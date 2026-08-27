// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { parse, type TomlTable } from "smol-toml";

import { describeError } from "./errors.ts";

/** The single key this action reads out of a `.clippy.toml`. */
export interface ClippyConfig {
  readonly msrv?: string;
}

/** Parses a `.clippy.toml`. Throws on malformed TOML. */
export function parseClippyConfig(toml: string): ClippyConfig {
  // An immediately-invoked function keeps `document`'s type as whatever
  // `parse` actually returns (a table, always — it never yields `unknown`),
  // instead of widening it to `unknown` and reintroducing a defensive
  // guard that can never be false.
  const document = ((): TomlTable => {
    try {
      return parse(toml);
    } catch (error) {
      throw new Error(
        `.clippy.toml is not valid TOML: ${describeError(error)}`,
        {
          cause: error,
        },
      );
    }
  })();

  const msrv = document["msrv"];
  return {
    msrv: typeof msrv === "string" && msrv.length > 0 ? msrv : undefined,
  };
}
