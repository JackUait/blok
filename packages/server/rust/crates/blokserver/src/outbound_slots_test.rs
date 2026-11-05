use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant, UNIX_EPOCH};

use blok_http::{Request, ResponseWriter};
use blok_outbound::ExactOriginPolicy;
use tokio::sync::Semaphore;
use tokio::task::JoinHandle;

use crate::testutil::{Answer, Running, fixture_ticket, send, start, temp_dir};
use crate::{Options, Server};

// With the rate limit on, one caller runs at most two outbound fetches at
// once in each pool; a third waits for one of its own slots. Callers are
// ticket users, since every test request comes from 127.0.0.1.

const EDITOR: &str = "https://app.example.com";

/// Serves /plain and /png at once, and /stall: the head, then a body held
/// until release.
struct StallOrigin {
    _running: Running,
    url: String,
    gate: Arc<Semaphore>,
    stalled: Arc<AtomicUsize>,
    pngs: Arc<AtomicUsize>,
}

impl StallOrigin {
    async fn start() -> StallOrigin {
        let gate = Arc::new(Semaphore::new(0));
        let stalled = Arc::new(AtomicUsize::new(0));
        let pngs = Arc::new(AtomicUsize::new(0));
        let (g, s, p) = (Arc::clone(&gate), Arc::clone(&stalled), Arc::clone(&pngs));
        let running = start(move |request: Request, mut response: ResponseWriter| {
            let (gate, stalled, pngs) = (Arc::clone(&g), Arc::clone(&s), Arc::clone(&p));
            let path = request.target().to_owned();
            async move {
                match path.as_str() {
                    "/plain" => {
                        response.headers_mut().set("Content-Type", "text/html");
                        let _ = response
                            .write(b"<html><head><title>t</title></head></html>")
                            .await;
                    }
                    "/png" => {
                        pngs.fetch_add(1, Ordering::SeqCst);
                        response.headers_mut().set("Content-Type", "image/png");
                        let _ = response.write(b"png bytes").await;
                    }
                    "/stall" => {
                        response.headers_mut().set("Content-Type", "image/png");
                        response.headers_mut().set("Content-Length", "100");
                        let _ = response.write(b"x").await;
                        stalled.fetch_add(1, Ordering::SeqCst);
                        let _ = gate.acquire().await;
                    }
                    _ => response.set_status(404),
                }
            }
        })
        .await;
        StallOrigin {
            url: format!("http://127.0.0.1:{}", running.address.port()),
            _running: running,
            gate,
            stalled,
            pngs,
        }
    }

    fn release(&self) {
        self.gate.close();
    }

    async fn wait_stalled(&self, want: usize) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while self.stalled.load(Ordering::SeqCst) < want && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(
            self.stalled.load(Ordering::SeqCst),
            want,
            "fetches at the stalling page"
        );
    }
}

impl Drop for StallOrigin {
    fn drop(&mut self) {
        self.release();
    }
}

async fn app(origin: &StallOrigin, rate_limit: i64) -> Running {
    let server = Server::new(Options {
        auth: "ticket".into(),
        secret: fixture_ticket("secret"),
        allowed_origins: vec![EDITOR.into()],
        rate_limit_per_minute: rate_limit,
        storage_directory: temp_dir().display().to_string(),
        public_url: "https://uploads.example.com/files/".into(),
        unfurl_enabled: true,
        ..Options::default()
    })
    .unwrap();
    let port: u16 = origin.url.rsplit(':').next().unwrap().parse().unwrap();
    server.inner.set_policy(Arc::new(ExactOriginPolicy {
        origin: origin.url.clone(),
        port,
    }));
    start(server.handler("")).await
}

fn pass(user: &str) -> String {
    let claims = blok_blokserver_ticket::Claims {
        user: Some(user.into()),
        doc: Some("doc-42".into()),
        write: true,
        ttl_seconds: None,
    };
    let now = UNIX_EPOCH + Duration::from_secs(4_102_444_800 - 300);
    blok_blokserver_ticket::mint(&fixture_ticket("secret"), &claims, now).unwrap()
}

async fn upload(address: SocketAddr, user: &str, url: &str) -> Answer {
    let body = format!(r#"{{"url":"{url}"}}"#);
    send(
        address,
        &format!(
            "POST /upload-by-url HTTP/1.1\r\nOrigin: {EDITOR}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}",
            pass(user),
            body.len()
        ),
        body.as_bytes(),
    )
    .await
}

async fn get(address: SocketAddr, user: &str, route: &str, url: &str) -> Answer {
    let query: String = url
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect();
    send(
        address,
        &format!(
            "GET /{route}?url={query} HTTP/1.1\r\nOrigin: {EDITOR}\r\nAuthorization: Bearer {}",
            pass(user)
        ),
        b"",
    )
    .await
}

fn spawn_uploads(address: SocketAddr, users: &[&str], url: &str) -> Vec<JoinHandle<Answer>> {
    users
        .iter()
        .map(|user| {
            let (user, url) = (user.to_string(), url.to_owned());
            tokio::spawn(async move { upload(address, &user, &url).await })
        })
        .collect()
}

/// Waits 300 ms and fails if the task already answered.
async fn assert_waiting(task: &JoinHandle<Answer>, what: &str) {
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        !task.is_finished(),
        "{what} answered while its caller held two"
    );
}

// Four stalled uploads fill the upload pool, never the one frame checks use.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stalled_uploads_by_url_never_starve_another_callers_frame_check() {
    let origin = StallOrigin::start().await;
    let running = app(&origin, 60).await;
    let held = spawn_uploads(
        running.address,
        &["a", "b", "c", "d"],
        &format!("{}/stall", origin.url),
    );
    origin.wait_stalled(4).await;
    let check = tokio::time::timeout(
        Duration::from_secs(2),
        get(
            running.address,
            "e",
            "frame-check",
            &format!("{}/plain", origin.url),
        ),
    )
    .await
    .expect("another caller's frame check waited behind four uploads");
    assert!(
        check.text().starts_with(r#"{"verdict":"insecure""#),
        "{}",
        check.text()
    );
    origin.release();
    for task in held {
        task.await.unwrap();
    }
}

// The third upload waits for one of the caller's slots and never reaches the
// page meanwhile. Other callers and the caller's own checks are served.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_third_concurrent_upload_from_one_caller_waits_for_its_own_slot() {
    let origin = StallOrigin::start().await;
    let running = app(&origin, 60).await;
    let held = spawn_uploads(
        running.address,
        &["a", "a"],
        &format!("{}/stall", origin.url),
    );
    origin.wait_stalled(2).await;
    let third = spawn_uploads(running.address, &["a"], &format!("{}/png", origin.url)).remove(0);
    assert_waiting(&third, "the third upload").await;
    assert_eq!(
        origin.pngs.load(Ordering::SeqCst),
        0,
        "the waiting upload reached the page"
    );
    let check = get(
        running.address,
        "a",
        "frame-check",
        &format!("{}/plain", origin.url),
    )
    .await;
    assert!(
        check.text().starts_with(r#"{"verdict":"insecure""#),
        "{}",
        check.text()
    );
    let other = upload(running.address, "b", &format!("{}/png", origin.url)).await;
    assert_eq!(other.status, 200, "{}", other.text());
    origin.release();
    for task in held {
        task.await.unwrap();
    }
    let third = tokio::time::timeout(Duration::from_secs(5), third)
        .await
        .expect("the third upload never ran after its caller freed a slot")
        .unwrap();
    assert_eq!(third.status, 200, "{}", third.text());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_third_concurrent_check_from_one_caller_waits_for_its_own_slot() {
    let origin = StallOrigin::start().await;
    let running = app(&origin, 60).await;
    let stall = format!("{}/stall", origin.url);
    let address = running.address;
    let held = [
        tokio::spawn({
            let stall = stall.clone();
            async move { get(address, "a", "frame-check", &stall).await }
        }),
        tokio::spawn(async move { get(address, "a", "unfurl", &stall).await }),
    ];
    origin.wait_stalled(2).await;
    let plain = format!("{}/plain", origin.url);
    let third = tokio::spawn(async move { get(address, "a", "frame-check", &plain).await });
    assert_waiting(&third, "the third check").await;
    origin.release();
    for task in held {
        task.await.unwrap();
    }
    let third = tokio::time::timeout(Duration::from_secs(5), third)
        .await
        .expect("the third check never ran after its caller freed a slot")
        .unwrap();
    assert!(
        third.text().starts_with(r#"{"verdict":"insecure""#),
        "{}",
        third.text()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_caller_cap_is_off_with_the_rate_limit() {
    let origin = StallOrigin::start().await;
    let running = app(&origin, 0).await;
    let held = spawn_uploads(
        running.address,
        &["a", "a", "a"],
        &format!("{}/stall", origin.url),
    );
    origin.wait_stalled(3).await;
    origin.release();
    for task in held {
        task.await.unwrap();
    }
}
