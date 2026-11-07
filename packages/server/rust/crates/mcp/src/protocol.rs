//! The MCP protocol layer on rmcp: what src/mcp/sdk-server.ts does on
//! Node's SDK, with the spots where rmcp differs from Node written out.

use std::sync::Arc;

#[allow(deprecated)]
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, CompleteRequestParams, CompleteResult,
    CustomRequest, CustomResult, DiscoverResult, ErrorCode, GetPromptRequestParams,
    GetPromptResponse, GetPromptResult, InitializeRequestParams, InitializeResult,
    InputRequiredResult, ListPromptsResult, ListResourceTemplatesResult, ListResourcesResult,
    ListToolsResult, PaginatedRequestParams, ProtocolVersion, ReadResourceRequestParams,
    ReadResourceResponse, ServerConfig, SetLevelRequestParams, SubscribeRequestParams,
    UnsubscribeRequestParams,
};
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{ErrorData, ServerHandler};
use serde_json::{Value, json};

use crate::server::{Approval, Caller, Mcp, Outcome};

pub const SERVER_NAME: &str = "blok-mcp";
const SERVER_INFO_KEY: &str = "io.modelcontextprotocol/serverInfo";
const CLIENT_INFO_KEY: &str = "io.modelcontextprotocol/clientInfo";
const CLIENT_CAPABILITIES_KEY: &str = "io.modelcontextprotocol/clientCapabilities";
const MODERN: &str = "2026-07-28";
// Node's SDK still accepts this draft revision as is; rmcp does not know it.
const DRAFT_2024: &str = "2024-10-07";

/// Who the HTTP layer says is calling, per request.
#[derive(Debug, Clone)]
pub struct HttpIdentity {
    pub principal: String,
    pub scopes: Option<Vec<String>>,
}

#[derive(Clone)]
pub struct Handler {
    mcp: Arc<Mcp>,
    version: String,
    /// Stateless HTTP: no session, so nothing from `initialize` carries over.
    http: bool,
}

/// Node's SDK answers every method it has no handler for this way.
fn not_found() -> ErrorData {
    ErrorData::new(ErrorCode::METHOD_NOT_FOUND, "Method not found", None)
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

impl Handler {
    pub fn new(mcp: Arc<Mcp>, version: String, http: bool) -> Handler {
        Handler { mcp, version, http }
    }

    fn server_info(&self) -> Value {
        json!({ "name": SERVER_NAME, "version": self.version })
    }

    fn modern(context: &RequestContext<RoleServer>) -> bool {
        context
            .protocol_version()
            .is_some_and(|v| v.as_str() >= MODERN)
    }

    /// 2026 results carry the server's identity in `_meta`, as Node's do.
    fn finish(&self, mut result: Value, context: &RequestContext<RoleServer>) -> Value {
        if Self::modern(context) {
            result["resultType"] = Value::String("complete".to_owned());
            result["_meta"] = json!({ SERVER_INFO_KEY: self.server_info() });
        }
        result
    }

    fn meta(context: &RequestContext<RoleServer>, key: &str) -> Option<Value> {
        context.meta.0.0.get(key).cloned()
    }

    fn caller(&self, context: &RequestContext<RoleServer>) -> Caller {
        let from_meta = Self::meta(context, CLIENT_INFO_KEY)
            .and_then(|info| info.get("name").and_then(Value::as_str).map(str::to_owned));
        // The stdio proxy's stand-in initialize names no client (stdio.rs).
        // Over stateless HTTP rmcp invents a placeholder peer; only _meta is real.
        let client_name = from_meta.or_else(|| {
            (!self.http)
                .then(|| {
                    context
                        .peer
                        .peer_info()
                        .map(|info| info.client_info.name.clone())
                })
                .flatten()
                .filter(|name| !name.is_empty())
        });
        let identity = context
            .extensions
            .get::<http::request::Parts>()
            .and_then(|parts| parts.extensions.get::<HttpIdentity>().cloned());
        match identity {
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
        }
    }

    fn capabilities(&self, context: &RequestContext<RoleServer>) -> Value {
        Self::meta(context, CLIENT_CAPABILITIES_KEY)
            .or_else(|| {
                (!self.http)
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
        &self,
        structured: &str,
        is_error: bool,
        context: &RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let parsed: Value =
            serde_json::from_str(structured).map_err(|e| internal(e.to_string()))?;
        from_json(self.finish(
            json!({
                "content": [{ "type": "text", "text": structured }],
                "structuredContent": parsed,
                "isError": is_error,
            }),
            context,
        ))
    }
}

impl ServerHandler for Handler {
    async fn ping(&self, context: RequestContext<RoleServer>) -> Result<(), ErrorData> {
        // 2026-07-28 has no ping; a request that says so in its _meta gets -32601.
        if context
            .meta
            .protocol_version()
            .is_some_and(|v| v.as_str() >= MODERN)
        {
            return Err(not_found());
        }
        Ok(())
    }

    async fn complete(
        &self,
        _request: CompleteRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CompleteResult, ErrorData> {
        Err(not_found())
    }

    #[allow(deprecated)]
    async fn set_level(
        &self,
        _request: SetLevelRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<(), ErrorData> {
        Err(not_found())
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, ErrorData> {
        Err(not_found())
    }

    async fn list_resource_templates(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourceTemplatesResult, ErrorData> {
        Err(not_found())
    }

    async fn read_resource(
        &self,
        _request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, ErrorData> {
        Err(not_found())
    }

    async fn subscribe(
        &self,
        _request: SubscribeRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<(), ErrorData> {
        Err(not_found())
    }

    async fn unsubscribe(
        &self,
        _request: UnsubscribeRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<(), ErrorData> {
        Err(not_found())
    }

    async fn on_custom_request(
        &self,
        _request: CustomRequest,
        _context: RequestContext<RoleServer>,
    ) -> Result<CustomResult, ErrorData> {
        Err(not_found())
    }

    fn get_info(&self) -> ServerConfig {
        serde_json::from_value(json!({
            "protocolVersion": "2025-11-25",
            "capabilities": { "tools": {}, "prompts": {} },
            "serverInfo": self.server_info(),
            "instructions": self.mcp.surface.instructions,
        }))
        .expect("a valid server config")
    }

    async fn initialize(
        &self,
        request: InitializeRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<InitializeResult, ErrorData> {
        context.peer.set_peer_info(request.clone());
        if request.protocol_version.as_str() == DRAFT_2024 {
            let mut info = self.get_info();
            info.protocol_version = request.protocol_version.clone();
            return Ok(info);
        }
        self.negotiate_initialize(&request)
    }

    async fn discover(
        &self,
        _context: RequestContext<RoleServer>,
    ) -> Result<DiscoverResult, ErrorData> {
        Ok(DiscoverResult::from_server_info(
            vec![ProtocolVersion::V_2026_07_28],
            self.get_info(),
        ))
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        from_json(self.finish(json!({ "tools": self.mcp.surface.tools }), &context))
    }

    async fn list_prompts(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListPromptsResult, ErrorData> {
        from_json(self.finish(json!({ "prompts": self.mcp.surface.prompts }), &context))
    }

    async fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        context: RequestContext<RoleServer>,
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
        let result: GetPromptResult = from_json(self.finish(
            answer.get("result").cloned().unwrap_or(Value::Null),
            &context,
        ))?;
        Ok(GetPromptResponse::Complete(result))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let caller = self.caller(&context);
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
                    return Ok(CallToolResponse::Complete(self.tool_result(
                        &answer.structured,
                        answer.is_error,
                        &context,
                    )?));
                }
                Outcome::Ask(ask) => {
                    let params = json!({
                        "message": ask.message,
                        "requestedSchema": ask.requested_schema,
                        "mode": "form",
                    });
                    if Self::modern(&context) {
                        let mut result = json!({
                            "resultType": "input_required",
                            "inputRequests": { ask.key.clone(): { "method": "elicitation/create", "params": params } },
                        });
                        result["_meta"] = json!({ SERVER_INFO_KEY: self.server_info() });
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_bare_result_objects_as_replies() {
        let responses: Vec<(String, Value)> = vec![
            (
                "a".to_owned(),
                json!({ "action": "accept", "content": { "unlock": true } }),
            ),
            ("b".to_owned(), json!("yes")),
            (
                "c".to_owned(),
                json!({ "method": "elicitation/create", "result": {} }),
            ),
            ("d".to_owned(), json!({ "result": { "action": "accept" } })),
            ("e".to_owned(), json!([1])),
        ];
        assert_eq!(
            accepted_responses(responses.iter().map(|(k, v)| (k, v))),
            json!({ "a": { "action": "accept", "content": { "unlock": true } } })
        );
    }
}
