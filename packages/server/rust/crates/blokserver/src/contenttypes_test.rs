use std::collections::BTreeMap;

use blok_jsjson::{Options, parse_node, to_string_lossy};

use super::*;

// contenttypes.rs is generated from this file, which ContentTypeFixtureTests
// pins to ASP.NET's FileExtensionContentTypeProvider.
#[test]
fn content_types_match_asp_net() {
    let path = format!(
        "{}/../../../../../test/unit/server-conformance/fixtures/content-types.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let node = parse_node(&std::fs::read(path).unwrap(), Options::default()).unwrap();
    let want: BTreeMap<String, String> = node
        .members
        .iter()
        .map(|m| {
            (
                to_string_lossy(m.key().unwrap().units()),
                to_string_lossy(m.value.text().unwrap().units()),
            )
        })
        .collect();
    let got: BTreeMap<String, String> = CONTENT_TYPES
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect();
    assert!(
        got == want,
        "contenttypes.rs is stale: regenerate it from content-types.json"
    );
    assert_eq!(
        content_type_for("0123456789abcdef0123456789abcdef.HTML"),
        "text/html"
    );
    assert_eq!(content_type_for("x.unknownext"), "application/octet-stream");
}

// The table holds ".IVF" in upper case. ASP.NET's provider ignores case, so
// a stored "x.ivf" (stored names are lower case) is video/x-ivf.
#[test]
fn an_upper_case_table_key_still_matches() {
    assert_eq!(
        content_type_for("0123456789abcdef0123456789abcdef.ivf"),
        "video/x-ivf"
    );
}

#[test]
fn ranges_parse_like_the_csharp_endpoint() {
    let r = |start, length| ByteRange { start, length };
    assert_eq!(parse_ranges("bytes=0-4", 10), Ok(vec![r(0, 5)]));
    assert_eq!(parse_ranges("bytes=-3", 10), Ok(vec![r(7, 3)]));
    assert_eq!(parse_ranges("bytes=8-", 10), Ok(vec![r(8, 2)]));
    assert_eq!(parse_ranges("bytes=5-100", 10), Ok(vec![r(5, 5)]));
    assert_eq!(parse_ranges("bytes=10-", 10), Err(RangeError::NoOverlap));
    assert_eq!(parse_ranges("bytes=-0", 10), Err(RangeError::NoOverlap));
    assert_eq!(parse_ranges("bytes=5-4", 10), Err(RangeError::Invalid));
    assert_eq!(parse_ranges("bytes=--1", 10), Err(RangeError::Invalid));
    assert_eq!(parse_ranges("items=0-1", 10), Err(RangeError::Invalid));
    assert_eq!(
        parse_ranges(&format!("bytes={}", ["0-0"; 17].join(",")), 10),
        Err(RangeError::TooMany)
    );
}
