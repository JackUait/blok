# Verification of 05-go-mcp.md, 06-rust-mcp.md and 00-plan.md §2b

Repo HEAD d2ffc2f5 (2026-11-07). Read-only. The repo stayed clean (`git status --short` empty after every build and test).

Every verdict cites a file read or a command run in this session. Throwaway code lives in the session scratchpad under `verify-go-rust/`:

- `goprobe/main.go`: a Go SDK v1.8.0 server. Env flags turn on each workaround: `FIXVERS`, `EMPTYCONTENT`, `NOCONTENT`, `STRIPHDR`.
- `node/ir.mjs`: a Node `@modelcontextprotocol/server` 2.4.0 server. It is built like `src/mcp/sdk-server.ts`: `serveStdio`, `setRequestHandler`, `inputRequired`.
- `drive.py`: a raw stdio driver. `http.sh` holds the curl checks.
- `rustprobe/`: a copy of the 06 probe, rebuilt here.
- `rustadapter/`: rmcp mounted on the workspace's own `blok-http` crate.
- `sessioncheck/`: a handle task that owns an `Arc<Executor>`.

Node HTTP answers come from the 05 oracle bundle (`go-mcp/node-http-host.mjs`, built from `src/mcp`), run again here.

---

## Go (05-go-mcp.md)

### G1. go-sdk v1.8.0 is the latest — CONFIRMED
- `proxy.golang.org/.../@latest` returns `{"Version":"v1.8.0","Time":"2026-09-04T08:08:52Z", Ref refs/tags/v1.8.0}`.
- `@v/list` has nothing newer than v1.8.0, and no v1.9 pre-release.
- `/v2/@latest` gives 404, and `/v3/@latest` says "no matching versions".
- `gh api .../releases`: v1.8.0 was published 2026-09-14T08:05:46Z, and v1.7.0 on 2026-07-28.
- The SDK `go.mod` says `go 1.25.0`.

### G2. Protocol versions — CONFIRMED
- `sdk/mcp/shared.go:46-64` lists 2026-07-28, 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05.
- `ServerOptions.SupportedProtocolVersions` can only narrow the list (`server.go:186-200`).
- Measured: `initialize` with `2024-10-07` gets `protocolVersion:"2025-11-25"` from Go. Node echoes `2024-10-07`.

### G3. 2026 input-required retry and 2025 stdio `elicitation/create` fallback — CONFIRMED
- **2026, raw stdio.** The handler returns `InputRequests`. The SDK sends `resultType:"input_required"` with no `requestState`, and the retry with `inputResponses` reaches the handler.
- **2025-11-25 and 2024-11-05 stdio.** The SDK sends a real `elicitation/create`, then runs the handler again (`mrtr.go:119-163`).
- **Elicit is refused on 2026.** The guard is at `server.go:1611-1627`. 05 cites `:1611-1626`.
- **New detail.** Go's fallback `elicitation/create` has no `params._meta.progressToken`. Node 2.4.0 sends `"_meta":{"progressToken":0}`, and so does rmcp. Clients answered both shapes, so this matters only if conformance compares the server→client request.

### G4. The three "open differences" in §2b — all three are REAL, and all three can be REMOVED with SDK hooks Go already has
None of them needs an SDK change.

**(a) `supportedVersions` lists five versions. Node lists `["2026-07-28"]`.**
- Real. Node's oracle discover answer and `node/ir.mjs` both give `["2026-07-28"]`. Go gives all five.
- Fix: a receiving middleware that sets `res.(*mcp.DiscoverResult).SupportedVersions = []string{"2026-07-28"}`.
- `discover` (`server.go:926-957`) returns a fresh `*DiscoverResult`. It does not narrow negotiation.
- Measured with `FIXVERS=1`:
  - discover answers `["2026-07-28"]`;
  - `initialize` on 2025-11-25 and 2024-11-05 still negotiates;
  - the 2025 elicitation fallback still works.
- Narrowing `SupportedProtocolVersions` instead would push legacy `initialize` to answer 2025-11-25 and expect the client to disconnect (`server.go:192-199`). 05 was right to avoid that.

**(b) `"content": null` on the input-required result.**
- Real. `CallToolResult.Content` is tagged `json:"content"` with no `omitempty` (`protocol.go:277`), and `MarshalJSON` keeps it (`:372-388`).
- Measured Node 2.4.0 wire: `{"resultType":"input_required","inputRequests":{...},"_meta":{serverInfo}}`. There is no `content` key, so 05 §5's open question is answered.
- `Content: []mcp.Content{}` only changes it to `"content":[]`. Still different.
- Fix (measured with `NOCONTENT=1`): a receiving middleware swaps a `*CallToolResult` that has `InputRequests` for a custom struct. The struct embeds `mcp.ResultBase` and carries `resultType` and `inputRequests` only.
  - The 2026 result then has no `content`.
  - The 2026 retry still completes.
  - The 2025 fallback still works, because user middleware wraps the SDK's legacy middleware. On 2025 it only ever sees the final result.

**(c) `-32020` for a 2026 HTTP `tools/call` without `Mcp-Param-Blok-Handle`.**
- Real. Measured: no header gives HTTP 400 `-32020 "missing Mcp-Param-Blok-Handle header"`.
- New: a header that does not match the argument is **also** refused with `-32020 ... does not match body value`. Plan §2c says Node lets the argument win, and measured Node answered 200 to both requests.
- There is no option flag. The check runs on the *registered* tool's schema (`streamable_headers.go:391-396`, `validateParamHeaders :401-442`, `toolLookup = server.getServerTool` at `streamable.go:533`).
- Fix (measured with `STRIPHDR=1`):
  - Register `blok_*` schemas **without** `x-mcp-header`.
  - Put it back only in the `tools/list` answer, with a middleware that **copies** each `*Tool` before it sets the schema.
  - Result: `tools/list` still shows `"x-mcp-header":"Blok-Handle"`, and calls with no header or a wrong header answer 200.
- **Trap, measured:** `ListToolsResult.Tools` holds the registered `*Tool` pointers. Changing `t.InputSchema` in place writes the annotation back into the server. The very next call then gets `-32020` again. The first `STRIPHDR` run failed for exactly this reason.

### G5. A fourth difference §2b does not list — PARTLY (the list is incomplete)
On HTTP, an `MCP-Protocol-Version: 2024-10-07` header gets these answers:
- Go: **400** "Unsupported protocol version" (`streamable.go:348-356`).
- rmcp: **400**.
- Node: **200**, measured.

Over stdio, Go answers `initialize` 2024-10-07 with 2025-11-25 (G2). 05 §1.2 mentions 2024-10-07, but §2b's "open differences" list leaves it out. There is no SDK option for it. A wrapper `http.Handler` can rewrite the header, or the plan can decide to accept the split.

### G6. Origin and Host behaviour — CONFIRMED
Measured on the Go probe and on Node:

| Check | Go | Node |
|---|---|---|
| Foreign `Origin` | 200 | 403 |
| `Host: localhost:1` (wrong port) | 200 | 403 |
| `Host: evil.example` | 403 | 403 |

- Source: `streamable.go:316-332`. It checks only that the host is loopback (`util.IsLoopback(req.Host)`), and only when the local address is loopback. There is no Origin check unless the deprecated `CrossOriginProtection` is set (`:184-195`).
- 05's advice (Blok's own Origin list, a port-exact Host check, and `DisableLocalhostProtection` under `--public`) matches the code.

### G7. A `blokmcp` package in the v2 module can import `internal/...` — CONFIRMED
- `go.mod:1` is `module github.com/JackUait/blok/packages/server/go/v2`.
- `blokserver/collab.go:14-18` already imports `.../v2/internal/collab/docendpoint` and other internal packages.
- `blokserver/ticket/mint.go:16-17` imports `internal/jsjson` and `internal/ticket`.
- Go's internal rule therefore allows `go/blokmcp`. I did not create the package, so this rests on the language rule plus those precedents.

### G8. `internal/outbound/law_test.go` scans the module and bans WS clients — PARTLY
- **Scans the module: CONFIRMED.** `moduleSources` walks `filepath.Abs("../..")`, which is the module root, and reads every non-test `.go` file (`:142-167`). So `blokmcp/` and `cmd/blok-mcp/` would be scanned.
- **"Bans WebSocket clients outright": overstated.** What is banned:
  - the names `Dial`, `DialConfig`, `NewConfig` and `NewClient` from `golang.org/x/net/websocket` (`:33`);
  - raw `net` and `crypto/tls` dialing;
  - the `net/http` client names.
- The ban works **by import path inside Blok's own sources** (`findUses :60-115`). A third-party WebSocket module, such as one under `github.com/...`, is not named, and its dialing happens in another module the scan never reads.
- There is no `go.mod`/`go.sum` ban. Rust's law, by contrast, also checks `Cargo.lock`. grep found no gorilla, nhooyr or coder websocket rule anywhere in `packages/server/go` or `test/unit/architecture`.
- So a hand-written client using `net.Dialer` is banned until it becomes a pinned owner, but a third-party client library would slip through unless the law is extended.
- **Small cite errors in 05 §2.6:**
  - The banned `net/http` list also has `DefaultTransport`, `Head` and `PostForm` (`:25-28`).
  - `pinned` (`:45-50`) holds `internal/blob/s3.go`, `internal/collab/docendpoint/client.go` and `internal/dotnet/sockets.go`.
  - The guarded fetcher is a separate `guardOwner` (`:42`), not one of the pinned entries.

### G9. `ticket.Mint` (`blokserver/ticket/mint.go:43`) matches `tickets.json` — CONFIRMED
- `Mint` is at `mint.go:43`.
- `go test ./blokserver/ticket/ -count=1 -v`: all 8 tests pass. One of them is `TestMintsTheSharedTicketPassesByteForByte` (`tickets_fixture_test.go:96-115`). It mints `compatible`, `docMismatch`, `readOnly` and `userTwo` from `test/unit/server-conformance/fixtures/tickets.json` byte for byte.
- `go.sum` was not touched.
- Node mints with `{user, doc, write, ttlSeconds}` (`src/mcp/auth/tickets.ts:36`), which maps onto `Claims`.

---

## Rust (06-rust-mcp.md)

### R1. rmcp 3.9.0 is the latest — CONFIRMED (cadence wording is loose)
- crates.io API: `max_stable_version` and `max_version` are both 3.9.0, created 2026-11-05T16:07:10Z. MSRV is 1.88, the license is Apache-2.0, and it is not yanked.
- The cadence list leaves out the patch releases 3.5.1 (10-05), 3.4.1 (09-23) and 3.1.4 (08-20).
- From 3.2.0 to 3.9.0 there are 8 minor releases in about 9.5 weeks, not "nine in eleven weeks". The conclusion still holds: pin `=x.y.z`.

### R2. `preserve_order` makes tool schemas byte-equal — CONFIRMED, and stronger than stated
I rebuilt the probe with toolchain 1.99.1 in `verify-go-rust/rustprobe`.
- **Default features:** 12 of the 12 input and output schemas differ. All 6 descriptions are exact.
- **With `serde_json/preserve_order`:** all 18 strings are exact bytes.
- **Also:** all 6 whole tool objects are byte-equal to `JSON.stringify(tool)`, and so is the whole `tools` array (`JSON.stringify(got.tools.slice(0,6)) === JSON.stringify(oracle)` gives true).
- The oracle has `"x-mcp-header": "Blok-Handle"` on four tools, and it survives.

### R3. 2025 clients get no automatic elicitation fallback — CONFIRMED
- **Returning `InputRequired` on 2025-11-25 stdio** gives `-32600 "InputRequiredResult requires negotiated protocol version 2026-07-28 or newer"`.
- **Calling `peer.create_elicitation` by hand on 2025-11-25 stdio** works. The request carries `_meta.progressToken:0`.
- **2026** returns `input_required` with no `requestState`, and the retry completes.

### R4. Stateless HTTP behaviour — CONFIRMED, plus three gaps 06 does not list
Measured on `rustprobe` (hyper) and again on `rustadapter` (blok-http).
- **As stated:**
  - no `Mcp-Session-Id`;
  - 2025 stateless `client_info()` returns the placeholder name `rmcp` and `client_capabilities()` returns `{}`;
  - a `create_elicitation` on 2025 stateless HTTP hangs (curl timed out at 20 s after the server streamed `elicitation/create` as SSE);
  - GET and DELETE answer 405, a 5 MiB body answers 413, and a foreign Host answers 403;
  - a foreign Origin answers 200 by default.
- **Gap 1: `Host: localhost:1` (wrong port) answers 200 by default.** Node answers 403. 06 §1.3 does not say this.
  - SDK option: `allowed_hosts` takes `host:port` entries (`tower.rs:242-251`).
  - Measured on the adapter with `["127.0.0.1:5301","localhost:5301"]`: `Host: localhost:1` answers 403.
  - `allowed_origins` with `"http://localhost:5301"`: a foreign Origin answers 403 and the listed one answers 200.
- **Gap 2: `supportedVersions` lists all five versions**, oldest first: `["2024-11-05",…,"2026-07-28"]`. Node lists one. 06 §1.2 reports the five but never calls it a difference, and §2b lists it for Go only.
  - SDK option: override `ServerHandler::discover` (`handler/server.rs:452-460`).
  - Measured: it answers `["2026-07-28"]`, and 2025 `initialize` still negotiates.
- **Gap 3: no `_meta."io.modelcontextprotocol/serverInfo"` on 2026 results other than discover.** That covers `tools/call`, `tools/list` and `input_required`.
  - rmcp sets it only on the discover and subscription types (`model.rs:1502-1529, 2514`).
  - Node (measured) and Go put it on every 2026 result.
  - The handler can set `meta` on each result.
- **Not a gap:** a missing `resultType:"complete"` in the 06 probe came from building results with `serde_json::from_value`. rmcp's constructors default it to `Some(COMPLETE)` (`model.rs:1022-1027`). Measured: `CallToolResult::success` gives `"resultType":"complete"`. It also writes `"isError":false`. Whether Node writes `isError:false` was not measured.
- **Also measured:** rmcp does **not** enforce `Mcp-Param-*` headers. A 2026 `blok_read` with no header or a wrong one reached the handler, and grep finds the header logic only in `streamable_http_client.rs`. So Rust does not have Go's `-32020` difference.
- **Also measured:** a missing `Mcp-Method` gives `-32020`, as in Node.
- **Also measured:** an `MCP-Protocol-Version: 2024-10-07` header answers 400, the same split as Go (G5).

### R5. No server-side OAuth — CONFIRMED
- The `auth` feature is `oauth2` plus `__reqwest` (`Cargo.toml` features `:67-72`).
- grep for `oauth-protected-resource`, `WWW-Authenticate` or 401 under `src/transport/streamable_http_server/` finds nothing.
- The hits are all client-side: `transport/auth*`, `streamable_http_client.rs`, `service/client.rs`, and a parse helper in `common/http_header.rs:47`.

### R6. Can rmcp's HTTP layer run on the workspace's own `crates/http`? — YES. 06 §1.3/§1.6 and §2b need correcting.
06 says rmcp's HTTP side is a tower Service "over `http`/`hyper` types", and that it needs "an adapter … or a second listener on hyper". The adapter half is right. hyper is not needed at all.

- **Feature deps.** `transport-streamable-http-server` = `server-side-http` + session + worker. `server-side-http` pulls in `http`, `http-body`, `http-body-util`, `bytes`, `sse-stream`, `tower-service`, `rand`, `uuid` and `base64` (rmcp `Cargo.toml` features). **hyper and hyper-util are only in `transport-streamable-http-client-unix-socket`.**
- **The adapter is about 30 lines** (`verify-go-rust/rustadapter/src/main.rs`):
  1. A `blok_http::Handler` closure reads the body with `Body::read_to_end`.
  2. It builds `http::Request<Full<Bytes>>` from `method()`, `target()` and `headers().iter()`.
  3. It calls `StreamableHttpService::handle` (`tower.rs:1955`).
  4. It copies status and headers to `ResponseWriter`, then writes each body frame with `write` + `flush`, so SSE frames can stream.
- **Builds:** offline on 1.99.1, depending on `blok-http` by path. `cargo tree -e normal` has **no hyper, hyper-util, axum or reqwest**.
- **Measured through `blok-http`:**
  - discover, tools/call and 2025 `initialize` answer 200;
  - the answers carry `Server: Kestrel`, because blok-http still writes the HTTP framing;
  - the Host port check and the Origin check answer 403 when configured;
  - GET and DELETE answer 405, and 5 MiB answers 413.
- **Effect on `packages/server/rust/README.md:37-38`** (lines confirmed):
  - **Line 37 (own HTTP/1.1 server) does not need an exception.** The listener, framing, limits and timeouts stay `blok-http`. Only the MCP protocol layer behind `/mcp` is rmcp's.
  - The README amendment that §4b asks for can be narrow: "rmcp's `StreamableHttpService` runs behind `blok-http` through an adapter; no hyper."
  - **Line 38 (JSON through `blok-jsjson`) still needs the approved exception.** rmcp writes every envelope with `serde_json`.
  - Two details for the adapter, both measured only on short JSON answers:
    - `blok-http`'s `max_request_body` default is 30 MB (`lib.rs:55`), so rmcp's 4 MiB cap is the one that answers.
    - The adapter streams, so answers go out chunked unless the adapter sets `Content-Length`.

### R7. Executor/session borrowing — PARTLY: no blokagent API change is needed
- **The facts hold.**
  - `Session<'e> { executor: &'e Executor, … }` (`blokagent/src/session.rs:20-25`).
  - `open_session(&self, …) -> Session<'_>` (`:29`).
  - `Server::agent_executor() -> Result<Arc<Executor>, CollabError>` (`blokserver/src/collab.rs:424`).
  - A struct cannot hold both the `Arc` and a `Session` that borrows from it.
- **The conclusion "this is an API change in blokagent" is wrong.** A per-handle task can own the `Arc` and borrow it inside its own future:

  ```rust
  tokio::spawn(async move {
      let mut s = executor.open_session(actor, None);
      while let Some(..) = rx.recv().await {
          s.execute(&cancel, &doc, &batch).await
      }
  })
  ```

  The handle then talks to the task over an mpsc channel.
- `verify-go-rust/sessioncheck` compiles this against the real `blok-blokagent` with `cargo check`. So the session future is `Send + 'static`. The task also serializes calls per handle, which is the mutex Node's `HandleRegistry.use` provides.
- An owning `Session` in `blokagent` stays an option, not a requirement.
- 06 §2.1 is also right that `invoke` is `pub(crate)` (`executor.rs:113`). New bundle ops still need public wrappers.

### R8. Release route — CONFIRMED (one cite off)
- `jsruntime/src/runtime.rs:7-8` does `include_str!("../../../../go/internal/jsruntime/blok-server-runtime.js")`.
- `rust/Cargo.toml:9` sets `publish = false` for the workspace.
- `README.md:5` says "ships nothing yet".
- grep finds no `rust` or `cargo` step in `release-server.yml`.
- I did not re-run the `cargo package` experiment. With `publish=false` and the out-of-crate `include_str!`, crates.io is blocked as things stand either way.
- "Release archives plus an npm wrapper" is consistent with `packages/server/bin/blok-server.mjs`.
- **Cite fix:** the musl handling is at `:35-53`, not `:24-31` (`:24-31` holds the platform and runtime tables).

---

## 00-plan.md §2b — summary of corrections

| §2b line | Verdict | Correction |
|---|---|---|
| Go SDK v1.8.0, 2024-11-05..2026-07-28 | CONFIRMED | — |
| Go: schemas, instructions and prompts match; 2026 retry and 2025 fallback work | CONFIRMED (G3) | The 2025 fallback request has no `_meta.progressToken`. Node and rmcp send one. |
| Go "open differences" (3) | REAL, but all removable | (a) a discover middleware; (b) a middleware that swaps in a custom result with no `content`; (c) register without `x-mcp-header`, put it back on a **copied** tool in `tools/list`. Add the mismatched-header case and the 2024-10-07 HTTP 400 (G5). |
| Go `blokmcp` gets internals | CONFIRMED | — |
| `ticket.Mint` at `mint.go:43` | CONFIRMED | — |
| Go outbound law bans WS clients outright | PARTLY | It bans only `x/net/websocket` dial names and raw dialing in Blok sources. A third-party WS module would pass. |
| rmcp 3.9.0 works with `preserve_order` | CONFIRMED | Whole tool objects are byte-equal too. |
| rmcp breaks README:37-38 | PARTLY | Line 37 is not broken if rmcp runs behind `blok-http` (no hyper, measured). Only line 38 needs the exception. |
| No server-side OAuth | CONFIRMED | — |
| Rust differences (not listed in §2b) | MISSING | `supportedVersions` lists five (fix: override `discover`); no `_meta.serverInfo` on non-discover 2026 results (set it in the handler); wrong-port Host gets 200 by default (fix: `allowed_hosts` with `host:port`); 2024-10-07 HTTP answers 400. |
| A long-lived handle needs an owning Session | PARTLY | A per-handle task that owns the `Arc` works today (compiles). No API change is needed. |
| crates.io blocked; archives plus npm wrapper | CONFIRMED | — |

## Not verified here
- Whether Node writes `isError:false` on success (rmcp's `CallToolResult::success` does).
- Whether the blok-http adapter streams SSE correctly. Only JSON answers were measured through it.
- Whether a stricter client rejects Go's legacy `elicitation/create` without `progressToken`.
