# Remote live mode: a sync client for the C#, Go and Rust MCP ports

The user decided that remote live mode ships in v1 of all three ports (`00-plan.md` §4). This file covers:

- what the Node MCP sends and receives on the wire;
- what the three servers already have that a client can reuse;
- a design for the client in each language;
- how to prove the ports behave like Node;
- the outbound-network laws each client must pass.

Every claim cites a file. "Code-derived" means it comes from reading code, not from a trace. "Unverified" means no evidence was gathered in this session.

## 0. Short answer

- **Node runs the whole client in JS.** That covers Yjs, the provider state machine, the outbox and awareness. The only native piece is the `ws` socket (`src/mcp/live/node-socket.ts:11-19`).
- **That JS client cannot move into the shared runtime bundle as it stands.** The bundle contains no Yjs. The three runtimes have no timers and no `crypto`. Engines are pooled and live for one call. (§1.10)
- **All three servers already have native Yjs, a two-way wire codec, a Yjs↔JSON converter and the edit translator.** The missing pieces are:
  - a WebSocket *client*;
  - a client-side awareness encoder;
  - the provider state machine;
  - a small amount of bundle work. (§2, §3)
- **Recommendation:** a native client in each language. JS stays the planner, through the same `agentExecute` path `ExecuteInRoom` uses. The test oracle is the existing `mcp-agent-participant` conformance suite, run with a spawned port binary, plus a new scripted room for the failure paths. (§3)

## 1. The client protocol the Node MCP speaks

### 1.1 Who does the work

| Piece | File |
| --- | --- |
| Opens a live handle, ticket revocation, error mapping | `src/mcp/live/open-live.ts:139-190` |
| `ws` socket with Origin | `src/mcp/live/node-socket.ts:11-19` |
| Headless room member: store, outbox, write tap, sync wait | `src/components/modules/collaboration/headless-session.ts:70-238` |
| Provider (state machine, handshake, drain, reconnect) | `src/components/modules/collaboration/provider.ts:288-1686` |
| Wire codec | `src/components/modules/collaboration/sync-wire.ts:103-249`, `wire-encoding.ts` |
| Outbox in memory, operation ids | `src/components/modules/collaboration/operation-store.ts:305-312, 712-715, 885-912` |
| Ack and quarantine tracking | `src/components/modules/collaboration/tracking-outbox.ts` |
| Yjs document and awareness (`yjs` 13.6.33, `y-protocols` 1.0.7) | `src/components/modules/yjs/document-store.ts:1-2, 2584-2600, 2652-2670` |
| Agent writes into the Y doc | `src/components/modules/agent/store-session.ts:19-61`, `store-applier.ts:97-140` |
| Delivery, durability, close summary | `src/mcp/live/live-session.ts` |
| Presence fields | `src/mcp/live/presence.ts` |
| Version history over HTTP | `src/mcp/live/version-history.ts` |
| Ticket minting | `src/mcp/auth/tickets.ts`, `packages/server/src/ticket.ts:45-60` |

The normative wire spec is `packages/server/protocol/blok-sync-v2.md`.

### 1.2 URL

- `<sync.url without trailing slash>/<encodeURIComponent(documentId)>` (`open-live.ts:41-47`).
- `''`, `.` and `..` are refused with `INVALID_ARGS`.
- The version history base is the same URL with `ws(s):` turned into `http(s):`, plus `/history` (`version-history.ts:55`).

### 1.3 Handshake

- **Library.** `new WebSocket(url, protocols, {origin})` from `ws` 8.22.0 (`node-socket.ts:12`). An `error` listener that does nothing keeps the process alive (`:14-16`).
- **Origin.** Sent as the `Origin` header when `--origin` is set (`node_modules/ws/lib/websocket.js:810-815`).
  - The server requires an origin in ticket mode and answers `403 origin not allowed` otherwise (`blok-sync-v2.md` §2.1).
  - Go reads it at `go/internal/collab/synchttp/handshake.go:76`.
- **Subprotocols.** The client offers `blok-sync.v2, blok-sync.v1, <ticket>`.
  - v2 is offered only when the client has an outbox. A headless room always has one (`provider.ts:45-61, 1451-1453`; `headless-session.ts:75,142`).
  - `ws` joins them with `,` and no space. It refuses a token outside its subprotocol regex or a duplicate (`websocket.js:793-807`).
  - The ticket is a JWT made of base64url segments joined by `.`.
- **What the server picks.** The server selects v2 or v1. It never selects the ticket. It must leave both version tokens out when it looks for a ticket (`blok-sync-v2.md` §2).
- **What `ws` accepts back.** `ws` aborts the handshake if the server selects nothing, or selects something that was not offered (`websocket.js:979-994`).
  - So under Node, "selected nothing" is a failed connect, not v1.
  - The provider's comment that "a proxy may select nothing, and that is v1" (`provider.ts:1267-1269`) holds for browsers only.
  - A port should copy Node: no selection fails the connect.
- **Other `ws` defaults Node runs with.** These are not set by Blok (`websocket.js:676-700`):
  - `permessage-deflate` is offered. The Blok servers implement no extensions (`go/internal/ws/ws.go:1-5`), so nothing changes on the wire.
  - `autoPong` is on (`:683, 1265`).
  - `maxPayload` is 100 MiB.
- **Pings.** The server pings every 15 s. A ping with no matching pong within 30 s ends the socket (`blok-sync-v2.md` §2.1). **A native client must answer pings.**
- **Refusals.** Pre-upgrade answers (403/400/429/503) and accept-then-close codes (4400/4401/4403/4503) are tabled in `blok-sync-v2.md` §2.1.

### 1.4 Frames

There is one message per binary WebSocket frame. The codec header is at `sync-wire.ts:11-19`, and the byte layout is pinned by `test/unit/server-conformance/fixtures/sync-frames.json`.

| Type | Layout | Direction (Node client) |
| --- | --- | --- |
| 0/0 SyncStep1 | `[0][0][len][state vector]` | both |
| 0/1 SyncStep2 | `[0][1][len][update]` | in; out only on v1 (`answerResync`, `provider.ts:1129-1158`) |
| 0/2 Update | `[0][2][len][update]` | in; out only on v1 (`hookSeam`, `:493-523`) |
| 1 Awareness | `[1][len][awareness update]` | both |
| 2/0 PermissionDenied | `[2][0][len][utf8]` | in, ignored (`:1206-1209`) |
| 3 QueryAwareness | `[3]` | in; answered with full awareness (`:1203-1205`) |
| 100 Control | `[100][len]{"epoch","format","lineage"}` | in |
| 101 Limits | `[101][len]{"maxMessageBytes"}` | in |
| 102 Operation | `[102][len]{"lineage","operationId"}[len][update]` | out (v2 writes) |
| 103 Acknowledgement | `[103][len]{"lineage","operationId","serverSequence"}` | in |
| 104 Rejection | `[104][len]{"lineage","operationId","code"}` | in |
| 106 Activity | `[106]` | out |
| 107 Identities | `[107][len][json]` | in; the headless room passes no `onVerifiedIdentities`, so it is dropped (`headless-session.ts:138-168`, `provider.ts:1231-1235`) |

The decoder is strict:

- `malformed` and `unknown` frames are dropped (`provider.ts:1524-1529`).
- Frames 102 and 106 arriving from the server are dropped.
- Frames 103, 104 and 107 that arrive before control are dropped.
- All other frames that arrive before control are buffered, up to 64. Past 64 the client tears down and reconnects (`:1537-1558, 1345-1354`).

### 1.5 From connect to "ready"

This order is code-derived. No trace was taken.

1. `openHeadlessRoom` (`headless-session.ts:70-172`):
   - creates the `DocumentStore`;
   - creates an in-memory operation store (`offlineScope: null`, so no IndexedDB; `operation-store.ts:712-715`);
   - wraps it in a `TrackingOutbox`;
   - starts the 15 s sync timeout (`:62, 131`). This is not the provider's 10 s `firstSyncTimer` from step 6;
   - calls `provider.connect()`.
2. `openGeneration` (`provider.ts:1586-1628`):
   - turns awareness on;
   - reports `connecting`;
   - awaits `ticketSource()`. A mint failure schedules a reconnect.
3. `openSocket` (`:1451-1584`):
   - creates the socket;
   - sets the phase to `awaiting-control`;
   - arms the 10 s handshake timer at creation (`:1495-1498`).
4. On `open`, the client sends **SyncStep1**, its own state vector (`:1500-1507`). This is the only frame allowed before control.
5. The server's join sends, in this order (C# `Collab/CollabRoom.cs:435-453`):
   - **Control 100**;
   - **Limits 101**, if configured;
   - **Identities 107**;
   - then it broadcasts QueryAwareness to the room.

   The server answers the client's SyncStep1 with **SyncStep2**, then its own **SyncStep1** (`CollabRoom.cs:2686-2687`).
6. `handleControl` (`provider.ts:1245-1334`):
   - Format ≠ 2 → terminal `unsupported-format`.
   - Lineage ≠ known lineage → relineage.
   - Otherwise it stores the tag and reads `protocol` from the socket's selected subprotocol, then hooks the seam.
   - It sends **Activity 106** (budgeted at one per 60 s across reconnects, `:458-467`).
   - It replays buffered frames.
   - It re-announces awareness, if any exists.
   - If the client is not synced yet, it arms the first-sync timer (10 s).
7. **SyncStep2** applies, then `markSynced` (`:1077-1099`):
   - resets the backoff and counters;
   - reports `connected`;
   - drains.
8. The `connected` status makes the headless room call `operations.recordSession(tag, writeDenied, protocol)`. Outbox rows can only be stamped after this. Then `openHeadlessRoom` resolves (`headless-session.ts:157-167`).
9. On v2, the server's **SyncStep1** goes to `handleResync` (`provider.ts:941-978`):
   - it marks a resync as owed and drains;
   - the outbox is empty, so the client sends one more **SyncStep1**, the residual round (`:790-798`);
   - the next server SyncStep1 is answered by enveloping the residual diff as a 102 only if the diff is longer than 2 bytes (`:951-959`).

   On a fresh agent, nothing goes out. This is one extra SyncStep1 round per connection.
10. `createLiveSession` calls `presence.announce()` (`live-session.ts:79`). This writes the `user` and `agent` awareness fields. Awareness frames are throttled to one per 100 ms and carry only the changed clients (`provider.ts:475-486, 382-403`).

### 1.6 A batch on the wire

1. `live-session.execute` (`live-session.ts:81-151`):
   - checks for an ended room and the read-only latch;
   - records `mark = outbox.appendedCount()`;
   - runs the agent.
2. `StoreApplier.apply` writes every edit, then the `lastEditedAt/By/With` metadata, inside **one** `store.transact(..., 'local')` (`store-applier.ts:105-121`). One transaction gives one Yjs `update` event. That is standard Yjs behaviour and was not traced here.
3. `store.onUpdate` passes only non-remote origins (`document-store.ts:2584-2600`). The headless write tap (`headless-session.ts:176-195`) then:
   - waits for `recordSession`;
   - calls `outbox.appendLocal(update)`, which creates a row with `operationId` = 16 random bytes as lowercase hex (`operation-store.ts:305-312, 885-912`);
   - calls `provider.drain()`.
4. `runDrainPass` (`provider.ts:812-870`) reads the oldest pending row. It skips rows with a stale format or lineage by quarantining them. Then `sendOperation` (`:753-781`):
   - sends **Operation 102**;
   - sets `inFlight` (one operation at a time);
   - arms the **15 s redrive timer**. On expiry it tears down, reconnects and resends the same id and bytes, which is idempotent per `blok-sync-v2.md` §7.2.
   - If a limits frame announced a cap and the framed message is bigger, the row is quarantined as `oversized-update`.
5. **Ack 103** (`:999-1029`):
   - It must name the current lineage.
   - It frees `inFlight`.
   - `onOperationAcknowledged(seq)` fires, then `outbox.acknowledge(id)`, then the next row drains.
   - `TrackingOutbox.noteSequence` pairs the sequence with the ack that follows it (`tracking-outbox.ts:23-24, 43-50`).
6. **Rejection 104** (`provider.ts:1042-1075`):
   - `lineage-mismatch` → relineage.
   - `not-synced` → reconnect and keep the row.
   - Any other code is final: the lineage's pending tail is quarantined with that code as the reason.
7. Back in `live-session` (`:107-150`):
   - `flushAppends()`. If the append failures went up, it latches read-only and returns `APPLY_FAILED` `{stage:'journal'}`.
   - `ids = idsSince(mark)`, then a race between `waitFor(ids, 10 s)` and the room ending.

**Two different ack timers.** Keep them apart in a port:

| Timer | Value | On expiry |
| --- | --- | --- |
| Provider redrive | 15 s (`provider.ts:95`) | Reconnect and resend the same operation |
| MCP delivery wait | 10 s (`live-session.ts:20`) | The batch succeeds with `pending: true` |

**`delivery`:**

| Outcome | Result |
| --- | --- |
| Not a write, or protocol v1 | `NO_DELIVERY` = `{durable:false, pending:false, serverSequence:null, savedVersion:null}` (`errors.ts:23`, `live-session.ts:104-106`) |
| All ids acked | `{durable:true, pending:false, serverSequence:<last id's sequence>, savedVersion:null}` (`:131-135`; last id because acks arrive in order, `tracking-outbox.ts:91, 115-118`) |
| Timeout | `{durable:false, pending:true, serverSequence:null, savedVersion:null}` (`:136-138`) |
| Quarantined `lineage-reset` | `ROOM_RESET` |
| Quarantined `read-only` | latch, then `READ_ONLY` |
| Other quarantine | `REJECTED {rejectionCode}` (`:139-150`) |

**Other durability fields:**

- `durability` is `acknowledged` on v2 and `best-effort` on v1 (`:156-158`).
- `hostRecordLags` is `protocol === 'v2'`, checked at close (`:174`).
- `unsavedBatches` counts the batches whose ids are not all acked (`:41-50`).

**What a write is.** A batch is a write if any command's contract entry has `readOnly === false` (`errors.ts:39-43`).

**Revision.** The live `revision` is `l<count of Y updates seen>`, local to the handle (`store-applier.ts:60-62, 77-79`). It is **not** the journal head that in-process rooms use (`go/blokagent/room.go:64-68`). This matters for §3.

### 1.7 Reconnect, terminal states, timeouts

All references in this section are to `provider.ts`.

- **Backoff:** `1000 · 2^(attempt-1)`, capped at 30 s, with jitter between 0.5 and 1.0 (`:607-617`).
  - A `1008` close counts as 2 attempts.
  - The first `1001` close reconnects after 250 ms.
  - A completed sync resets the attempts.
- **Close codes** (`:1367-1417`):
  - `4400` → terminal `bad-request`.
  - `4403` → terminal `forbidden`.
  - `4409` → relineage.
  - `4401` → reconnect with a fresh ticket the first time, terminal `unauthorized` the second time before a sync.
  - `1009` → remember the largest frame sent; terminal `oversized-update` on the second.
  - Anything else → reconnect.
- **Handshake timeout:** 10 s with no control frame. After 3 in a row since the last sync it is terminal `handshake-timeout`; before that it reconnects (`:1430-1443`).
- **No first sync:** if no SyncStep2 arrives within 10 s after control, the client reconnects (`:1323-1333`).
- **Apply failure:** a doc frame that throws is terminal `apply-failed`. A presence frame that throws is dropped (`:1561-1571, 1169-1175`).
- **Relineage:**
  - quarantine the old lineage's pending rows as `lineage-reset`;
  - `resetForRelineage`, which makes the headless room finish with `{reason:'reset'}`;
  - clear lineage and tag;
  - reconnect through backoff (`:711-745, 685-694`; `headless-session.ts:115-119`).
- **Before the first sync:**
  - `openHeadlessRoom` rejects after 15 s with `HeadlessRoomTimeoutError` → `ROOM_SYNC_TIMEOUT`.
  - A terminal status rejects with `HeadlessRoomTerminalError` → `terminalToError`: `VERSION_SKEW`, `FORBIDDEN` or `SOURCE_UNAVAILABLE` (`headless-session.ts:131,147-153`; `open-live.ts:49-60`; `live-session.ts:22-31`).
- **Ticket revocation:** one `FORBIDDEN` from the ticket source ends the room for the handle. It aborts the open wait at once (`open-live.ts:62-122, 141-158`).
- **Pending rows** live in memory only. They survive reconnects inside one process, not a restart.

### 1.8 Presence (awareness)

**Fields** (`presence.ts`):

| When | Field | Value |
| --- | --- | --- |
| On announce | `user` | `{name, color, id}` |
| On announce | `agent` | `{via:'mcp', onBehalfOf, onBehalfOfName?}` |
| After each successful batch | `activeAt` | now |
| When a block changed | `blockId` | the changed block |
| When a block changed | `agentCursor` | `{actorId, name, color, blockId, field?, start?, end?}` |
| On close | `agentCursor`, `blockId` | `null` |

- `caret` is never written.
- An Activity 106 frame goes out at most once per 60 s (`:75-77`).
- Colour rules are in `01-node-mcp-spec.md` §7.5.

**Encoding** (y-protocols, `node_modules/y-protocols/awareness.js:194-207`):

```
varUint(count) then, per client: varUint(clientID) varUint(clock) varString(JSON.stringify(state))
```

- `clientID` is the Y doc's client id.
- Every `setLocalStateField` bumps the clock and emits `update`.

**Renewal.** y-protocols checks every 3 s and renews the local state when it is 15 s old. Peers drop a state after 30 s (`awareness.js:13, 59-77`). The provider forwards every awareness `update`, renewals included (`provider.ts:525-535`; `document-store.ts` comment at ~2690). **A port must renew too**, or peers prune the agent after 30 s.

### 1.9 Close

This order is code-derived. `live-session.close` (`:173-181`) runs:

1. Compute the summary.
2. `presence.clear()`. This schedules a throttled awareness frame.
3. `agent.close()`.
4. `room.close()` (`headless-session.ts:197-202`):
   - unhook the tap;
   - `provider.destroy()` (`provider.ts:1657-1672`):
     - `announceDeparture()` sends a null-state awareness frame **at once** (`:415-429`);
     - `teardownGeneration(true)` cancels the throttled frame from step 2 (`:557`) and closes with **1000** (`:578-584`);
   - `store.destroy()`;
   - `operations.close()`.

Peers therefore see the departure. The "cursor null" frame never ships.

### 1.10 Version history and tickets (HTTP)

- **History.** `GET <base>[?group=]`, `GET <base>/<lineage>/<seq>`, and `POST <base>/<lineage>/<seq>/restore` with `Blok-Idempotency-Key` and `If-Match`.
  - Every request sends `Authorization: Bearer <ticket>` and `Origin`.
  - A 401 is retried once with a fresh ticket.
  - There is no timeout.
  - Full mapping: `01-node-mcp-spec.md` §7.6 and `version-history.ts:54-143`.
- **Secret mode.** `blokTicket(secret, {user: actorId, doc, write, ttl 1800})`.
  - The header is the fixed string `{"alg":"HS256","typ":"JWT"}`.
  - The payload key order is `user, doc?, write, exp`.
  - Encoding is base64url (`packages/server/src/ticket.ts:12, 45-60`; `tickets.ts:34-41`).
- **URL mode.** `POST config.url` with the host token.
  - It times out after 10 s and refreshes when 30 s from expiry.
  - It checks `user == actorId` and `doc`, and refuses a write ticket on a read-only open (`tickets.ts:43-100`).

### 1.11 Could this JS client run inside the shared runtime bundle?

No, not without new infrastructure in all three hosts:

- **The bundle has no Yjs.** `grep -c 'encodeStateAsUpdate|YMap|ContentDeleted'` on `go/internal/jsruntime/blok-server-runtime.js` gives 0. Its entry, `src/view/server-runtime.ts`, imports no `yjs`.
- **No timers or `crypto`.** `setTimeout`, `getRandomValues` and `crypto` appear nowhere in `go/internal/jsruntime/*.go`, `rust/crates/jsruntime/src/*.rs` or `dotnet/Blok.Server/Runtime/JintBlokRuntime.cs`. The provider depends on timers, and both Yjs client ids and operation ids need randomness.
- **One call per engine.** The runtimes run one `invoke(operation, json)` per pooled engine:
  - Go returns `ErrPending` if a promise is still pending when the call returns (`runtime.go:23`).
  - Jint may replace the engine after a call (`JintBlokRuntime.cs:352`).

  A live client needs a long-lived engine per handle, a host-driven timer and message pump, and a larger bundle. That is a second runtime model, written three times.

Native Yjs already exists in all three languages (§2). So "JS does the CRDT, host does the socket" costs more than "host does the CRDT and socket, JS plans".

## 2. What each server already has

| Need | C# (`packages/server/dotnet/Blok.Server`) | Go (`packages/server/go`) | Rust (`packages/server/rust/crates`) |
| --- | --- | --- | --- |
| Yjs doc: state vector, diff, apply, transact returning update bytes | `Yjs/YDoc.cs:93,107,125,170` | `internal/yjs/doc.go:178,184,215,242` | `yjs/src/doc.rs:236,243,250,283` (in-house, not `yrs`; `yjs/Cargo.toml:9-12`) |
| lib0 varuint/varstring | `Yjs/Lib0Reader.cs`, `Lib0Writer.cs` | `internal/lib0/lib0.go` | `lib0` crate |
| Wire codec, every frame both ways | `Collab/SyncWire.cs:10-78, 155, 243` | `internal/collab/wire/encode.go:17`, `decode.go:24` | `collab-wire/src/encode.rs:21`, `decode.rs:40` |
| Awareness | validate + **removal only** (`SyncWire.cs:1699,1743`) | same (`wire/awareness.go:23,59`) | same (`collab-wire/src/awareness.rs:20,62`) |
| Y doc ↔ blocks JSON | `Collab/CollabDocConverter.cs:115` (`ExportAsync`), `YDocConverter.cs:279,597` | `collab/convert/docconverter.go:124`, `export.go:752,763` | `collab-convert/src/export.rs:792,804`, `docconverter.rs:194` |
| Apply edit ops to a plain doc in **one** transaction | `YDocConverter.ApplyOps(YDoc, ops, input)` (`:400-445`; doc comment: "one update carrying every op") | `collab/convert/apply.go:23` | `collab-convert/src/apply.rs:31` |
| Agent edits → edit ops | `Agent/RoomEditTranslator.cs:15` | `blokagent/translate.go:12` | `blokagent/src/translate.rs:11` |
| Planner run on a doc snapshot | `Agent/BlokAgentExecutor.cs:507-540` (`agentExecute` inside `AgentEditAsync`) | `blokagent/room.go:68` | `blokagent/src/room.rs:122` |
| WebSocket | server only (ASP.NET Core) | **server only**: "the server side of RFC 6455" (`internal/ws/ws.go:1-5`); rejects unmasked frames (`:394,407`); `writeFrame` never masks (`:282-296`) | **server only** (`ws/src/lib.rs:1-5`); rejects unmasked frames (`:524`) |
| Ticket mint (secret mode) | `Tickets/BlokTicket.cs:36,44` (public) | `blokserver/ticket/mint.go:43` (`Mint`, public; corrected in review 2026-11-07, the original row said none) | `blokserver-ticket/src/lib.rs:68` (`mint`) |
| Operator HTTP client (proxy, TLS, no SSRF guard) | `Collab/DocEndpointClient.cs` (pinned) | `internal/dotnet/sockets.go:72` (`NewSocketsTransport`), used by `collab/docendpoint/client.go` | `outbound/src/operator.rs:110-135` (`OperatorClient`), dial at `:326,378` |

Most C# pieces are `internal`. `00-plan.md` §4 settles this with `InternalsVisibleTo("Blok.Server.Mcp")`.

**What none of them have:**

- a WebSocket client handshake and client framing:
  - send `Sec-WebSocket-Key`;
  - check `Sec-WebSocket-Accept`;
  - check the selected subprotocol;
  - mask every write;
  - require unmasked reads;
  - answer pings;
- an awareness state encoder, with clock, 15 s renewal and null-state departure;
- an outbox;
- the provider state machine;
- an HTTP client for the history routes and the ticket URL.

## 3. Recommended design

### 3.1 Shape: native client, JS plans

Each port gets one `LiveRoomClient` per handle, built from four parts.

1. **Socket.**
   - **C#:** `ClientWebSocket`. It needs `Origin` and the subprotocols set before connect. It answers pings itself (.NET behaviour from memory, **unverified** here).
   - **Go and Rust:** add a *client role* to the existing `ws` package. That means the client handshake, masked writes, accepting unmasked reads, and pong (§2). The frame reader, the UTF-8 check and the close handling are shared with the server role.
   - Dial through the operator transport (§4), so proxy and TLS behave like the doc-endpoint client.
2. **Provider state machine.** A port of `provider.ts` limited to what a headless writer uses:
   - phases `connecting → awaiting-control → ready → offline | terminal`;
   - the frame buffer (64);
   - the 10 s handshake and first-sync timers;
   - backoff;
   - the close-code table;
   - relineage;
   - the v2 drain with one operation in flight;
   - the 15 s redrive;
   - the residual round;
   - the limits cap;
   - Activity on handshake.

   Leave out everything that only a browser needs: v1 local sends beyond the residual, multi-tab `onCommitted`, IndexedDB. The headless case never has them (`headless-session.ts:72` uses `offlineScope: null`).
3. **Local doc and outbox.**
   - A native `YDoc` takes the place of `DocumentStore`. SyncStep1 is `EncodeStateVector`. Incoming SyncStep2 and Update frames go to `ApplyUpdate`.
   - The outbox is an in-memory list of `{operationId (16 random bytes hex), lineage, bytes, fate}`, the same shape as `TrackingOutbox`.
4. **Awareness encoder.** It owns the local state, the per-client clock, the 100 ms throttle, the 15 s renewal and the null-state departure. The encoding matches §1.8.

**A batch reuses the in-room path piece by piece, not `ExecuteInRoom` as a whole:**

1. Export the local doc to blocks JSON (`ExportAsync` / `convert.Export` / `export`).
2. Run `agentExecute` in the bundle with that document.
3. Translate with `RoomEditTranslator` / `translate`.
4. Apply with `ApplyOps` on the local doc. That is one transaction, so its update bytes become **one** row and one 102 frame.

Node also produces one transaction per batch (§1.6). The ids-since-mark logic stays the same.

`ExecuteInRoom` itself cannot be reused, because it goes through an in-process room manager and journal (`room.go:64-68`; `BlokAgentExecutor.cs:507`).

### 3.2 Bundle changes this needs

These are found by reading the code and running one measurement.

1. **The contract runtime tag.**
   - The bundle's `contractWhere` accepts only `jint` and `csharp-live` (`src/view/server-runtime.ts:497-499`). Node live presents `node-live` (`src/mcp/contract.ts:48-52`).
   - Measured in this session (esbuild bundle of `createHeadlessAgentSetup`, both with no services and with `versionHistory` + `restores`):
     - all 101 commands are byte-identical;
     - every other contract field is equal;
     - **only `revision` differs** (`e609bb00` vs `44501f3b`; `9b204518` vs `2f65ae0f`).
   - `contractRevision` is shown to the agent (`live-session.ts:159`). Let the bundle accept `runtime: 'node-live'` so the ports present Node's revision.
2. **The document revision.**
   - Node live returns `l<n>` (§1.6). The bundle's `agentExecute` returns a content hash on the Jint path. The room path returns the journal head.
   - For parity, the port must hand the bundle its own `l<n>` counter (the number of Y updates applied to the local doc). The bundle then checks `expectRevision` against it and reports it.
   - There is no input for this today (`server-runtime.ts:577-618`). It is a new input field.
   - The count is `onAnyUpdate` events, peers' updates included (`store-applier.ts:60-62`). The parity corpus does not compare revision values: `test/unit/agent/parity/normalize.ts`, `mcp-harness.ts` and `run-case.ts` never mention `revision`.
   - So the bar is matching stale detection (an `expectRevision` that is stale after a peer write is refused), not equal numbers. **Unverified:** whether native Yjs fires update events exactly when JS Yjs does, including the server's type-0 echo of the agent's own operation. Make the counter exact only if a test shows it must be.
3. **Version history.**
   - The bundle does not call history. It reads it preloaded (`loadedVersionHistory`, `server-runtime.ts:465-490`).
   - On a history command, the port fetches it over HTTP first (§1.10), the same way in-room hosts detect version commands (`room.go:105-111`).
   - A restore comes back named in the output, and the host then POSTs it, through the approval retry (`00-plan.md` §3 milestone 6).
4. **Undo.**
   - Node live undo is a `Y.UndoManager` on the local doc, tracking only this handle's transactions (`store-applier.ts:63-70`).
   - The bundle supports carried JSON history (`input.history`, `server-runtime.ts:509-533`), and C# rooms keep `RoomAgentHistory` per in-process room.
   - A remote handle must carry history per handle.
   - **Unverified risk:** JSON-diff undo and Yjs `UndoManager` undo can disagree when a peer has edited the same block in the meantime. The parity corpus has no concurrent peers, so it will not catch this. Add a participant scenario where a human edits between an agent write and its undo.

### 3.3 Where the duplicated logic stays small

- **Single source:** planning, the contract, the error text, presence colour and name rules (in the bundle where possible), the wire codec (already shared through fixtures), and edit translation (already ported).
- **Written three times:** the WebSocket client role, the provider state machine (about 700 lines of TS that matter for a headless client, **estimate**), the outbox, the awareness encoder, the history and ticket HTTP calls. (Go already has `ticket.Mint`, `blokserver/ticket/mint.go:43`.)
  - The state machine is the risky part. Port it from `provider.ts` line for line, keeping the constants (`:45-142`), and pin it with the scripted room below.
- **Go ticket mint** already exists (`blokserver/ticket/mint.go:43`). Check it against `test/unit/server-conformance/fixtures/tickets.json` before relying on it.

### 3.4 Test oracle

1. **Real rooms: the existing participant suite.**
   - `test/unit/server-conformance/mcp-agent-participant.test.ts` already runs Node's MCP in live mode against the built C#, Go and Rust hosts. It is in `SUITES` in `scripts/test-server-conformance.mjs:44-57`.
   - It has five scenarios (lines 182-337):
     - rich text, presence fields, attribution, history text and the close summary;
     - a moved block keeps its identity;
     - a read-only ticket;
     - the room refuses a write;
     - open before sync.
   - The human peer is the real Node provider.
   - Parameterise the *MCP under test*: `node` (in process, as now) or a spawned port binary over stdio, using the MCP client already in devDependencies.
   - To fit the 7-minute job budget, run Node against all three hosts (as now) plus each port against its own host. Do not run the full 3×3.
2. **A scripted room for the failure paths.**
   - Promote the in-memory `RoomSocket` fake (`test/unit/agent/parity/mcp-harness.ts:110-183`) into a real WebSocket server driven by a JSON script. A script lists the frames and closes to send, and the client frames and MCP results to expect.
   - Scripts to cover:
     - 4401 twice → `FORBIDDEN`;
     - 4403;
     - 4409 → `ROOM_RESET`;
     - control with format 3 → `VERSION_SKEW`;
     - no control at open → `ROOM_SYNC_TIMEOUT`. Three 10 s handshake timeouts plus backoff take about 33 s, so the 15 s sync timeout fires first (`headless-session.ts:62,131`);
     - no control on three reconnects after a completed sync → the room ends, and the next execute returns `SOURCE_UNAVAILABLE {terminal:'handshake-timeout'}`;
     - no ack → `pending:true`, then the redrive resends the same `operationId`;
     - rejection `read-only`, `lineage-mismatch`, `not-synced`;
     - a limits cap;
     - a ping with no pong.
   - Node runs the scripts first and becomes the oracle. Then every port runs the same scripts.
   - Run the `mcp-live` parity corpus (`test/unit/agent/parity/mcp-live-runner.test.ts`) through it too.
3. **Frame goldens.**
   - Record frames through the scripted room or a logging proxy.
   - Compare frame types, order and metadata *shape* only. Normalise `lineage`, `operationId`, `clientID`, `clock`, the ticket and the timestamps.
   - **Never compare Yjs payload bytes.** Client ids are random, and native ApplyOps does not write the same structs as the JS `StoreApplier`. Compare document content after read-back instead.
   - Byte-level codec parity is already covered by `sync-frames.json` / `sync-wire-decode.json` in all three codec suites.
4. **Test timers.** The ports need test-only knobs for the sync timeout and the ack wait, as Node has (`liveSyncTimeoutMs`, `ackTimeoutMs`; `src/mcp/server.ts:116-117`, `live-session.ts:17`). Otherwise each timeout script costs 10–30 s.

## 4. Outbound-client laws

| Language | Law | What a sync client must do |
| --- | --- | --- |
| C# | `Blok.Server.Tests/OutboundClientArchitectureTests.cs` | **`ClientWebSocket` is banned everywhere, pinned owners included** (`:10-24, 246-261`). |
| Go | `internal/outbound/law_test.go` | Bans `x/net/websocket` `Dial*`/`NewConfig`/`NewClient`, `net.Dial*`, `tls.Dial`/`Client`, and the sockets transport outside pinned files (`:23-48`). |
| Rust | `outbound/src/law_test.rs` | Token scan for `TcpStream::connect` and friends and for `OperatorClient` construction (`:11-33`). |

**C# details.**

- The scan covers every `*.cs` under `packages/server/dotnet` except `*.Tests`, `bin` and `obj` (`:613-623`). The new `Blok.Server.Mcp` project is scanned.
- `GuardedOutboundFetcher.cs` is skipped entirely (`:436-439`).
- S3 and DocEndpoint are pinned to exactly one client field, one client creation, one handler return and one handler creation (`:38-41, 449-470`).
- So the law must gain a new owner *kind*: one file allowed to create one `ClientWebSocket`. A new pinned path is not enough.
- Connecting through a `SocketsHttpHandler` from that file's single `CreateHandler`, with `ConnectAsync(uri, invoker, ct)`, would share proxy and TLS rules with DocEndpoint. **Unverified:** that overload's behaviour, and whether `SetRequestHeader("Origin")` and subprotocol validation accept JWT characters. Check with a small compile before relying on them.
- The history routes and the ticket URL POST need an `HttpClient` owner. That is a second new pinned owner, or reuse of the DocEndpoint client pattern.

**Go details.**

- The scan root is the whole module, minus `_test.go` (`:65-81`).
- A client built on `dotnet.NewSocketsTransport` (an HTTP/1.1 upgrade through `http.Transport`) or on `net.Dialer` needs a `pinned` entry with counts (`:43-48`).
- That `net/http` hands back the upgraded connection on a 101 response is standard library behaviour from memory. **Unverified** here.

**Rust details.**

- A third-party crate such as `tokio-tungstenite` dials inside itself, so the token scan would not see it. That is a gap, not a pass.
- Dial through `OperatorClient`'s connect path (`operator.rs:326, 378`) and add a `DIAL_OWNERS` / `CLIENT_OWNERS` entry. Reuse the same client for history and ticket HTTP.

**Category.** The sync URL, history base and ticket URL are operator-configured (`--sync-url`, `--ticket-url`; `src/mcp/config.ts:16, 159-169`). Like the doc endpoint, these are operator clients, not caller URLs. They belong outside the SSRF guard, in the pinned-operator category, in all three languages.

**Outbound calls per language in remote live mode:**

- the WebSocket upgrade;
- `GET` and `POST` on `/history`;
- the ticket URL `POST` in URL mode;
- in secret mode no ticket call, only local minting.

## 5. Unverified items

- The connect-to-ready frame order (§1.5) and the close order (§1.9) are code-derived. No wire trace was taken.
- `ClientWebSocket` auto-pong, the `ConnectAsync(Uri, HttpMessageInvoker, …)` overload, the Origin header and JWT subprotocol tokens on .NET.
- Go `net/http` 101 upgrade returning a writable body.
- Whether JSON-history undo matches `Y.UndoManager` undo under concurrent peer edits.
- The size of the provider subset to port (§3.3) is an estimate.
- Whether the server sends QueryAwareness to the joiner itself. `BroadcastLocked(QueryAwareness, membership)` at `CollabRoom.cs:453`; the exclusion semantics were not read.
