# MCP server in C#, Go and Rust: research summary and plan

Goal: a C# MCP server that behaves like `@bloklabs/mcp` (Node, `src/mcp`), and that a .NET team can add to their own ASP.NET Core app.

Detail files in this folder:

- `01-node-mcp-spec.md` is the full behaviour spec of the Node server, with file:line citations.
- `02-csharp-reuse-map.md` covers what `packages/server/dotnet` already has, with a gap table in §7.
- `03-csharp-mcp-sdk.md` covers the official C# MCP SDK. A throwaway server was built and called over stdio and HTTP.
- `04-parity-tests-and-release.md` covers how to prove parity, CI fit and the release path.
- `05-go-mcp.md` covers the Go SDK and the Go server's reuse map.
- `06-rust-mcp.md` covers the Rust SDK and the Rust server's reuse map.
- `07-remote-live-client.md` covers the remote live-room client for all three languages.
- `review-2026-11-07/` holds four independent verification reports of 01–04. Their corrections are folded in below.

Everything below comes from those files. Claims they mark "unverified" stay unverified here.

## 1. What we found

**The engine is already in C#.**

- The Node MCP shell is 4,078 lines across 35 files.
- The editing engine it calls is about 65k lines, shared with Ask AI.
- The C# server already runs that engine in Jint (`BlokAgentExecutor`, `BlokAgentSession`), for stored documents and for live rooms in the same process (`ExecuteInRoomAsync`).
- Undo/redo, co-authoring (`createdBy`/`createdWith`) and sub-page creation already exist in C#.

**The official C# SDK covers the protocol.**

- `ModelContextProtocol` and `ModelContextProtocol.AspNetCore` 2.3.1 were published 2026-11-03. They target net8–net10 and are licensed Apache-2.0.
- They support the same protocol versions as Node's `@modelcontextprotocol/server` 2.4.0, including 2026-07-28. The one difference is the old 2024-10-07: Node accepts it as is, while C# answers 200 and offers 2025-11-25 instead.
- These were measured on a test server, not just read in the docs:
  - Raw JSON tool schemas come back with the same meaning, but NOT byte for byte (corrected in review). C#'s default JSON writer escapes `'`, `<`, `>`, `&`, `+`, `"` and every non-ASCII character as `\uXXXX`, and turns `\/` into `/`. Node writes raw UTF-8. Blok's `blok_execute` description has an apostrophe, so this shows up for real. Whether the SDK's encoder can be changed is unverified.
  - Prompts and instructions work.
  - The 2026 "input required" approval flow works, and so does the fallback to `elicitation/create` on 2025-era stdio clients.
  - Stateless HTTP works.
  - A 401 points at protected-resource metadata.
- Not covered by the SDK, so we build it:
  - Blok's own JWT rules: `typ at+jwt` and the `sub`/`client:` rules.
  - Origin and Host checks. The SDK has neither. ASP.NET Core's `AllowedHosts` setting can block a foreign Host (400); Origin needs our own middleware.
  - The 4 MiB body cap.
  - Output-schema projection.
- Avoid `ElicitAsync`, because it throws on every stateless HTTP session.
- Throwing `InputRequiredException` for a 2025-era client on stateless HTTP comes back as JSON-RPC error `-32603`. Ask only when the client declares form elicitation, as Node does.
- The first `dnx` run of an unsigned package from a local feed prints a NuGet line to stdout before the JSON-RPC. That breaks stdio in local tests; cached runs are clean.

**These are missing in C#** (full table: `02` §7):

- **`blok_read`** is partial.
- **`blok_describe`** for one tool or command is missing.
- **Tool-call parsing and error answers** (`src/shared/agent/tool-call.ts`) are missing.
- **The MCP shell** is missing: tool schemas, instructions and prompts (Ask AI skills). None of it is in the Jint bundle.
- **Handles** are missing: open, close, idle expiry and the per-principal cap.
- **Sources** are missing: the files source, and the endpoint source's list route and 409 handling. The existing endpoint client is internal and room-only.
- **Joining a remote sync service over WebSocket** is missing. C# has only the server side.
- **Presence** is missing.
- **Ticket URL mode** is missing. Secret mode exists through `BlokTicket.Create`.
- **OAuth** is missing.
- **The webhook form of the authorize hook** is missing.
- **Approvals** are missing: unlock, restore and share, plus `database.buttonConfirm` and `database.buttonHooks` (`src/shared/agent/approval.ts:16-27`), which MCP always refuses. The C# runtime calls `session.execute(batch)` with no `approve`, so today they answer `APPROVAL_REQUIRED` (reason `no-channel`).
- **Uploads** are missing on the C# side. The JS runtime already accepts an `uploader` service (`src/view/server-runtime.ts:587`), but C# never sends one and has no upload port.
- **The stdio host** is missing.

**Hard constraints in the repo:**

- **The runtime bundle is shared by all three backends.** `scripts/build-server-runtime.mjs` writes it for C# and for Go (`packages/server/go/internal/jsruntime`). Rust embeds Go's copy (`packages/server/rust/crates/jsruntime/src/runtime.rs:8`). Adding operations means rebuilding and committing it, which touches Go and Rust no matter where the C# MCP lives.
- **Outbound calls are restricted.** An architecture test (`OutboundClientArchitectureTests.cs:31-41`) forbids `HttpClient` and `ClientWebSocket` outside one guard owner and two pinned owners. It scans every non-test project under `dotnet/`, so `Blok.Server.Mcp` will be scanned. Every outbound call the MCP makes needs a pinned owner: endpoint, ticket URL, webhook, JWKS, history and the WebSocket.
- **Most reusable C# pieces are `internal`.** This covers the room manager, room member, wire codec, ticket verifier and endpoint client.

## 2. Recommended shape

Two new projects under `packages/server/dotnet/`, both on the official SDK 2.3.1.

**`Blok.Server.Mcp` (library, NuGet).** This is the "add it to my C# project" piece. It follows the pattern `Blok.Server.AspNetCore` already uses:

```csharp
builder.Services.AddBlokServer(...);          // existing
builder.Services.AddBlokMcp(o => {            // new
    o.Source = BlokMcpSource.Endpoint(new Uri("https://host/docs"));
});
app.MapBlokMcp("/mcp").RequireAuthorization(); // new, wraps the SDK's MapMcp
```

- When the app also hosts Blok collab, live handles join rooms in process through `ExecuteInRoomAsync`. No WebSocket, no ticket. This is the cheapest live mode, and it is the natural one for a C# host.
- Authorization reuses `IBlokAuthorization`, with an adapter. That interface takes a `ClaimsPrincipal` and has separate read and write methods. Node's hook is `(principal string, documentId, write)`. The adapter builds a `ClaimsPrincipal` from the MCP principal (stdio has none) and picks the method from `write`. Node's `--authorize` also takes a module path, not only a webhook. The tool needs its own form of that.

**`Blok.Mcp` (dotnet tool, NuGet).**

- It is a thin host over `Blok.Server.Mcp`, adding only the CLI parser, stdio and the webhook authorize hook. The shell is built once, in the library.
- This is the copy of `blok-mcp`: the same flags, environment variables, stdio by default, and `--http`.
- It is packed with `PackAsTool` and `PackageType=McpServer`, with `.mcp/server.json`, so users run `dnx Blok.Mcp --source files:./docs`. The SDK agent installed and ran a test tool this way.

**Keep text and schemas single-source.** Do not retype the tool schemas, instructions, prompt text, describe output or tool-call errors in C#. Add them to the Jint runtime bundle as new operations, and have C# call them:

- `mcpTools`
- `mcpInstructions`
- `skills`
- `parseToolCall`
- `read`
- `describe`

This follows the repo's "hand-transcription drifts — generate instead" rule. It gives parity of meaning for free. Byte parity also depends on each language's JSON writer (C# escapes characters Node does not; Rust's `rmcp` re-sorts keys unless `preserve_order` is on). So the MCP conformance suite compares parsed JSON, never raw bytes.

The C# code then owns only what is truly host-side: transports, handles, sources, auth, tickets, errors and shutdown.

**Error flags.** `retryable` depends on which helper built the error, not only on its code (`01` fact 4). Port the helpers one to one. Do not use one table keyed by code.

## 2b. Go and Rust

The decision to apply the three-backend rule means each milestone below is done in C#, Go and Rust, and all three pass the same MCP conformance suite.

**Go** (`05-go-mcp.md`):

- Official SDK `github.com/modelcontextprotocol/go-sdk` v1.8.0, protocols 2024-11-05 to 2026-07-28.
- Measured: schemas, instructions and prompts match Node; the 2026 approval retry and the 2025 stdio `elicitation/create` fallback both work.
- Open differences: `supportedVersions` lists five versions where Node lists one, `"content": null` on the approval request, and a `-32020` refusal of a 2026 HTTP call without `Mcp-Param-Blok-Handle` that Node accepts. These need workarounds or a decision.
- Shape: a `blokmcp` package plus `cmd/blok-mcp` inside the existing v2 module. Being in the module gives it the internal packages, which is the Go form of decision 3.
- Already there: stored and in-room runs, undo, co-authoring, sub-pages, `ticket.Mint` (`blokserver/ticket/mint.go:43`).
- Go's outbound law (`internal/outbound/law_test.go`) scans the module and bans WebSocket clients outright.

**Rust** (`06-rust-mcp.md`):

- Official SDK `rmcp` 3.9.0 works, with `serde_json`'s `preserve_order` on for schema key order.
- It breaks the Rust workspace's written rules (`packages/server/rust/README.md:37-38`): own HTTP server, all JSON through `blok-jsjson`. It also adds about 45 crates and has no server-side OAuth.
- Recommended: a hand-written MCP layer, about 2–3k lines (estimate). See decision 5.
- Nothing important is hidden, so no access workaround is needed. A session borrows the executor, so a long-lived handle needs an owning version.
- Shipping: crates.io is blocked (the engine bundle lives outside the crate). Release archives plus an npm wrapper is the practical route.

## 2c. Exact-bytes traps found in review

These change saved data or hashes if a port gets them wrong:

- **Saved files.** The files source writes `JSON.stringify(doc,null,2)+"\n"` with `é`, U+2028, emoji, `<` and `>` as raw UTF-8, and the version is the SHA-256 of those bytes. C#'s default JSON writer escapes them, and Go's `encoding/json` escapes `<`, `>`, `&` and U+2028 by default (measured with `json.MarshalIndent`). Each port needs a writer that matches Node byte for byte, with a fixture test.
- **Two contract revisions.** Live handles report a different `contractRevision` than stored ones. `tools/list` is always built from the stored contract.
- **Ticket URL mode and non-ASCII ids.** Node decoded the ticket with `atob` (Latin-1), so any non-ASCII document id or principal was refused as FORBIDDEN. Fixed in Node on 2026-11-07; ports decode UTF-8.
- **Lenient parsing to match:** empty env vars count as set (except `BLOK_SECRET` and `BLOK_MCP_HOST_TOKEN`), number flags use JS `Number()` (`0x10`, `1e3`), base64 decoders skip bad characters, and `--authorize HTTP://…` is treated as a module path.
- **2026-07-28 wire:** JSON responses, not SSE, with `resultType:"complete"`. The SDK requires `Mcp-Method`, answers `ping` and `server/discover`, and does not enforce `Mcp-Param-Blok-Handle`; the argument wins. An unknown protocol version is answered with 2025-11-25.

## 2d. Review round 2 (2026-11-07): corrections the lanes must follow

Full reports: `review-2026-11-07/verify-05-06.md`, `review-2026-11-07/verify-07.md`.

**Go:**
- `supportedVersions`: a middleware sets `DiscoverResult.SupportedVersions = ["2026-07-28"]`.
- `"content": null` on input-required: Node sends no `content` key. Swap the result for a small custom one with only `resultType` and `inputRequests`.
- `-32020` without `Mcp-Param-Blok-Handle`: register tools without `x-mcp-header`, and add it back in `tools/list` on a COPY of each tool. This also stops Go refusing a header that disagrees with the argument.
- An `MCP-Protocol-Version: 2024-10-07` header gets 400 from Go and rmcp, 200 from Node. Over stdio Go answers 2025-11-25 where Node echoes 2024-10-07. No SDK option; wrap or rewrite.
- Go's 2025 `elicitation/create` has no `_meta.progressToken`; Node sends one.
- Go's outbound law bans `x/net/websocket` dials, raw dialing and `http.Client`. It does not ban third-party WS libraries. History and ticket HTTP calls need pinned entries.

**Rust:**
- `rmcp`'s HTTP server runs on the workspace's own `blok-http` through a ~30-line adapter, with no hyper. So README line 37 (own HTTP) stays true. Only line 38 (JSON through `blok-jsjson`) needs the approved exception.
- Override `ServerHandler::discover` for `supportedVersions`. Add `_meta` serverInfo on 2026 results. Set `allowed_hosts` with `host:port` and `allowed_origins`.
- A long-lived handle needs no `blokagent` API change: a task per handle owns `Arc<Executor>` and keeps the `Session` inside its future.

**Remote live (all three):**
- Keep the v1 path. Hosts without a journal or operation store pick v1, and Node then sends writes as Update frames and answers SyncStep1 with SyncStep2.
- Activity 106 has two separate 60 s budgets (provider at handshake, presence after a batch). On the first batch Activity goes before the operation frame.
- A write batch that adds no outbox rows reports `{durable: true, serverSequence: null}`.
- On v2 the server echoes the agent's own operation as an Update before the ack. It must not bump the `l<n>` revision.
- A full awareness flush carries every known state, peers included.
- **Single lane per batch.** Hold incoming doc frames from export until apply and outbox append are done. Write only the keys the agent patched, as Node does. Otherwise a peer's concurrent edit is reverted.
- **Undo must match Node's.** Node's undo is Yjs `UndoManager`, scoped to the agent's own changes. Pin Node's behaviour with live conformance cases (peer edits in the same block, CONFLICT cases) and match it.
- C#: the outbound architecture test needs a new owner kind covering `ClientWebSocket`, `HttpMessageInvoker` and `SocketsHttpHandler`. Measured: `ClientWebSocket` with Origin, a ticket subprotocol, `ConnectAsync(uri, invoker, ct)` and auto-pong all work against the Go host.
- Go: `translate` is unexported; Rust: `translate` is `pub(crate)`. Both need visibility changes. Rust `OperatorClient::connect` is private.

**Node facts the harness measured that correct earlier notes:**
- 2026 `ping` answers -32601 "Method not found". 2026 `initialize` on stdio answers 2025-11-25.
- A refused room upgrade is retried until the 15 s room-sync timeout.
- A `BLOK_SECRET` under 32 characters fails `blok_open` with -32603.
- HTTP with a 2025 client loses the client name: the agent id is `agent:local:mcp-client`.

## 3. Milestones

Each milestone ships green, with tests written first.

1. **Parity harness first.** Add `scripts/test-mcp-conformance.mjs --target node|csharp|go|rust` (design in `04` §1).
   - It spawns the binary and talks MCP over stdio and HTTP with the client library already in devDependencies.
   - `test/evals/agent/runner/surfaces/mcp.ts:115` and `live-room.ts:38-127` already spawn blok-mcp. Model the spawn helper on them.
   - It reuses the agent parity corpus and `checkMcpCase`. That function hard-codes its opener (`mcp-harness.ts:228`), so it needs an opener parameter for a spawned process.
   - It needs a fix for the agent id. Goldens say `agent-test` in both `createdWith` (90 times) and `lastEditedWith` (123 times), but a spawned binary says `agent:<principal>:<client>`. Fix it with a conformance-only flag, or remap both fields.
   - Node passes first, and that becomes the oracle.
2. **Bundle operations.** Add `read`, `describe`, `parseToolCall`, tool schemas, instructions and skills to `server-runtime.ts`. Also add an `agentExecute` input carrying approval replies, from which the runtime builds the `approve` callback (today `server-runtime.ts:640` calls `session.execute(batch)` with none). Then rebuild the bundle. C#, Go and Rust all load it, so run all three conformance targets.
3. **Stored mode, library first.** Build `Blok.Server.Mcp` with the following, then the `Blok.Mcp` tool as a stdio host over it:
   - the files and endpoint sources;
   - all six tools, the prompts and the instructions;
   - handles, the CLI parser and `checkOptionSafety`, in the same validation order (`01` §3);
   - the files source with exact bytes: `JSON.stringify(doc,null,2)+"\n"`, a SHA-256 version, lowercase lock keys and UTF-16 sort order.
4. **HTTP and auth:**
   - Stateless `/mcp`, with GET and DELETE answering 405.
   - Origin and Host checks, and the 4 MiB cap.
   - OAuth on `JwtBearer` plus Blok's rules, and protected-resource metadata at the root path.
   - The authorize hook: `IBlokAuthorization` for the library, and the webhook for the tool.
   - Tickets in secret and URL mode.
5. **In-process live rooms.** When the app hosts Blok collab, live handles go through `ExecuteInRoomAsync`, with presence and version history in process.
   - A spawned `Blok.Mcp` cannot run the `mcp-live` corpus yet; that needs milestone 7.
   - So the harness also needs a test host that serves collab and the MCP library together. It proves milestone 5 on its own.
6. **Approvals and uploads.** Node's approver (`elicitationApprover`, `src/mcp/sdk-server.ts:87-111`) is called mid-batch, but it answers at once from the client's replies already in the request. Jint therefore never has to wait on the host:
   - C# passes the request's replies into the Jint run as data, and a JS approver answers from them.
   - On the first run there is no reply, so the approver records the question and says no. The batch applies nothing.
   - C# then throws the SDK's `InputRequiredException`, and the client retries with the reply. Agent 3 measured this retry flow on SDK 2.3.1.
   - Port these rules too: button kinds are always refused; a retry that brings replies but meets a second question fails with `APPROVAL_REQUIRED` (`one-per-call`); the server asks only if the client declares form elicitation (`canElicit`, `sdk-server.ts:114`).
   - This logic lives in the MCP shell, not the engine. Move it into the bundle so all three languages share it.
   - Uploads need an uploader service handed to Jint.
7. **Remote live mode** (design: `07-remote-live-client.md`). The tool joins a remote sync service over WebSocket, with the ticket as the last offered subprotocol and an Origin header.
   - Node runs the whole sync client in JS. That client cannot run in the shared bundle: the bundle has no Yjs, the runtimes have no timers or crypto, and engines live for one call.
   - So each language gets a native client: a WebSocket client role, the connection state machine, the pending-writes queue and an awareness encoder. The JS bundle still plans each batch.
   - Reused from each server: native Yjs, the wire codec, the converter, the edit translator and single-transaction apply.
   - Bundle changes: accept Node's live runtime tag, take a host-supplied document revision, and carry version history and undo per handle.
   - Outbound laws: C# bans `ClientWebSocket` even for pinned owners, so its architecture test needs a new owner kind. Go needs a pinned entry. Rust needs an owner entry.
   - Oracle: the existing live-mode suite already runs Node against the C#, Go and Rust hosts. Give it a switch to run a spawned port binary, and add a scripted room for failure cases. Compare frame types and order, never Yjs payload bytes.
8. **Release.**
   - Pack and push both packages in `release-server.yml`.
   - Update `verify-docs-release.mjs`, `test-server-packages.mjs` and the release wiring tests.
   - Add docs pages in both locales.
   - Also note that `release-server.yml` runs `publish-server-go.mjs` (line 159). The Go MCP ships through it.
   - CI: the Server job ran 466–516 s in three recent main runs, over the 7-minute budget. Server Delivery had 15–84 s spare. Validate Spec Coverage ran 138–153 s. Put MCP conformance next to Validate Spec Coverage, or in a new job (20-job cap), and update `ci-critical-path-law.test.ts`.

## 4. User decisions (2026-11-06)

- **Three-backend rule: YES.** The MCP is written in C#, Go and Rust, all proven by one shared MCP conformance suite. Research for Go and Rust: `05-go-mcp.md`, `06-rust-mcp.md`.
- **Remote live mode in v1: YES.** Design: `07-remote-live-client.md`.
- **Internals: give access to the MCP package only** (`InternalsVisibleTo("Blok.Server.Mcp")`), no new public API.
- **Names: approved.** `Blok.Server.Mcp` (library) and `Blok.Mcp` (tool).

The questions as they were asked:

1. **Does the three-backend rule apply?** CLAUDE.md requires Go, C# and Rust for backend features in `packages/server`. The MCP today lives in `src/mcp` and is a client of the servers (`04` §7). Putting the C# MCP under `packages/server/dotnet` may pull Go and Rust MCPs into scope. Milestone 2 changes the shared bundle either way, so Go and Rust conformance must pass regardless.
2. **Remote live mode in v1?** In-process live (milestone 5) is cheap. Remote live (milestone 7) needs a new sync client in C#. Shipping v1 without it means the dotnet tool can only do stored documents, plus live rooms when it runs inside a Blok C# host.
3. **Internal or public API?** Reuse room, ticket and endpoint internals through `InternalsVisibleTo("Blok.Server.Mcp")`, or make them public, which is new published surface.
4. **Package names.** The plan assumes `Blok.Server.Mcp` (library) and `Blok.Mcp` (tool).

## 4b. User decisions (2026-11-07)

- **Rust: use the official `rmcp` SDK.** This is an approved exception to `packages/server/rust/README.md:37-38` (own HTTP server, all JSON through `blok-jsjson`). Amend the README in the same change that adds the crate. Turn on `serde_json`'s `preserve_order`. Server-side OAuth is still ours to write, since `rmcp`'s `auth` feature is client-only.
- **Non-ASCII ids: fix Node first.** Done: `readTicketClaims` now decodes the payload as UTF-8. All ports decode UTF-8 too.

The questions as they were asked:

5. **Rust: official `rmcp` or a hand-written MCP layer?** `rmcp` works but breaks the Rust workspace's own-HTTP and own-JSON rules and adds about 45 crates. Hand-written is about 2–3k lines (estimate).
6. **Non-ASCII ids in ticket URL mode.** Node refuses them because of an `atob` bug. Fix Node first so all ports decode UTF-8, or copy the bug?

## 5. Still unverified

- Whether a batch refused for approval leaves the document unchanged, so the retry is safe. Node's comment says it "applies nothing" (`sdk-server.ts:84`); no test was run for it.
- Whether `blok_read` through `doc.read` matches Node's `session.read` exactly.
- Whether the Jint runtime works under ahead-of-time compilation, if a self-contained tool is wanted.
- Whether a stray stdout write corrupts C# stdio framing.
- Whether `JwtBearer` defaults match each Blok token rule.
- Whether C#'s SDK JSON encoder can be set to write raw UTF-8 like Node.
- Go: whether `net/http` hands back the upgraded connection on a 101; .NET: `ClientWebSocket` auto-pong.
- Whether JSON-diff undo matches Yjs undo when a peer edits the same block at the same time.

Resolved in review: an `unavailableCommands` reason of `host` is unreachable (32 option combinations measured), so the schema mismatch is latent only.
