# blok-mcp (Rust)

Blok's MCP server in Rust, built on the official Rust MCP SDK (`rmcp`). It takes the same flags and environment variables as the Node server, `@bloklabs/mcp`.

It ships nothing yet, like the Rust server. Build it from this repository:

```sh
cd packages/server/rust
cargo build --release -p blok-mcp
./target/release/blok-mcp --source files:./docs
```

CI checks it against the Node server with the shared suite:

```sh
node scripts/test-mcp-conformance.mjs --target rust
```

The crate's rules are the workspace's, in `packages/server/rust/README.md`. One exception: this crate uses `serde_json`, because `rmcp` requires it.
