# Verify 07: remote live client (and milestone 7 of 00-plan)

Adversarial check of `07-remote-live-client.md` and `00-plan.md` §3 milestone 7, done 2026-11-07. Read-only: the repo was not changed. The throwaway scripts and logs are in `/private/tmp/claude-501/-Users-jackuait-Packages-blok/127fe423-fcdf-4069-b172-fc3dabc89038/scratchpad/verify-live/`.

Verdicts: CONFIRMED / WRONG / PARTLY / UNVERIFIABLE.

## What was measured

1. **Wire trace, Node MCP live against the Go host.** I built the Go host (`go build -tags conformance ./cmd/blok-server`, the same build as `scripts/test-server-conformance.mjs:189-197`). I started it with the participant suite's arguments (`mcp-agent-participant.test.ts:153-160`) and ran `assembleMcp` with a human peer connected. `ws` send and emit were patched to log every frame (`trace.ts`).
   - With `--conformance-journal` the server picks v2. Log: `trace-go-v2.log`.
   - Without it the server picks v1. Log: `trace-go-v1.log`.
2. **.NET `ClientWebSocket` probe against the same Go host** (`cswsprobe/`, net10.0).
3. **Control for the pong check:** a `ws` client with `autoPong: false` (`nopong.cjs`).
4. **Contract comparison** (`contract-cmp.ts`): `createHeadlessAgentSetup` with `runtime: 'node-live'` and with `'csharp-live'`, under three service sets.

The v2 trace, abridged (s1 = the agent socket):

```
handshake protocols=[blok-sync.v2, blok-sync.v1, <ticket 3 segs>] origin=https://app.example.com
open protocol=blok-sync.v2
OUT syncStep1            IN control             OUT activity
IN  limits               IN identities          IN syncStep2
IN  syncStep1            OUT syncStep1 (residual round)
IN  syncStep2            IN syncStep1
IN  identities           IN awareness (alice)   OUT awareness (agent + alice states)
--- execute write
OUT activity             OUT operation          IN update (echo of own op, same length)
IN  acknowledgement seq 1   -> delivery {durable:true,pending:false,serverSequence:"1"}, revision "l1"
OUT awareness (activeAt, blockId, agentCursor)
--- second write
OUT operation  IN update  IN acknowledgement seq 2   -> revision "l2" (no activity frame)
--- close
OUT awareness (12 bytes, null state)   close 1000   -> {unsavedBatches:0, hostRecordLags:true}
```

In the v1 trace, writes go out as `OUT update` (type 0/2). The server's SyncStep1 is answered with `OUT syncStep2`. Delivery is `NO_DELIVERY`, durability is `best-effort`, and `hostRecordLags` is `false`.

## 1. Handshake

| Claim | Verdict | Evidence |
| --- | --- | --- |
| Client offers `blok-sync.v2, blok-sync.v1, <ticket>` | CONFIRMED | `provider.ts:60-61, 1452-1453`; the trace header shows exactly that order. |
| Origin is sent as a header | CONFIRMED | `node-socket.ts:12`; `ws/lib/websocket.js:810-815` (ws 8.22.0); the trace shows `origin=https://app.example.com`. |
| `ws` fails the connect if the server selects nothing or something not offered | CONFIRMED, with a nuance | `websocket.js:979-994` → `abortHandshake` → `emitErrorAndClose` (`:1116-1141`). The provider sees close 1006 and **reconnects** (`provider.ts:1355-1416`); this is not terminal. Before the first sync it ends as `ROOM_SYNC_TIMEOUT` after 15 s. After a sync it retries forever, because `teardownGeneration` clears the handshake timer, so the 3-timeout rule never fires. |
| Server side, all three: v2 only with an operation store, else v1; ticket in ticket mode; 400 if no version token; 403 without an allowed Origin | CONFIRMED | Go `synchttp/handshake.go:75-122, 201-217` (`HasOperationStore` = `hasJournal()`, `blokserver/collab.go:55-58`). C# `Blok.Server.AspNetCore/Collab/SyncHandshake.cs:113-172, 279-287` (also gated on `AdvertiseV2 = true`, `:71`). Rust `collab-synchttp/src/handshake.rs:77-135, 216-225`. |
| "Ticket as the **last** offered subprotocol" | PARTLY | Node sends it last. All three servers try **every** non-version offer (`verifyAny`; `candidates` filter), so position does not matter. |
| A v1 server is an edge case | WRONG (by implication) | A Go/Rust host without a journal, or a C# host without an operation store, picks v1. This is a supported production mode, and Node writes to it (`trace-go-v1.log`). |

## 2. Frames, timers, delivery, presence, close

| Claim | Verdict | Evidence |
| --- | --- | --- |
| Frame table, strict decoder, 64-frame buffer, 103/104/107 dropped before control | CONFIRMED | `provider.ts:1507-1567, 1345-1354`. |
| Join order Control → Limits → Identities, then QueryAwareness to the room; SyncStep2 then SyncStep1 in answer to the client's SyncStep1 | CONFIRMED | C# `CollabRoom.cs:435-453, 2686-2687`. Go trace shows the same order. |
| (07 §5 open item) QueryAwareness reaches the joiner | RESOLVED: it does not | C# `BroadcastLocked(frame, except: membership)` (`CollabRoom.cs:3226-3235`); Go `room/room.go:290`; Rust `collab-room/src/sync.rs:76`, `room.rs:582` (`Some(id)`). The trace shows no QueryAwareness on the agent socket. |
| Connect → ready order (§1.5) | CONFIRMED by trace | See the trace above, including the residual SyncStep1 round. Activity goes out **right after control**, before the limits frame arrives. |
| 15 s redrive (`provider.ts:95`), 10 s MCP ack wait (`live-session.ts:20`), 15 s sync timeout (`headless-session.ts:62`), 10 s handshake and first-sync timers | CONFIRMED | Read in code. |
| One operation in flight | CONFIRMED | `runDrain` returns while `inFlight !== null` (`provider.ts:893-904`); the trace shows op → echo → ack → next op. |
| The server echoes the agent's own operation as a type 0/2 Update **before** the ack | MISSING from 07 | C# comment `CollabRoom.cs:2818-2821` ("The submitter included"); seen in the Go trace. A port must apply its own echo as a no-op. In Node the echo does not bump the revision (`l1` → `l2` across two writes). The port's YDoc must also emit no update event for a no-op apply, or `l<n>` drifts. |
| `delivery` table | PARTLY | `live-session.ts:104-150`, `tracking-outbox.ts:94-140`. Missing row: a write batch that appends **zero** rows gets `ids = []`. `[].every(...)` is true, so the result is `{durable:true, pending:false, serverSequence:null}`, not `NO_DELIVERY`. |
| `hostRecordLags = protocol === 'v2'` at close | CONFIRMED | `live-session.ts:174`; v2 trace `true`, v1 trace `false`. |
| "An Activity 106 frame goes out at most once per 60 s" (§1.8) | WRONG | There are two **independent** 60 s budgets. One is the provider's handshake budget (`provider.ts:458-467`, `lastActivitySentAt`). The other is presence's (`presence.ts:15, 75-77`, `lastActivity`), and it is not shared because `provider.sendActivity()` (`:440-450`) never touches `lastActivitySentAt`. The trace shows 106 at handshake and 106 again at the first batch, **311 ms apart**. On the first batch it goes out before the 102 (`afterBatch` runs before the async append). |
| Presence fields and renewal | CONFIRMED | `presence.ts:40-83`; y-protocols 1.0.7 `awareness.js:13, 59-77, 194-207`. One thing to add: `afterBatch` also runs for **read-only** successful batches (`live-session.ts:103`), so reads bump `activeAt`. |
| Awareness frames carry "only the changed clients" | PARTLY | A *full* flush (after control, or on QueryAwareness) encodes **every** known state, peers included (`flushAwareness`, `provider.ts:382-403`). The trace's first agent frame carries alice's state too. A port whose encoder writes only its own state differs on the wire. That is harmless, but it does not match Node byte for byte. |
| Close order | CONFIRMED by trace | Null-state awareness (12 bytes) right away, then close 1000. The "cursor null" frame never ships. |
| `revision` = `l<count of onAnyUpdate>` | CONFIRMED | `store-applier.ts:60-62, 77-79`; trace `l1`, `l2`. |

## 3. "The JS client cannot run in the shared bundle"

| Claim | Verdict | Evidence |
| --- | --- | --- |
| No Yjs in the bundle | CONFIRMED | `grep -c 'encodeStateAsUpdate\|YMap\|ContentDeleted' go/internal/jsruntime/blok-server-runtime.js` → 0; `server-runtime.ts` imports no `yjs`. |
| No timers or crypto in the runtimes | PARTLY | No `setTimeout`, `getRandomValues` or `crypto` is provided by `go/internal/jsruntime/*.go`, `rust/crates/jsruntime/src/*.rs` or `JintBlokRuntime.cs`. Randomness is still available: the bundle already falls back to `Math.random` when `globalThis.crypto` is missing. Timers are the real blocker; crypto is not. |
| "Engines live for one call" | PARTLY | Engines are **pooled and reused** (`JintBlokRuntime.cs:340-358`, `reusable ? engine : CreateEngine()`). What is true is that no call can leave work pending: Go returns `ErrPending` (`jsruntime/runtime.go:23-24`). The conclusion stands. |

## 4. Native pieces in each server

| Need | Verdict | Evidence / correction |
| --- | --- | --- |
| Yjs doc (state vector, diff, apply, transact) | CONFIRMED | C# `Yjs/YDoc.cs:93,107,125,170`, plus `UpdateEmitted` (`:23`, with a `Local` flag, `YUpdateEvent.cs:8`). Go `internal/yjs/doc.go:178,184,215,242`, `OnUpdate` `:108`. Rust `yjs/src/doc.rs:236,243,250,283`, `on_update` `:202`. The Rust Yjs is in-house (deps: jsjson, lib0, getrandom). |
| Wire codec, both ways | CONFIRMED | C# `SyncWire.cs:155, 243`; Go `wire/encode.go:17`, `decode.go:24`; Rust `collab-wire/src/encode.rs:21`, `decode.rs:40`. |
| Awareness: validate and removal only | CONFIRMED | C# `SyncWire.cs:1699,1743`; Go `wire/awareness.go:23,59`; Rust `awareness.rs:20,62`. |
| Converter | CONFIRMED, path typo | The Go paths in 07 §2 omit `internal/`. The right paths are `go/internal/collab/convert/docconverter.go:124` and `export.go:752,763`. |
| Single-transaction apply | CONFIRMED, with detail | Go `internal/collab/convert/apply.go:23` (not `collab/convert/apply.go`); Rust `apply.rs:31`; C# `YDocConverter.cs:405`. `ApplyOps` returns **void/error**, not bytes. The client gets the update from the doc's update event. The room path uses `CollabDocConverter.ApplyOpsAsync` (`CollabDocConverter.cs:60-104`), which first makes a **runtime call** to convert rich-text HTML. The port should reuse that async entry, not bare `ApplyOps`. |
| Edit translator | CONFIRMED, visibility gap | C# `RoomEditTranslator.cs:15` (internal; the `InternalsVisibleTo` decision covers it). Go `blokagent/translate.go:12` is **unexported** (`translate`). Rust `blokagent/src/translate.rs:11` is **`pub(crate)`**. Go and Rust need a visibility change, which 07 does not mention. |
| WebSocket server-only, rejects unmasked frames, never masks | CONFIRMED | Go `ws/ws.go:1-5, 282-296, 394-407`; Rust `ws/src/lib.rs:1-5, 518-528`. |
| Ticket mint | CONFIRMED | C# `BlokTicket.cs:36,44`; Go `blokserver/ticket/mint.go:43`; Rust `blokserver-ticket/src/lib.rs:68`. |

## 5. "101 commands identical; only `revision` differs"

CONFIRMED by re-measuring (`contract-cmp.ts`). With no services, with `versionHistory` + `restores`, and with all services + `prepares:['page']`, both runtimes give 101 commands, 0 command diffs, and `revision` as the only differing key.

The revision values in 07 (`e609bb00`/`44501f3b`) are stale. Today they are, for example, `4acce894` (node-live, history), which matches the `contractRevision` in the trace. This is not load-bearing.

## 6. Outbound laws

| Law | Verdict | Evidence / addition |
| --- | --- | --- |
| C#: `ClientWebSocket` banned everywhere, pinned owners too; needs a new owner kind | CONFIRMED | `OutboundClientArchitectureTests.cs:10-24, 246-261, 449-470`. Also note: `HttpMessageInvoker` and `SocketsHttpHandler` are restricted types too (`:12-18`). The `ConnectAsync(uri, invoker, ct)` route therefore needs the new owner kind to allow one handler creation as well. |
| C# unverified items: `ConnectAsync(Uri, HttpMessageInvoker, ct)`, Origin via `SetRequestHeader`, JWT as a subprotocol, auto-pong | RESOLVED: all work | Probe against the Go host, all on .NET 10.0.4xx SDK: `SetRequestHeader("Origin", …)` plus `AddSubProtocol(jwt)` connects with `SubProtocol = blok-sync.v2`, and the overload compiles and runs. The socket stayed up **75 s** without any app-level pong. The control client without pong was dropped at **48.8 s** (close 1006, ping at 18.8 s). So .NET answers pings itself. |
| Go: bans `x/net/websocket`, `net.Dial*`, `tls.*`, the sockets transport | PARTLY | `internal/outbound/law_test.go:23-48`. Also banned: `net/http` `Client`/`Transport`/`Get`/`Post`/… The history and ticket HTTP calls therefore need a pinned `http.Client` too, not only the WS dial. |
| Go: `net/http` returns a writable body on 101 | RESOLVED for the standard library | Go 1.27.1 `src/net/http/transport.go:2709-2791` (`readWriteCloserBody`) and `response.go:347`. Not verified through `dotnet.SocketsTransport`, which wraps the conn (`wireConn`/`pooledConn`, `internal/dotnet/sockets.go:114-180`). The URL also has to be rewritten `ws→http`. |
| Rust: needs a `DIAL_OWNERS`/`CLIENT_OWNERS` entry | PARTLY | `outbound/src/law_test.rs:11-33`. `OperatorClient::connect` is **private** (`operator.rs:326`). The only public entry is `send` (`:135`). Its `Response.body` is `Body<BufReader<Box<dyn Stream>>>`, and `Stream` is `AsyncRead + AsyncWrite` (`operator.rs:28`, `wire.rs:485` `into_inner`). An upgrade through `send` + `into_inner` looks possible but is unverified: it depends on how `send` frames a 101 head. Otherwise `outbound` needs a new public upgrade method. |

## 7. Design soundness: native client, bundle plans each batch

The overall shape is sound. Export, `agentExecute`, translate and apply is exactly what the in-room path already runs (`BlokAgentExecutor.cs:507-540`, Go `room.go:64-68`). Below are the flaws and gaps.

**F1. Dropping v1 sends breaks writes to v1 servers.** (07 §3.1 says "Leave out … v1 local sends … The headless case never has them".) WRONG.

- `headless-session.ts:180-181`: "Under v1 the provider's own seam hook sends local edits."
- `hookSeam` sends every local update as 0/2 (`provider.ts:493-523`), and `answerResync` answers the server's SyncStep1 with 0/1 (`:1129-1158`).
- `trace-go-v1.log` shows Node doing both against a Go host without a journal.
- Fix: port the v1 path (send Update, answer SyncStep1 with SyncStep2, apply the announced and learned size caps). Or refuse writes on v1 on purpose and document that. Do not drop it silently.

**F2. Batches must run in one lane against the local doc.** 07 does not mention this.

- The in-room path runs export → plan → translate → apply inside the room lane (`AgentEditAsync`, `BlokAgentExecutor.cs:507-540`; Go `room.go:64` "plans it inside the room lane").
- A native client has a socket reader running at the same time (goroutine, task or tokio).
- The translator turns `setData`/`setRichText` into one `Update` carrying the block's **whole final data** (`translate.go:33-35, 105-110`).
- `replaceData` then deletes live keys that are missing from that data and diff-assigns the rest against the **live** doc (`apply.go:877-922`).
- So if a peer update is applied between export and apply, it gets reverted, even on keys the agent never touched.
- Node writes only the patched keys (`store-applier.ts:375-382`, `updateBlockData` per key, `document-store.ts:1520+`).
- Fix: queue inbound doc frames, keeping awareness and acks flowing, from export until the apply transaction and the outbox append are done. This includes the async HTML conversion inside `ApplyOpsAsync`.

**F3. JSON-history undo cannot match Node's `Y.UndoManager`.** 07 lists this as "unverified risk". It is a **known divergence by construction** (code-derived, not run):

- **Node** (`store-applier.ts:63-70, 250-277`) undoes its own Yjs items. A peer's text and map writes in the same blocks survive. Only a peer's *structural* change to the step's blocks gives `CONFLICT`.
- **Bundle carried history** (`server-runtime.ts` `carriedHistory`, ~`:510-525`) drops the whole stack (`lost`) whenever the content revision differs. Any peer keystroke anywhere in the doc therefore leaves `NOTHING_TO_UNDO`.
- **Room history** (Go `roomhistory.go:17-23`, C# `RoomAgentHistory`) writes back blocks "only while nobody else changed them". So a peer edit in the same block refuses an undo that Node would perform.
- Fix: pick room history, which is closer, and write the participant scenario 07 proposes. Expect it to show a difference, and decide whether that difference is accepted. The other route is a native `UndoManager` port, which is much more work.

**F4. Write-batch edge cases a port must copy.** These are not in 07:

- A zero-row write gives `durable:true, serverSequence:null` (§2 above).
- The self-echo before the ack must not bump `l<n>`.
- On the first batch, Activity goes out before the operation, and the second Activity budget lives in presence (§2).

**F5. Translator and Rust dial visibility.** Covered in §4 and §6: Go `translate` is unexported, Rust `translate` is `pub(crate)`, and Rust `OperatorClient::connect` is private. Each needs a small API change in the server crates/packages. That is a backend change, so under the three-backend rule it needs tests in all three.

**F6. Normalisation risk (unverified).** The port writes whatever differs between live and the bundle's `after` document for every edited block. If the export → bundle round trip normalises *untouched* keys of an edited block (HTML spelling, legacy shapes), the port writes changes that Node would not. The in-room path has the same exposure today. 07 §3.4's "compare document content after read-back" catches content changes, not extra Yjs churn.

## Corrections to 00-plan milestone 7

- "connect fails if no subprotocol selected": true per attempt, but it is a reconnect loop, not a terminal state (§1).
- "Outbound laws … Go needs a pinned entry": it needs one for the WS dial **and** one for the history/ticket `http.Client`. "Rust needs an owner entry": it also needs a public upgrade path in `outbound` (§6).
- Add F1 (v1 path) and F2 (single lane) to the milestone's scope.
- In 07 §5 / 00-plan §5, these items are now resolved:
  - .NET auto-pong, the invoker overload, Origin and JWT subprotocol all work.
  - Go stdlib 101 gives a writable body.
  - QueryAwareness is not sent to the joiner.
  - The connect → ready and close order is now traced against the Go host, not only code-derived.
- Still unverified: the C# and Rust hosts were not traced, and F6.
