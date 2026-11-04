# Blok server in Rust

This is the third build of Blok's server, next to C# (`../dotnet`) and Go (`../go`). It serves the same routes and reads and writes the same files on disk.

It passes the full conformance suite, and CI runs it there. It ships nothing yet: the npm binary, the Docker image and the NuGet packages still ship the C# server.

It runs on Unix only for now. The blob store and the collab journal use Unix file APIs.

## Build and test

```bash
cargo build -p blok-server                         # ordinary host
cargo build -p blok-server --features conformance  # the host the conformance suite drives
cargo test                                         # unit tests
node ../../../scripts/test-server-conformance.mjs --target rust
```

## Layout

One crate per Go package, named after its Go path:

| Go package | Rust crate |
|---|---|
| `internal/jsjson` | `crates/jsjson` (`blok-jsjson`) |
| `internal/collab/room` | `crates/collab-room` (`blok-collab-room`) |
| `blokserver` | `crates/blokserver` (`blok-blokserver`) |
| `cmd/blok-server` | `crates/blok-server` (the binary) |

Each Go `foo_test.go` has a Rust twin: a `#[cfg(test)] mod` in `foo.rs`, or `tests/foo.rs`. Keep the Go test names in snake case, so the two lists can be compared.

## Rules

- Tests read the shared fixtures in `test/unit/server-conformance/fixtures`, the same files Go and C# read. Build the path from `env!("CARGO_MANIFEST_DIR")`.
- Async code runs on tokio.
- The HTTP/1.1 server and the WebSocket code are our own (`crates/http`, `crates/ws`). The conformance suite pins Kestrel's exact bytes, and a general crate hides the parts we must control.
- JSON goes through `blok-jsjson`, never `serde_json`, for anything a fixture or a client reads. It matches `System.Text.Json` and JS strings, which `serde_json` does not.
- No `unsafe`, except the JS engine's memory counter in `crates/jsruntime` (`budget.rs`).
- `cargo fmt --check` and `cargo clippy -- -D warnings` pass.
