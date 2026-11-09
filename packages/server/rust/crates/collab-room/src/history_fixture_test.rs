use std::collections::HashSet;
use std::time::{Duration, SystemTime};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use blok_collab_convert::{
    DocConverter, EditOp, Error as ConvertError, HtmlReader, RichTextHtml, describe_structure,
    read_page_maps,
};
use blok_collab_journal::{LineageInfo, RecordHeader};
use blok_collab_operation::{Record, Source};
use blok_dotnet::{ticks, time_from_ticks};
use blok_jsjson::{Node, Object, Str, Value, parse, stringify};
use blok_yjs::{Doc, Options, Out};

use crate::changes::replay_changes;
use crate::changes_test::{array, kind_name, member, object, read_repo_json, string};
use crate::restore::plan_restore;
use crate::{Error, LineageHeaders, TIMELINE_IDLE_GAP, TIMELINE_MAX_SPAN, Version, group_versions};

// The twins of C# CollabHistoryCaptureTests: the same grouping, changes
// and restore plans, read from fixtures/collab-history.

/// A reader for format-2 fixtures, which hold no HTML.
pub(crate) struct NoHtml;

impl HtmlReader for NoHtml {
    #[allow(clippy::manual_async_fn, reason = "the trait asks for a Send future")]
    fn read(
        &self,
        fields: &[RichTextHtml],
        _timeout: Option<Duration>,
    ) -> impl Future<Output = Result<Vec<Vec<Value>>, ConvertError>> + Send {
        let count = fields.len();
        async move { panic!("{count} HTML fields read from a format-2 fixture") }
    }
}

pub(crate) fn no_html_converter() -> DocConverter<NoHtml> {
    DocConverter {
        now: Box::new(SystemTime::now),
        html: NoHtml,
        fields: None,
        log: None,
    }
}

pub(crate) fn history_fixture(name: &str) -> Vec<Object> {
    let fixture = read_repo_json(&[
        "test",
        "unit",
        "server-conformance",
        "fixtures",
        "collab-history",
        name,
    ]);
    let items = array(member(&fixture, "cases"));
    assert!(items.len() >= 5, "{name}: only {} cases", items.len());
    items.iter().map(|item| object(item).clone()).collect()
}

fn text(object: &Object, key: &str) -> String {
    match member(object, key) {
        Value::String(s) => s.to_string(),
        _ => panic!("{key:?} is not a string"),
    }
}

fn optional_text(object: &Object, key: &str) -> Option<String> {
    if matches!(member(object, key), Value::Null) {
        return None;
    }
    Some(text(object, key))
}

fn number(object: &Object, key: &str) -> u64 {
    text(object, key)
        .parse()
        .unwrap_or_else(|err| panic!("{key}: {err}"))
}

fn ticks_of(object: &Object, key: &str) -> Option<SystemTime> {
    let s = optional_text(object, key)?;
    Some(time_from_ticks(
        s.parse().unwrap_or_else(|err| panic!("{key}: {err}")),
    ))
}

fn ticks_text(at: Option<SystemTime>) -> Option<String> {
    at.map(|at| ticks(at).to_string())
}

fn objects(value: &Value) -> Vec<&Object> {
    array(value).iter().map(object).collect()
}

fn string_list(value: &Value) -> Vec<String> {
    array(value).iter().map(string).collect()
}

pub(crate) fn stringified(value: &Value) -> String {
    stringify(value).unwrap_or_else(|err| panic!("{err}"))
}

fn node_value(node: &Node) -> Value {
    let mut raw = Vec::new();
    node.append_json(&mut raw)
        .unwrap_or_else(|err| panic!("{err}"));
    parse(&raw).unwrap_or_else(|err| panic!("{err}"))
}

fn object_text(object: Option<&Object>) -> String {
    object.map_or_else(
        || "null".to_owned(),
        |o| stringified(&Value::Object(o.clone())),
    )
}

fn decode(s: &str) -> Vec<u8> {
    STANDARD.decode(s).unwrap_or_else(|err| panic!("{err}"))
}

fn show(version: &Version) -> String {
    format!("{version:?}")
}

#[test]
fn group_versions_matches_the_timeline_fixture() {
    let mut failures = Vec::new();
    for c in history_fixture("timeline.json") {
        let name = text(&c, "name");
        let mut lineages = Vec::new();
        for entry in objects(member(&c, "lineages")) {
            let mut lineage = LineageHeaders {
                lineage: LineageInfo {
                    lineage: text(entry, "lineage"),
                    epoch: 1,
                    format: 2,
                    created_at: ticks_of(entry, "createdAt"),
                    current: false,
                },
                headers: Vec::new(),
            };
            for header in objects(member(entry, "headers")) {
                lineage.headers.push(RecordHeader {
                    sequence: number(header, "sequence"),
                    committed_at: ticks_of(header, "committedAt")
                        .unwrap_or_else(|| panic!("{name}: no committedAt")),
                    actor_id: optional_text(header, "actor"),
                });
            }
            lineages.push(lineage);
        }
        let (mut gap, mut span) = (TIMELINE_IDLE_GAP, TIMELINE_MAX_SPAN);
        if let Value::Number(window) = member(&c, "windowMinutes") {
            let minutes = Duration::from_secs(60 * *window as u64);
            (gap, span) = (minutes, minutes);
        }
        let got = group_versions(&lineages, gap, span);
        let want = objects(member(&c, "versions"));
        if got.len() != want.len() {
            failures.push(format!(
                "{name}: {} versions, want {}",
                got.len(),
                want.len()
            ));
            continue;
        }
        for (i, version) in want.iter().enumerate() {
            let g = &got[i];
            if g.lineage != text(version, "lineage")
                || g.sequence != number(version, "sequence")
                || ticks_text(g.started_at) != optional_text(version, "startedAt")
                || ticks_text(g.saved_at) != optional_text(version, "savedAt")
                || g.actors != string_list(member(version, "actors"))
            {
                failures.push(format!(
                    "{name}: version {i} is {}, want {}",
                    show(g),
                    stringified(&Value::Object((*version).clone()))
                ));
            }
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

#[tokio::test]
async fn replay_changes_matches_the_changes_fixture() {
    let converter = no_html_converter();
    let mut failures = Vec::new();
    for c in history_fixture("changes.json") {
        let name = text(&c, "name");
        let baseline: Vec<Vec<u8>> = string_list(member(&c, "baseline"))
            .iter()
            .map(|update| decode(update))
            .collect();
        let records: Vec<Record> = objects(member(&c, "records"))
            .into_iter()
            .map(|record| {
                let sequence = number(record, "sequence");
                Record {
                    operation_id: format!("op-{sequence}"),
                    sequence,
                    committed_at: ticks_of(record, "committedAt")
                        .unwrap_or_else(|| panic!("{name}: no committedAt")),
                    actor_id: optional_text(record, "actor"),
                    source: Source::HTTP_EDIT,
                    update: decode(&text(record, "update")),
                    digest: vec![0; 32],
                }
            })
            .collect();
        let max_bytes: i64 = text(&c, "maxBytes")
            .parse()
            .unwrap_or_else(|err| panic!("{err}"));
        let got = replay_changes(
            &baseline,
            records.into_iter().map(Ok::<_, Error>),
            number(&c, "firstBefore"),
            &converter,
            max_bytes,
        )
        .await
        .unwrap_or_else(|err| panic!("{name}: {err}"));
        let want = objects(member(&c, "changes"));
        if got.len() != want.len() {
            failures.push(format!("{name}: {} rows, want {}", got.len(), want.len()));
            continue;
        }
        for (i, row) in want.iter().enumerate() {
            let g = &got[i];
            if g.sequence != number(row, "sequence")
                || ticks_text(Some(g.committed_at)) != optional_text(row, "committedAt")
                || g.actor_id != optional_text(row, "actor")
                || g.page != string_list(member(row, "page"))
            {
                failures.push(format!(
                    "{name}: row {i} is {} {:?} {:?} {:?}, want {}",
                    g.sequence,
                    g.committed_at,
                    g.actor_id,
                    g.page,
                    stringified(&Value::Object((*row).clone()))
                ));
            }
            let blocks = objects(member(row, "blocks"));
            if g.blocks.len() != blocks.len() {
                failures.push(format!(
                    "{name}: row {i} has {} blocks, want {}",
                    g.blocks.len(),
                    blocks.len()
                ));
                continue;
            }
            for (j, block) in blocks.iter().enumerate() {
                let change = &g.blocks[j];
                let type_name = change.kind_type.as_ref().map(Str::to_string);
                if change.id.to_string() != text(block, "id")
                    || type_name != optional_text(block, "type")
                    || kind_name(change.kind) != text(block, "kind")
                    || object_text(change.before.as_ref()) != stringified(member(block, "before"))
                    || object_text(change.after.as_ref()) != stringified(member(block, "after"))
                {
                    failures.push(format!(
                        "{name}: row {i} block {j} is {} {} {} -> {}, want {}",
                        change.id,
                        kind_name(change.kind),
                        object_text(change.before.as_ref()),
                        object_text(change.after.as_ref()),
                        stringified(&Value::Object((*block).clone()))
                    ));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

fn doc_of(update: &str) -> Doc {
    let doc = Doc::new(Options::default());
    doc.apply_update(&decode(update))
        .unwrap_or_else(|err| panic!("{err}"));
    doc
}

fn exported_blocks(doc: &Doc) -> Vec<Value> {
    let (blocks, slots) = no_html_converter()
        .export_blocks(doc, &mut HashSet::new())
        .unwrap_or_else(|err| panic!("{err}"));
    assert!(
        slots.is_empty(),
        "{} HTML slots: the fixture holds format-2 docs only",
        slots.len()
    );
    blocks
}

fn op_text(op: &EditOp) -> String {
    let mut out = Object::new();
    let str_field = |out: &mut Object, key: &str, value: Option<&Str>| {
        out.set(
            key.into(),
            value.map_or(Value::Null, |s| Value::String(s.clone())),
        );
    };
    match op {
        EditOp::Insert {
            id,
            block,
            after,
            parent,
        } => {
            str_field(&mut out, "op", Some(&"insert".into()));
            str_field(&mut out, "id", Some(id));
            str_field(&mut out, "after", after.as_ref());
            str_field(&mut out, "parent", parent.as_ref());
            out.set("block".into(), node_value(block));
        }
        EditOp::Update { id, data } => {
            str_field(&mut out, "op", Some(&"update".into()));
            str_field(&mut out, "id", Some(id));
            out.set("data".into(), node_value(data));
        }
        EditOp::Remove { id } => {
            str_field(&mut out, "op", Some(&"remove".into()));
            str_field(&mut out, "id", Some(id));
        }
        EditOp::PatchMaps { patches } => {
            str_field(&mut out, "op", Some(&"patchMaps".into()));
            let entries = patches
                .iter()
                .map(|patch| {
                    let mut entry = Object::new();
                    entry.set("map".into(), Value::String(patch.map.clone()));
                    entry.set("key".into(), Value::String(patch.key.clone()));
                    entry.set("remove".into(), Value::Bool(patch.remove));
                    let value = match &patch.value {
                        Out::Any(value) => value.clone(),
                        other => panic!("a patch holds {other:?}"),
                    };
                    entry.set("value".into(), value);
                    Value::Object(entry)
                })
                .collect();
            out.set("patches".into(), Value::Array(entries));
        }
        other => panic!("the planner made {other:?}"),
    }
    stringified(&Value::Object(out))
}

#[test]
fn plan_restore_matches_the_restore_plans_fixture() {
    let mut failures = Vec::new();
    for c in history_fixture("restore-plans.json") {
        let name = text(&c, "name");
        let (current, target) = (doc_of(&text(&c, "current")), doc_of(&text(&c, "target")));
        let ops = plan_restore(
            &exported_blocks(&current),
            &describe_structure(&current).unwrap_or_else(|err| panic!("{err}")),
            &exported_blocks(&target),
            &read_page_maps(&current).unwrap_or_else(|err| panic!("{err}")),
            &read_page_maps(&target).unwrap_or_else(|err| panic!("{err}")),
        );
        let want = array(member(&c, "ops"));
        if ops.len() != want.len() {
            failures.push(format!("{name}: {} ops, want {}", ops.len(), want.len()));
            continue;
        }
        for (i, op) in ops.iter().enumerate() {
            let (got, expected) = (op_text(op), stringified(&want[i]));
            if got != expected {
                failures.push(format!("{name}: op {i} is {got}, want {expected}"));
            }
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}
