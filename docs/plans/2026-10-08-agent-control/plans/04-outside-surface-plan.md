# Outside Agent Surface (`@bloklabs/mcp`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@bloklabs/mcp`, a Node MCP server (bin `blok-mcp`) that lets Claude Code, Claude Desktop and any MCP client read and edit Blok documents through the shared agent contract, both in live collab rooms (as a visible participant) and in stored documents (load, edit headless, save).

**Architecture:** All server code lives in `src/mcp/` and is bundled from source into `packages/mcp/dist` by `scripts/build-mcp.mjs`, the way `@bloklabs/cli` ships. The three core tools come from 03's `renderAgentTools`; 04 adds three lifecycle tools and a handle registry. Stored handles run 01's `createDocumentAgentSession` over a `DocumentSource` (local files or the host's existing doc endpoint). Live handles run 01's `createStoreAgentSession` over a `DocumentStore` that a new core module, `headless-session.ts`, keeps in sync with a room through the real `createCollabProvider`, an in-memory operation store, and a tracking outbox that reports per-batch acks.

**Tech Stack:** TypeScript, Vite (lib build), Vitest (`unit` project, `// @vitest-environment node` per file), `@modelcontextprotocol/server` 2.3.1 (runtime dep), `@modelcontextprotocol/client` 2.3.1 (root devDependency, tests only), `ws` 8.21.0 (runtime dep), `yjs` (bundled), Node `node:crypto` for JWT checks, the C# `Blok.Server.Host` binary for the conformance test.

**Spec:** `docs/plans/2026-10-08-agent-control/04-outside-surface.md`. Binding contract and decisions: `docs/plans/2026-10-08-agent-control/06-reconciliation.md` §3 and §12 (where 04 and 06 differ, 06 wins).

## Global Constraints

- Package name `@bloklabs/mcp`, bin `blok-mcp` (decided D2). It ships in the same family version as `@bloklabs/core` and `@bloklabs/server`; its README says to upgrade all three together.
- Exactly six MCP tools: `blok_list_documents`, `blok_open`, `blok_read`, `blok_describe`, `blok_execute`, `blok_close`. The three core tools are `renderAgentTools(contract, { format: 'mcp', handle: true })` output, never hand-written (06 §3.7).
- `handle`: random, 128 bits. Idle expiry 10 minutes by default (`--handle-idle-ms`). Cap 8 open handles per principal by default (`--max-handles`). A principal mismatch reads as `UNKNOWN_HANDLE`.
- Live open waits for `connected` with a non-null `tag`, timeout 15 s, else `ROOM_SYNC_TIMEOUT`. Journal ack wait: 10 s, then `ok: true` with `delivery.pending: true`. There is no `DURABILITY_TIMEOUT`.
- `provider.sendActivity()` at most once a minute. No `caret` field. `agentCursor` per 06 §10.2, verbatim; `null` on close and on expiry.
- Ticket `user` claim must equal `actor.id`. Secret-minted tickets: `{ user: actor.id, doc, write, ttlSeconds: 1800 }`.
- `mode: "stored"` is refused with `STORED_WRITE_FORBIDDEN` when a sync URL is configured. `mode: "auto"` → `live` with a sync URL, else `stored`.
- `history.undo` in live mode → `COMMAND_UNAVAILABLE` (contract built with `runtime: 'node-live'`). Stored mode supports it. `history.undo` / `history.redo` must be alone in their batch (01 deviation D-3: a mixed batch is `INVALID_ARGS` from 01's executor); this plan passes batches through and every test sends undo alone.
- `expectRevision`: live = 01's counter over `DocumentStore.onAnyUpdate`; stored = 01's canonical-JSON hash. Never the source's `savedVersion`.
- stdio: the server never writes non-MCP bytes to stdout. Credentials come from env: `BLOK_SECRET`, or `BLOK_TICKET_URL` + `BLOK_MCP_HOST_TOKEN`, and `BLOK_DOC_ENDPOINT_AUTH`.
- HTTP: default bind `127.0.0.1`. Binding a non-loopback address needs `--public` and an auth mode other than `none`. OAuth scopes are `blok.read` and `blok.write`. The server never accepts a Blok ticket from the caller and never forwards the caller's token.
- Schema mode default `'envelope'`; `strict` is never emitted for `blok_execute`.
- Page fields in stored mode use `OutputData.title` / `OutputData.icon` (01 plan deviation D-1, verified: `types/data-formats/output-data.d.ts:129`, `:132`), not the spec's `OutputData.page`.
- `--page-titles page-map` is off by default. Only then is `pageBackend` in the contract's `services`.
- Docker image, custom tool action handlers outside the browser, uploads, live undo, MCP resources/prompts: out of scope (decided D6).
- `packages/mcp/types/index.d.ts` imports nothing from `src/` (published-types law; `test/unit/architecture/published-types-no-src-refs.test.ts:118-140` already scans every `packages/*/types`).
- Nothing in this plan is breaking. All surface is new (D2, D4). The release note lists `@bloklabs/mcp`, its flags, the `agent` and `agentCursor` awareness fields.
- Protected config files (`vite.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `.env`) are not touched. The root `package.json` gets only the `build:mcp` script (D2) and the `@modelcontextprotocol/client` devDependency (D3, R3-10).
- Commits go straight to `main`. Stage explicit paths, never `git commit -a`. Every commit ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Lint only changed files while iterating: `npx eslint <paths>`. Run only the new/related test files: `yarn test <file>`.
- No `let` in `src/` or `scripts/*.ts`: ESLint bans it (`eslint.config.mjs:1150-1155`); use a `const` holder object, as `src/components/utils/access-pass.ts:110-111` does. Test files are exempt (`no-restricted-syntax` is off for `test/unit/**` and `test/playwright/**`).

## Review Focus

1. **Two tool calls on one handle at once.** MCP clients may run tool calls in parallel. Both must run one after the other on that handle. In stored mode the second save must chain on the first save's version, never fail with `DOCUMENT_CHANGED` against its own write. Pinned in Task 7 (registry serialization) and Task 12 (two parallel `execute` calls both saved).
2. **The room drops mid-batch.** A socket close (4503, network loss) during the ack wait must give `ok: true` with `delivery.pending: true`, not an error. The rows drain on reconnect, and `blok_close` reports them in `unsavedBatches`. Pinned in Task 18.
3. **Odd document ids.** `../x`, `a/b`, `""`, 600 characters, `%2e%2e`. The files source must never touch a path outside its directory (`INVALID_ARGS`). The endpoint source must percent-encode the id. Pinned in Tasks 10 and 11.
4. **The client goes away with live handles open.** stdin EOF or SIGTERM must leave every room: presence withdrawn, `agentCursor: null`, sockets closed, process exits. Pinned in Task 20 (`stop()` closes all handles) and Task 3 (bin exits on stdin EOF).
5. **A stored document that is not what we expect.** Invalid JSON, a JSON array, `{}` with no `blocks`, rich fields holding HTML. Unparseable or wrong-shaped files open as `SOURCE_UNAVAILABLE` with a message, never a crash. HTML rich fields open fine (01's `loadStoredDocument` turns them into segments). Pinned in Tasks 10 and 12.

## Cross-plan dependencies

This plan starts after the pieces below exist on `main`. Each import site in this plan is a single line, so a different final name changes one file only.

**Needs from plan 01 (core commands):**

| Canonical name | Where (per 01 plan file structure) | Used in |
|---|---|---|
| Types `AgentSession`, `AgentResult`, `AgentError`, `AgentErrorCode`, `AgentBatch`, `AgentActor`, `AgentWarning`, `DocumentView`, `ViewArgs`, `AgentPorts` | `src/shared/agent/index.ts` barrel (types re-exported from `types/agent.d.ts`) | Tasks 7, 8, 12, 18, 19 |
| `createDocumentAgentSession({ document, tools, contract, actor, ports, pageTitles? })` with `output()` | `src/shared/agent/document-session.ts` (01 Task 17) | Tasks 12, 13 |
| `createStoreAgentSession({ store, tools, contract, actor, ports, richTextFieldsFor, pageTitles? })` (`richTextFieldsFor` is required) | `src/components/modules/agent/store-session.ts` (01 Task 35). Must not import editor modules. | Tasks 18, 20 |
| `createHeadlessPorts(input: { sanitizeFor(type): SanitizerConfig \| undefined; richTextFieldsFor(type): string[]; globalSanitizer?; openPageDocument?; newId? })` and `loadStoredDocument(doc: OutputData, richTextFieldsFor: (type: string) => string[]): OutputData` (01 Task 19); `createHeadlessAgentSetup({ customTools?, overrides?, services?, runtime? })` → `{ contract, tools, ports, richTextFieldsFor }` (01 Task 21) | `src/view/agent-runtime.ts` | Tasks 5, 12, 13, 18, 20, 26 |
| The view-entry law exception for `src/mcp/` plus its "nobody imports `src/mcp/`" guard | `test/unit/architecture/view-entry-law.test.ts` (01 Task 19). This plan does not duplicate it. | Task 1 onward |
| `AgentPorts.openPageDocument` port and the Node `pageBackend` (`createPageMapBackend(open, actor, readBlock)`, 01 Task 17; it implements 02's `PageBackendService`, block id in, and reads `data.pageId` itself). 01 builds it when the session gets `pageTitles: 'page-map'` and the port. | 01 Task 17, 02 Task 12 | Tasks 13, 20, 26 |
| `OutputData.title` / `OutputData.icon` as the stored page slot | 01 deviation D-1 | Tasks 14, 26 |

**Needs from plan 02 (tool self-description):**

| Canonical name | Where | Used in |
|---|---|---|
| `buildToolManifest(snapshot, overrides)`, `buildAgentContract(manifest, COMMANDS, where)` | `src/shared/tool-manifest.ts` | Task 5 |
| The Node tool setup for built-ins plus a `BlokCustomToolsFile`. There is no `buildNodeToolSetup`: 02 produces `buildBuiltInSnapshot` (`src/shared/built-in-snapshot.ts`, 02 Task 27) and `readCustomToolsFile`, `snapshotWithCustomTools`, `runtimesWithCustomTools` (`src/shared/custom-tools-file.ts`, 02 Task 29), and 01's `createHeadlessAgentSetup` (01 Task 21) composes them. This plan calls 01's setup, and wraps `readCustomToolsFile` for `--manifest`. | 02 Tasks 27, 29; 01 Task 21 | Task 5 |
| Types `BlokCustomToolsFile`, `ManifestOverrides`, `ToolRegistrySnapshot`, `AgentContract`, `HostService` (`types/tool-manifest.d.ts`, 02 Task 3); `ContractSlice` (`types/agent.d.ts`, 01 Task 17); `ToolRuntimeRegistry` (internal, `src/shared/tool-actions/runtime.ts`, 02 Task 13) | as listed | Tasks 2, 5, 6, 27 |
| `richTextFields` on each manifest entry | manifest | Task 17 |
| Table `ToolRuntime.normalize` | `normalizeTable`, registered on `BUILT_IN_TOOL_RUNTIMES.get('table')` (`src/shared/tool-actions/table.ts`, 02 Task 15) | Gate on live table writes (Task 18 note) |

**Needs from plan 03 (in-app surface):**

| Canonical name | Where | Used in |
|---|---|---|
| `renderAgentTools(contract, { format: 'mcp', handle: true, schema })` returning MCP `{ name, description, inputSchema, outputSchema }` with `handle` + `x-mcp-header: "Blok-Handle"` | `src/agent/render-tools.ts` | Task 6 |
| Browser drawing of a participant whose awareness carries `agent` and `agentCursor` | 03 | Task 29 (E2E only) |

**Co-owned with plan 01, not duplicated here:** the C# Jint path (`IBlokAgentExecutor`, `agentExecute` / `manifest` Jint ops, `RoomEditTranslator`, internal `Move` / `Retype` / `SetTunes` / `SetPageField` ops, `SeedAsync`/`ExportAsync` page root). Plan 01 Tasks 37–46 own all of it. This plan has no C# task.

**What plan 05 needs from this plan:**

| Item | Task |
|---|---|
| `@bloklabs/mcp` built by `yarn build:mcp`, runnable as `blok-mcp --source files:<dir>` over stdio (05's `mcp-stored` runner) | Tasks 1, 3, 13 |
| Live mode against `startServer` from `test/unit/server-conformance/run-against.ts`, ticket `user` = `actor.id` (05's `mcp-live` runner) | Tasks 21, 22 |
| `blok_execute` output `AgentResult & { delivery }`, `delivery.durable` only after acks (`ackedOnly` grader) | Tasks 16, 18 |
| Awareness `agentCursor` and `agent` fields (`agentVisible` grader) | Task 19 |
| Saved `lastEditedBy` = `actor.id`; journal `actors` names the agent (`attributed` grader) | Task 21 |
| `createBlokMcpServer` for in-process runners | Task 27 |
| `mcp-tools-from-renderer-law.test.ts` (05's renderer compare reuses it) | Task 6 |

---

## Facts checked for this plan (this session)

- `packages/cli/package.json` + `scripts/build-cli.mjs:16-38` + `packages/cli/bin/blok-cli.mjs` are the template: Vite `lib` build of `src/cli/index.ts` into `packages/cli/dist/cli.mjs`, externals listed, bin imports `../dist/cli.mjs`.
- `scripts/release-manifest.mjs` `FAMILY` lists packages in publish order; `test/unit/scripts/release-manifest.test.ts:15-25` pins that list. `scripts/release.mjs:290-297` `WORKSPACE_MANIFESTS` bumps versions; `:323` runs `node scripts/build-all.mjs --with-cli`. `scripts/build-all.mjs` adds the `cli` task only with `withCli`; `test/unit/scripts/build-all.test.ts:101-105` pins it.
- CI builds the CLI before unit tests (`.github/workflows/ci.yml:383`, `:426`), because `test/unit/cli/bin.test.ts` needs `packages/cli/dist`.
- Root scripts: `"build:cli": "node scripts/build-cli.mjs"` (`package.json:147`), `"test": "vitest run --project=unit --project=unit-angular"` (`:168`). The `unit` project runs `test/unit/**/*.test.ts` in jsdom (`vitest.config.ts:58-68`); Node tests opt in with `// @vitest-environment node` (as `blok-client-contract.test.ts:1`).
- `@modelcontextprotocol/server` 2.3.1 and `@modelcontextprotocol/client` 2.3.1 exist on npm (`npm view`, 2026-10-08). The server package's own README says it implements the 2026-07-28 spec and replaces `@modelcontextprotocol/sdk` 1.x. Read from its packed `.d.mts`: low-level `Server` with `setRequestHandler(method, handler(request, ctx))` (marked `@deprecated` in favour of `McpServer`, "only use Server for advanced use cases"); `serveStdio(factory, options)` serves both the 2025-era `initialize` opening and the 2026 era; `createMcpHandler(factory, options)` serves HTTP with `legacy: 'stateless'` by default; `McpServerFactory = (ctx: McpRequestContext) => McpServer | Server`, and `ctx.authInfo` carries HTTP auth; `InMemoryTransport.createLinkedPair()`; `requireBearerAuth`, `verifyBearerToken`, `OAuthTokenVerifier { verifyAccessToken(token): Promise<AuthInfo> }`; `AuthInfo { token, clientId, scopes, expiresAt?, resource?: URL, ... }`; `Server.projectCallToolResult(result, advertisedOutputSchema)` must be called by low-level `tools/call` authors. `SUPPORTED_PROTOCOL_VERSIONS` in core 2.3.1 includes `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`.
- Why low-level `Server`, not `McpServer.registerTool`: `registerTool` takes a Standard Schema and re-serializes it for `tools/list`; the law in Task 6 needs the renderer's JSON byte-for-byte. **Unverified:** that `fromJsonSchema` round-trips a schema unchanged.
- `ws` 8.21.0 is in `node_modules` (transitive). Its constructor takes `{ origin }` and writes the `Origin` header (`node_modules/ws/lib/websocket.js:798-800`) and supports `binaryType = 'arraybuffer'`. It is not a root dependency. `@types/ws` is not installed, so `src/mcp/ws-module.d.ts` declares the slice we use.
- Node's global `WebSocket` with a `headers` init is what the conformance test uses (`blok-client-contract.test.ts:216-234`, cast through `unknown`). This plan uses `ws` instead, so the engine floor stays `>=20.19.0`. **Unverified:** whether Node 20.19's global `WebSocket` is unflagged.
- `downloadOfflinePage` builds the headless seam (`src/components/modules/collaboration/headless-offline-page.ts:96-118`) and waits for `connected` + non-null `tag` (`:128-150`), 15 s timeout (`:88`). It builds `new YBlockSerializer()` with no options (`:32`), which defaults `htmlToSegments` to `htmlToSegmentsDom` (`src/components/modules/yjs/serializer.ts:345`). In Node the caller must pass `htmlToSegmentsNode`, as the conformance test does (`blok-client-contract.test.ts:306`).
- v2 is offered only with an outbox (`provider.ts:51-61`). The write tap: append each local update, then `provider.drain()`, only under `protocol === 'v2'` (`collaboration/index.ts:940-951`; the conformance test's copy at `blok-client-contract.test.ts:336-342`).
- `OperationStore.recordSession` must run before `appendLocal`: "rows can only be stamped once the meta names a lineage" (`operation-store.ts:145-149`). The Collaboration module calls it on every validated control frame (`collaboration/index.ts:1354-1356`). **Unverified:** what `appendLocal` does before `recordSession`; Task 17 pins it.
- `onOperationAcknowledged(serverSequence)` is called before the outbox `acknowledge(operationId)` (`types.ts:340-352`). A relineage quarantines with reason `lineage-reset` (`blok-client-contract.test.ts:71`, `:1234`); a 104 rejection quarantines with the frame's code (`provider.ts:663-668`, `types.ts:340-352`).
- `DocumentStore`: `transact(fn, origin: LocalOriginTag)` (`document-store.ts:2281`), `'local'` is a tag (`yjs/types.ts:73-80`), `onUpdate` skips remote (`:2399`), `enableAwareness` (`:2467`), `setAwarenessField` no-ops before enable (`:2482-2484`), `page` getter (`:222`).
- Presence writes `user` as `{ name?, color, id? }` with `presenceColorFor(clientId)` as the default color (`presence.ts:351-371`) and `activeAt: Date.now()` (`:380-392`). `isPresenceColor` / `presenceColorFor` are exported (`presence.ts:121`, `:172`).
- Ticket signer `blokTicket(secret, { user, doc?, write?, ttlSeconds? })` (`packages/server/src/ticket.ts:45-61`); `scripts/dev-ticket.mjs:12` already imports it from source. A ticket endpoint answers `{ "ticket": "<jwt>" }` (`src/components/utils/access-pass.ts:125-131`); `readTicketClaims(token)` decodes the payload (`access-pass.ts:67`).
- Conformance: `scripts/test-server-conformance.mjs:140-149` runs a fixed file list; a new conformance file must be added there. Files skip unless `BLOK_CONFORMANCE_SERVER` is set (`blok-client-contract.test.ts:48`). `startServer` is in `run-against.ts:159`. Ticket mode needs `--allow-origin` and an `Origin` header (`blok-client-contract.test.ts:470`, `:216-229`). `--conformance-journal` turns on v2 (`:451-453`).
- `getBlokVersion()` reads a `VERSION` define (`src/components/utils/version.ts:15-30`); `scripts/build-server-runtime.mjs:87` defines it.
- None of `src/agent/`, `src/mcp/`, `src/components/modules/agent/`, `src/shared/agent/`, `src/view/agent-runtime.ts` exist yet (`ls`, this session).

---

## File Structure

New package:

| File | Responsibility |
|---|---|
| `packages/mcp/package.json` | `@bloklabs/mcp` manifest: bin, exports, runtime deps `@modelcontextprotocol/server`, `ws` |
| `packages/mcp/bin/blok-mcp.mjs` | Installs the stdout guard, then loads `dist/mcp.mjs` and runs the CLI |
| `packages/mcp/types/index.d.ts` | Hand-authored public types: `BlokMcpOptions`, `createBlokMcpServer`, copied `AgentActor` / `ManifestOverrides` / `BlokCustomToolsFile` |
| `packages/mcp/README.md` | Usage, flags, auth, host duties, version lockstep |
| `scripts/build-mcp.mjs` | Vite lib build of `src/mcp/index.ts` and `src/mcp/stdout-guard.ts` |

New MCP source (`src/mcp/`, bundled, never imported by other `src/` modules):

| File | Responsibility |
|---|---|
| `src/mcp/index.ts` | Bundle entry: `createBlokMcpServer`, `runCli` |
| `src/mcp/options.ts` | Internal `BlokMcpOptions` and resolved defaults |
| `src/mcp/config.ts` | `parseMcpArgs(argv, env)` → `BlokMcpOptions`; `McpConfigError`; config refusals |
| `src/mcp/stdout-guard.ts` | `installStdoutGuard(console)` |
| `src/mcp/errors.ts` | `McpSurfaceError`, `surfaceError()`, `isMcpSurfaceError()` |
| `src/mcp/custom-tools-file.ts` | `parseCustomToolsFile`, `parseOverridesFile` |
| `src/mcp/contract.ts` | `buildMcpContracts()` → stored + live contracts and runtimes |
| `src/mcp/tools.ts` | `listMcpTools()`: rendered core tools + lifecycle tool schemas |
| `src/mcp/session.ts` | `HandleSession`, `Delivery`, `McpExecuteResult`, `NO_DELIVERY` |
| `src/mcp/handles.ts` | `HandleRegistry`: principal binding, idle expiry, cap, per-handle queue |
| `src/mcp/dispatcher.ts` | `createToolDispatcher()`: tool name + args + caller → `ToolOutcome` |
| `src/mcp/sdk-server.ts` | `buildSdkServer()`: SDK `Server` with `tools/list` + `tools/call` |
| `src/mcp/mode.ts` | `resolveMode()` |
| `src/mcp/actor.ts` | `defaultAgentActor()`, `safeClientName()` |
| `src/mcp/sources/types.ts` | `DocumentSource`, `LoadedDocument` |
| `src/mcp/sources/files.ts` | `createFilesSource(dir)` |
| `src/mcp/sources/endpoint.ts` | `createEndpointSource({ url, endpointAuth, list? }, fetchImpl)` |
| `src/mcp/stored-session.ts` | `openStoredSession()` → `HandleSession` |
| `src/mcp/live/node-socket.ts` | `nodeSocketFactory(origin)` over `ws` |
| `src/mcp/ws-module.d.ts` | Ambient declaration for the `ws` slice used |
| `src/mcp/live/presence.ts` | `AgentPresence`: `user`, `agent`, `blockId`, `activeAt`, `agentCursor`, activity rate limit |
| `src/mcp/live/live-session.ts` | `createLiveSession()` → `HandleSession` |
| `src/mcp/live/open-live.ts` | `createOpenLive()`: room + store session + presence for a live `blok_open` |
| `src/mcp/opener.ts` | `createOpener()`: mode, authorize, tickets, sessions for `blok_open` and page targets |
| `src/mcp/auth/tickets.ts` | `createTicketProvider()` |
| `src/mcp/auth/authorize.ts` | `loadAuthorizeHook()` |
| `src/mcp/auth/oauth.ts` | `createJwtVerifier()` (JWKS, RS256/ES256, `node:crypto`) |
| `src/mcp/http.ts` | `startHttpServer()`: Origin check, bearer auth, PRM, `createMcpHandler` |
| `src/mcp/page-titles.ts` | `createOpenPageDocument()` for `--page-titles page-map` |
| `src/mcp/server.ts` | `assembleMcp()`: wires contracts, registry, opener, dispatcher |

New core (`src/components/modules/collaboration/`, not published):

| File | Responsibility |
|---|---|
| `tracking-outbox.ts` | `TrackingOutbox`: wraps a `CollabOutbox`, tracks each row's fate (pending / acked / quarantined) |
| `headless-session.ts` | `openHeadlessRoom()`: a writing headless room member (store, memory op store, tracking outbox, provider, write tap, sync gate) |

Modified:

| File | Change |
|---|---|
| `package.json` (root) | `"build:mcp"` script; devDependency `@modelcontextprotocol/client` |
| `scripts/release-manifest.mjs` | `FAMILY` entry for `@bloklabs/mcp` |
| `scripts/release.mjs:290-297` | `packages/mcp/package.json` in `WORKSPACE_MANIFESTS` |
| `scripts/build-all.mjs` | `mcp` task beside `cli` under `withCli` |
| `scripts/test-server-conformance.mjs:140-149` | add `mcp-agent-participant.test.ts` |
| `.github/workflows/ci.yml:383`, `:426` | build MCP next to the CLI |

Tests (all new unless noted):

| File | Covers |
|---|---|
| `test/unit/scripts/release-manifest.test.ts` (modified) | FAMILY entry |
| `test/unit/scripts/build-all.test.ts` (modified) | `mcp` task |
| `test/unit/mcp/package.test.ts` | manifest, version parity, deps pinned |
| `test/unit/mcp/errors.test.ts`, `actor.test.ts` | error shape, agent actor id |
| `test/unit/mcp/stdout-guard.test.ts` | stdout law, in-process |
| `test/unit/mcp/bin.test.ts` | built bin: stdout is JSON-RPC only, exits on stdin EOF |
| `test/unit/mcp/config.test.ts` | flags, env, refusals |
| `test/unit/mcp/custom-tools-file.test.ts`, `contract.test.ts` | manifest file, contracts |
| `test/unit/architecture/mcp-tools-from-renderer-law.test.ts` | core tools = renderer output |
| `test/unit/mcp/handles.test.ts`, `dispatcher.test.ts`, `sdk-server.test.ts` | registry, dispatch, SDK wiring |
| `test/unit/mcp/sources-files.test.ts`, `sources-endpoint.test.ts`, `stored-session.test.ts`, `mode.test.ts`, `stored-e2e.test.ts` | stored mode |
| `test/unit/mcp/node-socket.test.ts`, `presence.test.ts`, `live-session.test.ts`, `open-live.test.ts` | live mode units |
| `test/unit/components/modules/collaboration/tracking-outbox.test.ts`, `headless-session.test.ts` | core room member |
| `test/unit/server-conformance/mcp-agent-participant.test.ts` | live mode against the C# host |
| `test/unit/mcp/tickets.test.ts`, `authorize.test.ts`, `oauth.test.ts`, `http.test.ts` | auth |
| `test/unit/mcp/page-titles.test.ts` | page-map opt-in |
| `test/unit/mcp/public-types.test.ts`, `readme.test.ts` | type drift, README covers every flag |
| `test/playwright/tests/agent/mcp-participant.spec.ts` | browser sees the agent |

## Phases

| Phase | Tasks | Ends with |
|---|---|---|
| 1. Package scaffold and tool surface | 1–9 | Checkpoint 1 |
| 2. Stored-document mode | 10–14 | Checkpoint 2 |
| 3. Live-room mode | 15–21 | Checkpoint 3 |
| 4. Auth and tickets | 22–25 | Checkpoint 4 |
| 5. Page titles opt-in | 26 | Checkpoint 5 |
| 6. Packaging, docs, E2E | 27–29 | Final checkpoint |

Do not start a phase before the previous checkpoint passes.

**Run-ahead exceptions (06 §14 "Execution order").** Tasks 15, 16, 17 (Node socket, tracking outbox, headless room member; Phase 3) and Task 24 (JWKS verifier; Phase 4) use no 01/02/03 code and may run in wave 0. Task 2 waits for 01 Task 17 (`ContractSlice`); Task 5 for 01 Task 21; Task 6 for 03 Task 5. Every other task keeps this plan's order.

---

## Phase 1 — Package scaffold and tool surface

### Task 1: `@bloklabs/mcp` package, build script, release wiring

**Files:**
- Create: `packages/mcp/package.json`, `packages/mcp/bin/blok-mcp.mjs` (temporary body, finished in Task 3), `scripts/build-mcp.mjs`, `src/mcp/index.ts` (stub), `src/mcp/stdout-guard.ts` (stub), `test/unit/mcp/package.test.ts`
- Modify: `package.json` (root, `scripts`: add `"build:mcp"` after `"build:cli"` at `:147`; `devDependencies`: add `"@modelcontextprotocol/client": "2.3.1"`), `scripts/release-manifest.mjs` (FAMILY, after the `@bloklabs/server` entry), `scripts/release.mjs:290-297`, `scripts/build-all.mjs` (`withCli` block), `.github/workflows/ci.yml:383` and `:426`
- Test: `test/unit/scripts/release-manifest.test.ts:15-25`, `test/unit/scripts/build-all.test.ts:101-105`, `test/unit/mcp/package.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: package `@bloklabs/mcp` (version = root version), `yarn build:mcp` → `packages/mcp/dist/mcp.mjs` + `packages/mcp/dist/stdout-guard.mjs`; build-all task named `mcp`; `FAMILY` entry `{ npmName: '@bloklabs/mcp', gprName: '@dodopizza/blok-mcp', manifestPath: 'packages/mcp/package.json', packDir: 'packages/mcp' }`.

- [ ] **Step 1: Write the failing tests**

In `test/unit/scripts/release-manifest.test.ts`, extend the expected list at `:16-24`:

```ts
    expect(FAMILY.map((p) => [p.npmName, p.gprName])).toEqual([
      ['@bloklabs/core', '@dodopizza/blok'],
      ['@bloklabs/react', '@dodopizza/blok-react'],
      ['@bloklabs/vue', '@dodopizza/blok-vue'],
      ['@bloklabs/angular', '@dodopizza/blok-angular'],
      ['@bloklabs/cli', '@dodopizza/blok-cli'],
      ['@bloklabs/presets', '@dodopizza/blok-presets'],
      ['@bloklabs/server', '@dodopizza/blok-server'],
      ['@bloklabs/mcp', '@dodopizza/blok-mcp'],
    ]);
```

In `test/unit/scripts/build-all.test.ts`, add after the `cli` assertions at `:103-105`:

```ts
    expect(tasks.get('mcp')?.cmd).toBe('node scripts/build-mcp.mjs');
    expect(tasks.get('mcp')?.deps ?? []).not.toContain('main');
    expect(buildTasks({ mode: 'production' }).some((t) => t.name === 'mcp')).toBe(false);
```

Create `test/unit/mcp/package.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(ROOT, path), 'utf-8')) as Record<string, unknown>;

describe('@bloklabs/mcp manifest', () => {
  const pkg = readJson('packages/mcp/package.json');

  it('is the lockstep family version', () => {
    expect(pkg.version).toBe(readJson('package.json').version);
  });

  it('ships the blok-mcp bin, dist and types only', () => {
    expect(pkg.name).toBe('@bloklabs/mcp');
    expect(pkg.bin).toEqual({ 'blok-mcp': 'bin/blok-mcp.mjs' });
    expect(pkg.files).toEqual(['bin', 'dist', 'types']);
    expect(pkg.type).toBe('module');
  });

  it('pins its runtime dependencies exactly', () => {
    expect(pkg.dependencies).toEqual({ '@modelcontextprotocol/server': '2.3.1', ws: '8.21.0' });
  });

  it('copies the core engine floor', () => {
    expect(pkg.engines).toEqual({ node: '>=20.19.0' });
  });

  it('is bumped by the release script', () => {
    expect(readFileSync(resolve(ROOT, 'scripts/release.mjs'), 'utf-8')).toContain("'packages/mcp/package.json'");
  });

  it('has a root build script', () => {
    expect((readJson('package.json').scripts as Record<string, string>)['build:mcp']).toBe('node scripts/build-mcp.mjs');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn test test/unit/scripts/release-manifest.test.ts test/unit/scripts/build-all.test.ts test/unit/mcp/package.test.ts`
Expected: FAIL. `release-manifest` misses `@bloklabs/mcp`; `build-all` has no `mcp` task; `package.test.ts` cannot read `packages/mcp/package.json` (ENOENT).

Memory note (`blok-agent-gate-traps.md`): a multi-path vitest run can skip files. If any of the three is not listed in the output, run it alone.

- [ ] **Step 3: Write the minimal implementation**

`packages/mcp/package.json` (set `version` to the root `version` at the time you run this; it is `1.16.1` on `30c77599`):

```json
{
  "name": "@bloklabs/mcp",
  "version": "1.16.1",
  "description": "MCP server for Blok — lets outside agents read and edit Blok documents, in live rooms or stored.",
  "license": "Apache-2.0",
  "author": "JackUait",
  "homepage": "https://blokeditor.com",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/JackUait/blok.git",
    "directory": "packages/mcp"
  },
  "bugs": {
    "url": "https://github.com/JackUait/blok/issues"
  },
  "keywords": ["blok", "mcp", "model-context-protocol", "agent", "block-editor", "rich-text-editor", "collaboration"],
  "type": "module",
  "exports": {
    ".": {
      "types": "./types/index.d.ts",
      "import": "./dist/mcp.mjs"
    },
    "./package.json": "./package.json"
  },
  "bin": {
    "blok-mcp": "bin/blok-mcp.mjs"
  },
  "files": ["bin", "dist", "types"],
  "engines": {
    "node": ">=20.19.0"
  },
  "publishConfig": {
    "access": "public"
  },
  "dependencies": {
    "@modelcontextprotocol/server": "2.3.1",
    "ws": "8.21.0"
  }
}
```

`scripts/build-mcp.mjs`:

```js
import { build } from 'vite';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const version = JSON.parse(readFileSync(path.resolve(__dirname, '../packages/mcp/package.json'), 'utf-8')).version;

async function buildMcp() {
  console.log('Building MCP server...');

  await build({
    configFile: false,
    build: {
      copyPublicDir: false,
      // Runs in Node only: keeps node: built-ins external instead of polyfilling them.
      ssr: true,
      target: 'node20',
      emptyOutDir: true,
      outDir: path.resolve(__dirname, '../packages/mcp/dist'),
      lib: {
        entry: {
          mcp: path.resolve(__dirname, '../src/mcp/index.ts'),
          // Separate file: the bin loads it BEFORE the bundle, so bundled code that logs at import cannot reach stdout.
          'stdout-guard': path.resolve(__dirname, '../src/mcp/stdout-guard.ts'),
        },
        formats: ['es'],
        fileName: (_format, name) => `${name}.mjs`,
      },
      rollupOptions: {
        // Must match packages/mcp/package.json dependencies; anything else is bundled.
        external: [/^node:/, /^@modelcontextprotocol\/server(\/.*)?$/, 'ws'],
      },
    },
    // Same define the editor and the server runtime use; getBlokVersion() reads it.
    define: { VERSION: JSON.stringify(version) },
  });

  console.log('MCP server built successfully');
}

buildMcp().catch((error) => {
  console.error('Failed to build MCP server:', error);
  process.exit(1);
});
```

`src/mcp/index.ts` (stub, replaced in Task 9):

```ts
export const runCli = async (_argv: string[], _env: NodeJS.ProcessEnv): Promise<void> => {
  throw new Error('blok-mcp: not implemented yet');
};
```

`src/mcp/stdout-guard.ts` (stub, finished in Task 3):

```ts
export const installStdoutGuard = (_target: Console): void => {};
```

`packages/mcp/bin/blok-mcp.mjs` (temporary):

```js
#!/usr/bin/env node
import { runCli } from '../dist/mcp.mjs';

await runCli(process.argv.slice(2), process.env);
```

Root `package.json` `scripts`, after `"build:cli"`:

```json
    "build:mcp": "node scripts/build-mcp.mjs",
```

Root `package.json` `devDependencies` (alphabetical position):

```json
    "@modelcontextprotocol/client": "2.3.1",
```

`scripts/release-manifest.mjs`, append to `FAMILY` after the server entry:

```js
  {
    // Bundles its own copy of core (like cli), so no @bloklabs/core peer.
    npmName: '@bloklabs/mcp',
    gprName: '@dodopizza/blok-mcp',
    manifestPath: 'packages/mcp/package.json',
    packDir: 'packages/mcp',
  },
```

`scripts/release.mjs` `WORKSPACE_MANIFESTS`, add `'packages/mcp/package.json',` after `'packages/server/package.json',`.

`scripts/build-all.mjs`, in the `if (withCli)` block:

```js
  if (withCli) {
    tasks.push({ name: 'cli', cmd: 'node scripts/build-cli.mjs', deps: ['fonts'] });
    tasks.push({ name: 'mcp', cmd: 'node scripts/build-mcp.mjs', deps: ['fonts'] });
  }
```

`.github/workflows/ci.yml` at `:383` and `:426`, after each `run: yarn build:cli` step add:

```yaml
      - name: Build MCP
        run: yarn build:mcp
```

Then install so `yarn.lock` records the new deps: `yarn install`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn test test/unit/scripts/release-manifest.test.ts`, then `yarn test test/unit/scripts/build-all.test.ts`, then `yarn test test/unit/mcp/package.test.ts`
Expected: PASS each.
Run: `yarn build:mcp`
Expected: `packages/mcp/dist/mcp.mjs` and `packages/mcp/dist/stdout-guard.mjs` exist.
Check `packages/mcp/.gitignore` is not needed: `git status --porcelain packages/mcp` must not list `dist/` or `node_modules/`. If it does, add `packages/mcp/dist/` the same way `packages/cli/dist` is ignored (find it with `git check-ignore -v packages/cli/dist/cli.mjs`).

- [ ] **Step 5: Lint changed files**

Run: `npx eslint scripts/build-mcp.mjs scripts/release-manifest.mjs scripts/release.mjs scripts/build-all.mjs src/mcp/index.ts src/mcp/stdout-guard.ts test/unit/mcp/package.test.ts test/unit/scripts/release-manifest.test.ts test/unit/scripts/build-all.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/package.json packages/mcp/bin/blok-mcp.mjs scripts/build-mcp.mjs src/mcp/index.ts src/mcp/stdout-guard.ts \
  package.json yarn.lock scripts/release-manifest.mjs scripts/release.mjs scripts/build-all.mjs .github/workflows/ci.yml \
  test/unit/mcp/package.test.ts test/unit/scripts/release-manifest.test.ts test/unit/scripts/build-all.test.ts
git diff --cached --name-only   # must list exactly the paths above
git commit -m "feat(mcp): scaffold @bloklabs/mcp package and release wiring" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Errors and session types

**Files:**
- Create: `src/mcp/errors.ts`, `src/mcp/session.ts`, `test/unit/mcp/errors.test.ts`

**Interfaces:**
- Consumes: from 01, `AgentError`, `AgentErrorCode`, `AgentResult`, `AgentBatch`, `DocumentView`, `ViewArgs`, `ContractSlice` (`types/agent.d.ts`, 01 Tasks 1, 17); from 02, `AgentContract` (`types/tool-manifest.d.ts`, 02 Task 3).
- Produces:
  - `class McpSurfaceError extends Error { readonly agentError: AgentError }`
  - `surfaceError(code: AgentErrorCode, message: string, details?: Record<string, unknown>): McpSurfaceError`
  - `isMcpSurfaceError(value: unknown): value is McpSurfaceError`
  - `type Durability = 'acknowledged' | 'best-effort' | 'saved-on-execute'`
  - `interface Delivery { durable: boolean; pending: boolean; serverSequence: string | null; savedVersion: string | null }`
  - `type McpExecuteResult = AgentResult & { delivery: Delivery }`
  - `const NO_DELIVERY: Delivery`
  - `interface CloseSummary { unsavedBatches: number; hostRecordLags: boolean }`
  - `interface HandleSession { readonly mode: 'live' | 'stored'; readonly write: boolean; readonly durability: Durability; readonly contractRevision: string; read(args: ViewArgs): Promise<DocumentView>; describe(query: { tool?: string; command?: string }): AgentContract | ContractSlice; execute(batch: AgentBatch): Promise<McpExecuteResult>; close(reason: 'closed' | 'expired'): Promise<CloseSummary> }`
  - `failedResult(error: AgentError, warnings?: AgentResult['warnings']): McpExecuteResult` (an `ok: false` result with no `revision` and `NO_DELIVERY`)

- [ ] **Step 1: Write the failing test**

`test/unit/mcp/errors.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { failedResult, isMcpSurfaceError, NO_DELIVERY, surfaceError } from '../../../src/mcp/errors';

describe('surface errors', () => {
  it('carries one AgentError with a code from the shared union', () => {
    const error = surfaceError('UNKNOWN_HANDLE', 'No open document has this handle. Call blok_open again.');

    expect(isMcpSurfaceError(error)).toBe(true);
    expect(error.agentError).toEqual({
      code: 'UNKNOWN_HANDLE',
      message: 'No open document has this handle. Call blok_open again.',
      retryable: false,
    });
  });

  it('marks transient codes retryable', () => {
    expect(surfaceError('ROOM_SYNC_TIMEOUT', 'x').agentError.retryable).toBe(true);
    expect(surfaceError('SOURCE_UNAVAILABLE', 'x').agentError.retryable).toBe(true);
    expect(surfaceError('DOCUMENT_CHANGED', 'x').agentError.retryable).toBe(true);
    expect(surfaceError('FORBIDDEN', 'x').agentError.retryable).toBe(false);
  });

  it('keeps details', () => {
    expect(surfaceError('REJECTED', 'x', { rejectionCode: 'oversized-update' }).agentError.details)
      .toEqual({ rejectionCode: 'oversized-update' });
  });

  it('builds a pre-session failure with no revision', () => {
    const result = failedResult(surfaceError('UNKNOWN_HANDLE', 'gone').agentError);

    expect(result).toEqual({
      ok: false,
      error: { code: 'UNKNOWN_HANDLE', message: 'gone', retryable: false },
      warnings: [],
      delivery: NO_DELIVERY,
    });
    expect('revision' in result).toBe(false);
  });

  it('never reports durable work in NO_DELIVERY', () => {
    expect(NO_DELIVERY).toEqual({ durable: false, pending: false, serverSequence: null, savedVersion: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/mcp/errors.test.ts`
Expected: FAIL, "Cannot find module '../../../src/mcp/errors'".

- [ ] **Step 3: Write minimal implementation**

`src/mcp/session.ts`:

```ts
import type { AgentBatch, AgentResult, DocumentView, ViewArgs } from '../shared/agent';
import type { ContractSlice } from '../../types/agent';
import type { AgentContract } from '../../types/tool-manifest';

export type Durability = 'acknowledged' | 'best-effort' | 'saved-on-execute';

export interface Delivery {
  durable: boolean;
  pending: boolean;
  serverSequence: string | null;
  savedVersion: string | null;
}

export type McpExecuteResult = AgentResult & { delivery: Delivery };

export interface CloseSummary {
  unsavedBatches: number;
  hostRecordLags: boolean;
}

export interface HandleSession {
  readonly mode: 'live' | 'stored';
  readonly write: boolean;
  readonly durability: Durability;
  readonly contractRevision: string;
  read(args: ViewArgs): Promise<DocumentView>;
  describe(query: { tool?: string; command?: string }): AgentContract | ContractSlice;
  execute(batch: AgentBatch): Promise<McpExecuteResult>;
  close(reason: 'closed' | 'expired'): Promise<CloseSummary>;
}
```

`src/mcp/errors.ts`:

```ts
import type { AgentError, AgentErrorCode, AgentResult } from '../shared/agent';
import type { Delivery, McpExecuteResult } from './session';

export type { Delivery } from './session';

// A retry can succeed without the agent changing anything (DOCUMENT_CHANGED after a re-read).
const RETRYABLE = new Set<AgentErrorCode>(['ROOM_SYNC_TIMEOUT', 'SOURCE_UNAVAILABLE', 'DOCUMENT_CHANGED', 'HANDLE_LIMIT']);

export class McpSurfaceError extends Error {
  public readonly agentError: AgentError;

  constructor(code: AgentErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'McpSurfaceError';
    this.agentError = { code, message, retryable: RETRYABLE.has(code), ...(details !== undefined && { details }) };
  }
}

export const surfaceError = (code: AgentErrorCode, message: string, details?: Record<string, unknown>): McpSurfaceError =>
  new McpSurfaceError(code, message, details);

export const isMcpSurfaceError = (value: unknown): value is McpSurfaceError => value instanceof McpSurfaceError;

export const NO_DELIVERY: Delivery = Object.freeze({ durable: false, pending: false, serverSequence: null, savedVersion: null });

export const failedResult = (error: AgentError, warnings: AgentResult['warnings'] = []): McpExecuteResult => ({
  ok: false,
  error,
  warnings,
  delivery: NO_DELIVERY,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/mcp/errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/mcp/errors.ts src/mcp/session.ts test/unit/mcp/errors.test.ts
git add src/mcp/errors.ts src/mcp/session.ts test/unit/mcp/errors.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): surface errors and handle session types" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: stdout guard and the bin

**Files:**
- Modify: `src/mcp/stdout-guard.ts`, `packages/mcp/bin/blok-mcp.mjs`
- Create: `test/unit/mcp/stdout-guard.test.ts`, `test/unit/mcp/bin.test.ts`

**Interfaces:**
- Consumes: `runCli` from `src/mcp/index.ts` (real body lands in Task 9; the bin test here runs only after Task 9 — see Step 6).
- Produces: `installStdoutGuard(target: Console): void` — afterwards `target.log`, `target.info`, `target.debug` write to stderr through `target.error`.

- [ ] **Step 1: Write the failing test**

`test/unit/mcp/stdout-guard.test.ts`:

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installStdoutGuard } from '../../../src/mcp/stdout-guard';

describe('stdout law (in-process)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends log, info and debug to stderr, never stdout', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const target = new console.Console({ stdout: process.stdout, stderr: process.stderr });

    installStdoutGuard(target);
    target.log('from bundled core');
    target.info('info');
    target.debug('debug');

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr.mock.calls.map((call) => String(call[0]))).toEqual(['from bundled core\n', 'info\n', 'debug\n']);
  });

  it('leaves warn and error on stderr', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const target = new console.Console({ stdout: process.stdout, stderr: process.stderr });

    installStdoutGuard(target);
    target.warn('w');
    target.error('e');

    expect(stdout).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/mcp/stdout-guard.test.ts`
Expected: FAIL. `stdout.write` was called with `from bundled core\n` (the stub does nothing).

- [ ] **Step 3: Write minimal implementation**

`src/mcp/stdout-guard.ts`:

```ts
/**
 * stdio MCP: stdout carries only JSON-RPC messages. Bundled core code may log,
 * so every stdout-bound console method is pointed at stderr.
 */
export const installStdoutGuard = (target: Console): void => {
  const toStderr = (...args: unknown[]): void => target.error(...args);

  target.log = toStderr;
  target.info = toStderr;
  target.debug = toStderr;
};
```

`packages/mcp/bin/blok-mcp.mjs`:

```js
#!/usr/bin/env node
// Guard first, bundle second: a log at bundle import time would corrupt the stdio stream.
import { installStdoutGuard } from '../dist/stdout-guard.mjs';

installStdoutGuard(console);

const { runCli } = await import('../dist/mcp.mjs');

await runCli(process.argv.slice(2), process.env);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/mcp/stdout-guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the built-bin test (runs green only after Task 9)**

`test/unit/mcp/bin.test.ts` mirrors `test/unit/cli/bin.test.ts` (it needs `yarn build:mcp`, which CI now runs):

```ts
// @vitest-environment node
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const BIN = resolve(__dirname, '../../../packages/mcp/bin/blok-mcp.mjs');
const DIST = resolve(__dirname, '../../../packages/mcp/dist/mcp.mjs');
const TIMEOUT_MS = 60_000;

const dirs: string[] = [];

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe('blok-mcp binary', () => {
  it('dist/mcp.mjs exists (requires yarn build:mcp)', () => {
    expect(existsSync(DIST)).toBe(true);
  });

  it('answers initialize on stdout with JSON-RPC only, and exits when stdin closes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'blok-mcp-bin-'));

    dirs.push(dir);
    const child = spawn(process.execPath, [BIN, '--source', `files:${dir}`], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bin-test', version: '0' } },
    })}\n`);

    await new Promise<void>((done, fail) => {
      const deadline = setTimeout(() => fail(new Error(`no initialize answer; stdout=${stdout}`)), 20_000);

      child.stdout.on('data', () => {
        if (stdout.includes('\n')) {
          clearTimeout(deadline);
          done();
        }
      });
    });

    const exit = new Promise<number | null>((done) => child.once('exit', (code) => done(code)));

    child.stdin.end();

    expect(await exit).toBe(0);

    const lines = stdout.split('\n').filter((line) => line !== '');

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(JSON.parse(line)).toMatchObject({ jsonrpc: '2.0' });
    }
    expect(JSON.parse(lines[0])).toMatchObject({ id: 1, result: { serverInfo: { name: 'blok-mcp' } } });
  }, TIMEOUT_MS);
});
```

- [ ] **Step 6: Commit (bin test is red until Task 9)**

The bin test fails now (`runCli` throws). Do not commit a red test. Commit only the guard now; add `bin.test.ts` in Task 9's commit, where it goes green.

```bash
npx eslint src/mcp/stdout-guard.ts test/unit/mcp/stdout-guard.test.ts
git add src/mcp/stdout-guard.ts packages/mcp/bin/blok-mcp.mjs test/unit/mcp/stdout-guard.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): keep stdout for JSON-RPC only" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Keep `test/unit/mcp/bin.test.ts` unstaged until Task 9.

---

### Task 4: Config parsing and refusals

**Files:**
- Create: `src/mcp/options.ts`, `src/mcp/config.ts`, `test/unit/mcp/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`src/mcp/options.ts`, the internal mirror of the public `BlokMcpOptions` in spec §5.1, plus `principal`):

```ts
export interface BlokMcpOptions {
  transport: { kind: 'stdio' } | { kind: 'http'; listen: string; public?: boolean };
  auth: { kind: 'none' } | { kind: 'oauth'; issuer: string; audience: string; jwksUrl: string };
  sync?: { url: string; origin?: string };
  tickets?: { kind: 'secret'; secret: string } | { kind: 'url'; url: string; hostToken: string };
  authorize?: (principal: string, documentId: string, write: boolean) => Promise<boolean>;
  agentActor?: (principal: string, clientName: string) => AgentActor;
  source?: { kind: 'endpoint'; url: string; endpointAuth: string; list?: string } | { kind: 'files'; dir: string };
  manifest?: BlokCustomToolsFile;
  pageTitles?: 'off' | 'page-map';
  overrides?: ManifestOverrides;
  richTextFields?: Record<string, string[]>;
  schema?: 'envelope' | 'full';
  handleIdleMs?: number;
  maxHandlesPerPrincipal?: number;
  /** stdio principal; default 'local'. */
  principal?: string;
}
export const DEFAULTS: { handleIdleMs: 600_000; maxHandlesPerPrincipal: 8; schema: 'envelope'; pageTitles: 'off'; principal: 'local' };
```

- `src/mcp/config.ts`:
  - `class McpConfigError extends Error`
  - `interface ParsedCli { options: Omit<BlokMcpOptions, 'authorize' | 'manifest' | 'overrides'>; files: { manifest?: string; overrides?: string; authorize?: string } }`
  - `parseMcpArgs(argv: string[], env: Record<string, string | undefined>): ParsedCli` — flags win over env (as `packages/server/README.md:220`).
  - `checkOptionSafety(options: BlokMcpOptions): void` — throws `McpConfigError` for: non-loopback `--http` without `--public`; `--public` with `auth.kind === 'none'`; `--ticket-url` without `BLOK_MCP_HOST_TOKEN`; `--sync-url` without any ticket mode is allowed (a no-auth room).

- [ ] **Step 1: Write the failing test**

`test/unit/mcp/config.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkOptionSafety, McpConfigError, parseMcpArgs } from '../../../src/mcp/config';

describe('parseMcpArgs', () => {
  it('defaults to stdio, no auth, no sync', () => {
    const { options } = parseMcpArgs(['--source', 'files:./docs'], {});

    expect(options.transport).toEqual({ kind: 'stdio' });
    expect(options.auth).toEqual({ kind: 'none' });
    expect(options.sync).toBeUndefined();
    expect(options.source).toEqual({ kind: 'files', dir: './docs' });
  });

  it('reads endpoint source with BLOK_DOC_ENDPOINT_AUTH', () => {
    const { options } = parseMcpArgs(['--source', 'endpoint:https://app.example.com/api/docs'], { BLOK_DOC_ENDPOINT_AUTH: 'Bearer s3cret' });

    expect(options.source).toEqual({ kind: 'endpoint', url: 'https://app.example.com/api/docs', endpointAuth: 'Bearer s3cret' });
  });

  it('lets a flag win over its env var', () => {
    const { options } = parseMcpArgs(['--sync-url', 'ws://flag'], { BLOK_SYNC_URL: 'ws://env' });

    expect(options.sync?.url).toBe('ws://flag');
  });

  it('reads sync, origin and tickets from env', () => {
    const { options } = parseMcpArgs([], {
      BLOK_SYNC_URL: 'ws://127.0.0.1:4000/sync',
      BLOK_MCP_ORIGIN: 'http://localhost:5173',
      BLOK_SECRET: 'x'.repeat(32),
    });

    expect(options.sync).toEqual({ url: 'ws://127.0.0.1:4000/sync', origin: 'http://localhost:5173' });
    expect(options.tickets).toEqual({ kind: 'secret', secret: 'x'.repeat(32) });
  });

  it('prefers a ticket URL over a secret and needs the host token', () => {
    const { options } = parseMcpArgs(['--ticket-url', 'https://app/tickets'], { BLOK_SECRET: 'x'.repeat(32), BLOK_MCP_HOST_TOKEN: 't' });

    expect(options.tickets).toEqual({ kind: 'url', url: 'https://app/tickets', hostToken: 't' });
    expect(() => parseMcpArgs(['--ticket-url', 'https://app/tickets'], {})).toThrow(McpConfigError);
  });

  it('reads numeric and enum flags', () => {
    const { options } = parseMcpArgs(
      ['--handle-idle-ms', '1000', '--max-handles', '2', '--schema', 'full', '--page-titles', 'page-map'],
      {},
    );

    expect(options).toMatchObject({ handleIdleMs: 1000, maxHandlesPerPrincipal: 2, schema: 'full', pageTitles: 'page-map' });
  });

  it('refuses bad enum and number values', () => {
    expect(() => parseMcpArgs(['--schema', 'loose'], {})).toThrow(McpConfigError);
    expect(() => parseMcpArgs(['--max-handles', '0'], {})).toThrow(McpConfigError);
    expect(() => parseMcpArgs(['--source', 'ftp:x'], {})).toThrow(McpConfigError);
  });

  it('reads rich text fields JSON from flag or env', () => {
    expect(parseMcpArgs([], { BLOK_RICH_TEXT_FIELDS: '{"callout":["title"]}' }).options.richTextFields).toEqual({ callout: ['title'] });
  });

  it('collects file-backed options for later loading', () => {
    expect(parseMcpArgs(['--manifest', 'm.json', '--manifest-overrides', 'o.json', '--authorize', './auth.mjs'], {}).files)
      .toEqual({ manifest: 'm.json', overrides: 'o.json', authorize: './auth.mjs' });
  });

  it('reads http and oauth', () => {
    const { options } = parseMcpArgs(
      ['--http', '127.0.0.1:4100', '--auth', 'oauth', '--oauth-issuer', 'https://id', '--oauth-audience', 'https://mcp', '--oauth-jwks', 'https://id/jwks'],
      {},
    );

    expect(options.transport).toEqual({ kind: 'http', listen: '127.0.0.1:4100' });
    expect(options.auth).toEqual({ kind: 'oauth', issuer: 'https://id', audience: 'https://mcp', jwksUrl: 'https://id/jwks' });
  });

  it('refuses oauth without all three settings', () => {
    expect(() => parseMcpArgs(['--auth', 'oauth', '--oauth-issuer', 'https://id'], {})).toThrow(McpConfigError);
  });
});

describe('checkOptionSafety', () => {
  const base = parseMcpArgs([], {}).options;

  it('refuses a non-loopback bind without --public', () => {
    expect(() => checkOptionSafety({ ...base, transport: { kind: 'http', listen: '0.0.0.0:4100' } })).toThrow(/--public/);
  });

  it('refuses --public without auth', () => {
    expect(() => checkOptionSafety({ ...base, transport: { kind: 'http', listen: '0.0.0.0:4100', public: true } })).toThrow(/auth/);
  });

  it('allows loopback http without auth', () => {
    expect(() => checkOptionSafety({ ...base, transport: { kind: 'http', listen: '127.0.0.1:4100' } })).not.toThrow();
    expect(() => checkOptionSafety({ ...base, transport: { kind: 'http', listen: '[::1]:4100' } })).not.toThrow();
    expect(() => checkOptionSafety({ ...base, transport: { kind: 'http', listen: 'localhost:4100' } })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/mcp/config.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

`src/mcp/options.ts`:

```ts
import type { AgentActor } from '../shared/agent';
import type { BlokCustomToolsFile, ManifestOverrides } from '../../types/tool-manifest';

export interface BlokMcpOptions {
  transport: { kind: 'stdio' } | { kind: 'http'; listen: string; public?: boolean };
  auth: { kind: 'none' } | { kind: 'oauth'; issuer: string; audience: string; jwksUrl: string };
  sync?: { url: string; origin?: string };
  tickets?: { kind: 'secret'; secret: string } | { kind: 'url'; url: string; hostToken: string };
  authorize?: (principal: string, documentId: string, write: boolean) => Promise<boolean>;
  agentActor?: (principal: string, clientName: string) => AgentActor;
  source?: { kind: 'endpoint'; url: string; endpointAuth: string; list?: string } | { kind: 'files'; dir: string };
  manifest?: BlokCustomToolsFile;
  pageTitles?: 'off' | 'page-map';
  overrides?: ManifestOverrides;
  richTextFields?: Record<string, string[]>;
  schema?: 'envelope' | 'full';
  handleIdleMs?: number;
  maxHandlesPerPrincipal?: number;
  principal?: string;
}

export const DEFAULTS = {
  handleIdleMs: 600_000,
  maxHandlesPerPrincipal: 8,
  schema: 'envelope',
  pageTitles: 'off',
  principal: 'local',
} as const;
```

`src/mcp/config.ts`:

```ts
import type { BlokMcpOptions } from './options';

export class McpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpConfigError';
  }
}

export interface ParsedCli {
  options: Omit<BlokMcpOptions, 'authorize' | 'manifest' | 'overrides'>;
  files: { manifest?: string; overrides?: string; authorize?: string };
}

type Env = Record<string, string | undefined>;

const flag = (argv: string[], name: string): string | undefined => {
  const index = argv.indexOf(name);

  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];

  if (value === undefined || value.startsWith('--')) {
    throw new McpConfigError(`${name} needs a value`);
  }

  return value;
};

const positiveInt = (name: string, raw: string | undefined): number | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);

  if (!Number.isInteger(value) || value < 1) {
    throw new McpConfigError(`${name} must be a positive integer, got "${raw}"`);
  }

  return value;
};

const oneOf = <T extends string>(name: string, raw: string | undefined, allowed: readonly T[]): T | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  const match = allowed.find((value) => value === raw);

  if (match === undefined) {
    throw new McpConfigError(`${name} must be one of ${allowed.join(', ')}, got "${raw}"`);
  }

  return match;
};

const parseSource = (raw: string | undefined, env: Env, list: string | undefined): BlokMcpOptions['source'] => {
  if (raw === undefined) {
    return undefined;
  }
  if (raw.startsWith('files:')) {
    return { kind: 'files', dir: raw.slice('files:'.length) };
  }
  if (raw.startsWith('endpoint:')) {
    return {
      kind: 'endpoint',
      url: raw.slice('endpoint:'.length),
      endpointAuth: env.BLOK_DOC_ENDPOINT_AUTH ?? '',
      ...(list !== undefined && { list }),
    };
  }
  throw new McpConfigError(`--source must be files:<dir> or endpoint:<url>, got "${raw}"`);
};

const parseRichTextFields = (raw: string | undefined): Record<string, string[]> | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(raw);
  const valid = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    && Object.values(parsed).every((fields) => Array.isArray(fields) && fields.every((field) => typeof field === 'string'));

  if (!valid) {
    throw new McpConfigError('--rich-text-fields must be JSON like {"callout":["title"]}');
  }

  return parsed as Record<string, string[]>;
};

const parseAuth = (argv: string[], kind: 'none' | 'oauth'): BlokMcpOptions['auth'] => {
  if (kind === 'none') {
    return { kind: 'none' };
  }
  const issuer = flag(argv, '--oauth-issuer');
  const audience = flag(argv, '--oauth-audience');
  const jwksUrl = flag(argv, '--oauth-jwks');

  if (issuer === undefined || audience === undefined || jwksUrl === undefined) {
    throw new McpConfigError('--auth oauth needs --oauth-issuer, --oauth-audience and --oauth-jwks');
  }

  return { kind: 'oauth', issuer, audience, jwksUrl };
};

const parseTickets = (ticketUrl: string | undefined, env: Env): BlokMcpOptions['tickets'] => {
  if (ticketUrl !== undefined) {
    const hostToken = env.BLOK_MCP_HOST_TOKEN;

    if (hostToken === undefined || hostToken === '') {
      throw new McpConfigError('--ticket-url needs BLOK_MCP_HOST_TOKEN');
    }

    return { kind: 'url', url: ticketUrl, hostToken };
  }

  return env.BLOK_SECRET !== undefined && env.BLOK_SECRET !== '' ? { kind: 'secret', secret: env.BLOK_SECRET } : undefined;
};

export const parseMcpArgs = (argv: string[], env: Env): ParsedCli => {
  const http = flag(argv, '--http') ?? env.BLOK_MCP_HTTP;
  const authKind = oneOf('--auth', flag(argv, '--auth'), ['none', 'oauth'] as const) ?? 'none';
  const syncUrl = flag(argv, '--sync-url') ?? env.BLOK_SYNC_URL;
  const origin = flag(argv, '--origin') ?? env.BLOK_MCP_ORIGIN;
  const ticketUrl = flag(argv, '--ticket-url') ?? env.BLOK_TICKET_URL;

  const auth = parseAuth(argv, authKind);
  const tickets = parseTickets(ticketUrl, env);

  const options: ParsedCli['options'] = {
    transport: http === undefined ? { kind: 'stdio' } : { kind: 'http', listen: http, ...(argv.includes('--public') && { public: true }) },
    auth,
    ...(syncUrl !== undefined && { sync: { url: syncUrl, ...(origin !== undefined && { origin }) } }),
    ...(tickets !== undefined && { tickets }),
    source: parseSource(flag(argv, '--source'), env, flag(argv, '--source-list')),
    pageTitles: oneOf('--page-titles', flag(argv, '--page-titles'), ['off', 'page-map'] as const),
    richTextFields: parseRichTextFields(flag(argv, '--rich-text-fields') ?? env.BLOK_RICH_TEXT_FIELDS),
    schema: oneOf('--schema', flag(argv, '--schema'), ['envelope', 'full'] as const),
    handleIdleMs: positiveInt('--handle-idle-ms', flag(argv, '--handle-idle-ms')),
    maxHandlesPerPrincipal: positiveInt('--max-handles', flag(argv, '--max-handles')),
    principal: flag(argv, '--principal'),
  };

  return {
    options,
    files: {
      ...(flag(argv, '--manifest') !== undefined && { manifest: flag(argv, '--manifest') }),
      ...(flag(argv, '--manifest-overrides') !== undefined && { overrides: flag(argv, '--manifest-overrides') }),
      ...(flag(argv, '--authorize') !== undefined && { authorize: flag(argv, '--authorize') }),
    },
  };
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Host part of "host:port"; IPv6 stays bracketed. */
const hostOf = (listen: string): string => (listen.startsWith('[') ? listen.slice(0, listen.indexOf(']') + 1) : listen.slice(0, listen.lastIndexOf(':')));

export const checkOptionSafety = (options: BlokMcpOptions): void => {
  if (options.transport.kind !== 'http') {
    return;
  }
  const loopback = LOOPBACK_HOSTS.has(hostOf(options.transport.listen));

  if (!loopback && options.transport.public !== true) {
    throw new McpConfigError(`Refusing to bind ${options.transport.listen}: a non-loopback address needs --public`);
  }
  if (options.transport.public === true && options.auth.kind === 'none') {
    throw new McpConfigError('--public needs --auth oauth: a public MCP endpoint without auth opens every document');
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/mcp/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/mcp/options.ts src/mcp/config.ts test/unit/mcp/config.test.ts
git add src/mcp/options.ts src/mcp/config.ts test/unit/mcp/config.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): parse flags and env, refuse unsafe binds" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Custom tools file, overrides, and the two contracts

**Files:**
- Create: `src/mcp/custom-tools-file.ts`, `src/mcp/contract.ts`, `test/unit/mcp/custom-tools-file.test.ts`, `test/unit/mcp/contract.test.ts`

**Interfaces:**
- Consumes: from 01, `createHeadlessAgentSetup({ customTools, overrides, services, runtime })` (`src/view/agent-runtime.ts`, 01 Task 21; it composes 02's `buildBuiltInSnapshot`, `snapshotWithCustomTools`, `runtimesWithCustomTools`, `buildToolManifest`, `buildAgentContract` and 01's `COMMANDS`); from 02, `readCustomToolsFile` (`src/shared/custom-tools-file.ts`, 02 Task 29); types `BlokCustomToolsFile`, `ManifestOverrides`, `AgentContract`, `HostService` (`types/tool-manifest.d.ts`), `ToolRuntimeRegistry` (`src/shared/tool-actions/runtime.ts`).
- Produces:
  - `parseCustomToolsFile(value: unknown): BlokCustomToolsFile` — wraps 02's `readCustomToolsFile`; its `TypeError` (JSON-pointer paths) becomes `McpConfigError` with the same text. No second validator.
  - `parseOverridesFile(value: unknown): ManifestOverrides` — same.
  - `interface McpContracts { stored: AgentContract; live: AgentContract; runtimes: ToolRuntimeRegistry; richTextFieldsFor(type: string): string[] }`
  - `buildMcpContracts(input: { manifest?: BlokCustomToolsFile; overrides?: ManifestOverrides; pageTitles: 'off' | 'page-map'; richTextFields?: Record<string, string[]> }): McpContracts`

- [ ] **Step 1: Write the failing tests**

`test/unit/mcp/custom-tools-file.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { McpConfigError } from '../../../src/mcp/config';
import { parseCustomToolsFile, parseOverridesFile } from '../../../src/mcp/custom-tools-file';

const validFile = {
  formatVersion: 1,
  blocks: [{ name: 'callout_x', description: { summary: 'A callout', data: { type: 'object' } }, statics: {} }],
};

describe('parseCustomToolsFile', () => {
  it('accepts a formatVersion 1 file', () => {
    expect(parseCustomToolsFile(validFile)).toEqual(validFile);
  });

  it.each([
    // JSON-pointer paths: the messages come from 02's readCustomToolsFile (02 Task 29).
    [null, 'Not a Blok custom tools file'],
    [[], 'Not a Blok custom tools file'],
    [{ formatVersion: 2, blocks: [] }, 'formatVersion'],
    [{ formatVersion: 1 }, '/blocks'],
    [{ formatVersion: 1, blocks: [{ description: {}, statics: {} }] }, '/blocks/0'],
    [{ formatVersion: 1, blocks: [{ name: 'x', statics: {} }] }, '/blocks/0'],
    // Unverified: that 02's readCustomToolsFile refuses a non-object `sanitize` (R3-9 says object rules only); if it does not, drop this row or add the check to 02 Task 29.
    [{ formatVersion: 1, blocks: [{ name: 'x', description: {}, statics: {}, sanitize: 'b' }] }, '/blocks/0'],
  ])('refuses %j at %s', (value, path) => {
    expect(() => parseCustomToolsFile(value)).toThrow(McpConfigError);
    expect(() => parseCustomToolsFile(value)).toThrow(path);
  });
});

describe('parseOverridesFile', () => {
  it('accepts hidden, hiddenActions and guidance', () => {
    const value = { table: { hiddenActions: ['mergeCells'], guidance: 'Prefer two columns.' }, embed: { hidden: true } };

    expect(parseOverridesFile(value)).toEqual(value);
  });

  it('refuses unknown keys and wrong types', () => {
    expect(() => parseOverridesFile({ table: { hide: true } })).toThrow('$.table.hide');
    expect(() => parseOverridesFile({ table: { hiddenActions: 'mergeCells' } })).toThrow('$.table.hiddenActions');
  });
});
```

`test/unit/mcp/contract.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildMcpContracts } from '../../../src/mcp/contract';

const command = (contract: { commands: Array<{ name: string; available: boolean; unavailableReason?: string }> }, name: string) =>
  contract.commands.find((entry) => entry.name === name);

describe('buildMcpContracts', () => {
  it('builds a stored contract where history.undo is available', () => {
    const { stored } = buildMcpContracts({ pageTitles: 'off' });

    expect(command(stored, 'history.undo')?.available).toBe(true);
  });

  it('builds a live contract where history.undo is unavailable for the runtime', () => {
    const { live } = buildMcpContracts({ pageTitles: 'off' });

    expect(command(live, 'history.undo')).toMatchObject({ available: false, unavailableReason: 'runtime' });
  });

  it('leaves page.rename unavailable for the service unless page-map is on', () => {
    expect(command(buildMcpContracts({ pageTitles: 'off' }).stored, 'page.rename'))
      .toMatchObject({ available: false, unavailableReason: 'service' });
    expect(command(buildMcpContracts({ pageTitles: 'page-map' }).stored, 'page.rename')?.available).toBe(true);
  });

  it('drops an action hidden by overrides from the contract', () => {
    const { stored } = buildMcpContracts({ pageTitles: 'off', overrides: { table: { hiddenActions: ['insertRows'] } } });

    expect(command(stored, 'table.insertRows')).toBeUndefined();
  });

  it('reads rich text fields from the manifest first, then the config list', () => {
    const contracts = buildMcpContracts({
      pageTitles: 'off',
      richTextFields: { paragraph: ['ignored'], legacy_note: ['body'] },
    });

    expect(contracts.richTextFieldsFor('paragraph')).not.toContain('ignored');
    expect(contracts.richTextFieldsFor('legacy_note')).toEqual(['body']);
    expect(contracts.richTextFieldsFor('unknown_type')).toEqual([]);
  });

  it('changes the revision when the custom tools change', () => {
    const plain = buildMcpContracts({ pageTitles: 'off' }).stored.revision;
    const custom = buildMcpContracts({
      pageTitles: 'off',
      manifest: { formatVersion: 1, blocks: [{ name: 'note_x', description: { summary: 'Note', data: { type: 'object' } }, statics: {} }] },
    }).stored.revision;

    expect(custom).not.toBe(plain);
  });
});
```

The `description` and `statics` literals above must satisfy 02's `BlockToolDescription` and snapshot statics types. If 02's types require more fields, add the minimum fields 02's own Node-build test uses (02 spec §6 item 11).

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/mcp/custom-tools-file.test.ts`, then `yarn test test/unit/mcp/contract.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write minimal implementation**

`src/mcp/custom-tools-file.ts`:

```ts
import type { BlokCustomToolsFile, ManifestOverrides } from '../../types/tool-manifest';
import { readCustomToolsFile } from '../shared/custom-tools-file';
import { McpConfigError } from './config';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const fail = (path: string, what: string): never => {
  throw new McpConfigError(`Invalid file at ${path}: ${what}`);
};

/** One validator for the file format: 02's readCustomToolsFile (02 Task 29). This only turns its TypeError into a config error. */
export const parseCustomToolsFile = (value: unknown): BlokCustomToolsFile => {
  try {
    return readCustomToolsFile(value);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new McpConfigError(`Invalid --manifest file: ${error.message}`);
    }
    throw error;
  }
};

const OVERRIDE_KEYS = new Set(['hidden', 'hiddenActions', 'guidance']);

export const parseOverridesFile = (value: unknown): ManifestOverrides => {
  if (!isRecord(value)) {
    return fail('$', 'expected an object');
  }
  for (const [tool, entry] of Object.entries(value)) {
    const at = `$.${tool}`;

    if (!isRecord(entry)) {
      fail(at, 'expected an object');
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!OVERRIDE_KEYS.has(key)) {
        fail(`${at}.${key}`, 'unknown key');
      }
    }
    if (entry.hidden !== undefined && typeof entry.hidden !== 'boolean') {
      fail(`${at}.hidden`, 'expected a boolean');
    }
    if (entry.hiddenActions !== undefined
      && !(Array.isArray(entry.hiddenActions) && entry.hiddenActions.every((name) => typeof name === 'string'))) {
      fail(`${at}.hiddenActions`, 'expected an array of strings');
    }
    if (entry.guidance !== undefined && typeof entry.guidance !== 'string') {
      fail(`${at}.guidance`, 'expected a string');
    }
  }

  return value as ManifestOverrides;
};
```

`src/mcp/contract.ts`:

```ts
import type { ToolRuntimeRegistry } from '../shared/tool-actions/runtime';
import { createHeadlessAgentSetup } from '../view/agent-runtime';
import type { AgentContract, BlokCustomToolsFile, HostService, ManifestOverrides } from '../../types/tool-manifest';

export interface McpContracts {
  stored: AgentContract;
  live: AgentContract;
  runtimes: ToolRuntimeRegistry;
  richTextFieldsFor(type: string): string[];
}

export const buildMcpContracts = (input: {
  manifest?: BlokCustomToolsFile;
  overrides?: ManifestOverrides;
  pageTitles: 'off' | 'page-map';
  richTextFields?: Record<string, string[]>;
}): McpContracts => {
  const services: HostService[] = input.pageTitles === 'page-map' ? ['pageBackend'] : [];
  // 01's one Node setup (01 Task 21) over 02's built-in snapshot, custom tools file and runtimes.
  const setup = (runtime: 'node' | 'node-live') => createHeadlessAgentSetup({ customTools: input.manifest, overrides: input.overrides, services, runtime });
  const stored = setup('node');
  const fromManifest = new Map(stored.contract.manifest.blocks.map((block) => [block.name, block.richTextFields ?? []]));

  return {
    // tools/list is fixed per deployment, so it renders the stored contract (06 R3-1).
    stored: stored.contract,
    live: setup('node-live').contract,
    runtimes: stored.tools,
    // Config list is only for block types the manifest does not know (06 04-Q10).
    richTextFieldsFor: (type) => fromManifest.get(type) ?? input.richTextFields?.[type] ?? [],
  };
};
```

`ToolRuntimeRegistry` is internal to 02 (`src/shared/tool-actions/runtime.ts`, 02 Task 13); `HostService` is published (`types/tool-manifest.d.ts`, 02 Task 3).

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/mcp/custom-tools-file.test.ts`, then `yarn test test/unit/mcp/contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/mcp/custom-tools-file.ts src/mcp/contract.ts test/unit/mcp/custom-tools-file.test.ts test/unit/mcp/contract.test.ts
git add src/mcp/custom-tools-file.ts src/mcp/contract.ts test/unit/mcp/custom-tools-file.test.ts test/unit/mcp/contract.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): load custom tools and overrides, build stored and live contracts" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The MCP tool list and its renderer law

**Files:**
- Create: `src/mcp/tools.ts`, `test/unit/architecture/mcp-tools-from-renderer-law.test.ts`

**Interfaces:**
- Consumes: `renderAgentTools(contract, { format: 'mcp', handle: true, schema })` from `src/agent/render-tools.ts` (03); `McpContracts` (Task 5).
- Produces:
  - `interface McpTool { name: string; description: string; inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown> }`
  - `CORE_TOOL_NAMES = ['blok_read', 'blok_describe', 'blok_execute'] as const`
  - `LIFECYCLE_TOOL_NAMES = ['blok_list_documents', 'blok_open', 'blok_close'] as const`
  - `listMcpTools(contract: AgentContract, options: { schema: 'envelope' | 'full'; handleIdleMs: number }): McpTool[]` — six tools, lifecycle tools first.

- [ ] **Step 1: Write the failing law test**

`test/unit/architecture/mcp-tools-from-renderer-law.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderAgentTools } from '../../../src/agent/render-tools';
import { buildMcpContracts } from '../../../src/mcp/contract';
import { CORE_TOOL_NAMES, listMcpTools } from '../../../src/mcp/tools';

/**
 * LAW: the MCP server's three core tools ARE the shared renderer's output.
 * 04 never hand-writes or re-renders a core tool schema (06 C2, §3.7).
 */
describe('MCP core tools come from renderAgentTools', () => {
  const { stored } = buildMcpContracts({ pageTitles: 'off' });

  for (const schema of ['envelope', 'full'] as const) {
    it(`equals the renderer output in ${schema} mode`, () => {
      const rendered = renderAgentTools(stored, { format: 'mcp', handle: true, schema });
      const tools = listMcpTools(stored, { schema, handleIdleMs: 600_000 });

      expect(tools.filter((tool) => (CORE_TOOL_NAMES as readonly string[]).includes(tool.name))).toEqual(rendered);
    });
  }

  it('lists exactly six tools', () => {
    expect(listMcpTools(stored, { schema: 'envelope', handleIdleMs: 600_000 }).map((tool) => tool.name).sort()).toEqual(
      ['blok_close', 'blok_describe', 'blok_execute', 'blok_list_documents', 'blok_open', 'blok_read'],
    );
  });

  it('names only available contract commands in blok_execute (envelope enum)', () => {
    const execute = listMcpTools(stored, { schema: 'envelope', handleIdleMs: 600_000 }).find((tool) => tool.name === 'blok_execute');
    const text = JSON.stringify(execute?.inputSchema);
    const available = new Set(stored.commands.filter((entry) => entry.available).map((entry) => entry.name));

    for (const entry of stored.commands) {
      expect(text.includes(JSON.stringify(entry.name)), entry.name).toBe(available.has(entry.name));
    }
  });

  it('never emits strict on blok_execute', () => {
    const execute = listMcpTools(stored, { schema: 'full', handleIdleMs: 600_000 }).find((tool) => tool.name === 'blok_execute');

    expect(JSON.stringify(execute)).not.toContain('"strict"');
  });

  it('src/mcp never builds a core tool schema by hand', () => {
    const source = readFileSync(resolve(__dirname, '../../../src/mcp/tools.ts'), 'utf-8');

    for (const name of CORE_TOOL_NAMES) {
      expect(source.match(new RegExp(`name:\\s*'${name}'`, 'g')) ?? [], name).toEqual([]);
    }
  });

  it('marks handle with the sticky-routing header on blok_close too', () => {
    const close = listMcpTools(stored, { schema: 'envelope', handleIdleMs: 600_000 }).find((tool) => tool.name === 'blok_close');

    expect(close?.inputSchema).toMatchObject({ properties: { handle: { 'x-mcp-header': 'Blok-Handle' } } });
  });

  it('states the idle expiry in blok_open', () => {
    const open = listMcpTools(stored, { schema: 'envelope', handleIdleMs: 600_000 }).find((tool) => tool.name === 'blok_open');

    expect(open?.description).toContain('10 minutes');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/architecture/mcp-tools-from-renderer-law.test.ts`
Expected: FAIL, `src/mcp/tools` not found.

- [ ] **Step 3: Write minimal implementation**

`src/mcp/tools.ts`:

```ts
import { renderAgentTools } from '../agent/render-tools';
import type { AgentContract } from '../../types/tool-manifest';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export const CORE_TOOL_NAMES = ['blok_read', 'blok_describe', 'blok_execute'] as const;
export const LIFECYCLE_TOOL_NAMES = ['blok_list_documents', 'blok_open', 'blok_close'] as const;

const ERROR_BRANCH = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'retryable'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        retryable: { type: 'boolean' },
        details: { type: 'object' },
      },
    },
  },
};

const withErrorBranch = (success: Record<string, unknown>): Record<string, unknown> => ({ oneOf: [success, ERROR_BRANCH] });

const minutes = (ms: number): string => {
  const value = ms / 60_000;

  return Number.isInteger(value) ? `${value} minutes` : `${Math.round(ms / 1000)} seconds`;
};

const lifecycleTools = (handleIdleMs: number): McpTool[] => [
  {
    name: 'blok_list_documents',
    description: 'Lists Blok documents you may open. Returns supported: false when the document source cannot list.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', maxLength: 200 },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      },
    },
    outputSchema: withErrorBranch({
      type: 'object',
      required: ['documents'],
      properties: {
        documents: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string' }, title: { type: ['string', 'null'] }, live: { type: 'boolean' } },
          },
        },
        nextCursor: { type: ['string', 'null'] },
        supported: { type: 'boolean' },
      },
    }),
  },
  {
    name: 'blok_open',
    description: [
      'Opens a Blok document and returns a handle for blok_read, blok_describe, blok_execute and blok_close.',
      'mode "auto" joins the live room when one is configured, else edits the stored document.',
      `A handle expires after ${minutes(handleIdleMs)} without a call; then open again.`,
      'Write rich text with commands such as text.format or markdown.insert. Never put Markdown or HTML into block data.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['documentId'],
      properties: {
        documentId: { type: 'string', minLength: 1, maxLength: 512 },
        mode: { enum: ['auto', 'live', 'stored'], default: 'auto' },
        write: { type: 'boolean', default: false },
        view: { type: 'object' },
      },
    },
    outputSchema: withErrorBranch({
      type: 'object',
      required: ['handle', 'mode', 'write', 'expiresAfterIdleMs'],
      properties: {
        handle: { type: 'string' },
        mode: { enum: ['live', 'stored'] },
        write: { type: 'boolean' },
        durability: { enum: ['acknowledged', 'best-effort', 'saved-on-execute'] },
        expiresAfterIdleMs: { type: 'integer' },
        contractRevision: { type: 'string' },
        view: { type: 'object' },
      },
    }),
  },
  {
    name: 'blok_close',
    description: 'Closes a handle: leaves the live room, or drops the stored session. Reports work the server had not acknowledged.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['handle'],
      properties: { handle: { type: 'string', 'x-mcp-header': 'Blok-Handle' } },
    },
    outputSchema: withErrorBranch({
      type: 'object',
      required: ['closed', 'unsavedBatches'],
      properties: { closed: { type: 'boolean' }, unsavedBatches: { type: 'integer' }, hostRecordLags: { type: 'boolean' } },
    }),
  },
];

export const listMcpTools = (
  contract: AgentContract,
  options: { schema: 'envelope' | 'full'; handleIdleMs: number },
): McpTool[] => [
  ...lifecycleTools(options.handleIdleMs),
  ...(renderAgentTools(contract, { format: 'mcp', handle: true, schema: options.schema }) as McpTool[]),
];
```

`renderAgentTools` returns the `RenderedTool` union; the `format: 'mcp'` branch is `{ name, description, inputSchema, outputSchema }` (06 §3.7). If 03 ships per-format overloads (06 R2-03-8), drop the `as McpTool[]`.

The `view` property uses `{ type: 'object' }` rather than `$ref: '#/$defs/ViewArgs'` because the lifecycle schema carries no `$defs`; the dispatcher passes it to `session.read`, which validates it (01).

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/architecture/mcp-tools-from-renderer-law.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation check of the law (manual, not committed)**

Temporarily add `{ name: 'blok_read', description: 'x', inputSchema: {}, outputSchema: {} }` to the array `listMcpTools` returns. Run the law test. Expected: FAIL in "lists exactly six tools" and "equals the renderer output". Revert.

- [ ] **Step 6: Commit**

```bash
npx eslint src/mcp/tools.ts test/unit/architecture/mcp-tools-from-renderer-law.test.ts
git add src/mcp/tools.ts test/unit/architecture/mcp-tools-from-renderer-law.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): six-tool list with core tools from renderAgentTools" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Handle registry

**Files:**
- Create: `src/mcp/handles.ts`, `test/unit/mcp/handles.test.ts`

**Interfaces:**
- Consumes: `surfaceError` (Task 2).
- Produces:

```ts
export interface HandleRegistryOptions<S> {
  idleMs: number;
  maxPerPrincipal: number;
  onExpire(session: S): Promise<void>;
  now?: () => number;
  newHandle?: () => string;     // default: randomBytes(16).toString('base64url')
}
export class HandleRegistry<S> {
  constructor(options: HandleRegistryOptions<S>);
  add(principal: string, documentId: string, session: S): string;               // HANDLE_LIMIT when full
  use<T>(handle: string, principal: string, fn: (session: S, documentId: string) => Promise<T>): Promise<T>; // UNKNOWN_HANDLE; one call at a time per handle
  remove(handle: string, principal: string): Promise<S>;                         // waits for queued calls; UNKNOWN_HANDLE
  sweep(): Promise<number>;                                                      // expires idle, never a busy handle
  closeAll(close: (session: S) => Promise<void>): Promise<void>;
  count(principal: string): number;
}
```

- [ ] **Step 1: Write the failing test**

`test/unit/mcp/handles.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isMcpSurfaceError } from '../../../src/mcp/errors';
import { HandleRegistry } from '../../../src/mcp/handles';

interface FakeSession { id: string }

const codeOf = async (promise: Promise<unknown>): Promise<string | undefined> =>
  promise.then(() => undefined, (thrown: unknown) => (isMcpSurfaceError(thrown) ? thrown.agentError.code : 'not-surface'));

describe('HandleRegistry', () => {
  let clock = 0;
  const expired: string[] = [];
  const make = (max = 8): HandleRegistry<FakeSession> => new HandleRegistry<FakeSession>({
    idleMs: 1000,
    maxPerPrincipal: max,
    now: () => clock,
    onExpire: async (session) => {
      expired.push(session.id);
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clock = 0;
    expired.length = 0;
  });

  it('mints 128-bit opaque handles', () => {
    const handle = make().add('alice', 'doc', { id: 'a' });

    expect(Buffer.from(handle, 'base64url')).toHaveLength(16);
  });

  it('hides a handle from another principal as UNKNOWN_HANDLE', async () => {
    const registry = make();
    const handle = registry.add('alice', 'doc', { id: 'a' });

    expect(await codeOf(registry.use(handle, 'bob', async () => 'x'))).toBe('UNKNOWN_HANDLE');
    expect(await codeOf(registry.use('nope', 'alice', async () => 'x'))).toBe('UNKNOWN_HANDLE');
    expect(await registry.use(handle, 'alice', async (session, documentId) => `${session.id}:${documentId}`)).toBe('a:doc');
  });

  it('caps open handles per principal', () => {
    const registry = make(2);

    registry.add('alice', 'd1', { id: '1' });
    registry.add('alice', 'd2', { id: '2' });
    registry.add('bob', 'd3', { id: '3' });

    expect(() => registry.add('alice', 'd4', { id: '4' })).toThrow(expect.objectContaining({ agentError: expect.objectContaining({ code: 'HANDLE_LIMIT' }) }));
  });

  it('expires idle handles and calls onExpire', async () => {
    const registry = make();
    const handle = registry.add('alice', 'doc', { id: 'a' });

    clock = 999;
    expect(await registry.sweep()).toBe(0);
    clock = 1001;
    expect(await registry.sweep()).toBe(1);
    expect(expired).toEqual(['a']);
    expect(await codeOf(registry.use(handle, 'alice', async () => 'x'))).toBe('UNKNOWN_HANDLE');
  });

  it('touches a handle on use', async () => {
    const registry = make();
    const handle = registry.add('alice', 'doc', { id: 'a' });

    clock = 900;
    await registry.use(handle, 'alice', async () => undefined);
    clock = 1500;
    expect(await registry.sweep()).toBe(0);
  });

  it('runs calls on one handle one after the other (Review Focus 1)', async () => {
    const registry = make();
    const handle = registry.add('alice', 'doc', { id: 'a' });
    const order: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((done) => {
      release = done;
    });

    const first = registry.use(handle, 'alice', async () => {
      order.push('first:start');
      await gate;
      order.push('first:end');
    });
    const second = registry.use(handle, 'alice', async () => {
      order.push('second');
    });

    await Promise.resolve();
    release();
    await Promise.all([first, second]);

    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('never expires a handle while a call runs on it', async () => {
    const registry = make();
    const handle = registry.add('alice', 'doc', { id: 'a' });
    let release: () => void = () => undefined;
    const running = registry.use(handle, 'alice', () => new Promise<void>((done) => {
      release = done;
    }));

    clock = 5000;
    expect(await registry.sweep()).toBe(0);
    release();
    await running;
  });

  it('remove waits for queued calls and then forgets the handle', async () => {
    const registry = make();
    const handle = registry.add('alice', 'doc', { id: 'a' });

    expect(await registry.remove(handle, 'alice')).toEqual({ id: 'a' });
    expect(registry.count('alice')).toBe(0);
    expect(await codeOf(registry.remove(handle, 'alice'))).toBe('UNKNOWN_HANDLE');
  });

  it('a failing call does not jam the queue', async () => {
    const registry = make();
    const handle = registry.add('alice', 'doc', { id: 'a' });

    await expect(registry.use(handle, 'alice', async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(await registry.use(handle, 'alice', async () => 'next')).toBe('next');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/mcp/handles.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

`src/mcp/handles.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { surfaceError } from './errors';

export interface HandleRegistryOptions<S> {
  idleMs: number;
  maxPerPrincipal: number;
  onExpire(session: S): Promise<void>;
  now?: () => number;
  newHandle?: () => string;
}

interface Entry<S> {
  principal: string;
  documentId: string;
  session: S;
  lastUsed: number;
  busy: number;
  queue: Promise<unknown>;
}

const unknownHandle = (): Error =>
  surfaceError('UNKNOWN_HANDLE', 'No open document has this handle. It may have expired; call blok_open again.');

export class HandleRegistry<S> {
  private readonly entries = new Map<string, Entry<S>>();
  private readonly now: () => number;
  private readonly newHandle: () => string;

  constructor(private readonly options: HandleRegistryOptions<S>) {
    this.now = options.now ?? Date.now;
    // 16 random bytes = 128 bits (spec §3.3).
    this.newHandle = options.newHandle ?? ((): string => randomBytes(16).toString('base64url'));
  }

  public count(principal: string): number {
    return [...this.entries.values()].filter((entry) => entry.principal === principal).length;
  }

  public add(principal: string, documentId: string, session: S): string {
    if (this.count(principal) >= this.options.maxPerPrincipal) {
      throw surfaceError('HANDLE_LIMIT', `You already have ${this.options.maxPerPrincipal} open documents. Close one with blok_close.`);
    }
    const handle = this.newHandle();

    this.entries.set(handle, { principal, documentId, session, lastUsed: this.now(), busy: 0, queue: Promise.resolve() });

    return handle;
  }

  public use<T>(handle: string, principal: string, fn: (session: S, documentId: string) => Promise<T>): Promise<T> {
    const entry = this.entries.get(handle);

    // A wrong principal reads exactly like a missing handle, so a handle's existence never leaks.
    if (entry === undefined || entry.principal !== principal) {
      return Promise.reject(unknownHandle());
    }
    entry.busy += 1;
    entry.lastUsed = this.now();
    const run = entry.queue.then(() => fn(entry.session, entry.documentId));

    entry.queue = run.catch(() => undefined).finally(() => {
      entry.busy -= 1;
      entry.lastUsed = this.now();
    });

    return run;
  }

  public async remove(handle: string, principal: string): Promise<S> {
    const entry = this.entries.get(handle);

    if (entry === undefined || entry.principal !== principal) {
      throw unknownHandle();
    }
    this.entries.delete(handle);
    await entry.queue;

    return entry.session;
  }

  public async sweep(): Promise<number> {
    const cutoff = this.now() - this.options.idleMs;
    const idle = [...this.entries].filter(([, entry]) => entry.busy === 0 && entry.lastUsed < cutoff);

    for (const [handle, entry] of idle) {
      this.entries.delete(handle);
      await this.options.onExpire(entry.session);
    }

    return idle.length;
  }

  public async closeAll(close: (session: S) => Promise<void>): Promise<void> {
    const all = [...this.entries.values()];

    this.entries.clear();
    await Promise.allSettled(all.map(async (entry) => {
      await entry.queue;
      await close(entry.session);
    }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/mcp/handles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/mcp/handles.ts test/unit/mcp/handles.test.ts
git add src/mcp/handles.ts test/unit/mcp/handles.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): handle registry with principal binding, expiry, cap and per-handle queue" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Tool dispatcher

**Files:**
- Create: `src/mcp/dispatcher.ts`, `test/unit/mcp/dispatcher.test.ts`

**Interfaces:**
- Consumes: `HandleRegistry` (Task 7), `HandleSession`, `NO_DELIVERY`, `failedResult`, `surfaceError`, `isMcpSurfaceError` (Task 2).
- Produces:

```ts
export interface Caller { principal: string; clientName: string; scopes: readonly string[] | null } // null = stdio, all scopes
export interface ToolOutcome { structuredContent: Record<string, unknown>; isError: boolean }
export class UnknownToolError extends Error {}
export interface OpenRequest { documentId: string; mode: 'auto' | 'live' | 'stored'; write: boolean }
export interface ListRequest { query?: string; cursor?: string; limit: number }
export interface ListResult { documents: Array<{ id: string; title: string | null; live: boolean }>; nextCursor: string | null; supported: boolean }
export interface DispatcherDeps {
  handles: HandleRegistry<HandleSession>;
  open(request: OpenRequest, caller: Caller): Promise<HandleSession>;
  list(request: ListRequest, caller: Caller): Promise<ListResult>;
  /** Re-checked on every handle call (MCP "Stateful Tools"). */
  stillAllowed(caller: Caller, documentId: string, write: boolean): Promise<boolean>;
  handleIdleMs: number;
}
export const createToolDispatcher: (deps: DispatcherDeps) => (name: string, args: Record<string, unknown>, caller: Caller) => Promise<ToolOutcome>;
```

Rules the dispatcher owns:
- `blok_execute` always answers `McpExecuteResult` (with `delivery`), `isError = !ok`. A pre-session error is `failedResult(error)`: no `revision`.
- `blok_read`, `blok_describe` and lifecycle tools answer success, or `{ error: AgentError }` with `isError: true` (06 R2-04-3).
- `blok.write` scope is needed for `blok_open` with `write: true` and for `blok_execute`; `blok.read` for everything else. Missing → `FORBIDDEN` with `details.requiredScope`. (Spec §3.8 wants HTTP 403 `insufficient_scope`; the per-request HTTP layer in Task 25 enforces `blok.read`; a per-tool HTTP 403 needs the SDK's scope-challenge hook, which is **unverified**, so a missing `blok.write` is a tool error here.)
- Unknown tool → `UnknownToolError` (the SDK layer turns it into a JSON-RPC error).
- Bad args (missing `handle`, non-array `commands`) → `INVALID_ARGS`.

- [ ] **Step 1: Write the failing test**

`test/unit/mcp/dispatcher.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Caller, DispatcherDeps } from '../../../src/mcp/dispatcher';
import { createToolDispatcher, UnknownToolError } from '../../../src/mcp/dispatcher';
import { NO_DELIVERY } from '../../../src/mcp/errors';
import { HandleRegistry } from '../../../src/mcp/handles';
import type { HandleSession } from '../../../src/mcp/session';

const stdio: Caller = { principal: 'local', clientName: 'test', scopes: null };
const readOnlyCaller: Caller = { principal: 'local', clientName: 'test', scopes: ['blok.read'] };

const fakeSession = (overrides: Partial<HandleSession> = {}): HandleSession => ({
  mode: 'stored',
  write: true,
  durability: 'saved-on-execute',
  contractRevision: 'rev-1',
  read: vi.fn(async () => ({ blocks: [] }) as never),
  describe: vi.fn(() => ({ index: { tools: [], commands: [], guidance: '' } }) as never),
  execute: vi.fn(async () => ({
    ok: true, revision: 'r2', results: [], refs: {}, changed: { created: [], updated: [], moved: [], removed: [] }, warnings: [],
    delivery: { durable: true, pending: false, serverSequence: null, savedVersion: 'v2' },
  })),
  close: vi.fn(async () => ({ unsavedBatches: 0, hostRecordLags: false })),
  ...overrides,
});

describe('createToolDispatcher', () => {
  let session: HandleSession;
  let deps: DispatcherDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    session = fakeSession();
    deps = {
      handles: new HandleRegistry<HandleSession>({ idleMs: 600_000, maxPerPrincipal: 8, onExpire: async () => undefined }),
      open: vi.fn(async () => session),
      list: vi.fn(async () => ({ documents: [{ id: 'a', title: null, live: false }], nextCursor: null, supported: true })),
      stillAllowed: vi.fn(async () => true),
      handleIdleMs: 600_000,
    };
  });

  it('opens a document and returns a handle with its facts', async () => {
    const dispatch = createToolDispatcher(deps);
    const outcome = await dispatch('blok_open', { documentId: 'doc-1', write: true }, stdio);

    expect(outcome.isError).toBe(false);
    expect(outcome.structuredContent).toMatchObject({
      mode: 'stored', write: true, durability: 'saved-on-execute', expiresAfterIdleMs: 600_000, contractRevision: 'rev-1',
    });
    expect(typeof outcome.structuredContent.handle).toBe('string');
    expect(deps.open).toHaveBeenCalledWith({ documentId: 'doc-1', mode: 'auto', write: true }, stdio);
  });

  it('includes a first view when asked', async () => {
    const dispatch = createToolDispatcher(deps);
    const outcome = await dispatch('blok_open', { documentId: 'doc-1', view: { depth: 1 } }, stdio);

    expect(session.read).toHaveBeenCalledWith({ depth: 1 });
    expect(outcome.structuredContent.view).toEqual({ blocks: [] });
  });

  it('routes execute to the session and returns AgentResult with delivery', async () => {
    const dispatch = createToolDispatcher(deps);
    const { structuredContent } = await dispatch('blok_open', { documentId: 'd', write: true }, stdio);
    const outcome = await dispatch('blok_execute', { handle: structuredContent.handle, commands: [{ name: 'block.insert', args: {} }] }, stdio);

    expect(outcome.isError).toBe(false);
    expect(session.execute).toHaveBeenCalledWith({ commands: [{ name: 'block.insert', args: {} }] });
    expect(outcome.structuredContent).toMatchObject({ ok: true, delivery: { savedVersion: 'v2' } });
  });

  it('answers execute on an unknown handle with ok:false, no revision, and a delivery', async () => {
    const outcome = await createToolDispatcher(deps)('blok_execute', { handle: 'nope', commands: [] }, stdio);

    expect(outcome.isError).toBe(true);
    expect(outcome.structuredContent).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'UNKNOWN_HANDLE' }),
      warnings: [],
      delivery: NO_DELIVERY,
    });
  });

  it('answers read on an unknown handle with the error branch', async () => {
    const outcome = await createToolDispatcher(deps)('blok_read', { handle: 'nope' }, stdio);

    expect(outcome).toEqual({ isError: true, structuredContent: { error: expect.objectContaining({ code: 'UNKNOWN_HANDLE' }) } });
  });

  it('passes view args and describe queries through', async () => {
    const dispatch = createToolDispatcher(deps);
    const handle = (await dispatch('blok_open', { documentId: 'd' }, stdio)).structuredContent.handle;

    await dispatch('blok_read', { handle, depth: 2 }, stdio);
    await dispatch('blok_describe', { handle, tool: 'table' }, stdio);

    expect(session.read).toHaveBeenCalledWith({ depth: 2 });
    expect(session.describe).toHaveBeenCalledWith({ tool: 'table' });
  });

  it('closes a handle and reports the summary', async () => {
    const dispatch = createToolDispatcher(deps);
    const handle = (await dispatch('blok_open', { documentId: 'd' }, stdio)).structuredContent.handle;
    const outcome = await dispatch('blok_close', { handle }, stdio);

    expect(outcome.structuredContent).toEqual({ closed: true, unsavedBatches: 0, hostRecordLags: false });
    expect(session.close).toHaveBeenCalledWith('closed');
  });

  it('needs blok.write to open for writing or to execute', async () => {
    const dispatch = createToolDispatcher(deps);

    expect((await dispatch('blok_open', { documentId: 'd', write: true }, readOnlyCaller)).structuredContent)
      .toEqual({ error: expect.objectContaining({ code: 'FORBIDDEN', details: { requiredScope: 'blok.write' } }) });
    expect((await dispatch('blok_open', { documentId: 'd' }, readOnlyCaller)).isError).toBe(false);
  });

  it('re-checks access on every handle call', async () => {
    const dispatch = createToolDispatcher(deps);
    const handle = (await dispatch('blok_open', { documentId: 'd', write: true }, stdio)).structuredContent.handle;

    vi.mocked(deps.stillAllowed).mockResolvedValueOnce(false);
    const outcome = await dispatch('blok_execute', { handle, commands: [] }, stdio);

    expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(deps.stillAllowed).toHaveBeenCalledWith(stdio, 'd', true);
  });

  it('turns a surface error from open into the error branch', async () => {
    vi.mocked(deps.open).mockRejectedValueOnce(
      (await import('../../../src/mcp/errors')).surfaceError('STORED_WRITE_FORBIDDEN', 'live room owns it'),
    );
    const outcome = await createToolDispatcher(deps)('blok_open', { documentId: 'd', mode: 'stored' }, stdio);

    expect(outcome.structuredContent).toEqual({ error: expect.objectContaining({ code: 'STORED_WRITE_FORBIDDEN' }) });
  });

  it('refuses malformed args with INVALID_ARGS', async () => {
    const dispatch = createToolDispatcher(deps);

    expect((await dispatch('blok_read', {}, stdio)).structuredContent).toEqual({ error: expect.objectContaining({ code: 'INVALID_ARGS' }) });
    expect((await dispatch('blok_open', { documentId: '' }, stdio)).structuredContent).toEqual({ error: expect.objectContaining({ code: 'INVALID_ARGS' }) });
    expect((await dispatch('blok_execute', { handle: 'h', commands: 'x' }, stdio)).structuredContent)
      .toMatchObject({ ok: false, error: { code: 'INVALID_ARGS' } });
  });

  it('lists documents and clamps the limit', async () => {
    const outcome = await createToolDispatcher(deps)('blok_list_documents', { limit: 500 }, stdio);

    expect(deps.list).toHaveBeenCalledWith({ limit: 100 }, stdio);
    expect(outcome.structuredContent).toMatchObject({ supported: true });
  });

  it('throws UnknownToolError for any other name', async () => {
    await expect(createToolDispatcher(deps)('blok_delete_everything', {}, stdio)).rejects.toBeInstanceOf(UnknownToolError);
  });

  it('lets unexpected errors escape (they become JSON-RPC errors, not tool results)', async () => {
    vi.mocked(deps.open).mockRejectedValueOnce(new TypeError('bug'));

    await expect(createToolDispatcher(deps)('blok_open', { documentId: 'd' }, stdio)).rejects.toThrow('bug');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/mcp/dispatcher.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

`src/mcp/dispatcher.ts`:

```ts
import type { AgentBatch, AgentCommand, ViewArgs } from '../shared/agent';
import { failedResult, isMcpSurfaceError, surfaceError } from './errors';
import type { HandleRegistry } from './handles';
import type { HandleSession } from './session';

export interface Caller { principal: string; clientName: string; scopes: readonly string[] | null }
export interface ToolOutcome { structuredContent: Record<string, unknown>; isError: boolean }
export interface OpenRequest { documentId: string; mode: 'auto' | 'live' | 'stored'; write: boolean }
export interface ListRequest { query?: string; cursor?: string; limit: number }
export interface ListResult {
  documents: Array<{ id: string; title: string | null; live: boolean }>;
  nextCursor: string | null;
  supported: boolean;
}
export interface DispatcherDeps {
  handles: HandleRegistry<HandleSession>;
  open(request: OpenRequest, caller: Caller): Promise<HandleSession>;
  list(request: ListRequest, caller: Caller): Promise<ListResult>;
  stillAllowed(caller: Caller, documentId: string, write: boolean): Promise<boolean>;
  handleIdleMs: number;
}

export class UnknownToolError extends Error {
  constructor(name: string) {
    super(`Unknown tool: ${name}`);
    this.name = 'UnknownToolError';
  }
}

const invalid = (message: string): Error => surfaceError('INVALID_ARGS', message);

const requireScope = (caller: Caller, scope: 'blok.read' | 'blok.write'): void => {
  if (caller.scopes !== null && !caller.scopes.includes(scope)) {
    throw surfaceError('FORBIDDEN', `This call needs the ${scope} scope.`, { requiredScope: scope });
  }
};

const handleOf = (args: Record<string, unknown>): string => {
  if (typeof args.handle !== 'string' || args.handle === '') {
    throw invalid('handle must be the string blok_open returned.');
  }

  return args.handle;
};

const withoutHandle = (args: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'handle'));

const ok = (structuredContent: Record<string, unknown>): ToolOutcome => ({ structuredContent, isError: false });

export const createToolDispatcher = (deps: DispatcherDeps) => {
  const onHandle = <T>(caller: Caller, handle: string, write: boolean, fn: (session: HandleSession) => Promise<T>): Promise<T> =>
    deps.handles.use(handle, caller.principal, async (session, documentId) => {
      if (!(await deps.stillAllowed(caller, documentId, write))) {
        throw surfaceError('FORBIDDEN', 'You no longer have access to this document.');
      }

      return fn(session);
    });

  const lifecycleOrCore = async (name: string, args: Record<string, unknown>, caller: Caller): Promise<ToolOutcome> => {
    switch (name) {
      case 'blok_list_documents': {
        requireScope(caller, 'blok.read');
        const limit = typeof args.limit === 'number' ? Math.min(Math.max(Math.trunc(args.limit), 1), 100) : 25;
        const request: ListRequest = {
          limit,
          ...(typeof args.query === 'string' && { query: args.query }),
          ...(typeof args.cursor === 'string' && { cursor: args.cursor }),
        };

        return ok({ ...(await deps.list(request, caller)) });
      }
      case 'blok_open': {
        const write = args.write === true;

        requireScope(caller, write ? 'blok.write' : 'blok.read');
        if (typeof args.documentId !== 'string' || args.documentId === '' || args.documentId.length > 512) {
          throw invalid('documentId must be a string of 1 to 512 characters.');
        }
        const mode = args.mode === 'live' || args.mode === 'stored' ? args.mode : 'auto';
        const session = await deps.open({ documentId: args.documentId, mode, write }, caller);
        const handle = await Promise.resolve()
          .then(() => deps.handles.add(caller.principal, args.documentId as string, session))
          .catch(async (thrown: unknown) => {
            await session.close('closed');
            throw thrown;
          });
        const view = typeof args.view === 'object' && args.view !== null ? await session.read(args.view as ViewArgs) : undefined;

        return ok({
          handle,
          mode: session.mode,
          write: session.write,
          durability: session.durability,
          expiresAfterIdleMs: deps.handleIdleMs,
          contractRevision: session.contractRevision,
          ...(view !== undefined && { view }),
        });
      }
      case 'blok_close': {
        requireScope(caller, 'blok.read');
        const session = await deps.handles.remove(handleOf(args), caller.principal);
        const summary = await session.close('closed');

        return ok({ closed: true, ...summary });
      }
      case 'blok_read': {
        requireScope(caller, 'blok.read');
        const view = await onHandle(caller, handleOf(args), false, (session) => session.read(withoutHandle(args) as ViewArgs));

        return ok(view as unknown as Record<string, unknown>);
      }
      case 'blok_describe': {
        requireScope(caller, 'blok.read');
        const query = {
          ...(typeof args.tool === 'string' && { tool: args.tool }),
          ...(typeof args.command === 'string' && { command: args.command }),
        };
        const slice = await onHandle(caller, handleOf(args), false, async (session) => session.describe(query));

        return ok(slice as unknown as Record<string, unknown>);
      }
      default:
        throw new UnknownToolError(name);
    }
  };

  const execute = async (args: Record<string, unknown>, caller: Caller): Promise<ToolOutcome> => {
    try {
      requireScope(caller, 'blok.write');
      if (!Array.isArray(args.commands)) {
        throw invalid('commands must be an array of { name, args }.');
      }
      const batch: AgentBatch = {
        commands: args.commands as AgentCommand[],
        ...(typeof args.expectRevision === 'string' && { expectRevision: args.expectRevision }),
      };
      const result = await onHandle(caller, handleOf(args), true, (session) => session.execute(batch));

      return { structuredContent: result as unknown as Record<string, unknown>, isError: !result.ok };
    } catch (thrown) {
      if (isMcpSurfaceError(thrown)) {
        return { structuredContent: failedResult(thrown.agentError) as unknown as Record<string, unknown>, isError: true };
      }
      throw thrown;
    }
  };

  return async (name: string, args: Record<string, unknown>, caller: Caller): Promise<ToolOutcome> => {
    if (name === 'blok_execute') {
      return execute(args, caller);
    }
    try {
      return await lifecycleOrCore(name, args, caller);
    } catch (thrown) {
      if (isMcpSurfaceError(thrown)) {
        return { structuredContent: { error: thrown.agentError }, isError: true };
      }
      throw thrown;
    }
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/mcp/dispatcher.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/mcp/dispatcher.ts test/unit/mcp/dispatcher.test.ts
git add src/mcp/dispatcher.ts test/unit/mcp/dispatcher.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): dispatch lifecycle and core tools with one error shape" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: SDK server, stdio serving, `runCli`

**Files:**
- Create: `src/mcp/sdk-server.ts`, `src/mcp/actor.ts`, `src/mcp/server.ts`, `test/unit/mcp/sdk-server.test.ts`, `test/unit/mcp/actor.test.ts`
- Modify: `src/mcp/index.ts`
- Add (from Task 3): `test/unit/mcp/bin.test.ts`

**Interfaces:**
- Consumes: `listMcpTools` (Task 6), `createToolDispatcher` (Task 8), `HandleRegistry` (Task 7), `buildMcpContracts` (Task 5), `parseMcpArgs`, `checkOptionSafety` (Task 4), `parseCustomToolsFile`, `parseOverridesFile` (Task 5).
- Produces:
  - `buildSdkServer(input: { tools: McpTool[]; dispatch: Dispatch; caller: (clientName: string) => Caller; version: string }): Server` — SDK `Server` named `blok-mcp`.
  - `safeClientName(raw: string | undefined): string` — `[A-Za-z0-9._-]`, max 64 chars, default `mcp-client`.
  - `defaultAgentActor(principal: string, clientName: string): AgentActor` → `{ id: 'agent:<principal>:<client>', name: '<client> (for <principal>)', kind: 'agent', onBehalfOf: principal }`.
  - `interface AssembledMcp { tools: McpTool[]; dispatch: Dispatch; handles: HandleRegistry<HandleSession>; stop(): Promise<void> }` and `assembleMcp(options: BlokMcpOptions, deps?: { openOverride?: DispatcherDeps['open'] }): AssembledMcp` in `src/mcp/server.ts`. In this task `open` answers `SOURCE_UNAVAILABLE` "no document source is configured" and `list` answers `supported: false`; Task 13 and Task 20 replace them with the real opener.
  - `runCli(argv: string[], env: NodeJS.ProcessEnv): Promise<void>` in `src/mcp/index.ts`: parses, loads `--manifest` / `--manifest-overrides` JSON, serves stdio (HTTP lands in Task 25), closes every handle on stdin end / SIGINT / SIGTERM.

SDK facts used (read from the packed 2.3.1 `.d.mts`, see "Facts checked"): `new Server(info, { capabilities: { tools: {} } })`, `server.setRequestHandler('tools/list', handler)`, `server.setRequestHandler('tools/call', (request, ctx) => ...)`, `server.getClientVersion()`, `server.projectCallToolResult(result, outputSchema)`, `serveStdio(factory)`. **Unverified until Step 2 runs:** the exact request field names (`request.params.name`, `request.params.arguments`) and whether `ProtocolError(ProtocolErrorCode.InvalidParams, message)` is the constructor shape. Before writing Step 3, open `node_modules/@modelcontextprotocol/server/dist/index.d.mts` and confirm both; adjust only `sdk-server.ts`.

- [ ] **Step 1: Write the failing tests**

`test/unit/mcp/actor.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { defaultAgentActor, safeClientName } from '../../../src/mcp/actor';

describe('agent actor', () => {
  it('builds an agent id that is never the human id', () => {
    expect(defaultAgentActor('user-42', 'claude-code')).toEqual({
      id: 'agent:user-42:claude-code',
      name: 'claude-code (for user-42)',
      kind: 'agent',
      onBehalfOf: 'user-42',
    });
  });

  it('cleans client names before they reach an id', () => {
    expect(safeClientName('Claude Desktop/1.0 (mac)')).toBe('Claude-Desktop-1.0--mac-');
    expect(safeClientName(undefined)).toBe('mcp-client');
    expect(safeClientName('')).toBe('mcp-client');
    expect(safeClientName('x'.repeat(200))).toHaveLength(64);
  });
});
```

`test/unit/mcp/sdk-server.test.ts`:

```ts
// @vitest-environment node
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAgentTools } from '../../../src/agent/render-tools';
import { buildMcpContracts } from '../../../src/mcp/contract';
import type { Caller, ToolOutcome } from '../../../src/mcp/dispatcher';
import { buildSdkServer } from '../../../src/mcp/sdk-server';
import { listMcpTools } from '../../../src/mcp/tools';

describe('buildSdkServer', () => {
  const { stored } = buildMcpContracts({ pageTitles: 'off' });
  const tools = listMcpTools(stored, { schema: 'envelope', handleIdleMs: 600_000 });
  const seen: Array<{ name: string; caller: Caller }> = [];
  let client: Client;

  beforeEach(async () => {
    vi.clearAllMocks();
    seen.length = 0;
    const dispatch = vi.fn(async (name: string, _args: Record<string, unknown>, caller: Caller): Promise<ToolOutcome> => {
      seen.push({ name, caller });

      return { structuredContent: { error: { code: 'UNKNOWN_HANDLE', message: 'gone', retryable: false } }, isError: true };
    });
    const server = buildSdkServer({
      tools,
      dispatch,
      caller: (clientName) => ({ principal: 'local', clientName, scopes: null }),
      version: '0.0.0-test',
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();

    await server.connect(serverSide);
    client = new Client({ name: 'sdk-test', version: '1' });
    await client.connect(clientSide);
  });

  afterEach(async () => {
    await client.close();
    vi.restoreAllMocks();
  });

  it('lists the renderer schemas byte for byte', async () => {
    const listed = await client.listTools();
    const core = renderAgentTools(stored, { format: 'mcp', handle: true, schema: 'envelope' });

    for (const tool of core) {
      expect(listed.tools.find((entry) => entry.name === tool.name)).toMatchObject({
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
      });
    }
    expect(listed.tools).toHaveLength(6);
  });

  it('returns structuredContent plus the same JSON as text, with isError', async () => {
    const result = await client.callTool({ name: 'blok_read', arguments: { handle: 'nope' } });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ error: { code: 'UNKNOWN_HANDLE', message: 'gone', retryable: false } });
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
  });

  it('passes the client name to the caller', async () => {
    await client.callTool({ name: 'blok_read', arguments: { handle: 'nope' } });

    expect(seen[0].caller.clientName).toBe('sdk-test');
  });
});
```

If `@modelcontextprotocol/client` 2.3.1's `Client.connect` against an in-memory `Server` negotiates a different era than the one the request handlers see, keep the test and adjust only `sdk-server.ts`; the assertions are era-independent.

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/mcp/actor.test.ts`, then `yarn test test/unit/mcp/sdk-server.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write minimal implementation**

`src/mcp/actor.ts`:

```ts
import type { AgentActor } from '../shared/agent';

const MAX_CLIENT_NAME = 64;

/** The client name ends up inside an actor id, so only id-safe characters pass. */
export const safeClientName = (raw: string | undefined): string => {
  const cleaned = (raw ?? '').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, MAX_CLIENT_NAME);

  return cleaned === '' ? 'mcp-client' : cleaned;
};

export const defaultAgentActor = (principal: string, clientName: string): AgentActor => ({
  // Never the human's id: two connections with one verified id merge into one participant row (participants.ts:80).
  id: `agent:${principal}:${clientName}`,
  name: `${clientName} (for ${principal})`,
  kind: 'agent',
  onBehalfOf: principal,
});
```

`src/mcp/sdk-server.ts`:

```ts
import { ProtocolError, ProtocolErrorCode, Server } from '@modelcontextprotocol/server';
import { safeClientName } from './actor';
import type { Caller, ToolOutcome } from './dispatcher';
import { UnknownToolError } from './dispatcher';
import type { McpTool } from './tools';

export type Dispatch = (name: string, args: Record<string, unknown>, caller: Caller) => Promise<ToolOutcome>;

/**
 * Low-level Server, not McpServer.registerTool: registerTool re-serializes a
 * Standard Schema, and the renderer law needs its JSON passed through as is.
 */
export const buildSdkServer = (input: {
  tools: McpTool[];
  dispatch: Dispatch;
  caller: (clientName: string) => Caller;
  version: string;
}): Server => {
  const server = new Server({ name: 'blok-mcp', version: input.version }, { capabilities: { tools: {} } });
  const byName = new Map(input.tools.map((tool) => [tool.name, tool]));

  server.setRequestHandler('tools/list', async () => ({ tools: input.tools }));
  server.setRequestHandler('tools/call', async (request) => {
    const name = request.params.name;
    const tool = byName.get(name);

    if (tool === undefined) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown tool: ${name}`);
    }
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const outcome: ToolOutcome = await input.dispatch(name, args, input.caller(safeClientName(server.getClientVersion()?.name)))
      .catch((thrown: unknown) => {
        if (thrown instanceof UnknownToolError) {
          throw new ProtocolError(ProtocolErrorCode.InvalidParams, thrown.message);
        }
        throw thrown;
      });

    return server.projectCallToolResult(
      {
        content: [{ type: 'text', text: JSON.stringify(outcome.structuredContent) }],
        structuredContent: outcome.structuredContent,
        isError: outcome.isError,
      },
      tool.outputSchema,
    );
  });

  return server;
};
```

`src/mcp/server.ts`:

```ts
import { buildMcpContracts } from './contract';
import type { Caller, DispatcherDeps, ListResult } from './dispatcher';
import { createToolDispatcher } from './dispatcher';
import { surfaceError } from './errors';
import { HandleRegistry } from './handles';
import type { BlokMcpOptions } from './options';
import { DEFAULTS } from './options';
import type { Dispatch } from './sdk-server';
import type { HandleSession } from './session';
import type { McpTool } from './tools';
import { listMcpTools } from './tools';

export interface AssembledMcp {
  tools: McpTool[];
  dispatch: Dispatch;
  handles: HandleRegistry<HandleSession>;
  stop(): Promise<void>;
}

export interface AssembleDeps {
  open?: DispatcherDeps['open'];
  list?: DispatcherDeps['list'];
}

const noSource: DispatcherDeps['open'] = async () => {
  throw surfaceError('SOURCE_UNAVAILABLE', 'No document source is configured. Start blok-mcp with --source or --sync-url.');
};

const cannotList = async (): Promise<ListResult> => ({ documents: [], nextCursor: null, supported: false });

export const assembleMcp = (options: BlokMcpOptions, deps: AssembleDeps = {}): AssembledMcp => {
  const handleIdleMs = options.handleIdleMs ?? DEFAULTS.handleIdleMs;
  const contracts = buildMcpContracts({
    manifest: options.manifest,
    overrides: options.overrides,
    pageTitles: options.pageTitles ?? DEFAULTS.pageTitles,
    richTextFields: options.richTextFields,
  });
  const handles = new HandleRegistry<HandleSession>({
    idleMs: handleIdleMs,
    maxPerPrincipal: options.maxHandlesPerPrincipal ?? DEFAULTS.maxHandlesPerPrincipal,
    onExpire: async (session) => {
      await session.close('expired');
    },
  });
  const sweeper = setInterval(() => {
    void handles.sweep();
  }, Math.min(handleIdleMs, 30_000));

  // A sweep timer must never keep a finished CLI alive.
  sweeper.unref();

  const authorize = options.authorize;
  const dispatch = createToolDispatcher({
    handles,
    open: deps.open ?? noSource,
    list: deps.list ?? cannotList,
    stillAllowed: async (caller: Caller, documentId: string, write: boolean) =>
      authorize === undefined ? true : authorize(caller.principal, documentId, write),
    handleIdleMs,
  });

  return {
    tools: listMcpTools(contracts.stored, { schema: options.schema ?? DEFAULTS.schema, handleIdleMs }),
    dispatch,
    handles,
    stop: async () => {
      clearInterval(sweeper);
      await handles.closeAll(async (session) => {
        await session.close('closed');
      });
    },
  };
};
```

`src/mcp/index.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { getBlokVersion } from '../components/utils/version';
import { checkOptionSafety, McpConfigError, parseMcpArgs } from './config';
import { parseCustomToolsFile, parseOverridesFile } from './custom-tools-file';
import type { BlokMcpOptions } from './options';
import { DEFAULTS } from './options';
import { buildSdkServer } from './sdk-server';
import { assembleMcp } from './server';

export type { BlokMcpOptions } from './options';

const readJsonFile = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf-8'));

export const createBlokMcpServer = (options: BlokMcpOptions): { start(): Promise<void>; stop(): Promise<void> } => {
  checkOptionSafety(options);
  const assembled = assembleMcp(options);
  const running: { handle: { close(): Promise<void> } | null } = { handle: null };

  return {
    start: async () => {
      if (options.transport.kind === 'http') {
        throw new McpConfigError('HTTP transport is not available yet');
      }
      running.handle = serveStdio(() => buildSdkServer({
        tools: assembled.tools,
        dispatch: assembled.dispatch,
        caller: (clientName) => ({ principal: options.principal ?? DEFAULTS.principal, clientName, scopes: null }),
        version: getBlokVersion(),
      }));
    },
    stop: async () => {
      await assembled.stop();
      await running.handle?.close();
    },
  };
};

export const runCli = async (argv: string[], env: NodeJS.ProcessEnv): Promise<void> => {
  try {
    const { options, files } = parseMcpArgs(argv, env);
    const server = createBlokMcpServer({
      ...options,
      ...(files.manifest !== undefined && { manifest: parseCustomToolsFile(await readJsonFile(files.manifest)) }),
      ...(files.overrides !== undefined && { overrides: parseOverridesFile(await readJsonFile(files.overrides)) }),
    });
    const shutdown = (): void => {
      void server.stop().finally(() => process.exit(0));
    };

    process.stdin.once('end', shutdown);
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    await server.start();
  } catch (thrown) {
    if (thrown instanceof McpConfigError) {
      console.error(`blok-mcp: ${thrown.message}`);
      process.exit(2);
    }
    throw thrown;
  }
};
```

`--authorize <module|url>` is loaded in Task 23, `--http` in Task 25, sources in Task 13, live in Task 20.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/mcp/actor.test.ts`, then `yarn test test/unit/mcp/sdk-server.test.ts`
Expected: PASS.
Run: `yarn build:mcp && yarn test test/unit/mcp/bin.test.ts`
Expected: PASS (both cases). If "answers initialize" fails because the bundle touches the DOM at import (a `ReferenceError: document is not defined` on stderr), find the import chain with `node --stack-trace-limit=50 packages/mcp/bin/blok-mcp.mjs` and move the DOM-touching import behind the seam that needs it; do not add a DOM shim.

- [ ] **Step 5: Commit**

```bash
npx eslint src/mcp/actor.ts src/mcp/sdk-server.ts src/mcp/server.ts src/mcp/index.ts test/unit/mcp/actor.test.ts test/unit/mcp/sdk-server.test.ts test/unit/mcp/bin.test.ts
git add src/mcp/actor.ts src/mcp/sdk-server.ts src/mcp/server.ts src/mcp/index.ts test/unit/mcp/actor.test.ts test/unit/mcp/sdk-server.test.ts test/unit/mcp/bin.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): serve the six tools over stdio with the MCP SDK" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Checkpoint 1

- [ ] Run each Phase 1 test file on its own: `yarn test test/unit/mcp/package.test.ts`, `errors`, `stdout-guard`, `config`, `custom-tools-file`, `contract`, `handles`, `dispatcher`, `actor`, `sdk-server`, `bin`; `yarn test test/unit/architecture/mcp-tools-from-renderer-law.test.ts`; `yarn test test/unit/architecture/view-entry-law.test.ts` (01's `src/mcp/` exception must hold with real files now); `yarn test test/unit/architecture/published-types-no-src-refs.test.ts`; `yarn test test/unit/scripts/release-manifest.test.ts test/unit/scripts/build-all.test.ts`.
- [ ] Type check: `NODE_OPTIONS=--max-old-space-size=8192 yarn lint:types` (memory: local tsc needs 8 GB).
- [ ] Manual smoke: add `{"mcpServers":{"blok":{"command":"node","args":["<repo>/packages/mcp/bin/blok-mcp.mjs","--source","files:/tmp/blok-docs"]}}}` to a scratch Claude Code MCP config and confirm the six tools are listed. Record the protocol revision the client negotiated (resolves the spec's unverified §3.7 item).
- [ ] `git pull --rebase && git push`. `git status` says "up to date with origin".

---

## Phase 2 — Stored-document mode

### Task 10: Document sources: types and the `files` source

**Files:**
- Create: `src/mcp/sources/types.ts`, `src/mcp/sources/files.ts`, `test/unit/mcp/sources-files.test.ts`

**Interfaces:**
- Consumes: `surfaceError` (Task 2).
- Produces:

```ts
// src/mcp/sources/types.ts
export interface LoadedDocument { raw: unknown; version: string | null }   // raw = { blocks: [...] , ... } as stored, before 01's loader
export interface SourceListing { documents: Array<{ id: string; title: string | null }>; nextCursor: string | null }
export interface DocumentSource {
  readonly kind: 'files' | 'endpoint';
  load(documentId: string): Promise<LoadedDocument>;                                  // SOURCE_UNAVAILABLE on unreadable / wrong shape
  save(documentId: string, document: unknown, options: { ifVersion: string | null }): Promise<{ version: string | null }>; // DOCUMENT_CHANGED on stale
  list?(request: { query?: string; cursor?: string; limit: number }): Promise<SourceListing>;
}
export const assertDocumentShape: (value: unknown, where: string) => void;   // object with a `blocks` array, else SOURCE_UNAVAILABLE

// src/mcp/sources/files.ts
export const createFilesSource: (dir: string) => DocumentSource;
```

Rules: id must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$` (else `INVALID_ARGS`); file is `<dir>/<id>.json`; a missing file loads as `{ blocks: [] }` with `version: null`; version = SHA-256 hex of the file bytes; save writes a temp file in the same directory and renames it (atomic on one filesystem); compare-and-swap on the hash. The check-then-rename window is not locked; two local writers inside it can still race. That is accepted for local stdio use and stated in the README (Task 28).

- [ ] **Step 1: Write the failing test**

`test/unit/mcp/sources-files.test.ts`:

```ts
// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isMcpSurfaceError } from '../../../src/mcp/errors';
import { createFilesSource } from '../../../src/mcp/sources/files';

const codeOf = async (promise: Promise<unknown>): Promise<string | undefined> =>
  promise.then(() => undefined, (thrown: unknown) => (isMcpSurfaceError(thrown) ? thrown.agentError.code : String(thrown)));

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

describe('files source', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'blok-mcp-files-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads a missing document as empty with no version', async () => {
    expect(await createFilesSource(dir).load('fresh')).toEqual({ raw: { blocks: [] }, version: null });
  });

  it('loads a document with the SHA-256 of its bytes as version', async () => {
    const text = '{"blocks":[{"id":"a","type":"paragraph","data":{"text":"<b>hi</b>"}}]}';

    writeFileSync(join(dir, 'doc.json'), text);
    expect(await createFilesSource(dir).load('doc')).toEqual({ raw: JSON.parse(text), version: sha(text) });
  });

  it.each([
    ['not json', '{blocks'],
    ['an array', '[]'],
    ['no blocks', '{}'],
    ['blocks not an array', '{"blocks":{}}'],
  ])('refuses %s with SOURCE_UNAVAILABLE (Review Focus 5)', async (_label, text) => {
    writeFileSync(join(dir, 'bad.json'), text);
    expect(await codeOf(createFilesSource(dir).load('bad'))).toBe('SOURCE_UNAVAILABLE');
  });

  it.each(['../escape', 'a/b', '', '.', '..', '%2e%2e', 'x'.repeat(201), '.hidden'])(
    'refuses id %j without touching the disk (Review Focus 3)',
    async (id) => {
      const source = createFilesSource(dir);

      expect(await codeOf(source.load(id))).toBe('INVALID_ARGS');
      expect(await codeOf(source.save(id, { blocks: [] }, { ifVersion: null }))).toBe('INVALID_ARGS');
      expect(readdirSync(dir)).toEqual([]);
    },
  );

  it('saves atomically and returns the new hash', async () => {
    const source = createFilesSource(dir);
    const { version } = await source.save('doc', { blocks: [] }, { ifVersion: null });
    const written = readFileSync(join(dir, 'doc.json'), 'utf-8');

    expect(version).toBe(sha(written));
    expect(readdirSync(dir)).toEqual(['doc.json']);
  });

  it('chains versions across saves', async () => {
    const source = createFilesSource(dir);
    const first = await source.save('doc', { blocks: [] }, { ifVersion: null });
    const second = await source.save('doc', { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'x' } }] }, { ifVersion: first.version });

    expect(second.version).not.toBe(first.version);
  });

  it('refuses a stale save with DOCUMENT_CHANGED, even for a same-size edit', async () => {
    const source = createFilesSource(dir);
    const { version } = await source.save('doc', { blocks: [], title: 'aaaa' }, { ifVersion: null });

    writeFileSync(join(dir, 'doc.json'), JSON.stringify({ blocks: [], title: 'bbbb' }));
    expect(await codeOf(source.save('doc', { blocks: [] }, { ifVersion: version }))).toBe('DOCUMENT_CHANGED');
  });

  it('refuses a first save when the file appeared meanwhile', async () => {
    writeFileSync(join(dir, 'doc.json'), '{"blocks":[]}');
    expect(await codeOf(createFilesSource(dir).save('doc', { blocks: [] }, { ifVersion: null }))).toBe('DOCUMENT_CHANGED');
  });

  it('lists documents with titles, filtered and paged', async () => {
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ blocks: [], title: 'Alpha plan' }));
    writeFileSync(join(dir, 'b.json'), JSON.stringify({ blocks: [] }));
    writeFileSync(join(dir, 'c.json'), JSON.stringify({ blocks: [], title: 'Gamma plan' }));
    writeFileSync(join(dir, 'notes.txt'), 'skip');
    const source = createFilesSource(dir);

    expect(await source.list?.({ limit: 2 })).toEqual({
      documents: [{ id: 'a', title: 'Alpha plan' }, { id: 'b', title: null }],
      nextCursor: 'b',
    });
    expect(await source.list?.({ limit: 2, cursor: 'b' })).toEqual({ documents: [{ id: 'c', title: 'Gamma plan' }], nextCursor: null });
    expect((await source.list?.({ limit: 10, query: 'PLAN' }))?.documents.map((doc) => doc.id)).toEqual(['a', 'c']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/mcp/sources-files.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

`src/mcp/sources/types.ts`:

```ts
import { surfaceError } from '../errors';

export interface LoadedDocument { raw: unknown; version: string | null }
export interface SourceListing { documents: Array<{ id: string; title: string | null }>; nextCursor: string | null }

export interface DocumentSource {
  readonly kind: 'files' | 'endpoint';
  load(documentId: string): Promise<LoadedDocument>;
  save(documentId: string, document: unknown, options: { ifVersion: string | null }): Promise<{ version: string | null }>;
  list?(request: { query?: string; cursor?: string; limit: number }): Promise<SourceListing>;
}

export const assertDocumentShape = (value: unknown, where: string): void => {
  const isDoc = typeof value === 'object' && value !== null && !Array.isArray(value)
    && Array.isArray((value as { blocks?: unknown }).blocks);

  if (!isDoc) {
    throw surfaceError('SOURCE_UNAVAILABLE', `${where} is not a Blok document: expected an object with a "blocks" array.`);
  }
};
```

`src/mcp/sources/files.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { surfaceError } from '../errors';
import type { DocumentSource } from './types';
import { assertDocumentShape } from './types';

// Starts with a letter or digit, so ".", ".." and dotfiles never match; no "/" or "\" can appear.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

const hash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

const isMissing = (thrown: unknown): boolean =>
  typeof thrown === 'object' && thrown !== null && (thrown as { code?: unknown }).code === 'ENOENT';

export const createFilesSource = (dir: string): DocumentSource => {
  const pathOf = (documentId: string): string => {
    if (!SAFE_ID.test(documentId)) {
      throw surfaceError('INVALID_ARGS', 'With the files source, a document id uses letters, digits, ".", "_" and "-" only (max 200).');
    }

    return join(dir, `${documentId}.json`);
  };

  const readBytes = async (path: string): Promise<Buffer | null> => {
    try {
      return await readFile(path);
    } catch (thrown) {
      if (isMissing(thrown)) {
        return null;
      }
      throw surfaceError('SOURCE_UNAVAILABLE', `Cannot read ${path}.`);
    }
  };

  const titleOf = async (id: string): Promise<string | null> => {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(dir, `${id}.json`), 'utf-8'));
      const title = (parsed as { title?: unknown }).title;

      return typeof title === 'string' && title !== '' ? title : null;
    } catch {
      return null;
    }
  };

  return {
    kind: 'files',
    load: async (documentId) => {
      const path = pathOf(documentId);
      const bytes = await readBytes(path);

      if (bytes === null) {
        return { raw: { blocks: [] }, version: null };
      }
      const raw: unknown = (() => {
        try {
          return JSON.parse(bytes.toString('utf-8'));
        } catch {
          throw surfaceError('SOURCE_UNAVAILABLE', `${documentId}.json is not valid JSON.`);
        }
      })();

      assertDocumentShape(raw, `${documentId}.json`);

      return { raw, version: hash(bytes) };
    },
    save: async (documentId, document, { ifVersion }) => {
      const path = pathOf(documentId);
      const current = await readBytes(path);

      if ((current === null ? null : hash(current)) !== ifVersion) {
        throw surfaceError('DOCUMENT_CHANGED', 'The document changed on disk since you opened it. Read it again, then retry.');
      }
      const text = `${JSON.stringify(document, null, 2)}\n`;
      const temp = join(dir, `.${documentId}.${randomBytes(6).toString('hex')}.tmp`);

      try {
        await writeFile(temp, text);
        await rename(temp, path);
      } catch {
        await rm(temp, { force: true });
        throw surfaceError('SOURCE_UNAVAILABLE', `Cannot write ${path}.`);
      }

      return { version: hash(text) };
    },
    list: async ({ query, cursor, limit }) => {
      const ids = (await readdir(dir))
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -'.json'.length))
        .filter((id) => SAFE_ID.test(id))
        .sort();
      const titled = await Promise.all(ids.map(async (id) => ({ id, title: await titleOf(id) })));
      const needle = query?.toLowerCase();
      const matching = titled.filter((doc) => needle === undefined
        || doc.id.toLowerCase().includes(needle) || (doc.title ?? '').toLowerCase().includes(needle));
      const start = cursor === undefined ? 0 : matching.findIndex((doc) => doc.id > cursor);
      const page = start === -1 ? [] : matching.slice(start, start + limit);
      const more = start !== -1 && start + limit < matching.length;

      return { documents: page, nextCursor: more ? page[page.length - 1].id : null };
    },
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/mcp/sources-files.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/mcp/sources/types.ts src/mcp/sources/files.ts test/unit/mcp/sources-files.test.ts
git add src/mcp/sources/types.ts src/mcp/sources/files.ts test/unit/mcp/sources-files.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): files document source with atomic, hash-checked saves" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `endpoint` source (the host's existing doc routes)

**Files:**
- Create: `src/mcp/sources/endpoint.ts`, `test/unit/mcp/sources-endpoint.test.ts`

**Interfaces:**
- Consumes: `DocumentSource`, `assertDocumentShape` (Task 10).
- Produces: `createEndpointSource(config: { url: string; endpointAuth: string; list?: string }, fetchImpl?: typeof fetch): DocumentSource`.

Contract reused from `packages/server/README.md:518-526`:
- `GET {url}/{id}` with `Authorization: <endpointAuth>` (sent verbatim). `200` with `null`, `{"data": null, "version": "0"}`, `{"data": <doc>, "version": "<v>"}`, or the bare document. Anything else → `SOURCE_UNAVAILABLE`.
- `PUT {url}/{id}` with the bare document, `Blok-Doc-Version: <ifVersion>` when known. `409` → `DOCUMENT_CHANGED`. Other non-2xx → `SOURCE_UNAVAILABLE`. A JSON body with a string `version` sets the next version; an empty body keeps `ifVersion`.
- `list` (optional, new for MCP; documented in README, Task 28): `GET {list}?query=&cursor=&limit=` → `{ "documents": [{ "id", "title"? }], "nextCursor"? }`.
- The id is percent-encoded with `encodeURIComponent` (Review Focus 3).

- [ ] **Step 1: Write the failing test**

`test/unit/mcp/sources-endpoint.test.ts`:

```ts
// @vitest-environment node
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isMcpSurfaceError } from '../../../src/mcp/errors';
import { createEndpointSource } from '../../../src/mcp/sources/endpoint';

interface Seen { method: string; path: string; headers: IncomingMessage['headers']; body: string }

const codeOf = async (promise: Promise<unknown>): Promise<string | undefined> =>
  promise.then(() => undefined, (thrown: unknown) => (isMcpSurfaceError(thrown) ? thrown.agentError.code : String(thrown)));

describe('endpoint source', () => {
  let server: Server;
  let base: string;
  const seen: Seen[] = [];
  let answer: (request: Seen, response: ServerResponse) => void = (_r, response) => response.end();

  beforeEach(async () => {
    seen.length = 0;
    server = createServer((request, response) => {
      let body = '';

      request.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf-8');
      });
      request.on('end', () => {
        const entry = { method: request.method ?? '', path: request.url ?? '', headers: request.headers, body };

        seen.push(entry);
        answer(entry, response);
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/docs`;
  });

  afterEach(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  const json = (response: ServerResponse, status: number, value: unknown): void => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
  };

  it('loads an envelope and sends the auth header verbatim', async () => {
    answer = (_r, response) => json(response, 200, { data: { blocks: [] }, version: '7' });
    const source = createEndpointSource({ url: base, endpointAuth: 'Bearer host-secret' });

    expect(await source.load('doc-1')).toEqual({ raw: { blocks: [] }, version: '7' });
    expect(seen[0]).toMatchObject({ method: 'GET', path: '/docs/doc-1' });
    expect(seen[0].headers.authorization).toBe('Bearer host-secret');
  });

  it.each([
    ['null', null, { raw: { blocks: [] }, version: null }],
    ['an empty envelope', { data: null, version: '0' }, { raw: { blocks: [] }, version: '0' }],
    ['a bare document', { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'x' } }] }, { raw: { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'x' } }] }, version: null }],
  ])('loads %s', async (_label, body, expected) => {
    answer = (_r, response) => json(response, 200, body);
    expect(await createEndpointSource({ url: base, endpointAuth: 'a' }).load('d')).toEqual(expected);
  });

  it('percent-encodes the id (Review Focus 3)', async () => {
    answer = (_r, response) => json(response, 200, null);
    await createEndpointSource({ url: base, endpointAuth: 'a' }).load('../a b/%2e');

    expect(seen[0].path).toBe('/docs/..%2Fa%20b%2F%252e');
  });

  it.each([404, 500, 204])('maps GET %i to SOURCE_UNAVAILABLE', async (status) => {
    answer = (_r, response) => {
      response.writeHead(status);
      response.end();
    };
    expect(await codeOf(createEndpointSource({ url: base, endpointAuth: 'a' }).load('d'))).toBe('SOURCE_UNAVAILABLE');
  });

  it('PUTs the bare document with Blok-Doc-Version and chains the answered version', async () => {
    answer = (_r, response) => json(response, 200, { version: '8' });
    const source = createEndpointSource({ url: base, endpointAuth: 'a' });

    expect(await source.save('d', { blocks: [] }, { ifVersion: '7' })).toEqual({ version: '8' });
    expect(seen[0]).toMatchObject({ method: 'PUT', path: '/docs/d', body: '{"blocks":[]}' });
    expect(seen[0].headers['blok-doc-version']).toBe('7');
  });

  it('keeps the version on an empty 2xx body, and sends no header without one', async () => {
    answer = (_r, response) => {
      response.writeHead(204);
      response.end();
    };
    const source = createEndpointSource({ url: base, endpointAuth: 'a' });

    expect(await source.save('d', { blocks: [] }, { ifVersion: null })).toEqual({ version: null });
    expect(seen[0].headers['blok-doc-version']).toBeUndefined();
    expect(await source.save('d', { blocks: [] }, { ifVersion: '3' })).toEqual({ version: '3' });
  });

  it('maps 409 to DOCUMENT_CHANGED', async () => {
    answer = (_r, response) => {
      response.writeHead(409);
      response.end();
    };
    expect(await codeOf(createEndpointSource({ url: base, endpointAuth: 'a' }).save('d', { blocks: [] }, { ifVersion: '1' }))).toBe('DOCUMENT_CHANGED');
  });

  it('maps a network failure to SOURCE_UNAVAILABLE', async () => {
    const source = createEndpointSource({ url: 'http://127.0.0.1:1/docs', endpointAuth: 'a' });

    expect(await codeOf(source.load('d'))).toBe('SOURCE_UNAVAILABLE');
  });

  it('lists through the optional list route', async () => {
    answer = (_r, response) => json(response, 200, { documents: [{ id: 'a', title: 'A' }, { id: 'b' }], nextCursor: 'b' });
    const source = createEndpointSource({ url: base, endpointAuth: 'a', list: `${base}-index` });

    expect(await source.list?.({ query: 'pl an', limit: 2 })).toEqual({
      documents: [{ id: 'a', title: 'A' }, { id: 'b', title: null }],
      nextCursor: 'b',
    });
    expect(seen[0].path).toBe('/docs-index?query=pl+an&limit=2');
  });

  it('has no list without a list route', () => {
    expect(createEndpointSource({ url: base, endpointAuth: 'a' }).list).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/mcp/sources-endpoint.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

`src/mcp/sources/endpoint.ts`:

```ts
import { surfaceError } from '../errors';
import type { DocumentSource, SourceListing } from './types';
import { assertDocumentShape } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const unavailable = (what: string): Error => surfaceError('SOURCE_UNAVAILABLE', `The document endpoint ${what}.`);

export const createEndpointSource = (
  config: { url: string; endpointAuth: string; list?: string },
  fetchImpl: typeof fetch = fetch,
): DocumentSource => {
  const urlOf = (documentId: string): string => `${config.url.replace(/\/$/, '')}/${encodeURIComponent(documentId)}`;

  const call = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await fetchImpl(url, init);
    } catch {
      throw unavailable('could not be reached');
    }
  };

  const source: DocumentSource = {
    kind: 'endpoint',
    load: async (documentId) => {
      const response = await call(urlOf(documentId), { headers: { Authorization: config.endpointAuth } });

      if (response.status !== 200) {
        throw unavailable(`answered ${response.status} for ${documentId}`);
      }
      const text = await response.text();
      const body: unknown = (() => {
        try {
          return JSON.parse(text);
        } catch {
          throw unavailable(`answered non-JSON for ${documentId}`);
        }
      })();

      if (body === null) {
        return { raw: { blocks: [] }, version: null };
      }
      if (isRecord(body) && 'data' in body && !('blocks' in body)) {
        const version = typeof body.version === 'string' ? body.version : null;

        if (body.data === null) {
          return { raw: { blocks: [] }, version };
        }
        assertDocumentShape(body.data, documentId);

        return { raw: body.data, version };
      }
      assertDocumentShape(body, documentId);

      return { raw: body, version: null };
    },
    save: async (documentId, document, { ifVersion }) => {
      const response = await call(urlOf(documentId), {
        method: 'PUT',
        headers: {
          Authorization: config.endpointAuth,
          'Content-Type': 'application/json',
          ...(ifVersion !== null && { 'Blok-Doc-Version': ifVersion }),
        },
        body: JSON.stringify(document),
      });

      // README recommends 409 for a stale PUT; without it the host is last-writer-wins (spec §3.6).
      if (response.status === 409) {
        throw surfaceError('DOCUMENT_CHANGED', 'Someone saved this document since you opened it. Read it again, then retry.');
      }
      if (response.status < 200 || response.status > 299) {
        throw unavailable(`refused the save with ${response.status}`);
      }
      const text = await response.text();

      if (text === '') {
        return { version: ifVersion };
      }
      try {
        const body: unknown = JSON.parse(text);

        return { version: isRecord(body) && typeof body.version === 'string' ? body.version : ifVersion };
      } catch {
        return { version: ifVersion };
      }
    },
  };

  if (config.list !== undefined) {
    const listUrl = config.list;

    source.list = async ({ query, cursor, limit }): Promise<SourceListing> => {
      const params = new URLSearchParams({
        ...(query !== undefined && { query }),
        ...(cursor !== undefined && { cursor }),
        limit: String(limit),
      });
      const response = await call(`${listUrl}?${params.toString()}`, { headers: { Authorization: config.endpointAuth } });

      if (response.status !== 200) {
        throw unavailable(`list answered ${response.status}`);
      }
      const body: unknown = await response.json();

      if (!isRecord(body) || !Array.isArray(body.documents)) {
        throw unavailable('list answered without a "documents" array');
      }

      return {
        documents: body.documents.filter(isRecord).filter((doc) => typeof doc.id === 'string').map((doc) => ({
          id: doc.id as string,
          title: typeof doc.title === 'string' ? doc.title : null,
        })),
        nextCursor: typeof body.nextCursor === 'string' ? body.nextCursor : null,
      };
    };
  }

  return source;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/mcp/sources-endpoint.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/mcp/sources/endpoint.ts test/unit/mcp/sources-endpoint.test.ts
git add src/mcp/sources/endpoint.ts test/unit/mcp/sources-endpoint.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): endpoint document source over the host's doc routes" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Stored session

**Files:**
- Create: `src/mcp/stored-session.ts`, `test/unit/mcp/stored-session.test.ts`

**Interfaces:**
- Consumes: `DocumentSource` (Task 10); `HandleSession`, `McpExecuteResult`, `NO_DELIVERY` (Task 2); from 01, `AgentSession` and the `output()` extension; `AgentContract` (02).
- Produces:

```ts
export interface StoredSessionInput {
  documentId: string;
  write: boolean;
  source: DocumentSource;
  contract: AgentContract;
  /** 01's loader: rich fields holding HTML become segments (parse5). */
  loadDocument(raw: unknown): OutputData;
  /** 01's createDocumentAgentSession, bound to tools, contract, actor and ports. */
  createAgentSession(document: OutputData): AgentSession & { output(): OutputData };
}
export const openStoredSession: (input: StoredSessionInput) => Promise<HandleSession>;
```

Rules:
- A batch "writes" when any command's contract entry has `readOnly: false`. Unknown names do not count, so 01 answers them with `UNKNOWN_COMMAND`.
- `write: false` + a writing batch → `ok: false`, `READ_ONLY`, nothing runs.
- After an `ok` writing batch: `source.save(id, agent.output(), { ifVersion })`. Success → `delivery: { durable: true, pending: false, serverSequence: null, savedVersion }`.
- Save fails → reload from the source and rebuild the agent session, so memory never holds work the source refused; the result is `ok: false` with the save's error (`DOCUMENT_CHANGED` or `SOURCE_UNAVAILABLE`) and the batch's warnings. If the reload fails too, the next call reloads first.
- `history.undo` is ordinary here: 01 restores the snapshot, then it saves like any batch.
- `durability: 'saved-on-execute'`; close → `{ unsavedBatches: 0, hostRecordLags: false }`.

- [ ] **Step 1: Write the failing test**

`test/unit/mcp/stored-session.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { surfaceError } from '../../../src/mcp/errors';
import type { DocumentSource } from '../../../src/mcp/sources/types';
import { openStoredSession } from '../../../src/mcp/stored-session';

const okResult = { ok: true as const, revision: 'r', results: [], refs: {}, changed: { created: ['p1'], updated: [], moved: [], removed: [] }, warnings: [] };

const contract = {
  formatVersion: 1, revision: 'c1', manifest: {}, guidance: { general: '', commands: {}, tools: {} },
  commands: [
    { name: 'doc.read', readOnly: true, available: true },
    { name: 'block.insert', readOnly: false, available: true },
    { name: 'history.undo', readOnly: false, available: true },
  ],
} as never;

describe('openStoredSession', () => {
  let source: DocumentSource;
  let documents: unknown[];
  const agent = (doc: unknown) => ({
    id: 's', actor: { id: 'agent:x', name: 'x', kind: 'agent' as const },
    read: vi.fn(async () => ({ doc }) as never),
    describe: vi.fn(() => ({}) as never),
    execute: vi.fn(async () => okResult),
    log: () => [],
    close: () => undefined,
    output: () => ({ blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'x' } }] }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    documents = [];
    source = {
      kind: 'files',
      load: vi.fn(async () => ({ raw: { blocks: [] }, version: 'v1' })),
      save: vi.fn(async () => ({ version: 'v2' })),
    };
  });

  const open = (write = true) => openStoredSession({
    documentId: 'doc',
    write,
    source,
    contract,
    loadDocument: (raw) => {
      documents.push(raw);

      return raw as never;
    },
    createAgentSession: (document) => agent(document),
  });

  it('loads through 01 loader and reports its facts', async () => {
    const session = await open();

    expect(documents).toEqual([{ blocks: [] }]);
    expect(session).toMatchObject({ mode: 'stored', write: true, durability: 'saved-on-execute', contractRevision: 'c1' });
  });

  it('saves after a writing batch with the last version and reports it', async () => {
    const session = await open();
    const result = await session.execute({ commands: [{ name: 'block.insert', args: {} }] });

    expect(source.save).toHaveBeenCalledWith('doc', { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'x' } }] }, { ifVersion: 'v1' });
    expect(result).toMatchObject({ ok: true, delivery: { durable: true, pending: false, serverSequence: null, savedVersion: 'v2' } });
  });

  it('chains versions: the second save uses the first save version (Review Focus 1)', async () => {
    vi.mocked(source.save).mockResolvedValueOnce({ version: 'v2' }).mockResolvedValueOnce({ version: 'v3' });
    const session = await open();

    await session.execute({ commands: [{ name: 'block.insert', args: {} }] });
    await session.execute({ commands: [{ name: 'block.insert', args: {} }] });

    expect(vi.mocked(source.save).mock.calls.map((call) => call[2])).toEqual([{ ifVersion: 'v1' }, { ifVersion: 'v2' }]);
  });

  it('does not save a read-only batch', async () => {
    const session = await open();
    const result = await session.execute({ commands: [{ name: 'doc.read', args: {} }] });

    expect(source.save).not.toHaveBeenCalled();
    expect(result.delivery).toEqual({ durable: false, pending: false, serverSequence: null, savedVersion: null });
  });

  it('refuses writes on a read-only handle without running them', async () => {
    const session = await open(false);
    const result = await session.execute({ commands: [{ name: 'block.insert', args: {} }] });

    expect(result).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
    expect(source.save).not.toHaveBeenCalled();
  });

  it('on DOCUMENT_CHANGED reloads and reports the conflict', async () => {
    vi.mocked(source.save).mockRejectedValueOnce(surfaceError('DOCUMENT_CHANGED', 'stale'));
    vi.mocked(source.load).mockResolvedValueOnce({ raw: { blocks: [] }, version: 'v1' }).mockResolvedValueOnce({ raw: { blocks: [], title: 'theirs' }, version: 'v9' });
    const session = await open();
    const result = await session.execute({ commands: [{ name: 'block.insert', args: {} }] });

    expect(result).toMatchObject({ ok: false, error: { code: 'DOCUMENT_CHANGED' }, delivery: { durable: false } });
    expect(documents.at(-1)).toEqual({ blocks: [], title: 'theirs' });
    await session.execute({ commands: [{ name: 'block.insert', args: {} }] });
    expect(vi.mocked(source.save).mock.calls.at(-1)?.[2]).toEqual({ ifVersion: 'v9' });
  });

  it('saves an undo like any batch', async () => {
    const session = await open();

    await session.execute({ commands: [{ name: 'history.undo', args: {} }] });
    expect(source.save).toHaveBeenCalledTimes(1);
  });

  it('passes a failed batch through without saving', async () => {
    const failing = { ok: false as const, revision: 'r', error: { code: 'BLOCK_NOT_FOUND' as const, message: 'x', retryable: false }, warnings: [] };
    const session = await openStoredSession({
      documentId: 'doc', write: true, source, contract,
      loadDocument: (raw) => raw as never,
      createAgentSession: (document) => ({ ...agent(document), execute: vi.fn(async () => failing) }),
    });

    expect(await session.execute({ commands: [{ name: 'block.insert', args: {} }] })).toMatchObject({ ...failing, delivery: { durable: false } });
    expect(source.save).not.toHaveBeenCalled();
  });

  it('closes with nothing unsaved', async () => {
    expect(await (await open()).close('closed')).toEqual({ unsavedBatches: 0, hostRecordLags: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/mcp/stored-session.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

`src/mcp/stored-session.ts`:

```ts
import type { AgentBatch, AgentSession } from '../shared/agent';
import type { OutputData } from '../../types/data-formats/output-data';
import type { AgentContract } from '../../types/tool-manifest';
import { failedResult, isMcpSurfaceError, NO_DELIVERY, surfaceError } from './errors';
import type { HandleSession, McpExecuteResult } from './session';
import type { DocumentSource } from './sources/types';

export interface StoredSessionInput {
  documentId: string;
  write: boolean;
  source: DocumentSource;
  contract: AgentContract;
  loadDocument(raw: unknown): OutputData;
  createAgentSession(document: OutputData): AgentSession & { output(): OutputData };
}

export const openStoredSession = async (input: StoredSessionInput): Promise<HandleSession> => {
  const readOnlyByName = new Map(input.contract.commands.map((entry) => [entry.name, entry.readOnly]));
  const writes = (batch: AgentBatch): boolean => batch.commands.some((command) => readOnlyByName.get(command.name) === false);
  const state: { agent: AgentSession & { output(): OutputData }; version: string | null; stale: boolean } = {
    ...(await (async () => {
      const loaded = await input.source.load(input.documentId);

      return { agent: input.createAgentSession(input.loadDocument(loaded.raw)), version: loaded.version };
    })()),
    stale: false,
  };

  const reload = async (): Promise<void> => {
    const loaded = await input.source.load(input.documentId);

    state.agent = input.createAgentSession(input.loadDocument(loaded.raw));
    state.version = loaded.version;
    state.stale = false;
  };

  return {
    mode: 'stored',
    write: input.write,
    durability: 'saved-on-execute',
    contractRevision: input.contract.revision,
    read: async (args) => {
      if (state.stale) {
        await reload();
      }

      return state.agent.read(args);
    },
    describe: (query) => state.agent.describe(query),
    execute: async (batch): Promise<McpExecuteResult> => {
      if (state.stale) {
        await reload();
      }
      const writing = writes(batch);

      if (writing && !input.write) {
        return failedResult(surfaceError('READ_ONLY', 'This handle is read-only. Open the document with write: true.').agentError);
      }
      const result = await state.agent.execute(batch);

      if (!result.ok || !writing) {
        return { ...result, delivery: NO_DELIVERY };
      }
      try {
        const saved = await input.source.save(input.documentId, state.agent.output(), { ifVersion: state.version });

        state.version = saved.version;

        return { ...result, delivery: { durable: true, pending: false, serverSequence: null, savedVersion: saved.version } };
      } catch (thrown) {
        if (!isMcpSurfaceError(thrown)) {
          throw thrown;
        }
        // Memory must match the source: drop the refused work.
        state.stale = true;
        await reload().catch(() => undefined);

        return failedResult(thrown.agentError, result.warnings);
      }
    },
    close: async () => ({ unsavedBatches: 0, hostRecordLags: false }),
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/mcp/stored-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/mcp/stored-session.ts test/unit/mcp/stored-session.test.ts
git add src/mcp/stored-session.ts test/unit/mcp/stored-session.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): stored session saves every batch with version chaining" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Mode resolution, the opener, and stored wiring

**Files:**
- Create: `src/mcp/mode.ts`, `src/mcp/opener.ts`, `test/unit/mcp/mode.test.ts`
- Modify: `src/mcp/server.ts` (use the opener), `src/mcp/index.ts` (nothing else changes)

**Interfaces:**
- Consumes: `openStoredSession` (Task 12), `createFilesSource`, `createEndpointSource` (Tasks 10–11), `McpContracts` (Task 5), `defaultAgentActor` (Task 9); from 01, `createDocumentAgentSession`, `createHeadlessPorts`, `loadStoredDocument`.
- Produces:
  - `resolveMode(requested: 'auto' | 'live' | 'stored', syncConfigured: boolean): 'live' | 'stored'` — `stored` + sync → `STORED_WRITE_FORBIDDEN`; `live` without sync → `INVALID_ARGS`.
  - `createSource(source: BlokMcpOptions['source']): DocumentSource | null`
  - `interface OpenerDeps { options: BlokMcpOptions; contracts: McpContracts; source: DocumentSource | null; openLive?: (request: OpenRequest, caller: Caller, actor: AgentActor) => Promise<HandleSession>; portsFor(caller: Caller, actor: AgentActor): AgentPorts }`
  - `createOpener(deps: OpenerDeps): { open: DispatcherDeps['open']; list: DispatcherDeps['list']; actorFor(caller: Caller): AgentActor }`
  - `assembleMcp` now builds the opener (source from `options.source`, `portsFor` = `createHeadlessPorts({ sanitizeFor: (type) => contracts.runtimes.get(type)?.sanitize, richTextFieldsFor: contracts.richTextFieldsFor })`); `openLive` stays absent until Task 20, so `live` resolves to `INVALID_ARGS` "live mode needs --sync-url" until then.

The mode rule (spec §3.6): a stored-mode PUT next to a room would be overwritten or force a reset, so `stored` is refused whenever a sync URL is configured, even read-only.

- [ ] **Step 1: Write the failing test**

`test/unit/mcp/mode.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isMcpSurfaceError } from '../../../src/mcp/errors';
import { resolveMode } from '../../../src/mcp/mode';

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();

    return undefined;
  } catch (thrown) {
    return isMcpSurfaceError(thrown) ? thrown.agentError.code : 'other';
  }
};

describe('resolveMode', () => {
  it('auto picks live when a sync URL is configured, else stored', () => {
    expect(resolveMode('auto', true)).toBe('live');
    expect(resolveMode('auto', false)).toBe('stored');
  });

  it('refuses stored next to a sync service', () => {
    expect(codeOf(() => resolveMode('stored', true))).toBe('STORED_WRITE_FORBIDDEN');
    expect(resolveMode('stored', false)).toBe('stored');
  });

  it('refuses live without a sync URL', () => {
    expect(codeOf(() => resolveMode('live', false))).toBe('INVALID_ARGS');
    expect(resolveMode('live', true)).toBe('live');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/mcp/mode.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

`src/mcp/mode.ts`:

```ts
import { surfaceError } from './errors';

export const resolveMode = (requested: 'auto' | 'live' | 'stored', syncConfigured: boolean): 'live' | 'stored' => {
  if (requested === 'stored' && syncConfigured) {
    throw surfaceError(
      'STORED_WRITE_FORBIDDEN',
      'A live room owns this document, so stored edits would be overwritten. Open it with mode "live" or "auto".',
    );
  }
  if (requested === 'live' && !syncConfigured) {
    throw surfaceError('INVALID_ARGS', 'Live mode needs blok-mcp to run with --sync-url.');
  }
  if (requested === 'auto') {
    return syncConfigured ? 'live' : 'stored';
  }

  return requested;
};
```

`src/mcp/opener.ts`:

```ts
import type { AgentActor, AgentPorts } from '../shared/agent';
import { createDocumentAgentSession } from '../shared/agent/document-session';
import type { OutputData } from '../../types/data-formats/output-data';
import { loadStoredDocument } from '../view/agent-runtime';
import { defaultAgentActor } from './actor';
import type { McpContracts } from './contract';
import type { Caller, DispatcherDeps, ListResult, OpenRequest } from './dispatcher';
import { surfaceError } from './errors';
import { resolveMode } from './mode';
import type { BlokMcpOptions } from './options';
import type { HandleSession } from './session';
import { createEndpointSource } from './sources/endpoint';
import { createFilesSource } from './sources/files';
import type { DocumentSource } from './sources/types';
import { openStoredSession } from './stored-session';

export const createSource = (source: BlokMcpOptions['source']): DocumentSource | null => {
  if (source === undefined) {
    return null;
  }

  return source.kind === 'files' ? createFilesSource(source.dir) : createEndpointSource(source);
};

export interface OpenerDeps {
  options: BlokMcpOptions;
  contracts: McpContracts;
  source: DocumentSource | null;
  openLive?: (request: OpenRequest, caller: Caller, actor: AgentActor) => Promise<HandleSession>;
  portsFor(caller: Caller, actor: AgentActor): AgentPorts;
}

export const createOpener = (deps: OpenerDeps): { open: DispatcherDeps['open']; list: DispatcherDeps['list']; actorFor(caller: Caller): AgentActor } => {
  const syncConfigured = deps.options.sync !== undefined;
  const actorFor = (caller: Caller): AgentActor => (deps.options.agentActor ?? defaultAgentActor)(caller.principal, caller.clientName);

  const open: DispatcherDeps['open'] = async (request, caller) => {
    const mode = resolveMode(request.mode, syncConfigured);
    const actor = actorFor(caller);

    if (mode === 'live') {
      if (deps.openLive === undefined) {
        throw surfaceError('INVALID_ARGS', 'Live mode needs blok-mcp to run with --sync-url.');
      }

      return deps.openLive(request, caller, actor);
    }
    if (deps.source === null) {
      throw surfaceError('SOURCE_UNAVAILABLE', 'No document source is configured. Start blok-mcp with --source.');
    }

    return openStoredSession({
      documentId: request.documentId,
      write: request.write,
      source: deps.source,
      contract: deps.contracts.stored,
      // assertDocumentShape (Task 10) already checked `blocks`; 01's loader turns HTML rich fields into segments.
      loadDocument: (raw) => loadStoredDocument(raw as OutputData, deps.contracts.richTextFieldsFor),
      createAgentSession: (document) => createDocumentAgentSession({
        document,
        tools: deps.contracts.runtimes,
        contract: deps.contracts.stored,
        actor,
        ports: deps.portsFor(caller, actor),
        // 01 builds the Node pageBackend (createPageMapBackend) only with this flag and the port (Task 26).
        ...(deps.options.pageTitles === 'page-map' && { pageTitles: 'page-map' as const }),
      }),
    });
  };

  const list: DispatcherDeps['list'] = async (request): Promise<ListResult> => {
    if (deps.source?.list === undefined) {
      return { documents: [], nextCursor: null, supported: false };
    }
    const listing = await deps.source.list(request);

    return {
      documents: listing.documents.map((doc) => ({ ...doc, live: syncConfigured })),
      nextCursor: listing.nextCursor,
      supported: true,
    };
  };

  return { open, list, actorFor };
};
```

`src/mcp/server.ts`: replace the `noSource` / `cannotList` defaults with the opener (keep the `AssembleDeps` overrides for tests):

```ts
import { createHeadlessPorts } from '../view/agent-runtime';
import { createOpener, createSource } from './opener';
// ...inside assembleMcp, after `contracts`:
  const opener = createOpener({
    options,
    contracts,
    source: createSource(options.source),
    portsFor: () => createHeadlessPorts({ sanitizeFor: (type) => contracts.runtimes.get(type)?.sanitize, richTextFieldsFor: contracts.richTextFieldsFor }),
  });
// ...and in createToolDispatcher:
    open: deps.open ?? opener.open,
    list: deps.list ?? opener.list,
```

Delete the now-unused `noSource` and `cannotList` helpers.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/mcp/mode.test.ts`, then `yarn test test/unit/mcp/sdk-server.test.ts`, then `yarn test test/unit/architecture/view-entry-law.test.ts`
Expected: PASS (the last proves `src/mcp/opener.ts` importing `src/view/agent-runtime.ts` is allowed by 01's exception).

- [ ] **Step 5: Commit**

```bash
npx eslint src/mcp/mode.ts src/mcp/opener.ts src/mcp/server.ts test/unit/mcp/mode.test.ts
git add src/mcp/mode.ts src/mcp/opener.ts src/mcp/server.ts test/unit/mcp/mode.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): resolve live/stored mode and open stored documents" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Stored mode end to end (real 01 session, files source)

**Files:**
- Create: `test/unit/mcp/stored-e2e.test.ts`

**Interfaces:**
- Consumes: `assembleMcp` (Tasks 9, 13); 01's real `createDocumentAgentSession`, `JsonApplier`, `loadStoredDocument`.
- Produces: no new code. If a case fails, the fix goes in the module that owns it (this plan's `src/mcp/` files, or a bug report to plan 01 for planner behaviour).

- [ ] **Step 1: Write the test**

`test/unit/mcp/stored-e2e.test.ts`:

```ts
// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Caller } from '../../../src/mcp/dispatcher';
import { assembleMcp, type AssembledMcp } from '../../../src/mcp/server';

const caller: Caller = { principal: 'alice', clientName: 'e2e', scopes: null };

describe('stored mode through the MCP dispatcher', () => {
  let dir: string;
  let mcp: AssembledMcp;
  const file = (id: string): Record<string, unknown> => JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf-8'));

  const openWrite = async (documentId: string): Promise<string> => {
    const opened = await mcp.dispatch('blok_open', { documentId, write: true }, caller);

    expect(opened.isError).toBe(false);

    return opened.structuredContent.handle as string;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'blok-mcp-stored-'));
    mcp = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir } });
  });

  afterEach(async () => {
    await mcp.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('inserts a paragraph, saves it, and stamps lastEditedBy with the agent id', async () => {
    const handle = await openWrite('doc');
    const outcome = await mcp.dispatch('blok_execute', {
      handle,
      commands: [{ name: 'block.insert', args: { type: 'paragraph', id: 'p1', data: { text: 'Hello' } } }],
    }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: true, delivery: { durable: true } });
    const saved = file('doc') as { blocks: Array<{ id: string; lastEditedBy?: string; data: { text: unknown } }> };

    expect(saved.blocks.map((block) => block.id)).toEqual(['p1']);
    expect(saved.blocks[0].lastEditedBy).toBe('agent:alice:e2e');
    expect(Array.isArray(saved.blocks[0].data.text)).toBe(true);
  });

  it('runs two parallel executes on one handle and saves both (Review Focus 1)', async () => {
    const handle = await openWrite('doc');
    const insert = (id: string) => mcp.dispatch('blok_execute', {
      handle, commands: [{ name: 'block.insert', args: { type: 'paragraph', id, data: { text: id } } }],
    }, caller);
    const [first, second] = await Promise.all([insert('a'), insert('b')]);

    expect(first.structuredContent).toMatchObject({ ok: true });
    expect(second.structuredContent).toMatchObject({ ok: true });
    expect((file('doc') as { blocks: Array<{ id: string }> }).blocks.map((block) => block.id).sort()).toEqual(['a', 'b']);
  });

  it('writes the page title into OutputData.title (01 D-1)', async () => {
    const handle = await openWrite('doc');

    await mcp.dispatch('blok_execute', { handle, commands: [{ name: 'doc.setTitle', args: { title: 'Q3 plan' } }] }, caller);
    expect(file('doc').title).toBe('Q3 plan');
  });

  it('undoes its own last batch and saves the result', async () => {
    const handle = await openWrite('doc');

    await mcp.dispatch('blok_execute', { handle, commands: [{ name: 'block.insert', args: { type: 'paragraph', id: 'p1', data: { text: 'x' } } }] }, caller);
    const undone = await mcp.dispatch('blok_execute', { handle, commands: [{ name: 'history.undo', args: {} }] }, caller);

    expect(undone.structuredContent).toMatchObject({ ok: true });
    expect((file('doc') as { blocks: unknown[] }).blocks).toEqual([]);
  });

  it('reports DOCUMENT_CHANGED when the file changes underneath, then works after re-read', async () => {
    const handle = await openWrite('doc');

    writeFileSync(join(dir, 'doc.json'), JSON.stringify({ blocks: [{ id: 'theirs', type: 'paragraph', data: { text: 'mine' } }] }));
    const stale = await mcp.dispatch('blok_execute', { handle, commands: [{ name: 'block.insert', args: { type: 'paragraph', id: 'p1', data: { text: 'x' } } }] }, caller);

    expect(stale.structuredContent).toMatchObject({ ok: false, error: { code: 'DOCUMENT_CHANGED' } });
    const retry = await mcp.dispatch('blok_execute', { handle, commands: [{ name: 'block.insert', args: { type: 'paragraph', id: 'p1', data: { text: 'x' } } }] }, caller);

    expect(retry.structuredContent).toMatchObject({ ok: true });
    expect((file('doc') as { blocks: Array<{ id: string }> }).blocks.map((block) => block.id)).toEqual(['theirs', 'p1']);
  });

  it('opens a file whose rich fields hold HTML, and reads segments (Review Focus 5)', async () => {
    writeFileSync(join(dir, 'legacy.json'), JSON.stringify({ blocks: [{ id: 'h', type: 'paragraph', data: { text: '<b>bold</b> text' } }] }));
    const opened = await mcp.dispatch('blok_open', { documentId: 'legacy', view: {} }, caller);

    expect(opened.isError).toBe(false);
    expect(JSON.stringify(opened.structuredContent.view)).not.toContain('<b>');
  });

  it('answers SOURCE_UNAVAILABLE for an unparseable file (Review Focus 5)', async () => {
    writeFileSync(join(dir, 'broken.json'), '{blocks');
    const opened = await mcp.dispatch('blok_open', { documentId: 'broken' }, caller);

    expect(opened.structuredContent).toEqual({ error: expect.objectContaining({ code: 'SOURCE_UNAVAILABLE' }) });
  });

  it('refuses writes on a read-only handle', async () => {
    const handle = (await mcp.dispatch('blok_open', { documentId: 'doc' }, caller)).structuredContent.handle;
    const outcome = await mcp.dispatch('blok_execute', { handle, commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'x' } } }] }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
  });

  it('lists the directory', async () => {
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ blocks: [], title: 'Alpha' }));
    const listed = await mcp.dispatch('blok_list_documents', {}, caller);

    expect(listed.structuredContent).toEqual({ documents: [{ id: 'a', title: 'Alpha', live: false }], nextCursor: null, supported: true });
  });
});
```

- [ ] **Step 2: Run the test**

Run: `yarn test test/unit/mcp/stored-e2e.test.ts`
Expected: PASS if Tasks 10–13 and 01's stored path are correct. This task adds no new production code, so it is not a red-first task; it is the integration proof for Phase 2. If a case fails, write the failing unit test in the owning module first, then fix it there.

Mutation check (manual, not committed): in `stored-session.ts`, change `{ ifVersion: state.version }` to `{ ifVersion: null }`. Run the test. Expected: the "two parallel executes" and "DOCUMENT_CHANGED ... then works" cases FAIL. Revert.

- [ ] **Step 3: Commit**

```bash
npx eslint test/unit/mcp/stored-e2e.test.ts
git add test/unit/mcp/stored-e2e.test.ts
git diff --cached --name-only
git commit -m "test(mcp): stored mode end to end through the dispatcher" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Checkpoint 2

- [ ] Run each Phase 2 test file on its own: `sources-files`, `sources-endpoint`, `stored-session`, `mode`, `stored-e2e`; re-run `sdk-server`, `dispatcher`, `mcp-tools-from-renderer-law`, `view-entry-law`.
- [ ] `NODE_OPTIONS=--max-old-space-size=8192 yarn lint:types`.
- [ ] `yarn build:mcp && yarn test test/unit/mcp/bin.test.ts`.
- [ ] Manual: in Claude Code with the scratch config from Checkpoint 1, ask "add a heading 'Plan' and two bullets to doc notes". Confirm `/tmp/blok-docs/notes.json` holds a header block and two list blocks, no Markdown characters in `data`.
- [ ] `git pull --rebase && git push`; `git status` up to date.

---

## Phase 3 — Live-room mode

### Task 15: Node socket factory over `ws`

**Files:**
- Create: `src/mcp/ws-module.d.ts`, `src/mcp/live/node-socket.ts`, `test/unit/mcp/node-socket.test.ts`

**Interfaces:**
- Consumes: `CollabSocketFactory`, `WebSocketLike` (`src/components/modules/collaboration/types.ts:217-234`).
- Produces: `nodeSocketFactory(origin: string | null): CollabSocketFactory` — opens a `ws` socket with the provider's subprotocols and, when `origin` is set, an `Origin` header (ticket mode needs it on every client: `SyncHandshake.cs:113-125`).

- [ ] **Step 1: Write the failing test**

`test/unit/mcp/node-socket.test.ts`:

```ts
// @vitest-environment node
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeSocketFactory } from '../../../src/mcp/live/node-socket';

describe('nodeSocketFactory', () => {
  let server: Server;
  let url: string;
  const upgrades: IncomingHttpHeaders[] = [];

  beforeEach(async () => {
    upgrades.length = 0;
    server = createServer();
    server.on('upgrade', (request, socket) => {
      upgrades.push(request.headers);
      socket.destroy();
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/sync/doc-1`;
  });

  afterEach(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  const opened = async (origin: string | null): Promise<IncomingHttpHeaders> => {
    const socket = nodeSocketFactory(origin)(url, ['blok-sync.v2', 'blok-sync.v1', 'ticket-abc']);

    await new Promise<void>((done) => {
      socket.onclose = () => done();
      socket.onerror = () => undefined;
    });

    return upgrades[0];
  };

  it('offers the provider subprotocols and sends Origin in ticket mode', async () => {
    const headers = await opened('https://app.example.com');

    expect(headers['sec-websocket-protocol']).toBe('blok-sync.v2,blok-sync.v1,ticket-abc');
    expect(headers.origin).toBe('https://app.example.com');
  });

  it('sends no Origin when none is configured', async () => {
    expect((await opened(null)).origin).toBeUndefined();
  });

  it('exposes the WebSocketLike surface the provider drives', () => {
    const socket = nodeSocketFactory(null)(url, ['blok-sync.v1']);

    socket.onerror = () => undefined;
    socket.binaryType = 'arraybuffer';
    expect(socket.binaryType).toBe('arraybuffer');
    expect(typeof socket.readyState).toBe('number');
    expect(socket.protocol).toBe('');
    socket.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/mcp/node-socket.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

`src/mcp/ws-module.d.ts`:

```ts
// The slice of `ws` 8.x this package uses. @types/ws is not installed.
declare module 'ws' {
  export default class WebSocket {
    constructor(url: string, protocols: string[], options?: { origin?: string });
    binaryType: string;
    readonly readyState: number;
    readonly protocol: string;
    onopen: ((event: unknown) => void) | null;
    onmessage: ((event: { data: unknown }) => void) | null;
    onclose: ((event: { code: number; reason: string }) => void) | null;
    onerror: ((event: unknown) => void) | null;
    send(data: ArrayBufferLike | ArrayBufferView): void;
    close(code?: number, reason?: string): void;
  }
}
```

`src/mcp/live/node-socket.ts`:

```ts
import WebSocket from 'ws';
import type { CollabSocketFactory, WebSocketLike } from '../../components/modules/collaboration/types';

/**
 * `ws`, not Node's global WebSocket: `ws` takes an origin option on every
 * supported Node, so the package keeps core's >=20.19.0 engine floor.
 */
export const nodeSocketFactory = (origin: string | null): CollabSocketFactory => (url, protocols) => {
  const socket: WebSocketLike = new WebSocket(url, protocols, origin === null ? {} : { origin });

  return socket;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/mcp/node-socket.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/mcp/ws-module.d.ts src/mcp/live/node-socket.ts test/unit/mcp/node-socket.test.ts
git add src/mcp/ws-module.d.ts src/mcp/live/node-socket.ts test/unit/mcp/node-socket.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): node socket factory with Origin over ws" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Tracking outbox (core)

**Files:**
- Create: `src/components/modules/collaboration/tracking-outbox.ts`, `test/unit/components/modules/collaboration/tracking-outbox.test.ts`

**Interfaces:**
- Consumes: `CollabOutbox`, `CollabOutboxRow`, `QuarantineFilter` (`types.ts:82-128`).
- Produces:

```ts
export type BatchDelivery =
  | { state: 'acked'; serverSequence: string | null }
  | { state: 'quarantined'; reason: string }
  | { state: 'timeout' };
export class TrackingOutbox implements CollabOutbox {
  constructor(inner: CollabOutbox);
  appendLocal(update: Uint8Array): Promise<CollabOutboxRow>;
  oldestPending(): Promise<CollabOutboxRow | null>;
  acknowledge(operationId: string): Promise<void>;
  quarantineLineage(lineage: string, reason: string, snapshot: Uint8Array, filter?: QuarantineFilter): Promise<number>;
  onCommitted(listener: () => void): () => void;
  /** Wire to the provider's onOperationAcknowledged; it fires before acknowledge(). */
  noteSequence(serverSequence: string): void;
  appendedCount(): number;
  idsSince(mark: number): string[];
  pendingIds(): string[];
  waitFor(ids: readonly string[], timeoutMs: number): Promise<BatchDelivery>;
}
```

Why it exists: `blok_execute` must say `delivery.durable: true` only after the server acknowledged every row of that batch (spec success criterion 3), and must tell a quarantine (`read-only`, a 104 code, `lineage-reset`) from an ack. The provider reports acks and quarantines only through the outbox calls, so a decorator sees both.

- [ ] **Step 1: Write the failing test**

`test/unit/components/modules/collaboration/tracking-outbox.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackingOutbox } from '../../../../../src/components/modules/collaboration/tracking-outbox';
import type { CollabOutbox, CollabOutboxRow } from '../../../../../src/components/modules/collaboration/types';

const memoryOutbox = (lineage = 'L1'): CollabOutbox & { rows: CollabOutboxRow[] } => {
  let next = 0;
  const rows: CollabOutboxRow[] = [];

  return {
    rows,
    appendLocal: async (bytes) => {
      next += 1;
      const row = { operationId: `op-${next}`, lineage, format: 2, bytes };

      rows.push(row);

      return row;
    },
    oldestPending: async () => rows[0] ?? null,
    acknowledge: async (id) => {
      rows.splice(rows.findIndex((row) => row.operationId === id), 1);
    },
    quarantineLineage: async (target) => {
      const moved = rows.filter((row) => row.lineage === target).length;

      rows.splice(0, rows.length, ...rows.filter((row) => row.lineage !== target));

      return moved;
    },
    onCommitted: () => () => undefined,
  };
};

describe('TrackingOutbox', () => {
  let inner: ReturnType<typeof memoryOutbox>;
  let outbox: TrackingOutbox;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    inner = memoryOutbox();
    outbox = new TrackingOutbox(inner);
  });

  it('delegates appends and remembers the order', async () => {
    const mark = outbox.appendedCount();

    await outbox.appendLocal(new Uint8Array([1]));
    await outbox.appendLocal(new Uint8Array([2]));

    expect(inner.rows).toHaveLength(2);
    expect(outbox.idsSince(mark)).toEqual(['op-1', 'op-2']);
    expect(outbox.pendingIds()).toEqual(['op-1', 'op-2']);
  });

  it('resolves acked with the sequence noted just before the ack', async () => {
    await outbox.appendLocal(new Uint8Array([1]));
    await outbox.appendLocal(new Uint8Array([2]));
    const waiting = outbox.waitFor(['op-1', 'op-2'], 10_000);

    outbox.noteSequence('41');
    await outbox.acknowledge('op-1');
    outbox.noteSequence('42');
    await outbox.acknowledge('op-2');

    expect(await waiting).toEqual({ state: 'acked', serverSequence: '42' });
    expect(outbox.pendingIds()).toEqual([]);
  });

  it('resolves quarantined with the reason when any row is moved aside', async () => {
    await outbox.appendLocal(new Uint8Array([1]));
    const waiting = outbox.waitFor(['op-1'], 10_000);

    await outbox.quarantineLineage('L1', 'read-only', new Uint8Array(0));

    expect(await waiting).toEqual({ state: 'quarantined', reason: 'read-only' });
  });

  it('keeps rows a keepFormat filter keeps', async () => {
    await outbox.appendLocal(new Uint8Array([1]));
    await outbox.quarantineLineage('L1', 'stale-format', new Uint8Array(0), { keepFormat: 2 });

    expect(outbox.pendingIds()).toEqual(['op-1']);
  });

  it('only touches rows of the quarantined lineage', async () => {
    await outbox.appendLocal(new Uint8Array([1]));
    await outbox.quarantineLineage('OTHER', 'lineage-reset', new Uint8Array(0));

    expect(outbox.pendingIds()).toEqual(['op-1']);
  });

  it('times out without inventing an ack', async () => {
    vi.useFakeTimers();
    await outbox.appendLocal(new Uint8Array([1]));
    const waiting = outbox.waitFor(['op-1'], 10_000);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(await waiting).toEqual({ state: 'timeout' });
    vi.useRealTimers();
  });

  it('treats an empty batch as acked with no sequence', async () => {
    expect(await outbox.waitFor([], 10_000)).toEqual({ state: 'acked', serverSequence: null });
  });

  it('answers at once for rows already settled', async () => {
    await outbox.appendLocal(new Uint8Array([1]));
    outbox.noteSequence('7');
    await outbox.acknowledge('op-1');

    expect(await outbox.waitFor(['op-1'], 10_000)).toEqual({ state: 'acked', serverSequence: '7' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/collaboration/tracking-outbox.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

`src/components/modules/collaboration/tracking-outbox.ts`:

```ts
import type { CollabOutbox, CollabOutboxRow, QuarantineFilter } from './types';

export type BatchDelivery =
  | { state: 'acked'; serverSequence: string | null }
  | { state: 'quarantined'; reason: string }
  | { state: 'timeout' };

type Fate =
  | { state: 'pending'; lineage: string; format: number }
  | { state: 'acked'; serverSequence: string | null }
  | { state: 'quarantined'; reason: string };

/**
 * Wraps the provider's outbox to learn each row's fate. The provider reports
 * acks and quarantines only through these calls, so this is the one place a
 * headless writer can tell "durable" from "refused".
 */
export class TrackingOutbox implements CollabOutbox {
  private readonly fates = new Map<string, Fate>();
  private readonly order: string[] = [];
  private readonly listeners = new Set<() => void>();
  // onOperationAcknowledged fires just before acknowledge() (types.ts:340-352).
  private nextSequence: string | null = null;

  constructor(private readonly inner: CollabOutbox) {}

  public async appendLocal(update: Uint8Array): Promise<CollabOutboxRow> {
    const row = await this.inner.appendLocal(update);

    this.fates.set(row.operationId, { state: 'pending', lineage: row.lineage, format: row.format });
    this.order.push(row.operationId);

    return row;
  }

  public oldestPending(): Promise<CollabOutboxRow | null> {
    return this.inner.oldestPending();
  }

  public async acknowledge(operationId: string): Promise<void> {
    await this.inner.acknowledge(operationId);
    if (this.fates.get(operationId)?.state === 'pending') {
      this.fates.set(operationId, { state: 'acked', serverSequence: this.nextSequence });
    }
    this.nextSequence = null;
    this.notify();
  }

  public async quarantineLineage(lineage: string, reason: string, snapshot: Uint8Array, filter?: QuarantineFilter): Promise<number> {
    const moved = await this.inner.quarantineLineage(lineage, reason, snapshot, filter);

    for (const [id, fate] of this.fates) {
      if (fate.state === 'pending' && fate.lineage === lineage && fate.format !== filter?.keepFormat) {
        this.fates.set(id, { state: 'quarantined', reason });
      }
    }
    this.notify();

    return moved;
  }

  public onCommitted(listener: () => void): () => void {
    return this.inner.onCommitted(listener);
  }

  public noteSequence(serverSequence: string): void {
    this.nextSequence = serverSequence;
  }

  public appendedCount(): number {
    return this.order.length;
  }

  public idsSince(mark: number): string[] {
    return this.order.slice(mark);
  }

  public pendingIds(): string[] {
    return this.order.filter((id) => this.fates.get(id)?.state === 'pending');
  }

  public waitFor(ids: readonly string[], timeoutMs: number): Promise<BatchDelivery> {
    return new Promise((resolve) => {
      const wait: { timer: ReturnType<typeof setTimeout> | undefined } = { timer: undefined };
      const check = (): boolean => {
        const fates = ids.map((id) => this.fates.get(id));
        const quarantined = fates.find((fate) => fate?.state === 'quarantined');

        if (quarantined?.state === 'quarantined') {
          finish({ state: 'quarantined', reason: quarantined.reason });

          return true;
        }
        if (fates.every((fate) => fate?.state === 'acked')) {
          const last = fates.at(-1);

          finish({ state: 'acked', serverSequence: last?.state === 'acked' ? last.serverSequence : null });

          return true;
        }

        return false;
      };
      const finish = (delivery: BatchDelivery): void => {
        this.listeners.delete(listener);
        if (wait.timer !== undefined) {
          clearTimeout(wait.timer);
        }
        resolve(delivery);
      };
      const listener = (): void => {
        check();
      };

      if (check()) {
        return;
      }
      this.listeners.add(listener);
      wait.timer = setTimeout(() => finish({ state: 'timeout' }), timeoutMs);
    });
  }

  private notify(): void {
    [...this.listeners].forEach((listener) => listener());
  }
}
```

Note: an ack that arrives out of order leaves the last id's own sequence as `serverSequence`, not the maximum. The server acks in order on one socket (`blok-sync-v2.md:519-543`), so the last row's sequence is the batch's highest.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/modules/collaboration/tracking-outbox.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/components/modules/collaboration/tracking-outbox.ts test/unit/components/modules/collaboration/tracking-outbox.test.ts
git add src/components/modules/collaboration/tracking-outbox.ts test/unit/components/modules/collaboration/tracking-outbox.test.ts
git diff --cached --name-only
git commit -m "feat(collab): tracking outbox reports each row's ack or quarantine" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: Headless room member (core)

**Files:**
- Create: `src/components/modules/collaboration/headless-session.ts`, `test/unit/components/modules/collaboration/headless-session.test.ts`

**Interfaces:**
- Consumes: `createCollabProvider`, `createOperationStore`, `DocumentStore`, `YBlockSerializer`, `TrackingOutbox` (Task 16), seam shape from `headless-offline-page.ts:96-118`.
- Produces:

```ts
export interface HeadlessRoomInput {
  url: string;                       // full sync URL including the doc segment
  docId: string;
  serializer: YBlockSerializer;      // built by the caller: htmlToSegmentsNode + richTextFieldsFor (no src/view import here)
  socketFactory: CollabSocketFactory;
  ticketSource?: CollabTicketSource;
  writeDenied: boolean;
  syncTimeoutMs?: number;            // default 15_000 (headless-offline-page.ts:88)
}
export type HeadlessRoomEnd = { reason: 'reset' } | { reason: 'terminal'; error: CollabTerminalError | undefined };
export class HeadlessRoomTimeoutError extends Error {}
export class HeadlessRoomTerminalError extends Error { readonly error: CollabTerminalError | undefined }
export interface HeadlessRoom {
  readonly store: DocumentStore;
  readonly outbox: TrackingOutbox;
  readonly protocol: SessionProtocol;
  sendActivity(): boolean;
  /** Resolves when every append the write tap started has committed. */
  flushAppends(): Promise<void>;
  ended(): HeadlessRoomEnd | null;
  onEnd(listener: (end: HeadlessRoomEnd) => void): () => void;
  close(): Promise<void>;
}
export const openHeadlessRoom: (input: HeadlessRoomInput) => Promise<HeadlessRoom>;
```

Rules:
- Open resolves only after `onStatus('connected')` with a non-null `provider.tag` (an empty document before that would make "append at end" act on nothing). Timeout → `HeadlessRoomTimeoutError`; `error` before sync → `HeadlessRoomTerminalError`. Both destroy everything first.
- On every `connected`: `operationStore.recordSession(tag, writeDenied, provider.protocol)`; appends wait for it (`operation-store.ts:145-149`).
- Write tap on `store.onUpdate` (never `onAnyUpdate`, which would send peers' work back as ours). Only when `provider.protocol === 'v2'`; under v1 the provider's own seam hook sends local edits.
- `resetForRelineage` replaces the store's doc, which wipes the agent session's view. So the room ends with `{ reason: 'reset' }`.
- `onStatus('error')` after sync ends the room with `{ reason: 'terminal', error }`.
- `close()`: `provider.destroy()` (it announces departure first, `types.ts:378-383`), `store.destroy()`, `operationStore.close()`.

- [ ] **Step 1: Write the failing test**

`test/unit/components/modules/collaboration/headless-session.test.ts` (reuses the scripted-socket pattern of `headless-offline-page.test.ts:22-112`):

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HeadlessRoomTerminalError,
  HeadlessRoomTimeoutError,
  openHeadlessRoom,
  type HeadlessRoom,
} from '../../../../../src/components/modules/collaboration/headless-session';
import { decode, encode } from '../../../../../src/components/modules/collaboration/sync-wire';
import type { CollabSocketFactory, SyncWireFrame, WebSocketLike, WorkingSetTag } from '../../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { htmlToSegmentsNode } from '../../../../../src/view/rich-text-parse5';

const TAG: WorkingSetTag = { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' };

class ScriptedSocket implements WebSocketLike {
  public binaryType = 'blob';
  public readyState = 0;
  public protocol = '';
  public sent: SyncWireFrame[] = [];
  public onopen: ((event: unknown) => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;

  public send(data: ArrayBufferLike | ArrayBufferView): void {
    const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
    const frame = decode(bytes);

    if (frame.type !== 'unknown' && frame.type !== 'malformed') {
      this.sent.push(frame);
    }
  }

  public close(): void {
    this.readyState = 3;
  }

  public open(protocol: string): void {
    this.readyState = 1;
    this.protocol = protocol;
    this.onopen?.({});
  }

  public deliver(frame: SyncWireFrame): void {
    this.onmessage?.({ data: encode(frame).slice().buffer });
  }

  public serverClose(code: number, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

const peerUpdate = (): Uint8Array => {
  const peer = new DocumentStore(new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode }));

  peer.fromJSON([{ id: 'p0', type: 'paragraph', data: { text: 'from the room' } }]);
  const update = peer.encodeStateAsUpdate();

  peer.destroy();

  return update;
};

type Script = 'sync' | 'silent' | 'forbidden';

const scripted = (protocol: string, script: Script = 'sync'): { factory: CollabSocketFactory; sockets: ScriptedSocket[] } => {
  const sockets: ScriptedSocket[] = [];
  const factory: CollabSocketFactory = () => {
    const socket = new ScriptedSocket();

    sockets.push(socket);
    queueMicrotask(() => {
      socket.open(protocol);
      if (script === 'forbidden') {
        socket.serverClose(4403, 'forbidden');

        return;
      }
      if (script === 'sync') {
        socket.deliver({ type: 'control', tag: TAG });
        socket.deliver({ type: 'syncStep2', update: peerUpdate() });
      }
    });

    return socket;
  };

  return { factory, sockets };
};

const serializer = (): YBlockSerializer => new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode });

describe('openHeadlessRoom', () => {
  const rooms: HeadlessRoom[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await Promise.all(rooms.splice(0).map((room) => room.close()));
    vi.restoreAllMocks();
  });

  const open = async (protocol: string, script: Script = 'sync', syncTimeoutMs = 15_000) => {
    const { factory, sockets } = scripted(protocol, script);
    const room = await openHeadlessRoom({
      url: 'wss://sync.test/sync/doc-1', docId: 'doc-1', serializer: serializer(), socketFactory: factory, writeDenied: false, syncTimeoutMs,
    });

    rooms.push(room);

    return { room, sockets };
  };

  it('resolves only after the first sync, with the room content loaded', async () => {
    const { room } = await open('blok-sync.v2');

    expect(room.store.toJSON().map((block) => block.id)).toEqual(['p0']);
    expect(room.protocol).toBe('v2');
    expect(room.ended()).toBeNull();
  });

  it('times out when the room never syncs', async () => {
    await expect(open('blok-sync.v2', 'silent', 50)).rejects.toBeInstanceOf(HeadlessRoomTimeoutError);
  });

  it('fails with the terminal reason when refused before sync', async () => {
    const failure = await open('blok-sync.v2', 'forbidden').then(() => null, (thrown: unknown) => thrown);

    expect(failure).toBeInstanceOf(HeadlessRoomTerminalError);
    expect((failure as HeadlessRoomTerminalError).error).toBe('forbidden');
  });

  it('journals its own local writes into the outbox under v2', async () => {
    const { room } = await open('blok-sync.v2');
    const mark = room.outbox.appendedCount();

    room.store.transact(() => {
      room.store.addBlock({ id: 'a1', type: 'paragraph', data: { text: 'agent' } });
    }, 'local');
    await room.flushAppends();

    expect(room.outbox.idsSince(mark)).toHaveLength(1);
  });

  it('never journals what the room sent (remote updates)', async () => {
    const { room, sockets } = await open('blok-sync.v2');
    const mark = room.outbox.appendedCount();

    sockets[0].deliver({ type: 'update', update: peerUpdate() });
    await room.flushAppends();

    expect(room.outbox.idsSince(mark)).toEqual([]);
  });

  it('does not journal under v1 (the provider sends local edits itself)', async () => {
    const { room, sockets } = await open('blok-sync.v1');

    room.store.transact(() => {
      room.store.addBlock({ id: 'a1', type: 'paragraph', data: { text: 'agent' } });
    }, 'local');
    await room.flushAppends();

    expect(room.outbox.appendedCount()).toBe(0);
    expect(sockets[0].sent.some((frame) => frame.type === 'update')).toBe(true);
  });

  it('ends with reset when the room is reset (4409)', async () => {
    const { room, sockets } = await open('blok-sync.v2');
    const ends: unknown[] = [];

    room.onEnd((end) => ends.push(end));
    sockets[0].serverClose(4409, 'reset');

    // The provider quarantines first (async), then swaps the doc.
    await vi.waitFor(() => expect(room.ended()).toEqual({ reason: 'reset' }));
    expect(ends).toEqual([{ reason: 'reset' }]);
  });

  it('withdraws presence and closes the socket on close', async () => {
    const { room, sockets } = await open('blok-sync.v2');

    await room.close();
    expect(sockets[0].readyState).toBe(3);
  });
});
```

The test file lives under `test/unit/components/` but imports `src/view/rich-text-parse5`. That is a test import, not a source import, so the view-entry law (which scans `src/` only, `view-entry-law.test.ts:33`) does not apply.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/collaboration/headless-session.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

`src/components/modules/collaboration/headless-session.ts`:

```ts
import { createOperationStore } from './operation-store';
import { createCollabProvider } from './provider';
import { TrackingOutbox } from './tracking-outbox';
import type {
  CollabDocSeam,
  CollabProvider,
  CollabSocketFactory,
  CollabTerminalError,
  CollabTicketSource,
  SessionProtocol,
} from './types';
import { DocumentStore } from '../yjs/document-store';
import type { YBlockSerializer } from '../yjs/serializer';

export interface HeadlessRoomInput {
  url: string;
  docId: string;
  serializer: YBlockSerializer;
  socketFactory: CollabSocketFactory;
  ticketSource?: CollabTicketSource;
  writeDenied: boolean;
  syncTimeoutMs?: number;
}

export type HeadlessRoomEnd = { reason: 'reset' } | { reason: 'terminal'; error: CollabTerminalError | undefined };

export class HeadlessRoomTimeoutError extends Error {
  constructor() {
    super('The room did not finish its first sync in time');
    this.name = 'HeadlessRoomTimeoutError';
  }
}

export class HeadlessRoomTerminalError extends Error {
  constructor(public readonly error: CollabTerminalError | undefined) {
    super(`The room refused the connection: ${error ?? 'unknown'}`);
    this.name = 'HeadlessRoomTerminalError';
  }
}

export interface HeadlessRoom {
  readonly store: DocumentStore;
  readonly outbox: TrackingOutbox;
  readonly protocol: SessionProtocol;
  sendActivity(): boolean;
  flushAppends(): Promise<void>;
  ended(): HeadlessRoomEnd | null;
  onEnd(listener: (end: HeadlessRoomEnd) => void): () => void;
  close(): Promise<void>;
}

const DEFAULT_SYNC_TIMEOUT_MS = 15_000;

/**
 * A writing, headless room member: downloadOfflinePage's seam plus the
 * Collaboration module's outbox tap. No editor, no DOM.
 */
export const openHeadlessRoom = async (input: HeadlessRoomInput): Promise<HeadlessRoom> => {
  const store = new DocumentStore(input.serializer);
  const operations = createOperationStore({ url: input.url, doc: input.docId, offlineScope: null });

  await operations.open();
  const outbox = new TrackingOutbox(operations);
  const inflight = new Set<Promise<unknown>>();
  const endListeners = new Set<(end: HeadlessRoomEnd) => void>();
  const state: { end: HeadlessRoomEnd | null; synced: boolean; session: Promise<void>; provider: CollabProvider | null } = {
    end: null,
    synced: false,
    session: Promise.resolve(),
    provider: null,
  };

  const finish = (end: HeadlessRoomEnd): void => {
    if (state.end !== null) {
      return;
    }
    state.end = end;
    [...endListeners].forEach((listener) => listener(end));
  };

  const seam: CollabDocSeam = {
    applyRemoteUpdate: (update, origin) => store.applyRemoteUpdate(update, origin),
    onDocUpdate: (callback) => store.onUpdate(callback),
    onAnyDocUpdate: (callback) => store.onAnyUpdate(callback),
    getStateVector: () => store.getStateVector(),
    encodeStateAsUpdate: (stateVector) => store.encodeStateAsUpdate(stateVector),
    enableAwareness: () => store.enableAwareness(),
    setAwarenessField: (field, value) => store.setAwarenessField(field, value),
    getAwarenessStates: () => store.getAwarenessStates(),
    onAwarenessChange: (callback) => store.onAwarenessChange(callback),
    onAwarenessUpdate: (callback) => store.onAwarenessUpdate(callback),
    encodeAwarenessUpdate: (clients) => store.encodeAwarenessUpdate(clients),
    encodeLocalAwarenessDeparture: () => store.encodeLocalAwarenessDeparture(),
    applyAwarenessUpdate: (update, origin) => store.applyAwarenessUpdate(update, origin),
    clearRemoteAwarenessStates: () => store.clearRemoteAwarenessStates(),
    resetForRelineage: () => {
      store.resetForRelineage();
      // The agent session read this doc; after the swap its view is gone.
      finish({ reason: 'reset' });
    },
    flushPendingWrites: () => {},
  };

  const synced = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new HeadlessRoomTimeoutError()), input.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS);
    const provider = createCollabProvider({
      url: input.url,
      docId: input.docId,
      yjs: seam,
      outbox,
      ticketSource: input.ticketSource,
      socketFactory: input.socketFactory,
      onOperationAcknowledged: (serverSequence) => outbox.noteSequence(serverSequence),
      onStatus: (status, detail) => {
        if (status === 'error') {
          clearTimeout(timer);
          if (state.synced) {
            finish({ reason: 'terminal', error: detail?.error });
          } else {
            reject(new HeadlessRoomTerminalError(detail?.error));
          }

          return;
        }
        if (status !== 'connected' || provider.tag === null) {
          return;
        }
        // Rows can only be stamped once the session names a lineage (operation-store.ts:145-149).
        state.session = operations.recordSession(provider.tag, input.writeDenied, provider.protocol);
        if (!state.synced) {
          state.synced = true;
          clearTimeout(timer);
          resolve();
        }
      },
    });

    state.provider = provider;
    provider.connect();
  });

  // onUpdate, never onAnyUpdate: the latter would send peers' work back as ours.
  const unhookTap = store.onUpdate((update) => {
    const provider = state.provider;

    if (provider === null || provider.protocol !== 'v2') {
      return;
    }
    const append = state.session
      .then(() => outbox.appendLocal(update))
      .then(() => provider.drain());

    inflight.add(append);
    void append.finally(() => inflight.delete(append));
  });

  const close = async (): Promise<void> => {
    unhookTap();
    state.provider?.destroy();
    store.destroy();
    await operations.close();
  };

  try {
    await synced;
  } catch (thrown) {
    await close();
    throw thrown;
  }

  const provider = state.provider;

  if (provider === null) {
    throw new HeadlessRoomTerminalError(undefined);
  }

  return {
    store,
    outbox,
    get protocol(): SessionProtocol {
      return provider.protocol;
    },
    sendActivity: () => provider.sendActivity(),
    flushAppends: async () => {
      await Promise.allSettled([...inflight]);
    },
    ended: () => state.end,
    onEnd: (listener) => {
      endListeners.add(listener);

      return () => endListeners.delete(listener);
    },
    close,
  };
};
```

If `appendLocal` before `recordSession` turns out to work without the wait (unverified), keep the wait anyway: it is the documented order.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/modules/collaboration/headless-session.test.ts`
Expected: PASS. If "does not journal under v1" fails because the v1 provider sends nothing before the next tick, `await new Promise((done) => setTimeout(done, 0))` before the `sent` assertion; do not weaken the `appendedCount` assertion.

- [ ] **Step 5: Run the neighbours that share these modules**

Run: `yarn test test/unit/components/modules/collaboration/headless-offline-page.test.ts`, then `yarn test test/unit/components/modules/collaboration/provider.test.ts`
Expected: PASS (no shared code changed; this guards accidental edits).

- [ ] **Step 6: Commit**

```bash
npx eslint src/components/modules/collaboration/headless-session.ts test/unit/components/modules/collaboration/headless-session.test.ts
git add src/components/modules/collaboration/headless-session.ts test/unit/components/modules/collaboration/headless-session.test.ts
git diff --cached --name-only
git commit -m "feat(collab): headless writing room member with sync gate and outbox tap" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: Live session (execute, delivery, error mapping)

**Files:**
- Create: `src/mcp/live/live-session.ts`, `test/unit/mcp/live-session.test.ts`

**Interfaces:**
- Consumes: `HeadlessRoom` (Task 17), `BatchDelivery` (Task 16), `HandleSession`, `failedResult`, `NO_DELIVERY` (Task 2), `AgentSession` (01), `AgentPresence` (Task 19 — this task uses only the `PresenceSink` interface below, so Task 19 can land after).
- Produces:

```ts
export interface PresenceSink { announce(): void; afterBatch(result: AgentResult): void; clear(): void }
export interface LiveSessionInput {
  room: HeadlessRoom;
  agent: AgentSession;             // 01 createStoreAgentSession over room.store
  contract: AgentContract;         // the live contract
  presence: PresenceSink;
  write: boolean;
  ackTimeoutMs?: number;           // default 10_000
}
export const createLiveSession: (input: LiveSessionInput) => HandleSession;
export const terminalToError: (error: CollabTerminalError | undefined) => AgentError;
```

Mapping (spec §3.5 "Room events" table):

| Event | Result | Handle after |
|---|---|---|
| all rows acked | `ok: true`, `delivery { durable: true, pending: false, serverSequence }` | usable |
| v1 negotiated | `ok: true`, `delivery { durable: false, pending: false }` | usable |
| ack wait timed out (incl. 4503 / network drop) | `ok: true`, `delivery { durable: false, pending: true }`; counted in `unsavedBatches` until acked | usable |
| quarantined `read-only` | `ok: false`, `READ_ONLY` | read-only |
| quarantined `lineage-reset`, or room ended `reset` | `ok: false`, `ROOM_RESET`, `details.notSavedBatches` | dead |
| quarantined any other code | `ok: false`, `REJECTED`, `details.rejectionCode` | usable |
| room ended terminal `unsupported-format` | `VERSION_SKEW` | dead |
| room ended terminal `forbidden` / `unauthorized` | `FORBIDDEN` | dead |
| room ended terminal, anything else | `SOURCE_UNAVAILABLE`, `details.terminal` | dead |
| 01 returns `APPLY_FAILED` | passed through, `NO_DELIVERY` | read-only |
| `write: false` and a writing batch | `READ_ONLY`, nothing runs | read-only |

`durability`: `'acknowledged'` on v2, `'best-effort'` on v1. `close` → `{ unsavedBatches, hostRecordLags: protocol === 'v2' }` (spec §3.6: the host record lags until the room checkpoints).

Live table writes: 06 C17 makes table `normalize` (02) a v1 blocker for live mode. That gate lives in 01/02 (the live contract marks table-reshaping actions unavailable until `normalize` exists); this session adds no table check.

- [ ] **Step 1: Write the failing test**

`test/unit/mcp/live-session.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeadlessRoom, HeadlessRoomEnd } from '../../../src/components/modules/collaboration/headless-session';
import { TrackingOutbox } from '../../../src/components/modules/collaboration/tracking-outbox';
import type { CollabOutbox, CollabOutboxRow } from '../../../src/components/modules/collaboration/types';
import { createLiveSession, type PresenceSink } from '../../../src/mcp/live/live-session';

const contract = {
  formatVersion: 1, revision: 'live-1', manifest: {}, guidance: { general: '', commands: {}, tools: {} },
  commands: [{ name: 'doc.read', readOnly: true, available: true }, { name: 'block.insert', readOnly: false, available: true }],
} as never;

const ok = { ok: true as const, revision: '5', results: [], refs: {}, changed: { created: ['p1'], updated: [], moved: [], removed: [] }, warnings: [] };

const innerOutbox = (): CollabOutbox => {
  let n = 0;

  return {
    appendLocal: async (bytes): Promise<CollabOutboxRow> => {
      n += 1;

      return { operationId: `op-${n}`, lineage: 'L1', format: 2, bytes };
    },
    oldestPending: async () => null,
    acknowledge: async () => undefined,
    quarantineLineage: async () => 1,
    onCommitted: () => () => undefined,
  };
};

describe('createLiveSession', () => {
  let outbox: TrackingOutbox;
  let endListener: (end: HeadlessRoomEnd) => void;
  let ended: HeadlessRoomEnd | null;
  let protocol: 'v1' | 'v2';
  let presence: PresenceSink;
  let room: HeadlessRoom;
  const agentExecute = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    outbox = new TrackingOutbox(innerOutbox());
    ended = null;
    protocol = 'v2';
    presence = { announce: vi.fn(), afterBatch: vi.fn(), clear: vi.fn() };
    room = {
      store: {} as never,
      outbox,
      get protocol() {
        return protocol;
      },
      sendActivity: () => true,
      flushAppends: async () => undefined,
      ended: () => ended,
      onEnd: (listener) => {
        endListener = listener;

        return () => undefined;
      },
      close: vi.fn(async () => undefined),
    };
    // The agent's write makes the tap append one row, as the real store + tap would.
    agentExecute.mockImplementation(async () => {
      await outbox.appendLocal(new Uint8Array([1]));

      return ok;
    });
  });

  const session = (write = true, ackTimeoutMs = 10_000) => createLiveSession({
    room,
    agent: { id: 's', actor: { id: 'agent:a', name: 'a', kind: 'agent' }, read: vi.fn(), describe: vi.fn(), execute: agentExecute, log: () => [], close: () => undefined } as never,
    contract,
    presence,
    write,
    ackTimeoutMs,
  });

  const insert = { commands: [{ name: 'block.insert', args: {} }] };

  it('reports durable only after the server acks the batch rows', async () => {
    const live = session();
    const pending = live.execute(insert);

    await vi.waitFor(() => expect(outbox.pendingIds()).toEqual(['op-1']));
    outbox.noteSequence('12');
    await outbox.acknowledge('op-1');

    expect(await pending).toMatchObject({ ok: true, delivery: { durable: true, pending: false, serverSequence: '12', savedVersion: null } });
    expect(presence.afterBatch).toHaveBeenCalledWith(ok);
  });

  it('reports pending, not an error, when the ack wait times out (Review Focus 2)', async () => {
    vi.useFakeTimers();
    const live = session();
    const pending = live.execute(insert);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({ ok: true, delivery: { durable: false, pending: true } });
    expect(await live.close('closed')).toEqual({ unsavedBatches: 1, hostRecordLags: true });
  });

  it('stops counting a timed-out batch once its ack arrives later', async () => {
    vi.useFakeTimers();
    const live = session();
    const pending = live.execute(insert);

    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    await outbox.acknowledge('op-1');
    expect(await live.close('closed')).toMatchObject({ unsavedBatches: 0 });
  });

  it('is best-effort under v1', async () => {
    protocol = 'v1';
    agentExecute.mockResolvedValueOnce(ok);
    const live = session();

    expect(live.durability).toBe('best-effort');
    expect(await live.execute(insert)).toMatchObject({ ok: true, delivery: { durable: false, pending: false } });
  });

  it('maps a read-only quarantine to READ_ONLY and locks the handle', async () => {
    const live = session();
    const pending = live.execute(insert);

    await vi.waitFor(() => expect(outbox.pendingIds()).toHaveLength(1));
    await outbox.quarantineLineage('L1', 'read-only', new Uint8Array(0));

    expect(await pending).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
    expect(await live.execute(insert)).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
  });

  it('maps another rejection code to REJECTED and stays usable', async () => {
    const live = session();
    const pending = live.execute(insert);

    await vi.waitFor(() => expect(outbox.pendingIds()).toHaveLength(1));
    await outbox.quarantineLineage('L1', 'oversized-update', new Uint8Array(0));

    expect(await pending).toMatchObject({ ok: false, error: { code: 'REJECTED', details: { rejectionCode: 'oversized-update' } } });
  });

  it('maps a reset to ROOM_RESET listing batches that were never acked, then stays dead', async () => {
    vi.useFakeTimers();
    const live = session();
    const first = live.execute(insert);

    await vi.advanceTimersByTimeAsync(10_000);
    await first;
    ended = { reason: 'reset' };
    endListener({ reason: 'reset' });

    expect(await live.execute(insert)).toMatchObject({ ok: false, error: { code: 'ROOM_RESET', details: { notSavedBatches: [1] } } });
    await expect(live.read({})).rejects.toMatchObject({ agentError: { code: 'ROOM_RESET' } });
  });

  it.each([
    ['unsupported-format', 'VERSION_SKEW'],
    ['forbidden', 'FORBIDDEN'],
    ['unauthorized', 'FORBIDDEN'],
    ['apply-failed', 'SOURCE_UNAVAILABLE'],
  ])('maps terminal %s to %s', async (error, code) => {
    const live = session();

    ended = { reason: 'terminal', error: error as never };
    expect(await live.execute(insert)).toMatchObject({ ok: false, error: { code } });
  });

  it('locks the handle after APPLY_FAILED', async () => {
    agentExecute.mockResolvedValueOnce({ ok: false, revision: '5', error: { code: 'APPLY_FAILED', message: 'partly applied', retryable: false }, warnings: [] });
    const live = session();

    expect(await live.execute(insert)).toMatchObject({ ok: false, error: { code: 'APPLY_FAILED' }, delivery: { durable: false } });
    expect(await live.execute(insert)).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
  });

  it('refuses writes on a read-only handle and still runs reads', async () => {
    agentExecute.mockResolvedValueOnce(ok);
    const live = session(false);

    expect(await live.execute(insert)).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
    expect(await live.execute({ commands: [{ name: 'doc.read', args: {} }] })).toMatchObject({ ok: true });
  });

  it('clears presence and closes the room on close', async () => {
    const live = session();

    await live.close('expired');
    expect(presence.clear).toHaveBeenCalled();
    expect(room.close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/mcp/live-session.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

`src/mcp/live/live-session.ts`:

```ts
import type { HeadlessRoom, HeadlessRoomEnd } from '../../components/modules/collaboration/headless-session';
import type { CollabTerminalError } from '../../components/modules/collaboration/types';
import type { AgentBatch, AgentError, AgentResult, AgentSession } from '../../shared/agent';
import type { AgentContract } from '../../../types/tool-manifest';
import { failedResult, NO_DELIVERY, surfaceError } from '../errors';
import type { HandleSession, McpExecuteResult } from '../session';

export interface PresenceSink { announce(): void; afterBatch(result: AgentResult): void; clear(): void }

export interface LiveSessionInput {
  room: HeadlessRoom;
  agent: AgentSession;
  contract: AgentContract;
  presence: PresenceSink;
  write: boolean;
  ackTimeoutMs?: number;
}

const DEFAULT_ACK_TIMEOUT_MS = 10_000;

export const terminalToError = (error: CollabTerminalError | undefined): AgentError => {
  if (error === 'unsupported-format') {
    return surfaceError('VERSION_SKEW', 'The room uses a newer document format. Upgrade @bloklabs/mcp to the server family version.').agentError;
  }
  if (error === 'forbidden' || error === 'unauthorized') {
    return surfaceError('FORBIDDEN', 'The room refused this agent. Its ticket may not grant this document.').agentError;
  }

  return surfaceError('SOURCE_UNAVAILABLE', 'The room connection stopped for good. Open the document again.', { terminal: error ?? 'unknown' }).agentError;
};

export const createLiveSession = (input: LiveSessionInput): HandleSession => {
  const ackTimeoutMs = input.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
  const readOnlyByName = new Map(input.contract.commands.map((entry) => [entry.name, entry.readOnly]));
  const state = { readOnly: !input.write, batch: 0 };
  // Batch number → its row ids, while any row is still unacknowledged.
  const unacked = new Map<number, string[]>();

  const notSaved = (): number[] => {
    for (const [batch, ids] of unacked) {
      if (ids.every((id) => !input.room.outbox.pendingIds().includes(id))) {
        unacked.delete(batch);
      }
    }

    return [...unacked.keys()];
  };

  const endError = (end: HeadlessRoomEnd): AgentError => (end.reason === 'reset'
    ? surfaceError('ROOM_RESET', "The room's history was reset. Work not acknowledged is lost; open the document again.", { notSavedBatches: notSaved() }).agentError
    : terminalToError(end.error));

  input.presence.announce();

  const execute = async (batch: AgentBatch): Promise<McpExecuteResult> => {
    const end = input.room.ended();

    if (end !== null) {
      return failedResult(endError(end));
    }
    const writing = batch.commands.some((command) => readOnlyByName.get(command.name) === false);

    if (writing && state.readOnly) {
      return failedResult(surfaceError('READ_ONLY', 'This handle cannot write to the room.').agentError);
    }
    const mark = input.room.outbox.appendedCount();
    const result = await input.agent.execute(batch);

    if (!result.ok) {
      if (result.error.code === 'APPLY_FAILED') {
        state.readOnly = true;
      }

      return { ...result, delivery: NO_DELIVERY };
    }
    input.presence.afterBatch(result);
    if (!writing || input.room.protocol === 'v1') {
      return { ...result, delivery: NO_DELIVERY };
    }
    await input.room.flushAppends();
    const ids = input.room.outbox.idsSince(mark);

    state.batch += 1;
    const number = state.batch;

    unacked.set(number, ids);
    const fate = await input.room.outbox.waitFor(ids, ackTimeoutMs);

    if (fate.state === 'acked') {
      unacked.delete(number);

      return { ...result, delivery: { durable: true, pending: false, serverSequence: fate.serverSequence, savedVersion: null } };
    }
    if (fate.state === 'timeout') {
      return { ...result, delivery: { durable: false, pending: true, serverSequence: null, savedVersion: null } };
    }
    unacked.delete(number);
    if (fate.reason === 'read-only') {
      state.readOnly = true;

      return failedResult(surfaceError('READ_ONLY', 'The room refused the write: this agent may only read. The batch was not saved.').agentError, result.warnings);
    }
    if (fate.reason === 'lineage-reset') {
      return failedResult(endError({ reason: 'reset' }), result.warnings);
    }

    return failedResult(surfaceError('REJECTED', 'The room refused this batch. It was not saved.', { rejectionCode: fate.reason }).agentError, result.warnings);
  };

  return {
    mode: 'live',
    write: input.write,
    get durability() {
      return input.room.protocol === 'v2' ? 'acknowledged' : 'best-effort';
    },
    contractRevision: input.contract.revision,
    read: async (args) => {
      const end = input.room.ended();

      if (end !== null) {
        throw surfaceError(endError(end).code, endError(end).message);
      }

      return input.agent.read(args);
    },
    describe: (query) => input.agent.describe(query),
    execute,
    close: async () => {
      const summary = { unsavedBatches: notSaved().length, hostRecordLags: input.room.protocol === 'v2' };

      input.presence.clear();
      await input.room.close();

      return summary;
    },
  };
};
```

The `durability` getter satisfies `readonly durability: Durability` in `HandleSession`.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/mcp/live-session.test.ts`
Expected: PASS.

Mutation check (manual, not committed): change `if (fate.state === 'acked')` to `if (fate.state !== 'quarantined')`. Run. Expected: "reports pending ... (Review Focus 2)" FAILS (it would claim durable). Revert.

- [ ] **Step 5: Commit**

```bash
npx eslint src/mcp/live/live-session.ts test/unit/mcp/live-session.test.ts
git add src/mcp/live/live-session.ts test/unit/mcp/live-session.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): live session maps acks, quarantines and resets to delivery and errors" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: Agent presence (`user`, `agent`, `blockId`, `activeAt`, `agentCursor`)

**Files:**
- Create: `src/mcp/live/presence.ts`, `test/unit/mcp/presence.test.ts`

**Interfaces:**
- Consumes: `PresenceSink` (Task 18), `AgentActor`, `AgentResult` (01), `isPresenceColor`, `presenceColorFor` (`presence.ts:121`, `:172`).
- Produces:

```ts
export interface PresenceTarget { setAwarenessField(field: string, value: unknown): void; sendActivity(): boolean }
export interface AgentPresenceOptions { actor: AgentActor; onBehalfOfName?: string; now?: () => number }
export class AgentPresence implements PresenceSink {
  constructor(target: PresenceTarget, options: AgentPresenceOptions);
  announce(): void;                    // user + agent fields
  afterBatch(result: AgentResult): void;
  clear(): void;                       // agentCursor null, blockId null
}
```

Wire shapes (06 §10.2 and R2-03-4, verbatim):
- `user`: `{ name: actor.name, color, id: actor.id }` (`id` only beside a name, as `presence.ts:356-370`).
- `agent`: `{ via: 'mcp', onBehalfOf: actor.onBehalfOf, onBehalfOfName? }`.
- `blockId`: last id of `changed.created`, else of `updated`, else of `moved`.
- `activeAt`: `now()` after every batch.
- `agentCursor`: `{ actorId, name, color?, blockId, field?, start?, end? }` from `lastRange`, else block-level; `null` on clear.
- `sendActivity()`: at most once a minute; a call that sent nothing (socket not ready) does not spend the minute (`types.ts:383-391`).
- No `caret` field ever (`caret.inputIndex` counts DOM inputs).

- [ ] **Step 1: Write the failing test**

`test/unit/mcp/presence.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentPresence } from '../../../src/mcp/live/presence';

const actor = { id: 'agent:alice:claude', name: 'claude (for alice)', kind: 'agent' as const, onBehalfOf: 'alice', color: '#7c3aed' };
const result = (changed: Partial<Record<'created' | 'updated' | 'moved' | 'removed', string[]>>, lastRange?: object) => ({
  ok: true as const, revision: '1', results: [], refs: {}, warnings: [],
  changed: { created: [], updated: [], moved: [], removed: [], ...changed },
  ...(lastRange !== undefined && { lastRange }),
});

describe('AgentPresence', () => {
  let fields: Record<string, unknown>;
  let activity: ReturnType<typeof vi.fn>;
  let clock: number;
  let presence: AgentPresence;

  beforeEach(() => {
    vi.clearAllMocks();
    fields = {};
    clock = 1_000_000;
    activity = vi.fn(() => true);
    presence = new AgentPresence(
      { setAwarenessField: (field, value) => { fields[field] = value; }, sendActivity: activity },
      { actor, onBehalfOfName: 'Alice', now: () => clock },
    );
  });

  it('announces a named agent participant with its own id', () => {
    presence.announce();

    expect(fields.user).toEqual({ name: 'claude (for alice)', color: '#7c3aed', id: 'agent:alice:claude' });
    expect(fields.agent).toEqual({ via: 'mcp', onBehalfOf: 'alice', onBehalfOfName: 'Alice' });
    expect(fields.caret).toBeUndefined();
  });

  it('points at the last created block and sets a block-level cursor', () => {
    presence.afterBatch(result({ created: ['a', 'b'], updated: ['c'] }));

    expect(fields.blockId).toBe('b');
    expect(fields.activeAt).toBe(clock);
    expect(fields.agentCursor).toEqual({ actorId: actor.id, name: actor.name, color: '#7c3aed', blockId: 'b' });
  });

  it('falls back to updated, then moved', () => {
    presence.afterBatch(result({ updated: ['u1', 'u2'], moved: ['m'] }));
    expect(fields.blockId).toBe('u2');
    presence.afterBatch(result({ moved: ['m1'] }));
    expect(fields.blockId).toBe('m1');
  });

  it('uses lastRange for a text-level cursor', () => {
    presence.afterBatch(result({ updated: ['p'] }, { blockId: 'p', field: 'text', start: 4, end: 12 }));

    expect(fields.agentCursor).toEqual({ actorId: actor.id, name: actor.name, color: '#7c3aed', blockId: 'p', field: 'text', start: 4, end: 12 });
  });

  it('keeps the old cursor after a batch that touched nothing', () => {
    presence.afterBatch(result({ created: ['a'] }));
    presence.afterBatch(result({}));

    expect(fields.blockId).toBe('a');
  });

  it('sends activity at most once a minute, and a failed send does not count', () => {
    activity.mockReturnValueOnce(false);
    presence.afterBatch(result({ created: ['a'] }));
    presence.afterBatch(result({ created: ['b'] }));
    clock += 30_000;
    presence.afterBatch(result({ created: ['c'] }));
    clock += 30_000;
    presence.afterBatch(result({ created: ['d'] }));

    expect(activity).toHaveBeenCalledTimes(3);
  });

  it('clears the cursor and block on clear', () => {
    presence.afterBatch(result({ created: ['a'] }));
    presence.clear();

    expect(fields.agentCursor).toBeNull();
    expect(fields.blockId).toBeNull();
  });

  it('derives a valid color when the actor has none', () => {
    const plain = new AgentPresence(
      { setAwarenessField: (field, value) => { fields[field] = value; }, sendActivity: () => true },
      { actor: { id: 'agent:x', name: 'x', kind: 'agent', onBehalfOf: 'x' } },
    );

    plain.announce();
    expect(typeof (fields.user as { color: unknown }).color).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/mcp/presence.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

`src/mcp/live/presence.ts`:

```ts
import { createHash } from 'node:crypto';
import { isPresenceColor, presenceColorFor } from '../../components/modules/collaboration/presence';
import type { AgentActor, AgentResult } from '../../shared/agent';
import type { PresenceSink } from './live-session';

export interface PresenceTarget { setAwarenessField(field: string, value: unknown): void; sendActivity(): boolean }
export interface AgentPresenceOptions { actor: AgentActor; onBehalfOfName?: string; now?: () => number }

const ACTIVITY_INTERVAL_MS = 60_000;

/** Stable small number from the actor id, so the default color does not change per connection. */
const colorSeed = (id: string): number => createHash('sha256').update(id).digest().readUInt16BE(0);

export class AgentPresence implements PresenceSink {
  private readonly now: () => number;
  private readonly color: string;
  private lastActivity: number | null = null;

  constructor(private readonly target: PresenceTarget, private readonly options: AgentPresenceOptions) {
    this.now = options.now ?? Date.now;
    this.color = isPresenceColor(options.actor.color) ? options.actor.color : presenceColorFor(colorSeed(options.actor.id));
  }

  public announce(): void {
    const { actor, onBehalfOfName } = this.options;

    this.target.setAwarenessField('user', { name: actor.name, color: this.color, id: actor.id });
    // A new field, not a change to `user`: old clients read existing fields by name (presence.ts:316-322).
    this.target.setAwarenessField('agent', {
      via: 'mcp',
      onBehalfOf: actor.onBehalfOf ?? actor.id,
      ...(onBehalfOfName !== undefined && { onBehalfOfName }),
    });
  }

  public afterBatch(result: AgentResult): void {
    if (!result.ok) {
      return;
    }
    const { created, updated, moved } = result.changed;
    const blockId = created.at(-1) ?? updated.at(-1) ?? moved.at(-1);
    const now = this.now();

    this.target.setAwarenessField('activeAt', now);
    if (blockId !== undefined) {
      const range = result.lastRange;

      this.target.setAwarenessField('blockId', range?.blockId ?? blockId);
      this.target.setAwarenessField('agentCursor', {
        actorId: this.options.actor.id,
        name: this.options.actor.name,
        color: this.color,
        blockId: range?.blockId ?? blockId,
        ...(range !== undefined && { field: range.field, start: range.start, end: range.end }),
      });
    }
    if (this.lastActivity === null || now - this.lastActivity >= ACTIVITY_INTERVAL_MS) {
      if (this.target.sendActivity()) {
        this.lastActivity = now;
      }
    }
  }

  public clear(): void {
    this.target.setAwarenessField('agentCursor', null);
    this.target.setAwarenessField('blockId', null);
  }
}
```

If importing `presence.ts` pulls DOM code into the Node bundle (the bin test in Task 9 catches a `document is not defined` at load), copy the two pure helpers into `src/components/modules/collaboration/presence-color.ts`, re-export them from `presence.ts`, and import from the new file here.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/mcp/presence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/mcp/live/presence.ts test/unit/mcp/presence.test.ts
git add src/mcp/live/presence.ts test/unit/mcp/presence.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): agent presence with agent and agentCursor awareness fields" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 20: Opening live handles, expiry and shutdown

**Files:**
- Create: `src/mcp/live/open-live.ts`, `test/unit/mcp/open-live.test.ts`
- Modify: `src/mcp/server.ts` (pass `openLive` to the opener when `options.sync` is set)

**Interfaces:**
- Consumes: `openHeadlessRoom`, `HeadlessRoomTimeoutError`, `HeadlessRoomTerminalError` (Task 17), `createLiveSession`, `terminalToError` (Task 18), `AgentPresence` (Task 19), `nodeSocketFactory` (Task 15), `McpContracts.richTextFieldsFor` (Task 5); from 01, `createStoreAgentSession`, `createHeadlessPorts`; `htmlToSegmentsNode` (`src/view/rich-text-parse5.ts`); `YBlockSerializer`.
- Produces:

```ts
export interface OpenLiveDeps {
  sync: { url: string; origin?: string };
  contracts: McpContracts;
  /** Task 22 fills this; until then a room with no auth. */
  ticketsFor?: (request: OpenRequest, caller: Caller, actor: AgentActor) => Promise<CollabTicketSource>;
  socketFactory?: CollabSocketFactory;   // default nodeSocketFactory(sync.origin ?? null)
  portsFor(caller: Caller, actor: AgentActor): AgentPorts;
  pageTitles?: 'off' | 'page-map';
  syncTimeoutMs?: number;
}
export const createOpenLive: (deps: OpenLiveDeps) => (request: OpenRequest, caller: Caller, actor: AgentActor) => Promise<HandleSession>;
export const syncUrlFor: (base: string, documentId: string) => string;   // `${base}/${encodeURIComponent(id)}`
```

Errors: `HeadlessRoomTimeoutError` → `ROOM_SYNC_TIMEOUT`; `HeadlessRoomTerminalError` → `terminalToError(error)`.

Shutdown: `assembleMcp().stop()` already runs `handles.closeAll(session.close)`, and `runCli` calls `stop()` on stdin end / SIGINT / SIGTERM (Task 9). Live `close` clears presence and destroys the provider, which announces departure. The test below pins that path (Review Focus 4).

- [ ] **Step 1: Write the failing test**

`test/unit/mcp/open-live.test.ts` (scripted v2 room, same `ScriptedSocket` as Task 17, copied in):

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decode, encode } from '../../../src/components/modules/collaboration/sync-wire';
import type { CollabSocketFactory, SyncWireFrame, WebSocketLike, WorkingSetTag } from '../../../src/components/modules/collaboration/types';
import type { Caller } from '../../../src/mcp/dispatcher';
import { assembleMcp, type AssembledMcp } from '../../../src/mcp/server';

const TAG: WorkingSetTag = { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' };
const caller: Caller = { principal: 'alice', clientName: 'claude', scopes: null };

class ScriptedSocket implements WebSocketLike {
  public binaryType = 'blob';
  public readyState = 0;
  public protocol = '';
  public sent: SyncWireFrame[] = [];
  public onopen: ((event: unknown) => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  public send(data: ArrayBufferLike | ArrayBufferView): void {
    const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
    const frame = decode(bytes);

    if (frame.type !== 'unknown' && frame.type !== 'malformed') {
      this.sent.push(frame);
    }
  }
  public close(): void {
    this.readyState = 3;
  }
  public deliver(frame: SyncWireFrame): void {
    this.onmessage?.({ data: encode(frame).slice().buffer });
  }
}

describe('live handles through the dispatcher', () => {
  let sockets: ScriptedSocket[];
  let silent: boolean;
  let mcp: AssembledMcp;

  const factory: CollabSocketFactory = () => {
    const socket = new ScriptedSocket();

    sockets.push(socket);
    queueMicrotask(() => {
      socket.readyState = 1;
      socket.protocol = 'blok-sync.v2';
      socket.onopen?.({});
      if (!silent) {
        socket.deliver({ type: 'control', tag: TAG });
        socket.deliver({ type: 'syncStep2', update: new Uint8Array([0, 0]) });
      }
    });

    return socket;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sockets = [];
    silent = false;
    mcp = assembleMcp(
      { transport: { kind: 'stdio' }, auth: { kind: 'none' }, sync: { url: 'wss://sync.test/sync' } },
      { liveSocketFactory: factory, liveSyncTimeoutMs: 100 },
    );
  });

  afterEach(async () => {
    await mcp.stop();
  });

  it('auto mode opens a live, acknowledged handle once the room synced', async () => {
    const opened = await mcp.dispatch('blok_open', { documentId: 'doc 1', write: true }, caller);

    expect(opened.structuredContent).toMatchObject({ mode: 'live', write: true, durability: 'acknowledged' });
  });

  it('answers ROOM_SYNC_TIMEOUT when the room never syncs', async () => {
    silent = true;
    const opened = await mcp.dispatch('blok_open', { documentId: 'doc', write: true }, caller);

    expect(opened.structuredContent).toEqual({ error: expect.objectContaining({ code: 'ROOM_SYNC_TIMEOUT', retryable: true }) });
  });

  it('refuses stored mode next to the sync service', async () => {
    const opened = await mcp.dispatch('blok_open', { documentId: 'doc', mode: 'stored' }, caller);

    expect(opened.structuredContent).toEqual({ error: expect.objectContaining({ code: 'STORED_WRITE_FORBIDDEN' }) });
  });

  it('publishes the agent participant, then withdraws it on stop (Review Focus 4)', async () => {
    await mcp.dispatch('blok_open', { documentId: 'doc', write: true }, caller);
    // The provider batches awareness in a 100 ms window (types.ts awarenessThrottleMs).
    await vi.waitFor(() => expect(sockets[0].sent.some((frame) => frame.type === 'awareness')).toBe(true));
    const awarenessBefore = sockets[0].sent.filter((frame) => frame.type === 'awareness').length;

    await mcp.stop();

    expect(sockets[0].readyState).toBe(3);
    expect(sockets[0].sent.filter((frame) => frame.type === 'awareness').length).toBeGreaterThan(awarenessBefore);
  });

  it('refuses history.undo in live mode with COMMAND_UNAVAILABLE', async () => {
    const handle = (await mcp.dispatch('blok_open', { documentId: 'doc', write: true }, caller)).structuredContent.handle;
    const outcome = await mcp.dispatch('blok_execute', { handle, commands: [{ name: 'history.undo', args: {} }] }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE', details: { reason: 'runtime' } } });
  });

  it('percent-encodes the document id into the sync URL', async () => {
    const urls: string[] = [];
    const spyFactory: CollabSocketFactory = (url, protocols) => {
      urls.push(url);

      return factory(url, protocols);
    };

    await mcp.stop();
    mcp = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, sync: { url: 'wss://sync.test/sync/' } }, { liveSocketFactory: spyFactory });
    await mcp.dispatch('blok_open', { documentId: 'a/b c' }, caller);

    expect(urls[0]).toBe('wss://sync.test/sync/a%2Fb%20c');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/mcp/open-live.test.ts`
Expected: FAIL, `liveSocketFactory` is not an `AssembleDeps` key and live mode answers `INVALID_ARGS`.

- [ ] **Step 3: Write minimal implementation**

`src/mcp/live/open-live.ts`:

```ts
import {
  HeadlessRoomTerminalError,
  HeadlessRoomTimeoutError,
  openHeadlessRoom,
} from '../../components/modules/collaboration/headless-session';
import type { CollabSocketFactory, CollabTicketSource } from '../../components/modules/collaboration/types';
import { createStoreAgentSession } from '../../components/modules/agent/store-session';
import { YBlockSerializer } from '../../components/modules/yjs/serializer';
import type { AgentActor, AgentPorts } from '../../shared/agent';
import { htmlToSegmentsNode } from '../../view/rich-text-parse5';
import type { McpContracts } from '../contract';
import type { Caller, OpenRequest } from '../dispatcher';
import { McpSurfaceError, surfaceError } from '../errors';
import type { HandleSession } from '../session';
import { createLiveSession, terminalToError } from './live-session';
import { nodeSocketFactory } from './node-socket';
import { AgentPresence } from './presence';

export interface OpenLiveDeps {
  sync: { url: string; origin?: string };
  contracts: McpContracts;
  ticketsFor?: (request: OpenRequest, caller: Caller, actor: AgentActor) => Promise<CollabTicketSource>;
  socketFactory?: CollabSocketFactory;
  portsFor(caller: Caller, actor: AgentActor): AgentPorts;
  pageTitles?: 'off' | 'page-map';
  syncTimeoutMs?: number;
}

export const syncUrlFor = (base: string, documentId: string): string => `${base.replace(/\/$/, '')}/${encodeURIComponent(documentId)}`;

export const createOpenLive = (deps: OpenLiveDeps) => async (request: OpenRequest, caller: Caller, actor: AgentActor): Promise<HandleSession> => {
  const ticketSource = deps.ticketsFor === undefined ? undefined : await deps.ticketsFor(request, caller, actor);
  const room = await openHeadlessRoom({
    url: syncUrlFor(deps.sync.url, request.documentId),
    docId: request.documentId,
    serializer: new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode, richTextFieldsFor: deps.contracts.richTextFieldsFor }),
    socketFactory: deps.socketFactory ?? nodeSocketFactory(deps.sync.origin ?? null),
    ticketSource,
    writeDenied: !request.write,
    syncTimeoutMs: deps.syncTimeoutMs,
  }).catch((thrown: unknown) => {
    if (thrown instanceof HeadlessRoomTimeoutError) {
      throw surfaceError('ROOM_SYNC_TIMEOUT', 'The room did not finish loading in 15 seconds. Try again.');
    }
    if (thrown instanceof HeadlessRoomTerminalError) {
      const error = terminalToError(thrown.error);

      throw new McpSurfaceError(error.code, error.message, error.details);
    }
    throw thrown;
  });

  const agent = createStoreAgentSession({
    store: room.store,
    tools: deps.contracts.runtimes,
    contract: deps.contracts.live,
    actor,
    ports: deps.portsFor(caller, actor),
    richTextFieldsFor: deps.contracts.richTextFieldsFor,
    ...(deps.pageTitles === 'page-map' && { pageTitles: 'page-map' as const }),
  });
  const presence = new AgentPresence(
    { setAwarenessField: (field, value) => room.store.setAwarenessField(field, value), sendActivity: () => room.sendActivity() },
    { actor },
  );

  return createLiveSession({ room, agent, contract: deps.contracts.live, presence, write: request.write });
};
```

`src/mcp/server.ts` — extend `AssembleDeps` and pass `openLive`:

```ts
import type { CollabSocketFactory } from '../components/modules/collaboration/types';
import { createOpenLive } from './live/open-live';

export interface AssembleDeps {
  open?: DispatcherDeps['open'];
  list?: DispatcherDeps['list'];
  /** Tests inject a scripted transport. */
  liveSocketFactory?: CollabSocketFactory;
  liveSyncTimeoutMs?: number;
}
// inside assembleMcp, before createOpener:
  const portsFor = (): AgentPorts => createHeadlessPorts({ sanitizeFor: (type) => contracts.runtimes.get(type)?.sanitize, richTextFieldsFor: contracts.richTextFieldsFor });
  const openLive = options.sync === undefined ? undefined : createOpenLive({
    sync: options.sync,
    contracts,
    pageTitles: options.pageTitles,
    socketFactory: deps.liveSocketFactory,
    syncTimeoutMs: deps.liveSyncTimeoutMs,
    portsFor,
  });
  const opener = createOpener({ options, contracts, source: createSource(options.source), openLive, portsFor });
```

(`AgentPorts` type import from `../shared/agent`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/mcp/open-live.test.ts`, then `yarn test test/unit/mcp/stored-e2e.test.ts`, then `yarn test test/unit/architecture/view-entry-law.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/mcp/live/open-live.ts src/mcp/server.ts test/unit/mcp/open-live.test.ts
git add src/mcp/live/open-live.ts src/mcp/server.ts test/unit/mcp/open-live.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): open live rooms as a visible agent participant" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 21: Conformance: the agent in a real C# room

**Files:**
- Create: `test/unit/server-conformance/mcp-agent-participant.test.ts`
- Modify: `scripts/test-server-conformance.mjs:140-149` (add the file to the vitest list)

**Interfaces:**
- Consumes: `startServer` (`run-against.ts:159`), `startDocEndpoint` (`doc-endpoint.ts`), `blokTicket` (`packages/server/src/ticket.ts`), `assembleMcp` (Tasks 9–20), Blok's own client pieces exactly as `blok-client-contract.test.ts:180-380` builds them. Tickets in this file are minted by the MCP server's own secret path, so it also needs Task 22; run Step 2 after Task 22 lands, or temporarily mint with `ticketsFor` (see Step 3).
- Produces: the live-mode proof 05 relies on (`live-coedit` grader facts).

- [ ] **Step 1: Write the test**

`test/unit/server-conformance/mcp-agent-participant.test.ts`:

```ts
// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it as baseIt } from 'vitest';
import * as Y from 'yjs';
import { blokTicket } from '../../../packages/server/src/ticket';
import { createCollabProvider } from '../../../src/components/modules/collaboration/provider';
import type { CollabDocSeam, CollabProvider } from '../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import type { Caller } from '../../../src/mcp/dispatcher';
import { nodeSocketFactory } from '../../../src/mcp/live/node-socket';
import { assembleMcp } from '../../../src/mcp/server';
import { htmlToSegmentsNode } from '../../../src/view/rich-text-parse5';
import { startDocEndpoint } from './doc-endpoint';
import { startServer } from './run-against';

/**
 * Live mode against the built C# host: the MCP agent is a real socket member
 * with its own verified identity. Same gate as blok-client-contract.test.ts.
 */
const it = baseIt.skipIf(process.env.BLOK_CONFORMANCE_SERVER === undefined || process.env.BLOK_CONFORMANCE_SERVER === '');

const SECRET = 'mcp-conformance-secret-0123456789abcdef';
const ORIGIN = 'https://app.example.com';
const DOC = 'mcp-doc';
const HUMAN = 'alice';
const DEADLINE_MS = 15_000;
const caller: Caller = { principal: HUMAN, clientName: 'claude-code', scopes: null };

const waitFor = async (predicate: () => boolean, what: () => string): Promise<void> => {
  const deadline = Date.now() + DEADLINE_MS;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what()}`);
    }
    await new Promise((done) => setTimeout(done, 25));
  }
};

interface Human { store: DocumentStore; provider: CollabProvider; identities: Array<{ clientId: number; actorId: string }>; destroy(): void }

const connectHuman = (wsUrl: string): Human => {
  const store = new DocumentStore(new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode }));
  const identities: Human['identities'] = [];
  const seam: CollabDocSeam = {
    applyRemoteUpdate: (u, o) => store.applyRemoteUpdate(u, o),
    onDocUpdate: (c) => store.onUpdate(c),
    onAnyDocUpdate: (c) => store.onAnyUpdate(c),
    getStateVector: () => store.getStateVector(),
    encodeStateAsUpdate: (sv) => store.encodeStateAsUpdate(sv),
    enableAwareness: () => store.enableAwareness(),
    setAwarenessField: (f, v) => store.setAwarenessField(f, v),
    getAwarenessStates: () => store.getAwarenessStates(),
    onAwarenessChange: (c) => store.onAwarenessChange(c),
    onAwarenessUpdate: (c) => store.onAwarenessUpdate(c),
    encodeAwarenessUpdate: (c) => store.encodeAwarenessUpdate(c),
    encodeLocalAwarenessDeparture: () => store.encodeLocalAwarenessDeparture(),
    applyAwarenessUpdate: (u, o) => store.applyAwarenessUpdate(u, o),
    clearRemoteAwarenessStates: () => store.clearRemoteAwarenessStates(),
    resetForRelineage: () => store.resetForRelineage(),
  };
  const provider = createCollabProvider({
    url: `${wsUrl}/${DOC}`,
    docId: DOC,
    yjs: seam,
    ticketSource: async () => blokTicket(SECRET, { user: HUMAN, doc: DOC, write: true, ttlSeconds: 600 }),
    socketFactory: nodeSocketFactory(ORIGIN),
    random: () => 0,
    onVerifiedIdentities: (map) => identities.splice(0, identities.length, ...map),
  });

  provider.connect();

  return { store, provider, identities, destroy: () => { provider.destroy(); store.destroy(); } };
};

const withRoom = async (run: (input: { wsUrl: string; baseUrl: string; request: (method: string, path: string) => Promise<{ status: number; text: string }> }) => Promise<void>): Promise<void> => {
  const collabDirectory = await mkdtemp(join(tmpdir(), 'blok-mcp-conformance-'));
  const endpoint = await startDocEndpoint();
  const server = await startServer({
    args: [
      '--listen', '127.0.0.1:0', '--auth', 'ticket', '--storage-dir', '', '--rate-limit', '0',
      '--collab', '--collab-dir', collabDirectory, '--doc-endpoint', endpoint.url,
      '--conformance-journal', '--allow-origin', ORIGIN,
    ],
    env: { BLOK_SECRET: SECRET },
  });

  try {
    await run({
      wsUrl: `${server.baseUrl.replace(/^http:/, 'ws:')}/sync`,
      baseUrl: server.baseUrl,
      request: async (method, path) => {
        const answer = await server.request(method, path, {
          headers: { Origin: ORIGIN, Authorization: `Bearer ${blokTicket(SECRET, { user: HUMAN, doc: DOC, write: true })}` },
        });

        return { status: answer.status, text: answer.text };
      },
    });
  } finally {
    await server.stop();
    await endpoint.stop();
    await rm(collabDirectory, { recursive: true, force: true });
  }
};

it('an MCP agent joins as its own participant and writes formatted rich text', async () => {
  await withRoom(async ({ wsUrl, request }) => {
    const human = connectHuman(wsUrl);
    const mcp = assembleMcp({
      transport: { kind: 'stdio' }, auth: { kind: 'none' },
      sync: { url: wsUrl, origin: ORIGIN }, tickets: { kind: 'secret', secret: SECRET },
    });

    try {
      await waitFor(() => human.provider.status === 'connected', () => `human status ${human.provider.status}`);
      const opened = await mcp.dispatch('blok_open', { documentId: DOC, write: true }, caller);

      expect(opened.structuredContent).toMatchObject({ mode: 'live', durability: 'acknowledged' });
      const handle = opened.structuredContent.handle;
      const executed = await mcp.dispatch('blok_execute', {
        handle,
        commands: [{ name: 'block.insert', args: { type: 'paragraph', id: 'agent-p', data: { text: [{ text: 'Hello ' }, { text: 'bold', marks: { bold: true } }] } } }],
      }, caller);

      // Success criterion 3: durable only after the server acknowledged it.
      expect(executed.structuredContent).toMatchObject({ ok: true, delivery: { durable: true, pending: false } });
      expect(typeof (executed.structuredContent.delivery as { serverSequence: unknown }).serverSequence).toBe('string');

      await waitFor(() => human.store.getBlockById('agent-p') !== undefined, () => 'the agent block at the human');
      const text = (human.store.getBlockById('agent-p')?.get('data') as Y.Map<unknown>).get('text');

      expect(text).toBeInstanceOf(Y.XmlText);
      expect(JSON.stringify(new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode }).readRichText(text as Y.XmlText)))
        .toContain('"bold":true');

      // Frame 107 names the agent, not the human (participants group by verified id).
      await waitFor(() => human.identities.some((entry) => entry.actorId === 'agent:alice:claude-code'), () => JSON.stringify(human.identities));
      expect(human.identities.some((entry) => entry.actorId === HUMAN)).toBe(true);

      // The human sees agent + agentCursor awareness fields.
      await waitFor(() => [...human.store.getAwarenessStates().values()].some((state) => state.agent !== undefined), () => 'agent awareness');
      const agentState = [...human.store.getAwarenessStates().values()].find((state) => state.agent !== undefined);

      expect(agentState?.agent).toEqual({ via: 'mcp', onBehalfOf: HUMAN });
      expect(agentState?.agentCursor).toMatchObject({ actorId: 'agent:alice:claude-code', blockId: 'agent-p' });
      expect(agentState?.caret).toBeUndefined();

      // Saved attribution and journal actors.
      expect(human.store.toJSON().find((block) => block.id === 'agent-p')?.lastEditedBy).toBe('agent:alice:claude-code');
      const history = await request('GET', `/sync/${DOC}/history`);

      expect(history.status).toBe(200);
      expect(history.text).toContain('agent:alice:claude-code');

      const closed = await mcp.dispatch('blok_close', { handle }, caller);

      expect(closed.structuredContent).toEqual({ closed: true, unsavedBatches: 0, hostRecordLags: true });
      await waitFor(() => ![...human.store.getAwarenessStates().values()].some((state) => state.agent !== undefined), () => 'agent to leave');
    } finally {
      await mcp.stop();
      human.destroy();
    }
  });
}, 60_000);

it('a moved block keeps its identity while the human types inside it', async () => {
  await withRoom(async ({ wsUrl }) => {
    const human = connectHuman(wsUrl);
    const mcp = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, sync: { url: wsUrl, origin: ORIGIN }, tickets: { kind: 'secret', secret: SECRET } });

    try {
      await waitFor(() => human.provider.status === 'connected', () => 'human connected');
      const handle = (await mcp.dispatch('blok_open', { documentId: DOC, write: true }, caller)).structuredContent.handle;

      await mcp.dispatch('blok_execute', {
        handle,
        commands: [
          { name: 'block.insert', args: { type: 'paragraph', id: 'first', data: { text: 'first' } } },
          { name: 'block.insert', args: { type: 'paragraph', id: 'moved', data: { text: 'move me' } } },
        ],
      }, caller);
      await waitFor(() => human.store.getBlockById('moved') !== undefined, () => 'moved block at human');
      const before = human.store.getBlockById('moved');

      human.store.transact(() => {
        human.store.updateBlockData('moved', 'text', 'move me, typed');
      }, 'local');
      await mcp.dispatch('blok_execute', { handle, commands: [{ name: 'block.move', args: { id: 'moved', position: { before: 'first' } } }] }, caller);

      await waitFor(() => human.store.toJSON()[0]?.id === 'moved', () => JSON.stringify(human.store.toJSON().map((b) => b.id)));
      expect(human.store.getBlockById('moved')).toBe(before);
      expect(JSON.stringify(human.store.toJSON()[0].data)).toContain('typed');
    } finally {
      await mcp.stop();
      human.destroy();
    }
  });
}, 60_000);

it('a read-only ticket makes the batch not saved with READ_ONLY', async () => {
  await withRoom(async ({ wsUrl }) => {
    const mcp = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, sync: { url: wsUrl, origin: ORIGIN }, tickets: { kind: 'secret', secret: SECRET } });

    try {
      const handle = (await mcp.dispatch('blok_open', { documentId: DOC, write: false }, caller)).structuredContent.handle;
      const outcome = await mcp.dispatch('blok_execute', { handle, commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'x' } } }] }, caller);

      expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
    } finally {
      await mcp.stop();
    }
  });
}, 60_000);

it('open before sync never returns an empty view', async () => {
  await withRoom(async ({ wsUrl }) => {
    const human = connectHuman(wsUrl);
    const mcp = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, sync: { url: wsUrl, origin: ORIGIN }, tickets: { kind: 'secret', secret: SECRET } });

    try {
      await waitFor(() => human.provider.status === 'connected', () => 'human connected');
      human.store.transact(() => {
        human.store.addBlock({ id: 'h1', type: 'paragraph', data: { text: 'already here' } });
      }, 'local');
      await new Promise((done) => setTimeout(done, 500));
      const opened = await mcp.dispatch('blok_open', { documentId: DOC, view: {} }, caller);

      expect(JSON.stringify(opened.structuredContent.view)).toContain('h1');
    } finally {
      await mcp.stop();
      human.destroy();
    }
  });
}, 60_000);
```

`updateBlockData`'s exact signature is `document-store.ts:1363`; if it is `(id, data)` rather than `(id, key, value)`, call it with `{ text: 'move me, typed' }`. `block.move`'s `position` follows 01's `BlockPosition` (`types/api/blocks.d.ts:33`); use its "before" form.

The human's `connectHuman` does not use an outbox, so it speaks v1; a v1 member in a journal room is allowed (the server selects per socket, `SyncHandshake.cs:276-280`) and its writes are still relayed.

- [ ] **Step 2: Add the file to the conformance runner and run it**

`scripts/test-server-conformance.mjs`, in `vitestArgs` after `'test/unit/server-conformance/protocol-v2-contract.test.ts',`:

```js
      'test/unit/server-conformance/mcp-agent-participant.test.ts',
```

Run: `node scripts/test-server-conformance.mjs --test-name-pattern "MCP agent|moved block|read-only ticket|open before sync"`
Expected: PASS (needs `dotnet`; builds both hosts first). Run `yarn test test/unit/scripts/test-server-conformance.test.ts` too; it pins the script's options, not the file list, so it stays green.

Plain `yarn test test/unit/server-conformance/mcp-agent-participant.test.ts` must report the four tests as skipped, not failed.

- [ ] **Step 3: If Task 22 has not landed yet**

`assembleMcp` gets ticket minting in Task 22. Run this task's Step 2 after Task 22. Do not add a test-only ticket path to production code.

- [ ] **Step 4: Commit**

```bash
npx eslint test/unit/server-conformance/mcp-agent-participant.test.ts scripts/test-server-conformance.mjs
git add test/unit/server-conformance/mcp-agent-participant.test.ts scripts/test-server-conformance.mjs
git diff --cached --name-only
git commit -m "test(mcp): agent participant conformance against the C# room" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Commit this together with Task 22 if Task 22 is not on `main` yet, so `main` never carries a conformance case that cannot pass.

---

### Checkpoint 3

- [ ] Run each Phase 3 test file on its own: `node-socket`, `tracking-outbox`, `headless-session`, `live-session`, `presence`, `open-live`; re-run `stored-e2e`, `sdk-server`, `dispatcher`, `headless-offline-page`, `provider`, `view-entry-law`.
- [ ] `NODE_OPTIONS=--max-old-space-size=8192 yarn lint:types`.
- [ ] `yarn build:mcp && yarn test test/unit/mcp/bin.test.ts` (catches DOM-at-import from the live modules).
- [ ] Conformance (after Task 22): `node scripts/test-server-conformance.mjs --test-name-pattern "MCP agent|moved block|read-only ticket|open before sync"`.
- [ ] `git pull --rebase && git push`; `git status` up to date.

---

## Phase 4 — Auth and tickets

### Task 22: Ticket provider (secret and ticket URL)

**Files:**
- Create: `src/mcp/auth/tickets.ts`, `test/unit/mcp/tickets.test.ts`
- Modify: `src/mcp/server.ts` (pass `ticketsFor` to `createOpenLive`), `src/mcp/config.ts` (`checkOptionSafety`: secret mode without `authorize` only over stdio), `test/unit/mcp/config.test.ts`

**Interfaces:**
- Consumes: `blokTicket` (`packages/server/src/ticket.ts:45-61`, imported from source as `scripts/dev-ticket.mjs:12` does), `readTicketClaims` (`src/components/utils/access-pass.ts:67`), `CollabTicketSource` (`types.ts:247`).
- Produces:

```ts
export interface TicketRequest { documentId: string; write: boolean; principal: string; clientName: string; actorId: string }
export const createTicketProvider: (
  config: NonNullable<BlokMcpOptions['tickets']>,
  fetchImpl?: typeof fetch,
  now?: () => number,
) => (request: TicketRequest) => Promise<CollabTicketSource>;   // mints the first ticket eagerly so refusals surface at blok_open
```

Rules (spec §3.8, 06 C3):
- `secret`: `blokTicket(secret, { user: actorId, doc: documentId, write, ttlSeconds: 1800 })`. Fresh per call (HMAC is cheap).
- `url`: `POST <url>` JSON `{ doc, write, principal, clientName, actorId }`, `Authorization: Bearer <hostToken>`; answer `{ "ticket": "<jwt>" }` (same field `createTicketSource` reads, `access-pass.ts:125-131`). The payload's `user` must equal `actorId` and `doc` must equal `documentId`, else `FORBIDDEN`. The signature is not checked here; the room checks it. Cache until 30 s before `exp`; `forceRefresh` (after a 4401) mints again.
- Host answers 401/403 → `FORBIDDEN`. Other failures → `SOURCE_UNAVAILABLE`.
- Never the caller's OAuth token: the request carries only the MCP server's own `hostToken`.

- [ ] **Step 1: Write the failing tests**

`test/unit/mcp/tickets.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readTicketClaims } from '../../../src/components/utils/access-pass';
import { createTicketProvider } from '../../../src/mcp/auth/tickets';
import { isMcpSurfaceError } from '../../../src/mcp/errors';

const SECRET = 'x'.repeat(32);
const request = { documentId: 'doc-1', write: true, principal: 'alice', clientName: 'claude', actorId: 'agent:alice:claude' };
const jwt = (claims: Record<string, unknown>): string =>
  `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

const codeOf = async (promise: Promise<unknown>): Promise<string | undefined> =>
  promise.then(() => undefined, (thrown: unknown) => (isMcpSurfaceError(thrown) ? thrown.agentError.code : String(thrown)));

describe('secret tickets', () => {
  it('mint user = actor id, never the human, scoped to the doc, 30 minutes', async () => {
    const source = await createTicketProvider({ kind: 'secret', secret: SECRET }, fetch, () => 1_000_000)(request);
    const claims = readTicketClaims(await source());

    expect(claims).toMatchObject({ user: 'agent:alice:claude', doc: 'doc-1', write: true });
    expect(claims?.user).not.toBe('alice');
    expect((claims?.exp as number) - Math.floor(Date.now() / 1000)).toBeGreaterThan(1790);
  });

  it('follow the write flag', async () => {
    const source = await createTicketProvider({ kind: 'secret', secret: SECRET })({ ...request, write: false });

    expect(readTicketClaims(await source())?.write).toBe(false);
  });
});

describe('ticket URL', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const answer = (status: number, body: unknown): void => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
  };

  it('posts who and what to the host with the host token only', async () => {
    answer(200, { ticket: jwt({ user: 'agent:alice:claude', doc: 'doc-1', write: true, exp: 2_000_000_000 }) });
    await createTicketProvider({ kind: 'url', url: 'https://app/mcp-tickets', hostToken: 'host-t' }, fetchMock)(request);

    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe('https://app/mcp-tickets');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer host-t');
    expect(JSON.parse(String(init?.body))).toEqual({ doc: 'doc-1', write: true, principal: 'alice', clientName: 'claude', actorId: 'agent:alice:claude' });
  });

  it('refuses a ticket minted for the human with FORBIDDEN', async () => {
    answer(200, { ticket: jwt({ user: 'alice', doc: 'doc-1', exp: 2_000_000_000 }) });
    expect(await codeOf(createTicketProvider({ kind: 'url', url: 'https://app/t', hostToken: 'h' }, fetchMock)(request))).toBe('FORBIDDEN');
  });

  it('refuses a ticket for another document', async () => {
    answer(200, { ticket: jwt({ user: 'agent:alice:claude', doc: 'other', exp: 2_000_000_000 }) });
    expect(await codeOf(createTicketProvider({ kind: 'url', url: 'https://app/t', hostToken: 'h' }, fetchMock)(request))).toBe('FORBIDDEN');
  });

  it.each([[401, 'FORBIDDEN'], [403, 'FORBIDDEN'], [500, 'SOURCE_UNAVAILABLE']])('maps host %i to %s', async (status, code) => {
    answer(status, {});
    expect(await codeOf(createTicketProvider({ kind: 'url', url: 'https://app/t', hostToken: 'h' }, fetchMock)(request))).toBe(code);
  });

  it('caches until 30 s before expiry and refreshes on forceRefresh', async () => {
    const nowSeconds = 1_000_000;
    const ticket = jwt({ user: 'agent:alice:claude', doc: 'doc-1', exp: nowSeconds + 600 });

    answer(200, { ticket });
    answer(200, { ticket });
    const source = await createTicketProvider({ kind: 'url', url: 'https://app/t', hostToken: 'h' }, fetchMock, () => nowSeconds * 1000)(request);

    await source();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await source({ forceRefresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

Add to `test/unit/mcp/config.test.ts`, in `describe('checkOptionSafety')`:

```ts
  it('allows secret tickets without an authorize hook only over stdio', () => {
    const secret = { kind: 'secret' as const, secret: 'x'.repeat(32) };

    expect(() => checkOptionSafety({ ...base, tickets: secret })).not.toThrow();
    expect(() => checkOptionSafety({ ...base, transport: { kind: 'http', listen: '127.0.0.1:4100' }, tickets: secret })).toThrow(/authorize/);
    expect(() => checkOptionSafety({
      ...base, transport: { kind: 'http', listen: '127.0.0.1:4100' }, tickets: secret, authorize: async () => true,
    })).not.toThrow();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/mcp/tickets.test.ts`, then `yarn test test/unit/mcp/config.test.ts`
Expected: FAIL (module not found; the new config case does not throw).

- [ ] **Step 3: Write minimal implementation**

`src/mcp/auth/tickets.ts`:

```ts
import { blokTicket } from '../../../packages/server/src/ticket';
import type { CollabTicketSource } from '../../components/modules/collaboration/types';
import { readTicketClaims } from '../../components/utils/access-pass';
import { surfaceError } from '../errors';
import type { BlokMcpOptions } from '../options';

export interface TicketRequest { documentId: string; write: boolean; principal: string; clientName: string; actorId: string }

// A collaboration pass is checked at the handshake only; 1800 s is the ceiling ticket.ts recommends.
const TTL_SECONDS = 1800;
const REFRESH_MARGIN_MS = 30_000;

export const createTicketProvider = (
  config: NonNullable<BlokMcpOptions['tickets']>,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
) => async (request: TicketRequest): Promise<CollabTicketSource> => {
  if (config.kind === 'secret') {
    const mint: CollabTicketSource = async () =>
      blokTicket(config.secret, { user: request.actorId, doc: request.documentId, write: request.write, ttlSeconds: TTL_SECONDS });

    await mint();

    return mint;
  }

  const fetchTicket = async (): Promise<{ ticket: string; expiresAtMs: number }> => {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.hostToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doc: request.documentId, write: request.write, principal: request.principal,
        clientName: request.clientName, actorId: request.actorId,
      }),
    }).catch(() => {
      throw surfaceError('SOURCE_UNAVAILABLE', 'The ticket endpoint could not be reached.');
    });

    if (response.status === 401 || response.status === 403) {
      throw surfaceError('FORBIDDEN', 'The host did not grant this document to this agent.');
    }
    if (!response.ok) {
      throw surfaceError('SOURCE_UNAVAILABLE', `The ticket endpoint answered ${response.status}.`);
    }
    const body = (await response.json()) as { ticket?: unknown };

    if (typeof body.ticket !== 'string') {
      throw surfaceError('SOURCE_UNAVAILABLE', 'The ticket endpoint answered without a "ticket" field.');
    }
    const claims = readTicketClaims(body.ticket);

    // The journal and frame 107 name the ticket's user; it must be the agent, never the human (06 C3).
    if (claims?.user !== request.actorId || claims.doc !== request.documentId) {
      throw surfaceError('FORBIDDEN', 'The host minted a ticket for another user or document. Its "user" must equal actorId.');
    }
    const exp = typeof claims.exp === 'number' ? claims.exp * 1000 : now();

    return { ticket: body.ticket, expiresAtMs: exp };
  };

  // A holder, not `let`: the repo bans `let` (access-pass.ts:110-111).
  const state = { cached: await fetchTicket() };

  return async (options) => {
    if (options?.forceRefresh === true || state.cached.expiresAtMs - now() < REFRESH_MARGIN_MS) {
      state.cached = await fetchTicket();
    }

    return state.cached.ticket;
  };
};
```

`src/mcp/config.ts`, end of `checkOptionSafety`:

```ts
  // Without a hook, a secret-minting server grants every document to any caller who reaches it.
  if (options.tickets?.kind === 'secret' && options.authorize === undefined) {
    throw new McpConfigError('Secret tickets over HTTP need --authorize: otherwise every caller can open every document');
  }
```

(Place it after the `transport.kind !== 'http'` early return, so stdio stays allowed.)

`src/mcp/server.ts`, in the `createOpenLive` call:

```ts
import { createTicketProvider } from './auth/tickets';
// ...
  const tickets = options.tickets === undefined ? undefined : createTicketProvider(options.tickets);
  const openLive = options.sync === undefined ? undefined : createOpenLive({
    sync: options.sync,
    contracts,
    pageTitles: options.pageTitles,
    socketFactory: deps.liveSocketFactory,
    syncTimeoutMs: deps.liveSyncTimeoutMs,
    portsFor,
    ...(tickets !== undefined && {
      ticketsFor: (request, caller, actor) => tickets({
        documentId: request.documentId, write: request.write, principal: caller.principal, clientName: caller.clientName, actorId: actor.id,
      }),
    }),
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/mcp/tickets.test.ts`, then `yarn test test/unit/mcp/config.test.ts`, then `yarn test test/unit/mcp/open-live.test.ts`
Expected: PASS.
Then run Task 21's conformance cases: `node scripts/test-server-conformance.mjs --test-name-pattern "MCP agent|moved block|read-only ticket|open before sync"`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/mcp/auth/tickets.ts src/mcp/config.ts src/mcp/server.ts test/unit/mcp/tickets.test.ts test/unit/mcp/config.test.ts
git add src/mcp/auth/tickets.ts src/mcp/config.ts src/mcp/server.ts test/unit/mcp/tickets.test.ts test/unit/mcp/config.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): mint or fetch room tickets whose user is the agent" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(If Task 21 is not on `main` yet, add its two files to this commit.)

---

### Task 23: `authorize` hook (module or webhook)

**Files:**
- Create: `src/mcp/auth/authorize.ts`, `test/unit/mcp/authorize.test.ts`
- Modify: `src/mcp/opener.ts` (check before opening), `src/mcp/index.ts` (load `--authorize`)

**Interfaces:**
- Consumes: `surfaceError`; `createOpener` (Task 13).
- Produces:
  - `type AuthorizeHook = (principal: string, documentId: string, write: boolean) => Promise<boolean>`
  - `loadAuthorizeHook(spec: string, deps?: { fetchImpl?: typeof fetch; importModule?: (path: string) => Promise<unknown>; cwd?: string }): Promise<AuthorizeHook>`
    - `http://` / `https://` → webhook: `POST spec` JSON `{ principal, documentId, write }` → `200 { "allowed": boolean }`. Any other answer → `false` (fail closed).
    - Anything else → a module path resolved against `cwd`; its default export must be a function, else `McpConfigError`.
  - Opener: when `options.authorize` is set and answers `false` → `FORBIDDEN` before any room or source is touched.

- [ ] **Step 1: Write the failing test**

`test/unit/mcp/authorize.test.ts`:

```ts
// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAuthorizeHook } from '../../../src/mcp/auth/authorize';
import { McpConfigError } from '../../../src/mcp/config';
import type { Caller } from '../../../src/mcp/dispatcher';
import { assembleMcp } from '../../../src/mcp/server';

describe('loadAuthorizeHook', () => {
  let dir: string;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'blok-mcp-authz-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads a module default export', async () => {
    writeFileSync(join(dir, 'authz.mjs'), 'export default async (principal, doc, write) => principal === "alice" && (!write || doc === "mine");');
    const hook = await loadAuthorizeHook('./authz.mjs', { cwd: dir });

    expect(await hook('alice', 'mine', true)).toBe(true);
    expect(await hook('alice', 'theirs', true)).toBe(false);
    expect(await hook('bob', 'mine', false)).toBe(false);
  });

  it('refuses a module without a default function', async () => {
    writeFileSync(join(dir, 'bad.mjs'), 'export const x = 1;');
    await expect(loadAuthorizeHook('./bad.mjs', { cwd: dir })).rejects.toBeInstanceOf(McpConfigError);
  });

  it('asks a webhook and fails closed', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ allowed: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockRejectedValueOnce(new Error('down'));
    const hook = await loadAuthorizeHook('https://app/authz', { fetchImpl: fetchMock });

    expect(await hook('alice', 'd', true)).toBe(true);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ principal: 'alice', documentId: 'd', write: true });
    expect(await hook('alice', 'd', true)).toBe(false);
    expect(await hook('alice', 'd', true)).toBe(false);
  });
});

describe('authorize at open', () => {
  it('answers FORBIDDEN before touching the source', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'blok-mcp-authz-open-'));
    const caller: Caller = { principal: 'bob', clientName: 'c', scopes: null };
    const mcp = assembleMcp({
      transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir },
      authorize: async (principal) => principal === 'alice',
    });

    try {
      expect((await mcp.dispatch('blok_open', { documentId: 'doc' }, caller)).structuredContent)
        .toEqual({ error: expect.objectContaining({ code: 'FORBIDDEN' }) });
    } finally {
      await mcp.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/mcp/authorize.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

`src/mcp/auth/authorize.ts`:

```ts
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpConfigError } from '../config';

export type AuthorizeHook = (principal: string, documentId: string, write: boolean) => Promise<boolean>;

export const loadAuthorizeHook = async (
  spec: string,
  deps: { fetchImpl?: typeof fetch; importModule?: (path: string) => Promise<unknown>; cwd?: string } = {},
): Promise<AuthorizeHook> => {
  if (/^https?:\/\//.test(spec)) {
    const fetchImpl = deps.fetchImpl ?? fetch;

    // Fail closed: any answer but an explicit { allowed: true } denies.
    return async (principal, documentId, write) => {
      try {
        const response = await fetchImpl(spec, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ principal, documentId, write }),
        });

        if (response.status !== 200) {
          return false;
        }

        return ((await response.json()) as { allowed?: unknown }).allowed === true;
      } catch {
        return false;
      }
    };
  }
  const url = pathToFileURL(resolve(deps.cwd ?? process.cwd(), spec)).href;
  const loaded = (await (deps.importModule ?? ((path: string) => import(/* @vite-ignore */ path)))(url)) as { default?: unknown };

  if (typeof loaded.default !== 'function') {
    throw new McpConfigError(`--authorize ${spec} must default-export (principal, documentId, write) => Promise<boolean>`);
  }
  const hook = loaded.default as (principal: string, documentId: string, write: boolean) => unknown;

  return async (principal, documentId, write) => (await hook(principal, documentId, write)) === true;
};
```

`src/mcp/opener.ts`, first lines of `open`:

```ts
    if (deps.options.authorize !== undefined && !(await deps.options.authorize(caller.principal, request.documentId, request.write))) {
      throw surfaceError('FORBIDDEN', 'You may not open this document with this access.');
    }
```

`src/mcp/index.ts`, in `runCli` before `createBlokMcpServer`:

```ts
import { loadAuthorizeHook } from './auth/authorize';
// ...
    const authorize = files.authorize === undefined ? undefined : await loadAuthorizeHook(files.authorize);
    const server = createBlokMcpServer({
      ...options,
      ...(authorize !== undefined && { authorize }),
      // ...manifest and overrides as before
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/mcp/authorize.test.ts`, then `yarn test test/unit/mcp/stored-e2e.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/mcp/auth/authorize.ts src/mcp/opener.ts src/mcp/index.ts test/unit/mcp/authorize.test.ts
git add src/mcp/auth/authorize.ts src/mcp/opener.ts src/mcp/index.ts test/unit/mcp/authorize.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): authorize hook as a module or webhook, checked at open and on every call" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 24: OAuth access-token verifier (JWKS, no new dependency)

**Files:**
- Create: `src/mcp/auth/oauth.ts`, `test/unit/mcp/oauth.test.ts`

**Interfaces:**
- Consumes: `node:crypto` (`createPublicKey` with `format: 'jwk'`, `verify`); SDK `OAuthError`, `OAuthErrorCode`, type `AuthInfo`, type `OAuthTokenVerifier` from `@modelcontextprotocol/server`. **Unverified:** `OAuthError`'s constructor arguments; confirm in `node_modules/@modelcontextprotocol/server/dist/index.d.mts` before Step 3, change only the two `invalid()` lines.
- Produces:

```ts
export interface JwtVerifierConfig { issuer: string; audience: string; jwksUrl: string }
export const createJwtVerifier: (config: JwtVerifierConfig, fetchImpl?: typeof fetch, now?: () => number) => OAuthTokenVerifier;
export const principalOf: (info: AuthInfo) => string;   // extra.sub, else clientId
```

Checks: `alg` is `RS256` or `ES256` (anything else, `none` included, is refused); `kid` found in JWKS (one refetch on a miss, JWKS cached 10 minutes); signature; `iss === issuer`; `aud` (string or array) contains `audience` (RFC 8707); `exp` in the future (seconds); `nbf` not in the future. Scopes from `scope` (space-separated) or `scp` (array). `AuthInfo.expiresAt` = `exp` in seconds (the SDK rejects tokens without it); `resource` = `new URL(audience)`.

- [ ] **Step 1: Write the failing test**

`test/unit/mcp/oauth.test.ts`:

```ts
// @vitest-environment node
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createJwtVerifier, principalOf } from '../../../src/mcp/auth/oauth';

const NOW_S = 1_800_000_000;
const config = { issuer: 'https://id.example.com', audience: 'https://mcp.example.com', jwksUrl: 'https://id.example.com/jwks' };
const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = (key: KeyObject, kid: string, alg: string) => ({ ...key.export({ format: 'jwk' }), kid, alg, use: 'sig' });

const token = (claims: Record<string, unknown>, options: { alg?: string; kid?: string; key?: KeyObject } = {}): string => {
  const alg = options.alg ?? 'RS256';
  const head = `${b64({ alg, kid: options.kid ?? 'rsa-1', typ: 'JWT' })}.${b64(claims)}`;
  const signature = alg === 'ES256'
    ? sign('sha256', Buffer.from(head), { key: options.key ?? ec.privateKey, dsaEncoding: 'ieee-p1363' })
    : sign('sha256', Buffer.from(head), options.key ?? rsa.privateKey);

  return `${head}.${signature.toString('base64url')}`;
};

const good = { iss: config.issuer, aud: config.audience, sub: 'user-42', client_id: 'claude', scope: 'blok.read blok.write', exp: NOW_S + 600 };

describe('createJwtVerifier', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({
      keys: [jwk(rsa.publicKey, 'rsa-1', 'RS256'), jwk(ec.publicKey, 'ec-1', 'ES256')],
    })));
  });

  const verifier = () => createJwtVerifier(config, fetchMock, () => NOW_S * 1000);

  it('accepts a valid RS256 token and maps scopes, expiry, resource and principal', async () => {
    const info = await verifier().verifyAccessToken(token(good));

    expect(info).toMatchObject({ clientId: 'claude', scopes: ['blok.read', 'blok.write'], expiresAt: NOW_S + 600 });
    expect(info.resource?.href).toBe('https://mcp.example.com/');
    expect(principalOf(info)).toBe('user-42');
  });

  it('accepts ES256 and an scp array', async () => {
    const info = await verifier().verifyAccessToken(token({ ...good, scope: undefined, scp: ['blok.read'] }, { alg: 'ES256', kid: 'ec-1' }));

    expect(info.scopes).toEqual(['blok.read']);
  });

  it('accepts an audience array that contains this server', async () => {
    await expect(verifier().verifyAccessToken(token({ ...good, aud: ['other', config.audience] }))).resolves.toBeDefined();
  });

  it.each([
    ['another audience (RFC 8707)', { ...good, aud: 'https://other' }],
    ['another issuer', { ...good, iss: 'https://evil' }],
    ['an expired token', { ...good, exp: NOW_S - 1 }],
    ['a token not valid yet', { ...good, nbf: NOW_S + 60 }],
    ['a token without exp', { ...good, exp: undefined }],
  ])('refuses %s', async (_label, claims) => {
    await expect(verifier().verifyAccessToken(token(claims))).rejects.toThrow();
  });

  it('refuses alg none and a forged signature', async () => {
    const unsigned = `${b64({ alg: 'none', kid: 'rsa-1' })}.${b64(good)}.`;
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

    await expect(verifier().verifyAccessToken(unsigned)).rejects.toThrow();
    await expect(verifier().verifyAccessToken(token(good, { key: other.privateKey }))).rejects.toThrow();
  });

  it('refetches the JWKS once for an unknown kid, then refuses', async () => {
    const check = verifier();

    await check.verifyAccessToken(token(good));
    await expect(check.verifyAccessToken(token(good, { kid: 'rotated' }))).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/mcp/oauth.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

`src/mcp/auth/oauth.ts`:

```ts
import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto';
import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from '@modelcontextprotocol/server';

export interface JwtVerifierConfig { issuer: string; audience: string; jwksUrl: string }

const JWKS_TTL_MS = 10 * 60_000;
const ALGORITHMS = new Set(['RS256', 'ES256']);

const invalid = (message: string): Error => new OAuthError(OAuthErrorCode.InvalidToken, message);

const decodePart = (part: string | undefined): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(Buffer.from(part ?? '', 'base64url').toString('utf-8'));

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw invalid('Malformed token');
};

export const principalOf = (info: AuthInfo): string => {
  const sub = (info.extra as { sub?: unknown } | undefined)?.sub;

  return typeof sub === 'string' && sub !== '' ? sub : info.clientId;
};

export const createJwtVerifier = (
  config: JwtVerifierConfig,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): OAuthTokenVerifier => {
  const cache: { keys: Map<string, KeyObject>; fetchedAt: number } = { keys: new Map(), fetchedAt: -Infinity };

  const refresh = async (): Promise<void> => {
    const response = await fetchImpl(config.jwksUrl);
    const body = (await response.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };

    cache.keys = new Map((body.keys ?? [])
      .filter((key): key is JsonWebKey & { kid: string } => typeof key.kid === 'string')
      .map((key) => [key.kid, createPublicKey({ key, format: 'jwk' })]));
    cache.fetchedAt = now();
  };

  const keyFor = async (kid: string): Promise<KeyObject> => {
    if (now() - cache.fetchedAt > JWKS_TTL_MS) {
      await refresh();
    }
    if (!cache.keys.has(kid)) {
      await refresh();
    }
    const key = cache.keys.get(kid);

    if (key === undefined) {
      throw invalid('Unknown signing key');
    }

    return key;
  };

  return {
    verifyAccessToken: async (token: string): Promise<AuthInfo> => {
      const [head, body, signature] = token.split('.');
      const header = decodePart(head);
      const claims = decodePart(body);

      if (typeof header.alg !== 'string' || !ALGORITHMS.has(header.alg) || typeof header.kid !== 'string' || signature === undefined) {
        throw invalid('Unsupported token');
      }
      const key = await keyFor(header.kid);
      const data = Buffer.from(`${head}.${body}`);
      const bytes = Buffer.from(signature, 'base64url');
      const valid = header.alg === 'ES256'
        ? verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, bytes)
        : verify('sha256', data, key, bytes);

      if (!valid) {
        throw invalid('Bad signature');
      }
      const nowS = Math.floor(now() / 1000);
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

      if (claims.iss !== config.issuer) {
        throw invalid('Wrong issuer');
      }
      // RFC 8707: the token must be issued for this server.
      if (!audiences.includes(config.audience)) {
        throw invalid('Token not issued for this server');
      }
      if (typeof claims.exp !== 'number' || claims.exp <= nowS) {
        throw invalid('Token expired');
      }
      if (typeof claims.nbf === 'number' && claims.nbf > nowS) {
        throw invalid('Token not valid yet');
      }
      const scopes = typeof claims.scope === 'string'
        ? claims.scope.split(' ').filter((scope) => scope !== '')
        : Array.isArray(claims.scp) ? claims.scp.filter((scope): scope is string => typeof scope === 'string') : [];
      const clientId = [claims.client_id, claims.azp, claims.sub].find((value): value is string => typeof value === 'string') ?? 'unknown';

      return {
        token,
        clientId,
        scopes,
        expiresAt: claims.exp,
        resource: new URL(config.audience),
        extra: { sub: claims.sub },
      };
    },
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/mcp/oauth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/mcp/auth/oauth.ts test/unit/mcp/oauth.test.ts
git add src/mcp/auth/oauth.ts test/unit/mcp/oauth.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): verify OAuth access tokens against the issuer JWKS" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 25: Streamable HTTP transport

**Files:**
- Create: `src/mcp/http.ts`, `test/unit/mcp/http.test.ts`
- Modify: `src/mcp/index.ts` (`createBlokMcpServer.start` serves HTTP when `transport.kind === 'http'`)

**Interfaces:**
- Consumes: `buildSdkServer` (Task 9), `createJwtVerifier`, `principalOf` (Task 24); SDK `createMcpHandler(factory, options)` returning `McpHttpHandler` with `fetch(request, { authInfo })`, `requireBearerAuth({ verifier, requiredScopes, expectedResource, resourceMetadataUrl })` returning `(request) => Promise<AuthInfo | Response>`. **Unverified:** the method name on `McpHttpHandler` (`fetch` per its doc comment "Caller-provided per-request inputs for McpHttpHandler.fetch"); confirm in the `.d.mts` before Step 3.
- Produces:

```ts
export interface HttpServerInput {
  listen: string;                         // host:port, port 0 allowed in tests
  path?: string;                          // default '/mcp'
  tools: McpTool[];
  dispatch: Dispatch;
  auth: BlokMcpOptions['auth'];
  principal: string;                      // used with auth none
  version: string;
  fetchImpl?: typeof fetch;               // JWKS fetch, tests inject
}
export const startHttpServer: (input: HttpServerInput) => Promise<{ url: string; close(): Promise<void> }>;
```

Rules (spec §3.7, §3.8):
- A request carrying an `Origin` header that is not a loopback origin (`http://localhost:*`, `http://127.0.0.1:*`, `http://[::1]:*`) → `403`. MCP clients are not browsers; a browser page on another site must not drive the server. (The spec says "validate Origin"; it names no allow-list flag, so this plan allows loopback origins only.)
- `auth: oauth`: every MCP request needs a bearer token with scope `blok.read` (`requireBearerAuth`; `401` with `WWW-Authenticate` naming the metadata URL, `403 insufficient_scope`). `blok.write` is checked per tool (Task 8).
- `GET /.well-known/oauth-protected-resource` → RFC 9728 JSON `{ resource, authorization_servers: [issuer], scopes_supported: ['blok.read', 'blok.write'], bearer_methods_supported: ['header'] }`.
- Unknown paths → `404`.

- [ ] **Step 1: Write the failing test**

`test/unit/mcp/http.test.ts`:

```ts
// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Caller } from '../../../src/mcp/dispatcher';
import { startHttpServer } from '../../../src/mcp/http';
import { buildMcpContracts } from '../../../src/mcp/contract';
import { listMcpTools } from '../../../src/mcp/tools';

const initialize = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'http-test', version: '0' } },
};
const post = (url: string, headers: Record<string, string> = {}): Promise<Response> => fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
  body: JSON.stringify(initialize),
});

describe('startHttpServer', () => {
  const tools = listMcpTools(buildMcpContracts({ pageTitles: 'off' }).stored, { schema: 'envelope', handleIdleMs: 600_000 });
  const seen: Caller[] = [];
  const dispatch = vi.fn(async (_name: string, _args: Record<string, unknown>, caller: Caller) => {
    seen.push(caller);

    return { structuredContent: { documents: [], nextCursor: null, supported: false }, isError: false };
  });
  let server: { url: string; close(): Promise<void> };

  beforeEach(() => {
    vi.clearAllMocks();
    seen.length = 0;
  });

  afterEach(async () => {
    await server.close();
  });

  it('answers initialize on POST /mcp', async () => {
    server = await startHttpServer({ listen: '127.0.0.1:0', tools, dispatch, auth: { kind: 'none' }, principal: 'local', version: '0' });
    const response = await post(`${server.url}/mcp`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('blok-mcp');
  });

  it('refuses a foreign Origin with 403 and allows a loopback one', async () => {
    server = await startHttpServer({ listen: '127.0.0.1:0', tools, dispatch, auth: { kind: 'none' }, principal: 'local', version: '0' });

    expect((await post(`${server.url}/mcp`, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(`${server.url}/mcp`, { Origin: 'http://localhost:5173' })).status).toBe(200);
  });

  it('404s other paths', async () => {
    server = await startHttpServer({ listen: '127.0.0.1:0', tools, dispatch, auth: { kind: 'none' }, principal: 'local', version: '0' });

    expect((await fetch(`${server.url}/other`)).status).toBe(404);
  });

  describe('with OAuth', () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const config = { kind: 'oauth' as const, issuer: 'https://id.test', audience: 'https://mcp.test', jwksUrl: 'https://id.test/jwks' };
    const jwks = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'k1' }] })));
    const bearer = (scope: string): string => {
      const head = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url')}.${Buffer.from(JSON.stringify({
        iss: config.issuer, aud: config.audience, sub: 'user-42', scope, exp: Math.floor(Date.now() / 1000) + 600,
      })).toString('base64url')}`;

      return `${head}.${sign('sha256', Buffer.from(head), keys.privateKey).toString('base64url')}`;
    };

    beforeEach(async () => {
      server = await startHttpServer({ listen: '127.0.0.1:0', tools, dispatch, auth: config, principal: 'unused', version: '0', fetchImpl: jwks });
    });

    it('serves protected resource metadata', async () => {
      const response = await fetch(`${server.url}/.well-known/oauth-protected-resource`);

      expect(await response.json()).toEqual({
        resource: 'https://mcp.test',
        authorization_servers: ['https://id.test'],
        scopes_supported: ['blok.read', 'blok.write'],
        bearer_methods_supported: ['header'],
      });
    });

    it('401s without a token and names the metadata', async () => {
      const response = await post(`${server.url}/mcp`);

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain('oauth-protected-resource');
    });

    it('403s a token without blok.read', async () => {
      expect((await post(`${server.url}/mcp`, { Authorization: `Bearer ${bearer('other')}` })).status).toBe(403);
    });

    it('accepts a token with blok.read and passes its principal and scopes to tools', async () => {
      const response = await post(`${server.url}/mcp`, { Authorization: `Bearer ${bearer('blok.read')}` });

      expect(response.status).toBe(200);
    });
  });
});
```

The last case proves auth passes. A follow-up assertion on `seen[0]` (`principal: 'user-42'`, `scopes: ['blok.read']`) needs a `tools/call` after `initialize`; on the 2025 era that is a second POST in the same stateless exchange. Add it once Step 3 shows how `createMcpHandler`'s stateless legacy mode treats a `tools/call` without a prior `initialize` on the same instance (**unverified**).

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/mcp/http.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

`src/mcp/http.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { createMcpHandler, requireBearerAuth, type AuthInfo } from '@modelcontextprotocol/server';
import { createJwtVerifier, principalOf } from './auth/oauth';
import type { BlokMcpOptions } from './options';
import type { Dispatch } from './sdk-server';
import { buildSdkServer } from './sdk-server';
import type { McpTool } from './tools';

export interface HttpServerInput {
  listen: string;
  path?: string;
  tools: McpTool[];
  dispatch: Dispatch;
  auth: BlokMcpOptions['auth'];
  principal: string;
  version: string;
  fetchImpl?: typeof fetch;
}

const METADATA_PATH = '/.well-known/oauth-protected-resource';
const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const toRequest = (req: IncomingMessage, base: string): Request => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') {
      headers.set(name, value);
    } else if (Array.isArray(value)) {
      headers.set(name, value.join(', '));
    }
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

  return new Request(new URL(req.url ?? '/', base), {
    method: req.method,
    headers,
    ...(hasBody && { body: Readable.toWeb(req) as ReadableStream, duplex: 'half' }),
  } as RequestInit);
};

const send = async (res: ServerResponse, response: Response): Promise<void> => {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body === null) {
    res.end();

    return;
  }
  for await (const chunk of response.body) {
    res.write(chunk);
  }
  res.end();
};

const splitListen = (listen: string): { host: string; port: number } => {
  const at = listen.lastIndexOf(':');

  return { host: listen.slice(0, at).replace(/^\[|\]$/g, ''), port: Number(listen.slice(at + 1)) };
};

export const startHttpServer = async (input: HttpServerInput): Promise<{ url: string; close(): Promise<void> }> => {
  const path = input.path ?? '/mcp';
  const oauth = input.auth.kind === 'oauth' ? input.auth : null;
  const metadataUrl = oauth === null ? undefined : new URL(METADATA_PATH, oauth.audience).href;
  const authenticate = oauth === null ? null : requireBearerAuth({
    verifier: createJwtVerifier(oauth, input.fetchImpl),
    requiredScopes: ['blok.read'],
    expectedResource: new URL(oauth.audience),
    resourceMetadataUrl: metadataUrl,
  });
  const handler = createMcpHandler((ctx) => {
    const info: AuthInfo | undefined = ctx.authInfo;

    return buildSdkServer({
      tools: input.tools,
      dispatch: input.dispatch,
      caller: (clientName) => (info === undefined
        ? { principal: input.principal, clientName, scopes: null }
        : { principal: principalOf(info), clientName, scopes: info.scopes }),
      version: input.version,
    });
  });
  const { host, port } = splitListen(input.listen);
  const server = createServer((req, res) => {
    void (async () => {
      const base = `http://${req.headers.host ?? 'localhost'}`;
      const url = new URL(req.url ?? '/', base);
      const origin = req.headers.origin;

      if (origin !== undefined && !LOOPBACK_ORIGIN.test(origin)) {
        res.writeHead(403).end();

        return;
      }
      if (oauth !== null && req.method === 'GET' && url.pathname === METADATA_PATH) {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          resource: oauth.audience,
          authorization_servers: [oauth.issuer],
          scopes_supported: ['blok.read', 'blok.write'],
          bearer_methods_supported: ['header'],
        }));

        return;
      }
      if (url.pathname !== path) {
        res.writeHead(404).end();

        return;
      }
      const request = toRequest(req, base);
      const verdict = authenticate === null ? undefined : await authenticate(request);

      if (verdict instanceof Response) {
        await send(res, verdict);

        return;
      }
      await send(res, await handler.fetch(request, { authInfo: verdict }));
    })().catch((error: unknown) => {
      console.error('blok-mcp: HTTP request failed', error);
      if (!res.headersSent) {
        res.writeHead(500).end();
      }
    });
  });

  await new Promise<void>((done) => server.listen(port, host, done));
  const address = server.address() as AddressInfo;
  const shownHost = address.family === 'IPv6' ? `[${address.address}]` : address.address;

  return {
    url: `http://${shownHost}:${address.port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
};
```

`src/mcp/index.ts`, `createBlokMcpServer.start`:

```ts
import { startHttpServer } from './http';
// ...
    start: async () => {
      if (options.transport.kind === 'http') {
        const http = await startHttpServer({
          listen: options.transport.listen,
          tools: assembled.tools,
          dispatch: assembled.dispatch,
          auth: options.auth,
          principal: options.principal ?? DEFAULTS.principal,
          version: getBlokVersion(),
        });

        console.error(`blok-mcp: listening on ${http.url}/mcp`);
        running.handle = http;

        return;
      }
      running.handle = serveStdio(/* as before */);
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/mcp/http.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/mcp/http.ts src/mcp/index.ts test/unit/mcp/http.test.ts
git add src/mcp/http.ts src/mcp/index.ts test/unit/mcp/http.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): Streamable HTTP with Origin check, bearer auth and resource metadata" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Checkpoint 4

- [ ] Run each Phase 4 test file on its own: `tickets`, `authorize`, `oauth`, `http`, `config`; re-run `open-live`, `stored-e2e`, `sdk-server`, `bin` (after `yarn build:mcp`).
- [ ] Conformance: `node scripts/test-server-conformance.mjs --test-name-pattern "MCP agent|moved block|read-only ticket|open before sync"`.
- [ ] `NODE_OPTIONS=--max-old-space-size=8192 yarn lint:types`.
- [ ] Manual: `node packages/mcp/bin/blok-mcp.mjs --http 0.0.0.0:4100` must exit 2 with the `--public` message; `--http 0.0.0.0:4100 --public` must exit 2 with the auth message.
- [ ] `git pull --rebase && git push`; `git status` up to date.

---

## Phase 5 — Page titles opt-in

### Task 26: `--page-titles page-map` (headless `page.rename` / `page.setIcon`)

**Files:**
- Create: `src/mcp/page-titles.ts`, `test/unit/mcp/page-titles.test.ts`
- Modify: `src/mcp/server.ts` (`portsFor` passes `openPageDocument` when `pageTitles === 'page-map'`)

**Interfaces:**
- Consumes: `createOpener().open` (Task 13), `HandleSession` (Task 2), `createHeadlessPorts({ openPageDocument })` (01), `AgentPorts['openPageDocument']` signature `(pageId: string, actor: AgentActor) => Promise<AgentSession & { close(): void }>` (01 spec §3.1).
- Produces:

```ts
export const createOpenPageDocument: (deps: {
  open: DispatcherDeps['open'];
  caller: Caller;
}) => NonNullable<AgentPorts['openPageDocument']>;
```

Rules (06 §10.1 B, R3-2): the target is opened by the same opener as `blok_open` (live if a sync URL is set, else stored), under the same principal and `authorize` checks (the opener runs them, Task 23), with `write: true`. 01's executor runs `doc.setTitle` / `doc.setIcon` there and closes it; the action is `effects: 'host'`, alone in its batch. Without `page-map` the contract has no `pageBackend`, so the actions are `available: false` and not rendered (Task 5 test).

- [ ] **Step 1: Write the failing test**

`test/unit/mcp/page-titles.test.ts`:

```ts
// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Caller } from '../../../src/mcp/dispatcher';
import { assembleMcp, type AssembledMcp } from '../../../src/mcp/server';

const caller: Caller = { principal: 'alice', clientName: 'c', scopes: null };

describe('page titles through page-map', () => {
  let dir: string;
  let mcp: AssembledMcp;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'blok-mcp-pages-'));
    writeFileSync(join(dir, 'parent.json'), JSON.stringify({ blocks: [{ id: 'pb', type: 'page', data: { pageId: 'child' } }] }));
    writeFileSync(join(dir, 'child.json'), JSON.stringify({ blocks: [], title: 'Old' }));
  });

  afterEach(async () => {
    await mcp.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const openParent = async (): Promise<string> =>
    (await mcp.dispatch('blok_open', { documentId: 'parent', write: true }, caller)).structuredContent.handle as string;

  it('renames another page by writing its title into that page document', async () => {
    mcp = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir }, pageTitles: 'page-map' });
    const outcome = await mcp.dispatch('blok_execute', { handle: await openParent(), commands: [{ name: 'page.rename', args: { id: 'pb', title: 'New name' } }] }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: true, results: [{ pageId: 'child', applied: true }] });
    expect(JSON.parse(readFileSync(join(dir, 'child.json'), 'utf-8')).title).toBe('New name');
  });

  it('is unavailable without page-map', async () => {
    mcp = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir } });
    const outcome = await mcp.dispatch('blok_execute', { handle: await openParent(), commands: [{ name: 'page.rename', args: { id: 'pb', title: 'x' } }] }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE', details: { reason: 'service' } } });
    expect(JSON.stringify(mcp.tools.find((tool) => tool.name === 'blok_execute')?.inputSchema)).not.toContain('"page.rename"');
  });

  it('runs the authorize check on the target page', async () => {
    mcp = assembleMcp({
      transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir }, pageTitles: 'page-map',
      authorize: async (_principal, documentId) => documentId !== 'child',
    });
    const outcome = await mcp.dispatch('blok_execute', { handle: await openParent(), commands: [{ name: 'page.rename', args: { id: 'pb', title: 'x' } }] }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', details: { pageId: 'child' } } });
    expect(JSON.parse(readFileSync(join(dir, 'child.json'), 'utf-8')).title).toBe('Old');
  });
});
```

`page.rename`'s args (`{ id, title }`: 02 Task 49's `{ title }` plus the core-added `id`) and result (`{ pageId, applied: true }`, 01 Task 17's `createPageMapBackend`) are settled names. The backend takes the BLOCK id (02's `PageBackendService`, 02 Task 12) and reads the block's `data.pageId` itself. The error detail `pageId` is 01's.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/mcp/page-titles.test.ts`
Expected: FAIL. `pageBackend` is in the contract's `services` (Task 5), but `portsFor` gives no `openPageDocument`, so 01's session builds no `pageBackend` object (01 Task 17 builds it only from `pageTitles: 'page-map'` plus the port) and the target page is never written.

- [ ] **Step 3: Write minimal implementation**

`src/mcp/page-titles.ts`:

```ts
import type { AgentPorts, AgentSession } from '../shared/agent';
import type { Caller, DispatcherDeps } from './dispatcher';

/**
 * Headless page.rename / page.setIcon: open the target page's own document
 * with the same opener (mode, authorize, tickets) as blok_open.
 */
export const createOpenPageDocument = (deps: { open: DispatcherDeps['open']; caller: Caller }): NonNullable<AgentPorts['openPageDocument']> =>
  async (pageId, actor) => {
    const session = await deps.open({ documentId: pageId, mode: 'auto', write: true }, deps.caller);
    const agent: AgentSession & { close(): void } = {
      id: `page:${pageId}`,
      actor,
      read: (args) => session.read(args ?? {}),
      describe: (query) => session.describe(query ?? {}),
      execute: (batch) => session.execute(batch),
      log: () => [],
      close: () => {
        // Live: waits for nothing more (execute already waited for acks); stored: no-op.
        void session.close('closed').catch((error: unknown) => console.error('blok-mcp: closing a page target failed', error));
      },
    };

    return agent;
  };
```

`src/mcp/server.ts`: `portsFor` needs the opener, and the opener needs `portsFor`. Break the cycle with a late-bound reference:

```ts
import { createOpenPageDocument } from './page-titles';
// ...
  const late: { open: DispatcherDeps['open'] | null } = { open: null };
  const portsFor = (caller: Caller): AgentPorts => createHeadlessPorts({
    sanitizeFor: (type) => contracts.runtimes.get(type)?.sanitize,
    richTextFieldsFor: contracts.richTextFieldsFor,
    ...((options.pageTitles ?? DEFAULTS.pageTitles) === 'page-map'
      ? {
        openPageDocument: createOpenPageDocument({
          open: (request, who) => {
            if (late.open === null) {
              throw new Error('opener not ready');
            }

            return late.open(request, who);
          },
          caller,
        }),
      }
      : {}),
  });
  // ...createOpenLive (pass `pageTitles: options.pageTitles`) and createOpener as before, then:
  late.open = opener.open;
```

If an error thrown from the target session does not arrive with `details.pageId`, that is 01's executor path (01 §3.13 B step 4); file it against plan 01 rather than adding it here.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/mcp/page-titles.test.ts`, then `yarn test test/unit/mcp/stored-e2e.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/mcp/page-titles.ts src/mcp/server.ts test/unit/mcp/page-titles.test.ts
git add src/mcp/page-titles.ts src/mcp/server.ts test/unit/mcp/page-titles.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): opt-in headless page.rename and page.setIcon through the page map" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Checkpoint 5

- [ ] `yarn test test/unit/mcp/page-titles.test.ts`, `contract`, `stored-e2e`, `open-live`, each on its own.
- [ ] `NODE_OPTIONS=--max-old-space-size=8192 yarn lint:types`.
- [ ] `git pull --rebase && git push`; `git status` up to date.

---

## Phase 6 — Packaging, docs, E2E

### Task 27: Published types and their drift guard

**Files:**
- Create: `packages/mcp/types/index.d.ts`, `test/unit/mcp/public-types.test.ts`
- Modify: `test/unit/mcp/bin.test.ts` (the built bundle exports `createBlokMcpServer`)

**Interfaces:**
- Consumes: internal `BlokMcpOptions` (`src/mcp/options.ts`), `AgentActor` (01, `types/agent.d.ts`), `ManifestOverrides`, `BlokCustomToolsFile` (02, `types/tool-manifest.d.ts`).
- Produces: `@bloklabs/mcp` types: `BlokMcpOptions`, `createBlokMcpServer`, and hand copies `AgentActor`, `ManifestOverrides`, `BlokCustomToolsFile` (published-types law: no import from `src/`, and no import from `@bloklabs/core` either, because `@bloklabs/mcp` has no core peer).

`BlokCustomToolsFile.blocks[].description` and `.statics` are typed `Record<string, unknown>` in the copy: their full types live in core's `types/`, and pulling them in would need a core dependency. The drift test below checks the copy accepts every valid core value (core ⊆ copy), which is the direction a consumer relies on.

- [ ] **Step 1: Write the failing test**

`test/unit/mcp/public-types.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type * as Public from '../../../packages/mcp/types/index';
import type { BlokMcpOptions as InternalOptions } from '../../../src/mcp/options';
import type { AgentActor } from '../../../types/agent';
import type { BlokCustomToolsFile, ManifestOverrides } from '../../../types/tool-manifest';

/**
 * Compile-time drift guard: `yarn lint:types` fails on any assignment below
 * when a copy in packages/mcp/types drifts from its source.
 */
const actorToPublic = (value: AgentActor): Public.AgentActor => value;
const actorFromPublic = (value: Public.AgentActor): AgentActor => value;
const overridesToPublic = (value: ManifestOverrides): Public.ManifestOverrides => value;
const overridesFromPublic = (value: Public.ManifestOverrides): ManifestOverrides => value;
const customToolsToPublic = (value: BlokCustomToolsFile): Public.BlokCustomToolsFile => value;
const optionsToPublic = (value: InternalOptions): Public.BlokMcpOptions => value;
const optionsFromPublic = (value: Public.BlokMcpOptions): InternalOptions => ({
  ...value,
  ...(value.manifest !== undefined && { manifest: value.manifest as unknown as BlokCustomToolsFile }),
});

describe('@bloklabs/mcp public types', () => {
  it('keeps the compile-time checks referenced', () => {
    expect([actorToPublic, actorFromPublic, overridesToPublic, overridesFromPublic, customToolsToPublic, optionsToPublic, optionsFromPublic])
      .toHaveLength(7);
  });

  it('declares createBlokMcpServer and imports nothing', () => {
    const source = readFileSync(resolve(__dirname, '../../../packages/mcp/types/index.d.ts'), 'utf-8');

    expect(source).toContain('export declare function createBlokMcpServer');
    expect(source).not.toMatch(/\bfrom\s+['"]/);
  });
});
```

Add to `test/unit/mcp/bin.test.ts`:

```ts
  it('the bundle exports createBlokMcpServer', async () => {
    const bundle = (await import(DIST)) as { createBlokMcpServer?: unknown };

    expect(typeof bundle.createBlokMcpServer).toBe('function');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/mcp/public-types.test.ts`
Expected: FAIL, `packages/mcp/types/index.d.ts` not found. (`NODE_OPTIONS=--max-old-space-size=8192 yarn lint:types` also fails on the type-only import.)

- [ ] **Step 3: Write minimal implementation**

`packages/mcp/types/index.d.ts`:

```ts
/**
 * Public types for `@bloklabs/mcp`.
 *
 * Hand-authored: a published `.d.ts` may not reach outside its own tarball.
 * AgentActor, ManifestOverrides and BlokCustomToolsFile are copies of core's;
 * test/unit/mcp/public-types.test.ts fails the type check when they drift.
 */

export interface AgentActor {
  id: string;
  name: string;
  kind: 'agent';
  onBehalfOf?: string;
  color?: string;
}

export type ManifestOverrides = Record<string, { hidden?: boolean; hiddenActions?: string[]; guidance?: string }>;

export interface BlokCustomToolsFile {
  formatVersion: 1;
  blocks: Array<{
    name: string;
    description: Record<string, unknown>;
    statics: Record<string, unknown>;
    /** Object and boolean sanitize rules only. */
    sanitize?: Record<string, unknown>;
  }>;
}

export interface BlokMcpOptions {
  transport: { kind: 'stdio' } | { kind: 'http'; listen: string; public?: boolean };
  auth: { kind: 'none' } | { kind: 'oauth'; issuer: string; audience: string; jwksUrl: string };
  /** Absent: no live mode. */
  sync?: { url: string; origin?: string };
  tickets?: { kind: 'secret'; secret: string } | { kind: 'url'; url: string; hostToken: string };
  authorize?: (principal: string, documentId: string, write: boolean) => Promise<boolean>;
  /** Builds the session's actor. The ticket `user` must equal the returned `id`. */
  agentActor?: (principal: string, clientName: string) => AgentActor;
  source?: { kind: 'endpoint'; url: string; endpointAuth: string; list?: string } | { kind: 'files'; dir: string };
  /** Host custom tool descriptions, as `--manifest <file>` loads them. */
  manifest?: BlokCustomToolsFile;
  /** 'page-map' turns on headless page.rename / page.setIcon. Default off. */
  pageTitles?: 'off' | 'page-map';
  /** Same shape as `--manifest-overrides <file>`. */
  overrides?: ManifestOverrides;
  /** Only for block types missing from the manifest. */
  richTextFields?: Record<string, string[]>;
  /** Default 'envelope'. */
  schema?: 'envelope' | 'full';
  /** Default 600000 (10 minutes). */
  handleIdleMs?: number;
  /** Default 8. */
  maxHandlesPerPrincipal?: number;
  /** stdio and auth 'none' only: who the caller is. Default 'local'. */
  principal?: string;
}

export declare function createBlokMcpServer(options: BlokMcpOptions): { start(): Promise<void>; stop(): Promise<void> };
```

If `optionsToPublic` fails because the internal `manifest` type is wider than the copy, that is the drift the guard exists for: narrow the copy only if core's type really changed, else fix the internal type.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/mcp/public-types.test.ts`, `yarn test test/unit/architecture/published-types-no-src-refs.test.ts`, `yarn build:mcp && yarn test test/unit/mcp/bin.test.ts`, `NODE_OPTIONS=--max-old-space-size=8192 yarn lint:types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint test/unit/mcp/public-types.test.ts test/unit/mcp/bin.test.ts
git add packages/mcp/types/index.d.ts test/unit/mcp/public-types.test.ts test/unit/mcp/bin.test.ts
git diff --cached --name-only
git commit -m "feat(mcp): hand-authored public types with a drift guard" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 28: README and the flag-coverage guard

**Files:**
- Create: `packages/mcp/README.md`, `test/unit/mcp/readme.test.ts`

**Interfaces:**
- Consumes: `src/mcp/config.ts` (flag and env names).
- Produces: user docs. A test fails when a flag or env var the parser reads is missing from the README.

README sections (short, simple language; one idea per sentence):
1. What it is: the six tools; live rooms vs stored documents; "agents write rich text with commands, never Markdown or HTML in block data".
2. Install and run locally: `npx @bloklabs/mcp --source files:./docs`; Claude Code and Claude Desktop `mcpServers` JSON with `command: "npx"`, `args: ["@bloklabs/mcp", "--source", "files:/abs/path"]`.
3. Live rooms: `--sync-url`, `--origin` (why a backend sends the app's origin: ticket mode checks `Origin` on every client, `SyncHandshake.cs:113-125`; the ticket is what authenticates), `BLOK_SECRET` vs `--ticket-url` + `BLOK_MCP_HOST_TOKEN`; the ticket `user` must equal the agent's `actorId`; durability (`acknowledged` on a journal, `best-effort` without); `blok_close` reports `hostRecordLags`.
4. Stored documents: `--source endpoint:<url>` reuses the doc endpoint contract; `BLOK_DOC_ENDPOINT_AUTH`; answer stale PUTs with 409 or saves are last-writer-wins; `--source-list` route contract (`GET ?query=&cursor=&limit=` → `{ documents: [{ id, title? }], nextCursor? }`); `files` source: id rules, atomic writes, hash check, the unlocked check-then-rename window; stored mode is refused when `--sync-url` is set.
5. Hosted: `--http`, `--public`, `--auth oauth` + issuer/audience/JWKS, scopes `blok.read` / `blok.write`, Protected Resource Metadata path, loopback-only `Origin`, sticky routing on `Mcp-Param-Blok-Handle`, single instance for clients that do not mirror `x-mcp-header`.
6. Host duties: `IBlokAuthorization` sees the agent's actor id and must map it to the human; `--authorize` module/webhook contract (`{ principal, documentId, write }` → `{ allowed }`, fails closed); `--page-titles page-map` works only if the host reads titles from each page document's title.
7. Custom tools: `--manifest` (`BlokCustomToolsFile`), `--manifest-overrides`, `--rich-text-fields`; custom action handlers do not run here.
8. Limits: no live undo; no uploads (media by URL); no Docker image; handles expire after 10 minutes idle; 8 per principal.
9. Versions: upgrade `@bloklabs/core`, `@bloklabs/server` and `@bloklabs/mcp` together (room format; `unsupported-format` → `VERSION_SKEW`).

- [ ] **Step 1: Write the failing test**

`test/unit/mcp/readme.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');

describe('@bloklabs/mcp README', () => {
  const config = readFileSync(resolve(ROOT, 'src/mcp/config.ts'), 'utf-8');
  const readme = readFileSync(resolve(ROOT, 'packages/mcp/README.md'), 'utf-8');
  const flags = [...new Set([...config.matchAll(/'(--[a-z-]+)'/g)].map((match) => match[1]))];
  const envs = [...new Set([...config.matchAll(/env\.([A-Z_]+)/g)].map((match) => match[1]))];

  it('finds the parser names (non-vacuity)', () => {
    expect(flags.length).toBeGreaterThan(15);
    expect(envs).toContain('BLOK_SECRET');
  });

  it.each(flags)('documents %s', (flag) => {
    expect(readme).toContain(flag);
  });

  it.each(envs)('documents %s', (env) => {
    expect(readme).toContain(env);
  });

  it('states the version lockstep and the Markdown rule', () => {
    expect(readme).toMatch(/@bloklabs\/core.*@bloklabs\/server|@bloklabs\/server.*@bloklabs\/core/s);
    expect(readme).toMatch(/never.*Markdown/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/mcp/readme.test.ts`
Expected: FAIL, README not found.

- [ ] **Step 3: Write `packages/mcp/README.md`** with the nine sections above. Every flag and env var in `src/mcp/config.ts` appears in a table: flag, env var, default, what it does.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/mcp/readme.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint test/unit/mcp/readme.test.ts
git add packages/mcp/README.md test/unit/mcp/readme.test.ts
git diff --cached --name-only
git commit -m "docs(mcp): README for @bloklabs/mcp with a flag-coverage guard" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

The release note is owed, not written here: `/release:release` writes it at release time (repo practice; see the "release note owed" entries in memory). It must list, per D4: `@bloklabs/mcp` and `blok-mcp`, the flags, `createBlokMcpServer`, and the awareness fields `agent` and `agentCursor`. Nothing is breaking.

---

### Task 29: E2E: a browser tab sees the agent

**Files:**
- Create: `test/playwright/tests/agent/mcp-participant.spec.ts`

**Interfaces:**
- Consumes: the built C# host (`BLOK_CONFORMANCE_SERVER`, as Task 21), `startServer` (`run-against.ts`), `blokTicket`, Vite `createServer` the way `test/playwright/tests/tools/page-real-host.spec.ts:28-46` boots the playground, `assembleMcp`; 03's browser drawing of `agent` / `agentCursor` (cross-plan).
- Produces: the browser-side proof that a human sees the agent's blocks and its participant.

Facts to confirm by reading before Step 1 (all **unverified** today; each changes one line):
1. The playground joins a room only when `__BLOK_DEV_BACKEND__` is true (`index.html:1897`), uses `DEV_SERVER_URL = 'http://127.0.0.1:4000'` (`index.html:1886`) and `VITE_BLOK_TICKET_URL` (`index.html:1879`). Find where `__BLOK_DEV_BACKEND__` is defined (grep `vite.config.mjs`, `scripts/dev.mjs`) and how to set it for a programmatic Vite boot without editing `vite.config.mjs` (protected).
2. What the playground's ticket request looks like (`playgroundTicketUrl`, `index.html`), so this spec's mint answers it with `{ ticket }`.
3. The accessible name of a presence face (`buildPresenceFace`, `index.html`), for a role or title locator.

- [ ] **Step 1: Write the spec**

```ts
import { createServer as createHttpServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { blokTicket } from '../../../../packages/server/src/ticket';
import { assembleMcp, type AssembledMcp } from '../../../../src/mcp/server';
import { startDocEndpoint } from '../../../unit/server-conformance/doc-endpoint';
import { startServer, type RunningServer } from '../../../unit/server-conformance/run-against';

const ROOT = resolve(__dirname, '../../../..');
const SECRET = 'mcp-e2e-secret-0123456789abcdefghijkl';
const DOC = 'mcp-e2e';
const SYNC_PORT = 4000;   // the playground's fixed DEV_SERVER_URL

test.skip(process.env.BLOK_CONFORMANCE_SERVER === undefined, 'needs the built C# host (scripts/test-server-conformance.mjs builds it)');
test.describe.configure({ mode: 'serial' });

let vite: ViteDevServer;
let viteUrl: string;
let mint: Server;
let room: RunningServer;
let endpoint: Awaited<ReturnType<typeof startDocEndpoint>>;
let collabDir: string;
let cacheDir: string;
let mcp: AssembledMcp;

test.beforeAll(async () => {
  cacheDir = mkdtempSync(join(tmpdir(), 'blok-vite-'));
  collabDir = mkdtempSync(join(tmpdir(), 'blok-mcp-e2e-'));
  mint = createHttpServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const doc = url.searchParams.get('doc') ?? DOC;

    response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    response.end(JSON.stringify({ ticket: blokTicket(SECRET, { user: 'e2e-human', doc, write: true, ttlSeconds: 600 }) }));
  });
  await new Promise<void>((done) => mint.listen(0, '127.0.0.1', done));
  const mintUrl = `http://127.0.0.1:${(mint.address() as { port: number }).port}/ticket`;

  process.env.VITE_BLOK_TICKET_URL = mintUrl;
  vite = await createServer({
    root: ROOT, logLevel: 'error', cacheDir,
    server: { host: '127.0.0.1', port: 0, open: false, hmr: false },
    // Fact 1: set the dev-backend flag here once its define name is confirmed.
    define: { __BLOK_DEV_BACKEND__: 'true' },
  });
  await vite.listen();
  viteUrl = `http://127.0.0.1:${(vite.httpServer?.address() as { port: number }).port}`;
  endpoint = await startDocEndpoint();
  room = await startServer({
    args: [
      '--listen', `127.0.0.1:${SYNC_PORT}`, '--auth', 'ticket', '--rate-limit', '0', '--storage-dir', '',
      '--collab', '--collab-journal', '--collab-dir', collabDir, '--doc-endpoint', endpoint.url, '--allow-origin', viteUrl,
    ],
    env: { BLOK_SECRET: SECRET },
  });
  mcp = assembleMcp({
    transport: { kind: 'stdio' }, auth: { kind: 'none' },
    sync: { url: `ws://127.0.0.1:${SYNC_PORT}/sync`, origin: viteUrl },
    tickets: { kind: 'secret', secret: SECRET },
  });
});

test.afterAll(async () => {
  await mcp?.stop();
  await room?.stop();
  await endpoint?.stop();
  await vite?.close();
  await new Promise<void>((done) => mint.close(() => done()));
  rmSync(collabDir, { recursive: true, force: true });
  rmSync(cacheDir, { recursive: true, force: true });
});

test('the human sees the agent block and the agent participant', async ({ page }) => {
  await page.goto(`${viteUrl}/editor?collab=${DOC}&name=Alice`);
  await expect(page.getByRole('textbox').first()).toBeVisible();

  const caller = { principal: 'alice', clientName: 'claude-code', scopes: null };
  const handle = (await mcp.dispatch('blok_open', { documentId: DOC, write: true }, caller)).structuredContent.handle;
  const executed = await mcp.dispatch('blok_execute', {
    handle,
    commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'Hello from the agent' } } }],
  }, caller);

  expect(executed.structuredContent).toMatchObject({ ok: true });
  await expect(page.getByText('Hello from the agent')).toBeVisible();
  // Fact 3: the presence face's accessible name.
  await expect(page.getByTitle(/claude-code \(for alice\)/)).toBeVisible();

  await mcp.dispatch('blok_close', { handle }, caller);
  await expect(page.getByTitle(/claude-code \(for alice\)/)).toHaveCount(0);
});
```

If port 4000 is busy (a `yarn serve` is running), the test fails in `beforeAll` with the server's bind error; stop the other session's playground first (do not kill it if it is in use; ask its owner).

- [ ] **Step 2: Run it**

Run: `node scripts/test-server-conformance.mjs --test-name-pattern "^$"` is not suitable (it runs vitest). Build the host the same way, then: `BLOK_CONFORMANCE_SERVER=<path from that build> yarn e2e test/playwright/tests/agent/mcp-participant.spec.ts --project=chromium`.
Expected: PASS. Before 03 lands its agent drawing, the participant assertion may fail; the block assertion must pass.

Memory note: `yarn e2e` builds first; a hook timeout means a slow load, not a flake (`e2e-hook-timeout-means-load-not-flake.md`). Confirm the spec is routed to a project (`e2e-project-routing-silent-no-match.md`): a spec under `test/playwright/tests/agent/` must match a project's `testMatch`.

- [ ] **Step 3: Commit**

```bash
npx eslint test/playwright/tests/agent/mcp-participant.spec.ts
git add test/playwright/tests/agent/mcp-participant.spec.ts
git diff --cached --name-only
git commit -m "test(mcp): browser sees the MCP agent's block and participant" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Final checkpoint

- [ ] Run every test file this plan added or changed, one at a time (memory: a multi-path vitest run can skip files): all of `test/unit/mcp/*.test.ts`, `test/unit/architecture/mcp-tools-from-renderer-law.test.ts`, `view-entry-law.test.ts`, `published-types-no-src-refs.test.ts`, `test/unit/components/modules/collaboration/tracking-outbox.test.ts`, `headless-session.test.ts`, `headless-offline-page.test.ts`, `provider.test.ts`, `test/unit/scripts/release-manifest.test.ts`, `build-all.test.ts`, `test-server-conformance.test.ts`.
- [ ] `yarn build:mcp && yarn test test/unit/mcp/bin.test.ts`.
- [ ] Conformance: `node scripts/test-server-conformance.mjs` (full list, now including `mcp-agent-participant.test.ts`).
- [ ] E2E: Task 29's command.
- [ ] Lint changed files: `npx eslint $(git diff --name-only origin/main -- '*.ts' '*.mjs')`.
- [ ] Type check: `NODE_OPTIONS=--max-old-space-size=8192 yarn lint:types`.
- [ ] Final gate per `CLAUDE.md` "Landing the Plane": `yarn lint` and `yarn test`. (Memory `run-only-related-tests.md` says the user prefers related tests over a full run; `CLAUDE.md` makes the full run the final gate. Follow `CLAUDE.md`; if the full run exceeds the time box, report which files ran.)
- [ ] `git pull --rebase && git push`; `git status` says "up to date with origin".
- [ ] Remove any worktree used, per the global worktree rule.
- [ ] Tell the user: release note owed (D4 list above); nothing breaking.

---

## Self-review

**Spec coverage (04 §1 success criteria → tasks):**

1. Open / read / execute / close with MCP tools only → Tasks 6, 8, 9, 13, 14.
2. Agent is its own participant; edits as remote edits; formatted `Y.XmlText`; moves keep identity → Tasks 17–21 (conformance cases 1 and 2), 29.
3. `delivery.durable: true` only after every row is acked → Tasks 16, 18, 21.
4. Stored save never overwrites a newer version when the host answers 409 → Tasks 11, 12, 14.
5. No stored write next to a sync URL → Task 13 (`STORED_WRITE_FORBIDDEN`), Task 20 test.
6. Core tools are renderer output; law test → Task 6.
7. stdio with no network; Streamable HTTP with OAuth → Tasks 3, 9, 24, 25.
8. `agentCursor` visible to peers → Tasks 19, 21.
9. `doc.setTitle` / `doc.setIcon` in both modes → Task 14 (stored, via 01), live via 01's `StoreApplier` (`writePageField`) exercised through Task 20's live handle; a live title case belongs in 01's StoreApplier tests. Headless `page.rename` → Task 26.

Spec §3.3 handles (128 bits, idle, cap, principal) → Task 7. §3.4 tools, results, descriptions (idle expiry, "never Markdown") → Tasks 6, 8, 9. §3.5 identity, ticket user = actor id → Tasks 9, 22; presence → Task 19; live atomicity / `APPLY_FAILED` → Task 18; room events table → Task 18; undo unavailable → Tasks 5, 20. §3.6 sources, save-per-batch, conflict, undo → Tasks 10–14. §3.7 stdout law, bind rules, sticky header → Tasks 3, 4, 6, 25. §3.8 auth layers, scopes, `secret` only over stdio without authorize, `ticketUrl` → Tasks 8, 22–25. §3.9 error model → Tasks 2, 8. §3.10 deployment → Tasks 1, 9, 25, 28. §4 public surface → Tasks 1, 27, 28. §6 tests → every task; the spec's law items 1–4 → Task 6, Task 3, the existing law (Task 27 check), and 01's view-entry exception.

**Gaps and deviations (stated, not hidden):**
- `OutputData.page` (spec) → `OutputData.title` / `icon` (01 D-1, verified in `types/data-formats/output-data.d.ts`).
- The view-entry law change is 01's Task 19; this plan relies on it.
- A missing `blok.write` scope is a `FORBIDDEN` tool error, not an HTTP 403 (SDK per-tool scope challenge unverified).
- Allowed HTTP origins are loopback only; the spec names no allow-list flag.
- `Server` (low-level) is marked deprecated in SDK 2.3.1; it is still the only way to pass renderer JSON through unchanged (Task 9 note).
- MCP tool annotations (`readOnlyHint`) are not added: the spec marks them unverified, and the renderer owns core tool JSON.

**Placeholder scan:** no "TBD"/"TODO". Places that depend on another plan's final names name the single import line to change. Unverified SDK details name the `.d.mts` file to read and the only file to adjust.

**Type consistency:** `HandleSession`, `McpExecuteResult`, `Delivery`, `NO_DELIVERY`, `failedResult` (Task 2) are used unchanged in Tasks 8, 12, 18, 26. `Caller`, `ToolOutcome`, `OpenRequest`, `DispatcherDeps` (Task 8) are used in Tasks 9, 13, 20, 22, 26. `TrackingOutbox` / `BatchDelivery` (Task 16) feed `HeadlessRoom` (Task 17) and `createLiveSession` (Task 18). `AssembleDeps` grows in Task 20 (`liveSocketFactory`, `liveSyncTimeoutMs`) and is used by Task 20's test only.
