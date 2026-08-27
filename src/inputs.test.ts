// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import type { ActionCore } from "./deps.ts";
import { parseList, readOptions } from "./inputs.ts";

function coreWith(values: Record<string, string>): ActionCore {
  return {
    getInput: (name: string) => values[name] ?? "",
    setOutput: () => undefined,
    setFailed: () => undefined,
    warning: () => undefined,
    info: () => undefined,
  };
}

describe("parseList", () => {
  it("splits on commas, spaces, and newlines", () => {
    expect(parseList("a, b\nc  d")).toEqual(["a", "b", "c", "d"]);
  });

  it("returns empty for blank input", () => {
    expect(parseList("   ")).toEqual([]);
  });
});

describe("readOptions", () => {
  it("applies documented defaults", () => {
    const options = readOptions(coreWith({}));
    expect(options).toEqual({
      workingDirectory: ".",
      toolchain: undefined,
      channels: [],
      targets: [],
      runnerMap: {},
      workspaceMode: "root",
      includeMsrv: true,
    });
  });

  it("reads every input", () => {
    const options = readOptions(
      coreWith({
        "working-directory": "fixtures/cli",
        toolchain: "1.90",
        channels: "beta, nightly",
        targets: "wasm32-unknown-unknown",
        "workspace-mode": "per-crate",
        "include-msrv": "false",
        "runner-map": '{"wasm32-unknown-unknown":"self-hosted"}',
      }),
    );
    expect(options).toEqual({
      workingDirectory: "fixtures/cli",
      toolchain: "1.90",
      channels: ["beta", "nightly"],
      targets: ["wasm32-unknown-unknown"],
      runnerMap: { "wasm32-unknown-unknown": "self-hosted" },
      workspaceMode: "per-crate",
      includeMsrv: false,
    });
  });

  it("accepts legitimate channel formats", () => {
    const optionsWithDateChannel = readOptions(
      coreWith({ channels: "nightly-2026-08-03-x86_64-apple-darwin" }),
    );
    expect(optionsWithDateChannel.channels).toEqual([
      "nightly-2026-08-03-x86_64-apple-darwin",
    ]);

    const optionsWithVersionChannel = readOptions(
      coreWith({ channels: "1.88.0-beta.1" }),
    );
    expect(optionsWithVersionChannel.channels).toEqual(["1.88.0-beta.1"]);
  });

  it("rejects an invalid workspace mode", () => {
    expect(() => readOptions(coreWith({ "workspace-mode": "nope" }))).toThrow(
      "workspace-mode must be one of",
    );
  });

  it("rejects a runner-map that is not a JSON object", () => {
    expect(() => readOptions(coreWith({ "runner-map": "[1]" }))).toThrow(
      "runner-map must be a JSON object",
    );
    expect(() => readOptions(coreWith({ "runner-map": "{" }))).toThrow(
      "runner-map must be a JSON object",
    );
  });

  it("rejects a target name that is not an identifier", () => {
    expect(() => readOptions(coreWith({ targets: "../etc/passwd" }))).toThrow(
      "is not a valid identifier",
    );
  });

  it("rejects a channel name that is not an identifier", () => {
    expect(() => readOptions(coreWith({ channels: "../etc/passwd" }))).toThrow(
      "is not a valid identifier",
    );
  });
});
