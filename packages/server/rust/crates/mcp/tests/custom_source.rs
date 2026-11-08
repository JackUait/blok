//! A host's own document store (`Hooks::source`), as Node's
//! `source: { kind: 'custom', source }` (src/mcp/sources/custom.ts).

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use blok_mcp::bundle::Bundle;
use blok_mcp::document_source::{
    DocumentCaller, DocumentSource, ListedDocument, SourceError, SourceList, SourceListing,
    StoredDocument,
};
use blok_mcp::options::{Hooks, McpOptions, Source, Tickets, Transport};
use blok_mcp::server::{Approval, Caller, Mcp, Outcome};
use blok_mcp::uploads::BoxFuture;
use serde_json::{Value, json};

#[derive(Debug, Clone)]
struct Seen {
    op: &'static str,
    caller: DocumentCaller,
    id: String,
    if_version: Option<String>,
    text: Option<String>,
}

type Answer<T> = Result<T, SourceError>;

/// A store in memory, with answers a case can queue ahead.
#[derive(Default)]
struct Store {
    docs: Mutex<HashMap<String, (String, String)>>,
    loads: Mutex<VecDeque<Answer<Option<StoredDocument>>>>,
    saves: Mutex<VecDeque<Answer<Option<String>>>>,
    seen: Mutex<Vec<Seen>>,
    lists: bool,
}

impl Store {
    fn with(docs: &[(&str, &str, &str)]) -> Arc<Store> {
        let store = Store::default();
        for (id, text, version) in docs {
            store.docs.lock().unwrap().insert(
                (*id).to_owned(),
                ((*text).to_owned(), (*version).to_owned()),
            );
        }
        Arc::new(store)
    }

    fn seen(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }
}

impl DocumentSource for Store {
    fn load(
        &self,
        caller: DocumentCaller,
        id: String,
    ) -> BoxFuture<'_, Answer<Option<StoredDocument>>> {
        self.seen.lock().unwrap().push(Seen {
            op: "load",
            caller,
            id: id.clone(),
            if_version: None,
            text: None,
        });
        let queued = self.loads.lock().unwrap().pop_front();
        let answer = queued.unwrap_or_else(|| {
            Ok(self
                .docs
                .lock()
                .unwrap()
                .get(&id)
                .map(|(text, version)| StoredDocument {
                    document_text: text.clone(),
                    version: Some(version.clone()),
                }))
        });
        Box::pin(async move { answer })
    }

    fn save(
        &self,
        caller: DocumentCaller,
        id: String,
        document_text: String,
        if_version: Option<String>,
    ) -> BoxFuture<'_, Answer<Option<String>>> {
        self.seen.lock().unwrap().push(Seen {
            op: "save",
            caller,
            id: id.clone(),
            if_version: if_version.clone(),
            text: Some(document_text.clone()),
        });
        let queued = self.saves.lock().unwrap().pop_front();
        let answer = queued.unwrap_or_else(|| {
            let mut docs = self.docs.lock().unwrap();
            let next = format!("v{}", docs.len() + self.seen.lock().unwrap().len());
            docs.insert(id, (document_text, next.clone()));
            Ok(Some(next))
        });
        Box::pin(async move { answer })
    }

    fn lists(&self) -> bool {
        self.lists
    }

    fn list(
        &self,
        caller: DocumentCaller,
        list: SourceList,
    ) -> BoxFuture<'_, Answer<SourceListing>> {
        self.seen.lock().unwrap().push(Seen {
            op: "list",
            caller,
            id: list.query.clone().unwrap_or_default(),
            if_version: None,
            text: None,
        });
        Box::pin(async {
            Ok(SourceListing {
                documents: vec![
                    ListedDocument {
                        id: "doc".to_owned(),
                        title: Some("Notes".to_owned()),
                    },
                    ListedDocument {
                        id: "secret".to_owned(),
                        title: None,
                    },
                ],
                next_cursor: Some("page-2".to_owned()),
            })
        })
    }
}

fn bundle() -> Arc<Bundle> {
    Arc::new(Bundle::new(1).unwrap())
}

async fn mcp_over(store: Arc<Store>) -> Mcp {
    let hooks = Hooks {
        source: Some(store),
        authorize: Some(Arc::new(
            |_principal: String, document_id: String, _write: bool| async move {
                document_id != "secret"
            },
        )),
        ..Hooks::default()
    };
    Mcp::with_hooks(bundle(), &McpOptions::default().to_value(), hooks)
        .await
        .unwrap()
}

fn alice(client: &str) -> Caller {
    Caller {
        principal: "alice".to_owned(),
        client_name: Some(client.to_owned()),
        scopes: None,
    }
}

async fn call_as(mcp: &Mcp, caller: &Caller, tool: &str, args: Value) -> Value {
    match mcp
        .call(tool, &args, caller, &Approval::default(), &|| false)
        .await
    {
        Ok(Outcome::Answer(answer)) => serde_json::from_str(&answer.structured).unwrap(),
        other => panic!("{tool}: {other:?}"),
    }
}

async fn call(mcp: &Mcp, tool: &str, args: Value) -> Value {
    call_as(mcp, &alice("Desk"), tool, args).await
}

async fn open(mcp: &Mcp, id: &str) -> String {
    let opened = call(mcp, "blok_open", json!({ "documentId": id, "write": true })).await;
    opened["handle"]
        .as_str()
        .unwrap_or_else(|| panic!("{opened}"))
        .to_owned()
}

fn set_title(handle: &str, title: &str) -> Value {
    json!({ "handle": handle, "commands": [{ "name": "doc.setTitle", "args": { "title": title } }] })
}

fn error_of(answer: &Value) -> (String, String) {
    (
        answer["error"]["code"]
            .as_str()
            .unwrap_or_default()
            .to_owned(),
        answer["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .to_owned(),
    )
}

const PARAGRAPH: &str = r#"{"blocks":[{"id":"p1","type":"paragraph","data":{"text":"Stored"}}]}"#;

#[tokio::test(flavor = "multi_thread")]
async fn a_missing_document_opens_empty_and_its_first_save_names_no_version() {
    let store = Store::with(&[]);
    let mcp = mcp_over(store.clone()).await;
    let opened = call(
        &mcp,
        "blok_open",
        json!({ "documentId": "new", "write": true }),
    )
    .await;
    assert_eq!(opened["exists"], false, "{opened}");
    let handle = opened["handle"].as_str().unwrap().to_owned();

    store
        .saves
        .lock()
        .unwrap()
        .push_back(Ok(Some("v1".to_owned())));
    store
        .saves
        .lock()
        .unwrap()
        .push_back(Ok(Some("v2".to_owned())));
    let first = call(&mcp, "blok_execute", set_title(&handle, "First")).await;
    assert_eq!(first["delivery"]["savedVersion"], "v1", "{first}");
    let second = call(&mcp, "blok_execute", set_title(&handle, "Second")).await;
    assert_eq!(second["delivery"]["savedVersion"], "v2", "{second}");

    let saves: Vec<Seen> = store
        .seen()
        .into_iter()
        .filter(|s| s.op == "save")
        .collect();
    assert_eq!(saves[0].if_version, None);
    assert_eq!(
        saves[0].text.as_deref(),
        Some(r#"{"title":"First","blocks":[]}"#)
    );
    assert_eq!(saves[1].if_version.as_deref(), Some("v1"));
    let caller = &saves[0].caller;
    assert_eq!(caller.principal, "alice");
    assert_eq!(caller.client_name, "Desk");
    assert_eq!(caller.scopes, None);
    assert_eq!(caller.actor.id, "agent:alice:Desk");
    assert_eq!(caller.actor.on_behalf_of.as_deref(), Some("alice"));
}

// Node binds the source to the caller that opened the handle (opener.ts sourceFor).
#[tokio::test(flavor = "multi_thread")]
async fn a_save_runs_for_the_opener_even_when_another_client_of_the_principal_calls() {
    let store = Store::with(&[("doc", PARAGRAPH, "v1")]);
    let mcp = mcp_over(store.clone()).await;
    let handle = open(&mcp, "doc").await;
    let saved = call_as(
        &mcp,
        &alice("Other"),
        "blok_execute",
        set_title(&handle, "T"),
    )
    .await;
    assert_eq!(saved["ok"], true, "{saved}");
    let save = store.seen().into_iter().find(|s| s.op == "save").unwrap();
    assert_eq!(save.caller.client_name, "Desk");
    assert_eq!(save.if_version.as_deref(), Some("v1"));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_changed_save_is_document_changed_and_the_handle_reloads() {
    let store = Store::with(&[("doc", PARAGRAPH, "v1")]);
    let mcp = mcp_over(store.clone()).await;
    let handle = open(&mcp, "doc").await;
    store
        .saves
        .lock()
        .unwrap()
        .push_back(Err(SourceError::changed("")));
    let refused = call(&mcp, "blok_execute", set_title(&handle, "Lost")).await;
    assert_eq!(
        error_of(&refused),
        (
            "DOCUMENT_CHANGED".to_owned(),
            "Someone saved this document since you opened it. Read it again, then retry."
                .to_owned()
        ),
        "{refused}"
    );
    assert_eq!(refused["error"]["retryable"], true);
    let read = call(&mcp, "blok_read", json!({ "handle": handle })).await;
    assert!(read.get("page").is_none(), "{read}");
    assert_eq!(store.seen().iter().filter(|s| s.op == "load").count(), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_host_failure_is_generic_for_the_agent_and_memory_reloads() {
    let store = Store::with(&[("doc", PARAGRAPH, "v1")]);
    let mcp = mcp_over(store.clone()).await;
    let handle = open(&mcp, "doc").await;
    store
        .saves
        .lock()
        .unwrap()
        .push_back(Err(SourceError::failed("db password=hunter2")));
    let refused = call(&mcp, "blok_execute", set_title(&handle, "Lost")).await;
    assert_eq!(
        error_of(&refused),
        (
            "SOURCE_UNAVAILABLE".to_owned(),
            "The host could not save this document, so nothing was saved. Try again.".to_owned()
        ),
        "{refused}"
    );
    let undo = call(
        &mcp,
        "blok_execute",
        json!({ "handle": handle, "commands": [{ "name": "history.undo", "args": {} }] }),
    )
    .await;
    assert_eq!(undo["error"]["code"], "NOTHING_TO_UNDO", "{undo}");
}

#[tokio::test(flavor = "multi_thread")]
async fn refusals_take_the_store_words_or_blok_words() {
    let store = Store::with(&[("doc", PARAGRAPH, "v1")]);
    let mcp = mcp_over(store.clone()).await;
    let cases = [
        (
            SourceError::unavailable(""),
            "SOURCE_UNAVAILABLE",
            "The host could not load this document. Try again.",
        ),
        (
            SourceError::invalid_id("Ids here are numbers."),
            "INVALID_ARGS",
            "Ids here are numbers.",
        ),
        (
            SourceError::forbidden("  "),
            "FORBIDDEN",
            "The host does not allow this.",
        ),
        (
            SourceError::invalid_id(""),
            "INVALID_ARGS",
            "The host does not accept this document id.",
        ),
    ];
    for (error, code, message) in cases {
        store.loads.lock().unwrap().push_back(Err(error));
        let refused = call(&mcp, "blok_open", json!({ "documentId": "doc" })).await;
        assert_eq!(error_of(&refused), (code.to_owned(), message.to_owned()));
    }
    let handle = open(&mcp, "doc").await;
    store
        .saves
        .lock()
        .unwrap()
        .push_back(Err(SourceError::unavailable("")));
    let refused = call(&mcp, "blok_execute", set_title(&handle, "x")).await;
    assert_eq!(
        error_of(&refused).1,
        "The host could not save this document, so nothing was saved. Try again."
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn every_load_is_checked_as_the_endpoint_source_checks_it() {
    let deep = format!(
        r#"{{"blocks":[],"x":{}{}}}"#,
        "[".repeat(48),
        "]".repeat(48)
    );
    let fits = format!(
        r#"{{"blocks":[],"x":{}{}}}"#,
        "[".repeat(47),
        "]".repeat(47)
    );
    let store = Store::with(&[
        ("shapeless", r#"{"title":"x"}"#, "v1"),
        ("broken", "{nope", "v1"),
        ("deep", &deep, "v1"),
        ("fits", &fits, "v1"),
        (
            "lone",
            r#"{"blocks":[{"id":"p1","type":"paragraph","data":{"text":"a\ud800b"}}]}"#,
            "v1",
        ),
        ("twice", r#"{"title":"a","blocks":[],"title":"b"}"#, "v1"),
        ("unversioned", PARAGRAPH, ""),
    ]);
    let mcp = mcp_over(store.clone()).await;
    let refused = |id: &'static str| {
        let mcp = &mcp;
        async move { error_of(&call(mcp, "blok_open", json!({ "documentId": id })).await) }
    };
    assert_eq!(
        refused("shapeless").await.1,
        "The host's document \"shapeless\" is not a Blok document: expected an object with a \"blocks\" array."
    );
    assert_eq!(
        refused("broken").await.1,
        "The host's document \"broken\" is not JSON."
    );
    assert_eq!(
        refused("deep").await.1,
        "The host's document \"deep\" nests deeper than 48 levels of objects and arrays."
    );
    assert_eq!(
        refused("unversioned").await,
        (
            "SOURCE_UNAVAILABLE".to_owned(),
            "The host could not load this document. Try again.".to_owned()
        )
    );
    let fits = open(&mcp, "fits").await;
    assert!(!fits.is_empty());
    let lone = open(&mcp, "lone").await;
    let read = call(&mcp, "blok_read", json!({ "handle": lone })).await;
    assert_eq!(read["blocks"][0]["text"], "a\u{fffd}b", "{read}");
    let twice = open(&mcp, "twice").await;
    let read = call(&mcp, "blok_read", json!({ "handle": twice })).await;
    assert_eq!(read["page"]["title"], "b", "{read}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_save_without_a_version_says_the_host_may_have_saved() {
    let store = Store::with(&[("doc", PARAGRAPH, "v1")]);
    let mcp = mcp_over(store.clone()).await;
    let handle = open(&mcp, "doc").await;
    store.saves.lock().unwrap().push_back(Ok(None));
    let refused = call(&mcp, "blok_execute", set_title(&handle, "x")).await;
    assert_eq!(
        error_of(&refused),
        (
            "SOURCE_UNAVAILABLE".to_owned(),
            "The host may have saved this document but did not say which version. Read it before you retry."
                .to_owned()
        ),
        "{refused}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn dot_ids_never_reach_the_store() {
    let store = Store::with(&[]);
    let mcp = mcp_over(store.clone()).await;
    // The tool arguments already refuse "".
    for id in [".", ".."] {
        let refused = call(&mcp, "blok_open", json!({ "documentId": id })).await;
        assert_eq!(
            error_of(&refused),
            (
                "INVALID_ARGS".to_owned(),
                format!("\"{id}\" is not a document id.")
            ),
            "{refused}"
        );
    }
    assert!(store.seen().is_empty(), "{:?}", store.seen());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_listing_runs_for_the_current_caller_and_drops_what_authorize_refuses() {
    let unlisted = Store::with(&[]);
    let mcp = mcp_over(unlisted).await;
    let none = call(&mcp, "blok_list_documents", json!({})).await;
    assert_eq!(none["supported"], false, "{none}");

    let store = Arc::new(Store {
        lists: true,
        ..Store::default()
    });
    let mcp = mcp_over(store.clone()).await;
    let listed = call_as(
        &mcp,
        &alice("Other"),
        "blok_list_documents",
        json!({ "query": "notes" }),
    )
    .await;
    assert_eq!(
        listed,
        json!({ "documents": [{ "id": "doc", "title": "Notes", "live": false }], "nextCursor": "page-2", "supported": true })
    );
    let list = &store.seen()[0];
    assert_eq!((list.op, list.id.as_str()), ("list", "notes"));
    assert_eq!(list.caller.client_name, "Other");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_custom_source_cannot_be_combined_with_a_files_or_endpoint_source() {
    let options = McpOptions {
        source: Some(Source::Files {
            dir: std::env::temp_dir().to_string_lossy().into_owned(),
        }),
        ..McpOptions::default()
    };
    let hooks = Hooks {
        source: Some(Store::with(&[])),
        ..Hooks::default()
    };
    let refused = Mcp::with_hooks(bundle(), &options.to_value(), hooks).await;
    assert!(refused.is_err());
}

fn ticket_url_over_http() -> McpOptions {
    McpOptions {
        transport: Transport::Http {
            listen: "127.0.0.1:0".to_owned(),
            public: false,
        },
        tickets: Some(Tickets::Url {
            url: "http://127.0.0.1:9/tickets".to_owned(),
            host_token: "token".to_owned(),
        }),
        ..McpOptions::default()
    }
}

// A ticket URL with no source lets the ticket host decide per room; a
// custom source is a source, so it needs a per-document check.
#[tokio::test(flavor = "multi_thread")]
async fn a_ticket_url_with_a_custom_source_and_no_authorize_refuses_to_start() {
    let rooms_only = Mcp::with_hooks(
        bundle(),
        &ticket_url_over_http().to_value(),
        Hooks::default(),
    )
    .await;
    assert!(rooms_only.is_ok());
    let hooks = Hooks {
        source: Some(Store::with(&[])),
        ..Hooks::default()
    };
    let refused = Mcp::with_hooks(bundle(), &ticket_url_over_http().to_value(), hooks).await;
    match refused {
        Err(blok_mcp::errors::Fault::Internal(message)) => {
            assert!(message.contains("--authorize"), "{message}");
        }
        Err(other) => panic!("{other:?}"),
        Ok(_) => panic!("started with no per-document check"),
    }
}
