// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import { isDatedNonNightly, isRolling, parseChannel } from "./channel.ts";

describe("parseChannel", () => {
  it("parses the rolling channels", () => {
    expect(parseChannel("stable").kind).toBe("stable");
    expect(parseChannel("  beta ").kind).toBe("beta");
    expect(parseChannel("nightly").kind).toBe("nightly");
  });

  it("parses a two-field and a three-field version", () => {
    expect(parseChannel("1.88").version).toBe("1.88");
    expect(parseChannel("1.88.0").version).toBe("1.88.0");
  });

  it("parses a prerelease suffix", () => {
    const parsed = parseChannel("1.88.0-beta.1");
    expect(parsed.version).toBe("1.88.0");
    expect(parsed.prerelease).toBe("beta.1");
  });

  it("parses a dated nightly", () => {
    const parsed = parseChannel("nightly-2026-08-03");
    expect(parsed.kind).toBe("nightly");
    expect(parsed.date).toBe("2026-08-03");
  });

  it("parses a host suffix", () => {
    const parsed = parseChannel("stable-x86_64-apple-darwin");
    expect(parsed.kind).toBe("stable");
    expect(parsed.host).toBe("x86_64-apple-darwin");
  });

  it("parses a dated nightly with a host", () => {
    const parsed = parseChannel("nightly-2026-08-03-x86_64-apple-darwin");
    expect(parsed.date).toBe("2026-08-03");
    expect(parsed.host).toBe("x86_64-apple-darwin");
  });

  it("treats an unrecognised name as a custom version channel", () => {
    expect(parseChannel("my-toolchain").kind).toBe("version");
  });

  it("rejects empty input", () => {
    expect(() => parseChannel("   ")).toThrow("channel must not be empty");
  });

  it("rejects unparseable version", () => {
    expect(() => parseChannel("1")).toThrow("unparseable channel: 1");
  });
});

describe("isRolling", () => {
  it("is true for stable, beta, and undated nightly", () => {
    expect(isRolling(parseChannel("stable"))).toBe(true);
    expect(isRolling(parseChannel("beta"))).toBe(true);
    expect(isRolling(parseChannel("nightly"))).toBe(true);
  });

  it("is false for a dated nightly and for a version", () => {
    expect(isRolling(parseChannel("nightly-2026-08-03"))).toBe(false);
    expect(isRolling(parseChannel("1.88"))).toBe(false);
  });
});

describe("isDatedNonNightly", () => {
  it("flags a dated stable but not a dated nightly", () => {
    expect(isDatedNonNightly(parseChannel("stable-2026-08-03"))).toBe(true);
    expect(isDatedNonNightly(parseChannel("nightly-2026-08-03"))).toBe(false);
    expect(isDatedNonNightly(parseChannel("stable"))).toBe(false);
  });
});
