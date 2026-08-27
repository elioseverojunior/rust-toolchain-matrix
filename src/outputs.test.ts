// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import { buildInstallPlan, toOutputEntries } from "./outputs.ts";

describe("buildInstallPlan", () => {
  it("orders toolchain before profile", () => {
    const plan = buildInstallPlan({
      profile: "default",
      components: [],
      hasTargets: false,
    });
    expect(plan.map((step) => step.step)).toEqual(["toolchain", "profile"]);
    expect(plan[0]?.argv).toEqual([
      "rustup",
      "toolchain",
      "install",
      "$TOOLCHAIN",
    ]);
    expect(plan[1]).toEqual({
      step: "profile",
      argv: ["rustup", "set", "profile", "default"],
    });
  });

  it("omits steps that do not apply", () => {
    const plan = buildInstallPlan({ components: [], hasTargets: false });
    expect(plan.map((step) => step.step)).toEqual(["toolchain"]);
  });

  it("includes components and targets when present", () => {
    const plan = buildInstallPlan({
      profile: "minimal",
      components: ["rustfmt", "clippy"],
      hasTargets: true,
    });
    expect(plan.map((step) => step.step)).toEqual([
      "toolchain",
      "profile",
      "components",
      "target",
    ]);
    expect(plan[1]).toEqual({
      step: "profile",
      argv: ["rustup", "set", "profile", "minimal"],
    });
    expect(plan[2]?.argv).toEqual([
      "rustup",
      "component",
      "add",
      "rustfmt",
      "clippy",
    ]);
    expect(plan[3]?.argv).toEqual(["rustup", "target", "add", "$TARGET"]);
  });
});

describe("toOutputEntries", () => {
  it("serialises lists as JSON so fromJSON works", () => {
    const outputs = {
      matrix: { include: [] },
      toolchains: ["1.97"],
      targets: [],
      runners: ["ubuntu-latest"],
      crates: [],
      channel: "1.97",
      msrv: "1.88",
      "msrv-source": "cargo-toml" as const,
      components: ["clippy"],
      profile: "default",
      "install-plan": [],
    };
    const entries = toOutputEntries(outputs);
    const map = new Map(entries);
    expect(map.get("toolchains")).toBe('["1.97"]');
    expect(map.get("channel")).toBe("1.97");
    expect(map.get("msrv-source")).toBe("cargo-toml");
    expect(map.get("json")).toBe(JSON.stringify(outputs));
  });
});
