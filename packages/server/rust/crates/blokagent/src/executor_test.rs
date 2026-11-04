use std::time::Duration;

use blok_jsruntime::PoolError;

use crate::{Actor, Cancel, Executor, FactoryOptions};

// C# BlokAgentExecutorTests.FactoryForwardsPoolAndStartupConstraints. Rust's
// pool size is a usize, so the negative-size row has no form.
#[test]
fn new_refuses_limits_below_their_floors_before_loading() {
    for (param, options) in [
        (
            "Timeout",
            FactoryOptions {
                pool_size: 1,
                timeout: Duration::from_millis(1),
                ..FactoryOptions::default()
            },
        ),
        (
            "MemoryBudget",
            FactoryOptions {
                pool_size: 1,
                memory_budget: 1024,
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

#[test]
#[ignore = "needs live rooms, which wait for the collab crates"]
fn a_room_contract_offers_the_history_only_with_a_history_journal() {}

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
        pool_size: 2,
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
