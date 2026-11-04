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

// Measured on the C# host: Kestrel drains a body the handler left unread, up
// to the body cap, and answers the next request on the connection. A 30 MB
// cap bounds it, with the minimum data rate and the request deadline.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_unread_body_under_the_cap_is_drained_for_the_next_request() {
    let running = start(
        |request: Request, mut response: ResponseWriter| async move {
            let _ = response.write(request.path().as_bytes()).await;
        },
        Config::default(),
    )
    .await;
    for size in [1usize << 20, 5 << 20] {
        let mut conn = connect(running.address).await;
        let head = format!("POST /first HTTP/1.1\r\nHost: x\r\nContent-Length: {size}\r\n\r\n");
        {
            let (read, mut write) = conn.into_split();
            let mut bytes = head.into_bytes();
            bytes.extend(vec![b'x'; size]);
            bytes
                .extend_from_slice(b"GET /second HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
            let task = tokio::spawn(async move {
                use tokio::io::AsyncWriteExt;
                let _ = write.write_all(&bytes).await;
                write
            });
            conn = read.reunite(task.await.unwrap()).unwrap();
        }
        let answer = String::from_utf8_lossy(&read_all(&mut conn, Duration::from_secs(5)).await)
            .into_owned();
        assert!(
            answer.contains("/first") && answer.contains("/second"),
            "{size}: {answer:?}"
        );
    }
}
