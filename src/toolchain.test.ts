// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import { parseToolchainFile } from "./toolchain.ts";

describe("parseToolchainFile", () => {
  it("reads channel, components, targets, and profile", () => {
    const parsed = parseToolchainFile(
      [
        "[toolchain]",
        'channel = "1.97"',
        'profile = "default"',
        'components = ["rustfmt", "clippy"]',
        'targets = ["wasm32-unknown-unknown"]',
      ].join("\n"),
    );
    expect(parsed.channel).toBe("1.97");
    expect(parsed.profile).toBe("default");
    expect(parsed.components).toEqual(["rustfmt", "clippy"]);
    expect(parsed.targets).toEqual(["wasm32-unknown-unknown"]);
  });

  it("returns empty values when the table is absent", () => {
    const parsed = parseToolchainFile("");
    expect(parsed.channel).toBeUndefined();
    expect(parsed.components).toEqual([]);
    expect(parsed.targets).toEqual([]);
  });

  it("accepts a path-only toolchain", () => {
    const parsed = parseToolchainFile('[toolchain]\npath = "/opt/rust"\n');
    expect(parsed.path).toBe("/opt/rust");
  });

  it("rejects channel and path together", () => {
    expect(() =>
      parseToolchainFile('[toolchain]\nchannel = "1.97"\npath = "/opt/rust"\n'),
    ).toThrow("mutually exclusive");
  });

  it("rejects an unknown profile", () => {
    expect(() =>
      parseToolchainFile('[toolchain]\nprofile = "everything"\n'),
    ).toThrow("profile must be one of");
  });

  it("rejects malformed TOML", () => {
    expect(() => parseToolchainFile("[toolchain\n")).toThrow(
      "rust-toolchain.toml is not valid TOML",
    );
  });

  it("ignores non-string entries in the lists", () => {
    const parsed = parseToolchainFile(
      '[toolchain]\ncomponents = ["clippy", 7]\n',
    );
    expect(parsed.components).toEqual(["clippy"]);
  });
});
