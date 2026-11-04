mod common;

use blok_http::{Config, Request, ResponseWriter};
use common::{raw_answer, start, write_text};

// A mount under a prefix hands the rest of the path on; the query and the
// target stay as sent.
#[tokio::test]
async fn set_path_replaces_the_routed_path_only() {
    let running = start(
        |mut request: Request, mut response: ResponseWriter| async move {
            let rest = request.path().strip_prefix("/api").unwrap_or("").to_owned();
            request.set_path(rest);
            let text = format!(
                "{}|{}|{}",
                request.path(),
                request.query(),
                request.target()
            );
            write_text(&mut response, &text).await;
        },
        Config::default(),
    )
    .await;
    let answer = raw_answer(
        running.address,
        b"GET /api/a%2Fb?x=1 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert!(
        answer.ends_with("\r\n\r\n1a\r\n/a%2Fb|?x=1|/api/a%2Fb?x=1\r\n0\r\n\r\n"),
        "{answer:?}"
    );
}
