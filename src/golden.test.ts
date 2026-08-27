// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { globSync, readFileSync } from "node:fs";

import { describe, expect, it } from "bun:test";

import { run } from "./action.ts";
import type { ActionDeps } from "./deps.ts";
import type { MatrixLeg } from "./matrix.ts";

function fixtureDeps(
  fixture: string,
  inputs: Record<string, string>,
): { deps: ActionDeps; outputs: Map<string, string>; failures: string[] } {
  const outputs = new Map<string, string>();
  const failures: string[] = [];
  const values: Record<string, string> = {
    "working-directory": `fixtures/${fixture}`,
    ...inputs,
  };
  return {
    outputs,
    failures,
    deps: {
      core: {
        getInput: (name) => values[name] ?? "",
        setOutput: (name, value) => outputs.set(name, value),
        setFailed: (message) => failures.push(message),
        warning: () => undefined,
        info: () => undefined,
      },
      readFile: (path) => readFileSync(path, "utf8"),
      glob: (pattern, cwd) => globSync(pattern, { cwd }),
      cwd: process.cwd(),
    },
  };
}

function matrixInclude(outputs: Map<string, string>): readonly MatrixLeg[] {
  const raw = outputs.get("matrix");
  if (raw === undefined) {
    throw new Error("matrix output missing");
  }
  const parsed: unknown = JSON.parse(raw);
  return (parsed as { include: MatrixLeg[] }).include;
}

function legCount(outputs: Map<string, string>): number {
  return matrixInclude(outputs).length;
}

/**
 * Groups per-crate legs by their `crate` key.
 *
 * A bare total leg count cannot tell a correct per-crate merge from a wrong
 * one that happens to sum to the same number (e.g. every leg carrying the
 * same crate name, or the toolchains misassigned across crates). This is
 * what lets a test assert the actual DISTRIBUTION instead.
 */
function groupLegsByCrate(
  legs: readonly MatrixLeg[],
): Map<string, MatrixLeg[]> {
  const grouped = new Map<string, MatrixLeg[]>();
  for (const leg of legs) {
    const crate = leg.crate;
    if (crate === undefined) {
      throw new Error("leg is missing a crate name in per-crate mode");
    }
    const existing = grouped.get(crate);
    if (existing === undefined) {
      grouped.set(crate, [leg]);
    } else {
      existing.push(leg);
    }
  }
  return grouped;
}

/** The distinct toolchains present among a set of legs, sorted for a stable comparison. */
function distinctToolchains(legs: readonly MatrixLeg[]): string[] {
  return [...new Set(legs.map((leg) => leg.toolchain))].sort();
}

describe("golden fixtures", () => {
  it("cli has no MSRV and one toolchain", () => {
    const g = fixtureDeps("cli", {});
    run(g.deps);
    expect(g.failures).toEqual([]);
    expect(g.outputs.get("msrv-source")).toBe("none");
    expect(g.outputs.get("toolchains")).toBe('["1.97"]');

    // Assert leg CONTENTS, not just the count: `cli` has exactly one
    // toolchain and four targets declared in rust-toolchain.toml, so the
    // whole `include` array is small enough to pin down completely. This is
    // the whole-object assertion the earlier tasks kept needing fix rounds
    // for skipping.
    expect(matrixInclude(g.outputs)).toEqual([
      {
        toolchain: "1.97",
        target: "wasm32-unknown-unknown",
        os: "ubuntu-latest",
        "can-run": false,
      },
      {
        toolchain: "1.97",
        target: "x86_64-unknown-linux-gnu",
        os: "ubuntu-latest",
        "can-run": true,
      },
      {
        toolchain: "1.97",
        target: "aarch64-unknown-linux-gnu",
        os: "ubuntu-24.04-arm",
        "can-run": true,
      },
      {
        toolchain: "1.97",
        target: "x86_64-apple-darwin",
        os: "macos-15-intel",
        "can-run": true,
      },
    ]);
  });

  it("cli-msrv adds the MSRV leg", () => {
    const g = fixtureDeps("cli-msrv", {});
    run(g.deps);
    expect(g.failures).toEqual([]);
    expect(g.outputs.get("toolchains")).toBe('["1.97","1.88"]');
    // 2 toolchains (pinned channel + MSRV) x 4 targets from
    // rust-toolchain.toml.
    expect(legCount(g.outputs)).toBe(8);
  });

  it("workspace-lib-msrv resolves 8 legs in root mode", () => {
    const g = fixtureDeps("workspace-lib-msrv", { "workspace-mode": "root" });
    run(g.deps);
    expect(g.failures).toEqual([]);
    expect(g.outputs.get("msrv")).toBe("1.88");
    expect(legCount(g.outputs)).toBe(8);
  });

  it("workspace-lib-msrv aggregates to the maximum member MSRV", () => {
    const g = fixtureDeps("workspace-lib-msrv", {
      "workspace-mode": "aggregate",
    });
    run(g.deps);
    expect(g.failures).toEqual([]);
    expect(g.outputs.get("msrv")).toBe("1.92");
    expect(legCount(g.outputs)).toBe(8);
  });

  // `per-crate` mode drives `MatrixBuilder` once per crate, so this is the
  // one shape where `action.ts` has to merge separately-built matrices
  // rather than delegate to a single builder call. `workspace-lib-msrv` has
  // three members with three different MSRV shapes:
  //   - channel: inherits `rust-version.workspace = true` -> 1.88, which
  //     differs from the pinned channel 1.97, so it gets its own MSRV leg
  //     (2 toolchains).
  //   - version: declares no `rust-version` at all, so it never opts in to
  //     an MSRV leg (1 toolchain).
  //   - strict: declares `rust-version = "1.92"` directly, above the
  //     workspace floor, so it also gets its own MSRV leg (2 toolchains).
  // Each toolchain is crossed with the 4 targets from rust-toolchain.toml:
  // (2 + 1 + 2) x 4 = 20.
  it("workspace-lib-msrv resolves 20 legs in per-crate mode", () => {
    const g = fixtureDeps("workspace-lib-msrv", {
      "workspace-mode": "per-crate",
    });
    run(g.deps);
    expect(g.failures).toEqual([]);
    expect(legCount(g.outputs)).toBe(20);

    // A bare total is the one assertion shape that CANNOT catch a wrong
    // merge across the per-crate units: channel=1/version=2/strict=2 (or
    // every leg carrying the same crate name) also sums to 20. Assert the
    // DISTRIBUTION instead -- how many legs, and which distinct toolchains,
    // landed on each crate. `version` staying at exactly `["1.97"]` while
    // `channel` and `strict` pick up their own MSRV is the observable proof
    // that the opt-in inheritance rule survives the per-unit merge in
    // `action.ts`, not just that some 20 legs came out the other end.
    const byCrate = groupLegsByCrate(matrixInclude(g.outputs));
    expect([...byCrate.keys()].sort()).toEqual([
      "channel",
      "strict",
      "version",
    ]);

    const channelLegs = byCrate.get("channel") ?? [];
    expect(channelLegs.length).toBe(8);
    expect(distinctToolchains(channelLegs)).toEqual(["1.88", "1.97"]);

    const versionLegs = byCrate.get("version") ?? [];
    expect(versionLegs.length).toBe(4);
    expect(distinctToolchains(versionLegs)).toEqual(["1.97"]);

    const strictLegs = byCrate.get("strict") ?? [];
    expect(strictLegs.length).toBe(8);
    expect(distinctToolchains(strictLegs)).toEqual(["1.92", "1.97"]);

    // The `crates` output is a separate emitted value from `matrix` itself;
    // assert it names exactly these three crates too. Compared sorted
    // because emission order follows `deps.glob`'s match order, which this
    // test does not pin down and should not need to.
    const rawCrates = g.outputs.get("crates");
    if (rawCrates === undefined) {
      throw new Error("crates output missing");
    }
    const crates: unknown = JSON.parse(rawCrates);
    expect((crates as string[]).slice().sort()).toEqual([
      "channel",
      "strict",
      "version",
    ]);
  });

  it("workspace-lib has nothing to validate", () => {
    const g = fixtureDeps("workspace-lib", { "workspace-mode": "root" });
    run(g.deps);
    expect(g.failures).toEqual([]);
    expect(g.outputs.get("msrv-source")).toBe("none");
  });
});
