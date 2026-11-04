use std::sync::{Arc, Mutex};

/// Stamped at build time: BLOK_SERVER_VERSION=1.2.3 cargo build.
const VERSION: &str = match option_env!("BLOK_SERVER_VERSION") {
    Some(version) => version,
    None => "dev",
};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("the tokio runtime");
    let stderr: blok_server::collablog::Stderr = Arc::new(Mutex::new(std::io::stderr()));
    let getenv = |name: &str| std::env::var(name).unwrap_or_default();
    let code = runtime.block_on(blok_server::run(
        &args,
        &getenv,
        stderr,
        async {
            // SIGTERM, SIGINT and SIGQUIT: .NET stops gracefully on each.
            let _ = blok_http::shutdown_signal().await;
        },
        VERSION,
    ));
    // Hijacked sockets and stray tasks must not hold the exit.
    runtime.shutdown_timeout(std::time::Duration::from_millis(100));
    std::process::exit(code);
}
