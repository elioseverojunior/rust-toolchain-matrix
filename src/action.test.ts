// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import { run } from "./action.ts";
import type { ActionDeps } from "./deps.ts";

interface Recorded {
  readonly deps: ActionDeps;
  readonly outputs: Map<string, string>;
  readonly warnings: string[];
  readonly failures: string[];
}

function recordingDeps(files: Record<string, string>): Recorded {
  const outputs = new Map<string, string>();
  const warnings: string[] = [];
  const failures: string[] = [];
  const deps: ActionDeps = {
    core: {
      getInput: (name: string) => (name === "working-directory" ? "/p" : ""),
      setOutput: (name, value) => outputs.set(name, value),
      setFailed: (message) => failures.push(message),
      warning: (message) => warnings.push(message),
      info: () => undefined,
    },
    readFile: (path: string) => {
      const found = files[path];
      if (found === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }
      return found;
    },
    glob: () => [],
    cwd: "/p",
  };
  return { deps, outputs, warnings, failures };
}

/**
 * Like `recordingDeps`, but also drives `workspace-mode` and lets `glob`
 * return a fixed member list — needed for the RULING 1 tests below, which
 * exercise `expandWorkspace` over a real (fake) workspace instead of a
 * single package.
 */
function recordingWorkspaceDeps(
  files: Record<string, string>,
  members: readonly string[],
  workspaceMode?: string,
): Recorded {
  const outputs = new Map<string, string>();
  const warnings: string[] = [];
  const failures: string[] = [];
  const deps: ActionDeps = {
    core: {
      getInput: (name: string) => {
        if (name === "working-directory") {
          return "/p";
        }
        if (name === "workspace-mode") {
          return workspaceMode ?? "";
        }
        return "";
      },
      setOutput: (name, value) => outputs.set(name, value),
      setFailed: (message) => failures.push(message),
      warning: (message) => warnings.push(message),
      info: () => undefined,
    },
    readFile: (path: string) => {
      const found = files[path];
      if (found === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }
      return found;
    },
    glob: () => [...members],
    cwd: "/p",
  };
  return { deps, outputs, warnings, failures };
}

describe("run", () => {
  it("adds the MSRV as its own leg", () => {
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\nrust-version = "1.88"\n',
      "/p/rust-toolchain.toml": '[toolchain]\nchannel = "1.97"\n',
    });
    run(r.deps);
    expect(r.failures).toEqual([]);
    expect(r.outputs.get("toolchains")).toBe('["1.97","1.88"]');
    expect(r.outputs.get("msrv")).toBe("1.88");
    expect(r.outputs.get("msrv-source")).toBe("cargo-toml");
  });

  it("falls back to stable with no toolchain file", () => {
    const r = recordingDeps({ "/p/Cargo.toml": '[package]\nname = "cli"\n' });
    run(r.deps);
    expect(r.outputs.get("channel")).toBe("stable");
  });

  it("fails when Cargo.toml is missing", () => {
    const r = recordingDeps({});
    run(r.deps);
    expect(r.failures[0]).toContain("Cargo.toml");
  });

  it("fails on a clippy msrv that disagrees", () => {
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\nrust-version = "1.88"\n',
      "/p/.clippy.toml": 'msrv = "1.90"\n',
    });
    run(r.deps);
    expect(r.failures[0]).toContain("must be equal");
  });

  it("fails on a toolchain below the MSRV", () => {
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\nrust-version = "1.88"\n',
      "/p/rust-toolchain.toml": '[toolchain]\nchannel = "1.85"\n',
    });
    run(r.deps);
    expect(r.failures[0]).toContain("below the declared MSRV");
  });

  it("fails on a path toolchain with no toolchain input", () => {
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\n',
      "/p/rust-toolchain.toml": '[toolchain]\npath = "/opt/rust"\n',
    });
    run(r.deps);
    expect(r.failures[0]).toContain("no channel to become a matrix leg");
  });

  it("warns about the complete profile", () => {
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\n',
      "/p/rust-toolchain.toml":
        '[toolchain]\nchannel = "1.97"\nprofile = "complete"\n',
    });
    run(r.deps);
    expect(r.warnings.join(" ")).toContain("complete");
  });

  it("suppresses a duplicate MSRV leg and says so", () => {
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\nrust-version = "1.97"\n',
      "/p/rust-toolchain.toml": '[toolchain]\nchannel = "1.97"\n',
    });
    run(r.deps);
    expect(r.outputs.get("toolchains")).toBe('["1.97"]');
    expect(r.warnings.join(" ")).toContain("MSRV");
  });
});

describe("run — warning paths the base scenarios above never reach", () => {
  it("warns about a dated non-nightly channel", () => {
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\n',
      "/p/rust-toolchain.toml": '[toolchain]\nchannel = "beta-2026-01-01"\n',
    });
    run(r.deps);
    expect(r.failures).toEqual([]);
    expect(r.warnings).toEqual([
      'channel "beta-2026-01-01" is dated, which rustup documents only ' +
        "for nightly",
    ]);
  });

  it("warns about non-default components on a nightly leg", () => {
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\n',
      "/p/rust-toolchain.toml":
        '[toolchain]\nchannel = "nightly"\ncomponents = ["llvm-tools"]\n',
    });
    run(r.deps);
    expect(r.failures).toEqual([]);
    expect(r.warnings).toEqual([
      "nightly builds may be published without non-default components: " +
        "llvm-tools",
    ]);
  });
});

describe("run — RULING 2: validates identifiers read from the checkout", () => {
  it("rejects a rust-toolchain.toml target that is not a valid identifier", () => {
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\n',
      "/p/rust-toolchain.toml": '[toolchain]\ntargets = ["$bad"]\n',
    });
    run(r.deps);
    expect(r.failures[0]).toBe('target "$bad" is not a valid identifier');
  });

  it("rejects a rust-toolchain.toml component that is not a valid identifier", () => {
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\n',
      "/p/rust-toolchain.toml": '[toolchain]\ncomponents = ["bad component"]\n',
    });
    run(r.deps);
    expect(r.failures[0]).toBe(
      'component "bad component" is not a valid identifier',
    );
  });

  it("accepts realistic targets and components, still flagging the unmapped one", () => {
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\n',
      "/p/rust-toolchain.toml":
        "[toolchain]\n" +
        'channel = "1.97"\n' +
        'targets = ["wasm32-unknown-unknown", "x86_64-unknown-linux-gnu"]\n' +
        'components = ["rustfmt", "llvm-tools", "rust-src"]\n',
    });
    run(r.deps);
    expect(r.failures).toEqual([]);
    expect(r.warnings).toEqual([
      'target "wasm32-unknown-unknown" has no runner mapping; falling ' +
        "back to ubuntu-latest as an unverified cross-compile",
    ]);
    expect(r.outputs.get("channel")).toBe("1.97");
    expect(r.outputs.get("targets")).toBe(
      '["wasm32-unknown-unknown","x86_64-unknown-linux-gnu"]',
    );
    expect(r.outputs.get("components")).toBe(
      '["rustfmt","llvm-tools","rust-src"]',
    );
    expect(JSON.parse(r.outputs.get("matrix") ?? "null")).toEqual({
      include: [
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
      ],
    });
  });
});

describe("run — RULING 1: per-directory clippy validation is mode-independent", () => {
  it("fails on a member's clippy disagreement even though root mode never builds it", () => {
    const r = recordingWorkspaceDeps(
      {
        "/p/Cargo.toml": '[workspace]\nmembers = ["crates/*"]\n',
        "/p/crates/bad/Cargo.toml":
          '[package]\nname = "bad"\nrust-version = "1.88"\n',
        "/p/crates/bad/.clippy.toml": 'msrv = "1.90"\n',
      },
      ["crates/bad"],
      // workspace-mode left unset, so it defaults to "root" — the matrix
      // would only ever see the workspace root, never "crates/bad". Ruling
      // 1 requires validation to catch this member's disagreement anyway.
    );
    run(r.deps);
    expect(r.failures).toEqual([
      '/p/crates/bad/.clippy.toml declares msrv "1.90" but ' +
        '/p/crates/bad/Cargo.toml declares rust-version "1.88"; they ' +
        "must be equal",
    ]);
  });

  it("builds a correct per-crate matrix after validating every member", () => {
    const r = recordingWorkspaceDeps(
      {
        "/p/Cargo.toml": '[workspace]\nmembers = ["crates/*"]\n',
        "/p/crates/a/Cargo.toml": '[package]\nname = "a"\n',
        "/p/crates/b/Cargo.toml": '[package]\nname = "b"\n',
      },
      ["crates/a", "crates/b"],
      "per-crate",
    );
    run(r.deps);
    expect(r.failures).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.outputs.get("crates")).toBe('["a","b"]');
    expect(r.outputs.get("toolchains")).toBe('["stable"]');
    expect(JSON.parse(r.outputs.get("matrix") ?? "null")).toEqual({
      include: [
        {
          toolchain: "stable",
          target: "",
          os: "ubuntu-latest",
          "can-run": true,
          crate: "a",
        },
        {
          toolchain: "stable",
          target: "",
          os: "ubuntu-latest",
          "can-run": true,
          crate: "b",
        },
      ],
    });
  });
});
