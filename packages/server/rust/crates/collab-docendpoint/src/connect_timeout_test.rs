use std::time::{Duration, Instant};

use blok_dotnet::parse_absolute_uri;

use crate::client::{Client, Fake, Options};
use crate::client_test::{Recorder, Setup, client, endpoint_error};

// SocketsHttpHandler.ConnectTimeout bounds the TCP connect and the TLS
// handshake, and its cancellation is an OperationCanceledException, which
// SendAsync turns into "timed out after".

#[tokio::test]
async fn a_connect_timeout_reads_as_timed_out() {
    let err = client(&Recorder::default(), Setup::default(), |_| {
        Fake::ConnectTimeout
    })
    .load("a")
    .await
    .unwrap_err();
    assert_eq!(
        endpoint_error(err).0,
        "collab: the doc endpoint GET timed out after 30s."
    );
}

#[tokio::test]
async fn a_stalled_tls_handshake_dies_at_the_connect_timeout() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let mut held = Vec::new();
        while let Ok((conn, _)) = listener.accept().await {
            held.push(conn);
        }
    });
    let c = Client::with_connect_timeout(
        Options {
            endpoint: parse_absolute_uri(&format!("https://{address}/docs")).unwrap(),
            request_timeout: Some(Duration::from_secs(3)),
            ..Options::default()
        },
        Duration::from_millis(300),
        None,
    );
    let start = Instant::now();
    let err = c.load("a").await.unwrap_err();
    assert!(
        start.elapsed() <= Duration::from_millis(1500),
        "failed after {:?}",
        start.elapsed()
    );
    assert_eq!(
        endpoint_error(err).0,
        "collab: the doc endpoint GET timed out after 3s."
    );
}
