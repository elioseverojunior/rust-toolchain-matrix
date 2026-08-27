// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

/** A `major.minor.patch` version with any suffix already dropped. */
export interface SemVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const SHAPE = /^(\d+)\.(\d+)(?:\.(\d+))?$/;

/**
 * Parses a version, dropping any pre-release or build suffix.
 *
 * Returns `undefined` rather than throwing: one odd entry among many should not
 * sink the whole resolution, so callers skip what they cannot read.
 */
export function parseVersion(raw: string): SemVersion | undefined {
  const core = raw.trim().split(/[-+]/)[0];
  if (core === undefined) {
    return undefined;
  }
  const matched = SHAPE.exec(core);
  if (matched === null) {
    return undefined;
  }
  const [, major, minor, patch] = matched;
  if (major === undefined || minor === undefined) {
    return undefined;
  }
  return {
    major: Number(major),
    minor: Number(minor),
    patch: patch === undefined ? 0 : Number(patch),
  };
}

/**
 * Orders two versions field by field.
 *
 * This is the whole point of the type. Comparing the strings instead sorts
 * "1.9" above "1.10", which silently selects the wrong MSRV.
 */
export function compareVersions(a: SemVersion, b: SemVersion): number {
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  return a.patch - b.patch;
}

/** Returns the highest parseable version, preserving its original spelling. */
export function maxVersion(raw: readonly string[]): string | undefined {
  let bestRaw: string | undefined;
  let best: SemVersion | undefined;
  for (const candidate of raw) {
    const parsed = parseVersion(candidate);
    if (parsed === undefined) {
      continue;
    }
    if (best === undefined || compareVersions(parsed, best) > 0) {
      best = parsed;
      bestRaw = candidate;
    }
  }
  return bestRaw;
}
