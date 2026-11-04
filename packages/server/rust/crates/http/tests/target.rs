mod common;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_http::{Config, Request, ResponseWriter};
use common::*;

// Measured on the C# host: Kestrel routes every one of these targets, and
// net/http refuses each with its own 400 before any handler runs.
const UNPARSED_TARGETS: [&[u8]; 17] = [
    b"/a%zzb",
    b"/health%",
    b"/health%4",
    b"/health%%41",
    b"/health%C3%",
    b"/sync/d%C3%/state",
    b"/health\x01",
    b"/health\t",
    b"/health\r",
    b"/health\x1f",
    b"/health\x7f",
    b"/health\x00",
    b"/health?x=\x01y",
    b"/health?x=\x7f",
    b"/health?x=\x00",
    b"/a%zzb?x=\x7f",
    b"/%zz/../health",
];

type Seen = Arc<Mutex<Vec<(String, Vec<u8>)>>>;

/// Input, the targets and bodies a handler sees, and the bare refusal that
/// ends the connection, if any.
type StreamCase = (
    String,
    Vec<(&'static str, &'static str)>,
    Option<&'static str>,
);

/// A server that records each request's target and body, and answers with
/// the target.
async fn recording(config: Config) -> (Running, Seen) {
    let seen: Seen = Arc::default();
    let record = Arc::clone(&seen);
    let handler = move |mut request: Request, mut response: ResponseWriter| {
        let record = Arc::clone(&record);
        async move {
            let mut body = Vec::new();
            if let Some(reader) = request.body_mut() {
                let _ = reader.read_to_end(&mut body).await;
            }
            record
                .lock()
                .unwrap()
                .push((request.target().to_owned(), body));
            write_text(&mut response, request.target()).await;
        }
    };
    (start(handler, config).await, seen)
}

/// Writes input in pieces of size, then reads until the close.
async fn stream(server: &Running, input: &[u8], size: usize) -> String {
    let mut conn = connect(server.address).await;
    for piece in input.chunks(size) {
        write(&mut conn, piece).await;
        tokio::task::yield_now().await;
    }
    String::from_utf8_lossy(&read_all(&mut conn, Duration::from_secs(2)).await).into_owned()
}

// Go's stream swapped bytes net/http refuses and restored them before the
// router. blok-http parses Kestrel's grammar itself, so the handler sees
// every one of these targets as sent, and only the NUL ones are refused.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rewrite_swaps_only_what_go_refuses() {
    let (server, seen) = recording(Config::default()).await;
    let targets: [&[u8]; 13] = [
        b"/a%zzb",
        b"/a%%41",
        b"/a%4",
        b"/a%",
        b"/a%C3%",
        b"/a%\x01",
        b"/a\tb\rc\x7f",
        b"/a?%zz\x01%",
        b"/a%zz?b%zz",
        b"/a%41%2F|",
        b"*",
        b"http://h/a%zz",
        b"h:443",
    ];
    for target in targets {
        let method: &[u8] = match target {
            b"*" => b"OPTIONS",
            b"h:443" => b"CONNECT",
            _ => b"GET",
        };
        let host: &[u8] = if target == b"h:443" {
            b"h:443"
        } else if target.starts_with(b"http://") {
            b"h"
        } else {
            b"x"
        };
        let request = [
            method,
            b" ",
            target,
            b" HTTP/1.1\r\nHost: ",
            host,
            b"\r\nConnection: close\r\n\r\n",
        ]
        .concat();
        let answer = raw_answer(server.address, &request).await;
        assert!(
            answer.starts_with("HTTP/1.1 200 OK\r\n"),
            "{}: {answer:?}",
            go_quote(target)
        );
    }
    let got: Vec<String> = seen
        .lock()
        .unwrap()
        .iter()
        .map(|(t, _)| t.clone())
        .collect();
    let want: Vec<String> = targets
        .iter()
        .map(|t| String::from_utf8(t.to_vec()).unwrap())
        .collect();
    assert_eq!(got, want);
}

// FuzzRewrite over its seed corpus: every target the C# host routes reaches
// the handler byte for byte; a NUL gets Kestrel's 400.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fuzz_rewrite() {
    let (server, seen) = recording(Config::default()).await;
    let mut corpus: Vec<&[u8]> = UNPARSED_TARGETS.to_vec();
    corpus.extend([b"/health".as_slice(), b"/a%41?b=%zz"]);
    for target in corpus {
        seen.lock().unwrap().clear();
        let request = [
            b"GET ",
            target,
            b" HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
        ]
        .concat();
        let answer = raw_answer(server.address, &request).await;
        if target.contains(&0) {
            assert!(
                answer.starts_with("HTTP/1.1 400 Bad Request\r\n"),
                "{}: {answer:?}",
                go_quote(target)
            );
            continue;
        }
        let got = seen.lock().unwrap().first().map(|(t, _)| t.clone());
        assert_eq!(
            got.as_deref().map(str::as_bytes),
            Some(target),
            "{}",
            go_quote(target)
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_stream_changes_only_heads() {
    let body = "GET /in-body\x01 HTTP/1.1\r\nHost: x\r\n\r\n";
    // (input, the targets and bodies the handler sees, and whether a bare
    // Kestrel refusal ends the connection).
    let cases: Vec<StreamCase> = vec![
        (
            format!("POST /a%zz HTTP/1.1\r\nHost: x\r\nContent-Length: {}\r\n\r\n{body}GET /b\x01 HTTP/1.1\r\nHost: x\r\n\r\n", body.len()),
            vec![("/a%zz", body), ("/b\x01", "")],
            None,
        ),
        (
            "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\n\r\nz\r\n\r\n\r\nGET /c%zz HTTP/1.1\r\nHost: x\r\n\r\n".into(),
            vec![("/", "z"), ("/c%zz", "")],
            None,
        ),
        (
            "GET / HTTP/1.1\r\nHost: x\r\n\r\n\r\n\nGET /c%zz HTTP/1.1\r\nHost: x\r\n\r\n".into(),
            vec![("/", ""), ("/c%zz", "")],
            None,
        ),
        ("GET / HTTP/1.1\r\nHost: x\r\nX\"y: a\x01b\x7f\r\n\r\n".into(), vec![("/", "")], None),
        // The request after the body has no Host: Kestrel refuses it.
        (
            "POST /a\x01 HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n3\r\n\x01\x01\x01\r\n0\r\n\r\nGET /b\x01 HTTP/1.1\r\n\r\n".into(),
            vec![("/a\x01", "\x01\x01\x01")],
            Some("HTTP/1.1 400 Bad Request\r\n"),
        ),
        (
            "GET /s\x01 HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nGET /b\x01 HTTP/1.1\r\n\r\n".into(),
            vec![("/s\x01", "")],
            Some("HTTP/1.1 400 Bad Request\r\n"),
        ),
        // Measured: Kestrel refuses a final coding that is not chunked.
        (
            "POST /a\x01 HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: gzip\r\n\r\nGET /b\x01 HTTP/1.1\r\n\r\n".into(),
            vec![],
            Some("HTTP/1.1 400 Bad Request\r\n"),
        ),
        ("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n\x00\x00\x12\x04\x00\x01\x01".into(), vec![], Some("\x00\x00\x08\x07")),
        (
            "GET /a\x01 HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\nGET /b\x01 HTTP/1.1\r\n\r\n".into(),
            vec![],
            Some("HTTP/1.1 400 Bad Request\r\n"),
        ),
        // The host refuses bare LF line ends (DisableHttp1LineFeedTerminators).
        (
            "GET /a\rb HTTP/1.1\nHost: x\n\nGET /c%zz HTTP/1.1\r\nHost: x\r\n\r\n".into(),
            vec![],
            Some("HTTP/1.1 400 Bad Request\r\n"),
        ),
    ];
    for (input, want, refusal) in cases {
        for size in [1, 3, 4096] {
            let (server, seen) = recording(timeouts(
                Duration::from_secs(60),
                Duration::from_millis(300),
            ))
            .await;
            let answer = stream(&server, input.as_bytes(), size).await;
            let got: Vec<(String, Vec<u8>)> = seen.lock().unwrap().clone();
            let want: Vec<(String, Vec<u8>)> = want
                .iter()
                .map(|(t, b)| (t.to_string(), b.as_bytes().to_vec()))
                .collect();
            assert_eq!(
                got,
                want,
                "{} (writes of {size})",
                go_quote(input.as_bytes())
            );
            let answers = answer.matches("HTTP/1.1 200 OK\r\n").count();
            assert_eq!(
                answers,
                want.len(),
                "{} (writes of {size}): {answer:?}",
                go_quote(input.as_bytes())
            );
            if let Some(refusal) = refusal {
                assert!(
                    answer.contains(refusal),
                    "{} (writes of {size}): {answer:?}",
                    go_quote(input.as_bytes())
                );
            }
        }
    }
}

// A head over Kestrel's limits never reaches a handler; Kestrel's bare
// answer goes out and the connection closes.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_head_over_the_limits_becomes_the_stand_in() {
    let (server, seen) = recording(Config::default()).await;
    let cases = [
        (
            format!(
                "GET /a HTTP/1.1\r\nHost: x\r\nX: {}\r\n\r\nGET /b HTTP/1.1\r\n\r\n",
                "v".repeat(32 * 1024 + 2)
            ),
            "HTTP/1.1 431 Request Header Fields Too Large\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        ),
        (
            format!("GET /a\x01{} HTTP/1.1\r\n\r\n", "v".repeat(8 * 1024)),
            "HTTP/1.1 414 URI Too Long\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        ),
    ];
    for (input, want) in &cases {
        assert_eq!(
            raw_answer(server.address, input.as_bytes()).await,
            *want,
            "{:.30}",
            input
        );
    }
    let invalid = b"GET /a HTTP/1.1\r\nHost: x\r\nX-A: \xff\r\n\r\n";
    assert_eq!(
        raw_answer(server.address, invalid).await,
        "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    assert!(seen.lock().unwrap().is_empty());
}

// A request line cut by a pause keeps its first half.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_timeout_keeps_a_half_read_line() {
    let (server, seen) = recording(Config::default()).await;
    let mut conn = connect(server.address).await;
    write(&mut conn, b"GET /a").await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    write(
        &mut conn,
        b"%zz HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
    )
    .await;
    let answer =
        String::from_utf8_lossy(&read_all(&mut conn, Duration::from_secs(2)).await).into_owned();
    assert!(answer.ends_with("/a%zz\r\n0\r\n\r\n"), "{answer:?}");
    assert_eq!(seen.lock().unwrap()[0].0, "/a%zz");
}

// Measured on the C# host: a peer that half-closes mid-line gets no answer.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stream_ending_mid_line_hands_over_what_it_has() {
    let (server, seen) = recording(Config::default()).await;
    let mut conn = connect(server.address).await;
    write(&mut conn, b"GET /a\x01 HTTP/1.1").await;
    tokio::io::AsyncWriteExt::shutdown(&mut conn).await.unwrap();
    let answer = read_all(&mut conn, Duration::from_secs(2)).await;
    assert!(answer.is_empty(), "{answer:?}");
    assert!(seen.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_handler_sees_the_target_as_sent_on_a_kept_alive_connection() {
    let server = start(echo_target, Config::default()).await;
    let mut conn = connect(server.address).await;
    write(
        &mut conn,
        b"POST /a%zz?q=%zz\x01 HTTP/1.1\r\nHost: x\r\nContent-Length: 4\r\n\r\n\x01%zz\
          GET /b\x01/../c HTTP/1.1\r\nHost: x\r\n\r\n\
          GET /plain?x=1 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
    )
    .await;
    let answer = read_all(&mut conn, Duration::from_secs(5)).await;
    let got: Vec<String> = responses(&answer)
        .iter()
        .map(|r| format!("{} {}", r.status, String::from_utf8_lossy(&r.body)))
        .collect();
    assert_eq!(
        got,
        [
            r#"200 "/a%zz?q=%zz\x01" "q=%zz\x01" "\x01%zz""#,
            r#"200 "/b\x01/../c" "" """#,
            r#"200 "/plain?x=1" "x=1" """#,
        ]
    );
}

#[test]
#[ignore = "the queue of swapped targets is net/http plumbing; blok-http hands each target over as parsed"]
fn a_target_that_does_not_match_the_queue_is_refused() {}

// The header clock arms on raw bytes, so a request line held back for its
// end still gets the 408.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_held_back_request_line_still_gets408() {
    let server = start(
        echo_target,
        timeouts(Duration::from_millis(200), Duration::from_secs(60)),
    )
    .await;
    let mut conn = connect(server.address).await;
    write(&mut conn, b"GET /a\x01").await;
    let answer =
        String::from_utf8_lossy(&read_all(&mut conn, Duration::from_secs(5)).await).into_owned();
    assert!(
        answer.starts_with("HTTP/1.1 408 Request Timeout\r\n"),
        "{answer:?}"
    );
}

const STREAM_SEEDS: [&[u8]; 6] = [
    b"POST /a%zz HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nG\x01T \r\n\r\nGET /b\x01 HTTP/1.1\r\nHost: x\r\n\r\n",
    b"GET /a HTTP/1.1\r\nHost: x\r\nUpgrade: x\r\n\r\nGET /b\x01 HTTP/1.1\r\n\r\n",
    b"POST /c HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n1\r\n\x01\r\n0\r\n\r\nGET /d%zz HTTP/1.1\r\n\r\n",
    b"GET /e%4 HTTP/1.0\nContent-Length: 2\nX\"\x01: \x7f\n\n%zGET /f\t HTTP/1.1\nHost: x\n\n",
    b"\r\nGET / HTTP/1.1\r\nHost: x\r\nX: \xe9\r\n\r\n",
    b" /% \n",
];

/// The property both fuzz targets check, on their seeds: every target a
/// handler sees is in the input verbatim, in order, and the connection ends
/// in a bare refusal or after its last answer.
async fn check_the_stream_follows_the_input(input: &[u8], pieces: &[&[u8]]) {
    let (server, seen) = recording(timeouts(
        Duration::from_secs(60),
        Duration::from_millis(300),
    ))
    .await;
    let mut conn = connect(server.address).await;
    for piece in pieces {
        write(&mut conn, piece).await;
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    let answer = read_all(&mut conn, Duration::from_secs(3)).await;
    let mut rest = input;
    for (target, _) in seen.lock().unwrap().iter() {
        let at = find(rest, target.as_bytes())
            .unwrap_or_else(|| panic!("{}: {target:?} not in the input", go_quote(input)));
        rest = &rest[at + target.len()..];
    }
    let answers = responses(&answer).len();
    let handled = seen.lock().unwrap().len();
    assert!(
        answers >= handled,
        "{}: {handled} handled, {answers} answers",
        go_quote(input)
    );
}

// FuzzTheStreamFollowsNetHTTP over its seed corpus.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fuzz_the_stream_follows_net_http() {
    for seed in STREAM_SEEDS {
        check_the_stream_follows_the_input(seed, &[seed]).await;
    }
}

// FuzzTheStreamFollowsNetHTTPThroughTimeouts over its seed corpus: the
// input is cut at the seed's points, with a pause after each piece.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fuzz_the_stream_follows_net_http_through_timeouts() {
    let seeds: [(&[u8], &[usize]); 5] = [
        (STREAM_SEEDS[0], &[30, 5, 2]),
        (b"GET /a HTTP/1.1\r\nHost: x\r\n\r\nGET /b%zz HTTP/1.1\r\nHost: x\r\nX: y\r\n\r\n", &[3, 17, 1]),
        (b"POST /c HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\n\r\nz\r\nGET /d%zz HTTP/1.1\r\nHost: x\r\n\r\n", &[40, 1]),
        (b"POST /000 HTTP/0.0\r\nContent-Length:07 \n\r\n0000000\n0 * HTTP/0.0\n\n", &[48, 48]),
        (b"0 * HTTP/0.0\n\n0 * HTTP/0.0\n\n", &[48]),
    ];
    for (input, cuts) in seeds {
        let mut pieces = Vec::new();
        let mut rest = input;
        for &cut in cuts {
            if cut > 0 && cut < rest.len() {
                pieces.push(&rest[..cut]);
                rest = &rest[cut..];
            }
        }
        if !rest.is_empty() {
            pieces.push(rest);
        }
        check_the_stream_follows_the_input(input, &pieces).await;
    }
}

// The next request's line trickles in while a handler runs.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_request_line_that_trickles_in_during_a_handler() {
    let handler = |request: Request, response: ResponseWriter| async move {
        if request.target() == "/slow" {
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
        echo_target(request, response).await;
    };
    let server = start(handler, Config::default()).await;
    let mut conn = connect(server.address).await;
    write(&mut conn, b"GET /slow HTTP/1.1\r\nHost: x\r\n\r\nG").await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    write(&mut conn, b"ET /b%").await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    write(
        &mut conn,
        b"zz\x01 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
    )
    .await;
    let answer =
        String::from_utf8_lossy(&read_all(&mut conn, Duration::from_secs(5)).await).into_owned();
    assert!(
        answer.contains(r#""/slow""#) && answer.contains(r#""/b%zz\x01""#),
        "{answer:?}"
    );
}

// The CR/LF after a POST may come later, and is dropped, not read as a
// request line.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_timeout_after_a_post_still_drops_the_crlf() {
    let post: &[u8] = b"POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\n\r\nz";
    let cases: [(&str, Vec<&[u8]>); 2] = [
        (
            "timeout before the CRLF",
            vec![post, b"\r\nGET /c%zz HTTP/1.1\r\nHost: x\r\n\r\n"],
        ),
        (
            "timeout inside the CRLF",
            vec![post, b"\r", b"\nGET /c%zz HTTP/1.1\r\nHost: x\r\n\r\n"],
        ),
    ];
    for (name, parts) in cases {
        let (server, seen) = recording(timeouts(
            Duration::from_secs(60),
            Duration::from_millis(300),
        ))
        .await;
        let mut conn = connect(server.address).await;
        for part in parts {
            write(&mut conn, part).await;
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let answer = read_all(&mut conn, Duration::from_secs(2)).await;
        let targets: Vec<String> = seen
            .lock()
            .unwrap()
            .iter()
            .map(|(t, _)| t.clone())
            .collect();
        assert_eq!(targets, ["/", "/c%zz"], "{name}");
        assert_eq!(responses(&answer).len(), 2, "{name}");
    }
}

#[test]
#[ignore = "counting allocations needs a GlobalAlloc, which is unsafe; the scan resumes where it stopped (head::tests::a_slow_line_costs_linear_time)"]
fn a_slow_line_does_not_allocate_per_read() {}

// End to end: the CRLF after a POST lands after its answer.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_crlf_after_a_post_on_a_kept_alive_connection() {
    let server = start(echo_target, Config::default()).await;
    let mut conn = connect(server.address).await;
    write(
        &mut conn,
        b"POST /p HTTP/1.1\r\nHost: x\r\nContent-Length: 4\r\n\r\nabcd",
    )
    .await;
    let mut first = Vec::new();
    while responses(&first).is_empty() {
        let mut chunk = [0u8; 4096];
        let n = tokio::time::timeout(
            Duration::from_secs(5),
            tokio::io::AsyncReadExt::read(&mut conn, &mut chunk),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(n > 0, "closed after the POST");
        first.extend_from_slice(&chunk[..n]);
    }
    assert_eq!(responses(&first)[0].status, 200);
    tokio::time::sleep(Duration::from_millis(50)).await;
    write(
        &mut conn,
        b"\r\nGET /ok HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
    )
    .await;
    let rest = read_all(&mut conn, Duration::from_secs(5)).await;
    let second = responses(&rest);
    assert_eq!(second.len(), 1, "{:?}", String::from_utf8_lossy(&rest));
    assert!(String::from_utf8_lossy(&second[0].body).contains(r#""/ok""#));
}
