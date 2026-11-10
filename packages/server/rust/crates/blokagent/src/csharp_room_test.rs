use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_collab_convert::{EditOp, MapPatch};
use blok_collab_room::EditStatus;
use blok_jsjson::{Kind, Object, Str, Value};
use blok_yjs::Out;

use crate::room::new_guid;
use crate::room_test::{insert_batch, ok_in, room_agent};
use crate::roomharness_test::{new_local_journal, new_test_room, new_test_room_on_with};
use crate::test_support::{lookup, must_parse, string_of};
use crate::{
    Actor, Cancel, Execution, Executor, HostFuture, InvokeFuture, Invoker, Options, PageLocation,
    PageTarget,
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
        _: Option<Duration>,
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

// C# BlokAgentVersionHistoryTests.APeerValueWithNoJsonFormFailsNoCommand: a
// peer's nested bigint in a page map is left out, as the version read leaves
// it out, so no command fails on it. "restore-before" restores the version
// before the peer wrote it, which removes the key.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_peer_value_with_no_json_form_fails_no_command() {
    for name in [
        "history.read",
        "history.restore",
        "restore-before",
        "history.changes",
        "text.replace",
    ] {
        let r = new_test_room(false, None);
        r.docs.hold(
            "d",
            r#"{"blocks":[{"id":"p","type":"paragraph","data":{"text":"Hello"}}]}"#,
        );
        let before = ok_in(
            &r,
            "d",
            r#"{"commands":[{"name":"doc.setTitle","args":{"title":"One"}}]}"#,
        )
        .await
        .revision;
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
        let command = match name {
            "history.changes" => {
                format!(
                    r#"{{"name":"history.changes","args":{{"from":"{before}","to":"{head}"}}}}"#
                )
            }
            "text.replace" => {
                r#"{"name":"text.replace","args":{"id":"p","with":"Changed"}}"#.to_owned()
            }
            "restore-before" => {
                format!(r#"{{"name":"history.restore","args":{{"version":"{before}"}}}}"#)
            }
            _ => format!(r#"{{"name":"{name}","args":{{"version":"{head}"}}}}"#),
        };

        ok_in(&r, "d", &format!(r#"{{"commands":[{command}]}}"#)).await;
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

// C# BlokAgentVersionHistoryTests.ARestoreHonoursTheHostsTrashOptionForALaterPagePointer.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_restore_honours_the_hosts_trash_option_for_a_later_page_pointer() {
    for trash in [false, true] {
        let (journal, dir) = new_local_journal();
        let r = new_test_room_on_with(Some(Arc::new(journal)), Some(dir), None, None, {
            let mut o = blok_collab_room::Options::default();
            o.restore_trashes_pages = trash;
            o
        });
        r.docs.hold(
            "d",
            r#"{"blocks":[{"id":"p","type":"paragraph","data":{"text":"P"}}]}"#,
        );
        let edit = ok_in(
            &r,
            "d",
            r#"{"commands":[{"name":"text.replace","args":{"id":"p","with":"Changed"}}]}"#,
        )
        .await;
        let lineage = &edit.revision[..edit.revision.rfind(':').expect("a revision")];
        let page = EditOp::Insert {
            id: Str::from("pg"),
            block: blok_jsjson::parse_node(
                br#"{"type":"page","data":{"pageId":"sub"}}"#,
                blok_jsjson::Options::default(),
            )
            .expect("a block"),
            after: Some(Str::from("p")),
            parent: None,
        };
        let applied = r
            .manager
            .edit("d", vec![page], &new_guid(), &[0u8; 32], "u1", None)
            .await
            .expect("edit");
        assert_eq!(applied.status, EditStatus::Applied, "{trash}: page");

        ok_in(
            &r,
            "d",
            &format!(
                r#"{{"commands":[{{"name":"history.restore","args":{{"version":"{lineage}:0"}}}}]}}"#
            ),
        )
        .await;

        let exported = r.export("d").await;
        let blocks = lookup(Some(&exported), "blocks").expect("blocks");
        let by = blocks
            .items
            .iter()
            .find(|block| string_of(lookup(Some(block), "id")).as_deref() == Some("pg"))
            .map(|block| string_of(lookup(lookup(lookup(Some(block), "data"), "trashed"), "by")));
        let want = if trash {
            Some(Some("agent-cs".to_owned()))
        } else {
            None
        };
        assert_eq!(by, want, "trash {trash}");
    }
}
