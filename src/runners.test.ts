// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import { resolveRunner } from "./runners.ts";

describe("resolveRunner", () => {
  it("maps every native triple to its native runner", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["x86_64-unknown-linux-gnu", "ubuntu-latest"],
      ["aarch64-unknown-linux-gnu", "ubuntu-24.04-arm"],
      ["x86_64-apple-darwin", "macos-15-intel"],
      ["aarch64-apple-darwin", "macos-latest"],
      ["x86_64-pc-windows-msvc", "windows-latest"],
      ["aarch64-pc-windows-msvc", "windows-11-arm"],
    ];
    for (const [target, os] of cases) {
      const choice = resolveRunner(target, {});
      expect(choice.os).toBe(os);
      expect(choice.canRun).toBe(true);
    }
  });

  it("does not put an x86_64 macOS target on an ARM runner", () => {
    expect(resolveRunner("x86_64-apple-darwin", {}).os).not.toBe(
      "macos-latest",
    );
  });

  it("maps wasm to ubuntu but marks it not runnable", () => {
    const choice = resolveRunner("wasm32-unknown-unknown", {});
    expect(choice.os).toBe("ubuntu-latest");
    expect(choice.canRun).toBe(false);
  });

  it("falls back for an unmapped target and reports it", () => {
    const choice = resolveRunner("riscv64gc-unknown-linux-gnu", {});
    expect(choice.os).toBe("ubuntu-latest");
    expect(choice.canRun).toBe(false);
    expect(choice.mapped).toBe(false);
  });

  it("lets an override win", () => {
    const choice = resolveRunner("wasm32-unknown-unknown", {
      "wasm32-unknown-unknown": "self-hosted-wasm",
    });
    expect(choice.os).toBe("self-hosted-wasm");
    expect(choice.mapped).toBe(true);
  });
});
