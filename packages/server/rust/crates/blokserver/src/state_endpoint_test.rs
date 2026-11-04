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
