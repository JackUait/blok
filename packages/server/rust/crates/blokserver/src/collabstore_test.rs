use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use blok_auth::User;
use blok_collab::BoxFuture;
use blok_collab_journal::Context;
use blok_collab_operation::{AppendResult, Candidate, Checkpoint, Head, Lookup, OpenResult, Reset};
use blok_collab_room::{
    ActivityKind, ActivityObserver, Error, HistoryStore, LocalJournal, Opened, OperationSession,
    OperationStore, PurgeStore,
};
use blok_http::{Handler, Request, ResponseWriter};

use crate::testutil::{Answer, Running, send, start, temp_dir};
use crate::{Options, Server};

/// A host store: the built-in journal behind a recorder, so the test sees
/// which store the rooms opened. It keeps history only when `keeps`.
struct Opening {
    opened: Mutex<Vec<String>>,
    inner: LocalJournal,
    keeps: bool,
}

impl OperationStore for Opening {
    fn open<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<Opened, Error>> {
        self.opened.lock().unwrap().push(doc_id.to_owned());
        self.inner.open(ctx, doc_id)
    }
    fn as_purge(&self) -> Option<&dyn PurgeStore> {
        self.keeps.then_some(&self.inner as &dyn PurgeStore)
    }
    fn as_history(&self) -> Option<&dyn HistoryStore> {
        self.keeps.then_some(&self.inner as &dyn HistoryStore)
    }
    fn type_name(&self) -> &'static str {
        "blokserver_test.opening"
    }
}

#[derive(Default)]
struct Observed(Mutex<Vec<String>>, Mutex<Vec<SystemTime>>);

impl ActivityObserver for Observed {
    fn record<'a>(
        &'a self,
        doc_id: &'a str,
        actor_id: &'a str,
        at: SystemTime,
        kind: ActivityKind,
    ) -> BoxFuture<'a, Result<(), Error>> {
        self.1.lock().unwrap().push(at);
        self.0
            .lock()
            .unwrap()
            .push(format!("{doc_id} {actor_id} {kind}"));
        Box::pin(async { Ok(()) })
    }
}

fn local_journal() -> LocalJournal {
    LocalJournal(blok_collab_journal::Store::new(temp_dir(), Default::default()).unwrap())
}

struct Host {
    running: Running,
    _endpoint: Running,
    server: Server,
}

/// The server's routes behind a host middleware that signs in u1.
async fn host_server(configure: impl FnOnce(&mut Options)) -> Host {
    let endpoint = start(
        |request: Request, mut response: ResponseWriter| async move {
            if request.method() == "GET" {
                let _ = response.write(b"null").await;
                return;
            }
            response.set_status(204);
        },
    )
    .await;
    let mut options = Options {
        auth: "none".into(),
        collab_enabled: true,
        collab_directory: temp_dir().display().to_string(),
        doc_endpoint: format!("http://{}/docs", endpoint.address),
        ..Options::default()
    };
    configure(&mut options);
    let server = Server::new(options).unwrap();
    let handler = Arc::new(server.handler(""));
    let running = start(move |mut request: Request, response: ResponseWriter| {
        let handler = handler.clone();
        request.extensions.insert(User {
            id: "u1".into(),
            authenticated: true,
            write: true,
            ..User::default()
        });
        async move { handler.serve(request, response).await }
    })
    .await;
    Host {
        running,
        _endpoint: endpoint,
        server,
    }
}

impl Host {
    async fn edit(&self, doc: &str, key: &str) -> Answer {
        let body = format!(
            r#"{{"ops":[{{"op":"insert","id":"{key}","block":{{"type":"paragraph","data":{{"text":"x"}}}}}}]}}"#
        );
        send(
            self.running.address,
            &format!(
                "POST /sync/{doc}/edit HTTP/1.1\r\nBlok-Idempotency-Key: {key}\r\nContent-Length: {}",
                body.len()
            ),
            body.as_bytes(),
        )
        .await
    }

    async fn get(&self, path: &str) -> Answer {
        send(self.running.address, &format!("GET {path} HTTP/1.1"), b"").await
    }

    async fn close(self) {
        let _ = self.server.drain(Duration::from_secs(30)).await;
    }
}

// T1, T7: UseCollabOperationStore<T> turns the journal on with the host's
// store; history needs a store that also keeps it (T2), as C#'s
// "is ICollabOperationHistoryStore".
#[tokio::test(flavor = "multi_thread")]
async fn a_host_operation_store_turns_the_journal_on() {
    let store = Arc::new(Opening {
        opened: Mutex::default(),
        inner: local_journal(),
        keeps: false,
    });
    let host = host_server(|o| o.collab_operation_store = Some(store.clone())).await;

    let response = host.edit("doc", "k1").await;
    assert_eq!(
        (response.status, response.header("Blok-Doc-Sequence")),
        (204, "1"),
        "edit: {}",
        response.text()
    );
    assert_eq!(store.opened.lock().unwrap().join(","), "doc");
    let history = host.get("/sync/doc/history").await;
    assert_eq!(
        (history.status, history.text().as_str()),
        (501, "history needs a journal that keeps it\n")
    );
    host.close().await;

    let kept = Arc::new(Opening {
        opened: Mutex::default(),
        inner: local_journal(),
        keeps: true,
    });
    let with_history = host_server(|o| o.collab_operation_store = Some(kept)).await;
    assert_eq!(with_history.edit("doc", "k1").await.status, 204);
    let history = with_history.get("/sync/doc/history").await;
    assert!(
        history.status == 200 && history.text().contains(r#""sequence":1"#),
        "history: {} {:?}",
        history.status,
        history.text()
    );
    with_history.close().await;
}

// T5, T7: UseCollabActivityObserver<T>; an edit is recorded once it is
// journalled, under the caller's id.
#[tokio::test(flavor = "multi_thread")]
async fn a_host_activity_observer_hears_an_edit() {
    let observer = Arc::new(Observed::default());
    let host = host_server(|o| {
        o.collab_journal = true;
        o.collab_activity_observer = Some(observer.clone());
    })
    .await;
    assert_eq!(host.edit("doc", "k1").await.status, 204);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while observer.0.lock().unwrap().is_empty() && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(observer.0.lock().unwrap().join(","), "doc u1 Edited");
    host.close().await;
}

// C# hands the host's TimeProvider to the room manager, so activity is
// stamped with the host's clock.
#[tokio::test(flavor = "multi_thread")]
async fn activity_is_stamped_with_the_host_clock() {
    let observer = Arc::new(Observed::default());
    let fixed = SystemTime::UNIX_EPOCH + Duration::from_secs(981_173_106);
    let host = host_server(|o| {
        o.collab_journal = true;
        o.collab_activity_observer = Some(observer.clone());
        o.clock = Some(Arc::new(move || fixed));
    })
    .await;
    assert_eq!(host.edit("doc", "k1").await.status, 204);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while observer.0.lock().unwrap().is_empty() && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(*observer.1.lock().unwrap(), [fixed]);
    host.close().await;
}

type Failure = fn() -> Error;

/// Wraps each session so its checkpoint fails with the error.
struct FailingCheckpoints {
    inner: LocalJournal,
    err: Failure,
}

impl OperationStore for FailingCheckpoints {
    fn open<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<Opened, Error>> {
        Box::pin(async move {
            let (outcome, session) = self.inner.open(ctx, doc_id).await?;
            let session = session.map(|session| {
                Arc::new(FailingSession {
                    inner: session,
                    err: self.err,
                }) as Arc<dyn OperationSession>
            });
            Ok((outcome, session))
        })
    }
    fn type_name(&self) -> &'static str {
        "blokserver_test.failingCheckpoints"
    }
}

struct FailingSession {
    inner: Arc<dyn OperationSession>,
    err: Failure,
}

impl OperationSession for FailingSession {
    fn open_result(&self) -> &OpenResult {
        self.inner.open_result()
    }
    fn find_committed<'a>(
        &'a self,
        ctx: &'a Context,
        operation_id: &'a str,
        digest: &'a [u8],
    ) -> BoxFuture<'a, Result<Lookup, Error>> {
        self.inner.find_committed(ctx, operation_id, digest)
    }
    fn append<'a>(
        &'a self,
        ctx: &'a Context,
        candidate: Candidate,
    ) -> BoxFuture<'a, Result<AppendResult, Error>> {
        self.inner.append(ctx, candidate)
    }
    fn write_checkpoint<'a>(
        &'a self,
        _ctx: &'a Context,
        _checkpoint: Checkpoint,
    ) -> BoxFuture<'a, Result<(), Error>> {
        let err = (self.err)();
        Box::pin(async move { Err(err) })
    }
    fn reset<'a>(&'a self, ctx: &'a Context, reset: Reset) -> BoxFuture<'a, Result<Head, Error>> {
        self.inner.reset(ctx, reset)
    }
    fn close(&self) -> BoxFuture<'_, Result<(), Error>> {
        self.inner.close()
    }
}

// T4: a host store fails a checkpoint with the same error values the
// built-in journal uses. Unreadable data fails the room, so the next edit
// is refused; any other error is retried and edits go on.
#[tokio::test(flavor = "multi_thread")]
async fn a_host_stores_checkpoint_error_decides_between_fail_and_retry() {
    let cases: [(&str, Failure, u16); 4] = [
        (
            "invalid data",
            || {
                Error::Journal(blok_collab_journal::Error::InvalidData {
                    message: "unreadable".into(),
                    source: None,
                })
            },
            503,
        ),
        (
            "out of range",
            || {
                Error::Journal(blok_collab_journal::Error::Argument {
                    message: "sequence".into(),
                    out_of_range: true,
                })
            },
            503,
        ),
        (
            "fence lost",
            || Error::Journal(blok_collab_journal::Error::FenceLost),
            503,
        ),
        ("other", || Error::message("disk busy"), 204),
    ];
    for (name, err, status) in cases {
        let store = Arc::new(FailingCheckpoints {
            inner: local_journal(),
            err,
        });
        let host = host_server(|o| o.collab_operation_store = Some(store)).await;
        // 64 operations since the last checkpoint publish the next one.
        for i in 1..=64 {
            let response = host.edit("doc", &format!("k{i}")).await;
            assert_eq!(
                response.status,
                204,
                "{name}: edit {i}: {}",
                response.text()
            );
        }
        // The checkpoint is queued behind edit 64, so it runs before this one.
        let got = host.edit("doc", "after").await.status;
        assert_eq!(got, status, "{name}: the edit after the checkpoint");
        host.close().await;
    }
}

// HostCollabTests.cs

impl Host {
    /// PostEditAsync: an insert of `id` with text `id`.
    async fn insert(&self, key: &str, id: &str) -> Answer {
        let body = format!(
            r#"{{ "ops": [ {{ "op": "insert", "id": "{id}", "block": {{ "type": "paragraph", "data": {{ "text": "{id}" }} }} }} ] }}"#
        );
        send(
            self.running.address,
            &format!(
                "POST /sync/doc-1/edit HTTP/1.1\r\nContent-Type: application/json; charset=utf-8\r\nBlok-Idempotency-Key: {key}\r\nContent-Length: {}",
                body.len()
            ),
            body.as_bytes(),
        )
        .await
    }
}

fn block_ids(output: &[u8]) -> Vec<String> {
    let node = blok_jsjson::parse_node(output, Default::default()).unwrap();
    node.lookup("blocks")
        .unwrap()
        .expect("no blocks array")
        .items
        .iter()
        .map(|b| {
            blok_jsjson::to_string_lossy(b.lookup("id").unwrap().unwrap().text().unwrap().units())
        })
        .collect()
}

/// Names under `dir`: (regular files, directories ending ".journal").
fn listing(dir: &std::path::Path) -> (Vec<String>, Vec<String>) {
    let (mut files, mut journals) = (Vec::new(), Vec::new());
    for entry in std::fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name().to_string_lossy().into_owned();
        let kind = entry.file_type().unwrap();
        if kind.is_file() {
            files.push(name);
        } else if kind.is_dir() && name.ends_with(".journal") {
            journals.push(name);
        }
    }
    (files, journals)
}

#[tokio::test(flavor = "multi_thread")]
async fn the_collab_journal_flag_turns_on_receipts_and_key_dedupe_on_edit() {
    let collab = temp_dir().join("collab");
    let dir = collab.display().to_string();
    let host = host_server(|o| {
        o.collab_journal = true;
        o.collab_directory = dir;
    })
    .await;

    let first = host.insert("journal-key", "first").await;
    let replay = host.insert("journal-key", "first").await;
    let next = host.insert("journal-key-2", "second").await;

    assert_eq!(first.status, 204, "{}", first.text());
    assert_eq!(replay.status, 204, "{}", replay.text());
    let lineage = first.header("Blok-Doc-Lineage").to_owned();
    assert!(
        lineage.len() == 32
            && lineage
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "lineage {lineage:?}"
    );
    assert_eq!(first.header("Blok-Doc-Sequence"), "1");
    assert_eq!(replay.header("Blok-Doc-Lineage"), lineage);
    assert_eq!(replay.header("Blok-Doc-Sequence"), "1");
    assert_eq!(next.header("Blok-Doc-Sequence"), "2");

    let state = host.get("/sync/doc-1/state").await;
    assert_eq!(state.status, 200, "{}", state.text());
    assert_eq!(state.header("ETag"), format!("\"{lineage}:2\""));
    // An insert with no "after" goes first, so the later edit leads.
    assert_eq!(block_ids(&state.body), ["second", "first"]);
    assert!(!listing(&collab).1.is_empty(), "no *.journal directory");
    host.close().await;
}

// The endpoint GET answers null, so after the switch the block can only come
// from the working set the first boot left. Once adopted the working-set
// file goes.
#[tokio::test(flavor = "multi_thread")]
async fn turning_the_journal_on_keeps_what_the_working_set_held() {
    let collab = temp_dir().join("collab");
    let dir = collab.display().to_string();

    let before = host_server(|o| o.collab_directory = dir.clone()).await;
    let edit = before.insert("before-switch", "kept").await;
    assert_eq!(edit.status, 204, "{}", edit.text());
    before.close().await;

    let after = host_server(|o| {
        o.collab_journal = true;
        o.collab_directory = dir;
    })
    .await;
    let state = after.get("/sync/doc-1/state").await;
    assert_eq!(state.status, 200, "{}", state.text());
    assert_eq!(block_ids(&state.body), ["kept"]);
    assert_eq!(state.header("Blok-Doc-Sequence"), "0");
    let (files, journals) = listing(&collab);
    assert!(files.is_empty(), "plain files left: {files:?}");
    assert_eq!(journals.len(), 1, "{journals:?}");
    after.close().await;
}

impl Host {
    async fn post(&self, path: &str, key: &str, body: &str) -> Answer {
        send(
            self.running.address,
            &format!(
                "POST {path} HTTP/1.1\r\nBlok-Idempotency-Key: {key}\r\nContent-Length: {}",
                body.len()
            ),
            body.as_bytes(),
        )
        .await
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_collab_journal_option_registers_the_local_journal_unless_a_store_replaces_it() {
    let host = host_server(|o| o.collab_journal = true).await;
    for (key, sequence) in [("k1", "1"), ("k2", "2")] {
        let response = host.edit("doc", key).await;
        assert_eq!(
            (response.status, response.header("Blok-Doc-Sequence")),
            (204, sequence),
            "edit {key}: {}",
            response.text()
        );
    }
    let history = host.get("/sync/doc/history").await;
    assert!(
        history.status == 200 && history.text().contains(r#""sequence":2"#),
        "history: {} {:?}",
        history.status,
        history.text()
    );
    host.close().await;

    let store = Arc::new(Opening {
        opened: Mutex::default(),
        inner: local_journal(),
        keeps: false,
    });
    let replaced = host_server(|o| {
        o.collab_journal = true;
        o.collab_operation_store = Some(store.clone());
    })
    .await;
    assert_eq!(replaced.edit("doc", "k1").await.status, 204);
    assert_eq!(store.opened.lock().unwrap().join(","), "doc");
    let history = replaced.get("/sync/doc/history").await;
    assert_eq!(
        (history.status, history.text().as_str()),
        (501, "history needs a journal that keeps it\n")
    );
    replaced.close().await;
}

// C# reads CollabRoomManager.Options; Rust's Manager hides them, so the
// limit is read off a restore. 1.5 MiB is over the built-in journal's 1 MiB
// append limit and under the announced 4 MiB.
#[tokio::test(flavor = "multi_thread")]
async fn rooms_know_the_built_in_journals_update_limit_but_not_a_custom_stores() {
    // An edit may send at most 32768 HTML characters per field, so the
    // 1.5 MiB is 48 blocks of 32000.
    async fn restore_a_large_removal(host: &Host) -> Answer {
        let text = "x".repeat(32_000);
        let mut lineage = String::new();
        for edit in 0..3 {
            let ops: Vec<String> = (0..16)
                .map(|n| {
                    format!(
                        r#"{{"op":"insert","id":"b{edit}-{n}","block":{{"type":"paragraph","data":{{"text":"{text}"}}}}}}"#
                    )
                })
                .collect();
            let body = format!(r#"{{"ops":[{}]}}"#, ops.join(","));
            let response = host
                .post("/sync/doc/edit", &format!("i{edit}"), &body)
                .await;
            assert_eq!(response.status, 204, "insert {edit}: {}", response.text());
            lineage = response.header("Blok-Doc-Lineage").to_owned();
        }
        let removes: Vec<String> = (0..3)
            .flat_map(|edit| {
                (0..16).map(move |n| format!(r#"{{"op":"remove","id":"b{edit}-{n}"}}"#))
            })
            .collect();
        let body = format!(r#"{{"ops":[{}]}}"#, removes.join(","));
        let response = host.post("/sync/doc/edit", "removes", &body).await;
        assert_eq!(response.status, 204, "removes: {}", response.text());
        host.post(
            &format!("/sync/doc/history/{lineage}/3/restore"),
            "restore",
            "",
        )
        .await
    }

    let built_in = host_server(|o| {
        o.collab_journal = true;
        o.collab_max_message_bytes = 4 << 20;
    })
    .await;
    let restore = restore_a_large_removal(&built_in).await;
    assert_eq!(
        (restore.status, restore.text().as_str()),
        (
            413,
            "collab: the restore is larger than one update may be.\n"
        )
    );
    built_in.close().await;

    let roomy = blok_collab_journal::Store::new(
        temp_dir(),
        blok_collab_journal::StoreOptions {
            max_update_bytes: 8 << 20,
            ..Default::default()
        },
    )
    .unwrap();
    let store = Arc::new(Opening {
        opened: Mutex::default(),
        inner: LocalJournal(roomy),
        keeps: true,
    });
    let custom = host_server(|o| {
        o.collab_journal = true;
        o.collab_max_message_bytes = 4 << 20;
        o.collab_operation_store = Some(store);
    })
    .await;
    let restore = restore_a_large_removal(&custom).await;
    assert_eq!(restore.status, 204, "restore: {}", restore.text());
    custom.close().await;
}
