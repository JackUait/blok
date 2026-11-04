use std::borrow::Cow;

use crate::json_input::normalize;
use crate::runtime::Stop;

fn run(text: &str) -> Cow<'_, str> {
    normalize(text, i64::MAX, &mut || Ok(())).expect("normalize")
}

#[track_caller]
fn same(text: &str) {
    assert!(
        matches!(run(text), Cow::Borrowed(_)),
        "{text} was rewritten"
    );
}

fn large_document(repeat: bool) -> String {
    let blocks: Vec<String> = (0..20_000)
        .map(|i| format!(r#"{{"id":"b{i}","type":"paragraph","data":{{"text":"x"}}}}"#))
        .collect();
    let blocks = blocks.join(",");
    if repeat {
        format!(r#"{{"blocks":[],"blocks":[{blocks}]}}"#)
    } else {
        format!(r#"{{"blocks":[{blocks}]}}"#)
    }
}

#[test]
fn hands_back_the_same_text_when_nothing_needs_changing() {
    same(r#"{"a":1,"b":[true,false,null,"x"]}"#);
    same(r#"{"a":"\ud83d\ude80","b":"😀"}"#);
    same(r#"{"a":{"k":1},"b":{"k":2}}"#);
}

#[test]
fn leaves_text_that_is_not_strict_json_for_the_engine_to_refuse() {
    for text in [
        r#"{"a":01,"a":2}"#,
        r#"{"a":1.,"a":2}"#,
        r#"{"a":.5,"a":2}"#,
        r#"{"a":+1,"a":2}"#,
        r#"{"a":1,"a":2} x"#,
        r#"{"a":1,"a":2,}"#,
        r#"{"a":"\x","a":2}"#,
        "{\"a\":\"\t\",\"a\":2}",
        "{\"a\":1,\u{a0}\"a\":2}",
        r#"{"a":"\ud800","#,
    ] {
        same(text);
    }
}

#[test]
fn keeps_the_first_position_and_the_last_value_of_a_repeated_key() {
    assert_eq!(run(r#"{"a":{"deep":[1]},"b":2,"a":7}"#), r#"{"a":7,"b":2}"#);
}

#[test]
fn treats_an_escaped_key_as_the_key_it_spells() {
    assert_eq!(run(r#"{"text":"a","t\u0065xt":"b"}"#), r#"{"text":"b"}"#);
}

#[test]
fn finds_a_repeat_in_an_object_with_many_keys() {
    let keys: Vec<String> = (0..40).map(|i| format!(r#""k{i}":{i}"#)).collect();
    let keys = keys.join(",");
    assert_eq!(
        run(&format!(r#"{{{keys},"k3":"last"}}"#)),
        format!("{{{}}}", keys.replace(r#""k3":3"#, r#""k3":"last""#))
    );
}

#[test]
fn copies_numbers_and_escapes_as_written() {
    assert_eq!(
        run(
            r#"{"n":[1.0,9007199254740993,-0,1E+2],"s":"\u00e9\n\/","n":[1.0,9007199254740993,-0,1E+2]}"#
        ),
        r#"{"n":[1.0,9007199254740993,-0,1E+2],"s":"\u00e9\n\/"}"#
    );
}

#[test]
fn reads_a_lone_surrogate_as_a_replacement_character_and_keeps_pairs() {
    assert_eq!(
        run(r#"{"a":"x\ud800y\udc00\ud83d\ude80\udbff","\udc00":1}"#),
        "{\"a\":\"x\u{fffd}y\u{fffd}\\ud83d\\ude80\u{fffd}\",\"\u{fffd}\":1}"
    );
}

#[test]
#[ignore = "A Rust &str cannot hold a raw lone surrogate, so only escapes reach the rewrite"]
fn reads_a_raw_lone_surrogate_the_same_way() {}

#[test]
fn reads_a_high_escape_before_a_raw_astral_character_as_lone() {
    assert_eq!(run(r#"["\ud800😀"]"#), "[\"\u{fffd}😀\"]");
}

#[test]
fn rewrites_at_the_depth_the_engine_still_reads() {
    let depth = 64;
    let deep = format!("{}\"\\ud800\"{}", "[".repeat(depth), "]".repeat(depth));
    assert_eq!(
        run(&deep),
        format!("{}\"\u{fffd}\"{}", "[".repeat(depth), "]".repeat(depth))
    );
}

#[test]
fn leaves_text_deeper_than_the_engine_reads_unchanged() {
    let depth = 200_000;
    same(&format!(
        "{}\"\\ud800\"{}",
        "[".repeat(depth),
        "]".repeat(depth)
    ));
}

#[test]
fn passes_a_large_input_with_no_repeat_through_outside_the_budget() {
    let large = large_document(false);
    let got = normalize(&large, 1024, &mut || Ok(())).expect("normalize");
    assert!(matches!(got, Cow::Borrowed(_)));
}

#[test]
fn refuses_a_rewrite_larger_than_the_allocation_budget() {
    let large = large_document(true);
    assert_eq!(
        normalize(&large, 1024, &mut || Ok(())).err(),
        Some(Stop::Budget)
    );
}

#[test]
fn stops_when_the_call_is_cancelled() {
    for repeat in [false, true] {
        let large = large_document(repeat);
        let mut calls = 0;
        let got = normalize(&large, i64::MAX, &mut || {
            calls += 1;
            Err(Stop::Cancel)
        });
        assert_eq!(got.err(), Some(Stop::Cancel));
        assert_eq!(calls, 1);
    }
}
