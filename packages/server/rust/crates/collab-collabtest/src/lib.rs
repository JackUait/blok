//! Reads the shared collab fixtures under test/unit/server-conformance/fixtures,
//! the same files Go's collabtest and Blok.Server.Tests read. Failures panic,
//! as Go's t.Fatal ends the test.

use std::path::PathBuf;

use blok_jsjson::Value;

/// The absolute path of a file under fixtures/.
pub fn path(relative: &str) -> PathBuf {
    let root = blok_yjs_yjstest::repo_root().unwrap_or_else(|err| panic!("{err}"));
    root.join("test/unit/server-conformance/fixtures")
        .join(relative)
}

/// One fixture file's bytes.
pub fn read_bytes(relative: &str) -> Vec<u8> {
    std::fs::read(path(relative)).unwrap_or_else(|err| panic!("{relative}: {err}"))
}

/// One fixture file parsed as JS values, keys in file order.
pub fn read(relative: &str) -> Value {
    blok_jsjson::parse(&read_bytes(relative)).unwrap_or_else(|err| panic!("{relative}: {err}"))
}

/// Decodes hex (either case, as Go's hex.DecodeString), panicking on bad input.
pub fn hex(text: &str) -> Vec<u8> {
    let digits = text.as_bytes();
    assert!(digits.len().is_multiple_of(2), "odd hex length in {text:?}");
    digits
        .chunks(2)
        .map(|pair| {
            let nibble = |d: u8| match d {
                b'0'..=b'9' => d - b'0',
                b'a'..=b'f' => d - b'a' + 10,
                b'A'..=b'F' => d - b'A' + 10,
                _ => panic!("bad hex digit in {text:?}"),
            };
            (nibble(pair[0]) << 4) | nibble(pair[1])
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_reads_both_cases() {
        assert_eq!(hex("00ffA0"), vec![0x00, 0xff, 0xa0]);
    }

    #[test]
    fn path_reaches_the_collab_fixtures() {
        assert!(path("collab").is_dir());
    }
}
