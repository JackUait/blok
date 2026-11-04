use std::collections::BTreeMap;

use blok_collab_collabtest::{path, read};
use blok_jsjson::{Str, Value, append_quoted, compare, stringify};
use blok_yjs::{Doc, Options, Out, TypeKind};

use crate::export::PAGE_MAPS;
use crate::export_test::decode64;
use crate::richtext_test::{field, items, text};
use crate::structure::{
    KeyShape, PlainPageMap, describe_structure, plain_map_values_equal, plain_page_maps,
    read_page_maps,
};

/// Writes JSON keeping each object's member order, so a key order
/// difference shows.
fn ordered(v: &Value) -> String {
    match v {
        Value::Object(object) => {
            let parts: Vec<String> = object
                .members()
                .iter()
                .map(|member| {
                    let mut key = Vec::new();
                    append_quoted(&mut key, &member.key);
                    format!(
                        "{}:{}",
                        String::from_utf8_lossy(&key),
                        ordered(&member.value)
                    )
                })
                .collect();
            format!("{{{}}}", parts.join(","))
        }
        Value::Array(items) => {
            let parts: Vec<String> = items.iter().map(ordered).collect();
            format!("[{}]", parts.join(","))
        }
        other => stringify(other).unwrap_or_default(),
    }
}

fn value_kind(v: &Out) -> String {
    match v {
        Out::Any(Value::Null) => "null",
        Out::Any(Value::String(_)) => "string",
        Out::Any(Value::Number(_)) => "number",
        Out::Any(Value::Bool(_)) => "bool",
        Out::Any(Value::Object(_)) => "object",
        Out::Any(Value::Array(_)) => "array",
        Out::Any(Value::Bytes(_)) => "bytes",
        Out::Any(Value::BigInt(_)) => "bigint",
        Out::Any(Value::Undefined) => "undefined",
        Out::Type(handle) => match handle.kind() {
            TypeKind::Map => "YMap",
            TypeKind::Array => "YArray",
            TypeKind::XmlText => "YXmlText",
            TypeKind::Text => "YText",
            other => return format!("{other:?}"),
        },
        Out::Subdoc(_) => "Subdoc",
    }
    .to_owned()
}

fn plain_maps_json(maps: &[PlainPageMap]) -> String {
    let parts: Vec<String> = maps
        .iter()
        .map(|m| {
            format!(
                "{{\"name\":\"{}\",\"map\":{}}}",
                m.name,
                ordered(&Value::Object(m.map.clone()))
            )
        })
        .collect();
    format!("[{}]", parts.join(","))
}

fn strs(s: Option<&Str>) -> String {
    s.map_or_else(|| "<nil>".to_owned(), Str::to_string)
}

fn listed(ids: Option<&[Str]>) -> String {
    match ids {
        None => "<none>".to_owned(),
        Some(ids) => {
            let parts: Vec<String> = ids.iter().map(Str::to_string).collect();
            format!("[{}]", parts.join(" "))
        }
    }
}

fn optional_strs(value: &Value) -> Option<Vec<Str>> {
    match value {
        Value::Array(entries) => Some(entries.iter().map(|entry| Str::from(text(entry))).collect()),
        _ => None,
    }
}

fn shape_line(k: &KeyShape) -> String {
    format!(
        "{} {} {} {}",
        k.id,
        k.is_block,
        strs(k.stored_parent.as_ref()),
        listed(k.listed.as_deref())
    )
}

// Twin of YDocConverterStructureCaptureTests.
#[test]
fn the_doc_reads_match_csharp() {
    let fixture = read("collab-structure/cases.json");
    let cases = items(field(&fixture, "cases"));
    assert!(!cases.is_empty(), "no cases");
    let mut failures = Vec::new();
    for c in cases {
        let name = text(field(c, "name"));
        let room = match field(c, "room") {
            Value::String(room) => {
                let raw = std::fs::read_to_string(
                    path("collab").join(room.to_string()).join("update.b64"),
                )
                .unwrap_or_else(|err| panic!("{name}: {err}"));
                decode64(raw.trim())
            }
            _ => decode64(&text(field(c, "roomUpdate"))),
        };
        let doc = Doc::new(Options::default());
        doc.apply_update(&room)
            .unwrap_or_else(|err| panic!("{name}: {err}"));

        let structure = describe_structure(&doc).unwrap_or_else(|err| panic!("{name}: {err}"));
        let mut keys = structure.keys.clone();
        keys.sort_by(|a, b| compare(&a.id, &b.id));
        let got: Vec<String> = keys.iter().map(shape_line).collect();
        let want: Vec<String> = items(field(field(c, "structure"), "keys"))
            .iter()
            .map(|k| {
                let parent = match field(k, "storedParent") {
                    Value::String(parent) => Some(parent.clone()),
                    _ => None,
                };
                shape_line(&KeyShape {
                    id: Str::from(text(field(k, "id"))),
                    is_block: matches!(field(k, "isBlock"), Value::Bool(true)),
                    stored_parent: parent,
                    listed: optional_strs(field(k, "listed")),
                })
            })
            .collect();
        if got != want {
            failures.push(format!("{name}: keys\n got {got:?}\nwant {want:?}"));
        }
        let order: Vec<String> = structure.root_order.iter().map(Str::to_string).collect();
        let want: Vec<String> = items(field(field(c, "structure"), "rootOrder"))
            .iter()
            .map(text)
            .collect();
        if order != want {
            failures.push(format!("{name}: order {order:?}, want {want:?}"));
        }
        // Asked per key, as the restore planner asks it.
        let reached: Vec<String> = keys
            .iter()
            .filter(|k| structure.reached(&k.id))
            .map(|k| k.id.to_string())
            .collect();
        let want: Vec<String> = items(field(field(c, "structure"), "reached"))
            .iter()
            .map(text)
            .collect();
        if reached != want {
            failures.push(format!("{name}: reached {reached:?}, want {want:?}"));
        }

        let mut names = Vec::new();
        let mut kinds: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
        let mut values: Vec<(String, Out)> = Vec::new();
        for m in read_page_maps(&doc).unwrap_or_else(|err| panic!("{name}: {err}")) {
            names.push(m.name);
            let mut entries = m.entries.clone();
            entries.sort_by(|a, b| compare(&a.0, &b.0));
            let map_kinds = kinds.entry(m.name.to_owned()).or_default();
            for (key, value) in entries {
                map_kinds.insert(key.to_string(), value_kind(&value));
                values.push((format!("{}.{key}", m.name), value));
            }
        }
        let want: BTreeMap<String, BTreeMap<String, String>> = match field(c, "pageMaps") {
            Value::Object(maps) => maps
                .members()
                .iter()
                .map(|m| {
                    let entries = match &m.value {
                        Value::Object(entries) => entries
                            .members()
                            .iter()
                            .map(|e| (e.key.to_string(), text(&e.value)))
                            .collect(),
                        _ => BTreeMap::new(),
                    };
                    (m.key.to_string(), entries)
                })
                .collect(),
            other => panic!("{name}: pageMaps {other:?}"),
        };
        if names != PAGE_MAPS || kinds != want {
            failures.push(format!("{name}: page maps\n got {kinds:?}\nwant {want:?}"));
        }
        let plain = plain_page_maps(&doc, &[]).unwrap_or_else(|err| panic!("{name}: {err}"));
        let (got, want) = (plain_maps_json(&plain), ordered(field(c, "plainPageMaps")));
        if got != want {
            failures.push(format!("{name}: plain\n got {got}\nwant {want}"));
        }
        let plain = plain_page_maps(&doc, &["title"]).unwrap_or_else(|err| panic!("{name}: {err}"));
        let (got, want) = (
            plain_maps_json(&plain),
            ordered(field(c, "plainPageMapsSkippingTitle")),
        );
        if got != want {
            failures.push(format!(
                "{name}: plain skipping title\n got {got}\nwant {want}"
            ));
        }
        let mut pairs = Vec::new();
        for i in 0..values.len() {
            for j in i + 1..values.len() {
                if plain_map_values_equal(&values[i].1, &values[j].1) {
                    pairs.push([values[i].0.clone(), values[j].0.clone()]);
                }
            }
        }
        let want: Vec<[String; 2]> = items(field(c, "equalPairs"))
            .iter()
            .map(|pair| {
                let pair = items(pair);
                [text(&pair[0]), text(&pair[1])]
            })
            .collect();
        if pairs != want {
            failures.push(format!(
                "{name}: equal pairs\n got {pairs:?}\nwant {want:?}"
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
