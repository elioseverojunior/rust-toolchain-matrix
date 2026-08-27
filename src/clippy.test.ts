// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import { parseClippyConfig } from "./clippy.ts";

describe("parseClippyConfig", () => {
  it("reads an msrv key", () => {
    expect(parseClippyConfig('msrv = "1.88"\n').msrv).toBe("1.88");
  });

  it("returns nothing when the key is absent", () => {
    expect(
      parseClippyConfig("avoid-breaking-exported-api = false\n").msrv,
    ).toBeUndefined();
  });

  it("rejects malformed TOML", () => {
    expect(() => parseClippyConfig('msrv = "\n')).toThrow(
      ".clippy.toml is not valid TOML",
    );
  });
});
