use std::collections::BTreeMap;

use blok_jsjson::{Str, Value};
use blok_lib0::Writer;
use blok_yjs_yjstest as yjstest;

use crate::content::Content;
use crate::integrator::to_runtime_struct;
use crate::item::ORIGIN_BIT;
use crate::item::PARENT_SUB_BIT;
use crate::test_support::*;
use crate::{DEFAULT_INSPECT_DEPTH, DecodedUpdate, Id, StructKind, Verdict, decode, inspect};

fn render_id(id: Option<Id>) -> Value {
    match id {
        None => Value::Null,
        Some(id) => vobj(vec![
            ("client", num(id.client as f64)),
            ("clock", num(id.clock as f64)),
        ]),
    }
}

pub fn render_content(content: &Content) -> Value {
    let mut rendered = obj(vec![("ref", num(f64::from(content.ref_number())))]);
    match content {
        Content::Deleted(ticks) => rendered.set(s("len"), num(*ticks as f64)),
        Content::Json(raws) => rendered.set(
            s("arr"),
            Value::Array(
                raws.iter()
                    .map(|raw| {
                        if raw.to_string() == "undefined" {
                            vobj(vec![("$undefined", Value::Bool(true))])
                        } else {
                            parse_raw(raw)
                        }
                    })
                    .collect(),
            ),
        ),
        Content::Binary(bytes) => rendered.set(s("bytes"), sv(&b64_encode(bytes))),
        Content::String(text) => rendered.set(s("str"), Value::String(text.clone())),
        Content::Embed(json) => rendered.set(s("embed"), parse_raw(json)),
        Content::Format(format) => {
            rendered.set(s("key"), Value::String(format.key.clone()));
            rendered.set(s("value"), parse_raw(&format.json));
        }
        Content::Type(handle) => {
            let type_ref = handle.kind().ref_number();
            rendered.set(s("typeRef"), num(f64::from(type_ref)));
            if let Some(name) = handle.name() {
                let key = if type_ref == 3 {
                    "nodeName"
                } else {
                    "hookName"
                };
                rendered.set(s(key), Value::String(name.clone()));
            }
        }
        Content::Any(items) => rendered.set(
            s("arr"),
            Value::Array(items.iter().map(yjstest::to_fixture).collect()),
        ),
        Content::Doc(doc) => {
            rendered.set(s("guid"), Value::String(doc.guid.clone()));
            rendered.set(s("opts"), yjstest::to_fixture(&doc.options));
        }
    }
    Value::Object(rendered)
}

pub fn render_decoded(update: &DecodedUpdate) -> Value {
    let mut structs = Vec::new();
    for group in &update.groups {
        for d in &group.structs {
            let kind = match d.kind {
                StructKind::Item => "item",
                StructKind::Gc => "gc",
                StructKind::Skip => "skip",
            };
            let mut rendered = obj(vec![
                ("kind", sv(kind)),
                ("client", num(d.id.client as f64)),
                ("clock", num(d.id.clock as f64)),
                ("length", num(d.length as f64)),
            ]);
            if d.kind == StructKind::Item {
                rendered.set(s("origin"), render_id(d.origin));
                rendered.set(s("rightOrigin"), render_id(d.right_origin));
                let parent = match (&d.parent_root, d.parent_id) {
                    (Some(root), _) => vobj(vec![("root", Value::String(root.clone()))]),
                    (None, Some(id)) => vobj(vec![("item", render_id(Some(id)))]),
                    _ => Value::Null,
                };
                rendered.set(s("parent"), parent);
                rendered.set(
                    s("parentSub"),
                    d.parent_sub.clone().map_or(Value::Null, Value::String),
                );
                rendered.set(s("content"), render_content(d.content.as_ref().unwrap()));
            }
            structs.push(Value::Object(rendered));
        }
    }
    let mut delete_set = blok_jsjson::Object::new();
    for client in update.delete_set.clients() {
        let ranges = update
            .delete_set
            .ranges(client)
            .iter()
            .map(|r| Value::Array(vec![num(r.clock as f64), num(r.length as f64)]))
            .collect();
        delete_set.set(Str::from(client.to_string()), Value::Array(ranges));
    }
    vobj(vec![
        ("structs", Value::Array(structs)),
        ("deleteSet", Value::Object(delete_set)),
    ])
}

/// Writes a decoded update back through the engine's own struct writers,
/// groups in the update's order.
pub fn re_encode(update: &DecodedUpdate) -> Vec<u8> {
    let mut w = Writer::new();
    w.write_var_uint(update.groups.len() as u64);
    for group in &update.groups {
        w.write_var_uint(group.structs.len() as u64);
        w.write_var_uint(group.client);
        w.write_var_uint(group.structs.first().map_or(0, |d| d.id.clock));
        for d in &group.structs {
            to_runtime_struct(d).write(&mut w, 0, &[]).unwrap();
        }
    }
    update.delete_set.write(&mut w);
    w.into_bytes()
}

#[test]
fn decodes_every_structs_golden() {
    let cases = fixture_cases("structs.json");
    assert!(!cases.is_empty(), "no structs cases");
    let mut failures = Vec::new();
    for c in &cases {
        let name = yjstest::string(c, "name");
        let decoded = must_decode(&fixture_bytes(c, "update"));
        let got = canonical(&render_decoded(&decoded));
        let want = canonical(yjstest::field(c, "decoded").unwrap());
        if got != want {
            failures.push(format!("{name}:\n got {got}\nwant {want}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

fn reason_text(reason: &str) -> &'static str {
    match reason {
        "eos" => "remain",
        "integer-out-of-range" => "above 2^53-1",
        "invalid-utf8" => "is not UTF-8",
        "trailing-bytes" => "follow the delete set",
        "duplicate-client" => "is listed twice",
        "unknown-content-ref" => "is not an item content ref",
        "v2-update" => "follow the delete set",
        "empty-struct" => "has length 0",
        other => panic!("{other} is not a known reason"),
    }
}

#[test]
fn rejects_every_negative_golden() {
    let cases = fixture_cases("negative.json");
    assert_eq!(cases.len(), 9, "want 9 negative cases");
    let mut failures = Vec::new();
    for c in &cases {
        let name = yjstest::string(c, "name");
        let want = reason_text(&yjstest::string(c, "reason"));
        let update = fixture_bytes(c, "update");
        match decode(&update) {
            Err(err) if err.to_string().contains(want) => {}
            other => failures.push(format!(
                "{name}: got {other:?}, want a format error containing {want:?}"
            )),
        }
        let inspection = inspect(&update, DEFAULT_INSPECT_DEPTH);
        if inspection.verdict != Verdict::Malformed
            || inspection.reason.is_empty()
            || inspection.decoded.is_some()
        {
            failures.push(format!("{name}: inspection {inspection:?}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

// yrs writes these two with integer tags yjs would write as floats, so
// only their decoded form survives a rewrite.
const YRS_INTEGER_TAG_CASES: [&str; 2] = ["array-kinds", "edit-metadata"];

#[test]
fn decode_then_write_is_byte_identical() {
    let mut failures = Vec::new();
    for file in ["structs.json", "yrs-compat.json"] {
        for c in fixture_cases(file) {
            let name = yjstest::string(&c, "name");
            let update = fixture_bytes(&c, "update");
            let decoded = must_decode(&update);
            let written = re_encode(&decoded);
            if (file == "structs.json" || !YRS_INTEGER_TAG_CASES.contains(&name.as_str()))
                && written != update
            {
                failures.push(format!("{file}:{name}: rewrite differs"));
            }
            if canonical(&render_decoded(&decoded))
                != canonical(&render_decoded(&must_decode(&written)))
            {
                failures.push(format!("{file}:{name}: rewrite decodes differently"));
            }
            if file == "yrs-compat.json" && decoded.contains_nul() {
                failures.push(format!("{name}: decoded a NUL its seed refused"));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

pub fn collab_updates() -> BTreeMap<String, Vec<u8>> {
    let root = yjstest::repo_root().unwrap();
    let dir = root.join("test/unit/server-conformance/fixtures/collab");
    let mut updates = BTreeMap::new();
    for entry in std::fs::read_dir(&dir).unwrap() {
        let entry = entry.unwrap();
        if !entry.file_type().unwrap().is_dir() {
            continue;
        }
        let text = std::fs::read_to_string(entry.path().join("update.b64")).unwrap();
        // Go's base64 decoder skips the line breaks these files carry.
        let text: String = text.chars().filter(|c| *c != '\n' && *c != '\r').collect();
        updates.insert(entry.file_name().to_string_lossy().into_owned(), b64(&text));
    }
    assert_eq!(updates.len(), 37, "want 37 collab fixtures");
    updates
}

#[test]
fn decodes_and_inspects_every_collab_fixture() {
    let mut failures = Vec::new();
    for (name, update) in collab_updates() {
        if re_encode(&must_decode(&update)) != update {
            failures.push(format!("{name}: rewrite differs"));
        }
        let inspection = inspect(&update, DEFAULT_INSPECT_DEPTH);
        if inspection.verdict != Verdict::Ok
            || !inspection.reason.is_empty()
            || inspection.decoded.is_none()
        {
            failures.push(format!(
                "{name}: inspection {:?} {}",
                inspection.verdict, inspection.reason
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn parent_is_absent_when_an_origin_bit_is_set() {
    let decoded = must_decode(&fixture_bytes(
        &fixture_case("structs.json", "map-key-overwrite"),
        "update",
    ));
    let overwrite = &decoded.groups[0].structs[1];
    assert!(overwrite.origin.is_some());
    assert!(
        overwrite.parent_root.is_none()
            && overwrite.parent_id.is_none()
            && overwrite.parent_sub.is_none()
    );
    assert!(
        overwrite.info & PARENT_SUB_BIT != 0 && overwrite.info & ORIGIN_BIT != 0,
        "info {:x}",
        overwrite.info
    );
}

/// One struct for client 1000 at clock 0, then an empty delete set.
pub fn raw_struct(info: u8, body: impl FnOnce(&mut Writer)) -> Vec<u8> {
    let mut w = Writer::new();
    w.write_var_uint(1);
    w.write_var_uint(1);
    w.write_var_uint(PINNED_CLIENT);
    w.write_var_uint(0);
    w.write_uint8(info);
    body(&mut w);
    w.write_var_uint(0);
    w.into_bytes()
}

pub fn single_struct(
    content_ref: u8,
    root: &str,
    parent_sub: Option<&str>,
    content: impl FnOnce(&mut Writer),
) -> Vec<u8> {
    let mut info = content_ref;
    if parent_sub.is_some() {
        info |= PARENT_SUB_BIT;
    }
    raw_struct(info, |w| {
        w.write_var_uint(1);
        w.write_var_string(&s(root));
        if let Some(sub) = parent_sub {
            w.write_var_string(&s(sub));
        }
        content(w);
    })
}

fn map_key(key: &str, value: &str, root: &str) -> Vec<u8> {
    single_struct(0x08, root, Some(key), |w| {
        w.write_var_uint(1);
        blok_lib0::write_any(w, &sv(value));
    })
}

fn assert_refused(reason: &str, update: &[u8]) {
    match decode(update) {
        Err(err) if err.to_string().contains(reason) => {}
        other => panic!("got {other:?}, want a format error containing {reason:?}"),
    }
}

#[test]
fn skip_length_is_a_raw_var_uint() {
    let mut w = Writer::new();
    w.write_var_uint(1);
    w.write_var_uint(2);
    w.write_var_uint(PINNED_CLIENT);
    w.write_var_uint(0);
    w.write_uint8(10);
    w.write_var_uint(300);
    w.write_uint8(0x08);
    w.write_var_uint(1);
    w.write_var_string(&s("m"));
    w.write_var_uint(1);
    blok_lib0::write_any(&mut w, &sv("v"));
    w.write_var_uint(0);
    let decoded = must_decode(w.bytes());
    let structs = &decoded.groups[0].structs;
    assert!(
        structs[0].kind == StructKind::Skip
            && structs[0].length == 300
            && structs[1].id.clock == 300
    );
}

fn nul_bearing_updates() -> Vec<(&'static str, Vec<u8>)> {
    vec![
        ("a root name", map_key("k", "v", "r\0t")),
        ("a parentSub", map_key("k\0", "v", "m")),
        ("an Any string leaf", map_key("k", "v\0v", "m")),
        (
            "an Any object key",
            single_struct(0x08, "m", Some("k"), |w| {
                w.write_var_uint(1);
                w.write_uint8(118);
                w.write_var_uint(1);
                w.write_var_string(&s("n\0l"));
                w.write_uint8(126);
            }),
        ),
        (
            "ContentString",
            single_struct(0x04, "t", None, |w| w.write_var_string(&s("a\0b"))),
        ),
        (
            "a ContentFormat key",
            single_struct(0x06, "t", None, |w| {
                w.write_var_string(&s("b\0d"));
                w.write_var_string(&s("true"));
            }),
        ),
        (
            "an XmlElement node name",
            single_struct(0x07, "m", Some("k"), |w| {
                w.write_var_uint(3);
                w.write_var_string(&s("d\0v"));
            }),
        ),
        (
            "a ContentDoc guid",
            single_struct(0x09, "m", Some("k"), |w| {
                w.write_var_string(&s("g\0d"));
                w.write_uint8(118);
                w.write_var_uint(0);
            }),
        ),
    ]
}

fn json_payload_updates() -> Vec<(&'static str, Vec<u8>)> {
    vec![
        (
            "a ContentEmbed payload",
            single_struct(0x05, "t", None, |w| w.write_var_string(&s(r#""a\u0000b""#))),
        ),
        (
            "a ContentJSON payload",
            single_struct(0x02, "m", Some("k"), |w| {
                w.write_var_uint(1);
                w.write_var_string(&s(r#""a\u0000b""#));
            }),
        ),
    ]
}

#[test]
fn contains_nul_sees_keys_values_and_parent_sub() {
    assert!(
        !must_decode(&map_key("k", "v", "m")).contains_nul(),
        "a NUL-free update reports one"
    );
    for (what, update) in nul_bearing_updates() {
        assert!(
            must_decode(&update).contains_nul(),
            "the NUL in {what} went unseen"
        );
    }
    let canary = b64(concat!(
        "AQfV8oK8AwAnAQZibG9ja3MDYQBiASgA1fKCvAMAAmlkAXcDYQBiKADV8oK8AwAE",
        "dHlwZQF3CXBhcmFncmFwaCcA1fKCvAMABGRhdGEBJwDV8oK8AwAKY29udGVudElk",
        "cwAoANXygrwDAwR0ZXh0AXcBeAgBBHJvb3QBdwNhAGIA"
    ));
    let inspection = inspect(&canary, DEFAULT_INSPECT_DEPTH);
    assert!(inspection.verdict == Verdict::Ok && inspection.decoded.unwrap().contains_nul());
}

#[test]
fn every_hand_built_content_ref_survives_a_write_back() {
    for (what, update) in nul_bearing_updates()
        .into_iter()
        .chain(json_payload_updates())
    {
        assert_eq!(
            re_encode(&must_decode(&update)),
            update,
            "the update carrying {what} did not write back byte for byte"
        );
    }
}

#[test]
fn content_writes_only_the_tail_at_an_offset() {
    let cases = vec![
        (Content::String(s("hello")), Content::String(s("llo"))),
        (
            Content::Any(vec![sv("a"), sv("b"), sv("c")]),
            Content::Any(vec![sv("c")]),
        ),
        (
            Content::Json(vec![s("1"), s("2"), s("3")]),
            Content::Json(vec![s("3")]),
        ),
        (Content::Deleted(5), Content::Deleted(3)),
    ];
    for (whole, tail) in cases {
        let (mut written, mut expected) = (Writer::new(), Writer::new());
        whole.write(&mut written, 2);
        tail.write(&mut expected, 0);
        assert_eq!(written.bytes(), expected.bytes(), "{whole:?}");
    }
}

#[test]
fn refuses_wire_values_no_encoder_writes() {
    assert_refused(
        "the parent info",
        &raw_struct(0x08, |w| {
            w.write_var_uint(2);
            w.write_var_string(&s("m"));
            w.write_var_uint(1);
            blok_lib0::write_any(w, &sv("v"));
        }),
    );
    assert_refused(
        "is not a shared type ref",
        &single_struct(0x07, "m", Some("k"), |w| w.write_var_uint(7)),
    );
    assert_refused(
        "past int.MaxValue",
        &raw_struct(0, |w| w.write_var_uint(1 << 32)),
    );
    // The boundary: 2^31-1 reads, 2^31 does not.
    assert_refused(
        "past int.MaxValue",
        &raw_struct(0, |w| w.write_var_uint(1 << 31)),
    );
    decode(&raw_struct(0, |w| w.write_var_uint((1 << 31) - 1))).unwrap();
    assert_refused(
        "subdocument options",
        &single_struct(0x09, "m", Some("k"), |w| {
            w.write_var_string(&s("g"));
            w.write_uint8(126);
        }),
    );
    assert_refused(
        "subdocument options",
        &single_struct(0x09, "m", Some("k"), |w| {
            w.write_var_string(&s("g"));
            w.write_uint8(127);
        }),
    );
}

#[test]
fn refuses_raw_json_content_no_yjs_peer_can_parse() {
    assert_refused(
        "is not JSON",
        &single_struct(0x02, "m", Some("k"), |w| {
            w.write_var_uint(1);
            w.write_var_string(&s("{not json"));
        }),
    );
    assert_refused(
        "is not JSON",
        &single_struct(0x05, "m", Some("k"), |w| w.write_var_string(&s("nope"))),
    );
    assert_refused(
        "is not JSON",
        &single_struct(0x06, "m", Some("k"), |w| {
            w.write_var_string(&s("bold"));
            w.write_var_string(&s("nope"));
        }),
    );
}

fn embed_update(json: &str) -> Vec<u8> {
    single_struct(0x05, "m", Some("k"), |w| w.write_var_string(&s(json)))
}

#[test]
fn accepts_every_raw_json_payload_a_browser_accepts() {
    for json in [
        r#""\ud800""#,
        r#"{"a":1,"a":2}"#,
        "1e999",
        "[[[[[[[[[[1]]]]]]]]]]",
        r#""undefined""#,
    ] {
        decode(&embed_update(json)).unwrap_or_else(|err| panic!("{json}: {err}"));
    }
}

#[test]
fn raw_json_depth_is_512() {
    let deep = |depth: usize| format!("{}1{}", "[".repeat(depth), "]".repeat(depth));
    let decoded = decode(&embed_update(&deep(512))).expect("512");
    let values = decoded.groups[0].structs[0]
        .content
        .as_ref()
        .unwrap()
        .values();
    assert!(!values.is_empty(), "512: no value read back");
    assert_refused("is not JSON", &embed_update(&deep(513)));
}

#[test]
fn wire_json_reads_back_as_engine_values_even_with_a_lone_surrogate() {
    let embed = Content::Embed(std::sync::Arc::new(s(r#""\ud800""#))).values();
    assert_eq!(embed[0].as_value(), Some(&Value::String(Str(vec![0xd800]))));
    let legacy = Content::Json(vec![s(r#"{"a":"\ud800"}"#), s("[1,2]"), s("undefined")]).values();
    assert_eq!(
        blok_jsjson::stringify(legacy[0].as_value().unwrap()).unwrap(),
        r#"{"a":"\ud800"}"#
    );
    assert_eq!(
        blok_jsjson::stringify(legacy[1].as_value().unwrap()).unwrap(),
        "[1,2]"
    );
    assert_eq!(legacy[2].as_value(), Some(&Value::Undefined));
}

fn nested_array_update(depth: usize) -> Vec<u8> {
    let mut w = Writer::new();
    w.write_var_uint(1);
    w.write_var_uint(1);
    w.write_var_uint(PINNED_CLIENT);
    w.write_var_uint(0);
    w.write_uint8(0x28);
    w.write_var_uint(1);
    w.write_var_string(&s("m"));
    w.write_var_string(&s("k"));
    w.write_var_uint(1);
    for _ in 0..depth {
        w.write_uint8(117);
        w.write_var_uint(1);
    }
    w.write_uint8(126);
    w.write_var_uint(0);
    w.into_bytes()
}

#[test]
fn too_deep_past_the_cap() {
    let at_cap = inspect(
        &nested_array_update(DEFAULT_INSPECT_DEPTH),
        DEFAULT_INSPECT_DEPTH,
    );
    assert!(
        at_cap.verdict == Verdict::Ok
            && at_cap.decoded.unwrap().max_nesting_depth == DEFAULT_INSPECT_DEPTH
    );
    let past = inspect(
        &nested_array_update(DEFAULT_INSPECT_DEPTH + 1),
        DEFAULT_INSPECT_DEPTH,
    );
    assert!(past.verdict == Verdict::TooDeep && !past.reason.is_empty() && past.decoded.is_none());
    assert_eq!(
        inspect(
            &nested_array_update(DEFAULT_INSPECT_DEPTH + 1),
            DEFAULT_INSPECT_DEPTH + 1
        )
        .verdict,
        Verdict::Ok,
        "the cap is the caller's"
    );
}
