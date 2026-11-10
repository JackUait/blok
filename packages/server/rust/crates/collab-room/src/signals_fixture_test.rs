use std::time::{Duration, SystemTime, UNIX_EPOCH};

use blok_jsjson::{Object, Value};

use crate::changes_test::{array, member, object};
use crate::historytime_fixture_test::{fixture, optional_text, text};
use crate::{
    ChangeSignal, RecordNote, SignalAuthor, SignalBlock, SignalProperties, SignalRecord,
    SignalSchema, fold_signals,
};

// The twin of C# CollabChangeSignalsCaptureTests: windows and their signals,
// from fixtures/collab-history/signals.json.

fn int(object: &Object, key: &str) -> u64 {
    match member(object, key) {
        Value::Number(n) => *n as u64,
        other => panic!("{key:?} is {other:?}"),
    }
}

fn millis(object: &Object, key: &str) -> SystemTime {
    UNIX_EPOCH + Duration::from_millis(int(object, key))
}

fn strings(value: &Value) -> Vec<String> {
    array(value)
        .iter()
        .map(|item| match item {
            Value::String(s) => s.to_string(),
            other => panic!("{other:?} is not a string"),
        })
        .collect()
}

fn blocks(value: &Value) -> Vec<SignalBlock> {
    array(value)
        .iter()
        .map(|item| SignalBlock {
            id: text(object(item), "id"),
            kind: text(object(item), "kind"),
        })
        .collect()
}

fn properties(value: &Value) -> Vec<SignalProperties> {
    array(value)
        .iter()
        .map(|item| SignalProperties {
            row_id: text(object(item), "rowId"),
            ids: strings(member(object(item), "ids")),
        })
        .collect()
}

fn schema(value: &Value) -> Vec<SignalSchema> {
    array(value)
        .iter()
        .map(|item| {
            let entry = object(item);
            SignalSchema {
                database_id: text(entry, "databaseId"),
                id: text(entry, "id"),
                name: optional_text(entry, "name"),
                action: text(entry, "action"),
            }
        })
        .collect()
}

fn record(item: &Value) -> SignalRecord {
    let r = object(item);
    let note = match member(r, "note") {
        Value::Object(note) => Some(RecordNote {
            kind: text(note, "kind"),
            on_behalf_of: optional_text(note, "onBehalfOf"),
        }),
        _ => None,
    };
    SignalRecord {
        lineage: text(r, "lineage"),
        sequence: int(r, "sequence"),
        committed_at: millis(r, "committedAt"),
        actor: optional_text(r, "actor"),
        note,
        blocks: blocks(member(r, "blocks")),
        page: strings(member(r, "page")),
        properties: properties(member(r, "properties")),
        schema: schema(member(r, "schema")),
    }
}

fn signal(item: &Value) -> ChangeSignal {
    let s = object(item);
    ChangeSignal {
        doc_id: text(s, "doc"),
        lineage: text(s, "lineage"),
        from_sequence: int(s, "fromSequence"),
        to_sequence: int(s, "toSequence"),
        window_start: millis(s, "windowStart"),
        window_end: millis(s, "windowEnd"),
        blocks: blocks(member(s, "blocks")),
        page: strings(member(s, "page")),
        properties: properties(member(s, "properties")),
        schema: schema(member(s, "schema")),
        authors: array(member(s, "authors"))
            .iter()
            .map(|author| SignalAuthor {
                id: text(object(author), "id"),
                kind: optional_text(object(author), "kind"),
            })
            .collect(),
    }
}

#[test]
fn signals_fixture() {
    let fixture = fixture("signals.json");
    let cases = array(member(&fixture, "cases"));
    assert!(cases.len() >= 5, "only {} cases", cases.len());
    for case in cases {
        let c = object(case);
        let name = text(c, "name");
        let records: Vec<SignalRecord> = array(member(c, "records")).iter().map(record).collect();
        let want: Vec<ChangeSignal> = array(member(c, "signals")).iter().map(signal).collect();
        let got = fold_signals("doc-1", &records, Duration::from_millis(int(c, "windowMs")));
        assert_eq!(got, want, "{name}");
    }
}
