//! Blok's tools and prompts on a host's own rmcp server (Node's createBlok,
//! src/mcp/embed.ts). The host keeps its `ServerHandler`, serverInfo,
//! instructions and transport; its handler hands Blok's names to `BlokTools`.
//! The standalone server (protocol.rs `Handler`) is one more such host.

use std::sync::Arc;
use std::time::Duration;

use rmcp::ErrorData;
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ErrorCode, GetPromptRequestParams,
    GetPromptResponse, GetPromptResult, InputRequiredResult, Prompt, Tool,
};
use rmcp::service::{RequestContext, RoleServer};
use serde_json::{Value, json};

use crate::bundle::Bundle;
use crate::cli::StartError;
use crate::options::{Hooks, McpOptions};
use crate::server::{Approval, Caller, Mcp, Outcome};

const SERVER_INFO_KEY: &str = "io.modelcontextprotocol/serverInfo";
const CLIENT_INFO_KEY: &str = "io.modelcontextprotocol/clientInfo";
const CLIENT_CAPABILITIES_KEY: &str = "io.modelcontextprotocol/clientCapabilities";
pub(crate) const MODERN: &str = "2026-07-28";

// Every port refuses with these exact words (shared conformance: embed.json).
const ANONYMOUS: &str = "Blok needs a signed-in caller.";
const UNNAMED: &str = "Blok needs a named caller (sub or NameIdentifier).";

/// Who the HTTP layer says is calling, per request (the standalone front door).
#[derive(Debug, Clone)]
pub struct HttpIdentity {
    pub principal: String,
    pub scopes: Option<Vec<String>>,
}

/// What the host's own sign-in put on an HTTP request, as the SDK's AuthInfo
/// in Node. Insert it into the request's extensions before rmcp's
/// StreamableHttpService sees the request. `subject` is the user's name
/// (`sub`); None: signed in without a name. Blok ignores `scopes` by
/// default (the host owns auth); a `caller` hook can pass them on.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SignedIn {
    pub subject: Option<String>,
    pub scopes: Vec<String>,
}

/// Who calls one tools/call, as the host says. A None or empty principal
/// is a caller signed in without a name. `scopes` None skips Blok's
/// blok.read / blok.write checks; Some enforces them as standalone does.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CallerIdentity {
    pub principal: Option<String>,
    pub scopes: Option<Vec<String>>,
}

/// Node's `caller(ctx)` hook: the caller of one tools/call, or None for an
/// anonymous one.
pub type IdentifyFn =
    Arc<dyn Fn(&RequestContext<RoleServer>) -> Option<CallerIdentity> + Send + Sync>;

/// Node's CreateBlokHooks.
#[derive(Clone, Default)]
pub struct EmbedHooks {
    /// Default: the `SignedIn` on the HTTP request, named by its subject.
    /// Over stdio there is none, so every call is anonymous.
    pub caller: Option<IdentifyFn>,
    /// Serve anonymous callers as this principal. None: they are refused.
    /// All of them share it: its handles and its handle limit.
    pub anonymous_principal: Option<String>,
}

#[derive(Clone)]
enum Identity {
    /// The standalone server: its own front door names the caller.
    Standalone {
        http: bool,
    },
    Host(EmbedHooks),
}

/// Blok's MCP tools and prompts for a host's own rmcp server. Build it
/// once; every handler the host makes (one per request over stateless
/// HTTP) clones it.
#[derive(Clone)]
pub struct BlokTools {
    mcp: Arc<Mcp>,
    version: String,
    identity: Identity,
}

fn invalid_request(message: &str) -> ErrorData {
    ErrorData::new(ErrorCode::INVALID_REQUEST, message.to_owned(), None)
}

fn internal(message: String) -> ErrorData {
    ErrorData::new(ErrorCode::INTERNAL_ERROR, message, None)
}

fn from_json<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, ErrorData> {
    serde_json::from_value(value).map_err(|e| internal(e.to_string()))
}

/// Node's SDK partitionInputResponses: only bare result objects count as
/// replies; an `{ method, result }` envelope or a non-object is dropped.
pub fn accepted_responses<'a>(responses: impl Iterator<Item = (&'a String, &'a Value)>) -> Value {
    Value::Object(
        responses
            .filter(|(_, entry)| {
                entry
                    .as_object()
                    .is_some_and(|o| !o.contains_key("method") && !o.contains_key("result"))
            })
            .map(|(key, entry)| (key.clone(), entry.clone()))
            .collect(),
    )
}

pub(crate) fn modern(context: &RequestContext<RoleServer>) -> bool {
    context
        .protocol_version()
        .is_some_and(|v| v.as_str() >= MODERN)
}

/// 2026 results say they are complete. `server_info`: the standalone
/// server's own identity in `_meta`, as Node's are; a host stamps its own.
pub(crate) fn finish(
    mut result: Value,
    context: &RequestContext<RoleServer>,
    server_info: Option<&Value>,
) -> Value {
    if modern(context) {
        result["resultType"] = Value::String("complete".to_owned());
        if let Some(info) = server_info {
            result["_meta"] = json!({ SERVER_INFO_KEY: info });
        }
    }
    result
}

fn meta(context: &RequestContext<RoleServer>, key: &str) -> Option<Value> {
    context.meta.0.0.get(key).cloned()
}

/// The Node-parity front doors and rmcp's HTTP service put the request's
/// parts here; stdio has none.
fn parts(context: &RequestContext<RoleServer>) -> Option<&http::request::Parts> {
    context.extensions.get::<http::request::Parts>()
}

/// Node's createBlok default: the host's sign-in, named by its subject.
/// Its scopes are the host's business, so Blok skips its own checks.
fn signed_in(context: &RequestContext<RoleServer>) -> Option<CallerIdentity> {
    let signed = parts(context)?.extensions.get::<SignedIn>()?;
    Some(CallerIdentity {
        principal: signed.subject.clone(),
        scopes: None,
    })
}

impl BlokTools {
    /// From the options object the CLI flags give (`cli::parse`), as
    /// Node's createBlok takes BlokMcpOptions. The host owns transport and
    /// sign-in, so `transport` is ignored and Blok's own OAuth, `principal`
    /// and a missing per-document check are refused.
    pub async fn new(
        bundle: Arc<Bundle>,
        options: &Value,
        hooks: Hooks,
        embed: EmbedHooks,
    ) -> Result<BlokTools, StartError> {
        check_embed(options, &hooks, &embed)?;
        // A loopback listen keeps the bind rules out; the host owns its address.
        let mut checked = options.clone();
        checked["transport"] = json!({ "kind": "http", "listen": "127.0.0.1:0" });
        checked["auth"] = json!({ "kind": "none" });
        let refusal = crate::server::option_refusal(
            &bundle,
            &checked,
            hooks.authorize.is_some(),
            hooks.uploads.as_ref(),
            hooks.source.is_some(),
        )
        .await?;
        if let Some(refusal) = refusal {
            return Err(StartError::Config(refusal));
        }
        let version = bundle.call_text("version", "{}").await?;
        let mcp = Mcp::with_hooks(bundle, &checked, hooks)
            .await
            .map_err(|fault| StartError::Failed(fault_text(fault)))?;
        let mcp = Arc::new(mcp);
        mcp.spawn_sweeper();
        Ok(BlokTools {
            mcp,
            version,
            identity: Identity::Host(embed),
        })
    }

    /// From typed options, as `new`.
    pub async fn start(
        bundle: Arc<Bundle>,
        options: &McpOptions,
        hooks: Hooks,
        embed: EmbedHooks,
    ) -> Result<BlokTools, StartError> {
        BlokTools::new(bundle, &options.to_value(), hooks, embed).await
    }

    /// The standalone server's own: its front door names the caller.
    pub(crate) fn standalone(mcp: Arc<Mcp>, version: String, http: bool) -> BlokTools {
        BlokTools {
            mcp,
            version,
            identity: Identity::Standalone { http },
        }
    }

    pub(crate) fn mcp(&self) -> &Arc<Mcp> {
        &self.mcp
    }

    /// Blok's primer. Put it into your server's instructions; Blok never
    /// sets them.
    pub fn instructions(&self) -> &str {
        &self.mcp.surface.instructions
    }

    /// The version Blok stamps.
    pub fn version(&self) -> &str {
        &self.version
    }

    pub fn tool_names(&self) -> Vec<String> {
        names(&self.mcp.surface.tools)
    }

    pub fn prompt_names(&self) -> Vec<String> {
        names(&self.mcp.surface.prompts)
    }

    pub fn owns_tool(&self, name: &str) -> bool {
        self.mcp
            .surface
            .tools
            .iter()
            .any(|t| name_of(t) == Some(name))
    }

    pub fn owns_prompt(&self, name: &str) -> bool {
        self.mcp
            .surface
            .prompts
            .iter()
            .any(|p| name_of(p) == Some(name))
    }

    /// Blok's tools, as the standalone tools/list shows them.
    pub fn tools(&self) -> Result<Vec<Tool>, ErrorData> {
        from_json(Value::Array(self.mcp.surface.tools.clone()))
    }

    /// Blok's prompts (Ask AI's skills).
    pub fn prompts(&self) -> Result<Vec<Prompt>, ErrorData> {
        from_json(Value::Array(self.mcp.surface.prompts.clone()))
    }

    /// Fails when the host serves a tool or prompt name Blok serves. Call
    /// it before serving: a clash must stop the host, never pick a winner.
    pub fn check_names<'a>(
        &self,
        tools: impl IntoIterator<Item = &'a str>,
        prompts: impl IntoIterator<Item = &'a str>,
    ) -> Result<(), String> {
        let taken: Vec<&str> = tools
            .into_iter()
            .filter(|name| self.owns_tool(name))
            .chain(prompts.into_iter().filter(|name| self.owns_prompt(name)))
            .collect();
        if taken.is_empty() {
            return Ok(());
        }
        Err(format!(
            "Blok already serves {}: rename the host's tool or prompt",
            taken.join(", ")
        ))
    }

    /// One tools/call for a Blok tool. A 2026 result says it is complete;
    /// stamp your own serverInfo `_meta` on it, as on your other results.
    pub async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        self.answer_call(request, context, None).await
    }

    /// One prompts/get for a Blok prompt.
    pub async fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<GetPromptResponse, ErrorData> {
        self.answer_prompt(request, &context, None).await
    }

    /// Stops new opens, waits for the calls in flight (Blok first: their
    /// answers still need your transport), then closes every handle. Gives
    /// up after `limit`.
    pub async fn shutdown(&self, limit: Duration) {
        let started = std::time::Instant::now();
        self.mcp.stop_opening();
        self.mcp.calls_drained(limit).await;
        self.mcp
            .close_all(limit.saturating_sub(started.elapsed()))
            .await;
    }

    fn caller(&self, context: &RequestContext<RoleServer>) -> Result<Caller, ErrorData> {
        let http = match &self.identity {
            Identity::Standalone { http } => *http,
            // rmcp's HTTP service puts the request's parts in every context.
            Identity::Host(_) => parts(context).is_some(),
        };
        let from_meta = meta(context, CLIENT_INFO_KEY)
            .and_then(|info| info.get("name").and_then(Value::as_str).map(str::to_owned));
        // The stdio proxy's stand-in initialize names no client (stdio.rs).
        // Over stateless HTTP rmcp invents a placeholder peer; only _meta is real.
        let client_name = from_meta.or_else(|| {
            (!http)
                .then(|| {
                    context
                        .peer
                        .peer_info()
                        .map(|info| info.client_info.name.clone())
                })
                .flatten()
                .filter(|name| !name.is_empty())
        });
        let hooks = match &self.identity {
            Identity::Standalone { .. } => {
                let identity = parts(context)
                    .and_then(|parts| parts.extensions.get::<HttpIdentity>().cloned());
                return Ok(match identity {
                    Some(identity) => Caller {
                        principal: identity.principal,
                        client_name,
                        scopes: identity.scopes,
                    },
                    None => Caller {
                        principal: self.mcp.principal.clone(),
                        client_name,
                        scopes: None,
                    },
                });
            }
            Identity::Host(hooks) => hooks,
        };
        let who = match &hooks.caller {
            Some(identify) => identify(context),
            None => signed_in(context),
        };
        let Some(who) = who else {
            return match &hooks.anonymous_principal {
                Some(principal) => Ok(Caller {
                    principal: principal.clone(),
                    client_name,
                    scopes: None,
                }),
                None => Err(invalid_request(ANONYMOUS)),
            };
        };
        match who.principal {
            Some(principal) if !principal.is_empty() => Ok(Caller {
                principal,
                client_name,
                scopes: who.scopes,
            }),
            _ => Err(invalid_request(UNNAMED)),
        }
    }

    fn capabilities(&self, context: &RequestContext<RoleServer>) -> Value {
        let http = match &self.identity {
            Identity::Standalone { http } => *http,
            Identity::Host(_) => parts(context).is_some(),
        };
        meta(context, CLIENT_CAPABILITIES_KEY)
            .or_else(|| {
                (!http)
                    .then(|| {
                        context
                            .peer
                            .peer_info()
                            .and_then(|info| serde_json::to_value(&info.capabilities).ok())
                    })
                    .flatten()
            })
            .unwrap_or_else(|| json!({}))
    }

    fn tool_result(
        structured: &str,
        is_error: bool,
        context: &RequestContext<RoleServer>,
        server_info: Option<&Value>,
    ) -> Result<CallToolResult, ErrorData> {
        let parsed: Value =
            serde_json::from_str(structured).map_err(|e| internal(e.to_string()))?;
        from_json(finish(
            json!({
                "content": [{ "type": "text", "text": structured }],
                "structuredContent": parsed,
                "isError": is_error,
            }),
            context,
            server_info,
        ))
    }

    pub(crate) async fn answer_prompt(
        &self,
        request: GetPromptRequestParams,
        context: &RequestContext<RoleServer>,
        server_info: Option<&Value>,
    ) -> Result<GetPromptResponse, ErrorData> {
        let arguments = serde_json::to_value(&request.arguments).unwrap_or(Value::Null);
        let answer = self
            .mcp
            .prompt(&request.name, &arguments)
            .await
            .map_err(|f| internal(format!("{f:?}")))?;
        if let Some(error) = answer.get("error") {
            return Err(ErrorData::new(
                ErrorCode(error.get("code").and_then(Value::as_i64).unwrap_or(-32602) as i32),
                error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                None,
            ));
        }
        let result: GetPromptResult = from_json(finish(
            answer.get("result").cloned().unwrap_or(Value::Null),
            context,
            server_info,
        ))?;
        Ok(GetPromptResponse::Complete(result))
    }

    /// One tools/call. `server_info`: the standalone server stamps its own.
    pub(crate) async fn answer_call(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
        server_info: Option<&Value>,
    ) -> Result<CallToolResponse, ErrorData> {
        // Node's blokHandlers: an unknown name, then who calls.
        if matches!(self.identity, Identity::Host(_)) && !self.owns_tool(&request.name) {
            return Err(ErrorData::new(
                ErrorCode::INVALID_PARAMS,
                format!("Unknown tool: {}", request.name),
                None,
            ));
        }
        let caller = self.caller(&context)?;
        let args = request
            .arguments
            .clone()
            .map_or_else(|| json!({}), Value::Object);
        let mut approval = Approval {
            capabilities: self.capabilities(&context),
            replies: request
                .input_responses
                .as_ref()
                .map(|r| accepted_responses(r.iter())),
        };
        let ct = context.ct.clone();
        let cancelled = move || ct.is_cancelled();
        // Calls on one handle run in the order they came (handles.rs).
        let id = serde_json::to_value(&context.id)
            .map(|id| id.to_string())
            .unwrap_or_default();
        let turn = self.mcp.turn_for(&id, &args, &caller.principal);
        if let Some(turn) = &turn {
            turn.wait().await;
        }
        loop {
            let outcome = self
                .mcp
                .call(&request.name, &args, &caller, &approval, &cancelled)
                .await
                .map_err(internal)?;
            match outcome {
                Outcome::UnknownTool(message) => {
                    return Err(ErrorData::new(ErrorCode::INVALID_PARAMS, message, None));
                }
                Outcome::Answer(answer) => {
                    return Ok(CallToolResponse::Complete(Self::tool_result(
                        &answer.structured,
                        answer.is_error,
                        &context,
                        server_info,
                    )?));
                }
                Outcome::Ask(ask) => {
                    let params = json!({
                        "message": ask.message,
                        "requestedSchema": ask.requested_schema,
                        "mode": "form",
                    });
                    if modern(&context) {
                        let mut result = json!({
                            "resultType": "input_required",
                            "inputRequests": { ask.key.clone(): { "method": "elicitation/create", "params": params } },
                        });
                        if let Some(info) = server_info {
                            result["_meta"] = json!({ SERVER_INFO_KEY: info });
                        }
                        let result: InputRequiredResult = from_json(result)?;
                        return Ok(CallToolResponse::InputRequired(result));
                    }
                    // rmcp has no 2025 fallback: ask over the session ourselves,
                    // then run the call again with the reply, as Node's SDK does.
                    let elicited = context.peer.create_elicitation(from_json(params)?).await;
                    match elicited {
                        Ok(reply) => {
                            let reply = serde_json::to_value(reply).unwrap_or(Value::Null);
                            approval.replies = Some(json!({ ask.key: reply }));
                        }
                        Err(err) => {
                            return Ok(CallToolResponse::Complete(from_json(json!({
                                "content": [{ "type": "text", "text": err.to_string() }],
                                "isError": true,
                            }))?));
                        }
                    }
                }
            }
        }
    }
}

fn name_of(entry: &Value) -> Option<&str> {
    entry.get("name").and_then(Value::as_str)
}

fn names(entries: &[Value]) -> Vec<String> {
    entries
        .iter()
        .filter_map(name_of)
        .map(str::to_owned)
        .collect()
}

fn fault_text(fault: crate::errors::Fault) -> String {
    match fault {
        crate::errors::Fault::Internal(message) => message,
        crate::errors::Fault::Host(error) => error.error.to_string(),
    }
}

/// Node's checkEmbedOptions, in its order.
fn check_embed(options: &Value, hooks: &Hooks, embed: &EmbedHooks) -> Result<(), StartError> {
    let text = |pointer: &str| options.pointer(pointer).and_then(Value::as_str);
    let refuse = |message: &str| Err(StartError::Config(message.to_owned()));
    if text("/auth/kind") == Some("oauth") {
        return refuse(
            "Blok's own OAuth is for the standalone server; on a host server the host signs callers in (pass caller)",
        );
    }
    if options.get("principal").is_some_and(|p| !p.is_null()) {
        return refuse(
            "principal names the standalone caller; on a host server use caller, or anonymousPrincipal",
        );
    }
    if embed.anonymous_principal.as_deref() == Some("") {
        return refuse("anonymousPrincipal must be a non-empty string");
    }
    // Blok cannot see the host's transport, so it treats every caller as remote, as over HTTP.
    let has_source = options.get("source").is_some_and(|s| !s.is_null()) || hooks.source.is_some();
    let host_decides = text("/tickets/kind") == Some("url") && !has_source;
    if hooks.authorize.is_none() && !host_decides {
        return refuse(
            "Blok on a host server needs a per-document check: pass authorize (--authorize), or serve live rooms only with --ticket-url and no source",
        );
    }
    Ok(())
}
