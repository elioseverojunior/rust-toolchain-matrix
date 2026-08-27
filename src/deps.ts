// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

/**
 * Interface for interacting with GitHub Actions core utilities.
 *
 * Exists so no library module imports `@actions/core` directly.
 * Callers inject a concrete implementation at runtime.
 */
export interface ActionCore {
  readonly getInput: (name: string) => string;
  readonly setOutput: (name: string, value: string) => void;
  readonly setFailed: (message: string) => void;
  readonly warning: (message: string) => void;
  readonly info: (message: string) => void;
}

/**
 * Interface for injected dependencies.
 *
 * Exists so no library module imports `@actions/core` directly.
 * Callers inject concrete implementations at runtime for file operations,
 * glob patterns, and action core utilities.
 */
export interface ActionDeps {
  readonly core: ActionCore;
  readonly readFile: (path: string) => string;
  readonly glob: (pattern: string, cwd: string) => string[];
  readonly cwd: string;
}
