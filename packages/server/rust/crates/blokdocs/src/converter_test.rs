use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;

use blok_jsruntime::InvokeError;

use crate::{Error, InvokeFuture, Options, Reason, Runtime, Validation, new, new_on_runtime};

struct Scripted {
    answers: Mutex<Vec<String>>,
    calls: Arc<AtomicUsize>,
}

impl Runtime for Scripted {
    fn invoke<'a>(&'a self, _: &'a str, _: &'a str, _: Duration) -> InvokeFuture<'a> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let mut answers = self.answers.lock().expect("lock");
        let answer = answers[0].clone();
        if answers.len() > 1 {
            answers.remove(0);
        }
        Box::pin(async move { Ok::<_, InvokeError>(answer) })
    }
}

fn scripted(answers: &[&str]) -> (crate::Converter, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let runtime = Scripted {
        answers: Mutex::new(answers.iter().map(|a| (*a).to_owned()).collect()),
        calls: calls.clone(),
    };
    (new_on_runtime(runtime), calls)
}

#[tokio::test]
async fn asks_the_bundle_for_its_version_only_once() {
    let (converter, calls) = scripted(&["1.2.3"]);
    for _ in 0..2 {
        assert_eq!(converter.version().await.expect("version"), "1.2.3");
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

// "dev" is the bundle built without the VERSION define. Caching it would stamp it into every document.
#[tokio::test]
async fn refuses_to_hand_out_a_version_the_bundle_does_not_have_and_asks_again() {
    let (converter, calls) = scripted(&["dev", "", "1.2.3"]);
    for _ in 0..2 {
        match converter.version().await {
            Err(Error::Answer(err)) => assert!(err.message.contains("VERSION define"), "{err}"),
            other => panic!("{other:?}, want the no-version error"),
        }
    }
    assert_eq!(converter.version().await.expect("version"), "1.2.3");
    assert_eq!(calls.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn fetches_the_schema_once() {
    let (converter, calls) = scripted(&[r#"{"type":"object"}"#]);
    for _ in 0..2 {
        assert_eq!(
            converter.schema().await.expect("schema"),
            r#"{"type":"object"}"#
        );
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

struct Never {
    dropped: Arc<AtomicBool>,
}

struct SetOnDrop(Arc<AtomicBool>);

impl Drop for SetOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

impl Runtime for Never {
    fn invoke<'a>(&'a self, _: &'a str, _: &'a str, _: Duration) -> InvokeFuture<'a> {
        let guard = SetOnDrop(self.dropped.clone());
        Box::pin(async move {
            let _guard = guard;
            std::future::pending::<Result<String, InvokeError>>().await
        })
    }
}

// Cancellation stays cancellation, Validate included, which otherwise never
// fails: dropping the call drops the runtime's call too.
#[tokio::test]
async fn reports_the_callers_own_cancellation_as_cancellation() {
    for validate in [false, true] {
        let dropped = Arc::new(AtomicBool::new(false));
        let converter = new_on_runtime(Never {
            dropped: dropped.clone(),
        });
        let elapsed = if validate {
            tokio::time::timeout(
                Duration::from_millis(50),
                converter.validate(r#"{"blocks":[]}"#),
            )
            .await
            .is_err()
        } else {
            tokio::time::timeout(
                Duration::from_millis(50),
                converter.to_html(r#"{"blocks":[]}"#),
            )
            .await
            .is_err()
        };
        assert!(elapsed, "the call finished instead of waiting");
        assert!(
            dropped.load(Ordering::SeqCst),
            "the runtime call outlived its caller"
        );
    }
}

#[test]
fn is_fully_understood_only_with_nothing_malformed_or_unknown() {
    let cases = [
        (
            Validation {
                is_document: true,
                ..Validation::default()
            },
            true,
        ),
        (
            Validation {
                is_document: false,
                ..Validation::default()
            },
            false,
        ),
        (
            Validation {
                is_document: true,
                malformed_block_count: 1,
                ..Validation::default()
            },
            false,
        ),
        (
            Validation {
                is_document: true,
                unrecognized_block_types: vec!["x".to_owned()],
                ..Validation::default()
            },
            false,
        ),
    ];
    for (validation, want) in cases {
        assert_eq!(validation.is_fully_understood(), want, "{validation:?}");
    }
}

pub(crate) fn real_converter() -> crate::Converter {
    new(Options {
        pool_size: Some(1),
        ..Options::default()
    })
    .expect("new")
}

pub(crate) fn is_reason(result: &Result<impl std::fmt::Debug, Error>, reason: Reason) -> bool {
    matches!(result, Err(Error::Conversion(err)) if err.reason == reason)
}

// C# BlokDocumentConverterTests.RefusesADocumentNestedPastTheParseDepth:
// Jint's JSON.parse refuses a 65th nested array or object, and the bare
// readers hand it the document as is; plain text wraps it one level deeper.
#[tokio::test]
async fn refuses_a_document_nested_past_the_parse_depth() {
    let c = real_converter();
    let nested = |depth: usize| {
        format!(
            r#"{{"blocks":[],"deep":{}{}}}"#,
            "[".repeat(depth - 1),
            "]".repeat(depth - 1)
        )
    };
    c.to_html(&nested(64)).await.expect("ToHTML at 64");
    c.to_markdown(&nested(64)).await.expect("ToMarkdown at 64");
    let wrapped = c.to_plain_text(&nested(64), false).await;
    assert!(is_reason(&wrapped, Reason::InvalidDocument), "{wrapped:?}");
    let html = c.to_html(&nested(65)).await;
    assert!(is_reason(&html, Reason::InvalidDocument), "{html:?}");
    let markdown = c.to_markdown(&nested(65)).await;
    assert!(
        is_reason(&markdown, Reason::InvalidDocument),
        "{markdown:?}"
    );
}

#[tokio::test]
async fn converts_through_the_embedded_bundle() {
    let converter = real_converter();
    let article = r#"{"blocks":[{"id":"h1","type":"header","data":{"text":"Release notes","level":2}},{"id":"p1","type":"paragraph","data":{"text":"Ships <b>today</b>"}}]}"#;

    let html = converter.to_html(article).await.expect("to_html");
    assert!(html.contains("<b>today</b>"), "{html}");
    let markdown = converter.to_markdown(article).await.expect("to_markdown");
    assert_eq!(markdown.markdown, "## Release notes\n\nShips **today**");
    assert!(markdown.warnings.is_empty());
    let refused = converter.to_markdown(r#"{"nope":1}"#).await;
    assert!(is_reason(&refused, Reason::InvalidDocument), "{refused:?}");
    let validation = converter
        .validate(r#"{"blocks":[{"type":"org-chart","data":{}}]}"#)
        .await
        .expect("validate");
    assert!(
        validation.is_document && validation.is_empty,
        "{validation:?}"
    );
    assert_eq!(validation.unrecognized_block_types, ["org-chart"]);
    let version = converter.version().await.expect("version");
    assert!(version != "dev" && !version.is_empty(), "{version}");
    converter.warm_up().await.expect("warm_up");
}

#[test]
fn refuses_limits_below_the_floors_before_loading() {
    for options in [
        Options {
            timeout: Duration::from_millis(1),
            ..Options::default()
        },
        Options {
            memory_budget: 1024,
            ..Options::default()
        },
        Options {
            pool_size: Some(0),
            ..Options::default()
        },
    ] {
        assert!(
            matches!(new(options), Err(crate::PoolError::Constraint(_))),
            "{options:?}"
        );
    }
}

// goja's JSON.parse, C#'s JsonInputNormalizer and jsruntime's json_input all
// read a lone-surrogate escape as U+FFFD, so the bare operations convert
// such a document.
#[tokio::test]
async fn reads_a_lone_surrogate_in_a_bare_document_as_a_replacement_character() {
    let converter = real_converter();
    let lone = r#"{"blocks":[{"id":"p","type":"paragraph","data":{"text":"a\ud800b"}}]}"#;

    let markdown = converter.to_markdown(lone).await.expect("to_markdown");
    assert_eq!(markdown.markdown, "a\u{fffd}b");
    assert_eq!(
        converter.to_html(lone).await.expect("to_html"),
        "<p>a\u{fffd}b</p>"
    );
    let validation = converter
        .validate(r#"{"blocks":[{"type":"\udc00","data":{}}]}"#)
        .await
        .expect("validate");
    assert_eq!(validation.failure, None);
    assert_eq!(validation.unrecognized_block_types, ["\u{fffd}"]);
    let envelope = converter.to_plain_text(lone, false).await;
    assert!(
        is_reason(&envelope, Reason::InvalidDocument),
        "{envelope:?}"
    );
}
