// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { resolveRunner } from "./runners.ts";

/** One entry of the emitted `include` list. */
export interface MatrixLeg {
  readonly toolchain: string;
  readonly target: string;
  readonly os: string;
  readonly "can-run": boolean;
  readonly crate?: string;
}

/** The combined matrix plus the individual axes. */
export interface BuiltMatrix {
  readonly include: readonly MatrixLeg[];
  readonly toolchains: readonly string[];
  readonly targets: readonly string[];
  readonly runners: readonly string[];
  readonly crates: readonly string[];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Builds the matrix.
 *
 * The shape is an `include` list rather than named axes plus `exclude`, because
 * the runner is a FUNCTION of the target: a cross product would generate
 * impossible pairs, and an exclusion list grows faster than the matrix itself.
 */
export class MatrixBuilder {
  #crate: string | undefined;
  #toolchains: string[];
  #targets: string[];
  #overrides: Readonly<Record<string, string>>;

  // Bun's coverage instrumentation tracks the synthetic constructor a class
  // gets from field initializers as a distinct, never-"hit" function even
  // when the class is instantiated — an explicit constructor avoids that.
  constructor() {
    this.#crate = undefined;
    this.#toolchains = [];
    this.#targets = [];
    this.#overrides = {};
  }

  withCrate(name: string): this {
    this.#crate = name;
    return this;
  }

  withToolchains(toolchains: readonly string[]): this {
    this.#toolchains = unique(toolchains);
    return this;
  }

  withTargets(targets: readonly string[]): this {
    this.#targets = unique(targets);
    return this;
  }

  withRunnerOverrides(overrides: Readonly<Record<string, string>>): this {
    this.#overrides = overrides;
    return this;
  }

  build(): BuiltMatrix {
    // An empty target list still yields one leg: the native build, which passes
    // no `--target` flag at all.
    const targets = this.#targets.length === 0 ? [""] : this.#targets;
    const include: MatrixLeg[] = [];
    for (const toolchain of this.#toolchains) {
      for (const target of targets) {
        const choice = resolveRunner(target, this.#overrides);
        include.push({
          toolchain,
          target,
          os: choice.os,
          "can-run": target === "" ? true : choice.canRun,
          ...(this.#crate === undefined ? {} : { crate: this.#crate }),
        });
      }
    }
    if (include.length === 0) {
      throw new Error(
        "matrix is empty; a downstream job would be skipped silently",
      );
    }
    return {
      include,
      toolchains: this.#toolchains,
      targets: this.#targets,
      runners: unique(include.map((leg) => leg.os)),
      crates: this.#crate === undefined ? [] : [this.#crate],
    };
  }
}
