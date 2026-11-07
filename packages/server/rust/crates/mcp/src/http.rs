//! Streamable HTTP (src/mcp/http.ts): Blok's own front door on blok-http,
//! then rmcp's StreamableHttpService behind an adapter. The front door does
//! everything Node does before its SDK sees the request.

use std::net::SocketAddr;
use std::sync::Arc;

use blok_http::{Config, Request, ResponseWriter, Server};
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use rmcp::transport::streamable_http_server::session::never::NeverSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use serde_json::Value;

use crate::oauth::{METADATA_PATH, OAuth};
use crate::protocol::{Handler, HttpIdentity};

// Node's cap, the SDK's own default body bound.
const MAX_BODY: usize = 4 * 1024 * 1024;
const MCP_PATH: &str = "/mcp";
const LOOPBACK_HOST_NAMES: [&str; 3] = ["localhost", "127.0.0.1", "[::1]"];

type Service = StreamableHttpService<Handler, NeverSessionManager>;

pub struct Front {
    json: Service,
    sse: Service,
    oauth: Option<OAuth>,
    principal: String,
    /// --public: a proxy in front sets Host, so only a loopback bind checks it.
    public: bool,
    port: u16,
}

/// MCP clients are not browsers: only a loopback page may drive this
/// server. Case-sensitive, any port, as Node's LOOPBACK_ORIGIN regex.
pub fn loopback_origin(origin: &str) -> bool {
    let Some(rest) = origin.strip_prefix("http://") else {
        return false;
    };
    let after = ["localhost", "127.0.0.1", "[::1]"]
        .iter()
        .find_map(|name| rest.strip_prefix(name));
    match after {
        Some("") => true,
        Some(port) => port
            .strip_prefix(':')
            .is_some_and(|digits| !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())),
        None => false,
    }
}

/// A DNS-rebound page's Host names the attacker's domain: the name must be
/// a loopback one (any case) and the port the bound one.
pub fn loopback_host(host: Option<&str>, port: u16) -> bool {
    let Some(host) = host else { return false };
    let Some(at) = host.rfind(':').filter(|at| *at > 0) else {
        return false;
    };
    LOOPBACK_HOST_NAMES.contains(&host[..at].to_lowercase().as_str())
        && host[at + 1..] == port.to_string()
}

/// blok-mcp behind an embedding host's own HTTP server, with the checks
/// Node's front door makes: a browser Origin must be a loopback page, and
/// the Host a loopback name (any port) or one of the app's own names.
pub struct EmbeddedHttp {
    service: Service,
    hosts: Option<Vec<String>>,
    oauth: Option<OAuth>,
    principal: String,
}

impl EmbeddedHttp {
    /// `hosts`: the app's own host names, any case, with or without a port.
    /// None takes loopback names only.
    pub fn new(
        handler: Handler,
        hosts: Option<Vec<String>>,
        oauth: Option<OAuth>,
        principal: String,
    ) -> EmbeddedHttp {
        let mut config = StreamableHttpServerConfig::default();
        config.legacy_session_mode = false;
        // Checked here, Node's way.
        config.allowed_hosts.clear();
        EmbeddedHttp {
            service: StreamableHttpService::new(
                move || Ok(handler.clone()),
                Arc::new(NeverSessionManager::default()),
                config,
            ),
            hosts: hosts.map(|hosts| hosts.iter().map(|h| h.to_lowercase()).collect()),
            oauth,
            principal,
        }
    }

    fn host_allowed(&self, host: Option<&str>) -> bool {
        let Some(host) = host.map(str::to_lowercase) else {
            return false;
        };
        let name = match host.rfind(':') {
            Some(at) if !host.ends_with(']') => &host[..at],
            _ => host.as_str(),
        };
        match &self.hosts {
            None => LOOPBACK_HOST_NAMES.contains(&name),
            Some(hosts) => hosts.iter().any(|h| *h == host || *h == name),
        }
    }

    /// One request: 403 for a foreign Origin or Host, else rmcp's answer.
    pub async fn handle(
        &self,
        request: http::Request<Full<Bytes>>,
    ) -> http::Response<http_body_util::combinators::BoxBody<Bytes, std::convert::Infallible>> {
        let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok());
        if header("origin").is_some_and(|o| !loopback_origin(o))
            || !self.host_allowed(header("host"))
        {
            let mut refused = http::Response::new(
                Full::new(Bytes::new())
                    .map_err(|never| match never {})
                    .boxed(),
            );
            *refused.status_mut() = http::StatusCode::FORBIDDEN;
            return refused;
        }
        // The SDK's bearer gate, as the front door runs it.
        let identity = match &self.oauth {
            None => HttpIdentity {
                principal: self.principal.clone(),
                scopes: None,
            },
            Some(oauth) => match oauth.authenticate(header("authorization")).await {
                Ok(verified) => HttpIdentity {
                    principal: verified.principal,
                    scopes: Some(verified.scopes),
                },
                Err(refusal) => {
                    let mut refused = http::Response::new(
                        Full::new(Bytes::from(refusal.body))
                            .map_err(|never| match never {})
                            .boxed(),
                    );
                    *refused.status_mut() = http::StatusCode::from_u16(refusal.status)
                        .unwrap_or(http::StatusCode::UNAUTHORIZED);
                    let headers = refused.headers_mut();
                    headers.insert(
                        "content-type",
                        http::HeaderValue::from_static("application/json"),
                    );
                    if let Ok(challenge) = http::HeaderValue::from_str(&refusal.challenge) {
                        headers.insert("www-authenticate", challenge);
                    }
                    return refused;
                }
            },
        };
        let mut request = request;
        request.extensions_mut().insert(identity);
        self.service.handle(request).await
    }
}

fn empty(resp: &mut ResponseWriter, status: u16) {
    resp.set_status(status);
    resp.headers_mut().set("Content-Length", "0");
}

async fn json(resp: &mut ResponseWriter, status: u16, body: &str, extra: &[(&str, &str)]) {
    resp.set_status(status);
    resp.headers_mut().set("Content-Type", "application/json");
    for (name, value) in extra {
        resp.headers_mut().set(*name, *value);
    }
    resp.headers_mut()
        .set("Content-Length", body.len().to_string());
    let _ = resp.write(body.as_bytes()).await;
}

enum Read {
    Body(Vec<u8>),
    TooLarge,
    Failed,
}

async fn read_body(req: &mut Request) -> Read {
    let Some(mut body) = req.take_body() else {
        return Read::Body(Vec::new());
    };
    let mut out = Vec::new();
    let mut buf = vec![0u8; 64 << 10];
    loop {
        match body.read(&mut buf).await {
            Ok(0) => return Read::Body(out),
            Ok(n) => {
                out.extend_from_slice(&buf[..n]);
                if out.len() > MAX_BODY {
                    return Read::TooLarge;
                }
            }
            Err(_) => return Read::Failed,
        }
    }
}

impl Front {
    async fn serve(self: Arc<Self>, mut req: Request, mut resp: ResponseWriter) {
        let origin = req.headers().get("origin").map(str::to_owned);
        let host = req.headers().get("host").map(str::to_owned);
        if origin.as_deref().is_some_and(|o| !loopback_origin(o))
            || (!self.public && !loopback_host(host.as_deref(), self.port))
        {
            return empty(&mut resp, 403);
        }
        let path = req
            .target()
            .split('?')
            .next()
            .unwrap_or_default()
            .to_owned();
        if let Some(oauth) = &self.oauth
            && req.method() == "GET"
            && path == METADATA_PATH
        {
            return json(&mut resp, 200, &oauth.metadata(), &[]).await;
        }
        if path != MCP_PATH {
            return empty(&mut resp, 404);
        }
        // The bearer gate reads only the header, so a refused caller never gets a body read.
        let identity = match &self.oauth {
            None => HttpIdentity {
                principal: self.principal.clone(),
                scopes: None,
            },
            Some(oauth) => match oauth.authenticate(req.headers().get("authorization")).await {
                Ok(verified) => HttpIdentity {
                    principal: verified.principal,
                    scopes: Some(verified.scopes),
                },
                Err(refusal) => {
                    return json(
                        &mut resp,
                        refusal.status,
                        &refusal.body,
                        &[("WWW-Authenticate", &refusal.challenge)],
                    )
                    .await;
                }
            },
        };
        if req.method() != "POST" {
            return json(
                &mut resp,
                405,
                r#"{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}"#,
                &[("Allow", "POST")],
            )
            .await;
        }
        let body = match read_body(&mut req).await {
            Read::Body(body) => body,
            Read::TooLarge => return empty(&mut resp, 413),
            Read::Failed => return empty(&mut resp, 400),
        };
        // JSON.parse takes a lone surrogate and any depth; serde_json does not.
        let body = match std::str::from_utf8(&body).map(crate::lenient::mend) {
            Ok(crate::lenient::Mended::Forward(text)) => text.into_bytes(),
            Ok(crate::lenient::Mended::Answer(answer)) => {
                return json(&mut resp, 200, &answer, &[]).await;
            }
            Err(_) => body,
        };
        let body = match std::str::from_utf8(&body).map(crate::shape::shape) {
            Ok(crate::shape::Shaped::Forward(text)) => text.into_bytes(),
            Ok(crate::shape::Shaped::NotAMessage(id)) => {
                let answer = serde_json::json!({
                    "jsonrpc": "2.0",
                    "error": { "code": -32600, "message": crate::shape::NOT_A_MESSAGE },
                    "id": id,
                });
                return json(&mut resp, 400, &answer.to_string(), &[]).await;
            }
            Ok(crate::shape::Shaped::Refused(answer)) => {
                let header_version = req.headers().get("mcp-protocol-version").map(str::to_owned);
                let modern = serde_json::from_slice::<Value>(&body)
                    .is_ok_and(|m| is_modern(&m, header_version.as_deref()));
                if modern {
                    return json(&mut resp, 200, &answer, &[]).await;
                }
                // 2025 answers are SSE, as Node's SDK sends them.
                resp.set_status(200);
                resp.headers_mut().set("Content-Type", "text/event-stream");
                resp.headers_mut().set("Cache-Control", "no-cache");
                let event = format!("event: message\ndata: {answer}\n\n");
                resp.headers_mut()
                    .set("Content-Length", event.len().to_string());
                let _ = resp.write(event.as_bytes()).await;
                return;
            }
            Err(_) => body,
        };
        let Ok(message) = serde_json::from_slice::<Value>(&body) else {
            return json(
                &mut resp,
                400,
                r#"{"jsonrpc":"2.0","error":{"code":-32700,"message":"Parse error: Invalid JSON"},"id":null}"#,
                &[],
            )
            .await;
        };
        let header_version = req.headers().get("mcp-protocol-version").map(str::to_owned);
        let modern = is_modern(&message, header_version.as_deref());
        let mut builder = http::Request::builder()
            .method(req.method())
            .uri(req.target());
        for (name, value) in req.headers().iter() {
            // Node's SDK still takes this draft revision; rmcp refuses it with 400.
            let value = if name.eq_ignore_ascii_case("mcp-protocol-version") && value == DRAFT_2024
            {
                LEGACY_2024
            } else {
                value
            };
            builder = builder.header(name, value);
        }
        let Ok(mut request) = builder.body(Full::new(Bytes::from(body))) else {
            return empty(&mut resp, 400);
        };
        request.extensions_mut().insert(identity);
        // 2026-07-28 answers are JSON and earlier ones SSE, as Node's SDK sends them.
        let service = if modern { &self.json } else { &self.sse };
        let answer = service.handle(request).await;
        let (parts, mut answer_body) = answer.into_parts();
        let json_answer = parts
            .headers
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with("application/json"));
        resp.set_status(parts.status.as_u16());
        for (name, value) in &parts.headers {
            if json_answer && name.as_str().eq_ignore_ascii_case("content-length") {
                continue;
            }
            resp.headers_mut()
                .add(name.as_str(), value.to_str().unwrap_or_default());
        }
        if json_answer {
            let Ok(collected) = answer_body.collect().await;
            let bytes = collected.to_bytes();
            let (status, text) = node_error_shape(parts.status.as_u16(), &bytes);
            resp.set_status(status);
            resp.headers_mut()
                .set("Content-Length", text.len().to_string());
            let _ = resp.write(text.as_bytes()).await;
            return;
        }
        while let Some(Ok(frame)) = answer_body.frame().await {
            if let Ok(data) = frame.into_data() {
                if resp.write(&data).await.is_err() {
                    return;
                }
                let _ = resp.flush().await;
            }
        }
    }
}

const DRAFT_2024: &str = "2024-10-07";
const LEGACY_2024: &str = "2024-11-05";
const MODERN: &str = "2026-07-28";

/// Node's body-first era rule: initialize is legacy; otherwise the body's
/// _meta claim, then the header, decide.
fn is_modern(message: &Value, header: Option<&str>) -> bool {
    if message.get("method").and_then(Value::as_str) == Some("initialize") {
        return false;
    }
    let claim = message
        .pointer("/params/_meta/io.modelcontextprotocol~1protocolVersion")
        .and_then(Value::as_str);
    claim.or(header).is_some_and(|v| v >= MODERN)
}

/// Where rmcp's JSON errors differ from Node's: Node names every missing
/// method "Method not found", and its edge refusals carry `data` and HTTP 400.
fn node_error_shape(status: u16, bytes: &[u8]) -> (u16, String) {
    let Ok(mut message) = serde_json::from_slice::<Value>(bytes) else {
        return (status, String::from_utf8_lossy(bytes).into_owned());
    };
    let mut status = status;
    if let Some(error) = message.get_mut("error").and_then(Value::as_object_mut) {
        let code = error.get("code").and_then(Value::as_i64);
        match code {
            Some(-32601) => {
                error.insert(
                    "message".to_owned(),
                    Value::String("Method not found".to_owned()),
                );
            }
            Some(-32020) => {
                error.entry("data").or_insert_with(|| serde_json::json!({}));
            }
            Some(-32602)
                if error
                    .get("message")
                    .and_then(Value::as_str)
                    .is_some_and(|m| {
                        m.starts_with("request _meta is missing or has malformed")
                    }) =>
            {
                // The SDK's envelope check: an edge refusal in Node, not an in-band one.
                status = 400;
                error.entry("data").or_insert_with(|| serde_json::json!({}));
            }
            _ => {}
        }
    }
    (status, message.to_string())
}

pub struct Listening {
    pub url: String,
    pub serve: std::pin::Pin<Box<dyn std::future::Future<Output = std::io::Result<()>> + Send>>,
    /// Stops accepting and waits up to the grace for requests in flight.
    pub server: Arc<Server>,
}

fn split_listen(listen: &str) -> (String, u16) {
    let at = listen.rfind(':').unwrap_or(listen.len());
    let host = listen[..at]
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_owned();
    let port = listen
        .get(at + 1..)
        .and_then(|p| p.parse().ok())
        .unwrap_or(0);
    (host, port)
}

pub async fn listen(
    listen: &str,
    handler: Handler,
    oauth: Option<OAuth>,
    principal: String,
    public: bool,
) -> std::io::Result<Listening> {
    let (host, port) = split_listen(listen);
    let listener = tokio::net::TcpListener::bind((host.as_str(), port)).await?;
    let address: SocketAddr = listener.local_addr()?;
    let port = address.port();
    let service = |json_response: bool| {
        let mut config = StreamableHttpServerConfig::default();
        config.legacy_session_mode = false;
        config.json_response = json_response;
        // The front door already checked Host and Origin, Node's way.
        config.allowed_hosts.clear();
        let handler = handler.clone();
        StreamableHttpService::new(
            move || Ok(handler.clone()),
            Arc::new(NeverSessionManager::default()),
            config,
        )
    };
    let front = Arc::new(Front {
        json: service(true),
        sse: service(false),
        oauth,
        principal,
        public,
        port,
    });
    let server = Arc::new(Server::new(
        move |req, resp| front.clone().serve(req, resp),
        Config {
            server_header: None,
            request_timeout: None,
            ..Config::default()
        },
    ));
    let shown = match address {
        SocketAddr::V6(v6) => format!("[{}]", v6.ip()),
        SocketAddr::V4(v4) => v4.ip().to_string(),
    };
    Ok(Listening {
        url: format!("http://{shown}:{port}"),
        serve: {
            let server = server.clone();
            Box::pin(async move { server.serve(listener).await })
        },
        server,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_era_comes_from_the_body_then_the_header() {
        let init = serde_json::json!({ "method": "initialize" });
        assert!(!is_modern(&init, Some("2026-07-28")));
        let claimed = serde_json::json!({ "method": "tools/list", "params": { "_meta": { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } });
        assert!(is_modern(&claimed, Some("2025-06-18")));
        let bare = serde_json::json!({ "method": "tools/list" });
        assert!(is_modern(&bare, Some("2026-07-28")));
        assert!(!is_modern(&bare, None));
    }

    #[test]
    fn json_errors_take_node_messages() {
        let (status, text) = node_error_shape(
            404,
            br#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"ping"}}"#,
        );
        assert_eq!(status, 404);
        assert_eq!(
            text,
            r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}"#
        );
        let (status, text) = node_error_shape(
            200,
            br#"{"jsonrpc":"2.0","id":4,"error":{"code":-32602,"message":"request _meta is missing or has malformed required fields: x"}}"#,
        );
        assert_eq!(status, 400);
        assert!(text.contains(r#""data":{}"#));
    }

    #[test]
    fn origins_are_loopback_http_with_any_port_case_sensitive() {
        for ok in [
            "http://localhost",
            "http://localhost:9",
            "http://127.0.0.1",
            "http://[::1]:5",
        ] {
            assert!(loopback_origin(ok), "{ok}");
        }
        for refused in [
            "http://LOCALHOST",
            "https://localhost",
            "null",
            "http://evil.test",
            "http://localhost.evil.test",
            "http://127.0.0.1:80/x",
            "http://localhost:",
        ] {
            assert!(!loopback_origin(refused), "{refused}");
        }
    }

    #[test]
    fn hosts_need_a_loopback_name_and_the_bound_port() {
        assert!(loopback_host(Some("LOCALHOST:5"), 5));
        assert!(loopback_host(Some("[::1]:5"), 5));
        assert!(!loopback_host(Some("127.0.0.1"), 5));
        assert!(!loopback_host(Some("localhost:1"), 5));
        assert!(!loopback_host(Some("127.0.0.1:05"), 5));
        assert!(!loopback_host(Some("127.0.0.2:5"), 5));
        assert!(!loopback_host(None, 5));
    }
}
