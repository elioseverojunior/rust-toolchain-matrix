// SPDX-FileCopyrightText: RUST-PROJECT-PARSER contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

//! Demo binary. It prints what a matrix generator would derive from this crate's
//! own `rust-toolchain.toml` and `Cargo.toml`, reading the former at compile time
//! so the fixture stays self-contained and dependency-free.

mod channel;
mod version;

use channel::Channel;
use version::highest;

/// The fixture's own toolchain file, embedded at compile time.
const TOOLCHAIN_TOML: &str = include_str!("../rust-toolchain.toml");

/// Pulls `channel = "..."` out of a `rust-toolchain.toml` body.
///
/// Deliberately line-oriented rather than a real TOML parse: a fixture should not
/// need a dependency to demonstrate the shape the action cares about.
fn declared_channel(toml: &str) -> Option<&str> {
    toml.lines()
        .map(str::trim)
        .filter(|line| !line.starts_with('#'))
        .find_map(|line| line.strip_prefix("channel"))
        .and_then(|rest| rest.trim().strip_prefix('='))
        .map(|value| value.trim().trim_matches('"'))
}

fn main() {
    match declared_channel(TOOLCHAIN_TOML) {
        Some(raw) => {
            let parsed = Channel::parse(raw);
            println!("channel   : {}", parsed.render());
            println!("rolling   : {}", parsed.is_rolling());
        }
        None => println!("channel   : (not declared)"),
    }

    let msrv = option_env!("CARGO_PKG_RUST_VERSION").unwrap_or_default();
    if msrv.is_empty() {
        println!("msrv      : (none declared)");
    } else {
        println!("msrv      : {msrv}");
    }

    // A stand-in for the deepest `rust-version` in a resolved dependency graph:
    // the effective MSRV is the maximum, not this crate's own declaration.
    match highest([msrv, "1.90.0"]) {
        Some(effective) => println!("effective : {effective:?}"),
        None => println!("effective : (unresolved)"),
    }
}

#[cfg(test)]
mod tests {
    use super::declared_channel;

    #[test]
    fn reads_the_channel_from_the_fixture_toolchain_file() {
        assert_eq!(declared_channel(super::TOOLCHAIN_TOML), Some("1.97"));
    }

    #[test]
    fn ignores_commented_out_keys() {
        let toml = "[toolchain]\n# channel = \"nightly\"\nchannel = \"stable\"\n";
        assert_eq!(declared_channel(toml), Some("stable"));
    }

    #[test]
    fn returns_none_when_absent() {
        assert_eq!(declared_channel("[toolchain]\nprofile = \"default\"\n"), None);
    }
}
