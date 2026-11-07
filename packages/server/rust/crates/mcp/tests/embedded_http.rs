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

async fn status(http: &blok_mcp::http::EmbeddedHttp, request: http::Request<Full<Bytes>>) -> u16 {
    let answer = http.handle(request).await;
    let status = answer.status().as_u16();
    let _ = answer.into_body().collect().await;
    status
}

#[tokio::test(flavor = "multi_thread")]
async fn a_foreign_origin_or_host_is_refused_and_loopback_is_served() {
    let embedded = embedded().await;
    let http = embedded.http(None);
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
    let http = embedded.http(Some(vec!["app.example.com".to_owned()]));
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
    let http = embedded.http(None);
    let answer = http.handle(list_tools("localhost:4000", None)).await;
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
