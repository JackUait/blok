# MCP operations in the server runtime bundle

Date: 2026-11-07. Lane: `mcp/bundle`.

The C#, Go and Rust MCP ports call these operations through the existing `invoke(operation, inputJson)` of `src/view/server-runtime.ts`. Each one runs the Node MCP's own code, so a port that only does IO answers what `blok-mcp` answers.

Every shape below is pinned by `test/unit/view/server-runtime-mcp.test.ts`. That test runs each operation next to Node's own function, or Node's whole dispatcher, on the same input.

## 0. Ground rules

- **Input and output are JSON text.** The input is always one JSON object. The output is a JSON object, except where noted.
- **A thrown error means a host bug** (bad input shape). Model-fixable refusals always come back as data.
- **Byte parity.** A tool answer's `text` content is `JSON.stringify(structuredContent)` in Node. Ports should keep the key order the bundle gives. Do not re-sort keys, and parse and re-write as little as possible. Rust needs `serde_json` with `preserve_order`. C# needs an encoder that does not escape `'`, `<`, `>`, `&`, `+` or non-ASCII.
- **Answer shape.** Every operation that produces a tool answer returns it as `answer: { structuredContent, isError }`. The host sends `{ content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent, isError }`.
- **Shared code** lives in `src/shared/mcp/*` (pure, no IO). `src/view/mcp-runtime.ts` and `src/view/server-runtime.ts` expose it. Node's `src/mcp/*` imports the same functions.
- **Cache per process.** Call `mcpSurface` once at startup and keep it. The other operations are per request.

## 1. Startup

### `mcpParseArgs`

Node's `parseMcpArgs` (CLI and env). It covers JS `Number()` for number flags, empty env vars counting as set, flag order and every message.

- In: `{ argv: string[], env: { [name]: string } }`.
- Out: `{ ok: { options, files } }` or `{ error: "<message>" }`.
  - `options` is the `BlokMcpOptions` data: `transport`, `auth`, `sync?`, `tickets?`, `source?`, `pageTitles?`, `richTextFields?`, `schema?`, `handleIdleMs?`, `maxHandlesPerPrincipal?`, `principal?`, `comments?`. Absent keys are left out.
  - `files` holds `{ manifest?, overrides?, authorize? }`, the paths as given.
- On `error`: print `blok-mcp: <error>` to stderr and exit 2.

### `mcpConfigFile`

Validates a `--manifest` or `--manifest-overrides` file the host already read and parsed.

- In: `{ kind: 'manifest' | 'overrides', value: <parsed JSON> }`.
- Out: `{ value }` or `{ error }`. Exit 2 on error.
- The host builds two messages itself, before this call:
  - `Cannot read "<path>": no such file`
  - `Invalid JSON in "<path>": <parser message>`
  - The `<parser message>` is V8's `SyntaxError` text. No other engine can match it. This is a known, accepted difference.

### `mcpCheckOptions`

Node's `checkOptionSafety`.

- In: `{ options }`. These are the `options` from `mcpParseArgs`, plus the following. Function-valued options become presence flags:
  - `authorize: true` when there is an authorize hook (`--authorize` or a library hook);
  - `uploads: { uploadByFile: true|false, root?, limits? }` when uploads are configured.
- Out: `{}` or `{ error }`. Run it after the manifest and overrides are read and the authorize hook is loaded, as `runCli` does.

### `mcpSurface`

What a client sees before it opens anything.

- In, using Node's start-option semantics:

  ```
  { pageTitles?: 'off'|'page-map',
    sync: boolean,     // a sync URL is set
    source: boolean,   // a document source is set
    uploads: boolean,  // an uploader is set
    comments?: false,  // --no-comments
    manifest?, overrides?,   // validated values, see mcpConfigFile
    richTextFields?: { [type]: string[] },
    schema?: 'envelope'|'full'|'mixed', handleIdleMs?: number }
  ```

- Out:

  ```
  { tools: [...6 tools, tools/list order],
    instructions: "<initialize instructions>",
    prompts: [{ name, description, arguments: [{ name, description, required }] }],
    contractRevision: { stored, live },
    liveUnavailableCommands: [{ name, reason }] }
  ```

- `blok_open` reports `contractRevision.stored` on a stored handle and `contractRevision.live` on a live one. They differ.
- A live handle's `unavailableCommands` is `liveUnavailableCommands`, sent only when it is not empty.
- **Every later call on a handle passes these same flags again** as its `mcp` object (§3), plus `mode`.

## 2. One tool call

The host runs these steps in this order. They match Node's dispatcher order exactly.

### `mcpCheckCall`

Every check of a `tools/call` that needs no IO.

- In: `{ name, arguments, scopes: string[] | null }`. `scopes` is null without OAuth.
- Out, one of:
  - `{ unknownTool: "Unknown tool: <name>" }`: answer JSON-RPC `-32602` with that message.
  - `{ answer }`: a refusal. Send it as is.
  - `{ step }`, where `step` is one of:
    - `{ tool: 'blok_list_documents', list: { limit, query?, cursor? } }`
    - `{ tool: 'blok_open', documentId, mode, write, view? }`
    - `{ tool: 'blok_open', find: { query? }, mode, write, view? }`
    - `{ tool: 'blok_close', handle }`
    - `{ tool: 'blok_read'|'blok_describe'|'blok_execute', handle, write, call }`
      - `call` is `{ name: 'blok_read', view }`, `{ name: 'blok_describe', query }` or `{ name: 'blok_execute', batch }`.
      - `write` is true only for execute. It is what the authorize hook is asked on every handle call.

After `step`, the host does its IO. Every model-fixable error it raises goes through `mcpErrorAnswer`.

**List** (`blok_list_documents`, and the `find` form of `blok_open`):

1. List with `step.list`, or with `{ limit: 25, query? }` from `find`. Without a list route the listing is `{ documents: [], nextCursor: null, supported: false }`.
2. Filter by the authorize hook with `write=false`. Add `live: <sync configured>` to each entry.
3. Call `mcpListAnswer { request, listing }`. It returns:
   - `{ relist: { limit } }`: list again with that request, then call it again with `relisted` set to the second listing; or
   - `{ listing }`: the final listing.
4. For `blok_list_documents`, answer `{ structuredContent: listing, isError: false }`.
5. For `blok_open` with `find`, call `mcpPickDocument { find, listing }`. It returns `{ answer }` (the listing to choose from) or `{ open: { documentId, title } }`.

**Open:**

1. Check the handle cap.
2. Ask the authorize hook (`write = step.write`).
3. Call `mcpResolveMode { requested: step.mode, sync }`. It returns `{ mode }` or `{ error }`.
4. Open the stored or live session.
5. If `view` is set, call `mcpRead`. An `isError` answer closes the session and is the answer.
6. Check cancel.
7. Add the handle.
8. Call `mcpOpenAnswer`:

   ```
   { handle, expiresAfterIdleMs,
     session: { mode, write, durability, contractRevision, exists?, unavailableCommands? },
     found?: { documentId, title },   // only for the find form
     view? }                          // the read's structuredContent
   ```

   It returns `{ answer }`.

**Close:** use the handle with `write=false`, so a revoked document answers FORBIDDEN and the handle stays. Then remove it, close it, and answer `{ closed: true, unsavedBatches, hostRecordLags }` in that key order.

**Core tools:** look up the handle (`UNKNOWN_HANDLE`), ask `stillAllowed(write)`, then run `mcpRead`, `mcpDescribe` or `agentExecute` (§3).

### `mcpErrorAnswer`

The answer for an error the host raised.

- In: `{ tool, helper, error: { code, message, details?, path?, commandIndex? } }`.
- `helper` decides `retryable`. Pick it by the Node call site, never by the code alone:
  - `surface`: Node's `surfaceError`. `retryable` is true only for `ROOM_SYNC_TIMEOUT`, `SOURCE_UNAVAILABLE`, `DOCUMENT_CHANGED` and `HANDLE_LIMIT`. Use this for every error from handles, sources, tickets, rooms, the authorize hook, `stillAllowed`, scopes and `resolveMode`.
  - `failure`: the engine's `failure()`. `retryable` is true for `STALE`, `CONFLICT` and `CANCELLED`. Node uses it for the open-cancelled error, `local-files` and the page-titles same-document error.
  - `as-is`: the error already carries `retryable`. Use it for re-wraps that copy the flag, such as `createPage` adding `details.pageId` to a surface error.
- Out: `{ answer }`. For `blok_execute`, `structuredContent` is `{ ok: false, error, delivery: NO_DELIVERY }`. Otherwise it is `{ error }`.

### `mcpResolveMode`

- In: `{ requested: 'auto'|'live'|'stored', sync: boolean }`.
- Out: `{ mode: 'live'|'stored' }` or `{ error }`.

### `mcpActor`

- In: `{ principal, clientName? }`. `clientName` is the raw client name: from the request envelope `_meta['io.modelcontextprotocol/clientInfo'].name`, else from `initialize`.
- Out: `{ clientName, actor, presenceName }`.
  - `clientName` is cleaned by `safeClientName`, which works per UTF-16 unit, so an emoji gives two dashes.
  - `actor` is the default `agent:<principal>:<client>` actor.
- A library host with its own actor function uses that actor and publishes `actor.name` as the presence name.

### `mcpPrompt`

- In: `{ name, arguments? }`.
- Out: `{ result: { description, messages } }` or `{ error: { code: -32602, message } }`.

## 3. Running on a handle's document

All three take the **session input**:

```
{ mcp: { ...the mcpSurface flags, mode: 'stored'|'live', write: boolean },
  document,            // the handle's current document (stored JSON)
  actor,               // from mcpActor or the host's agentActor
  revision?: { now, afterWrite },   // live only, see below
  history?,            // carried undo steps, see below
  versionHistory?,     // preloaded history, as agentExecute already takes it
  createdPages? }      // page ids made first, as agentExecute already takes them
```

The contract, rich-text fields, sanitizers and ports come from `mcp`, exactly as blok-mcp builds them. The old `customTools`, `services`, `runtime` and `prepares` inputs are ignored when `mcp` is set. Existing callers without `mcp` see no change.

### `mcpRead` / `mcpDescribe`

- In: the session input plus `view` (from `step.call.view`), or plus `query` (from `step.call.query`).
- Out: `{ answer }`. A bad view or an unknown tool is an error answer. Anything else throws, as it does in Node, and becomes JSON-RPC `-32603`.

### `agentExecute` with `mcp`

- In: the session input plus:
  - `batch` (from `step.call.batch`);
  - `documentText?: 'file' | 'compact'`;
  - `approval?: { capabilities, replies?, clientName }`, where `capabilities` are the client capabilities (envelope `_meta['io.modelcontextprotocol/clientCapabilities']`, else from `initialize`), `replies` are the request's `inputResponses`, and `clientName` is the cleaned name.

- Out:
  - `{ ask: { key, message, requestedSchema } }`: the person must be asked. Nothing was applied, and `document` and `history` are unchanged.
    - **2026-07-28:** answer `input_required` with `inputRequests: { [key]: elicitation/create { message, requestedSchema, mode: 'form' } }`.
    - **2025-era stdio:** send `elicitation/create` and run the call again with `replies = { [key]: <the elicit result> }`.
    - Ask only when `ask` comes back. The bundle already checked `canElicit(capabilities)`. Without elicitation the batch fails with `APPROVAL_REQUIRED` (`no-channel`).
  - `{ result, document, edits, history?, restore?, writes, save, documentText? }`.
    - `writes` says whether the batch holds a writing command of this contract.
    - `save` is true only when `writes` is true, the batch succeeded and the content changed. That is Node's stored save rule.
    - `documentText` is the exact text to store (only when `save` is true and `documentText` was asked for):
      - `file`: `JSON.stringify(doc, null, 2) + "\n"`. Write these bytes as UTF-8. The files source's version is the SHA-256 hex of them.
      - `compact`: `JSON.stringify(doc)`, the endpoint PUT body.
- **Read-only handles:** when `mcp.write` is false and the batch writes, nothing runs. `result` is `READ_ONLY` with the stored or live message. For live, pass `write: false` once the handle latched read-only (after `APPLY_FAILED`, or a room `read-only` rejection).
- **Approval rules** (all in the bundle):
  - button kinds are always refused;
  - an accept counts only with the tick;
  - a retry with replies that meets another question fails with `APPROVAL_REQUIRED` `one-per-call`.

Then answer with **`mcpExecuteAnswer`**:

- In: `{ result, delivery? }` or `{ result, failed: { helper, error } }`.
- `delivery` is what the save or the room gave:
  - stored after a save: `{ durable: true, pending: false, serverSequence: null, savedVersion }`;
  - live acked: `{ durable: true, pending: false, serverSequence, savedVersion: null }`;
  - live timeout: `{ durable: false, pending: true, serverSequence: null, savedVersion: null }`;
  - absent: `NO_DELIVERY`.
- `failed` is a save or room refusal after the batch ran. The answer is that error with the batch's warnings, as Node's `failedResult` builds it.
- Out: `{ answer }`. Node's `modelAnswer` puts `ok` and `warnings` first, drops empty lists, caps id lists at 50 and keeps `delivery` last.

### Undo between calls (`history`)

- Send `history: {}` on the first call and the returned `history` on the next one, with the returned `document`.
- A Node stored handle keeps its steps in memory. The carried steps reproduce that, because the host keeps the handle's document between calls.
- **When Node reloads a stored handle** (after a failed save), it starts a fresh agent. Drop `history` then, and send `{}`.
- **Live (remote) handles:** the carried steps are dropped as lost whenever the document's content differs from the one they were made on, so a peer's edit in between loses them. Node's `Y.UndoManager` keeps them. Ports with a native room history (C# `RoomAgentHistory` and its Go and Rust twins) can use that instead. **Open:** decide per port. There is no parity test with a concurrent peer yet.

### Live revision (`revision`)

- Node live reports `l<n>`, where `n` counts Y updates on the local doc.
- Pass `revision: { now: 'l<n>', afterWrite: 'l<n+1>' }`. The bundle checks `expectRevision` against `now`, and reports `afterWrite` in `result.revision` and in every `doc.read` result, once the batch changed the document. A batch is one transaction, so one update.
- Reads report `now`.
- Without `revision`, the content hash is used, as on stored handles.

## 4. Files source helpers

- **`mcpFileId { id }`** → `{}` or `{ error }`. This is the id rule, including Windows device names. Run it before any path is built.
- **`mcpFileIds { names }`** → `{ ids }`. Pass the raw `readdir` names. You get the safe ids, sorted by UTF-16 units (ordinal).
- **`mcpFilesList { entries: [{ id, text|null }], query?, cursor?, limit }`** → `{ documents: [{ id, title }], nextCursor }`.
  - `text` is the file decoded as UTF-8 with replacement characters, or null if it cannot be read.
  - Run the authorize filter and add `live` after this call.
- **`mcpParseDocument { id, text }`** → `{ document }` or `{ error }`.
  - `text` is the file's bytes decoded as UTF-8, with U+FFFD for bad bytes, as Node's `toString('utf-8')` does.
  - A BOM is kept, so the call fails as "not valid JSON", as in Node.
  - Then pass `document` on as the session input.
- **`mcpDocumentText { document, form: 'file'|'compact' }`** → `{ text }`. Use it for saves outside `agentExecute`, such as a new page's empty `{ blocks: [] }`.

The disk work stays in the host: the lock file, temp file, fsync, rename, case and symlink checks, and SHA-256.

## 5. Live helpers

- **`mcpRoomError { terminal? }`** → `{ error }`. This is Node's `terminalToError`:
  - `unsupported-format` → `VERSION_SKEW`;
  - `forbidden` and `unauthorized` → `FORBIDDEN`;
  - anything else → `SOURCE_UNAVAILABLE` with `details.terminal`.
  - Use helper `as-is` when answering with it.

## 6. Still in the host (and written three times)

- transports;
- handles: ids, cap, queue and sweep;
- sources' IO;
- the authorize hook;
- OAuth;
- tickets;
- the room client, presence and its colour hash (SHA-256);
- version-history HTTP;
- shutdown.

The messages these raise are Node's literal strings in `src/mcp/handles.ts`, `sources/*.ts`, `auth/*.ts`, `live/*.ts` and `opener.ts`. They are not in the bundle yet. **Open:** a shared message table would remove the last retyped strings.

## 7. Open items

1. **`page.rename` / `page.setIcon` under `--page-titles page-map`.**
   - The engine calls `openPageDocument` in the middle of a batch, and Jint cannot call back to the host.
   - The stored contract still lists these commands. Through the bundle they fail at run time, because there is no `pageBackend`.
   - A fix needs a pre-pass like `agentPagesNeeded`: name the page ids, have the host load them, then pass them in and return their new documents.
   - Not done in this lane.
2. **Uploads.** With `uploads: true`, the contract lists `<tool>.uploadFile`, but the bundle has no uploader service. That is milestone 6.
3. **Live undo** with concurrent peers (§3).
4. **Host error messages** are not single-source yet (§6).
5. **JSON readers.** `mcpParseDocument` parses with JS `JSON.parse`, but the host then re-reads `document` from the output. Lone surrogates come out escaped (`\udXXX`). A host JSON reader that maps them to U+FFFD would differ from Node, which keeps them.

No Node behaviour was changed, and no Node bug was found in this lane.
