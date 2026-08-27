// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
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

  it("emits every output value, including runners, profile, install-plan, and json", () => {
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\nrust-version = "1.88"\n',
      "/p/rust-toolchain.toml":
        "[toolchain]\n" +
        'channel = "1.97"\n' +
        'profile = "default"\n' +
        'targets = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"]\n' +
        'components = ["rustfmt"]\n',
    });
    run(r.deps);
    expect(r.failures).toEqual([]);
    expect(r.warnings).toEqual([]);

    // `runners`: the exact deduplicated list, in first-seen order.
    expect(r.outputs.get("runners")).toBe('["ubuntu-latest","macos-latest"]');

    // `profile`: passes through the toolchain file's value unchanged.
    expect(r.outputs.get("profile")).toBe("default");

    // `install-plan`: the whole ordered step array, not merely its length.
    const installPlan: unknown = JSON.parse(
      r.outputs.get("install-plan") ?? "null",
    );
    expect(installPlan).toEqual([
      {
        step: "toolchain",
        argv: ["rustup", "toolchain", "install", "$TOOLCHAIN"],
      },
      { step: "profile", argv: ["rustup", "set", "profile", "default"] },
      { step: "components", argv: ["rustup", "component", "add", "rustfmt"] },
      { step: "target", argv: ["rustup", "target", "add", "$TARGET"] },
    ]);

    // `matrix`: every leg, not a sample.
    const matrixOutput: unknown = JSON.parse(r.outputs.get("matrix") ?? "null");
    expect(matrixOutput).toEqual({
      include: [
        {
          toolchain: "1.97",
          target: "x86_64-unknown-linux-gnu",
          os: "ubuntu-latest",
          "can-run": true,
        },
        {
          toolchain: "1.97",
          target: "aarch64-apple-darwin",
          os: "macos-latest",
          "can-run": true,
        },
        {
          toolchain: "1.88",
          target: "x86_64-unknown-linux-gnu",
          os: "ubuntu-latest",
          "can-run": true,
        },
        {
          toolchain: "1.88",
          target: "aarch64-apple-darwin",
          os: "macos-latest",
          "can-run": true,
        },
      ],
    });

    // `json`: parses, and its `matrix` field equals the `matrix` output —
    // guards against action.ts ever building the two from different data.
    const jsonOutput: unknown = JSON.parse(r.outputs.get("json") ?? "null");
    expect(jsonOutput).toEqual({
      matrix: matrixOutput,
      toolchains: ["1.97", "1.88"],
      targets: ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"],
      runners: ["ubuntu-latest", "macos-latest"],
      crates: [],
      channel: "1.97",
      msrv: "1.88",
      "msrv-source": "cargo-toml",
      components: ["rustfmt"],
      profile: "default",
      "install-plan": installPlan,
    });
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
    // FINDING I1: `wasm32-unknown-unknown` used to sit in this fixture as
    // the "unmapped" target, but the spec explicitly maps the whole
    // `wasm32-*` family — it was the test that was wrong, not the target.
    // `riscv64gc-unknown-linux-gnu` is genuinely absent from the
    // target-to-runner table, so it keeps this test's "still flagging the
    // unmapped one" warning-path coverage honest.
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\n',
      "/p/rust-toolchain.toml":
        "[toolchain]\n" +
        'channel = "1.97"\n' +
        'targets = ["riscv64gc-unknown-linux-gnu", "x86_64-unknown-linux-gnu"]\n' +
        'components = ["rustfmt", "llvm-tools", "rust-src"]\n',
    });
    run(r.deps);
    expect(r.failures).toEqual([]);
    expect(r.warnings).toEqual([
      'target "riscv64gc-unknown-linux-gnu" has no runner mapping; falling ' +
        "back to ubuntu-latest as an unverified cross-compile",
    ]);
    expect(r.outputs.get("channel")).toBe("1.97");
    expect(r.outputs.get("targets")).toBe(
      '["riscv64gc-unknown-linux-gnu","x86_64-unknown-linux-gnu"]',
    );
    expect(r.outputs.get("components")).toBe(
      '["rustfmt","llvm-tools","rust-src"]',
    );
    expect(JSON.parse(r.outputs.get("matrix") ?? "null")).toEqual({
      include: [
        {
          toolchain: "1.97",
          target: "riscv64gc-unknown-linux-gnu",
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

  it("no longer warns for a wasm32 target now that it is explicitly mapped", () => {
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\n',
      "/p/rust-toolchain.toml":
        '[toolchain]\nchannel = "1.97"\ntargets = ["wasm32-unknown-unknown"]\n',
    });
    run(r.deps);
    expect(r.failures).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(JSON.parse(r.outputs.get("matrix") ?? "null")).toEqual({
      include: [
        {
          toolchain: "1.97",
          target: "wasm32-unknown-unknown",
          os: "ubuntu-latest",
          "can-run": false,
        },
      ],
    });
  });

  it("rejects a rust-toolchain.toml channel that is not a valid identifier", () => {
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\n',
      "/p/rust-toolchain.toml": '[toolchain]\nchannel = "bad channel"\n',
    });
    run(r.deps);
    expect(r.failures[0]).toBe(
      'channel "bad channel" is not a valid identifier',
    );
  });

  it("accepts every legal rustup channel form", () => {
    // FINDING I3: the identifier check added alongside `target`/`component`
    // must not reject anything the rustup channel grammar actually allows.
    const legal = [
      "stable",
      "beta",
      "nightly",
      "1.88",
      "1.88.0",
      "1.88.0-beta.1",
      "nightly-2026-08-03",
      "nightly-2026-08-03-x86_64-apple-darwin",
      "stable-x86_64-apple-darwin",
    ];
    for (const channel of legal) {
      const r = recordingDeps({
        "/p/Cargo.toml": '[package]\nname = "cli"\n',
        "/p/rust-toolchain.toml": `[toolchain]\nchannel = "${channel}"\n`,
      });
      run(r.deps);
      expect(r.failures).toEqual([]);
      expect(r.outputs.get("channel")).toBe(channel);
    }
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

  it("fails on the ROOT's own clippy disagreement in a hybrid [package]+[workspace] manifest", () => {
    // A Cargo manifest can be both a package AND a workspace root at once —
    // a root crate that also owns members. `expandWorkspace({mode:
    // "per-crate"})` returns member units only (the root is never one of
    // its own members), so validating members alone would miss the root's
    // own .clippy.toml. This is the regression the fix for Finding 1
    // addresses: without unioning in the root unit, this test would see no
    // failure at all.
    const r = recordingWorkspaceDeps(
      {
        "/p/Cargo.toml":
          '[package]\nname = "root"\nrust-version = "1.88"\n' +
          '[workspace]\nmembers = ["crates/*"]\n',
        "/p/.clippy.toml": 'msrv = "1.90"\n',
        "/p/crates/ok/Cargo.toml": '[package]\nname = "ok"\n',
      },
      ["crates/ok"],
      // workspace-mode left unset, so it defaults to "root".
    );
    run(r.deps);
    expect(r.failures).toEqual([
      '/p/.clippy.toml declares msrv "1.90" but /p/Cargo.toml declares ' +
        'rust-version "1.88"; they must be equal',
    ]);
  });
});

describe("run — Finding C1: an empty matrix is structurally fatal", () => {
  it("fails a [workspace] with no members key in per-crate mode, emitting nothing", () => {
    // A `[workspace]` table with NO `members` key is legal Cargo — members
    // are auto-discovered from path dependencies — so `manifest.members` is
    // `[]`, `memberDirectories` never throws (its guard only fires when
    // `members.length > 0`), and `memberUnits` returns `[]`. In `per-crate`
    // mode that makes `units` itself `[]`, so the `for (const unit of
    // units)` loop in `run()` never runs and `MatrixBuilder` — the only
    // place that used to guard against an empty matrix — is never
    // constructed. GitHub Actions skips a job with an empty matrix rather
    // than failing it, so `run()` must enforce this itself.
    const r = recordingWorkspaceDeps(
      { "/p/Cargo.toml": "[workspace]\n" },
      [],
      "per-crate",
    );
    run(r.deps);
    expect(r.failures).toEqual([
      "matrix is empty; a downstream job would be skipped silently",
    ]);
    expect(r.outputs.size).toBe(0);
  });
});

describe("run — Finding I2: per-crate mode is a mode decision, not a cardinality one", () => {
  it("keeps the crate key for a single-member workspace in per-crate mode", () => {
    const r = recordingWorkspaceDeps(
      {
        "/p/Cargo.toml": '[workspace]\nmembers = ["crates/*"]\n',
        "/p/crates/only/Cargo.toml": '[package]\nname = "only"\n',
      },
      ["crates/only"],
      "per-crate",
    );
    run(r.deps);
    expect(r.failures).toEqual([]);
    expect(r.outputs.get("crates")).toBe('["only"]');
    expect(JSON.parse(r.outputs.get("matrix") ?? "null")).toEqual({
      include: [
        {
          toolchain: "stable",
          target: "",
          os: "ubuntu-latest",
          "can-run": true,
          crate: "only",
        },
      ],
    });
  });
});

describe("run — Finding I6: per-crate msrv outputs are deterministic", () => {
  const files: Record<string, string> = {
    "/p/Cargo.toml": '[workspace]\nmembers = ["crates/*"]\n',
    // A pinned channel above both members' MSRV keeps the pinned toolchain
    // deterministic too, so this test isolates the `msrv`/`msrv-source`
    // outputs finding I6 actually fixes rather than also tripping over the
    // separately-known non-determinism in the pin fallback (out of scope
    // for this finding).
    "/p/rust-toolchain.toml": '[toolchain]\nchannel = "1.97"\n',
    "/p/crates/a/Cargo.toml": '[package]\nname = "a"\nrust-version = "1.90"\n',
    "/p/crates/b/Cargo.toml": '[package]\nname = "b"\nrust-version = "1.95"\n',
  };

  it("picks the maximum member MSRV independent of glob order", () => {
    const forward = recordingWorkspaceDeps(
      files,
      ["crates/a", "crates/b"],
      "per-crate",
    );
    run(forward.deps);
    expect(forward.failures).toEqual([]);
    expect(forward.outputs.get("msrv")).toBe("1.95");
    expect(forward.outputs.get("msrv-source")).toBe("cargo-toml");

    // Same files, same fixture, only the glob fake's member order reversed
    // — the scalar outputs must not move.
    const reversed = recordingWorkspaceDeps(
      files,
      ["crates/b", "crates/a"],
      "per-crate",
    );
    run(reversed.deps);
    expect(reversed.failures).toEqual([]);
    expect(reversed.outputs.get("msrv")).toBe(forward.outputs.get("msrv"));
    expect(reversed.outputs.get("msrv-source")).toBe(
      forward.outputs.get("msrv-source"),
    );
  });

  it("falls back to none when no member declares an MSRV", () => {
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
    expect(r.outputs.get("msrv")).toBe("");
    expect(r.outputs.get("msrv-source")).toBe("none");
  });
});
