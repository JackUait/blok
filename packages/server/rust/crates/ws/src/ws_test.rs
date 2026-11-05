use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::task::{Context, Poll, Waker};
use std::time::{Duration, Instant};

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::*;

/// A server Conn and the raw client end over loopback TCP.
async fn pair(options: Options) -> (Conn, TcpStream) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (client, accepted) = tokio::join!(TcpStream::connect(address), listener.accept());
    let (read, write) = accepted.unwrap().0.into_split();
    let server = Conn::new(read, write, Vec::new(), options);
    // A test that waits on a frame that never comes fails instead of hanging.
    let stop = server.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(10)).await;
        stop.abort();
    });
    (server, client.unwrap())
}

const TEST_MASK: [u8; 4] = [0x11, 0x22, 0x33, 0x44];

/// A masked client frame; first is the byte with FIN, RSV and opcode.
fn frame(first: u8, payload: &[u8]) -> Vec<u8> {
    let mut b = vec![first];
    match payload.len() {
        n if n <= 125 => b.push(0x80 | n as u8),
        n if n <= 0xffff => {
            b.push(0x80 | 126);
            b.extend_from_slice(&(n as u16).to_be_bytes());
        }
        n => {
            b.push(0x80 | 127);
            b.extend_from_slice(&(n as u64).to_be_bytes());
        }
    }
    b.extend_from_slice(&TEST_MASK);
    b.extend(
        payload
            .iter()
            .enumerate()
            .map(|(i, c)| c ^ TEST_MASK[i & 3]),
    );
    b
}

async fn send(client: &mut (impl AsyncWrite + Unpin), frames: &[Vec<u8>]) {
    for f in frames {
        client.write_all(f).await.unwrap();
    }
}

/// One unmasked server frame.
async fn server_frame(client: &mut (impl AsyncRead + Unpin)) -> (u8, Vec<u8>) {
    tokio::time::timeout(Duration::from_secs(5), async {
        let mut head = [0u8; 2];
        client.read_exact(&mut head).await.expect("no server frame");
        let mut length = usize::from(head[1] & 0x7f);
        if length == 126 {
            let mut ext = [0u8; 2];
            client.read_exact(&mut ext).await.unwrap();
            length = usize::from(u16::from_be_bytes(ext));
        }
        let mut payload = vec![0u8; length];
        client.read_exact(&mut payload).await.unwrap();
        (head[0], payload)
    })
    .await
    .expect("no server frame within 5s")
}

fn close_frame(status: u16, reason: &str) -> Vec<u8> {
    let mut b = status.to_be_bytes().to_vec();
    b.extend_from_slice(reason.as_bytes());
    b
}

type Receipt = (usize, MessageType, bool);

async fn receive_all(server: &Conn, count: usize) -> Vec<Receipt> {
    let mut buf = vec![0u8; 16 * 1024];
    let mut got = Vec::new();
    for i in 0..count {
        let receipt = server
            .receive(&mut buf)
            .await
            .unwrap_or_else(|error| panic!("receive {i}: {error}"));
        got.push(receipt);
    }
    got
}

async fn receive_until_error(server: &Conn) -> Error {
    let mut buf = vec![0u8; 16 * 1024];
    loop {
        if let Err(error) = server.receive(&mut buf).await {
            return error;
        }
    }
}

fn alive_tasks() -> usize {
    tokio::runtime::Handle::current()
        .metrics()
        .num_alive_tasks()
}

#[tokio::test]
async fn a_frame_arrives_in_receives_of_the_buffer_size() {
    let (server, mut client) = pair(Options::default()).await;
    send(&mut client, &[frame(0x82, &[7; 40000])]).await;
    let got = receive_all(&server, 3).await;
    let want = [
        (16384, MessageType::Binary, false),
        (16384, MessageType::Binary, false),
        (7232, MessageType::Binary, true),
    ];
    assert_eq!(got, want);
}

#[tokio::test]
async fn every_empty_fragment_is_one_receive() {
    let (server, mut client) = pair(Options::default()).await;
    send(
        &mut client,
        &[
            frame(0x02, &[]),
            frame(0x00, &[]),
            frame(0x00, &[1]),
            frame(0x80, &[]),
        ],
    )
    .await;
    let got = receive_all(&server, 4).await;
    let want = [
        (0, MessageType::Binary, false),
        (0, MessageType::Binary, false),
        (1, MessageType::Binary, false),
        (0, MessageType::Binary, true),
    ];
    assert_eq!(got, want);
}

#[tokio::test]
async fn a_ping_inside_a_fragmented_message_is_answered_and_skipped() {
    let (server, mut client) = pair(Options::default()).await;
    send(
        &mut client,
        &[frame(0x02, &[1]), frame(0x89, b"hi"), frame(0x80, &[2])],
    )
    .await;
    let got = receive_all(&server, 2).await;
    assert_eq!(
        got,
        [
            (1, MessageType::Binary, false),
            (1, MessageType::Binary, true)
        ]
    );
    let (op, payload) = server_frame(&mut client).await;
    assert_eq!((op, payload.as_slice()), (0x8a, b"hi".as_slice()));
}

#[tokio::test]
async fn protocol_errors_close_with1002_and_no_reason() {
    let unmasked = vec![0x82, 0x01, 0x00, 0x00, 0x00, 0x00, 0x05];
    let mut negative = vec![0x82, 0xff, 0x80, 0, 0, 0, 0, 0, 0, 0];
    negative.extend_from_slice(&TEST_MASK);
    let mut bad_reason = close_frame(1000, "");
    bad_reason.push(0xff);
    let cases: Vec<(&str, Vec<Vec<u8>>)> = vec![
        ("unmasked", vec![unmasked]),
        ("rsv1", vec![frame(0xc2, &[1])]),
        ("rsv3", vec![frame(0x92, &[1])]),
        ("unknown opcode", vec![frame(0x83, &[])]),
        ("continuation first", vec![frame(0x80, &[1])]),
        (
            "binary inside a fragment",
            vec![frame(0x02, &[1]), frame(0x82, &[1])],
        ),
        ("long ping", vec![frame(0x89, &[1; 126])]),
        ("fragmented ping", vec![frame(0x09, &[])]),
        ("one-byte close", vec![frame(0x88, &[3])]),
        ("close 1005", vec![frame(0x88, &close_frame(1005, ""))]),
        ("close 1004", vec![frame(0x88, &close_frame(1004, ""))]),
        ("close 999", vec![frame(0x88, &close_frame(999, ""))]),
        ("close 5000", vec![frame(0x88, &close_frame(5000, ""))]),
        ("close bad reason", vec![frame(0x88, &bad_reason)]),
        ("negative length", vec![negative]),
    ];
    for (name, frames) in cases {
        let (server, mut client) = pair(Options::default()).await;
        send(&mut client, &frames).await;
        let error = receive_until_error(&server).await;
        assert_eq!(error, Error::Protocol, "{name}");
        let (op, payload) = server_frame(&mut client).await;
        assert_eq!((op, payload), (0x88, close_frame(1002, "")), "{name}");
    }
}

#[tokio::test]
async fn valid_close_statuses_are_accepted() {
    for status in [1000, 1003, 1007, 1014, 3000, 4999] {
        let (server, mut client) = pair(Options::default()).await;
        send(
            &mut client,
            &[frame(0x88, &close_frame(status, "bye \u{e9}"))],
        )
        .await;
        let got = receive_all(&server, 1).await;
        assert_eq!(got[0].1, MessageType::Close, "{status}");
        assert_eq!(
            (server.close_status(), server.close_description()),
            (status, "bye \u{e9}".to_owned())
        );
    }
}

#[tokio::test]
async fn invalid_text_closes_with1007() {
    let cases: Vec<(&str, Vec<Vec<u8>>)> = vec![
        (
            "split overlong",
            vec![frame(0x01, &[0xc0]), frame(0x80, &[0xaf])],
        ),
        ("surrogate", vec![frame(0x81, &[0xed, 0xa0, 0x80])]),
        (
            "cut at the end",
            vec![frame(0x01, &[b'a', 0xe2, 0x82]), frame(0x80, &[])],
        ),
        (
            "past U+10FFFF split",
            vec![frame(0x01, &[0xf4]), frame(0x80, &[0x90, 0x80, 0x80])],
        ),
    ];
    for (name, frames) in cases {
        let (server, mut client) = pair(Options::default()).await;
        send(&mut client, &frames).await;
        let error = receive_until_error(&server).await;
        let (op, payload) = server_frame(&mut client).await;
        assert_eq!(
            (op, payload),
            (0x88, close_frame(1007, "")),
            "{name} ({error})"
        );
    }
}

#[tokio::test]
async fn text_split_inside_a_character_is_valid() {
    let (server, mut client) = pair(Options::default()).await;
    let euro = "\u{20ac}".as_bytes();
    send(
        &mut client,
        &[frame(0x01, &euro[..1]), frame(0x80, &euro[1..])],
    )
    .await;
    let got = receive_all(&server, 2).await;
    assert_eq!(
        got,
        [(1, MessageType::Text, false), (2, MessageType::Text, true)]
    );
}

#[tokio::test]
async fn closing_after_the_peers_close_ends_the_stream() {
    let (server, mut client) = pair(Options::default()).await;
    send(&mut client, &[frame(0x88, &close_frame(1001, ""))]).await;
    receive_all(&server, 1).await;
    server.close_output(4401, "missing pass").await.unwrap();
    let (op, payload) = server_frame(&mut client).await;
    assert_eq!((op, payload), (0x88, close_frame(4401, "missing pass")));
    let mut one = [0u8; 1];
    let n = tokio::time::timeout(Duration::from_secs(5), client.read(&mut one))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(n, 0, "want EOF after both closes");
    assert_eq!(server.send_binary(&[1]).await, Err(Error::InvalidState));
}

#[tokio::test]
async fn an_unanswered_ping_aborts_with_no_close_frame() {
    let options = Options {
        keep_alive_interval: Duration::from_millis(40),
        keep_alive_timeout: Duration::from_millis(80),
        ..Options::default()
    };
    let (server, mut client) = pair(options).await;
    let started = Instant::now();
    let (op, payload) = server_frame(&mut client).await;
    assert_eq!(
        (op, payload),
        (0x89, 1u64.to_be_bytes().to_vec()),
        "first ping"
    );
    let error = server.receive(&mut [0u8; 16]).await.unwrap_err();
    assert_eq!(error, Error::KeepAliveTimeout);
    let elapsed = started.elapsed();
    assert!(
        elapsed >= Duration::from_millis(100) && elapsed <= Duration::from_secs(2),
        "aborted after {elapsed:?}"
    );
    let mut one = [0u8; 1];
    let n = tokio::time::timeout(Duration::from_secs(5), client.read(&mut one))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(n, 0, "want a bare EOF");
}

#[tokio::test]
async fn answered_pings_keep_the_socket_and_count() {
    let options = Options {
        keep_alive_interval: Duration::from_millis(30),
        keep_alive_timeout: Duration::from_millis(60),
        ..Options::default()
    };
    let (server, mut client) = pair(options).await;
    let receiver = server.clone();
    tokio::spawn(async move {
        let _ = receiver.receive(&mut [0u8; 16]).await;
    });
    for want in 1u64..=4 {
        let (op, payload) = server_frame(&mut client).await;
        assert_eq!(
            (op, payload.clone()),
            (0x89, want.to_be_bytes().to_vec()),
            "ping {want}"
        );
        send(&mut client, &[frame(0x8a, &payload)]).await;
    }
    assert!(!server.is_done(), "an answered socket was aborted");
}

#[tokio::test]
async fn a_wrong_pong_does_not_answer_the_ping() {
    let options = Options {
        keep_alive_interval: Duration::from_millis(30),
        keep_alive_timeout: Duration::from_millis(60),
        ..Options::default()
    };
    let (server, mut client) = pair(options).await;
    let receiver = server.clone();
    let errors = tokio::spawn(async move { receiver.receive(&mut [0u8; 16]).await });
    let (_, payload) = server_frame(&mut client).await;
    send(
        &mut client,
        &[
            frame(0x8a, &[0, 0, 0, 0, 0, 0, 0, 9]),
            frame(0x8a, &payload[..4]),
        ],
    )
    .await;
    assert_eq!(errors.await.unwrap(), Err(Error::KeepAliveTimeout));
}

#[test]
fn accept_key_matches_rfc6455() {
    assert_eq!(
        accept_key("dGhlIHNhbXBsZSBub25jZQ==").as_deref(),
        Some("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")
    );
}

#[test]
fn web_socket_request_check() {
    let base = || {
        let mut headers = blok_http::Headers::new();
        headers.set("Connection", "keep-alive, Upgrade");
        headers.set("Upgrade", "WebSocket");
        headers.set("Sec-WebSocket-Version", "8, 13");
        headers.set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==");
        ("GET", headers, false, false)
    };
    let check = |(method, headers, body, coding): (&str, blok_http::Headers, bool, bool)| {
        is_upgrade(method, &headers, body, coding)
    };
    assert!(check(base()), "a valid request was refused");
    type Edit = fn(&mut (&str, blok_http::Headers, bool, bool));
    let edits: [(&str, Edit); 10] = [
        ("post", |r| r.0 = "POST"),
        ("no connection", |r| r.1.remove("Connection")),
        ("version 12", |r| r.1.set("Sec-WebSocket-Version", "12")),
        ("no upgrade", |r| r.1.set("Upgrade", "h2c")),
        ("short key", |r| r.1.set("Sec-WebSocket-Key", "AAAA")),
        ("long key", |r| {
            r.1.set("Sec-WebSocket-Key", "AAAAAAAAAAAAAAAAAAAAAAAAAAAA")
        }),
        ("blank key", |r| r.1.set("Sec-WebSocket-Key", "  ")),
        ("body", |r| r.2 = true),
        ("chunked", |r| r.3 = true),
        ("unpadded key", |r| {
            r.1.set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ")
        }),
    ];
    for (name, edit) in edits {
        let mut request = base();
        edit(&mut request);
        assert!(!check(request), "{name}: accepted");
    }
    let mut spaced = base();
    spaced
        .1
        .set("Sec-WebSocket-Key", "dGhl IHNh bXBs ZSBu b25j ZQ==");
    assert!(check(spaced), "base64 with spaces is a valid .NET key");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn senders_never_interleave_frames() {
    let (server, client) = pair(Options::default()).await;
    let big = vec![5u8; 70000];
    let sender = server.clone();
    let done = tokio::spawn(async move {
        let mut tasks = Vec::new();
        for _ in 0..20 {
            let sender = sender.clone();
            let big = big.clone();
            tasks.push(tokio::spawn(async move { sender.send_binary(&big).await }));
        }
        for task in tasks {
            let _ = task.await;
        }
    });
    let mut reader = tokio::io::BufReader::new(client);
    for i in 0..20 {
        let mut head = [0u8; 10];
        reader.read_exact(&mut head).await.unwrap();
        assert!(
            head[0] == 0x82
                && head[1] == 127
                && u64::from_be_bytes(head[2..].try_into().unwrap()) == 70000,
            "frame {i} header {head:x?}"
        );
        let mut body = vec![0u8; 70000];
        reader.read_exact(&mut body).await.unwrap();
    }
    done.await.unwrap();
}

// OnDataReceived runs after every stream read, header reads included
// (EnsureBufferContainsAsync), so a peer sending only empty frames still
// pushes the next ping back.
#[tokio::test]
async fn empty_frames_push_the_next_ping_back() {
    let options = Options {
        keep_alive_interval: Duration::from_millis(150),
        keep_alive_timeout: Duration::from_secs(1),
        ..Options::default()
    };
    let (server, client) = pair(options).await;
    let receiver = server.clone();
    tokio::spawn(async move {
        let mut buf = [0u8; 16];
        while receiver.receive(&mut buf).await.is_ok() {}
    });
    let (mut read, mut write) = client.into_split();
    let pinged = Arc::new(AtomicBool::new(false));
    let saw = Arc::clone(&pinged);
    tokio::spawn(async move {
        let mut head = [0u8; 2];
        if read.read_exact(&mut head).await.is_ok() && head[0] == 0x89 {
            saw.store(true, Ordering::SeqCst);
        }
    });
    for _ in 0..12 {
        send(&mut write, &[frame(0x82, &[])]).await;
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(
        !pinged.load(Ordering::SeqCst),
        "pinged a peer that kept sending"
    );
}

/// A server Conn on one end of an in-memory pipe that holds only a few
/// bytes, so a send blocks once the peer stops reading.
fn piped(options: Options) -> (Conn, tokio::io::DuplexStream) {
    let (server_end, client) = tokio::io::duplex(64);
    let (read, write) = tokio::io::split(server_end);
    (Conn::new(read, write, Vec::new(), options), client)
}

// A peer that stops reading but keeps the connection open must not pin the
// socket: the keep-alive still times out and aborts it, which also ends the
// stuck send (ManagedWebSocket fires the ping outside the send lock).
#[tokio::test]
async fn a_stuck_send_still_times_out_the_keep_alive() {
    let before = alive_tasks();
    let (server, _client) = piped(Options {
        keep_alive_interval: Duration::from_millis(20),
        keep_alive_timeout: Duration::from_millis(20),
        ..Options::default()
    });
    let sender = server.clone();
    let sent = tokio::spawn(async move { sender.send_binary(&vec![0u8; 64 * 1024]).await });
    tokio::time::timeout(Duration::from_secs(1), server.done())
        .await
        .expect("socket still open 1s later");
    let result = tokio::time::timeout(Duration::from_secs(1), sent)
        .await
        .expect("the stuck send never returned")
        .unwrap();
    assert!(result.is_err(), "the stuck send reported success");
    let settled = Instant::now() + Duration::from_secs(1);
    while alive_tasks() > before && Instant::now() < settled {
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert!(
        alive_tasks() <= before,
        "{} tasks left, {before} before",
        alive_tasks()
    );
}

// With no timeout the heartbeat sends unsolicited pongs; a stuck send must
// not pile up one waiting pong per tick.
#[tokio::test]
async fn a_stuck_send_does_not_pile_up_pongs() {
    let (server, _client) = piped(Options {
        keep_alive_interval: Duration::from_millis(1),
        ..Options::default()
    });
    let sender = server.clone();
    tokio::spawn(async move {
        let _ = sender.send_binary(&vec![0u8; 64 * 1024]).await;
    });
    tokio::time::sleep(Duration::from_millis(20)).await;
    let before = alive_tasks();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(
        alive_tasks() <= before + 1,
        "{} tasks after 100 ticks, {before} before",
        alive_tasks()
    );
    server.abort();
}

// A peer that stops reading and sends pongs for guessed counters must not
// answer a ping that was never written: the stuck socket still times out,
// and no ping task piles up behind the stuck send.
#[tokio::test]
async fn guessed_pongs_do_not_answer_an_unwritten_ping() {
    let (server, client) = piped(Options {
        keep_alive_interval: Duration::from_millis(10),
        keep_alive_timeout: Duration::from_millis(400),
        ..Options::default()
    });
    let (_client_read, mut client_write) = tokio::io::split(client);
    let receiver = server.clone();
    let errors = tokio::spawn(async move {
        let mut buf = [0u8; 16];
        loop {
            if let Err(error) = receiver.receive(&mut buf).await {
                return error;
            }
        }
    });
    let sender = server.clone();
    tokio::spawn(async move {
        let _ = sender.send_binary(&vec![0u8; 64 * 1024]).await;
    });
    // Any frame pushes the next ping back, so the peer goes quiet for more
    // than the interval, then answers the ping it guesses was sent.
    tokio::spawn(async move {
        for v in 1u64.. {
            tokio::time::sleep(Duration::from_millis(25)).await;
            if client_write
                .write_all(&frame(0x8a, &v.to_be_bytes()))
                .await
                .is_err()
            {
                return;
            }
        }
    });
    let started = Instant::now();
    tokio::time::sleep(Duration::from_millis(50)).await;
    let before = alive_tasks();
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert!(
        alive_tasks() <= before + 2,
        "{} tasks after 10 guessed pongs, {before} before",
        alive_tasks()
    );
    let error = tokio::time::timeout(Duration::from_secs(2), errors)
        .await
        .expect("socket still open 2s later")
        .unwrap();
    assert_eq!(error, Error::KeepAliveTimeout);
    let elapsed = started.elapsed();
    assert!(
        elapsed >= Duration::from_millis(350),
        "aborted after {elapsed:?}, before the timeout"
    );
}

/// Holds each ping's write open after its bytes went out until the gate
/// opens, so the peer's pong lands before the write returns.
struct GatedPingWriter<W> {
    inner: W,
    gate: Arc<Gate>,
    held: Option<usize>,
}

#[derive(Default)]
struct Gate {
    open: AtomicBool,
    waker: StdMutex<Option<Waker>>,
}

impl Gate {
    fn open(&self) {
        self.open.store(true, Ordering::SeqCst);
        if let Some(waker) = self.waker.lock().unwrap().take() {
            waker.wake();
        }
    }
}

impl<W: AsyncWrite + Unpin> AsyncWrite for GatedPingWriter<W> {
    fn poll_write(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        if let Some(n) = self.held {
            if self.gate.open.load(Ordering::SeqCst) {
                self.held = None;
                return Poll::Ready(Ok(n));
            }
            *self.gate.waker.lock().unwrap() = Some(cx.waker().clone());
            if self.gate.open.load(Ordering::SeqCst) {
                self.held = None;
                return Poll::Ready(Ok(n));
            }
            return Poll::Pending;
        }
        let written = std::pin::Pin::new(&mut self.inner).poll_write(cx, buf);
        if let Poll::Ready(Ok(n)) = written
            && buf.first() == Some(&0x89)
            && !self.gate.open.load(Ordering::SeqCst)
        {
            self.held = Some(n);
            *self.gate.waker.lock().unwrap() = Some(cx.waker().clone());
            return Poll::Pending;
        }
        written
    }

    fn poll_flush(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

// An honest pong can beat the ping's write back: it still answers the ping.
#[tokio::test]
async fn a_pong_that_beats_the_ping_write_still_answers_it() {
    let (server_end, client) = tokio::io::duplex(4096);
    let (read, write) = tokio::io::split(server_end);
    let gate = Arc::new(Gate::default());
    let writer = GatedPingWriter {
        inner: write,
        gate: Arc::clone(&gate),
        held: None,
    };
    let server = Conn::new(
        read,
        writer,
        Vec::new(),
        Options {
            keep_alive_interval: Duration::from_millis(20),
            keep_alive_timeout: Duration::from_millis(150),
            ..Options::default()
        },
    );
    let receiver = server.clone();
    tokio::spawn(async move {
        let mut buf = [0u8; 16];
        while receiver.receive(&mut buf).await.is_ok() {}
    });
    let (mut client_read, mut client_write) = tokio::io::split(client);
    let (_, payload) = server_frame(&mut client_read).await;
    send(&mut client_write, &[frame(0x8a, &payload)]).await;
    // Let receive handle the pong before the ping's write returns.
    tokio::time::sleep(Duration::from_millis(30)).await;
    gate.open();
    tokio::spawn(async move {
        loop {
            let mut head = [0u8; 2];
            if client_read.read_exact(&mut head).await.is_err() {
                return;
            }
            let mut body = vec![0u8; usize::from(head[1] & 0x7f)];
            if client_read.read_exact(&mut body).await.is_err() {
                return;
            }
            if head[0] == 0x89 && client_write.write_all(&frame(0x8a, &body)).await.is_err() {
                return;
            }
        }
    });
    let aborted = tokio::time::timeout(Duration::from_millis(400), server.done()).await;
    assert!(aborted.is_err(), "an answered ping timed out");
    server.abort();
}

/// The 101 the host writes for this sub-protocol, read off the wire.
async fn answer_101(sub_protocol: &'static str) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = blok_http::Server::new(
        move |request: blok_http::Request, response: blok_http::ResponseWriter| async move {
            let options = Options {
                sub_protocol: sub_protocol.into(),
                keep_alive_interval: Duration::ZERO,
                keep_alive_timeout: Duration::ZERO,
            };
            if let Ok(conn) = upgrade(response, &request, options).await {
                tokio::time::sleep(Duration::from_millis(200)).await;
                conn.abort();
            }
        },
        blok_http::Config::default(),
    );
    tokio::spawn(async move { server.serve(listener).await });
    let mut client = TcpStream::connect(address).await.unwrap();
    client
        .write_all(b"GET /sync/doc HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n")
        .await
        .unwrap();
    let mut bytes = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(2), client.read_to_end(&mut bytes)).await;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    match text.split_once("\r\nDate: ") {
        Some((before, after)) => {
            let rest = after.split_once("\r\n").map_or("", |(_, rest)| rest);
            format!("{before}\r\nDate: <date>\r\n{rest}")
        }
        None => text,
    }
}

// Measured on the C# host (raw TCP): Date and Server after Connection, and
// the sub-protocol last.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_101_has_kestrels_bytes() {
    assert_eq!(
        answer_101("").await,
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nDate: <date>\r\nServer: Kestrel\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n"
    );
    assert_eq!(
        answer_101("blok-sync.v2").await,
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nDate: <date>\r\nServer: Kestrel\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\nSec-WebSocket-Protocol: blok-sync.v2\r\n\r\n"
    );
}
