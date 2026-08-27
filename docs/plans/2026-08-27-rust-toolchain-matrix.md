<!--
SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors

SPDX-License-Identifier: MIT OR Apache-2.0
-->

# rust-toolchain-matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a GitHub Action that parses `Cargo.toml`, `rust-toolchain.toml`, and `.clippy.toml` into GitHub Actions matrix strategies.

**Architecture:** A functional core with an imperative shell. Every module is a pure function over explicit types; all I/O enters through a structural `ActionDeps` object constructed only in `src/index.ts`. No library module imports `@actions/core`, which is what makes the 100% coverage gate reachable with plain fakes instead of mocks.

**Tech Stack:** TypeScript 6, Bun 1.4 (test runner and bundler), `smol-toml` for TOML parsing, `@actions/core` v3 for the Actions runtime, Node 26 at execution time.

**Spec:** `docs/specs/2026-08-27-rust-toolchain-matrix-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **TDD is mandatory.** Write the failing test, run it and watch it fail, write the minimum code to pass, run it again, commit. Never write implementation before its test.
- **Coverage gate: 100%** of lines, functions, and statements, enforced by `bunfig.toml`. `bun test` measures coverage by default. A production file without a test breaks the suite. Bun has no `branches` metric.
- **No mocks.** No `mock()`, no `spyOn()`. Tests pass plain object literals that satisfy the injected interface.
- **Tests are co-located** as `src/**/*.test.ts` using `bun:test`. There is no `tests/` directory.
- **SPDX header on every new file**, in that file's comment syntax:
  `// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors`, a blank comment line, then
  a `// SPDX-License-Identifier` line carrying `MIT OR Apache-2.0`.
- **ESLint is strict.** `@typescript-eslint/explicit-function-return-type` and `no-explicit-any` are errors, not warnings. Lint runs with `--max-warnings 0`.
- **TypeScript flags:** `verbatimModuleSyntax` (type-only imports MUST be written `import type`), `noUncheckedIndexedAccess` (every indexed access is `T | undefined`), `strict`.
- **No non-null assertions (`!`) on data read from a file.** This is the TypeScript analogue of the project's no-`.unwrap()`-on-external-input rule.
- **Import order** is enforced by `import-x/order`: builtin, external, internal, parent, sibling/index — blank line between groups, alphabetized within each.
- **Prettier:** double quotes, `printWidth` 80, `trailingComma: "all"`.
- **All written artifacts are in English.** Code, comments, doc comments, commit messages, `action.yml` descriptions.
- **Commits are conventional and GPG-signed** (`git commit -S`). The `type-enum` adds a non-standard `init` type. **Never add a `Co-Authored-By` trailer.**
- **Runtime is Node, not Bun.** `bun build --target node` produces the bundle and `action.yml` declares `using: node24`. `Bun.Glob` does not exist at runtime — use `fs.globSync` from `node:fs`.
- **Verify before claiming done.** `mise run ci` reproduces the full gate: `hk`, typecheck, coverage, build.

### One deliberate departure from the spec

The spec's module table gives `msrv.ts` three jobs: MSRV extraction, numeric
comparison, and the consistency rules. This plan splits the middle one into
`src/version.ts`, leaving `src/msrv.ts` holding only the domain rules. Comparing
versions is generic and has no notion of an MSRV; keeping them together would
have made `msrv.ts` the largest module in the tree for no gain. Everything else
follows the spec's table exactly.

### Shared types

These types are referenced across tasks. Task 1 creates the file that holds them.

```ts
export interface ActionDeps {
  readonly core: ActionCore;
  readonly readFile: (path: string) => string;
  readonly glob: (pattern: string, cwd: string) => string[];
  readonly cwd: string;
}

export interface ActionCore {
  readonly getInput: (name: string) => string;
  readonly setOutput: (name: string, value: string) => void;
  readonly setFailed: (message: string) => void;
  readonly warning: (message: string) => void;
  readonly info: (message: string) => void;
}
```

`readFile` throws when the file is absent; callers that treat absence as legal catch and treat it as "not present".

---

### Task 1: Error description and shared types

**Files:**

- Create: `src/errors.ts`
- Create: `src/deps.ts`
- Test: `src/errors.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `describeError(error: unknown): string`. `ActionDeps` and `ActionCore` interfaces exactly as written in Global Constraints.
- [ ] **Step 1: Write the failing test**

Create `src/errors.test.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import { describeError } from "./errors.ts";

describe("describeError", () => {
  it("uses the message of an Error", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("passes a string through unchanged", () => {
    expect(describeError("plain failure")).toBe("plain failure");
  });

  it("serialises a non-Error value", () => {
    expect(describeError({ code: 7 })).toBe('{"code":7}');
  });

  it("falls back when serialisation fails", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(describeError(circular)).toBe("[unserialisable error]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/errors.test.ts`
Expected: FAIL — `Cannot find module './errors.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/errors.ts`:

```ts
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
```

Create `src/deps.ts` with the `ActionDeps` and `ActionCore` interfaces from Global Constraints, prefixed with the SPDX header, each interface carrying a doc comment explaining that it exists so no library module imports `@actions/core`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/errors.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts src/deps.ts src/errors.test.ts
git commit -S -m "feat: add error description and injected dependency types"
```

---

### Task 2: Channel grammar

**Files:**

- Create: `src/channel.ts`
- Test: `src/channel.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `interface ParsedChannel { kind: "stable" | "beta" | "nightly" | "version"; version?: string; prerelease?: string; date?: string; host?: string; raw: string }`
  - `parseChannel(raw: string): ParsedChannel` — throws on empty input.
  - `isRolling(channel: ParsedChannel): boolean`
  - `isDatedNonNightly(channel: ParsedChannel): boolean` — drives a warning in Task 12.

The grammar, from the spec:

```text
<channel>[-<date>][-<host>]
<channel>    = stable|beta|nightly|<versioned>[-<prerelease>]
<versioned>  = <major.minor>|<major.minor.patch>
<prerelease> = beta[.<number>]
<date>       = YYYY-MM-DD
```

- [ ] **Step 1: Write the failing test**

Create `src/channel.test.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import { isDatedNonNightly, isRolling, parseChannel } from "./channel.ts";

describe("parseChannel", () => {
  it("parses the rolling channels", () => {
    expect(parseChannel("stable").kind).toBe("stable");
    expect(parseChannel("  beta ").kind).toBe("beta");
    expect(parseChannel("nightly").kind).toBe("nightly");
  });

  it("parses a two-field and a three-field version", () => {
    expect(parseChannel("1.88").version).toBe("1.88");
    expect(parseChannel("1.88.0").version).toBe("1.88.0");
  });

  it("parses a prerelease suffix", () => {
    const parsed = parseChannel("1.88.0-beta.1");
    expect(parsed.version).toBe("1.88.0");
    expect(parsed.prerelease).toBe("beta.1");
  });

  it("parses a dated nightly", () => {
    const parsed = parseChannel("nightly-2026-08-03");
    expect(parsed.kind).toBe("nightly");
    expect(parsed.date).toBe("2026-08-03");
  });

  it("parses a host suffix", () => {
    const parsed = parseChannel("stable-x86_64-apple-darwin");
    expect(parsed.kind).toBe("stable");
    expect(parsed.host).toBe("x86_64-apple-darwin");
  });

  it("parses a dated nightly with a host", () => {
    const parsed = parseChannel("nightly-2026-08-03-x86_64-apple-darwin");
    expect(parsed.date).toBe("2026-08-03");
    expect(parsed.host).toBe("x86_64-apple-darwin");
  });

  it("treats an unrecognised name as a custom version channel", () => {
    expect(parseChannel("my-toolchain").kind).toBe("version");
  });

  it("rejects empty input", () => {
    expect(() => parseChannel("   ")).toThrow("channel must not be empty");
  });
});

describe("isRolling", () => {
  it("is true for stable, beta, and undated nightly", () => {
    expect(isRolling(parseChannel("stable"))).toBe(true);
    expect(isRolling(parseChannel("beta"))).toBe(true);
    expect(isRolling(parseChannel("nightly"))).toBe(true);
  });

  it("is false for a dated nightly and for a version", () => {
    expect(isRolling(parseChannel("nightly-2026-08-03"))).toBe(false);
    expect(isRolling(parseChannel("1.88"))).toBe(false);
  });
});

describe("isDatedNonNightly", () => {
  it("flags a dated stable but not a dated nightly", () => {
    expect(isDatedNonNightly(parseChannel("stable-2026-08-03"))).toBe(true);
    expect(isDatedNonNightly(parseChannel("nightly-2026-08-03"))).toBe(false);
    expect(isDatedNonNightly(parseChannel("stable"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/channel.test.ts`
Expected: FAIL — `Cannot find module './channel.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/channel.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/channel.test.ts`
Expected: PASS. If any branch is uncovered, add the missing case before moving on — the gate is 100%.

- [ ] **Step 5: Commit**

```bash
git add src/channel.ts src/channel.test.ts
git commit -S -m "feat: parse rustup channel specifications"
```

---

### Task 3: Version comparison

**Files:**

- Create: `src/version.ts`
- Test: `src/version.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `interface SemVersion { major: number; minor: number; patch: number }`
  - `parseVersion(raw: string): SemVersion | undefined`
  - `compareVersions(a: SemVersion, b: SemVersion): number` — negative, zero, positive.
  - `maxVersion(raw: readonly string[]): string | undefined` — returns the original string of the highest entry.
- [ ] **Step 1: Write the failing test**

Create `src/version.test.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import { compareVersions, maxVersion, parseVersion } from "./version.ts";

describe("parseVersion", () => {
  it("accepts two and three field versions", () => {
    expect(parseVersion("1.88")).toEqual({ major: 1, minor: 88, patch: 0 });
    expect(parseVersion("1.88.2")).toEqual({ major: 1, minor: 88, patch: 2 });
  });

  it("drops a prerelease or build suffix", () => {
    expect(parseVersion("1.88.0-beta.1")).toEqual(parseVersion("1.88.0"));
    expect(parseVersion("1.88.0+build9")).toEqual(parseVersion("1.88.0"));
  });

  it("returns undefined for malformed input", () => {
    for (const raw of ["", "1", "1.x", "1.2.3.4", "   "]) {
      expect(parseVersion(raw)).toBeUndefined();
    }
  });
});

describe("compareVersions", () => {
  it("orders numerically, not lexically", () => {
    const older = parseVersion("1.9.0");
    const newer = parseVersion("1.10.0");
    if (older === undefined || newer === undefined) {
      throw new Error("fixture versions must parse");
    }
    expect(compareVersions(older, newer)).toBeLessThan(0);
    expect(compareVersions(newer, older)).toBeGreaterThan(0);
    expect(compareVersions(older, older)).toBe(0);
  });
});

describe("maxVersion", () => {
  it("returns the highest parseable entry", () => {
    expect(maxVersion(["1.88.0", "1.95.0", "1.9.0"])).toBe("1.95.0");
  });

  it("skips unparseable entries rather than failing", () => {
    expect(maxVersion(["not-a-version", "1.88.0"])).toBe("1.88.0");
  });

  it("returns undefined when nothing parses", () => {
    expect(maxVersion(["nope"])).toBeUndefined();
    expect(maxVersion([])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/version.test.ts`
Expected: FAIL — `Cannot find module './version.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/version.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/version.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/version.ts src/version.test.ts
git commit -S -m "feat: compare versions numerically"
```

---

### Task 4: Toolchain file parsing

**Files:**

- Create: `src/toolchain.ts`
- Test: `src/toolchain.test.ts`

**Interfaces:**

- Consumes: `describeError` from Task 1.
- Produces:
  - `interface ToolchainFile { channel?: string; components: string[]; targets: string[]; profile?: string; path?: string }`
  - `parseToolchainFile(toml: string): ToolchainFile` — throws on malformed TOML, on `channel` together with `path`, and on a profile outside the closed set.

Rules from the spec: `channel` and `path` are mutually exclusive; `profile` is one of `minimal`, `default`, `complete`; an absent `[toolchain]` table yields empty lists and no channel.

- [ ] **Step 1: Write the failing test**

Create `src/toolchain.test.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import { parseToolchainFile } from "./toolchain.ts";

describe("parseToolchainFile", () => {
  it("reads channel, components, targets, and profile", () => {
    const parsed = parseToolchainFile(
      [
        "[toolchain]",
        'channel = "1.97"',
        'profile = "default"',
        'components = ["rustfmt", "clippy"]',
        'targets = ["wasm32-unknown-unknown"]',
      ].join("\n"),
    );
    expect(parsed.channel).toBe("1.97");
    expect(parsed.profile).toBe("default");
    expect(parsed.components).toEqual(["rustfmt", "clippy"]);
    expect(parsed.targets).toEqual(["wasm32-unknown-unknown"]);
  });

  it("returns empty values when the table is absent", () => {
    const parsed = parseToolchainFile("");
    expect(parsed.channel).toBeUndefined();
    expect(parsed.components).toEqual([]);
    expect(parsed.targets).toEqual([]);
  });

  it("accepts a path-only toolchain", () => {
    const parsed = parseToolchainFile('[toolchain]\npath = "/opt/rust"\n');
    expect(parsed.path).toBe("/opt/rust");
  });

  it("rejects channel and path together", () => {
    expect(() =>
      parseToolchainFile('[toolchain]\nchannel = "1.97"\npath = "/opt/rust"\n'),
    ).toThrow("mutually exclusive");
  });

  it("rejects an unknown profile", () => {
    expect(() =>
      parseToolchainFile('[toolchain]\nprofile = "everything"\n'),
    ).toThrow("profile must be one of");
  });

  it("rejects malformed TOML", () => {
    expect(() => parseToolchainFile("[toolchain\n")).toThrow(
      "rust-toolchain.toml is not valid TOML",
    );
  });

  it("ignores non-string entries in the lists", () => {
    const parsed = parseToolchainFile(
      '[toolchain]\ncomponents = ["clippy", 7]\n',
    );
    expect(parsed.components).toEqual(["clippy"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/toolchain.test.ts`
Expected: FAIL — `Cannot find module './toolchain.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/toolchain.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { parse } from "smol-toml";

import { describeError } from "./errors.ts";

/** The `[toolchain]` table of a `rust-toolchain.toml`. */
export interface ToolchainFile {
  readonly channel?: string;
  readonly components: readonly string[];
  readonly targets: readonly string[];
  readonly profile?: string;
  readonly path?: string;
}

const PROFILES = ["minimal", "default", "complete"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Parses a `rust-toolchain.toml`.
 *
 * Throws on malformed TOML rather than degrading: a syntax error hides the
 * author's intent, and guessing past it produces a matrix nobody asked for.
 */
export function parseToolchainFile(toml: string): ToolchainFile {
  let document: unknown;
  try {
    document = parse(toml);
  } catch (error) {
    throw new Error(
      `rust-toolchain.toml is not valid TOML: ${describeError(error)}`,
      { cause: error },
    );
  }

  const table = isRecord(document) ? document["toolchain"] : undefined;
  if (!isRecord(table)) {
    return { components: [], targets: [] };
  }

  const channel = optionalString(table["channel"]);
  const path = optionalString(table["path"]);
  if (channel !== undefined && path !== undefined) {
    throw new Error(
      "rust-toolchain.toml declares both `channel` and `path`, which rustup " +
        "treats as mutually exclusive",
    );
  }

  const profile = optionalString(table["profile"]);
  if (profile !== undefined && !PROFILES.includes(profile)) {
    throw new Error(
      `rust-toolchain.toml profile must be one of ${PROFILES.join(", ")}; ` +
        `found "${profile}"`,
    );
  }

  return {
    channel,
    path,
    profile,
    components: stringList(table["components"]),
    targets: stringList(table["targets"]),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/toolchain.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/toolchain.ts src/toolchain.test.ts
git commit -S -m "feat: parse rust-toolchain.toml with rustup constraints"
```

---

### Task 5: Cargo manifest parsing

**Files:**

- Create: `src/manifest.ts`
- Test: `src/manifest.test.ts`

**Interfaces:**

- Consumes: `describeError` from Task 1.
- Produces:
  - `type MsrvSource = "cargo-toml" | "workspace-inherit" | "none"`
  - `interface Manifest { name?: string; rustVersion?: string; msrvSource: MsrvSource; isWorkspaceRoot: boolean; members: string[]; exclude: string[]; defaultMembers: string[]; workspaceRustVersion?: string; inheritsRustVersion: boolean }`
  - `parseManifest(toml: string): Manifest`

The three shapes, from the spec: a direct `[package] rust-version` wins outright; a virtual manifest's `[workspace.package] rust-version` is `workspace-inherit`; and `rust-version.workspace = true` parses to the **object** `{ workspace: true }`, not a string. Inheritance is opt-in — a `[package]` that merely omits `rust-version` inherits nothing.

- [ ] **Step 1: Write the failing test**

Create `src/manifest.test.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import { parseManifest } from "./manifest.ts";

describe("parseManifest", () => {
  it("reads a direct package rust-version", () => {
    const parsed = parseManifest(
      '[package]\nname = "cli"\nrust-version = "1.88"\n',
    );
    expect(parsed.name).toBe("cli");
    expect(parsed.rustVersion).toBe("1.88");
    expect(parsed.msrvSource).toBe("cargo-toml");
  });

  it("reports none when the package omits rust-version", () => {
    const parsed = parseManifest('[package]\nname = "cli"\n');
    expect(parsed.rustVersion).toBeUndefined();
    expect(parsed.msrvSource).toBe("none");
  });

  it("reads a virtual manifest's workspace rust-version", () => {
    const parsed = parseManifest(
      [
        "[workspace]",
        'members = ["crates/*"]',
        "[workspace.package]",
        'rust-version = "1.88"',
      ].join("\n"),
    );
    expect(parsed.isWorkspaceRoot).toBe(true);
    expect(parsed.members).toEqual(["crates/*"]);
    expect(parsed.rustVersion).toBe("1.88");
    expect(parsed.msrvSource).toBe("workspace-inherit");
  });

  it("detects the object form of rust-version.workspace", () => {
    const parsed = parseManifest(
      '[package]\nname = "channel"\nrust-version.workspace = true\n',
    );
    expect(parsed.inheritsRustVersion).toBe(true);
    expect(parsed.rustVersion).toBeUndefined();
    expect(parsed.msrvSource).toBe("workspace-inherit");
  });

  it("does not inherit when the package merely omits rust-version", () => {
    const parsed = parseManifest(
      [
        "[package]",
        'name = "version"',
        "[workspace.package]",
        'rust-version = "1.88"',
      ].join("\n"),
    );
    expect(parsed.inheritsRustVersion).toBe(false);
    expect(parsed.msrvSource).toBe("none");
  });

  it("reads exclude and default-members", () => {
    const parsed = parseManifest(
      [
        "[workspace]",
        'members = ["crates/*"]',
        'exclude = ["crates/legacy"]',
        'default-members = ["crates/core"]',
      ].join("\n"),
    );
    expect(parsed.exclude).toEqual(["crates/legacy"]);
    expect(parsed.defaultMembers).toEqual(["crates/core"]);
  });

  it("rejects malformed TOML", () => {
    expect(() => parseManifest("[package\n")).toThrow(
      "Cargo.toml is not valid TOML",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/manifest.test.ts`
Expected: FAIL — `Cannot find module './manifest.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/manifest.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { parse } from "smol-toml";

import { describeError } from "./errors.ts";

/** Where a resolved MSRV came from. Published as an output, so it is versioned. */
export type MsrvSource = "cargo-toml" | "workspace-inherit" | "none";

/** The parts of a `Cargo.toml` this action reads. */
export interface Manifest {
  readonly name?: string;
  readonly rustVersion?: string;
  readonly msrvSource: MsrvSource;
  readonly isWorkspaceRoot: boolean;
  readonly members: readonly string[];
  readonly exclude: readonly string[];
  readonly defaultMembers: readonly string[];
  readonly workspaceRustVersion?: string;
  readonly inheritsRustVersion: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function declaredVersion(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * True when a table opts into workspace inheritance.
 *
 * This is the one trap in this file: `rust-version.workspace = true` parses to
 * the object `{ workspace: true }`, not to a string. Code that expects a string
 * here reads no MSRV and silently reports none.
 */
function inherits(table: Record<string, unknown>): boolean {
  const value = table["rust-version"];
  return isRecord(value) && value["workspace"] === true;
}

/** Parses a `Cargo.toml`. Throws on malformed TOML. */
export function parseManifest(toml: string): Manifest {
  let document: unknown;
  try {
    document = parse(toml);
  } catch (error) {
    throw new Error(`Cargo.toml is not valid TOML: ${describeError(error)}`, {
      cause: error,
    });
  }

  const root = isRecord(document) ? document : {};
  const pkg = isRecord(root["package"]) ? root["package"] : undefined;
  const workspace = isRecord(root["workspace"]) ? root["workspace"] : undefined;
  const workspacePackage = isRecord(root["workspace.package"])
    ? root["workspace.package"]
    : isRecord(workspace?.["package"])
      ? workspace["package"]
      : undefined;

  const workspaceRustVersion = declaredVersion(
    workspacePackage?.["rust-version"],
  );
  const direct =
    pkg === undefined ? undefined : declaredVersion(pkg["rust-version"]);
  const optsIn = pkg !== undefined && inherits(pkg);

  let rustVersion: string | undefined;
  let msrvSource: MsrvSource = "none";
  if (direct !== undefined) {
    rustVersion = direct;
    msrvSource = "cargo-toml";
  } else if (optsIn) {
    // The member opts in; the value itself lives in the workspace root, which
    // this single-file parse may not have. Resolution happens in workspace.ts.
    msrvSource = "workspace-inherit";
  } else if (pkg === undefined && workspaceRustVersion !== undefined) {
    rustVersion = workspaceRustVersion;
    msrvSource = "workspace-inherit";
  }

  return {
    name: declaredVersion(pkg?.["name"]),
    rustVersion,
    msrvSource,
    isWorkspaceRoot: workspace !== undefined,
    members: stringList(workspace?.["members"]),
    exclude: stringList(workspace?.["exclude"]),
    defaultMembers: stringList(workspace?.["default-members"]),
    workspaceRustVersion,
    inheritsRustVersion: optsIn,
  };
}
```

> Note for the implementer: `smol-toml` renders `[workspace.package]` as a nested
> object under `workspace`, not as a flat `"workspace.package"` key. Both lookups
> are kept above so the parse is robust to either shape; verify which one your
> `smol-toml` version produces and delete the branch that is dead, since the
> coverage gate will otherwise fail on the unreachable one.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/manifest.ts src/manifest.test.ts
git commit -S -m "feat: parse Cargo.toml including workspace inheritance"
```

---

### Task 6: Clippy config and MSRV consistency rules

**Files:**

- Create: `src/clippy.ts`
- Create: `src/msrv.ts`
- Test: `src/clippy.test.ts`
- Test: `src/msrv.test.ts`

**Interfaces:**

- Consumes: `describeError` (Task 1); `parseVersion`, `compareVersions` (Task 3); `ParsedChannel`, `isRolling` (Task 2).
- Produces:
  - `parseClippyConfig(toml: string): { msrv?: string }`
  - `assertClippyAgreement(input: { directory: string; clippyMsrv?: string; manifestRustVersion?: string }): void` — throws naming both paths and both values.
  - `assertToolchainMeetsMsrv(channel: ParsedChannel, msrv: string | undefined): void` — throws when a concrete channel is below the floor; rolling channels always pass.
- [ ] **Step 1: Write the failing test**

Create `src/clippy.test.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import { parseClippyConfig } from "./clippy.ts";

describe("parseClippyConfig", () => {
  it("reads an msrv key", () => {
    expect(parseClippyConfig('msrv = "1.88"\n').msrv).toBe("1.88");
  });

  it("returns nothing when the key is absent", () => {
    expect(
      parseClippyConfig("avoid-breaking-exported-api = false\n").msrv,
    ).toBeUndefined();
  });

  it("rejects malformed TOML", () => {
    expect(() => parseClippyConfig('msrv = "\n')).toThrow(
      ".clippy.toml is not valid TOML",
    );
  });
});
```

Create `src/msrv.test.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
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
    ).toThrow(/fixtures\/cli-msrv\/\.clippy\.toml.*1\.90.*1\.88/s);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/clippy.test.ts src/msrv.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/clippy.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { parse } from "smol-toml";

import { describeError } from "./errors.ts";

/** The single key this action reads out of a `.clippy.toml`. */
export interface ClippyConfig {
  readonly msrv?: string;
}

/** Parses a `.clippy.toml`. Throws on malformed TOML. */
export function parseClippyConfig(toml: string): ClippyConfig {
  let document: unknown;
  try {
    document = parse(toml);
  } catch (error) {
    throw new Error(`.clippy.toml is not valid TOML: ${describeError(error)}`, {
      cause: error,
    });
  }
  const root =
    typeof document === "object" && document !== null
      ? (document as Record<string, unknown>)
      : {};
  const msrv = root["msrv"];
  return {
    msrv: typeof msrv === "string" && msrv.length > 0 ? msrv : undefined,
  };
}
```

Create `src/msrv.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/clippy.test.ts src/msrv.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/clippy.ts src/msrv.ts src/clippy.test.ts src/msrv.test.ts
git commit -S -m "feat: enforce MSRV consistency across clippy and cargo config"
```

---

### Task 7: Workspace expansion

**Files:**

- Create: `src/workspace.ts`
- Test: `src/workspace.test.ts`

**Interfaces:**

- Consumes: `Manifest`, `parseManifest` (Task 5); `maxVersion` (Task 3); `parseClippyConfig` (Task 6); `ActionDeps` (Task 1).
- Produces:
  - `type WorkspaceMode = "root" | "per-crate" | "aggregate"`
  - `interface Unit { directory: string; name: string; rustVersion?: string; msrvSource: MsrvSource; clippyMsrv?: string }`
  - `expandWorkspace(input: { deps: ActionDeps; root: string; manifest: Manifest; mode: WorkspaceMode }): Unit[]`

`root` returns one unit for the root manifest. `per-crate` returns one unit per member. `aggregate` returns one unit whose `rustVersion` is the maximum across members. Members are expanded with `deps.glob`, then filtered by `exclude`. A declared `members` list expanding to zero crates throws.

- [ ] **Step 1: Write the failing test**

Create `src/workspace.test.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import type { ActionDeps } from "./deps.ts";

import { parseManifest } from "./manifest.ts";
import { expandWorkspace } from "./workspace.ts";

const ROOT_TOML = [
  "[workspace]",
  'members = ["crates/*"]',
  "[workspace.package]",
  'rust-version = "1.88"',
].join("\n");

const FILES: Record<string, string> = {
  "/w/crates/channel/Cargo.toml":
    '[package]\nname = "channel"\nrust-version.workspace = true\n',
  "/w/crates/version/Cargo.toml": '[package]\nname = "version"\n',
  "/w/crates/strict/Cargo.toml":
    '[package]\nname = "strict"\nrust-version = "1.92"\n',
  "/w/crates/strict/.clippy.toml": 'msrv = "1.92"\n',
};

function fakeDeps(): ActionDeps {
  return {
    core: {
      getInput: () => "",
      setOutput: () => undefined,
      setFailed: () => undefined,
      warning: () => undefined,
      info: () => undefined,
    },
    readFile: (path: string) => {
      const found = FILES[path];
      if (found === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }
      return found;
    },
    glob: () => ["crates/channel", "crates/strict", "crates/version"],
    cwd: "/w",
  };
}

describe("expandWorkspace", () => {
  it("returns a single unit in root mode", () => {
    const units = expandWorkspace({
      deps: fakeDeps(),
      root: "/w",
      manifest: parseManifest(ROOT_TOML),
      mode: "root",
    });
    expect(units).toHaveLength(1);
    expect(units[0]?.rustVersion).toBe("1.88");
  });

  it("returns one unit per member in per-crate mode", () => {
    const units = expandWorkspace({
      deps: fakeDeps(),
      root: "/w",
      manifest: parseManifest(ROOT_TOML),
      mode: "per-crate",
    });
    expect(units.map((unit) => unit.name)).toEqual([
      "channel",
      "strict",
      "version",
    ]);
    expect(units[0]?.rustVersion).toBe("1.88");
    expect(units[1]?.rustVersion).toBe("1.92");
    expect(units[2]?.rustVersion).toBeUndefined();
  });

  it("collapses to the maximum member MSRV in aggregate mode", () => {
    const units = expandWorkspace({
      deps: fakeDeps(),
      root: "/w",
      manifest: parseManifest(ROOT_TOML),
      mode: "aggregate",
    });
    expect(units).toHaveLength(1);
    expect(units[0]?.rustVersion).toBe("1.92");
  });

  it("carries the sibling clippy msrv for validation", () => {
    const units = expandWorkspace({
      deps: fakeDeps(),
      root: "/w",
      manifest: parseManifest(ROOT_TOML),
      mode: "per-crate",
    });
    expect(units[1]?.clippyMsrv).toBe("1.92");
    expect(units[0]?.clippyMsrv).toBeUndefined();
  });

  it("throws when declared members expand to nothing", () => {
    const deps = { ...fakeDeps(), glob: (): string[] => [] };
    expect(() =>
      expandWorkspace({
        deps,
        root: "/w",
        manifest: parseManifest(ROOT_TOML),
        mode: "per-crate",
      }),
    ).toThrow("expanded to zero crates");
  });

  it("treats a plain package as a single unit", () => {
    const manifest = parseManifest(
      '[package]\nname = "cli"\nrust-version = "1.88"\n',
    );
    const units = expandWorkspace({
      deps: fakeDeps(),
      root: "/w",
      manifest,
      mode: "per-crate",
    });
    expect(units).toHaveLength(1);
    expect(units[0]?.name).toBe("cli");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/workspace.test.ts`
Expected: FAIL — `Cannot find module './workspace.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/workspace.ts`. Implement exactly these three pure functions plus the dispatcher, keeping them in one module per the Rule of Three — extract a `WorkspaceResolver` interface only once a third implementation demonstrably diverges.

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import type { ActionDeps } from "./deps.ts";
import type { Manifest, MsrvSource } from "./manifest.ts";

import { parseClippyConfig } from "./clippy.ts";
import { parseManifest } from "./manifest.ts";
import { maxVersion } from "./version.ts";

/** How a workspace is projected onto matrix legs. */
export type WorkspaceMode = "root" | "per-crate" | "aggregate";

/** One resolved crate (or the whole tree) that the matrix is built from. */
export interface Unit {
  readonly directory: string;
  readonly name: string;
  readonly rustVersion?: string;
  readonly msrvSource: MsrvSource;
  readonly clippyMsrv?: string;
}

interface ExpandInput {
  readonly deps: ActionDeps;
  readonly root: string;
  readonly manifest: Manifest;
  readonly mode: WorkspaceMode;
}

function readOptional(deps: ActionDeps, path: string): string | undefined {
  try {
    return deps.readFile(path);
  } catch {
    return undefined;
  }
}

function clippyMsrvAt(deps: ActionDeps, directory: string): string | undefined {
  const raw = readOptional(deps, `${directory}/.clippy.toml`);
  return raw === undefined ? undefined : parseClippyConfig(raw).msrv;
}

function memberDirectories(input: ExpandInput): readonly string[] {
  const { deps, root, manifest } = input;
  const matched = manifest.members.flatMap((pattern) =>
    deps.glob(pattern, root),
  );
  const excluded = new Set(manifest.exclude);
  const kept = matched.filter((entry) => !excluded.has(entry));
  if (manifest.members.length > 0 && kept.length === 0) {
    throw new Error(
      `Cargo.toml declares workspace members ${manifest.members.join(", ")} ` +
        "but the pattern expanded to zero crates",
    );
  }
  return kept;
}

function memberUnits(input: ExpandInput): readonly Unit[] {
  const { deps, root, manifest } = input;
  return memberDirectories(input).map((relative) => {
    const directory = `${root}/${relative}`;
    const member = parseManifest(deps.readFile(`${directory}/Cargo.toml`));
    const rustVersion = member.inheritsRustVersion
      ? manifest.workspaceRustVersion
      : member.rustVersion;
    return {
      directory,
      name: member.name ?? relative,
      rustVersion,
      msrvSource: member.msrvSource,
      clippyMsrv: clippyMsrvAt(deps, directory),
    };
  });
}

function rootUnit(input: ExpandInput): Unit {
  const { deps, root, manifest } = input;
  return {
    directory: root,
    name: manifest.name ?? "workspace",
    rustVersion: manifest.rustVersion,
    msrvSource: manifest.msrvSource,
    clippyMsrv: clippyMsrvAt(deps, root),
  };
}

function aggregateUnit(input: ExpandInput): Unit {
  const members = memberUnits(input);
  const declared = members
    .map((unit) => unit.rustVersion)
    .filter((value): value is string => value !== undefined);
  const highest = maxVersion(declared);
  const base = rootUnit(input);
  return {
    ...base,
    rustVersion: highest ?? base.rustVersion,
    msrvSource: highest === undefined ? base.msrvSource : "workspace-inherit",
  };
}

/** Projects a manifest onto the units the matrix is built from. */
export function expandWorkspace(input: ExpandInput): Unit[] {
  if (!input.manifest.isWorkspaceRoot) {
    return [rootUnit(input)];
  }
  if (input.mode === "root") {
    return [rootUnit(input)];
  }
  if (input.mode === "aggregate") {
    return [aggregateUnit(input)];
  }
  return [...memberUnits(input)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/workspace.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workspace.ts src/workspace.test.ts
git commit -S -m "feat: expand cargo workspaces into matrix units"
```

---

### Task 8: Target-to-runner mapping

**Files:**

- Create: `src/runners.ts`
- Test: `src/runners.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `interface RunnerChoice { os: string; canRun: boolean; mapped: boolean }`
  - `resolveRunner(target: string, overrides: Readonly<Record<string, string>>): RunnerChoice`
  - `DEFAULT_RUNNERS: Readonly<Record<string, string>>`
- [ ] **Step 1: Write the failing test**

Create `src/runners.test.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import { resolveRunner } from "./runners.ts";

describe("resolveRunner", () => {
  it("maps every native triple to its native runner", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["x86_64-unknown-linux-gnu", "ubuntu-latest"],
      ["aarch64-unknown-linux-gnu", "ubuntu-24.04-arm"],
      ["x86_64-apple-darwin", "macos-15-intel"],
      ["aarch64-apple-darwin", "macos-latest"],
      ["x86_64-pc-windows-msvc", "windows-latest"],
      ["aarch64-pc-windows-msvc", "windows-11-arm"],
    ];
    for (const [target, os] of cases) {
      const choice = resolveRunner(target, {});
      expect(choice.os).toBe(os);
      expect(choice.canRun).toBe(true);
    }
  });

  it("does not put an x86_64 macOS target on an ARM runner", () => {
    expect(resolveRunner("x86_64-apple-darwin", {}).os).not.toBe(
      "macos-latest",
    );
  });

  it("maps wasm to ubuntu but marks it not runnable", () => {
    const choice = resolveRunner("wasm32-unknown-unknown", {});
    expect(choice.os).toBe("ubuntu-latest");
    expect(choice.canRun).toBe(false);
  });

  it("falls back for an unmapped target and reports it", () => {
    const choice = resolveRunner("riscv64gc-unknown-linux-gnu", {});
    expect(choice.os).toBe("ubuntu-latest");
    expect(choice.canRun).toBe(false);
    expect(choice.mapped).toBe(false);
  });

  it("lets an override win", () => {
    const choice = resolveRunner("wasm32-unknown-unknown", {
      "wasm32-unknown-unknown": "self-hosted-wasm",
    });
    expect(choice.os).toBe("self-hosted-wasm");
    expect(choice.mapped).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/runners.test.ts`
Expected: FAIL — `Cannot find module './runners.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/runners.ts`:

```ts
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
  return { os: FALLBACK, canRun: false, mapped: false };
}
```

> Note for the implementer: an override deliberately reports `canRun: false`,
> because the action cannot know whether an arbitrary self-hosted label runs the
> target natively. If a later requirement needs an override to assert
> runnability, extend `runner-map` to accept an object rather than guessing here.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/runners.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runners.ts src/runners.test.ts
git commit -S -m "feat: map target triples to native GitHub runners"
```

---

### Task 9: Matrix builder

**Files:**

- Create: `src/matrix.ts`
- Test: `src/matrix.test.ts`

**Interfaces:**

- Consumes: `resolveRunner` (Task 8).
- Produces:
  - `interface MatrixLeg { toolchain: string; target: string; os: string; "can-run": boolean; crate?: string }`
  - `interface BuiltMatrix { include: MatrixLeg[]; toolchains: string[]; targets: string[]; runners: string[]; crates: string[] }`
  - `class MatrixBuilder` with `withCrate(name)`, `withToolchains(list)`, `withTargets(list)`, `withRunnerOverrides(map)`, `build(): BuiltMatrix`. Every `with*` returns `this`.

An empty matrix throws: a downstream job reading an empty matrix is skipped silently, and a green workflow that ran nothing is the worst available outcome.

- [ ] **Step 1: Write the failing test**

Create `src/matrix.test.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
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
    expect(built.include[0]?.["can-run"]).toBe(false);
  });

  it("adds a crate key without multiplying an axis", () => {
    const built = new MatrixBuilder()
      .withCrate("channel")
      .withToolchains(["1.97"])
      .withTargets(["x86_64-unknown-linux-gnu"])
      .build();
    expect(built.include[0]?.crate).toBe("channel");
    expect(built.crates).toEqual(["channel"]);
  });

  it("emits a host leg when no target is declared", () => {
    const built = new MatrixBuilder().withToolchains(["stable"]).build();
    expect(built.include).toHaveLength(1);
    expect(built.include[0]?.target).toBe("");
    expect(built.include[0]?.os).toBe("ubuntu-latest");
  });

  it("deduplicates the axes", () => {
    const built = new MatrixBuilder()
      .withToolchains(["1.97", "1.97"])
      .withTargets(["x86_64-unknown-linux-gnu", "x86_64-unknown-linux-gnu"])
      .build();
    expect(built.toolchains).toEqual(["1.97"]);
    expect(built.targets).toEqual(["x86_64-unknown-linux-gnu"]);
    expect(built.include).toHaveLength(1);
  });

  it("honours a runner override", () => {
    const built = new MatrixBuilder()
      .withToolchains(["1.97"])
      .withTargets(["wasm32-unknown-unknown"])
      .withRunnerOverrides({ "wasm32-unknown-unknown": "self-hosted-wasm" })
      .build();
    expect(built.include[0]?.os).toBe("self-hosted-wasm");
  });

  it("refuses to build an empty matrix", () => {
    expect(() => new MatrixBuilder().build()).toThrow("matrix is empty");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/matrix.test.ts`
Expected: FAIL — `Cannot find module './matrix.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/matrix.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
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
  #toolchains: string[] = [];
  #targets: string[] = [];
  #overrides: Readonly<Record<string, string>> = {};

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/matrix.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/matrix.ts src/matrix.test.ts
git commit -S -m "feat: build an include-list matrix with a fluent builder"
```

---

### Task 10: Input reading

**Files:**

- Create: `src/inputs.ts`
- Test: `src/inputs.test.ts`

**Interfaces:**

- Consumes: `ActionCore` (Task 1); `WorkspaceMode` (Task 7).
- Produces:
  - `interface Options { workingDirectory: string; toolchain?: string; channels: string[]; targets: string[]; runnerMap: Record<string, string>; workspaceMode: WorkspaceMode; includeMsrv: boolean }`
  - `readOptions(core: ActionCore): Options`
  - `parseList(raw: string): string[]` — splits on commas, spaces, and newlines.

Identifier validation: every target and component must match `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`, because these values arrive from an untrusted checkout.

- [ ] **Step 1: Write the failing test**

Create `src/inputs.test.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import type { ActionCore } from "./deps.ts";

import { parseList, readOptions } from "./inputs.ts";

function coreWith(values: Record<string, string>): ActionCore {
  return {
    getInput: (name: string) => values[name] ?? "",
    setOutput: () => undefined,
    setFailed: () => undefined,
    warning: () => undefined,
    info: () => undefined,
  };
}

describe("parseList", () => {
  it("splits on commas, spaces, and newlines", () => {
    expect(parseList("a, b\nc  d")).toEqual(["a", "b", "c", "d"]);
  });

  it("returns empty for blank input", () => {
    expect(parseList("   ")).toEqual([]);
  });
});

describe("readOptions", () => {
  it("applies documented defaults", () => {
    const options = readOptions(coreWith({}));
    expect(options.workingDirectory).toBe(".");
    expect(options.workspaceMode).toBe("root");
    expect(options.includeMsrv).toBe(true);
    expect(options.channels).toEqual([]);
  });

  it("reads every input", () => {
    const options = readOptions(
      coreWith({
        "working-directory": "fixtures/cli",
        toolchain: "1.90",
        channels: "beta, nightly",
        targets: "wasm32-unknown-unknown",
        "workspace-mode": "per-crate",
        "include-msrv": "false",
        "runner-map": '{"wasm32-unknown-unknown":"self-hosted"}',
      }),
    );
    expect(options.toolchain).toBe("1.90");
    expect(options.channels).toEqual(["beta", "nightly"]);
    expect(options.workspaceMode).toBe("per-crate");
    expect(options.includeMsrv).toBe(false);
    expect(options.runnerMap["wasm32-unknown-unknown"]).toBe("self-hosted");
  });

  it("rejects an invalid workspace mode", () => {
    expect(() => readOptions(coreWith({ "workspace-mode": "nope" }))).toThrow(
      "workspace-mode must be one of",
    );
  });

  it("rejects a runner-map that is not a JSON object", () => {
    expect(() => readOptions(coreWith({ "runner-map": "[1]" }))).toThrow(
      "runner-map must be a JSON object",
    );
    expect(() => readOptions(coreWith({ "runner-map": "{" }))).toThrow(
      "runner-map must be a JSON object",
    );
  });

  it("rejects a target name that is not an identifier", () => {
    expect(() => readOptions(coreWith({ targets: "../etc/passwd" }))).toThrow(
      "is not a valid identifier",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/inputs.test.ts`
Expected: FAIL — `Cannot find module './inputs.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/inputs.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import type { ActionCore } from "./deps.ts";
import type { WorkspaceMode } from "./workspace.ts";

/** Resolved action inputs. */
export interface Options {
  readonly workingDirectory: string;
  readonly toolchain?: string;
  readonly channels: readonly string[];
  readonly targets: readonly string[];
  readonly runnerMap: Readonly<Record<string, string>>;
  readonly workspaceMode: WorkspaceMode;
  readonly includeMsrv: boolean;
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Splits a list input on commas, spaces, and newlines. */
export function parseList(raw: string): string[] {
  return raw.split(/[,\s]+/).filter((entry) => entry.length > 0);
}

function isWorkspaceMode(value: string): value is WorkspaceMode {
  return value === "root" || value === "per-crate" || value === "aggregate";
}

/**
 * Rejects a value that is not a bare identifier.
 *
 * These arrive from an untrusted checkout and end up interpolated into rustup
 * arguments, so this is defence in depth plus a better error message.
 */
function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`${label} "${value}" is not a valid identifier`);
  }
}

function readRunnerMap(raw: string): Readonly<Record<string, string>> {
  if (raw.trim().length === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("runner-map must be a JSON object", { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("runner-map must be a JSON object");
  }
  const entries = Object.entries(parsed).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

/** Reads and validates every action input. */
export function readOptions(core: ActionCore): Options {
  const mode = core.getInput("workspace-mode") || "root";
  if (!isWorkspaceMode(mode)) {
    throw new Error("workspace-mode must be one of root, per-crate, aggregate");
  }

  const targets = parseList(core.getInput("targets"));
  for (const target of targets) {
    assertIdentifier(target, "target");
  }

  const toolchain = core.getInput("toolchain");

  return {
    workingDirectory: core.getInput("working-directory") || ".",
    toolchain: toolchain.length > 0 ? toolchain : undefined,
    channels: parseList(core.getInput("channels")),
    targets,
    runnerMap: readRunnerMap(core.getInput("runner-map")),
    workspaceMode: mode,
    includeMsrv: core.getInput("include-msrv") !== "false",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/inputs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/inputs.ts src/inputs.test.ts
git commit -S -m "feat: read and validate action inputs"
```

---

### Task 11: Outputs and install plan

**Files:**

- Create: `src/outputs.ts`
- Test: `src/outputs.test.ts`

**Interfaces:**

- Consumes: `BuiltMatrix` (Task 9); `MsrvSource` (Task 5).
- Produces:
  - `interface InstallStep { step: "toolchain" | "profile" | "components" | "target"; argv: string[] }`
  - `buildInstallPlan(input: { profile?: string; components: readonly string[]; hasTargets: boolean }): InstallStep[]`
  - `interface ActionOutputs { matrix; toolchains; targets; runners; crates; channel; msrv; "msrv-source"; components; profile; "install-plan" }`
  - `toOutputEntries(outputs: ActionOutputs): Array<[string, string]>`

The plan is ordered because installing the toolchain first and resolving the profile second lets a `complete` profile degrade rather than abort. `$TOOLCHAIN` and `$TARGET` are substituted by the consumer. **The action never executes this plan.**

- [ ] **Step 1: Write the failing test**

Create `src/outputs.test.ts`:

```ts
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
    const entries = toOutputEntries({
      matrix: { include: [] },
      toolchains: ["1.97"],
      targets: [],
      runners: ["ubuntu-latest"],
      crates: [],
      channel: "1.97",
      msrv: "1.88",
      "msrv-source": "cargo-toml",
      components: ["clippy"],
      profile: "default",
      "install-plan": [],
    });
    const map = new Map(entries);
    expect(map.get("toolchains")).toBe('["1.97"]');
    expect(map.get("channel")).toBe("1.97");
    expect(map.get("msrv-source")).toBe("cargo-toml");
    expect(map.has("json")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/outputs.test.ts`
Expected: FAIL — `Cannot find module './outputs.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/outputs.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import type { MsrvSource } from "./manifest.ts";
import type { MatrixLeg } from "./matrix.ts";

/** One ordered step of the declarative install plan. */
export interface InstallStep {
  readonly step: "toolchain" | "profile" | "components" | "target";
  readonly argv: readonly string[];
}

/** Everything this action publishes. Declaration order is the key order. */
export interface ActionOutputs {
  readonly matrix: { readonly include: readonly MatrixLeg[] };
  readonly toolchains: readonly string[];
  readonly targets: readonly string[];
  readonly runners: readonly string[];
  readonly crates: readonly string[];
  readonly channel: string;
  readonly msrv: string;
  readonly "msrv-source": MsrvSource;
  readonly components: readonly string[];
  readonly profile: string;
  readonly "install-plan": readonly InstallStep[];
}

interface PlanInput {
  readonly profile?: string;
  readonly components: readonly string[];
  readonly hasTargets: boolean;
}

/**
 * Builds the ordered install plan.
 *
 * Ordered because installing the toolchain first and resolving the profile
 * second lets a `complete` profile degrade rather than abort the job.
 * `$TOOLCHAIN` and `$TARGET` are substituted by the consumer from the matrix
 * leg. THIS ACTION NEVER EXECUTES THE PLAN — it is data.
 */
export function buildInstallPlan(input: PlanInput): InstallStep[] {
  const plan: InstallStep[] = [
    {
      step: "toolchain",
      argv: ["rustup", "toolchain", "install", "$TOOLCHAIN"],
    },
  ];
  if (input.profile !== undefined) {
    plan.push({
      step: "profile",
      argv: ["rustup", "set", "profile", input.profile],
    });
  }
  if (input.components.length > 0) {
    plan.push({
      step: "components",
      argv: ["rustup", "component", "add", ...input.components],
    });
  }
  if (input.hasTargets) {
    plan.push({ step: "target", argv: ["rustup", "target", "add", "$TARGET"] });
  }
  return plan;
}

/** Flattens the outputs, serialising every non-scalar so `fromJSON` works. */
export function toOutputEntries(
  outputs: ActionOutputs,
): Array<[string, string]> {
  const entries: Array<[string, string]> = Object.entries(outputs).map(
    ([name, value]) => [
      name,
      typeof value === "string" ? value : JSON.stringify(value),
    ],
  );
  entries.push(["json", JSON.stringify(outputs)]);
  return entries;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/outputs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/outputs.ts src/outputs.test.ts
git commit -S -m "feat: emit outputs and a declarative install plan"
```

---

### Task 12: Orchestration

**Files:**

- Create: `src/action.ts`
- Test: `src/action.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 1–11.
- Produces: `run(deps: ActionDeps): void` — the only function that catches, ending in `setFailed(describeError(error))`.

Pipeline order, from the spec: discover, parse, expand, validate, toolchain axis, target axis, map runners, build, emit. Warnings are emitted for `profile = "complete"`, a nightly leg with non-default components, a dated non-nightly channel, an unmapped target, and an MSRV leg suppressed for equalling the pin.

- [ ] **Step 1: Write the failing test**

Create `src/action.test.ts`. Build a `recordingDeps()` helper returning an `ActionDeps` whose `core` pushes to arrays, and drive these cases:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";

import type { ActionDeps } from "./deps.ts";

import { run } from "./action.ts";

interface Recorded {
  readonly deps: ActionDeps;
  readonly outputs: Map<string, string>;
  readonly warnings: string[];
  readonly failures: string[];
}

function recordingDeps(files: Record<string, string>): Recorded {
  const outputs = new Map<string, string>();
  const warnings: string[] = [];
  const failures: string[] = [];
  const deps: ActionDeps = {
    core: {
      getInput: (name: string) => (name === "working-directory" ? "/p" : ""),
      setOutput: (name, value) => outputs.set(name, value),
      setFailed: (message) => failures.push(message),
      warning: (message) => warnings.push(message),
      info: () => undefined,
    },
    readFile: (path: string) => {
      const found = files[path];
      if (found === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }
      return found;
    },
    glob: () => [],
    cwd: "/p",
  };
  return { deps, outputs, warnings, failures };
}

describe("run", () => {
  it("adds the MSRV as its own leg", () => {
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\nrust-version = "1.88"\n',
      "/p/rust-toolchain.toml": '[toolchain]\nchannel = "1.97"\n',
    });
    run(r.deps);
    expect(r.failures).toEqual([]);
    expect(r.outputs.get("toolchains")).toBe('["1.97","1.88"]');
    expect(r.outputs.get("msrv")).toBe("1.88");
    expect(r.outputs.get("msrv-source")).toBe("cargo-toml");
  });

  it("falls back to stable with no toolchain file", () => {
    const r = recordingDeps({ "/p/Cargo.toml": '[package]\nname = "cli"\n' });
    run(r.deps);
    expect(r.outputs.get("channel")).toBe("stable");
  });

  it("fails when Cargo.toml is missing", () => {
    const r = recordingDeps({});
    run(r.deps);
    expect(r.failures[0]).toContain("Cargo.toml");
  });

  it("fails on a clippy msrv that disagrees", () => {
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\nrust-version = "1.88"\n',
      "/p/.clippy.toml": 'msrv = "1.90"\n',
    });
    run(r.deps);
    expect(r.failures[0]).toContain("must be equal");
  });

  it("fails on a toolchain below the MSRV", () => {
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\nrust-version = "1.88"\n',
      "/p/rust-toolchain.toml": '[toolchain]\nchannel = "1.85"\n',
    });
    run(r.deps);
    expect(r.failures[0]).toContain("below the declared MSRV");
  });

  it("fails on a path toolchain with no toolchain input", () => {
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\n',
      "/p/rust-toolchain.toml": '[toolchain]\npath = "/opt/rust"\n',
    });
    run(r.deps);
    expect(r.failures[0]).toContain("no channel to become a matrix leg");
  });

  it("warns about the complete profile", () => {
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\n',
      "/p/rust-toolchain.toml":
        '[toolchain]\nchannel = "1.97"\nprofile = "complete"\n',
    });
    run(r.deps);
    expect(r.warnings.join(" ")).toContain("complete");
  });

  it("suppresses a duplicate MSRV leg and says so", () => {
    const r = recordingDeps({
      "/p/Cargo.toml": '[package]\nname = "cli"\nrust-version = "1.97"\n',
      "/p/rust-toolchain.toml": '[toolchain]\nchannel = "1.97"\n',
    });
    run(r.deps);
    expect(r.outputs.get("toolchains")).toBe('["1.97"]');
    expect(r.warnings.join(" ")).toContain("MSRV");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/action.test.ts`
Expected: FAIL — `Cannot find module './action.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/action.ts`:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import type { ActionDeps } from "./deps.ts";
import type { MatrixLeg } from "./matrix.ts";

import { isDatedNonNightly, parseChannel } from "./channel.ts";
import { describeError } from "./errors.ts";
import { readOptions } from "./inputs.ts";
import { parseManifest } from "./manifest.ts";
import { MatrixBuilder } from "./matrix.ts";
import { assertClippyAgreement, assertToolchainMeetsMsrv } from "./msrv.ts";
import { buildInstallPlan, toOutputEntries } from "./outputs.ts";
import { resolveRunner } from "./runners.ts";
import { parseToolchainFile } from "./toolchain.ts";
import { expandWorkspace } from "./workspace.ts";

/** Components rustup's `default` profile does not ship. */
const NON_DEFAULT = ["llvm-tools", "rustc-dev", "miri", "rust-analyzer"];

function readOptional(deps: ActionDeps, path: string): string | undefined {
  try {
    return deps.readFile(path);
  } catch {
    return undefined;
  }
}

/**
 * Runs the whole pipeline.
 *
 * The only function that catches. Library modules throw; this turns a throw
 * into `setFailed`, and emits nothing at all on failure — a downstream job
 * reading an empty matrix is skipped silently, so a partial emit would be
 * worse than none.
 */
export function run(deps: ActionDeps): void {
  try {
    const options = readOptions(deps.core);
    const root = options.workingDirectory;

    // Cargo.toml is mandatory; letting its absence propagate IS the fatal.
    const manifest = parseManifest(deps.readFile(`${root}/Cargo.toml`));

    const rawToolchain = readOptional(deps, `${root}/rust-toolchain.toml`);
    const toolchainFile =
      rawToolchain === undefined
        ? { components: [], targets: [] }
        : parseToolchainFile(rawToolchain);

    if (toolchainFile.path !== undefined && options.toolchain === undefined) {
      throw new Error(
        "rust-toolchain.toml declares `path` and no `toolchain` input was " +
          "given: a local toolchain has no channel to become a matrix leg",
      );
    }

    const units = expandWorkspace({
      deps,
      root,
      manifest,
      mode: options.workspaceMode,
    });

    for (const unit of units) {
      assertClippyAgreement({
        directory: unit.directory,
        clippyMsrv: unit.clippyMsrv,
        manifestRustVersion: unit.rustVersion,
      });
    }

    const primary = units[0];
    const pin =
      options.toolchain ??
      toolchainFile.channel ??
      primary?.rustVersion ??
      "stable";
    const pinned = parseChannel(pin);

    if (toolchainFile.profile === "complete") {
      deps.core.warning(
        'profile = "complete" is documented as typically failing during ' +
          "installation",
      );
    }
    if (isDatedNonNightly(pinned)) {
      deps.core.warning(
        `channel "${pinned.raw}" is dated, which rustup documents only for ` +
          "nightly",
      );
    }

    const targets = [
      ...new Set([...options.targets, ...toolchainFile.targets]),
    ];
    for (const target of targets) {
      if (!resolveRunner(target, options.runnerMap).mapped) {
        deps.core.warning(
          `target "${target}" has no runner mapping; falling back to ` +
            "ubuntu-latest as an unverified cross-compile",
        );
      }
    }

    const legs: MatrixLeg[] = [];
    const toolchains: string[] = [];
    const crates: string[] = [];
    const perCrate = units.length > 1;

    for (const unit of units) {
      const msrv = unit.rustVersion;
      const forUnit = [pin];
      if (options.includeMsrv && msrv !== undefined) {
        if (msrv === pin) {
          deps.core.warning(
            `MSRV leg for ${unit.name} suppressed: it equals the pinned ` +
              `channel ${pin}`,
          );
        } else {
          forUnit.push(msrv);
        }
      }
      const all = [...forUnit, ...options.channels];
      for (const raw of all) {
        assertToolchainMeetsMsrv(parseChannel(raw), msrv);
      }

      const builder = new MatrixBuilder()
        .withToolchains(all)
        .withTargets(targets)
        .withRunnerOverrides(options.runnerMap);
      if (perCrate) {
        builder.withCrate(unit.name);
        crates.push(unit.name);
      }
      const built = builder.build();
      legs.push(...built.include);
      toolchains.push(...built.toolchains);
    }

    const entries = toOutputEntries({
      matrix: { include: legs },
      toolchains: [...new Set(toolchains)],
      targets,
      runners: [...new Set(legs.map((leg) => leg.os))],
      crates,
      channel: pin,
      msrv: primary?.rustVersion ?? "",
      "msrv-source": primary?.msrvSource ?? "none",
      components: toolchainFile.components,
      profile: toolchainFile.profile ?? "",
      "install-plan": buildInstallPlan({
        profile: toolchainFile.profile,
        components: toolchainFile.components,
        hasTargets: targets.length > 0,
      }),
    });
    for (const [name, value] of entries) {
      deps.core.setOutput(name, value);
    }

    const nonDefault = toolchainFile.components.filter((component) =>
      NON_DEFAULT.includes(component),
    );
    const hasNightly = toolchains.some(
      (raw) => parseChannel(raw).kind === "nightly",
    );
    if (nonDefault.length > 0 && hasNightly) {
      deps.core.warning(
        "nightly builds may be published without non-default components: " +
          nonDefault.join(", "),
      );
    }
  } catch (error) {
    deps.core.setFailed(describeError(error));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/action.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/action.ts src/action.test.ts
git commit -S -m "feat: orchestrate the parse-to-matrix pipeline"
```

---

### Task 13: Entry point, barrel, and action manifest

**Files:**

- Create: `src/index.ts` (currently an empty file — replace its contents)
- Create: `src/lib.ts`
- Create: `action.yml`
- Modify: `README.md` (generated — see Step 5)

**Interfaces:**

- Consumes: `run` (Task 12).
- Produces: the built `dist/index.js` bundle.

`src/index.ts` is wiring only and is never imported, which is what keeps it invisible to the coverage gate. It is the single file allowed to import `@actions/core`.

- [ ] **Step 1: Write the entry point**

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

//! Wiring only. This file constructs the real adapters and calls `run`. It is
//! never imported, so it is invisible to the coverage gate; code earns a place
//! here individually by being unmockable, not by proximity.

import { globSync, readFileSync } from "node:fs";

import * as core from "@actions/core";

import { run } from "./action.ts";

run({
  core: {
    getInput: (name) => core.getInput(name),
    setOutput: (name, value) => core.setOutput(name, value),
    setFailed: (message) => core.setFailed(message),
    warning: (message) => core.warning(message),
    info: (message) => core.info(message),
  },
  readFile: (path) => readFileSync(path, "utf8"),
  // `fs.globSync`, not `Bun.Glob`: the bundle is built with `--target node` and
  // runs under node24, where Bun's globals do not exist.
  glob: (pattern, cwd) => globSync(pattern, { cwd }),
  cwd: process.cwd(),
});
```

Create `src/lib.ts` as a barrel re-exporting every module except `index.ts`, using the package specifier (`@rust-toolchain-matrix/action`, not `./action.ts`) so it resolves identically for a consumer.

- [ ] **Step 2: Write `action.yml`**

Declare `name`, `description`, `author`, every input from Task 10 with its documented default and `required: false`, every output from Task 11, and:

```yaml
runs:
  using: "node24"
  main: "dist/index.js"
```

- [ ] **Step 3: Build and verify the bundle**

Run: `bun run build`
Expected: `dist/index.js` written.

Verify it does not reference Bun globals:

```bash
grep -c "Bun\." dist/index.js || echo "clean"
```

- [ ] **Step 4: Run the whole gate**

Run: `mise run ci`
Expected: `hk`, typecheck, coverage, and build all pass. Coverage must be 100% on lines, functions, and statements.

- [ ] **Step 5: Generate the README and commit**

```bash
mise run readme
git add src/index.ts src/lib.ts action.yml dist/index.js README.md
git commit -S -m "feat: add action entry point and manifest"
```

> `README.md` is generated from `action.yml` by `action-docs`. Never hand-edit
> the generated block. `dist/index.js` is committed on purpose and CI fails on
> `git diff --exit-code dist/`.

---

### Task 14: Fixture amendments and golden tests

**Files:**

- Modify: `fixtures/cli-msrv/.clippy.toml`
- Create: `fixtures/workspace-lib-msrv/crates/channel/.clippy.toml`
- Create: `fixtures/workspace-lib-msrv/crates/strict/.clippy.toml`
- Create: `src/golden.test.ts`

**Interfaces:**

- Consumes: `run` (Task 12).
- Produces: nothing; this task is the end-to-end proof.
- [ ] **Step 1: Amend the fixtures**

Add `msrv = "1.88"` to `fixtures/cli-msrv/.clippy.toml`, matching its `Cargo.toml`. Create `fixtures/workspace-lib-msrv/crates/channel/.clippy.toml` with `msrv = "1.88"` and `.../crates/strict/.clippy.toml` with `msrv = "1.92"`, each matching its own manifest — the rule is per directory, so the root file alone cannot exercise it. Each new file needs the SPDX header in `#` comment syntax. Leave `cli` and `workspace-lib` without the key; they are the nothing-to-validate case.

- [ ] **Step 2: Write the failing golden test**

Create `src/golden.test.ts` driving `run` against the four real fixtures through real `node:fs` adapters, asserting the cardinalities the spec fixes:

```ts
// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, it } from "bun:test";
import { globSync, readFileSync } from "node:fs";

import type { ActionDeps } from "./deps.ts";

import { run } from "./action.ts";

function fixtureDeps(
  fixture: string,
  inputs: Record<string, string>,
): { deps: ActionDeps; outputs: Map<string, string>; failures: string[] } {
  const outputs = new Map<string, string>();
  const failures: string[] = [];
  const values = { "working-directory": `fixtures/${fixture}`, ...inputs };
  return {
    outputs,
    failures,
    deps: {
      core: {
        getInput: (name) => values[name] ?? "",
        setOutput: (name, value) => outputs.set(name, value),
        setFailed: (message) => failures.push(message),
        warning: () => undefined,
        info: () => undefined,
      },
      readFile: (path) => readFileSync(path, "utf8"),
      glob: (pattern, cwd) => globSync(pattern, { cwd }),
      cwd: process.cwd(),
    },
  };
}

function legCount(outputs: Map<string, string>): number {
  const raw = outputs.get("matrix");
  if (raw === undefined) {
    throw new Error("matrix output missing");
  }
  const parsed: unknown = JSON.parse(raw);
  const include = (parsed as { include: unknown[] }).include;
  return include.length;
}

describe("golden fixtures", () => {
  it("cli has no MSRV and one toolchain", () => {
    const g = fixtureDeps("cli", {});
    run(g.deps);
    expect(g.failures).toEqual([]);
    expect(g.outputs.get("msrv-source")).toBe("none");
    expect(g.outputs.get("toolchains")).toBe('["1.97"]');
  });

  it("cli-msrv adds the MSRV leg", () => {
    const g = fixtureDeps("cli-msrv", {});
    run(g.deps);
    expect(g.outputs.get("toolchains")).toBe('["1.97","1.88"]');
    expect(legCount(g.outputs)).toBe(8);
  });

  it("workspace-lib-msrv resolves 8 legs in root mode", () => {
    const g = fixtureDeps("workspace-lib-msrv", { "workspace-mode": "root" });
    run(g.deps);
    expect(g.failures).toEqual([]);
    expect(g.outputs.get("msrv")).toBe("1.88");
    expect(legCount(g.outputs)).toBe(8);
  });

  it("workspace-lib-msrv aggregates to the maximum member MSRV", () => {
    const g = fixtureDeps("workspace-lib-msrv", {
      "workspace-mode": "aggregate",
    });
    run(g.deps);
    expect(g.outputs.get("msrv")).toBe("1.92");
    expect(legCount(g.outputs)).toBe(8);
  });

  it("workspace-lib has nothing to validate", () => {
    const g = fixtureDeps("workspace-lib", { "workspace-mode": "root" });
    run(g.deps);
    expect(g.failures).toEqual([]);
    expect(g.outputs.get("msrv-source")).toBe("none");
  });
});
```

- [ ] **Step 3: Run the golden test**

Run: `bun test src/golden.test.ts`
Expected: PASS. If `cli-msrv` reports 8 legs but the fixture declares four targets and two toolchains, that is the expected 2 x 4. A mismatch means an axis is being multiplied where it should not be — re-read Task 9 before adjusting the assertion.

- [ ] **Step 4: Run the whole gate**

Run: `mise run ci`
Expected: everything passes, coverage at 100%.

- [ ] **Step 5: Commit**

```bash
git add fixtures src/golden.test.ts
git commit -S -m "test: add golden fixtures for matrix generation"
```

> `per-crate` mode against `workspace-lib-msrv` should yield 20 legs
> (`channel` 2 toolchains + `version` 1 + `strict` 2, each times 4 targets).
> Task 9's `MatrixBuilder` builds one crate at a time, so orchestrating the
> per-crate merge across units is the one piece Task 12 must get right; add that
> assertion here once it passes rather than weakening it.
