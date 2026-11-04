use std::sync::Arc;

use super::*;

#[test]
fn an_upgrade_slot_is_freed_once_when_its_socket_closes() {
    let limit = Arc::new(UpgradeLimit::new(1));
    let held = limit.try_take().expect("under the limit");
    assert!(limit.try_take().is_none(), "past the limit");
    held.release();
    held.release();
    let again = limit.try_take();
    assert!(again.is_some(), "after close");
    assert!(
        limit.try_take().is_none(),
        "a second close freed a second slot"
    );
}

// Measured on Kestrel with MaxConcurrentUpgradedConnections = 2: a socket it
// accepts only to close takes a slot too, and an upgrade past the limit is an
// empty 500 that keeps the connection, even after the room was joined.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn past_the_upgrade_limit_every_upgrade_is_an_empty500() {
    let h = crate::test_support::start_endpoint(
        |c| {
            c.connections = Arc::new(crate::ConnectionTable::new(3, 8));
            c.upgrades = Some(Arc::new(UpgradeLimit::new(2)));
        },
        None,
    )
    .await;
    let _first = h.dial("/sync/doc", &[]).await;
    let _second = h.dial("/sync/doc", &[]).await;
    for path in ["/sync/a%2Fb", "/sync/doc"] {
        let client = h.dial(path, &[]).await;
        assert_eq!(
            (
                client.status,
                client.body.as_str(),
                client.header("Content-Length")
            ),
            (500, "", "0"),
            "{path}: {:?}",
            client.headers
        );
        assert!(
            !client.header("Connection").eq_ignore_ascii_case("close"),
            "{path}: closed"
        );
    }
    assert_eq!(h.rooms.joins(), 3);
    assert!(
        h.rooms.membership(2).has_left(),
        "the failed upgrade never left"
    );
}

// Only an upgrade takes a slot: a plain request at the limit still gets its
// own answer.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_plain_request_keeps_its_own_writer() {
    let h = crate::test_support::start_endpoint(
        |c| c.upgrades = Some(Arc::new(UpgradeLimit::new(0))),
        None,
    )
    .await;
    let mut stream = tokio::net::TcpStream::connect(h.address).await.unwrap();
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    stream
        .write_all(b"GET /sync/doc HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
        .await
        .unwrap();
    let mut answer = String::new();
    stream.read_to_string(&mut answer).await.unwrap();
    assert!(answer.starts_with("HTTP/1.1 426 "), "{answer:?}");
    assert!(
        answer.contains("WebSocket upgrade required\n"),
        "{answer:?}"
    );
}
