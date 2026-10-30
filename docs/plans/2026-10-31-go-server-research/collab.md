# Go server research: collab parity ledger

Research only. Nothing here is implemented. Every row cites code read in this session.

## Key

- `S/` = `packages/server/dotnet/Blok.Server/Collab/`
- `A/` = `packages/server/dotnet/Blok.Server.AspNetCore/Collab/`
- `AC/` = `packages/server/dotnet/Blok.Server.AspNetCore/`
- `H/` = `packages/server/dotnet/Blok.Server.Host/`
- `T/` = `test/unit/server-conformance/`
- Oracle tests:
  - `SC` = `T/sync-contract.test.ts`
  - `PV` = `T/protocol-v2-contract.test.ts`
  - `BC` = `T/blok-client-contract.test.ts`
  - `MCP` = `T/mcp-agent-participant.test.ts`
- `NONE → Pn` means no oracle exists today. `Pn` is the proposed oracle in section 4.
- Go homes are a PROPOSAL. The module is `packages/server/go`. The deleted tree (`git show ad5782d7^`) used `packages/server/{cmd,internal}`, and its `go.mod` required only `golang.org/x/net` and `github.com/doyensec/safeurl`.

Proposed Go packages:

| Go package | Holds |
| --- | --- |
| `internal/ws` | The RFC 6455 server subset (section 7). |
| `internal/collab/wire` | `SyncWire`. |
| `internal/collab/room` | `CollabRoom`, `CollabRoomManager`, room options. |
| `internal/collab/journal` | The journal codec, the lineage ledger, `LocalCollabOperationStore`. |
| `internal/collab/workingset` | The working-set codec, tag and law; local and S3 working-set stores. |
| `internal/collab/convert` | `YDocConverter`, `CollabDocConverter`, `RichText*`, `TextDiff`, edit ops, the restore planner, version changes, timeline, replay. |
| `internal/collab/docendpoint` | `DocEndpointClient`. |
| `internal/httpapi/collab` | The sync, edit, state, reset and history handlers; handshake, budget, connection table, socket member, closes. |
| `pkg/collab` | The public host seams (section 2.O). |

## 1. Dependency order (what collab needs first)

1. **lib0 varuint/varbytes.** `S/SyncWire.cs:368-412`. Shared oracle: `T/lib0-parity.test.ts`.
2. **The Yjs engine** (`Blok.Server/Yjs`, 6145 lines). Collab uses:
   - `EncodeStateAsUpdate(sv)`, `EncodeStateVector`, `ApplyUpdate` and `UpdateInspector.Inspect` (`S/CollabRoom.cs:2360-2395`)
   - `ApplyResult.Changed` (`Blok.Server/Yjs/ApplyResult.cs`). The journal decision rests on it: `S/CollabRoom.cs:2987`.
   - `UpdateEmitted` with a `Local` flag, `AdoptClientId` and `HasPending` (`S/CollabRoom.cs:890-919`, `:1001-1009`)
   - `Transact`, `YMap`, `YArray`, `YText`, `YXmlText` with format attributes and delta
   
   Oracle: `T/fixtures/yjs-engine` plus `yjs-engine-fixtures.freshness.test.ts`. This is another area's job.
3. **The JS runtime.** Rich-text HTML is read by the CLIENT's reader, running in the embedded engine, through the op `htmlFieldsToSegments` (`S/RichTextHtmlReader.cs` summary; `MaxCallChars` at `:35`). Go needs an equivalent runtime or a ported reader. This blocks seed, edit and migration of HTML fields.
4. **Tickets, CORS, the fixed-window limiter, the request guard and `IBlokAuthorization`.** Used by `A/SyncHandshake.cs:54-58,113-125,158-179` and by every HTTP route through `AC/BlokServerEndpointRouteBuilderExtensions.cs:170`. Other areas own these.
5. **The S3 blob store.** Used by `S/S3CollabStore.cs` (key `{prefix}/{CollabDocKey}`, `:142-144`). The storage area owns it.
6. **Then collab itself**, in this order: wire → working-set and journal formats → converter, rich text, text diff → room → manager → HTTP and WebSocket endpoints.
7. **Agent (`Blok.Server/Agent`) consumes collab.** It uses `CollabRoomManager.AgentEditAsync` (`S/CollabRoomManager.cs:401`) and the `DocumentReplaced` event (`:208`). It is out of scope here, but the Go room manager must expose both.

## 2. Parity ledger

### 2.R Routes and the HTTP shell

| # | Feature | C# location | What it does | Oracle | Go home |
| --- | --- | --- | --- | --- | --- |
| R1 | `GET /sync/{doc}` | `AC/BlokServerEndpointRouteBuilderExtensions.cs:103` | WebSocket door. Mapped only when `CollabEnabled`. Has no request timeout and no guard. | SC (all 16) | `internal/httpapi/collab/sync.go` |
| R2 | Non-GET on `/sync/{doc}` | same `:105` | Answers 405 with `Allow: GET`. | NONE → P2 | same |
| R3 | `POST /sync/{doc}/reset`, `POST …/edit`, `GET …/state` | same `:106-108` | Run behind the shared guard. The guard requires a write pass when the method is not GET (`:170`). | SC reset test (`resets a document: 204…`), SC `page title: GET state carries the title and icon` | `internal/httpapi/collab/routes.go` |
| R4 | Five history routes | same `:14-20,110-113` | Covers list, point read, DELETE lineage, restore and changes. DELETE needs a write pass, because `method != "GET"` (`:170`). | MCP (one GET history) | `internal/httpapi/collab/history.go` |
| R5 | OPTIONS and 405 on each shell route | same `:170-185` | Answers the preflight. Sync GET routes advertise `GET, OPTIONS` without HEAD (`:181`). | NONE → P1 | `routes.go` |
| R6 | Open-routes warning | same `:29,114-118` | Logs a warning when `Auth=="none"` and no `IBlokAuthorization` is registered. | NONE (log only) | `routes.go` |
| R7 | Single-segment doc id | `A/SyncEndpoint.cs:54-61` | Refuses an id that is empty or holds `/`, `\`, `%2f` or `%5c` (any case). | NONE → P1, P2 | `internal/httpapi/collab/docid.go` |
| R8 | Plain refusal body | `A/SyncEndpoint.cs:63-68` | Sends `text/plain; charset=utf-8` with the reason and a trailing `\n`. | NONE → P1 | same |
| R9 | 503 with `Retry-After` | `A/SyncEndpoint.cs:74-80` | Sends whole seconds, rounded up, at least 1. The value is `RetryBackoff` (2 s, `S/CollabRoomManager.cs` `RetryAfter`). | NONE → P1 | same |

### 2.H Handshake (`A/SyncHandshake.cs`)

| # | Feature | C# location | What it does | Oracle | Go home |
| --- | --- | --- | --- | --- | --- |
| H1 | Check order | `:43-53,73-92` | Order: plumbing → origin → ticket → doc claim → rate limit → authorization hook. A *refused* result does not spend the limit. A *rejected* one does. | NONE → P2 | `internal/httpapi/collab/handshake.go` |
| H2 | No WebSocket feature | `:99-104` | Answers 500 `the sync endpoint needs WebSockets…`. | NONE (Go always has it; keep the branch out) | — |
| H3 | Not an upgrade | `:106-111` | Answers 426 `WebSocket upgrade required`. | NONE → P2 | handshake.go |
| H4 | Origin rule | `:113-125` | Origin is required in ticket mode, or when an `Origin` header is present, or when `Sec-Fetch-Site: cross-site`. Otherwise answers 403 `origin not allowed`. | NONE → P2 | handshake.go |
| H5 | Bad doc id | `:135-138` | Accepts, then closes 4400. | NONE → P2 | handshake.go |
| H6 | Ticket mode, no known subprotocol | `:144-149` | Answers 400 `blok-sync.v1 must be offered in Sec-WebSocket-Protocol`. | NONE → P2 | handshake.go |
| H7 | Version tokens are not tickets | `:151` | Removes `blok-sync.v1` and `blok-sync.v2` from the ticket candidates (protocol §2). | SC `accepts a compatible ticket offered as a subprotocol…` | handshake.go |
| H8 | Missing, invalid, other-doc or userless pass | `:155-172` | Accepts, then closes 4401 with four distinct reasons (`A/SyncClose.cs:29-48`). | SC `accepts then closes 4401 for a ticket bound to another doc or expired` (other-doc and invalid only) | handshake.go |
| H9 | Rate-limit key | `:97,175-176` | The key is `addr:<ip>`, or `user:<ticketUser>` once a ticket verifies. 429 `rate limit exceeded`. | NONE → P2 | handshake.go |
| H10 | Principal (per-user cap key) | `:175,181,221-231` | The principal is `user:<u>` in ticket mode, else `app:<Identity.Name ?? NameIdentifier>`, else null (uncapped). | NONE → P2 | handshake.go |
| H11 | Actor for the journal | `:247-269` | The actor is the ticket user, else NameIdentifier, else Name, else null. The order is the OPPOSITE of H10. | PV `the journalled actor comes from each connection's own pass, never from presence`, PV `an authenticated actor is journalled…` | handshake.go |
| H12 | Subprotocol choice | `:60-61,71,276-284` | Picks v2 only when `AdvertiseV2` holds and an operation store exists. Else v1. Else none. Matching is ordinal. | PV `a v2 operation is acknowledged…`; BC `a v2-capable client on a v1 server…` | handshake.go |
| H13 | Offer parsing | `:287-294` | Reads comma-joined values and repeated header lines alike, trimmed, empty tokens dropped. | NONE → P2 | handshake.go |
| H14 | Multi-candidate verify | `:296-311` | Tries every candidate token against the secret at the injected clock. | SC 4401 test (partly) | handshake.go |
| H15 | Hook refusal | `:192-218` | Read denied → accept, then close 4403. Write denied → a read-only member (no refusal). | NONE → P2 | handshake.go |
| H16 | Ticket principal claims | `:328-354` | Builds auth type `blok-ticket` with NameIdentifier, Name, `blok:doc` and `blok:write` (`"true"`/`"false"`) for the hook. | NONE (host API surface) → P2 | `pkg/collab/principal.go` |
| H17 | Protocol source | `:183-185` | The source is `ClientV2` when v2 was selected, else `ClientV1`. Stock y-websocket (no subprotocol) also counts as `ClientV1`. | PV (S8), SC `journals a v1 member's write…` | handshake.go |

### 2.W Socket member, connection table and inbound budget

| # | Feature | C# location | What it does | Oracle | Go home |
| --- | --- | --- | --- | --- | --- |
| W1 | Process-wide cap | `A/SyncConnectionTable.cs:16-28`; `A/SyncEndpoint.cs:91-101` | Answers 503 `too many connections on this server` before the room is seeded. 0 means no ceiling. | NONE → P2 | `internal/httpapi/collab/conntable.go` |
| W2 | Per (doc, principal) cap | `A/SyncConnectionTable.cs:31-64`; `A/SyncEndpoint.cs:104-111` | Answers 429 `too many connections`. Has no effect when the principal is null. | NONE → P2 | conntable.go |
| W3 | Join before upgrade | `A/SyncEndpoint.cs:143-166` | Joins first, then upgrades. Draining → HTTP 503 `shutting down`. Room Forbidden/Purged → HTTP 403 `forbidden`. | NONE → P2 (BC drain covers the 1001 path only) | sync.go |
| W4 | Seed failed or unavailable | `A/SyncEndpoint.cs:188-191` | Upgrades, then closes 4503 `document unavailable`. | PV `a failed journal commit … 4503…` (cooldown path) | sync.go |
| W5 | Recheck closure | `A/SyncEndpoint.cs:115-129` | Rechecks read access, and write access when the member can write. Used by `ICollabRoomManager.RecheckAccessAsync`. | NONE → P2 | sync.go |
| W6 | Keep-alive | `A/SyncEndpoint.cs:227-245` | Pings every `CollabKeepAliveInterval` (15 s). Aborts after 2× the interval with no answer. 0 turns it off. .NET's exact ping/pong semantics are UNVERIFIED. | NONE → P2 | `internal/ws` |
| W7 | Rejected-close grace | `A/SyncEndpoint.cs:20,203-225` | Accepts, queues the close, and waits 250 ms for the peer's close before aborting. | NONE → P2 | sync.go |
| W8 | Outbound backlog | `A/SyncEndpoint.cs:13,134`; `A/SyncSocketMember.cs:88-106` | The cap is 8 × `CollabMaxMessageBytes`. A frame is admitted when the backlog BEFORE it fits. Past the cap: 1008 `outbound queue overflow`. | NONE → P2 | `internal/httpapi/collab/member.go` |
| W9 | Forbidden overtakes | `A/SyncSocketMember.cs:114-129,191` | A Forbidden close replaces any earlier close. Queued frames are then dropped, not sent. | NONE → P2 | member.go |
| W10 | Leave before answering | `A/SyncSocketMember.cs:137-170` | Leaves the room and frees the lease, then sends Normal (1000). Waits 5 s of grace, then aborts. | NONE → P2 | member.go |
| W11 | Single sender | `A/SyncSocketMember.cs:9-14,180-217` | One pump goroutine owns every write. Room sends only enqueue. | NONE (structural) | member.go |
| W12 | Text frame | `A/SyncSocketMember.cs:262-268` | Closes 1003 `binary frames only`. | NONE → P2 | member.go |
| W13 | Fragment flood | `A/SyncSocketMember.cs:27-38,270-278` | Closes 1008 `inbound rate exceeded` past 16 receives + 1 per 64 bytes for one message. | NONE → P2 | member.go + `internal/ws` |
| W14 | Message too big | `A/SyncSocketMember.cs:280-286` | The size is counted across fragments. Closes 1009 `message too big`. | NONE → P2 | member.go |
| W15 | Discard after close | `A/SyncSocketMember.cs:255-260` | Once a close is requested, or when there is no membership, frames are read and dropped until the peer's close. | NONE → P2 | member.go |
| W16 | Frame budget | `A/SyncInboundBudget.cs:43-57,73-86,141-162` | Token buckets: 50/s with a burst of 100. Amplifiers (SyncStep1, queryAwareness) get 60/min with a burst of 10. Awareness bytes get 128 KiB/s with a burst of 512 KiB. A rate of 0 is off. Over budget → 1008. | NONE → P2 | `internal/httpapi/collab/budget.go` |
| W17 | Classify by decoded varuint | `A/SyncInboundBudget.cs:88-120` | Reads the type with the lib0 reader, never by comparing bytes, so `[0x80,0x00]` is still type 0. | NONE → P2 (add a non-canonical-varuint vector) | budget.go |
| W18 | Store source | `A/CollabOperationStoreSource.cs:16-29,34` | Uses the registered store, else `LocalCollabOperationStore(CollabDirectory)` when `CollabEnabled && CollabJournal`, else none. Exactly one per process. | PV (whole file runs on the journal host) | `internal/httpapi/collab/store.go` |

### 2.C Close codes (`A/SyncClose.cs:11-104`)

| # | Code | Reason (exact) | Sent when | Oracle | Go home |
| --- | --- | --- | --- | --- | --- |
| C1 | 1000 | `` | A normal end (`:11-12`). | NONE → P2 | `internal/httpapi/collab/close.go` |
| C2 | 1001 | `server shutting down` | Drain (`:14-15`). | BC `reports offline with close 1001 when the server drains on SIGTERM`; PV `a drain never acknowledges…` | close.go |
| C3 | 1009 | `message too big` | W14 (`:17-18`). | NONE → P2 | close.go |
| C4 | 1008 | `inbound rate exceeded` | W13 and W16 (`:20-21`). | NONE → P2 | close.go |
| C5 | 1008 | `outbound queue overflow` | W8 (`:23-24`). | NONE → P2 | close.go |
| C6 | 4400 | `document ids must be a single path segment` | H5 (`:26-27`). | NONE → P2 | close.go |
| C7 | 4401 | `missing pass` / `invalid pass` / `pass is for another document` / `pass names no user` | H8 (`:29-48`). | SC 4401 test (code only) | close.go |
| C8 | 1003 | `binary frames only` | W12 (`:39-40`). | NONE → P2 | close.go |
| C9 | 4403 | `forbidden` | H15, recheck expel, purge (`:50-51`). | NONE → P2 | close.go |
| C10 | 4409 | `document reset` | Reset (`:53-54`). | SC reset test; PV `a reset starts a new lineage…`; BC `resets its lineage on 4409…` | close.go |
| C11 | 4503 | `document unavailable` | W4 (`:56-57`). | PV S4 test (code) | close.go |
| C12 | 4503 | `commit unavailable, retry` | A failed commit (`:65-66`). | PV `a failed journal commit acknowledges nothing, closes every member 4503…` (asserts the reason) | close.go |
| C13 | 1008 | `malformed awareness` | The third malformed awareness frame (`:68-69`). | NONE → P2 | close.go |
| C14 | 1008 | `raw write on a v2 session` | A v2 member sends SyncStep2 or Update (`:76-77`). | NONE → P2 | close.go |
| C15 | 1011 | `internal error` | A reason outside the enum (`:80-93`). | NONE (defensive) | close.go |

### 2.F Wire codec (`S/SyncWire.cs`)

| # | Feature | C# location | What it does | Oracle | Go home |
| --- | --- | --- | --- | --- | --- |
| F1 | Message type numbers | `:102-119` | Covers 0, 1, 2, 3, 100, 101, 102, 103, 104, 106, 107 and the sync sub-types 0/1/2. | `T/fixtures/sync-frames.json` (`frames` ×10, `v2.frames` ×12) | `internal/collab/wire/types.go` |
| F2 | varuint | `:368-394` | At most 10 bytes. The tenth byte may carry only bit 0. Never throws. | `sync-frames.json` `v2.negative` (rule 1/2), `T/lib0-parity.test.ts` | wire/varint.go |
| F3 | varbytes bounds before allocation | `:396-412` | Checks the length against the bytes left BEFORE it allocates. | `v2.negative` `operationHugeUpdateLength` | wire/varint.go |
| F4 | Encode | `:155-218` | One frame per message. Payloads are non-empty (`RequirePayload`/`RequireUpdate`). | `sync-frames.json` canonical frames | wire/encode.go |
| F5 | Decode | `:257-357` | An unknown outer type decodes as `UnknownFrame` and the room ignores it (`:346`). Other frames must end exactly (`RequireEnd`). | `v2.negative` (43 entries; 105 = unknown) | wire/decode.go |
| F6 | v2 metadata rules 1–12, in order | `:500,571,617,1293-1440,1583-1660` | Strict UTF-8, no `\`, no JSON whitespace, a key-set check, the sequence grammar, the code grammar. Reports the first rule broken. | `v2.negative` (`rule` field), protocol §5 | wire/meta.go |
| F7 | Control frame 100 | `:789,1022` | `{"epoch":N,"format":N,"lineage":…}` in that key order. | `sync-frames.json` `blokControl` | wire/control.go |
| F8 | Limits frame 101 | `:951` | `{"maxMessageBytes":N}`. | `blokLimits` | wire/control.go |
| F9 | Identities frame 107 | `:1125` | Exactly one key; elements with `{clientId,actorId}`; clientId at most 2^53−1 (`:140`). | `identities` frame; protocol §3.5 | wire/identities.go |
| F10 | Awareness validation | `:1676-1717,1739` | Walks the entry count, then `[id][clock][varstring state]`. Each state must be one JSON value. The client cap is checked before entries. | NONE → P11 | wire/awareness.go |
| F11 | Awareness removal | `:1720-1737` | Writes each id at its last clock with the state `null`. | NONE → P11 | wire/awareness.go |

### 2.M Room behaviour (`S/CollabRoom.cs`)

| # | Feature | C# location | What it does | Oracle | Go home |
| --- | --- | --- | --- | --- | --- |
| M1 | Single lane | `:79-95,1423-1460` | Every doc access runs serially. Post queues work after the current item. | NONE (structural) | `internal/collab/room/room.go` |
| M2 | Join frames | `:367-457` | Sends 100 → 101 (only if a limit is announced) → 107 (even when empty) to the joiner, then broadcasts 3 (queryAwareness) to the others. | SC `relays awareness and re-queries presence for a late joiner`; protocol §3.5 | room/join.go |
| M3 | Join outcomes | `:367-457` | Covers Purged, Forbidden (closes a New room), SeedFailed, Unavailable (open elsewhere) and Joined. A null result means "closed, retry". | NONE → P2 | room/join.go |
| M4 | SyncStep1 answer | `:2662-2693` | Replies Step2(diff) and then Step1(sv), and only then marks the member synced. A bad state vector is dropped silently. | SC `hands a late joiner the full document state` | room/sync.go |
| M5 | Raw write on v2 | `:2575-2580` | Expels the member with C14. Nothing is applied. | NONE → P2 | room/sync.go |
| M6 | v2 commit order | `:2700-2831` | Checks: no session → drop; not v2 → drop; read-only; not-synced; lineage-mismatch BEFORE the lookup; lookup Duplicate → ack the original sequence; Conflict → reject. Then apply (invalid-update), append, then broadcast to ALL including the sender, then ack. | PV S1, S2, S7, S8 tests; PV `a v2 operation is acknowledged, relayed…` | room/commit.go |
| M7 | Rejection carries the client's lineage | `:2925-2942` | A 104 echoes the lineage the client named, not the room's. | PV `a reset starts a new lineage…` | room/commit.go |
| M8 | Failed commit | `:2944-2955` | Sets `CommitUnavailable` and closes every member with C12. | PV S4 test | room/commit.go |
| M9 | v1 write path | `:2957-3026` | Read-only → silent drop. Applies; journals only if `Changed`, under a minted id (`:3028`). Broadcasts to the others only, with no ack. | SC `journals a v1 member's write before it broadcasts it, and sends it no receipt`; SC `relays a writer to a read-only ticket but never the reverse` | room/v1.go |
| M10 | No-journal room | `:2966-2975` | Applies, relays and schedules the working-set blob. | SC (ordinary host) | room/v1.go |
| M11 | Awareness relay | `:2628-2660` | Relays verbatim to the others. Over the cap → dropped and logged. Malformed → counted; the third closes C13. | SC awareness test (happy path) | room/awareness.go |
| M12 | Awareness ownership | `:3073-3158` | Ownership follows the clock. An unknown id is claimed only from a one-entry frame. Ids above 2^53−1 are skipped. At most one 107 broadcast per frame. The map is capped at 256. | NONE → P11 | room/awareness.go |
| M13 | Withdraw on leave | `:3160-3198` | Broadcasts an awareness removal to the others, plus a 107 if the member was verified. | NONE → P11 | room/awareness.go |
| M14 | Activity frame 106 | `:2603-2607,1487-1594` | Records `Active`. Joined and Left always pass. Active and Edited are suppressed within 55 s per actor. Null actor → nothing. 256-stamp sweep. | NONE → P7 | room/activity.go |
| M15 | Activity pump | `:1630-1695,1341` | Delivers off the lane, with a queue bound of 256. The drain waits for it at most `CommitTimeout`. | NONE → P7 | room/activity.go |
| M16 | HTTP edit in the lane | `:597-868` | Order: load → lookup (Duplicate → 204 with the original sequence; Conflict → 409) → If-Match → plan → size gate → apply. A no-op → 204 with the current head and nothing recorded (`:781`). Exactly one local update allowed. | NONE → P1 | room/edit.go |
| M17 | Restore size gate | `:870-919` | Measures the planned update frame on a scratch doc that has the same client id. The limit is min(announced or 1 MiB, store limit). Over → 413. | NONE → P1 | room/edit.go |
| M18 | State read | `:921-987` | Reads the export and the head in one lane hold. Transient → Overloaded (503 + Retry-After). Any other failure → ExportFailed (500). | SC `page title: GET state…` (body only) | room/state.go |
| M19 | Checkpoint | `:989-1074,2895-2904` | Fires after 64 ops or 1 MiB since the last one, posted after the ack. Skipped while HasPending. Fence lost, bad sequence or bad data → fail. Other errors are retried; the 3rd fails. | PV `checkpoint lag replays the journal tail after a hard kill`; PV `a published checkpoint keeps every operation id it covers…` | room/checkpoint.go |
| M20 | Reset (journal) | `:1076-1250` | Hydrates, flushes to the endpoint with no token (`:1183`), retires the working set strictly (`:1197`), mints a new lineage, then closes C10. | PV `a reset starts a new lineage…`; SC reset test | room/reset.go |
| M21 | Reset (no journal) | `:1238-1262` | The new tag gets epoch+1 and a new lineage. Writes an empty working set. Closes C10. | SC reset test | room/reset.go |
| M22 | Purge | `:1267-1302` | Waits for the in-flight save and persist, then closes C9. | NONE → P1 | room/purge.go |
| M23 | Drain | `:1304-1356` | Flushes when Ready, then closes C2. Waits for the activity pump. | BC drain test; PV drain test | room/drain.go |
| M24 | Load (no journal) | `:1725-1808` | Reads the working set. A wrong format is migrated or reseeded. Empty → seed from the endpoint. A compacted log is persisted. A load failure may set `LoadHeldOff`. | SC seed and reconnect tests; `T/fixtures/collab-format1` | room/load.go |
| M25 | Load (journal) | `:1810-1878` | Uses the baseline, then the checkpoint, then the tail. No head → seed. Reads the endpoint version best-effort (`:1890-1905`). | PV hard-kill tests | room/load.go |
| M26 | Seed lineage rule | `:2294-2331` | Mints a new lineage only when the endpoint data is non-null or there is no lineage yet. The seed blob write is awaited. | SC `seeds a room from the doc endpoint…` | room/load.go |
| M27 | Export scheduling | `:3275-3356` | Debounce 2 s, max delay 10 s, doubling retry backoff (2 s to 60 s). A journal room exports only after a checkpoint, evict or drain. | SC `exports an edited document back…` | room/export.go |
| M28 | Export give-up | `:3358-3429` | After 8 runtime-limit failures, the projection is refused. A non-transient failure on a journal room is refused at once. | NONE → P6 | room/export.go |
| M29 | Save answer | `:3453-3496` | The answered `version` replaces the stored one. A failure re-marks the room dirty and backs off. | SC export test (version echo) | room/export.go |
| M30 | Eviction | `:3255-3273,3498-3550` | 30 s after the last member leaves, flushes, then drops the room. The blob or export must land first. | NONE → P2 | room/evict.go |
| M31 | Compaction | `:2527-2558`; `S/CollabRoomOptions.cs:15-18` | Compacts at 64 frames or 1 MiB of frames. No-journal rooms only. | NONE → P4 | room/compact.go |
| M32 | Recheck access | `:460-484` | Expels every member that fails with C9. Returns the count. | NONE → P2 | room/join.go |

### 2.G Room manager (`S/CollabRoomManager.cs`)

| # | Feature | C# location | What it does | Oracle | Go home |
| --- | --- | --- | --- | --- | --- |
| G1 | Join retry | `:198,257-301` | Up to 16 attempts. Checks purging → draining → cooldown → room. Past the attempts it throws. | NONE (internal) | `internal/collab/room/manager.go` |
| G2 | Commit and load cooldown | `:1018,1212-1250` | A room closed by a commit failure or `LoadHeldOff` blocks the doc for `Backoff(n)` (2 s doubling to 60 s). An ordinary close clears it. | PV S4 (`connectAfterOutage`) | manager.go |
| G3 | Purge tombstone | `:201,1020-1111` | Purge lanes are NEVER removed (only `:1064` adds one). A purged id is refused for the life of the process. Checks single-segment, `.` and `..` (`:1028`), and the authorize callback. A journal without the purge interface is refused. | NONE → P1 | manager.go |
| G4 | Drain | `:1114-1127` | Sets `draining` and drains all rooms in parallel until none are left. | BC drain test | manager.go |
| G5 | `DocumentReplaced` event | `:208,332,824,1080` | Fires on reset, applied restore and purge. Agent consumes it. | NONE (Agent area) | manager.go |
| G6 | 428 without a journal | `:373-399` | `If-Match` with no store → PreconditionRequired, before any room exists. | NONE → P1 | manager.go |
| G7 | History list | `:475-531` | Purge is checked before and after. A decode failure → Corrupt (500). | MCP (one GET) | `room/history.go` |
| G8 | Point read | `:533-574,867-930` | Replays baseline and records through the sequence. Adds `time`, plus `title`/`icon` from the page maps. | NONE → P1 | room/history.go |
| G9 | Changes window | `:576-729` | Window `(since, seq]`, at most 200 records and 4 MiB. When truncated it keeps the newest rows. Headers must match the records. | NONE → P1, P10 | room/history.go |
| G10 | Delete lineage | `:731-760` | Deleted → 204, Current → 409, NotFound → 404, Purged → 403. | NONE → P1 | room/history.go |
| G11 | Restore | `:762-830` | Digest = SHA-256(`restore\n{lineage}\n{sequence}`) (`:785`). Plans in the lane through `CollabRestorePlanner`. A missing point → 404. | NONE → P1, P9 | room/history.go |
| G12 | Recheck API | `:976-987`; `S/ICollabRoomManager.cs` | Rechecks only a loaded room. Returns the expelled count. | NONE → P2 | `pkg/collab` |

### 2.E Edit endpoint (`A/EditEndpoint.cs`) and edit ops (`S/CollabEditOps.cs`)

| # | Feature | C# location | What it does | Oracle | Go home |
| --- | --- | --- | --- | --- | --- |
| E1 | Refusal order | `A/EditEndpoint.cs:26-134`; protocol §12.2 | Order: guard → 400 doc id → 403 other doc → 403 hook → 400 key → 400 If-Match → 413 body → 422 parse. | NONE → P1 | `internal/httpapi/collab/edit.go` |
| E2 | `Blok-Idempotency-Key` | `A/EditEndpoint.cs:22,66-76`; `S/CollabEditOps.cs:137-157` | Exactly one header of 1–128 chars, all in 0x20–0x7E. The op id is the hex of the first 16 bytes of SHA-256(ASCII key). | NONE → P1, P3 | edit.go, `convert/editops.go` |
| E3 | If-Match grammar | `A/EditEndpoint.cs:276-308` | One quoted strong tag `"<lineage>:<seq>"` with a canonical decimal. Refuses `*`, `W/`, lists and leading zeros. | NONE → P1 | edit.go |
| E4 | Body cap | `A/EditEndpoint.cs:92-102,314-335` | Counts bytes while reading in 8 KiB chunks. Over `CollabMaxMessageBytes` → 413. Content-Length is not trusted. | NONE → P1 | edit.go |
| E5 | Ops schema | `S/CollabEditOps.cs:79-133,310-340`; `:454-470` | `{"ops":[…]}` with at least one op. Op kinds: insert, update, remove. Members form a closed set. Any NUL anywhere → 422. Depth 512, duplicate keys refused. | NONE → P1 | convert/editops.go |
| E6 | Canonical body digest | `S/CollabEditOps.cs:161-185,282` | SHA-256 over sorted-key JSON. See trap T2. | NONE → P3 | convert/editops.go |
| E7 | Result mapping | `A/EditEndpoint.cs:137-228` | Applied → 204 + head. 412 + head. 428, 409, 422, 503 + Retry-After (Overloaded), 413 (TooLarge), 403 (Purged), 503. | NONE → P1 | edit.go |
| E8 | Head headers and CORS expose | `A/EditEndpoint.cs:231-263` | Sets `Blok-Doc-Lineage` and `Blok-Doc-Sequence`. Merges them, with `ETag`, into `Access-Control-Expose-Headers`, but only when ACAO is present. | NONE → P1 | edit.go |
| E9 | HTML field cap | `S/CollabDocConverter.cs:36,74-78` | One HTML string over 32768 UTF-16 units → 413, checked before any read. | NONE → P1 | convert/docconverter.go |
| E10 | Agent-only ops | `S/CollabEditOps.cs:44-74` | PatchMaps, SetPageField, Move, Lift, Retype, SetTunes, SetMetadata. Never parsed from `/edit`. | `T/agent-move-fixture.test.ts`, `T/agent-page-fields-fixture.test.ts` (fixtures `agent-moves.json`, `agent-page-fields.json`) | convert/editops.go |

### 2.S State and reset endpoints

| # | Feature | C# location | What it does | Oracle | Go home |
| --- | --- | --- | --- | --- | --- |
| S1 | State door | `A/StateEndpoint.cs:19-56` | 400 doc id, 403 other doc, read hook only. | NONE → P1 | `internal/httpapi/collab/state.go` |
| S2 | State body and head | `A/StateEndpoint.cs:63-76` | Sends `Cache-Control: no-store`. With a journal it also sends `Blok-Doc-*` and an ETag that is a valid If-Match. | SC `page title: GET state…` (body only) | state.go |
| S3 | State statuses | `A/StateEndpoint.cs:78-113` | Purged 403. Unavailable 503. Overloaded 503 + Retry-After. ExportFailed 500. Default 503. | NONE → P1 | state.go |
| S4 | Reset | `A/ResetEndpoint.cs:14-88` | Same door with read AND write hooks. Reset 204, Purged 403, Unavailable 503 `…unavailable, retry`, else 503 `…could not be loaded`. | SC `resets a document: 204, open sockets close 4409…` | `reset.go` |

### 2.Y History endpoint (`A/HistoryEndpoint.cs`)

| # | Feature | C# location | What it does | Oracle | Go home |
| --- | --- | --- | --- | --- | --- |
| Y1 | Shared admit | `:309-357` | Sends `no-store` first, then the doc id, ticket-doc and hook checks. Write is required for DELETE and restore. | NONE → P1 | `internal/httpapi/collab/history.go` |
| Y2 | List body | `:44-93` | `{lineages:[{lineage,epoch,format,createdAt,current}],versions:[{lineage,sequence,startedAt,savedAt,actors}]}`. Times in ms or null. | MCP (one GET) | history.go |
| Y3 | `group` query | `:51,387-406` | Absent, 1, 15 or 60. Empty, signed or repeated → 400 `group must be 1, 15 or 60`. | NONE → P1 | history.go |
| Y4 | Version grouping | `S/CollabVersionTimeline.cs:19-26` | A new group starts when the gap exceeds 2 min or the span reaches 10 min. A negative gap counts as 0. The `group=W` window replaces both. | NONE → P8 | `convert/timeline.go` |
| Y5 | Point read | `:95-120` | `Blok-History-Lineage` and `Blok-History-Sequence`, exposed. No ETag. | NONE → P1 | history.go |
| Y6 | Sequence and lineage parsing | `:360-381,409-421` | `ulong` with `NumberStyles.None` → 400. A non-lineage → 404 `no such version`. | NONE → P1 | history.go |
| Y7 | Changes body | `:126-200,432-490` | Newest rows first, always at least one, capped at 4 MiB with a 32-byte envelope. Kinds: added, removed, changed, moved. `page` is optional. `"truncated":true` only when truncated. | NONE → P1, P10 | history.go |
| Y8 | `since` | `:134-142` | Defaults to 0. Above the sequence, or malformed → 400. | NONE → P1 | history.go |
| Y9 | Delete | `:202-247` | 204, 409 `the document is on this lineage…`, 404, 403. | NONE → P1 | history.go |
| Y10 | Restore | `:249-303` | Needs the key. If-Match is optional. Answers like edit (E7). 501 when there is no history, never 428. | NONE → P1 | history.go |
| Y11 | Refusal statuses | `:497-546` | 501 `history needs a journal that keeps it`, 404, 403, 503 + Retry-After, 500 export, 500 corrupt (logged as event id 3 `CollabHistoryCorrupt`). | NONE → P1 | history.go |
| Y12 | Changes diff semantics | `S/CollabVersionChanges.cs:38-40,52,152,201`; `S/CollabLongestKeptOrder.cs:13` | Matches blocks by id. Changed beats moved. Moved uses the longest kept subsequence. Page keys, then `values.<k>`, in ordinal order. | NONE → P10 | convert/changes.go |
| Y13 | Restore planner | `S/CollabRestorePlanner.cs:37-148` | Forward edits to the target. A type or tunes change → remove plus insert. Patches `page`/`values` maps with plain-JSON keys only. | NONE → P9 | convert/restore.go |

### 2.D Doc endpoint client (`S/DocEndpointClient.cs`)

| # | Feature | C# location | What it does | Oracle | Go home |
| --- | --- | --- | --- | --- | --- |
| D1 | GET seed | summary at `:60-66`; `:216-280` | `GET {endpoint}/{escaped id}`, `Accept: application/json`. The body may be bare OutputData, a `{data,version}` envelope (data may be null) or a bare `null`. | SC `seeds a room from the doc endpoint…` (via `T/doc-endpoint.ts`) | `internal/collab/docendpoint/client.go` |
| D2 | PUT export | `:81-87` and SaveAsync | Bare JSON with `Blok-Doc-Version` (when known), plus `Blok-Doc-Lineage` and `Blok-Doc-Sequence` on a journal room. The answer's `version` is adopted. | SC `exports an edited document back to the doc endpoint with the served version` | client.go |
| D3 | Version value | `:281-297` | A string, or a number formatted with `double.ToString(Invariant)`. Anything else → error. | NONE → P6 | client.go |
| D4 | One-segment URL guard | `:316` | After escaping and URI normalising, the URL must still hold exactly one segment, or it is refused. | NONE → P6 | client.go |
| D5 | Authorization header | `:343` | Sent verbatim. A CR or LF → error (the options also refuse it at startup). | NONE → P6 | client.go |
| D6 | Limits | `:25,90,208-212,444-453`; `AC/BlokServerServiceCollectionExtensions.cs:15` | 64 MiB response cap. 512-byte error prefix. No redirects. 10 s connect. 5 min pool lifetime. 30 s request timeout. | NONE → P6 | client.go |
| D7 | JSON depth and duplicates | `:189` and the reader options | Depth 512 both ways. Duplicate properties refused. | NONE → P6 | client.go |

### 2.P Stores and on-disk formats

| # | Feature | C# location | What it does | Oracle | Go home |
| --- | --- | --- | --- | --- | --- |
| P1r | Doc key | `S/CollabDocKey.cs:15-20` | Lower-hex SHA-256 of the UTF-8 doc id. Names every file and S3 key. | PV (`docKey()` in the test) | `internal/collab/workingset/key.go` |
| P2r | Working-set blob `BKW2` | `S/CollabWorkingSetCodec.cs:23-26` | 32-byte header: magic, int32 format, int64 epoch, 16-byte lineage. Then int32 LE-length frames. | NONE → P4 | workingset/codec.go |
| P3r | Working-set tag | `S/CollabWorkingSetTag.cs:25-34` | Formats 1 (HTML) and 2 (XmlText, the current one). Lineage is 32 lower-hex chars. | `sync-frames.json` `blokControl` | workingset/tag.go |
| P4r | Local working-set store | `S/LocalCollabStore.cs:29,71,93-95,126,146,215-236,310-321,404,431` | Atomic temp-and-rename, fsync of the dir. An unreadable file moves aside to `.unreadable-<UTC>`. Epoch guards. Temp sweep (older than 1 min). Modes 0600/0700. | SC (ordinary host) | workingset/local.go |
| P5r | S3 working-set store | `S/S3CollabStore.cs:7-35,142-144` | Key `{prefix trimmed of /}/{docKey}`. An empty prefix is refused. | NONE (storage area) → P4 | workingset/s3.go |
| P6r | Journal record codec | `S/CollabJournalCodec.cs:37-131,137,206,229,324-327` | 38-byte header (len, ver=1, source, SHA-256). The body holds the op id (16 raw bytes), seq, committedAt as .NET UTC TICKS, actor (−1 = null), digest, update, SHA-256. Caps: 32 MiB update, 4 KiB actor. Torn tail vs corruption are told apart. | PV `a torn final journal record is dropped…`, PV `middle journal corruption refuses to serve the document` | `internal/collab/journal/codec.go` |
| P7r | Lineage ledger `lineages` | `S/CollabLineageLedger.cs:46-113` | Fixed 61-byte entries: kind, gen, gen fence, lineage, epoch, format, ticks (long.MinValue = unknown), then 8 bytes of SHA-256. Skips bad entries. Pads a torn tail. | NONE → P4 | journal/ledger.go |
| P8r | Local op store layout | `S/LocalCollabOperationStore.cs:16-25,100-128,169-173,972-997` | `<dir>/<key>.journal/` holds `lock`, `manifest` (`BKJM`, 2×128-byte slots), `lineages`, `journal.<gen>.<fence>`, `baseline.<gen>.<fence>` (`BKJB`) and `checkpoint.<gen>.<through>.<fence>` (`BKJC`), plus a `purged` marker. | PV (reads names, offsets and the manifest directly) | journal/store.go |
| P9r | Sealed files | `S/LocalCollabOperationStore.cs:1408-1430` | 24-byte header (magic, ver=1, uint64 tag, int64 len), the content, then SHA-256. Each is fsynced. | PV checkpoint tests (indirect) | journal/store.go |
| P10r | Manifest slot | `S/LocalCollabOperationStore.cs:1179-1215` | Magic, ver=2, seeded, writeCounter, fence, gen, format, epoch, lineage, ckptThrough, genFence, ckptFence, then SHA-256 over 96 bytes. | PV S4 (zeroes the manifest) | journal/store.go |
| P11r | Fence and lock | `S/LocalCollabOperationStore.cs:72-87` (remarks), `:1020-1035,1548` | The lock file is opened exclusively for liveness. Every write re-reads the manifest fence, and an append checks it again after flush. How .NET locks on Unix (flock or not) is UNVERIFIED. | PV hard-kill tests | journal/store.go |
| P12r | Import of a working set | `S/LocalCollabOperationStore.cs:888` | Imports a legacy working set on first open. An undecodable one fails CLOSED. It must run before `LocalCollabStore.ReadAsync` moves it aside. | NONE → P4 | journal/import.go |
| P13r | Purge and history reads | `S/LocalCollabOperationStore.cs:185-356,633` | Purge marker. Lock-free history reads. Delete-lineage outcomes. | NONE → P1 | journal/history.go |
| P14r | `MaxUpdateBytes` | `S/LocalCollabOperationStore.cs:100`; `A/CollabOperationStoreSource.cs:34` | 1 MiB append limit, fed to the restore gate (M17). | NONE → P1 | journal/store.go |

### 2.X Converter, rich text and text diff

| # | Feature | C# location | What it does | Oracle | Go home |
| --- | --- | --- | --- | --- | --- |
| X1 | Seed JSON → doc | `S/YDocConverter.cs:149-268` | Blocks, the root order and the page map. Grids get `__rows`/`__rowKeys` with 10-char keys. | `T/fixtures/collab/<32 cases>` (`input.json` → `canonical*.json`), C# `YDocConverterConformanceTests` | `internal/collab/convert/ydoc.go` |
| X2 | Export doc → JSON | `S/YDocConverter.cs:587-626` | Normalises cycles, orphans, dangling refs, duplicates and malformed blocks. Max value depth 256. JSON depth 512 (`:58,75`). | `fixtures/collab` (`update.b64` → canonical) | ydoc.go |
| X3 | Page maps | `S/YDocConverter.cs:269,627-705` | Title and icon live in `page`. Plain-map reads and equality. | `fixtures/collab/page-*`; SC page-title tests | ydoc.go |
| X4 | Apply ops | `S/YDocConverter.cs:390-480` | Insert, update and remove, plus the agent ops. Diff-merges text (X8) and pairs array elements (`RowSimilarity` `:2616`). | `T/fixtures/agent-*.json`; NONE for /edit → P1 | ydoc.go |
| X5 | Diffable and ordered-id key sets | `S/YDocConverter.cs:101,124` | Key lists that must equal the client's. | `T/server-concurrent-loss.test.ts` `key-set lockstep with the C# converter` (PARSES C# SOURCE) → P5 | ydoc.go |
| X6 | Format-1 migration | `S/YDocConverter.cs:481-586` | HTML `Y.Text` → formatted `Y.XmlText`. New lineage, epoch+1. 60 s read timeout (`S/CollabDocConverter.cs:25`). | `T/fixtures/collab-format1` + `collab-format1-fixtures.test.ts` | convert/migrate.go |
| X7 | Rich text canonical | `S/RichText.cs:37-280` | Segments ↔ delta, canonical marks. | `T/fixtures/rich-text-canonical` + `rich-text-canonical-fixtures.test.ts`; `fixtures/rich-text-fields.json` | convert/richtext.go |
| X8 | Rich-text edit planner | `S/RichTextEdit.cs:9-104` | Insert, InsertEmbed (U+FFFC), Delete and Format ops against the live delta. | `T/fixtures/rich-text-edits/cases.json` (25 cases) + `rich-text-edit-fixtures.test.ts`, C# `RichTextEditFixtureTests` | convert/richtextedit.go |
| X9 | TextDiff | `S/TextDiff.cs:53-100,311` | Myers over atoms (tag, entity, grapheme). Cap 64, 3-atom anchors, FNV hash, JS `\s`. UTF-16 indices. | `T/server-concurrent-loss-wave2.test.ts` `GB9c tables…` (PARSES C# SOURCE) → P5 | convert/textdiff.go |
| X10 | Rich fields config | `S/RichTextFields.cs:44-75`; `AC/BlokServerOptions.cs:456` | Built-in plus custom `{type:[fields]}`. Invalid → startup refusal. | `fixtures/rich-text-fields.json` | convert/fields.go |
| X11 | Runtime HTML reader | `S/RichTextHtmlReader.cs:35` + summary | Batches up to 32K chars per runtime call. Timeouts → transient (503). | NONE → P1 (needs a runtime) | convert/htmlreader.go |
| X12 | History replay | `S/CollabHistoryReplay.cs:15-42` | Builds a doc from the baseline plus the records through a sequence. | PV (indirectly) → P10 | convert/replay.go |

### 2.O Options, flags, env vars and startup refusals

| # | Feature | C# location | What it does | Oracle | Go home |
| --- | --- | --- | --- | --- | --- |
| O1 | `CollabEnabled` / `--collab` | `AC/BlokServerOptions.cs:148`; `H/HostArguments.cs:50-51,132-146` | Maps the sync routes. Needs `--doc-endpoint`. | SC (whole) | `internal/config` |
| O2 | `DocEndpoint`, `DocEndpointAuth` / `BLOK_DOC_ENDPOINT_AUTH` | `AC/BlokServerOptions.cs:155,164`; refusals in `:413-560` | Must be absolute http(s) with no userinfo, query or fragment. HTTP only on loopback. Auth must not hold CR or LF. | NONE → P12 | config |
| O3 | `CollabDirectory` / `--collab-dir` (default `./blok-collab`) | `AC/BlokServerOptions.cs:171`; `H/HostArguments.cs:56-57,78,251-252` | Must not resolve inside `--storage-dir` (a lexical check). | NONE → P12 | config |
| O4 | `CollabS3Prefix` / `--collab-s3-prefix` | `AC/BlokServerOptions.cs:178`; `H/HostArguments.cs:58-59,254-255` | Needs `--s3-bucket` and `--collab`. | NONE → P12 | config |
| O5 | `CollabJournal` / `--collab-journal` / `BLOK_COLLAB_JOURNAL` | `AC/BlokServerOptions.cs:189`; `H/HostArguments.cs:60-62,150-166,287-296` | Needs `--collab`. Refused together with `--collab-s3-prefix`. Turns on v2. | PV runs on `--conformance-journal` (`H/ConformanceArguments.cs:40`) | config |
| O6 | Numeric limits | `AC/BlokServerOptions.cs:195-253,413-473` | Per-user 8 (>0), max connections 0 (≥0), message 1 MiB (>0), keep-alive 15 s (≥0), frames 50/s (≥0), burst 100 (>0), resyncs 60/min (≥0), awareness 128 KiB/s (≥0). | NONE → P12 | config |
| O7 | Host caps | `H/HostCollab.cs:23,31,38,46,63` | 30 s shutdown, 1024 upgraded connections, which also become `CollabMaxConnections`. | NONE → P2 | `cmd/blok-server` |
| O8 | Drain on SIGTERM | `H/HostCollab.cs:77-117` | Drains in `StoppingAsync`. On failure it writes `warning: collab: the shutdown drain did not complete: …` to stderr. | BC drain test | cmd/blok-server |
| O9 | Collab log category | `AC/BlokServerServiceCollectionExtensions.cs:16-17`; `H/HostCollab.cs:126-128` | `Blok.Server.Collab` warnings go to stderr as one line each. | NONE (log text) | internal/log |
| O10 | Conformance journal flag | `AC/BlokServerConformanceExtensions.cs:29-44`; `H/ConformanceArguments.cs:40-42` | Test-only build registers `LocalCollabOperationStore`. | PV, BC, MCP | `cmd/blok-server/conformance.go` (build tag, as in `ad5782d7^`) |

### 2.T Public host seams (public C# types)

| # | Feature | C# location | What it does | Oracle | Go home |
| --- | --- | --- | --- | --- | --- |
| T1 | `ICollabOperationStore` / `ICollabOperationSession` | `S/ICollabOperationStore.cs:124-127,249-…` | `OpenAsync` → Opened, DocumentOpenElsewhere or Purged. Session: FindCommitted, Append, WriteCheckpoint, Reset, Dispose. | NONE → P13 | `pkg/collab/store.go` |
| T2 | `ICollabOperationPurgeStore`, `ICollabOperationHistoryStore` | `S/ICollabOperationStore.cs:203`; `S/ICollabOperationHistoryStore.cs:53` | Purge, list lineages, baseline, headers, records, delete lineage. | NONE → P13 | pkg/collab/history.go |
| T3 | Records | `S/CollabOperation.cs:11-268` | Source enum 0=ClientV2, 1=ClientV1, 2=HttpEdit (the byte on disk). Head, Checkpoint, Record, Candidate, Lookup, Append, Reset, OpenResult. | PV journal byte checks | pkg/collab/types.go |
| T4 | `CollabOperationFenceLostException` | `S/ICollabOperationStore.cs:72-90` | Fails the room (M19). | NONE → P13 | pkg/collab/errors.go |
| T5 | `ICollabActivityObserver` | `S/ICollabActivityObserver.cs:4-48` | Kinds: Joined, Active, Edited, Left. `RecordAsync(doc, actor, at, kind)`. | NONE → P7 | pkg/collab/activity.go |
| T6 | `ICollabRoomManager`, `ICollabDocumentPurger` | `S/ICollabRoomManager.cs:9`; `S/ICollabDocumentPurger.cs:4` | Drain, RecheckAccess, PurgeDocument(authorize). | NONE → P1 | pkg/collab/manager.go |
| T7 | Builder hooks | `AC/BlokServerBuilderExtensions.cs:22,56,81` | `UseAuthorization<T>`, `UseCollabOperationStore<T>`, `UseCollabActivityObserver<T>`. | NONE (Go: option funcs) | `pkg/blokserver/options.go` |

## 3. Timers, limits and constants (one place)

| Constant | Value | C# location |
| --- | --- | --- |
| ExportDebounce / ExportMaxDelay | 2 s / 10 s | `S/CollabRoomOptions.cs:6,9` |
| EvictionLinger | 30 s | `S/CollabRoomOptions.cs:12` |
| Compaction frames / bytes | 64 / 1 MiB | `S/CollabRoomOptions.cs:15,18` |
| Checkpoint ops / bytes | 64 / 1 MiB | `S/CollabRoomOptions.cs:28,31` |
| MaxAwarenessClients | 256 | `S/CollabRoomOptions.cs:38` |
| RetryBackoff / cap / formula | 2 s doubling, at most 16 steps, cap 60 s | `S/CollabRoomOptions.cs:56,59,71-77` |
| CommitTimeout (each store call, activity drain wait) | 10 s | `S/CollabRoomOptions.cs:68`; `S/CollabRoom.cs:1341` |
| MalformedAwarenessLimit | 3 | `S/CollabRoom.cs:98` |
| CheckpointFailureLimit | 3 | `S/CollabRoom.cs:101` |
| TransientExportFailureLimit | 8 | `S/CollabRoom.cs:110` |
| ActivityWindow | 55 s | `S/CollabRoom.cs:124` |
| ActivityQueueLimit / ActivityStampLimit | 256 / 256 | `S/CollabRoom.cs:133,154` |
| MaxJoinAttempts | 16 | `S/CollabRoomManager.cs:198` |
| Changes rows / bytes / envelope | 200 / 4 MiB / 32 B | `S/CollabRoomManager.cs:576,582`; `A/HistoryEndpoint.cs:33` |
| Timeline idle gap / max span | 2 min / 10 min | `S/CollabVersionTimeline.cs:19-20` |
| MaxEditHtmlChars / MaxCallChars | 32768 UTF-16 units | `S/CollabDocConverter.cs:36`; `S/RichTextHtmlReader.cs:35` |
| MigrationReadTimeout | 60 s | `S/CollabDocConverter.cs:25` |
| MaxValueDepth / JsonMaxDepth | 256 / 512 | `S/YDocConverter.cs:58,75` |
| TextDiff cap / anchor atoms / max entity | 64 / 3 / 32 | `S/TextDiff.cs:53,61,69` |
| MaxVarUintBytes / MaxAwarenessClientId | 10 / 2^53−1 | `S/SyncWire.cs:122,140` |
| Journal max update / max actor | 32 MiB / 4 KiB | `S/CollabJournalCodec.cs:125,128` |
| Local store DefaultMaxUpdateBytes | 1 MiB | `S/LocalCollabOperationStore.cs:100` |
| Doc endpoint: response cap / error prefix / connect / pool / request | 64 MiB / 512 B / 10 s / 5 min / 30 s | `S/DocEndpointClient.cs:25,90,209,212`; `AC/BlokServerServiceCollectionExtensions.cs:15` |
| Socket: receive buffer / slack / bytes per receive | 16 KiB / 16 / 64 | `A/SyncSocketMember.cs:25,36,38` |
| Close grace / rejected grace | 5 s / 250 ms | `A/SyncSocketMember.cs:41`; `A/SyncEndpoint.cs:20` |
| Outbound queue factor | 8 × message cap | `A/SyncEndpoint.cs:13` |
| Budget: amplifier burst / awareness burst | 10 / 512 KiB | `A/SyncInboundBudget.cs:27,35` |
| Option defaults | see O6 | `AC/BlokServerOptions.cs:195-253` |
| Host shutdown / max upgraded | 30 s / 1024 | `H/HostCollab.cs:23,31` |

## 4. Proposed shared oracles (for rows marked NONE)

| ID | Proposal | Covers |
| --- | --- | --- |
| P1 | `T/collab-http-contract.test.ts` against both binaries. It covers `/edit`, `/state`, `/reset` and every history route: the refusal order (§12.2), idempotency (dedupe and 409), If-Match (400/412/428), the no-op 204, 413 body and HTML, the Retry-After shape, expose headers, `no-store`, history list/point/changes/delete/restore bodies, purge tombstone. Today `/edit` has ZERO black-box coverage: grep found no `/edit` in `T/*.test.ts`. | R2–R9, E*, S*, Y*, G3, G6–G11, M16–M17, M22 |
| P2 | `T/sync-transport-contract.test.ts` with raw sockets. It covers every close code and reason (C*), 426/400/403/429/503 before the upgrade, connection caps (run the host with a low cap), text frame, oversize, an empty-fragment flood (the 17th fragment), budget closes, a non-canonical varuint SyncStep1, keep-alive abort, forbidden-overtakes, the 250 ms rejected grace, recheck expel. | H*, W*, C*, M3, M5, M30, M32 |
| P3 | `T/fixtures/canonical-edit-digest.json`: `{body, canonicalBody, digestHex}` and `{key, operationId}` vectors, plus the restore digest. Include non-ASCII, astral keys versus U+FF61, `<>&'+`, `1.0`/`1e2`/big ints and `A` escapes. Both languages assert the bytes. | E2, E6, G11 |
| P4 | `T/fixtures/collab-disk/`: golden files C# writes (a working-set blob, a journal with 3 records including a null actor, a ledger, both manifest slots, baseline and checkpoint). Go must read them and write identical bytes, given a fixed clock and ids. | P2r, P5r–P14r, M31 |
| P5 | `T/fixtures/converter-keys.json` (diffable keys, ordered-id keys, GB9c tables). Both languages read it, instead of the TS test parsing `YDocConverter.cs` and `TextDiff.cs` source by path. | X5, X9 |
| P6 | Extend `T/doc-endpoint.ts`: record request headers, answer a numeric `version`, slow, oversized, 3xx and error responses. Covers the version echo format and the timeout. | D*, M28 |
| P7 | A conformance-only activity sink: a flag that writes each `RecordAsync` as one stderr JSON line. Plus a test for Joined/Active/Edited/Left, the 55 s suppression, and no calls for a null actor. | M14, M15, T5 |
| P8 | `T/fixtures/version-timeline.json`: header lists, then expected groups for the default and for 1/15/60. | Y4 |
| P9 | `T/fixtures/restore-plans.json`: current blocks, structure and target, then expected ops. | Y13, G11 |
| P10 | `T/fixtures/version-changes.json`: record replays, then change rows (kinds, order, page keys). | Y7, Y12, X12 |
| P11 | `T/fixtures/awareness.json`: valid, over-cap and malformed payloads; ownership sequences, then expected 107 frames; removal bytes. | F10, F11, M12, M13 |
| P12 | A startup-refusal contract: the exit code and the stderr line for each invalid flag combination (likely shared with the host/config area). | O2–O6 |
| P13 | A store-seam contract test suite (Go: an exported `collabtest.RunStoreContract(t, store)`; C#: `FakeCollabOperationStoreTests` as the source of cases). | T1–T4 |
| P0 | The runner: add `--target go` to `scripts/test-server-conformance.mjs`. Today `:39-52` accept only `csharp`, and `:108-171` build only dotnet. Go builds an ordinary binary and a `-tags conformance` binary. Both must print `listening on` to stderr (`run-against.ts`). | everything |

## 5. C# unit tests that need Go equivalents

There are 1047 `[Fact]`/`[Theory]` attributes across `Blok.Server.Tests/Collab/*.cs` and `Blok.Server.AspNetCore.Tests/Collab/*.cs`, plus 339 `InlineData` rows. The command was `grep -cE '^\s*\[(Fact|Theory)'`.

| Count | File |
| --- | --- |
| 207 | `Blok.Server.Tests/Collab/CollabRoomTests.cs` |
| 52 | `CollabRoomManagerTests.cs` |
| 48 | `AspNetCore.Tests/Collab/SyncEndpointTests.cs` |
| 36 | `AspNetCore.Tests/Collab/HistoryEndpointTests.cs` |
| 35 | `AspNetCore.Tests/Collab/SyncHandshakeTests.cs` |
| 32 each | `YDocConverterHardeningTests.cs`, `LocalCollabOperationStoreTests.cs`, `AspNetCore.Tests/Collab/EditEndpointTests.cs` |
| 31 | `CollabHistoryManagerTests.cs` |
| 29 each | `YDocConverterLawTests.cs`, `DocEndpointClientTests.cs` |
| 28 | `Blok.Server.Tests/CollabDurabilityArchitectureTests.cs` (pins every fsync call; Go needs a source-scan law test) |
| 27 | `YDocConverterEditTests.cs` |
| 24 each | `SyncWireTests.cs`, `CollabRestorePlannerTests.cs` |
| 23 each | `YDocConverterRichTextTests.cs`, `LocalCollabOperationHistoryTests.cs` |
| 21 | `TextDiffTests.cs` |
| 20 each | `CollabVersionChangesTests.cs`, `CollabRoomMigrationTests.cs` |
| 19 | `CollabWorkingSetCodecTests.cs` |
| 18 each | `YDocConverterConcurrentLossTests.cs`, `LocalCollabStoreTests.cs` |
| 17 | `FakeCollabOperationStoreTests.cs` |
| 16 | `SyncWireFramingTests.cs` (reads `sync-frames.json`) |
| 15 | `Blok.Server.Host.Tests/HostCollabTests.cs` (reads `fixtures/collab`) |
| 14 | `CollabDocConverterTests.cs` |
| 13 each | `CollabVersionTimelineTests.cs`, `AgentRoomOpsTests.cs` |
| 12 each | `YDocConverterMigrationTests.cs`, `S3CollabStoreTests.cs`, `AspNetCore.Tests/Collab/StateEndpointTests.cs` |
| 11 | `YDocConverterTextDiffTests.cs` |
| 10 each | `AspNetCore.Tests/Collab/SyncSocketMemberTests.cs`, `ResetEndpointTests.cs` |
| 9 each | `YDocConverterTextMergeTests.cs`, `CollabEditOpsTests.cs` |
| 8 each | `TableDataLossAuditTests.cs`, `CollabJournalCodecTests.cs` |
| 7 each | `YDocConverterDatabaseRowTitleTests.cs`, `YDocConverterDatabaseRelationTests.cs`, `YDocConverterConformanceTests.cs` (fixtures/collab), `S3BlobStoreObjectMethodsTests.cs`, `CollabHistoryReplayTests.cs` |
| 5 | `RichTextFieldsTests.cs` |
| 4 each | `YDocConverterDatabaseStructureTests.cs`, `RuntimeRichTextHtmlReaderTests.cs`, `CollabDocKeyTests.cs` |
| 3 each | `YDocConverterViewSettingsTests.cs`, `RichTextMalformedTests.cs`, `RichTextCanonicalTests.cs` |
| 2 each | `YDocConverterTableRowIdsTests.cs`, `YDocConverterCellBlockIdsTests.cs`, `TextDiffGraphemeTests.cs`, `RichTextEditFixtureTests.cs`, `CollabLongestKeptOrderTests.cs` |
| 1 each | `LocalCollabStoreDirectoryModeTests.cs`, `AspNetCore.Tests/Collab/JournalFailureGateTests.cs` |

The support files have no tests but carry fakes worth porting: `CollabRoomTestSupport.cs` (1676 lines), `SyncTestSupport.cs` (1266 lines) and `S3CollabTestSupport.cs`.

## 6. Traps (a port would get these silently wrong)

| # | Trap | Evidence |
| --- | --- | --- |
| T1 | **The on-disk journal is part of the black-box contract.** PV reads `sha256(docId).journal/`, the `journal.`/`baseline.`/`checkpoint.` prefixes, 38-byte record headers and the actor at body+32/+36. It also zeroes `manifest`. A Go store with any other layout fails PV. | `T/protocol-v2-contract.test.ts:71,253-258,271-340,722-727,1085-1116` |
| T2 | **The canonical edit digest is .NET-specific.** `Utf8JsonWriter` escapes every non-ASCII char and `<>&'+` as UPPERCASE `\uXXXX`. Number tokens are kept verbatim (`1.0`, `1e2`, a 23-digit int). `A` is decoded to `A`. Keys are sorted by UTF-16 ordinal, so U+1F600 (`\uD83D…`) sorts BEFORE U+FF61. Go's byte order puts them the other way round. A Go server reading a C# journal would answer 409 to a legit retry. | Probe `scratchpad/collab/digest/probe.cs`. Output: `{"a":"é<>&'+A","b":1.0,"big":12345678901234567890123,"n":1e2,"😀":3,"｡":2}`; `S/CollabEditOps.cs:161-185,282` |
| T3 | **Time on disk is .NET ticks**: 100 ns units since 0001-01-01 UTC. The ledger uses `long.MinValue` for unknown. | `S/CollabJournalCodec.cs:206,324-327`; `S/CollabLineageLedger.cs:55,69,101-113` |
| T4 | **The WebSocket libraries hide empty fragments**, so the fragment-flood close (W13) cannot be ported on top of them. | gorilla `conn.go:1044-1076` (v1.5.3) and coder `read.go:458-479` (v1.8.15) both loop over continuation frames inside `Read` |
| T5 | **Rich-text HTML needs the client's JS reader**, run in the embedded runtime. Without a runtime, seed, edit and migration of HTML fields cannot reach parity. | `S/RichTextHtmlReader.cs` summary, `:35` |
| T6 | **UTF-16 everywhere.** TextDiff indices, the Y.Text lengths and the 32768-char HTML cap all count UTF-16 code units. Go strings are UTF-8. TextDiff also uses a Unicode 17 grapheme/GB9c table and JS `\s` (not .NET's). | `S/TextDiff.cs:1-4,84`; `S/CollabDocConverter.cs:74`; `T/server-concurrent-loss-wave2.test.ts` `TABLE_UNICODE = '17.0'` |
| T7 | **The lockstep tests parse C# source by path.** A Go port has no equivalent guard until P5 exists. | `T/server-concurrent-loss.test.ts:182-205` (`csharpKeyList(source, …)`); wave2 `csharpMethodBody(source, 'RowSimilarity')`, `DIFF_PATH` |
| T8 | **The purge tombstone never clears.** After a purge, the doc id answers Purged/403 until the process restarts. | `S/CollabRoomManager.cs:201,1057-1064` (no `Remove` anywhere: `grep -n purgeLanes`) |
| T9 | **Two "forbidden" shapes.** A hook read-denial → accept, then 4403. A room Forbidden/Purged at join → plain HTTP 403 before the upgrade. | `A/SyncHandshake.cs:202-205`; `A/SyncEndpoint.cs:161-166` |
| T10 | **Rate-limit spending.** A refusal (plain HTTP) does not spend the limit. A rejection (accept, then close) does. | `A/SyncHandshake.cs:77-87` |
| T11 | **v1 vs v2 broadcast.** v2 broadcasts to everyone, the sender included, then acks. v1 broadcasts to the others only, with no ack, and journals under a minted id only when `ApplyResult.Changed`. Byte-level "did anything change" is wrong both ways. | `S/CollabRoom.cs:2822,2987,2993,3016`; `Blok.Server/Yjs/ApplyResult.cs` remarks |
| T12 | **Lineage before lookup.** The lineage-mismatch check runs before the id lookup, or an old-lineage id is answered as a duplicate. | `S/CollabRoom.cs:2742-2748`; protocol S7 |
| T13 | **Join frame order** is 100 → 101 (only if a cap is announced) → 107 (even when empty), then queryAwareness to the OTHERS. The server does NOT send its own SyncStep1 on join; it sends one only in answer to the client's. | `S/CollabRoom.cs:435-453,2662-2693` |
| T14 | **Awareness JSON depth is 64.** `Utf8JsonReader` defaults refuse a state nested more than 64 deep, so it counts as malformed. Go's `encoding/json` accepts much deeper. A removed entry is detected by the exact bytes `null`. | Probe output `depth65 fail: The maximum configured depth of 64 has been exceeded`; `S/SyncWire.cs:1710,1739-1758` |
| T15 | **Number equality.** `JsonNode.DeepEquals(1, 1.0)` is true. It drives `RowSimilarity` pairing and restore and changes equality. | Probe output `True`; `S/YDocConverter.cs:2616-2645` |
| T16 | **The doc-endpoint numeric version is formatted the .NET way**: `1E+21`, while Go `strconv` gives `1e+21`. It is echoed back in `Blok-Doc-Version`. | Probe output `1E+21 0.30000000000000004`; `S/DocEndpointClient.cs:297` |
| T17 | **Coder/websocket defaults differ.** The read limit is 32768 and its own 1009 close text replaces `message too big`. Subprotocol matching is `EqualFold`, where C# is ordinal. Origin checking is on by default. | coder `read.go:88-100`, `accept.go:266-274,95`; `A/SyncHandshake.cs:278,283` |
| T18 | **Protocol doc §11.1 is stale.** It says a released host never journals. But `--collab-journal`/`BLOK_COLLAB_JOURNAL` now builds `LocalCollabOperationStore` in an ordinary host. | `packages/server/protocol/blok-sync-v2.md` §11.1; `A/CollabOperationStoreSource.cs:26-28`; `H/HostArguments.cs:60-62,287-296` |
| T19 | **A no-op edit records nothing under its key.** A retry re-runs the edit, and a different body is not a 409. | `S/CollabRoom.cs:781-794`; protocol §12.1 |
| T20 | **Reset flushes with no cancellation.** The pre-reset flush ignores the caller's token, so a disconnect cannot leave the record stale. | `S/CollabRoom.cs:1183` |
| T21 | **The working-set store moves an unreadable blob aside**, which defeats the journal's fail-closed import. The journal must open a doc BEFORE `LocalCollabStore.ReadAsync`. | `S/LocalCollabStore.cs:79-95`; `S/LocalCollabOperationStore.cs` remarks (lines 56-63 of the header) |
| T22 | **The receive-count semantics are not a byte count.** .NET counts `ReceiveAsync` returns (each at most 16 KiB, never across a frame). A Go reader must count fragments plus 16 KiB chunks to keep the same 17th-fragment threshold. Whether .NET ever splits a frame into more than one receive below 16 KiB is UNVERIFIED. | `A/SyncSocketMember.cs:25,248,272` |
| T23 | **Dispatch on "Forbidden" compares the whole record**, `close == SyncClose.Forbidden`, so code AND reason must match. Port it as identity of the named value. | `A/SyncSocketMember.cs:118,191` |

## 7. WebSocket: hand-written RFC 6455 or a module?

**What C# needs from the transport (verified in code):**

- Server side only.
- Echoes one chosen subprotocol, matched ordinally (`A/SyncHandshake.cs:276-284`).
- Accepts and closes with custom 4xxx codes and exact reasons (`A/SyncClose.cs`).
- Sends a close, waits a grace for the peer's close, then aborts (`A/SyncSocketMember.cs:137-170,205-208`).
- Pings on an interval and aborts after 2× the interval with no answer (`A/SyncEndpoint.cs:238-242`).
- Binary messages only; a text message closes 1003.
- Reassembles fragmented messages with a running size cap.
- Counts receives, so it sees empty fragments.
- Never negotiates compression: `WebSocketAcceptContext` sets only `SubProtocol` and keep-alive (`A/SyncEndpoint.cs:232-236`).
- Joins the room BEFORE the 101 response, so it can still answer plain HTTP 503/403/429 (`A/SyncEndpoint.cs:143-166`).

**Recommendation: write a small RFC 6455 server subset in `internal/ws`.**

Reasons:

1. **Fragment visibility.** Both mature modules swallow empty continuation frames inside `Read` (T4), so the W13 defence is impossible without forking them.
2. **The scope is small.** It needs the upgrade (Sec-WebSocket-Accept SHA-1/base64), masking, opcodes 0/1/2/8/9/10, the control-frame rules (≤125 bytes, no fragmentation), the close-code and UTF-8 reason rules, and 7/16/64-bit lengths. There are no extensions and no client.
3. **Exact close texts and timings** without fighting library defaults (T17).
4. **The repo trend.** Lib0, jszip, parse5, DOMPurify and webm-muxer were all replaced in-house (MEMORY.md index). The deleted Go tree carried only 2 modules.
5. **Testability.** One package owns every byte, so P2 failures point at our code.

Fallback: `github.com/coder/websocket` v1.8.15 (in the local module cache). It would need:

- `InsecureSkipVerify` (we do our own origin check)
- `SetReadLimit(CollabMaxMessageBytes+1)`
- our own close on the limit
- `Subprotocols=[selected]`

It accepts losing W13 parity. Gorilla v1.5.3 has the same W13 gap and also needs a dedicated writer goroutine (one concurrent writer).

Go stdlib: `net/http` `Hijacker` gives the raw conn after we write 101. That is all `internal/ws` needs.
