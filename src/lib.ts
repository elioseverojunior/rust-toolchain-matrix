// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

//! The public barrel. Re-exports every library module except `index.ts`
//! (wiring, never imported) using this package's own path alias, so the
//! specifier a consumer writes (`@rust-project-parser/...`) resolves
//! identically to how library source resolves it internally.

export * from "@rust-project-parser/action";
export * from "@rust-project-parser/channel";
export * from "@rust-project-parser/clippy";
export * from "@rust-project-parser/deps";
export * from "@rust-project-parser/errors";
export * from "@rust-project-parser/inputs";
export * from "@rust-project-parser/manifest";
export * from "@rust-project-parser/matrix";
export * from "@rust-project-parser/msrv";
export * from "@rust-project-parser/outputs";
export * from "@rust-project-parser/runners";
export * from "@rust-project-parser/toolchain";
export * from "@rust-project-parser/version";
export * from "@rust-project-parser/workspace";
