use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_jsruntime::PoolError;

use crate::roomharness_test::new_test_room;
use crate::{Actor, Cancel, Executor, FactoryOptions, InvokeFuture, Invoker};

// C# BlokAgentExecutorTests.FactoryForwardsPoolAndStartupConstraints. Rust's
// pool size is a usize, so the negative-size row has no form; 0 is refused.
#[test]
fn new_refuses_limits_below_their_floors_before_loading() {
    for (param, options) in [
        (
            "PoolSize",
            FactoryOptions {
                pool_size: Some(0),
                ..FactoryOptions::default()
            },
        ),
        (
            "Timeout",
            FactoryOptions {
                pool_size: Some(1),
                timeout: Some(Duration::from_millis(1)),
                ..FactoryOptions::default()
            },
        ),
        (
            "Timeout",
            FactoryOptions {
                pool_size: Some(1),
                timeout: Some(Duration::ZERO),
                ..FactoryOptions::default()
            },
        ),
        (
            "MemoryBudget",
            FactoryOptions {
                pool_size: Some(1),
                memory_budget: Some(1024),
                ..FactoryOptions::default()
            },
        ),
        (
            "MemoryBudget",
            FactoryOptions {
                pool_size: Some(1),
                memory_budget: Some(0),
                ..FactoryOptions::default()
            },
        ),
    ] {
        match Executor::new(options) {
            Err(PoolError::Constraint(err)) => assert_eq!(err.param, param),
            Err(err) => panic!("{param}: {err}"),
            Ok(_) => panic!("{param}: built"),
        }
    }
}

/// Records the input and answers one fixed text.
struct RecordingRuntime {
    answer: &'static str,
    input: Arc<Mutex<String>>,
}

impl Invoker for RecordingRuntime {
    fn invoke<'a>(
        &'a self,
        _: &'a Cancel,
        _: &'a str,
        input: &'a str,
        _: Option<Duration>,
    ) -> InvokeFuture<'a> {
        *self.input.lock().expect("lock") = input.to_owned();
        Box::pin(async { Ok(self.answer.to_owned()) })
    }
}

// RoomCommon (BlokAgentExecutor.cs:1205-1219): rooms whose journal keeps
// history add versionHistory last to services, then restores after
// runtime. Rooms with no journal add neither.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_room_contract_offers_the_history_only_with_a_history_journal() {
    for (no_journal, want) in [
        (
            false,
            r#"{"services":["versionHistory"],"runtime":"csharp-live","restores":true}"#,
        ),
        (true, r#"{"services":[],"runtime":"csharp-live"}"#),
    ] {
        let input = Arc::new(Mutex::new(String::new()));
        let recorded = input.clone();
        let rooms = new_test_room(
            no_journal,
            Some(Box::new(move |_| {
                Arc::new(RecordingRuntime {
                    answer: r#"{"contract":{}}"#,
                    input: recorded,
                })
            })),
        );
        rooms
            .executor
            .room_contract(&Cancel::new(), None)
            .await
            .expect("contract");
        assert_eq!(*input.lock().expect("lock"), want, "room contract input");
    }
}

/// Drops the edit time, the one field that differs between calls.
fn untimed(document: &str) -> String {
    let mut out = String::new();
    let mut rest = document;
    while let Some(at) = rest.find("\"lastEditedAt\":") {
        out.push_str(&rest[..at]);
        let tail = &rest[at + "\"lastEditedAt\":".len()..];
        let digits = tail.bytes().take_while(u8::is_ascii_digit).count();
        if digits > 0 && tail.as_bytes().get(digits) == Some(&b',') {
            rest = &tail[digits + 1..];
        } else {
            out.push_str(&rest[at..at + "\"lastEditedAt\":".len()]);
            rest = tail;
        }
    }
    out.push_str(rest);
    out
}

// An Executor is shared by every request, so calls on it may overlap; each
// one must answer as if it ran alone.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_calls_answer_as_they_do_alone() {
    let executor = Executor::new(FactoryOptions {
        pool_size: Some(2),
        ..FactoryOptions::default()
    })
    .expect("new");
    let cancel = Cancel::new();
    let document = r#"{"blocks":[{"id":"p","type":"paragraph","data":{"text":"Hi"}}]}"#;
    let batch = r#"{"commands":[{"name":"block.update","args":{"id":"p","data":{"text":"Bye"}}}]}"#;
    let actor = Actor {
        id: "a".to_owned(),
        name: "A".to_owned(),
        on_behalf_of: None,
    };
    let alone = executor
        .execute(&cancel, document, batch, &actor, None)
        .await
        .expect("alone");
    let alone_document = alone.document_json.expect("a document");
    let call = || async {
        let mut session = executor.open_session(actor.clone(), None);
        let execution = session
            .execute(&cancel, document, batch)
            .await
            .expect("execute");
        let saved = execution.document_json.expect("a document");
        let undo = session
            .execute(
                &cancel,
                &saved,
                r#"{"commands":[{"name":"history.undo","args":{}}]}"#,
            )
            .await
            .expect("undo");
        format!("{}\n{}", untimed(&saved), undo.result_json)
    };
    let answers = tokio::join!(call(), call(), call(), call(), call(), call());
    let answers = [
        answers.0, answers.1, answers.2, answers.3, answers.4, answers.5,
    ];
    for answer in &answers[1..] {
        assert_eq!(answer, &answers[0], "answers differ");
    }
    let saved = answers[0].split('\n').next().expect("a line");
    assert_eq!(saved, untimed(&alone_document));
}

#[test]
fn untimed_drops_only_the_edit_time() {
    assert_eq!(
        untimed(r#"{"a":1,"lastEditedAt":123,"b":2,"lastEditedAt":"x"}"#),
        r#"{"a":1,"b":2,"lastEditedAt":"x"}"#
    );
}
