//! The Rust build of the Blok server host: flags, the startup line,
//! signals and the drain. `main.rs` only runs [`run`].

pub mod args;
pub mod collablog;
pub mod conformance;

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use blok_blokserver::{Options, Server};
use blok_http::listen::listen;

use crate::args::{USAGE, parse_host_arguments};
use crate::collablog::{CollabStderr, Stderr, write_log_line};
use crate::conformance::{apply_conformance, parse_conformance_arguments};

/// HostCollab.ShutdownTimeout: a ceiling for the drain and the graceful
/// stop, not a wait.
pub const SHUTDOWN_GRACE: Duration = Duration::from_secs(30);

/// HostCollab.DefaultMaxUpgradedConnections: an accept-and-hold flood cannot
/// pin every socket the process can hold.
pub const MAX_UPGRADED_CONNECTIONS: i64 = 1024;

/// HostCollab.Configure.
pub fn configure_collab(options: &mut Options, stderr: &Stderr) {
    if options.collab_enabled {
        options.collab_max_connections = MAX_UPGRADED_CONNECTIONS;
        options.logger = Some(Arc::new(CollabStderr {
            out: Arc::clone(stderr),
        }));
    }
}

/// The upgraded-socket limit HostCollab.Configure gives Kestrel: 1024 with
/// collab, none without.
pub fn upgrade_limit(options: &Options) -> Option<i64> {
    options.collab_enabled.then_some(MAX_UPGRADED_CONNECTIONS)
}

fn print(stderr: &Stderr, text: &str) {
    let mut out = stderr
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let _ = out.write_all(text.as_bytes());
    let _ = out.flush();
}

/// Runs the host until the future `shutdown` makes resolves; returns the
/// exit code. `shutdown` is called just before the bind, where C#'s
/// StartAsync registers its signal handlers: a signal before that takes the
/// default action, as it does in C#. Kestrel's limits are blok-http's
/// defaults: 10 s for a head, 2 min idle, and every request cut off with 504
/// at 10 min.
pub async fn run<F: Future<Output = ()>>(
    args: &[String],
    getenv: &(dyn Fn(&str) -> String + Sync),
    stderr: Stderr,
    shutdown: impl FnOnce() -> F,
    version: &str,
) -> i32 {
    let (host_args, conformance) = match parse_conformance_arguments(args) {
        Ok(parsed) => parsed,
        Err(message) => {
            print(&stderr, &format!("{message}\n{USAGE}"));
            return 2;
        }
    };
    let parsed = parse_host_arguments(&host_args, getenv);
    if parsed.help {
        print(&stderr, USAGE);
        return 0;
    }
    if !parsed.err.is_empty() {
        print(&stderr, &format!("{}\n{USAGE}", parsed.err));
        return 2;
    }
    let mut options = parsed.options;
    options.version = version.to_owned();
    configure_collab(&mut options, &stderr);
    let server = match Server::new(options) {
        Ok(server) => server,
        Err(error) => {
            print(&stderr, &format!("blok-server refused to start: {error}\n"));
            return 1;
        }
    };
    if parsed.secret_from_flag {
        print(
            &stderr,
            "warning: --secret puts the shared secret in this machine's process list; set BLOK_SECRET in the environment instead\n",
        );
    }
    if parsed.doc_endpoint_auth_from_flag {
        print(
            &stderr,
            "warning: --doc-endpoint-auth puts the credential in this machine's process list; set BLOK_DOC_ENDPOINT_AUTH in the environment instead\n",
        );
    }
    apply_conformance(&server, &conformance);
    if let Some(max) = upgrade_limit(server.options()) {
        server.limit_upgrades(max);
    }

    let shutdown = shutdown();
    let options = server.options();
    let listeners = match listen(&options.listen_address, blok_dotnet::parse_ip) {
        Ok(listeners) => listeners,
        Err(error) => {
            print(&stderr, &format!("blok-server refused to start: {error}\n"));
            return 1;
        }
    };
    let http = blok_http::Server::new(server.handler(""), blok_http::Config::default());
    let (served_tx, mut served) = tokio::sync::mpsc::channel::<std::io::Error>(listeners.len());
    for listener in listeners {
        let http = http.clone();
        let served_tx = served_tx.clone();
        tokio::spawn(async move {
            if let Err(error) = http.serve_std(listener).await {
                let _ = served_tx.send(error).await;
            }
        });
    }

    // The harness trusts /health only after this line, so it must follow
    // the bind.
    print(
        &stderr,
        &format!(
            "blok-server {version} listening on {} (--auth {})\n",
            options.listen_address, options.auth
        ),
    );

    tokio::select! {
        Some(error) = served.recv() => {
            print(&stderr, &format!("blok-server stopped: {error}\n"));
            return 1;
        }
        () = shutdown => {}
    }

    let started = tokio::time::Instant::now();
    if let Err(error) = server.drain(SHUTDOWN_GRACE).await {
        let _ = write_log_line(
            &stderr,
            "warning",
            &format!("collab: the shutdown drain did not complete: {error}"),
        );
    }
    http.shutdown(SHUTDOWN_GRACE.saturating_sub(started.elapsed()))
        .await;
    0
}
