//! C# Blok.Server.Tests/Yjs cases with no Go twin, and the C# assertions
//! the Go twins leave out. The halves that pipe bytes through Node and real
//! yjs (NodeReplay.cs) are ignored: no Rust test starts Node.

use std::sync::{Arc, Mutex};

use blok_jsjson::{Str, Value};
use blok_lib0::Reader;
use blok_yjs_yjstest as yjstest;

use crate::content::Content;
use crate::decode_test::{re_encode, render_decoded};
use crate::scenario_test::{
    ScenarioRunner, build_value, render_value, scenario_named, step_update,
};
use crate::store::Store;
use crate::structstore_test::{chain, create_type};
use crate::test_support::*;
use crate::types::{MAX_TYPE_REF, TypeCore, TypeKind};
use crate::{Doc, In, Out, StructKind, UpdateEvent, XmlText, decode_state_vector};

fn record(doc: &Doc) -> Arc<Mutex<Vec<UpdateEvent>>> {
    let events: Arc<Mutex<Vec<UpdateEvent>>> = Arc::default();
    let sink = events.clone();
    let _ = doc.on_update(move |event| sink.lock().unwrap().push(event.clone()));
    events
}

// EncoderTests.NothingChangedEmitsNothing.
#[test]
fn nothing_changed_emits_nothing() {
    let c = scenario_named("out-of-order-delivery");
    let doc = doc_with_id(4242);
    apply_bytes(&doc, &step_update(&c, "s1"));
    let events = record(&doc);
    apply_bytes(&doc, &step_update(&c, "s1"));
    assert!(
        events.lock().unwrap().is_empty(),
        "a duplicate apply emitted"
    );
    assert!(doc.transact(|_| Ok(())).unwrap().is_none());
    assert!(events.lock().unwrap().is_empty());
}

// EncoderTests.ApplyEmitsTheAppliedChangeOnly, without its Node replay.
#[test]
fn apply_emits_the_applied_change_only() {
    let c = scenario_named("out-of-order-delivery");
    let doc = doc_with_id(4242);
    apply_bytes(&doc, &step_update(&c, "s1"));
    let events = record(&doc);
    apply_bytes(&doc, &step_update(&c, "s2"));
    let events = events.lock().unwrap();
    assert!(events.len() == 1 && !events[0].local, "{events:?}");
}

// EncoderTests.TransactionEmitsOneUpdateThatReplaysIntoYjs, without its
// Node replay.
#[test]
fn transaction_emits_one_update() {
    let doc = doc_with_id(4242);
    apply_bytes(
        &doc,
        &fixture_bytes(&fixture_case("structs.json", "map-set-any"), "update"),
    );
    let events = record(&doc);
    let m = doc.get_map("m").unwrap();
    let returned = doc
        .transact(|txn| m.set(txn, "engine", sv("written")))
        .unwrap()
        .unwrap();
    let events = events.lock().unwrap();
    assert!(events.len() == 1 && events[0].local && events[0].update == returned);
}

// EncoderTests.PendingWithGapsEncodesSkipsReadableByYjs, without its Node
// replay.
#[test]
fn pending_with_gaps_encodes_skips() {
    let c = scenario_named("engine-writes-while-pending");
    let mut runner = ScenarioRunner::new(c.clone());
    for step in &c.steps[..c.steps.len() - 2] {
        runner.run(step);
    }
    assert!(runner.doc.has_pending());
    let decoded = must_decode(&encode_state(&runner.doc, &[]));
    let group = decoded
        .groups
        .iter()
        .find(|g| g.client == 1000)
        .expect("client 1000");
    assert!(
        group.structs.iter().any(|d| d.kind == StructKind::Skip),
        "no Skip"
    );
    apply_bytes(&runner.doc, &step_update(&c, "s2"));
    assert!(!runner.doc.has_pending());
}

// YDocWriteTests.OneTransactionEmitsOneUpdateReadableByYjs, without its
// Node replay.
#[test]
fn one_transaction_emits_one_update() {
    let doc = doc_with_id(4242);
    let events = record(&doc);
    let (blocks, list, content) = (
        doc.get_map("blocks").unwrap(),
        doc.get_array("list").unwrap(),
        doc.get_text("content").unwrap(),
    );
    let returned = doc
        .transact(|txn| {
            blocks.set(txn, "title", sv("hello"))?;
            list.insert(txn, 0, vec![sv("a").into(), sv("b").into()])?;
            content.insert(Some(txn), 0, "text", None)
        })
        .unwrap()
        .unwrap();
    let events = events.lock().unwrap();
    assert!(events.len() == 1 && events[0].local && events[0].update == returned);
}

// YDocWriteTests.JsonNumbersAlwaysLowerToDouble, without its Node replay.
#[test]
fn json_numbers_always_lower_to_double() {
    let descriptor =
        blok_jsjson::parse(br#"{"i": 1, "f": 0.5, "wide": 2147483648, "deep": [7]}"#).unwrap();
    let In::Any(Value::Object(built)) = build_value(&descriptor) else {
        panic!("an object")
    };
    let get = |key: &str| built.get(&s(key)).cloned();
    assert_eq!(get("i"), Some(num(1.0)));
    assert_eq!(get("f"), Some(num(0.5)));
    assert_eq!(get("wide"), Some(num(2147483648.0)));
    assert_eq!(get("deep"), Some(Value::Array(vec![num(7.0)])));
    assert!(matches!(build_value(&num(1.0)), In::Any(Value::Number(_))));
}

// YDocWriteTests.TextSplitsOnSurrogatePairsLikeYjs, without its Node replay.
#[test]
fn text_splits_on_surrogate_pairs_like_yjs() {
    let doc = doc_with_id(4242);
    let text = doc.get_text("content").unwrap();
    doc.transact(|txn| text.insert(Some(txn), 0, "a😀b", None))
        .unwrap();
    doc.transact(|txn| text.delete(Some(txn), 1, 1)).unwrap();
    assert_eq!(
        text.units(),
        Str(vec![u16::from(b'a'), 0xfffd, u16::from(b'b')])
    );
}

// YDocWriteTests.TextRoundTripsThroughNode, without its Node replay.
#[test]
fn text_round_trips() {
    let doc = doc_with_id(4242);
    let text = doc.get_text("content").unwrap();
    let mut updates = 0;
    for write in 0..3 {
        let update = doc
            .transact(|txn| match write {
                0 => text.insert(Some(txn), 0, "hello world", None),
                1 => text.insert(Some(txn), 5, ",", None),
                _ => text.delete(Some(txn), 0, 1),
            })
            .unwrap();
        updates += usize::from(update.is_some());
    }
    assert_eq!(text.to_string(), "ello, world");
    assert_eq!(updates, 3);
}

// YTextFormattingTests.ToDeltaReadsAPeersFormatsAndEmbeds.
#[test]
fn to_delta_reads_a_peers_formats_and_embeds() {
    let c = scenario_named("text-format-and-embed");
    let mut runner = ScenarioRunner::new(c.clone());
    runner.run_all();
    let want = c
        .steps
        .iter()
        .rev()
        .find_map(|step| step.expect.as_ref().and_then(|e| e.json.clone()))
        .expect("an expected json");
    let want = yjstest::field(yjstest::field(&want, "content").unwrap(), "$text")
        .unwrap()
        .clone();
    let got: Vec<Value> = runner
        .doc
        .get_text("content")
        .unwrap()
        .to_delta()
        .into_iter()
        .map(|op| {
            let mut rendered = obj(vec![("insert", render_value(&op.insert))]);
            if let Some(attributes) = op.attributes {
                rendered.set(
                    s("attributes"),
                    render_value(&Out::Any(Value::Object(attributes))),
                );
            }
            Value::Object(rendered)
        })
        .collect();
    assert_eq!(canonical(&Value::Array(got)), canonical(&want));
}

// YTextFormattingTests.UndefinedAttributeIsRefused.
#[test]
fn undefined_attribute_is_refused() {
    let doc = doc_with_id(4242);
    let content = doc.get_text("content").unwrap();
    let marks = obj(vec![("bold", Value::Undefined)]);
    assert!(
        doc.transact(|txn| content.insert(Some(txn), 0, "a", Some(&marks)))
            .is_err()
    );
}

// YTextFormattingTests.QueuedWritesAreCheckedWhenMade, the rows Go leaves out.
#[test]
fn queued_writes_are_checked_when_made() {
    let text = XmlText::new(None);
    let undefined = obj(vec![("bold", Value::Undefined)]);
    let empty = obj(Vec::new());
    assert!(text.insert(None, 0, "a", Some(&undefined)).is_err());
    assert!(text.format(None, 0, 1, &undefined).is_err());
    assert!(
        text.insert_embed(None, 0, vobj(vec![("big", Value::BigInt(1))]), None)
            .is_err()
    );
    assert!(
        text.insert_embed(None, 0, vobj(vec![("page", sv("p"))]), Some(&undefined))
            .is_err()
    );
    assert!(text.insert(None, -1, "a", None).is_err());
    assert!(
        text.insert_embed(None, -1, Value::Object(empty.clone()), None)
            .is_err()
    );
    assert!(text.format(None, -1, 1, &empty).is_err());
    assert!(text.delete(None, -1, 1).is_err());
    let doc = doc_with_id(4242);
    let blocks = doc.get_map("blocks").unwrap();
    // Nothing bad was queued, so the text integrates cleanly.
    doc.transact(|txn| blocks.set(txn, "b1", &text)).unwrap();
    assert!(text.to_delta().is_empty());
}

// YDocWriteTests.InsertPacksConsecutiveAnys: the values read back.
#[test]
fn insert_packs_consecutive_anys_reads_back_every_value() {
    let doc = doc_with_id(4242);
    let list = doc.get_array("list").unwrap();
    let values = vec![sv("a"), num(1.0), Value::Bool(true), Value::Null];
    doc.transact(|txn| list.insert(txn, 0, values.iter().cloned().map(In::Any).collect()))
        .unwrap();
    assert_eq!(
        list.values(),
        values.into_iter().map(Out::Any).collect::<Vec<_>>()
    );
}

// EncoderTests.DecodeThenReencodeIsByteIdenticalWithoutMerging: the two yrs
// rows whose first rewrite differs reach a fixed point.
#[test]
fn rewriting_a_rewrite_is_a_fixed_point() {
    for name in ["array-kinds", "edit-metadata"] {
        let once = re_encode(&must_decode(&fixture_bytes(
            &fixture_case("yrs-compat.json", name),
            "update",
        )));
        let twice = re_encode(&must_decode(&once));
        assert_eq!(once, twice, "{name}");
        assert_eq!(
            canonical(&render_decoded(&must_decode(&once))),
            canonical(&render_decoded(&must_decode(&twice)))
        );
    }
}

// YrsCompatCorpusTests.EveryCorpusEntryNamesACollabFixture.
#[test]
fn every_corpus_entry_names_a_collab_fixture() {
    let cases = fixture_cases("yrs-compat.json");
    assert!(!cases.is_empty());
    let collab = yjstest::repo_root()
        .unwrap()
        .join("test/unit/server-conformance/fixtures/collab");
    for entry in cases {
        let name = yjstest::string(&entry, "name");
        assert!(
            collab.join(&name).is_dir(),
            "{name} names no collab fixture"
        );
        assert!(
            !fixture_bytes(&entry, "update").is_empty(),
            "{name}: empty update"
        );
    }
}

// StructStoreTests: the rows of FindLocates, CleanStart and SplitRepoints
// that Go leaves out.
#[test]
fn store_lookups_name_the_exact_struct() {
    let mut store = Store::new();
    add_item(
        &mut store,
        any_item(STORE_CLIENT, 0, vec![sv("a"), sv("b"), sv("c")]),
    );
    store
        .add_struct(crate::item::Struct::Gc(crate::Header {
            id: crate::Id::new(STORE_CLIENT, 3),
            length: 1,
        }))
        .unwrap();
    add_item(
        &mut store,
        any_item(STORE_CLIENT, 4, (0..5).map(|_| sv("x")).collect()),
    );
    assert_eq!(store.find_index(STORE_CLIENT, 8).unwrap(), 2);

    let mut split = Store::new();
    let left = add_item(
        &mut split,
        any_item(STORE_CLIENT, 0, (0..4).map(|_| sv("x")).collect()),
    );
    let right = split
        .get_item_clean_start(crate::Id::new(STORE_CLIENT, 3))
        .unwrap();
    let item = |id| crate::item::Struct::Item(id);
    assert_eq!(
        split.find(crate::Id::new(STORE_CLIENT, 2)).unwrap(),
        item(left)
    );
    assert_eq!(
        split.find(crate::Id::new(STORE_CLIENT, 3)).unwrap(),
        item(right)
    );
    assert_eq!(split.clients[&STORE_CLIENT], vec![item(left), item(right)]);

    let mut maps = Store::new();
    maps.types.push(TypeCore::new(TypeKind::Map));
    let mut head = any_item(STORE_CLIENT, 0, vec![sv("a"), sv("b")]);
    head.parent = crate::item::Parent::Type(0);
    head.parent_sub = Some(s("k"));
    let head = maps.alloc(head);
    maps.types[0].map_set_head(s("k"), head);
    let right = maps.split_at(head, 1).unwrap();
    assert_eq!(maps.items[right].parent_sub, Some(s("k")));
    assert!(!maps.items[right].deleted);
}

// StructStoreTests.ContentStringSplice: the rows Go leaves out.
#[test]
fn content_splice_keeps_both_halves() {
    let split = |mut content: Content, at| {
        let right = content.splice(at).unwrap();
        (content, right)
    };
    let (l, r) = split(Content::String(s("ab😀cd")), 3);
    let fffd = 0xfffd;
    assert!(
        matches!(&l, Content::String(t) if t.0 == vec![97, 98, fffd]),
        "{l:?}"
    );
    assert!(
        matches!(&r, Content::String(t) if t.0 == vec![fffd, 99, 100]),
        "{r:?}"
    );
    let (l, r) = split(Content::String(s("abcd")), 2);
    assert!(
        matches!(&l, Content::String(t) if *t == s("ab"))
            && matches!(&r, Content::String(t) if *t == s("cd"))
    );
    let (_, r) = split(Content::Any(vec![sv("a"), sv("b"), sv("c")]), 1);
    assert!(matches!(&r, Content::Any(items) if *items == vec![sv("b"), sv("c")]));
    let (_, r) = split(Content::Json(vec![s("1"), s("2"), s("3")]), 2);
    assert!(matches!(&r, Content::Json(raws) if *raws == vec![s("3")]));
    let (l, r) = split(Content::Deleted(5), 2);
    assert!(matches!((l, r), (Content::Deleted(2), Content::Deleted(3))));
    let typed = Content::Type(create_type(1, &s("p")).unwrap());
    assert!(split_err(typed));
    let format = Content::Format(Arc::new(crate::FormatContent::new(s("bold"), s("true"))));
    assert!(split_err(format));
}

fn split_err(mut content: Content) -> bool {
    content.splice(1).is_err()
}

// StructStoreTests.TextToStringSkipsFormatsAndEmbeds.
#[test]
fn text_to_string_skips_formats_and_embeds() {
    let doc = pinned_doc();
    let mut st = doc.lock();
    st.store.types.push(TypeCore::new(TypeKind::Text));
    let text = st.store.types.len() - 1;
    let ids: Vec<usize> = [
        item_with(STORE_CLIENT, 0, Content::String(s("Hel"))),
        item_with(
            STORE_CLIENT,
            3,
            Content::Format(Arc::new(crate::FormatContent::new(s("bold"), s("true")))),
        ),
        item_with(STORE_CLIENT, 4, Content::String(s("lo"))),
        item_with(
            STORE_CLIENT,
            6,
            Content::Embed(Arc::new(s(r#"{"image":1}"#))),
        ),
        {
            let mut gone = item_with(STORE_CLIENT, 7, Content::String(s(" gone")));
            gone.deleted = true;
            gone
        },
    ]
    .into_iter()
    .map(|item| st.store.alloc(item))
    .collect();
    chain(&mut st.store, text, &ids);
    assert_eq!(st.text_units(text).to_string(), "Hello");
    st.store.types.push(TypeCore::new(TypeKind::XmlText));
    let xml = st.store.types.len() - 1;
    let only = st
        .store
        .alloc(item_with(STORE_CLIENT + 1, 0, Content::String(s("xml"))));
    chain(&mut st.store, xml, &[only]);
    assert_eq!(st.text_units(xml).to_string(), "xml");
}

// StructStoreTests.CreateTypeCoversEveryTypeRef: the kind per ref and the
// two names.
#[test]
fn create_type_keeps_the_kind_and_the_names() {
    let kinds = [
        TypeKind::Array,
        TypeKind::Map,
        TypeKind::Text,
        TypeKind::XmlElement,
        TypeKind::XmlFragment,
        TypeKind::XmlHook,
        TypeKind::XmlText,
    ];
    for type_ref in 0..=MAX_TYPE_REF {
        assert_eq!(
            create_type(type_ref, &s("x")).unwrap().kind(),
            kinds[type_ref as usize]
        );
    }
    for (type_ref, name) in [(3u8, "div"), (5, "hook")] {
        let mut w = blok_lib0::Writer::new();
        Content::Type(create_type(type_ref, &s(name)).unwrap()).write(&mut w, 0);
        let read = crate::decode::read_content_type(&mut Reader::new(w.bytes())).unwrap();
        assert_eq!(read.name(), Some(&s(name)));
    }
}

// StateVectorTests: the rows Go leaves out.
#[test]
fn state_vector_reads_back_every_entry() {
    assert!(decode_state_vector(&[0]).unwrap().is_empty());
    for golden in crate::store_test::scenario_state_vectors(1) {
        let decoded = decode_state_vector(&golden).unwrap();
        let mut r = Reader::new(&golden);
        for _ in 0..r.read_var_uint().unwrap() {
            let client = r.read_var_uint().unwrap();
            assert_eq!(decoded.get(client), r.read_var_uint().unwrap());
        }
    }
}

#[test]
#[ignore = "needs node + yjs replay (EncoderTests.DiffAgainstAPeerVectorIsAcceptedByYjs)"]
fn diff_against_a_peer_vector_is_accepted_by_yjs() {}

#[test]
#[ignore = "needs node + yjs replay (EncoderTests.ForeignTextEmbedsAndFormatsSurviveTheOracle)"]
fn foreign_text_embeds_and_formats_survive_the_oracle() {}

#[test]
#[ignore = "needs node + yjs replay (EncoderTests.DiffAgainstAnEmptyVector)"]
fn diff_against_an_empty_vector_is_accepted_by_yjs() {}

#[test]
#[ignore = "needs node + yjs replay (EncoderTests: the Node halves of the emit and pending tests)"]
fn emitted_updates_replay_into_yjs() {}

#[test]
#[ignore = "needs node + yjs replay (FuzzCorpusTests: every seed through yjs)"]
fn every_fuzz_seed_replays_in_yjs() {}

#[test]
#[ignore = "needs node + yjs replay (YDocWriteTests: the Node halves)"]
fn local_writes_read_back_in_yjs() {}

#[test]
#[ignore = "needs node + yjs replay (YTextFormattingTests.FormattedWritesReadBackInYjs)"]
fn formatted_writes_read_back_in_yjs() {}

#[test]
#[ignore = "needs node + yjs replay (YjsEngineHarnessTests.NodeReplayAppliesAnEmptyUpdateAndReportsNoPending)"]
fn node_replay_applies_an_empty_update_and_reports_no_pending() {}

#[test]
#[ignore = "needs the collab converter (YrsCompatCorpusTests.CapturedUpdatesApplyIntoTheEngineAndExportTheCanonicalJson)"]
fn captured_updates_apply_into_the_engine_and_export_the_canonical_json() {}

// A room holds its document across awaits on a multi-thread runtime.
#[test]
fn documents_and_types_cross_threads() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<Doc>();
    assert_send_sync::<crate::TypeRef>();
    assert_send_sync::<crate::Map>();
    assert_send_sync::<XmlText>();
}

// Go's transact clears the open transaction in a defer: a body that panics
// must not leave every later transaction looking nested.
#[test]
fn a_panicking_body_leaves_no_transaction_open() {
    let doc = pinned_doc();
    let m = doc.get_map("m").unwrap();
    let caught = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = doc.transact(|txn| {
            m.set(txn, "a", num(1.0))?;
            panic!("the body fails");
        });
    }));
    assert!(caught.is_err());
    let update = doc.transact(|txn| m.set(txn, "b", num(2.0))).unwrap();
    assert!(update.is_some(), "a later transaction joined a dead one");
}

// C# (unchecked ulong) and Go (uint64) wrap clock + length - 1 on a
// length-0 item at clock 0, so a local write after one names origin
// 2^64-1, which no decoder reads back. Pinned as both servers behave.
#[test]
fn a_write_after_a_length_zero_head_wraps_its_origin() {
    let doc = pinned_doc();
    apply_bytes(&doc, &b64("AQHoBwAkAQFtAWsAAA=="));
    let m = doc.get_map("m").unwrap();
    let update = doc
        .transact(|txn| m.set(txn, "k", num(1.0)))
        .unwrap()
        .unwrap();
    let mut r = Reader::new(&update);
    for _ in 0..4 {
        r.read_var_uint().unwrap();
    }
    assert_eq!(
        r.read_uint8().unwrap() & crate::item::ORIGIN_BIT,
        crate::item::ORIGIN_BIT
    );
    assert_eq!(r.read_var_uint().unwrap(), 1000);
    let wrapped = &update[r.pos()..r.pos() + 10];
    assert_eq!(
        wrapped,
        &[0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]
    );
    assert!(
        crate::decode(&update)
            .unwrap_err()
            .to_string()
            .contains("above 2^53-1")
    );
}
