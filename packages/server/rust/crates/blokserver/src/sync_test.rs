use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_collab::{BoxFuture, JoinResult, JoinStatus, Member, Rooms};

use crate::collab_test::collab_options;
use crate::testutil::{send, start};
use crate::{Options, Server};

/// Records each join and answers Draining, after `delay`.
#[derive(Default)]
struct CountingRooms {
    joins: Mutex<Vec<String>>,
    delay: Duration,
}

impl Rooms for CountingRooms {
    fn join<'a>(
        &'a self,
        doc: &'a str,
        _member: Arc<dyn Member>,
    ) -> BoxFuture<'a, Result<JoinResult, blok_collab::Error>> {
        Box::pin(async move {
            tokio::time::sleep(self.delay).await;
            self.joins.lock().unwrap().push(doc.to_owned());
            Ok(JoinResult {
                status: JoinStatus::Draining,
                membership: None,
                err: None,
            })
        })
    }
}

fn collab_server(rooms: Arc<CountingRooms>) -> Server {
    let s = Server::new(collab_options()).unwrap();
    *s.inner.rooms_override.lock().unwrap() = Some(rooms);
    s
}

fn upgrade_head(method: &str, path: &str) -> String {
    format!(
        "{method} {path} HTTP/1.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=="
    )
}

// MapGet("/sync/{doc}") outside the guard, and its 405 answers Allow: GET
// (BlokServerEndpointRouteBuilderExtensions.cs:103-105).
#[tokio::test]
async fn the_sync_door_is_mapped_outside_the_guard_with_a_get_only405() {
    let rooms = Arc::new(CountingRooms::default());
    let running = start(collab_server(rooms.clone()).handler("/blok")).await;

    let got = send(
        running.address,
        &upgrade_head("GET", "/blok/sync/doc-1"),
        b"",
    )
    .await;
    assert_eq!((got.status, got.text().as_str()), (503, "shutting down\n"));
    assert_eq!(*rooms.joins.lock().unwrap(), vec!["doc-1".to_owned()]);

    let got = send(
        running.address,
        &upgrade_head("POST", "/blok/sync/doc-1"),
        b"",
    )
    .await;
    assert_eq!((got.status, got.header("Allow")), (405, "GET"));
}

#[tokio::test]
async fn the_sync_door_is_not_mapped_without_collaboration() {
    let s = Server::new(Options::default()).unwrap();
    *s.inner.rooms_override.lock().unwrap() = Some(Arc::new(CountingRooms::default()));
    let running = start(s.handler("")).await;
    let got = send(running.address, &upgrade_head("GET", "/sync/doc-1"), b"").await;
    assert_eq!(got.status, 404);
}

// GET /sync/{doc} lifts the host's request deadline before the door runs,
// as MapGet(...).DisableRequestTimeout() does: a join that outlasts the
// deadline still gets the door's answer, not the host's 504.
#[tokio::test]
async fn the_sync_door_lifts_the_request_deadline_before_it_joins() {
    let rooms = Arc::new(CountingRooms {
        delay: Duration::from_millis(600),
        ..CountingRooms::default()
    });
    let handler = collab_server(rooms.clone()).handler("");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = blok_http::Server::new(
        handler,
        blok_http::Config {
            request_timeout: Some(Duration::from_millis(200)),
            ..blok_http::Config::default()
        },
    );
    let task = tokio::spawn(async move {
        let _ = server.serve(listener).await;
    });
    let got = send(address, &upgrade_head("GET", "/sync/doc-1"), b"").await;
    task.abort();
    assert_eq!((got.status, got.text().as_str()), (503, "shutting down\n"));
    assert_eq!(rooms.joins.lock().unwrap().len(), 1);
}
