use std::sync::Arc;
use std::time::Duration;

use crate::pool_test::{nested_outline, want_kind};
use crate::test_json::{self, Json};
use crate::{
    ConstraintError, Kind, MINIMUM_MEMORY_BUDGET, MINIMUM_TIMEOUT, Options, Pool, PoolError,
    StartupCause,
};

// Twins of C# Blok.Server.Tests Runtime/JintBlokRuntimeTests.cs and
// Documents/BlokRuntimeStartupTests.cs that Go's tests do not cover.

/// A JSON string as System.Text.Json writes it by default: non-ASCII and
/// HTML-sensitive characters as \uXXXX.
fn json_string(text: &str) -> String {
    let mut out = String::from("\"");
    for unit in text.encode_utf16() {
        match unit {
            0x5c => out.push_str("\\\\"),
            0x0a => out.push_str("\\n"),
            0x20..=0x7e if !b"<>&'\"+`".contains(&(unit as u8)) => out.push(unit as u8 as char),
            _ => out.push_str(&format!("\\u{unit:04X}")),
        }
    }
    out.push('"');
    out
}

fn embedded(timeout: Duration, budget: i64) -> Pool {
    Pool::new(Options {
        pool_size: Some(1),
        timeout,
        memory_budget: budget,
    })
    .expect("new")
}

fn first_block(output: &str) -> Json {
    test_json::parse(output).get("blocks").array()[0].clone()
}

const SPINNING_SCRIPT: &str = "globalThis.blokServerInvoke = function () {
  const until = Date.now() + 600;
  while (Date.now() < until) {}
  return 'ok';
};";

fn paragraphs(texts: impl Iterator<Item = String>) -> String {
    let blocks: Vec<String> = texts
        .enumerate()
        .map(|(index, text)| {
            format!(
                r#"{{"id":"b{index}","type":"paragraph","data":{{"text":{}}}}}"#,
                json_string(&text)
            )
        })
        .collect();
    format!(r#"{{"blocks":[{}]}}"#, blocks.join(","))
}

pub(crate) fn long_article() -> (String, String) {
    let paragraph = vec!["слово"; 30].join(" ");
    (paragraphs((0..3600).map(|_| paragraph.clone())), paragraph)
}

pub(crate) fn marked_up_article() -> String {
    const PLAIN: &str = "An entirely ordinary paragraph with no markup at all inside it, ";
    const MARKED: &str =
        "Ships <b>today</b> &amp; see <a href=\"https://example.com/a\">the details</a>, ";
    paragraphs((0..1800).map(|index| {
        let piece = if index % 3 == 0 { MARKED } else { PLAIN };
        format!("{}paragraph {index}", piece.repeat(5))
    }))
}

pub(crate) fn multi_megabyte_url(kind: &str, prefix: &str) -> (String, String) {
    let url = format!("{prefix}{}", "A".repeat(3 * 1024 * 1024));
    let input = format!(
        r#"{{"blocks":[{{"id":"u1","type":{},"data":{{"url":{}}}}}]}}"#,
        json_string(kind),
        json_string(&url)
    );
    (input, url)
}

#[tokio::test]
async fn imports_markdown() {
    let pool = embedded(Duration::ZERO, 0);
    let output = pool
        .invoke(
            "markdownToBlocks",
            r##"{"markdown":"# Hello"}"##,
            Duration::ZERO,
        )
        .await
        .expect("invoke");
    let block = first_block(&output);
    assert_eq!(block.get("type").str(), "header");
    assert_eq!(
        block.get("data").get("text"),
        &test_json::parse(r#"[{"text":"Hello"}]"#)
    );
    assert_eq!(block.get("data").get("level").number(), 1.0);
}

#[tokio::test]
async fn imports_markdown_math() {
    let pool = embedded(Duration::ZERO, 0);
    let output = pool
        .invoke(
            "markdownToBlocks",
            r#"{"markdown":"$$E = mc^2$$"}"#,
            Duration::ZERO,
        )
        .await
        .expect("invoke");
    let data = first_block(&output).get("data").clone();
    assert_eq!(data.get("code").str(), "E = mc^2");
    assert_eq!(data.get("language").str(), "latex");
}

#[tokio::test]
async fn converts_html_fields_to_segments_in_order() {
    let pool = embedded(Duration::ZERO, 0);
    let output = pool
        .invoke(
            "htmlFieldsToSegments",
            r#"[{"id":"a","type":"paragraph","field":"text","html":"Hi <b>there</b>"},{"type":"header","field":"text","html":"a &lt; b &amp;&amp; <img src=\"x.png\">"}]"#,
            Duration::ZERO,
        )
        .await
        .expect("invoke");
    let fields = test_json::parse(&output);
    let fields = fields.array();
    assert_eq!(fields.len(), 2);

    let first = &fields[0];
    assert_eq!(first.get("id").str(), "a");
    assert_eq!(first.get("type").str(), "paragraph");
    assert_eq!(first.get("field").str(), "text");
    assert_eq!(
        first.get("segments"),
        &test_json::parse(r#"[{"text":"Hi "},{"text":"there","marks":{"bold":true}}]"#)
    );

    let Json::Object(second) = &fields[1] else {
        panic!("not an object")
    };
    assert!(!second.contains_key("id"));
    assert_eq!(second["type"].str(), "header");
    let segments = second["segments"].array();
    assert_eq!(segments.len(), 2);
    assert_eq!(segments[0].get("text").str(), "a < b && ");
    let Json::Object(plain) = &segments[0] else {
        panic!("not an object")
    };
    assert!(!plain.contains_key("marks"));
    assert_eq!(
        segments[1].get("embed").get("html").str(),
        "<img src=\"x.png\">"
    );
}

#[tokio::test]
async fn renders_html() {
    let pool = embedded(Duration::ZERO, 0);
    let output = pool
        .invoke(
            "blocksToHtml",
            r#"{"blocks":[{"type":"paragraph","data":{"text":"Hi <b>there</b>"}}]}"#,
            Duration::ZERO,
        )
        .await;
    assert_eq!(output.expect("invoke"), "<p>Hi <b>there</b></p>");
}

#[tokio::test]
async fn renders_plain_text() {
    let pool = embedded(Duration::ZERO, 0);
    let output = pool
        .invoke(
            "blocksToPlainText",
            r#"{"blocks":[{"type":"paragraph","data":{"text":"Hi <b>there</b>"}}]}"#,
            Duration::ZERO,
        )
        .await;
    assert_eq!(output.expect("invoke"), "Hi there");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn handles_concurrent_calls_without_sharing_an_engine_csharp() {
    let pool = Arc::new(
        Pool::new(Options {
            pool_size: Some(4),
            ..Options::default()
        })
        .expect("new"),
    );
    let calls: Vec<_> = (0..64)
        .map(|index| {
            let pool = pool.clone();
            tokio::spawn(async move {
                let expected = format!("row-{index}");
                let input = format!(
                    r#"{{"blocks":[{{"type":"paragraph","data":{{"text":{}}}}}]}}"#,
                    json_string(&expected)
                );
                let output = pool
                    .invoke("blocksToPlainText", &input, Duration::ZERO)
                    .await;
                (expected, output)
            })
        })
        .collect();
    let all = async {
        for call in calls {
            let (expected, output) = call.await.expect("join");
            assert_eq!(output.expect("invoke"), expected);
        }
    };
    tokio::time::timeout(Duration::from_secs(30), all)
        .await
        .expect("within 30 s");
}

// The call waits on the pending promise until the caller cancels, as in C#,
// and the next call is served.
#[tokio::test]
async fn replaces_an_engine_after_cancellation() {
    let script = "globalThis.blokServerInvoke = async (operation) => {
      if (operation === 'wait') return await new Promise(() => {});
      return 'ok';
    };";
    let pool = Pool::from_source(script, 1, Duration::ZERO, 0).expect("from_source");
    let waited = tokio::time::timeout(
        Duration::from_millis(50),
        pool.invoke("wait", "{}", Duration::ZERO),
    )
    .await;
    assert!(
        waited.is_err(),
        "returned before the caller cancelled: {waited:?}"
    );
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        pool.invoke("ready", "{}", Duration::ZERO),
    )
    .await
    .expect("within 5 s");
    assert_eq!(output.expect("ready"), "ok");
}

#[tokio::test]
async fn times_out_instead_of_hanging_csharp() {
    let script = "globalThis.blokServerInvoke = function () { for (;;) {} };";
    let pool = Pool::from_source(script, 1, Duration::from_millis(200), 0).expect("from_source");
    let result = pool.invoke("blocksToMarkdown", "{}", Duration::ZERO).await;
    want_kind(result, Kind::TimedOut);
}

#[tokio::test]
async fn reports_a_memory_limit_as_bloks_own_failure() {
    let script = "globalThis.blokServerInvoke = function () {  let grown = 'x';  for (;;) { grown += grown; }};";
    let pool = Pool::from_source(script, 1, Duration::ZERO, 8 * 1024 * 1024).expect("from_source");
    let result = pool.invoke("blocksToHtml", "{}", Duration::ZERO).await;
    want_kind(result, Kind::DocumentTooLarge);
}

#[tokio::test]
async fn does_not_blame_the_document_for_a_failure_that_is_not_about_it() {
    let script = "globalThis.blokServerInvoke = function () {  throw new Error('the bundle itself broke');};";
    let pool = Pool::from_source(script, 1, Duration::ZERO, 0).expect("from_source");
    let result = pool.invoke("blocksToHtml", "{}", Duration::ZERO).await;
    want_kind(result, Kind::Unknown);
}

#[tokio::test]
async fn survives_runaway_recursion_and_keeps_serving() {
    let script = "globalThis.blokServerInvoke = function (operation) {
        if (operation === 'runaway') {
          const recurse = (depth) => depth === 0 ? 0 : recurse(depth - 1) + 1;
          return String(recurse(1000000));
        }
        return 'ok';
      };";
    let pool = Pool::from_source(script, 1, Duration::ZERO, 0).expect("from_source");
    assert!(pool.invoke("runaway", "{}", Duration::ZERO).await.is_err());
    let output = pool.invoke("blocksToMarkdown", "{}", Duration::ZERO).await;
    assert_eq!(output.expect("after the runaway"), "ok");
}

#[tokio::test]
async fn a_per_call_timeout_replaces_the_default_for_that_call_only_csharp() {
    let pool =
        Pool::from_source(SPINNING_SCRIPT, 1, Duration::from_millis(200), 0).expect("from_source");
    let long = pool.invoke("spin", "{}", Duration::from_secs(30)).await;
    assert_eq!(long.expect("long call"), "ok");
    want_kind(
        pool.invoke("spin", "{}", Duration::ZERO).await,
        Kind::TimedOut,
    );
}

#[tokio::test]
async fn a_per_call_timeout_can_be_shorter_than_the_default_csharp() {
    let pool = Pool::from_source(SPINNING_SCRIPT, 1, Duration::ZERO, 0).expect("from_source");
    let result = pool.invoke("spin", "{}", Duration::from_millis(200)).await;
    want_kind(result, Kind::TimedOut);
}

#[tokio::test]
async fn keeps_serving_after_a_timeout() {
    let script = "globalThis.blokServerInvoke = function (operation) {
        if (operation === 'spin') { for (;;) {} }
        return 'ok';
      };";
    let pool = Pool::from_source(script, 1, Duration::from_millis(200), 0).expect("from_source");
    for _ in 0..3 {
        assert!(pool.invoke("spin", "{}", Duration::ZERO).await.is_err());
        let output = pool.invoke("blocksToMarkdown", "{}", Duration::ZERO).await;
        assert_eq!(output.expect("after the timeout"), "ok");
    }
}

#[tokio::test]
async fn converts_a_long_article_without_exhausting_the_memory_limit() {
    let pool = embedded(Duration::from_secs(300), 0);
    let (input, paragraph) = long_article();
    assert!(input.len() > 600_000, "too short: {}", input.len());
    for op in ["blocksToPlainText", "blocksToMarkdown", "blocksToHtml"] {
        let output = pool.invoke(op, &input, Duration::ZERO).await;
        let output = output.unwrap_or_else(|err| panic!("{op}: {err}"));
        assert!(output.contains(&paragraph), "{op}");
    }
}

#[tokio::test]
async fn writes_a_multi_megabyte_url_to_markdown() {
    let pool = embedded(Duration::from_secs(120), 0);
    for (kind, prefix) in [
        ("image", "data:image/png;base64,"),
        ("bookmark", "https://example.com/?q="),
    ] {
        let (input, url) = multi_megabyte_url(kind, prefix);
        let output = pool
            .invoke("blocksToMarkdown", &input, Duration::ZERO)
            .await;
        let output = output.unwrap_or_else(|err| panic!("{kind}: {err}"));
        assert!(output.contains(&format!("({url})")), "{kind}");
    }
}

#[tokio::test]
async fn converts_a_deeply_nested_outline_csharp() {
    let pool = embedded(Duration::from_secs(120), 0);
    let input = nested_outline(120);
    for op in ["blocksToPlainText", "blocksToMarkdown"] {
        let output = pool.invoke(op, &input, Duration::ZERO).await;
        let output = output.unwrap_or_else(|err| panic!("{op}: {err}"));
        assert!(output.contains("level 119"), "{op}");
    }
}

#[tokio::test]
async fn converts_a_long_article_whose_fields_carry_inline_markup() {
    let pool = embedded(Duration::from_secs(300), 0);
    let input = marked_up_article();
    assert!(input.len() > 700_000, "too short: {}", input.len());
    for op in ["blocksToPlainText", "blocksToMarkdown", "blocksToHtml"] {
        let output = pool.invoke(op, &input, Duration::ZERO).await;
        let output = output.unwrap_or_else(|err| panic!("{op}: {err}"));
        assert!(output.contains("paragraph 1799"), "{op}");
    }
}

// Rust runs every engine on its own thread, so the caller's stack plays no
// part; the case is that 1000 levels convert to HTML. QuickJS's 16 MiB stack
// cap stops HTML at 1687 levels (measured), short of C#'s 2380.
#[tokio::test]
async fn converts_the_same_depth_whatever_the_caller_has_spent_of_its_stack() {
    let pool = embedded(Duration::from_secs(120), 0);
    let output = pool
        .invoke(
            "blocksToHtml",
            &crate::pool_test::nested_outline(1000),
            Duration::ZERO,
        )
        .await
        .expect("1000 levels to HTML");
    assert!(output.contains("level 999"));
}

#[tokio::test]
async fn stops_a_conversion_that_outgrows_the_budget_it_was_given() {
    let pool = embedded(Duration::from_secs(300), 64 * 1024 * 1024);
    let result = pool
        .invoke("blocksToHtml", &marked_up_article(), Duration::ZERO)
        .await;
    want_kind(result, Kind::DocumentTooLarge);
}

#[test]
fn explains_a_start_up_too_small_to_load_the_bundle() {
    for (options, param) in [
        (
            Options {
                pool_size: Some(1),
                memory_budget: 1024,
                ..Options::default()
            },
            "MemoryBudget",
        ),
        (
            Options {
                pool_size: Some(1),
                timeout: Duration::from_millis(1),
                ..Options::default()
            },
            "Timeout",
        ),
    ] {
        match Pool::new(options) {
            Err(PoolError::Constraint(err)) => assert_eq!(err.param, param),
            other => panic!("{options:?}: {:?}", other.err()),
        }
    }
}

#[test]
fn refuses_an_allocation_budget_too_small_to_load_the_bundle() {
    match Pool::new(Options {
        pool_size: Some(1),
        memory_budget: 1024 * 1024,
        ..Options::default()
    }) {
        Err(PoolError::Constraint(err)) => {
            assert_eq!(err.param, "MemoryBudget");
            assert!(
                err.to_string().contains(&MINIMUM_MEMORY_BUDGET.to_string()),
                "{err}"
            );
        }
        other => panic!("{:?}", other.err()),
    }
}

#[test]
fn refuses_a_timeout_too_short_to_load_the_bundle() {
    match Pool::new(Options {
        pool_size: Some(1),
        timeout: Duration::from_millis(5),
        ..Options::default()
    }) {
        Err(PoolError::Constraint(ConstraintError { param, .. })) => assert_eq!(param, "Timeout"),
        other => panic!("{:?}", other.err()),
    }
}

#[test]
fn publishes_the_floors_it_enforces() {
    const { assert!(MINIMUM_MEMORY_BUDGET > 0) };
    assert!(!MINIMUM_TIMEOUT.is_zero());
}

#[test]
fn reports_an_exhausted_load_budget_as_bloks_own_exception() {
    let greedy = "var s = ''; for (var i = 0; i < 2000000; i++) { s += 'xxxxxxxxxx'; }";
    match Pool::from_source(greedy, 1, Duration::ZERO, 2 * 1024 * 1024) {
        Err(PoolError::Startup(err)) => {
            assert_eq!(err.cause, StartupCause::OverBudget, "{err}");
            assert!(
                err.to_string().to_lowercase().contains("allocation budget"),
                "{err}"
            );
        }
        other => panic!("{:?}", other.err()),
    }
}

#[test]
fn reports_a_load_that_runs_past_the_timeout_as_bloks_own_exception() {
    let endless = "var n = 0; while (true) { n += 1; }";
    match Pool::from_source(endless, 1, Duration::from_millis(50), 0) {
        Err(PoolError::Startup(err)) => {
            assert_eq!(err.cause, StartupCause::TimedOut, "{err}");
            assert!(err.to_string().to_lowercase().contains("timeout"), "{err}");
        }
        other => panic!("{:?}", other.err()),
    }
}

#[test]
fn keeps_the_exception_type_callers_already_catch() {
    match Pool::from_source("throw new Error('no bundle here');", 1, Duration::ZERO, 0) {
        Err(PoolError::Startup(err)) => assert_eq!(err.cause, StartupCause::Failed),
        other => panic!("{:?}", other.err()),
    }
}

const ECHO_SCRIPT: &str = "globalThis.blokServerInvoke = function (op, input) { return input; };";

#[tokio::test]
async fn hands_the_engine_the_last_value_of_a_repeated_key() {
    let pool = Pool::from_source(ECHO_SCRIPT, 1, Duration::ZERO, 0).expect("from_source");
    let output = pool
        .invoke("x", r#"{"a":1,"b":1,"a":2}"#, Duration::ZERO)
        .await;
    assert_eq!(output.expect("echo"), r#"{"a":2,"b":1}"#);
}

// The rewrite runs on the host, so it is held to the engine's budget too.
// The echo script would hand the text back if it got that far.
#[tokio::test]
async fn refuses_a_rewrite_larger_than_the_allocation_budget_and_keeps_serving() {
    let pool =
        Pool::from_source(ECHO_SCRIPT, 1, Duration::ZERO, 8 * 1024 * 1024).expect("from_source");
    let blocks: Vec<String> = (0..100_000)
        .map(|i| format!(r#"{{"id":"b{i}","type":"paragraph","data":{{"text":"x"}}}}"#))
        .collect();
    let input = format!(r#"{{"blocks":[],"blocks":[{}]}}"#, blocks.join(","));
    want_kind(
        pool.invoke("x", &input, Duration::ZERO).await,
        Kind::DocumentTooLarge,
    );
    let output = pool.invoke("x", "{}", Duration::ZERO).await;
    assert_eq!(output.expect("after the refusal"), "{}");
}
