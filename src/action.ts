// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { isDatedNonNightly, parseChannel } from "./channel.ts";
import type { ActionDeps } from "./deps.ts";
import { describeError } from "./errors.ts";
import { assertIdentifier, readOptions } from "./inputs.ts";
import { parseManifest } from "./manifest.ts";
import type { MatrixLeg } from "./matrix.ts";
import { MatrixBuilder } from "./matrix.ts";
import { assertClippyAgreement, assertToolchainMeetsMsrv } from "./msrv.ts";
import { buildInstallPlan, toOutputEntries } from "./outputs.ts";
import { resolveRunner } from "./runners.ts";
import { parseToolchainFile } from "./toolchain.ts";
import { expandWorkspace } from "./workspace.ts";

/** Components rustup's `default` profile does not ship. */
const NON_DEFAULT = ["llvm-tools", "rustc-dev", "miri", "rust-analyzer"];

function readOptional(deps: ActionDeps, path: string): string | undefined {
  try {
    return deps.readFile(path);
  } catch {
    return undefined;
  }
}

/**
 * Runs the whole pipeline.
 *
 * The only function that catches. Library modules throw; this turns a throw
 * into `setFailed`, and emits nothing at all on failure — a downstream job
 * reading an empty matrix is skipped silently, so a partial emit would be
 * worse than none.
 */
export function run(deps: ActionDeps): void {
  try {
    const options = readOptions(deps.core);
    const root = options.workingDirectory;

    // Cargo.toml is mandatory; letting its absence propagate IS the fatal.
    const manifest = parseManifest(deps.readFile(`${root}/Cargo.toml`));

    const rawToolchain = readOptional(deps, `${root}/rust-toolchain.toml`);
    const toolchainFile =
      rawToolchain === undefined
        ? { components: [], targets: [] }
        : parseToolchainFile(rawToolchain);

    if (toolchainFile.path !== undefined && options.toolchain === undefined) {
      throw new Error(
        "rust-toolchain.toml declares `path` and no `toolchain` input was " +
          "given: a local toolchain has no channel to become a matrix leg",
      );
    }

    // RULING 2: `targets` and `components` here were read out of the checked
    // out repository's rust-toolchain.toml, not out of a workflow input.
    // `inputs.ts` already validates workflow-input `targets`/`channels` on
    // the grounds that they "arrive from an untrusted checkout" — but the
    // file actually read FROM that checkout was only ever filtered for
    // non-strings (toolchain.ts) and never pattern-checked, which inverted
    // the spec's own rationale: the trusted path was validated and the
    // untrusted one was not. Reuse the same identifier checker `inputs.ts`
    // exports so a future tightening of the pattern covers both paths.
    for (const target of toolchainFile.targets) {
      assertIdentifier(target, "target");
    }
    for (const component of toolchainFile.components) {
      assertIdentifier(component, "component");
    }

    // RULING 1: per-directory clippy validation is mode-independent. A
    // member crate's `.clippy.toml` must agree with its own `Cargo.toml`
    // regardless of `workspace-mode`, because that agreement is a property
    // of the files on disk, not of which units the matrix happens to use.
    // `root` and `aggregate` mode collapse a workspace to a single unit,
    // which would let a disagreeing member go unchecked. So: for a
    // workspace root, expand ONCE with "per-crate" purely to obtain every
    // member directory and validate that full list. A plain package is not
    // a workspace root — `expandWorkspace` returns the very same single
    // unit no matter the mode passed to it — so there the validation set
    // and the matrix set are one call, not two.
    const validationUnits = manifest.isWorkspaceRoot
      ? expandWorkspace({ deps, root, manifest, mode: "per-crate" })
      : expandWorkspace({
          deps,
          root,
          manifest,
          mode: options.workspaceMode,
        });

    for (const unit of validationUnits) {
      assertClippyAgreement({
        directory: unit.directory,
        clippyMsrv: unit.clippyMsrv,
        manifestRustVersion: unit.rustVersion,
      });
    }

    // Matrix shape IS mode-dependent, unlike validation above: expand again
    // with the caller's chosen mode. For a plain package this is the same
    // single unit already computed as `validationUnits`, so it is reused
    // rather than re-read from disk.
    const units = manifest.isWorkspaceRoot
      ? expandWorkspace({ deps, root, manifest, mode: options.workspaceMode })
      : validationUnits;

    const primary = units[0];
    const pin =
      options.toolchain ??
      toolchainFile.channel ??
      primary?.rustVersion ??
      "stable";
    const pinned = parseChannel(pin);

    if (toolchainFile.profile === "complete") {
      deps.core.warning(
        'profile = "complete" is documented as typically failing during ' +
          "installation",
      );
    }
    if (isDatedNonNightly(pinned)) {
      deps.core.warning(
        `channel "${pinned.raw}" is dated, which rustup documents only for ` +
          "nightly",
      );
    }

    const targets = [
      ...new Set([...options.targets, ...toolchainFile.targets]),
    ];
    for (const target of targets) {
      if (!resolveRunner(target, options.runnerMap).mapped) {
        deps.core.warning(
          `target "${target}" has no runner mapping; falling back to ` +
            "ubuntu-latest as an unverified cross-compile",
        );
      }
    }

    const legs: MatrixLeg[] = [];
    const toolchains: string[] = [];
    const crates: string[] = [];
    const perCrate = units.length > 1;

    for (const unit of units) {
      const msrv = unit.rustVersion;
      const forUnit = [pin];
      if (options.includeMsrv && msrv !== undefined) {
        if (msrv === pin) {
          deps.core.warning(
            `MSRV leg for ${unit.name} suppressed: it equals the pinned ` +
              `channel ${pin}`,
          );
        } else {
          forUnit.push(msrv);
        }
      }
      const all = [...forUnit, ...options.channels];
      for (const raw of all) {
        assertToolchainMeetsMsrv(parseChannel(raw), msrv);
      }

      const builder = new MatrixBuilder()
        .withToolchains(all)
        .withTargets(targets)
        .withRunnerOverrides(options.runnerMap);
      if (perCrate) {
        builder.withCrate(unit.name);
        crates.push(unit.name);
      }
      const built = builder.build();
      legs.push(...built.include);
      toolchains.push(...built.toolchains);
    }

    const entries = toOutputEntries({
      matrix: { include: legs },
      toolchains: [...new Set(toolchains)],
      targets,
      runners: [...new Set(legs.map((leg) => leg.os))],
      crates,
      channel: pin,
      msrv: primary?.rustVersion ?? "",
      "msrv-source": primary?.msrvSource ?? "none",
      components: toolchainFile.components,
      profile: toolchainFile.profile ?? "",
      "install-plan": buildInstallPlan({
        profile: toolchainFile.profile,
        components: toolchainFile.components,
        hasTargets: targets.length > 0,
      }),
    });
    for (const [name, value] of entries) {
      deps.core.setOutput(name, value);
    }

    const nonDefault = toolchainFile.components.filter((component) =>
      NON_DEFAULT.includes(component),
    );
    const hasNightly = toolchains.some(
      (raw) => parseChannel(raw).kind === "nightly",
    );
    if (nonDefault.length > 0 && hasNightly) {
      deps.core.warning(
        "nightly builds may be published without non-default components: " +
          nonDefault.join(", "),
      );
    }
  } catch (error) {
    deps.core.setFailed(describeError(error));
  }
}
