use std::collections::BTreeMap;
use std::sync::Arc;

use crate::fetcher::{Fetcher, Limits};
use crate::origin_test::*;
use crate::policy::{ExactOriginPolicy, Failure};
use crate::test_json::{field, fixture_path, items, load, string};

// The black-box outbound fixtures, which http-host-contract captures from
// C# through the conformance policy, replayed against a local origin.

fn page() -> Vec<u8> {
    std::fs::read(fixture_path("metadata/precedence.html")).unwrap()
}

fn conformance_fetcher(port: u16) -> Fetcher {
    Fetcher::new(Arc::new(ExactOriginPolicy {
        origin: format!("http://127.0.0.1:{port}"),
        port,
    }))
}

/// unfurl's limits (UnfurlEndpoint): 10 s, 2 MiB, 5 redirects.
fn unfurl_limits() -> Limits {
    limits_of(10_000, 2 << 20, 5)
}

fn page_response(page: &[u8], headers: &str) -> Vec<u8> {
    [
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n{headers}Content-Length: {}\r\n\r\n",
            page.len()
        )
        .into_bytes(),
        page.to_vec(),
    ]
    .concat()
}

#[tokio::test]
async fn header_size_matches_the_c_sharp_fixture() {
    let page = page();
    let o = Origin::start(
        "127.0.0.1:0",
        None,
        answer(move |seen, _| {
            let kib: usize = seen
                .target
                .trim_start_matches("/big-header/")
                .parse()
                .unwrap();
            page_response(&page, &format!("X-Padding: {}\r\n", "a".repeat(kib << 10)))
        }),
    )
    .await
    .unwrap();
    let f = conformance_fetcher(o.port);
    let cases = load("outbound-header-size.json");
    assert_eq!(items(&cases).len(), 4);
    for c in items(&cases) {
        let name = string(c, "name");
        let kib = name
            .trim_start_matches("a ")
            .trim_end_matches(" KiB header");
        let got = f
            .get(
                &format!("http://127.0.0.1:{}/big-header/{kib}", o.port),
                &unfurl_limits(),
            )
            .await;
        let ok = string(field(c, "response"), "body").starts_with("{\"success\":1");
        assert_eq!(got.is_ok(), ok, "{name}");
        if !ok {
            assert_eq!(failure(got), Some(Failure::Blocked), "{name}");
        }
    }
}

#[tokio::test]
async fn redirect_cap_matches_the_c_sharp_fixture() {
    let page = page();
    let o = Origin::start(
        "127.0.0.1:0",
        None,
        answer(move |seen, _| {
            let rest = seen.target.trim_start_matches("/chain/");
            let (hops, name) = rest.split_once('/').unwrap();
            let hops: usize = hops.parse().unwrap();
            if hops > 0 {
                format!(
                    "HTTP/1.1 302 Found\r\nLocation: /chain/{}/{name}\r\nContent-Length: 0\r\n\r\n",
                    hops - 1
                )
                .into_bytes()
            } else {
                page_response(&page, "")
            }
        }),
    )
    .await
    .unwrap();
    let f = conformance_fetcher(o.port);
    let cases = load("outbound-redirect-cap.json");
    for c in items(&cases) {
        let name = string(c, "name");
        // Both endpoints follow at most 5 redirects.
        let hops = if name.contains("after 5") { 5 } else { 6 };
        let response = field(c, "response");
        let ok = match field(response, "status") {
            blok_jsjson::Value::Number(n) => *n == 200.0,
            _ => false,
        } && !string(response, "body").starts_with("{\"success\":0");
        let got = f
            .get(
                &format!("http://127.0.0.1:{}/chain/{hops}/page.html", o.port),
                &unfurl_limits(),
            )
            .await;
        assert_eq!(got.is_ok(), ok, "{name}");
        if let Ok(response) = got {
            assert_eq!(response.redirects, 5, "{name}");
            assert_eq!(
                response.final_url,
                format!("http://127.0.0.1:{}/chain/0/page.html", o.port)
            );
        } else {
            assert_eq!(failure(got), Some(Failure::TooManyRedirects), "{name}");
        }
    }
}

#[tokio::test]
async fn request_headers_match_the_c_sharp_fixture() {
    let o = Origin::start(
        "127.0.0.1:0",
        None,
        answer(|seen, _| match seen.target.split('?').next().unwrap() {
            "/metadata/redirect" => b"HTTP/1.1 302 Found\r\nLocation: /metadata/final/page.html?from=redirect\r\nContent-Length: 0\r\n\r\n".to_vec(),
            "/media/redirect" => b"HTTP/1.1 302 Found\r\nLocation: /media/final/photo.jpeg?download=1\r\nContent-Length: 0\r\n\r\n".to_vec(),
            _ => b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok".to_vec(),
        }),
    )
    .await
    .unwrap();
    let f = conformance_fetcher(o.port);
    for path in ["/metadata/redirect", "/media/redirect"] {
        f.get(
            &format!("http://127.0.0.1:{}{path}", o.port),
            &unfurl_limits(),
        )
        .await
        .unwrap();
    }
    let cases = load("outbound-request-headers.json");
    let seen = o.seen.lock().unwrap().clone();
    assert_eq!(seen.len(), items(&cases).len());
    for (index, (c, request)) in items(&cases).iter().zip(seen).enumerate() {
        let path = request.target.split('?').next().unwrap();
        assert_eq!(string(c, "name"), format!("{index} {path}"));
        let got: BTreeMap<String, String> = request
            .headers
            .iter()
            .map(|(n, v)| {
                let n = n.to_ascii_lowercase();
                let v = if n == "host" {
                    "<origin host>".to_owned()
                } else {
                    v.clone()
                };
                (n, v)
            })
            .collect();
        let want: BTreeMap<String, String> = match field(c, "response") {
            blok_jsjson::Value::Object(object) => object
                .members()
                .iter()
                .map(|m| (m.key.to_string(), crate::test_json::text(&m.value).unwrap()))
                .collect(),
            _ => panic!("no headers"),
        };
        assert_eq!(got, want, "{index} {path}");
    }
}
