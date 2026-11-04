use blok_collab_collabtest::read;

use crate::richtext_test::{field, items, text};

#[test]
fn the_shared_fixture_holds_the_malformed_cases() {
    let inputs = read("rich-text-canonical/inputs.json");
    let malformed = |group: &str| {
        items(field(&inputs, group))
            .iter()
            .filter(|entry| text(field(entry, "name")).starts_with("malformed-"))
            .count()
    };
    assert!(malformed("segments") >= 20);
    assert!(malformed("deltas") > 0);
}

#[test]
#[ignore = "drives YDocConverter.ApplyOps; needs apply (lane E)"]
fn an_update_leaves_the_delta_yjs_leaves() {}
