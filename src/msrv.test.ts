// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import { parseChannel } from "./channel.ts";
import { assertClippyAgreement, assertToolchainMeetsMsrv } from "./msrv.ts";

describe("assertClippyAgreement", () => {
  it("passes when both agree", () => {
    expect(() =>
      assertClippyAgreement({
        directory: "fixtures/cli-msrv",
        clippyMsrv: "1.88",
        manifestRustVersion: "1.88",
      }),
    ).not.toThrow();
  });

  it("passes when either side is absent", () => {
    expect(() =>
      assertClippyAgreement({ directory: "a", manifestRustVersion: "1.88" }),
    ).not.toThrow();
    expect(() =>
      assertClippyAgreement({ directory: "a", clippyMsrv: "1.88" }),
    ).not.toThrow();
  });

  it("names both files and both values when they diverge", () => {
    expect(() =>
      assertClippyAgreement({
        directory: "fixtures/cli-msrv",
        clippyMsrv: "1.90",
        manifestRustVersion: "1.88",
      }),
    ).toThrow(
      /fixtures\/cli-msrv\/\.clippy\.toml.*1\.90.*fixtures\/cli-msrv\/Cargo\.toml.*1\.88/s,
    );
  });
});

describe("assertToolchainMeetsMsrv", () => {
  it("accepts a concrete channel at or above the floor", () => {
    expect(() =>
      assertToolchainMeetsMsrv(parseChannel("1.97"), "1.88"),
    ).not.toThrow();
    expect(() =>
      assertToolchainMeetsMsrv(parseChannel("1.88"), "1.88"),
    ).not.toThrow();
  });

  it("rejects a concrete channel below the floor", () => {
    expect(() =>
      assertToolchainMeetsMsrv(parseChannel("1.85"), "1.88"),
    ).toThrow("below the declared MSRV");
  });

  it("always accepts rolling channels", () => {
    for (const raw of ["stable", "beta", "nightly"]) {
      expect(() =>
        assertToolchainMeetsMsrv(parseChannel(raw), "1.88"),
      ).not.toThrow();
    }
  });

  it("accepts anything when no MSRV is declared", () => {
    expect(() =>
      assertToolchainMeetsMsrv(parseChannel("1.10"), undefined),
    ).not.toThrow();
  });

  it("accepts an unparseable channel version rather than guessing", () => {
    expect(() =>
      assertToolchainMeetsMsrv(parseChannel("my-toolchain"), "1.88"),
    ).not.toThrow();
  });
});
