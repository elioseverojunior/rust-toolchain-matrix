// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { parseClippyConfig } from "./clippy.ts";
import type { ActionDeps } from "./deps.ts";
import type { Manifest, MsrvSource } from "./manifest.ts";
import { parseManifest } from "./manifest.ts";
import { maxVersion } from "./version.ts";

/** How a workspace is projected onto matrix legs. */
export type WorkspaceMode = "root" | "per-crate" | "aggregate";

/** One resolved crate (or the whole tree) that the matrix is built from. */
export interface Unit {
  readonly directory: string;
  readonly name: string;
  readonly rustVersion?: string;
  readonly msrvSource: MsrvSource;
  readonly clippyMsrv?: string;
}

interface ExpandInput {
  readonly deps: ActionDeps;
  readonly root: string;
  readonly manifest: Manifest;
  readonly mode: WorkspaceMode;
}

function readOptional(deps: ActionDeps, path: string): string | undefined {
  try {
    return deps.readFile(path);
  } catch {
    return undefined;
  }
}

function clippyMsrvAt(deps: ActionDeps, directory: string): string | undefined {
  const raw = readOptional(deps, `${directory}/.clippy.toml`);
  return raw === undefined ? undefined : parseClippyConfig(raw).msrv;
}

function memberDirectories(input: ExpandInput): readonly string[] {
  const { deps, root, manifest } = input;
  const matched = manifest.members.flatMap((pattern) =>
    deps.glob(pattern, root),
  );
  const excluded = new Set(manifest.exclude);
  const kept = matched.filter((entry) => !excluded.has(entry));
  if (manifest.members.length > 0 && kept.length === 0) {
    throw new Error(
      `Cargo.toml declares workspace members ${manifest.members.join(", ")} ` +
        "but the pattern expanded to zero crates",
    );
  }
  return kept;
}

function memberUnits(input: ExpandInput): readonly Unit[] {
  const { deps, root, manifest } = input;
  return memberDirectories(input).map((relative) => {
    const directory = `${root}/${relative}`;
    const member = parseManifest(deps.readFile(`${directory}/Cargo.toml`));
    const rustVersion = member.inheritsRustVersion
      ? manifest.workspaceRustVersion
      : member.rustVersion;
    return {
      directory,
      name: member.name ?? relative,
      rustVersion,
      msrvSource: member.msrvSource,
      clippyMsrv: clippyMsrvAt(deps, directory),
    };
  });
}

function rootUnit(input: ExpandInput): Unit {
  const { deps, root, manifest } = input;
  return {
    directory: root,
    name: manifest.name ?? "workspace",
    rustVersion: manifest.rustVersion,
    msrvSource: manifest.msrvSource,
    clippyMsrv: clippyMsrvAt(deps, root),
  };
}

function aggregateUnit(input: ExpandInput): Unit {
  const members = memberUnits(input);
  const declared = members
    .map((unit) => unit.rustVersion)
    .filter((value): value is string => value !== undefined);
  const highest = maxVersion(declared);
  const base = rootUnit(input);
  return {
    ...base,
    rustVersion: highest ?? base.rustVersion,
    msrvSource: highest === undefined ? base.msrvSource : "workspace-inherit",
  };
}

/** Projects a manifest onto the units the matrix is built from. */
export function expandWorkspace(input: ExpandInput): Unit[] {
  if (!input.manifest.isWorkspaceRoot) {
    return [rootUnit(input)];
  }
  if (input.mode === "root") {
    return [rootUnit(input)];
  }
  if (input.mode === "aggregate") {
    return [aggregateUnit(input)];
  }
  return [...memberUnits(input)];
}
