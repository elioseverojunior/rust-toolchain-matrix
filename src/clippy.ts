// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { parse } from "smol-toml";

import { describeError } from "./errors.ts";

/** The single key this action reads out of a `.clippy.toml`. */
export interface ClippyConfig {
  readonly msrv?: string;
}

/** Parses a `.clippy.toml`. Throws on malformed TOML. */
export function parseClippyConfig(toml: string): ClippyConfig {
  let document: unknown;
  try {
    document = parse(toml);
  } catch (error) {
    throw new Error(`.clippy.toml is not valid TOML: ${describeError(error)}`, {
      cause: error,
    });
  }
  const root =
    typeof document === "object" && document !== null
      ? (document as Record<string, unknown>)
      : {};
  const msrv = root["msrv"];
  return {
    msrv: typeof msrv === "string" && msrv.length > 0 ? msrv : undefined,
  };
}
