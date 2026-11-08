//! Live pages made for a batch that then failed: reported as orphaned only
//! when the room, read again, does not name them.

use std::sync::Arc;

use blok_http::{Config, Request, ResponseWriter, Server as HttpServer};
use serde_json::{Value, json};
use tokio::net::TcpListener;

use crate::bundle::Bundle;
use crate::server::{Approval, Caller, Mcp, Outcome};

const SECRET: &str = "a-test-secret-that-is-long-enough-0123456789";
const ORIGIN: &str = "https://app.example.com";

async fn serve(handler: impl blok_http::Handler) -> std::net::SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = HttpServer::new(handler, Config::default());
    tokio::spawn(async move {
        let _ = server.serve(listener).await;
    });
    address
}

/// A collab host whose doc endpoint answers every document empty.
async fn host(name: &str) -> std::net::SocketAddr {
    let docs = serve(
        |request: Request, mut response: ResponseWriter| async move {
            if request.method() == "GET" {
                response
                    .headers_mut()
                    .set("Content-Type", "application/json; charset=utf-8");
                let _ = response.write(br#"{"blocks":[]}"#).await;
                return;
            }
            response.set_status(204);
        },
    )
    .await;
    let dir = std::env::temp_dir().join(format!(
        "blok-mcp-live-orphans-{name}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    let server = blok_blokserver::Server::new(blok_blokserver::Options {
        auth: "ticket".into(),
        secret: SECRET.into(),
        allowed_origins: vec![ORIGIN.into()],
        storage_directory: dir.join("files").display().to_string(),
        public_url: "/files".into(),
        collab_enabled: true,
        collab_journal: true,
        collab_directory: dir.join("collab").display().to_string(),
        doc_endpoint: format!("http://{docs}/docs"),
        rate_limit_per_minute: 0,
        ..blok_blokserver::Options::default()
    })
    .unwrap();
    serve(server.handler("")).await
}

async fn call(mcp: &Mcp, name: &str, args: Value) -> Result<Value, String> {
    let caller = Caller {
        principal: "alice".to_owned(),
        client_name: Some("Desk".to_owned()),
        scopes: None,
    };
    match mcp
        .call(name, &args, &caller, &Approval::default(), &|| false)
        .await?
    {
        Outcome::Answer(answer) => Ok(serde_json::from_str(&answer.structured).unwrap()),
        other => panic!("{name}: {other:?}"),
    }
}

/// Opens "doc" live with page-map on, then runs a page insert and a
/// paragraph insert with `break_it` set on the bundle.
async fn page_batch(name: &str, break_it: impl FnOnce(&Bundle)) -> Result<Value, String> {
    let address = host(name).await;
    let bundle = Arc::new(Bundle::new(1).unwrap());
    let options = json!({
        "transport": { "kind": "stdio" },
        "auth": { "kind": "none" },
        "sync": { "url": format!("ws://{address}/sync"), "origin": ORIGIN },
        "tickets": { "kind": "secret", "secret": SECRET },
        "pageTitles": "page-map",
    });
    let mcp = Mcp::new(bundle.clone(), &options, None, None)
        .await
        .unwrap();
    let opened = call(
        &mcp,
        "blok_open",
        json!({ "documentId": "doc", "mode": "live", "write": true }),
    )
    .await
    .unwrap();
    let handle = opened["handle"]
        .as_str()
        .unwrap_or_else(|| panic!("{opened}"))
        .to_owned();
    break_it(&bundle);
    call(
        &mcp,
        "blok_execute",
        json!({ "handle": handle, "commands": [
            { "name": "block.insert", "args": { "type": "page", "id": "pg1", "data": {} } },
            { "name": "block.insert", "args": { "type": "paragraph", "id": "p1", "data": { "text": "<b>hi</b>" } } },
        ] }),
    )
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn a_live_batch_that_fails_before_the_room_write_reports_its_pages() {
    let answer = page_batch("before", |bundle| {
        *bundle.fail.lock().unwrap() = Some(("agentExecute", "createdPages"));
    })
    .await
    .expect("the made page is reported, not a JSON-RPC error");
    let error = &answer["error"];
    assert_eq!(error["code"], "ORPHANED_SIDE_EFFECT", "{answer}");
    assert_eq!(error["retryable"], false, "{answer}");
    let orphaned = error["details"]["orphaned"].as_array().unwrap();
    assert_eq!(orphaned.len(), 1, "{answer}");
    assert_eq!(orphaned[0]["command"], "block.insert", "{answer}");
    assert_eq!(orphaned[0]["type"], "page", "{answer}");
    assert!(orphaned[0]["prepared"]["pageId"].is_string(), "{answer}");
    crate::server::tests::assert_server_stop(&error["details"]["cause"]);
}

// The room may hold the page insert, so its page is in use: no orphan.
#[tokio::test(flavor = "multi_thread")]
async fn a_live_batch_that_fails_while_the_room_is_written_reports_no_orphan() {
    let answer = page_batch("after", |bundle| {
        bundle
            .fail_after_room_write
            .store(true, std::sync::atomic::Ordering::SeqCst);
    })
    .await;
    let message = answer.expect_err("the failure stays a JSON-RPC error");
    assert!(message.contains("after the room write"), "{message}");
}

// A room that cannot be read may name the page: nothing is reported.
#[tokio::test(flavor = "multi_thread")]
async fn a_live_batch_whose_room_cannot_be_read_reports_no_orphan() {
    let answer = page_batch("unread", |bundle| {
        *bundle.fail.lock().unwrap() = Some(("agentExecute", "createdPages"));
        bundle
            .fail_room_read
            .store(true, std::sync::atomic::Ordering::SeqCst);
    })
    .await;
    let message = answer.expect_err("the failure stays a JSON-RPC error");
    assert!(
        message.contains("agentExecute: failed for a test"),
        "{message}"
    );
}
