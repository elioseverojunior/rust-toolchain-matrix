// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import { compareVersions, maxVersion, parseVersion } from "./version.ts";

describe("parseVersion", () => {
  it("accepts two and three field versions", () => {
    expect(parseVersion("1.88")).toEqual({ major: 1, minor: 88, patch: 0 });
    expect(parseVersion("1.88.2")).toEqual({ major: 1, minor: 88, patch: 2 });
  });

  it("drops a prerelease or build suffix", () => {
    expect(parseVersion("1.88.0-beta.1")).toEqual(parseVersion("1.88.0"));
    expect(parseVersion("1.88.0+build9")).toEqual(parseVersion("1.88.0"));
  });

  it("returns undefined for malformed input", () => {
    for (const raw of ["", "1", "1.x", "1.2.3.4", "   "]) {
      expect(parseVersion(raw)).toBeUndefined();
    }
  });
});

describe("compareVersions", () => {
  it("orders numerically, not lexically", () => {
    const older = parseVersion("1.9.0");
    const newer = parseVersion("1.10.0");
    if (older === undefined || newer === undefined) {
      throw new Error("fixture versions must parse");
    }
    expect(compareVersions(older, newer)).toBeLessThan(0);
    expect(compareVersions(newer, older)).toBeGreaterThan(0);
    expect(compareVersions(older, older)).toBe(0);
  });

  it("compares major versions first", () => {
    const v1 = parseVersion("1.0.0");
    const v2 = parseVersion("2.0.0");
    if (v1 === undefined || v2 === undefined) {
      throw new Error("fixture versions must parse");
    }
    expect(compareVersions(v1, v2)).toBeLessThan(0);
    expect(compareVersions(v2, v1)).toBeGreaterThan(0);
  });
});

describe("maxVersion", () => {
  it("returns the highest parseable entry", () => {
    expect(maxVersion(["1.88.0", "1.95.0", "1.9.0"])).toBe("1.95.0");
  });

  it("skips unparseable entries rather than failing", () => {
    expect(maxVersion(["not-a-version", "1.88.0"])).toBe("1.88.0");
  });

  it("returns undefined when nothing parses", () => {
    expect(maxVersion(["nope"])).toBeUndefined();
    expect(maxVersion([])).toBeUndefined();
  });
});
