// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { globSync, readFileSync } from "node:fs";

import { describe, expect, it } from "bun:test";

import { run } from "./action.ts";
import type { ActionDeps } from "./deps.ts";
import type { MatrixLeg } from "./matrix.ts";

function fixtureDeps(
  fixture: string,
  inputs: Record<string, string>,
): { deps: ActionDeps; outputs: Map<string, string>; failures: string[] } {
  const outputs = new Map<string, string>();
  const failures: string[] = [];
  const values: Record<string, string> = {
    "working-directory": `fixtures/${fixture}`,
    ...inputs,
  };
  return {
    outputs,
    failures,
    deps: {
      core: {
        getInput: (name) => values[name] ?? "",
        setOutput: (name, value) => outputs.set(name, value),
        setFailed: (message) => failures.push(message),
        warning: () => undefined,
        info: () => undefined,
      },
      readFile: (path) => readFileSync(path, "utf8"),
      glob: (pattern, cwd) => globSync(pattern, { cwd }),
      cwd: process.cwd(),
    },
  };
}

function matrixInclude(outputs: Map<string, string>): readonly MatrixLeg[] {
  const raw = outputs.get("matrix");
  if (raw === undefined) {
    throw new Error("matrix output missing");
  }
  const parsed: unknown = JSON.parse(raw);
  return (parsed as { include: MatrixLeg[] }).include;
}

function legCount(outputs: Map<string, string>): number {
  return matrixInclude(outputs).length;
}

describe("golden fixtures", () => {
  it("cli has no MSRV and one toolchain", () => {
    const g = fixtureDeps("cli", {});
    run(g.deps);
    expect(g.failures).toEqual([]);
    expect(g.outputs.get("msrv-source")).toBe("none");
    expect(g.outputs.get("toolchains")).toBe('["1.97"]');

    // Assert leg CONTENTS, not just the count: `cli` has exactly one
    // toolchain and four targets declared in rust-toolchain.toml, so the
    // whole `include` array is small enough to pin down completely. This is
    // the whole-object assertion the earlier tasks kept needing fix rounds
    // for skipping.
    expect(matrixInclude(g.outputs)).toEqual([
      {
        toolchain: "1.97",
        target: "wasm32-unknown-unknown",
        os: "ubuntu-latest",
        "can-run": false,
      },
      {
        toolchain: "1.97",
        target: "x86_64-unknown-linux-gnu",
        os: "ubuntu-latest",
        "can-run": true,
      },
      {
        toolchain: "1.97",
        target: "aarch64-unknown-linux-gnu",
        os: "ubuntu-24.04-arm",
        "can-run": true,
      },
      {
        toolchain: "1.97",
        target: "x86_64-apple-darwin",
        os: "macos-15-intel",
        "can-run": true,
      },
    ]);
  });

  it("cli-msrv adds the MSRV leg", () => {
    const g = fixtureDeps("cli-msrv", {});
    run(g.deps);
    expect(g.failures).toEqual([]);
    expect(g.outputs.get("toolchains")).toBe('["1.97","1.88"]');
    // 2 toolchains (pinned channel + MSRV) x 4 targets from
    // rust-toolchain.toml.
    expect(legCount(g.outputs)).toBe(8);
  });

  it("workspace-lib-msrv resolves 8 legs in root mode", () => {
    const g = fixtureDeps("workspace-lib-msrv", { "workspace-mode": "root" });
    run(g.deps);
    expect(g.failures).toEqual([]);
    expect(g.outputs.get("msrv")).toBe("1.88");
    expect(legCount(g.outputs)).toBe(8);
  });

  it("workspace-lib-msrv aggregates to the maximum member MSRV", () => {
    const g = fixtureDeps("workspace-lib-msrv", {
      "workspace-mode": "aggregate",
    });
    run(g.deps);
    expect(g.failures).toEqual([]);
    expect(g.outputs.get("msrv")).toBe("1.92");
    expect(legCount(g.outputs)).toBe(8);
  });

  // `per-crate` mode drives `MatrixBuilder` once per crate, so this is the
  // one shape where `action.ts` has to merge separately-built matrices
  // rather than delegate to a single builder call. `workspace-lib-msrv` has
  // three members with three different MSRV shapes:
  //   - channel: inherits `rust-version.workspace = true` -> 1.88, which
  //     differs from the pinned channel 1.97, so it gets its own MSRV leg
  //     (2 toolchains).
  //   - version: declares no `rust-version` at all, so it never opts in to
  //     an MSRV leg (1 toolchain).
  //   - strict: declares `rust-version = "1.92"` directly, above the
  //     workspace floor, so it also gets its own MSRV leg (2 toolchains).
  // Each toolchain is crossed with the 4 targets from rust-toolchain.toml:
  // (2 + 1 + 2) x 4 = 20.
  it("workspace-lib-msrv resolves 20 legs in per-crate mode", () => {
    const g = fixtureDeps("workspace-lib-msrv", {
      "workspace-mode": "per-crate",
    });
    run(g.deps);
    expect(g.failures).toEqual([]);
    expect(legCount(g.outputs)).toBe(20);
  });

  it("workspace-lib has nothing to validate", () => {
    const g = fixtureDeps("workspace-lib", { "workspace-mode": "root" });
    run(g.deps);
    expect(g.failures).toEqual([]);
    expect(g.outputs.get("msrv-source")).toBe("none");
  });
});
