use blok_collab_collabtest as collabtest;
use blok_jsjson::Value;
use blok_yjs_yjstest::field;

use crate::keys::{DIFFABLE_TEXT_KEYS, ORDERED_ID_ARRAY_KEYS};
use crate::textdiff_tables::{CONJUNCT_BREAKERS, CONJUNCT_CONSONANTS, CONJUNCT_LINKERS};

fn strings(fixture: &Value, key: &str) -> Vec<String> {
    match field(fixture, key) {
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| match item {
                Value::String(s) => s.to_string(),
                other => panic!("{key}: {other:?}"),
            })
            .collect(),
        other => panic!("{key}: {other:?}"),
    }
}

// fixtures/converter-keys.json is shared with the client tests, C#
// ConverterKeysFixtureTests and Go keys_test.go; each side checks its own copy.
#[test]
fn the_key_sets_and_conjunct_tables_match_the_shared_fixture() {
    let fixture = collabtest::read("converter-keys.json");
    assert_eq!(
        DIFFABLE_TEXT_KEYS.to_vec(),
        strings(&fixture, "diffableTextKeys")
    );
    assert_eq!(
        ORDERED_ID_ARRAY_KEYS.to_vec(),
        strings(&fixture, "orderedIdArrayKeys")
    );
    for (name, table) in [
        ("conjunctLinkers", CONJUNCT_LINKERS),
        ("conjunctConsonants", CONJUNCT_CONSONANTS),
        ("conjunctBreakers", CONJUNCT_BREAKERS),
    ] {
        let got: Vec<String> = table
            .chunks(2)
            .map(|pair| format!("{:04X}-{:04X}", pair[0], pair[1]))
            .collect();
        let want = strings(&fixture, name);
        assert!(
            !want.is_empty() && got == want,
            "{name} differs from the fixture"
        );
    }
}
