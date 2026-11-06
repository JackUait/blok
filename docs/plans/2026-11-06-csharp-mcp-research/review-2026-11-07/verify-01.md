# Verification of 01-node-mcp-spec.md

Repo `/Users/jackuait/Packages/blok`, HEAD `a626c28f`. `git diff --stat 07b2326d HEAD -- src packages/mcp test/unit/mcp` is empty and `git status --short` on those paths is empty, so the code is the spec's. Read-only. Every verdict below is from opening the cited code or running a probe in `scratchpad/verify-node/` (esbuild-bundled scripts against `src/mcp`, Node 24.13.0). "Code" = read the source. "Measured" = ran it.

## Summary of non-CONFIRMED items

| # | Spec claim | Verdict | Correction |
|---|---|---|---|
| A | §9 "40 files, 10,428 lines" | WRONG | 39 files (`find test/unit/mcp -type f`), 10,428 lines. The 39 names match the spec's classification lists exactly. |
| B | §2.2 tools array sizes "mixed 56,594 B; envelope 33,645 B; full 370,093 B" | PARTLY | Those are `JSON.stringify(tools, null, 2)` sizes (measured identical). Compact wire JSON is 22,089 / 14,182 / 112,225 bytes. Label them. |
| C | §2.2 / Open items: whether `reason:'host'` is reachable | Resolved: UNREACHABLE today | `unavailableCommands` is EMPTY for all 32 combos of pageTitles × createsPages × versionHistory × uploadsFiles × comments (measured, no manifest). With a custom manifest: by reading only — every `where.runtime` test in `src` (grep: `tool-manifest.ts:385,423,434,534-535`) compares to `'editor'` or looks up a table where `node` and `node-live` have the same value. Stored and live contracts get identical inputs (`contract.ts:41-54`) and `node`/`node-live` are treated the same everywhere in `tool-manifest.ts` (`PREPARES_INSERT` :376-378, `UNDO_RUNNERS` :392, `toolAvailability` :419-438 compares only to `'editor'`). The 101 commands of the two contracts are byte-identical (measured). So the schema mismatch is latent, not live. Keep `'host'` out or add it to the enum; either is parity-safe today. |
| D | Open item: exit code when `runCli` re-throws | Resolved | A top-level-await rejection exits with code 1 on Node 24.13 (measured with a 1-line module). |
| E | §1.1 `packages/mcp/dist/mcp.mjs` is 1,886,518 bytes | PARTLY | Size is right, but the file is dated Oct 19 and `git log --since=2026-10-19 -- src/mcp` has 53 commits (1,494 under `src`). It is a stale local build, not the size of the current source. |
| F | §2.4 blok_open step 8 (findDocument) | PARTLY (omission) | `findDocument` goes through `listDocuments`, so a query that matches nothing re-lists everything and the blok_open answer carries `queryMatched:false` (measured: `{"documents":[…],"nextCursor":null,"supported":true,"queryMatched":false}`). |
| G | §2.3 modelAnswer "refs, changed and warnings are dropped when empty" | PARTLY | Also each EMPTY `changed.*` sub-list is dropped on its own (`cappedChanged`, `model-answer.ts:37-41`). Measured: `"changed":{"created":["…"]}` with no `updated/moved/removed`. |
| H | §7.1 createPage | PARTLY (omission) | Missing branches: stored with no source → `SOURCE_UNAVAILABLE` "No document source is configured, so no page document can be created." (`opener.ts:131`); live without openLive → `INVALID_ARGS` (`opener.ts:151`). |
| I | §2.7 `APPROVAL_REQUIRED` reason `no-channel` only when no approver | PARTLY | Also when the key is already in the `approved` set, or asks reached `MAX_ASKS` (`approval.ts:184-186`). I did not read how long `approved` lives. |
| J | §8.2 "Re-wraps (`opener.ts:142`, `page-titles.ts:21-23`, `open-live.ts:56`) copy the original error, flag included" | PARTLY | `opener.ts:142` and `page-titles.ts:21-23` spread `agentError` (flag copied). `open-live.ts:56` builds `new McpSurfaceError(code, message, details)`, which RECOMPUTES `retryable` from the shell set. Same for `live-session.ts:166` (read after an end). Same values today because `terminalToError` already uses `surfaceError`, but a port must recompute there, not copy. |

## Important omissions (not in the spec)

1. **Ticket-URL mode refuses non-ASCII ids (Node bug a port must decide on).** `readTicketClaims` decodes the payload with `atob` (Latin-1), not UTF-8 (`access-pass.ts:67-81`). Measured: a payload with `doc:'документ'` decodes to `Ð´Ð¾…`, so `claims.doc !== documentId` and `tickets.ts:81` throws `FORBIDDEN`. Any non-ASCII `documentId`, or a non-ASCII principal (it is inside `actorId = agent:<principal>:<client>`), always fails in `--ticket-url` mode. A C# port that decodes UTF-8 correctly would diverge. Secret mode is unaffected (it signs, never decodes).
2. **Live `contractRevision` is the LIVE contract's revision.** `live-session.ts:159` uses `input.contract.revision` (live), stored uses the stored one (`stored-session.ts:50`). Measured: stored `ddb44d3e`, live `484763e1`. tools/list is rendered from the stored contract (`server.ts:136`). A port must keep two revisions.
3. **Protocol negotiation fallback.** `initialize` with an unknown version (`2099-01-01`) is answered with `2025-11-25` (measured). `2024-10-07` and `2025-11-25` are echoed (measured).
4. **2026-07-28 era over HTTP differs on the wire** (measured): response is `content-type: application/json` (not SSE), result has `"resultType":"complete"` and `"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"blok-mcp","version":…}}`. The SDK rejects a modern request whose `_meta` lacks `clientCapabilities` with 400 / -32602. A modern `tools/call` WITHOUT the `Mcp-Param-Blok-Handle` header was accepted, and one whose header (`y`) DISAGREES with `arguments.handle` (`x`) was accepted too and acted on the argument; same on the 2025 era (all measured). So the header is advisory only. The modern era does require an `Mcp-Method` header: `server/discover` without it got 400 / -32020 "the request headers and body disagree" (measured). The SDK also answers `ping` (measured) and `server/discover`; a port must provide these.
5. **Empty env vars count as set** for `BLOK_MCP_HTTP`, `BLOK_SYNC_URL`, `BLOK_MCP_ORIGIN`, `BLOK_TICKET_URL`, `BLOK_RICH_TEXT_FIELDS` (`flag ?? env`, `config.ts:182-186`). Measured: `BLOK_MCP_HTTP=''` → `transport:{kind:'http',listen:''}`; `BLOK_SYNC_URL=''` → `sync:{url:''}`. Only `BLOK_SECRET` and `BLOK_MCP_HOST_TOKEN` treat `''` as absent.
6. **`positiveInt` uses JS `Number()`**: `0x10` → 16, `1e3` → 1000, `" 7 "` → 7 are accepted (measured). A C# `int.Parse` port would reject them. The spec names `Number(raw)` but not these consequences.
7. **`--source-list` is always parsed**, so `--source files:x --source-list` (no value) fails "--source-list needs a value" even though files ignores it (measured).
8. **Lenient decoders.** `Buffer.from(x,'base64')` (uploads `decodeBase64`, `uploads.ts:18`) and `'base64url'` (OAuth parts, `oauth.ts:34`) skip invalid characters: `"aGVsbG8*!!"` decodes to `hello` (measured). .NET strict decoders would differ (C# side unverified).
9. **Files source BOM.** A file starting with a UTF-8 BOM fails `JSON.parse` → `SOURCE_UNAVAILABLE "<id>.json is not valid JSON."` (measured BOM behaviour of JSON.parse). Non-ENOENT read errors give `SOURCE_UNAVAILABLE "Cannot read <id>.json."` (`files.ts:161`) — not in §6.2.
10. **Saved-file bytes, Node side (measured).** `JSON.stringify(doc,null,2)+"\n"`, raw UTF-8 for `é`, U+2028 (e2 80 a8), astral emoji, and `<`/`>` unescaped. File hash equals `savedVersion` (measured `bf075f50…`). This is the golden a C# writer must match; the C# default encoder's behaviour is unverified here.
11. (Moved to row J.)
12. **Version history uses global `fetch`**, not an injectable one, and its `ws(s):`→`http(s):` swap is case-insensitive (`version-history.ts:55,59`).
13. **Authorize webhook detection is case-sensitive** (`/^https?:\/\//`, `authorize.ts:28`): `HTTP://…` is treated as a module path.

## Load-bearing claims

### 1. Tool schemas, outputs, prompts, instructions — CONFIRMED
- Order and names: measured `blok_list_documents,blok_open,blok_close,blok_read,blok_describe,blok_execute` (`tools.ts:51-148`).
- `blok_list_documents`, `blok_open`, `blok_close` input/output schemas match `tools.ts:52-146` verbatim, incl. `reason` enum `['runtime','service']` at `:121`.
- `blok_read` and `blok_describe` inputs: measured, byte-identical to the spec's JSON.
- `blok_execute`: mixed has 10 `oneOf` branches = 9 full (`block.convert, block.delete, block.insert, block.move, doc.setIcon, doc.setTitle, markdown.insert, text.format, text.replace`) + envelope with 79 names; `$defs` keys `block_insert__insertSpec,marks,position,range,parentId,id`; envelope schema has 88 names, required `["name","args"]` (all measured). No `additionalProperties:false` on execute input (`render-tools.ts:105-112`) — consistent with spec.
- Outputs: `blok_read` success branch `{type:'object'}` (measured); `blok_execute` uses `EXECUTE_OUTPUT_SCHEMA` not `orError` (`render-tools.ts:233-242`); `orError` and `AGENT_ERROR_SCHEMA` match `result-schemas.ts:8-27,112-123`; `DELIVERY_SCHEMA` all required (`:47-56`).
- Prompts: measured order and args: improve/shorter/longer/simplify/explain have `selection:true`; proofread `selection:false`; summarize/actionItems/continue have no selection arg. Text assembly and errors match `prompts.ts:45-70`, `skills.ts:23,54-58`.
- Instructions: measured 2,328 bytes, last line is the MCP rule; with `page-map` + source the PAGE_CREATE_RULE line sits before it (measured).
- blok_open idle sentence "10 minutes" at default (measured).

### 2. `retryable` depends on the helper — CONFIRMED
- `surfaceError`: `RETRYABLE = {ROOM_SYNC_TIMEOUT, SOURCE_UNAVAILABLE, DOCUMENT_CHANGED, HANDLE_LIMIT}` (`errors.ts:6,14`).
- `failure()`: `RETRYABLE_CODES = {STALE, CONFLICT, CANCELLED}` (`shared/agent/errors.ts:3,25`).
- Grep of every constructor in `src/mcp`: `failure()` is used only for CANCELLED (`dispatcher.ts:215`), APPROVAL_REQUIRED (`sdk-server.ts:100`), PRECONDITION_FAILED/INVALID_ARGS (`local-files.ts:13,75`), INVALID_ARGS (`page-titles.ts:17`) and via `unknownArgument`/`parseToolCall`. Everything else is `surfaceError`.
- Re-wraps `opener.ts:142` and `page-titles.ts:21-23` spread the original `agentError`. `open-live.ts:56` and `live-session.ts:166` recompute via `McpSurfaceError` (row J). The engine's `prepareAt` (`executor.ts:206`) also spreads an `AgentFailure`, so the flag survives into the batch result. Non-AgentFailure errors become `TOOL_ACTION_FAILED`.
- A grep for LITERAL `failure('<CODE>'` calls finds no shell-retryable code raised by the engine via `failure()` except CANCELLED (`executor.ts:394`). The grep misses variable codes and wrapper helpers.

### 3. Validation order, CLI, checkOptionSafety, execute write=true, close after revoke — CONFIRMED
- Dispatcher order matches `dispatcher.ts:178-235,238-262,264-303` exactly (scope before handle for core tools; write type → scope → documentId → query → mode → view for open).
- Measured: unknown arg on blok_open → `INVALID_ARGS "blok_open: unknown field \"zzz\"; accepted fields: documentId, query, mode, write, view"`, `path:"/zzz"`. Extra key on execute → same shape with `commands, expectRevision` plus NO_DELIVERY. `page` on blok_read → `COMMAND_UNAVAILABLE` path `/page`.
- Measured: with an authorize hook that allows only `write=false`, a read-only handle's `blok_execute` of `doc.find` → `FORBIDDEN "You no longer have access to this document."`, and the hook saw `["alice","doc1",true]`; `blok_read` on the same handle passed with `write=false`.
- Measured: revoke, then `blok_close` → `{"error":{"code":"FORBIDDEN",…}}`, handle count stays 1; after re-allowing, close succeeds and count is 0.
- CLI parse order and messages match `config.ts:24-222`; `--http --public` → "--http needs a value" (measured); `--auth=oauth` → the "=" message (measured).
- The spec's untested `--public`-in-a-value-slot case: `--principal --public` (no http) → "--public applies to --http only"; with `--http` it fails "--principal needs a value" (both measured). Because `flag()` refuses any value starting with `--`, a swallowed `--public` can never yield a successful `public:true`.
- `checkOptionSafety` order and messages match `config.ts:250-305`; loopback set is exact/case-sensitive; `hostOf` matches.
- `runCli` order (`index.ts:119-144`) confirmed; note manifest then overrides are read inside the object literal passed to `createBlokMcpServer`, so `checkOptionSafety` runs after both files are read and after the authorize module is imported.

### 4. Files source — CONFIRMED
- `JSON.stringify(document, null, 2)` + `\n` (`files.ts:230`); measured file ends with `\n`, 2-space indent.
- Version = SHA-256 hex of raw bytes on load (`:283`), of the written text after save (`:255`); measured file hash == `savedVersion`.
- In-process queue key = lowercased target path (`:209,290`); lock file `.<lowercased target basename>.lock` (`:83`); `wx`, 25 ms retry, 2 s wait, 30 s stale (`:28-31,82-114`).
- Temp `.<id>.<12 hex>.tmp` in target dir, `wx`, write, `sync`, close, chmod old mode, rename, then best-effort dir fsync, then lock removed (`:230-256,293-297`).
- Ids `^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$` minus Windows device names (`:14-17`). Since ids are ASCII-only, the UTF-16 `.sort()` and `id > cursor` reduce to ordinal ASCII (note for C#: use ordinal, not culture, compare).
- Symlink write-through via `realpath` (`:188-206`); dangling link → "is a link to a missing file".

### 5. HTTP — CONFIRMED (measured on 127.0.0.1)
- GET and DELETE `/mcp` → 405, `allow: POST`, body `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}`.
- `initialize` → 200, `text/event-stream`, no `mcp-session-id`; `tools/call` without initialize → 200 with result. No `access-control-*` headers.
- `Origin: http://LOCALHOST` → 403; `Origin: http://localhost:9` → 200; `Host: 127.0.0.1` (no port) → 403; `Host: LOCALHOST:<port>` → 200.
- Body 4 MiB + 1 → 413 empty; exactly 4 MiB → passes the cap (then 400 parse error). Path `/x` → 404.
- Fresh server per request: `createMcpHandler(ctx => buildSdkServer(...))` (`http.ts:119-131`); SDK doc comment "per-request server factory" (`index.mjs:1069-1072`).

### 6. Protocol versions, `_meta`, header — CONFIRMED
- Measured from `@modelcontextprotocol/server` 2.4.0: `LATEST_PROTOCOL_VERSION=2025-11-25`, supported list exactly as spec; meta keys `io.modelcontextprotocol/clientInfo`, `io.modelcontextprotocol/clientCapabilities`.
- `sdk-server.ts:148-161` reads the envelope, falls back to `getClientVersion()` / `getClientCapabilities()`.
- `MCP_PARAM_HEADER_PREFIX="Mcp-Param-"`, `X_MCP_HEADER_KEY="x-mcp-header"` (`src-DdvbAHrR.mjs:4553-4555`). README `:147`. See omission 4 on enforcement.
- SDK `McpServer` validates input at `mcp-oHn3ureC.mjs:1608` (`validateToolInput`) — Blok bypasses it via `mcp.server.setRequestHandler` (`sdk-server.ts:132-141`). Note it does construct an `McpServer`, then uses its low-level `.server`.

### 7. Tickets and timeouts — CONFIRMED
- HS256, header bytes `{"alg":"HS256","typ":"JWT"}`, payload `{user, doc?, write, exp}`, HMAC over `<b64>.<b64>`, min secret 32 UTF-16 units (`ticket.ts:4,12,45-61`); TTL 1800 (`tickets.ts:10`), refresh margin 30 s (`:11,95`).
- URL mode: 401 → `SOURCE_UNAVAILABLE` (retryable), 403 → `FORBIDDEN`, others as spec (`tickets.ts:55-87`). Accepts any 2xx (`response.ok`).
- Timeouts: endpoint 30 s (`endpoint.ts:7,49`), webhook 10 s (`authorize.ts:8,38`), ticket 10 s (`tickets.ts:13,54`), JWKS 10 s (`oauth.ts:14`), room sync 15 s (`headless-session.ts:62,131`), ack 10 s (`live-session.ts:20`), stop drain 45 s (`server.ts:43`), version history none (`version-history.ts:59`, no signal), authorize module none (`authorize.ts:65-69`).

### 8. `host` reason — see row C. Mismatch is real in the schema, unreachable in practice.

### 9. Line counts — CONFIRMED
- `find src/mcp -name '*.ts' | xargs wc -l` = 35 files / 4,078; every per-file count in §1.2 matches.
- esbuild metafile of `src/mcp/index.ts` (externals `@modelcontextprotocol/*`, `ws`): shell 32 files / 4,046; engine 256 files / 65,365; total 288 / 69,411; npm inlined `lib0` 28, `yjs` 1, `y-protocols` 1, `nanoid` 2 files (spec said "nanoid" with no count).

## Sampled citations (all CONFIRMED unless noted)

1. `errors.ts:23` NO_DELIVERY frozen all-false/null.
2. `errors.ts:39-44` isWriteBatch: known name with `readOnly===false`.
3. `handles.ts:33` 16 random bytes base64url.
4. `handles.ts:37-44` shutting-down then cap check.
5. `handles.ts:79-90` remove deletes before awaiting queue.
6. `handles.ts:92-116` sweep skips busy/recent.
7. `handles.ts:118-127` closeAll marks closed, clears, waits queues.
8. `server.ts:146-156` sweep every `min(idle,30s)`, `unref`.
9. `server.ts:163-164` stillAllowed passes without hook.
10. `server.ts:169-179` blok_open promises tracked.
11. `server.ts:46-55` drain loops until nothing new.
12. `mode.ts:7-22` stored+sync → STORED_WRITE_FORBIDDEN even read-only.
13. `opener.ts:54` authorize on open; `:100-103` list filtered with write=false; `:122` createPage write=true.
14. `opener.ts:149-165` live createPage reads, checks blocks/title/icon, always closes.
15. `stored-session.ts:60-93` read-only check, revision compare, save, stale+reload on error.
16. `stored-session.ts:94` close summary.
17. `live-session.ts:22-31` terminalToError mapping.
18. `live-session.ts:104-150` v1 no ack wait; journal failure latch; fate handling.
19. `live-session.ts:156-158` durability getter.
20. `live-session.ts:173-181` close summary then presence/agent/room.
21. `open-live.ts:41-47` syncUrlFor id rules.
22. `open-live.ts:69-104` revocation latch on first FORBIDDEN.
23. `open-live.ts:125-137` refusedHere.
24. `node-socket.ts:11-19` ws with origin, no-op error listener.
25. `presence.ts:18,37` sha256 first 2 bytes BE; palette `collaboration/presence.ts:105-114` (spec cites 106-115 — off by one, harmless).
26. `presence.ts:75-77` activity once per 60 s, failed send does not count.
27. `version-history.ts:36-48,111-141` pointPath, restore 404/412, If-Match quoting, idempotency key.
28. `local-files.ts:73-118` path checks, O_NOFOLLOW|O_NONBLOCK, nlink, ino/dev, max+1 read.
29. `local-files.ts:45-55` root not a folder → McpConfigError at assemble.
30. `oauth.ts:148-222` order of checks and messages.
31. `oauth.ts:67-145` JWKS TTL/cooldown/in-flight sharing.
32. `http.ts:113-118` bearer gate config; `:152-161` metadata JSON.
33. `endpoint.ts:67-91` load shapes; `:92-122` save; `:125-153` list.
34. `actor.ts:3-14,21-22` safeClientName, defaultAgentActor, presence name.
35. `custom-tools-file.ts:13-58` override keys and messages.
36. `index.ts:76-78` OAuth over stdio error at start; `:64-66` stopped error.
37. `index.ts:102-117` shutdown handlers and exit codes.
38. `bin/blok-mcp.mjs` guard first, then import, then runCli.
39. `stdout-guard.ts:1-9`.
40. `types/agent.d.ts:46-54` code list (spec says 46-55; harmless).
41. `IBlokAgentExecutor.cs` members ExecuteAsync/GetContractAsync/GetRoomContractAsync/OpenSession/ExecuteInRoomAsync; `Blok.Server.csproj:42` Jint 4.17.0; `server-runtime.ts:9,17,722`; case list contains `agentExecute, agentPlanHost, agentPagesNeeded, schema, manifest`.
42. `scripts/build-mcp.mjs:7,31,36-37`.
43. `packages/mcp/types/index.d.ts:40-55,103`.
44. Tests: `sdk-server.test.ts:113,277-285,288-299`; `unlock-elicitation.test.ts:20,110-140`; `http.test.ts:123,175-190`; `bin.test.ts:37-82`; `creation-stamp.test.ts:33-52` — all say what the spec says.
