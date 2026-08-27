// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
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
