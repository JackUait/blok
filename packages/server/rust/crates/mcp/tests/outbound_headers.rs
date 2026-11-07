//! Header values on outbound calls, as Node's fetch sends them.

use std::time::Duration;

use blok_mcp::outbound::Outbound;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Sends one GET and returns the Authorization line the host read.
async fn authorization_sent(value: &str) -> Option<String> {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/docs/a", listener.local_addr().unwrap());
    let host = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.ok()?;
        let mut buffer = vec![0u8; 4096];
        let n = socket.read(&mut buffer).await.ok()?;
        let head = String::from_utf8_lossy(&buffer[..n]).into_owned();
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
            .await
            .ok()?;
        head.split("\r\n")
            .find(|line| line.starts_with("Authorization:"))
            .map(str::to_owned)
    });
    let sent = Outbound::new()
        .send(
            "GET",
            &url,
            vec![("Authorization".to_owned(), value.to_owned())],
            None,
            Duration::from_secs(5),
        )
        .await;
    if sent.is_err() {
        host.abort();
        return None;
    }
    host.await.unwrap()
}

// fetch trims spaces, tabs, CR and LF around a value; inside they stay.
#[tokio::test]
async fn outer_whitespace_is_trimmed_as_node_fetch_does() {
    assert_eq!(
        authorization_sent("\t Token  t \r\n").await.as_deref(),
        Some("Authorization: Token  t")
    );
    assert_eq!(
        authorization_sent("\nToken\tt\t").await.as_deref(),
        Some("Authorization: Token\tt")
    );
    // A line break left inside is still refused.
    assert_eq!(authorization_sent("Token a\nb").await, None);
}
