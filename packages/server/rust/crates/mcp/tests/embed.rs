//! Blok's tools on a host's own rmcp server (`BlokTools`), as Node's
//! createBlok (src/mcp/embed.ts).

use std::sync::Arc;

use blok_mcp::bundle::Bundle;
use blok_mcp::cli::StartError;
use blok_mcp::embed::{BlokTools, CallerIdentity, EmbedHooks};
use blok_mcp::options::{Auth, Hooks, McpOptions, Source, Tickets};
use rmcp::model::{CallToolRequestParams, CallToolResponse, ErrorData, ServerConfig};
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{ServerHandler, ServiceExt};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

fn bundle() -> Arc<Bundle> {
    Arc::new(Bundle::new(1).unwrap())
}

fn docs() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "blok-mcp-embed-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("doc.json"), r#"{"title":"T","blocks":[]}"#).unwrap();
    dir
}

fn files(dir: &std::path::Path) -> McpOptions {
    McpOptions {
        source: Some(Source::Files {
            dir: dir.to_string_lossy().into_owned(),
        }),
        ..McpOptions::default()
    }
}

fn allow_all() -> Hooks {
    Hooks {
        authorize: Some(Arc::new(
            |_principal: String, _document_id: String, _write: bool| async move { true },
        )),
        ..Hooks::default()
    }
}

async fn refusal(options: McpOptions, hooks: Hooks, embed: EmbedHooks) -> String {
    match BlokTools::start(bundle(), &options, hooks, embed).await {
        Err(StartError::Config(message)) => message,
        Err(other) => panic!("not a config refusal: {other:?}"),
        Ok(_) => panic!("started"),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_host_server_refuses_the_standalone_only_options() {
    let dir = docs();
    let oauth = McpOptions {
        auth: Auth::OAuth {
            issuer: "https://issuer.example".to_owned(),
            audience: "https://blok.example".to_owned(),
            jwks_url: "https://issuer.example/jwks".to_owned(),
        },
        ..files(&dir)
    };
    assert_eq!(
        refusal(oauth, allow_all(), EmbedHooks::default()).await,
        "Blok's own OAuth is for the standalone server; on a host server the host signs callers in (pass caller)"
    );
    let principal = McpOptions {
        principal: Some("someone".to_owned()),
        ..files(&dir)
    };
    assert_eq!(
        refusal(principal, allow_all(), EmbedHooks::default()).await,
        "principal names the standalone caller; on a host server use caller, or anonymousPrincipal"
    );
    let blank = EmbedHooks {
        anonymous_principal: Some(String::new()),
        ..EmbedHooks::default()
    };
    assert_eq!(
        refusal(files(&dir), allow_all(), blank).await,
        "anonymousPrincipal must be a non-empty string"
    );
    // Over stdio too: Blok cannot see the host's transport.
    assert_eq!(
        refusal(files(&dir), Hooks::default(), EmbedHooks::default()).await,
        "Blok on a host server needs a per-document check: pass authorize (--authorize), or serve live rooms only with --ticket-url and no source"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_ticket_url_with_no_source_starts_without_authorize() {
    let rooms = McpOptions {
        sync: Some(blok_mcp::options::SyncOptions {
            url: "ws://127.0.0.1:9/sync".to_owned(),
            origin: None,
        }),
        tickets: Some(Tickets::Url {
            url: "http://127.0.0.1:9/tickets".to_owned(),
            host_token: "token".to_owned(),
        }),
        ..McpOptions::default()
    };
    let started = BlokTools::start(bundle(), &rooms, Hooks::default(), EmbedHooks::default()).await;
    assert!(started.is_ok(), "{:?}", started.err());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_host_name_that_blok_serves_is_refused() {
    let dir = docs();
    let blok = BlokTools::start(bundle(), &files(&dir), allow_all(), EmbedHooks::default())
        .await
        .unwrap();
    assert!(blok.tool_names().contains(&"blok_open".to_owned()));
    assert!(blok.prompt_names().contains(&"improve".to_owned()));
    assert!(
        blok.instructions()
            .contains("Rules for editing a Blok document")
    );
    assert_eq!(blok.tools().unwrap().len(), blok.tool_names().len());
    assert!(blok.check_names(["host_echo"], ["host_hello"]).is_ok());
    assert_eq!(
        blok.check_names(["host_echo", "blok_open"], ["improve"]),
        Err("Blok already serves blok_open, improve: rename the host's tool or prompt".to_owned())
    );
}

/// A host whose own tool is `host_echo`; Blok's names go to `BlokTools`.
#[derive(Clone)]
struct Host {
    blok: BlokTools,
}

impl ServerHandler for Host {
    fn get_info(&self) -> ServerConfig {
        serde_json::from_value(json!({
            "protocolVersion": "2025-11-25",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "host", "version": "1" },
            "instructions": format!("Host.\n\n{}", self.blok.instructions()),
        }))
        .unwrap()
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        if request.name == "host_echo" {
            return Ok(CallToolResponse::Complete(
                serde_json::from_value(json!({ "content": [{ "type": "text", "text": "echo" }] }))
                    .unwrap(),
            ));
        }
        self.blok.call_tool(request, context).await
    }
}

/// The test's stand-in for a host sign-in: `_meta["test/user"]`.
fn test_caller() -> EmbedHooks {
    EmbedHooks {
        caller: Some(Arc::new(|context: &RequestContext<RoleServer>| {
            let user = context.meta.0.0.get("test/user")?;
            Some(CallerIdentity {
                principal: user.get("name").and_then(Value::as_str).map(str::to_owned),
                scopes: user
                    .get("scopes")
                    .and_then(|s| serde_json::from_value(s.clone()).ok()),
            })
        })),
        ..EmbedHooks::default()
    }
}

/// One stdio session with the host, spoken as 2026-07-28 JSON-RPC lines.
struct Session {
    write: tokio::io::WriteHalf<tokio::io::DuplexStream>,
    read: tokio::io::Lines<BufReader<tokio::io::ReadHalf<tokio::io::DuplexStream>>>,
    id: u64,
}

impl Session {
    async fn new(blok: BlokTools) -> Session {
        let (client, server) = tokio::io::duplex(1 << 20);
        tokio::spawn(async move {
            let host = Host { blok };
            if let Ok(running) = host.serve(tokio::io::split(server)).await {
                let _ = running.waiting().await;
            }
        });
        let (read, write) = tokio::io::split(client);
        Session {
            write,
            read: BufReader::new(read).lines(),
            id: 0,
        }
    }

    async fn call(&mut self, user: Value, name: &str, arguments: Value) -> Value {
        self.id += 1;
        let mut meta = json!({
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { "name": "Desk", "version": "1" },
            "io.modelcontextprotocol/clientCapabilities": {},
        });
        if !user.is_null() {
            meta["test/user"] = user;
        }
        let line = json!({
            "jsonrpc": "2.0",
            "id": self.id,
            "method": "tools/call",
            "params": { "name": name, "arguments": arguments, "_meta": meta },
        });
        self.write
            .write_all(format!("{line}\n").as_bytes())
            .await
            .unwrap();
        loop {
            let text = self.read.next_line().await.unwrap().unwrap();
            let message: Value = serde_json::from_str(&text).unwrap();
            if message["id"] == json!(self.id) {
                return message;
            }
        }
    }
}

fn structured(answer: &Value) -> &Value {
    &answer["result"]["structuredContent"]
}

#[tokio::test(flavor = "multi_thread")]
async fn the_host_names_the_caller_and_a_handle_stays_with_its_opener() {
    let dir = docs();
    let blok = BlokTools::start(bundle(), &files(&dir), allow_all(), test_caller())
        .await
        .unwrap();
    let mut session = Session::new(blok).await;
    let open = json!({ "documentId": "doc", "write": true });

    let anonymous = session.call(Value::Null, "blok_open", open.clone()).await;
    assert_eq!(
        anonymous["error"],
        json!({ "code": -32600, "message": "Blok needs a signed-in caller." })
    );
    let unnamed = session.call(json!({}), "blok_open", open.clone()).await;
    assert_eq!(
        unnamed["error"],
        json!({ "code": -32600, "message": "Blok needs a named caller (sub or NameIdentifier)." })
    );
    let unknown = session.call(Value::Null, "blok_nope", json!({})).await;
    assert_eq!(
        unknown["error"],
        json!({ "code": -32602, "message": "Unknown tool: blok_nope" })
    );
    let echo = session.call(Value::Null, "host_echo", json!({})).await;
    assert_eq!(echo["result"]["content"][0]["text"], "echo", "{echo}");

    let alice = json!({ "name": "alice" });
    let opened = session.call(alice.clone(), "blok_open", open.clone()).await;
    assert_eq!(opened["result"]["resultType"], "complete", "{opened}");
    assert!(opened["result"].get("_meta").is_none(), "{opened}");
    let handle = structured(&opened)["handle"].as_str().unwrap().to_owned();
    let bob = session
        .call(
            json!({ "name": "bob" }),
            "blok_read",
            json!({ "handle": handle }),
        )
        .await;
    assert_eq!(structured(&bob)["error"]["code"], "UNKNOWN_HANDLE", "{bob}");
    let read = session
        .call(alice, "blok_read", json!({ "handle": handle }))
        .await;
    assert_eq!(structured(&read)["page"]["title"], "T", "{read}");

    // Scopes the hook passes are enforced as standalone enforces them.
    let reader = json!({ "name": "carol", "scopes": ["blok.read"] });
    let refused = session.call(reader, "blok_open", open).await;
    assert_eq!(
        structured(&refused)["error"]["code"],
        "FORBIDDEN",
        "{refused}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn an_anonymous_principal_serves_callers_with_no_sign_in() {
    let dir = docs();
    let embed = EmbedHooks {
        anonymous_principal: Some("guest".to_owned()),
        ..test_caller()
    };
    let blok = BlokTools::start(bundle(), &files(&dir), allow_all(), embed)
        .await
        .unwrap();
    let mut session = Session::new(blok).await;
    let opened = session
        .call(Value::Null, "blok_open", json!({ "documentId": "doc" }))
        .await;
    assert_eq!(structured(&opened)["mode"], "stored", "{opened}");
}

// Node's parseBlokMcpArgs reads the flags only; the standalone checks are runCli's.
#[tokio::test(flavor = "multi_thread")]
async fn parse_reads_the_flags_that_start_refuses() {
    let bundle = Bundle::new(1).unwrap();
    let argv: Vec<String> = ["--http", "127.0.0.1:0", "--source", "files:."]
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
    let cwd = std::env::temp_dir();
    let parsed = blok_mcp::cli::parse(&bundle, &argv, json!({}), &cwd).await;
    assert!(parsed.is_ok(), "{:?}", parsed.err());
    match blok_mcp::cli::start(&bundle, &argv, json!({}), &cwd).await {
        Err(StartError::Config(message)) => {
            assert!(message.contains("per-document check"), "{message}");
        }
        other => panic!("{other:?}"),
    }
}
