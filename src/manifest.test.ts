// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import { parseManifest } from "./manifest.ts";

describe("parseManifest", () => {
  it("reads a direct package rust-version", () => {
    const parsed = parseManifest(
      '[package]\nname = "cli"\nrust-version = "1.88"\n',
    );
    expect(parsed.name).toBe("cli");
    expect(parsed.rustVersion).toBe("1.88");
    expect(parsed.msrvSource).toBe("cargo-toml");
  });

  it("reports none when the package omits rust-version", () => {
    const parsed = parseManifest('[package]\nname = "cli"\n');
    expect(parsed.rustVersion).toBeUndefined();
    expect(parsed.msrvSource).toBe("none");
  });

  it("reads a virtual manifest's workspace rust-version", () => {
    const parsed = parseManifest(
      [
        "[workspace]",
        'members = ["crates/*"]',
        "[workspace.package]",
        'rust-version = "1.88"',
      ].join("\n"),
    );
    expect(parsed.isWorkspaceRoot).toBe(true);
    expect(parsed.members).toEqual(["crates/*"]);
    expect(parsed.rustVersion).toBe("1.88");
    expect(parsed.msrvSource).toBe("workspace-inherit");
  });

  it("detects the object form of rust-version.workspace", () => {
    const parsed = parseManifest(
      '[package]\nname = "channel"\nrust-version.workspace = true\n',
    );
    expect(parsed.inheritsRustVersion).toBe(true);
    expect(parsed.rustVersion).toBeUndefined();
    expect(parsed.msrvSource).toBe("workspace-inherit");
  });

  it("does not inherit when the package merely omits rust-version", () => {
    const parsed = parseManifest(
      [
        "[package]",
        'name = "version"',
        "[workspace.package]",
        'rust-version = "1.88"',
      ].join("\n"),
    );
    expect(parsed.inheritsRustVersion).toBe(false);
    expect(parsed.msrvSource).toBe("none");
  });

  it("reads exclude and default-members", () => {
    const parsed = parseManifest(
      [
        "[workspace]",
        'members = ["crates/*"]',
        'exclude = ["crates/legacy"]',
        'default-members = ["crates/core"]',
      ].join("\n"),
    );
    expect(parsed.exclude).toEqual(["crates/legacy"]);
    expect(parsed.defaultMembers).toEqual(["crates/core"]);
  });

  it("rejects malformed TOML", () => {
    expect(() => parseManifest("[package\n")).toThrow(
      "Cargo.toml is not valid TOML",
    );
  });
});
