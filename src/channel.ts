// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

/** A toolchain channel parsed per the rustup grammar. */
export interface ParsedChannel {
  readonly kind: "stable" | "beta" | "nightly" | "version";
  readonly version?: string;
  readonly prerelease?: string;
  readonly date?: string;
  readonly host?: string;
  readonly raw: string;
}

const ROLLING = ["stable", "beta", "nightly"] as const;
const VERSION_HEAD = /^\d+\.\d+(?:\.\d+)?/;
const PRERELEASE_HEAD = /^-(beta(?:\.\d+)?)/;
const DATE_HEAD = /^-(\d{4}-\d{2}-\d{2})/;

/**
 * Parses a toolchain specification.
 *
 * Parsing is permissive and follows the grammar; narrowing to what rustup
 * actually publishes is the validator's job, not this function's. An
 * unrecognised name is returned as a custom `version` channel rather than
 * rejected, because rustup accepts linked custom toolchains.
 */
export function parseChannel(raw: string): ParsedChannel {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("channel must not be empty");
  }

  let kind: ParsedChannel["kind"] = "version";
  let version: string | undefined;
  let prerelease: string | undefined;
  // eslint-disable-next-line no-useless-assignment
  let rest = trimmed;

  // A leading digit means a versioned channel; only then can `-beta.N` be a
  // prerelease rather than the `beta` channel itself. Checking this first is
  // what disambiguates "beta" from "1.88.0-beta.1".
  if (/^\d/.test(trimmed)) {
    const matched = VERSION_HEAD.exec(trimmed);
    if (matched === null) {
      throw new Error(`unparseable channel: ${trimmed}`);
    }
    version = matched[0];
    rest = trimmed.slice(version.length);
    const pre = PRERELEASE_HEAD.exec(rest);
    if (pre !== null) {
      prerelease = pre[1];
      rest = rest.slice(pre[0].length);
    }
  } else {
    const found = ROLLING.find((name) => trimmed.startsWith(name));
    if (found === undefined) {
      return { kind: "version", version: trimmed, raw: trimmed };
    }
    kind = found;
    rest = trimmed.slice(found.length);
  }

  let date: string | undefined;
  const dated = DATE_HEAD.exec(rest);
  if (dated !== null) {
    date = dated[1];
    rest = rest.slice(dated[0].length);
  }

  const host = rest.startsWith("-") ? rest.slice(1) : undefined;

  return { kind, version, prerelease, date, host, raw: trimmed };
}

/** True when the channel moves on its own over time. */
export function isRolling(channel: ParsedChannel): boolean {
  if (channel.kind === "version") {
    return false;
  }
  return channel.date === undefined;
}

/**
 * True for a dated channel that is not nightly.
 *
 * The grammar permits it, but rustup documents dated variants only for
 * nightly, so this earns a warning rather than a rejection.
 */
export function isDatedNonNightly(channel: ParsedChannel): boolean {
  return channel.date !== undefined && channel.kind !== "nightly";
}
