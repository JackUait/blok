//! Streamable HTTP (src/mcp/http.ts): Blok's own front door on blok-http,
//! then rmcp's StreamableHttpService behind an adapter. The front door does
//! everything Node does before its SDK sees the request.

use std::future::Future;
use std::net::SocketAddr;
use std::pin::Pin;
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
/// How long answers ending together are gathered to keep the batch's order.
const BATCH_SETTLE: std::time::Duration = std::time::Duration::from_millis(5);
const LOOPBACK_HOST_NAMES: [&str; 3] = ["localhost", "127.0.0.1", "[::1]"];

type Service = StreamableHttpService<Handler, NeverSessionManager>;

pub struct Front {
    core: Core,
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
/// the Host a loopback name with the port the request came in on, or one of
/// the app's own names. Past them it answers as the CLI's front door does.
///
/// With neither OAuth nor the app's own host names, only a loopback peer is
/// served, as Node binds loopback itself: a Host header proves nothing about
/// the caller. A host behind a proxy (the peer is the proxy) must set OAuth
/// or name its hosts. Naming hosts admits remote callers without OAuth.
pub struct EmbeddedHttp {
    core: Core,
    hosts: Option<Vec<String>>,
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
        EmbeddedHttp {
            core: Core::new(&handler, oauth, principal),
            hosts: hosts.map(|hosts| hosts.iter().map(|h| h.to_lowercase()).collect()),
        }
    }

    fn host_allowed(&self, host: Option<&str>, port: u16) -> bool {
        let Some(hosts) = &self.hosts else {
            return loopback_host(host, port);
        };
        let Some(host) = host.map(str::to_lowercase) else {
            return false;
        };
        let name = match host.rfind(':') {
            Some(at) if !host.ends_with(']') => &host[..at],
            _ => host.as_str(),
        };
        hosts.iter().any(|h| *h == host || *h == name)
    }

    /// One request from `peer`, the socket address that sent it, taken on
    /// `local`, the address the host's server accepted it on: 403 for a
    /// foreign Origin or Host, or a remote peer with no opt-in; else the
    /// answer the CLI's front door gives.
    ///
    /// The body is already read, so the 413 past 4 MiB bounds nothing: the
    /// caller must cap the body at 4 MiB while reading it (for example with
    /// `http_body_util::Limited`) and answer 413 itself, as Node does.
    pub async fn handle(
        &self,
        peer: SocketAddr,
        local: SocketAddr,
        request: http::Request<Full<Bytes>>,
    ) -> Answer {
        let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok());
        let opted_in = self.core.oauth.is_some() || self.hosts.is_some();
        if (!opted_in && !is_loopback(peer.ip()))
            || header("origin").is_some_and(|o| !loopback_origin(o))
            || !self.host_allowed(header("host"), local.port())
        {
            return answer(403, None, Bytes::new(), &[]);
        }
        let target = request
            .uri()
            .path_and_query()
            .map_or("/", |p| p.as_str())
            .to_owned();
        let method = request.method().as_str().to_owned();
        let headers: Vec<(String, String)> = request
            .headers()
            .iter()
            .map(|(n, v)| {
                (
                    n.as_str().to_owned(),
                    String::from_utf8_lossy(v.as_bytes()).into_owned(),
                )
            })
            .collect();
        let identity = match self.core.gate(&method, &target, &headers).await {
            Ok(identity) => identity,
            Err(refused) => return *refused,
        };
        let Ok(body) = request.into_body().collect().await;
        let body = body.to_bytes();
        if body.len() > MAX_BODY {
            return answer(413, None, Bytes::new(), &[]);
        }
        self.core
            .post(identity, &method, &target, &headers, body.to_vec())
            .await
    }
}

/// A loopback address, IPv4-mapped IPv6 too.
fn is_loopback(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => v4.is_loopback(),
        std::net::IpAddr::V6(v6) => {
            v6.is_loopback() || v6.to_ipv4_mapped().is_some_and(|v4| v4.is_loopback())
        }
    }
}

type Body = http_body_util::combinators::BoxBody<Bytes, std::convert::Infallible>;
pub type Answer = http::Response<Body>;

fn answer(
    status: u16,
    content_type: Option<&str>,
    body: impl Into<Bytes>,
    extra: &[(&str, &str)],
) -> Answer {
    let mut out = http::Response::new(
        Full::new(body.into())
            .map_err(|never| match never {})
            .boxed(),
    );
    *out.status_mut() =
        http::StatusCode::from_u16(status).unwrap_or(http::StatusCode::INTERNAL_SERVER_ERROR);
    let headers = out.headers_mut();
    if let Some(kind) = content_type {
        headers.insert(
            "content-type",
            http::HeaderValue::from_str(kind)
                .unwrap_or(http::HeaderValue::from_static("application/json")),
        );
    }
    for (name, value) in extra {
        if let (Ok(name), Ok(value)) = (
            http::HeaderName::from_bytes(name.as_bytes()),
            http::HeaderValue::from_str(value),
        ) {
            headers.insert(name, value);
        }
    }
    out
}

fn json_answer(status: u16, body: String) -> Answer {
    answer(status, Some("application/json"), body, &[])
}

/// The JSON-RPC error answer Node's SDK builds at its entry.
fn rpc_error(status: u16, code: i64, message: &str, id: Value) -> Answer {
    json_answer(
        status,
        serde_json::json!({ "jsonrpc": "2.0", "error": { "code": code, "message": message }, "id": id })
            .to_string(),
    )
}

/// The SDK's echoableRequestId: a single request's string or number id.
fn echoable_id(message: &Value) -> Value {
    match (message.get("method"), message.get("id")) {
        (Some(Value::String(_)), Some(id @ (Value::String(_) | Value::Number(_)))) => {
            js_number_id(id)
        }
        _ => Value::Null,
    }
}

/// An id as JSON.stringify writes the number JSON.parse read.
fn js_number_id(id: &Value) -> Value {
    let Value::Number(number) = id else {
        return id.clone();
    };
    blok_jsjson::parse(number.to_string().as_bytes())
        .ok()
        .and_then(|v| blok_jsjson::stringify(&v).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| id.clone())
}

/// What a JSON-RPC body is, by the SDK's strict zod schemas.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Request,
    Notification,
    Response,
    Invalid,
}

const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

fn kind_of(message: &Value) -> Kind {
    let Value::Object(fields) = message else {
        return Kind::Invalid;
    };
    if fields.get("jsonrpc") != Some(&Value::String("2.0".to_owned())) {
        return Kind::Invalid;
    }
    // zod's int(): a safe integer, so 1.0 is one and 1.5 is not.
    let id_ok = |id: &Value| match id {
        Value::String(_) => true,
        Value::Number(n) => n
            .as_f64()
            .is_some_and(|f| f.fract() == 0.0 && f.abs() <= MAX_SAFE_INTEGER),
        _ => false,
    };
    let only = |allowed: &[&str]| fields.keys().all(|k| allowed.contains(&k.as_str()));
    let params_ok = fields.get("params").is_none_or(Value::is_object);
    let method_ok = fields.get("method").is_some_and(Value::is_string);
    if method_ok && params_ok {
        if let Some(id) = fields.get("id") {
            if id_ok(id) && only(&["jsonrpc", "id", "method", "params"]) {
                return Kind::Request;
            }
        } else if only(&["jsonrpc", "method", "params"]) {
            return Kind::Notification;
        }
        return Kind::Invalid;
    }
    if fields.get("id").is_some_and(id_ok)
        && fields.get("result").is_some_and(Value::is_object)
        && only(&["jsonrpc", "id", "result"])
    {
        return Kind::Response;
    }
    let error_ok = fields.get("error").is_some_and(|e| {
        e.get("code").is_some_and(|c| {
            c.as_f64()
                .is_some_and(|f| f.fract() == 0.0 && f.abs() <= MAX_SAFE_INTEGER)
        }) && e.get("message").is_some_and(Value::is_string)
    });
    if error_ok && fields.get("id").is_none_or(id_ok) && only(&["jsonrpc", "id", "error"]) {
        return Kind::Response;
    }
    Kind::Invalid
}

/// The versions the SDK takes in MCP-Protocol-Version, newest first.
const LEGACY_VERSIONS: [&str; 5] = [
    "2025-11-25",
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
    "2024-10-07",
];

/// The SDK's refusal of an MCP-Protocol-Version it does not serve; None when it does.
fn unsupported_version(header: Option<&str>) -> Option<Answer> {
    // The SDK strips HTTP whitespace first.
    let version = header?.trim_matches([' ', '\t']);
    if version == MODERN || LEGACY_VERSIONS.contains(&version) {
        return None;
    }
    let message = format!(
        "Bad Request: Unsupported protocol version: {version} (supported versions: {})",
        LEGACY_VERSIONS.join(", ")
    );
    Some(rpc_error(400, -32000, &message, Value::Null))
}

fn header_of<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(n, _)| n.eq_ignore_ascii_case(name))
        .map(|(_, v)| v.as_str())
}

/// What both front doors share past their own Origin and Host checks:
/// rmcp's services, the OAuth gate and Node's request shaping.
struct Core {
    services: Services,
    oauth: Option<OAuth>,
    principal: String,
}

/// rmcp's two services: JSON answers for 2026-07-28, SSE for earlier eras.
struct Services {
    json: Service,
    sse: Service,
}

impl Core {
    fn new(handler: &Handler, oauth: Option<OAuth>, principal: String) -> Core {
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
        Core {
            services: Services {
                json: service(true),
                sse: service(false),
            },
            oauth,
            principal,
        }
    }

    /// Before the body is read: the metadata route, the path, the bearer
    /// gate (it reads only the header, so a refused caller never gets a
    /// body read) and the method.
    async fn gate(
        &self,
        method: &str,
        target: &str,
        headers: &[(String, String)],
    ) -> Result<HttpIdentity, Box<Answer>> {
        let path = target.split('?').next().unwrap_or_default();
        if let Some(oauth) = &self.oauth
            && method == "GET"
            && path == METADATA_PATH
        {
            return Err(Box::new(json_answer(200, oauth.metadata())));
        }
        if path != MCP_PATH {
            return Err(Box::new(answer(404, None, Bytes::new(), &[])));
        }
        let identity = match &self.oauth {
            None => HttpIdentity {
                principal: self.principal.clone(),
                scopes: None,
            },
            Some(oauth) => match oauth
                .authenticate(header_of(headers, "authorization"))
                .await
            {
                Ok(verified) => HttpIdentity {
                    principal: verified.principal,
                    scopes: Some(verified.scopes),
                },
                Err(refusal) => {
                    return Err(Box::new(answer(
                        refusal.status,
                        Some("application/json"),
                        refusal.body,
                        &[("www-authenticate", &refusal.challenge)],
                    )));
                }
            },
        };
        if method != "POST" {
            return Err(Box::new(answer(
                405,
                Some("application/json"),
                r#"{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}"#,
                &[("allow", "POST")],
            )));
        }
        Ok(identity)
    }

    /// Node's shaping of a POST body, then rmcp's answer.
    async fn post(
        &self,
        identity: HttpIdentity,
        method: &str,
        target: &str,
        headers: &[(String, String)],
        body: Vec<u8>,
    ) -> Answer {
        // The SDK reads the body as UTF-8 with replacement.
        let text = match String::from_utf8(body) {
            Ok(text) => text,
            Err(bytes) => String::from_utf8_lossy(bytes.as_bytes()).into_owned(),
        };
        // TextDecoder drops a leading BOM.
        let text = match text.strip_prefix('\u{feff}') {
            Some(rest) => rest.to_owned(),
            None => text,
        };
        // JSON.parse takes a lone surrogate and any depth; serde_json does not.
        let text = crate::lenient::mend(&crate::depth::clamp(&text, crate::depth::MESSAGE_LIMIT));
        let header_version = header_of(headers, "mcp-protocol-version");
        let text = match crate::shape::shape(&text) {
            crate::shape::Shaped::Forward(text) => text,
            crate::shape::Shaped::NotAMessage(id) => {
                return rpc_error(400, -32600, crate::shape::NOT_A_MESSAGE, id);
            }
            crate::shape::Shaped::Refused(refusal) => {
                let modern = serde_json::from_str::<Value>(&text)
                    .is_ok_and(|m| is_modern(&m, header_version));
                if modern {
                    return json_answer(200, refusal);
                }
                // 2025 answers are SSE, as Node's SDK sends them.
                return answer(
                    200,
                    Some("text/event-stream"),
                    format!("event: message\ndata: {refusal}\n\n"),
                    &[("cache-control", "no-cache")],
                );
            }
        };
        let Ok(message) = serde_json::from_str::<Value>(&text) else {
            return rpc_error(400, -32700, "Parse error: Invalid JSON", Value::Null);
        };
        if let Value::Array(items) = &message {
            return self.batch(identity, method, target, headers, items).await;
        }
        let kind = kind_of(&message);
        match kind {
            Kind::Invalid => {
                return rpc_error(
                    400,
                    -32600,
                    crate::shape::NOT_A_MESSAGE,
                    echoable_id(&message),
                );
            }
            // Node takes a posted response and drops it.
            Kind::Response => return answer(202, None, Bytes::new(), &[]),
            Kind::Request
                if message.get("method").and_then(Value::as_str) != Some("initialize") =>
            {
                if let Some(refused) = unsupported_version(header_version) {
                    return refused;
                }
            }
            _ => {}
        }
        let initialize = message.get("method").and_then(Value::as_str) == Some("initialize");
        if kind == Kind::Request
            && !initialize
            && let Some(refused) = missing_envelope(&message, header_version)
        {
            return refused;
        }
        let modern = is_modern(&message, header_version);
        // initialize names its version in the body, and Node's SDK serves it
        // whatever older version the header names; rmcp refuses a mismatch.
        let mut headers: Vec<(String, String)> = headers
            .iter()
            .filter(|(name, value)| {
                !(initialize
                    && name.eq_ignore_ascii_case("mcp-protocol-version")
                    && value.trim_matches([' ', '\t']) < MODERN)
            })
            .cloned()
            .collect();
        // Node's SDK asks no Mcp-Method of a notification; rmcp refuses one without it.
        if kind == Kind::Notification
            && modern
            && header_of(&headers, "mcp-method").is_none()
            && let Some(name) = message.get("method").and_then(Value::as_str)
        {
            headers.push(("mcp-method".to_owned(), name.to_owned()));
        }
        self.services
            .forward(identity, method, target, &headers, text, modern)
            .await
    }

    /// A legacy batch, as Node's SDK serves it: each request answered as
    /// one SSE event, notifications and responses taken without one.
    async fn batch(
        &self,
        identity: HttpIdentity,
        method: &str,
        target: &str,
        headers: &[(String, String)],
        items: &[Value],
    ) -> Answer {
        if items.is_empty() {
            return rpc_error(
                400,
                -32600,
                "Bad Request: empty JSON-RPC batch",
                Value::Null,
            );
        }
        let claims = |item: &Value| {
            item.pointer("/params/_meta")
                .and_then(Value::as_object)
                .is_some_and(|meta| meta.contains_key("io.modelcontextprotocol/protocolVersion"))
        };
        if items.iter().any(claims) {
            return rpc_error(
                400,
                -32600,
                "Bad Request: JSON-RPC batches may not contain requests for protocol revision 2026-07-28 or later",
                Value::Null,
            );
        }
        if items.iter().any(|item| kind_of(item) == Kind::Invalid) {
            return rpc_error(
                400,
                -32600,
                "Bad Request: JSON-RPC batch contains an invalid message",
                Value::Null,
            );
        }
        // Node runs the requests together and writes each answer as it ends.
        let mut running: Vec<Option<Pin<Box<dyn Future<Output = Bytes> + Send + '_>>>> = items
            .iter()
            .filter(|item| kind_of(item) != Kind::Response)
            .map(|item| {
                let reply = self.services.forward(
                    identity.clone(),
                    method,
                    target,
                    headers,
                    item.to_string(),
                    false,
                );
                Some(Box::pin(async move {
                    let Ok(collected) = reply.await.into_body().collect().await;
                    collected.to_bytes()
                })
                    as Pin<Box<dyn Future<Output = Bytes> + Send + '_>>)
            })
            .collect();
        let mut finished: Vec<Option<Bytes>> = vec![None; running.len()];
        type Running<'a> = Vec<Option<Pin<Box<dyn Future<Output = Bytes> + Send + 'a>>>>;
        fn poll_all(
            running: &mut Running<'_>,
            finished: &mut [Option<Bytes>],
            cx: &mut std::task::Context<'_>,
        ) -> bool {
            let mut any = false;
            for (slot, out) in running.iter_mut().zip(finished.iter_mut()) {
                if let Some(reply) = slot
                    && let std::task::Poll::Ready(bytes) = reply.as_mut().poll(cx)
                {
                    *out = Some(bytes);
                    *slot = None;
                    any = true;
                }
            }
            any
        }
        let mut events = String::new();
        let mut left = finished.len();
        while left > 0 {
            std::future::poll_fn(|cx| {
                if poll_all(&mut running, &mut finished, cx) {
                    std::task::Poll::Ready(())
                } else {
                    std::task::Poll::Pending
                }
            })
            .await;
            // rmcp runs each request on its own task, so two instant ones can
            // end in either order; Node's single thread ends them in batch order.
            tokio::time::sleep(BATCH_SETTLE).await;
            std::future::poll_fn(|cx| {
                std::task::Poll::Ready(poll_all(&mut running, &mut finished, cx))
            })
            .await;
            for bytes in finished.iter_mut().filter_map(Option::take) {
                left -= 1;
                let text = String::from_utf8_lossy(&bytes);
                if text.trim_start().starts_with('{') {
                    events.push_str(&format!("event: message\ndata: {}\n\n", text.trim()));
                    continue;
                }
                for data in text.lines().filter_map(|line| line.strip_prefix("data: ")) {
                    events.push_str(&format!("event: message\ndata: {data}\n\n"));
                }
            }
        }
        if events.is_empty() {
            return answer(202, None, Bytes::new(), &[]);
        }
        answer(
            200,
            Some("text/event-stream"),
            events,
            &[("cache-control", "no-cache")],
        )
    }
}

impl Services {
    /// One message through rmcp: 2026-07-28 answers are JSON and earlier
    /// ones SSE, as Node's SDK sends them.
    async fn forward(
        &self,
        identity: HttpIdentity,
        method: &str,
        target: &str,
        headers: &[(String, String)],
        text: String,
        modern: bool,
    ) -> Answer {
        let mut builder = http::Request::builder().method(method).uri(target);
        for (name, value) in headers {
            // The body may have changed: rmcp reads its own length.
            if name.eq_ignore_ascii_case("content-length") {
                continue;
            }
            // Node's SDK still takes this draft revision; rmcp refuses it with 400.
            let value = if name.eq_ignore_ascii_case("mcp-protocol-version") && value == DRAFT_2024
            {
                LEGACY_2024
            } else {
                value.as_str()
            };
            builder = builder.header(name.as_str(), value);
        }
        let Ok(mut request) = builder.body(Full::new(Bytes::from(text))) else {
            return answer(400, None, Bytes::new(), &[]);
        };
        request.extensions_mut().insert(identity);
        let service = if modern { &self.json } else { &self.sse };
        let reply = service.handle(request).await;
        let (mut parts, body) = reply.into_parts();
        let kind = parts
            .headers
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_owned();
        if kind.starts_with("application/json") {
            let Ok(collected) = body.collect().await;
            let (status, text) = node_error_shape(parts.status.as_u16(), &collected.to_bytes());
            parts.status = http::StatusCode::from_u16(status).unwrap_or(parts.status);
            parts.headers.remove("content-length");
            let body = Full::new(Bytes::from(text))
                .map_err(|never| match never {})
                .boxed();
            return http::Response::from_parts(parts, body);
        }
        // rmcp's plain-text refusals (406, 415, 400): Node's carry a JSON-RPC body.
        if parts.status.as_u16() >= 400 && !kind.starts_with("text/event-stream") {
            let Ok(collected) = body.collect().await;
            let message = String::from_utf8_lossy(&collected.to_bytes())
                .trim()
                .to_owned();
            return rpc_error(parts.status.as_u16(), -32000, &message, Value::Null);
        }
        if kind.starts_with("text/event-stream") {
            return http::Response::from_parts(parts, node_events(body));
        }
        http::Response::from_parts(parts, body)
    }
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

/// Writes `reply` out: SSE streams frame by frame as it comes; anything
/// else goes out whole, with its length.
async fn write(resp: &mut ResponseWriter, reply: Answer) {
    let (parts, mut body) = reply.into_parts();
    resp.set_status(parts.status.as_u16());
    for (name, value) in &parts.headers {
        if name.as_str().eq_ignore_ascii_case("content-length") {
            continue;
        }
        resp.headers_mut()
            .add(name.as_str(), value.to_str().unwrap_or_default());
    }
    let streams = parts
        .headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("text/event-stream"));
    if !streams {
        let Ok(collected) = body.collect().await;
        let bytes = collected.to_bytes();
        resp.headers_mut()
            .set("Content-Length", bytes.len().to_string());
        let _ = resp.write(&bytes).await;
        return;
    }
    while let Some(Ok(frame)) = body.frame().await {
        if let Ok(data) = frame.into_data() {
            if resp.write(&data).await.is_err() {
                return;
            }
            let _ = resp.flush().await;
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
            return write(&mut resp, answer(403, None, Bytes::new(), &[])).await;
        }
        let method = req.method().to_owned();
        let target = req.target().to_owned();
        let headers: Vec<(String, String)> = req
            .headers()
            .iter()
            .map(|(n, v)| (n.to_owned(), v.to_owned()))
            .collect();
        let identity = match self.core.gate(&method, &target, &headers).await {
            Ok(identity) => identity,
            Err(refused) => return write(&mut resp, *refused).await,
        };
        let body = match read_body(&mut req).await {
            Read::Body(body) => body,
            Read::TooLarge => {
                return write(&mut resp, answer(413, None, Bytes::new(), &[])).await;
            }
            Read::Failed => return write(&mut resp, answer(400, None, Bytes::new(), &[])).await,
        };
        let reply = self
            .core
            .post(identity, &method, &target, &headers, body)
            .await;
        write(&mut resp, reply).await;
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

const PROTOCOL_VERSION_KEY: &str = "io.modelcontextprotocol/protocolVersion";
const CAPABILITIES_KEY: &str = "io.modelcontextprotocol/clientCapabilities";

/// The SDK's envelope rung: a request whose header names 2026-07-28 while
/// its _meta makes no claim is refused, naming the keys it lacks.
fn missing_envelope(message: &Value, header: Option<&str>) -> Option<Answer> {
    let version = header?.trim_matches([' ', '\t']);
    if version != MODERN {
        return None;
    }
    let meta = message.pointer("/params/_meta").and_then(Value::as_object);
    if meta.is_some_and(|meta| meta.contains_key(PROTOCOL_VERSION_KEY)) {
        return None;
    }
    let missing: Vec<&str> = match meta {
        None => vec!["_meta"],
        Some(meta) => [PROTOCOL_VERSION_KEY, CAPABILITIES_KEY]
            .into_iter()
            .filter(|key| !meta.contains_key(*key))
            .collect(),
    };
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "error": {
            "code": -32602,
            "message": format!("Invalid params: the MCP-Protocol-Version header names protocol revision {version}, but the request is missing the required per-request envelope key(s): {}", missing.join(", ")),
            "data": { "envelope": { "missing": missing } },
        },
        "id": echoable_id(message),
    });
    Some(json_answer(400, body.to_string()))
}

/// rmcp's SSE events as Node's SDK writes them: `event: message` before the
/// data, and a comment-only event as Node's keep-alive. rmcp's empty
/// priming event has no Node twin.
fn node_events(mut body: Body) -> Body {
    let (mut sender, channel) = http_body_util::Channel::<Bytes, std::convert::Infallible>::new(4);
    tokio::spawn(async move {
        let mut pending: Vec<u8> = Vec::new();
        while let Some(Ok(frame)) = body.frame().await {
            let Ok(data) = frame.into_data() else {
                continue;
            };
            pending.extend_from_slice(&data);
            while let Some(end) = pending.windows(2).position(|w| w == b"\n\n") {
                let event: Vec<u8> = pending.drain(..end + 2).collect();
                let Some(out) = node_event(&String::from_utf8_lossy(&event)) else {
                    continue;
                };
                // The client went away: dropping rmcp's body cancels the work.
                if sender.send_data(Bytes::from(out)).await.is_err() {
                    return;
                }
            }
        }
    });
    channel.boxed()
}

fn node_event(event: &str) -> Option<String> {
    let data: Vec<&str> = event
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|data| data.strip_prefix(' ').unwrap_or(data))
        .collect();
    if data.is_empty() {
        return event
            .lines()
            .any(|line| line.starts_with(':'))
            .then(|| ": keepalive\n\n".to_owned());
    }
    if data.iter().all(|line| line.is_empty()) {
        return None;
    }
    let lines: Vec<String> = data.iter().map(|line| format!("data: {line}")).collect();
    Some(format!("event: message\n{}\n\n", lines.join("\n")))
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

/// Node's splitListen: up to five digits after the last colon, 0 to 65535.
fn split_listen(listen: &str) -> std::io::Result<(String, u16)> {
    let refused = || {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("--http needs a port from 0 to 65535 after the last \":\", got \"{listen}\""),
        )
    };
    let at = listen.rfind(':').ok_or_else(refused)?;
    let text = &listen[at + 1..];
    if text.len() > 5 || !text.bytes().all(|b| b.is_ascii_digit()) {
        return Err(refused());
    }
    let port = if text.is_empty() {
        0
    } else {
        text.parse::<u32>()
            .ok()
            .and_then(|n| u16::try_from(n).ok())
            .ok_or_else(refused)?
    };
    let host = &listen[..at];
    let host = host.strip_prefix('[').unwrap_or(host);
    let host = host.strip_suffix(']').unwrap_or(host);
    Ok((host.to_owned(), port))
}

/// Binds the first address the host names, as Node's listen() does, and
/// words a failure as Node prints it.
async fn bind(listen: &str) -> std::io::Result<tokio::net::TcpListener> {
    let (host, port) = split_listen(listen)?;
    let failed =
        |detail: String| std::io::Error::other(format!("Cannot listen on {listen}: {detail}"));
    let address = match tokio::net::lookup_host((host.as_str(), port))
        .await
        .ok()
        .and_then(|mut found| found.next())
    {
        Some(address) => address,
        None => return Err(failed(format!("getaddrinfo ENOTFOUND {host}"))),
    };
    tokio::net::TcpListener::bind(address).await.map_err(|err| {
        let words = match err.kind() {
            std::io::ErrorKind::AddrInUse => "EADDRINUSE: address already in use",
            std::io::ErrorKind::AddrNotAvailable => "EADDRNOTAVAIL: address not available",
            std::io::ErrorKind::PermissionDenied => "EACCES: permission denied",
            _ => return failed(err.to_string()),
        };
        let shown = match port {
            0 => address.ip().to_string(),
            port => format!("{}:{port}", address.ip()),
        };
        failed(format!("listen {words} {shown}"))
    })
}

pub async fn listen(
    listen: &str,
    handler: Handler,
    oauth: Option<OAuth>,
    principal: String,
    public: bool,
) -> std::io::Result<Listening> {
    let listener = bind(listen).await?;
    let address: SocketAddr = listener.local_addr()?;
    let port = address.port();
    let front = Arc::new(Front {
        core: Core::new(&handler, oauth, principal),
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

    // Node's splitListen: up to five digits after the last colon, 0 to
    // 65535; an empty port is 0, a free one.
    #[test]
    fn a_port_node_cannot_listen_on_is_refused() {
        assert_eq!(
            split_listen("127.0.0.1:").unwrap(),
            ("127.0.0.1".to_owned(), 0)
        );
        assert_eq!(split_listen("[::1]:80").unwrap(), ("::1".to_owned(), 80));
        assert_eq!(split_listen("h:65535").unwrap().1, 65535);
        for bad in [
            "h:abc", "h:99999", "h:-1", "h:65535x", "h:1.5", "h:NaN", "h:inf", "h:0x10",
            "h:8080.0", "h: 0", "h:000001", "h",
        ] {
            assert_eq!(
                split_listen(bad).unwrap_err().to_string(),
                format!("--http needs a port from 0 to 65535 after the last \":\", got \"{bad}\""),
                "{bad}"
            );
        }
    }

    // Node prints libuv's words for a failed bind and getaddrinfo's for a
    // name that does not resolve.
    #[tokio::test]
    async fn a_failed_bind_is_worded_as_node_words_it() {
        let held = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = held.local_addr().unwrap().port();
        let listen = format!("127.0.0.1:{port}");
        let Err(err) = bind(&listen).await else {
            panic!("bound a port in use");
        };
        assert_eq!(
            err.to_string(),
            format!(
                "Cannot listen on {listen}: listen EADDRINUSE: address already in use 127.0.0.1:{port}"
            )
        );
        let Err(err) = bind("203.0.113.9:0").await else {
            panic!("bound an address this host lacks");
        };
        assert_eq!(
            err.to_string(),
            "Cannot listen on 203.0.113.9:0: listen EADDRNOTAVAIL: address not available 203.0.113.9"
        );
        let Err(err) = bind("nope.invalid:0").await else {
            panic!("bound a name that does not resolve");
        };
        assert_eq!(
            err.to_string(),
            "Cannot listen on nope.invalid:0: getaddrinfo ENOTFOUND nope.invalid"
        );
    }

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

    // Node: `event: message` before data, `: keepalive` comments, and no
    // empty priming event.
    #[test]
    fn sse_events_are_written_as_nodes_sdk_writes_them() {
        assert_eq!(
            node_event("data: {}\nid: 0\n\n").as_deref(),
            Some("event: message\ndata: {}\n\n")
        );
        assert_eq!(node_event(":\n\n").as_deref(), Some(": keepalive\n\n"));
        assert_eq!(node_event("data:\nretry: 3000\n\n"), None);
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
