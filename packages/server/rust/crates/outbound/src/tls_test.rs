use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use crate::fetcher::Fetcher;
use crate::origin_test::*;
use crate::pki_test::{Fields, Pki, acceptor, certificate, key, pki};
use crate::policy::Failure;

// Hand ports of the TLS cases in GuardedOutboundFetcherTests, plus the
// no-revocation rule of CreateTlsOptions, which C# pins by code only.

async fn tls_origin(pki: &Pki, protocols: &[&[u8]], handler: Handler) -> Origin {
    Origin::start(
        "127.0.0.1:0",
        Some(acceptor(pki.chain.clone(), pki.key.clone_key(), protocols)),
        handler,
    )
    .await
    .unwrap()
}

fn loopback_fetcher(host: &str, port: u16, roots: Option<crate::fetcher::Roots>) -> Fetcher {
    let mut f = fixture_fetcher(host, port);
    f.roots = roots;
    f
}

#[tokio::test]
async fn preserves_the_hostname_for_tls_sni_and_certificate_validation() {
    let pki = pki("secure.example", |_| {});
    let o = tls_origin(&pki, &[], ok_handler()).await;
    let f = loopback_fetcher("secure.example", o.port, Some(pki.roots.clone()));
    let response = f
        .get(&format!("https://secure.example:{}/tls", o.port), &limits())
        .await
        .unwrap();
    assert_eq!(response.body, b"ok");
    let seen = o.last().unwrap();
    assert_eq!(seen.server_name.as_deref(), Some("secure.example"));
    assert_eq!(
        seen.header("Host"),
        Some(format!("secure.example:{}", o.port).as_str())
    );
}

#[tokio::test]
async fn rejects_a_trusted_certificate_for_the_wrong_hostname() {
    let pki = pki("other.example", |_| {});
    let o = tls_origin(&pki, &[], ok_handler()).await;
    let f = loopback_fetcher("secure.example", o.port, Some(pki.roots.clone()));
    let got = f
        .get(&format!("https://secure.example:{}/", o.port), &limits())
        .await;
    assert_eq!(failure(got), Some(Failure::Blocked));
}

#[tokio::test]
async fn retains_normal_tls_certificate_validation() {
    let pki = pki("untrusted.example", |_| {});
    let o = tls_origin(&pki, &[], ok_handler()).await;
    let f = loopback_fetcher("untrusted.example", o.port, None);
    let got = f
        .get(&format!("https://untrusted.example:{}/", o.port), &limits())
        .await;
    assert_eq!(failure(got), Some(Failure::Blocked));
}

#[tokio::test]
async fn offers_only_http11_during_tls_negotiation() {
    let pki = pki("alpn.example", |_| {});
    let o = tls_origin(&pki, &[b"h2", b"http/1.1"], ok_handler()).await;
    let f = loopback_fetcher("alpn.example", o.port, Some(pki.roots.clone()));
    f.get(&format!("https://alpn.example:{}/", o.port), &limits())
        .await
        .unwrap();
    assert_eq!(
        o.last().unwrap().alpn.as_deref(),
        Some(b"http/1.1".as_slice())
    );
}

// SocketsHttpHandler offers no ALPN on an HTTP/1.1 connection
// (HttpConnectionPool's _sslOptionsHttp11.ApplicationProtocols = null,
// System.Net.Http 10.0.11; measured: a default HttpClient negotiates
// nothing with a server offering h2 and http/1.1). The operator client is
// HttpClient in C#.
#[tokio::test]
async fn the_operator_client_offers_no_alpn() {
    let pki = pki("localhost", |_| {});
    let o = tls_origin(&pki, &[b"h2", b"http/1.1"], ok_handler()).await;
    let client = crate::operator::OperatorClient {
        connect_timeout: Duration::from_secs(5),
        header_timeout: None,
        proxy: crate::proxy::EnvironmentProxy::from_lookup(|_| None),
        roots: Some(pki.roots.clone()),
    };
    let url = blok_dotnet::parse_absolute_uri(&format!("https://localhost:{}/", o.port)).unwrap();
    let host = format!("localhost:{}", o.port);
    let response = client
        .send(crate::operator::Request {
            method: "GET",
            url: &url,
            host: &host,
            headers: Vec::new(),
            body: crate::operator::RequestBody::None,
        })
        .await;
    assert!(response.is_ok(), "the request failed");
    assert_eq!(o.last().unwrap().alpn, None);
}

// RevocationMode = NoCheck: a leaf that names a CRL and an OCSP responder
// verifies without either being asked.
#[tokio::test]
async fn never_checks_revocation() {
    let responder = Origin::start(
        "127.0.0.1:0",
        None,
        answer(|_, _| b"HTTP/1.1 500 Oops\r\nContent-Length: 0\r\n\r\n".to_vec()),
    )
    .await
    .unwrap();
    let base = format!("http://127.0.0.1:{}", responder.port);
    let pki = pki("revoked.example", |leaf| {
        leaf.crl = vec![format!("{base}/crl")];
        leaf.ocsp = vec![format!("{base}/ocsp")];
    });
    let o = tls_origin(&pki, &[], ok_handler()).await;
    let f = loopback_fetcher("revoked.example", o.port, Some(pki.roots.clone()));
    f.get(&format!("https://revoked.example:{}/", o.port), &limits())
        .await
        .unwrap();
    assert_eq!(responder.count(), 0, "revocation endpoints asked");
}

// An IP literal sends no SNI (RFC 6066 3) and is checked against the
// certificate's IP addresses.
#[tokio::test]
async fn an_ip_literal_sends_no_server_name() {
    let pki = pki("127.0.0.1", |_| {});
    let o = tls_origin(&pki, &[], ok_handler()).await;
    let mut f = Fetcher::new(Arc::new(AnyAddress));
    f.roots = Some(pki.roots.clone());
    f.get(&format!("https://127.0.0.1:{}/", o.port), &limits())
        .await
        .unwrap();
    assert_eq!(o.hellos.load(Ordering::SeqCst), 1);
    assert_eq!(o.last().unwrap().server_name, None);
}

#[tokio::test]
async fn refuses_a_redirect_from_https_down_to_http() {
    let plain = ok_origin("127.0.0.1:0").await.unwrap();
    let plain_port = plain.port;
    let pki = pki("secure.example", |_| {});
    let secure = tls_origin(
        &pki,
        &[],
        answer(move |_, _| {
            format!("HTTP/1.1 302 Found\r\nLocation: http://secure.example:{plain_port}/plain\r\nContent-Length: 0\r\n\r\n")
                .into_bytes()
        }),
    )
    .await;
    let mut f = fetcher(
        FixturePolicy {
            hosts: vec!["secure.example".into()],
            ports: vec![secure.port, plain.port],
            allowed: addrs(&["127.0.0.1"]),
        },
        &counting(vec![addrs(&["127.0.0.1"])]),
    );
    f.roots = Some(pki.roots.clone());
    let got = f
        .get(
            &format!("https://secure.example:{}/", secure.port),
            &limits(),
        )
        .await;
    assert_eq!(failure(got), Some(Failure::Blocked));
    assert_eq!(secure.count(), 1);
    assert_eq!(plain.count(), 0, "the http hop was fetched");
}

#[tokio::test]
async fn follows_a_redirect_from_http_up_to_https() {
    let pki = pki("secure.example", |_| {});
    let secure = tls_origin(&pki, &[], ok_handler()).await;
    let secure_port = secure.port;
    let plain = Origin::start(
        "127.0.0.1:0",
        None,
        answer(move |_, _| {
            format!("HTTP/1.1 302 Found\r\nLocation: https://secure.example:{secure_port}/up\r\nContent-Length: 0\r\n\r\n")
                .into_bytes()
        }),
    )
    .await
    .unwrap();
    let mut f = fetcher(
        FixturePolicy {
            hosts: vec!["secure.example".into()],
            ports: vec![secure.port, plain.port],
            allowed: addrs(&["127.0.0.1"]),
        },
        &counting(vec![addrs(&["127.0.0.1"])]),
    );
    f.roots = Some(pki.roots.clone());
    let response = f
        .get(&format!("http://secure.example:{}/", plain.port), &limits())
        .await
        .unwrap();
    assert_eq!(response.body, b"ok");
}

/// A leaf signed by an intermediate the server does not send, with a
/// caIssuers URL pointing at a local listener.
pub(crate) async fn aia_setup(send_middle: bool) -> (Origin, Origin, crate::fetcher::Roots) {
    let middle_der = Arc::new(std::sync::Mutex::new(Vec::new()));
    let served = middle_der.clone();
    let issuer = Origin::start(
        "127.0.0.1:0",
        None,
        answer(move |_, _| {
            let body = served.lock().unwrap().clone();
            [
                format!("HTTP/1.1 200 OK\r\nContent-Type: application/pkix-cert\r\nContent-Length: {}\r\n\r\n", body.len()).into_bytes(),
                body,
            ]
            .concat()
        }),
    )
    .await
    .unwrap();
    let root = certificate(
        &Fields {
            common: "root".into(),
            ca: true,
            ..Fields::default()
        },
        1,
        &key("root"),
        "root",
        &key("root"),
    );
    let middle = certificate(
        &Fields {
            common: "middle".into(),
            ca: true,
            ..Fields::default()
        },
        2,
        &key("middle"),
        "root",
        &key("root"),
    );
    *middle_der.lock().unwrap() = middle.to_vec();
    let leaf = certificate(
        &Fields {
            common: "aia.example".into(),
            names: vec!["aia.example".into()],
            ca_issuers: vec![format!("http://127.0.0.1:{}/issuer.cer", issuer.port)],
            ..Fields::default()
        },
        3,
        &key("leaf"),
        "middle",
        &key("middle"),
    );
    let chain = if send_middle {
        vec![leaf, middle]
    } else {
        vec![leaf]
    };
    let origin = Origin::start(
        "127.0.0.1:0",
        Some(acceptor(chain, key("leaf").private(), &[])),
        ok_handler(),
    )
    .await
    .unwrap();
    (origin, issuer, Arc::new(vec![root]))
}

// The analogue of SslStreamStillLeaksAnIssuerFetchOnMacOs: a platform
// verifier may fetch a caIssuers URL, which would reach an address the guard
// never vetted. With the system roots the chain fails and nothing is asked.
#[tokio::test]
async fn the_fetcher_never_lets_the_verifier_fetch_an_issuer() {
    let (origin, issuer, _) = aia_setup(false).await;
    let f = loopback_fetcher("aia.example", origin.port, None);
    let got = f
        .get(&format!("https://aia.example:{}/", origin.port), &limits())
        .await;
    assert_eq!(
        failure(got),
        Some(Failure::Blocked),
        "an untrusted chain verified"
    );
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(issuer.count(), 0, "the verifier fetched the issuer");
}

// Twin of Go's TestRefusesAtTLSTheHostNamesDotNetRefuses: measured on the
// C# fetcher with a trusted certificate naming each host.
#[tokio::test]
async fn refuses_at_tls_the_host_names_dot_net_refuses() {
    let long = format!("{}.example", "a".repeat(64));
    let cases: [(&str, bool); 11] = [
        ("ok.example", true),
        ("a_b.example", true),
        ("ab--cd.example", true),
        ("xn--zz.example", true),
        ("a.1b.example", true),
        ("1.2.3.example", true),
        ("a.-b.example", false),
        ("foo-.example", false),
        ("-a.example", false),
        ("x.123", false),
        (&long, false),
    ];
    for (host, ok) in cases {
        let pki = pki(host, |_| {});
        let o = tls_origin(&pki, &[], ok_handler()).await;
        let f = loopback_fetcher(host, o.port, Some(pki.roots.clone()));
        let got = f
            .get(&format!("https://{host}:{}/", o.port), &limits())
            .await;
        if ok {
            assert_eq!(got.unwrap().body, b"ok", "{host}");
        } else {
            assert_eq!(failure(got), Some(Failure::Blocked), "{host}");
        }
    }
}
