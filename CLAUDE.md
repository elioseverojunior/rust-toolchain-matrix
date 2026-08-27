<!--
SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors

SPDX-License-Identifier: MIT OR Apache-2.0
-->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## What this action does

A GitHub Action that parses a checked-out Rust repo's `rust-toolchain.toml` and
`Cargo.toml` and emits GitHub Actions matrix strategies.

Outputs are emitted **both** ways: a combined `matrix` object for
`strategy.matrix: ${{ fromJSON(...) }}`, plus the individual axis arrays for
callers who compose their own matrix block. List-valued outputs are
`JSON.stringify`'d so `fromJSON` works on them.

Current state: greenfield. `src/index.ts` is empty, and there is no `action.yml`,
`README.md`, or workflow yet. `fixtures/` holds the Rust test corpus.

### Resolution precedence

Channel resolves as: action input, then `rust-toolchain.toml` `[toolchain]
channel`, then `Cargo.toml` `rust-version`, then `"stable"`.

MSRV deliberately sits **below** the toml. `rust-version` is a floor (the oldest
rustc a consumer needs); `rust-toolchain.toml` is a pin (the dev toolchain).
`fixtures/cli-msrv` demonstrates the gap on purpose — channel `1.97` against
`rust-version = "1.88"`. Never "sync" the two.

`targets` and `components`: inputs lead, then toml values, deduped by first
occurrence. Order matters because `targets[0]` is published as a scalar output.

Workspace handling supports three modes — root-manifest-only, per-crate
expansion, and aggregate-across-members — selected by action input.

### Cargo.toml parsing traps

- `rust-version.workspace = true` parses to the **object** `{ workspace: true }`,
  not a string.
- Inheritance is opt-in. A `[package]` that merely omits `rust-version` gets no
  MSRV even when `[workspace.package]` declares one in the same file.
- Compare versions numerically, field by field. Never lexically — `"1.9"` sorts
  above `"1.10"` as a string.
- Malformed TOML throws. Do not silently fall back; a syntax error hides intent.
- The true MSRV is the **maximum** `rust-version` across the resolved dependency
  graph (`cargo metadata --locked`), not the root manifest's value.

## Architecture

- Library modules **never** import `@actions/core`. Dependencies arrive through a
  structural `ActionDeps` interface listing exactly the functions used.
- `src/index.ts` is wiring only — the single place that constructs real adapters
  (`spawnSync`, `readFileSync`, `@actions/cache`, `fetch`). It is never imported,
  so it is invisible to the coverage gate. Code earns a place there individually
  by being unmockable, not by proximity.
- Because of the above there are **no `mock()` or `spyOn()` calls**. Tests pass
  plain fakes.
- Library functions `throw`. Only the top-level entry functions catch, ending in
  `setFailed(describeError(error))` — `catch` binds `unknown`, and boundaries can
  reject non-`Error` values.
- `src/lib.ts` is the barrel and re-exports using the package specifier
  (`@rust-project-parser/...`), not relative paths, so it resolves identically for
  a consumer. It excludes `src/index.ts`.

## Commands

- `mise run ci` — the one command that reproduces CI (hk, typecheck, coverage,
  build).
- `mise run hk` — `hk check --all`, exactly the CI Lint job.
- `mise run mutate` — Stryker. Runs under **Node, not Bun**; `bunx --bun stryker`
  fails in Babel. The config path is a positional argument.
- `bun run typecheck` is `tsc --build` (project references), not `--noEmit`.
- `mise run readme` regenerates `README.md` from `action.yml`. Do not hand-edit
  the generated block.
- `mise run act` runs workflows locally; it writes `.act/.secrets` from
  `gh auth token`.

`--no-deps` is **mandatory** on any nested `mise run` inside an hk step.
`[deps.bun] auto = true` runs `bun install` before every `mise run`, hk runs steps
concurrently, and the installs race. The failure is a bare
`bun exited with non-zero status: exit code 1` with no linter output, on a
different step each attempt.

## Testing

- `bun test` measures coverage **by default** and enforces 100% lines, functions,
  and statements. A new production file without tests fails the suite. Bun has no
  `branches` metric.
- Tests are co-located as `src/**/*.test.ts` using `bun:test`. There is no
  `tests/` directory.
- Stryker needs its own `stryker-bunfig.toml` with `coverage = false`. It judges a
  mutant by exit code, and the 100% threshold makes instrumented runs exit
  non-zero even when every test passes, so every mutant would falsely report as
  killed. `BUN_CONFIG_COVERAGE=false` is ignored; a separate `--config` is the
  only lever.
- Mutation testing is a report, not a gate.

## Code style

These differ from stock TypeScript and ESLint defaults:

- Every project ESLint rule is `error`, never `warn` — lint runs with
  `--max-warnings 0`, so there is no gray zone.
- `@typescript-eslint/explicit-function-return-type` is on. Annotate every
  function's return type.
- `@typescript-eslint/no-explicit-any` is an error, not a warning.
- `verbatimModuleSyntax` — type-only imports must be written `import type`.
- `noUncheckedIndexedAccess` — every index access is `T | undefined`.
- `import-x/order` groups: builtin, external, internal, parent, sibling/index,
  with blank lines between and alphabetized within. `bun:*` is pinned to
  **external** because the resolver classifies it inconsistently across
  platforms.
- Prettier: double quotes, `printWidth` 80, `trailingComma: "all"`.
- Aliases: `@rust-project-parser/*` in `src/`, `@/*` confined to tests. `paths` is
  duplicated into the root `tsconfig.json` because Bun reads `paths` from the
  nearest `tsconfig.json` and does not follow `references`.
- `**/*.ts` globs do not match `**/*.tsx`.

## Repo etiquette

- Every new file needs a two-line SPDX header in its comment syntax:
  `SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors` and
  `SPDX-License-Identifier: MIT OR Apache-2.0`. `comply annotate` has no ignore
  mechanism and re-adds headers on every run, so removing them by hand is not a
  stable state.
- Conventional commits, enforced at `commit-msg`. The `type-enum` adds a
  non-standard `init` type. GitVersion derives the version bump from the same
  prefixes.
- `dist/index.js` is **committed**. CI fails on `git diff --exit-code dist/`.
  Run `bun run build` and commit the result; never hand-edit it.
- Every `uses:` pins a full commit SHA with a trailing `# vX.Y.Z`, refreshed with
  `mise run uapw`. This intentionally overrides the global "prefer the loosest
  tag" rule.
- gitleaks must be passed `--config .gitleaks.toml` explicitly; it does not read
  `.gitignore` and walks the whole working directory otherwise.

## Known rough edge

`fixtures/**/target/` is in neither `.prettierignore` nor `.gitignore`. Running
`cargo build` in a fixture leaves JSON artifacts that break
`bun run prettier:format`, and `git add -A` would commit them.
