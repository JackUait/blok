mod common;

use std::time::Duration;

use blok_http::{Config, Request, ResponseWriter};
use common::{connect, read_all, start, write};

// The reader pauses at 64 KiB unread; taking body bytes must wake it, or a
// body bigger than that never ends.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_body_past_the_read_buffer_streams_to_the_end() {
    let running = start(
        |mut request: Request, mut response: ResponseWriter| async move {
            let mut body = Vec::new();
            let _ = request.body_mut().unwrap().read_to_end(&mut body).await;
            let _ = response.write(body.len().to_string().as_bytes()).await;
        },
        Config::default(),
    )
    .await;
    let size = 1 << 20;
    let mut conn = connect(running.address).await;
    let head = format!(
        "POST / HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Length: {size}\r\n\r\n"
    );
    write(&mut conn, head.as_bytes()).await;
    write(&mut conn, &vec![b'x'; size]).await;
    let answer =
        String::from_utf8_lossy(&read_all(&mut conn, Duration::from_secs(5)).await).into_owned();
    assert!(
        answer.contains("\r\n\r\n7\r\n1048576\r\n0\r\n\r\n"),
        "{answer:?}"
    );
}
