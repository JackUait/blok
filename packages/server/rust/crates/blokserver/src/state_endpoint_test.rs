use std::time::SystemTime;

use crate::history_endpoint_test::{assert_error, history_app};
use crate::testutil::fixture_ticket;

// Twins of the C# StateEndpointTests that need the guard in front.

#[tokio::test(flavor = "multi_thread")]
async fn in_ticket_mode_a_read_pass_for_this_document_is_enough() {
    let app = history_app("ticket").await;
    let missing = app.send("GET", "/state", None, None).await;
    assert_error(&missing, 401, "missing pass\n");
    let other = app
        .send("GET", "/state", Some(&fixture_ticket("docMismatch")), None)
        .await;
    assert_error(&other, 403, "pass is for another document\n");
    let read_only = app
        .send("GET", "/state", Some(&fixture_ticket("readOnly")), None)
        .await;
    assert_eq!(read_only.status, 200, "{}", read_only.text());
    app.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn in_ticket_mode_a_pass_minted_by_blok_ticket_is_accepted() {
    let app = history_app("ticket").await;
    let minted = |doc: &str| {
        let claims = blok_blokserver_ticket::Claims {
            user: Some("\u{fc}\u{1f600}<".into()),
            doc: Some(doc.into()),
            write: false,
            ttl_seconds: None,
        };
        blok_blokserver_ticket::mint(&fixture_ticket("secret"), &claims, SystemTime::now()).unwrap()
    };
    let other = app
        .send("GET", "/state", Some(&minted("other-doc")), None)
        .await;
    assert_error(&other, 403, "pass is for another document\n");
    let ok = app
        .send("GET", "/state", Some(&minted("doc-42")), None)
        .await;
    assert_eq!(ok.status, 200, "{}", ok.text());
    app.close().await;
}

const CORS_ORIGIN: &str = "https://app.example.com";
const APPEND_ONE: &[u8] =
    br#"{ "ops": [ { "op": "insert", "id": "new", "block": { "type": "p", "data": { "text": "!" } } } ] }"#;

/// SyncApp with the journal on, behind the whole server, so
/// Access-Control-Allow-Origin is what the server's own CORS step sent.
/// `exposed` is what the app's own CORS layer exposes first.
struct CorsApp {
    host: crate::testutil::Running,
    _endpoint: crate::testutil::Running,
    server: crate::Server,
}

impl CorsApp {
    async fn start(exposed: Option<&'static str>) -> Self {
        use std::sync::Arc;

        use blok_http::{Handler, Request, ResponseWriter};

        use crate::testutil::{start, temp_dir};
        use crate::{Options, Server};

        let endpoint = start(
            |request: Request, mut response: ResponseWriter| async move {
                if request.method() == "GET" {
                    response.headers_mut().set("Content-Type", "application/json");
                    let _ = response
                        .write(br#"{"blocks":[{"id":"a","type":"paragraph","data":{"text":"seeded"}}]}"#)
                        .await;
                    return;
                }
                response.set_status(204);
            },
        )
        .await;
        let server = Server::new(Options {
            allowed_origins: vec![CORS_ORIGIN.into()],
            collab_enabled: true,
            collab_journal: true,
            collab_directory: temp_dir().display().to_string(),
            doc_endpoint: format!("http://{}/docs", endpoint.address),
            ..Options::default()
        })
        .unwrap();
        let router: Arc<dyn Handler> = Arc::new(server.handler(""));
        let host = start(move |request: Request, mut response: ResponseWriter| {
            let router = router.clone();
            if let Some(exposed) = exposed {
                response
                    .headers_mut()
                    .set("Access-Control-Expose-Headers", exposed);
            }
            async move { router.serve(request, response).await }
        })
        .await;
        CorsApp {
            host,
            _endpoint: endpoint,
            server,
        }
    }

    async fn state(&self) -> crate::testutil::Answer {
        let head = format!("GET /sync/doc/state HTTP/1.1\r\nOrigin: {CORS_ORIGIN}");
        crate::testutil::send(self.host.address, &head, b"").await
    }

    async fn edit(&self, key: &str, if_match: Option<&str>) -> crate::testutil::Answer {
        let mut head = format!(
            "POST /sync/doc/edit HTTP/1.1\r\nOrigin: {CORS_ORIGIN}\r\nBlok-Idempotency-Key: {key}\r\nContent-Type: application/json\r\nContent-Length: {}",
            APPEND_ONE.len()
        );
        if let Some(etag) = if_match {
            head.push_str(&format!("\r\nIf-Match: {etag}"));
        }
        crate::testutil::send(self.host.address, &head, APPEND_ONE).await
    }

    async fn close(self) {
        let _ = self.server.drain(std::time::Duration::from_secs(30)).await;
    }
}

/// C# ExposedHeaders: the names, split and sorted, after checking the
/// answer is a CORS one.
fn exposed_headers(answer: &crate::testutil::Answer) -> Vec<String> {
    assert_eq!(
        answer.headers_all("Access-Control-Allow-Origin"),
        [CORS_ORIGIN]
    );
    let mut names: Vec<String> = answer
        .headers_all("Access-Control-Expose-Headers")
        .iter()
        .flat_map(|value| value.split(',').map(|name| name.trim().to_owned()))
        .collect();
    names.sort();
    names
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cross_origin_page_can_read_the_head_headers_on_state_and_edit() {
    let app = CorsApp::start(None).await;
    let state = app.state().await;
    let applied = app.edit("exposed-edit", None).await;
    let stale = app.edit("exposed-stale", Some(state.header("ETag"))).await;

    assert_eq!((applied.status, stale.status), (204, 412));
    let want = ["Blok-Doc-Lineage", "Blok-Doc-Sequence", "ETag"];
    assert_eq!(exposed_headers(&state), want);
    assert_eq!(exposed_headers(&applied), want);
    assert_eq!(exposed_headers(&stale), want);
    app.close().await;
}

// A host's own CORS layer may expose headers first; ours are added, not
// swapped in.
#[tokio::test(flavor = "multi_thread")]
async fn the_head_headers_join_headers_the_app_already_exposes() {
    let app = CorsApp::start(Some("X-Request-Id, etag")).await;
    let state = app.state().await;
    let edit = app.edit("joined-edit", None).await;

    assert_eq!((state.status, edit.status), (200, 204), "{}", edit.text());
    let want = [
        "Blok-Doc-Lineage",
        "Blok-Doc-Sequence",
        "X-Request-Id",
        "etag",
    ];
    assert_eq!(exposed_headers(&state), want);
    assert_eq!(exposed_headers(&edit), want);
    app.close().await;
}
