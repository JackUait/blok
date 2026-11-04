mod support;

use blok_mediatype::{boundary, is_json, sanitize_wire};
use support::json;

#[test]
fn media_types_match_the_csharp_fixture() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../../test/unit/server-conformance/fixtures/media-types.json"
    );
    let fixture = json::parse(&std::fs::read_to_string(path).unwrap());
    let inputs = fixture.get("inputs").array();
    let answers = fixture.get("answers").array();
    assert!(!inputs.is_empty());
    assert_eq!(inputs.len(), answers.len());
    let mut failures = Vec::new();
    for (input, want) in inputs.iter().zip(answers) {
        let input = input.str();
        let wire = sanitize_wire(input);
        if wire != want.get("wire").str() {
            failures.push(format!("{input:?}: wire {wire:?}"));
        }
        let got = boundary(input);
        if got.as_deref() != want.get("boundary").opt_str() {
            failures.push(format!("{input:?}: boundary {got:?}"));
        }
        if is_json(input) != want.get("json").bool() {
            failures.push(format!("{input:?}: json {}", is_json(input)));
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}
