# 05 — A Go MCP server: the Go SDK, what the Go server already has, and how it would ship

Research only. No repo code changed. Date: 2026-11-06/07.

How to read this:

- **[run]** I ran it in this session.
- **[src]** I read it in source. Paths under `go/` mean `packages/server/go/`. Paths under `sdk/` mean the Go SDK v1.8.0 source in the module cache (`~/go/pkg/mod/github.com/modelcontextprotocol/go-sdk@v1.8.0/`).
- **Unverified** means exactly that.

The probe lives in the session scratchpad under `go-mcp/`:

- `probe/main.go` is a throwaway Go server on SDK v1.8.0.
- `drive.mjs` is a raw stdio driver that records every line the server writes.
- `sdkclient2.mjs` drives the probe with the repo's official Node client (`@modelcontextprotocol/client` 2.4.0).
- `http.sh` holds the curl checks.
- `node-host.mjs` and `node-http-host.mjs` are the Node `blok-mcp`, bundled from `src/mcp` with esbuild. They are the oracle. `packages/mcp/dist` dates from Oct 19 (stale), so I did not use it.

The probe serves Node's real tools, prompts and instructions. It reads them from a capture of Node's own stdio answers (`node-2026-07-28.json`).

---

## 1. The official Go MCP SDK

### 1.1 Version

| Item | Value | Evidence |
|---|---|---|
| Module | `github.com/modelcontextprotocol/go-sdk`. There is no `/v2` or `/v3` (the proxy answers "no matching versions") | [run] `proxy.golang.org/.../@v/list`, `.../go-sdk/v2/@latest` |
| Latest stable | **v1.8.0** | [run] `@latest` → `{"Version":"v1.8.0","Time":"2026-09-04T08:08:52Z"}` |
| Dates | The proxy `Time` (2026-09-04) is the tag's commit time. The GitHub release was published 2026-09-14T08:05Z. Its notes say it "is equivalent to v1.8.0-pre.2" | [run] `gh api repos/modelcontextprotocol/go-sdk/releases` |
| Previous | v1.7.0 on 2026-07-28 (the 2026-07-28 spec release), v1.6.1 on 2026-05-22 | [run] same |
| Go needed | `go 1.25.0` (SDK `go.mod`). Blok's module needs `go 1.27.1` (`go/go.mod:3`), so Blok is the stricter floor | [src] |
| SDK deps | `golang-jwt/jwt/v5`, `google/jsonschema-go`, `segmentio/encoding`, `yosida95/uritemplate/v3`, `x/oauth2`, `x/time`, `x/tools` | [src] `sdk/go.mod` |
| License | The same MIT → Apache-2.0 transition note as the C# repo | [src] `sdk/LICENSE` |

**Upgrade risk.** The v1.8.0 notes add `MCPGODEBUG` escape hatches (`plaintextstatefulrejection`, `blockingcancelnotify`) that "will be removed in **v1.9.0**". `allowsessionsinstateless` (`sdk/mcp/streamable.go:143,280`) is another such flag. Blok should not depend on any of them.

### 1.2 Protocol versions

- Supported: `2026-07-28`, `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` ([src] `sdk/mcp/shared.go:50-64`).
- This is the same window as C# 2.3.1. Node 2.4.0 also accepts `2024-10-07`. Go does not.
- The v1.8.0 notes say: "It adds no new protocol revision … `2026-07-28` remains the newest version the SDK negotiates."
- `ServerOptions.SupportedProtocolVersions` can only narrow the list (`sdk/mcp/server.go:186-190`).

### 1.3 Tools with raw JSON schema

- `Server.AddTool(*Tool, ToolHandler)` is the low-level form. Validating arguments and shaping results are left to the caller (`sdk/mcp/server.go:290-357`).
- `Tool.InputSchema` and `Tool.OutputSchema` are `any`. The docs say they may be "any value that JSON-marshals to valid JSON schema (including json.RawMessage)" (`sdk/mcp/protocol.go:1908-1939`).
- `AddTool` panics when the input schema's `type` is not `"object"`. That is the same rule as Node.
- `AddTool` also checks every `x-mcp-header` annotation (`sdk/mcp/streamable_headers.go:283-322`). Blok's only one is `handle: {type: string, x-mcp-header: "Blok-Handle"}` (`src/agent/render-tools.ts:212`, `src/mcp/tools.ts:139`). It passes; the probe registered all six tools.

**[run] Byte check.** I served Node's six tools with `json.RawMessage` schemas, then compared on `2025-11-25` and `2026-07-28`:

- Every `inputSchema` and every `outputSchema` came back byte for byte. The compare is a substring match of Node's serialized schema in the raw Go line.
- The whole tool object is **not** byte-equal. Go writes struct fields in its own order (`description, inputSchema, name, outputSchema`), where Node writes `name, description, inputSchema, outputSchema`.

**Tool order.** The SDK lists tools sorted by name (`sdk/mcp/features.go:75-104`). Node lists them in registration order, starting with `blok_list_documents, blok_open, …`.

- [run] A receiving middleware (`Server.AddReceivingMiddleware`, `sdk/mcp/server.go:1860`) that re-sorts `*ListToolsResult.Tools` restored Node's order.
- With that fix, the probe's own extra tool sat in the middle, which shows the re-sort works.

### 1.4 Prompts and instructions

- `Server.AddPrompt(*Prompt, PromptHandler)` (`sdk/mcp/server.go:278`). `ServerOptions.Instructions` (`sdk/mcp/server.go:75`).
- [run] The instructions came back equal to Node's (2,328 chars) in `initialize` (2025-era) and in `server/discover` (2026-07-28).
- [run] All 9 prompts listed. `prompts/get` messages are equal to Node's once key order is ignored. Go writes `content, role`, where Node writes `role, content`.
- **Difference:** `PromptArgument.Required` is `bool` with `omitempty` (`sdk/mcp/protocol.go:1518-1529`). So Go drops the 19 `"required": false` that Node sends.
  - [run] Fixed in the probe. A middleware swaps the `prompts/list` answer for a custom struct that embeds `mcp.ResultBase` (`sdk/mcp/shared.go:818-830`) and carries Node's raw prompts JSON. After that, no diffs remained.

### 1.5 Envelope differences, measured against Node

From a key-order-insensitive diff ([run] `sem.mjs`).

**Fixed in the probe:**

| Field | Node | Go default | Fix ([run]) |
|---|---|---|---|
| `capabilities` | `{tools:{}, prompts:{}}` | adds `logging:{}` and `listChanged:true` on both | `ServerOptions.Capabilities = &ServerCapabilities{Tools:&ToolCapabilities{}, Prompts:&PromptCapabilities{}}` (`sdk/mcp/server.go:657-695`) |
| `cacheScope` on discover and lists (2026) | `"private"` | `"public"` | `ServerOptions.SetCacheable` (`sdk/mcp/server.go:177-183`), new in v1.8.0 |
| prompt `required:false` | sent | dropped | `ResultBase` custom result (§1.4) |
| tool order | registration order | by name | middleware re-sort (§1.3) |

**Not fixed, or not tested:**

| Field | Node | Go | Note |
|---|---|---|---|
| `server/discover.supportedVersions` | `["2026-07-28"]` | all five | Narrowing it would also drop `initialize` for 2025-era clients. Untested. Needs a normalize rule. |
| `ttlMs` and `cacheScope` in `tools/list` for **2025-era** clients | absent | `ttlMs:0, cacheScope` | The same `ResultBase` trick should remove them. Not tested for tools. |
| `"content": null` on an `input_required` result | not measured | sent | [run] The official Node client accepted it and retried. Node's own wire shape for this case was not captured, so it is unverified. |

### 1.6 Approval: "input required" and the 2025 fallback

In Go, the handler **returns** `&mcp.CallToolResult{InputRequests: mcp.InputRequestMap{"approve": &mcp.ElicitParams{...}}}`. In C# the handler throws instead. On the retry, it reads `req.Params.InputResponses["approve"].(*mcp.ElicitResult)` (`sdk/mcp/protocol.go:52-192,229-235,307-318`).

[run] Results:

| Client | Transport | What the Go SDK did |
|---|---|---|
| 2026-07-28 (raw driver) | stdio | Returned `{"resultType":"input_required","inputRequests":{"approve":{"method":"elicitation/create",...}}}` with no `requestState`. The retry with `inputResponses` got `resultType:"complete"`. A `decline` reached the handler too. |
| 2025-11-25 and 2025-06-18 (raw driver) | stdio | Sent a real `elicitation/create` to the client, then ran the handler again with the answer (`sdk/mcp/mrtr.go:119-163`, `serverMultiRoundTripMiddleware`). |
| Official Node client pinned to 2026-07-28 | stdio and stateless HTTP | Approved. The client's elicitation handler ran once and the client retried by itself. |
| Official Node client, `legacy` mode | stdio | Approved through `elicitation/create`. |
| Official Node client, `legacy` mode | stateless HTTP | `ClientCapabilities()` is nil, because each request gets a fresh session with made-up init params (`sdk/mcp/streamable.go:471-525`). The probe's `canElicit` gate answered "cannot-elicit". This matches Node and C#. |

- `ServerSession.Elicit` is refused while serving a 2026-07-28 request (`sdk/mcp/server.go:1611-1626`).
- On stateless HTTP every server-to-client request "is rejected immediately" (`sdk/mcp/streamable.go:129-138`).
- So, as in C#, use only the returned `InputRequests` path. Never call `Elicit` directly.

**Client identity per request.** `req.ClientInfo()` and `req.ClientCapabilities()` read `_meta` on 2026-07-28 and fall back to `initialize` on 2025-era (`sdk/mcp/shared.go:688-730`).

- [run] They gave `client=modern` on 2026 HTTP and `client=probe` on 2025 stdio.
- [run] They gave `<nil>` on 2025-era stateless HTTP. This is the same gap as C#, so the port must fall back to a default name.

### 1.7 stdio

- `mcp.StdioTransport{}` writes to `os.Stdout`, with `MaxLineLength` defaulting to 16 MiB (`sdk/mcp/transport.go:122-138`).
- [run] The process exited 0 when stdin closed.
- [run] A stray `fmt.Println` in a handler reached stdout as a non-JSON line. The raw driver logged it. The official Node client did not fail, but a stricter client might (unverified).
- [run] Guard that works: keep the real stdout, set `os.Stdout = os.Stderr`, and run on `mcp.IOTransport{Reader: os.Stdin, Writer: savedStdout}`. The stray line then went to stderr. This is the Go counterpart of Node's `installStdoutGuard`.

### 1.8 Stateless streamable HTTP

Setup: `mcp.NewStreamableHTTPHandler(getServer, &mcp.StreamableHTTPOptions{Stateless: true})` (`sdk/mcp/streamable.go:128-224`).

| Check ([run], same requests to both) | Node `blok-mcp` | Go SDK, default options |
|---|---|---|
| GET `/mcp` | 405 | 405, `Allow: POST` |
| DELETE `/mcp` | 405 | 405 |
| Foreign `Origin` | **403** | **200**. No Origin check by default. `CrossOriginProtection` is deprecated (`streamable.go:184-195`). |
| `Host: evil.example` on a loopback bind | 403 | 403. Localhost protection is on by default (`streamable.go:174-182,316-326`). |
| `Host: localhost:1` (wrong port) | **403** (Node checks the port, `src/mcp/http.ts:135-140`) | **200**. The SDK checks only that the host is loopback. |
| 5 MiB body | 413 | 413. `DefaultMaxRequestBodyBytes = 4 << 20` (`streamable.go:224`) |
| 3.9 MB body | 200 | 200 |
| Other path | 404 | 404 (the host's mux) |
| 2026 `tools/call blok_read` **without** `Mcp-Param-Blok-Handle` | **200** (the tool answered) | **`-32020` "header mismatch: missing Mcp-Param-Blok-Handle header"** (`streamable_headers.go:402-442`). There is no opt-out flag. |
| 2026 `tools/call` with the header | 200 | 200 |

What the port must do:

- Keep Blok's own Origin allow-list and its port-exact Host check, as C# does.
- Under `--public`, Node skips the Host check (`src/mcp/http.ts:24,147`). The SDK's own check would still answer 403 for a public Host on a loopback bind, so set `DisableLocalhostProtection: true` and rely on Blok's check alone.
- The `Mcp-Param` difference only shows with a raw request that leaves out the header. The official Node client sent it, because its HTTP calls passed. Still, a conformance case that sends raw 2026 requests must send that header, or it will split Node and Go.

### 1.9 OAuth

- `auth.RequireBearerToken(verifier, &RequireBearerTokenOptions{ResourceMetadataURL, Scopes})` (`sdk/auth/auth.go:41-97`). [run] It answered 401 with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource", scope="blok.read"`.
- `auth.ProtectedResourceMetadataHandler(&oauthex.ProtectedResourceMetadata{...})` (`sdk/auth/auth.go:188`). The host mounts it on any path, so the root path Node uses is easy. [run] It served `{"resource","authorization_servers","scopes_supported":["blok.read","blok.write"],"bearer_methods_supported":["header"]}`.
- The token check is the caller's `TokenVerifier`. Blok's rules have to be written in Go:
  - RS256/ES256 only;
  - `typ at+jwt`;
  - reject any `crit` header;
  - the JWKS cache;
  - `scope`/`scp`;
  - `client:` subjects.
- The JWKS fetch must be Blok's own code, not `oauthex`, because of the outbound law (§2.6).

---

## 2. What the Go server already has

### 2.0 Public vs internal

In Go, "internal" is a directory rule. Any package inside module `github.com/JackUait/blok/packages/server/go/v2` may import `go/internal/...`, and nothing outside it may. `blokserver/collab.go:94` already imports `internal/collab/docendpoint`.

So a **`blokmcp` package inside the v2 module** gets the internals for free. This is Go's form of the `InternalsVisibleTo("Blok.Server.Mcp")` decision, and it adds no public surface. A separate Go module could not reach them.

| Item | Visibility | Where |
|---|---|---|
| `blokagent.Executor` (`Execute`, `OpenSession`, `ExecuteInRoom`, `Contract`, `RoomContract`), `Session`, `Actor`, `Options`, `PageTarget`, `PageCreator`, `StoredPage`, `RoomPage` | public | `go/blokagent/executor.go:19,42,80`, `session.go:23,31`, `room.go:68` |
| `blokagent.New(FactoryOptions)`: a standalone executor, stored only unless `Rooms` is set | public | `executor.go:28-56` |
| `blokagent.NewRooms(*room.Manager)` | public func, but it takes an **internal** type, so only code in the module can call it | `room.go:22-26` |
| `blokserver.Server.AgentExecutor()`: the executor bound to the server's own rooms | public | `go/blokserver/collab.go:288-302` |
| `blokserver.Authorization` / `User` / `WithUser` / `UserFrom` (aliases of `internal/auth`) | public | `go/blokserver/user.go:10,14` |
| `blokserver/ticket.Mint`, `Claims` | public | `go/blokserver/ticket/mint.go:29,43` |
| `blokdocs.Converter` | public | `go/blokdocs/converter.go` |
| `internal/ticket.Verify` | internal | `go/internal/ticket/verify.go:30` |
| `internal/collab/docendpoint.Client` | internal | `go/internal/collab/docendpoint/client.go:78` |
| `internal/collab/room.Manager` (`Join`, `AgentEdit`, `History`) | internal | `go/internal/collab/room/manager.go:122,193`, `history.go:78` |
| `internal/collab.Member` | internal | `go/internal/collab/collab.go:39` |
| `internal/jsruntime` (goja pool) | internal | `go/internal/jsruntime/pool.go`, `runtime.go` |
| `internal/ws` (WebSocket) | internal, **server side only** | `go/internal/ws/ws.go:1` |

### 2.1 Agent engine

- It is the same bundle. `internal/jsruntime` embeds the committed copy that `scripts/build-server-runtime.mjs` writes (`runtime.go:17-21`).
- The Go host mirrors C#'s wire byte for byte. The package doc pins it with `test/unit/server-conformance/fixtures/agent/host.json` (`blokagent/types.go:1-8`).
- `Executor` is safe for concurrent use. **`Session` is not**: "finish each call before the next" (`session.go:16-23`). An MCP handle needs a mutex, as Node's `HandleRegistry.use` serializes calls.
- Session caps are 100 steps and 4 MiB in UTF-16 units (`session.go:9-14`).
- What the bundle receives (`blokagent/wire.go:177-209`): `services` holds only `pageBackend`, plus `prepares`, `customTools`, `overrides` and `comments`.
  - **No `uploader`**, so uploads are missing. This matches C#.
  - **No `approve`**, so approval is missing.
- The read, describe, tool-call parsing, tool schemas, instructions and skills ops are all **missing from the bundle**, exactly as `02` §1 says. The same bundle file serves both servers.
- **Parity is proven.** [run] `go test ./blokagent -run TestMatchesTheAgentCommandCorpus` passed (27.8 s). It covers both `TestMatchesTheAgentCommandCorpus` and `…InARoom`: 52 runnable cases each from `test/fixtures/agent-commands` (`blokagent/parity_test.go:140,195`).

### 2.2 Live rooms in the same process

- **This works today.** `Server.AgentExecutor()` hands back an executor wired to the server's room manager when collaboration is on (`blokserver/collab.go:288-302`).
- `ExecuteInRoom` plans inside the room lane. Its revision is the journal head `lineage:sequence` (`blokagent/room.go:62-68`). The corpus passes in a room (§2.1).
- **Stale doc.** `blokagent/types.go:10-12` still says "Live rooms need collaboration, which this package does not carry yet: ExecuteInRoom answers COMMAND_UNAVAILABLE". `room.go` and `collab.go:297` show it does. Flagged, not fixed.
- **Contract label.** Go rooms send `runtime: "csharp-live"` to the bundle (`room.go:55`). Stored calls report `jint`, because `contractWhere` knows only those two (`src/view/server-runtime.ts:497-498`). If MCP conformance compares contract text with Node (`node`, `node-live`), it needs a normalize rule. The same rule covers C#.
- **Undo, room:** `roomHistory` keeps steps per doc + actor + onBehalfOf. It drops them after `roomIdleLimit = time.Hour` (`roomhistory.go:17-27`) and forgets a doc that the room replaced (`room.go:41-46`).
- **Version history:** room only, with a journal (`RoomContract`, `room.go:49-57`; `versions.go:16,74`).
- **Approval on undo** answers `APPROVAL_REQUIRED` (`blokagent/roomreplay.go:139,148`).
- **Presence: missing.** `grep -i 'awareness|presence'` finds nothing in `blokagent/`. A room member is the internal `collab.Member` (`internal/collab/collab.go:39-49`), joined by the internal `room.Manager.Join` (`manager.go:122`). A `blokmcp` package inside the module could implement one.

### 2.3 Co-authoring and sub-pages

- **Co-authoring: exists.** `actorNode` sends `{id, name, kind:"agent", onBehalfOf}` (`wire.go:211-218`). The corpus goldens carry `createdWith: "agent-test"` (e.g. `test/fixtures/agent-commands/goldens/01-insert-columns-default.json:68`), and the Go corpus run matches them (§2.1). `translate_test.go:109-116` shows the room translation keeps `createdBy`/`createdWith`.
- **Sub-pages: exist.** Set `Options.PageTitles` with a `PageCreator`. Go creates the pages first, because goja cannot await the host (`blokagent/pagecreate.go:13`). Room cases are in `room_test.go:385,419,470`. Rename and icon go through `PageTarget` → `StoredPage{Load,Save}` or `RoomPage` (`go doc ./blokagent`).

### 2.4 Tickets

- **Signer: public.** `ticket.Mint(secret, Claims{User, Doc, Write, TTLSeconds}, now)`. Its doc says "A pass minted here verifies on the C# server and the other way round, and the same claims mint the same bytes" (`blokserver/ticket/mint.go:1-4,29-43`). It can mint Node's secret-mode claims.
- **Verifier: internal** (`internal/ticket/verify.go:30`).
- **Ticket URL mode: missing.** It also needs an outbound owner.

### 2.5 Documents and the endpoint client

- **No document source abstraction.** There is no `load/save/list` interface.
- `docendpoint.Client` is **internal**. It is built only in `blokserver/collab.go:94`, for the rooms.
  - It has `Load` (GET, `client.go:110`) and `Save` (PUT with `Blok-Doc-Version`/`Lineage`/`Sequence`, `client.go:25-27,128`).
  - `Error` carries `StatusCode` (`client.go:63-67`).
  - **There is no list route and no 409 → `DOCUMENT_CHANGED` mapping.** A grep for `409|StatusConflict` finds nothing.
- **Files source: missing.** `workingset.NewLocalStore` is the room working set (`collab.go:88-91`), not document JSON.

### 2.6 The Go outbound law: yes, there is one

`go/internal/outbound/law_test.go` is "the Go analogue of OutboundClientArchitectureTests" (`:16-20`).

- **Banned** (`:22-36`): `net/http.Client`, `Transport`, `DefaultClient`, `Get` and `Post`; `net.Dial*` and `Dialer`; `tls.Dial` and `tls.Client`; `x/net/websocket` `Dial`, `DialConfig`, `NewConfig` and `NewClient`; and the dotnet sockets transport.
- **Pinned owners** (`:45-50`): the guarded fetcher (`internal/outbound/fetcher.go`), `internal/blob/s3.go` and `internal/collab/docendpoint/client.go`. Each may make one `http.Client` and one sockets transport.
- **Scope** (`:142-167`): every non-test `.go` file under the module root. So a `blokmcp` package or a `cmd/blok-mcp` inside the module is scanned.
- The SDK's own HTTP code lives in another module and is not scanned. Blok's own calls are.
- The guarded fetcher is GET only and forbids private addresses (`fetcher.go:160`; `policy.go` ports C#'s policy). So it does not fit an operator endpoint.

Every outbound call the Node MCP makes needs a new pinned owner or a law change, as in C#:

- endpoint GET, PUT and list;
- ticket URL POST;
- authorize webhook;
- JWKS;
- remote version history;
- the sync WebSocket client.

There is no client WebSocket at all. `internal/ws` is the server side of RFC 6455 (`ws.go:1`), and `x/net/websocket` dialing is banned outright.

### 2.7 How a Go app embeds Blok today

Documented only in `packages/server/README.md:755-764` ("Go module and archives"):

- import `blokserver` for the routes and `blokdocs` for the converter;
- `Options.CollabOperationStore` and `Options.CollabActivityObserver`, with types in `blokserver/collabstore`;
- `Server.HandlerWithAuth(prefix, auth)` for the app's own auth.

The docs site has no Go section. `grep blokserver docs/src` finds nothing. Nothing documents `blokagent`.

The shape, from `go doc ./blokserver` and the consumer fixture `test/fixtures/go-server-consumer/main.go`:

```go
options := blokserver.DefaultOptions()
options.CollabEnabled = true                  // rooms for in-process live MCP
options.Authorization = pageRules{}           // narrows access, like IBlokAuthorization
server, err := blokserver.New(options)
mux.Handle("/api/blok/", requireUser(server.Handler("/api/blok")))
executor, err := server.AgentExecutor()       // stored + in-room agent
```

- `scripts/test-server-go-module.mjs` copies the tracked module files and builds that fixture against them. That proves a consumer build works (`:1-11`).
- A matching MCP surface could be `blokmcp.New(blokmcp.Options{Server: server, Source: …})` returning an `http.Handler` for `/mcp`, plus `ServeStdio(ctx)`. **That is a suggestion, not something that exists.** The authorize hook would reuse `blokserver.Authorization` (`CanReadDocument`/`CanWriteDocument(ctx, User, docID)`), the counterpart of `IBlokAuthorization`.

### 2.8 Dependency cost of putting MCP in the same module

[run] A two-package test module, with `core` using no deps and `mcpx` importing the SDK. The consumer imported only `core`, through a local `replace`. Result: `go list -deps` showed **0** SDK packages, and the consumer built.

So hosts that do not import `blokmcp` do not compile the SDK.

**Unverified:**

- whether the consumer's `go.sum` stays free of SDK lines with a real proxy version (the local `replace` hid it);
- whether MVS raises a consumer's shared deps, such as `x/sys`, `x/sync` and `x/net`, because Blok's `go.mod` would list the SDK.

Today Blok's module has four direct deps (`go/go.mod:7-12`).

### 2.9 Gap table (matches `02` §7)

"Outbound" means the feature needs a new pinned owner under §2.6.

| Node MCP capability | Go today | Where / note | Outbound |
|---|---|---|---|
| `blok_execute` stored | exists | `Executor.Execute`, `Session` | — |
| `blok_execute` live, same process | exists | `ExecuteInRoom` via `Server.AgentExecutor()` | — |
| `blok_read` | partial | `doc.read` batch; parity with `session.read` unverified (same as C#) | — |
| `blok_describe` `{tool,command}` | missing | no bundle op | — |
| Tool-call parsing, arg refusal, error answers | missing | not in bundle | — |
| MCP tool schemas | missing | not in bundle | — |
| Handles (open/close, idle, per-principal cap) | missing | `Session` needs a per-handle mutex | — |
| `blok_list_documents` | missing | no list in `docendpoint` | yes |
| Server instructions | missing | not in bundle | — |
| Prompts (skills) | missing | not in bundle | — |
| Stored endpoint source | partial | `docendpoint.Client` (internal, room-only, no 409, no list) | yes (pinned owner exists) |
| Files source | missing | working set is not document JSON | — |
| Live room, same process | exists | `room.go:68`, `collab.go:288` | — |
| Live room, remote sync over WS | missing | no WS client; dialing banned | yes |
| Presence | missing | `collab.Member` internal; no agent member | — |
| Version history | partial | room + journal, in process | yes for remote |
| Undo/redo | exists | `Session` (stored), `roomHistory` (room) | — |
| Co-authoring | exists | `wire.go:211`; corpus goldens | — |
| Sub-page create / rename | exists | `PageCreator`, `PageTarget` | — |
| Uploads | missing | no `uploader` service (`wire.go:177-209`) | — |
| Approval (unlock) | missing | no `approve`; room undo answers `APPROVAL_REQUIRED` | — |
| Tickets, secret mode | exists | `ticket.Mint` (public) | — |
| Tickets, URL mode | missing | — | yes |
| OAuth | missing | SDK has middleware + metadata; verifier is ours | yes (JWKS) |
| Authorize hook | partial | `blokserver.Authorization` fits; webhook form missing | yes for webhook |
| Custom tools / overrides / comments off | exists | `Options.CustomToolsJSON`, `OverridesJSON`, `DisableBuiltInComments` | — |
| stdio transport | missing | SDK has it (§1.7) | — |
| HTTP transport | missing | SDK has it (§1.8); Blok adds Origin, port-exact Host | — |

---

## 3. Distribution

### 3.1 How the Go server ships today

- **Module:** `github.com/JackUait/blok/packages/server/go/v2` (`go/go.mod:1`). Releases tag it `packages/server/go/vX.Y.Z` (README `:759`).
  - [run] The proxy has `v2.0.0` from 2026-11-06T07:22Z, at ref `refs/tags/packages/server/go/v2.0.0`.
  - The release checks it with `go list -m` against the public proxy (`.github/workflows/release-server.yml:427-430`).
- **Archives:** `blok-server-go_<os>_<arch>` for darwin, linux and windows on amd64 and arm64, plus `checksums-go.txt`.
  - They are built by `scripts/publish-server-go.mjs` (targets `:18-23`, `CGO_ENABLED=0` `:48`) from `release-server.yml:158-159`, and smoke-tested at `:180-184`.
  - [run] `gh release view v2.0.0` lists all six Go archives.
- **Docker:** C# only. The `packages/server/Dockerfile` final stage is `dotnet/runtime-deps` (`:56`). There is no Go image.
- **`go install`:** [run] `go install github.com/JackUait/blok/packages/server/go/v2/cmd/blok-server@v2.0.0` took 15 s and gave a 27.9 MB binary that runs `--help`. The module has no `replace` lines, which `go install` would refuse.
- **Stale doc.** README `:757` says "No release has shipped them yet". The v2.0.0 assets and the proxy entry say otherwise. Flagged, not fixed.
- **Laws that shape a new binary:**
  - `server-go-parity-law.test.ts:134` "ships no goreleaser config";
  - `server-go-delivery-law.test.ts`, which pins release delivery;
  - `server-go-parity-law.test.ts:83`, which checks that the module and its server command exist.

### 3.2 How a Go MCP would ship

**Library:**

- Package `blokmcp` inside the v2 module, at `github.com/JackUait/blok/packages/server/go/v2/blokmcp`.
- It ships with the existing tag, with no new release channel.
- It reaches the internals (§2.0) and costs non-users nothing at compile time (§2.8).

**Binary:**

- `cmd/blok-mcp` in the same module. Users would run `go install github.com/JackUait/blok/packages/server/go/v2/cmd/blok-mcp@vX.Y.Z`. This is **inferred** from the measured `blok-server` install, not tried.
- Archives would be new entries in `GO_TARGETS` in `publish-server-go.mjs`, with new names and checksums, the smoke step, and the delivery law.
- MCP clients usually launch by command. A Go user can point a client at the `go install`ed binary. Non-Go users would use the archive.
- An npm or `dnx`-style one-liner does not exist for Go. That is a docs and packaging decision for the user.

---

## 4. Go-specific risks

- **goja cannot await the host.** A still-pending promise returns `ErrPending` (`internal/jsruntime/runtime.go:23-24,197-208`). So approval uses the same two-run retry as C#. The first run answers `APPROVAL_REQUIRED`, Go returns `InputRequests`, and the retry runs the bundle with `approve`. Uploads need host data handed in up front. Page creation already works this way.
- **The memory budget is process-wide.** It is the live heap at the last GC, polled every millisecond, so "concurrent calls add up and the call that crosses the line is the one stopped" (`guard.go:20-33`). The default is 1 GiB (`pool.go:18-22`). Many MCP handles doing big reads at once can stop each other's calls.
- **The pool is small.** The default is `max(1, min(NumCPU, 4))` engines, and callers wait (`pool.go:185`; `blokdocs` Options). The MCP shares the pool with the rooms and the converter when embedded (`Server.AgentExecutor`).
- **The timeout is not a hard bound.** "goja checks it between JavaScript instructions, so a long native builtin … overruns it by seconds" (`blokdocs/blokdocs.go:32-35`).
- **`Session` is not safe for concurrent use.** Each handle needs a mutex (§2.1).
- **New bundle ops must pass the Go bundle laws:**
  - no sticky regex (`server-go-runtime-bundle-law.test.ts:174`; memory: sticky regex is quadratic in Jint);
  - the bundle is committed, rebuilt by the release and drift-tested.
  Rust embeds the same copy.
- **SDK churn.** The v1.9.0 flag removals (§1.1) and the hard `Mcp-Param` header check (§1.8) are SDK behaviour, not Blok's. Pin the version and cover it in conformance.
- **Consumers need Go 1.27.1 or later** (`go/go.mod:3`).

---

## 5. Still unverified

- Node's exact wire shape for `input_required` (whether it has `content`).
- Whether removing `ttlMs`/`cacheScope` from 2025-era `tools/list` with a `ResultBase` middleware works the way it did for prompts.
- The consumer `go.sum` and MVS effect of adding the SDK to Blok's `go.mod` (§2.8).
- That `go install …/cmd/blok-mcp@…` works. It is inferred from `blok-server`.
- Whether a stricter MCP client than Node's breaks on a stray stdout line.
- `blok_read` parity through `doc.read` (shared with C#).
