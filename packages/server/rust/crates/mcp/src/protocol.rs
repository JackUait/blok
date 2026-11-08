//! The MCP protocol layer on rmcp: what src/mcp/sdk-server.ts does on
//! Node's SDK, with the spots where rmcp differs from Node written out.

use std::sync::Arc;

#[allow(deprecated)]
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CompleteRequestParams, CompleteResult, CustomRequest,
    CustomResult, DiscoverResult, ErrorCode, GetPromptRequestParams, GetPromptResponse,
    InitializeRequestParams, InitializeResult, ListPromptsResult, ListResourceTemplatesResult,
    ListResourcesResult, ListToolsResult, PaginatedRequestParams, ProtocolVersion,
    ReadResourceRequestParams, ReadResourceResponse, ServerConfig, SetLevelRequestParams,
    SubscribeRequestParams, UnsubscribeRequestParams,
};
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{ErrorData, ServerHandler};
use serde_json::{Value, json};

use crate::embed::BlokTools;
use crate::server::Mcp;

pub const SERVER_NAME: &str = "blok-mcp";
// Node's SDK still accepts this draft revision as is; rmcp does not know it.
const DRAFT_2024: &str = "2024-10-07";

pub use crate::embed::{HttpIdentity, accepted_responses};

/// The standalone server: a host of Blok's tools whose serverInfo is
/// blok-mcp and whose instructions are Blok's own.
#[derive(Clone)]
pub struct Handler {
    blok: BlokTools,
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

impl Handler {
    pub fn new(mcp: Arc<Mcp>, version: String, http: bool) -> Handler {
        Handler {
            blok: BlokTools::standalone(mcp, version, http),
        }
    }

    fn mcp(&self) -> &Mcp {
        self.blok.mcp()
    }

    fn server_info(&self) -> Value {
        json!({ "name": SERVER_NAME, "version": self.blok.version() })
    }

    /// 2026 results carry the server's identity in `_meta`, as Node's do.
    fn finish(&self, result: Value, context: &RequestContext<RoleServer>) -> Value {
        crate::embed::finish(result, context, Some(&self.server_info()))
    }
}

impl ServerHandler for Handler {
    async fn ping(&self, context: RequestContext<RoleServer>) -> Result<(), ErrorData> {
        // 2026-07-28 has no ping; a request that says so in its _meta gets -32601.
        if context
            .meta
            .protocol_version()
            .is_some_and(|v| v.as_str() >= crate::embed::MODERN)
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
            "instructions": self.mcp().surface.instructions,
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
        from_json(self.finish(json!({ "tools": self.mcp().surface.tools }), &context))
    }

    async fn list_prompts(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListPromptsResult, ErrorData> {
        from_json(self.finish(json!({ "prompts": self.mcp().surface.prompts }), &context))
    }

    async fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<GetPromptResponse, ErrorData> {
        self.blok
            .answer_prompt(request, &context, Some(&self.server_info()))
            .await
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let info = self.server_info();
        // Boxed: the whole server future otherwise passes the compiler's layout depth.
        Box::pin(self.blok.answer_call(request, context, Some(&info))).await
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
