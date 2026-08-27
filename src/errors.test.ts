// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import { describeError } from "./errors.ts";

describe("describeError", () => {
  it("uses the message of an Error", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("passes a string through unchanged", () => {
    expect(describeError("plain failure")).toBe("plain failure");
  });

  it("serialises a non-Error value", () => {
    expect(describeError({ code: 7 })).toBe('{"code":7}');
  });

  it("falls back when serialisation fails", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(describeError(circular)).toBe("[unserialisable error]");
  });

  it("falls back for undefined, whose JSON.stringify is undefined rather than throwing", () => {
    // `JSON.stringify(undefined)` returns `undefined` — it does not throw —
    // so this exercises the `?? "[unserialisable error]"` branch directly,
    // distinct from the `catch` branch above.
    expect(describeError(undefined)).toBe("[unserialisable error]");
  });
});
