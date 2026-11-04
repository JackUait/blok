use blok_jsjson::{Str, Value};
use blok_yjs::{Doc, Options, Outcome, Text};

use crate::apply::apply_ops;
use crate::csharp_apply_test::{json, nodes, ops};
use crate::export::BLOCKS_ROOT;
use crate::fields::RichTextFields;
use crate::richtextinput::RichTextInput;
use crate::seed::seed;
use crate::textdiff::diff;

// C# YDocConverterTextDiffTests: the edit a host pushes through /edit merges
// with a peer's concurrent edit the way the client's does, because both
// sides diff a custom tool's plain text with a bounded Myers diff over code
// points.

fn seeded(block: &str) -> Doc {
    let doc = Doc::new(Options::default());
    let fields = RichTextFields::built_in();
    seed(
        &doc,
        &nodes(&[block]),
        &mut RichTextInput::refusing(&fields),
        None,
    )
    .unwrap_or_else(|err| panic!("{err}"));
    doc
}

fn quote(text: &str) -> String {
    json(&Value::String(Str::from(text)))
}

fn paragraph(text: &str) -> String {
    format!(
        r#"{{ "id": "p", "type": "note", "data": {{ "text": {} }} }}"#,
        quote(text)
    )
}

fn update_text(doc: &Doc, text: &str) {
    let op = format!(
        r#"{{ "op": "update", "id": "p", "data": {{ "text": {} }} }}"#,
        quote(text)
    );
    let fields = RichTextFields::built_in();
    apply_ops(doc, &ops(&[&op]), &mut RichTextInput::refusing(&fields))
        .unwrap_or_else(|err| panic!("{err}"));
}

fn live(doc: &Doc) -> Text {
    doc.get_map(BLOCKS_ROOT)
        .unwrap_or_else(|err| panic!("{err}"))
        .get("p")
        .and_then(|block| block.as_map())
        .and_then(|block| block.get("data"))
        .and_then(|data| data.as_map())
        .and_then(|data| data.get("text"))
        .and_then(|text| text.as_text())
        .unwrap_or_else(|| panic!("not a YText"))
}

fn text_of(doc: &Doc) -> Str {
    live(doc).units()
}

/// Types into the peer's own YText the way a person does.
fn set_text(doc: &Doc, next: &str) {
    let text = live(doc);
    let before = text.units();
    let next = Str::from(next);
    doc.transact(|t| {
        for edit in diff(&before, &next, true).iter().rev() {
            if edit.remove > 0 {
                text.delete(Some(t), edit.index as i64, edit.remove as i64)?;
            }
            if !edit.insert.is_empty() {
                text.insert(Some(t), edit.index as i64, edit.insert.clone(), None)?;
            }
        }
        Ok(())
    })
    .unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(text.units(), next);
}

fn cloned(source: &Doc) -> Doc {
    let clone = Doc::new(Options::default());
    let update = source
        .encode_state_as_update(&clone.encode_state_vector())
        .unwrap_or_else(|err| panic!("{err}"));
    let result = clone
        .apply_update(&update)
        .unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(result.outcome, Outcome::Applied);
    clone
}

fn exchange(left: &Doc, right: &Doc) {
    let to_right = left
        .encode_state_as_update(&right.encode_state_vector())
        .unwrap_or_else(|err| panic!("{err}"));
    let to_left = right
        .encode_state_as_update(&left.encode_state_vector())
        .unwrap_or_else(|err| panic!("{err}"));
    for (doc, update) in [(right, to_right), (left, to_left)] {
        let result = doc
            .apply_update(&update)
            .unwrap_or_else(|err| panic!("{err}"));
        assert_eq!(result.outcome, Outcome::Applied);
    }
}

fn occurrences(haystack: &Str, needle: &str) -> usize {
    let needle: Vec<u16> = needle.encode_utf16().collect();
    haystack
        .windows(needle.len())
        .filter(|window| *window == needle.as_slice())
        .count()
}

fn assert_well_formed(text: &Str) {
    assert!(!text.contains(&0xfffd), "U+FFFD in {text:?}");
    let mut index = 0;
    while index < text.len() {
        let unit = text[index];
        if (0xd800..=0xdbff).contains(&unit) {
            assert!(
                index + 1 < text.len() && (0xdc00..=0xdfff).contains(&text[index + 1]),
                "lone high surrogate at {index} in {text:?}"
            );
            index += 2;
            continue;
        }
        assert!(
            !(0xdc00..=0xdfff).contains(&unit),
            "lone low surrogate at {index}"
        );
        index += 1;
    }
}

// Two people wrap overlapping phrases at the same moment and every word
// still appears exactly once.
#[test]
fn two_peers_wrapping_overlapping_phrases_keep_every_word_once() {
    let server = seeded(&paragraph("the quick brown fox"));
    let peer = cloned(&server);
    set_text(&peer, "the <b>quick brown</b> fox");
    update_text(&server, "the quick <i>brown fox</i>");
    exchange(&server, &peer);
    let merged = text_of(&server);
    assert_eq!(occurrences(&merged, "quick"), 1, "{merged}");
    assert_eq!(occurrences(&merged, "brown"), 1, "{merged}");
    assert_eq!(occurrences(&merged, "fox"), 1, "{merged}");
    assert_eq!(text_of(&peer), merged);
}

#[test]
fn two_peers_wrapping_the_same_phrase_do_not_duplicate_it() {
    let server = seeded(&paragraph("the quick brown fox"));
    let peer = cloned(&server);
    set_text(&peer, "the <b>quick brown</b> fox");
    update_text(&server, "the <i>quick brown</i> fox");
    exchange(&server, &peer);
    let merged = text_of(&server);
    assert_eq!(occurrences(&merged, "quick brown"), 1, "{merged}");
    assert_eq!(occurrences(&merged, "the "), 1, "{merged}");
    assert_eq!(occurrences(&merged, " fox"), 1, "{merged}");
    assert_eq!(text_of(&peer), merged);
}

// A peer typing inside the phrase the host rewrites keeps its characters.
#[test]
fn a_peers_word_inside_the_rewritten_phrase_is_not_duplicated() {
    let server = seeded(&paragraph("one two three four"));
    let peer = cloned(&server);
    set_text(&peer, "one two THREE four");
    update_text(&server, "one <b>two three</b> four");
    exchange(&server, &peer);
    let merged = text_of(&server);
    assert_eq!(occurrences(&merged, "two"), 1, "{merged}");
    assert_eq!(occurrences(&merged, "four"), 1, "{merged}");
    assert_eq!(text_of(&peer), merged);
}

#[test]
fn appending_keeps_the_existing_characters() {
    let doc = seeded(&paragraph("hello"));
    update_text(&doc, "hello world");
    assert_eq!(text_of(&doc), Str::from("hello world"));
}

fn rewrites_well_formed(before: &str, after: &str) {
    let doc = seeded(&paragraph(before));
    update_text(&doc, after);
    let text = text_of(&doc);
    assert_well_formed(&text);
    assert_eq!(text, Str::from(after));
}

// The family emoji is four code points and three ZWJs; it survives whole.
#[test]
fn an_edit_beside_a_family_emoji_leaves_it_whole() {
    rewrites_well_formed(
        "hi \u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466} there",
        "hi \u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466} you",
    );
}

#[test]
fn swapping_one_flag_for_another_keeps_both_well_formed() {
    rewrites_well_formed(
        "from \u{1F1FA}\u{1F1F8} today",
        "from \u{1F1EB}\u{1F1F7} today",
    );
}

#[test]
fn changing_a_skin_tone_keeps_the_emoji_well_formed() {
    rewrites_well_formed("nice \u{1F44D}\u{1F3FD}!", "nice \u{1F44D}\u{1F3FF}!");
}

#[test]
fn concurrent_edits_around_an_emoji_keep_it_well_formed() {
    let server = seeded(&paragraph("a \u{1F44D} b"));
    let peer = cloned(&server);
    set_text(&peer, "a \u{1F44D} b!");
    update_text(&server, "A \u{1F44D} b");
    exchange(&server, &peer);
    let merged = text_of(&server);
    assert_well_formed(&merged);
    assert_eq!(occurrences(&merged, "\u{1F44D}"), 1, "{merged}");
    assert_eq!(text_of(&peer), merged);
}

#[test]
fn deleting_a_word_keeps_the_rest() {
    let doc = seeded(&paragraph("one two three"));
    update_text(&doc, "one three");
    assert_eq!(text_of(&doc), Str::from("one three"));
}

// A whole-string rewrite is past the search cap and falls back to the
// single-region answer; it still produces the right text.
#[test]
fn a_whole_string_rewrite_past_the_cap_still_lands() {
    let doc = seeded(&paragraph(&"a".repeat(200)));
    update_text(&doc, &"b".repeat(200));
    assert_eq!(text_of(&doc), Str::from("b".repeat(200)));
}

// Past the cap the one changed region must roll back off a surrogate pair.
#[test]
fn an_emoji_rewrite_past_the_cap_stays_well_formed() {
    rewrites_well_formed(
        &("\u{1F44D}".repeat(40) + " tail"),
        &("\u{1F44E}".repeat(40) + " tail"),
    );
}

// C# YDocConverterTextMergeTests, the update half (the seed half is in the
// collab-hardening capture): an update edits the live YText in place.

const NOTE: &str = r#"{ "id": "p", "type": "note", "data": { "text": "hello" } }"#;

#[test]
fn update_keeps_the_same_y_text_instance() {
    let doc = seeded(NOTE);
    let before = live(&doc);
    update_text(&doc, "hello!");
    let after = live(&doc);
    assert_eq!(before, after);
    assert_eq!(after.units(), Str::from("hello!"));
}

// A peer typing into the paragraph while the host pushes an update op
// through /edit keeps the burst.
#[test]
fn an_update_op_and_a_peers_typing_both_survive() {
    let server = seeded(NOTE);
    let peer = cloned(&server);
    // The peer types " world" at the end of the paragraph.
    let peer_text = live(&peer);
    peer.transact(|t| peer_text.insert(Some(t), 5, " world", None))
        .unwrap_or_else(|err| panic!("{err}"));
    // At the same moment the host pushes an edit that appends "!".
    update_text(&server, "hello!");
    exchange(&server, &peer);
    let merged = text_of(&server);
    assert!(occurrences(&merged, " world") > 0, "{merged}");
    assert!(occurrences(&merged, "!") > 0, "{merged}");
    assert_eq!(merged.len(), "hello world!".len());
    assert_eq!(text_of(&peer), merged);
}

#[test]
fn update_still_drops_the_keys_the_new_data_omits() {
    let doc = seeded(r#"{ "id": "p", "type": "note", "data": { "text": "old", "level": 3 } }"#);
    update_text(&doc, "new");
    let data = doc
        .get_map(BLOCKS_ROOT)
        .unwrap_or_else(|err| panic!("{err}"))
        .get("p")
        .and_then(|block| block.as_map())
        .and_then(|block| block.get("data"))
        .and_then(|data| data.as_map())
        .unwrap_or_else(|| panic!("no data map"));
    assert_eq!(data.keys(), [Str::from("text")]);
}
