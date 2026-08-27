// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import type { ActionDeps } from "./deps.ts";
import { parseManifest } from "./manifest.ts";
import { expandWorkspace } from "./workspace.ts";

const ROOT_TOML = [
  "[workspace]",
  'members = ["crates/*"]',
  "[workspace.package]",
  'rust-version = "1.88"',
].join("\n");

const EXCLUDE_TOML = [
  "[workspace]",
  'members = ["crates/*"]',
  'exclude = ["crates/strict"]',
  "[workspace.package]",
  'rust-version = "1.88"',
].join("\n");

const FILES: Record<string, string> = {
  "/w/crates/channel/Cargo.toml":
    '[package]\nname = "channel"\nrust-version.workspace = true\n',
  "/w/crates/version/Cargo.toml": '[package]\nname = "version"\n',
  "/w/crates/strict/Cargo.toml":
    '[package]\nname = "strict"\nrust-version = "1.92"\n',
  "/w/crates/strict/.clippy.toml": 'msrv = "1.92"\n',
};

function fakeDeps(): ActionDeps {
  return {
    core: {
      getInput: () => "",
      setOutput: () => undefined,
      setFailed: () => undefined,
      warning: () => undefined,
      info: () => undefined,
    },
    readFile: (path: string): string => {
      const found = FILES[path];
      if (found === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }
      return found;
    },
    glob: () => ["crates/channel", "crates/strict", "crates/version"],
    cwd: "/w",
  };
}

describe("expandWorkspace", () => {
  it("returns a single unit in root mode", () => {
    const units = expandWorkspace({
      deps: fakeDeps(),
      root: "/w",
      manifest: parseManifest(ROOT_TOML),
      mode: "root",
    });
    expect(units).toHaveLength(1);
    expect(units[0]?.rustVersion).toBe("1.88");
  });

  it("returns one unit per member in per-crate mode", () => {
    const units = expandWorkspace({
      deps: fakeDeps(),
      root: "/w",
      manifest: parseManifest(ROOT_TOML),
      mode: "per-crate",
    });
    expect(units.map((unit) => unit.name)).toEqual([
      "channel",
      "strict",
      "version",
    ]);
    expect(units[0]?.rustVersion).toBe("1.88");
    expect(units[1]?.rustVersion).toBe("1.92");
    expect(units[2]?.rustVersion).toBeUndefined();
  });

  it("omits crates listed in exclude from per-crate mode", () => {
    const units = expandWorkspace({
      deps: fakeDeps(),
      root: "/w",
      manifest: parseManifest(EXCLUDE_TOML),
      mode: "per-crate",
    });
    expect(units.map((unit) => unit.name)).toEqual(["channel", "version"]);
  });

  it("collapses to the maximum member MSRV in aggregate mode", () => {
    const units = expandWorkspace({
      deps: fakeDeps(),
      root: "/w",
      manifest: parseManifest(ROOT_TOML),
      mode: "aggregate",
    });
    expect(units).toHaveLength(1);
    expect(units[0]?.rustVersion).toBe("1.92");
  });

  it("carries the sibling clippy msrv for validation", () => {
    const units = expandWorkspace({
      deps: fakeDeps(),
      root: "/w",
      manifest: parseManifest(ROOT_TOML),
      mode: "per-crate",
    });
    expect(units[1]?.clippyMsrv).toBe("1.92");
    expect(units[0]?.clippyMsrv).toBeUndefined();
  });

  it("throws when declared members expand to nothing", () => {
    const deps = { ...fakeDeps(), glob: (): string[] => [] };
    expect(() =>
      expandWorkspace({
        deps,
        root: "/w",
        manifest: parseManifest(ROOT_TOML),
        mode: "per-crate",
      }),
    ).toThrow("expanded to zero crates");
  });

  it("treats a plain package as a single unit", () => {
    const manifest = parseManifest(
      '[package]\nname = "cli"\nrust-version = "1.88"\n',
    );
    const units = expandWorkspace({
      deps: fakeDeps(),
      root: "/w",
      manifest,
      mode: "per-crate",
    });
    expect(units).toHaveLength(1);
    expect(units[0]?.name).toBe("cli");
  });
});
