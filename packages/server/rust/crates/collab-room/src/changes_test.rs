use std::collections::BTreeMap;

use blok_jsjson::{Object, Value};

use crate::changes::{BlockChangeKind, diff_blocks};

pub(crate) fn kind_name(kind: BlockChangeKind) -> &'static str {
    match kind {
        BlockChangeKind::Added => "added",
        BlockChangeKind::Removed => "removed",
        BlockChangeKind::Changed => "changed",
        BlockChangeKind::Moved => "moved",
    }
}

pub(crate) fn read_repo_json(parts: &[&str]) -> Object {
    let mut path = blok_yjs_yjstest::repo_root().unwrap_or_else(|err| panic!("{err}"));
    for part in parts {
        path.push(part);
    }
    let data = std::fs::read(&path).unwrap_or_else(|err| panic!("{}: {err}", path.display()));
    match blok_jsjson::parse(&data).unwrap_or_else(|err| panic!("{err}")) {
        Value::Object(object) => object,
        _ => panic!("{parts:?} is not an object"),
    }
}

pub(crate) fn member<'a>(object: &'a Object, key: &str) -> &'a Value {
    object
        .get(&key.into())
        .unwrap_or_else(|| panic!("no {key:?}"))
}

pub(crate) fn array(value: &Value) -> &[Value] {
    match value {
        Value::Array(items) => items,
        _ => &[],
    }
}

pub(crate) fn object(value: &Value) -> &Object {
    match value {
        Value::Object(object) => object,
        other => panic!("{other:?} is not an object"),
    }
}

pub(crate) fn string(value: &Value) -> String {
    match value {
        Value::String(s) => s.to_string(),
        other => panic!("{other:?} is not a string"),
    }
}

#[test]
fn diff_blocks_marks_every_kind_fixture_case() {
    let fixture = read_repo_json(&["test", "fixtures", "version-history", "kind-cases.json"]);
    let cases = array(member(&fixture, "cases"));
    assert!(cases.len() > 10, "only {} cases", cases.len());
    let mut failures = Vec::new();
    for item in cases {
        let case = object(item);
        let name = string(member(case, "name"));
        let before = array(member(case, "before"));
        let after = array(member(case, "after"));
        let want: BTreeMap<String, String> = object(member(case, "kinds"))
            .members()
            .iter()
            .map(|entry| (entry.key.to_string(), string(&entry.value)))
            .collect();
        let got: BTreeMap<String, String> = diff_blocks(before, after)
            .into_iter()
            .map(|change| (change.id.to_string(), kind_name(change.kind).to_owned()))
            .collect();
        if got != want {
            failures.push(format!("{name}: got {got:?}, want {want:?}"));
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}
