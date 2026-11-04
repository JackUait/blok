use std::sync::Arc;
use std::sync::atomic::{AtomicI32, Ordering};

use blok_collab::BoxFuture;
use blok_collab_convert::{EditOp, TransientError};
use blok_collab_wire::Message;
use blok_jsjson::{Node, Object, Str};
use blok_jsruntime::{Failure, InvokeError, Kind};
use blok_yjs::Doc;

use crate::test_support::*;
use crate::*;

/// The real converter whose Export always fails.
struct FailingExport {
    inner: blok_collab_convert::DocConverter<NoHtml>,
    err: fn() -> Error,
    exports: AtomicI32,
}

impl Converter for FailingExport {
    fn seed<'a>(&'a self, doc: &'a Doc, output_data: &'a Node) -> BoxFuture<'a, Result<(), Error>> {
        Converter::seed(&self.inner, doc, output_data)
    }
    fn export<'a>(&'a self, _doc: &'a Doc) -> BoxFuture<'a, Result<Object, Error>> {
        self.exports.fetch_add(1, Ordering::SeqCst);
        let err = (self.err)();
        Box::pin(async move { Err(err) })
    }
    fn apply_ops<'a>(
        &'a self,
        doc: &'a Doc,
        ops: &'a [EditOp],
    ) -> BoxFuture<'a, Result<(), Error>> {
        Converter::apply_ops(&self.inner, doc, ops)
    }
    fn migrate_rich_text<'a>(&'a self, doc: &'a Doc) -> BoxFuture<'a, Result<usize, Error>> {
        Converter::migrate_rich_text(&self.inner, doc)
    }
}

struct ExportRoom {
    manager: Manager,
    endpoint: Arc<FakeEndpoint>,
    converter: Arc<FailingExport>,
    logs: Logs,
}

fn export_room(err: fn() -> Error, operations: Option<Arc<dyn OperationStore>>) -> ExportRoom {
    let endpoint = FakeEndpoint::null();
    let converter = Arc::new(FailingExport {
        inner: real_converter(),
        err,
        exports: AtomicI32::new(0),
    });
    let logs = Logs::default();
    let manager = Manager::new(ManagerOptions {
        store: MemoryStore::new(),
        endpoint: endpoint.clone(),
        converter: converter.clone(),
        room: Options {
            export_debounce: ms(1),
            export_max_delay: ms(1),
            retry_backoff: ms(1),
            retry_backoff_cap: ms(1),
            eviction_linger: ms(20),
            ..Options::default()
        },
        log: Some(logs.log()),
        operations,
        activity: None,
    });
    ExportRoom {
        manager,
        endpoint,
        converter,
        logs,
    }
}

fn runtime_limit() -> Error {
    Error::Convert(blok_collab_convert::Error::Transient(TransientError {
        message: "collab: the rich text HTML could not be read".to_owned(),
        err: Box::new(blok_collab_convert::Error::Runtime(InvokeError::Failure(
            Failure {
                kind: Kind::TimedOut,
                err: blok_jsruntime::Error::Engine("timed out".to_owned()),
            },
        ))),
    }))
}

fn invalid_data() -> Error {
    Error::Journal(blok_collab_journal::Error::InvalidData {
        message: "collab: block \"b-1\" has data that is not a map.".to_owned(),
        source: None,
    })
}

// Twin of ATransientExportFailureThatNeverHealsIsGivenUp (M28), on a room
// without a journal: eight runtime-limit failures, then no more attempts.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_transient_export_failure_that_never_heals_is_given_up() {
    let e = export_room(runtime_limit, None);
    let membership = join(&e.manager, "doc", &FakeMember::v1(true)).await;
    receive(
        &membership,
        Message::SyncUpdate {
            update: client_update(9, "k"),
        },
    )
    .await;

    wait_until("the give-up", || {
        e.logs.matching("gave up exporting after 8 attempts").len() == 1
    })
    .await;
    tokio::time::sleep(ms(100)).await;

    assert_eq!(
        e.converter.exports.load(Ordering::SeqCst),
        8,
        "no retry after the give-up"
    );
    assert_eq!(e.endpoint.saved(), 0, "a PUT was sent");
}

// A failure that is not transient on a journal room is refused at once and
// never retried (CollabRoom.cs:3358-3429).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_non_transient_export_failure_on_a_journal_room_is_refused_at_once() {
    let (journal, _dir) = open_journal();
    let e = export_room(invalid_data, Some(journal));
    // Unheld, the 20 ms linger can fire during a slow checkpoint and evict
    // before the checkpoint's export runs. C# holds a member the same way.
    let membership = join(&e.manager, "doc", &FakeMember::v1(true)).await;
    let block = node(r#"{"type":"custom","data":{"n":1}}"#);
    let result = e
        .manager
        .edit(
            "doc",
            vec![EditOp::Insert {
                id: Str::from("a"),
                block,
                after: None,
                parent: None,
            }],
            "00000000000000000000000000000001",
            &[0; 32],
            "",
            None,
        )
        .await
        .expect("edit");
    assert_eq!(result.status, EditStatus::Applied, "{:?}", result.err);
    assert!(e.manager.checkpoint("doc").await.expect("checkpoint"));

    wait_until("the refusal", || {
        e.logs.matching("cannot export its document").len() == 1
    })
    .await;
    tokio::time::sleep(ms(50)).await;
    assert_eq!(
        e.converter.exports.load(Ordering::SeqCst),
        1,
        "the refusal was retried while the room was occupied"
    );
    membership.leave();
    // The refusal releases the hold a dirty projection puts on eviction.
    wait_until("the room to be evicted", || {
        e.manager.live_room_count() == 0
    })
    .await;
    tokio::time::sleep(ms(50)).await;

    // The checkpoint's attempt and the eviction flush's, as C# counts them.
    assert_eq!(e.converter.exports.load(Ordering::SeqCst), 2);
    assert_eq!(
        e.logs.matching("retrying").len(),
        0,
        "the refusal was retried"
    );
    assert_eq!(e.endpoint.saved(), 0);
    assert_eq!(
        e.logs.matching("b-1").len(),
        1,
        "the refusal was logged twice"
    );
}

// M18, S3: a state read whose export hits a runtime limit is Overloaded
// (503 + Retry-After); any other export failure is ExportFailed (500).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_state_read_maps_export_failures() {
    let cases: [(fn() -> Error, StateStatus); 3] = [
        (runtime_limit, StateStatus::Overloaded),
        (invalid_data, StateStatus::ExportFailed),
        (
            || Error::message("anything else"),
            StateStatus::ExportFailed,
        ),
    ];
    for (err, want) in cases {
        let e = export_room(err, None);
        let result = e.manager.state("doc").await.expect("state");
        assert_eq!(result.status, want, "{}", err());
    }
}
