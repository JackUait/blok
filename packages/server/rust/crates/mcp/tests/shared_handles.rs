//! Stored handles in a shared handle store (`Hooks::handle_store`): two
//! servers on one store stand for two processes on one store.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_mcp::bundle::Bundle;
use blok_mcp::handle_store::{
    Acquired, HandleLease, HandleRecord, HandleStore, MemoryHandleStore, StoreError,
};
use blok_mcp::options::Hooks;
use blok_mcp::server::{Approval, Caller, Mcp, Outcome};
use blok_mcp::uploads::BoxFuture;
use serde_json::{Value, json};

const DOC: &str =
    r#"{"title":"Notes","blocks":[{"id":"p1","type":"paragraph","data":{"text":"Hello"}}]}"#;

fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "blok-mcp-shared-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("doc.json"), DOC).unwrap();
    std::fs::write(dir.join("other.json"), r#"{"blocks":[]}"#).unwrap();
    dir
}

fn options(dir: &std::path::Path) -> Value {
    json!({
        "transport": { "kind": "stdio" },
        "auth": { "kind": "none" },
        "source": { "kind": "files", "dir": dir.to_string_lossy() },
    })
}

async fn server(options: &Value, store: Arc<dyn HandleStore>) -> Mcp {
    let hooks = Hooks {
        handle_store: Some(store),
        ..Hooks::default()
    };
    Mcp::with_hooks(Arc::new(Bundle::new(1).unwrap()), options, hooks)
        .await
        .unwrap()
}

fn caller(principal: &str, client: &str) -> Caller {
    Caller {
        principal: principal.to_owned(),
        client_name: Some(client.to_owned()),
        scopes: None,
    }
}

async fn call_as(mcp: &Mcp, who: &Caller, name: &str, args: Value) -> Value {
    match mcp
        .call(name, &args, who, &Approval::default(), &|| false)
        .await
    {
        Ok(Outcome::Answer(answer)) => serde_json::from_str(&answer.structured).unwrap(),
        other => panic!("{name}: {other:?}"),
    }
}

async fn call(mcp: &Mcp, name: &str, args: Value) -> Value {
    call_as(mcp, &caller("alice", "Desk"), name, args).await
}

async fn open(mcp: &Mcp) -> String {
    let opened = call(
        mcp,
        "blok_open",
        json!({ "documentId": "doc", "write": true }),
    )
    .await;
    opened["handle"]
        .as_str()
        .unwrap_or_else(|| panic!("{opened}"))
        .to_owned()
}

fn insert(text: &str) -> Value {
    json!([{ "name": "block.insert", "args": { "type": "paragraph", "id": text, "data": { "text": text }, "position": "end" } }])
}

fn texts(read: &Value) -> Vec<String> {
    read["blocks"]
        .as_array()
        .unwrap_or_else(|| panic!("{read}"))
        .iter()
        .map(|b| b["text"].as_str().unwrap_or_default().to_owned())
        .collect()
}

struct Pair {
    dir: std::path::PathBuf,
    a: Mcp,
    b: Mcp,
}

impl Drop for Pair {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

async fn pair(name: &str, store: Arc<dyn HandleStore>) -> Pair {
    let dir = temp_dir(name);
    let a = server(&options(&dir), store.clone()).await;
    let b = server(&options(&dir), store).await;
    Pair { dir, a, b }
}

fn memory() -> Arc<dyn HandleStore> {
    Arc::new(MemoryHandleStore::new())
}

#[tokio::test(flavor = "multi_thread")]
async fn a_handle_opened_on_one_server_is_used_and_undone_on_the_other() {
    let p = pair("ab", memory()).await;
    let handle = open(&p.a).await;
    let ran = call(
        &p.b,
        "blok_execute",
        json!({ "handle": handle, "commands": insert("World") }),
    )
    .await;
    assert_eq!(ran["ok"], true, "{ran}");
    let read = call(&p.a, "blok_read", json!({ "handle": handle })).await;
    assert_eq!(texts(&read), vec!["Hello", "World"]);
    let undone = call(
        &p.a,
        "blok_execute",
        json!({ "handle": handle, "commands": [{ "name": "history.undo", "args": {} }] }),
    )
    .await;
    assert_eq!(undone["ok"], true, "{undone}");
    let read = call(&p.b, "blok_read", json!({ "handle": handle })).await;
    assert_eq!(texts(&read), vec!["Hello"]);
    // Closed on one, unknown on both.
    let closed = call(&p.b, "blok_close", json!({ "handle": handle })).await;
    assert_eq!(closed["closed"], true, "{closed}");
    let gone = call(&p.a, "blok_read", json!({ "handle": handle })).await;
    assert_eq!(gone["error"]["code"], "UNKNOWN_HANDLE", "{gone}");
}

#[tokio::test(flavor = "multi_thread")]
async fn another_principal_gets_unknown_handle_and_the_owner_keeps_it() {
    let p = pair("principal", memory()).await;
    let handle = open(&p.a).await;
    let bob = call_as(
        &p.b,
        &caller("bob", "Desk"),
        "blok_read",
        json!({ "handle": handle }),
    )
    .await;
    assert_eq!(bob["error"]["code"], "UNKNOWN_HANDLE", "{bob}");
    let closing = call_as(
        &p.b,
        &caller("bob", "Desk"),
        "blok_close",
        json!({ "handle": handle }),
    )
    .await;
    assert_eq!(closing["error"]["code"], "UNKNOWN_HANDLE", "{closing}");
    let read = call(&p.b, "blok_read", json!({ "handle": handle })).await;
    assert_eq!(texts(&read), vec!["Hello"]);
}

// The opener's caller, client and actor come from the record: the host's
// source saves for the opener, whoever sends the call.
#[tokio::test(flavor = "multi_thread")]
async fn a_restored_handle_acts_for_its_opener() {
    let source = Arc::new(Recording::default());
    let store = memory();
    let make = || async {
        let hooks = Hooks {
            handle_store: Some(store.clone()),
            source: Some(source.clone()),
            ..Hooks::default()
        };
        let options = json!({ "transport": { "kind": "stdio" }, "auth": { "kind": "none" } });
        Mcp::with_hooks(Arc::new(Bundle::new(1).unwrap()), &options, hooks)
            .await
            .unwrap()
    };
    let (a, b) = (make().await, make().await);
    let handle = open(&a).await;
    let ran = call_as(
        &b,
        &caller("alice", "Other"),
        "blok_execute",
        json!({ "handle": handle, "commands": insert("World") }),
    )
    .await;
    assert_eq!(ran["ok"], true, "{ran}");
    assert_eq!(
        *source.savers.lock().unwrap(),
        vec![("Desk".to_owned(), "agent:alice:Desk".to_owned())]
    );
}

/// A host source that remembers who saved.
#[derive(Default)]
struct Recording {
    documents: Mutex<std::collections::HashMap<String, String>>,
    savers: Mutex<Vec<(String, String)>>,
}

impl blok_mcp::document_source::DocumentSource for Recording {
    fn load(
        &self,
        _: blok_mcp::document_source::DocumentCaller,
        id: String,
    ) -> BoxFuture<
        '_,
        Result<
            Option<blok_mcp::document_source::StoredDocument>,
            blok_mcp::document_source::SourceError,
        >,
    > {
        let text = self.documents.lock().unwrap().get(&id).cloned();
        Box::pin(async move {
            Ok(Some(blok_mcp::document_source::StoredDocument {
                document_text: text.unwrap_or_else(|| DOC.to_owned()),
                version: Some("1".to_owned()),
            }))
        })
    }

    fn save(
        &self,
        caller: blok_mcp::document_source::DocumentCaller,
        id: String,
        text: String,
        _: Option<String>,
    ) -> BoxFuture<'_, Result<Option<String>, blok_mcp::document_source::SourceError>> {
        self.savers
            .lock()
            .unwrap()
            .push((caller.client_name.clone(), caller.actor.id.clone()));
        self.documents.lock().unwrap().insert(id, text);
        Box::pin(async { Ok(Some("2".to_owned())) })
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_cap_counts_both_servers_and_a_close_frees_a_place() {
    let p = pair("cap", memory()).await;
    let mut handles = Vec::new();
    for n in 0..8 {
        let on = if n % 2 == 0 { &p.a } else { &p.b };
        handles.push(open(on).await);
    }
    for on in [&p.a, &p.b] {
        let refused = call(on, "blok_open", json!({ "documentId": "doc" })).await;
        assert_eq!(refused["error"]["code"], "HANDLE_LIMIT", "{refused}");
    }
    call(&p.b, "blok_close", json!({ "handle": handles[0] })).await;
    let opened = call(&p.a, "blok_open", json!({ "documentId": "other" })).await;
    assert!(opened["handle"].is_string(), "{opened}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_handle_that_is_not_a_minted_shape_never_reaches_the_store() {
    let store = Arc::new(Counting::new(MemoryHandleStore::new()));
    let p = pair("shape", store.clone()).await;
    for bad in ["../x", "a b", &"a".repeat(129)] {
        let read = call(&p.a, "blok_read", json!({ "handle": bad })).await;
        assert_eq!(read["error"]["code"], "UNKNOWN_HANDLE", "{read}");
        let closed = call(&p.a, "blok_close", json!({ "handle": bad })).await;
        assert_eq!(closed["error"]["code"], "UNKNOWN_HANDLE", "{closed}");
    }
    assert_eq!(store.acquires.load(Ordering::SeqCst), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_handle_from_another_tool_contract_answers_version_skew() {
    let dir = temp_dir("skew");
    let store = memory();
    let a = server(&options(&dir), store.clone()).await;
    let mut other = options(&dir);
    other["pageTitles"] = json!("page-map");
    let b = server(&other, store).await;
    let handle = open(&a).await;
    let read = call(&b, "blok_read", json!({ "handle": handle })).await;
    assert_eq!(read["error"]["code"], "VERSION_SKEW", "{read}");
    // A close still works across contracts.
    let closed = call(&b, "blok_close", json!({ "handle": handle })).await;
    assert_eq!(closed["closed"], true, "{closed}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_store_that_fails_answers_source_unavailable() {
    let store = Arc::new(Counting::new(MemoryHandleStore::new()));
    let p = pair("down", store.clone()).await;
    let handle = open(&p.a).await;
    store.fail_acquire.store(true, Ordering::SeqCst);
    let read = call(&p.b, "blok_read", json!({ "handle": handle })).await;
    assert_eq!(
        read["error"],
        json!({ "code": "SOURCE_UNAVAILABLE", "message": "The handle store is unavailable. Retry shortly.", "retryable": true }),
        "{read}"
    );
}

// The source already has the batch: the answer stands, and the record that
// would save with an old version is dropped.
#[tokio::test(flavor = "multi_thread")]
async fn a_record_that_cannot_be_saved_after_the_source_save_closes_the_handle() {
    let store = Arc::new(Counting::new(MemoryHandleStore::new()));
    let p = pair("save-fails", store.clone()).await;
    let handle = open(&p.a).await;
    store.fail_save.store(true, Ordering::SeqCst);
    let ran = call(
        &p.b,
        "blok_execute",
        json!({ "handle": handle, "commands": insert("World") }),
    )
    .await;
    assert_eq!(ran["ok"], true, "{ran}");
    assert!(
        std::fs::read_to_string(p.dir.join("doc.json"))
            .unwrap()
            .contains("World")
    );
    store.fail_save.store(false, Ordering::SeqCst);
    let gone = call(&p.a, "blok_read", json!({ "handle": handle })).await;
    assert_eq!(gone["error"]["code"], "UNKNOWN_HANDLE", "{gone}");
}

// Steps whose revision is not the record's document's never undo onto it.
#[tokio::test(flavor = "multi_thread")]
async fn restored_steps_that_do_not_match_the_document_answer_conflict() {
    let memory = MemoryHandleStore::new();
    let p = pair("conflict", Arc::new(memory.clone())).await;
    let handle = open(&p.a).await;
    let ran = call(
        &p.a,
        "blok_execute",
        json!({ "handle": handle, "commands": insert("World") }),
    )
    .await;
    assert_eq!(ran["ok"], true, "{ran}");
    let Acquired::Lease(lease) = memory
        .acquire(
            handle.clone(),
            Duration::from_secs(60),
            Duration::from_secs(1),
        )
        .await
        .unwrap()
    else {
        panic!("no lease");
    };
    let mut forged = lease.record().clone();
    let mut history: Value = serde_json::from_str(forged.history.get()).unwrap();
    history["revision"] = json!("not-this-document");
    forged.history = serde_json::value::RawValue::from_string(history.to_string()).unwrap();
    lease.save(forged).await.unwrap();
    lease.release().await.unwrap();
    let undone = call(
        &p.b,
        "blok_execute",
        json!({ "handle": handle, "commands": [{ "name": "history.undo", "args": {} }] }),
    )
    .await;
    assert_eq!(undone["error"]["code"], "CONFLICT", "{undone}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_stopped_server_leaves_its_handles_in_the_store() {
    let p = pair("stop", memory()).await;
    let handle = open(&p.b).await;
    p.b.stop_opening();
    p.b.close_all(Duration::from_secs(1)).await;
    let read = call(&p.a, "blok_read", json!({ "handle": handle })).await;
    assert_eq!(texts(&read), vec!["Hello"]);
    let refused = call(&p.b, "blok_open", json!({ "documentId": "doc" })).await;
    assert_eq!(
        refused["error"]["message"], "The server is shutting down.",
        "{refused}"
    );
}

/// A store that counts acquires and can be made to fail.
struct Counting {
    inner: MemoryHandleStore,
    acquires: AtomicUsize,
    fail_acquire: std::sync::atomic::AtomicBool,
    fail_save: Arc<std::sync::atomic::AtomicBool>,
}

impl Counting {
    fn new(inner: MemoryHandleStore) -> Counting {
        Counting {
            inner,
            acquires: AtomicUsize::new(0),
            fail_acquire: std::sync::atomic::AtomicBool::new(false),
            fail_save: Arc::default(),
        }
    }
}

struct FailingSave {
    inner: Box<dyn HandleLease>,
    fail: Arc<std::sync::atomic::AtomicBool>,
    _held: Mutex<()>,
}

impl HandleLease for FailingSave {
    fn record(&self) -> &HandleRecord {
        self.inner.record()
    }
    fn save(&self, record: HandleRecord) -> BoxFuture<'_, Result<(), StoreError>> {
        if self.fail.load(Ordering::SeqCst) {
            return Box::pin(async { Err(StoreError("disk full".to_owned())) });
        }
        self.inner.save(record)
    }
    fn renew(&self) -> BoxFuture<'_, Result<(), StoreError>> {
        self.inner.renew()
    }
    fn remove(&self) -> BoxFuture<'_, Result<(), StoreError>> {
        self.inner.remove()
    }
    fn release(&self) -> BoxFuture<'_, Result<(), StoreError>> {
        self.inner.release()
    }
}

impl HandleStore for Counting {
    fn count(&self, principal: String, idle: Duration) -> BoxFuture<'_, Result<usize, StoreError>> {
        self.inner.count(principal, idle)
    }
    fn try_add(
        &self,
        handle: String,
        record: HandleRecord,
        max: usize,
        idle: Duration,
    ) -> BoxFuture<'_, Result<bool, StoreError>> {
        self.inner.try_add(handle, record, max, idle)
    }
    fn acquire(
        &self,
        handle: String,
        idle: Duration,
        timeout: Duration,
    ) -> BoxFuture<'_, Result<Acquired, StoreError>> {
        self.acquires.fetch_add(1, Ordering::SeqCst);
        if self.fail_acquire.load(Ordering::SeqCst) {
            return Box::pin(async { Err(StoreError("connection refused".to_owned())) });
        }
        let fail = self.fail_save.clone();
        Box::pin(async move {
            Ok(match self.inner.acquire(handle, idle, timeout).await? {
                Acquired::Lease(inner) => Acquired::Lease(Box::new(FailingSave {
                    inner,
                    fail,
                    _held: Mutex::new(()),
                })),
                other => other,
            })
        })
    }
    fn sweep(&self, idle: Duration) -> BoxFuture<'_, Result<(), StoreError>> {
        self.inner.sweep(idle)
    }
}

// The CLI takes --handle-store files:<dir> as the files store, made and
// checked at start: a refusal is a config error (exit 2), never ignored.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn the_cli_makes_the_files_store_and_refuses_an_open_directory() {
    use std::os::unix::fs::PermissionsExt;
    let bundle = Bundle::new(1).unwrap();
    let dir = temp_dir("cli");
    let open_dir = dir.join("open");
    std::fs::create_dir(&open_dir).unwrap();
    std::fs::set_permissions(&open_dir, std::fs::Permissions::from_mode(0o777)).unwrap();
    let argv = |store: &std::path::Path| -> Vec<String> {
        vec![
            "--source".to_owned(),
            format!("files:{}", dir.display()),
            "--handle-store".to_owned(),
            format!("files:{}", store.display()),
        ]
    };
    let started = blok_mcp::cli::start(&bundle, &argv(&open_dir), json!({}), &dir)
        .await
        .unwrap();
    match blok_mcp::cli::hooks_of(&started) {
        Err(blok_mcp::cli::StartError::Config(message)) => {
            assert!(message.contains("chmod 700"), "{message}");
        }
        Err(other) => panic!("{other:?}"),
        Ok(_) => panic!("an open directory was taken"),
    }
    let private = dir.join("private");
    let started = blok_mcp::cli::start(&bundle, &argv(&private), json!({}), &dir)
        .await
        .unwrap();
    let hooks = blok_mcp::cli::hooks_of(&started).unwrap();
    assert!(hooks.handle_store.is_some());
    assert!(private.is_dir());
    let _ = std::fs::remove_dir_all(&dir);
}
