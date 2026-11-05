use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use blok_dotnet::parse_ip;
use flate2::Compression;
use flate2::write::GzEncoder;

use crate::fetcher::{Limits, host_header};
use crate::origin_test::*;
use crate::policy::{DefaultPolicy, Failure, Target, resolve};

// Hand ports of GuardedOutboundFetcherTests that need a resolver or a dial
// seam, which no black-box fixture can reach.

#[tokio::test]
async fn rejects_the_whole_dns_answer_when_any_candidate_is_blocked() {
    let resolver = counting(vec![addrs(&["93.184.216.34", "127.0.0.1"])]);
    let mut f = fetcher(DefaultPolicy, &resolver);
    let dialed = dial_log(&mut f);
    let got = f.get("http://mixed.example/", &limits()).await;
    assert_eq!(failure(got), Some(Failure::Blocked));
    assert_eq!(resolver.calls.load(Ordering::SeqCst), 1);
    assert!(dialed.lock().unwrap().is_empty(), "dialed a blocked answer");
}

#[tokio::test]
async fn rejects_site_local_dns_answers_before_opening_a_socket() {
    for mixed in [false, true] {
        let (answer, want) = if mixed {
            (addrs(&["93.184.216.34", "fec0::1"]), vec![true, false])
        } else {
            (addrs(&["fec0::1"]), vec![false])
        };
        let resolver = counting(vec![answer]);
        let policy = Arc::new(RecordingPolicy::default());
        let mut f = fetcher(AnyAddress, &resolver);
        f.policy = policy.clone();
        let dialed = dial_log(&mut f);
        let got = f.get("http://site-local.example/", &limits()).await;
        assert_eq!(failure(got), Some(Failure::Blocked), "mixed={mixed}");
        assert_eq!(*policy.decisions.lock().unwrap(), want, "mixed={mixed}");
        assert!(dialed.lock().unwrap().is_empty(), "opened a socket");
    }
}

#[tokio::test]
async fn never_resolves_a_url_with_a_raw_control_character() {
    for raw in [
        "\0http://example.com/",
        "http://example.com/\0",
        "\u{85}http://example.com/",
    ] {
        let resolver = counting(vec![addrs(&["93.184.216.34"])]);
        let mut f = fetcher(DefaultPolicy, &resolver);
        let dialed = dial_log(&mut f);
        assert_eq!(
            failure(f.get(raw, &limits()).await),
            Some(Failure::Blocked),
            "{raw:?}"
        );
        assert_eq!(resolver.calls.load(Ordering::SeqCst), 0, "{raw:?}");
        assert!(dialed.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn an_empty_dns_answer_is_blocked() {
    let resolver = counting(vec![vec![]]);
    let mut f = fetcher(DefaultPolicy, &resolver);
    let dialed = dial_log(&mut f);
    let got = f.get("http://empty.example/", &limits()).await;
    assert_eq!(failure(got), Some(Failure::Blocked));
    assert!(dialed.lock().unwrap().is_empty());
}

#[tokio::test]
async fn resolves_once_and_connects_to_the_exact_first_validated_address() {
    let o = ok_origin("127.0.0.1:0").await.unwrap();
    let resolver = counting(vec![
        addrs(&["127.0.0.1", "127.0.0.2"]),
        addrs(&["127.0.0.2"]),
    ]);
    let mut f = fetcher(
        FixturePolicy::new("pinned.example", o.port, addrs(&["127.0.0.1", "127.0.0.2"])),
        &resolver,
    );
    let dialed = dial_log(&mut f);
    let url = format!("http://pinned.example:{}/exact", o.port);
    let response = f.get(&url, &limits()).await.unwrap();
    assert_eq!(resolver.calls.load(Ordering::SeqCst), 1);
    assert_eq!(response.body, b"ok");
    assert_eq!(response.content_type, "text/plain; charset=utf-8");
    assert_eq!(response.status_code, 200);
    assert_eq!(response.final_url, url);
    let seen = o.last().unwrap();
    assert_eq!(
        seen.header("Host"),
        Some(format!("pinned.example:{}", o.port).as_str())
    );
    assert_eq!(seen.target, "/exact");
    // pinned.example has no real DNS, so reaching the origin at all proves
    // the dial used the vetted address; one dial means no second attempt.
    assert_eq!(dialed.lock().unwrap().len(), 1);
}

// .NET's HttpClient refuses these names, so neither server sends them.
#[tokio::test]
async fn never_sends_a_host_whose_idn_form_is_not_a_plain_name() {
    for host in [
        "a\u{ff05}\u{ff43}\u{ff13}\u{ff05}\u{ff42}\u{ff43}b.com",
        "a\u{2474}.com",
    ] {
        let o = ok_origin("127.0.0.1:0").await.unwrap();
        let url = format!("http://{host}:{}/exact", o.port);
        let parsed = resolve(&url, None).expect("parses");
        let f = fetcher(
            FixturePolicy::new(&parsed.host, o.port, addrs(&["127.0.0.1"])),
            &counting(vec![addrs(&["127.0.0.1"])]),
        );
        assert_eq!(
            failure(f.get(&url, &limits()).await),
            Some(Failure::Blocked),
            "{host}"
        );
        assert_eq!(o.count(), 0, "{host}");
    }
}

#[tokio::test]
async fn connects_to_the_next_validated_address_when_the_first_is_unavailable() {
    let o = ok_origin("127.0.0.1:0").await.unwrap();
    let resolver = counting(vec![addrs(&["127.0.0.2", "127.0.0.1"])]);
    let f = fetcher(
        FixturePolicy::new(
            "fallback.example",
            o.port,
            addrs(&["127.0.0.2", "127.0.0.1"]),
        ),
        &resolver,
    );
    let url = format!("http://fallback.example:{}/fallback", o.port);
    let response = f.get(&url, &limits()).await.unwrap();
    assert_eq!(resolver.calls.load(Ordering::SeqCst), 1);
    assert_eq!(response.body, b"ok");
    assert_eq!(o.last().unwrap().target, "/fallback");
}

#[tokio::test]
async fn pins_an_ipv6_literal_without_resolving_it_again() {
    let Some(o) = ok_origin("[::1]:0").await else {
        return;
    };
    let resolver = counting(vec![addrs(&["::1"])]);
    let f = fetcher(
        LiteralPolicy {
            port: o.port,
            literal: "::1".parse().unwrap(),
        },
        &resolver,
    );
    let response = f
        .get(&format!("http://[::1]:{}/literal", o.port), &limits())
        .await
        .unwrap();
    assert_eq!(response.body, b"ok");
    assert_eq!(resolver.calls.load(Ordering::SeqCst), 0);
    assert_eq!(o.last().unwrap().target, "/literal");
}

#[tokio::test]
async fn connects_to_the_exact_validated_ipv6_candidate() {
    let Some(o) = ok_origin("[::1]:0").await else {
        return;
    };
    let resolver = counting(vec![addrs(&["::1", "::2"])]);
    let f = fetcher(
        FixturePolicy::new("ipv6-pinned.example", o.port, addrs(&["::1", "::2"])),
        &resolver,
    );
    let response = f
        .get(
            &format!("http://ipv6-pinned.example:{}/ipv6", o.port),
            &limits(),
        )
        .await
        .unwrap();
    assert_eq!(response.body, b"ok");
    assert_eq!(resolver.calls.load(Ordering::SeqCst), 1);
    assert_eq!(o.last().unwrap().target, "/ipv6");
}

// A slot stays taken until the caller releases the response, not just
// until the body is read.
#[tokio::test]
async fn holds_four_responses_until_one_is_released() {
    let o = ok_origin("127.0.0.1:0").await.unwrap();
    let f = fixture_fetcher("bounded.example", o.port);
    let url = format!("http://bounded.example:{}/", o.port);
    let mut held = Vec::new();
    for _ in 0..4 {
        held.push(f.get(&url, &limits()).await.unwrap());
    }
    let (f2, url2) = (f.clone(), url.clone());
    let fifth = tokio::spawn(async move { f2.get(&url2, &limits()).await.map(|_| ()) });
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        !fifth.is_finished(),
        "a fifth fetch ran while four were held"
    );
    held[0].release();
    tokio::time::timeout(Duration::from_secs(5), fifth)
        .await
        .expect("the fifth fetch never ran after a release")
        .unwrap()
        .unwrap();
}

// Four held uploads fill only the upload pool: a short check still runs at
// once, and a fifth upload waits.
#[tokio::test]
async fn held_uploads_never_take_a_check_slot() {
    let o = ok_origin("127.0.0.1:0").await.unwrap();
    let f = fixture_fetcher("bounded.example", o.port);
    let url = format!("http://bounded.example:{}/", o.port);
    let upload = Limits {
        upload: true,
        caller: String::new(),
        ..limits()
    };
    let mut held = Vec::new();
    for _ in 0..4 {
        held.push(f.get(&url, &upload).await.unwrap());
    }
    let check = Limits {
        timeout: Duration::from_millis(300),
        ..limits()
    };
    let checked = f.get(&url, &check).await;
    assert!(
        checked.is_ok(),
        "a check waited behind four uploads: {:?}",
        checked.err()
    );
    let fifth = Limits {
        timeout: Duration::from_millis(300),
        ..upload
    };
    assert!(
        f.get(&url, &fifth).await.is_err(),
        "a fifth upload ran while four were held"
    );
    drop(held);
}

// One caller holds at most two slots of a pool. Its third fetch waits for
// one of its own, inside its own deadline, and never holds a pool slot while
// it waits: other callers still get the two free slots.
#[tokio::test]
async fn a_callers_third_fetch_waits_for_its_own_slot() {
    let o = ok_origin("127.0.0.1:0").await.unwrap();
    let f = fixture_fetcher("bounded.example", o.port);
    let url = format!("http://bounded.example:{}/", o.port);
    let caller = Limits {
        caller: "addr:192.0.2.1".into(),
        ..limits()
    };
    let short = Limits {
        timeout: Duration::from_millis(300),
        ..caller.clone()
    };
    let mut held = [
        f.get(&url, &caller).await.unwrap(),
        f.get(&url, &caller).await.unwrap(),
    ];
    let timed_out = f.get(&url, &short).await;
    assert!(
        matches!(&timed_out, Err(e) if e.failure == Failure::TimedOut),
        "a third fetch from one caller got {:?}",
        timed_out.as_ref().err()
    );
    let (f2, url2, caller2) = (f.clone(), url.clone(), caller.clone());
    let third = tokio::spawn(async move { f2.get(&url2, &caller2).await.map(|_| ()) });
    tokio::time::sleep(Duration::from_millis(100)).await;
    let mut others = Vec::new();
    for other in ["addr:192.0.2.2", "addr:192.0.2.3"] {
        let limits = Limits {
            caller: other.into(),
            ..short.clone()
        };
        let got = f.get(&url, &limits).await;
        assert!(got.is_ok(), "{other} waited behind one caller's queue");
        others.push(got);
    }
    assert!(
        !third.is_finished(),
        "the third fetch ran while its caller held two"
    );
    held[0].release();
    tokio::time::timeout(Duration::from_secs(5), third)
        .await
        .expect("the third fetch never ran after its caller freed a slot")
        .unwrap()
        .unwrap();
}

fn redirect_forever() -> Handler {
    answer(|_, count| {
        format!("HTTP/1.1 302 Found\r\nLocation: /{count}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .into_bytes()
    })
}

#[tokio::test]
async fn rejects_the_redirect_after_the_configured_cap() {
    let o = Origin::start("127.0.0.1:0", None, redirect_forever())
        .await
        .unwrap();
    let resolver = counting(vec![addrs(&["127.0.0.1"])]);
    let f = fetcher(
        FixturePolicy::new("cap.example", o.port, addrs(&["127.0.0.1"])),
        &resolver,
    );
    let got = f
        .get(
            &format!("http://cap.example:{}/0", o.port),
            &limits_of(2000, 1024, 2),
        )
        .await;
    assert_eq!(failure(got), Some(Failure::TooManyRedirects));
    assert_eq!(o.count(), 3);
    assert_eq!(resolver.calls.load(Ordering::SeqCst), 3);
}

// .NET opens an IPv6 socket for a mapped address, and it never connects.
#[tokio::test]
async fn an_ipv4_mapped_literal_never_connects() {
    let o = ok_origin("127.0.0.1:0").await.unwrap();
    let resolver = counting(vec![addrs(&["::ffff:127.0.0.1"])]);
    let f = fetcher(
        LiteralPolicy {
            port: o.port,
            literal: "::ffff:127.0.0.1".parse().unwrap(),
        },
        &resolver,
    );
    let got = f
        .get(
            &format!("http://[::ffff:127.0.0.1]:{}/mapped", o.port),
            &limits(),
        )
        .await;
    assert_eq!(failure(got), Some(Failure::Blocked));
    assert_eq!(resolver.calls.load(Ordering::SeqCst), 0);
    assert_eq!(o.count(), 0);
}

#[tokio::test]
async fn skips_an_ipv4_mapped_dns_answer_for_the_next_address() {
    let o = ok_origin("127.0.0.1:0").await.unwrap();
    let f = fetcher(
        FixturePolicy::new(
            "mapped.example",
            o.port,
            addrs(&["::ffff:127.0.0.1", "127.0.0.1"]),
        ),
        &counting(vec![addrs(&["::ffff:127.0.0.1", "127.0.0.1"])]),
    );
    let started = Instant::now();
    let response = f
        .get(
            &format!("http://mapped.example:{}/mapped", o.port),
            &limits(),
        )
        .await
        .unwrap();
    assert_eq!(response.body, b"ok");
    assert_eq!(o.last().unwrap().target, "/mapped");
    // The mapped attempt fails at once; it must not wait out the attempt timeout.
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "took {:?}",
        started.elapsed()
    );
}

#[tokio::test]
async fn an_ipv4_mapped_dns_answer_never_connects() {
    let o = ok_origin("127.0.0.1:0").await.unwrap();
    let f = fetcher(
        FixturePolicy::new("mapped.example", o.port, addrs(&["::ffff:127.0.0.1"])),
        &counting(vec![addrs(&["::ffff:127.0.0.1"])]),
    );
    let got = f
        .get(
            &format!("http://mapped.example:{}/mapped", o.port),
            &limits(),
        )
        .await;
    assert_eq!(failure(got), Some(Failure::Blocked));
    assert_eq!(o.count(), 0);
}

// CreateHostHeader brackets every InterNetworkV6 literal, mapped ones too.
#[test]
fn host_header_brackets_every_ipv6_literal() {
    for (raw, want) in [
        ("http://127.0.0.1/", "127.0.0.1"),
        ("http://[::1]:8080/", "[::1]:8080"),
        ("http://[::ffff:127.0.0.1]/", "[::ffff:127.0.0.1]"),
        ("https://[::ffff:8.8.8.8]:444/", "[::ffff:8.8.8.8]:444"),
    ] {
        let url = resolve(raw, None).unwrap();
        let target = Target {
            host: url.idn_host.clone(),
            port: url.port,
            literal: parse_ip(&url.idn_host),
            url,
        };
        assert_eq!(host_header(&target), want, "{raw}");
    }
}

// .NET's SocketsHttpHandler defaults MaxResponseHeadersLength to 64 KiB.
#[tokio::test]
async fn refuses_a_response_head_over_sixty_four_ki_b() {
    for (kib, allowed) in [(48, true), (80, false)] {
        let o = Origin::start(
            "127.0.0.1:0",
            None,
            answer(move |_, _| {
                format!(
                    "HTTP/1.1 200 OK\r\nX-Padding: {}\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
                    "a".repeat(kib << 10)
                )
                .into_bytes()
            }),
        )
        .await
        .unwrap();
        let f = fixture_fetcher("head.example", o.port);
        let got = f
            .get(&format!("http://head.example:{}/", o.port), &limits())
            .await;
        if allowed {
            assert_eq!(got.unwrap().body, b"ok", "{kib} KiB");
        } else {
            assert_eq!(failure(got), Some(Failure::Blocked), "{kib} KiB");
        }
    }
}

#[tokio::test]
async fn asks_the_hop_budget_before_every_redirect() {
    let o = Origin::start("127.0.0.1:0", None, redirect_forever())
        .await
        .unwrap();
    let f = fixture_fetcher("hop.example", o.port);
    let asked = Arc::new(AtomicUsize::new(0));
    let asked2 = asked.clone();
    let limits = Limits {
        hop: Some(Arc::new(move || {
            asked2.fetch_add(1, Ordering::SeqCst) + 1 < 3
        })),
        ..limits()
    };
    let got = f
        .get(&format!("http://hop.example:{}/0", o.port), &limits)
        .await;
    assert_eq!(failure(got), Some(Failure::RateLimited));
    assert_eq!(o.count(), 3);
    assert_eq!(asked.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn truncates_the_body_at_the_cap_when_asked_and_keeps_the_final_headers() {
    let body = "0123456789".repeat(100);
    let body2 = body.clone();
    let o = Origin::start(
        "127.0.0.1:0",
        None,
        answer(move |seen, _| {
            if seen.target == "/start" {
                return b"HTTP/1.1 302 Found\r\nContent-Security-Policy: frame-ancestors 'none'\r\nLocation: /final\r\nContent-Length: 0\r\n\r\n".to_vec();
            }
            let mut head = "HTTP/1.1 200 OK\r\nContent-Security-Policy: default-src 'self'\r\nContent-Security-Policy: frame-ancestors https://a.example, img-src *\r\nX-Frame-Options: DENY\r\n".to_owned();
            let payload = if seen.target == "/final/gzip" {
                head.push_str("Content-Encoding: gzip\r\n");
                let mut e = GzEncoder::new(Vec::new(), Compression::default());
                std::io::Write::write_all(&mut e, body2.as_bytes()).unwrap();
                e.finish().unwrap()
            } else {
                body2.as_bytes().to_vec()
            };
            head.push_str(&format!("Content-Length: {}\r\n\r\n", payload.len()));
            [head.into_bytes(), payload].concat()
        }),
    )
    .await
    .unwrap();
    let f = fixture_fetcher("cut.example", o.port);
    let base = format!("http://cut.example:{}", o.port);
    let limits = Limits {
        truncate: true,
        upload: false,
        caller: String::new(),
        ..limits_of(5000, 25, 5)
    };
    let response = f.get(&format!("{base}/start"), &limits).await.unwrap();
    assert_eq!(response.body, body.as_bytes()[..25]);
    assert_eq!(response.redirects, 1);
    assert_eq!(response.final_url, format!("{base}/final"));
    let csp: Vec<&[u8]> = response.header.values("Content-Security-Policy").collect();
    assert_eq!(csp.len(), 2);
    assert_eq!(csp[1], b"frame-ancestors https://a.example, img-src *");
    let xfo: Vec<&[u8]> = response.header.values("X-Frame-Options").collect();
    assert_eq!(xfo, vec![b"DENY".as_slice()]);

    let gzip_limits = Limits {
        max_bytes: 100,
        ..limits.clone()
    };
    let response = f
        .get(&format!("{base}/final/gzip"), &gzip_limits)
        .await
        .unwrap();
    assert_eq!(response.body, body.as_bytes()[..100]);
    assert_eq!(response.redirects, 0);

    let strict = Limits {
        truncate: false,
        upload: false,
        caller: String::new(),
        ..limits
    };
    let got = f.get(&format!("{base}/final"), &strict).await;
    assert_eq!(failure(got), Some(Failure::TooLarge));
}
