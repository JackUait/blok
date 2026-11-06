# 06 — A Rust MCP server: SDK, reuse map, distribution

Date: 2026-11-06/07. Research only. No repo file changed except this one.

Paths under `rust/` mean `packages/server/rust/`. Crate paths mean `rust/crates/<name>/`.

How to read this:

- **[run]** I ran it in this session. The probe lives in the session scratchpad, at `/private/tmp/claude-501/-Users-jackuait-Packages-blok/127fe423-fcdf-4069-b172-fc3dabc89038/scratchpad/rust-mcp/`:
  - `src/main.rs` is the server;
  - `drive.py` drives stdio;
  - `rawlist.py` and `check.mjs` do the byte check;
  - `src/bin/nums.rs` is the JSON drift check.
  - The probe was built with the workspace toolchain, Rust 1.99.1 (`rust/rust-toolchain.toml`).
  - It is a standalone crate and is not part of the workspace.
- **[src]** It comes from the rmcp 3.9.0 source, downloaded from crates.io. A file:line cite is given.
- **[repo]** It comes from a file in this repo. A file:line cite is given.
- **Unverified** means it was not measured.

The schemas used as the oracle are Node's real tool list: `tools-mixed.json`, dumped by `assembleMcp` during the C# research (`dump.ts` in the same scratchpad).

---

## 0. Answer first

- **rmcp can do the job.** The official Rust SDK covers everything Blok's Node MCP relies on: protocol versions, raw schemas, prompts, instructions, the 2026 retry approval, a manual 2025 fallback, stdio and stateless HTTP.
- **But it breaks two workspace rules:**
  - *"JSON goes through `blok-jsjson`, never `serde_json`, for anything a fixture or a client reads"* (`rust/README.md:38`). rmcp writes every byte with `serde_json`.
  - *"The HTTP/1.1 server and the WebSocket code are our own"* (`rust/README.md:37`). rmcp's HTTP side is a tower `Service` over `http`/`hyper` types.
- **The JSON drift is measured, and it is narrow** (§1.4):
  - With default features, every Blok tool schema comes back with its keys reordered. `serde_json/preserve_order` fixes that, and then all 18 schema and description strings match byte for byte.
  - What is left is integers at or above about 1.8e19, which serde_json prints differently from JS in both directions, and lone surrogates, which fail to parse.
- **A hand-written MCP layer** on `blok-jsjson` + `blok-http` is about 2–3k lines plus tests. That is an estimate, not a measurement (§1.7). This is the same trade the workspace already made for HTTP and WebSocket.
- **Decision for the user:** rmcp with the rules relaxed for the MCP crate, or a hand-written layer that keeps the rules (§1.8).

---

## 1. The Rust MCP SDK (`rmcp`)

### 1.1 Current state

| Item | Value | Evidence |
|---|---|---|
| Crate | `rmcp`, repo https://github.com/modelcontextprotocol/rust-sdk/ | [run] `https://crates.io/api/v1/crates/rmcp` |
| Latest stable | **3.9.0**, published 2026-11-05T16:07Z | [run] same API, `max_stable_version` |
| Cadence | 3.1.3 (08-17), 3.2.0 (08-31), 3.3.0 (09-10), 3.4.0 (09-15), 3.5.0 (09-28), 3.6.0 (10-20), 3.7.0 (10-22), 3.8.0 (10-26), 3.9.0 (11-05). That is about one minor release a week. | [run] same API |
| MSRV | 1.88. The workspace pins 1.99.1. | [run] crates.io `rust_version`; [repo] `rust/rust-toolchain.toml:2` |
| License | Apache-2.0, the same as the workspace (`rust/Cargo.toml` `license`) | [run] crates.io |
| Runtime | tokio (`sync, macros, rt, time`) is required. That fits: the workspace runs on tokio (`rust/README.md:36`). | [run] `/api/v1/crates/rmcp/3.9.0/dependencies` |
| Always-on deps | `serde`, `serde_json`, `chrono`, `futures`, `indexmap`, `tracing`, `thiserror`, `tokio-util`, `sha2 ^0.11`, `libc`, `pin-project-lite` | same |
| Protocol versions | `2024-11-05`, `2025-03-26`, `2025-06-18`, `2025-11-25`, `2026-07-28`. `LATEST` is 2026-07-28. `LATEST_WITH_INITIALIZE` is 2025-11-25. | [src] `src/model.rs:169-176,201,289-293`; [run] discover answered `supportedVersions` with these five |

**The minimal feature set** is `default-features = false, features = ["server", "transport-io", "elicitation"]`. [run] It resolves to 89 unique crates. Of those, 45 name+version pairs are not in `rust/Cargo.lock` today:

- `serde_json` itself is new. `serde` is already locked, but only transitively.
- So are `schemars`, `chrono`, `tracing*`, `futures*`, `url`, `uuid`, `indexmap`, `thiserror`, `syn`, and a second `sha2` (0.11; the workspace uses 0.10).
- The `elicitation` feature pulls in `url`, which brings `idna` and `idna_adapter`. These are not the version `crates/dotnet` pins to `~1.1`.

**Features that are off-limits here:**

- `auth` pulls `reqwest` and `oauth2` ([run] crates.io features list).
- Every `transport-streamable-http-client*` feature is the client side.

Neither is needed for a server.

### 1.2 What was measured over stdio

The probe uses the low-level `ServerHandler` (`list_tools`, `call_tool`, `list_prompts`, `get_prompt`, `get_info`). It has no macros or reflected tools. That is the same shape as Node's `setRequestHandler`.

| Check | Result |
|---|---|
| `server/discover` (2026-07-28) | [run] `{"resultType":"complete","supportedVersions":[...5...],"capabilities":{"prompts":{},"tools":{}},"instructions":"...","ttlMs":0,"cacheScope":"private","_meta":{"io.modelcontextprotocol/serverInfo":{...}}}` |
| `initialize` (2025-11-25, 2025-06-18, 2024-11-05) | [run] Echoes the client's version. Capabilities are exactly `{"prompts":{},"tools":{}}`, so **no `logging`** (C# adds it, `03` §3 item 7). `instructions` is present. |
| `initialize` with `2024-10-07` | [run] Answers `protocolVersion: "2025-11-25"`. It does not refuse. Node accepts 2024-10-07 as is (`03` §0). |
| Instructions | [run] Present in both `initialize` and `server/discover`. `\n` survives. |
| Prompts | [run] `prompts/list` and `prompts/get` round-trip. On 2026-07-28, list results gain `ttlMs:0,cacheScope:"private"`, as in C# and Node (`03` §3 item 10). |
| Per-request client identity | [run] `RequestContext::client_info()` returned `probe` from `_meta` on 2026-07-28, and from `initialize` on 2025-era stdio ([src] `src/service.rs:1238-1268`). |
| Raw tool schemas, **default features** | [run] **12 of 12 schemas differ** from Node's bytes. All six tools' `inputSchema` and `outputSchema` had their keys sorted (`type` moved after `properties`). The 6 descriptions were exact. Cause: `Tool.input_schema` is `Arc<JsonObject>`, and `JsonObject = serde_json::Map` ([src] `src/model/tool.rs:27,30`, `src/model.rs:45`). That is a `BTreeMap` unless `preserve_order` is on. |
| Raw tool schemas, `serde_json/preserve_order` | [run] **18 of 18 exact bytes**. The raw `tools/list` line contains `JSON.stringify(schema)` for every input schema, output schema and description (`check.mjs`). A consumer crate can turn this on through feature unification. |
| 2026 approval flow (MRTR, SEP-2322) | [run] Returning `CallToolResponse::InputRequired(InputRequiredResult::from_input_requests({approve: elicitation/create}))` gave `{"resultType":"input_required","inputRequests":{"approve":{"method":"elicitation/create",...}}}`. The retry carried `inputResponses` and **no `requestState`**, and the handler finished. This matches Node, which sends no `requestState`. |
| Returning `InputRequired` to a 2025-era peer | [run] Error `{"code":-32600,"message":"InputRequiredResult requires negotiated protocol version 2026-07-28 or newer"}` ([src] `src/handler/server.rs:307-311`). **rmcp has no automatic legacy shim.** Node's SDK and C#'s SDK both turn this into a real `elicitation/create` (`03` §2.4). |
| Manual 2025 fallback | [run] The handler branched on `context.protocol_version()` and called `context.peer.create_elicitation(params)` (feature `elicitation`). Over stdio on 2025-11-25, 2025-06-18 and 2024-11-05, the client got a real `elicitation/create` request with `_meta.progressToken`, answered it, and the tool finished. That call errors on 2026-07-28 peers by design ([src] `src/service/server.rs:59-67`). |

So the Rust port must write the fallback itself:

- if the protocol version is 2026-07-28 or later, return `InputRequired`;
- else, if the client declared form elicitation (Node's `canElicit`) and the session is stdio, call `create_elicitation`;
- else, do not ask.

### 1.3 Stateless streamable HTTP (measured with a hyper adapter)

rmcp's server side is `StreamableHttpService`, a `tower_service::Service<http::Request<B>>` ([src] `src/transport/streamable_http_server/tower.rs:1495-1506`). It is not tied to axum. To drive it, the probe added `hyper` + `hyper-util` (feature `http`). Config: `legacy_session_mode = false`, `json_response = true`, `NeverSessionManager`.

| Check | Result |
|---|---|
| 2026-07-28 discover, tool call, approval retry | [run] 200 `application/json`, with no `Mcp-Session-Id`. The input-required result and the retry worked, the same as stdio. |
| 2025-11-25 `initialize` | [run] 200, with no session id |
| 2025-11-25 `tools/call` that calls `create_elicitation` on stateless HTTP | [run] **Hung** (killed after 120 s). There is no channel for the client's answer. The port must never ask there, which is Node's behaviour (`03` §2.4 last row). |
| Client identity on 2025-11-25 stateless HTTP | [run] `client_info()` returned name **`rmcp`**, a placeholder, not null. `client_capabilities()` returned `{}`. So a `canElicit` gate (ask only when `capabilities.elicitation` is present) skips the question there and avoids the hang. The port must not take `rmcp` as the client's real name. It must fall back to Node's default instead. |
| GET / DELETE `/mcp` | [run] 405 / 405. Node also answers 405. |
| Foreign `Host: evil.example:5299` | [run] 403 `Forbidden: Host header is not allowed`. Default `allowed_hosts` is `localhost`, `127.0.0.1`, `::1` ([src] `tower.rs:337-349`). This is better than C#, which served it (`03` §3 item 2). |
| Foreign `Origin` | [run] 200. Origin checking is opt-in through `allowed_origins`, which is empty by default ([src] `tower.rs:252-268`). Blok must set it. |
| 5 MiB body | [run] 413. Default `max_request_body_bytes` is 4 MiB ([src] `tower.rs:54,301`). This matches Node's cap. |

**OAuth.** rmcp has no server-side resource-server support:

- The `auth` module is client-side. It covers the authorization manager, the metadata resolver and reqwest's DNS hooks ([src] `src/transport/auth/metadata_resolver.rs:1-20`, `src/transport.rs:96-100`).
- A grep for `oauth-protected-resource` and `WWW-Authenticate` outside the client and auth files found no server-side challenge or metadata route.

So the `401` + `WWW-Authenticate: Bearer resource_metadata=...` answer, the root metadata route and the JWT verifier are all Blok's to write, whichever route is taken. The verifier needs RS256/ES256, `typ at+jwt`, no `crit`, JWKS with TTL and cooldown, and the `sub`/`client:` rules. `ring` 0.17 is already a workspace dep (`crates/outbound/Cargo.toml`) and can verify both algorithms (unverified for ES256 JWS encoding details).

### 1.4 JSON drift: why `rust/README.md:38` exists

Measured with the probe's `serde_json` (`src/bin/nums.rs`, with `preserve_order`), against Node's `JSON.stringify(JSON.parse(x))`.

The engine's answers leave the JS bundle as `JSON.stringify` text. If the port parses that text into `serde_json::Value` (for example for `structuredContent`) and rmcp writes it again, only some rows can occur.

**Reachable from bundle output:**

| Input (as JS writes it) | serde_json writes | JS writes |
|---|---|---|
| `18446744073709552000` (2^64 as JS prints it) | `1.8446744073709552e+19` | `18446744073709552000` |
| `100000000000000000000` | `1e+20` | `100000000000000000000` |
| `123456789012345680000` | `1.2345678901234567e+20` | `123456789012345680000` |
| `999999999999999900000` | `1e+21` (rounded wrong) | `999999999999999900000` |
| `"\ud800"` (lone surrogate, which `JSON.stringify` writes as an escape) | **parse error** | `"\ud800"` |
| Object key order, default features | sorted | insertion order |
| `1e21`, `1e-7`, `5e-324`, `1.5e300`, `0.1` | `1e+21`, `1e-7`, `5e-324`, `1.5e+300`, `0.1` | same |
| `{"a":1,"a":2}` | `{"a":2}` | `{"a":2}` |

**Only from JSON the host writes itself** (`JSON.stringify` never emits these):

| Input | serde_json writes | JS writes |
|---|---|---|
| `18446744073709551615` (u64 max) | `18446744073709551615` (kept exact) | `18446744073709552000` |
| `-0` | `-0.0` | `0` |
| `1.0` | `1.0` (also seen in `structuredContent`, [run]) | `1` |

So with `preserve_order` on, the drift reachable from the bundle is narrow: integers of 1.8e19 and up, and lone surrogates. Whether the bundle ever emits either in an MCP answer is unverified. The conformance suite would compare bytes either way.

**Way around it inside rmcp:** pass engine output only as text content, and build `structuredContent` with `serde_json::value::RawValue`. This was not tested. `CallToolResult.structured_content` is a `Value`, not raw, so this probably does not work without an rmcp change (unverified).

### 1.5 Other rmcp facts that matter

- **Stray stdout.** Unverified whether a `println!` corrupts the stdio framing. stdio is `tokio::io::stdout()` ([src] `src/transport/io.rs:16`), so a port should forbid `print!` in the MCP crate (clippy `print_stdout`).
- **Cancellation.** `RequestContext.ct` is a `CancellationToken` cancelled by `notifications/cancelled` ([src] `src/service.rs:1213-1215`). It maps onto `blok_blokagent::Cancel`.
- **Output-schema projection.** No equivalent of Node's `projectCallToolResult` was found (not searched exhaustively). Treat it as Blok's to write, as in C#.
- **Churn.** Nine minor releases in eleven weeks (§1.1). A pinned `=x.y.z` plus deliberate bumps would be needed. The conformance suite would catch wire changes.

### 1.6 Fit with the workspace stack

| Workspace rule or law | rmcp | Evidence |
|---|---|---|
| tokio | fits | `rust/README.md:36` |
| Own HTTP/1.1 server (`crates/http`, 3,790 lines) | **conflicts** for HTTP. Using rmcp's HTTP means either an adapter from `blok_http::Request` to `http::Request` + `http_body::Body`, or a second listener on hyper. stdio is unaffected. | `rust/README.md:37`; [src] `tower.rs:1495`; [run] `cargo tree` |
| JSON through `blok-jsjson` | **conflicts.** Every envelope and result is serde_json. | `rust/README.md:38`; §1.4 |
| Outbound dial law (`crates/outbound/src/law_test.rs:10-31`) | The server features dial nothing. The law scans only workspace sources (`law_test.rs:271-284`), so a dependency that dials would slip past it. That is why `auth` must stay off. | [repo] |
| WebSocket-client ban (`law_test.rs:483-497`, checks `Cargo.lock` too, `:501-516`) | None of the banned names appear in the probe's tree | [run] `cargo tree` |
| `unsafe_code = "deny"` (`rust/Cargo.toml` `[workspace.lints.rust]`) | The lint applies only to workspace crates, not to deps | [repo] |
| Dependency audit or license gate | None found. A grep for `cargo deny`, `cargo audit`, `cargo-deny` and `deny.toml` over `.github/workflows/*.yml` and `rust/` found nothing. The only lockfile scan is the WebSocket-client ban. | [run] grep |

### 1.7 A hand-written MCP layer: what it needs

Estimate only. It is sized against the parts the probe exercised and the existing own-stack crates (`crates/http` 3,790 lines, `crates/ws` 2,210 lines, both incl. tests in `src`).

| Piece | Rough size |
|---|---|
| stdio: newline-delimited JSON-RPC read/write, one writer task, no stdout leaks | ~150 |
| JSON-RPC envelope: ids (number/string), errors (-32600/-32601/-32602/-32603), notifications, `notifications/cancelled` → `Cancel` | ~350 |
| Version handling: `initialize` negotiation for five or six legacy revisions, `server/discover`, per-request `_meta` (`protocolVersion`, `clientInfo`, `clientCapabilities`), `resultType`, `ttlMs`/`cacheScope`, `_meta.serverInfo` | ~400 |
| Dispatch: `tools/list`, `tools/call`, `prompts/list`, `prompts/get`, `ping` | ~200 |
| Approvals: input-required result and retry on 2026; on 2025 stdio, a server→client `elicitation/create` with id correlation and a timeout | ~350 |
| Streamable HTTP on `blok-http`: POST `/mcp`, `Mcp-Method`/`Mcp-Name`/`MCP-Protocol-Version` headers, JSON response, 405 for GET/DELETE, 413 at 4 MiB, Host and Origin checks, 404 elsewhere | ~500 |
| Total | **~2–3k lines plus tests** |

The bytes are then `blok-jsjson`'s by construction. The shared MCP conformance suite (`00-plan.md` milestone 1) becomes the spec, which is the reasoning already applied to HTTP and WS (`rust/README.md:37`).

### 1.8 The decision

| | rmcp 3.9.0 | Hand-written |
|---|---|---|
| Work | Small for the protocol. Still needs the 2025 fallback, OAuth, Origin list, `preserve_order` and an HTTP adapter. | ~2–3k lines (estimate) |
| Workspace rules | Breaks `README.md:37-38` for this crate. Adds ~45 locked crates, incl. `serde_json`. | Keeps all of them |
| Byte parity risk | Measured drift (§1.4). Key order is fixable. Number forms and lone surrogates are not. | None beyond normal bugs |
| Upkeep | Weekly minor releases (§1.1) | Spec changes land by hand |

Recommendation, labelled as such: **hand-written, but it is a close call.**

- The measured drift is narrow (§1.4), so byte parity alone does not force the choice.
- What tips it is the two written rules. The HTTP rule (`README.md:37`) and the JSON rule (`README.md:38`) each stand on their own, and Rust is the one backend whose whole stack is already hand-rolled.
- If the user prefers rmcp, the README needs an explicit exception for the MCP crate. The port then needs `preserve_order`, a pinned version, and an adapter from `blok-http`.

---

## 2. Rust server reuse map

### 2.0 Public vs crate-private: no InternalsVisibleTo problem

Rust has no `internal` gate across workspace crates. A `pub` item in one crate is usable from a new `crates/mcp`. What is not reachable is `pub(crate)`, and that matters only for history and versions (below). This is unlike C#, where most room and ticket pieces are `internal` (`02` §0).

| Piece | Visibility | Where |
|---|---|---|
| `Executor` (`execute`, `contract`, `room_contract`, `execute_in_room`, `open_session`) | pub | `crates/blokagent/src/executor.rs:76,126,231,242`; `room.rs:122`; `session.rs:29` |
| `Session` | pub | `session.rs:20` |
| `Actor`, `Execution`, `Options`, `PageTarget`, `PageCreator`, `StoredPage`, `PageLocation`, `Cancel` | pub | `types.rs:12-89`; `cancel.rs:18` |
| `Rooms::new(Manager)` | pub | `room.rs:31-37` |
| Server's shared executor `Server::agent_executor()` | pub | `crates/blokserver/src/collab.rs:420-440` ("No route calls it; a host embedding the server does") |
| Room `Manager` (`join`, `edit`, `agent_edit`, `state`) | pub | `crates/collab-room/src/manager.rs:67,291,349,379,434` |
| `Member` / `Membership` traits | pub | `crates/collab/src/lib.rs:43,77` |
| Room history / version replay | `pub(crate)` | `roomhistory.rs`, `versions.rs:22`, `roomreplay.rs:75`. Reachable only through `Executor` batches (`history.*`, version commands). |
| Wire codec (`Message`, `read_var_uint`, awareness encode/validate) | pub | `crates/collab-wire/src/lib.rs:50,138`; `awareness.rs:7,20,62` |
| Ticket mint / verify | pub | `crates/blokserver-ticket/src/lib.rs:68` (`mint`); `crates/ticket/src/lib.rs:48` (`verify`) |
| Doc endpoint `Client` (`load`, `save`) | pub | `crates/collab-docendpoint/src/client.rs:129,190,199` |
| `Authorization` trait (`can_read_document`, `can_write_document`) | pub | `crates/auth/src/lib.rs:32-39` |
| Document converter | pub | `blokserver/src/collab.rs:415` (`document_converter`) |

### 2.1 Agent engine

- **The same bundle.** `crates/jsruntime/src/runtime.rs:7-8` does `include_str!("../../../../go/internal/jsruntime/blok-server-runtime.js")`. New bundle ops (`00-plan.md` milestone 2: `read`, `describe`, `parseToolCall`, tool schemas, instructions, skills) reach Rust with no extra work. The Rust side then calls them through `Executor`'s invoker. Today `invoke` is `pub(crate)` (`executor.rs:113`), so a public wrapper per new op is needed.
- **Stored execute:** `Executor::execute(cancel, doc_json, batch_json, actor, options)` (`executor.rs:126-139`). It returns the document only on success.
- **Undo/redo, stored:** `Session` carries the steps, with caps of 100 steps and 4 Mi UTF-16 units (`session.rs:9-13,20-26`). It takes `&mut self`, so calls are serialized by the type system.
- **A borrow catch for handles.** `Session<'e>` borrows `&'e Executor` (`session.rs:20-21`). The server hands out `Arc<Executor>` (`collab.rs:424`). A handle registry that keeps a `Session` for minutes cannot hold both the `Arc` and a `Session` borrowing from it without self-reference. Fix it with a small owning API in `blokagent` (for example `Session` over `Arc<Executor>`), or by leaking a `'static` executor. This is an API change in `blokagent`.
- **Contracts:** `contract`, `room_contract`, `Session::contract` return the full contract JSON (`executor.rs:230-249`, `session.rs:47-55`). There is no `describe` slice, the same gap as C#.
- **Co-authoring:** the actor is sent as `{id, name, kind:"agent", onBehalfOf}` (`wire.rs:190-200`). Attribution tests are a port of C#'s (`csharp_agent_test.rs` exists; the exact `createdBy`/`createdWith` test name was not checked).
- **Sub-pages:** `Options.page_titles` + `page_target` + `as_creator()`. Pages are created before the bundle runs (`types.rs:35-76`, `pagecreate.rs:24`, `wire.rs:165-172`).
- **Approvals: missing.** As in C#, room replay answers `APPROVAL_REQUIRED` (`roomreplay.rs:335-358`). `wire::common` sends no `approve`. The fix is the same as C#'s milestone 6: run once, return input-required, run again with an `approve` input.
- **Uploads: missing.** `wire::common` sends only `pageBackend` in `services` (`wire.rs:162-187`). There is no `uploader`.

### 2.2 Live rooms

- **In process: exists.** `Executor::execute_in_room(cancel, doc_id, batch, actor, options)` (`room.rs:116-140`). Without `Rooms` it answers COMMAND_UNAVAILABLE. The revision is the journal head `lineage:sequence` (`room.rs:116-121`). `Server::agent_executor()` already wires `Rooms` when collab is on (`collab.rs:427-436`).
- **Version history:** in process only, when the manager has a journal with history (`versions.rs:50`).
- **Presence: missing, but reachable.** No awareness in `blokagent` (grep: 0 hits). An in-process member can be written today:
  - implement `Member` (`collab/src/lib.rs:43-58`), then call `Manager::join`;
  - encode awareness with `collab-wire` (`awareness.rs`);
  - rooms already track awareness owners (`collab-room/src/room.rs:39,119-121`).
- **Remote sync service: missing.** `crates/ws` is server-only. Its doc says "The server side of RFC 6455" (`ws/src/lib.rs:1`), and it unmasks inbound frames (`:201-211`). A client needs: masking, the client handshake (ticket in the `blok-sync.v1/.v2` subprotocol offer, Origin header), and the v2 op/ack client with reconnect and outbox. Every third-party WS client is banned by name and through `Cargo.lock` (`outbound/src/law_test.rs:480-516,573-583`). So it is hand-written, like the C# side (`00-plan.md` milestone 7).

### 2.3 Tickets

- Secret mode **exists**: `blok_blokserver_ticket::mint(secret, &Claims, now)` matches C#'s `BlokTicket.Create` byte for byte (`blokserver-ticket/src/lib.rs:1-4,68-76`; min secret 32 UTF-16 units, default TTL 300).
- Verifying **exists**: `blok_ticket::verify` (`ticket/src/lib.rs:48`).
- URL mode (POST to a host, check claims) is **missing**, and it is an outbound call.

### 2.4 Doc endpoint and sources

- `collab_docendpoint::Client` is **pub**, and it already holds one of the three pinned operator-client constructions (`law_test.rs:28-31`). A stored endpoint source can reuse it with no law change.
- `load` (GET; bare data, `{data,version}` envelope, or null) and `save` (PUT with version and optional projection) exist (`client.rs:188-215`).
- **No list route.** **No 409 → `DOCUMENT_CHANGED` mapping**, but `Error::Endpoint.status_code` carries the status (`client.rs:55-58`), so the mapping is a few lines in the MCP crate.
- It is built from `Options { endpoint, authorization, request_timeout, max_response_bytes }` (`client.rs:31-38`). It follows no redirect (`client.rs:126`).
- **Files source: missing.** It needs the exact Node bytes: `JSON.stringify(doc,null,2)+"\n"`, a SHA-256 version, lock keys, UTF-16 sort (`00-plan.md` milestone 3). `blok-jsjson` should be able to write the 2-space form; that is unverified.

### 2.5 Outbound law

Only `outbound/src/fetcher.rs` and `operator.rs` may dial. Only `operator.rs`, `blob/src/s3.rs` and `collab-docendpoint/src/client.rs` may build an `OperatorClient` (`law_test.rs:20-31`). Each Node outbound call maps as follows:

| Node call | Rust route |
|---|---|
| Endpoint GET/PUT | existing `docendpoint::Client` (no change) |
| Endpoint list | add to `docendpoint::Client` (no new owner) |
| Ticket URL POST | new `CLIENT_OWNERS` entry |
| Authorize webhook | new `CLIENT_OWNERS` entry |
| JWKS fetch | new `CLIENT_OWNERS` entry, or the guarded `Fetcher` (it has only `get`, `fetcher.rs:201`; whether its policy allows the JWKS host is unverified) |
| Live version-history HTTP | new `CLIENT_OWNERS` entry |
| Sync WebSocket | a new dial owner, because a WS client needs a raw TCP/TLS stream, not an HTTP request. That means an edit to `DIAL_OWNERS`. |

### 2.6 Gap table (mirrors `02` §7)

| Node MCP capability | Rust today | Where / note | Outbound |
|---|---|---|---|
| `blok_execute` stored | exists | `Executor::execute`, `Session::execute` | — |
| `blok_execute` live, same process | exists | `execute_in_room` | — |
| `blok_read` | partial | `doc.read` batch + unwrap, as C#; parity unverified | — |
| `blok_describe` `{tool,command}` | missing | full contract only | — |
| Tool-call parsing, arg refusal, error answers | missing | not in bundle (`02` §1) | — |
| MCP tool schemas | missing | not in bundle | — |
| Handles (open/close, idle expiry, per-principal cap) | missing | plus the `Session<'e>` borrow (§2.1) | — |
| `blok_list_documents` | missing | no list in `docendpoint::Client` | yes (existing owner) |
| Server instructions | missing | not in bundle | — |
| Prompts (skills) | missing | not in bundle | — |
| Stored endpoint source | partial | `docendpoint::Client` pub; no 409 map, no list | yes (existing owner) |
| Files source | missing | — | — |
| Live room, same process | exists | `Server::agent_executor()` with rooms | — |
| Live room, remote over WS | missing | `crates/ws` server-only; third-party clients banned | yes (new dial owner) |
| Presence | missing | `Member` + `Manager::join` are pub, so it is buildable | — |
| Version history | partial | in process with journal; no remote HTTP client | yes for remote |
| Undo/redo | exists | `Session` (stored), room history (in process) | — |
| Co-authoring | exists | `wire.rs:190-200` | — |
| Sub-page create / rename | exists | `PageTarget`, `PageCreator` | — |
| Uploads | missing | no `uploader` service | — |
| Approval (unlock, restore, share) | missing | `APPROVAL_REQUIRED` (`roomreplay.rs:335-358`) | — |
| Tickets, secret mode | exists | `blokserver-ticket::mint` | — |
| Tickets, URL mode | missing | — | yes |
| OAuth (JWT, JWKS) | missing | `ring` present; no JWT code | yes (JWKS) |
| Authorize hook | partial | `blok_auth::Authorization` fits; webhook missing | yes for webhook |
| Custom tools / overrides / comments off | exists | `Options.custom_tools_json`, `overrides_json`, `disable_built_in_comments` (`types.rs:35-49`) | — |
| stdio transport | missing | rmcp or hand-written (§1) | — |
| Streamable HTTP | missing | `crates/http` exists; MCP layer missing | — |

---

## 3. Distribution: "ships nothing yet"

What exists:

- `rust/README.md:5`: "It ships nothing yet: the npm binary, the Docker image and the NuGet packages still ship the C# server."
- Every crate is `publish = false` through `[workspace.package]` (`rust/Cargo.toml:9`).
- CI only tests Rust: fmt, clippy, nextest, and the conformance and interop runs (`.github/workflows/ci.yml:95-119,548-575`).
- `release-server.yml` builds C# archives (`scripts/publish-server.mjs`) and Go archives (`scripts/publish-server-go.mjs`, `blok-server-go_*` plus `checksums-go.txt`), with no Rust step (`.github/workflows/release-server.yml:155-183,246-253`).

What shipping a Rust MCP needs:

1. **A binary crate**, for example `crates/blok-mcp` (name to be decided), next to `crates/blok-server`. It needs the same flags and env as `blok-mcp`, stdio by default, and `--http`.
2. **Release archives.** A `scripts/publish-mcp-rust.mjs` (or a Rust branch in the Go script) that cross-builds for the same platform set the npm wrapper resolves: darwin/linux/windows × x64/arm64, plus musl (`packages/server/bin/blok-server.mjs:24-31`). It also writes a checksums file and smoke-tests each archive, as `release-server.yml:161-183` does for C# and Go. `ring` needs a C toolchain per target, and Windows needs MinGW (`rust/README.md:7`). Only `--target x86_64-pc-windows-gnu` is checked today.
3. **crates.io is not a channel as things stand.** [run] `cargo package` does not carry a file that `include_str!` reaches outside the crate. A scratch crate with `include_str!("../../outside.txt")` packaged only `src/lib.rs` and the manifests, and the verify build failed with "couldn't read `src/../../outside.txt`". `jsruntime` reaches `../../../../go/...` (`runtime.rs:8`), so publishing any crate that depends on it would need the bundle copied into the crate. It would also need `publish = false` lifted for the whole dependency chain (jsruntime, blokagent, collab-*, jsjson, …).
4. **npm.** `@bloklabs/mcp` is a Node package today (`packages/mcp/package.json`, `bin: blok-mcp` → `bin/blok-mcp.mjs`). `@bloklabs/server`'s wrapper shows a pattern: download the platform archive from the GitHub release, check checksums, cache it, run it (`packages/server/bin/blok-server.mjs:1-10`). A Rust MCP could ship the same way. Whether it would replace the Node `blok-mcp` or sit beside it is a user decision.
5. **MCP registry.** `server.json` `registryType` is a free string with examples `npm`, `pypi`, `oci`, `nuget`, `mcpb` ([run] `https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json`). There is no `cargo` example. Whether the registry accepts one is unverified. `mcpb` (a bundle with a binary) or `oci` are the likely routes, also unverified.
6. **Docker.** The image ships the C# server (`rust/README.md:5`). An MCP image is optional, not required for parity.
7. **Wiring tests.** Add the new archives to `server-release-wiring.test.ts`, `verify-docs-release.mjs`, and the docs in both locales, as for C# (`02` §6).
8. **CI.** The Rust gates already run inside an existing job to respect the 20-job cap (`ci.yml:548-549`). MCP conformance `--target rust` would join the existing Rust conformance step (`ci.yml:115-116`). Its run time is unmeasured.

---

## 4. Still unverified

- Whether a `print!` to stdout corrupts rmcp's stdio framing.
- Whether `structuredContent` can be passed as raw text through rmcp without a `Value` round-trip.
- Whether the JS bundle ever emits `-0`, integers ≥ 1e20, or lone surrogates in MCP answers.
- Whether `blok-jsjson` can write `JSON.stringify(doc,null,2)` form exactly.
- Whether the guarded `Fetcher` policy can reach a JWKS host.
- Whether the MCP registry accepts a `cargo` registry type.
- Whether ES256 JWS verification on `ring` needs extra encoding work.
- The hand-written layer size (§1.7) is an estimate.

## Sources

- crates.io: `https://crates.io/api/v1/crates/rmcp`, `/rmcp/3.9.0`, `/rmcp/3.9.0/dependencies`, `/rmcp/3.9.0/download` (source read under `scratchpad/src-dl/rmcp-3.9.0/`).
- MCP registry schema: `https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json`.
- Repo files cited inline. `03-csharp-mcp-sdk.md` for the C# and Node comparisons.
