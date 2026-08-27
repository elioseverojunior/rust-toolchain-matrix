// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import type { ParsedChannel } from "./channel.ts";
import { isRolling } from "./channel.ts";
import { compareVersions, parseVersion } from "./version.ts";

/** Inputs to the per-directory clippy agreement check. */
export interface ClippyAgreement {
  readonly directory: string;
  readonly clippyMsrv?: string;
  readonly manifestRustVersion?: string;
}

/**
 * Enforces that a `.clippy.toml` msrv equals its sibling manifest's
 * `rust-version`.
 *
 * The message names both paths and both values, because the reader needs to
 * know which file to change, not merely that two disagree.
 */
export function assertClippyAgreement(input: ClippyAgreement): void {
  const { directory, clippyMsrv, manifestRustVersion } = input;
  if (clippyMsrv === undefined || manifestRustVersion === undefined) {
    return;
  }
  if (clippyMsrv === manifestRustVersion) {
    return;
  }
  throw new Error(
    `${directory}/.clippy.toml declares msrv "${clippyMsrv}" but ` +
      `${directory}/Cargo.toml declares rust-version ` +
      `"${manifestRustVersion}"; they must be equal`,
  );
}

/**
 * Enforces that a concrete toolchain sits at or above the declared floor.
 *
 * Rolling channels are not numerically comparable and always pass, being by
 * definition at or above any floor. An unparseable version is accepted rather
 * than guessed at.
 */
export function assertToolchainMeetsMsrv(
  channel: ParsedChannel,
  msrv: string | undefined,
): void {
  if (msrv === undefined || isRolling(channel)) {
    return;
  }
  const floor = parseVersion(msrv);
  const candidate =
    channel.version === undefined ? undefined : parseVersion(channel.version);
  if (floor === undefined || candidate === undefined) {
    return;
  }
  if (compareVersions(candidate, floor) < 0) {
    throw new Error(
      `toolchain "${channel.raw}" is below the declared MSRV "${msrv}"`,
    );
  }
}
