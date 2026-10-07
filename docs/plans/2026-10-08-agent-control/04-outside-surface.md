# 04 — Outside agent surface (MCP)

Date: 2026-10-08. Builds on `00-brief.md`. Consumes spec 01 (commands, document view, sessions), spec 02 (manifest) and the shared renderer from 03. Revised to match `06-reconciliation.md`, round 2 included. Where this spec and 06 differ, 06 wins. Shapes taken from 06 §3 are copied verbatim.

Labels used below:

- **[code]**: read in this repo in this session, cited `path:line`.
- **[MCP spec]**: read from the MCP specification, revision 2026-07-28, at modelcontextprotocol.io, when this spec was first written.
- **[unverified]**: not checked against a primary source. It must be checked before anyone builds on it.
- **(decided D#)**: follows the user's decision D# in 06 §5. All of D1, D1a and D2–D6 are decided.

---

## 1. Purpose and success criteria

**Purpose.** Let an outside agent (Claude Code, Claude Desktop, any MCP client) read and edit Blok documents through meaning-level commands. It must reach both kinds of document:

- a **live room**, where the agent joins as a named participant that people can see;
- a **stored document**, where no Blok sync service exists: load the JSON, edit it headless, save it.

The MCP server invents nothing. Its three core tools are rendered from the shared `AgentContract` by `renderAgentTools` (06 §3.6, §3.7). It adds only three lifecycle tools and the `handle` argument.

**Success criteria.**

1. An agent can open a document, read the `DocumentView`, run an `AgentBatch`, and close it, using only MCP tools.
2. In a live room, people in the browser see the agent as its own participant, separate from the person it works for. Its edits arrive as ordinary remote edits, with rich text written as formatted `Y.XmlText`. A moved block keeps its Yjs identity.
3. In a live room on a journal-backed service, a successful batch result says `delivery.durable: true` only after the server acknowledged every operation of that batch.
4. A stored-document save never silently overwrites a newer version when the host's endpoint answers a stale write with 409.
5. When config names a sync URL for a document, a stored-document save is never written to the host's endpoint.
6. The three core MCP tools are the output of `renderAgentTools({ format: 'mcp', handle: true })`. A law test fails if an MCP tool schema names a command that is not in the contract, or if 04 renders a core tool by itself.
7. Local use works over stdio with no network service. Hosted use works over Streamable HTTP with OAuth bearer tokens.
8. In a live room, peers see where the agent is working through `agentCursor`, at least at block level (06 §10.2).
9. `doc.setTitle` / `doc.setIcon` work in both modes (06 §10.1 A).

---

## 2. What exists today

### 2.1 The server package and its routes

- `@bloklabs/server` is a C# service with an npm wrapper and a Docker image (`packages/server/README.md:3`, `packages/server/bin/blok-server.mjs:1-10`, `packages/server/Dockerfile:46-50`). The npm package's only JS export is the ticket signer `./ticket` (`packages/server/package.json` `exports`, `packages/server/src/ticket.ts:45-61`).
- `--collab` turns on sync rooms. `--doc-endpoint` names the host routes the service loads documents from and writes them back to (`packages/server/README.md:218`).
- The host's endpoint contract (`packages/server/README.md:518-526`):
  - `GET {DocEndpoint}/{docId}` answers `{"data": <doc>, "version": "<v>"}` or the bare document.
  - `PUT {DocEndpoint}/{docId}` sends the bare document and `Blok-Doc-Version`.
  - The README **recommends** that the host answer a stale PUT with 409 (`:525`). Nothing enforces it.
  - The endpoint is authorised with one shared header value, `DocEndpointAuth` (`:218`, `:520`). That one value opens every document.
- HTTP routes for a backend that is not a socket peer (`packages/server/README.md:293-300`, `packages/server/protocol/blok-sync-v2.md:823-930`):
  - `GET /sync/{doc}/state` returns the live document JSON. On a journal it also returns `ETag: "<lineage>:<sequence>"` (`README.md:328`).
  - `POST /sync/{doc}/edit` applies ops all-or-nothing. It needs a `Blok-Idempotency-Key` and takes an optional `If-Match` (`README.md:304`, `:320-326`).
- The edit wire has only three ops: `insert`, `update` (replaces a block's `data`) and `remove` (`packages/server/dotnet/Blok.Server/Collab/CollabEditOps.cs:31-41`, `:84-89`). **There is no move op.** A version restore plans "everything else is removed and inserted again" (`packages/server/dotnet/Blok.Server/Collab/CollabRestorePlanner.cs:24-30`).
- `update` is merge-safe inside one block. It edits an existing formatted text in place with minimal ops, and deep-assigns into live containers (`packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs:1110-1185`, `:1315-1330`). Only the doc comment at `CollabEditOps.cs:37` still says "last writer wins" (06 B6). The C# side keeps this in lockstep with the client's `document-store.ts` by shared fixtures (`packages/server/dotnet/Blok.Server/Collab/RichTextEdit.cs:21-31`).
- The C# converter knows the `blocks` and `root` Yjs roots (`YDocConverter.cs:77-78`). The client added a `page` map two commits ago (`src/components/modules/yjs/document-store.ts:166`, commit `b679a115`). The store exposes it as `page` (`:222`) and loads it with `pageFromJSON` (`:227-232`). `page-fields.ts` exports `readPageFields` (`:25`) and `writePageField` (`:35`). `PageIcon` is `{type:'emoji', value} | {type:'image', url}` (`types/tools/page.d.ts:13`). `YjsManager` has `getPageFields`, `loadPage`, `setPageField`, `onPageChange` (`src/components/modules/yjs/index.ts:954-980`). The saved `OutputData` has no page field yet; 06 §10.1 adds an optional one.

### 2.2 The sync protocol

From `packages/server/protocol/blok-sync-v2.md`:

- Subprotocol offers are `blok-sync.v2, blok-sync.v1, <ticket>` (`:46-55`).
- On a v2 socket, a client write must be a type-102 operation frame. A raw sync update closes the socket with 1008 (`:479-491`).
- Type 103 is an acknowledgement. It means the operation is durable in the store (`:181-189`, `:519-543`).
- Type 104 is a rejection. Codes: `lineage-mismatch`, `read-only`, `not-synced`, `invalid-update`, `oversized-update`, `operation-id-conflict`. Unknown codes are final (`:427-467`).
- A store failure is not a rejection. The room closes every member with `4503 commit unavailable, retry` (`:469-477`).
- Type 106 (activity) is one byte, sent on open and at most once a minute (`:201-217`).
- Type 107 (identities) maps awareness client ids to the actor the **server** verified (`:219-264`).
- Type 100 announces `format: 2`. A client must close on any other format (`:127-140`, `packages/server/README.md:222`, `:412`).

### 2.3 Identity, auth and the door

- A ticket is an HS256 JWT with `user`, `doc`, `write`, `exp` (`packages/server/src/ticket.ts:14-34`, `:50-55`; `packages/server/dotnet/Blok.Server/Tickets/TicketVerifier.cs:113-128`).
- The ticket's `doc` claim scopes every collaboration route to one document. `write: false` opens the socket read-only (`packages/server/README.md:336`).
- A collaboration ticket must name a `user`, or the socket closes 4401 (`README.md:336`).
- The actor id recorded in the journal and sent in frame 107 is the ticket's `user` claim (`packages/server/dotnet/Blok.Server.AspNetCore/Collab/SyncHandshake.cs:247-252`).
- **In ticket mode the door always requires an allowed `Origin` header, for every client, browser or not** (`SyncHandshake.cs:113-125`; HTTP routes: `packages/server/dotnet/Blok.Server.AspNetCore/BlokServerRequestGuard.cs:26-40`).
- An ASP.NET host can narrow access per document with `IBlokAuthorization`. In ticket mode it receives a principal built from the ticket (`packages/server/dotnet/Blok.Server.AspNetCore/IBlokAuthorization.cs`, members `CanReadDocumentAsync` / `CanWriteDocumentAsync`).
- The dev playground runs the C# host in ticket mode with a journal, and turns off the rate limit because "Ticket mode defaults to 60 requests a minute" (`scripts/dev.mjs:183-195`).

### 2.4 The embedded Jint runtime

- `Blok.Server` embeds a JS bundle built from `src/view/server-runtime.ts` as an ES2020 IIFE with a `worker` resolve condition and an `atob` shim (`scripts/build-server-runtime.mjs:24-80`).
- The bundle exposes one entry, `blokServerInvoke(operation, inputJson)` (`src/view/server-runtime.ts:375`, `:493`). Its operations are pure JSON-in, JSON-out conversions: Markdown, HTML, plain text, texts, page index, remap, version, schema, `htmlFieldsToSegments` (`src/view/server-runtime.ts:377-483`).
- It holds no Y.Doc, no socket and no editor. The C# side runs it from an engine pool, with a 10 s default timeout and a 512 MiB per-call allocation budget (`packages/server/dotnet/Blok.Server/Runtime/JintBlokRuntime.cs:16-30`, `:58-80`).
- C# has its own Yjs port (`packages/server/dotnet/Blok.Server/Yjs/*.cs`). Rooms run on that port, not on JS Yjs.

### 2.5 Blok's own client already runs headless in Node

This is the most important fact for this spec.

- `downloadOfflinePage` builds a `DocumentStore`, an operation store and `createCollabProvider` with **no editor and no DOM**. It waits until the provider reports `connected` with a non-null working-set tag before it trusts the document (`src/components/modules/collaboration/headless-offline-page.ts:27-32`, `:96-118`, `:120-160`). It only downloads. It never writes.
- `test/unit/server-conformance/blok-client-contract.test.ts` runs under `@vitest-environment node` (`:1`). It drives the real `createCollabProvider` over the real `DocumentStore` against the built C# binary (`:13-27`, `:34-41`). Its socket factory sends an `Origin` header in ticket mode through Node's `WebSocket` (`:216-234`).
- The provider takes an injectable `socketFactory` "so … a node tier can supply `ws`" (`src/components/modules/collaboration/types.ts:213-234`).
- v2 is offered only when there is an outbox (`src/components/modules/collaboration/provider.ts:51-61`).
- `createOperationStore({ offlineScope: null })` runs the outbox in memory and "drains like any other queue" (`src/components/modules/collaboration/operation-store.ts:59-63`, `:118-127`).
- Without `keepsLocalCopy`, the store discards the quarantine's recovery snapshot (`src/components/modules/collaboration/types.ts:328-334`).
- The browser's write tap appends each **local** doc update to the outbox, then calls `provider.drain()`, because the outbox's commit hint never fires for the tab that wrote the row (`src/components/modules/collaboration/index.ts:940-951`; `types.ts:404-415`). The headless download path has no such tap.
- `DocumentStore.onUpdate` skips updates applied through `applyRemoteUpdate` (`src/components/modules/yjs/document-store.ts:2399-2415`). `onAnyUpdate` sees every update, remote ones included (`:2428`). The headless seam wires `onDocUpdate` to `onUpdate` and `onAnyDocUpdate` to `onAnyUpdate` (`headless-offline-page.ts:99-100`).
- `DocumentStore.transact(fn, origin)` takes a `LocalOriginTag` (`document-store.ts:2281-2282`). `'local'` is one of those tags (`src/components/modules/yjs/types.ts:73-80`). `onUpdate` drops only origins it remembered as remote (`document-store.ts:2344-2348`), so a `'local'` write reaches the tap.
- The provider calls `enableAwareness()` at connect (`provider.ts:1593-1597`). Publishing `user` is the Presence module's job (`src/components/modules/collaboration/presence.ts:351-371`). A headless session has no Presence module, so it must set `user` itself.
- `YBlockSerializer` takes `richTextFieldsFor` for custom tools' rich fields (`src/components/modules/yjs/serializer.ts:329-344`). `downloadOfflinePage` builds it with no options (`headless-offline-page.ts:32`).

### 2.6 How people see participants

- Awareness fields: `user` `{name?, color, id?}`, `blockId`, `caret`, `activeAt` (`presence.ts:312`, `:341`, `:363-370`, `:390`).
- New awareness information goes in a **new field**, because older clients read existing fields by name (`presence.ts:316-322`).
- `caret` is `{blockId, inputIndex, anchor, head}`. `inputIndex` indexes the block's DOM `inputs` (`src/components/modules/collaboration/caret-position.ts:18-29`). A headless client has no DOM inputs.
- Participant rows are grouped by the verified actor id from frame 107 (`src/components/modules/collaboration/participants.ts:80`, `:98-115`). **Two connections with the same verified id become one row.** The row is marked `self` if any member is the local client (`participants.ts:136`). So an agent that connects under its human's id would vanish into that human's row. In the human's own browser it would even show as "self".

### 2.7 The Yjs document shape

- `Y.Map('blocks')` holds id → per-block `Y.Map`. `Y.Array('root')` holds top-level order. Children keep order in each block's `contentIds` (`src/components/modules/yjs/document-store.ts:100-110`, `:151-166`).
- A move never deletes and recreates the block map, so a concurrent remote edit to a moved block merges (`document-store.ts:104-106`). The store has `addBlockAt` (`:681`), `moveBlockTo` (`:824`), `updateBlockData` (`:1363`) and `updateBlockMetadata` (`:2244`).
- Rich text in a room is formatted `Y.XmlText` with one attribute per mark (`packages/server/README.md:426-428`).

### 2.8 Packaging today

- `@bloklabs/cli` is built by `scripts/build-cli.mjs` from `src/cli/index.ts` into `packages/cli/dist` (`scripts/build-cli.mjs:16-38`). It depends on `jsdom` (`packages/cli/package.json` `dependencies`). It is a one-shot converter, not a server.
- Packages are released through `scripts/release-manifest.mjs`. The cli and server entries are at `:43-66`.
- `yjs`, `y-protocols` and `y-websocket` are root `devDependencies`, bundled into the build (`package.json:308-311`).
- `ws` 8.21.0 is in `node_modules` (`node_modules/ws/package.json:3`). It is not a root dependency (no `"ws"` key in `package.json`).
- The view-entry law forbids any module outside `src/view/` to import from it, except `src/migrate/` (`test/unit/architecture/view-entry-law.test.ts:58-66`). A separate test allows only `src/view/` to import `parse5` (`:50-55`).
- The last release tag is `v1.16.1`.

### 2.9 No existing MCP server

There is no MCP code in this repo today. `grep -rln modelcontextprotocol package.json src packages/*/package.json` found nothing.

---

## 3. Design

### 3.1 Decision: the MCP server is one Node package

(decided D1, D1a: headless execution ships in v1 in **both** Node and C# Jint. The C# path is a **service API**, `IBlokAgentExecutor`, for a .NET host's own backend agent (06 §7.3). It is not an MCP server and has no HTTP route. Stored ships first, then live rooms (06 §7.6). **The MCP server stays Node-only.**)

The MCP server is a new Node package, **`@bloklabs/mcp`**, with a `blok-mcp` bin (decided D2). It runs 01's sessions in Node:

- **Live rooms**: `createStoreAgentSession` over the session's own `DocumentStore`. Its `StoreApplier` writes with origin `'local'` inside `DocumentStore.transact` (06 C1). The room is reached through the real `createCollabProvider`.
- **Stored documents**: `createDocumentAgentSession` over plain `OutputData`. Its `JsonApplier` is pure. There is no socketless `DocumentStore` (06 C1). Page title and icon travel in the optional `OutputData.page` (06 §10.1 A).

| Concern | Node + real client code | C# host + Jint, as an MCP server |
|---|---|---|
| Yjs writes humans see | Same `DocumentStore` code the browser runs (§2.5, §2.7). No port to keep in lockstep. | C# Yjs port plus the `/edit` planner. Lockstep is kept by fixtures (§2.1). |
| Moves | `moveBlockTo` keeps the block's Y.Map (§2.7). 01's `Edit` list maps one-to-one onto store methods (06 C1). | `/edit` has no move op. A move becomes remove + insert (§2.1), which drops a peer's concurrent edit inside the moved subtree. |
| Running 01 | 01's planner is pure and DOM-free. Node runs it directly. | Jint runs pure JSON → JSON operations only (§2.4). It has no Y.Doc and cannot join a room. |
| Presence | The provider and awareness exist (§2.5). The agent is a real socket member with frames 106 and 107 handled. | An HTTP `/edit` caller has no awareness, so it is invisible. An in-process C# member would need new internal code (`ICollabMember` is internal, `packages/server/dotnet/Blok.Server/Collab/ICollabMember.cs:45`). |
| Who can deploy it | Any host that can run Node next to its Blok service, including .NET hosts. It speaks the public wire, like any client. | .NET hosts only. |

So: **the MCP server is Node.** The C# Jint path also ships in v1 (decided D1, D1a), but as `IBlokAgentExecutor` inside a .NET host, not as an MCP surface (06 §7.3). Its live variant translates `Edit[]` into internal room ops, including a new internal `Move`, without changing the `/edit` wire (06 §7.4). It writes as an attributed actor but is **not a visible participant**: it has no socket, so no awareness and no frame-107 identity (06 §7.4). The brief's "agent joins as a participant people can see" is met only by this Node MCP path. Until a server spec exists, the C# server work is owned by 01 and 04 together (06 §11).

### 3.2 Components

```
MCP client ──stdio / Streamable HTTP──► @bloklabs/mcp
                                         ├─ transport + auth            (§3.7, §3.8)
                                         ├─ tool set                    (§3.4)
                                         │     core tools: renderAgentTools(contract, {format:'mcp', handle:true, runtime:'headless'})
                                         │     lifecycle tools: rendered by 04
                                         ├─ contract                    buildAgentContract(buildToolManifest(...)) + --manifest / --manifest-overrides
                                         ├─ handle registry             (§3.3)
                                         ├─ LiveSession  ──blok-sync.v2 WebSocket──► Blok sync service room
                                         │     DocumentStore + memory outbox + provider + write tap + presence
                                         │     createStoreAgentSession (StoreApplier)
                                         └─ StoredSession ──DocumentSource──► host endpoint │ local files
                                               createDocumentAgentSession (JsonApplier) over OutputData
```

New code:

1. `src/components/modules/collaboration/headless-session.ts` (core, not published). It generalises `downloadOfflinePage` into a **writing** session. Details in §3.5.
2. `src/mcp/` (core source tree, bundled like `src/cli/`). It holds the MCP server: lifecycle tools, handles, sources and config. It bundles `src/agent/render-tools.ts` and `src/view/agent-runtime.ts` from source. No new core subpath (06 C13).
3. **View-entry law exception.** `src/mcp/` imports the headless ports from `src/view/agent-runtime.ts` (06 §3.8). Today that import fails the law (§2.8). The law gets a second exception for `src/mcp/`, with the same "no other module imports `src/mcp/`" guard it has for `src/migrate/` (06 C13). `src/mcp/` itself never imports `parse5`; the parse5 law stays as is.
4. `scripts/build-mcp.mjs`, modelled on `scripts/build-cli.mjs`. It writes `packages/mcp/dist`.
5. `packages/mcp/` with `package.json`, `bin/blok-mcp.mjs`, `README.md`, `types/index.d.ts`.
6. One new entry in `scripts/release-manifest.mjs`, next to cli and server (`:43-66`), and a root `build:mcp` script. The root script is a `package.json` edit, approved with D2 (decided D2).

**Version lockstep.** The package bundles its own copy of core. The room format and the `unsupported-format` close (§2.2) mean an MCP server from another release family can be refused by the room. `@bloklabs/mcp` therefore ships in the same family version as `@bloklabs/core` and `@bloklabs/server` (decided D2). Its README must say to upgrade all three together, like the server README does (`packages/server/README.md:222`).

### 3.3 Handles

**[MCP spec]** Revision 2026-07-28 has no protocol-level session. Tools that need state across calls should return an explicit handle from a creation tool and take it as an argument afterwards. A handle is a name, not a capability, so the server must re-check authorization on every call. Expiry must be stated in the creating tool's description. A call on an expired handle should be a tool execution error that says so. (Tools page, "Stateful Tools".)

So:

- `blok_open` returns an opaque `handle` (random, 128 bits). Every later tool takes it.
- A handle is bound to `{principal, documentId, mode, write, actor}`. Each call checks that the caller's principal matches. A mismatch reads as `UNKNOWN_HANDLE`, so the call does not reveal that the handle exists.
- **Idle expiry**: 10 minutes by default (`--handle-idle-ms`). On expiry a live handle leaves the room, which withdraws its presence. An idle open handle also keeps the room loaded, which delays eviction and the write-back to the host (§3.6), so expiry matters for more than cleanup.
- **Cap**: 8 open handles per principal by default (`--max-handles`).
- The same design works for clients on older, session-based revisions. Handles are ordinary tool arguments in any revision.

### 3.4 MCP tools

**[MCP spec]** `tools/list` "MUST NOT vary per-connection or as a side effect of other requests". It MAY vary by the authorization presented (Tools page, "Capabilities"). So the tool **set** is fixed per deployment. What a given document allows goes into the result of `blok_describe`, not into the tool list.

Six tools. Three are the **core tools**, identical to the in-app surface except for `handle` (06 C2). Three are **lifecycle tools**, owned by 04.

| Tool | Kind | What it does | Writes? |
|---|---|---|---|
| `blok_list_documents` | lifecycle | Lists documents the caller may open, if the source can list them. | no |
| `blok_open` | lifecycle | Opens a document in `live` or `stored` mode and returns a handle. | no |
| `blok_read` | core | Returns the `DocumentView` for a handle (`AgentSession.read`). | no |
| `blok_describe` | core | Returns the contract index, or one tool or command (`AgentSession.describe`). Takes `{ tool?, command? }`. | no |
| `blok_execute` | core | Runs one `AgentBatch` on a handle (`AgentSession.execute`). | yes |
| `blok_close` | lifecycle | Leaves the room, or drops the stored session. | no |

**Core tools come from the shared renderer.** 04 calls `renderAgentTools(contract, { format: 'mcp', handle: true })` (06 §3.7). `handle: true` adds `handle` with `x-mcp-header: "Blok-Handle"` to every core tool. The renderer lists only `available: true` commands (06 R3-1). `page.rename` and `page.setIcon` are `runtime: 'any'` and `requires: ['pageBackend']`; 04 provides `pageBackend` when `--page-titles page-map` is set, so they are listed then and absent otherwise (06 R3-2). 04 never hand-writes a core tool schema. The two surfaces cannot render the contract differently, because they run the same function.

**Schema mode.** Both surfaces use the same mode. Default `'envelope'`: `name` is an enum of `contract.commands[].name`, `args` is an open object, and the model calls `blok_describe` for a command's args. `'full'` is an option: `items` are a `oneOf` with one branch per command (06 §3.7). 05's eval picks the shipped default before release (06 C2, 04-Q15). `strict` is never emitted for `blok_execute`, because `block.insert.children` is recursive (06 §3.7, 03-Q6).

**The contract.** At startup 04 builds `buildAgentContract(buildToolManifest(snapshot, overrides), COMMANDS, { runtime, services })` (06 §3.6). `runtime` is `'node'` for stored handles and `'node-live'` for live ones, so `history.undo` is unavailable in live mode. `services` holds `'pageBackend'` only with `--page-titles page-map`. A tools/list is fixed per deployment, so the rendered list uses the stored contract; a live handle refuses `history.undo` with `COMMAND_UNAVAILABLE` (06 R3-1).

- Built-in tools come from `BUILT_IN_BLOCK_DESCRIPTIONS`, built in Node (06 04-Q9).
- Host custom tools come as a `BlokCustomToolsFile` through `--manifest <file>` (06 R2-04-Q17, published in `types/tool-manifest.d.ts`). The C# Jint ops take the same file (06 §7.2). In v1 custom tools get structural commands and field writes only. Custom tool **action handlers** run only in the browser; Node and Jint handlers are cut, user can revisit (decided D6).
- Overrides come through the `overrides` option and `--manifest-overrides <file>`, typed `ManifestOverrides` (06 §3.6, 02-Q10). An override that hides an action also refuses it at execute time.

**Results.** **[MCP spec]** A tool returns `structuredContent` plus, for backward compatibility, the same JSON as a text content block. A tool with an `outputSchema` must conform to it. Errors a model can fix go back as a tool result with `isError: true`. Malformed requests and unknown tools are JSON-RPC errors (Tools page, "Structured Content", "Error Handling"). Every tool here declares an `outputSchema`.

**Tool annotations** (`readOnlyHint` and similar) are **[unverified]** for revision 2026-07-28. If they exist, mark the read tools read-only and `blok_execute` not read-only.

**Descriptions.** The core tool descriptions come from the renderer and carry `AgentGuidance` (06 §3.6). The lifecycle tool descriptions are written by 04. `blok_open`'s description states the idle expiry (§3.3). The guidance must say plainly that agents write rich text through commands, never Markdown into block data. That failure is the one the brief opens with.

### 3.5 Live mode: the agent as a room participant

**Session assembly** (`headless-session.ts`):

1. `new DocumentStore(new YBlockSerializer({ richTextFieldsFor }))`. `richTextFieldsFor` reads `richTextFields` from each manifest entry (06 04-Q10). Config `richTextFields` (the same JSON shape as the server's `--rich-text-fields`, `packages/server/README.md:220`) is used only for block types missing from the manifest. Without either, a custom tool's rich field would be written in the wrong shape.
2. `createOperationStore({ url, doc, offlineScope: null })`, the in-memory outbox (§2.5).
3. `createCollabProvider({ url, docId, yjs: seam, outbox, ticketSource, socketFactory, onStatus, onOperationAcknowledged, onVerifiedIdentities })`. The seam is the same object `downloadOfflinePage` builds (`headless-offline-page.ts:96-118`).
4. **The write tap.** Subscribe to `onDocUpdate`, which is `DocumentStore.onUpdate` and skips remote updates (§2.5). For each update, call `store.appendLocal(update)`, then `provider.drain()`. This mirrors `collaboration/index.ts:940-951`. Never subscribe to `onAnyDocUpdate` here. That would send peers' work back to the room as the agent's.
5. `createStoreAgentSession({ store, tools, contract, actor, ports })` (06 §3.5). `StoreApplier` writes with origin `'local'`, which the tap sees (§2.5). `ports` are the headless ports from `src/view/agent-runtime.ts`.
6. `socketFactory` opens a Node WebSocket with the subprotocols the provider asks for, plus an `Origin` header from config `origin`. Ticket mode needs it (§2.3). Whether Node's global `WebSocket` accepts a `headers` init is **[unverified]**: the conformance test casts it (`blok-client-contract.test.ts:233-234`). If it does not, the implementation uses `ws`, which `@bloklabs/mcp` then declares as a dependency (§2.8; decided D2).

**Open is gated on sync.** `blok_open` in live mode does not return until the provider reports `connected` with a non-null `tag`, as `headless-offline-page.ts:128-150` waits. Before that the local document is empty. An agent that read or "appended at the end" earlier would act on an empty document. The wait has a timeout of 15 s, the value the download path uses (`headless-offline-page.ts:88`). On timeout the tool returns `ROOM_SYNC_TIMEOUT`.

**Identity.**

- The session's `AgentActor` (06 §3.5) is `{ id, name, kind: 'agent', onBehalfOf, color }`.
- **The ticket's `user` claim must equal `actor.id`** (06 C3). The journal and frame 107 then name the agent. The MCP server checks this before it connects. With `secret` tickets it mints the claim itself. With `ticketUrl` it decodes the returned ticket's payload and refuses a mismatch with `FORBIDDEN`. It does not verify the signature; the room does.
- `actor.id` is the agent's **own** id, never the human's (§2.6). The MCP server always sets `actor.onBehalfOf` to the human's id, since the awareness `agent.onBehalfOf` is required (06 R2-03-4). Recommended form: `agent:<humanId>:<clientName>`. The host decides the format, since the host mints or approves the ticket (§3.8).
- Awareness `user` = `{ name: actor.name, color: actor.color, id: actor.id }`.
  - `name` defaults to `"<clientName> (for <humanName>)"`. `clientName` comes from the MCP client's info.
  - `id` rides only alongside a name, as in `presence.ts:356-370`.
- A new awareness field, `agent`, set to `{ via: 'mcp', onBehalfOf: actor.onBehalfOf, onBehalfOfName? }` (06 R2-03-4). It is a new field, per the rule at `presence.ts:316-322`. Old clients ignore it. 03 shows "for <onBehalfOfName>", else resolves the participant row by id, else shows nothing.
- `lastEditedBy` / `lastEditedAt` on touched blocks are stamped by `StoreApplier` through `updateBlockMetadata` (`document-store.ts:2244`; 06 C3). 05's `attributed` grader reads them, plus the journal `actors` for MCP agents (06 05-Q11).

**Presence while working.**

- On open, the provider sends frame 106 itself (`types.ts:380-392`). After every executed batch, the session calls `provider.sendActivity()`, at most once a minute. In the browser the Presence module keeps that limit, not the provider (`types.ts:383-391`), so the headless session must keep it itself.
- After every batch, the session sets `blockId` to the last id in `AgentResult.changed` (created, then updated, then moved), and `activeAt` to now (06 C8, 04-Q3).
- **No `caret`.** `caret.inputIndex` counts DOM inputs (§2.6), and a headless agent has none.
- **`agentCursor` instead** (decided D6: kept in v1; 06 §10.2). After each batch the session publishes a new awareness field, verbatim from 06:

```ts
agentCursor: {
  actorId: string;
  name: string;
  color?: string;
  blockId: string;
  field?: string;        // a data field of that block; absent = block-level
  start?: number;        // contract units (C12): UTF-16, one per embed
  end?: number;
} | null
```

  - Set from `AgentResult.lastRange` when present (`blockId`, `field`, `start`, `end`). Otherwise block-level, with `blockId` from `changed`.
  - Set to `null` on `blok_close` and on handle expiry.
  - Browsers map `field` to an input with 02's `inputFields`, else draw a block-level marker. That drawing is 03's (06 §10.2).

**Live atomicity.** 01 plans, dry-runs and applies with no await between snapshot and apply, and applies in one `transact` (06 R2-01-2). If the apply throws, the result is `APPLY_FAILED` ("may be partly applied; re-read"). The handle then goes **read-only** until reopened. Later `blok_execute` calls return `READ_ONLY`.

**Page title and icon** (decided D6: kept in v1; 06 §10.1 A). `doc.setTitle` and `doc.setIcon` are core commands. In live mode `StoreApplier` writes them with `writePageField(store.page, key, value)` inside the batch's `transact` (§2.1). `doc.read` returns `page: { title?, icon? }`.

**Table data.** No browser writes normalised data back for a block another client authored (06 C17). So the agent must write complete data itself. Writing tables in live mode needs 02's pure `normalize(data)` for the table, which fills column and row ids. That is a **prerequisite**: until the table's `ToolRuntime.normalize` exists, live-mode commands that insert or reshape a table are not shipped (06 C17).

**Optimistic checks.** `AgentBatch.expectRevision` in live mode is an opaque counter over the session's store updates, counted from `DocumentStore.onAnyUpdate` (`document-store.ts:2428`; 06 04-Q4, R2-04-1). It is not a Yjs state vector, and never the source's `savedVersion`. A busy room bumps it on every peer keystroke, so it goes stale fast. Agents should prefer `expectText` on text ranges (01). The `blok_execute` description says so.

**Durability of a batch.** The result goes in `delivery` (§5.1).

| Server profile | What `blok_execute` waits for | `delivery` |
|---|---|---|
| Journal (v2 negotiated) | The outbox has no pending rows from this batch. Each row retires on its type-103 ack (`blok-sync-v2.md:181-189`). Timeout 10 s. | `durable: true`, `serverSequence` = last ack |
| Working copy (v1 negotiated) | Nothing beyond the local apply and send. The server selects v2 only when it has an operation store (`packages/server/dotnet/Blok.Server.AspNetCore/Collab/SyncHandshake.cs:276-280`), so a working-copy server always answers v1 even though the session offers v2. | `durable: false`. The server makes no durability claim on v1 (`blok-sync-v2.md:57-59`). |
| Timeout on a journal | — | `durable: false`, `pending: true`. The batch stays queued and drains on reconnect. |

**Room events and how the tools see them.**

| Event | Source | Effect on the handle | Error code |
|---|---|---|---|
| Rejection `read-only` | 104 | The provider quarantines the batch's rows and the rest of the lineage tail (`blok-sync-v2.md:450-455`). The handle becomes read-only. | `READ_ONLY` |
| Other final rejections (`invalid-update`, `oversized-update`, `operation-id-conflict`, unknown codes) | 104 | Quarantined. The batch is reported as **not saved**. | `REJECTED`, `details.rejectionCode` = the frame's code |
| `not-synced` | 104 | Transient. The provider keeps the rows and redrives them (`blok-sync-v2.md:462-467`). | none |
| Close 4503 `commit unavailable` | close | Rows are kept. The provider reconnects with backoff (`blok-sync-v2.md:469-477`). | none; the batch shows `delivery.pending: true` if the wait times out |
| Close 4409 reset, or `lineage-mismatch` | close / 104 | The room's history no longer matches. With `offlineScope: null` the recovery snapshot is discarded (§2.5). | `ROOM_RESET`, `details.notSavedBatches` = every batch not yet acked. The handle is dead and must be reopened. |
| `unsupported-format` | 100 | The session ends. | `VERSION_SKEW` |
| Ticket expiry | — | The ticket is checked only at the handshake (`packages/server/src/ticket.ts:28-32`). `ticketSource` mints a new one on reconnect. | none |

A batch result never claims `delivery.durable: true` for work that was quarantined or lost to a reset.

**Undo.** `history.undo` in live mode returns `COMMAND_UNAVAILABLE` (decided D6: cut, in Node and C# rooms alike; 06 C11, §11 01-15). Snapshot restore would erase peers' concurrent edits.

### 3.6 Stored mode

**Rule: no stored writes while a sync service owns the document.** On a deployment with a Blok sync service, both `/state` and a socket join load the document into a room (`packages/server/README.md:328`, `blok-sync-v2.md:910-930`). The room then owns the host record:

- The room writes it back. With a journal, that happens only on checkpoint, eviction or drain (`packages/server/README.md:7`, `:494`).
- A host's own write must be followed by `POST /sync/{doc}/reset` (`README.md:525`).

A stored-mode PUT next to a room would be overwritten, or would force a reset that drops the room's work. So:

- `mode: "auto"` resolves to `live` when config names a sync URL for the document, and to `stored` otherwise.
- `mode: "stored"` is refused with `STORED_WRITE_FORBIDDEN` when a sync URL is configured.
- On a collab deployment, the host's stored record lags the agent's edits until the room checkpoints. The `blok_close` result says so.

**Session.** A `StoredSession` is `createDocumentAgentSession` over plain `OutputData` (06 §3.5). It uses `JsonApplier`. There is no `DocumentStore` (06 C1). Page title and icon live in the optional `OutputData.page`, and `doc.setTitle` / `doc.setIcon` write it (06 §10.1 A). Steps:

1. **Open.** `source.load(documentId)` returns `{ document, version }`. A never-saved document comes back as `null` or `{"data": null, "version": "0"}` and opens empty (`packages/server/README.md:520`). The session is created with `document`. A loaded document may hold HTML strings in rich fields (`packages/server/README.md:220`). 01's loader turns them into segments with `htmlToSegmentsNode`, and sanitizes on `src/view/sanitize.ts` (parse5) (06 04-Q6).
2. **Execute.** `session.execute(batch)`. `JsonApplier` stamps `lastEditedBy` / `lastEditedAt` with `actor.id` (06 C3).
3. **Save after every successful batch.** `source.save(documentId, session.output(), { ifVersion })`. `ifVersion` is the last version the source handed back. For `endpoint` that is the `version` in the PUT response body, and an empty body keeps the previous one (`packages/server/README.md:521`). Without this chaining, the session's second save would be refused by its own first. The `version` stamp uses the same `getBlokVersion` the server runtime uses (`src/view/server-runtime.ts:4`). Saving per batch means an agent that forgets to save loses nothing.
4. **Conflict.** If the source reports a stale version, the result is `ok: false` with `DOCUMENT_CHANGED`. The handle reloads the document, and the agent must re-read before it retries.
5. **Undo.** `history.undo` is supported. It restores the pre-batch snapshot and saves it with `ifVersion`, like any batch (06 C11, 04-Q5). It undoes only this handle's own last batch, else `UNDO_NOT_OWN` (06 C11).

**Optimistic checks.** In stored mode `expectRevision` is a hash of the canonical document JSON, returned by the session (06 R2-04-1). It is never the source's `savedVersion`.

**Live rooms on the C# host and page fields.** Today the C# converter reads and writes only the `blocks` and `root` roots (§2.1). So a title the agent writes in a room does not reach the host record on write-back until `SeedAsync` / `ExportAsync` carry the `page` root (06 §10.1 A, §11 C# server). That C# change is a prerequisite for live page fields on a C#-hosted room.

**Another page's title and icon** (06 §10.1 B). `page.rename` and `page.setIcon` are page-block actions that point at **another** document by `pageId`. Headless, they are a cross-document write:

- Off by default: `pageTitles: 'off'` leaves `pageBackend` absent, so they are `available: false` and not rendered; a call returns `COMMAND_UNAVAILABLE` (`reason: 'service'`). `--page-titles page-map` provides `pageBackend` (06 R3-2).
- When on, the server opens the target document with the same source and mode rules as `blok_open` (live if a sync URL is set, else stored), under the same principal and `authorize` checks. It runs `doc.setTitle` / `doc.setIcon` there, then closes it. Result: `{ pageId, applied: true }`.
- The action declares `effects: 'host'`, so it must be the only command in its batch (06 R2-02-3).
- **[unverified]** whether a host reads a page's title from that page's `page` map. Hosts store titles behind their own `rename` hook today (`src/tools/page/index.ts:432-475`, per 06 §10.1). The README must say the host has to read titles from the page map for this to show up.

**Document sources** (config):

| Source | Load | Save | Conflict safety | Who may use it |
|---|---|---|---|---|
| `endpoint` | `GET {url}/{doc}` with `Authorization: <endpointAuth>`, the same contract the server uses (§2.1) | `PUT {url}/{doc}` with `Blok-Doc-Version: <version>` | **Only as good as the host's 409.** The README recommends one but does not enforce it (§2.1). Without it, saves are last-writer-wins. | A trusted backend only. `endpointAuth` opens every document, so per-document checks are the MCP server's own `authorize` hook (§3.8). |
| `files` | `<dir>/<doc>.json` | Atomic write: temp file, then rename. Version = a SHA-256 of the file's bytes. | Compare-and-swap on that hash. mtime and size would miss a same-size edit inside one mtime tick. | Local stdio use. |

The `endpoint` source reuses the contract hosts already implement for the sync service. It adds no new host route.

### 3.7 Transports

**stdio** — the default, for local agents.

- **[MCP spec]** "The server MUST NOT write anything to its stdout that is not a valid MCP message." Messages are newline-delimited and must not contain embedded newlines. The server MAY log to stderr. It SHOULD exit when stdin closes. (stdio page.)
- So the bin redirects `console.log`, `console.info` and `console.debug` to stderr before it loads the core bundle. Bundled core code that logs must never corrupt the stream. A test pins this (§6).
- **[MCP spec]** Over stdio, authorization "SHOULD NOT follow this specification, and instead retrieve credentials from the environment" (Authorization page). Credentials come from env: `BLOK_SECRET` or `BLOK_TICKET_URL` plus `BLOK_MCP_HOST_TOKEN`, and `BLOK_DOC_ENDPOINT_AUTH`.

**Streamable HTTP** — for hosted use, with `--http <host:port>`.

- **[MCP spec]** One POST endpoint. The server must validate `Origin` and answer 403 to an invalid one. It should bind to 127.0.0.1 when local. GET and DELETE on the endpoint get 405 in this revision. (Streamable HTTP page.)
- The default bind is `127.0.0.1`. Binding `0.0.0.0` needs `--public` and an auth mode other than `none`. This follows the server host's own rule of refusing unsafe public configs (`packages/server/README.md:196`).
- **Sticky routing.** **[MCP spec]** A tool parameter may carry `x-mcp-header`, which makes clients mirror it into an `Mcp-Param-{name}` header (Streamable HTTP page, "Custom Headers from Tool Parameters"). The renderer marks `handle` with `x-mcp-header: "Blok-Handle"` on the core tools (06 §3.7). 04 marks it the same way on `blok_close`. A load balancer can then route every call for a handle to the process that holds its room socket, without parsing the body. The handle is an opaque name, not a secret, so a header is acceptable. Clients on older revisions do not mirror `x-mcp-header`. Serving them means running a single instance, or routing by some other means.

**Protocol revisions.** Revision 2026-07-28 removed sessions and the GET stream (Streamable HTTP page, info box). Which revision Claude Code and Claude Desktop speak today is **[unverified]**. The server uses the official TypeScript SDK's version negotiation. The handle design does not depend on the revision. SDK package names are **[unverified]**. A web search on 2026-10-08 reported `@modelcontextprotocol/server` 2.x for 2026-07-28 and `@modelcontextprotocol/sdk` for older revisions. Check them at implementation time. The SDK dependency itself is approved (decided D2).

### 3.8 Auth and permissions

Two separate layers. They never share a token.

**Layer 1: caller → MCP server.**

- stdio: the local user. Principal = config `principal` (default `local`).
- HTTP: **[MCP spec]** the MCP server is an OAuth 2.1 resource server.
  - It must serve Protected Resource Metadata (RFC 9728).
  - It must validate that each token was issued for it as audience (RFC 8707).
  - It answers 401 to a bad token, and 403 with `insufficient_scope` to a missing scope.
  - It "MUST NOT accept or transit any other tokens". (Authorization page.)
- So the MCP server never accepts a Blok ticket from the caller, and never forwards the caller's OAuth token to Blok or to the host.
- Scopes: `blok.read` (list, open read-only, read, describe) and `blok.write` (open with write, execute).
- The authorization server is the host's. The MCP package only validates tokens: JWKS URL, issuer and audience come from config.

**Layer 2: MCP server → Blok sync service / host.** One ticket per open handle, scoped by the ticket's `doc` claim (§2.3). Its `user` claim equals `actor.id` (§3.5). Two ways to get one:

| Mode | How | Who decides access |
|---|---|---|
| `secret` | MCP holds `BLOK_SECRET` and mints `{user: actor.id, doc, write, ttlSeconds: 1800}` with `blokTicket` (`packages/server/src/ticket.ts:45-61`). | The MCP's `authorize(principal, doc, write)` hook: a host-supplied JS module or a webhook URL. With neither configured, `secret` mode is allowed only over stdio. |
| `ticketUrl` | MCP POSTs `{doc, write, principal, clientName, actorId}` to a host route, authenticated with the MCP server's own credential `BLOK_MCP_HOST_TOKEN`. The host checks the human's rights and returns a ticket whose `user` is `actorId`. | The host. |

`ticketUrl` is the recommended hosted mode. It keeps the signing secret in the host and puts the decision with the code that knows the user.

On an ASP.NET host with `IBlokAuthorization`, that hook will see the **agent** actor id (§2.3). The host must map it back to the human for its document checks. This is host work, and the MCP README must say so. No server change is needed. Adding an `onBehalfOf` claim to the ticket is possible but not proposed. Whether `TicketVerifier` tolerates unknown claims depends on System.Text.Json's default of skipping unmapped members, which is **[unverified]** here (`TicketVerifier.cs:58-66`, `:113-128`).

**Origin.** Ticket mode requires an allowed `Origin` on every request and socket (§2.3). The MCP server sends config `origin`, which must be listed in `--allow-origin`. Origin is a browser cross-site guard, not proof of identity. The ticket is what authenticates. The README must explain why a backend sends the app's origin.

**Rate limits and caps.**

- Live mode uses one socket per handle. The sync door spends its rate limit on every handshake, rejected ones included (`SyncHandshake.cs:46-52`). In ticket mode the limit key is the ticket's user (`SyncHandshake.cs:174-176`), which here is the agent actor id.
- One user may hold at most `CollabMaxConnectionsPerUserPerDoc` sockets on one document, 8 by default (`packages/server/dotnet/Blok.Server.AspNetCore/BlokServerOptions.cs:192-195`). An agent opens one socket per handle, and handles are per document, so it stays far below that.
- The MCP server never calls `/state` or `/edit`. So ticket mode's default HTTP limit of 60 requests a minute (`scripts/dev.mjs:186-187`) does not apply to it.

### 3.9 Error model

There is one error shape, `AgentError`, and one code union, `AgentErrorCode` (06 §3.2, C7). Command errors come from 01's session and pass through unchanged. 04 adds only the surface codes already in that union: `UNKNOWN_HANDLE`, `HANDLE_LIMIT`, `FORBIDDEN`, `ROOM_SYNC_TIMEOUT`, `ROOM_RESET`, `REJECTED`, `VERSION_SKEW`, `DOCUMENT_CHANGED`, `STORED_WRITE_FORBIDDEN`, `SOURCE_UNAVAILABLE`. `READ_ONLY` is the shared code, not a second one. There is no `DURABILITY_TIMEOUT`: a timed-out wait is `ok: true` with `delivery.pending: true` (06 R2-04-2). Extra facts go in `details` (`rejectionCode`, `notSavedBatches`).

- `blok_execute`: a failed batch or surface error is `AgentResult` with `ok: false` and `isError: true`. There is no second `error` field (06 C8). An error before any session exists (such as `UNKNOWN_HANDLE`) has no `revision` (06 R2-04-3).
- `blok_read`, `blok_describe`: the renderer's MCP `outputSchema` is `oneOf: [<success>, { error: AgentError }]` (06 R2-04-3). 04 does not wrap it (06 R2-04-Q18).
- Lifecycle tools: 04 uses the same branch, `isError: true` with `structuredContent = { error: AgentError }`.
- 04 needs nothing beyond `AgentResult.changed` and `lastRange`; the dropped `AgentChange` is not needed (06 R2-01-4).
- Transport and auth failures are JSON-RPC or HTTP errors, never tool results.

### 3.10 Deployment

- **Local:** `npx @bloklabs/mcp --source files:./docs` over stdio. With `--sync-url ws://127.0.0.1:4000 --origin http://localhost:5173 BLOK_SECRET=…`, it joins rooms of the dev playground's sync service (`scripts/dev.mjs:183-195`).
- **Hosted:** `blok-mcp --http 127.0.0.1:4100 --auth oauth …` behind the host's reverse proxy. It is a long-lived process, because live handles hold sockets. Scale it out with sticky routing on `Mcp-Param-Blok-Handle` (§3.7).
- **Embedded:** `createBlokMcpServer(options)` for a host's own Node backend (§4).
- **Docker:** not in v1; cut, user can revisit (decided D6). The existing image is `runtime-deps` with no Node (`packages/server/Dockerfile:46-50`), so it cannot carry this package.
- **Node version:** `engines` copies core's `>=20.19.0` (`package.json` `engines`) unless the WebSocket check in §3.5 forces a higher floor **[unverified]**.

---

## 4. Public surface, and whether anything breaks

New published things (decided D2; release note per decided D4):

- npm package `@bloklabs/mcp` with bin `blok-mcp`.
- CLI flags and env vars (§5.2).
- One JS export, `createBlokMcpServer`, typed in a hand-authored `packages/mcp/types/index.d.ts`. That file imports nothing from `src/`, per the published-types law.
- The MCP tool names and schemas in §5.1. These are a public contract for agents. The three core tool schemas are the renderer's output, so they change only when the contract changes.
- Two new awareness fields, `agent` and `agentCursor` (§3.5). They are wire fields, not published TS types here. Older clients ignore unknown fields (`presence.ts:316-322`).
- `doc.setTitle`, `doc.setIcon`, `OutputData.page` and `BlokCustomToolsFile` are 01's and 02's surface, listed in D4. 04 only uses them.

**Nothing is breaking.** All of it is new. No existing route, type, data attribute, CSS variable or saved shape changes. The server and its protocol are unchanged. The view-entry law change (§3.2) is a test, not a published surface.

---

## 5. Interfaces

### 5.1 Interfaces I provide

All tools take and return JSON. Schemas are JSON Schema 2020-12, the MCP default (Tools page). `AgentCommand`, `AgentBatch`, `AgentResult`, `AgentError`, `AgentErrorCode`, `DocumentView`, `ViewArgs`, `AgentActor`, `AgentContract`, `ContractSlice` and `ManifestOverrides` are the canonical shapes in 06 §3. This spec does not redefine them.

**Core tools** — rendered, not written by 04:

```ts
renderAgentTools(contract, { format: 'mcp', handle: true })
// → RenderedTool[] for 'blok_read' | 'blok_describe' | 'blok_execute', each
//   { name, description, inputSchema, outputSchema }, with `handle` added (x-mcp-header "Blok-Handle").
```

Their inputs, per 06 §3.7 and §3.5:

- `blok_read`: `{ handle } & ViewArgs` → `DocumentView`.
- `blok_describe`: `{ handle, tool?, command? }` → `AgentContract | ContractSlice`. With no args it returns the index.
- `blok_execute`: `{ handle, commands: AgentCommand[]; expectRevision?: string }` → MCP output, verbatim from 06 §3.7:

```ts
AgentResult & { delivery: { durable: boolean; pending: boolean; serverSequence: string | null; savedVersion: string | null } }
```

`savedVersion` is set in stored mode. `serverSequence` is set in live mode on a journal.

**Lifecycle tools** — written by 04:

```jsonc
// blok_list_documents
"inputSchema": { "type": "object", "additionalProperties": false,
  "properties": {
    "query":  { "type": "string", "maxLength": 200 },
    "cursor": { "type": "string" },
    "limit":  { "type": "integer", "minimum": 1, "maximum": 100, "default": 25 } } }
"outputSchema": { "type": "object", "required": ["documents"],
  "properties": {
    "documents": { "type": "array", "items": { "type": "object", "required": ["id"],
      "properties": { "id": { "type": "string" }, "title": { "type": ["string", "null"] },
                      "live": { "type": "boolean" } } } },
    "nextCursor": { "type": ["string", "null"] },
    "supported":  { "type": "boolean" } } }   // false when the source cannot list

// blok_open
"inputSchema": { "type": "object", "additionalProperties": false, "required": ["documentId"],
  "properties": {
    "documentId": { "type": "string", "minLength": 1, "maxLength": 512 },
    "mode":  { "enum": ["auto", "live", "stored"], "default": "auto" },
    "write": { "type": "boolean", "default": false },
    "view":  { "$ref": "#/$defs/ViewArgs" } } }   // optional first read
"outputSchema": { "type": "object", "required": ["handle", "mode", "write", "expiresAfterIdleMs"],
  "properties": {
    "handle": { "type": "string" },
    "mode":   { "enum": ["live", "stored"] },
    "write":  { "type": "boolean" },          // false if the room or ticket is read-only
    "durability": { "enum": ["acknowledged", "best-effort", "saved-on-execute"] },
    "expiresAfterIdleMs": { "type": "integer" },
    "contractRevision": { "type": "string" }, // AgentContract.revision
    "view": { "$ref": "#/$defs/DocumentView" } } }

// blok_close
"inputSchema": { "type": "object", "additionalProperties": false, "required": ["handle"],
  "properties": { "handle": { "type": "string", "x-mcp-header": "Blok-Handle" } } }
"outputSchema": { "type": "object", "required": ["closed", "unsavedBatches"],
  "properties": { "closed": { "type": "boolean" },
                  "unsavedBatches": { "type": "integer" },      // non-zero = work not acknowledged
                  "hostRecordLags": { "type": "boolean" } } }   // live mode on a journal (§3.6)

// Lifecycle tool errors: isError: true, structuredContent = { "error": AgentError } (06 §3.2)
```

The JS API for embedding:

```ts
export interface BlokMcpOptions {
  transport: { kind: 'stdio' } | { kind: 'http'; listen: string; public?: boolean };
  auth: { kind: 'none' } | { kind: 'oauth'; issuer: string; audience: string; jwksUrl: string };
  sync?: { url: string; origin?: string };                     // absent = no live mode
  tickets?: { kind: 'secret'; secret: string } | { kind: 'url'; url: string; hostToken: string };
  authorize?: (principal: string, documentId: string, write: boolean) => Promise<boolean>;
  /** Builds the session's actor. The ticket `user` must equal the returned `id`. */
  agentActor?: (principal: string, clientName: string) => AgentActor;
  source?: { kind: 'endpoint'; url: string; endpointAuth: string; list?: string }
         | { kind: 'files'; dir: string };
  /** Host custom tool descriptions, as `--manifest <file>` loads them. */
  manifest?: BlokCustomToolsFile;
  /** 'page-map' turns on headless page.rename / page.setIcon (06 §10.1 B). Default off. */
  pageTitles?: 'off' | 'page-map';
  /** Same shape as `--manifest-overrides <file>`. */
  overrides?: ManifestOverrides;
  /** Only for block types missing from the manifest. */
  richTextFields?: Record<string, string[]>;
  schema?: 'envelope' | 'full';                                // default 'envelope'
  handleIdleMs?: number;
  maxHandlesPerPrincipal?: number;
}
export function createBlokMcpServer(options: BlokMcpOptions): { start(): Promise<void>; stop(): Promise<void> };
```

`AgentActor`, `ManifestOverrides` and `BlokCustomToolsFile` are hand-copied into `packages/mcp/types/index.d.ts` from 06 §3.5, §3.6 and `types/tool-manifest.d.ts`, since that file may not import from `src/`. A drift test pins the copies.

### 5.2 Config (CLI flag / env)

`--http` / `BLOK_MCP_HTTP`, `--public`, `--auth none|oauth`, `--oauth-issuer`, `--oauth-audience`, `--oauth-jwks`, `--sync-url` / `BLOK_SYNC_URL`, `--origin` / `BLOK_MCP_ORIGIN`, `BLOK_SECRET`, `--ticket-url` / `BLOK_TICKET_URL` + `BLOK_MCP_HOST_TOKEN`, `--source endpoint:<url>|files:<dir>`, `BLOK_DOC_ENDPOINT_AUTH`, `--manifest <file>` (a `BlokCustomToolsFile`), `--manifest-overrides <file>`, `--page-titles off|page-map`, `--rich-text-fields` / `BLOK_RICH_TEXT_FIELDS` (same JSON as the server's; only for types missing from the manifest), `--schema envelope|full`, `--handle-idle-ms`, `--max-handles`, `--authorize <module|url>`. As in the server, a flag wins over its env var (`packages/server/README.md:220`).

### 5.3 Interfaces I consume

All settled by 06. Each line names the 06 section.

**From 01:**

- **A1.** `createStoreAgentSession({ store, tools, contract, actor, ports })` for live mode, and `createDocumentAgentSession({ document, tools, contract, actor, ports })` with `output()` for stored mode (06 §3.5, C1).
- **A2.** `AgentSession.read(ViewArgs): Promise<DocumentView>` (06 §3.3).
- **A3.** `AgentResult` with `changed: ChangedSet` and `lastRange` (06 §3.2, C8). Presence uses `changed`.
- **A4.** `AgentError` and the `AgentErrorCode` union, including 04's surface codes (06 §3.2).
- **A5.** Headless sanitize and HTML → segments run on parse5 through the ports in `src/view/agent-runtime.ts` (06 04-Q6, §3.8).
- **A6.** Attribution: `StoreApplier` and `JsonApplier` stamp `lastEditedBy` / `lastEditedAt` with `actor.id` (06 C3).
- **A7.** `history.undo`: `COMMAND_UNAVAILABLE` from `StoreApplier`; snapshot restore from `JsonApplier` (06 C11).
- **A8.** `expectRevision`: live Node = a counter over `onAnyUpdate`; stored = a canonical-JSON hash (06 04-Q4, R2-04-1).
- **A10.** `APPLY_FAILED` from `StoreApplier` when a live apply throws (06 R2-01-2).
- **A11.** `doc.setTitle` / `doc.setIcon`, the `setPageField` edit, `OutputData.page`, and `doc.read` returning `page` (06 §10.1 A).
- **A12.** A session hook to open a target document for headless `page.rename` / `page.setIcon` (06 §10.1 B, §11 01-14).
- **A9.** `ToolRuntimeRegistry` for built-in tools, importable in Node without tool classes (06 C10, 02 revision 12).

**From 02:**

- **B1.** `buildToolManifest(snapshot, overrides)`, pure, buildable in Node from `BUILT_IN_BLOCK_DESCRIPTIONS` (06 §3.6, 04-Q9).
- **B2.** `richTextFields` in each manifest entry (06 04-Q10).
- **B3.** `available` on every command entry, computed by `buildAgentContract` for the runner (06 R3-1). No built-in action is `runtime: 'editor'`.
- **B4.** A JSON description file format for host custom tools, loaded with `--manifest` (06 02-Q8).
- **B5.** `ToolRuntime.normalize` for the table, before table writes ship in live mode (06 C17).

**From 03:**

- **C1.** `renderAgentTools` in `src/agent/render-tools.ts` with `format: 'mcp'`, `handle`, `runtime` (06 §3.7).
- **C2.** The browser draws a participant whose awareness carries `agent` as an agent (badge, "for <name>") (06 04-Q14).

---

## 6. Testing strategy (TDD)

Each item below starts as a failing test.

**Law tests** (`test/unit/architecture/`):

1. `mcp-tools-from-renderer-law.test.ts`: the MCP server's `blok_read`, `blok_describe` and `blok_execute` equal `renderAgentTools(contract, { format: 'mcp', handle: true })` for the same contract. Every command name in the rendered `blok_execute` schema exists in `contract.commands` with `available: true`, and no unavailable command appears. It fails if 04 adds, drops or re-renders a command.
2. `mcp-stdout-law.test.ts`: start the stdio bin, call `console.log` from bundled core (inject one log), and assert stdout holds only newline-delimited JSON-RPC.
3. Extend `published-types-no-src-refs.test.ts` coverage to `packages/mcp/types/` (no `../src` specifiers).
4. Update `view-entry-law.test.ts`: `src/mcp/` may import from `src/view/`; no other module may import from `src/mcp/`.

**Unit** (`test/unit/mcp/`):

- Handle registry: principal binding, idle expiry, cap, unknown handle → `UNKNOWN_HANDLE`.
- Mode resolution: `auto` → live when a sync URL is set; `stored` refused with a sync URL.
- Stored session against a fake source: save per batch with `session.output()`; stale version → `DOCUMENT_CHANGED` and reload; `history.undo` restores the snapshot and saves with `ifVersion`; the `files` source's atomic write.
- Ticket minting: `user` equals `actor.id`, never the human's id; `doc` claim set; `write` follows the scope. A `ticketUrl` ticket whose `user` differs from `actor.id` → `FORBIDDEN`.
- Live `history.undo` → `COMMAND_UNAVAILABLE`.
- Error mapping table from §3.5, driven by a fake provider status and rejection stream. Every error is an `AgentError` with a code from the 06 union.
- Durability: `delivery.durable: true` only after the outbox drains; timeout → `delivery.pending: true`.
- Overrides: an action hidden by `--manifest-overrides` is absent from the contract and refused at execute with `UNKNOWN_COMMAND` (06 R2-03-7).
- No `DURABILITY_TIMEOUT` anywhere: a timed-out journal wait gives `ok: true` with `delivery.pending: true`.
- Pre-session errors: `blok_execute` with an unknown handle returns `ok: false` with no `revision`; `blok_read` returns the `{ error }` branch.
- Live `APPLY_FAILED` (a store method made to throw mid-apply): the handle goes read-only, and the next `blok_execute` returns `READ_ONLY`.
- `agentCursor`: set after a batch from `lastRange`, block-level without it, `null` after `blok_close` and after idle expiry.
- Page fields: `doc.setTitle` in live mode writes `store.page`; in stored mode it writes `OutputData.page` and saves.
- `--page-titles`: off → `page.rename` is `available: false`; `page-map` → the target document opens under the same principal checks and gets the title.
- `--manifest` rejects a file that is not a valid `BlokCustomToolsFile`.

**Node integration against the real C# host** (`test/unit/server-conformance/mcp-agent-participant.test.ts`, behind the existing `BLOK_CONFORMANCE_SERVER` gate; `startServer` from `test/unit/server-conformance/run-against.ts`, 06 05-Q12):

- An agent session and a real `createCollabProvider` client join one document.
- An agent batch inserts a paragraph with bold text. The second client sees a formatted `Y.XmlText` with a bold attribute, not an HTML string.
- An agent `block.move` keeps the block's Y.Map identity while the other client types inside it. Both edits survive.
- Frame 107 maps the agent's client id to `actor.id`, distinct from the human's.
- The journal history lists `actor.id` in `actors` (`packages/server/README.md:353-361`). Saved `lastEditedBy` on touched blocks equals `actor.id`.
- Live open before sync completes never returns an empty view.
- A `write: false` ticket → `READ_ONLY`, and the batch is reported not saved.
- The second client sees the agent's `agentCursor` and its `agent.via: 'mcp'` field.

**E2E** (Playwright, with the playground from `yarn serve`): one browser tab and one `blok-mcp` process on the same document. The tab sees the agent's participant row, its `blockId` presence, and its inserted blocks. Locators are role or test id only, per repo rules.

**Evals** are 05's. 05 adds live and stored lifecycle tasks with the pass criterion "nothing reported durable that was not acked" (06 04-Q16). They run on manual dispatch only, with token caps (decided D3).

---

## 7. Open questions for other specs

All of 04's earlier questions are answered by 06 §2. They are listed here as resolved, so other specs can still cite `04-Qn`.

1. **Resolved (06 04-Q1, C1).** Both: `JsonApplier` over `OutputData` for stored mode, `StoreApplier` over `DocumentStore` for live mode. A move stays a move.
2. **Resolved (06 04-Q2).** One `AgentError` shape and one `AgentErrorCode` union (06 §3.2).
3. **Resolved (06 04-Q3).** Yes, `AgentResult.changed`.
4. **Resolved (06 04-Q4).** `expectRevision` is an opaque counter over `DocumentStore.onAnyUpdate`, not a state vector. Prefer `expectText` in busy rooms.
5. **Resolved (06 04-Q5).** Stored: yes, snapshot restore. Live: `COMMAND_UNAVAILABLE` in v1.
6. **Resolved (06 04-Q6).** Yes, `htmlToSegmentsNode` on load; sanitize on `src/view/sanitize.ts` (parse5).
7. **Resolved, then changed in round 2 (06 §7, §11).** The C# Jint path ships in v1 as `IBlokAgentExecutor` (decided D1, D1a). It is not an MCP surface. Until a server spec exists, 01 and 04 co-own the C# server work.
8. **Resolved, then changed in round 2 (06 §10.1).** Page fields ship in v1 in both modes (decided D6): `doc.setTitle` / `doc.setIcon`, live via `DocumentStore.page`, stored via `OutputData.page`.
9. **Resolved (06 04-Q9).** Yes. Built-ins in Node; custom tools via `--manifest <file>`.
10. **Resolved (06 04-Q10).** Yes, `richTextFields` per manifest entry. The config list covers only types missing from the manifest.
11. **Resolved, then changed in round 2 (06 §10.2).** 02 adds `inputFields`. The agent publishes `agentCursor`; browsers map it (decided D6).
12. **Resolved (06 04-Q12, R3-1).** Availability is computed by `buildAgentContract`; every renderer lists only available commands.
13. **Resolved (06 04-Q13).** `renderAgentTools` in `src/agent/render-tools.ts`.
14. **Resolved (06 04-Q14).** 03 draws the agent marker and "for <name>". The human's undo stays free of agent edits, because remote origins are untracked.
15. **Resolved (06 04-Q15, C2).** One `blok_execute`. Schema mode `'envelope'` vs `'full'` is measured by 05's eval; both surfaces use the same mode.
16. **Resolved (06 04-Q16).** 05 adds live and stored lifecycle tasks.

17. **Resolved (06 R2-04-Q17).** `BlokCustomToolsFile` in `types/tool-manifest.d.ts`. The Jint ops take the same file.
18. **Resolved (06 R2-04-Q18).** The renderer emits the `{ error: AgentError }` branch. 04 does not wrap.

---

## 8. Out of scope

- An MCP server inside the C# host, and an HTTP route for the C# agent path. The C# path ships in v1 as a service API only (decided D1, D1a; 06 §7.3). MCP stays Node-only.
- Any change to the sync protocol, the ticket format, or the `/edit` wire. The C# room ops 06 §7.4 adds are internal.
- Uploading files or images from the agent. Media is set by URL only (decided D6, cut by the user).
- Undo in live rooms, Node or C# (decided D6, cut by the user).
- Custom tool action handlers outside the browser, in Node or Jint (decided D6: cut, user can revisit).
- A Docker image for the MCP server (decided D6: cut, user can revisit).
- View-state control (decided D6: cut, user can revisit).
- MCP resources, prompts and subscriptions. Tools only. A `subscriptions/listen` stream for "the document changed" can come later.
- A document index. Listing relies on the host's `source.list`, or on the `files` directory.

---

## Issues with 06

None open (closed in 06 round 3).
