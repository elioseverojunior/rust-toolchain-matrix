// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { parse } from "smol-toml";

import { describeError } from "./errors.ts";

/** The `[toolchain]` table of a `rust-toolchain.toml`. */
export interface ToolchainFile {
  readonly channel?: string;
  readonly components: readonly string[];
  readonly targets: readonly string[];
  readonly profile?: string;
  readonly path?: string;
}

const PROFILES = ["minimal", "default", "complete"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Parses a `rust-toolchain.toml`.
 *
 * Throws on malformed TOML rather than degrading: a syntax error hides the
 * author's intent, and guessing past it produces a matrix nobody asked for.
 */
export function parseToolchainFile(toml: string): ToolchainFile {
  let document: unknown;
  try {
    document = parse(toml);
  } catch (error) {
    throw new Error(
      `rust-toolchain.toml is not valid TOML: ${describeError(error)}`,
      { cause: error },
    );
  }

  const table = isRecord(document) ? document["toolchain"] : undefined;
  if (!isRecord(table)) {
    return { components: [], targets: [] };
  }

  const channel = optionalString(table["channel"]);
  const path = optionalString(table["path"]);
  if (channel !== undefined && path !== undefined) {
    throw new Error(
      "rust-toolchain.toml declares both `channel` and `path`, which rustup " +
        "treats as mutually exclusive",
    );
  }

  const profile = optionalString(table["profile"]);
  if (profile !== undefined && !PROFILES.includes(profile)) {
    throw new Error(
      `rust-toolchain.toml profile must be one of ${PROFILES.join(", ")}; ` +
        `found "${profile}"`,
    );
  }

  return {
    channel,
    path,
    profile,
    components: stringList(table["components"]),
    targets: stringList(table["targets"]),
  };
}
