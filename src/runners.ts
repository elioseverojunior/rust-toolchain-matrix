// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

/** The runner chosen for a target, and whether the target can execute there. */
export interface RunnerChoice {
  readonly os: string;
  readonly canRun: boolean;
  readonly mapped: boolean;
}

/**
 * Target triple to GitHub-hosted runner.
 *
 * Every entry is the NATIVE runner for that triple, which is what removes the
 * cross-linker problem: `rustup target add` installs `rust-std`, not a linker.
 * Note that `macos-latest` is ARM64 today, so an x86_64 Darwin target maps to
 * `macos-15-intel` — mapping it to `macos-latest` would turn a native build
 * into an unrequested cross-compile.
 */
export const DEFAULT_RUNNERS: Readonly<Record<string, string>> = {
  "x86_64-unknown-linux-gnu": "ubuntu-latest",
  "aarch64-unknown-linux-gnu": "ubuntu-24.04-arm",
  "x86_64-apple-darwin": "macos-15-intel",
  "aarch64-apple-darwin": "macos-latest",
  "x86_64-pc-windows-msvc": "windows-latest",
  "aarch64-pc-windows-msvc": "windows-11-arm",
};

const FALLBACK = "ubuntu-latest";

/**
 * `wasm32-*` triple prefix, e.g. `wasm32-unknown-unknown`, `wasm32-wasip1`.
 *
 * Unlike every other row of the target-to-runner table, this one is a
 * PREFIX match rather than an exact key: the spec maps the whole `wasm32-*`
 * family to `ubuntu-latest` with `can-run: false`, not one specific triple.
 */
const WASM32_PREFIX = "wasm32-";

/** Resolves the runner for a target, letting an override win. */
export function resolveRunner(
  target: string,
  overrides: Readonly<Record<string, string>>,
): RunnerChoice {
  const override = overrides[target];
  if (override !== undefined) {
    return { os: override, canRun: false, mapped: true };
  }
  const native = DEFAULT_RUNNERS[target];
  if (native !== undefined) {
    return { os: native, canRun: true, mapped: true };
  }
  if (target.startsWith(WASM32_PREFIX)) {
    return { os: FALLBACK, canRun: false, mapped: true };
  }
  return { os: FALLBACK, canRun: false, mapped: false };
}
