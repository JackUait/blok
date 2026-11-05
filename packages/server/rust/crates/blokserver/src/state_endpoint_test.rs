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

// TheHeadHeadersJoinHeadersTheAppAlreadyExposes through the whole server, so
// Access-Control-Allow-Origin is what the server's own CORS step sent.
#[tokio::test(flavor = "multi_thread")]
async fn the_head_headers_join_headers_the_app_already_exposes() {
    use std::sync::Arc;

    use blok_http::{Handler, Request, ResponseWriter};

    use crate::testutil::{Answer, send, start, temp_dir};
    use crate::{Options, Server};

    const ORIGIN: &str = "https://app.example.com";
    let endpoint = start(
        |request: Request, mut response: ResponseWriter| async move {
            if request.method() == "GET" {
                response
                    .headers_mut()
                    .set("Content-Type", "application/json");
                let _ = response
                    .write(
                        br#"{"blocks":[{"id":"a","type":"paragraph","data":{"text":"seeded"}}]}"#,
                    )
                    .await;
                return;
            }
            response.set_status(204);
        },
    )
    .await;
    let server = Server::new(Options {
        allowed_origins: vec![ORIGIN.into()],
        collab_enabled: true,
        collab_journal: true,
        collab_directory: temp_dir().display().to_string(),
        doc_endpoint: format!("http://{}/docs", endpoint.address),
        ..Options::default()
    })
    .unwrap();
    let router: Arc<dyn Handler> = Arc::new(server.handler(""));
    // The app's own exposed names, set before the server runs.
    let host = start(move |request: Request, mut response: ResponseWriter| {
        let router = router.clone();
        response
            .headers_mut()
            .set("Access-Control-Expose-Headers", "X-Request-Id, etag");
        async move { router.serve(request, response).await }
    })
    .await;
    let exposed = |answer: &Answer| {
        assert_eq!(answer.headers_all("Access-Control-Allow-Origin"), [ORIGIN]);
        let mut names: Vec<String> = answer
            .headers_all("Access-Control-Expose-Headers")
            .iter()
            .flat_map(|value| value.split(',').map(|name| name.trim().to_owned()))
            .collect();
        names.sort();
        names
    };

    let state = send(
        host.address,
        &format!("GET /sync/doc/state HTTP/1.1\r\nOrigin: {ORIGIN}"),
        b"",
    )
    .await;
    let body: &[u8] =
        br#"{ "ops": [ { "op": "insert", "id": "new", "block": { "type": "p", "data": { "text": "!" } } } ] }"#;
    let edit = send(
        host.address,
        &format!(
            "POST /sync/doc/edit HTTP/1.1\r\nOrigin: {ORIGIN}\r\nBlok-Idempotency-Key: joined-edit\r\nContent-Type: application/json\r\nContent-Length: {}",
            body.len()
        ),
        body,
    )
    .await;

    assert_eq!((state.status, edit.status), (200, 204), "{}", edit.text());
    let want = [
        "Blok-Doc-Lineage",
        "Blok-Doc-Sequence",
        "X-Request-Id",
        "etag",
    ];
    assert_eq!(exposed(&state), want);
    assert_eq!(exposed(&edit), want);
    let _ = server.drain(std::time::Duration::from_secs(30)).await;
}
