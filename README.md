<!--
SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors

SPDX-License-Identifier: MIT OR Apache-2.0
-->

<!-- action-docs-header source="action.yml" -->

<!-- action-docs-header source="action.yml" -->

<!-- action-docs-description source="action.yml" -->

## Description

Parses Cargo.toml, rust-toolchain.toml, and .clippy.toml into a GitHub Actions matrix strategy for downstream Rust CI jobs.
<!-- action-docs-description source="action.yml" -->

<!-- action-docs-inputs source="action.yml" -->

## Inputs

| name                | description                                                                                                                | required | default |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------- | ------- |
| `working-directory` | <p>Where to look for Cargo.toml, rust-toolchain.toml, and .clippy.toml.</p>                                                | `false`  | `.`     |
| `toolchain`         | <p>Overrides the resolved channel; highest precedence, above rust-toolchain.toml and the MSRV.</p>                         | `false`  | `""`    |
| `channels`          | <p>Extra toolchain legs to add to the matrix, e.g. beta, nightly. Comma, space, or newline separated.</p>                  | `false`  | `""`    |
| `targets`           | <p>Extra target triples, merged ahead of the ones declared in rust-toolchain.toml. Comma, space, or newline separated.</p> | `false`  | `""`    |
| `runner-map`        | <p>JSON object overriding or extending the target-triple-to-runner table.</p>                                              | `false`  | `""`    |
| `workspace-mode`    | <p>How to expand a Cargo workspace into matrix units: root, per-crate, or aggregate.</p>                                   | `false`  | `root`  |
| `include-msrv`      | <p>Whether the MSRV becomes its own matrix leg.</p>                                                                        | `false`  | `true`  |

<!-- action-docs-inputs source="action.yml" -->

<!-- action-docs-outputs source="action.yml" -->

## Outputs

| name           | description                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| `matrix`       | <p>The GitHub Actions matrix, shaped {"include": [{toolchain, target, os, can-run, crate?}, …]}.</p>           |
| `toolchains`   | <p>JSON array of every toolchain in the matrix, for callers composing their own matrix.</p>                    |
| `targets`      | <p>JSON array of every target in the matrix.</p>                                                               |
| `runners`      | <p>JSON array of every runner OS used by the matrix.</p>                                                       |
| `crates`       | <p>JSON array of crate names; populated only in per-crate workspace mode.</p>                                  |
| `channel`      | <p>The resolved channel.</p>                                                                                   |
| `msrv`         | <p>The resolved minimum supported Rust version.</p>                                                            |
| `msrv-source`  | <p>Where the MSRV came from: cargo-toml, workspace-inherit, or none.</p>                                       |
| `components`   | <p>JSON array of rustup components declared in rust-toolchain.toml. Host-level, constant across every leg.</p> |
| `profile`      | <p>The rustup profile declared in rust-toolchain.toml.</p>                                                     |
| `install-plan` | <p>Ordered JSON array of rustup install steps -- data, not execution.</p>                                      |
| `json`         | <p>The whole output object, as JSON.</p>                                                                       |

<!-- action-docs-outputs source="action.yml" -->

<!-- action-docs-runs source="action.yml" -->

## Runs

This action is a `node24` action.
<!-- action-docs-runs source="action.yml" -->
