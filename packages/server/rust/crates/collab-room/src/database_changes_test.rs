use blok_jsjson::{Str, Value};

use crate::changes_test::{array, member, object, read_repo_json};
use crate::describe_database_change;
use crate::history_fixture_test::stringified;

// The twin of C# CollabDatabaseChangesCaptureTests.
#[test]
fn describe_database_change_matches_the_property_changes_fixture() {
    let fixture = read_repo_json(&[
        "test",
        "unit",
        "server-conformance",
        "fixtures",
        "collab-history",
        "property-changes.json",
    ]);
    let cases = array(member(&fixture, "cases"));
    assert!(cases.len() >= 5, "only {} cases", cases.len());
    let mut failures = Vec::new();
    for c in cases {
        let c = object(c);
        let type_name = match member(c, "type") {
            Value::String(s) => Some(s.clone()),
            _ => None,
        };
        let side = |key| match member(c, key) {
            Value::Object(o) => Some(o.clone()),
            _ => None,
        };
        let got = describe_database_change(
            type_name.as_ref().map(|s: &Str| s),
            side("before").as_ref(),
            side("after").as_ref(),
        );
        let got = stringified(&Value::Object(got));
        let want = stringified(member(c, "fields"));
        if got != want {
            failures.push(format!("{:?}: {got}, want {want}", member(c, "name")));
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}
