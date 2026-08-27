// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { parse, type TomlTable } from "smol-toml";

import { describeError } from "./errors.ts";

/** Where a resolved MSRV came from. Published as an output, so it is versioned. */
export type MsrvSource = "cargo-toml" | "workspace-inherit" | "none";

/** The parts of a `Cargo.toml` this action reads. */
export interface Manifest {
  readonly name?: string;
  readonly rustVersion?: string;
  readonly msrvSource: MsrvSource;
  readonly isWorkspaceRoot: boolean;
  readonly members: readonly string[];
  readonly exclude: readonly string[];
  readonly defaultMembers: readonly string[];
  readonly workspaceRustVersion?: string;
  readonly inheritsRustVersion: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function declaredVersion(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * True when a table opts into workspace inheritance.
 *
 * This is the one trap in this file: `rust-version.workspace = true` parses to
 * the object `{ workspace: true }`, not to a string. Code that expects a string
 * here reads no MSRV and silently reports none.
 */
function inherits(table: Record<string, unknown>): boolean {
  const value = table["rust-version"];
  return isRecord(value) && value["workspace"] === true;
}

/** Parses a `Cargo.toml`. Throws on malformed TOML. */
export function parseManifest(toml: string): Manifest {
  // An immediately-invoked function keeps `document`'s type as whatever
  // `parse` actually returns (a table, always — it never yields `unknown`),
  // instead of widening it to `unknown` and reintroducing a defensive
  // `isRecord` check that can never be false.
  const document = ((): TomlTable => {
    try {
      return parse(toml);
    } catch (error) {
      throw new Error(`Cargo.toml is not valid TOML: ${describeError(error)}`, {
        cause: error,
      });
    }
  })();

  const pkg = isRecord(document["package"]) ? document["package"] : undefined;
  const workspace = isRecord(document["workspace"])
    ? document["workspace"]
    : undefined;
  // smol-toml renders `[workspace.package]` as a nested `package` table under
  // `workspace`, never as a flat `"workspace.package"` key — verified against
  // the installed smol-toml@1.8.0.
  const workspacePackage = isRecord(workspace?.["package"])
    ? workspace["package"]
    : undefined;

  const workspaceRustVersion = declaredVersion(
    workspacePackage?.["rust-version"],
  );
  const direct =
    pkg === undefined ? undefined : declaredVersion(pkg["rust-version"]);
  const optsIn = pkg !== undefined && inherits(pkg);

  let rustVersion: string | undefined;
  let msrvSource: MsrvSource = "none";
  if (direct !== undefined) {
    rustVersion = direct;
    msrvSource = "cargo-toml";
  } else if (optsIn) {
    // The member opts in; the value itself lives in the workspace root, which
    // this single-file parse may not have. Resolution happens in workspace.ts.
    msrvSource = "workspace-inherit";
  } else if (pkg === undefined && workspaceRustVersion !== undefined) {
    rustVersion = workspaceRustVersion;
    msrvSource = "workspace-inherit";
  }

  return {
    name: declaredVersion(pkg?.["name"]),
    rustVersion,
    msrvSource,
    isWorkspaceRoot: workspace !== undefined,
    members: stringList(workspace?.["members"]),
    exclude: stringList(workspace?.["exclude"]),
    defaultMembers: stringList(workspace?.["default-members"]),
    workspaceRustVersion,
    inheritsRustVersion: optsIn,
  };
}
