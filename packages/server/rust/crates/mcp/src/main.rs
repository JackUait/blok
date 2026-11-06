//! The blok-mcp binary: the same flags and env vars as the Node blok-mcp.

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let env = blok_mcp::cli::blok_env(std::env::vars());
    let cwd = std::env::current_dir().unwrap_or_default();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("a tokio runtime");
    let code = runtime.block_on(blok_mcp::run_cli(argv, env, &cwd));
    // Do not wait on blocked stdin reads or engine threads.
    std::process::exit(code);
}
