use std::time::{Duration, Instant};

use blok_jsjson::{Kind, Node, new_array, new_object};

use crate::test_support::{lookup, must_parse, pointer, shared_executor, stable, string_of};
use crate::wire::{member, str_node, write};
use crate::{Actor, Cancel};

// A port of C# JintFormulaLimitsTests: the formula caps of
// src/shared/database/formula/limits.ts as a server read sees them, with the
// same wall-clock bounds, so QuickJS's regex engine is held to Jint's.

async fn computed_of(expressions: &[String]) -> Node {
    let mut schema = vec![must_parse(
        r#"{"id":"t","name":"Name","type":"title","position":"a0"}"#,
    )];
    for (i, expression) in expressions.iter().enumerate() {
        schema.push(new_object(vec![
            member("id", str_node(&format!("f{i}"))),
            member("name", str_node(&format!("F{i}"))),
            member("type", str_node("formula")),
            member("position", str_node(&format!("b{i}"))),
            member(
                "formula",
                new_object(vec![member("expression", str_node(expression))]),
            ),
        ]));
    }
    let mut database = must_parse(
        r#"{"id":"db","type":"database","content":["r1"],"data":{"title":"Limits","activeViewId":"v1","views":[{"id":"v1","name":"Table","type":"table","position":"a0","filters":[],"sorts":[],"visibleProperties":[]}]}}"#,
    );
    database
        .lookup_mut("data")
        .expect("lookup")
        .expect("data")
        .set("schema", new_array(schema))
        .expect("set");
    let document = write(&new_object(vec![member(
        "blocks",
        new_array(vec![
            database,
            must_parse(r#"{"id":"r1","type":"database-row","parent":"db","data":{"position":"a0","properties":{"t":"One"}}}"#),
        ]),
    )]))
    .expect("write");
    let execution = shared_executor()
        .execute(
            &Cancel::new(),
            &document,
            r#"{"commands":[{"name":"doc.read","args":{"ids":["r1"]}}]}"#,
            &Actor {
                id: "agent-cs".to_owned(),
                name: "Server agent".to_owned(),
                on_behalf_of: None,
            },
            None,
        )
        .await
        .expect("execute");
    let result = must_parse(&execution.result_json);
    pointer(&result, "/results/0/blocks/0/computed")
        .cloned()
        .unwrap_or_else(|| panic!("no computed values: {}", execution.result_json))
}

#[track_caller]
fn unavailable_has(computed: &Node, id: &str, want: &str) {
    let reason = string_of(lookup(lookup(Some(computed), id), "unavailable")).unwrap_or_default();
    assert!(
        reason.contains(want),
        "{id}: {reason:?} does not say {want:?}"
    );
}

#[track_caller]
fn is_json_true(computed: &Node, id: &str) {
    assert!(
        lookup(Some(computed), id).is_some_and(|value| value.kind == Kind::True),
        "{id}: {}, want true",
        stable(Some(computed))
    );
}

#[tokio::test]
async fn a_formula_nested_to_the_cap_reads_and_one_past_it_is_a_compile_error() {
    let computed = computed_of(&[
        format!("{}1{}", "(".repeat(63), ")".repeat(63)),
        vec!["1"; 64].join(" + "),
        format!("\"A\"{}", ".lower()".repeat(63)),
        format!("{}1{}", "(".repeat(64), ")".repeat(64)),
        format!("{}1", "(".repeat(100_000)),
    ])
    .await;
    for (id, want) in [("f0", "1"), ("f1", "64"), ("f2", "\"a\"")] {
        assert_eq!(stable(lookup(Some(&computed), id)), want, "{id}");
    }
    unavailable_has(&computed, "f3", "nest at most 64 levels deep");
    unavailable_has(&computed, "f4", "at most 10000 characters long");
}

#[tokio::test]
async fn an_evil_pattern_and_a_huge_repeat_read_as_unavailable_at_once() {
    shared_executor();
    let start = Instant::now();
    let computed = computed_of(&[
        format!("test(\"{}b\", \"(a+)+$\")", "a".repeat(30)),
        r#"test(repeat("a", 5000) + "b", "a*a*a*$")"#.to_owned(),
        r#"repeat("ab", 1000000000)"#.to_owned(),
        r#"test("12-34", "^\\d+-\\d+$")"#.to_owned(),
        r#"test("foobarfoo", "^(foo|bar)+$")"#.to_owned(),
    ])
    .await;
    assert!(
        start.elapsed() < Duration::from_secs(5),
        "took {:?}, C# allows 5 s",
        start.elapsed()
    );
    unavailable_has(&computed, "f0", "could run too long");
    unavailable_has(&computed, "f1", "passed a limit");
    unavailable_has(&computed, "f2", "passed a limit");
    is_json_true(&computed, "f3");
    is_json_true(&computed, "f4");
}

#[tokio::test]
async fn zero_width_and_multi_character_escapes_read_as_unavailable_at_once() {
    shared_executor();
    let start = Instant::now();
    let computed = computed_of(&[
        format!(
            "test(\"{}!\", \"(\\\\B\\\\Ba|\\\\B\\\\Ba)+$\")",
            "a".repeat(30)
        ),
        format!("test(\"{}!\", \"(\\\\x61|\\\\x61)+$\")", "a".repeat(30)),
        r#"test("aaa", "(?:\\b)+")"#.to_owned(),
        r#"test("foo bar", "\\bbar\\b")"#.to_owned(),
    ])
    .await;
    unavailable_has(&computed, "f0", "passed a limit");
    unavailable_has(&computed, "f1", "passed a limit");
    unavailable_has(&computed, "f2", "could run too long");
    is_json_true(&computed, "f3");
    assert!(
        start.elapsed() < Duration::from_secs(10),
        "took {:?}, C# allows 10 s",
        start.elapsed()
    );
}
