// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

//! Numeric version comparison, mirroring the rule the parser action relies on
//! when it folds every `rust-version` in a dependency graph into one MSRV.

use std::cmp::Ordering;

/// A `major.minor.patch` version with an optional, ignored suffix.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Version {
    major: u64,
    minor: u64,
    patch: u64,
}

impl Version {
    /// Parses `1.88`, `1.88.0`, or `1.88.0-beta.1`, dropping any suffix.
    ///
    /// Returns `None` when a numeric field is absent or not a number. Callers
    /// skip unparseable versions rather than failing, because one odd entry in a
    /// dependency graph should not sink the whole resolution.
    #[must_use]
    pub fn parse(raw: &str) -> Option<Self> {
        let core = raw.trim().split(['-', '+']).next()?;
        let mut fields = core.split('.');
        let major = fields.next()?.parse().ok()?;
        let minor = fields.next()?.parse().ok()?;
        let patch = fields.next().map_or(Some(0), |field| field.parse().ok())?;
        if fields.next().is_some() {
            return None;
        }
        Some(Self { major, minor, patch })
    }

    /// Orders two versions field by field.
    ///
    /// This is the whole point of the type. Comparing the strings instead sorts
    /// `"1.9"` above `"1.10"`, which silently picks the wrong MSRV.
    #[must_use]
    pub fn compare(&self, other: &Self) -> Ordering {
        (self.major, self.minor, self.patch).cmp(&(other.major, other.minor, other.patch))
    }
}

/// Returns the highest version in `raw`, skipping anything unparseable.
#[must_use]
pub fn highest<'a>(raw: impl IntoIterator<Item = &'a str>) -> Option<Version> {
    raw.into_iter()
        .filter_map(Version::parse)
        .fold(None, |best: Option<Version>, next| match best {
            Some(current) if current.compare(&next) != Ordering::Less => Some(current),
            _ => Some(next),
        })
}

#[cfg(test)]
mod tests {
    use super::{highest, Version};
    use std::cmp::Ordering;

    #[test]
    fn parses_two_and_three_field_versions() {
        assert_eq!(Version::parse("1.88"), Version::parse("1.88.0"));
        assert!(Version::parse("1.88.1").is_some());
    }

    #[test]
    fn drops_a_prerelease_suffix() {
        assert_eq!(Version::parse("1.88.0-beta.1"), Version::parse("1.88.0"));
    }

    #[test]
    fn rejects_malformed_input() {
        for raw in ["", "1", "1.x", "1.2.3.4"] {
            assert!(Version::parse(raw).is_none(), "{raw} should not parse");
        }
    }

    #[test]
    fn compares_numerically_not_lexically() {
        let older = Version::parse("1.9.0").expect("valid");
        let newer = Version::parse("1.10.0").expect("valid");
        assert_eq!(older.compare(&newer), Ordering::Less, "1.9 < 1.10");
    }

    #[test]
    fn highest_skips_unparseable_entries() {
        let found = highest(["1.88.0", "not-a-version", "1.95.0", "1.9.0"]);
        assert_eq!(found, Version::parse("1.95.0"));
        assert_eq!(highest(["nope"]), None);
    }
}
