// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import { MatrixBuilder } from "./matrix.ts";

describe("MatrixBuilder", () => {
  it("produces one leg per toolchain and target", () => {
    const built = new MatrixBuilder()
      .withToolchains(["1.97", "1.88"])
      .withTargets(["x86_64-apple-darwin", "wasm32-unknown-unknown"])
      .build();
    expect(built.include).toHaveLength(4);
    expect(built.include[0]).toEqual({
      toolchain: "1.97",
      target: "x86_64-apple-darwin",
      os: "macos-15-intel",
      "can-run": true,
    });
  });

  it("marks a wasm leg as not runnable", () => {
    const built = new MatrixBuilder()
      .withToolchains(["1.97"])
      .withTargets(["wasm32-unknown-unknown"])
      .build();
    expect(built.include[0]).toEqual({
      toolchain: "1.97",
      target: "wasm32-unknown-unknown",
      os: "ubuntu-latest",
      "can-run": false,
    });
  });

  it("adds a crate key without multiplying an axis", () => {
    const built = new MatrixBuilder()
      .withCrate("channel")
      .withToolchains(["1.97"])
      .withTargets(["x86_64-unknown-linux-gnu"])
      .build();
    expect(built.include[0]).toEqual({
      toolchain: "1.97",
      target: "x86_64-unknown-linux-gnu",
      os: "ubuntu-latest",
      "can-run": true,
      crate: "channel",
    });
    expect(built.crates).toEqual(["channel"]);
  });

  it("emits a host leg when no target is declared", () => {
    const built = new MatrixBuilder().withToolchains(["stable"]).build();
    expect(built.include).toHaveLength(1);
    expect(built.include[0]).toEqual({
      toolchain: "stable",
      target: "",
      os: "ubuntu-latest",
      "can-run": true,
    });
  });

  it("deduplicates the axes", () => {
    const built = new MatrixBuilder()
      .withToolchains(["1.97", "1.97"])
      .withTargets(["x86_64-unknown-linux-gnu", "x86_64-unknown-linux-gnu"])
      .build();
    expect(built.toolchains).toEqual(["1.97"]);
    expect(built.targets).toEqual(["x86_64-unknown-linux-gnu"]);
    expect(built.include).toHaveLength(1);
    expect(built.include[0]).toEqual({
      toolchain: "1.97",
      target: "x86_64-unknown-linux-gnu",
      os: "ubuntu-latest",
      "can-run": true,
    });
  });

  it("honours a runner override", () => {
    const built = new MatrixBuilder()
      .withToolchains(["1.97"])
      .withTargets(["wasm32-unknown-unknown"])
      .withRunnerOverrides({ "wasm32-unknown-unknown": "self-hosted-wasm" })
      .build();
    expect(built.include[0]).toEqual({
      toolchain: "1.97",
      target: "wasm32-unknown-unknown",
      os: "self-hosted-wasm",
      "can-run": false,
    });
  });

  it("refuses to build an empty matrix", () => {
    expect(() => new MatrixBuilder().build()).toThrow("matrix is empty");
  });
});
