use crate::collab_test::collab_options;
use crate::testutil::{Answer, send, start};
use crate::{Options, Server};

// Twins of the C# endpoint tests that pin the collab route builders (the
// shell's 405 Allow and preflight answers), which have no Go test.

const ORIGIN: &str = "https://app.example.com";

fn app() -> Server {
    Server::new(Options {
        collab_journal: true,
        allowed_origins: vec![ORIGIN.into()],
        ..collab_options()
    })
    .unwrap()
}

async fn ask(server: &Server, method: &str, path: &str, headers: &str) -> Answer {
    let running = start(server.handler("")).await;
    send(
        running.address,
        &format!("{method} {path} HTTP/1.1{headers}"),
        b"",
    )
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn edit_answers_the_shared_write_route_wire_for_other_methods() {
    let wrong = ask(&app(), "GET", "/sync/doc/edit", "").await;
    assert_eq!(
        (wrong.status, wrong.header("Allow")),
        (405, "OPTIONS, POST")
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn reset_answers_the_shared_write_route_wire_for_other_methods() {
    let s = app();
    let wrong = ask(&s, "GET", "/sync/doc/reset", "").await;
    let preflight = ask(
        &s,
        "OPTIONS",
        "/sync/doc/reset",
        &format!("\r\nOrigin: {ORIGIN}\r\nAccess-Control-Request-Method: POST"),
    )
    .await;
    assert_eq!(
        (wrong.status, wrong.header("Allow")),
        (405, "OPTIONS, POST")
    );
    assert_eq!(
        (
            preflight.status,
            preflight.header("Access-Control-Allow-Methods")
        ),
        (204, "POST, OPTIONS")
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn state_answers_only_get() {
    let wrong = ask(&app(), "POST", "/sync/doc/state", "").await;
    assert_eq!((wrong.status, wrong.header("Allow")), (405, "GET, OPTIONS"));
}

#[tokio::test(flavor = "multi_thread")]
async fn each_route_advertises_its_own_methods() {
    let s = app();
    let lineage = "0123456789abcdef0123456789abcdef";
    for (method, path, allow) in [
        ("POST", "/sync/doc/history".to_owned(), "GET, OPTIONS"),
        (
            "DELETE",
            format!("/sync/doc/history/{lineage}/0"),
            "GET, OPTIONS",
        ),
        (
            "GET",
            format!("/sync/doc/history/{lineage}"),
            "DELETE, OPTIONS",
        ),
        (
            "GET",
            format!("/sync/doc/history/{lineage}/0/restore"),
            "OPTIONS, POST",
        ),
        ("HEAD", "/sync/doc/history".to_owned(), "GET, OPTIONS"),
        (
            "POST",
            format!("/sync/doc/history/{lineage}/0/changes"),
            "GET, OPTIONS",
        ),
    ] {
        let answer = ask(&s, method, &path, "").await;
        assert_eq!(
            (answer.status, answer.header("Allow")),
            (405, allow),
            "{method} {path}"
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_delete_preflight_is_allowed() {
    let preflight = ask(
        &app(),
        "OPTIONS",
        "/sync/doc/history/ffffffffffffffffffffffffffffffff",
        &format!("\r\nOrigin: {ORIGIN}\r\nAccess-Control-Request-Method: DELETE"),
    )
    .await;
    assert_eq!(
        (
            preflight.status,
            preflight.header("Access-Control-Allow-Origin"),
            preflight.header("Access-Control-Allow-Methods"),
        ),
        (204, ORIGIN, "DELETE, OPTIONS")
    );
}
