//! blok-mcp: Blok's MCP server, the Rust twin of the Node `@bloklabs/mcp`.
//! The pure MCP rules run in the shared engine bundle; this crate does the
//! IO: transports, handles, sources, auth and tickets.

#![deny(clippy::print_stdout)]

pub mod authorize;
pub mod awareness;
pub mod bundle;
pub mod cli;
pub mod errors;
pub mod files;
pub mod handles;
pub mod http;
pub mod inflight;
mod lenient;
pub mod live;
pub mod oauth;
pub mod options;
pub mod outbound;
pub mod protocol;
pub mod remote;
pub mod rooms;
pub mod server;
mod shape;
mod signal;
pub mod sources;
pub mod stdio;
pub mod uploads;
pub mod ws;

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
        Err(StartError::Failed(message)) => {
            eprintln!("blok-mcp: {message}");
            return 1;
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
    let embedded = match Embedded::new(bundle, &started.options, authorize, None).await {
        Ok(embedded) => embedded,
        Err(err) => {
            eprintln!("blok-mcp: {err}");
            return 1;
        }
    };
    // Boxed: the whole server future nested here passes the compiler's layout depth.
    Box::pin(embedded.serve(&started.options)).await
}

/// blok-mcp inside a Rust host. Give it the host's own collab rooms
/// (`blok_blokserver::Server::agent_executor()`) and live handles run in
/// this process, with no ticket and no socket.
pub struct Embedded {
    pub mcp: Arc<Mcp>,
    /// What serverInfo.version reports: the version Blok stamps.
    pub version: String,
    /// The options' `auth`, which `http` enforces.
    auth: Value,
    /// The options say http: only then were the HTTP rules checked.
    http_transport: bool,
}

const NOT_HTTP: &str =
    r#"serving over HTTP needs transport kind "http", so that the HTTP rules are checked"#;

fn is_http(options: &Value) -> bool {
    options.pointer("/transport/kind").and_then(Value::as_str) == Some("http")
}

/// The OAuth verifier `auth` names, if it names one.
fn oauth_of(auth: &Value) -> Option<OAuth> {
    let text = |key: &str| {
        auth.get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    (text("kind") == "oauth").then(|| {
        OAuth::new(
            text("issuer"),
            text("audience"),
            text("jwksUrl"),
            Outbound::new(),
        )
    })
}

impl Embedded {
    /// `options` is the options object mcpParseArgs gives (BlokMcpOptions as data).
    pub async fn new(
        bundle: Arc<Bundle>,
        options: &Value,
        authorize: Option<Webhook>,
        rooms: Option<Arc<blok_blokagent::Executor>>,
    ) -> Result<Embedded, String> {
        Embedded::with_uploads(bundle, options, authorize, rooms, None).await
    }

    /// From typed options and the hooks that are functions in Node, as a
    /// Node host calls createBlokMcpServer.
    pub async fn start(
        bundle: Arc<Bundle>,
        options: &options::McpOptions,
        hooks: options::Hooks,
    ) -> Result<Embedded, String> {
        let version = bundle.call_text("version", "{}").await.map_err(|e| e.0)?;
        let mcp = Mcp::with_hooks(bundle, &options.to_value(), hooks)
            .await
            .map_err(|err| match err {
                errors::Fault::Internal(message) => message,
                errors::Fault::Host(error) => error.error.to_string(),
            })?;
        let mcp = Arc::new(mcp);
        mcp.spawn_sweeper();
        let value = options.to_value();
        Ok(Embedded {
            mcp,
            version,
            auth: value["auth"].clone(),
            http_transport: is_http(&value),
        })
    }

    /// As `new`, with the host's own uploader (Node's `uploads` option).
    pub async fn with_uploads(
        bundle: Arc<Bundle>,
        options: &Value,
        authorize: Option<Webhook>,
        rooms: Option<Arc<blok_blokagent::Executor>>,
        uploads: Option<uploads::Uploads>,
    ) -> Result<Embedded, String> {
        let version = bundle.call_text("version", "{}").await.map_err(|e| e.0)?;
        let mcp = Mcp::with_uploads(bundle, options, authorize, rooms, uploads)
            .await
            .map_err(|err| match err {
                errors::Fault::Internal(message) => message,
                errors::Fault::Host(error) => error.error.to_string(),
            })?;
        let mcp = Arc::new(mcp);
        mcp.spawn_sweeper();
        let auth = options.get("auth").cloned().unwrap_or(Value::Null);
        Ok(Embedded {
            mcp,
            version,
            auth,
            http_transport: is_http(options),
        })
    }

    /// blok-mcp for the host's own HTTP server, with Node's Origin and Host
    /// checks. `hosts`: the app's own host names; None takes loopback only.
    /// Without OAuth or `hosts`, only loopback peers are served; behind a
    /// proxy, set OAuth or name the hosts. Refused unless the options say
    /// http, as Go's Handler: the HTTP rules are checked only then.
    pub fn http(&self, hosts: Option<Vec<String>>) -> Result<http::EmbeddedHttp, String> {
        Ok(http::EmbeddedHttp::new(
            self.handler(true)?,
            hosts,
            oauth_of(&self.auth),
            self.mcp.principal.clone(),
        ))
    }

    /// The rmcp handler, to serve on a transport the host picks. Over HTTP,
    /// serve `http` instead: it checks Origin and Host first. `http` is
    /// refused unless the options say http.
    pub fn handler(&self, http: bool) -> Result<Handler, String> {
        if http && !self.http_transport {
            return Err(NOT_HTTP.to_owned());
        }
        Ok(Handler::new(self.mcp.clone(), self.version.clone(), http))
    }

    /// Serves `options.transport` until stdin ends (stdio) or a signal.
    /// Returns the process exit code.
    pub async fn serve(self, options: &Value) -> i32 {
        if options.pointer("/transport/kind").and_then(Value::as_str) == Some("http") {
            return serve_http(self.mcp, self.version, options).await;
        }
        serve_stdio(self.mcp, self.version).await
    }
}

async fn serve_http(mcp: Arc<Mcp>, version: String, options: &Value) -> i32 {
    let text = |pointer: &str| {
        options
            .pointer(pointer)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    let oauth = oauth_of(options.get("auth").unwrap_or(&Value::Null));
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
    let mut serving = std::pin::pin!(listening.serve);
    tokio::select! {
        _ = &mut serving => {}
        // As Node's stop: requests in flight finish first, within the drain limit.
        _ = shutdown_signal() => {
            mcp.stop_opening();
            // As Node's stop: every call finishes first, while new connections
            // are still taken, then the answers in flight are written.
            let started = std::time::Instant::now();
            let drain = async {
                mcp.calls_drained(stdio::DRAIN_LIMIT).await;
                let left = stdio::DRAIN_LIMIT.saturating_sub(started.elapsed());
                listening.server.shutdown(left).await;
            };
            // The accept loop keeps running until the shutdown stops it.
            let stop = async {
                let _ = tokio::join!(drain, &mut serving);
            };
            tokio::select! {
                () = stop => {}
                again = shutdown_signal() => signal::die_by(again),
            }
            close_all(&mcp, stdio::DRAIN_LIMIT.saturating_sub(started.elapsed())).await;
            return 0;
        }
    }
    close_all(&mcp, stdio::DRAIN_LIMIT).await;
    0
}

/// Closes every handle; a second stop signal still ends the process at once.
async fn close_all(mcp: &Mcp, limit: std::time::Duration) {
    tokio::select! {
        () = mcp.close_all(limit) => {}
        again = shutdown_signal() => signal::die_by(again),
    }
}

async fn serve_stdio(mcp: Arc<Mcp>, version: String) -> i32 {
    let handler = Handler::new(mcp.clone(), version, false);
    let pending = Arc::new(stdio::Pending::with_requests(mcp.clone()));
    let served = stdio::proxy(
        tokio::io::stdin(),
        tokio::io::stdout(),
        pending.clone(),
        |read, write| async move {
            // A client that leaves before initialize ends the session; that is a clean exit.
            if let Ok(running) = handler.serve((read, write)).await {
                let _ = running.waiting().await;
            }
        },
    );
    let mut served = std::pin::pin!(served);
    tokio::select! {
        () = &mut served => {}
        // As Node's stop: the calls in flight finish first, within the drain limit.
        _ = shutdown_signal() => {
            mcp.stop_opening();
            let started = std::time::Instant::now();
            tokio::select! {
                () = &mut served => {}
                () = pending.drained(stdio::DRAIN_LIMIT) => {}
                again = shutdown_signal() => signal::die_by(again),
            }
            close_all(&mcp, stdio::DRAIN_LIMIT.saturating_sub(started.elapsed())).await;
            return 0;
        }
    }
    close_all(&mcp, stdio::DRAIN_LIMIT).await;
    0
}

async fn shutdown_signal() -> signal::Stop {
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
            _ = term.recv() => signal::Stop::Terminate,
            _ = int.recv() => signal::Stop::Interrupt,
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
        signal::Stop::Interrupt
    }
}
