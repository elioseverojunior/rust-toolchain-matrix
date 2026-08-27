// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
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
      expect(resolveRunner(target, {})).toEqual({
        os,
        canRun: true,
        mapped: true,
      });
    }
  });

  it("does not put an x86_64 macOS target on an ARM runner", () => {
    expect(resolveRunner("x86_64-apple-darwin", {}).os).not.toBe(
      "macos-latest",
    );
  });

  it("maps every wasm32-* triple to ubuntu-latest, not runnable, but mapped", () => {
    // FINDING I1: the spec's target-to-runner table maps the whole
    // `wasm32-*` family via a PREFIX match, not one exact triple — this
    // used to fall through to the unmapped fallback (`mapped: false`),
    // which wrongly fired the "no runner mapping" warning for a target the
    // spec explicitly maps.
    const cases = [
      "wasm32-unknown-unknown",
      "wasm32-wasip1",
      "wasm32-unknown-emscripten",
    ];
    for (const target of cases) {
      expect(resolveRunner(target, {})).toEqual({
        os: "ubuntu-latest",
        canRun: false,
        mapped: true,
      });
    }
  });

  it("falls back for an unmapped target and reports it", () => {
    expect(resolveRunner("riscv64gc-unknown-linux-gnu", {})).toEqual({
      os: "ubuntu-latest",
      canRun: false,
      mapped: false,
    });
  });

  it("lets an override win", () => {
    expect(
      resolveRunner("wasm32-unknown-unknown", {
        "wasm32-unknown-unknown": "self-hosted-wasm",
      }),
    ).toEqual({
      os: "self-hosted-wasm",
      canRun: false,
      mapped: true,
    });
  });
});
