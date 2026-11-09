use std::time::SystemTime;

use blok_collab_journal::{LineageInfo, RecordHeader};
use blok_dotnet::{ticks, time_from_ticks};
use blok_jsjson::{Object, Value};

use crate::changes_test::{array, member, object, read_repo_json};
use crate::{
    HistoryPoint, HistoryStatus, LineageHeaders, parse_history_time, resolve_at, select_range,
};

// The twins of C# CollabHistoryTimeCaptureTests.

fn fixture(name: &str) -> Object {
    read_repo_json(&[
        "test",
        "unit",
        "server-conformance",
        "fixtures",
        "collab-history",
        name,
    ])
}

fn text(object: &Object, key: &str) -> String {
    match member(object, key) {
        Value::String(s) => s.to_string(),
        _ => panic!("{key:?} is not a string"),
    }
}

fn optional_text(object: &Object, key: &str) -> Option<String> {
    match member(object, key) {
        Value::Null => None,
        _ => Some(text(object, key)),
    }
}

fn at(object: &Object, key: &str) -> Option<SystemTime> {
    optional_text(object, key).map(|s| time_from_ticks(s.parse().unwrap()))
}

fn number(object: &Object, key: &str) -> u64 {
    text(object, key).parse().unwrap()
}

fn lineages(c: &Object) -> Vec<LineageHeaders> {
    array(member(c, "lineages"))
        .iter()
        .map(|entry| {
            let entry = object(entry);
            LineageHeaders {
                lineage: LineageInfo {
                    lineage: text(entry, "lineage"),
                    epoch: 1,
                    format: 2,
                    created_at: at(entry, "createdAt"),
                    current: false,
                },
                headers: array(member(entry, "headers"))
                    .iter()
                    .map(|header| {
                        let header = object(header);
                        RecordHeader {
                            sequence: number(header, "sequence"),
                            committed_at: at(header, "committedAt").unwrap(),
                            actor_id: None,
                        }
                    })
                    .collect(),
            }
        })
        .collect()
}

fn point_text(point: Option<&HistoryPoint>) -> String {
    point.map_or_else(
        || "null".to_owned(),
        |p| {
            format!(
                "{}:{}@{}",
                p.lineage,
                p.sequence,
                p.committed_at.map(ticks).unwrap()
            )
        },
    )
}

fn want_point_text(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        value => {
            let o = object(value);
            format!(
                "{}:{}@{}",
                text(o, "lineage"),
                text(o, "sequence"),
                text(o, "committedAt")
            )
        }
    }
}

fn cases(fixture: &Object, key: &str) -> Vec<Object> {
    let items = array(member(fixture, key));
    assert!(items.len() >= 5, "only {} {key}", items.len());
    items.iter().map(|item| object(item).clone()).collect()
}

#[test]
fn parse_history_time_matches_the_at_time_fixture() {
    let mut failures = Vec::new();
    for c in cases(&fixture("at-time.json"), "parse") {
        let input = text(&c, "text");
        let got = parse_history_time(&input).map(|at| ticks(at).to_string());
        if got != optional_text(&c, "ticks") {
            failures.push(format!("{input:?} parsed to {got:?}"));
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

#[test]
fn resolve_at_matches_the_at_time_fixture() {
    let mut failures = Vec::new();
    for c in cases(&fixture("at-time.json"), "cases") {
        let got = point_text(resolve_at(&lineages(&c), at(&c, "time").unwrap()).as_ref());
        let want = want_point_text(member(&c, "point"));
        if got != want {
            failures.push(format!("{}: {got}, want {want}", text(&c, "name")));
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

#[test]
fn select_range_matches_the_changes_range_fixture() {
    let mut failures = Vec::new();
    for c in cases(&fixture("changes-range.json"), "cases") {
        let name = text(&c, "name");
        let before = match member(&c, "before") {
            Value::Null => None,
            value => Some(HistoryPoint {
                lineage: text(object(value), "lineage"),
                sequence: number(object(value), "sequence"),
                committed_at: None,
            }),
        };
        let Value::Number(max) = member(&c, "maxRecords") else {
            panic!("maxRecords")
        };
        let got = select_range(
            &lineages(&c),
            at(&c, "from").unwrap(),
            at(&c, "to").unwrap(),
            before.as_ref(),
            *max as usize,
        );
        let got_text: Vec<String> = got.records.iter().map(|p| point_text(Some(p))).collect();
        let want_text: Vec<String> = array(member(&c, "records"))
            .iter()
            .map(want_point_text)
            .collect();
        let found = matches!(member(&c, "found"), Value::Bool(true));
        let truncated = matches!(member(&c, "truncated"), Value::Bool(true));
        if got_text != want_text
            || got.truncated != truncated
            || (got.status == HistoryStatus::Ready) != found
        {
            failures.push(format!(
                "{name}: {got_text:?} {} {:?}",
                got.truncated, got.status
            ));
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}
