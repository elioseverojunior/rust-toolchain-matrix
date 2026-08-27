// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

//! The public barrel. Re-exports every library module except `index.ts`
//! (wiring, never imported) using this package's own path alias, so the
//! specifier a consumer writes (`@rust-toolchain-matrix/...`) resolves
//! identically to how library source resolves it internally.

export * from "@rust-toolchain-matrix/action";
export * from "@rust-toolchain-matrix/channel";
export * from "@rust-toolchain-matrix/clippy";
export * from "@rust-toolchain-matrix/deps";
export * from "@rust-toolchain-matrix/errors";
export * from "@rust-toolchain-matrix/inputs";
export * from "@rust-toolchain-matrix/manifest";
export * from "@rust-toolchain-matrix/matrix";
export * from "@rust-toolchain-matrix/msrv";
export * from "@rust-toolchain-matrix/outputs";
export * from "@rust-toolchain-matrix/runners";
export * from "@rust-toolchain-matrix/toolchain";
export * from "@rust-toolchain-matrix/version";
export * from "@rust-toolchain-matrix/workspace";
