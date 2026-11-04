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
