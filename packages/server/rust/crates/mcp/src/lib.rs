//! blok-mcp: Blok's MCP server, the Rust twin of the Node `@bloklabs/mcp`.
//! The pure MCP rules run in the shared engine bundle; this crate does the
//! IO: transports, handles, sources, auth and tickets.

#![deny(clippy::print_stdout)]

pub mod authorize;
pub mod bundle;
pub mod cli;
pub mod errors;
pub mod files;
pub mod handles;
pub mod http;
pub mod live;
pub mod oauth;
pub mod outbound;
pub mod protocol;
pub mod server;
pub mod sources;
pub mod stdio;

use std::path::Path;
use std::sync::Arc;

use rmcp::ServiceExt;
use serde_json::Value;

use crate::authorize::Webhook;
use crate::bundle::Bundle;
use crate::cli::{AuthorizeSpec, StartError};
use crate::oauth::OAuth;
use crate::outbound::Outbound;
use crate::protocol::Handler;
use crate::server::Mcp;

// Two engines: one call can run while another waits on IO.
const ENGINES: usize = 2;

/// Runs the CLI. Returns the process exit code.
pub async fn run_cli(argv: Vec<String>, env: Value, cwd: &Path) -> i32 {
    let bundle = match Bundle::new(ENGINES) {
        Ok(bundle) => Arc::new(bundle),
        Err(err) => {
            eprintln!("blok-mcp: {err}");
            return 1;
        }
    };
    let started = match cli::start(&bundle, &argv, env, cwd).await {
        Ok(started) => started,
        Err(StartError::Config(message)) => {
            eprintln!("blok-mcp: {message}");
            return 2;
        }
        Err(StartError::Bundle(err)) => {
            eprintln!("blok-mcp: {err}");
            return 1;
        }
    };
    let authorize = started
        .authorize
        .as_ref()
        .map(|AuthorizeSpec::Webhook(url)| Webhook::new(url.clone(), Outbound::new()));
    // serverInfo.version: the version Blok stamps, as Node's getBlokVersion.
    let version = match bundle.call_text("version", "{}").await {
        Ok(version) => version,
        Err(err) => {
            eprintln!("blok-mcp: {err}");
            return 1;
        }
    };
    let mcp = match Mcp::new(bundle, &started.options, authorize).await {
        Ok(mcp) => Arc::new(mcp),
        Err(err) => {
            eprintln!("blok-mcp: {err:?}");
            return 1;
        }
    };
    mcp.spawn_sweeper();
    let options = &started.options;
    if options.pointer("/transport/kind").and_then(Value::as_str) == Some("http") {
        return serve_http(mcp, version, options).await;
    }
    serve_stdio(mcp, version).await
}

async fn serve_http(mcp: Arc<Mcp>, version: String, options: &Value) -> i32 {
    let text = |pointer: &str| {
        options
            .pointer(pointer)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    let oauth = (text("/auth/kind") == "oauth").then(|| {
        OAuth::new(
            text("/auth/issuer"),
            text("/auth/audience"),
            text("/auth/jwksUrl"),
            Outbound::new(),
        )
    });
    let public = options.pointer("/transport/public") == Some(&Value::Bool(true));
    let handler = Handler::new(mcp.clone(), version, true);
    let listening = match http::listen(
        &text("/transport/listen"),
        handler,
        oauth,
        mcp.principal.clone(),
        public,
    )
    .await
    {
        Ok(listening) => listening,
        Err(err) => {
            eprintln!("blok-mcp: {err}");
            return 1;
        }
    };
    eprintln!("blok-mcp: listening on {}/mcp", listening.url);
    tokio::select! {
        _ = listening.serve => {}
        () = shutdown_signal() => {}
    }
    mcp.close_all();
    0
}

async fn serve_stdio(mcp: Arc<Mcp>, version: String) -> i32 {
    let handler = Handler::new(mcp.clone(), version, false);
    let shutdown = shutdown_signal();
    let served = stdio::proxy(
        tokio::io::stdin(),
        tokio::io::stdout(),
        |read, write| async move {
            // A client that leaves before initialize ends the session; that is a clean exit.
            if let Ok(running) = handler.serve((read, write)).await {
                let _ = running.waiting().await;
            }
        },
    );
    tokio::select! {
        () = served => {}
        () = shutdown => {}
    }
    mcp.close_all();
    0
}

async fn shutdown_signal() {
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
