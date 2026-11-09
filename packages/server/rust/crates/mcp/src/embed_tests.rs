//! `BlokTools` with a bundle that fails on purpose (`Bundle::fail`), which
//! only a crate test can set.

use std::sync::Arc;

use rmcp::model::{GetPromptRequestParams, GetPromptResponse, ServerConfig};
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{ErrorData, ServerHandler, ServiceExt};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::bundle::Bundle;
use crate::embed::{BlokTools, CallerIdentity, EmbedHooks};
use crate::options::{Hooks, McpOptions, Source};

#[derive(Clone)]
struct Host {
    blok: BlokTools,
}

impl ServerHandler for Host {
    fn get_info(&self) -> ServerConfig {
        serde_json::from_value(json!({
            "protocolVersion": "2025-11-25",
            "capabilities": { "prompts": {} },
            "serverInfo": { "name": "host", "version": "1" },
        }))
        .unwrap()
    }

    async fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<GetPromptResponse, ErrorData> {
        self.blok.get_prompt(request, context).await
    }
}

/// One 2026-07-28 request over stdio, and its answer.
async fn ask(blok: BlokTools, method: &str, params: Value) -> Value {
    let (client, server) = tokio::io::duplex(1 << 20);
    tokio::spawn(async move {
        if let Ok(running) = (Host { blok }).serve(tokio::io::split(server)).await {
            let _ = running.waiting().await;
        }
    });
    let (read, mut write) = tokio::io::split(client);
    let mut params = params;
    params["_meta"] = json!({
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { "name": "Desk", "version": "1" },
        "io.modelcontextprotocol/clientCapabilities": {},
    });
    let line = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    write
        .write_all(format!("{line}\n").as_bytes())
        .await
        .unwrap();
    let mut lines = BufReader::new(read).lines();
    loop {
        let message: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        if message["id"] == json!(1) {
            return message;
        }
    }
}

// E7f: an unexpected prompts/get failure on a host's server is logged and
// answered with fixed words, never its text.
#[tokio::test(flavor = "multi_thread")]
async fn a_prompt_that_fails_answers_fixed_words_and_never_its_text() {
    let bundle = Arc::new(Bundle::new(1).unwrap());
    let embed = EmbedHooks {
        caller: Some(Arc::new(|_: &RequestContext<RoleServer>| {
            Ok(Some(CallerIdentity {
                principal: Some("local".to_owned()),
                scopes: None,
            }))
        })),
        ..EmbedHooks::default()
    };
    let options = McpOptions {
        source: Some(Source::Files {
            dir: std::env::temp_dir().to_string_lossy().into_owned(),
        }),
        ..McpOptions::default()
    };
    let hooks = Hooks {
        authorize: Some(Arc::new(|_: String, _: String, _: bool| async { true })),
        ..Hooks::default()
    };
    let blok = BlokTools::start(bundle.clone(), &options, hooks, embed)
        .await
        .unwrap();
    let name = blok
        .prompt_names()
        .into_iter()
        .next()
        .expect("a Blok prompt");
    *bundle.fail.lock().unwrap() = Some(("mcpPrompt", "\"name\""));
    let failed = ask(
        blok,
        "prompts/get",
        json!({ "name": name, "arguments": {} }),
    )
    .await;
    assert_eq!(
        failed["error"],
        json!({ "code": -32603, "message": "Blok could not run this call." }),
        "{failed}"
    );
}
