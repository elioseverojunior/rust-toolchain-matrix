<!--
SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors

SPDX-License-Identifier: MIT OR Apache-2.0
-->

# rust-project-parser — Design

A GitHub Action that reads a Rust project's `Cargo.toml`, `rust-toolchain.toml`,
and `.clippy.toml`, and emits GitHub Actions matrix strategies for downstream
jobs.

## Purpose

Rust CI matrices are written by hand and drift from the project they test. The
pinned toolchain lives in `rust-toolchain.toml`, the support floor lives in
`Cargo.toml`, and the workflow repeats both as literals. This action derives the
matrix from those files so the two cannot disagree.

## Scope

In scope:

- Parsing `Cargo.toml`, `rust-toolchain.toml`, and `.clippy.toml`.
- Resolving a toolchain axis, a target axis, and a runner per target.
- Validating consistency between the three files.
- Emitting a matrix plus the individual axes.

Explicitly out of scope:

- **Installing anything.** The action parses and emits. The `install-plan`
  output is declarative data describing what a consumer _should_ run; the action
  never executes it.
- Transitive dependency MSRV. Only the repository's own declared `rust-version`
  is considered — no `cargo metadata`, no dependency graph walk.
- Invoking `cargo` or `rustup` in any form. The action runs on a bare
  `actions/checkout` with no Rust toolchain present.

## Decisions

| #   | Decision                                                         | Rationale                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Pure TOML parsing via `smol-toml`; never shell out to `cargo`    | The action must run as the first step of a workflow, before any toolchain exists. Shelling out to `cargo` to discover which Rust versions to install is circular. Also keeps the 100% coverage gate reachable without mocking a subprocess. |
| D2  | Repository's own MSRV only                                       | Deliberate scope limit. Transitive MSRV requires the resolved graph, which requires `cargo`, which D1 rules out.                                                                                                                            |
| D3  | Emit both a combined `matrix` and individual axis arrays         | Callers who want the whole matrix use `fromJSON(matrix)`; callers composing their own use the axes.                                                                                                                                         |
| D4  | `os` is derived from the target triple, with an input override   | Nothing in either TOML file declares a runner, but the mapping is mechanical. The override handles self-hosted fleets and unusual triples.                                                                                                  |
| D5  | Matrix shape is an `include` list, not named axes plus `exclude` | Because `os` is a _function_ of `target`, a cross product would generate impossible pairs. An exclusion list grows faster than the matrix and is where bugs would live.                                                                     |
| D6  | Every leg carries `can-run`                                      | `rustup target add` installs `rust-std`, not a linker or an emulator. A `wasm32` leg can `cargo build` but not `cargo test`. Encoding this prevents matrices whose legs fail by construction.                                               |
| D7  | The MSRV becomes an automatic matrix leg                         | Testing the pinned toolchain and separately proving the support floor still compiles is the pattern real Rust CI wants. Opt out via `include-msrv: false`.                                                                                  |
| D8  | Prefer the _native_ runner for every target                      | Native runners need no cross-linker. GitHub's current fleet has native runners for arm64 Linux, arm64 Windows, and both macOS architectures, which removes most cross-compilation.                                                          |

## Input contract

Three files are read from `working-directory`.

| File                  | Role                                                    | If absent                                 |
| --------------------- | ------------------------------------------------------- | ----------------------------------------- |
| `Cargo.toml`          | MSRV source and workspace topology                      | **Fatal.** There is no Rust project here. |
| `rust-toolchain.toml` | Channel pin, `targets`, `components`, `profile`         | Channel falls back to `stable`            |
| `.clippy.toml`        | Optional `msrv`, validated against its sibling manifest | Nothing to validate                       |

Action inputs, kebab-case:

| Input               | Default | Effect                                                  |
| ------------------- | ------- | ------------------------------------------------------- |
| `working-directory` | `.`     | Where to look for the three files                       |
| `toolchain`         | —       | Overrides the channel; highest precedence               |
| `channels`          | —       | Extra legs, e.g. `beta`, `nightly`                      |
| `targets`           | —       | Extra targets, merged ahead of the file's               |
| `runner-map`        | —       | JSON overriding or extending the triple-to-runner table |
| `workspace-mode`    | `root`  | `root` \| `per-crate` \| `aggregate`                    |
| `include-msrv`      | `true`  | Whether the MSRV becomes its own leg                    |

## Output contract

| Output                                       | Shape                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `matrix`                                     | `{"include": [{toolchain, target, os, can-run, crate?}, …]}`          |
| `toolchains`, `targets`, `runners`, `crates` | JSON arrays, for callers composing their own matrix                   |
| `channel`                                    | The resolved channel                                                  |
| `msrv`, `msrv-source`                        | Version and provenance: `cargo-toml` \| `workspace-inherit` \| `none` |
| `components`, `profile`                      | Host-level, constant across every leg                                 |
| `install-plan`                               | Ordered array of rustup steps — data, not execution                   |
| `json`                                       | The whole object                                                      |

List-valued outputs are `JSON.stringify`'d so `fromJSON` works on them.

### Why `components` is not per-leg

`rust-std` carries a target-tuple suffix (`rust-std-x86_64-pc-windows-msvc`) and
is installed by `rustup target add`. Everything else a project normally lists —
`rustfmt`, `clippy`, `rust-analyzer`, `llvm-tools`, `rustc-dev` — is host-only
and identical on every leg. Multiplying `components` across the matrix would be
wrong, not merely wasteful.

### The `install-plan` output

Ordered, because installing a toolchain and then resolving its profile lets a
`complete` profile degrade rather than abort the job. `$TOOLCHAIN` and `$TARGET`
are substituted by the consumer from the matrix leg; steps that do not apply are
omitted.

```json
[
  {
    "step": "toolchain",
    "argv": ["rustup", "toolchain", "install", "$TOOLCHAIN"]
  },
  { "step": "profile", "argv": ["rustup", "set", "profile", "default"] },
  {
    "step": "components",
    "argv": ["rustup", "component", "add", "rustfmt", "clippy"]
  },
  { "step": "target", "argv": ["rustup", "target", "add", "$TARGET"] }
]
```

## Resolution rules

### Channel grammar

Parsed per the rustup specification:

```text
<channel>[-<date>][-<host>]

<channel>    = stable|beta|nightly|<versioned>[-<prerelease>]
<versioned>  = <major.minor>|<major.minor.patch>
<prerelease> = beta[.<number>]
<date>       = YYYY-MM-DD
<host>       = <target-tuple>
```

Parsing is permissive and follows the grammar. Validation is where practice
narrows it: rustup documents dated variants only for `nightly`, so a dated
`stable` or `beta` earns a warning rather than a rejection.

### Toolchain precedence

Input `toolchain`, then `rust-toolchain.toml` `channel`, then the MSRV, then
`stable`. The MSRV sits _below_ the toolchain file deliberately: `rust-version`
is a floor and `rust-toolchain.toml` is a pin, and conflating them is a known
defect class — it publishes a support floor the code never actually required.

After precedence resolves the primary channel, the MSRV is appended as an extra
leg when it exists and differs from the pin, followed by any `channels` extras.

### MSRV rules

1. `Cargo.toml` is mandatory; absent is fatal.
2. A present `rust-version` is the minimum supported version.
3. Every **concrete** toolchain in the matrix must be `>= MSRV`. Lower is fatal.
4. Rolling channels (`stable`, `beta`, `nightly`) are not numerically comparable
   and are always valid, being by definition at or above any floor.
5. A `.clippy.toml` `msrv`, where present, must **equal** the `rust-version` in
   its sibling `Cargo.toml`. Divergence is fatal. The check is per directory,
   mirroring how clippy itself resolves the file.
6. With no `rust-version`, there is nothing to validate.

Rule 3 applies to every leg, not only to the channel in the toolchain file. An
input of `toolchain: "1.85"` against an MSRV of `1.88` is therefore fatal: it
asks the project to build below its own declared floor.

Rules 3 and 5 together preserve the floor-versus-pin decoupling. A project may
declare `rust-version = "1.88"` while pinning `channel = "1.97"` — the values
differ, and both rules still hold.

### Version comparison

Numeric, field by field, with any pre-release or build suffix dropped.
Never lexical: `"1.9"` sorts above `"1.10"` as a string, which silently selects
the wrong MSRV. Unparseable versions are skipped rather than fatal.

### Cargo manifest shapes

Three shapes, and the third is the subtle one:

1. `[package] rust-version = "1.88"` — wins outright.
2. Virtual manifest with `[workspace.package] rust-version` — source is
   `workspace-inherit`.
3. A member with `rust-version.workspace = true` — this parses to the **object**
   `{ workspace: true }`, not a string. A parser expecting a string here reads no
   MSRV and reports none.

Inheritance is opt-in. A `[package]` that merely omits `rust-version` inherits
nothing, even when `[workspace.package]` declares one in the same workspace.

### Workspace modes

| Mode        | MSRV used                     | Legs                                          |
| ----------- | ----------------------------- | --------------------------------------------- |
| `root`      | The root manifest's own value | One set for the whole tree                    |
| `aggregate` | The maximum across members    | One set for the whole tree                    |
| `per-crate` | Each member's own             | One set per member, each leg carrying `crate` |

Per the Rule of Three, the three modes begin as three pure functions in one
module. A `WorkspaceResolver` interface is extracted only once a third
implementation demonstrably diverges; abstracting earlier is guesswork.

### Target-to-runner mapping

| Target triple               | Runner             | Native |
| --------------------------- | ------------------ | ------ |
| `x86_64-unknown-linux-gnu`  | `ubuntu-latest`    | yes    |
| `aarch64-unknown-linux-gnu` | `ubuntu-24.04-arm` | yes    |
| `x86_64-apple-darwin`       | `macos-15-intel`   | yes    |
| `aarch64-apple-darwin`      | `macos-latest`     | yes    |
| `x86_64-pc-windows-msvc`    | `windows-latest`   | yes    |
| `aarch64-pc-windows-msvc`   | `windows-11-arm`   | yes    |
| `wasm32-*`                  | `ubuntu-latest`    | no     |

`macos-latest` is ARM64 today, so `x86_64-apple-darwin` maps to `macos-15-intel`
rather than `macos-latest`. Mapping an x86_64 target onto an ARM runner would
turn a native build into an unrequested cross-compile.

`can-run` is `true` when the target matches the runner's native triple. An
unmapped target falls back to `ubuntu-latest` with `can-run: false` and a
warning, because it is an unverified cross-compile with no guaranteed linker.

## Architecture

A functional core with an imperative shell. All I/O enters through a structural
`ActionDeps` (`core`, `readFile`, `glob`, `cwd`) constructed only in
`src/index.ts`. No library module imports `@actions/core`.

| Module         | Single responsibility                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `index.ts`     | Wiring only. Builds real adapters, calls `run(deps)`. Never imported, so invisible to the coverage gate |
| `action.ts`    | Orchestrates the pipeline; the only place that catches                                                  |
| `inputs.ts`    | Reads and validates inputs through a narrow `InputReader`                                               |
| `channel.ts`   | The rustup channel grammar                                                                              |
| `toolchain.ts` | `rust-toolchain.toml` to `ToolchainFile`; enforces `channel` xor `path` and the profile enum            |
| `manifest.ts`  | `Cargo.toml` to `Manifest`; detects package, workspace, and the object form of `rust-version.workspace` |
| `clippy.ts`    | `.clippy.toml` to an optional `msrv`                                                                    |
| `workspace.ts` | The three modes as pure functions; glob expansion, `exclude`, `default-members`                         |
| `msrv.ts`      | MSRV extraction, numeric comparison, and the consistency rules                                          |
| `runners.ts`   | Triple-to-runner table and `can-run` derivation                                                         |
| `matrix.ts`    | `MatrixBuilder`, fluent, producing the `include` list and axes                                          |
| `outputs.ts`   | Typed `ActionOutputs` to `[name, value][]`                                                              |
| `errors.ts`    | `describeError(unknown)`                                                                                |
| `lib.ts`       | Barrel, re-exporting via the package specifier                                                          |

`MatrixBuilder` is the only fluent surface. The rest of the pipeline is data
transformation, where builders would add ceremony without adding clarity.

## Data flow

```text
discover → parse → expand → validate → toolchain axis → target axis
        → map runners → build → emit
```

Only `discover` touches I/O. Every later stage is a pure function over explicit
types, which is what makes the coverage gate reachable with fakes instead of
mocks.

Worked example — `workspace-lib-msrv`, which pins `1.97`, declares four targets,
sets a workspace MSRV of `1.88`, and has three members: `channel`
(`workspace = true`, so `1.88`), `version` (omits, so none), and `strict`
(`1.92`).

| Mode        | MSRV       | Toolchain axis                                                        | Legs |
| ----------- | ---------- | --------------------------------------------------------------------- | ---- |
| `root`      | `1.88`     | `1.97`, `1.88`                                                        | 8    |
| `aggregate` | `1.92`     | `1.97`, `1.92`                                                        | 8    |
| `per-crate` | per member | `channel`: 1.97 + 1.88 · `version`: 1.97 only · `strict`: 1.97 + 1.92 | 20   |

In `per-crate` the `version` member gets only the pin leg, because it opted out
of inheritance. The parsing trap surfaces as an observable difference in the
matrix rather than as an internal detail.

A single leg:

```json
{
  "toolchain": "1.88",
  "target": "x86_64-apple-darwin",
  "os": "macos-15-intel",
  "can-run": true,
  "crate": "channel"
}
```

## Error handling

Library functions throw. Only `run()` catches, ending in
`setFailed(describeError(error))` — `catch` binds `unknown` in TypeScript, and
boundaries such as `smol-toml`, `JSON.parse`, and `fs` may reject with a
non-`Error`. Every thrown error carries `{ cause }`.

Output is all-or-nothing. This matters because a downstream job reading an empty
`matrix` is **skipped silently** rather than failed, and a green workflow that
ran nothing is the worst available outcome.

### Fatal

| Condition                                                         | Reason                                           |
| ----------------------------------------------------------------- | ------------------------------------------------ |
| `Cargo.toml` absent                                               | No Rust project in the directory                 |
| Malformed TOML in any of the three files                          | A syntax error hides intent; never degrade       |
| `channel` and `path` both set                                     | rustup declares them mutually exclusive          |
| `path` set with no `toolchain` input                              | A local toolchain has no channel to become a leg |
| `profile` outside `minimal` \| `default` \| `complete`            | Closed set                                       |
| `.clippy.toml` `msrv` unequal to its sibling `rust-version`       | Divergence is a defect                           |
| A concrete toolchain below the MSRV                               | Building beneath the declared floor              |
| Invalid `workspace-mode`; `runner-map` not valid JSON             | Malformed input                                  |
| Target or component name failing `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` | Values arrive from an untrusted checkout         |
| `members` declared but expanding to zero crates                   | A glob matching nothing is a mistake             |
| An empty matrix                                                   | The downstream job would be skipped silently     |

The MSRV divergence message names **both file paths and both values**, because
the reader needs to know which file to change, not merely that two disagree.

### Warning

| Condition                                    | Reason                                              |
| -------------------------------------------- | --------------------------------------------------- |
| `profile = "complete"`                       | Documented as typically failing during installation |
| A `nightly` leg with non-default components  | Nightly builds may ship without them                |
| A dated channel other than `nightly`         | The grammar allows it; rustup practice does not     |
| A target with no runner mapping              | Unverified cross-compile, no guaranteed linker      |
| An MSRV leg suppressed for equalling the pin | Informational                                       |

### Style

The project rule against `.unwrap()` on external input has a direct analogue
here: no non-null assertions on data read from a file. `noUncheckedIndexedAccess`
already makes every indexed access `T | undefined`, which forces the handling.

## Testing strategy

Test-driven: a failing test first, then the minimum code to pass, then refactor.
The 100% threshold for lines, functions, and statements is enforced by
`bunfig.toml`, so a production file without tests breaks the suite.

There are no mocks. That follows from the architecture rather than from
discipline: with a pure core and I/O injected through `ActionDeps`, tests pass
plain fakes.

| Layer    | Target            | Form                                                                                                                                      |
| -------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Grammar  | `channel.ts`      | Table-driven over the rustup productions: `stable`, `1.88`, `1.88.0`, `1.88.0-beta.1`, `nightly-2026-08-03`, `stable-x86_64-apple-darwin` |
| Ordering | `msrv.ts`         | The case that matters: `1.9 < 1.10`, which lexical comparison gets backwards                                                              |
| Unit     | remaining modules | Fakes for `readFile` and `glob`; TOML as string literals                                                                                  |
| Golden   | whole pipeline    | The four fixtures on disk against expected matrix JSON                                                                                    |

Fixtures cover the happy paths and workspace shapes. **Error paths are unit
tests over literal TOML strings**, not new projects on disk — the rules are pure
and testable from two strings, so no fifth fixture is warranted.

Golden tests anchor the cardinalities above: 8 legs in `root`, 8 in `aggregate`
at MSRV `1.92`, and 20 in `per-crate`. Breaking opt-in inheritance changes the
`per-crate` golden and the test names the regression.

Mutation testing via `mise run mutate`, scoped to the decision-dense modules:
`channel.ts`, `msrv.ts`, `workspace.ts`, `matrix.ts`, `runners.ts`. A report, not
a gate.

## Fixture amendments

The `.clippy.toml` consistency rule requires restoring a key that was previously
removed from the fixtures:

- `cli-msrv/.clippy.toml` — restore `msrv = "1.88"`, matching its `Cargo.toml`.
- `workspace-lib-msrv/crates/*/.clippy.toml` — add per crate, each matching its
  own manifest: `channel` at `1.88`, `strict` at `1.92`. The rule is per
  directory, so the root file alone cannot exercise it.
- `cli` and `workspace-lib` — leave without the key; they are the
  nothing-to-validate case.

Each fixture keeps `channel = "1.97"` against an MSRV of `1.88`, which the MSRV
rules accept and which preserves the documented floor-versus-pin decoupling.
