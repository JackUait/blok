//! blok-mcp over an embedding host's own HTTP server keeps Node's front
//! door checks: a browser page that is not on loopback, or a DNS-rebound
//! Host, is refused before rmcp sees the request.

use std::sync::Arc;

use blok_mcp::Embedded;
use blok_mcp::authorize::Webhook;
use blok_mcp::bundle::Bundle;
use blok_mcp::outbound::Outbound;
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use serde_json::json;

async fn embedded() -> Embedded {
    let options = json!({
        "transport": { "kind": "http", "listen": "127.0.0.1:0" }, "auth": { "kind": "none" },
    });
    let authorize = Webhook::new("http://127.0.0.1:9/authorize".to_owned(), Outbound::new());
    Embedded::new(
        Arc::new(Bundle::new(1).unwrap()),
        &options,
        Some(authorize),
        None,
    )
    .await
    .unwrap()
}

fn list_tools(host: &str, origin: Option<&str>) -> http::Request<Full<Bytes>> {
    let mut request = http::Request::builder()
        .method("POST")
        .uri("/mcp")
        .header("host", host)
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", "2026-07-28")
        .header("mcp-method", "tools/list");
    if let Some(origin) = origin {
        request = request.header("origin", origin);
    }
    let body = json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/list",
        "params": { "_meta": {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { "name": "t", "version": "1" },
            "io.modelcontextprotocol/clientCapabilities": {},
        } },
    });
    request
        .body(Full::new(Bytes::from(body.to_string())))
        .unwrap()
}

const LOOPBACK: &str = "127.0.0.1:50000";
const REMOTE: &str = "203.0.113.9:50000";

async fn status(http: &blok_mcp::http::EmbeddedHttp, request: http::Request<Full<Bytes>>) -> u16 {
    status_from(http, LOOPBACK, request).await
}

async fn status_from(
    http: &blok_mcp::http::EmbeddedHttp,
    peer: &str,
    request: http::Request<Full<Bytes>>,
) -> u16 {
    let answer = http.handle(peer.parse().unwrap(), request).await;
    let status = answer.status().as_u16();
    let _ = answer.into_body().collect().await;
    status
}

#[tokio::test(flavor = "multi_thread")]
async fn a_foreign_origin_or_host_is_refused_and_loopback_is_served() {
    let embedded = embedded().await;
    let http = embedded.http(None).unwrap();
    assert_eq!(status(&http, list_tools("localhost:4000", None)).await, 200);
    assert_eq!(
        status(
            &http,
            list_tools("localhost:4000", Some("http://127.0.0.1:5173"))
        )
        .await,
        200
    );
    assert_eq!(
        status(
            &http,
            list_tools("localhost:4000", Some("https://evil.example"))
        )
        .await,
        403
    );
    assert_eq!(status(&http, list_tools("evil.example", None)).await, 403);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_app_names_its_own_host_names() {
    let embedded = embedded().await;
    let http = embedded
        .http(Some(vec!["app.example.com".to_owned()]))
        .unwrap();
    assert_eq!(
        status(&http, list_tools("app.example.com", None)).await,
        200
    );
    assert_eq!(
        status(&http, list_tools("APP.example.com:443", None)).await,
        200
    );
    assert_eq!(status(&http, list_tools("localhost:4000", None)).await, 403);
    // Still no foreign browser page.
    assert_eq!(
        status(
            &http,
            list_tools("app.example.com", Some("https://evil.example"))
        )
        .await,
        403
    );
}

// Node's createBlokMcpServer with OAuth refuses a caller with no bearer token.
#[tokio::test(flavor = "multi_thread")]
async fn oauth_options_refuse_a_caller_with_no_token() {
    let options = json!({
        "transport": { "kind": "http", "listen": "127.0.0.1:0" },
        "auth": { "kind": "oauth", "issuer": "https://issuer.test", "audience": "https://mcp.test/mcp", "jwksUrl": "http://127.0.0.1:9/jwks" },
    });
    let authorize = Webhook::new("http://127.0.0.1:9/authorize".to_owned(), Outbound::new());
    let embedded = Embedded::new(
        Arc::new(Bundle::new(1).unwrap()),
        &options,
        Some(authorize),
        None,
    )
    .await
    .unwrap();
    let http = embedded.http(None).unwrap();
    // OAuth is the opt-in for remote callers: they get the bearer gate.
    let answer = http
        .handle(REMOTE.parse().unwrap(), list_tools("localhost:4000", None))
        .await;
    assert_eq!(answer.status().as_u16(), 401);
    let challenge = answer
        .headers()
        .get("www-authenticate")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    assert!(
        challenge.starts_with("Bearer error=\"invalid_token\""),
        "{challenge}"
    );
}

// Node binds loopback itself; a Host header proves nothing about the caller.
#[tokio::test(flavor = "multi_thread")]
async fn a_remote_caller_naming_localhost_is_refused_without_an_opt_in() {
    let embedded = embedded().await;
    let http = embedded.http(None).unwrap();
    assert_eq!(
        status_from(&http, REMOTE, list_tools("localhost:4000", None)).await,
        403
    );
    assert_eq!(
        status_from(&http, "[::1]:50000", list_tools("localhost:4000", None)).await,
        200
    );
    // An app that names its own hosts serves remote callers.
    let public = embedded
        .http(Some(vec!["app.example.com".to_owned()]))
        .unwrap();
    assert_eq!(
        status_from(&public, REMOTE, list_tools("app.example.com", None)).await,
        200
    );
}

// Go's Handler() refuses this too: the HTTP rules (a per-document check,
// no uploads.root) are checked only for http options.
#[tokio::test(flavor = "multi_thread")]
async fn stdio_options_are_never_served_over_http() {
    let options = json!({ "transport": { "kind": "stdio" }, "auth": { "kind": "none" } });
    let embedded = Embedded::new(Arc::new(Bundle::new(1).unwrap()), &options, None, None)
        .await
        .unwrap();
    let refused = embedded.http(None).err().unwrap_or_default();
    assert!(refused.contains(r#"transport kind "http""#), "{refused}");
    assert!(embedded.handler(true).is_err());
    assert!(embedded.handler(false).is_ok());
    let typed = Embedded::start(
        Arc::new(Bundle::new(1).unwrap()),
        &blok_mcp::options::McpOptions::default(),
        blok_mcp::options::Hooks::default(),
    )
    .await
    .unwrap();
    assert!(typed.http(None).is_err());
}
