# Node MCP server: behavioural spec for a C# port

Date: 2026-11-06. Source: `src/mcp/` at `07b2326d` (main). Package: `packages/mcp` (`@bloklabs/mcp` 2.0.0).

Every claim cites `file:line`. Paths are relative to the repo root. "Measured" means I ran it in this session. "Unverified" means I could not check it.

How the numbers and schemas here were produced:

- **Line counts.** I bundled `src/mcp/index.ts` with esbuild (`--metafile`, with `@modelcontextprotocol/*` and `ws` external) and grouped every input file by folder. A metafile lists only modules reached through runtime imports, so `import type` files are left out.
- **Schemas and instructions.** I bundled a small script that calls `assembleMcp({ transport: stdio, auth: none, schema })` with default options and dumped `tools` and `instructions` (measured). The `blok_read` / `blok_describe` / `blok_execute` schemas are generated from the agent contract. The contract changes with `pageTitles`, `sync`, `uploads`, `comments`, `manifest` and `overrides` (`src/mcp/contract.ts:29-54`), so the schemas change with them.
- **HTTP probes.** I started `createBlokMcpServer` over HTTP on `127.0.0.1:47811` and sent real requests (measured; results in §4.2).

---

## 1. Module map

### 1.1 Size: shell vs engine

| Group | Files | Lines | Source |
|---|---|---|---|
| MCP shell: `src/mcp/**` (all files, `wc -l`) | 35 | 4,078 | `find src/mcp -name '*.ts' \| xargs wc -l` |
| MCP shell reached at runtime (metafile) | 32 | ~4,046 | metafile; leaves out `session.ts` (types only), `ws-module.d.ts`, `stdout-guard.ts` (separate entry) |
| Engine: first-party code outside `src/mcp` reached at runtime | 256 | ~65,365 | metafile total 288 files / 69,411 lines, minus the shell rows |
| npm code inlined into the bundle | n/a | n/a | `yjs`, `y-protocols`, `lib0` (28 files), `nanoid` (metafile) |

Metafile line counts add about 1 per file, because they count `split('\n')`.

The largest engine groups (metafile, lines): `src/markdown` 8,067; `src/shared/agent` 7,489; `src/shared/database` 7,070; `src/html` 6,885; `src/components/modules/yjs` 5,560; `src/components/modules/collaboration` 5,060; `src/shared/tool-descriptions` 4,013; `src/shared/tool-actions` 3,927; `src/shared/table` 2,057; `src/shared/embed-registry.ts` 1,707; `src/shared/image` 1,590; `src/view/sanitize.ts` 1,479; `src/components/migration` 1,039.

The published bundle `packages/mcp/dist/mcp.mjs` is 1,886,518 bytes (`ls -la`). It is built by `scripts/build-mcp.mjs:12-38`. The externals are `node:*`, `@modelcontextprotocol/server*` and `ws` (`:31`). Everything else is inlined (`ssr.noExternal: true`, `:36`). `VERSION` is defined from `packages/mcp/package.json` (`:7`, `:37`).

### 1.2 Shell files (`src/mcp`)

| File | Lines | Role |
|---|---|---|
| `index.ts` | 144 | `createBlokMcpServer`, `runCli`, shutdown signals, JSON file loading |
| `config.ts` | 305 | CLI parsing (`parseMcpArgs`), `checkOptionSafety`, `McpConfigError` |
| `options.ts` | 54 | `BlokMcpOptions`, `McpUploads`, `DEFAULTS` |
| `server.ts` | 215 | `assembleMcp`: wires contracts, opener, handles, sweeper, dispatcher, stop drain |
| `sdk-server.ts` | 190 | Builds the SDK `Server`: tools/list, tools/call, prompts, elicitation |
| `http.ts` | 232 | Streamable HTTP over `node:http`; Origin/Host gate; OAuth gate; 413 |
| `dispatcher.ts` | 305 | Per-tool argument checks, scopes, handle use, error-to-result mapping |
| `tools.ts` | 149 | The 3 lifecycle tool schemas, plus the 3 core tools from `renderAgentTools` |
| `contract.ts` | 63 | Builds the stored and live `AgentContract` via `createHeadlessAgentSetup` |
| `instructions.ts` | 18 | `instructions` text |
| `prompts.ts` | 70 | Ask AI skills as MCP prompts |
| `handles.ts` | 132 | `HandleRegistry`: ids, per-principal cap, per-handle queue, idle sweep |
| `opener.ts` | 168 | `open`, `list`, `createPage`; authorize hook; mode resolution |
| `mode.ts` | 22 | `resolveMode` |
| `stored-session.ts` | 96 | Stored `HandleSession`: load, execute, save, reload on failure |
| `session.ts` | 39 | Types: `HandleSession`, `Delivery`, `Durability`, `UnavailableCommand` |
| `errors.ts` | 44 | `McpSurfaceError`, MCP retryable set, `NO_DELIVERY`, `isWriteBatch` |
| `page-titles.ts` | 47 | Headless `page.rename` / `page.setIcon` target port |
| `actor.ts` | 22 | `safeClientName`, `defaultAgentActor`, `agentPresenceName` |
| `uploads.ts` | 24 | Adapts the host uploader to the engine's `FileUploaderService` |
| `local-files.ts` | 119 | Safe file reader under `uploads.root` |
| `custom-tools-file.ts` | 58 | Validates `--manifest` and `--manifest-overrides` JSON |
| `stdout-guard.ts` | 9 | Sends `console.log/info/debug` to stderr |
| `ws-module.d.ts` | 16 | Ambient types for `ws` |
| `auth/oauth.ts` | 224 | JWT access-token verifier, JWKS cache, `principalOf` |
| `auth/authorize.ts` | 70 | `--authorize` hook: webhook or ES module |
| `auth/tickets.ts` | 101 | Room tickets: local HS256 signing, or the host ticket URL |
| `sources/types.ts` | 35 | `DocumentSource` interface, `assertDocumentShape` |
| `sources/endpoint.ts` | 156 | HTTP document endpoint source |
| `sources/files.ts` | 332 | Folder-of-JSON source: locks, atomic save, case and symlink rules |
| `live/open-live.ts` | 190 | Joins a room, guards ticket revocation, builds the live session |
| `live/live-session.ts` | 183 | Live `HandleSession`: acks, delivery, read-only latch, close summary |
| `live/presence.ts` | 84 | Awareness fields the agent publishes |
| `live/version-history.ts` | 143 | HTTP client for the sync server's `/history` routes |
| `live/node-socket.ts` | 19 | `ws` socket factory with an `Origin` option |

(Line counts from `wc -l`, this session.)

### 1.3 What the shell imports from outside `src/mcp` (runtime imports only)

These are the engine entry points a port must reproduce or host.

| Import | Used at | What the shell uses it for |
|---|---|---|
| `src/view/agent-runtime` `createHeadlessAgentSetup` | `contract.ts:1,41-54` | Builds the stored (`runtime:'node'`) and live (`runtime:'node-live'`) contracts and the tool runtime registry |
| `src/view/agent-runtime` `createHeadlessPorts` | `server.ts:4,84-110` | Agent ports: sanitize, rich-text fields, `openPageDocument`, `createPageDocument` |
| `src/view/agent-runtime` `loadStoredDocument` | `opener.ts:7,79` | Turns raw stored JSON into `OutputData` (HTML rich fields become segments) |
| `src/shared/agent/document-session` `createDocumentAgentSession` | `opener.ts:3,80-90` | The stored-mode agent (read / describe / execute / output / revision) |
| `src/components/modules/agent/store-session` `createStoreAgentSession` | `live/open-live.ts:9,162-175` | The live-mode agent over a Yjs store |
| `src/components/modules/collaboration/headless-session` `openHeadlessRoom` (+ `HeadlessRoomTimeoutError`, `HeadlessRoomTerminalError`) | `live/open-live.ts:1-7,146-158` | Joins a sync room; outbox, acks, protocol v1/v2, end events |
| `src/components/modules/yjs/serializer` `YBlockSerializer` | `live/open-live.ts:10,149` | Yjs to blocks |
| `src/view/rich-text-node` `htmlToSegmentsNode` | `live/open-live.ts:13,149` | HTML to segments in Node |
| `src/components/modules/collaboration/presence` `isPresenceColor`, `presenceColorFor` | `live/presence.ts:2,37` | Presence colour |
| `src/shared/agent/tool-call` `parseToolCall`, `toolErrorAnswer`, `unknownArgument` | `dispatcher.ts:4` | Parses core tool calls; shapes error answers |
| `src/shared/agent/model-answer` `modelAnswer` | `dispatcher.ts:3,261` | Trims a batch result to what the model sees |
| `src/shared/agent/errors` `AgentFailure`, `failure` | `dispatcher.ts:2`, `opener.ts:4`, `page-titles.ts:2`, `local-files.ts:6`, `sdk-server.ts:7` | Model-fixable errors |
| `src/shared/agent/approval` `approvalKey`, `describeShareChange`, `plainLine` | `sdk-server.ts:6` | Elicitation key and question text |
| `src/agent/render-tools` `renderAgentTools` | `tools.ts:4,45` | The `blok_read` / `blok_describe` / `blok_execute` schemas |
| `src/agent/result-schemas` `orError` | `tools.ts:5` | Output schema wrapper |
| `src/agent/guidance` `pagesInsert`, `SHARED_RULES`, `PAGE_CREATE_RULE` | `tools.ts:3`, `instructions.ts:2` | Description and instructions text |
| `src/shared/skills` `AGENT_SKILLS`, `skillPrompt` | `prompts.ts:5` | Prompt list and text |
| `src/shared/custom-tools-file` `readCustomToolsFile` | `custom-tools-file.ts:1` | Validates the `--manifest` file |
| `src/shared/mint-id` `mintId` | `opener.ts:6,119` | New page document id |
| `src/components/utils/version` `getBlokVersion` | `index.ts:6,54,84` | `serverInfo.version`. It returns the build-time `VERSION` (`src/components/utils/version.ts:15-18`) |
| `src/components/utils/access-pass` `readTicketClaims` | `auth/tickets.ts:3,77` | Decodes a ticket payload without checking it |
| `packages/server/src/ticket` `blokTicket` | `auth/tickets.ts:1,36` | Signs an HS256 ticket |
| `src/shared/tool-actions/services` (type), `src/shared/tool-actions/runtime` (type) | `uploads.ts:2`, `contract.ts:5` | Types only |
| npm `@modelcontextprotocol/server` 2.4.0 | `sdk-server.ts:1`, `http.ts:3`, `oauth.ts:2`, `prompts.ts:1`, `index.ts:2` | Protocol, both eras, stdio, HTTP handler, bearer gate |
| npm `ws` 8.22.0 | `live/node-socket.ts:1` | WebSocket client with an `Origin` option |

The full external import list was produced by grepping the `from '...'` lines in `src/mcp` this session.

### 1.4 Context: the C# server already runs this engine (not a recommendation)

- The C# server references Jint 4.17.0 (`packages/server/dotnet/Blok.Server/Blok.Server.csproj:42`).
- It runs a generated JS bundle, `packages/server/dotnet/Blok.Server/Generated/blok-server-runtime.js`. That bundle is built from `src/view/server-runtime.ts` (`scripts/build-server-runtime.mjs:38`).
- That entry imports `createDocumentAgentSession` and `createHeadlessAgentSetup` / `loadStoredDocument` (`src/view/server-runtime.ts:9,17`). These are the same engine pieces stored-mode MCP uses.
- It exposes operations through `invoke(operation, inputJson)` (`src/view/server-runtime.ts:722`). Among them are `agentExecute`, `agentPlanHost`, `agentPagesNeeded`, `schema` and `manifest` (grep of `case '…'` in that function).
- The C# executor interface has `ExecuteAsync`, `GetContractAsync`, `GetRoomContractAsync`, `OpenSession` and `ExecuteInRoomAsync` (`packages/server/dotnet/Blok.Server/Agent/IBlokAgentExecutor.cs:13-59`).
- Not checked: whether `server-runtime.ts` exposes `renderAgentTools`, `modelAnswer`, `parseToolCall`, `AGENT_SKILLS` or the live store session. A planner should check these before assuming reuse (unverified).

---

## 2. Public MCP surface

### 2.1 Server identity, capabilities, protocol

- **Server info.** `name: 'blok-mcp'`, `version: getBlokVersion()` (`sdk-server.ts:132`). Over HTTP, `initialize` answered `serverInfo: {name:"blok-mcp", version:"9.9.9"}` with `VERSION` defined as `9.9.9` (measured).
- **Capabilities.** `{ tools: {}, prompts: {} }` (`sdk-server.ts:136`). Measured `initialize` result: `"capabilities":{"tools":{},"prompts":{}}`. No resources, no logging, no completions.
- **Instructions.** Sent on initialize (`sdk-server.ts:132`; measured).
- **Handlers.** The server registers only `tools/list`, `prompts/list`, `prompts/get` and `tools/call` (`sdk-server.ts:137-187`). It uses the low-level `Server.setRequestHandler`, not `McpServer.registerTool`. So the SDK does **not** validate tool input against `inputSchema`. That SDK check lives only in `McpServer`'s own `tools/call` path (`node_modules/@modelcontextprotocol/server/dist/mcp-oHn3ureC.mjs:1603-1612`). All argument checks are Blok's own (§2.4).
- **Output projection.** The `tools/call` result goes through `server.projectCallToolResult(result, tool.outputSchema)` (`sdk-server.ts:182-186`). In the SDK, this is identity for object `structuredContent` on the 2026 era. On the 2025 era it wraps non-object content (SDK doc comment, `mcp-oHn3ureC.mjs:1243-1246`).
- **Output schema enforcement on the client.** A `structuredContent` that breaks `outputSchema` is rejected by the real SDK client with `InvalidParams` (`test/unit/mcp/sdk-server.test.ts:288-299`).
- **Protocol versions.**
  - SDK `LATEST_PROTOCOL_VERSION = '2025-11-25'`.
  - `SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25','2025-06-18','2025-03-26','2024-11-05','2024-10-07']`.
  - The SDK also serves the "modern" revision `2026-07-28` (grep of SDK dist).
  - `serveStdio` decides the era on the opening exchange and pins one server instance per connection (`server/dist/stdio.mjs:270-283`).
  - `createMcpHandler` serves 2026-07-28 and "by default falls back to old-school stateless serving for 2025-era traffic" (`server/dist/index.mjs:1069-1072`).
  - Blok's tests run both eras (`ERAS = ['legacy','modern']`, `test/unit/mcp/unlock-elicitation.test.ts:20`; `sdk-server.test.ts:113`).
  - Over HTTP, an `initialize` with `protocolVersion: '2025-06-18'` was answered with `"protocolVersion":"2025-06-18"` (measured).
- **Per-request metadata (2026 era).** Client name and capabilities are read from the request envelope:
  - `_meta['io.modelcontextprotocol/clientInfo'].name` and `_meta['io.modelcontextprotocol/clientCapabilities']`.
  - On a 2025-era client without an envelope, they fall back to the values sent in `initialize` (`sdk-server.ts:148-161`).
  - Key strings are from the SDK constants (grep).
- **`x-mcp-header`.**
  - Every handle-taking tool marks `handle` with `'x-mcp-header': 'Blok-Handle'` (`tools.ts:139`; `src/agent/render-tools.ts:212`).
  - The SDK maps these to `Mcp-Param-*` headers (`MCP_PARAM_HEADER_PREFIX = "Mcp-Param-"`, `server/dist/src-DdvbAHrR.mjs:4553-4555`).
  - The README tells hosted deployments to route on `Mcp-Param-Blok-Handle` (`packages/mcp/README.md:147-148`).
- **C# SDK support.** Whether the C# MCP SDK supports the 2026-07-28 era, `inputRequired` round trips, per-request `_meta` client info, or `x-mcp-header` is an **open decision**. I did not check it.

### 2.2 Tools

`tools/list` returns these six, in this order (`tools.ts:51-148`): `blok_list_documents`, `blok_open`, `blok_close`, `blok_read`, `blok_describe`, `blok_execute`.

#### `blok_list_documents` (`tools.ts:52-74`)

The description is a fixed string (`tools.ts:54`).

Input:
```json
{ "type": "object", "additionalProperties": false,
  "properties": {
    "query": { "type": "string", "maxLength": 200, "description": "Matches part of a document id or title. It does not search the text inside documents." },
    "cursor": { "type": "string" },
    "limit": { "type": "integer", "minimum": 1, "maximum": 100, "default": 25 } } }
```
Output: `orError({ type:'object', required:['documents'], properties:{ documents: DOCUMENTS_SCHEMA, nextCursor:{type:['string','null']}, supported:{type:'boolean'}, queryMatched:{type:'boolean'} } })`.

`DOCUMENTS_SCHEMA` is `{type:'array', items:{type:'object', required:['id'], properties:{id:string, title:[string,null], live:boolean}}}` (`tools.ts:22-29`).

#### `blok_open` (`tools.ts:75-131`)

The description is built from sentences (`tools.ts:77-90`):
- One sentence is added only when `pagesInsert(contract)` is true: `'A page block you insert gets a new, empty sub-page document, under the pageId the insert result shows.'` (`tools.ts:83`).
- The idle sentence says `"<n> minutes"` when `handleIdleMs/60000` is a whole number, else `"<round(ms/1000)> seconds"` (`tools.ts:46-49,88`).

Input:
```json
{ "type": "object", "additionalProperties": false,
  "properties": {
    "documentId": { "type": "string", "minLength": 1, "maxLength": 512 },
    "query": { "type": "string", "maxLength": 200, "description": "Without documentId: the exact id or title of the document to open." },
    "mode": { "enum": ["auto", "live", "stored"], "default": "auto" },
    "write": { "type": "boolean", "default": false },
    "view": "<blok_read inputSchema with 'handle' removed from properties and required>" } }
```
(`view` comes from `readArguments`, `tools.ts:32-39,99`.)

Output: `orError({ type:'object', anyOf:[{required:['handle','mode','write','expiresAfterIdleMs']},{required:['documents']}], properties:{...} })` (`tools.ts:102-130`):
- `handle` string; `documentId` string; `title` [string,null]
- `mode` enum live|stored; `write` boolean
- `durability` enum acknowledged|best-effort|saved-on-execute
- `expiresAfterIdleMs` integer; `contractRevision` string; `exists` boolean
- `unavailableCommands` array of `{name, reason}`, where `reason` is enum **`['runtime','service']`** (`tools.ts:116-123`)
- `view` object; `documents`; `nextCursor`; `supported`; `queryMatched`

**Mismatch to keep in mind.** `UnavailableCommand.reason` is typed `'runtime' | 'service' | 'host'` (`session.ts:21-24`). The output schema enum leaves out `'host'` (`tools.ts:121`). `refusedHere` copies `here?.unavailableReason ?? 'runtime'` from the live contract (`live/open-live.ts:125-137`). The engine has a `'host'` reason (`src/shared/agent/errors.ts:78-79`). If a live handle ever lists a `'host'` reason, the output would fail the client's schema check. Whether that can happen is **unverified**.

#### `blok_close` (`tools.ts:132-146`)

Input: `{type:'object', additionalProperties:false, required:['handle'], properties:{handle:{type:'string','x-mcp-header':'Blok-Handle'}}}`.

Output: `orError({type:'object', required:['closed','unsavedBatches'], properties:{closed:boolean, unsavedBatches:integer, hostRecordLags:boolean}})`.

#### `blok_read`, `blok_describe`, `blok_execute` (generated: `src/agent/render-tools.ts:264-273`, called at `tools.ts:45`)

Descriptions (`render-tools.ts:75-79`):
- `blok_read`: "Read the document as a tree of blocks with ids, types and text. Read before you edit, and again after a STALE error."
- `blok_describe`: "Look up what you can do. With no arguments it lists tools and commands. Pass { tool } or { command } to get the argument schema."
- `blok_execute`: under `schema: 'mixed'` it uses `mixedExecuteDescription`, which names the common commands (`render-tools.ts:166-170`). Otherwise it uses the fixed text.

Inputs (from the default-options dump):
- `blok_read`: the `doc.read` command's `args` schema plus `handle` (`render-tools.ts:81-87,202-215`). Measured default:
  ```json
  {"type":"object","properties":{
    "rootId":{"oneOf":[{"type":"string","minLength":1,"description":"A block id, or \"$\" plus the ref of a block an earlier command created."},{"type":"null"}]},
    "depth":{"type":"integer","minimum":0},
    "ids":{"type":"array","items":{"type":"string","minLength":1,"description":"…same…"}},
    "detail":{"enum":["outline","full"]},
    "limit":{"type":"integer","minimum":1,"maximum":1000},
    "cursor":{"type":"string"},
    "textLimit":{"type":"integer","minimum":0},
    "handle":{"type":"string","x-mcp-header":"Blok-Handle"}},
   "required":["handle"],"additionalProperties":false}
  ```
- `blok_describe` (measured): `{"type":"object","properties":{"tool":{"type":"string"},"command":{"type":"string"},"handle":{"type":"string","x-mcp-header":"Blok-Handle"}},"additionalProperties":false,"required":["handle"]}`.
- `blok_execute`: `{type:'object', properties:{commands:{type:'array',minItems:1,items}, expectRevision:{type:'string'}, handle}, required:['commands','handle'], $defs?}` (`render-tools.ts:105-112`). `items` depends on `--schema`:
  - `envelope`: `{type:'object', properties:{name:{type:'string',enum:[all available command names]}, args:{type:'object'}, ref:{type:'string'}}, required:['name','args']}` (`render-tools.ts:95-103`). Default contract: 88 names (measured).
  - `full`: `oneOf` with one strict branch per available command, `{name:{const}, args, ref?}`, `additionalProperties:false` (`render-tools.ts:114-140,144-149`). Shared subschemas go to `$defs` under prefixed names.
  - `mixed` (default, `options.ts:45`): full branches for the commands in `COMMON_COMMANDS` that are available, plus one envelope branch for the rest. Repeated subschemas of 100 or more characters are moved to `$defs` (`render-tools.ts:63-66,154-164`). Default measured: 9 full branches (`block.convert, block.delete, block.insert, block.move, doc.setIcon, doc.setTitle, markdown.insert, text.format, text.replace`) plus an envelope with 79 names. `$defs` keys: `block_insert__insertSpec, marks, position, range, parentId, id`.
  - For `full` and `mixed`, the schema size is checked against OpenAI limits (properties 5000, depth 10, enum values 1000). If it is too big, `AgentToolsTooLargeError` is thrown at startup (`render-tools.ts:40-56,172-181,249-251`).
  - Measured JSON sizes for the whole tools array: mixed 56,594 B; envelope 33,645 B; full 370,093 B.
- The SDK requires an object root for every input schema. `buildSdkServer` throws `TypeError('MCP tool input schemas must have an object root.')` otherwise (`sdk-server.ts:128-130`).

Outputs:
- `blok_read`: `orError(doc.read result schema or {type:'object'})` (`render-tools.ts:233-242`). In the default dump the success branch is `{type:'object'}` (measured).
- `blok_describe`: `orError({type:'object'})`.
- `blok_execute`: `EXECUTE_OUTPUT_SCHEMA` = `oneOf[ success+delivery, failure+delivery ]` (`src/agent/result-schemas.ts:58-110`).
  - Success requires `ok:true, revision, results, delivery`. It may have `refs, changed{created,updated,moved,removed,more*}, blocks, moreBlocks, lastRange{blockId,field,start,end}, warnings`.
  - Failure requires `ok:false, error, delivery`. It may have `revision, warnings`.
  - `delivery = {durable:boolean, pending:boolean, serverSequence:string|null, savedVersion:string|null}`, all required (`result-schemas.ts:47-56`).

`orError(success)` is `{type:'object', oneOf:[{allOf:[success,{not:{required:['error']}}]}, {type:'object', properties:{error:AGENT_ERROR_SCHEMA}, required:['error'], additionalProperties:false}]}` (`result-schemas.ts:112-123`).

`AGENT_ERROR_SCHEMA`: `{code, message, commandIndex?, path?, retryable, details?, others?[{code,message,commandIndex?,path?}]}`, required `code, message, retryable` (`result-schemas.ts:8-27`).

### 2.3 Tool result wire shape

Every tool answer is `{ content:[{type:'text', text: JSON.stringify(structuredContent)}], structuredContent, isError }` (`sdk-server.ts:182-186`). The text is the exact JSON of `structuredContent`, so key order matters if a port wants byte-equal text. Measured over HTTP: `{"content":[{"type":"text","text":"{\"documents\":[],\"nextCursor\":null,\"supported\":true}"}],"structuredContent":{"documents":[],"nextCursor":null,"supported":true},"isError":false}`.

Key order produced by the shell:
- `blok_open` success: `handle, mode, write, durability, expiresAfterIdleMs, contractRevision`, then `documentId, title` (only when the document was found by query, with no `documentId` argument), then `exists`, `unavailableCommands`, `view` (each only when set) (`dispatcher.ts:219-230`).
- `blok_close`: `closed: true, unsavedBatches, hostRecordLags` (`dispatcher.ts:287`; summary key order from `stored-session.ts:94` / `live-session.ts:174`).
- `blok_execute`: `modelAnswer(result)` (`dispatcher.ts:261`):
  - `ok` and `warnings` come first, then the other keys in their original order.
  - `refs`, `changed` and `warnings` are dropped when empty.
  - `changed.*` lists and `results[i].removedIds/liftedIds` are capped at 50, with a `more<Key>` count.
  - `delivery` comes last, because sessions spread it last.
  - Source: `src/shared/agent/model-answer.ts:7-73`.

Error answers (`dispatcher.ts:292-303`):
- An `McpSurfaceError` or `AgentFailure` becomes a tool result with `isError: true`.
- For every tool except `blok_execute`: `structuredContent = { error }`.
- For `blok_execute`: `{ ...modelAnswer({ok:false,error,warnings:[]}), delivery: NO_DELIVERY }`, which is `{ ok:false, error, delivery:{durable:false,pending:false,serverSequence:null,savedVersion:null} }` (`src/shared/agent/tool-call.ts:128-135`; `errors.ts:23`).
- A failed batch returned by a session (not thrown) is also `isError: true` (`dispatcher.ts:261`).
- Any other thrown error is re-thrown. The client sees a JSON-RPC `InternalError` (-32603) (`sdk-server.test.ts:277-285`).
- An unknown tool name gives JSON-RPC `InvalidParams` (-32602) `Unknown tool: <name>`. It is checked in `sdk-server.ts:145-147` before the dispatcher; the dispatcher's own `UnknownToolError` maps the same way (`sdk-server.ts:167-170`).

### 2.4 Per-tool validation order (first failure wins)

Shared step 1: refuse unknown arguments for lifecycle tools.
- The accepted keys are `blok_list_documents: query,cursor,limit`; `blok_open: documentId,query,mode,write,view`; `blok_close: handle` (`dispatcher.ts:84-97`).
- Message: `<tool>: unknown field "<k>"; accepted fields: <list>`, with `path: "/<k>"`, code `INVALID_ARGS` (`tool-call.ts:40-46`).
- It reports the first key in object order that is not accepted.

**Core tools** (`blok_read`, `blok_describe`, `blok_execute`) (`dispatcher.ts:238-262`):
1. Scope: `blok.read` for read and describe, `blok.write` for execute. Only when `caller.scopes !== null` (OAuth). Otherwise `FORBIDDEN` "This call needs the <scope> scope.", `details.requiredScope` (`:61-65,99-103`).
2. `handle` must be a non-empty string, or `INVALID_ARGS` "handle must be the string blok_open returned." (`:67-73`).
3. `parseToolCall(name, args minus handle, {pages:false})` (`tool-call.ts:94-125`):
   - `blok_describe`: unknown keys other than `tool` and `command` are refused, then type checks with paths `/tool` and `/command`.
   - A `page` argument on read or execute: if empty or not a string, `INVALID_ARGS`. Otherwise `COMMAND_UNAVAILABLE` "This surface cannot open sub-page documents…" with `path: '/page'`.
   - `blok_execute`: keys other than `commands` and `expectRevision` are refused.
   - `blok_read`: every other key goes to the engine's `doc.read` check.
4. `handles.use(handle, principal)`. A missing handle, or one owned by another principal, gives `UNKNOWN_HANDLE` "No open document has this handle. It may have expired; call blok_open again." (`handles.ts:22-23,62-65`).
5. Inside the handle's queue: `stillAllowed(caller, documentId, write)`, where `write = (name === 'blok_execute')` (`dispatcher.ts:247`). So every execute asks the authorize hook with `write=true`, even a read-only batch on a read-only handle. If the hook says no: `FORBIDDEN` "You no longer have access to this document." (`:165-176`). Without a hook, every call passes (`server.ts:163-164`).
6. Run: read gives `session.read(view)`; describe gives `session.describe(query)`; execute gives `session.execute(batch, {approve?})`. The batch is passed unchecked; the engine validates it (`dispatcher.ts:250-262`).

**`blok_open`** (`dispatcher.ts:178-235`):
1. Unknown arguments (above).
2. `write` present and not boolean: `INVALID_ARGS` "write must be true or false."
3. Scope `blok.write` if write, else `blok.read`.
4. `documentId` present and (not a string, empty, or longer than 512): `INVALID_ARGS` "documentId must be a string of 1 to 512 characters." The length is JS `.length` (UTF-16 units).
5. No `documentId`, and `query` present and not a string: `INVALID_ARGS` "query must be a string."
6. `mode` not in auto/live/stored: `INVALID_ARGS` `mode must be "auto", "live" or "stored".`
7. `view` present and not a plain object: `INVALID_ARGS` "view must be an object of blok_read arguments."
8. No `documentId`: run `findDocument(query)` (needs `blok.read`):
   - Trim the query and lowercase it.
   - List with `limit 25` and the trimmed query.
   - Candidates are all documents (no query), or those whose `id.toLowerCase() === needle`, or whose `title.trim().toLowerCase() === needle`.
   - If the count is not exactly 1, or `nextCursor !== null`, return the listing as a success (`isError: false`) with no handle (`:148-163,200-203`).
9. `handles.assertRoom(principal)`:
   - If shutting down: `SOURCE_UNAVAILABLE` "The server is shutting down."
   - If at the cap: `HANDLE_LIMIT` "You already have <n> open documents. Close one with blok_close." (`handles.ts:37-44`).
10. `opener.open` (§7.1): authorize hook, then `resolveMode`, then the live or stored open.
11. If `view` was given: `session.read(view)`.
12. If the request signal was aborted: `CANCELLED` "The request was cancelled before the document opened." This comes from the shared `failure()`, so `retryable` is true.
13. `handles.add`, which re-checks the room.
14. If any of steps 11-13 throw, the session is closed (errors swallowed) and the error is re-thrown (`dispatcher.ts:231-234`).

**`blok_list_documents`** (`dispatcher.ts:271-275,116-128,139-144`):
1. Unknown arguments.
2. Scope `blok.read`.
3. Types: `limit` must be a number; `query` and `cursor` must be strings. Otherwise `INVALID_ARGS` "limit must be a number; query and cursor must be strings."
4. `limit` is clamped: `min(max(trunc(limit),1),100)`, default 25. A number out of range is clamped, not refused.
5. If `query` was given, there was no cursor, the source can list, and the result is empty: list again without the query and add `queryMatched: false`.

**`blok_close`** (`dispatcher.ts:278-288`):
1. Unknown arguments.
2. Scope `blok.read`.
3. `handle` check.
4. `onHandle(..., write=false, noop)`. This runs `stillAllowed`, so a revoked document answers `FORBIDDEN` and **the handle stays** until the idle sweep removes it.
5. `handles.remove`: deletes the entry first, then waits for the queue.
6. `session.close('closed')`.
7. Answer `{closed:true, ...summary}`.

### 2.5 Prompts (`prompts.ts`)

- `prompts/list` gives one prompt per `AGENT_SKILLS` entry, in array order (`prompts.ts:25-29`; `src/shared/skills.ts:28-45`).
  - Order: `improve, proofread, shorter, longer, simplify, explain, summarize, actionItems, continue`.
  - `description` is the English label.
- Arguments (`prompts.ts:13-22`):
  - `documentId` (required: false).
  - `selection`, only for skills with a selection prompt. It is required when the skill has no caret prompt.
  - `blockId` (required: false). Its description depends on whether the skill has a selection prompt.
- `prompts/get` (`prompts.ts:45-70`):
  - An unknown name gives `ProtocolError InvalidParams` `Unknown prompt: <name>`.
  - An empty string counts as absent for `selection`, `documentId` and `blockId`.
  - Context is `selection` when a selection is given and the skill has a selection prompt. Otherwise it is `caret`.
  - `skillPrompt` gives `"<prompt> Write in the language of the document, and reply in it too."` (`skills.ts:23,54-58`). If the result is undefined: `InvalidParams` `Prompt <name> needs the selection argument.`
  - The text is these parts, joined with `\n\n`, skipping absent ones:
    1. The request.
    2. The context line (`prompts.ts:32-42`). For a selection, `JSON.stringify(selection)` is embedded.
    3. `Work in the Blok document with documentId <JSON>.` (only with a documentId).
    4. `MCP_SKILL_STEPS` (`prompts.ts:9-11`).
  - The result is `{description: label, messages:[{role:'user', content:{type:'text', text}}]}`.

### 2.6 `instructions` text (`instructions.ts:10-18`)

The parts, joined with `\n`:
1. `'How to write rich text in Blok:'`
2. `contract.guidance.general.trim()`
3. `''`
4. `'Rules for editing a Blok document:'`
5. `SHARED_RULES` (`src/agent/guidance.ts:4-13`)
6. `PAGE_CREATE_RULE` only when `pagesInsert(contract)` (`guidance.ts:29,37-38`)
7. `MCP_RULES` (`instructions.ts:5-7`)

Measured default output (2,328 bytes):

```
How to write rich text in Blok:
Rich text is a list of segments: { text, marks? } or { embed, marks? }. A plain string is plain text, HTML tags included.
Marks: bold, italic, underline, strikethrough, code, sup, sub, highlight, color, background, link, and tag:<name> for a custom inline tool. sup and sub cannot share a run.
highlight alone is stored as background "yellow"; with a background, as that background. color and background take a preset: "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red". Hex, rgb and hsl are stored as the nearest preset. A CSS colour name is lowercased and kept, and so is var(--name). Other syntaxes (oklch, lab, hwb, color()) are dropped, as are a transparent colour and a white or dark-grey page background.
A link needs href. With no target or rel it gets target "_blank" and rel "nofollow"; an "#anchor" href gets target "_self". A target or rel you give is kept, but in the editor a host link config replaces both.
Embeds: { equation: { expression } } is inline LaTeX; { page: { id } } mentions a page: id is the pageId in a page block's data, not the block id.
text.format with unset ["*"] clears every mark; "tag:*" clears every custom mark.
markdown.insert cannot write underline, sup, sub, highlight or colours: insert the text, then use text.format.

Rules for editing a Blok document:
- Call blok_read when you need blocks, text or data you do not have. Address blocks by the ids it returns.
- Rich text is segments, not Markdown and not HTML. To add Markdown, use the markdown.insert command.
- When the blok_execute schema lists a command's full arguments, use them. Otherwise call blok_describe with { command } before using it for the first time. Call it with { tool } for a block type's data.
- Someone may be typing in the document at the same time, so its text can change between your calls.
- On a STALE error, call blok_read again and retry with fresh ids and text.
- A CORRECTED warning means Blok changed your command. Check the result is what you meant.
- Change only the blocks the request is about. To add something, insert a new block; do not convert or rewrite a nearby block to get it.
- Put related edits in one blok_execute call.
- A page block's data.pageId is the id of its sub-page document; open it with blok_open to write inside it.
```

With `--page-titles page-map` and a source, one extra line comes before the last line (measured diff): `- To make a new sub-page, insert a page block without data.pageId. Blok creates its document and sets data.pageId. Then write inside it.` The first block of text (`guidance.general`) is generated by the engine from the contract.

### 2.7 Elicitation (approvals) (`sdk-server.ts:22-187`)

- **When the server elicits.** The client's capabilities (per-request envelope, else from initialize) must hold `elicitation` as an object that is empty or has `form` (`canElicit`, `sdk-server.ts:111-116`). Otherwise `approve` is undefined, and the engine refuses with `APPROVAL_REQUIRED`, reason `no-channel` (`src/shared/agent/approval.ts:184-186`).
- **The approver** (`sdk-server.ts:87-109`):
  - Button kinds (`database.buttonConfirm`, `database.buttonHooks`) are always `false`.
  - It reads `ctx.mcpReq.inputResponses[approvalKey(request)]`. An elicit reply counts as yes only when `action === 'accept'` and `content[field] === true`.
  - No reply, and the request carries other replies: reject with `APPROVAL_REQUIRED`. The message depends on the kind (share vs unlock/restore), with `details: {reason:'one-per-call', approval}`.
  - No replies at all: record the request in `asked` and answer `false`.
- **After dispatch.** If `asked[0]` exists, the handler returns `inputRequired({ inputRequests: { [approvalKey(q)]: inputRequired.elicit({ message, requestedSchema }) } })` instead of the tool result (`sdk-server.ts:175-180`).
  - `requestedSchema = {type:'object', properties:{<field>:{type:'boolean', title, description, default:false}}, required:[<field>]}`.
  - `field` is `unlock`, `restore` or `share` (`:27-45,72-79`).
  - `approvalKey` is a JSON array string (`src/shared/agent/approval.ts:16-28`).
- **Message text.** Per kind (`sdk-server.ts:48-71`). It uses the cleaned client name, `JSON.stringify(title)`, and `plainLine(blockId, 64)`. `plainLine` replaces line and paragraph separators with spaces, removes Cc/Cf characters, collapses whitespace, and cuts to `max-1` code points plus `…` (`src/shared/agent/plain-line.ts:8-22`).
- **Eras.** On the 2026-07-28 era the client answers `input_required` and sends the call again with `inputResponses`. On 2025-era clients, the SDK's "legacy shim" sends a real `elicitation/create` request and calls the handler again (SDK doc comment, `server/dist/src-DdvbAHrR.mjs:5607-5620`). Either way, `dispatch` runs once per round, and the first round applies nothing (the approver said no).
- **Tested** in both eras (`unlock-elicitation.test.ts:110-140`):
  - Accept with `unlock: true` unlocks.
  - Decline, cancel, or accept without the tick give `APPROVAL_REQUIRED`.
  - The question names `"Payroll"`.

---

## 3. Configuration

### 3.1 CLI flags and env vars (`config.ts:15-222`)

A flag wins over its env var (`config.ts:182-186,203`).

| Flag | Env | Default | Parsed to | Rule |
|---|---|---|---|---|
| `--http <host:port>` | `BLOK_MCP_HTTP` | stdio | `transport:{kind:'http', listen, public?}` | `:182,195-197` |
| `--public` | – | off | `transport.public: true` | error if there is no http (flag or env): "--public applies to --http only" `:190-192` |
| `--auth none\|oauth` | – | `none` | `auth` | `oneOf` `:183`; oauth needs all of `--oauth-issuer`, `--oauth-audience`, `--oauth-jwks` `:143-156` |
| `--oauth-issuer/-audience/-jwks <url>` | – | – | `auth.issuer/audience/jwksUrl` | read only when `--auth oauth` |
| `--sync-url <url>` | `BLOK_SYNC_URL` | – | `sync.url` | `:184,199` |
| `--origin <origin>` | `BLOK_MCP_ORIGIN` | – | `sync.origin` | only set when sync is set `:185,199` |
| `--ticket-url <url>` | `BLOK_TICKET_URL` | – | `tickets:{kind:'url', url, hostToken}` | needs non-empty `BLOK_MCP_HOST_TOKEN` `:158-170` |
| – | `BLOK_SECRET` | – | `tickets:{kind:'secret', secret}` | used only without a ticket URL, and only if non-empty `:172-174` |
| `--source files:<dir>` / `endpoint:<url>` | – | – | `source` | prefix match; else "--source must be files:<dir> or endpoint:<url>, got "<raw>"" `:92-113` |
| `--source-list <url>` | – | – | `source.list` | endpoint sources only (ignored for `files:`) `:108` |
| – | `BLOK_DOC_ENDPOINT_AUTH` | `''` | `source.endpointAuth` | `:107` |
| `--page-titles off\|page-map` | – | `off` | `pageTitles` | `:202` |
| `--rich-text-fields <json>` | `BLOK_RICH_TEXT_FIELDS` | – | `richTextFields` | must be a JSON object whose values are string arrays `:118-141` |
| `--schema envelope\|full\|mixed` | – | `mixed` | `schema` | `:204` |
| `--handle-idle-ms <n>` | – | 600000 | `handleIdleMs` | `Number(raw)` must be an integer ≥ 1 `:66-77` |
| `--max-handles <n>` | – | 8 | `maxHandlesPerPrincipal` | same check |
| `--principal <name>` | – | `local` | `principal` | any string |
| `--no-comments` | – | comments on | `comments:false` | `:208` |
| `--comments` | – | – | nothing | accepted no-op `:20-21` |
| `--manifest <file>` | – | – | file path | read in `runCli` |
| `--manifest-overrides <file>` | – | – | file path | read in `runCli` |
| `--authorize <module\|url>` | – | – | file path or URL | loaded in `runCli` |

Defaults: `DEFAULTS` (`options.ts:42-54`).

**Parse order** (`parseMcpArgs`, `config.ts:177-222`). The error message depends on which check fails first.
1. `checkArgs` walks argv (`:24-49`). For each token:
   - Not starting with `--`: `Unexpected argument "<arg>"`.
   - Contains `=` at index > 2: `<name> takes its value as the next argument, not after "="`.
   - Not a known flag: `Unknown flag <arg>`.
   - Already seen: `<arg> is given twice`.
   - A value flag skips the next token **without looking at it**.
2. `--http`.
3. `--auth` (`oneOf`: `<name> must be one of a, b, got "<raw>"`).
4. `--sync-url`, `--origin`, `--ticket-url`.
5. `parseAuth`.
6. `parseTickets`.
7. The `--public` check.
8. The options object: source, page-titles, rich-text-fields, schema, handle-idle-ms, max-handles, principal.
9. The manifest, overrides and authorize paths.

`flag(argv, name)` uses `indexOf`. If the next token is missing or starts with `--`, it throws `<name> needs a value` (`:51-64`).

Edge case: in `--http --public`, `checkArgs` swallows `--public` as the value. Then `flag('--http')` throws "needs a value". Also, `argv.includes('--public')` (`:190,197`) would see a `--public` token even when it sits in a value slot. That second point is from reading the code, not tested.

**`runCli`** (`index.ts:119-144`):
1. Parse.
2. Load the authorize hook (if given).
3. Read and validate the manifest, then the overrides (`readJsonFile`, `index.ts:19-37`):
   - Missing file: `Cannot read "<path>": no such file`.
   - Bad JSON: `Invalid JSON in "<path>": <msg>`.
   - The manifest goes through `readCustomToolsFile`; a `TypeError` becomes `Invalid --manifest file: <msg>`.
   - Overrides allow only the keys `hidden` (boolean), `hiddenActions` (string array) and `guidance` (string) per tool. Errors look like `Invalid file at $.<tool>.<key>: <msg>` (`custom-tools-file.ts:13-58`).
4. `createBlokMcpServer`.
5. `start`.
6. Install shutdown handlers.

On `McpConfigError`: stop any server, print `blok-mcp: <message>` to stderr, and `process.exit(2)` (`index.ts:136-142`). Other errors are re-thrown. The bin awaits `runCli` at top level (`packages/mcp/bin/blok-mcp.mjs`), so a re-thrown error ends the process with Node's unhandled-rejection exit code. I did not check which code that is (unverified).

### 3.2 `checkOptionSafety` (`config.ts:273-305`)

This runs in `createBlokMcpServer` (`index.ts:40`), so it covers embedded use too. Order:
1. `checkUploads` (`:250-271`):
   - `uploads.uploader.uploadByFile` must be a function.
   - `limits` must be an object.
   - Each key must be `image|video|audio|file`, and each value an object.
   - `types` must be a string array; `maxSize` a safe positive integer.
   - `uploads.root` with http: "uploads.root reads local files, so it works over stdio only".
2. Ticket URL with an empty host token: "--ticket-url needs BLOK_MCP_HOST_TOKEN".
3. `sync` without `tickets`: "--sync-url needs a ticket mode: set BLOK_SECRET, or --ticket-url with BLOK_MCP_HOST_TOKEN".
4. Stdio stops here.
5. HTTP: secret tickets without `authorize`: "A signing secret over HTTP needs --authorize, or use --ticket-url".
6. A non-loopback bind without `public`: "Refusing to bind <listen>: a non-loopback address needs --public".
   - Loopback hosts are `127.0.0.1`, `localhost`, `[::1]`, `::1` (exact, case-sensitive).
   - The host is the text before the last `:`, or the `[...]` part (`:224-228`).
7. `public` with `auth none`: "--public needs --auth oauth: a public MCP endpoint without auth opens every document".
8. No `authorize`, and not (ticket URL and no source): "HTTP needs a per-document check: pass --authorize, or serve live rooms only with --ticket-url and no --source".

Checks that happen elsewhere:
- At `start()`: stdio with `auth.kind !== 'none'` gives "OAuth authentication needs the HTTP transport (--http)" (`index.ts:76-78`). The CLI can reach this with `--auth oauth` and no `--http`.
- `start()` after `stop()` gives "This MCP server has stopped" (`index.ts:64-66`).
- At assemble time: an `uploads.root` that is not a folder gives `The upload root "<root>" is not a folder` (`local-files.ts:45-55`, called from `server.ts:73` via `uploads.ts:22`).
- Not checked at config time: a `BLOK_SECRET` shorter than 32 characters. `blokTicket` throws a plain `Error` (`packages/server/src/ticket.ts:4,46-48`) at the first live open (`auth/tickets.ts:35-38`). That is not model-fixable, so it would reach the client as a JSON-RPC InternalError (§2.3). This is from reading the code; no test covers it.

### 3.3 Programmatic API (`packages/mcp/types/index.d.ts`)

- `createBlokMcpServer(options: BlokMcpOptions): { start(): Promise<void>; stop(): Promise<void> }` (`:103`). `start` is idempotent; `stop` is shared and idempotent (`index.ts:62-99`).
- `BlokMcpOptions` (`:40-79`): `transport, auth, sync?, tickets?, authorize?, agentActor?, source?, manifest?, pageTitles?, overrides?, richTextFields?, schema?, handleIdleMs?, maxHandlesPerPrincipal?, principal?, uploads?, comments?`. This matches `src/mcp/options.ts:5-28`; `test/unit/mcp/public-types.test.ts` guards drift.
- `AgentActor {id, name, kind:'agent', onBehalfOf?, color?}`, `ManifestOverrides`, `BlokCustomToolsFile`, `McpUploads`, `McpUploadContext {kind, tool?}`, `McpAssetKind` (`:10-38,81-101`).
- **Inputs that are JS functions** and have no direct C# form: `authorize`, `agentActor`, `uploads.uploader.uploadByFile/uploadByUrl` (it receives a WHATWG `File`), and the `--authorize <module>` form, which does a dynamic `import()` of a JS file whose default export is a function (`auth/authorize.ts:52-69`).
- `runCli(argv, env)` is exported from `src/mcp/index.ts:119` and used by the bin, but it is not in the published types.

---

## 4. Transports

### 4.1 stdio

- **Bin** (`packages/mcp/bin/blok-mcp.mjs`): installs the stdout guard first, then imports `dist/mcp.mjs`, then calls `runCli(process.argv.slice(2), process.env)`.
  - The guard reassigns `console.log/info/debug` to `console.error` (`stdout-guard.ts:1-9`).
  - `bin-order.test.ts` checks that a log line printed while the module loads lands on stderr.
- **Serving.** `serveStdio(() => buildSdkServer({...caller: clientName => ({principal, clientName, scopes:null})}))` (`index.ts:79-85`). Over stdio the principal is the configured `principal` (default `local`) and there are no scopes.
- **Shutdown triggers.** SIGINT, SIGTERM, and (stdio only) `stdin` `end`. The first one removes the listeners and calls `stop()`, then `exit(0)` on success or `exit(1)` on failure (`index.ts:102-117`). `bin.test.ts:37-82` checks that ending stdin exits with code 0 and that stdout holds only JSON-RPC lines.
- **Logs.** All diagnostics go to stderr (`index.ts:59,139`; `server.ts:152`; `files.ts:54`).

### 4.2 HTTP (`http.ts`)

- **Server.** A plain `node:http` server. `listen` is split at the last `:`; brackets are stripped from the host; port 0 picks a free port (`:99-103,204-212`). On start it prints `blok-mcp: listening on http://<host>:<port>/mcp` (`index.ts:59`).
- **Per-request flow** (`serve`, `:143-186`), in this order:
  1. **Origin/Host gate → 403, empty body.**
     - A present `Origin` must match `^http://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$`. This is case-sensitive; `Origin: http://LOCALHOST` gave 403 (measured). The check runs even with `--public`.
     - Unless `--public`, `Host` must be `<loopback name>:<bound port>`. The name is compared lowercased (`localhost`, `127.0.0.1`, `[::1]`) and the port must equal the bound one exactly. A Host with no port fails, because `at > 0` is required (`:135-141`).
  2. **OAuth metadata.** Only with oauth, `GET /.well-known/oauth-protected-resource`: 200 JSON `{resource: audience, authorization_servers:[issuer], scopes_supported:['blok.read','blok.write'], bearer_methods_supported:['header']}` (`:152-161`; `http.test.ts:175-184`).
  3. **Path.** Anything other than `/mcp`: 404, empty body (`:162-166`).
  4. **Bearer gate** (oauth only). SDK `requireBearerAuth` with `requiredScopes:['blok.read']`, `expectedResource: new URL(audience)`, and `resourceMetadataUrl: new URL('/.well-known/oauth-protected-resource', audience).href` (`:113-118`). The metadata URL drops any path in the audience, because the path starts with `/`. The gate reads headers only, before the body (`:168-175`).
     - No token, a bad token, or a non-Bearer header: 401 with `WWW-Authenticate` naming `oauth-protected-resource`.
     - A token without `blok.read`: 403 (`http.test.ts:186-226`).
  5. **Body.** Read in full with a 4 MiB cap. Over the cap: 413, empty body (`:34,38-53,195-198`).
  6. **Dispatch.** `createMcpHandler(ctx => buildSdkServer(...))`. A **fresh SDK server is built for each request**. The caller is `{principal: principalOf(authInfo), scopes: authInfo.scopes}`, or `{principal: input.principal, scopes: null}` without auth (`:119-131`).
  7. **Disconnect.** If the client goes away before the response finishes, the request's `AbortSignal` is aborted and handed to dispatch (`:176-183`). `http.test.ts:123` covers it.
  8. **Other failures.** An error before headers gives 500 with a stderr log. An error after headers destroys the socket (`:188-203`).
- **Measured responses.**
  - `GET /mcp` and `DELETE /mcp`: **405** with `allow: POST`, body `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}`.
  - `POST initialize` (2025-06-18): **200**, `content-type: text/event-stream`, one `event: message` frame. **No `Mcp-Session-Id` header.**
  - `tools/call` sent **without a prior initialize** (header `mcp-protocol-version: 2025-06-18`): 200 with the tool result.
  - So HTTP serving is **stateless**. No MCP session exists; the in-memory handle registry is the only state between requests.
- **CORS.** `http.ts` sets no CORS headers. The measured responses carried none (no `access-control-*`).
- **Close.** `handler.close()`, then `server.close()` plus `closeAllConnections()` (`:224-230`).

---

## 5. Auth

### 5.1 OAuth access tokens (`auth/oauth.ts`)

`verifyAccessToken(token)` (`:148-222`), in order:
1. Split on `.`. Decode the header and claims as base64url JSON objects; failure gives "Malformed token".
2. `alg` must be `RS256` or `ES256`; `kid` must be a string; there must be exactly 3 parts. Otherwise "Unsupported token".
3. Any `crit` in the header: "Unsupported critical header".
4. `typ`, lowercased, must be `at+jwt` or `application/at+jwt`. Otherwise "Not an access token".
5. Key lookup by `kid` (JWKS cache, below). The JWK `alg`, if set, must equal the header `alg`. The key type must fit: RS256 needs `rsa`; ES256 needs `ec` with curve `prime256v1`. Otherwise "Signing key does not match the token algorithm".
6. Signature. SHA-256 over the ASCII bytes of `<head>.<body>`. ES256 uses the IEEE-P1363 (raw r‖s) encoding. Failure: "Bad signature".
7. `iss` must equal the issuer exactly: "Wrong issuer".
8. `aud` (a string or an array) must include the audience: "Token not issued for this server".
9. `exp` must be a number greater than now (seconds): "Token expired".
10. `nbf`, if a number, must be ≤ now: "Token not valid yet". There is no clock-skew allowance.
11. Scopes come from `scope` (a space-separated string, empty parts dropped), else from `scp` (an array; strings only).
12. `sub`, if present, must be a non-empty string: "Malformed subject". `sub` starting with `client:`: "Reserved subject".
13. `clientId` is the first non-empty string of `client_id`, `azp`, `sub`. None: "Token names no subject or client".
14. Returns `{token, clientId, scopes, expiresAt: exp, resource: URL(audience), extra:{sub}}`.

All failures are `OAuthError(InvalidToken, msg)`, which the SDK gate turns into 401.

`principalOf(info)` is `sub` if it is a non-empty string, else `client:<clientId>` (`:60-65`).

**JWKS cache** (`:67-145`):
- TTL 10 min; miss cooldown 30 s; fetch timeout 10 s.
- One shared in-flight fetch.
- Keys with `use` other than `sig`, and keys that fail to import, are skipped.
- An empty usable set counts as a failure.
- After the TTL a refresh is tried, unless a failure happened in the last 30 s. A failed refresh keeps the old keys.
- On an unknown `kid`: wait for an in-flight fetch, or refetch at most once per 30 s (and not during the failure cooldown).
- Errors: "Signing keys unavailable" (cache empty) or "Unknown signing key".

### 5.2 `--authorize` hook (`auth/authorize.ts`)

- **`http(s)://` spec: webhook.**
  - Sends `POST` with `Content-Type: application/json` and body `{"principal","documentId","write"}`, with a 10 s timeout.
  - Allowed only when the status is exactly 200 and the body JSON has `allowed === true`. Anything else, including errors, means no (`:28-50`).
- **Other spec: module path,** resolved against the cwd.
  - Missing path: `--authorize <spec>: no module at <path>`.
  - The default export must be a function, else `--authorize <spec> must default-export (principal, documentId, write) => Promise<boolean>`.
  - The result counts as allowed only when `=== true`.
  - No timeout (`:52-69`).
- **Where it is called:**
  - Every open (`opener.ts:54`).
  - Every later call on a handle, through `stillAllowed` (`server.ts:163-164`).
  - Each listed document, with `write=false` (`opener.ts:100-103`).
  - Each page creation, with `write=true` (`opener.ts:122`).
- Without a hook, everything is allowed and listings are not filtered.

### 5.3 Room tickets (`auth/tickets.ts`)

- **Secret mode** (`BLOK_SECRET`) (`:34-41`):
  - `blokTicket(secret, {user: actorId, doc: documentId, write, ttlSeconds: 1800})`.
  - One ticket is minted eagerly at open (so a failure shows at `blok_open`).
  - Every later call mints a fresh one.
  - Ticket format (`packages/server/src/ticket.ts:12,45-61`):
    - HS256 JWT. The header is the exact bytes `{"alg":"HS256","typ":"JWT"}`, base64url.
    - The payload is in key order `{user, doc?, write, exp}`, where `exp = floor(now/1000) + ttl`.
    - The signature is HMAC-SHA256 over the ASCII `<b64 header>.<b64 payload>`, base64url.
    - Secrets shorter than 32 characters throw.
- **URL mode** (`--ticket-url` + `BLOK_MCP_HOST_TOKEN`) (`:43-100`):
  - `POST <url>` with headers `Authorization: Bearer <hostToken>`, `Content-Type: application/json`.
  - Body `{doc, write, principal, clientName, actorId}`, 10 s timeout.
  - Responses:
    - Network failure: `SOURCE_UNAVAILABLE` "The ticket endpoint could not be reached."
    - **401: `SOURCE_UNAVAILABLE`** (retryable) "The ticket endpoint refused the host token."
    - **403: `FORBIDDEN`** "The host did not grant this document to this agent."
    - Other non-2xx: `SOURCE_UNAVAILABLE` "The ticket endpoint answered <status>."
    - A body without a string `ticket`: `SOURCE_UNAVAILABLE`.
  - The ticket's payload is decoded **without checking its signature** (`readTicketClaims`: base64url via `atob` after swapping `-` and `_`; returns null on failure, `src/components/utils/access-pass.ts:67-81`).
  - `claims.user` must equal `actorId` and `claims.doc` must equal `documentId`. Otherwise `FORBIDDEN` "The host minted a ticket for another user or document. Its "user" must equal actorId."
  - `claims.write === true` on a read-only open: `FORBIDDEN`.
  - Cache: refreshed when `exp*1000 - now < 30 s`, or on `forceRefresh`. A missing `exp` means "expires now".
- **Revocation** (`live/open-live.ts:62-122`): the first `FORBIDDEN` from the ticket source ends the room with `{reason:'terminal', error:'forbidden'}`. Later mints throw the same error. A refusal during open stops the room-sync wait at once.

---

## 6. Document sources (stored mode)

Interface (`sources/types.ts:3-26`): `load(id) → {raw, version, missing?}`, `save(id, doc, {ifVersion}) → {version}`, optional `list({query,cursor,limit})`, optional `sameDocument(a,b)`.

`assertDocumentShape`: the value must be a non-array object with a `blocks` array, else `SOURCE_UNAVAILABLE` "<where> is not a Blok document: expected an object with a "blocks" array." (`types.ts:31-35`).

### 6.1 Endpoint (`sources/endpoint.ts`)

- **URL.** `<url without trailing slash>/<encodeURIComponent(id)>`. The ids `''`, `'.'` and `'..'` give `INVALID_ARGS` `"<id>" is not a document id.` (`:34-40`).
- **Every request** uses `redirect: 'manual'` and a 30 s timeout. A network error gives `SOURCE_UNAVAILABLE` "The document endpoint could not be reached." A body read failure gives "…dropped the connection while answering." (`:42-63`).
- **Load: `GET` with `Authorization: <endpointAuth>`** (the raw value, no `Bearer` prefix) (`:67-91`):
  - Status not 200: `SOURCE_UNAVAILABLE` "The document endpoint answered <s> for <id>."
  - Non-JSON body: "…answered non-JSON for <id>."
  - `null`: empty document, `version: null`, `missing: true`.
  - `{data, version?}` without a `blocks` key: `data === null` gives an empty, missing document with that version. Otherwise the shape is checked and `version` is used if it is a string, else null.
  - Otherwise the body is the document itself, with `version: null`.
- **Save: `PUT`** with `Authorization`, `Content-Type: application/json`, `Blok-Doc-Version: <ifVersion>` (only when not null), and body `JSON.stringify(doc)` (compact) (`:92-122`):
  - 409: `DOCUMENT_CHANGED` "Someone saved this document since you opened it. Read it again, then retry."
  - Not 2xx: `SOURCE_UNAVAILABLE` "…refused the save with <s>."
  - The new version is `body.version` if the body is JSON with a string `version`. Otherwise it stays `ifVersion` (empty body, bad JSON, or no field).
- **List** (only with `--source-list`) (`:125-153`):
  - `GET <listUrl>?query=&cursor=&limit=` via `URLSearchParams`. `query` and `cursor` are left out when absent. Same `Authorization` header.
  - Status not 200: `SOURCE_UNAVAILABLE`. A body without a `documents` array: `SOURCE_UNAVAILABLE`.
  - Entries without a string `id` are dropped. `title` is kept only if it is a string, else null. `nextCursor` is kept only if it is a string.

### 6.2 Files (`sources/files.ts`)

- **Ids** (`:14-17,116-122`):
  - Pattern `^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$`, and not a Windows device name (`/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i`).
  - Otherwise `INVALID_ARGS` with a fixed message.
  - The path is `<dir>/<id>.json`.
- **Version.** The SHA-256 hex of the file's raw bytes (`:22,283`). After a save, it is the hash of the written text (`:255`).
- **Load** (`:260-284`):
  - Missing file: check `writeTargetOf` (a dangling symlink throws), then return an empty document with `version: null` and `missing: true`.
  - Otherwise `assertExactName`, parse the JSON (failure gives `SOURCE_UNAVAILABLE` "<id>.json is not valid JSON."), check the shape, and return the raw document with its hash.
- **Case rule** (`assertExactName`, `:131-152`):
  - The native `realpath` gives the on-disk name.
  - If the base name differs, or the path is a symlink, list the folder:
    - The exact name is present: OK.
    - A case-insensitive match is present: `INVALID_ARGS` "<taken> already uses this name with different letter case…"
    - Else: `INVALID_ARGS` "Document ids are case-sensitive. Use the id exactly as listed."
- **Symlinks** (`writeTargetOf`, `:188-206`):
  - Missing entry: the target is `realpath(dir)/<id>.json`.
  - Otherwise `realpath(path)`. A dangling link: `SOURCE_UNAVAILABLE` "<id>.json is a link to a missing file."
  - Saves write through to the link's target.
- **Save** (`:286-299,211-256`):
  - Saves are serialized per target key (the lowercased target path) inside the process (`:64-79,209`).
  - A cross-process lock file `.<lowercased target basename>.lock` sits beside the target:
    - Created with `open(..., 'wx')`.
    - Retried every 25 ms for up to 2 s, then `SOURCE_UNAVAILABLE` "<id>.json is being saved by another process. Retry shortly."
    - A lock with mtime older than 30 s is deleted and retried (`:27-31,82-114`).
  - Under the lock:
    1. Re-resolve the target. If it changed: `DOCUMENT_CHANGED`.
    2. Read the current bytes (and run `assertExactName` if they exist).
    3. Compare `hash(current)` (or null) with `ifVersion`. A mismatch gives `DOCUMENT_CHANGED` "The document changed on disk since you opened it. Read it again, then retry."
    4. Write `JSON.stringify(doc, null, 2) + "\n"` to a temp file `.<id>.<12 hex>.tmp` in the target's folder (`'wx'`).
    5. `fsync` the file, close it, copy the old file mode (`stat.mode & 0o7777`, `chmod`), and `rename` it over the target.
    6. On error, remove the temp file and raise `SOURCE_UNAVAILABLE` "Cannot write <id>.json."
    7. `fsync` the folder (best effort).
    8. Remove the lock.
- **`sameDocument(a,b)`**: both write-target keys resolve and are equal (`:300-311`).
- **List** (`:312-330`):
  - Take `readdir`, keep `*.json`, strip the extension, keep safe ids, and `.sort()`. That is a default JS sort, so it compares UTF-16 code units.
  - The title is the file's `title` field if it is a non-empty string, else null. Read or parse errors give null.
  - Query: substring match, lowercased, on the id or the title.
  - Cursor: the page starts at the first id with `id > cursor` (UTF-16 comparison). An unknown cursor past the end gives an empty page.
  - `nextCursor` is the last id on the page when more remain, else null.
- **Errors to stderr.** Messages to the agent name only `<id>.json`. The full path is logged to stderr (`:52-57`).
- **Porting notes:**
  - System.Text.Json's default escaping differs from `JSON.stringify` (unverified for this payload; worth a byte-level golden test), and the version hash depends on the exact bytes.
  - The memory index records a user decision on server JSON (duplicate keys: last wins; lone surrogates become U+FFFD). It was made for the C# server, not for this source. Whether it applies here is unverified.

---

## 7. Sessions: stored and live

### 7.1 Opener (`opener.ts`)

- **`open(request, caller)`** (`:53-92`):
  1. Authorize hook. False gives `FORBIDDEN` "You may not open this document with this access."
  2. `resolveMode`.
  3. `actor = (options.agentActor ?? defaultAgentActor)(principal, clientName)`.
  4. Live gives `openLive`. Stored with no source gives `SOURCE_UNAVAILABLE` "No document source is configured. Start blok-mcp with --source." Stored otherwise gives `openStoredSession`.
- **`resolveMode`** (`mode.ts:7-22`):
  - `stored` with sync configured: `STORED_WRITE_FORBIDDEN` "A live room owns this document, so stored edits would be overwritten. Open it with mode "live" or "auto"." This applies even read-only.
  - `live` without sync: `INVALID_ARGS` "Live mode needs blok-mcp to run with --sync-url."
  - `auto` gives live if sync is configured, else stored.
- **`list`** (`:94-110`):
  - No `source.list`: `{documents:[], nextCursor:null, supported:false}`.
  - Otherwise filter by the authorize hook (`write=false`) and add `live: syncConfigured` to each document.
- **`createPage(caller)`** (`:117-146`). Used by the engine when a page block is inserted under page-map.
  1. `pageId = mintId()`.
  2. Authorize with write=true. False: `FORBIDDEN` "You may not create a page document here."
  3. **Live:** join the room once with write=true. If the room holds any blocks or a title or icon: `SOURCE_UNAVAILABLE` "The new page id is taken. Try again." Always close the room afterwards (`:149-165`).
  4. **Stored:** `load(pageId)`. If not missing: `SOURCE_UNAVAILABLE` "…taken…". Otherwise `save(pageId, {blocks:[]}, {ifVersion: loaded.version})`.
  5. MCP errors are re-wrapped as `AgentFailure` with `details.pageId` added. The original `retryable` is kept.

### 7.2 Stored session (`stored-session.ts`)

- **Open.** Load once; build the agent via `createDocumentAgentSession(loadStoredDocument(raw))` (`opener.ts:73-91`). The session reports `mode:'stored'`, `durability:'saved-on-execute'`, `contractRevision = contract.revision`, and `exists = !missing` (`:46-51`).
- **`read` / `execute`.** If the session is marked stale, reload first.
- **`execute`** (`:60-93`):
  1. `writing = isWriteBatch(batch)`: some command whose name is in the contract with `readOnly === false`. Unknown names do not count (`errors.ts:39-44`).
  2. Writing on a read-only handle: a failed result `READ_ONLY` "This handle is read-only. Open the document with write: true." (returned, not thrown).
  3. `before = agent.revision()`, then `result = agent.execute(batch, {approve?})`.
  4. If `!ok`, not writing, or `result.revision === before`: return the result with `NO_DELIVERY` (no save).
  5. Otherwise `source.save(id, agent.output(), {ifVersion})`. On success the version is updated and the delivery is `{durable:true, pending:false, serverSequence:null, savedVersion}`.
  6. On a save error: mark stale, try to reload (errors ignored). A non-MCP error is re-thrown; an MCP error becomes a failed result carrying the batch's warnings.
- **`close`** returns `{unsavedBatches:0, hostRecordLags:false}` (`:94`).

### 7.3 Live open (`live/open-live.ts:139-190`)

1. `syncUrlFor`: `<sync.url without trailing slash>/<encodeURIComponent(id)>`. `''`, `.` and `..` give `INVALID_ARGS` (`:41-47`).
2. Mint the first ticket (§5.3) and wrap it for revocation.
3. `openHeadlessRoom({url, docId, serializer, socketFactory, ticketSource, writeDenied: !write, syncTimeoutMs, signal})`.
   - The default sync timeout is 15 s (`src/components/modules/collaboration/headless-session.ts:62,131`).
   - The socket factory is `ws` with `{origin}` when `--origin` is set, and with an `error` listener that does nothing (`live/node-socket.ts:11-19`).
4. Error mapping:
   - Timeout: `ROOM_SYNC_TIMEOUT` "The room did not finish loading in time. Try again."
   - A terminal room error goes through `terminalToError`:
     - `unsupported-format`: `VERSION_SKEW`.
     - `forbidden` or `unauthorized`: `FORBIDDEN`.
     - Else: `SOURCE_UNAVAILABLE` with `details.terminal` (`live-session.ts:22-31`).
   - A refused ticket raises that `FORBIDDEN`.
5. Build the agent: `createStoreAgentSession({store, tools, contract: live, actor, ports, richTextFieldsFor, pageTitles?, services:{versionHistory, uploader?}})`.
6. Presence, then the live session.
7. `unavailableCommands` lists commands that are available in the stored contract but not in the live one. It is attached only when non-empty (`:124-137,182-185`).
8. Any error after the room opened closes the room.

### 7.4 Live session (`live/live-session.ts`)

- **Durability.** `acknowledged` when the room protocol is `v2`, else `best-effort` (`:156-158`).
- **`execute`** (`:81-151`):
  1. Room already ended: a failed result.
     - `reset`: `ROOM_RESET` with `details.notSavedBatches`.
     - Terminal: mapped as in §7.3.
  2. Writing on a read-only latch: `READ_ONLY` "This handle cannot write to the room."
  3. Run the agent. A failure is returned with `NO_DELIVERY`. `APPLY_FAILED` latches the session read-only.
  4. `presence.afterBatch`.
  5. Not writing, or protocol `v1`: return with `NO_DELIVERY`.
  6. `flushAppends()`. If the append failure count went up: latch read-only and return `APPLY_FAILED` with `details.stage: 'journal'`.
  7. Collect the outbox row ids written since the mark, record the batch as unacked, then race `waitFor(ids, 10 s)` against the room's end.
  8. Outcomes:
     - **acked**: delivery `{durable:true, pending:false, serverSequence, savedVersion:null}`.
     - **timeout**: success with delivery `{durable:false, pending:true, serverSequence:null, savedVersion:null}`.
     - **ended**: a failed result (as in step 1).
     - **lineage-reset**: `ROOM_RESET`.
     - **read-only**: latch, then `READ_ONLY` "The room refused the write: this agent may only read. The batch was not saved."
     - **other rejection**: `REJECTED` with `details.rejectionCode`.
- **`read`** on an ended room throws the end error (`:160-170`).
- **`close`** (`:173-181`):
  - Summary: `unsavedBatches` is the count of batches whose rows are not all acked; `hostRecordLags` is `protocol === 'v2'`.
  - Then clear presence, close the agent, and close the room.

### 7.5 Presence (`live/presence.ts`)

- **On open** (`announce`):
  - `user = {name, color, id: actor.id}`.
  - `agent = {via:'mcp', onBehalfOf: actor.onBehalfOf ?? actor.id}`.
- **After each successful batch:**
  - `activeAt = now`.
  - When a block changed: `blockId` and `agentCursor = {actorId, name, color, blockId, field?, start?, end?}`, from `lastRange` or the last created, then updated, then moved id.
  - An activity frame is sent at most once per 60 s. A send that fails does not count toward the minute (`:52-78`).
- **On close:** `agentCursor = null`, `blockId = null`.
- **`caret` is never written.**
- **Colour.** `actor.color` if it is a hex colour (`#rgb/#rgba/#rrggbb/#rrggbbaa`). Otherwise `PRESENCE_PALETTE[sha256(actor.id) first 2 bytes, big-endian, % 8]` (`presence.ts:18,37`; `src/components/modules/collaboration/presence.ts:106-115,126-127,177-178`).
  - The palette: `#0b6e99, #c1461f, #0f7b6c, #6940a5, #ad1a72, #886c1a, #1f5aa8, #8f3a1c`.
- **Name.** The default actor publishes the cleaned client name. A host `agentActor` publishes `actor.name` (`actor.ts:21-22`; `server.ts:120-121`).

### 7.6 Version history (`live/version-history.ts`)

- **Base URL.** The room URL with `ws(s):` turned into `http(s):`, plus `/history` (`:55`).
- **Every request** sends `Authorization: Bearer <ticket>` and `Origin` (if set). On 401 it retries once with a fresh ticket. Network failures throw `Error` with `retryable: true`. **No timeout**, unlike every other outbound call (`:57-74`).
- **`list({group})`:**
  - `GET base[?group=<raw, not encoded>]`.
  - Response `{versions:[{lineage,sequence,savedAt,startedAt,actors}], lineages:[{lineage,current}]}`.
  - Mapped to `{version:"<lineage>:<sequence>", savedAt, startedAt, actors, beforeReset?:true}` (`:20-34,84-92`).
- **`read(version)`:**
  - The path is `<encodeURIComponent(lineage)>/<digits>`. A bad tag gives null.
  - `GET`. 404 gives null. A body with `blocks` gives the document (`:36-48,93-110`).
- **`restore(version, {expectRevision?})`:**
  - `POST base/<path>/restore` with `Blok-Idempotency-Key: <uuid>` and `If-Match: "<expect>"`.
  - 404 gives false; 412 gives `'stale'`; 2xx gives true.
  - An `expectRevision` that cannot be read gives `'stale'` without a request (`:111-141`).
- Other non-2xx statuses throw `Error("The sync server answered <s>: <text>")` with `status`.

### 7.7 Handles (`handles.ts`)

- **Ids.** 16 random bytes, base64url (22 characters) (`:33`).
- **Registry entry:** `{principal, documentId, session, lastUsed, busy, queue}`.
- **Cap.** `maxPerPrincipal` (default 8), counted per principal.
- **Ownership.** A handle is usable only by its own principal. Another principal gets `UNKNOWN_HANDLE`.
- **Serialization.** Calls on one handle run one at a time, in order, through a promise queue (`:56-77`). Calls on different handles run in parallel.
- **Idle.** `lastUsed` is updated when a call starts and when it ends.
- **Sweep** (`:92-116`): every `min(idleMs, 30 s)`, an unref'd timer (`server.ts:146-156`) removes handles that are not busy and idle past the cutoff, then calls `session.close('expired')`. Failures are logged to stderr.
- **`closeAll`** (`:118-127`): marks the registry closed (later opens get `SOURCE_UNAVAILABLE` "The server is shutting down."), clears the entries, waits for each queue, then closes each session.

### 7.8 Page titles: headless `page.rename` / `page.setIcon` (`page-titles.ts`)

- Active only with `--page-titles page-map` (`server.ts:87-100`).
- The engine asks the port to open the page's own document:
  1. If `isOpenDocument(pageId)` is true: `INVALID_ARGS` "This page block points at the document you have open. Use doc.setTitle or doc.setIcon instead." with `details.pageId`.
     - Stored mode: the same id, or `source.sameDocument` (symlinks) (`opener.ts:85-86`).
     - Live mode: the same id only (`open-live.ts:168`).
  2. Open with the same opener: `{mode:'auto', write:true}`, so the authorize hook and tickets apply. MCP errors are re-wrapped with `details.pageId`.
  3. A live write still pending after the ack timeout counts as failed: `SOURCE_UNAVAILABLE` "The room did not confirm the page write in time…" with `details.pending: true` (`:31-37`).
  4. `close()` does not wait. The close is tracked so that `stop` can wait for it (`server.ts:74-79`).
- Contract effects (`contract.ts:29-40`):
  - `pageTitles: 'page-map'` adds the `pageBackend` service.
  - Page blocks become insertable (`prepares: ['page']`) only when `createsPages` = page-map and (sync or a source) (`server.ts:62`).

### 7.9 Uploads and local files

- **Setup.** `uploads` adds the `uploader` service and `uploadsFiles: true` to the contract (`contract.ts:32,38`).
- **Uploader service** (`uploads.ts:8-24`): `uploadByFile`; `uploadByUrl` if present; `limits(kind)`; `decodeBase64` (native, in Node); `readLocal` (only with `root`).
- **`readLocal(path, maxBytes)`** (`local-files.ts:39-118`):
  - The path must be 1-4096 characters with no NUL, else `INVALID_ARGS` (path `/path`).
  - `realpath(resolve(root, path))` must be inside the real root. Missing and outside give the same message.
  - No part of the path relative to the root may start with `.`.
  - The file must be regular. `size > maxBytes` gives "too large".
  - It is opened with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`. The open file must be regular with `nlink === 1`, and the path is resolved again: `ino` and `dev` must match.
  - It reads up to `min(size, max) + 1` bytes and refuses if more than `max`.
  - Returns `{bytes, name: basename}`.
  - All refusals are `PRECONDITION_FAILED` with path `/path`.
- **C# note.** `O_NOFOLLOW`, `nlink` and `ino`/`dev` need platform APIs in .NET (port concern; unverified what .NET offers).

### 7.10 Actor and co-authoring (`actor.ts`)

- **`safeClientName(raw)`**: replace each UTF-16 code unit outside `[A-Za-z0-9._-]` with `-` (no `u` flag, so an astral character becomes two dashes), cut to 64 code units, and use `mcp-client` if the result is empty (`:3-7`).
- **`defaultAgentActor(principal, client)`**: `{id:'agent:<principal>:<client>', name:'<client> (for <principal>)', kind:'agent', onBehalfOf: principal}` (`:9-14`).
- **Attribution** (published doc: `packages/mcp/types/index.d.ts:47-53`; the engine does the stamping):
  - Blocks the agent writes name `onBehalfOf` in `createdBy` / `lastEditedBy` and the actor `id` in `createdWith` / `lastEditedWith`.
  - Tested for stored and live: `createdBy: 'alice'`, `createdWith: ACTOR.id`, `createdAt` a number (`test/unit/mcp/creation-stamp.test.ts:33-52`).
- **Ticket user.** In both ticket modes the ticket's `user` is `actor.id` (`tickets.ts:36,81`).

### 7.11 Custom tools file (`custom-tools-file.ts`)

The `--manifest` file is validated by the engine's `readCustomToolsFile`. `--manifest-overrides` is validated in the shell (§3.1).

---

## 8. Shutdown and error codes

### 8.1 Shutdown

- **`createBlokMcpServer.stop()`** (`index.ts:87-99`):
  1. Wait for any start in progress (errors ignored).
  2. Close the transport (stdio handle or HTTP server).
  3. **Finally** run `assembled.stop()`.
- **`assembled.stop()`** (`server.ts:186-213`):
  1. Clear the sweeper.
  2. Race the drain work against a **45 s deadline** (`STOP_DRAIN_MS`, `server.ts:41-43`). The 45 s sits above the slowest bounded open: a 10 s authorize webhook plus a 30 s endpoint load; live is 10 s + 10 s ticket + 15 s sync. An authorize module has no bound, so stop gives up at the deadline.
  3. The drain work:
     - `handles.closeAll(close 'closed')`, plus waiting for running sweeps, plus `drain(opens, pageCloses)`.
     - Then `drain` again, for page closes started by executes that were waited on.
     - `drain` loops until no new promises appear (`server.ts:46-55`).
- **Opens.** Every in-flight `blok_open` promise is tracked (`server.ts:169-179`). An open that finishes after `closeAll` fails `handles.add` (closed registry), and its session is closed (`dispatcher.ts:217,231-234`).
- **Process.** Exit 0 if `stop` resolves, 1 if it rejects (`index.ts:109`).

### 8.2 Error codes and `retryable`

`retryable` depends on **which helper built the error**, not only on the code:
- `surfaceError` (MCP shell): `retryable` is true only for `ROOM_SYNC_TIMEOUT`, `SOURCE_UNAVAILABLE`, `DOCUMENT_CHANGED`, `HANDLE_LIMIT` (`errors.ts:6-15`).
- `failure()` (engine): true only for `STALE`, `CONFLICT`, `CANCELLED` (`src/shared/agent/errors.ts:3,15-26`).
- Re-wraps (`opener.ts:142`, `page-titles.ts:21-23`, `open-live.ts:56`) copy the original error, flag included.
- So a C# port needs both sets, applied at the right call sites. One code-to-retryable table would be wrong.

All codes: `types/agent.d.ts:46-55`.

Codes the shell raises itself:

| Code | Where (helper) | retryable |
|---|---|---|
| `INVALID_ARGS` | dispatcher arg checks (surface); unknown arguments (failure); mode.ts live-without-sync; endpoint and sync ids; files ids and case; local-files path (failure); page-titles same doc (failure) | false |
| `FORBIDDEN` | scope; stillAllowed; authorize on open or create page; ticket 403 or claim mismatch; room forbidden or unauthorized | false |
| `UNKNOWN_HANDLE` | handles use or remove | false |
| `HANDLE_LIMIT` | handles.assertRoom | **true** |
| `SOURCE_UNAVAILABLE` | shutting down; no source; endpoint and files I/O; ticket endpoint (incl. 401); page id taken; room ended for good; pending page write | **true** |
| `DOCUMENT_CHANGED` | endpoint 409; files hash or target mismatch | **true** |
| `STORED_WRITE_FORBIDDEN` | mode.ts | false |
| `ROOM_SYNC_TIMEOUT` | open-live | **true** |
| `ROOM_RESET` | live-session | false |
| `VERSION_SKEW` | live-session terminalToError | false |
| `READ_ONLY` | stored or live session | false |
| `APPLY_FAILED` | live-session journal stage | false |
| `REJECTED` | live-session room rejection | false |
| `CANCELLED` | dispatcher open aborted (failure) | **true** |
| `COMMAND_UNAVAILABLE` | `page` argument refused (failure via parseToolCall) | false |
| `PRECONDITION_FAILED` | local-files (failure) | false |
| `APPROVAL_REQUIRED` | sdk-server one-per-call (failure) | false |

Every other code (`UNKNOWN_COMMAND`, `STALE`, `CONFLICT`, `DATA_REJECTED`, …) comes from the engine.

---

## 9. Tests in `test/unit/mcp` (40 files, 10,428 lines)

How I classified them: by import (`grep from` per file) and by whether they start a process (`grep spawn|child_process`).

**Black-box over a process (could run against a C# binary):**
- `bin.test.ts` test 3 (`:37-82`): spawn the bin with `--source files:<tmp>`, send `initialize` over stdin, expect only JSON-RPC lines on stdout with `serverInfo.name === 'blok-mcp'`, then close stdin and expect exit 0. Tests 1 and 2 check the Node bundle and do not port.

**Node-packaging checks (do not port):** `bin-order`, `bundle-deps`, `package`, `public-types`, `readme` (README must name every flag and env var the parser reads).

**Protocol-level but in-process.** These use the real SDK `Client` over PassThrough stdio or real HTTP, against a server built in-process with injected fakes. The assertions are behavioural and could be turned into scenarios for a C# binary, but the setup code is TS-only:
- `sdk-server.test.ts`: both eras; schemas served unchanged; instructions; tool error text equals the JSON; cancel; unknown tool gives InvalidParams; unexpected throw gives InternalError; output schema enforced.
- `unlock-elicitation.test.ts`: both eras; accept, decline, cancel, no tick; one per call; no elicitation capability.
- `http.test.ts`: Origin and Host gates; 404; disconnect abort; OAuth metadata, 401 and 403.
- `index.test.ts`: `createBlokMcpServer` and `runCli` with a mocked `process`; exit codes; signal lifecycle.
- `custom-inline-tools.test.ts`: Client plus server, stored and live.

**Scenario tests through `assembleMcp().dispatch`** (white-box entry, behavioural assertions): `stored-e2e`, `server`, `server-live`, `page-titles`, `uploads`, `live-version-history`, `authorize` (part), `creation-stamp`.

**Unit, white-box:** `actor`, `config`, `contract`, `custom-tools-file`, `dispatcher`, `errors`, `handles`, `local-files`, `live-session`, `mode`, `node-socket`, `oauth`, `open-live`, `presence`, `run-cli-config`, `sources-endpoint`, `sources-files`, `stdout-guard`, `stored-session`, `tickets`.

**Strongest cross-language oracle (outside `test/unit/mcp`).** `test/unit/agent/parity/` runs a shared corpus through MCP stored and live (`mcp-stored-runner.test.ts`, `mcp-live-runner.test.ts`, harness `mcp-harness.ts`). It compares against golden answers (`answers.ts`, `run-case.ts` `compareToGolden`). The harness calls `assembleMcp` in-process (`mcp-harness.ts:13`). It is still the best source of expected answers for a port.

---

## Open items (unverified in this session)

- C# MCP SDK support for the 2026-07-28 era, `inputRequired` and its legacy shim, per-request `_meta` client info, `x-mcp-header`, and stateless HTTP.
- Whether a live handle can list `reason: 'host'`, which the `blok_open` output schema does not allow (§2.2).
- The process exit code when `runCli` throws a non-config error.
- Which engine operations `src/view/server-runtime.ts` already exposes to C# beyond the `case` names listed in §1.4.
- How System.Text.Json output differs from `JSON.stringify` for saved files and for the tool `text` content.
