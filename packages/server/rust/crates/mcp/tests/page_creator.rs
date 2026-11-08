//! The host's page creator (`Hooks::page_creator`): with it, a page insert
//! takes the host's id, and Blok never authorizes, loads or saves the page.

use std::sync::{Arc, Mutex};

use blok_blokagent::{Cancel, CancelReason, Error, HostFuture, PageCreateRequest, PageCreator};
use blok_mcp::bundle::Bundle;
use blok_mcp::options::Hooks;
use blok_mcp::server::{Approval, BuildError, Caller, Mcp, Outcome};
use serde_json::{Value, json};

/// One scripted answer per create, in order; past the script, "host-<n>".
enum Next {
    Id(&'static str),
    Owned(String),
    Refuse,
    Fail,
    Cancel,
}

#[derive(Default)]
struct Host {
    script: Mutex<Vec<Next>>,
    asked: Mutex<Vec<PageCreateRequest>>,
}

impl Host {
    fn with(script: Vec<Next>) -> Arc<Host> {
        Arc::new(Host {
            script: Mutex::new(script.into_iter().rev().collect()),
            ..Host::default()
        })
    }

    fn asked(&self) -> Vec<PageCreateRequest> {
        self.asked.lock().unwrap().clone()
    }
}

impl PageCreator for Host {
    fn create<'a>(
        &'a self,
        _: &'a Cancel,
        request: &'a PageCreateRequest,
    ) -> HostFuture<'a, Option<String>> {
        let mut asked = self.asked.lock().unwrap();
        asked.push(request.clone());
        let at = asked.len();
        let next = self.script.lock().unwrap().pop();
        Box::pin(async move {
            match next {
                None => Ok(Some(format!("host-{at}"))),
                Some(Next::Id(id)) => Ok(Some(id.to_owned())),
                Some(Next::Owned(id)) => Ok(Some(id)),
                Some(Next::Refuse) => Ok(None),
                Some(Next::Fail) => Err(Error::Host("database down".into())),
                Some(Next::Cancel) => Err(Error::Cancelled(CancelReason::Cancelled)),
            }
        })
    }
}

struct Fixture {
    dir: std::path::PathBuf,
    mcp: Mcp,
    authorized: Arc<Mutex<Vec<String>>>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn options(dir: &std::path::Path) -> Value {
    json!({
        "transport": { "kind": "stdio" },
        "auth": { "kind": "none" },
        "source": { "kind": "files", "dir": dir.to_string_lossy() },
        "pageTitles": "page-map",
    })
}

fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "blok-mcp-creator-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

async fn fixture(name: &str, parent: &str, host: Arc<Host>) -> Fixture {
    let dir = temp_dir(name);
    std::fs::write(dir.join("doc.json"), parent).unwrap();
    let authorized = Arc::new(Mutex::new(Vec::new()));
    let seen = authorized.clone();
    let hooks = Hooks {
        authorize: Some(Arc::new(
            move |_principal: String, document_id: String, _write: bool| {
                seen.lock().unwrap().push(document_id);
                async move { true }
            },
        )),
        page_creator: Some(host),
        ..Hooks::default()
    };
    let mcp = Mcp::with_hooks(Arc::new(Bundle::new(1).unwrap()), &options(&dir), hooks)
        .await
        .unwrap();
    Fixture {
        dir,
        mcp,
        authorized,
    }
}

async fn call(mcp: &Mcp, name: &str, args: Value) -> Value {
    let caller = Caller {
        principal: "alice".to_owned(),
        client_name: Some("Desk".to_owned()),
        scopes: None,
    };
    match mcp
        .call(name, &args, &caller, &Approval::default(), &|| false)
        .await
    {
        Ok(Outcome::Answer(answer)) => serde_json::from_str(&answer.structured).unwrap(),
        other => panic!("{name}: {other:?}"),
    }
}

fn insert(id: &str) -> Value {
    json!({ "name": "block.insert", "args": { "type": "page", "id": id, "position": "end" } })
}

async fn open(f: &Fixture) -> String {
    let opened = call(
        &f.mcp,
        "blok_open",
        json!({ "documentId": "doc", "write": true }),
    )
    .await;
    opened["handle"].as_str().unwrap().to_owned()
}

async fn execute(f: &Fixture, handle: &str, commands: Value) -> Value {
    call(
        &f.mcp,
        "blok_execute",
        json!({ "handle": handle, "commands": commands }),
    )
    .await
}

fn saved(f: &Fixture) -> String {
    std::fs::read_to_string(f.dir.join("doc.json")).unwrap()
}

fn files(f: &Fixture) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(&f.dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

const EMPTY: &str = r#"{"blocks":[]}"#;

#[tokio::test(flavor = "multi_thread")]
async fn a_page_insert_takes_the_hosts_id_and_blok_never_touches_the_page() {
    let host = Host::with(vec![Next::Id("host-page-1")]);
    let f = fixture("takes", EMPTY, host.clone()).await;
    let handle = open(&f).await;
    let made = execute(&f, &handle, json!([insert("np0")])).await;
    assert_eq!(made["ok"], true, "{made}");
    assert_eq!(made["blocks"][0]["data"]["pageId"], "host-page-1", "{made}");
    let asked = host.asked();
    assert_eq!(asked.len(), 1);
    assert_eq!(asked[0].parent_document_id.as_deref(), Some("doc"));
    assert_eq!(asked[0].principal.as_deref(), Some("alice"));
    assert_eq!(asked[0].actor.id, "agent:alice:Desk");
    assert_eq!(asked[0].actor.on_behalf_of.as_deref(), Some("alice"));
    assert_eq!(asked[0].suggested_page_id.chars().count(), 10);
    // The open and the call were authorized: never the new id.
    assert!(
        f.authorized.lock().unwrap().iter().all(|id| id == "doc"),
        "{:?}",
        f.authorized.lock().unwrap()
    );
    // No page document was loaded or saved here: the host owns it.
    assert_eq!(files(&f), vec!["doc.json"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_refusal_fails_the_insert_with_forbidden_and_saves_nothing() {
    let f = fixture("refuse", EMPTY, Host::with(vec![Next::Refuse])).await;
    let handle = open(&f).await;
    let refused = execute(&f, &handle, json!([insert("np0")])).await;
    assert_eq!(
        refused["error"],
        json!({ "code": "FORBIDDEN", "message": "You may not create a page document here.", "retryable": false, "commandIndex": 0 }),
        "{refused}"
    );
    assert_eq!(saved(&f), EMPTY);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_host_failure_on_the_first_page_is_source_unavailable() {
    let f = fixture("first", EMPTY, Host::with(vec![Next::Fail])).await;
    let handle = open(&f).await;
    let failed = execute(&f, &handle, json!([insert("np0")])).await;
    assert_eq!(
        failed["error"],
        json!({ "code": "SOURCE_UNAVAILABLE", "message": "The host could not create the page.", "retryable": true, "commandIndex": 0 }),
        "{failed}"
    );
    assert_eq!(saved(&f), EMPTY);
}

fn orphaned_ids(answer: &Value) -> Vec<String> {
    answer["error"]["details"]["orphaned"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["prepared"]["pageId"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_host_failure_after_a_page_lists_it_with_a_server_stop_as_the_cause() {
    let f = fixture(
        "second",
        EMPTY,
        Host::with(vec![Next::Id("host-1"), Next::Fail]),
    )
    .await;
    let handle = open(&f).await;
    let failed = execute(&f, &handle, json!([insert("np0"), insert("np1")])).await;
    assert_eq!(failed["error"]["code"], "ORPHANED_SIDE_EFFECT", "{failed}");
    assert_eq!(failed["error"]["commandIndex"], 1, "{failed}");
    assert_eq!(orphaned_ids(&failed), vec!["host-1"]);
    assert_eq!(
        failed["error"]["details"]["cause"],
        json!({ "code": "APPLY_FAILED", "message": "The batch stopped on a server error. Nothing was written.", "retryable": true, "commandIndex": 1 })
    );
    assert_eq!(saved(&f), EMPTY);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_refusal_after_a_page_lists_it_with_forbidden_as_the_cause() {
    let f = fixture(
        "second-refused",
        EMPTY,
        Host::with(vec![Next::Id("host-1"), Next::Refuse]),
    )
    .await;
    let handle = open(&f).await;
    let failed = execute(&f, &handle, json!([insert("np0"), insert("np1")])).await;
    assert_eq!(orphaned_ids(&failed), vec!["host-1"], "{failed}");
    assert_eq!(failed["error"]["details"]["cause"]["code"], "FORBIDDEN");
}

// Spec §3: a cancel after N pages is reported as a host error after N pages is.
#[tokio::test(flavor = "multi_thread")]
async fn a_cancel_after_a_page_lists_it_with_cancelled_as_the_cause() {
    let f = fixture(
        "cancel",
        EMPTY,
        Host::with(vec![Next::Id("host-1"), Next::Cancel]),
    )
    .await;
    let handle = open(&f).await;
    let failed = execute(&f, &handle, json!([insert("np0"), insert("np1")])).await;
    assert_eq!(failed["error"]["code"], "ORPHANED_SIDE_EFFECT", "{failed}");
    assert_eq!(failed["error"]["commandIndex"], 1, "{failed}");
    assert_eq!(orphaned_ids(&failed), vec!["host-1"]);
    assert_eq!(
        failed["error"]["details"]["cause"],
        // The engine's failure() marks CANCELLED retryable.
        json!({ "code": "CANCELLED", "message": "The batch was cancelled. Nothing was written.", "retryable": true, "commandIndex": 1 })
    );
    assert_eq!(
        failed["error"]["message"],
        "The batch failed after the host did work for it (The batch was cancelled. Nothing was written.). Clean up the listed items."
    );
    assert_eq!(saved(&f), EMPTY);
}

// A page the parent names must never be offered for deletion.
#[tokio::test(flavor = "multi_thread")]
async fn a_page_the_parent_already_links_is_no_orphan() {
    let parent = r#"{"blocks":[{"id":"old","type":"page","data":{"pageId":"linked"}}]}"#;
    let f = fixture(
        "linked",
        parent,
        Host::with(vec![Next::Id("linked"), Next::Fail]),
    )
    .await;
    let handle = open(&f).await;
    let failed = execute(&f, &handle, json!([insert("np0"), insert("np1")])).await;
    assert_eq!(
        failed["error"],
        json!({ "code": "APPLY_FAILED", "message": "The batch stopped on a server error. Nothing was written.", "retryable": true, "commandIndex": 1 }),
        "{failed}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn ids_are_checked_in_code_points_and_bad_ones_are_host_errors() {
    let bad = vec![
        Next::Id(""),
        Next::Id("."),
        Next::Id(".."),
        Next::Id("page\u{7}"),
        Next::Id("page\u{85}"),
        Next::Owned("a".repeat(513)),
        Next::Owned("\u{1F600}".repeat(513)),
        Next::Owned("\u{1F600}".repeat(512)),
    ];
    let count = bad.len();
    let f = fixture("ids", EMPTY, Host::with(bad)).await;
    let handle = open(&f).await;
    for at in 0..count - 1 {
        let failed = execute(&f, &handle, json!([insert(&format!("np{at}"))])).await;
        assert_eq!(
            failed["error"]["message"], "The host could not create the page.",
            "case {at}: {failed}"
        );
    }
    let made = execute(&f, &handle, json!([insert("last")])).await;
    assert_eq!(made["ok"], true, "{made}");
}

#[tokio::test(flavor = "multi_thread")]
async fn undo_and_redo_never_call_the_host() {
    let host = Host::with(vec![]);
    let f = fixture("undo", EMPTY, host.clone()).await;
    let handle = open(&f).await;
    let made = execute(&f, &handle, json!([insert("np0")])).await;
    assert_eq!(made["ok"], true, "{made}");
    let undone = execute(&f, &handle, json!([{ "name": "history.undo", "args": {} }])).await;
    assert_eq!(undone["ok"], true, "{undone}");
    let redone = execute(&f, &handle, json!([{ "name": "history.redo", "args": {} }])).await;
    assert_eq!(redone["ok"], true, "{redone}");
    assert_eq!(host.asked().len(), 1);
}

async fn start_refusal(options: Value, hooks: Hooks) -> String {
    match Mcp::build(Arc::new(Bundle::new(1).unwrap()), &options, hooks).await {
        Err(BuildError::Config(message)) => message,
        Err(other) => panic!("not a refusal: {other:?}"),
        Ok(_) => panic!("started"),
    }
}

fn creator() -> Hooks {
    Hooks {
        page_creator: Some(Host::with(vec![])),
        ..Hooks::default()
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_creator_needs_stored_mode_with_a_source() {
    let dir = temp_dir("start");
    let mut live = options(&dir);
    live["sync"] = json!({ "url": "ws://127.0.0.1:9/sync" });
    assert_eq!(
        start_refusal(live, creator()).await,
        "--create-page works in stored mode only: it cannot be used with live rooms (--sync-url)"
    );
    let no_source = json!({ "transport": { "kind": "stdio" }, "auth": { "kind": "none" }, "pageTitles": "page-map" });
    assert_eq!(
        start_refusal(no_source, creator()).await,
        "--create-page needs a document source (--source): the agent opens each new page through it"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

fn argv(args: &[&str]) -> Vec<String> {
    args.iter().map(|s| (*s).to_owned()).collect()
}

// The CLI takes --create-page as the webhook, never silently drops it.
#[tokio::test(flavor = "multi_thread")]
async fn the_cli_checks_and_keeps_create_page() {
    let bundle = Bundle::new(1).unwrap();
    let cwd = std::env::temp_dir();
    let no_source = argv(&[
        "--page-titles",
        "page-map",
        "--create-page",
        "http://127.0.0.1:9/pages",
    ]);
    match blok_mcp::cli::start(&bundle, &no_source, json!({}), &cwd).await {
        Err(blok_mcp::cli::StartError::Config(message)) => assert_eq!(
            message,
            "--create-page needs a document source (--source): the agent opens each new page through it"
        ),
        other => panic!("{other:?}"),
    }
    let ok = argv(&[
        "--source",
        "files:.",
        "--page-titles",
        "page-map",
        "--create-page",
        "http://127.0.0.1:9/pages",
    ]);
    let started = blok_mcp::cli::start(&bundle, &ok, json!({}), &cwd)
        .await
        .unwrap();
    assert_eq!(
        started.create_page.as_deref(),
        Some("http://127.0.0.1:9/pages")
    );
}

// The engine sees no rooms in the options, so Blok refuses this itself.
#[tokio::test(flavor = "multi_thread")]
async fn a_creator_with_the_hosts_own_rooms_is_refused() {
    let dir = temp_dir("rooms");
    let pool = blok_jsruntime::Pool::new(blok_jsruntime::Options {
        pool_size: Some(1),
        ..blok_jsruntime::Options::default()
    })
    .unwrap();
    let hooks = Hooks {
        rooms: Some(Arc::new(blok_blokagent::Executor::new_on_runtime(
            pool, None,
        ))),
        ..creator()
    };
    assert_eq!(
        start_refusal(options(&dir), hooks).await,
        "--create-page works in stored mode only: it cannot be used with live rooms (hooks.rooms)"
    );
    let _ = std::fs::remove_dir_all(&dir);
}
