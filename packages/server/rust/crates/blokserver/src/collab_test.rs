use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use blok_auth::{Authorization, BoxFuture, Error, User};
use blok_http::{Request, ResponseWriter};

use crate::testutil::{send, start, temp_dir};
use crate::{Level, Logger, Options, PurgeOutcome, Server};

/// Keeps every record with its category.
#[derive(Default)]
pub(crate) struct Recording(pub Mutex<Vec<String>>);

impl Logger for Recording {
    fn log(&self, level: Level, category: &str, message: &str) {
        let level = match level {
            Level::Info => "INFO",
            Level::Warn => "WARN",
            Level::Error => "ERROR",
        };
        self.0
            .lock()
            .unwrap()
            .push(format!("{level} {category} {message}"));
    }
}

pub(crate) fn collab_options() -> Options {
    Options {
        collab_enabled: true,
        collab_directory: temp_dir().display().to_string(),
        doc_endpoint: "http://127.0.0.1:1/docs".into(),
        ..Options::default()
    }
}

struct AllowAll;

impl Authorization for AllowAll {
    fn can_read_document<'a>(
        &'a self,
        _: &'a User,
        _: &'a str,
    ) -> BoxFuture<'a, Result<bool, Error>> {
        Box::pin(async { Ok(true) })
    }
    fn can_write_document<'a>(
        &'a self,
        _: &'a User,
        _: &'a str,
    ) -> BoxFuture<'a, Result<bool, Error>> {
        Box::pin(async { Ok(true) })
    }
}

async fn allow() -> Result<bool, blok_collab_room::Error> {
    Ok(true)
}

async fn deny() -> Result<bool, blok_collab_room::Error> {
    Ok(false)
}

// L9: collab on, Auth none and no hook warns once per mapping, under its own
// category, so the standalone host (which prints only the room category)
// never shows it.
#[tokio::test]
async fn open_sync_routes_warn_under_the_host_category() {
    let records = Arc::new(Recording::default());
    let mut o = collab_options();
    o.logger = Some(records.clone());
    Server::new(o.clone()).unwrap().handler("/blok");
    {
        let seen = records.0.lock().unwrap();
        assert_eq!(seen.len(), 1, "records = {seen:?}, want one warning");
        assert!(
            seen[0].starts_with("WARN Blok.Server.AspNetCore collab: no authorization hook is set and Auth is \"none\", so GET /blok/sync/{doc}, POST /blok/sync/{doc}/reset"),
            "warning = {:?}",
            seen[0]
        );
    }

    records.0.lock().unwrap().clear();
    o.authorization = Some(Arc::new(AllowAll));
    Server::new(o.clone()).unwrap().handler("");
    o.authorization = None;
    o.auth = "ticket".into();
    o.secret = "s".repeat(32);
    o.allowed_origins = vec!["https://app.example.com".into()];
    Server::new(o).unwrap().handler("");
    let seen = records.0.lock().unwrap();
    assert!(
        seen.is_empty(),
        "a hook or ticket mode still warned: {seen:?}"
    );
}

// ICollabRoomManager.RecheckAccessAsync: only a loaded room is rechecked.
#[tokio::test]
async fn recheck_access_of_an_unloaded_document_expels_nobody() {
    let s = Server::new(collab_options()).unwrap();
    let expelled = s.recheck_access("doc").await;
    assert!(matches!(expelled, Ok(0)), "RecheckAccess = {expelled:?}");
}

// C# resolves ICollabWorkingSetStore and ICollabRoomManager; the room
// manager's two Rust entry points answer the same message.
#[tokio::test]
async fn collab_services_throw_when_collaboration_is_disabled() {
    let s = Server::new(Options::default()).unwrap();
    let err = s.recheck_access("doc").await.unwrap_err();
    assert_eq!(err.to_string(), "Collaboration is disabled.");
    let err = s.purge_document("doc", Some(allow())).await.unwrap_err();
    assert_eq!(err.to_string(), "Collaboration is disabled.");
}

// ICollabDocumentPurger: the id and the authorize callback are checked
// first, and a purged id is refused from then on.
#[tokio::test(flavor = "multi_thread")]
async fn purge_document_refuses_then_tombstones() {
    let s = Server::new(collab_options()).unwrap();
    let err = s.purge_document("a/b", Some(allow())).await.unwrap_err();
    assert_eq!(
        err.to_string(),
        "collab: document ids must be a single path segment."
    );
    let err = s.purge_document("doc", Some(deny())).await.unwrap_err();
    assert_eq!(
        err.to_string(),
        "collab: document purge was not authorized."
    );
    for _ in 0..2 {
        let outcome = s.purge_document("doc", Some(allow())).await;
        assert!(
            matches!(outcome, Ok(PurgeOutcome::Purged)),
            "purge = {outcome:?}"
        );
    }
    let none: Option<std::future::Ready<Result<bool, blok_collab_room::Error>>> = None;
    assert!(
        matches!(
            s.purge_document("x", none).await,
            Err(crate::CollabError::NoAuthorize)
        ),
        "a missing authorize callback was accepted"
    );
}

// Shutdown does not wait for hijacked sockets, so drain does: a member's
// 1001 close is only queued when the rooms are closed, and the process
// must not exit before its pump writes it (Kestrel waits for upgraded
// connections up to the shutdown timeout).
#[tokio::test(flavor = "multi_thread")]
async fn drain_waits_for_open_sync_connections_up_to_its_context() {
    let s = Server::new(collab_options()).unwrap();
    let slot = s.inner.connections.try_enter().unwrap();
    let draining = s.clone();
    let mut done = tokio::spawn(async move { draining.drain(Duration::from_secs(30)).await });
    tokio::select! {
        result = &mut done => panic!("drain returned with a connection still open: {result:?}"),
        () = tokio::time::sleep(Duration::from_millis(100)) => {}
    }
    slot.release();
    let result = tokio::time::timeout(Duration::from_secs(2), done)
        .await
        .expect("drain did not return once the connection ended")
        .unwrap();
    assert!(result.is_ok(), "{result:?}");

    // Past its grace the wait gives up quietly, as Kestrel aborts what is
    // left at the shutdown timeout without a warning of its own.
    let _held = s.inner.connections.try_enter().unwrap();
    let started = Instant::now();
    let result = s.drain(Duration::from_millis(50)).await;
    assert!(
        result.is_ok() && started.elapsed() < Duration::from_secs(1),
        "a drain cut off by its grace: {result:?} after {:?}",
        started.elapsed()
    );
}

// S3, S4, E7, Y11: a purged id answers 403 forbidden on every collab door
// for the life of the process (CollabRoomManager.cs:201, purge lanes are
// never removed).
#[tokio::test(flavor = "multi_thread")]
async fn a_purged_document_answers_forbidden_on_every_door() {
    let s = Server::new(Options {
        collab_journal: true,
        ..collab_options()
    })
    .unwrap();
    s.purge_document("doc", Some(allow())).await.unwrap();
    let running = start(s.handler("")).await;
    let body = br#"{"ops":[{"op":"remove","id":"a"}]}"#;
    for (method, path) in [
        ("GET", "/sync/doc/state"),
        ("POST", "/sync/doc/reset"),
        ("POST", "/sync/doc/edit"),
        ("GET", "/sync/doc/history"),
        (
            "GET",
            "/sync/doc/history/0123456789abcdef0123456789abcdef/0",
        ),
        (
            "GET",
            "/sync/doc/history/0123456789abcdef0123456789abcdef/0/changes",
        ),
        (
            "DELETE",
            "/sync/doc/history/0123456789abcdef0123456789abcdef",
        ),
        (
            "POST",
            "/sync/doc/history/0123456789abcdef0123456789abcdef/0/restore",
        ),
    ] {
        let got = send(
            running.address,
            &format!(
                "{method} {path} HTTP/1.1\r\nBlok-Idempotency-Key: k1\r\nContent-Length: {}",
                body.len()
            ),
            body,
        )
        .await;
        assert!(
            got.status == 403 && got.text() == "forbidden\n",
            "{method} {path}: {} {:?}",
            got.status,
            got.text()
        );
    }
}

// L2: like AddBlokServer's AddBlokDocuments(warmUp: false), a collab host
// builds no engine pool until a conversion first needs one.
#[tokio::test(flavor = "multi_thread")]
async fn the_collab_runtime_is_built_only_on_the_first_html_read() {
    let endpoint = start(
        |request: Request, mut response: ResponseWriter| async move {
            response
                .headers_mut()
                .set("Content-Type", "application/json");
            let body: &[u8] = if request.path().ends_with("/rich") {
                br#"{"blocks":[{"id":"a","type":"paragraph","data":{"text":"<b>x</b>"}}]}"#
            } else {
                b"null"
            };
            let _ = response.write(body).await;
        },
    )
    .await;
    let s = Server::new(Options {
        doc_endpoint: format!("http://{}/docs", endpoint.address),
        ..collab_options()
    })
    .unwrap();
    let builds = Arc::new(Mutex::new(0));
    let counted = builds.clone();
    *s.inner.runtime.build.lock().unwrap() = Arc::new(move |_| {
        *counted.lock().unwrap() += 1;
        Err(blok_jsruntime::PoolError::Startup(
            blok_jsruntime::StartupError {
                cause: blok_jsruntime::StartupCause::Failed,
                message: "no engine in this test".into(),
                err: blok_jsruntime::Error::Engine("no engine in this test".into()),
            },
        ))
    });
    let running = start(s.handler("")).await;
    let address = running.address;
    let get = |path: &'static str| async move {
        send(address, &format!("GET {path} HTTP/1.1"), b"").await
    };

    get("/health").await;
    get("/sync/plain/state").await;
    assert_eq!(
        *builds.lock().unwrap(),
        0,
        "pools built before any HTML read"
    );
    get("/sync/rich/state").await;
    get("/sync/rich/state").await;
    assert_eq!(*builds.lock().unwrap(), 1, "pools built after HTML reads");
}

// HostCollabTests.cs

/// FixtureDocEndpoint: GET answers `get` (status, body); each PUT body is
/// kept with its path.
struct DocEndpoint {
    running: crate::testutil::Running,
    puts: Puts,
}

type Puts = Arc<Mutex<Vec<(String, Vec<u8>)>>>;

async fn doc_endpoint(get: Option<u16>, get_body: &'static str) -> DocEndpoint {
    let puts = Arc::new(Mutex::new(Vec::new()));
    let kept = puts.clone();
    let running = start(move |mut request: Request, mut response: ResponseWriter| {
        let kept = kept.clone();
        async move {
            if request.method() == "GET" {
                if let Some(status) = get {
                    response.set_status(status);
                    return;
                }
                response
                    .headers_mut()
                    .set("Content-Type", "application/json; charset=utf-8");
                let _ = response.write(get_body.as_bytes()).await;
                return;
            }
            let mut body = Vec::new();
            if let Some(reader) = request.body_mut() {
                let _ = reader.read_to_end(&mut body).await;
            }
            kept.lock().unwrap().push((request.path().to_owned(), body));
            response.set_status(204);
        }
    })
    .await;
    DocEndpoint { running, puts }
}

impl DocEndpoint {
    fn server(&self, configure: impl FnOnce(&mut Options)) -> Server {
        let mut o = Options {
            doc_endpoint: format!("http://{}/docs", self.running.address),
            ..collab_options()
        };
        configure(&mut o);
        Server::new(o).unwrap()
    }

    /// The last PUT for doc-1 whose texts pass `carries`, waiting up to 30 s.
    async fn put(&self, carries: impl Fn(&BTreeMap<String, String>) -> bool) -> Vec<u8> {
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let found = self
                .puts
                .lock()
                .unwrap()
                .iter()
                .rev()
                .find(|(path, body)| path.ends_with("/doc-1") && carries(&texts(body)))
                .map(|(_, body)| body.clone());
            if let Some(body) = found {
                return body;
            }
            assert!(Instant::now() < deadline, "no write-back PUT within 30 s");
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
}

/// Each block's data.text as compact JSON, by block id; `&` unescaped as
/// C#'s UnsafeRelaxedJsonEscaping writes it.
fn texts(output: &[u8]) -> BTreeMap<String, String> {
    let node = blok_jsjson::parse_node(output, Default::default()).unwrap();
    let blocks = node.lookup("blocks").unwrap().expect("no blocks array");
    blocks
        .items
        .iter()
        .map(|block| {
            let id = block.lookup("id").unwrap().unwrap().text().unwrap();
            let mut text = Vec::new();
            if let Some(t) = block
                .lookup("data")
                .unwrap()
                .and_then(|d| d.lookup("text").unwrap())
            {
                t.append_json(&mut text).unwrap();
            }
            (
                blok_jsjson::to_string_lossy(id.units()),
                String::from_utf8(text).unwrap().replace("\\u0026", "&"),
            )
        })
        .collect()
}

async fn post_ops(address: std::net::SocketAddr, key: &str, ops: &str) -> crate::testutil::Answer {
    let body = format!(r#"{{ "ops": {ops} }}"#);
    send(
        address,
        &format!(
            "POST /sync/doc-1/edit HTTP/1.1\r\nContent-Type: application/json; charset=utf-8\r\nBlok-Idempotency-Key: {key}\r\nContent-Length: {}",
            body.len()
        ),
        body.as_bytes(),
    )
    .await
}

fn insert(id: &str) -> String {
    format!(
        r#"[ {{ "op": "insert", "id": "{id}", "block": {{ "type": "paragraph", "data": {{ "text": "{id}" }} }} }} ]"#
    )
}

/// The close code of the first close frame after a 101.
async fn upgrade_close_code(address: std::net::SocketAddr) -> u16 {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut conn = tokio::net::TcpStream::connect(address).await.unwrap();
    conn.write_all(
        b"GET /sync/doc-1 HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
    )
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        let mut head = Vec::new();
        while !head.ends_with(b"\r\n\r\n") {
            head.push(conn.read_u8().await.unwrap());
        }
        assert!(
            head.starts_with(b"HTTP/1.1 101"),
            "{}",
            String::from_utf8_lossy(&head)
        );
        loop {
            let opcode = conn.read_u8().await.unwrap() & 0x0f;
            let mut length = u64::from(conn.read_u8().await.unwrap() & 0x7f);
            if length == 126 {
                length = u64::from(conn.read_u16().await.unwrap());
            } else if length == 127 {
                length = conn.read_u64().await.unwrap();
            }
            let mut payload = vec![0u8; usize::try_from(length).unwrap()];
            conn.read_exact(&mut payload).await.unwrap();
            if opcode == 0x8 {
                return u16::from_be_bytes([payload[0], payload[1]]);
            }
        }
    })
    .await
    .expect("no close frame")
}

// The host guide: a GET answering 404, 204 or an empty 200 fails a first
// open closed; only "null" opens an empty document.
#[tokio::test(flavor = "multi_thread")]
async fn a_seed_get_without_a_json_body_closes4503_and_state_answers503() {
    for status in [404, 204, 200] {
        let endpoint = doc_endpoint(Some(status), "").await;
        let running = start(endpoint.server(|_| {}).handler("")).await;
        assert_eq!(upgrade_close_code(running.address).await, 4503, "{status}");
        let state = send(running.address, "GET /sync/doc-1/state HTTP/1.1", b"").await;
        assert_eq!(state.status, 503, "{status}: {}", state.text());
    }
}

// The edit route takes rich text as HTML or as segments; /state and the
// write-back PUT both answer segments.
#[tokio::test(flavor = "multi_thread")]
async fn an_edit_in_html_or_segments_is_served_and_written_back_as_segments() {
    let endpoint = doc_endpoint(None, "null").await;
    let s = endpoint.server(|_| {});
    let running = start(s.handler("")).await;
    let html = post_ops(
        running.address,
        "html-edit",
        r#"[ { "op": "insert", "id": "html", "block": { "type": "paragraph", "data": { "text": "<b>bold</b> &amp; plain" } } } ]"#,
    )
    .await;
    let segments = post_ops(
        running.address,
        "segments-edit",
        r#"[ { "op": "insert", "id": "segments", "after": "html", "block": { "type": "paragraph", "data": { "text": [ { "text": "seg", "marks": { "italic": true } } ] } } } ]"#,
    )
    .await;
    let state = send(running.address, "GET /sync/doc-1/state HTTP/1.1", b"").await;
    assert_eq!(html.status, 204, "{}", html.text());
    assert_eq!(segments.status, 204, "{}", segments.text());
    assert_eq!(state.status, 200, "{}", state.text());
    let expected = BTreeMap::from([
        (
            "html".to_owned(),
            r#"[{"text":"bold","marks":{"bold":true}},{"text":" & plain"}]"#.to_owned(),
        ),
        (
            "segments".to_owned(),
            r#"[{"text":"seg","marks":{"italic":true}}]"#.to_owned(),
        ),
    ]);
    assert_eq!(texts(&state.body), expected);
    let put = endpoint.put(|t| t.len() == 2).await;
    assert_eq!(texts(&put), expected);
    let _ = s.drain(Duration::from_secs(30)).await;
}

// A document stored as HTML comes back as segments on the first write-back.
#[tokio::test(flavor = "multi_thread")]
async fn an_html_document_from_the_endpoint_is_written_back_as_segments() {
    let endpoint = doc_endpoint(
        None,
        r#"{ "time": 1, "blocks": [ { "id": "old", "type": "paragraph", "data": { "text": "a <i>b</i>" } } ] }"#,
    )
    .await;
    let s = endpoint.server(|_| {});
    let running = start(s.handler("")).await;
    let edit = post_ops(running.address, "after-html-seed", &insert("new")).await;
    let state = send(running.address, "GET /sync/doc-1/state HTTP/1.1", b"").await;
    assert_eq!(edit.status, 204, "{}", edit.text());
    let old = r#"[{"text":"a "},{"text":"b","marks":{"italic":true}}]"#;
    assert_eq!(texts(&state.body)["old"], old, "{}", state.text());
    let put = endpoint.put(|t| t.contains_key("new")).await;
    assert_eq!(texts(&put)["old"], old);
    let _ = s.drain(Duration::from_secs(30)).await;
}
