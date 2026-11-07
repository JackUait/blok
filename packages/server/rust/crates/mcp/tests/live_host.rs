//! Live handles against a real Blok host (blok-blokserver) behind a proxy
//! that can drop every connection: what the room refused must never reach it
//! later, and a refusal blocks writes only until the next sync, as in Node.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_http::{Config, Request, ResponseWriter, Server as HttpServer};
use blok_mcp::bundle::Bundle;
use blok_mcp::server::{Approval, Caller, Mcp, Outcome};
use serde_json::{Value, json};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

const SECRET: &str = "a-test-secret-that-is-long-enough-0123456789";
const ORIGIN: &str = "https://app.example.com";

async fn serve(handler: impl blok_http::Handler) -> (std::net::SocketAddr, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = HttpServer::new(handler, Config::default());
    let task = tokio::spawn(async move {
        let _ = server.serve(listener).await;
    });
    (address, task)
}

/// Forwards to `upstream`; `drop_all` cuts every open connection.
struct Proxy {
    address: std::net::SocketAddr,
    links: Arc<Mutex<Vec<JoinHandle<()>>>>,
}

impl Proxy {
    async fn start(upstream: std::net::SocketAddr) -> Proxy {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let links: Arc<Mutex<Vec<JoinHandle<()>>>> = Arc::default();
        let held = links.clone();
        tokio::spawn(async move {
            while let Ok((mut client, _)) = listener.accept().await {
                let link = tokio::spawn(async move {
                    if let Ok(mut server) = TcpStream::connect(upstream).await {
                        let _ = tokio::io::copy_bidirectional(&mut client, &mut server).await;
                    }
                });
                held.lock().unwrap().push(link);
            }
        });
        Proxy { address, links }
    }

    fn drop_all(&self) {
        for link in self.links.lock().unwrap().drain(..) {
            link.abort();
        }
    }
}

struct Host {
    proxy: Proxy,
    _tasks: Vec<JoinHandle<()>>,
}

/// A host with collab on; `journal` makes its rooms speak v2.
async fn host(journal: bool) -> Host {
    let (docs, docs_task) = serve(
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
        "blok-mcp-live-host-{}-{}",
        std::process::id(),
        rand_suffix()
    ));
    // A folder left by an earlier run with the same process id.
    let _ = std::fs::remove_dir_all(&dir);
    let server = blok_blokserver::Server::new(blok_blokserver::Options {
        auth: "ticket".into(),
        secret: SECRET.into(),
        allowed_origins: vec![ORIGIN.into()],
        storage_directory: dir.join("files").display().to_string(),
        public_url: "/files".into(),
        collab_enabled: true,
        collab_journal: journal,
        collab_directory: dir.join("collab").display().to_string(),
        doc_endpoint: format!("http://{docs}/docs"),
        rate_limit_per_minute: 0,
        ..blok_blokserver::Options::default()
    })
    .unwrap();
    let (address, host_task) = serve(server.handler("")).await;
    Host {
        proxy: Proxy::start(address).await,
        _tasks: vec![docs_task, host_task],
    }
}

/// Each host its own folders: tests run at once.
fn rand_suffix() -> usize {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
}

async fn mcp(host: &Host) -> Mcp {
    let options = json!({
        "transport": { "kind": "stdio" },
        "auth": { "kind": "none" },
        "sync": { "url": format!("ws://{}/sync", host.proxy.address), "origin": ORIGIN },
        "tickets": { "kind": "secret", "secret": SECRET },
    });
    Mcp::new(Arc::new(Bundle::new(1).unwrap()), &options, None, None)
        .await
        .unwrap()
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
        Ok(other) => panic!("{name}: {other:?}"),
        Err(err) => panic!("{name}: {err}"),
    }
}

async fn open(mcp: &Mcp) -> String {
    let opened = call(
        mcp,
        "blok_open",
        json!({ "documentId": "doc", "mode": "live", "write": true }),
    )
    .await;
    opened["handle"]
        .as_str()
        .unwrap_or_else(|| panic!("{opened}"))
        .to_owned()
}

async fn insert(mcp: &Mcp, handle: &str, id: &str, text: &str) -> Value {
    call(
        mcp,
        "blok_execute",
        json!({ "handle": handle, "commands": [{ "name": "block.insert", "args": {
            "type": "paragraph", "id": id, "data": { "text": text },
        } }] }),
    )
    .await
}

/// The block ids the room holds, read by a fresh session.
async fn room_ids(host: &Host) -> Vec<String> {
    let reader = mcp(host).await;
    let handle = open(&reader).await;
    let read = call(&reader, "blok_read", json!({ "handle": handle })).await;
    call(&reader, "blok_close", json!({ "handle": handle })).await;
    read["blocks"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|b| b["id"].as_str().map(str::to_owned))
        .collect()
}

// Over the host's 1 MiB message cap.
fn big() -> String {
    "x".repeat(1_100_000)
}

// Node's store drops the session at a quarantine: the next append fails,
// and the handle stops writing (real-host run: APPLY_FAILED, stage journal).
#[tokio::test(flavor = "multi_thread")]
async fn after_an_oversized_write_the_next_write_is_not_saved() {
    let host = host(true).await;
    let mcp = mcp(&host).await;
    let handle = open(&mcp).await;
    let refused = insert(&mcp, &handle, "big", &big()).await;
    assert_eq!(refused["error"]["code"], "REJECTED", "{refused}");
    let next = insert(&mcp, &handle, "p2", "small").await;
    assert_eq!(next["error"]["code"], "APPLY_FAILED", "{next}");
    assert_eq!(next["error"]["details"]["stage"], "journal", "{next}");
    assert!(room_ids(&host).await.is_empty());
}

// A refusal blocks writes until the next sync, which rebuilds the copy from
// the room: the refused block is never sent, and later writes are saved.
#[tokio::test(flavor = "multi_thread")]
async fn a_refused_write_never_reaches_the_room_after_a_reconnect() {
    let host = host(true).await;
    let mcp = mcp(&host).await;
    let handle = open(&mcp).await;
    let refused = insert(&mcp, &handle, "big", &big()).await;
    assert_eq!(refused["error"]["code"], "REJECTED", "{refused}");
    host.proxy.drop_all();
    // The reconnect waits about a second; then the room is read again.
    tokio::time::sleep(Duration::from_secs(3)).await;
    let saved = insert(&mcp, &handle, "p2", "small").await;
    assert_eq!(saved["ok"], true, "{saved}");
    assert_eq!(saved["delivery"]["durable"], true, "{saved}");
    assert_eq!(room_ids(&host).await, vec!["p2".to_owned()]);
    let read = call(&mcp, "blok_read", json!({ "handle": handle })).await;
    let ids: Vec<&str> = read["blocks"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|b| b["id"].as_str())
        .collect();
    assert_eq!(ids, vec!["p2"], "{read}");
}

// v1 rooms announce their cap too: Node refuses the update itself and ends
// the room, instead of sending it into a close 1009 again and again.
#[tokio::test(flavor = "multi_thread")]
async fn a_v1_update_over_the_announced_cap_ends_the_room() {
    let host = host(false).await;
    let mcp = mcp(&host).await;
    let handle = open(&mcp).await;
    let first = insert(&mcp, &handle, "big", &big()).await;
    assert_eq!(first["ok"], true, "{first}");
    let next = insert(&mcp, &handle, "p2", "small").await;
    assert_eq!(next["error"]["code"], "SOURCE_UNAVAILABLE", "{next}");
    assert_eq!(
        next["error"]["details"]["terminal"], "oversized-update",
        "{next}"
    );
}

async fn history(mcp: &Mcp, handle: &str, name: &str) -> Value {
    call(
        mcp,
        "blok_execute",
        json!({ "handle": handle, "commands": [{ "name": name, "args": {} }] }),
    )
    .await
}

// After the copy is rebuilt from the room, history knows only steps on the
// live copy: nothing to undo or redo, and a later step undoes in the room.
#[tokio::test(flavor = "multi_thread")]
async fn after_the_rebuild_history_acts_on_the_live_copy() {
    let host = host(true).await;
    let mcp = mcp(&host).await;
    let handle = open(&mcp).await;
    let kept = insert(&mcp, &handle, "p1", "before").await;
    assert_eq!(kept["ok"], true, "{kept}");
    let refused = insert(&mcp, &handle, "big", &big()).await;
    assert_eq!(refused["error"]["code"], "REJECTED", "{refused}");
    host.proxy.drop_all();
    tokio::time::sleep(Duration::from_secs(3)).await;
    let undo = history(&mcp, &handle, "history.undo").await;
    assert_eq!(undo["error"]["code"], "NOTHING_TO_UNDO", "{undo}");
    let redo = history(&mcp, &handle, "history.redo").await;
    assert_eq!(redo["error"]["code"], "NOTHING_TO_REDO", "{redo}");
    let later = insert(&mcp, &handle, "p2", "later").await;
    assert_eq!(later["ok"], true, "{later}");
    let undone = history(&mcp, &handle, "history.undo").await;
    assert_eq!(undone["ok"], true, "{undone}");
    assert_eq!(room_ids(&host).await, vec!["p1".to_owned()]);
    let read = call(&mcp, "blok_read", json!({ "handle": handle })).await;
    let ids: Vec<&str> = read["blocks"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|b| b["id"].as_str())
        .collect();
    assert_eq!(ids, vec!["p1"], "{read}");
}

/// A ticket URL that mints `grants` tickets of 20 s (inside the refresh
/// margin, so each use mints again), then answers 403. Counts the POSTs.
async fn ticket_url(grants: usize) -> (String, Arc<std::sync::atomic::AtomicUsize>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let posts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let seen = posts.clone();
    tokio::spawn(async move {
        while let Ok((mut tcp, _)) = listener.accept().await {
            let n = seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let mut raw = Vec::new();
            let mut buf = [0u8; 4096];
            let body = loop {
                let got = tcp.read(&mut buf).await.unwrap_or(0);
                raw.extend_from_slice(&buf[..got]);
                let text = String::from_utf8_lossy(&raw).into_owned();
                if let Some((head, body)) = text.split_once("\r\n\r\n") {
                    let length = head
                        .lines()
                        .find_map(|l| {
                            let (k, v) = l.split_once(':')?;
                            k.eq_ignore_ascii_case("content-length")
                                .then(|| v.trim().parse::<usize>().ok())?
                        })
                        .unwrap_or(0);
                    if body.len() >= length || got == 0 {
                        break body.to_owned();
                    }
                }
                if got == 0 {
                    break String::new();
                }
            };
            let answer = if n < grants {
                let request: Value = serde_json::from_str(&body).unwrap_or_default();
                let claims = blok_blokserver_ticket::Claims {
                    user: Some(request["actorId"].as_str().unwrap_or_default().into()),
                    doc: Some(request["doc"].as_str().unwrap_or_default().into()),
                    write: true,
                    ttl_seconds: Some(20),
                };
                let ticket =
                    blok_blokserver_ticket::mint(SECRET, &claims, std::time::SystemTime::now())
                        .unwrap();
                let json = json!({ "ticket": ticket }).to_string();
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{json}",
                    json.len()
                )
            } else {
                "HTTP/1.1 403 Forbidden\r\nContent-Length: 2\r\nConnection: close\r\n\r\nno"
                    .to_owned()
            };
            let _ = tcp.write_all(answer.as_bytes()).await;
        }
    });
    (format!("http://{address}/tickets"), posts)
}

// Node's revocable(): a 403 from the ticket URL while history mints ends
// the room for the session. The history command names the host's refusal;
// the writes after it are FORBIDDEN, and no mint is tried again.
#[tokio::test(flavor = "multi_thread")]
async fn a_refused_mint_for_version_history_ends_the_room() {
    let host = host(true).await;
    let (tickets, posts) = ticket_url(2).await;
    let options = json!({
        "transport": { "kind": "stdio" },
        "auth": { "kind": "none" },
        "sync": { "url": format!("ws://{}/sync", host.proxy.address), "origin": ORIGIN },
        "tickets": { "kind": "url", "url": tickets, "hostToken": "t" },
    });
    let mcp = Mcp::new(Arc::new(Bundle::new(1).unwrap()), &options, None, None)
        .await
        .unwrap();
    let handle = open(&mcp).await;
    let versions = history(&mcp, &handle, "history.versions").await;
    assert_eq!(
        versions["error"],
        json!({
            "code": "TOOL_ACTION_FAILED",
            "message": "The version history failed: The host did not grant this document to this agent.",
            "retryable": false,
            "commandIndex": 0,
            "path": "/commands/0/args",
        }),
        "{versions}"
    );
    for id in ["p1", "p2"] {
        let write = insert(&mcp, &handle, id, "x").await;
        assert_eq!(
            write["error"],
            json!({
                "code": "FORBIDDEN",
                "message": "The room refused this agent. Its ticket may not grant this document.",
                "retryable": false,
            }),
            "{write}"
        );
    }
    assert_eq!(posts.load(std::sync::atomic::Ordering::SeqCst), 3);
}

// The same refusal on the restore's own POST: a ticket error is a plain
// error to Node's restore, so it is not retryable, and the room ends.
#[tokio::test(flavor = "multi_thread")]
async fn a_refused_mint_for_a_restore_ends_the_room() {
    let host = host(true).await;
    // open, connect, versions, then the restore's list and read; its POST is refused.
    let (tickets, posts) = ticket_url(5).await;
    let options = json!({
        "transport": { "kind": "stdio" },
        "auth": { "kind": "none" },
        "sync": { "url": format!("ws://{}/sync", host.proxy.address), "origin": ORIGIN },
        "tickets": { "kind": "url", "url": tickets, "hostToken": "t" },
    });
    let mcp = Mcp::new(Arc::new(Bundle::new(1).unwrap()), &options, None, None)
        .await
        .unwrap();
    let handle = open(&mcp).await;
    let kept = insert(&mcp, &handle, "p1", "x").await;
    assert_eq!(kept["ok"], true, "{kept}");
    let versions = history(&mcp, &handle, "history.versions").await;
    let version = versions["results"][0]["versions"]
        .as_array()
        .and_then(|v| v.last())
        .and_then(|v| v["version"].as_str())
        .unwrap_or_else(|| panic!("{versions}"))
        .to_owned();
    let restore = call(
        &mcp,
        "blok_execute",
        json!({ "handle": handle, "commands": [{ "name": "history.restore", "args": { "version": version } }] }),
    )
    .await;
    assert_eq!(
        restore["error"],
        json!({
            "code": "TOOL_ACTION_FAILED",
            "message": "The version history failed: The host did not grant this document to this agent.",
            "retryable": false,
            "commandIndex": 0,
            "path": "/commands/0/args",
        }),
        "{restore}"
    );
    let write = insert(&mcp, &handle, "p2", "y").await;
    assert_eq!(write["error"]["code"], "FORBIDDEN", "{write}");
    assert_eq!(posts.load(std::sync::atomic::Ordering::SeqCst), 6);
}
