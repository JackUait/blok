//! C# Blok.Server.Tests/Yjs cases, the C# assertions older twins left out,
//! and the halves that pipe bytes through Node and real yjs (NodeReplay.cs).

use std::sync::{Arc, Mutex};

use blok_jsjson::{Object, Str, Value};
use blok_lib0::Reader;
use blok_yjs_yjstest as yjstest;

use crate::content::Content;
use crate::decode_test::{re_encode, render_decoded};
use crate::scenario_test::{
    ScenarioCase, ScenarioRunner, build_value, merge_text_runs, render, render_value,
    scenario_named, step_update,
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
        doc.transact(|txn| content.insert(Some(txn), 0, "a", Some(&crate::marks(&marks))))
            .is_err()
    );
}

// YTextFormattingTests.QueuedWritesAreCheckedWhenMade, the rows Go leaves out.
#[test]
fn queued_writes_are_checked_when_made() {
    let text = XmlText::new(None);
    let undefined = obj(vec![("bold", Value::Undefined)]);
    let empty = obj(Vec::new());
    assert!(
        text.insert(None, 0, "a", Some(&crate::marks(&undefined)))
            .is_err()
    );
    assert!(text.format(None, 0, 1, &crate::marks(&undefined)).is_err());
    assert!(
        text.insert_embed(None, 0, vobj(vec![("big", Value::BigInt(1))]), None)
            .is_err()
    );
    assert!(
        text.insert_embed(
            None,
            0,
            vobj(vec![("page", sv("p"))]),
            Some(&crate::marks(&undefined))
        )
        .is_err()
    );
    assert!(text.insert(None, -1, "a", None).is_err());
    assert!(
        text.insert_embed(None, -1, Value::Object(empty.clone()), None)
            .is_err()
    );
    assert!(text.format(None, -1, 1, &crate::marks(&empty)).is_err());
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

// The engine -> Node direction of the interop law (C# NodeReplay.cs): bytes
// the engine wrote are applied by real yjs through
// scripts/replay-yjs-update.mjs, and yjs must render what the engine
// renders. Like C#, a missing node or yjs fails the test: CI installs both
// before the Rust job runs.
struct NodeReplay {
    json: Value,
    sv: Vec<u8>,
    has_pending: bool,
    diff: Option<Vec<u8>>,
}

fn node_replay(roots: &[(String, String)], updates: &[Vec<u8>]) -> NodeReplay {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let mut named = Object::new();
    for (name, kind) in roots {
        named.set(s(name), sv(kind));
    }
    let roots = Value::Object(named);
    let updates = Value::Array(updates.iter().map(|u| sv(&b64_encode(u))).collect());
    let request = blok_jsjson::stringify(&vobj(vec![
        ("roots", roots),
        ("updates", updates),
        ("stateVectorFor", Value::Null),
    ]))
    .unwrap();
    let mut child = Command::new("node")
        .arg("scripts/replay-yjs-update.mjs")
        .current_dir(yjstest::repo_root().unwrap())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap_or_else(|err| panic!("could not start node: {err}"));
    child
        .stdin
        .take()
        .unwrap()
        .write_all(request.as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "node exited {}: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
    let replay = blok_jsjson::parse(output.stdout.trim_ascii()).unwrap();
    let diff = match yjstest::field(&replay, "diff") {
        Some(Value::String(diff)) => Some(b64(&diff.to_string())),
        _ => None,
    };
    NodeReplay {
        json: yjstest::field(&replay, "json")
            .expect("the replay script printed no json")
            .clone(),
        sv: b64(&yjstest::string(&replay, "sv")),
        has_pending: match yjstest::field(&replay, "hasPending") {
            Some(Value::Bool(pending)) => *pending,
            other => panic!("the replay script printed hasPending {other:?}"),
        },
        diff,
    }
}

fn roots(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
    pairs
        .iter()
        .map(|(name, kind)| (name.to_string(), kind.to_string()))
        .collect()
}

#[track_caller]
fn same_json(what: &str, engine: &Value, replayed: &Value) {
    assert_eq!(canonical(engine), canonical(replayed), "{what}");
}

/// Runs each case on its own thread, four at a time: one node start costs
/// about 90 ms.
fn each_case(cases: Vec<ScenarioCase>, check: fn(ScenarioCase)) {
    let chunks: Vec<Vec<ScenarioCase>> = cases
        .chunks(cases.len().div_ceil(4))
        .map(<[_]>::to_vec)
        .collect();
    std::thread::scope(|scope| {
        for chunk in chunks {
            scope.spawn(move || chunk.into_iter().for_each(check));
        }
    });
}

fn replays_whole(c: ScenarioCase) {
    let mut runner = ScenarioRunner::new(c);
    runner.run_all();
    assert!(runner.failures.is_empty(), "{:?}", runner.failures);
    let c = &runner.c;
    let replay = node_replay(&c.roots, &[encode_state(&runner.doc, &[])]);
    same_json(&c.name, &render(&runner.doc, &c.roots), &replay.json);
    assert_eq!(runner.doc.encode_state_vector(), replay.sv, "{}", c.name);
    assert_eq!(runner.doc.has_pending(), replay.has_pending, "{}", c.name);
}

// YjsEngineHarnessTests.NodeReplayAppliesAnEmptyUpdateAndReportsNoPending.
#[test]
fn node_replay_applies_an_empty_update_and_reports_no_pending() {
    let result = node_replay(&roots(&[("m", "map")]), &[vec![0, 0]]);
    assert_eq!(canonical(&result.json), r#"{"m":{}}"#);
    assert_eq!(result.sv, vec![0]);
    assert!(!result.has_pending);
    assert!(result.diff.is_none());
}

// EncoderTests.DiffAgainstAnEmptyVectorReplaysIntoYjsWithIdenticalJson.
#[test]
fn diff_against_an_empty_vector_is_accepted_by_yjs() {
    each_case(crate::scenario_test::scenarios(), replays_whole);
}

// EncoderTests.DiffAgainstAPeerVectorIsAcceptedByYjs: a snapshot taken half
// way plus the diff against its vector is the whole document.
#[test]
fn diff_against_a_peer_vector_is_accepted_by_yjs() {
    each_case(crate::scenario_test::scenarios(), |c| {
        let mut runner = ScenarioRunner::new(c.clone());
        let half = c.steps.len() / 2;
        for step in &c.steps[..half] {
            runner.run(step);
        }
        let at_half = encode_state(&runner.doc, &[]);
        let peer = runner.doc.encode_state_vector();
        for step in &c.steps[half..] {
            runner.run(step);
        }
        let replay = node_replay(&c.roots, &[at_half, encode_state(&runner.doc, &peer)]);
        same_json(&c.name, &render(&runner.doc, &c.roots), &replay.json);
        assert_eq!(runner.doc.encode_state_vector(), replay.sv, "{}", c.name);
    });
}

// FuzzCorpusTests.EverySeedMatchesTheYjsOracleAtEveryStep, the Node half.
#[test]
fn every_fuzz_seed_replays_in_yjs() {
    let seeds = crate::scenario_test::fuzz_seeds();
    assert_eq!(seeds.len(), 50);
    each_case(seeds, replays_whole);
}

// EncoderTests.ForeignTextEmbedsAndFormatsSurviveTheOracle.
#[test]
fn foreign_text_embeds_and_formats_survive_the_oracle() {
    let c = fixture_case("structs.json", "text-insert-format-embed");
    let roots = crate::scenario_test::roots_of(yjstest::field(&c, "roots").unwrap());
    let doc = doc_with_id(4242);
    apply_bytes(&doc, &fixture_bytes(&c, "update"));
    let replay = node_replay(&roots, &[encode_state(&doc, &[])]);
    same_json("json", &render(&doc, &roots), &replay.json);
}

// The Node halves of EncoderTests TransactionEmitsOneUpdateThatReplaysIntoYjs,
// ApplyEmitsTheAppliedChangeOnly and PendingWithGapsEncodesSkipsReadableByYjs.
#[test]
fn emitted_updates_replay_into_yjs() {
    let structs = fixture_case("structs.json", "map-set-any");
    let seed = fixture_bytes(&structs, "update");
    let map_roots = crate::scenario_test::roots_of(yjstest::field(&structs, "roots").unwrap());
    let doc = doc_with_id(4242);
    apply_bytes(&doc, &seed);
    let m = doc.get_map("m").unwrap();
    let written = doc
        .transact(|txn| m.set(txn, "engine", sv("written")))
        .unwrap()
        .unwrap();
    let replay = node_replay(&map_roots, &[seed, written]);
    same_json("local write", &render(&doc, &map_roots), &replay.json);

    let c = scenario_named("out-of-order-delivery");
    let doc = doc_with_id(4242);
    let first = step_update(&c, "s1");
    apply_bytes(&doc, &first);
    let events = record(&doc);
    apply_bytes(&doc, &step_update(&c, "s2"));
    let applied = events.lock().unwrap()[0].update.clone();
    let replay = node_replay(&c.roots, &[first, applied]);
    same_json("applied change", &render(&doc, &c.roots), &replay.json);

    let c = scenario_named("engine-writes-while-pending");
    let mut runner = ScenarioRunner::new(c.clone());
    for step in &c.steps[..c.steps.len() - 2] {
        runner.run(step);
    }
    let pending = encode_state(&runner.doc, &[]);
    let replay = node_replay(&c.roots, std::slice::from_ref(&pending));
    assert!(replay.has_pending, "yjs parked nothing");
    same_json("pending", &render(&runner.doc, &c.roots), &replay.json);
    let closing = step_update(&c, "s2");
    apply_bytes(&runner.doc, &closing);
    let converged = node_replay(&c.roots, &[pending, closing]);
    assert!(!runner.doc.has_pending() && !converged.has_pending);
    same_json("converged", &render(&runner.doc, &c.roots), &converged.json);
}

// The Node halves of YDocWriteTests.
#[test]
fn local_writes_read_back_in_yjs() {
    let every = roots(&[("blocks", "map"), ("list", "array"), ("content", "text")]);
    let doc = doc_with_id(4242);
    let (blocks, list, content) = (
        doc.get_map("blocks").unwrap(),
        doc.get_array("list").unwrap(),
        doc.get_text("content").unwrap(),
    );
    let written = doc
        .transact(|txn| {
            blocks.set(txn, "title", sv("hello"))?;
            list.insert(txn, 0, vec![sv("a").into(), sv("b").into()])?;
            content.insert(Some(txn), 0, "text", None)
        })
        .unwrap()
        .unwrap();
    let replay = node_replay(&every, &[written]);
    same_json("one transaction", &render(&doc, &every), &replay.json);
    assert_eq!(doc.encode_state_vector(), replay.sv);

    // PrelimMapIntegratesWithItsParent, SetAdmitsUndefined and
    // JsonNumbersAlwaysLowerToDouble.
    let map_root = roots(&[("blocks", "map")]);
    let numbers =
        blok_jsjson::parse(br#"{"i": 1, "f": 0.5, "wide": 2147483648, "deep": [7]}"#).unwrap();
    for (name, value) in [
        (
            "prelim",
            In::from(crate::Map::new(vec![
                crate::MapEntry::new("title", sv("first")),
                crate::MapEntry::new(
                    "tags",
                    crate::Array::new(vec![sv("a").into(), sv("b").into()]),
                ),
            ])),
        ),
        ("undefined", In::Any(Value::Undefined)),
        ("numbers", build_value(&numbers)),
    ] {
        let doc = doc_with_id(4242);
        let blocks = doc.get_map("blocks").unwrap();
        let written = doc
            .transact(|txn| blocks.set(txn, name, value))
            .unwrap()
            .unwrap();
        same_json(
            name,
            &render(&doc, &map_root),
            &node_replay(&map_root, &[written]).json,
        );
    }

    // TextWritesMatchYjs.
    for name in [
        "nul-and-astral-strings",
        "text-format-and-embed",
        "formatted-text-engine-writes",
        "formatted-text-prelim-queue",
        "formatted-text-link-key-order",
        "formatted-text-equal-links-cleanup",
        "formatted-text-remote-cleanup",
    ] {
        let mut runner = ScenarioRunner::new(scenario_named(name));
        runner.run_all();
        assert!(runner.checks > 0 && runner.failures.is_empty(), "{name}");
        let c = &runner.c;
        let mut rendered = render(&runner.doc, &c.roots);
        let mut replayed = node_replay(&c.roots, &[encode_state(&runner.doc, &[])]).json;
        if c.segments {
            rendered = merge_text_runs(&rendered);
            replayed = merge_text_runs(&replayed);
        }
        same_json(name, &rendered, &replayed);
    }

    // TextSplitsOnSurrogatePairsLikeYjs and TextRoundTripsThroughNode.
    let text_root = roots(&[("content", "text")]);
    for writes in [
        vec![(0, "insert", "a😀b", 0), (1, "delete", "", 1)],
        vec![
            (0, "insert", "hello world", 0),
            (5, "insert", ",", 0),
            (0, "delete", "", 1),
        ],
    ] {
        let doc = doc_with_id(4242);
        let text = doc.get_text("content").unwrap();
        let mut updates = Vec::new();
        for (index, kind, chunk, length) in writes {
            let update = doc
                .transact(|txn| match kind {
                    "insert" => text.insert(Some(txn), index, chunk, None),
                    _ => text.delete(Some(txn), index, length),
                })
                .unwrap()
                .unwrap();
            updates.push(update);
        }
        let replay = node_replay(&text_root, &updates);
        same_json("text", &render(&doc, &text_root), &replay.json);
        assert_eq!(doc.encode_state_vector(), replay.sv);
    }
}

fn delta_json(delta: Vec<crate::Delta>) -> Value {
    Value::Array(
        delta
            .into_iter()
            .map(|op| {
                let mut entry = obj(vec![("insert", render_value(&op.insert))]);
                if let Some(attributes) = op.attributes {
                    entry.set(s("attributes"), Value::Object(attributes));
                }
                Value::Object(entry)
            })
            .collect(),
    )
}

// YTextFormattingTests.FormattedWritesReadBackInYjs: every formatted write,
// one transaction each; the production ToDelta must read what yjs reads.
#[test]
fn formatted_writes_read_back_in_yjs() {
    let every = roots(&[("content", "text"), ("blocks", "map")]);
    let doc = doc_with_id(4242);
    let events = record(&doc);
    let content = doc.get_text("content").unwrap();
    let blocks = doc.get_map("blocks").unwrap();
    doc.transact(|txn| blocks.set(txn, "b1", XmlText::new(None)))
        .unwrap();
    let rich = blocks.get("b1").unwrap().as_xml_text().unwrap();
    let empty = obj(Vec::new());
    let bold = obj(vec![("bold", Value::Bool(true))]);
    let link = obj(vec![(
        "link",
        vobj(vec![("href", sv("h")), ("rel", sv("r"))]),
    )]);
    let unbold = obj(vec![("bold", Value::Null)]);
    let italic = obj(vec![("italic", Value::Bool(true))]);
    let equation = vobj(vec![("equation", vobj(vec![("expression", sv("x"))]))]);
    macro_rules! writes {
        ($text:expr) => {
            let text = $text;
            doc.transact(|txn| {
                text.insert(Some(txn), 0, "Hello world", Some(&crate::marks(&empty)))
            })
            .unwrap();
            doc.transact(|txn| text.format(Some(txn), 0, 5, &crate::marks(&bold)))
                .unwrap();
            doc.transact(|txn| text.format(Some(txn), 6, 5, &crate::marks(&link)))
                .unwrap();
            doc.transact(|txn| text.format(Some(txn), 1, 2, &crate::marks(&unbold)))
                .unwrap();
            doc.transact(|txn| {
                text.insert_embed(Some(txn), 5, equation.clone(), Some(&crate::marks(&italic)))
            })
            .unwrap();
            doc.transact(|txn| text.insert(Some(txn), 12, "!", None))
                .unwrap();
            doc.transact(|txn| text.delete(Some(txn), 3, 4)).unwrap();
        };
    }
    writes!(&content);
    writes!(&rich);
    let updates: Vec<Vec<u8>> = events
        .lock()
        .unwrap()
        .iter()
        .map(|event| event.update.clone())
        .collect();
    let replay = node_replay(&every, &updates);
    same_json("json", &render(&doc, &every), &replay.json);
    let replayed = |root: &str, key: Option<&str>| {
        let mut value = yjstest::field(&replay.json, root).unwrap();
        if let Some(key) = key {
            value = yjstest::field(value, key).unwrap();
        }
        yjstest::field(value, "$text").unwrap().clone()
    };
    same_json(
        "content delta",
        &delta_json(content.to_delta()),
        &replayed("content", None),
    );
    same_json(
        "b1 delta",
        &delta_json(rich.to_delta()),
        &replayed("blocks", Some("b1")),
    );
    assert_eq!(doc.encode_state_vector(), replay.sv);
}

// YTextFormattingTests.AttachedTextNeedsATransaction.
#[test]
fn attached_text_needs_a_transaction() {
    let doc = doc_with_id(4242);
    let failure = doc
        .get_text("content")
        .unwrap()
        .insert(None, 0, "a", None)
        .unwrap_err();
    assert_eq!(
        failure.to_string(),
        "yjs: a text in a document needs a transaction."
    );
}

// IntegrationTests.OutOfOrderDeliveryRetainsPendingThenConverges: the end
// state on top of the generic scenario run.
#[test]
fn out_of_order_delivery_retains_pending_then_converges() {
    let mut runner = ScenarioRunner::new(scenario_named("out-of-order-delivery"));
    runner.run_all();
    assert!(runner.failures.is_empty(), "{:?}", runner.failures);
    assert!(!runner.doc.has_pending());
    assert!(runner.checks >= 9, "{} checks", runner.checks);
}

#[test]
#[ignore = "ported to blok-collab-convert csharp_yrs_compat_test.rs: needs the converter, which blok-yjs cannot depend on"]
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

// A write over a length-0 item at clock 0 deletes a range that ends at
// clock -1. yjs's cleanup cannot find that struct and throws "Unexpected
// case" before it emits, so no update names the wrapped origin 2^64-1.
#[test]
fn a_write_over_a_length_zero_head_fails_like_yjs() {
    let doc = pinned_doc();
    apply_bytes(&doc, &b64("AQHoBwAkAQFtAWsAAA=="));
    let m = doc.get_map("m").unwrap();
    let failure = doc.transact(|txn| m.set(txn, "k", num(1.0))).unwrap_err();
    assert_eq!(failure.to_string(), "Unexpected case");
}

// YTextFormattingTests.ANegativeFormatLengthStillDeletesTheConflictingMarkAtTheStart:
// only the index is range-checked, and a negative length skips
// format_text's length-0 break, so the bold:true mark at clock 0 is
// deleted and restored after.
#[test]
fn a_negative_format_length_still_deletes_the_conflicting_mark_at_the_start() {
    let doc = doc_with_id(4242);
    let text = doc.get_text("content").unwrap();
    let bold = obj(vec![("bold", Value::Bool(true))]);
    let unbold = obj(vec![("bold", Value::Bool(false))]);
    doc.transact(|txn| text.insert(Some(txn), 0, "ab", Some(&crate::marks(&bold))))
        .unwrap();
    let update = doc
        .transact(|txn| text.format(Some(txn), 0, -1, &crate::marks(&unbold)))
        .unwrap()
        .expect("an update");
    let hex: String = update.iter().map(|byte| format!("{byte:02X}")).collect();
    assert_eq!(
        hex,
        "01029221044692210004626F6C640566616C7365C692210092210104626F6C640474727565019221010001"
    );
    assert_eq!(
        blok_jsjson::stringify(&delta_json(text.to_delta())).unwrap(),
        r#"[{"insert":"ab","attributes":{"bold":true}}]"#
    );
}

// YTextFormattingTests.FormattingTheSameNestedMarkObjectTwiceWritesItOnce:
// the mark keeps the caller's value, so the second call finds it === and
// writes nothing.
// C# TwoMarkObjectsSharingOneNestedInstanceWriteOnce: two different link
// objects that share ONE nested meta instance compare === member by member,
// so the second call writes nothing. A clone of a value is the same
// instance, as a JS reference is; a deep-equal copy built anew is not.
#[test]
fn two_mark_objects_sharing_one_nested_instance_write_once() {
    for shared in [true, false] {
        let doc = doc_with_id(4242);
        let text = doc.get_text("content").unwrap();
        let meta = vobj(vec![("x", Value::Number(1.0))]);
        let other = if shared {
            meta.clone()
        } else {
            vobj(vec![("x", Value::Number(1.0))])
        };
        let link = |meta: Value| {
            let mut marks = crate::Marks::default();
            marks.set(
                Str::from("link"),
                Arc::new(vobj(vec![("href", sv("h")), ("meta", meta)])),
            );
            marks
        };
        doc.transact(|txn| text.insert(Some(txn), 0, "ab", Some(&crate::marks(&obj(Vec::new())))))
            .unwrap();
        doc.transact(|txn| text.format(Some(txn), 0, 2, &link(meta)))
            .unwrap();
        let wrote = doc
            .transact(|txn| text.format(Some(txn), 0, 2, &link(other)))
            .unwrap();
        assert_eq!(wrote.is_none(), shared, "shared {shared}: {wrote:?}");
    }
}

#[test]
fn formatting_the_same_nested_mark_object_twice_writes_it_once() {
    let doc = doc_with_id(4242);
    let text = doc.get_text("content").unwrap();
    // One Marks value passed twice: the same object, as in C#.
    let link = crate::marks(&obj(vec![(
        "link",
        vobj(vec![
            ("href", sv("h")),
            ("meta", vobj(vec![("x", Value::Number(1.0))])),
        ]),
    )]));
    doc.transact(|txn| text.insert(Some(txn), 0, "ab", Some(&crate::marks(&obj(Vec::new())))))
        .unwrap();
    let first = doc
        .transact(|txn| text.format(Some(txn), 0, 2, &link))
        .unwrap()
        .expect("an update");
    let second = doc
        .transact(|txn| text.format(Some(txn), 0, 2, &link))
        .unwrap();
    let hex: String = first.iter().map(|byte| format!("{byte:02X}")).collect();
    assert_eq!(
        hex,
        "010292210246922100046C696E6B1B7B2268726566223A2268222C226D657461223A7B2278223A317D7D86922101046C696E6B046E756C6C00"
    );
    assert_eq!(second, None);
}
