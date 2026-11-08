//! Blok's MCP tools on your own MCP server.
//!
//! This host has its own serverInfo ("host-example"), its own instructions,
//! one tool (host_echo) and one prompt (host_hello). It adds Blok's blok_*
//! tools and prompts with `BlokTools`, configured by the same flags and env
//! as `blok-mcp` (`cli::parse`).
//!
//!   cargo run --release -p blok-mcp --example embed -- \
//!     --source files:./docs --authorize <url> [--http 127.0.0.1:0]
//!
//! Signing in is the host's job; this example fakes it:
//!   HTTP   `X-Example-User: <name>` signs the caller in as <name>.
//!          `X-Example-Signed-In: true` without X-Example-User signs them in
//!          without a name. Neither header: anonymous. `X-Example-Scopes: a,b`
//!          puts scopes on the sign-in; Blok ignores them by default.
//!   stdio  the one local user, "local".
//! Blok refuses anonymous and unnamed callers unless --example-allow-anonymous is given.
//!
//! Example flags (every other flag goes to Blok):
//!   --example-host-tool <name>             the host tool's name (default host_echo)
//!   --example-host-prompt <name>           the host prompt's name (default host_hello)
//!   --example-allow-anonymous <principal>  serve anonymous callers as this principal
//!   --example-source endpoint:<url>        your own document store, as `Hooks::source`
//!                                          (see ExampleSource; not with --source)
//!   --example-caller-error <text>          the caller hook fails with this text, as a
//!                                          host bug would; Blok logs it and answers
//!                                          "Blok could not run this call."
//!
//! The HTTP side keeps only what an example needs: no Origin checks and no
//! body cap of its own. Those, like OAuth, belong to your server.
//!
//! rmcp stamps no serverInfo on 2026-07-28 results, so this host stamps its
//! own on every one (`stamp`), Blok's included.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use blok_mcp::bundle::Bundle;
use blok_mcp::cli::{self, StartError};
use blok_mcp::document_source::{
    DocumentCaller, DocumentSource, ListedDocument, SourceError, SourceErrorKind, SourceList,
    SourceListing, StoredDocument,
};
use blok_mcp::embed::{BlokTools, CallerIdentity, EmbedHooks, SignedIn};
use blok_mcp::options::Hooks;
use blok_mcp::outbound::Outbound;
use blok_mcp::rmcp::model::{
    CallToolRequestParams, CallToolResponse, ErrorCode, GetPromptRequestParams, GetPromptResponse,
    ListPromptsResult, ListToolsResult, MetaObject, PaginatedRequestParams, ResultType,
    ServerConfig,
};
use blok_mcp::rmcp::service::{RequestContext, RoleServer};
use blok_mcp::rmcp::transport::streamable_http_server::session::never::NeverSessionManager;
use blok_mcp::rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService,
};
use blok_mcp::rmcp::{ErrorData, ServerHandler, ServiceExt};
use blok_mcp::sources::{encode_uri_component, form_encode, js_number};
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use serde_json::{Value, json};

const NAME: &str = "host-example";
const EXAMPLE_FLAGS: [&str; 5] = [
    "--example-host-tool",
    "--example-host-prompt",
    "--example-allow-anonymous",
    "--example-source",
    "--example-caller-error",
];
const MODERN: &str = "2026-07-28";
// How long a stop waits for Blok's calls in flight.
const DRAIN_LIMIT: Duration = Duration::from_secs(10);

/// Why the example did not start: printed as `host-example: <message>`.
enum Stop {
    /// A refusal: exit code 2.
    Config(String),
    /// Anything else: exit code 1.
    Failed(String),
}

impl From<StartError> for Stop {
    fn from(error: StartError) -> Self {
        match error {
            StartError::Config(message) => Stop::Config(message),
            StartError::Failed(message) => Stop::Failed(message),
            StartError::Bundle(error) => Stop::Failed(error.to_string()),
        }
    }
}

/// Splits this example's own flags from the blok-mcp ones. Each example flag takes a value.
fn split_args(argv: &[String]) -> Result<(HashMap<String, String>, Vec<String>), Stop> {
    let mut example = HashMap::new();
    let mut blok = Vec::new();
    let mut index = 0;
    while index < argv.len() {
        let arg = &argv[index];
        if !EXAMPLE_FLAGS.contains(&arg.as_str()) {
            blok.push(arg.clone());
            index += 1;
            continue;
        }
        match argv.get(index + 1) {
            Some(value) if !value.starts_with("--") => {
                example.insert(arg["--example-".len()..].to_owned(), value.clone());
            }
            _ => return Err(Stop::Config(format!("{arg} needs a value"))),
        }
        index += 2;
    }
    Ok((example, blok))
}

fn modern(context: &RequestContext<RoleServer>) -> bool {
    context
        .protocol_version()
        .is_some_and(|v| v.as_str() >= MODERN)
}

/// This server's identity on a 2026-07-28 result, as the Node SDK stamps it.
fn stamp(context: &RequestContext<RoleServer>) -> Option<MetaObject> {
    modern(context).then(|| {
        serde_json::from_value(json!({
            "io.modelcontextprotocol/serverInfo": { "name": NAME, "version": "1.0.0" },
        }))
        .expect("a meta object")
    })
}

fn not_found(what: &str, name: &str) -> ErrorData {
    ErrorData::new(
        ErrorCode::INVALID_PARAMS,
        format!("{what} {name} not found"),
        None,
    )
}

fn json_of<T: serde::de::DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).expect("a valid MCP result")
}

/// The host: its own tool and prompt, and Blok's.
#[derive(Clone)]
struct Host {
    blok: BlokTools,
    tool: String,
    prompt: String,
    instructions: String,
}

impl Host {
    fn tool(&self) -> Value {
        json!({
            "name": self.tool,
            "description": "Echoes the text back.",
            "inputSchema": { "type": "object", "properties": { "text": { "type": "string" } } },
        })
    }

    fn prompt(&self) -> Value {
        json!({ "name": self.prompt, "description": "Says hello." })
    }
}

impl ServerHandler for Host {
    fn get_info(&self) -> ServerConfig {
        // logging is the host's own capability.
        json_of(json!({
            "protocolVersion": "2025-11-25",
            "capabilities": { "tools": {}, "prompts": {}, "logging": {} },
            "serverInfo": { "name": NAME, "version": "1.0.0" },
            "instructions": self.instructions,
        }))
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let mut tools = vec![json_of(self.tool())];
        tools.extend(self.blok.tools()?);
        let mut result = ListToolsResult::with_all_items(tools);
        result.meta = stamp(&context);
        Ok(result)
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let meta = stamp(&context);
        if self.blok.owns_tool(&request.name) {
            return Ok(match self.blok.call_tool(request, context).await? {
                CallToolResponse::Complete(mut result) => {
                    result.meta = meta;
                    CallToolResponse::Complete(result)
                }
                CallToolResponse::InputRequired(mut result) => {
                    result.meta = meta;
                    CallToolResponse::InputRequired(result)
                }
                other => other,
            });
        }
        if request.name != self.tool {
            return Err(not_found("Tool", &request.name));
        }
        let text = match request.arguments.as_ref().and_then(|a| a.get("text")) {
            None | Some(Value::Null) => String::new(),
            Some(Value::String(text)) => text.clone(),
            Some(other) => other.to_string(),
        };
        let mut result: blok_mcp::rmcp::model::CallToolResult =
            json_of(json!({ "content": [{ "type": "text", "text": text }], "isError": false }));
        // rmcp leaves it out again for a 2025 client.
        result.result_type = Some(ResultType::COMPLETE);
        result.meta = meta;
        Ok(CallToolResponse::Complete(result))
    }

    async fn list_prompts(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListPromptsResult, ErrorData> {
        let mut prompts = vec![json_of(self.prompt())];
        prompts.extend(self.blok.prompts()?);
        let mut result = ListPromptsResult::with_all_items(prompts);
        result.meta = stamp(&context);
        Ok(result)
    }

    async fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<GetPromptResponse, ErrorData> {
        let meta = stamp(&context);
        if self.blok.owns_prompt(&request.name) {
            return Ok(match self.blok.get_prompt(request, context).await? {
                GetPromptResponse::Complete(mut result) => {
                    result.meta = meta;
                    GetPromptResponse::Complete(result)
                }
                other => other,
            });
        }
        if request.name != self.prompt {
            return Err(not_found("Prompt", &request.name));
        }
        let mut result: blok_mcp::rmcp::model::GetPromptResult = json_of(json!({
            "messages": [{ "role": "user", "content": { "type": "text", "text": "Hello from the host." } }],
        }));
        result.result_type = Some(ResultType::COMPLETE);
        result.meta = meta;
        Ok(GetPromptResponse::Complete(result))
    }
}

/*
 * --example-source endpoint:<url>: a custom document source that keeps
 * documents on a small HTTP store. A real host reads and writes its own
 * database here. The shared conformance suite
 * (test/unit/mcp-conformance/fixtures/embed.json) records this exact wire,
 * as packages/mcp/examples/embed/server.mjs speaks it:
 *
 *   <base>  <url> with one trailing "/" removed.
 *   <id>    the document id, percent-encoded as JS encodeURIComponent does: every UTF-8 byte
 *           is %XX (upper-case hex) except A-Z a-z 0-9 and - _ . ! ~ * ' ( ). Blok never passes
 *           "", "." or "..": it refuses those ids before it calls the source.
 *   Every request carries the caller, values sent as given:
 *     Blok-Caller: <caller.principal>
 *     Blok-Caller-Client: <caller.client_name>
 *     Blok-Caller-Actor: <caller.actor.id>
 *     Blok-Caller-On-Behalf-Of: <caller.actor.on_behalf_of>    left out when the actor has none
 *
 *   load  GET <base>/<id>
 *         200 body exactly `null`  -> never saved: load answers None.
 *         200 any other JSON body  -> documentText and version as given; documentText is the
 *                                     stored document as a JSON string, never parsed here, so
 *                                     Blok's own parser reads it.
 *   save  PUT <base>/<id>
 *         Content-Type: application/json; the body is documentText, byte for byte.
 *         Blok-If-Version: <if_version>, left out when it is None.
 *         200 JSON body            -> its version as given (absent = None).
 *   list  GET <base>?limit=<n>&query=<q>&cursor=<c>
 *         In that order; query and cursor left out when absent; values form-encoded as
 *         URLSearchParams does: space is "+", every other UTF-8 byte is %XX except
 *         A-Z a-z 0-9 and * - . _.
 *
 *   Any other answer, on every route:
 *     409 -> SourceError changed          503 -> SourceError unavailable
 *     403 -> SourceError forbidden        422 -> SourceError invalid_id
 *     with the body's JSON "message" when that is a string, else "" (Blok's own words).
 *   Every other status, a 200 body that is not JSON, or a network error: SourceError::Failed,
 *   which Blok logs and shows the agent as SOURCE_UNAVAILABLE.
 */
struct ExampleSource {
    base: String,
    outbound: Outbound,
}

// The store's own timeout; Blok's calls wait on it.
const STORE_TIMEOUT: Duration = Duration::from_secs(30);

fn refusal_kind(status: u16) -> Option<SourceErrorKind> {
    match status {
        409 => Some(SourceErrorKind::Changed),
        503 => Some(SourceErrorKind::Unavailable),
        403 => Some(SourceErrorKind::Forbidden),
        422 => Some(SourceErrorKind::InvalidId),
        _ => None,
    }
}

fn caller_headers(caller: &DocumentCaller) -> Vec<(String, String)> {
    let mut headers = vec![
        ("Blok-Caller".to_owned(), caller.principal.clone()),
        ("Blok-Caller-Client".to_owned(), caller.client_name.clone()),
        ("Blok-Caller-Actor".to_owned(), caller.actor.id.clone()),
    ];
    if let Some(on_behalf_of) = &caller.actor.on_behalf_of {
        headers.push(("Blok-Caller-On-Behalf-Of".to_owned(), on_behalf_of.clone()));
    }
    headers
}

fn string_at(body: &Value, key: &str) -> Option<String> {
    body.get(key).and_then(Value::as_str).map(str::to_owned)
}

impl ExampleSource {
    fn new(url: &str) -> ExampleSource {
        ExampleSource {
            base: url.strip_suffix('/').unwrap_or(url).to_owned(),
            outbound: Outbound::new(),
        }
    }

    fn url_of(&self, id: &str) -> String {
        format!("{}/{}", self.base, encode_uri_component(id))
    }

    async fn call(
        &self,
        method: &str,
        url: &str,
        headers: Vec<(String, String)>,
        body: Option<&[u8]>,
    ) -> Result<Value, SourceError> {
        let answer = self
            .outbound
            .send(method, url, headers, body, STORE_TIMEOUT)
            .await
            .map_err(|_| SourceError::failed("the document store could not be reached"))?;
        let text = String::from_utf8_lossy(&answer.body);
        if answer.status == 200 {
            return serde_json::from_str(&text).map_err(|error| {
                SourceError::failed(format!("the document store answered non-JSON: {error}"))
            });
        }
        let Some(kind) = refusal_kind(answer.status) else {
            return Err(SourceError::failed(format!(
                "the document store answered {}: {text}",
                answer.status
            )));
        };
        let message = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|body| string_at(&body, "message"))
            .unwrap_or_default();
        Err(SourceError::refused(kind, message))
    }
}

impl DocumentSource for ExampleSource {
    fn load(
        &self,
        caller: DocumentCaller,
        document_id: String,
    ) -> blok_mcp::uploads::BoxFuture<'_, Result<Option<StoredDocument>, SourceError>> {
        Box::pin(async move {
            let body = self
                .call(
                    "GET",
                    &self.url_of(&document_id),
                    caller_headers(&caller),
                    None,
                )
                .await?;
            if body.is_null() {
                return Ok(None);
            }
            let Some(document_text) = string_at(&body, "documentText") else {
                return Err(SourceError::failed(
                    "the document store answered no documentText",
                ));
            };
            Ok(Some(StoredDocument {
                document_text,
                version: string_at(&body, "version"),
            }))
        })
    }

    fn save(
        &self,
        caller: DocumentCaller,
        document_id: String,
        document_text: String,
        if_version: Option<String>,
    ) -> blok_mcp::uploads::BoxFuture<'_, Result<Option<String>, SourceError>> {
        Box::pin(async move {
            let mut headers = caller_headers(&caller);
            headers.push(("Content-Type".to_owned(), "application/json".to_owned()));
            if let Some(version) = if_version {
                headers.push(("Blok-If-Version".to_owned(), version));
            }
            let body = self
                .call(
                    "PUT",
                    &self.url_of(&document_id),
                    headers,
                    Some(document_text.as_bytes()),
                )
                .await?;
            Ok(string_at(&body, "version"))
        })
    }

    fn lists(&self) -> bool {
        true
    }

    fn list(
        &self,
        caller: DocumentCaller,
        list: SourceList,
    ) -> blok_mcp::uploads::BoxFuture<'_, Result<SourceListing, SourceError>> {
        Box::pin(async move {
            let mut params = vec![format!("limit={}", form_encode(&js_number(list.limit)))];
            if let Some(query) = &list.query {
                params.push(format!("query={}", form_encode(query)));
            }
            if let Some(cursor) = &list.cursor {
                params.push(format!("cursor={}", form_encode(cursor)));
            }
            let url = format!("{}?{}", self.base, params.join("&"));
            let body = self
                .call("GET", &url, caller_headers(&caller), None)
                .await?;
            let Some(documents) = body.get("documents").and_then(Value::as_array) else {
                return Err(SourceError::failed(
                    "list answered without a \"documents\" array",
                ));
            };
            Ok(SourceListing {
                documents: documents
                    .iter()
                    .filter_map(|doc| {
                        Some(ListedDocument {
                            id: string_at(doc, "id")?,
                            title: string_at(doc, "title"),
                        })
                    })
                    .collect(),
                next_cursor: string_at(&body, "nextCursor"),
            })
        })
    }
}

/// --example-source as `Hooks::source`; None keeps the one the blok-mcp flags set.
fn source_of(
    example: &HashMap<String, String>,
    options: &Value,
) -> Result<Option<Arc<dyn DocumentSource>>, Stop> {
    let Some(spec) = example.get("source") else {
        return Ok(None);
    };
    let Some(url) = spec.strip_prefix("endpoint:") else {
        return Err(Stop::Config(format!(
            "--example-source must be endpoint:<url>, got \"{spec}\""
        )));
    };
    if options.get("source").is_some_and(|s| !s.is_null()) {
        return Err(Stop::Config(
            "--example-source cannot be combined with --source".to_owned(),
        ));
    }
    Ok(Some(Arc::new(ExampleSource::new(url))))
}

/// The host's caller hook. --example-caller-error makes it fail, as a host
/// bug would; stdio has one local user; over HTTP None takes the default,
/// the SignedIn the host put on the request.
fn caller_of(
    example: &HashMap<String, String>,
    stdio: bool,
) -> Option<blok_mcp::embed::IdentifyFn> {
    if let Some(text) = example.get("caller-error") {
        let text = text.clone();
        return Some(Arc::new(move |_: &RequestContext<RoleServer>| {
            Err(text.clone())
        }));
    }
    stdio.then(|| -> blok_mcp::embed::IdentifyFn {
        Arc::new(|_: &RequestContext<RoleServer>| {
            Ok(Some(CallerIdentity {
                principal: Some("local".to_owned()),
                scopes: None,
            }))
        })
    })
}

/// The signed-in user from the fake headers, as the host's auth layer would put it.
fn signed_in(headers: &[(String, String)]) -> Option<SignedIn> {
    let header = |name: &str| {
        headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    };
    // X-Example-Scopes: a comma list. Blok ignores them by default (the host owns auth).
    let scopes = || {
        header("x-example-scopes")
            .map(|list| {
                list.split(',')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default()
    };
    match header("x-example-user") {
        Some(user) if !user.is_empty() => Some(SignedIn {
            subject: Some(user.to_owned()),
            scopes: scopes(),
        }),
        _ if header("x-example-signed-in") == Some("true") => Some(SignedIn {
            subject: None,
            scopes: Vec::new(),
        }),
        _ => None,
    }
}

type Service = StreamableHttpService<Host, NeverSessionManager>;

async fn read_body(req: &mut blok_http::Request) -> Option<Vec<u8>> {
    let Some(mut body) = req.take_body() else {
        return Some(Vec::new());
    };
    let mut out = Vec::new();
    body.read_to_end(&mut out).await.ok()?;
    Some(out)
}

async fn answer(
    service: &Service,
    mut req: blok_http::Request,
    mut resp: blok_http::ResponseWriter,
) {
    let path = req
        .target()
        .split('?')
        .next()
        .unwrap_or_default()
        .to_owned();
    if path != "/mcp" {
        resp.set_status(404);
        resp.headers_mut().set("Content-Length", "0");
        let _ = resp.write(&[]).await;
        return;
    }
    let headers: Vec<(String, String)> = req
        .headers()
        .iter()
        .map(|(n, v)| (n.to_owned(), v.to_owned()))
        .collect();
    let mut builder = http::Request::builder()
        .method(req.method())
        .uri(req.target());
    for (name, value) in &headers {
        builder = builder.header(name.as_str(), value.as_str());
    }
    let Some(body) = read_body(&mut req).await else {
        resp.set_status(400);
        resp.headers_mut().set("Content-Length", "0");
        let _ = resp.write(&[]).await;
        return;
    };
    let Ok(mut request) = builder.body(Full::new(Bytes::from(body))) else {
        resp.set_status(400);
        resp.headers_mut().set("Content-Length", "0");
        let _ = resp.write(&[]).await;
        return;
    };
    if let Some(user) = signed_in(&headers) {
        request.extensions_mut().insert(user);
    }
    let (parts, mut body) = service.handle(request).await.into_parts();
    resp.set_status(parts.status.as_u16());
    for (name, value) in &parts.headers {
        if !name.as_str().eq_ignore_ascii_case("content-length") {
            resp.headers_mut()
                .add(name.as_str(), value.to_str().unwrap_or_default());
        }
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

async fn serve_http(listen: &str, host: Host) -> Result<(), Stop> {
    let blok = host.blok.clone();
    let at = listen.rfind(':').unwrap_or(listen.len());
    let name = listen[..at].trim_start_matches('[').trim_end_matches(']');
    let port: u16 = listen[at + 1..].parse().unwrap_or(0);
    let listener = tokio::net::TcpListener::bind((name, port))
        .await
        .map_err(|error| Stop::Failed(format!("listen {listen}: {error}")))?;
    let address = listener
        .local_addr()
        .map_err(|error| Stop::Failed(error.to_string()))?;
    let mut config = StreamableHttpServerConfig::default();
    // Stateless: a handler per request, as the Node example's createMcpHandler.
    config.legacy_session_mode = false;
    config.allowed_hosts.clear();
    let service = Arc::new(StreamableHttpService::new(
        move || Ok(host.clone()),
        Arc::new(NeverSessionManager::default()),
        config,
    ));
    let server = blok_http::Server::new(
        move |req, resp| {
            let service = service.clone();
            async move { answer(&service, req, resp).await }
        },
        blok_http::Config {
            server_header: None,
            request_timeout: None,
            ..blok_http::Config::default()
        },
    );
    let shown = match address {
        std::net::SocketAddr::V6(v6) => format!("[{}]", v6.ip()),
        std::net::SocketAddr::V4(v4) => v4.ip().to_string(),
    };
    eprintln!("{NAME}: listening on http://{shown}:{}/mcp", address.port());
    let mut serving = std::pin::pin!(server.serve(listener));
    tokio::select! {
        _ = &mut serving => {}
        // Blok first: it waits for calls in flight, whose answers still need the transport.
        () = stop_signal() => {
            tokio::select! {
                () = blok.shutdown(DRAIN_LIMIT) => {}
                _ = &mut serving => {}
            }
        }
    }
    Ok(())
}

async fn serve_stdio(host: Host) {
    let blok = host.blok.clone();
    let mut serving = std::pin::pin!(async {
        // A client that leaves before initialize ends the session; that is a clean exit.
        if let Ok(running) = host.serve((tokio::io::stdin(), tokio::io::stdout())).await {
            let _ = running.waiting().await;
        }
    });
    tokio::select! {
        () = &mut serving => {}
        () = stop_signal() => {
            tokio::select! {
                () = blok.shutdown(DRAIN_LIMIT) => {}
                () = &mut serving => {}
            }
        }
    }
}

async fn stop_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let (Ok(mut term), Ok(mut int)) = (
            signal(SignalKind::terminate()),
            signal(SignalKind::interrupt()),
        ) else {
            return std::future::pending().await;
        };
        tokio::select! {
            _ = term.recv() => {}
            _ = int.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

async fn run(argv: Vec<String>) -> Result<(), Stop> {
    let (example, blok_args) = split_args(&argv)?;
    let bundle = Arc::new(Bundle::new(2).map_err(|error| Stop::Failed(error.to_string()))?);
    let env = cli::blok_env(std::env::vars());
    let cwd = std::env::current_dir().unwrap_or_default();
    let started = cli::parse(&bundle, &blok_args, env, &cwd).await?;
    let options = started.options.clone();
    let stdio = options.pointer("/transport/kind").and_then(Value::as_str) != Some("http");

    let source = source_of(&example, &options)?;
    let hooks = Hooks {
        source,
        ..cli::hooks_of(&started)?
    };
    let embed = EmbedHooks {
        // stdio has one local user; over HTTP the default reads the SignedIn the host put on the request.
        caller: caller_of(&example, stdio),
        anonymous_principal: example.get("allow-anonymous").cloned(),
    };
    let blok = BlokTools::new(bundle, &options, hooks, embed).await?;
    let host = Host {
        tool: example
            .get("host-tool")
            .cloned()
            .unwrap_or_else(|| "host_echo".to_owned()),
        prompt: example
            .get("host-prompt")
            .cloned()
            .unwrap_or_else(|| "host_hello".to_owned()),
        instructions: format!("Host instructions.\n\n{}", blok.instructions()),
        blok: blok.clone(),
    };
    // Check the names once before serving.
    if let Err(clash) = blok.check_names([host.tool.as_str()], [host.prompt.as_str()]) {
        blok.shutdown(DRAIN_LIMIT).await;
        return Err(Stop::Config(clash));
    }
    if stdio {
        serve_stdio(host).await;
    } else {
        let listen = options
            .pointer("/transport/listen")
            .and_then(Value::as_str)
            .unwrap_or("127.0.0.1:0")
            .to_owned();
        serve_http(&listen, host).await?;
    }
    blok.shutdown(DRAIN_LIMIT).await;
    Ok(())
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("a tokio runtime");
    let code = match runtime.block_on(run(argv)) {
        Ok(()) => 0,
        Err(Stop::Config(message)) => {
            eprintln!("{NAME}: {message}");
            2
        }
        Err(Stop::Failed(message)) => {
            eprintln!("{NAME}: {message}");
            1
        }
    };
    // Do not wait on blocked stdin reads or engine threads.
    std::process::exit(code);
}
