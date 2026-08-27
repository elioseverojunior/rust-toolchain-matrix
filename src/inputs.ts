// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import type { ActionCore } from "./deps.ts";
import type { WorkspaceMode } from "./workspace.ts";

/** Resolved action inputs. */
export interface Options {
  readonly workingDirectory: string;
  readonly toolchain?: string;
  readonly channels: readonly string[];
  readonly targets: readonly string[];
  readonly runnerMap: Readonly<Record<string, string>>;
  readonly workspaceMode: WorkspaceMode;
  readonly includeMsrv: boolean;
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Splits a list input on commas, spaces, and newlines. */
export function parseList(raw: string): string[] {
  return raw.split(/[,\s]+/).filter((entry) => entry.length > 0);
}

function isWorkspaceMode(value: string): value is WorkspaceMode {
  return value === "root" || value === "per-crate" || value === "aggregate";
}

/**
 * Rejects a value that is not a bare identifier.
 *
 * These arrive from an untrusted checkout and end up interpolated into rustup
 * arguments, so this is defence in depth plus a better error message.
 */
function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`${label} "${value}" is not a valid identifier`);
  }
}

function readRunnerMap(raw: string): Readonly<Record<string, string>> {
  if (raw.trim().length === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("runner-map must be a JSON object", { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("runner-map must be a JSON object");
  }
  const entries = Object.entries(parsed).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

/** Reads and validates every action input. */
export function readOptions(core: ActionCore): Options {
  const mode = core.getInput("workspace-mode") || "root";
  if (!isWorkspaceMode(mode)) {
    throw new Error("workspace-mode must be one of root, per-crate, aggregate");
  }

  const targets = parseList(core.getInput("targets"));
  for (const target of targets) {
    assertIdentifier(target, "target");
  }

  const channels = parseList(core.getInput("channels"));
  for (const channel of channels) {
    assertIdentifier(channel, "channel");
  }

  const toolchain = core.getInput("toolchain");

  return {
    workingDirectory: core.getInput("working-directory") || ".",
    toolchain: toolchain.length > 0 ? toolchain : undefined,
    channels,
    targets,
    runnerMap: readRunnerMap(core.getInput("runner-map")),
    workspaceMode: mode,
    includeMsrv: core.getInput("include-msrv") !== "false",
  };
}
