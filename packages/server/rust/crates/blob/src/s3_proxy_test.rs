use std::collections::HashMap;

use tokio::io::AsyncWriteExt;

use blok_outbound::EnvironmentProxy;

use crate::blob::{Body, Store};
use crate::s3::{S3, Settings};
use crate::s3_test::test_options;
use crate::s3_wire_test::raw_server;
use crate::test_json::{field, items, load, string};

/// http-host-contract's PROXY_CASES: the variables for each case, given
/// the proxy's URL. ENDPOINT replaces the S3 endpoint.
fn variables(name: &str, proxy: &str) -> Vec<(&'static str, String)> {
    let bare = proxy.replace("http://", "");
    let p = || proxy.to_owned();
    match name {
        "no proxy variables" => vec![],
        "HTTPS_PROXY" => vec![("HTTPS_PROXY", p())],
        "https_proxy" => vec![("https_proxy", p())],
        "HTTPS_PROXY without a scheme" => vec![("HTTPS_PROXY", bare)],
        "only HTTP_PROXY" => vec![("HTTP_PROXY", p())],
        "ALL_PROXY" => vec![("ALL_PROXY", p())],
        "all_proxy" => vec![("all_proxy", p())],
        "NO_PROXY names the host" => vec![
            ("HTTPS_PROXY", p()),
            ("NO_PROXY", "s3.blok-proxy.invalid".into()),
        ],
        "NO_PROXY names the domain" => vec![
            ("HTTPS_PROXY", p()),
            ("NO_PROXY", ".blok-proxy.invalid".into()),
        ],
        "NO_PROXY bare domain" => vec![
            ("HTTPS_PROXY", p()),
            ("NO_PROXY", "blok-proxy.invalid".into()),
        ],
        "NO_PROXY star" => vec![("HTTPS_PROXY", p()), ("NO_PROXY", "*".into())],
        "no_proxy names the host" => vec![
            ("HTTPS_PROXY", p()),
            ("no_proxy", "s3.blok-proxy.invalid".into()),
        ],
        "empty no_proxy beside NO_PROXY" => vec![
            ("HTTPS_PROXY", p()),
            ("no_proxy", String::new()),
            ("NO_PROXY", "s3.blok-proxy.invalid".into()),
        ],
        "empty https_proxy beside HTTPS_PROXY" => {
            vec![("https_proxy", String::new()), ("HTTPS_PROXY", p())]
        }
        "HTTPS_PROXY beside ALL_PROXY" => vec![
            ("HTTPS_PROXY", p()),
            ("ALL_PROXY", "http://127.0.0.1:9".into()),
        ],
        "HTTPS_PROXY with a path after the port" => {
            vec![("HTTPS_PROXY", format!("{proxy}/ignored"))]
        }
        "HTTPS_PROXY in upper case scheme" => {
            vec![("HTTPS_PROXY", proxy.replace("http://", "HTTP://"))]
        }
        "HTTPS_PROXY with an empty port" => {
            let cut = proxy.rsplit_once(':').unwrap().0;
            vec![("HTTPS_PROXY", format!("{cut}:")), ("ALL_PROXY", p())]
        }
        "NO_PROXY list with spaces and case" => vec![
            ("HTTPS_PROXY", p()),
            ("NO_PROXY", " other.example , S3.Blok-Proxy.Invalid ".into()),
        ],
        "NO_PROXY dot entry names the host itself" => {
            vec![
                ("HTTPS_PROXY", p()),
                ("NO_PROXY", ".s3.blok-proxy.invalid".into()),
            ]
        }
        "HTTPS_PROXY under CGI" => vec![
            ("HTTPS_PROXY", p()),
            ("GATEWAY_INTERFACE", "CGI/1.1".into()),
        ],
        "loopback http endpoint with HTTP_PROXY" => vec![("HTTP_PROXY", p()), ("ENDPOINT", p())],
        "loopback http endpoint with no proxy" => vec![("ENDPOINT", p())],
        "loopback http endpoint with HTTP_PROXY under CGI" => vec![
            ("HTTP_PROXY", p()),
            ("GATEWAY_INTERFACE", "CGI/1.1".into()),
            ("ENDPOINT", p()),
        ],
        "loopback http endpoint with http_proxy under CGI" => vec![
            ("http_proxy", p()),
            ("GATEWAY_INTERFACE", "CGI/1.1".into()),
            ("ENDPOINT", p()),
        ],
        other => panic!("no variables for {other}"),
    }
}

fn normalize(text: &str, proxy_authority: &str) -> String {
    let text = text.replace(proxy_authority, "<proxy>");
    match text.find(".txt") {
        Some(end) if end >= 32 && text.is_char_boundary(end - 32) => {
            format!("{}<key>{}", &text[..end - 32], &text[end..])
        }
        _ => text,
    }
}

#[tokio::test]
async fn sends_s3_requests_through_the_environment_proxy_the_way_dotnet_does() {
    // The proxy refuses every tunnel and every request, so each upload
    // fails; the fixture pins who was asked.
    let (proxy, seen, _task) = raw_server(true, |_, mut conn| async move {
        let _ = conn
            .get_mut()
            .write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
            .await;
    })
    .await;
    let authority = proxy.trim_start_matches("http://").to_owned();
    let cases = load("s3-proxy.json");
    assert!(!items(&cases).is_empty());
    for c in items(&cases) {
        let name = string(c, "name");
        seen.lock().unwrap().clear();
        let mut env: HashMap<&str, String> = variables(&name, &proxy).into_iter().collect();
        let endpoint = env
            .remove("ENDPOINT")
            .unwrap_or_else(|| "https://s3.blok-proxy.invalid".into());
        let mut options = test_options(&endpoint, "media", "path");
        options.region = "us-east-1".into();
        let settings = Settings {
            proxy: EnvironmentProxy::from_lookup(|name| env.get(name).cloned()),
            ..Settings::default()
        };
        let s = S3::build(options, settings).unwrap();
        assert!(
            s.put(".txt", "text/plain", Body::bytes(b"one".to_vec()))
                .await
                .is_err(),
            "{name}"
        );
        let got: Vec<(String, String, String)> = seen
            .lock()
            .unwrap()
            .iter()
            .map(|r| {
                (
                    r.method.clone(),
                    normalize(&r.target, &authority),
                    normalize(r.header("Host").unwrap_or_default(), &authority),
                )
            })
            .collect();
        let want: Vec<(String, String, String)> = items(field(field(c, "response"), "proxied"))
            .iter()
            .map(|p| (string(p, "method"), string(p, "target"), string(p, "host")))
            .collect();
        assert_eq!(got, want, "{name}");
    }
}
