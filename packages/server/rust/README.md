# Blok server in Rust

This is the third build of Blok's server, next to C# (`../dotnet`) and Go (`../go`). It serves the same routes and reads and writes the same files on disk.

It passes the full conformance suite, and CI runs it there. The server ships nothing yet: the npm binary, the Docker image and the NuGet packages still ship the C# server.

The MCP server ships on crates.io as `blok-mcp`, with the 20 crates it needs.
- Only those crates set `publish = true`. Each one pins its `blok-*` dependencies through `[workspace.dependencies]`, so the release moves every version at once.
- `yarn release` bumps them, then runs `node scripts/publish-rust-crates.mjs <version>`. The script is safe to re-run: it skips crates crates.io already has.
- `crates/jsruntime/src/blok-server-runtime.js` is a symlink to Go's bundle. `cargo publish` packs only files inside a crate, and it packs a symlink's target.

It builds for Unix and Windows. On Windows the collab journal holds a document with the open's share mode, as Go's `lock_windows.go` does, and file modes are left to Windows. CI tests it on Linux only; `cargo check --workspace --all-targets --target x86_64-pc-windows-gnu` (with a MinGW toolchain for `ring`) checks the Windows build.

## Build and test

```bash
cargo build -p blok-server                         # ordinary host
cargo build -p blok-server --features conformance  # the host the conformance suite drives
cargo test                                         # unit tests
node ../../../scripts/test-server-conformance.mjs --target rust
cargo build --release -p blok-mcp                  # the MCP server
node ../../../scripts/test-mcp-conformance.mjs --target rust
```

CI runs the unit tests with `cargo nextest run --workspace`, which runs every test binary at once, and runs doc tests with `cargo test --doc`. Each nextest test runs in its own process, so a test cannot rely on state another test left in the same process. `.config/nextest.toml` starts the slowest tests first.

## Layout

One crate per Go package, named after its Go path:

| Go package | Rust crate |
|---|---|
| `internal/jsjson` | `crates/jsjson` (`blok-jsjson`) |
| `internal/collab/room` | `crates/collab-room` (`blok-collab-room`) |
| `blokserver` | `crates/blokserver` (`blok-blokserver`) |
| `cmd/blok-server` | `crates/blok-server` (the binary) |
| `cmd/blok-mcp` | `crates/mcp` (`blok-mcp`, the MCP server) |

A host that embeds `blok-mcp` with its own uploader (`blok_mcp::uploads::Uploader`) returns `UploadError::Failed` for its own errors: the full message goes to stderr, and the agent sees only "The upload failed.". Return `UploadError::Agent` for words meant for the agent, as Node's `agentMessage`.

A host that serves `blok-mcp` on its own HTTP server uses `Embedded::http` and passes each request's peer and local addresses to `handle`. With no OAuth and no host names of its own, only loopback peers are served, as Node binds loopback itself. Behind a proxy every peer is the proxy, so set OAuth or name the app's hosts. See `crates/mcp/README.md`.

Each Go `foo_test.go` has a Rust twin: a `#[cfg(test)] mod` in `foo.rs`, or `tests/foo.rs`. Keep the Go test names in snake case, so the two lists can be compared.

## Rules

- Tests read the shared fixtures in `test/unit/server-conformance/fixtures`, the same files Go and C# read. Build the path from `env!("CARGO_MANIFEST_DIR")`.
- Async code runs on tokio.
- The HTTP/1.1 server and the WebSocket code are our own (`crates/http`, `crates/ws`). The conformance suite pins Kestrel's exact bytes, and a general crate hides the parts we must control.
- JSON goes through `blok-jsjson`, never `serde_json`, for anything a fixture or a client reads. It matches `System.Text.Json` and JS strings, which `serde_json` does not.
  - One approved exception: the MCP server (`crates/mcp`) uses `serde_json`, because the official MCP SDK it is built on (`rmcp`) requires it. `preserve_order` is on, so tool schemas keep their key order. Documents pass through it as raw text and are saved as the engine bundle wrote them. rmcp's HTTP layer runs behind our own `crates/http` through an adapter, with no hyper.
- No `unsafe`, except in `crates/jsruntime`: the JS engine's memory counter (`budget.rs`) and its stack limit (`engine.rs`, because rquickjs caps the safe setter at 16 MiB). And in `crates/outbound/src/sectrust.rs` (`mod raw`): security-framework binds neither `SecTrustCopyResult` nor `SecTrustGetTrustResult`, and the macOS operator check needs both. And in `crates/mcp/src/signal.rs`: a second SIGTERM or SIGINT must end the process by that signal, as Node's does (the shutdown conformance suite records it), and tokio keeps its handler for the life of the process, so the default action is put back with libc's `signal` and the signal raised.
- `cargo fmt --check` and `cargo clippy -- -D warnings` pass.
