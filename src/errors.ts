// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

/**
 * Renders an unknown thrown value as a message.
 *
 * `catch` binds `unknown` in TypeScript, and the boundaries this action touches
 * (`smol-toml`, `JSON.parse`, `node:fs`) may reject with something that is not
 * an `Error`. Every call site that reports a failure goes through here.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error) ?? "[unserialisable error]";
  } catch {
    return "[unserialisable error]";
  }
}
