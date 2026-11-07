//! A Rust host builds blok-mcp from typed options and its own hooks, as a
//! Node host passes BlokMcpOptions (packages/mcp/types/index.d.ts): an
//! authorize function and an agentActor.

use std::sync::Arc;

use blok_mcp::bundle::Bundle;
use blok_mcp::options::{AgentActor, Hooks, McpOptions, Source};
use blok_mcp::server::{Approval, Caller, Outcome};
use serde_json::{Value, json};

async fn call(mcp: &blok_mcp::server::Mcp, tool: &str, args: Value) -> Value {
    let caller = Caller {
        principal: "local".to_owned(),
        client_name: Some("claude-code".to_owned()),
        scopes: None,
    };
    match mcp
        .call(tool, &args, &caller, &Approval::default(), &|| false)
        .await
    {
        Ok(Outcome::Answer(answer)) => serde_json::from_str(&answer.structured).unwrap(),
        other => panic!("{other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn an_authorize_function_and_an_agent_actor_shape_the_session() {
    let work = std::env::temp_dir().join(format!("blok-mcp-options-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work).unwrap();
    std::fs::write(work.join("doc.json"), r#"{"blocks":[]}"#).unwrap();
    std::fs::write(work.join("secret.json"), r#"{"blocks":[]}"#).unwrap();

    let options = McpOptions {
        source: Some(Source::Files {
            dir: work.to_string_lossy().into_owned(),
        }),
        ..McpOptions::default()
    };
    let hooks = Hooks {
        authorize: Some(Arc::new(
            |_principal: String, document_id: String, _write: bool| async move {
                document_id != "secret"
            },
        )),
        agent_actor: Some(Arc::new(|principal: &str, client_name: &str| AgentActor {
            id: format!("bot:{client_name}"),
            name: "Helper".to_owned(),
            on_behalf_of: Some(format!("{principal}@example.com")),
            color: None,
        })),
        ..Hooks::default()
    };
    let embedded = blok_mcp::Embedded::start(Arc::new(Bundle::new(1).unwrap()), &options, hooks)
        .await
        .unwrap();
    let mcp = &embedded.mcp;

    let refused = call(mcp, "blok_open", json!({ "documentId": "secret" })).await;
    assert_eq!(refused["error"]["code"], "FORBIDDEN", "{refused}");

    let opened = call(
        mcp,
        "blok_open",
        json!({ "documentId": "doc", "write": true }),
    )
    .await;
    let handle = opened["handle"].as_str().unwrap().to_owned();
    let wrote = call(
        mcp,
        "blok_execute",
        json!({ "handle": handle, "commands": [{ "name": "block.insert", "args": { "type": "paragraph", "data": { "text": "hi" } } }] }),
    )
    .await;
    assert_eq!(
        wrote["blocks"][0]["meta"]["lastEditedBy"],
        json!({ "id": "local@example.com" }),
        "{wrote}"
    );
    let saved: Value =
        serde_json::from_slice(&std::fs::read(work.join("doc.json")).unwrap()).unwrap();
    assert_eq!(
        saved["blocks"][0]["lastEditedWith"],
        json!("bot:claude-code"),
        "{saved}"
    );
    let _ = std::fs::remove_dir_all(&work);
}
