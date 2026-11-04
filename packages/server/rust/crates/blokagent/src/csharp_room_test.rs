use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_collab_convert::{EditOp, MapPatch};
use blok_collab_room::EditStatus;
use blok_jsjson::{Kind, Object, Str, Value};
use blok_yjs::Out;

use crate::room::new_guid;
use crate::room_test::{insert_batch, ok_in, room_agent};
use crate::roomharness_test::new_test_room;
use crate::test_support::{lookup, must_parse, string_of};
use crate::{
    Actor, Cancel, Error, Execution, Executor, HostFuture, InvokeFuture, Invoker, Options,
    PageLocation, PageTarget,
};

// C# room cases the Go package has no twin for. The other C# room cases
// match a Go twin in room_test.rs or a room scenario by name.

const READ_BATCH: &str = r#"{"commands":[{"name":"doc.read","args":{"detail":"full"}}]}"#;
const RENAME_BATCH: &str =
    r#"{"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"}}]}"#;

/// Counts calls; the runtime must never be reached.
#[derive(Clone, Default)]
struct Recording(Arc<Mutex<Vec<String>>>);

impl Invoker for Recording {
    fn invoke<'a>(
        &'a self,
        _: &'a Cancel,
        op: &'a str,
        _: &'a str,
        _: Duration,
    ) -> InvokeFuture<'a> {
        self.0.lock().expect("lock").push(op.to_owned());
        Box::pin(async {
            Ok(r#"{"result":{"ok":true,"revision":"r"},"document":{"blocks":[]}}"#.to_owned())
        })
    }
}

#[derive(Default)]
struct Pages(Mutex<Vec<String>>);

impl PageTarget for Pages {
    fn resolve<'a>(
        &'a self,
        _: &'a Cancel,
        page_id: &'a str,
        _: &'a Actor,
    ) -> HostFuture<'a, Option<PageLocation>> {
        self.0.lock().expect("lock").push(page_id.to_owned());
        Box::pin(async { Ok(None) })
    }
}

fn actor() -> Actor {
    Actor {
        id: "agent-1".to_owned(),
        name: "Agent".to_owned(),
        on_behalf_of: None,
    }
}

fn assert_unavailable(execution: &Execution) {
    let result = must_parse(&execution.result_json);
    let error = lookup(Some(&result), "error");
    assert_eq!(
        string_of(lookup(error, "code")).as_deref(),
        Some("COMMAND_UNAVAILABLE")
    );
    assert_eq!(
        string_of(lookup(lookup(error, "details"), "reason")).as_deref(),
        Some("runtime")
    );
    assert_eq!(
        lookup(Some(&result), "ok").map(|ok| ok.kind),
        Some(Kind::False)
    );
    assert_eq!(
        lookup(error, "retryable").map(|r| r.kind),
        Some(Kind::False)
    );
    assert!(
        !string_of(lookup(error, "message"))
            .unwrap_or_default()
            .trim()
            .is_empty()
    );
    assert!(
        lookup(Some(&result), "warnings")
            .is_some_and(|w| w.kind == Kind::Array && w.items.is_empty())
    );
    assert!(execution.document_json.is_none());
    assert_eq!(execution.revision, "");
    assert!(lookup(Some(&result), "revision").is_none());
}

// C# BlokAgentExecutorTests.RoomsReturnAStructuredRuntimeRefusalWithoutInvokingTheStoredRuntime.
#[tokio::test]
async fn rooms_return_a_structured_runtime_refusal_without_invoking_the_stored_runtime() {
    let runtime = Recording::default();
    let executor = Executor::on_runtime(runtime.clone());
    let execution = executor
        .execute_in_room(&Cancel::new(), "doc", READ_BATCH, &actor(), None)
        .await
        .expect("execute");
    assert_unavailable(&execution);
    assert!(runtime.0.lock().expect("lock").is_empty());
}

// C# BlokAgentPageActionTests.RefusesARoomSourceWithoutCallingTheStoredRuntimeOrPageBackend.
#[tokio::test]
async fn refuses_a_room_source_without_calling_the_stored_runtime_or_page_backend() {
    let runtime = Recording::default();
    let executor = Executor::on_runtime(runtime.clone());
    let pages = Arc::new(Pages::default());
    let options = Options {
        page_titles: true,
        page_target: Some(pages.clone()),
        ..Options::default()
    };
    let execution = executor
        .execute_in_room(
            &Cancel::new(),
            "source-room",
            RENAME_BATCH,
            &actor(),
            Some(&options),
        )
        .await
        .expect("execute");
    assert!(pages.0.lock().expect("lock").is_empty());
    assert!(runtime.0.lock().expect("lock").is_empty());
    assert_unavailable(&execution);
}

// A peer can leave a bigint nested in a page map value. C# reads the
// version through RichText.ToJsonNode, which throws InvalidDataException
// (RichText.cs:318), and nothing on the agent path catches it. Go panics
// here (convert PlainPageMaps); the executor answers C#'s error.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_version_holding_a_nested_bigint_is_invalid_data() {
    for name in ["history.read", "history.restore", "history.changes"] {
        let r = new_test_room(false, None);
        r.docs.hold(
            "d",
            r#"{"blocks":[{"id":"p","type":"paragraph","data":{"text":"Hello"}}]}"#,
        );
        ok_in(&r, "d", &insert_batch("a", "Agent")).await;
        let mut held = Object::new();
        held.set(Str::from("n"), Value::BigInt(1));
        let edit = r
            .manager
            .edit(
                "d",
                vec![EditOp::PatchMaps {
                    patches: vec![MapPatch {
                        map: Str::from("values"),
                        key: Str::from("x"),
                        value: Out::Any(Value::Object(held)),
                        remove: false,
                    }],
                }],
                &new_guid(),
                &[0u8; 32],
                "human-2",
                None,
            )
            .await
            .expect("peer");
        assert_eq!(edit.status, EditStatus::Applied, "{name}: peer");
        let head = r.head("d").await;
        let args = if name == "history.changes" {
            format!(r#"{{"from":"{head}","to":"{head}"}}"#)
        } else {
            format!(r#"{{"version":"{head}"}}"#)
        };
        let outcome = r
            .executor
            .execute_in_room(
                &Cancel::new(),
                "d",
                &format!(r#"{{"commands":[{{"name":"{name}","args":{args}}}]}}"#),
                &room_agent(),
                None,
            )
            .await;
        match outcome {
            Err(Error::InvalidData(message))
                if message == "collab: unsupported value BigInteger in rich text." => {}
            other => panic!("{name}: {other:?}"),
        }
    }
}

// The host's own STALE, from a restore whose expectRevision is behind the
// room, is retryable as C#'s Failure("STALE", ..., true) is
// (BlokAgentExecutor.cs:1023). No scenario or C# test pins the flag here.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_restore_behind_the_room_is_a_retryable_stale() {
    let r = new_test_room(false, None);
    r.docs.hold(
        "d",
        r#"{"blocks":[{"id":"p","type":"paragraph","data":{"text":"Hello"}}]}"#,
    );
    let first = ok_in(&r, "d", &insert_batch("a", "One")).await;
    ok_in(&r, "d", &insert_batch("b", "Two")).await;
    let execution = r
        .executor
        .execute_in_room(
            &Cancel::new(),
            "d",
            &format!(
                r#"{{"expectRevision":"{0}","commands":[{{"name":"history.restore","args":{{"version":"{0}"}}}}]}}"#,
                first.revision
            ),
            &room_agent(),
            None,
        )
        .await
        .expect("execute");
    let result = must_parse(&execution.result_json);
    let error = lookup(Some(&result), "error");
    assert_eq!(string_of(lookup(error, "code")).as_deref(), Some("STALE"));
    assert_eq!(lookup(error, "retryable").map(|r| r.kind), Some(Kind::True));
    assert_eq!(execution.revision, r.head("d").await);
}
