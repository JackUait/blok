use std::sync::{Arc, Mutex};

/// Stamped at build time: BLOK_SERVER_VERSION=1.2.3 cargo build.
const VERSION: &str = match option_env!("BLOK_SERVER_VERSION") {
    Some(version) => version,
    None => "dev",
};

/// .NET decodes argv and the environment itself: bytes that are not UTF-8
/// become U+FFFD, not a panic or an unset variable.
#[cfg(unix)]
fn native(text: &std::ffi::OsStr) -> String {
    use std::os::unix::ffi::OsStrExt;
    blok_dotnet::native_text(text.as_bytes())
}

#[cfg(not(unix))]
fn native(text: &std::ffi::OsStr) -> String {
    text.to_string_lossy().into_owned()
}

fn main() {
    let args: Vec<String> = std::env::args_os()
        .skip(1)
        .map(|arg| native(&arg))
        .collect();
    std::panic::set_hook(blok_server::panic_hook(std::panic::take_hook()));
    let runtime = blok_server::runtime();
    let stderr: blok_server::collablog::Stderr = Arc::new(Mutex::new(std::io::stderr()));
    let getenv =
        |name: &str| std::env::var_os(name).map_or_else(String::new, |value| native(&value));
    let code = runtime.block_on(blok_server::run(
        &args,
        &getenv,
        stderr,
        || {
            // SIGTERM, SIGINT and SIGQUIT: .NET stops gracefully on each.
            let signals = blok_http::shutdown_signal();
            async move {
                match signals {
                    Ok(signals) => signals.await,
                    Err(_) => std::future::pending().await,
                }
            }
        },
        VERSION,
    ));
    // Hijacked sockets and stray tasks must not hold the exit.
    runtime.shutdown_timeout(std::time::Duration::from_millis(100));
    std::process::exit(code);
}
