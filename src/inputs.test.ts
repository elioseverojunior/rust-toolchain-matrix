// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
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
    expect(options.workingDirectory).toBe(".");
    expect(options.workspaceMode).toBe("root");
    expect(options.includeMsrv).toBe(true);
    expect(options.channels).toEqual([]);
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
    expect(options.toolchain).toBe("1.90");
    expect(options.channels).toEqual(["beta", "nightly"]);
    expect(options.workspaceMode).toBe("per-crate");
    expect(options.includeMsrv).toBe(false);
    expect(options.runnerMap["wasm32-unknown-unknown"]).toBe("self-hosted");
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
});
