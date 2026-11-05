use std::time::Duration;

use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;

use super::*;

async fn pair(options: Options) -> (Conn, TcpStream) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (client, accepted) = tokio::join!(TcpStream::connect(address), listener.accept());
    let (read, write) = accepted.unwrap().0.into_split();
    (Conn::new(read, write, Vec::new(), options), client.unwrap())
}

/// A masked binary frame of 100 zero bytes, mask 1 2 3 4.
fn small_frame() -> Vec<u8> {
    let mut frame = vec![0x82, 0x80 | 100, 1, 2, 3, 4];
    frame.extend((0..100).map(|i| (i % 4 + 1) as u8));
    frame
}

/// Frames received after the abort, and the error that ended them.
async fn received_after(how: &str) -> (usize, Option<Error>) {
    const FRAMES: usize = 200;
    let options = if how == "keep-alive" {
        Options {
            keep_alive_interval: Duration::from_millis(100),
            keep_alive_timeout: Duration::from_millis(200),
            ..Options::default()
        }
    } else {
        Options::default()
    };
    let (server, mut client) = pair(options).await;
    client
        .write_all(&small_frame().repeat(FRAMES))
        .await
        .unwrap();
    // Long enough for every frame to be read ahead.
    tokio::time::sleep(Duration::from_millis(300)).await;
    match how {
        "abort" => server.abort(),
        "keep-alive" => timeout(Duration::from_secs(5), server.done())
            .await
            .expect("the keep-alive never timed out"),
        _ => {}
    }
    let mut buf = [0u8; 256];
    let mut got = 0;
    while got < FRAMES {
        match server.receive(&mut buf).await {
            Ok(_) => got += 1,
            Err(error) => return (got, Some(error)),
        }
    }
    (got, None)
}

// Kestrel's WebSocket receives nothing once it is aborted, though its
// transport still holds the frames it read ahead (WebSocketAbortTests.cs).
#[tokio::test]
async fn no_frame_read_ahead_is_received_after_an_abort() {
    // Repeated: an unbiased race between the buffer and the abort would
    // let a frame through only now and then.
    for _ in 0..20 {
        assert_eq!(received_after("abort").await, (0, Some(Error::Aborted)));
    }
}

#[tokio::test]
async fn no_frame_read_ahead_is_received_after_a_keep_alive_timeout() {
    for _ in 0..5 {
        assert_eq!(
            received_after("keep-alive").await,
            (0, Some(Error::KeepAliveTimeout))
        );
    }
}

#[tokio::test]
async fn every_frame_read_ahead_is_received_without_an_abort() {
    assert_eq!(received_after("none").await, (200, None));
}
