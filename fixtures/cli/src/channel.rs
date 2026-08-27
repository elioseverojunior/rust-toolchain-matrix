// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

//! Toolchain channel handling, mirroring what the parser action must understand
//! when it reads the `channel` key out of a `rust-toolchain.toml`.

/// A Rust toolchain channel as it may appear in `rust-toolchain.toml`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Channel {
    /// The rolling `stable` channel.
    Stable,
    /// The rolling `beta` channel.
    Beta,
    /// `nightly`, optionally pinned to a date such as `nightly-2026-08-03`.
    Nightly { date: Option<String> },
    /// A pinned release such as `1.88` or `1.88.0`.
    Version(String),
}

impl Channel {
    /// Parses a channel string as written in `rust-toolchain.toml`.
    ///
    /// Unrecognised input is returned as [`Channel::Version`] rather than an
    /// error: rustup accepts custom toolchain names, so refusing them here would
    /// be stricter than the tool this mirrors.
    #[must_use]
    pub fn parse(raw: &str) -> Self {
        let raw = raw.trim();
        match raw {
            "stable" => Self::Stable,
            "beta" => Self::Beta,
            "nightly" => Self::Nightly { date: None },
            _ => raw.strip_prefix("nightly-").map_or_else(
                || Self::Version(raw.to_owned()),
                |date| Self::Nightly { date: Some(date.to_owned()) },
            ),
        }
    }

    /// Returns `true` when the channel moves on its own over time.
    ///
    /// A date-pinned nightly does not: `nightly-2026-08-03` always resolves to
    /// the same compiler, which is why it is treated as reproducible here.
    #[must_use]
    pub const fn is_rolling(&self) -> bool {
        match self {
            Self::Stable | Self::Beta => true,
            Self::Nightly { date } => date.is_none(),
            Self::Version(_) => false,
        }
    }

    /// Renders the channel back into its `rust-toolchain.toml` spelling.
    #[must_use]
    pub fn render(&self) -> String {
        match self {
            Self::Stable => "stable".to_owned(),
            Self::Beta => "beta".to_owned(),
            Self::Nightly { date: None } => "nightly".to_owned(),
            Self::Nightly { date: Some(date) } => format!("nightly-{date}"),
            Self::Version(version) => version.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Channel;

    #[test]
    fn parses_the_rolling_channels() {
        assert_eq!(Channel::parse("stable"), Channel::Stable);
        assert_eq!(Channel::parse("  beta "), Channel::Beta);
        assert_eq!(Channel::parse("nightly"), Channel::Nightly { date: None });
    }

    #[test]
    fn parses_a_dated_nightly() {
        let parsed = Channel::parse("nightly-2026-08-03");
        assert_eq!(parsed, Channel::Nightly { date: Some("2026-08-03".to_owned()) });
        assert!(!parsed.is_rolling(), "a dated nightly is reproducible");
    }

    #[test]
    fn treats_an_unknown_name_as_a_version() {
        assert_eq!(Channel::parse("1.88"), Channel::Version("1.88".to_owned()));
        assert!(!Channel::parse("1.88").is_rolling());
    }

    #[test]
    fn rendering_round_trips() {
        for raw in ["stable", "beta", "nightly", "nightly-2026-08-03", "1.88.0"] {
            assert_eq!(Channel::parse(raw).render(), raw);
        }
    }
}
