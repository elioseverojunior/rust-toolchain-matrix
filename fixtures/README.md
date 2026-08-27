<!--
SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors

SPDX-License-Identifier: MIT OR Apache-2.0
-->

# Fixtures

Four real Cargo projects used as parse targets. Each one builds, passes
`cargo clippy --all-targets` under `pedantic` + `nursery` with `-D warnings`, and
answers `cargo metadata` — so the action can be exercised against them exactly as
it would be against a user's checkout.

The corpus is a 2x2 over the two axes that change how MSRV resolves.

| Fixture              | Layout               | `rust-version`                  | Proves                                     |
| -------------------- | -------------------- | ------------------------------- | ------------------------------------------ |
| `cli`                | single package       | absent                          | resolution falls through to the channel    |
| `cli-msrv`           | single package       | `1.88` on `[package]`           | a direct declaration wins outright         |
| `workspace-lib`      | workspace, 2 members | absent everywhere               | a whole tree can legitimately have no MSRV |
| `workspace-lib-msrv` | workspace, 3 members | `1.88` on `[workspace.package]` | all three inheritance shapes at once       |

## The three inheritance shapes

`workspace-lib-msrv` exists to pin down the subtle cases. Its members are named
for what they demonstrate, not for what they contain:

- `crates/channel` — `rust-version.workspace = true`. This parses to the **object**
  `{ workspace: true }`, not a string. A parser expecting a string reads no MSRV
  and silently reports none.
- `crates/version` — omits `rust-version` entirely. Inheritance is **opt-in**, so
  this member gets nothing even though `[workspace.package]` declares `1.88` in
  the same file. Only the explicit `workspace = true` opts in.
- `crates/strict` — declares `1.92` directly, above the workspace floor. The
  effective MSRV for the tree is the **maximum across the graph**, not the
  workspace value.

Confirmed against Cargo itself:

```console
$ cd workspace-lib-msrv && cargo metadata --format-version 1 --no-deps
channel  rust_version = "1.88"    # inherited
strict   rust_version = "1.92"    # local override, and the tree's effective MSRV
version  rust_version = null      # opted out by omission
```

## Channel versus MSRV

Every fixture pins `channel = "1.97"` in `rust-toolchain.toml` while the ones that
declare an MSRV sit at `1.88`. The gap is deliberate and must not be "fixed":
`rust-version` is a floor (the oldest rustc a consumer needs) and
`rust-toolchain.toml` is a pin (the toolchain this project develops against).

## Sample code

The samples are dependency-free and on-theme, so the fixtures build offline and
stay fast. `channel` parses toolchain channel strings; `version` compares versions
numerically — the rule that keeps `1.9` below `1.10`, which string ordering gets
backwards.

`target/` is gitignored. Building here is safe.
