use crate::changes_test::{array, member, string};
use crate::history_fixture_test::{history_fixture, stringified};
use crate::restore_guards::restore_guards;

// The twin of C# CollabHistoryCaptureTests.TheRestoreGuardsMatchTheRules.
#[test]
fn restore_guards_match_the_fixture() {
    let mut failures = Vec::new();
    for c in history_fixture("restore-guards.json") {
        let name = string(member(&c, "name"));
        let wanted: Vec<String> = array(member(&c, "guards"))
            .iter()
            .map(stringified)
            .collect();
        let got: Vec<String> =
            restore_guards(array(member(&c, "current")), array(member(&c, "target")))
                .iter()
                .map(|guard| stringified(&guard.json()))
                .collect();
        if got != wanted {
            failures.push(format!("{name}: guards are {got:?}, want {wanted:?}"));
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

// Two ids with different lone surrogates are two blocks to the planner, so
// the guards must not read them as one.
#[test]
fn restore_guards_keep_lone_surrogate_ids_apart() {
    let parse = |text: &str| match blok_jsjson::parse(text.as_bytes()) {
        Ok(blok_jsjson::Value::Array(items)) => items,
        other => panic!("not an array: {other:?}"),
    };
    let public = r#""views": [{ "id": "v", "type": "table", "form": { "public": true } }]"#;
    let current = parse(&format!(
        r#"[{{ "id": "\uD800", "type": "database", "data": {{ "schema": [], {public} }} }}]"#
    ));
    let target = parse(&format!(
        r#"[{{ "id": "\uDC00", "type": "database", "data": {{ "schema": [], {public} }} }},
            {{ "id": "\uD800", "type": "database", "data": {{ "schema": [], {public} }} }}]"#
    ));
    let got: Vec<String> = restore_guards(&current, &target)
        .iter()
        .map(|guard| stringified(&guard.json()))
        .collect();
    assert_eq!(
        got,
        vec!["{\"kind\":\"share\",\"blockId\":\"\u{fffd}\",\"viewId\":\"v\"}"]
    );
}
