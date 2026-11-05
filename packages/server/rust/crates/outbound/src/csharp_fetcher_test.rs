use std::io::Write;
use std::sync::Arc;
use std::time::Duration;

use flate2::Compression;
use flate2::write::{GzEncoder, ZlibEncoder};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::oneshot;

use crate::fetcher::Fetcher;
use crate::origin_test::*;
use crate::pki_test::{Pki, acceptor, pki};
use crate::policy::{DefaultPolicy, Failure};

// Twins of the GuardedOutboundFetcherTests cases with no Go twin. Caller
// cancellation is a dropped future here, so those cases check what a drop
// must do: close the socket and free the slot.

fn gzip(data: &[u8]) -> Vec<u8> {
    let mut e = GzEncoder::new(Vec::new(), Compression::best());
    e.write_all(data).unwrap();
    e.finish().unwrap()
}

fn plain(status: &str, headers: &str, body: &[u8]) -> Vec<u8> {
    [
        format!("HTTP/1.1 {status}\r\n{headers}Connection: close\r\n\r\n").into_bytes(),
        body.to_vec(),
    ]
    .concat()
}

fn with_length(status: &str, headers: &str, body: &[u8]) -> Vec<u8> {
    plain(
        status,
        &format!("{headers}Content-Length: {}\r\n", body.len()),
        body,
    )
}

async fn origin(handler: Handler) -> Origin {
    Origin::start("127.0.0.1:0", None, handler).await.unwrap()
}

#[tokio::test]
async fn bounds_and_redacts_dns_and_transport_errors() {
    let mut f = Fetcher::new(Arc::new(DefaultPolicy));
    f.resolve = Arc::new(|_| Box::pin(async { Err(std::io::Error::other("x".repeat(10_000))) }));
    let error = f
        .get(
            "http://failure.example/private-path?secret=value",
            &limits(),
        )
        .await
        .err()
        .unwrap();
    assert_eq!(error.failure, Failure::Blocked);
    let message = error.to_string();
    assert!(message.len() <= 128);
    assert!(!message.contains("failure.example"));
    assert!(!message.contains('x'));
    assert!(std::error::Error::source(&error).is_none());
}

/// Fetches the issuer certificate for the AIA cases, counting requests.
async fn chain_case(send_middle: bool) -> (Result<crate::Response, crate::Error>, usize) {
    let (origin, issuer, roots) = crate::tls_test::aia_setup(send_middle).await;
    let mut f = fixture_fetcher("aia.example", origin.port);
    f.roots = Some(roots);
    let got = f
        .get(&format!("https://aia.example:{}/", origin.port), &limits())
        .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    (got, issuer.count())
}

#[tokio::test]
async fn default_tls_validation_does_not_download_a_missing_issuer() {
    let (got, asked) = chain_case(false).await;
    assert_eq!(failure(got), Some(Failure::Blocked));
    assert_eq!(asked, 0);
}

#[tokio::test]
async fn accepts_a_complete_server_chain_with_a_custom_root() {
    let (got, asked) = chain_case(true).await;
    assert_eq!(got.unwrap().body, b"ok");
    assert_eq!(asked, 0);
}

#[tokio::test]
async fn returns_the_final_non_success_status_for_the_consumer_to_refuse() {
    let o = origin(answer(|_, _| {
        with_length("503 Service Unavailable", "", b"error")
    }))
    .await;
    let f = fixture_fetcher("status.example", o.port);
    let response = f
        .get(
            &format!("http://status.example:{}/error", o.port),
            &limits(),
        )
        .await
        .unwrap();
    assert_eq!(response.status_code, 503);
    assert_eq!(response.body, b"error");
}

fn start_then_final(status: u16, body: &'static [u8]) -> Handler {
    answer(move |seen, _| {
        if seen.target == "/start" {
            with_length(&format!("{status} Redirect"), "Location: /final\r\n", b"")
        } else {
            with_length("200 OK", "", body)
        }
    })
}

#[tokio::test]
async fn follows_a_relative_redirect_by_get_and_revalidates_the_hop() {
    let o = origin(start_then_final(302, b"arrived")).await;
    let resolver = counting(vec![addrs(&["127.0.0.1"]), addrs(&["127.0.0.1"])]);
    let f = fetcher(
        FixturePolicy::new("redirect.example", o.port, addrs(&["127.0.0.1"])),
        &resolver,
    );
    let response = f
        .get(
            &format!("http://redirect.example:{}/start", o.port),
            &limits_of(2000, 1024, 1),
        )
        .await
        .unwrap();
    assert_eq!(response.body, b"arrived");
    assert_eq!(
        response.final_url,
        format!("http://redirect.example:{}/final", o.port)
    );
    assert_eq!(resolver.calls.load(std::sync::atomic::Ordering::SeqCst), 2);
    let seen = o.seen.lock().unwrap().clone();
    assert_eq!(seen.len(), 2);
    for request in seen {
        assert_eq!(request.method, "GET");
        assert!(request.header("Authorization").is_none());
    }
}

#[tokio::test]
async fn keeps_get_semantics_for_every_redirect_status() {
    for status in [301, 302, 303, 307, 308] {
        let o = origin(start_then_final(status, b"ok")).await;
        let f = fixture_fetcher("method.example", o.port);
        let response = f
            .get(
                &format!("http://method.example:{}/start", o.port),
                &limits_of(2000, 1024, 1),
            )
            .await
            .unwrap();
        assert_eq!(response.body, b"ok", "{status}");
        let seen = o.seen.lock().unwrap().clone();
        assert_eq!(seen.len(), 2, "{status}");
        assert!(seen.iter().all(|r| r.method == "GET"), "{status}");
    }
}

#[tokio::test]
async fn follows_exactly_the_configured_redirect_cap() {
    let o = origin(answer(|seen, _| {
        let hop: usize = seen.target.trim_start_matches('/').parse().unwrap();
        if hop == 2 {
            with_length("200 OK", "", b"ok")
        } else {
            with_length("302 Found", &format!("Location: /{}\r\n", hop + 1), b"")
        }
    }))
    .await;
    let resolver = counting(vec![addrs(&["127.0.0.1"])]);
    let f = fetcher(
        FixturePolicy::new("cap.example", o.port, addrs(&["127.0.0.1"])),
        &resolver,
    );
    let response = f
        .get(
            &format!("http://cap.example:{}/0", o.port),
            &limits_of(2000, 1024, 2),
        )
        .await
        .unwrap();
    assert_eq!(response.body, b"ok");
    assert_eq!(o.count(), 3);
    assert_eq!(resolver.calls.load(std::sync::atomic::Ordering::SeqCst), 3);
}

#[tokio::test]
async fn rejects_credentials_introduced_by_a_redirect() {
    let o = origin(answer(|seen, _| {
        let host = seen.header("Host").unwrap_or_default().to_owned();
        with_length(
            "302 Found",
            &format!("Location: http://user:secret@{host}/private\r\n"),
            b"",
        )
    }))
    .await;
    let resolver = counting(vec![addrs(&["127.0.0.1"])]);
    let f = fetcher(
        FixturePolicy::new("redirect.example", o.port, addrs(&["127.0.0.1"])),
        &resolver,
    );
    let got = f
        .get(
            &format!("http://redirect.example:{}/start", o.port),
            &limits(),
        )
        .await;
    assert_eq!(failure(got), Some(Failure::Blocked));
    assert_eq!(o.count(), 1);
    assert_eq!(resolver.calls.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[tokio::test]
async fn rejects_a_blocked_address_introduced_by_a_redirect() {
    let o = origin(answer(|seen, _| {
        let port = seen
            .header("Host")
            .unwrap()
            .rsplit(':')
            .next()
            .unwrap()
            .to_owned();
        with_length(
            "302 Found",
            &format!("Location: http://private.example:{port}/private\r\n"),
            b"",
        )
    }))
    .await;
    let resolver = counting(vec![addrs(&["127.0.0.1"]), addrs(&["127.0.0.2"])]);
    let f = fetcher(
        FixturePolicy {
            hosts: vec!["source.example".into(), "private.example".into()],
            ports: vec![o.port],
            allowed: addrs(&["127.0.0.1"]),
        },
        &resolver,
    );
    let got = f
        .get(
            &format!("http://source.example:{}/start", o.port),
            &limits(),
        )
        .await;
    assert_eq!(failure(got), Some(Failure::Blocked));
    assert_eq!(o.count(), 1);
    assert_eq!(resolver.calls.load(std::sync::atomic::Ordering::SeqCst), 2);
}

#[tokio::test]
async fn keeps_a_body_exactly_at_the_configured_cap() {
    let o = origin(answer(|_, _| plain("200 OK", "", b"1234"))).await;
    let f = fixture_fetcher("size.example", o.port);
    let response = f
        .get(
            &format!("http://size.example:{}/exact", o.port),
            &limits_of(2000, 4, 0),
        )
        .await
        .unwrap();
    assert_eq!(response.body, b"1234");
}

#[tokio::test]
async fn stops_after_one_byte_beyond_the_configured_body_cap() {
    let o = origin(answer(|_, _| plain("200 OK", "", b"12345"))).await;
    let f = fixture_fetcher("size.example", o.port);
    let got = f
        .get(
            &format!("http://size.example:{}/oversized", o.port),
            &limits_of(2000, 4, 0),
        )
        .await;
    assert_eq!(failure(got), Some(Failure::TooLarge));
}

/// A chunked body that keeps coming, one byte every `every`, `count` times.
fn trickle(every: Duration, count: usize) -> Handler {
    handler(move |_, _, mut conn| async move {
        let _ = conn
            .write_all(
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
            )
            .await;
        for _ in 0..count {
            if conn.write_all(b"1\r\nx\r\n").await.is_err() || conn.flush().await.is_err() {
                return;
            }
            tokio::time::sleep(every).await;
        }
        let _ = conn.write_all(b"0\r\n\r\n").await;
    })
}

#[tokio::test]
async fn total_deadline_stops_a_response_that_keeps_making_progress() {
    let o = origin(trickle(Duration::from_millis(10), 20)).await;
    let f = fixture_fetcher("deadline.example", o.port);
    let got = f
        .get(
            &format!("http://deadline.example:{}/progress", o.port),
            &limits_of(50, 1024, 0),
        )
        .await;
    assert_eq!(failure(got), Some(Failure::TimedOut));
}

/// Writes a chunked head and `chunk` until the client hangs up, then says so.
fn hang_up_probe(chunk: &'static [u8], once: bool) -> (Handler, oneshot::Receiver<()>) {
    let (tx, rx) = oneshot::channel();
    let tx = Arc::new(std::sync::Mutex::new(Some(tx)));
    let h = handler(move |_, _, conn| {
        let tx = tx.clone();
        async move {
            let (mut reader, mut writer) = tokio::io::split(conn);
            let _ = writer
                .write_all(
                    b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
                )
                .await;
            let probe = tokio::spawn(async move {
                let mut byte = [0u8; 1];
                let _ = reader.read(&mut byte).await;
            });
            loop {
                if writer.write_all(chunk).await.is_err() || writer.flush().await.is_err() || once {
                    break;
                }
                if probe.is_finished() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            let _ = probe.await;
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(());
            }
        }
    });
    (h, rx)
}

async fn tls_fixture(name: &str, handler: Handler) -> (Origin, Fetcher, Pki) {
    let pki = pki(name, |_| {});
    let o = Origin::start(
        "127.0.0.1:0",
        Some(acceptor(pki.chain.clone(), pki.key.clone_key(), &[])),
        handler,
    )
    .await
    .unwrap();
    let mut f = fixture_fetcher(name, o.port);
    f.roots = Some(pki.roots.clone());
    (o, f, pki)
}

#[tokio::test]
async fn tls_deadline_stops_a_response_and_disposes_the_connection() {
    let (h, hung_up) = hang_up_probe(b"1\r\nx\r\n", false);
    let (o, f, _pki) = tls_fixture("deadline-tls.example", h).await;
    let got = f
        .get(
            &format!("https://deadline-tls.example:{}/", o.port),
            &limits_of(2000, 1024, 0),
        )
        .await;
    assert_eq!(failure(got), Some(Failure::TimedOut));
    tokio::time::timeout(Duration::from_secs(2), hung_up)
        .await
        .expect("the origin never saw the connection close")
        .unwrap();
}

#[tokio::test]
async fn total_deadline_spans_the_whole_redirect_chain() {
    let o = origin(handler(|seen, _, mut conn| async move {
        let start = seen.target == "/start";
        tokio::time::sleep(Duration::from_millis(if start { 1500 } else { 3000 })).await;
        let response = if start {
            with_length("302 Found", "Location: /final\r\n", b"")
        } else {
            with_length("200 OK", "", b"ok")
        };
        let _ = conn.write_all(&response).await;
    }))
    .await;
    let f = fixture_fetcher("deadline.example", o.port);
    let got = f
        .get(
            &format!("http://deadline.example:{}/start", o.port),
            &limits_of(4000, 1024, 1),
        )
        .await;
    assert_eq!(failure(got), Some(Failure::TimedOut));
    assert_eq!(o.count(), 2);
}

// A Duration cannot be negative, so only the zero row ports.
#[tokio::test]
async fn non_positive_deadline_fails_closed_before_dns() {
    let o = ok_origin("127.0.0.1:0").await.unwrap();
    let resolver = counting(vec![addrs(&["127.0.0.1"])]);
    let f = fetcher(
        FixturePolicy::new("deadline.example", o.port, addrs(&["127.0.0.1"])),
        &resolver,
    );
    let got = f
        .get(
            &format!("http://deadline.example:{}/", o.port),
            &limits_of(0, 1024, 0),
        )
        .await;
    assert_eq!(failure(got), Some(Failure::TimedOut));
    assert_eq!(resolver.calls.load(std::sync::atomic::Ordering::SeqCst), 0);
    assert_eq!(o.count(), 0);
}

#[tokio::test]
async fn total_deadline_includes_dns_resolution() {
    let o = ok_origin("127.0.0.1:0").await.unwrap();
    let resolver = counting_with_delay(vec![addrs(&["127.0.0.1"])], Duration::from_millis(150));
    let f = fetcher(
        FixturePolicy::new("slow-dns.example", o.port, addrs(&["127.0.0.1"])),
        &resolver,
    );
    let got = f
        .get(
            &format!("http://slow-dns.example:{}/", o.port),
            &limits_of(30, 1024, 0),
        )
        .await;
    assert_eq!(failure(got), Some(Failure::TimedOut));
    assert_eq!(o.count(), 0);
}

#[tokio::test]
async fn honors_caller_cancellation_before_starting() {
    let o = ok_origin("127.0.0.1:0").await.unwrap();
    let f = fixture_fetcher("cancel.example", o.port);
    let url = format!("http://cancel.example:{}/", o.port);
    drop(f.get(&url, &limits()));
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(o.count(), 0);
}

/// Cancels a streaming fetch by dropping it, then checks the origin saw the
/// hang-up and all four slots are free again.
async fn cancel_mid_body(
    o: &Origin,
    f: &Fetcher,
    url: &str,
    after: Duration,
    hung_up: oneshot::Receiver<()>,
) {
    assert!(
        tokio::time::timeout(after, f.get(url, &limits()))
            .await
            .is_err()
    );
    tokio::time::timeout(Duration::from_secs(2), hung_up)
        .await
        .expect("the origin never saw the connection close")
        .unwrap();
    assert_eq!(f.permits_available(), 4);
    assert_eq!(o.count(), 1);
}

#[tokio::test]
async fn honors_caller_cancellation_while_streaming_the_body() {
    let (h, hung_up) = hang_up_probe(b"1\r\nx\r\n", false);
    let o = origin(h).await;
    let f = fixture_fetcher("cancel.example", o.port);
    let url = format!("http://cancel.example:{}/progress", o.port);
    cancel_mid_body(&o, &f, &url, Duration::from_millis(40), hung_up).await;
}

#[tokio::test]
async fn tls_streaming_preserves_caller_cancellation() {
    let (h, hung_up) = hang_up_probe(b"1\r\nx\r\n", false);
    let (o, f, _pki) = tls_fixture("cancel-tls.example", h).await;
    let url = format!("https://cancel-tls.example:{}/", o.port);
    cancel_mid_body(&o, &f, &url, Duration::from_millis(75), hung_up).await;
}

fn encoded(encoding: &'static str, body: Vec<u8>) -> Handler {
    answer(move |_, _| {
        with_length(
            "200 OK",
            &format!("Content-Encoding: {encoding}\r\n"),
            &body,
        )
    })
}

#[tokio::test]
async fn applies_the_body_cap_after_gzip_decompression() {
    let compressed = gzip(&[b'x'; 1024]);
    assert!(compressed.len() < 64);
    let o = origin(encoded("gzip", compressed)).await;
    let f = fixture_fetcher("gzip.example", o.port);
    let got = f
        .get(
            &format!("http://gzip.example:{}/large.gz", o.port),
            &limits_of(2000, 64, 0),
        )
        .await;
    assert_eq!(failure(got), Some(Failure::TooLarge));
}

#[tokio::test]
async fn decodes_supported_content_encoding() {
    let body = b"decoded body".to_vec();
    let mut brotli_body = Vec::new();
    {
        let mut w = brotli::CompressorWriter::new(&mut brotli_body, 4096, 11, 22);
        w.write_all(&body).unwrap();
    }
    let mut z = ZlibEncoder::new(Vec::new(), Compression::default());
    z.write_all(&body).unwrap();
    for (encoding, compressed) in [("br", brotli_body), ("deflate", z.finish().unwrap())] {
        let o = origin(encoded(encoding, compressed)).await;
        let f = fixture_fetcher("encoded.example", o.port);
        let response = f
            .get(
                &format!("http://encoded.example:{}/body", o.port),
                &limits(),
            )
            .await
            .unwrap();
        assert_eq!(response.body, body, "{encoding}");
    }
}

#[tokio::test]
async fn rejects_unsupported_content_encoding() {
    for encoding in ["compress", "gzip, br"] {
        let o = origin(encoded(encoding, b"x".to_vec())).await;
        let f = fixture_fetcher("encoded.example", o.port);
        let got = f
            .get(
                &format!("http://encoded.example:{}/body", o.port),
                &limits(),
            )
            .await;
        assert_eq!(
            failure(got),
            Some(Failure::UnsupportedContentEncoding),
            "{encoding}"
        );
    }
}

#[tokio::test]
async fn accepts_gzip_whose_raw_body_exactly_matches_the_cap() {
    let compressed = gzip(b"x");
    let cap = compressed.len() as u64;
    let o = origin(encoded("gzip", compressed)).await;
    let f = fixture_fetcher("raw-exact.example", o.port);
    let response = f
        .get(
            &format!("http://raw-exact.example:{}/exact.gz", o.port),
            &limits_of(2000, cap, 0),
        )
        .await
        .unwrap();
    assert_eq!(response.body, b"x");
}

#[tokio::test]
async fn accepts_gzip_whose_decoded_body_exactly_matches_the_cap() {
    let body = vec![b'x'; 64];
    let compressed = gzip(&body);
    assert!(compressed.len() < body.len());
    let o = origin(encoded("gzip", compressed)).await;
    let f = fixture_fetcher("decoded-exact.example", o.port);
    let response = f
        .get(
            &format!("http://decoded-exact.example:{}/exact.gz", o.port),
            &limits_of(2000, 64, 0),
        )
        .await
        .unwrap();
    assert_eq!(response.body, body);
}

fn members() -> Vec<u8> {
    let members: Vec<u8> = (0..100).flat_map(|_| gzip(b"x")).collect();
    assert!(members.len() > 128);
    members
}

#[tokio::test]
async fn rejects_concatenated_gzip_when_raw_bytes_exceed_the_cap() {
    let o = origin(encoded("gzip", members())).await;
    let f = fixture_fetcher("raw-gzip.example", o.port);
    let got = f
        .get(
            &format!("http://raw-gzip.example:{}/members.gz", o.port),
            &limits_of(2000, 128, 0),
        )
        .await;
    assert_eq!(failure(got), Some(Failure::TooLarge));
}

#[tokio::test]
async fn rejects_chunked_gzip_when_raw_bytes_exceed_the_cap() {
    let compressed = members();
    let o = origin(answer(move |_, _| {
        [
            format!(
                "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:X}\r\n",
                compressed.len()
            )
            .into_bytes(),
            compressed.clone(),
            b"\r\n0\r\n\r\n".to_vec(),
        ]
        .concat()
    }))
    .await;
    let f = fixture_fetcher("chunked-gzip.example", o.port);
    let got = f
        .get(
            &format!("http://chunked-gzip.example:{}/members.gz", o.port),
            &limits_of(2000, 128, 0),
        )
        .await;
    assert_eq!(failure(got), Some(Failure::TooLarge));
}

#[tokio::test]
async fn disposes_the_response_connection_after_the_size_limit_trips() {
    let (h, hung_up) = hang_up_probe(b"5\r\nxxxxx\r\n", true);
    let o = origin(h).await;
    let f = fixture_fetcher("dispose.example", o.port);
    let got = tokio::time::timeout(
        Duration::from_secs(2),
        f.get(
            &format!("http://dispose.example:{}/oversized", o.port),
            &limits_of(5000, 4, 0),
        ),
    )
    .await
    .unwrap();
    assert_eq!(failure(got), Some(Failure::TooLarge));
    tokio::time::timeout(Duration::from_secs(2), hung_up)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn tls_size_limit_disposes_the_connection() {
    let (h, hung_up) = hang_up_probe(b"5\r\nxxxxx\r\n", true);
    let (o, f, _pki) = tls_fixture("dispose-tls.example", h).await;
    let got = tokio::time::timeout(
        Duration::from_secs(2),
        f.get(
            &format!("https://dispose-tls.example:{}/", o.port),
            &limits_of(5000, 4, 0),
        ),
    )
    .await
    .unwrap();
    assert_eq!(failure(got), Some(Failure::TooLarge));
    tokio::time::timeout(Duration::from_secs(2), hung_up)
        .await
        .unwrap()
        .unwrap();
}

// C# ValidateLimits throws ArgumentOutOfRangeException before it resolves.
// A usize cannot be negative, so only the byte cap ceiling is left.
#[tokio::test]
async fn refuses_limits_outside_the_supported_range_before_fetching() {
    let mut f = Fetcher::new(Arc::new(DefaultPolicy));
    f.resolve = Arc::new(|_| panic!("resolved before refusing"));
    let mut over = limits();
    over.max_bytes = 0x7FFF_FFC8;
    let error = f
        .get("http://limits.example/", &over)
        .await
        .err()
        .expect("refused");
    assert_eq!(error.failure, Failure::LimitOutOfRange);
    assert_eq!(
        error.to_string(),
        "The response byte limit is outside the supported range."
    );
    over.max_bytes = 0x7FFF_FFC7;
    over.timeout = Duration::ZERO;
    assert_eq!(
        f.get("http://limits.example/", &over)
            .await
            .err()
            .map(|e| e.failure),
        Some(Failure::TimedOut)
    );
}
