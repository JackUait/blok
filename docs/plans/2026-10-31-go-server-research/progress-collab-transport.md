# Progress: collab-transport lane

Read this first next round. Ledger: `collab.md` (sections 2.H, 2.W, 2.C, 2.F, 7, and the matching rows of 3 and 6).

## Round 1 (2026-11-02)

### Where things live

| Go path | Ports |
|---|---|
| `internal/collab/wire` | `S/SyncWire.cs` (fuzz: `FuzzDecode`, `FuzzJSONReader`) |
| `internal/ws` | the RFC 6455 server subset, shaped like .NET `ManagedWebSocket` 10.0.11 (fuzz: `FuzzReceive`) |
| `internal/collab` | the seam: `Member` (ICollabMember), `Membership`, `Rooms`, `JoinStatus`, `CloseReason`, `OperationSource` |
| `internal/collab/synchttp` | `A/SyncHandshake.cs`, `A/SyncEndpoint.cs`, `A/SyncSocketMember.cs`, `A/SyncConnectionTable.cs`, `A/SyncInboundBudget.cs`, `A/SyncClose.cs` |
| `blokserver/server.go` | maps `GET /sync/{doc}` (+ 405 `Allow: GET`) outside the guard, only when `CollabEnabled` AND `s.rooms != nil` |
| `cmd/blok-server/conformance_rooms.go` | `-tags conformance` only: a stand-in `Rooms` that admits every join and drops every frame |

Decision: the package is `internal/collab/synchttp`, not the ledger's `internal/httpapi/collab`: a package named `collab` next to `internal/collab` would collide on import. The room lane's edit/state/reset/history handlers can live beside it or in their own package.

Decision: the Go oracle now is the conformance binary with the stand-in room. Every case in `sync-transport-contract` asserts only transport outcomes (status and body before the upgrade, close code plus exact reason), so C#'s real room and the stand-in answer them the same. The ordinary binary maps no `/sync` until the room lane sets `s.rooms`. **Room lane: replace `standInRooms` with the room manager, set `s.rooms` in `New` when `CollabEnabled`, and set `HasOperationStore` in `syncEndpoint()` when a journal exists; then un-skip the v2 case (`itNeedsAStore`).**

### Oracles added
- `test/unit/server-conformance/sync-transport-contract.test.ts` + `raw-websocket.ts` (a raw RFC 6455 client). 34 cases. C#: 34/34. Go (conformance build): 33 pass, 1 skipped (v2 selection: the stand-in has no store). In the runner's SUITES (so the C# CI step runs it) and in the Go CI step (`ci.yml`, `ci-critical-path-law`, `server-release-wiring`).
- Mutation check, black-box: `receiveSlack` 16 -> 17 fails "serves a message in 16 receives and closes the 17th 1008" on Go.
- Wall time: C# about 50 s of tests (62 s with the build); Go 12 s. The whole Go CI step (6 suites) took 1 min 18 s locally. **The C# step now runs this suite too: about +50 s on the "Server Delivery" job, which http-host already put at 6.5-7 min. Check the job time on a runner before landing; if it is over 7 min, split the C# conformance step or move `sync-transport-contract` to its own job (mind the 20-job cap).**
- Go unit tests (`internal/collab/synchttp`, `-race`): ports of `SyncSocketMemberTests` (all 10), the budget cases of `SyncEndpointTests` (burst, cadence refill, resync storm, queryAwareness storm, overlong varuint, presence flood, paste-not-presence, update-not-resync), the handshake actor/principal/hook cases of `SyncHandshakeTests`, join statuses, process ceiling, recheck.
- `cmd/blok-server/sync_deadline_test.go`: H33 "sync opts out".
- Fuzz, each run 150 s: `FuzzDecode` PASS, `FuzzJSONReader` PASS, `FuzzReceive` PASS (3.4 M execs).

### .NET behaviour read from the decompiled dll (ilspycmd, `System.Net.WebSockets.dll` 10.0.11, osx; output kept only in the session scratchpad)
- A payload receive is `ReadAtLeastAsync(buffer, min(len(buffer), payload left))`: it fills or ends the frame. So T22 is settled: receives = fragments plus 16 KiB chunks. Black-box pin: "counts receives, not frames: a message dribbled a byte at a time" (1 KiB, one byte per write) is served on C#, not closed.
- A server reads 2 + 4 mask bytes (+ extended length) before it checks the mask bit, so an unmasked frame with fewer than 4 payload bytes just waits.
- Cancelling a receive aborts the socket (`cancellationToken.Register(Abort)`). Go's member aborts on the grace timer instead.
- Keep-alive: heartbeat `max(min(delay, timeout)/4, 1 ms)`, ping payload is a counter, only a matching 8-byte pong answers, `OnDataReceived` after every stream read (header reads too). Go bug fixed: Go only pushed the next ping back before a payload read (`TestEmptyFramesPushTheNextPingBack`).

### Ledger rows

DONE (oracle in brackets; BB = sync-transport-contract on both targets, GU = Go unit test):
- 2.F F1-F11 [sync-frames.json, sync-wire-decode.json, C# + Go].
- 2.H H1 order [BB: bad doc before ticket check, refusals not billed, rejection billed; GU], H3 [BB], H4 [BB], H5 [BB], H6 [BB], H7 [BB "missing pass" for `v1, v2`], H8 all four reasons [BB], H9 [BB: address key, then `user:` key], H10 [GU signed-in principal], H11 [GU actor order], H12 v1 [BB], v2 [BB on C#, GU on Go], H13 [BB repeated lines + spaces], H14 [BB], H15 [GU], H16 [GU hook sees ID/Name/Doc/Write], H17 [GU].
- 2.H H2: kept out on purpose (Go always has WebSockets).
- 2.W W1 [GU ceiling + `TestTheHostCapsSyncConnectionsOnlyWhenCollaborating` 1024], W2 [BB 9th socket 429], W3 [GU; BB needs the room], W4 [GU], W5 [GU], W6 [ws unit tests + decompile; no BB: 15 s/30 s is too slow for CI], W7 [BB 150-2000 ms], W8 [GU], W9 [GU], W10 [BB + GU], W11 [structural: one pump goroutine], W12 [BB], W13 [BB 16 vs 17 + dribble], W14 [BB 1 MiB vs 1 MiB + 1 across fragments], W15 [BB], W16 [BB frame/resync/presence + GU], W17 [BB `80 00 00 00`].
- 2.C C1 [BB], C3 [BB], C4 [BB], C5 [GU], C6 [BB], C7 [BB], C8 [BB], C9 [GU 4403 on hook deny], C11 [GU], C12-C15 mapping [GU `TestEveryRoomReasonMapsToItsClose`].
- 2.R (route rows touched): R2 [BB 405 `Allow: GET`], R7 [BB `a%2Fb`], R8 [BB body + content type].
- §7 WebSocket [ws unit + BB "frames RFC 6455 refuses" 11 cases: 1002 x10, 1007].
- §3 socket constants (16 KiB, 16, 64, 5 s, 250 ms, 8x, bursts 10 / 512 KiB, host 1024) [BB + GU].
- §6 T4, T17 (no library), T22 (decompile + BB), T23 (`CloseFrame` compared as a value: code and reason), T14 (awareness depth 64/65 in sync-wire-decode.json).
- http-host hand-off H33 "sync opts out" DONE: `trackingWriter.Hijack` marks the writer done (the deadline no longer tries a 504 on a hijacked conn; net/http dropped it and logged a warning); `ws.Upgrade` clears the conn deadlines; the member uses `context.WithoutCancel`. Oracle: `TestAnUpgradedSocketOutlivesTheRequestDeadline` (deadline, header clock and idle all 150 ms; echo after 600 ms; no server log line).
- Protocol doc: new §2.1 (door and socket) in `packages/server/protocol/blok-sync-v2.md`; §11.1 stale text fixed (T18, and "Go passes only health").

Deferred to the room lane (each needs a real room to produce the frames or the status; the mapping is already GU-tested):
- C2 1001 drain, C10 4409 reset, C13 malformed awareness, C14 raw write on v2, W3 BB (Draining/Purged before upgrade), W4 BB (seed failed), W8 BB (slow consumer needs room output), W18 store source, T13 join frame order, §6 T11/T12. Oracles: SC, PV, BC suites on `--target go`.
- R1 (SC all 16) and the other 2.R rows: room lane.

### Known gaps (documented, not ported)
- `signedInPrincipal`: C# uses `Identity.Name ?? NameIdentifier` (null-coalesce). Go's `auth.User` cannot tell a null name from an empty one, so an empty name falls back to the id. UNVERIFIED whether a host can produce an empty, non-null Name claim.
- `protocolOffers` trims ASCII whitespace only; .NET `String.Trim` trims Unicode whitespace. How Kestrel decodes non-ASCII header bytes is UNVERIFIED.
- Kestrel's `MaxConcurrentUpgradedConnections` backstop (500 past the service cap) has no Go equivalent; the service count is the only cap.
- A hook error before the upgrade answers an empty 500 (what Kestrel does for an unhandled exception); measured on C#: not done.

### C# changes this round
- Commit af6174d6 (before this file existed): `SyncWire.TryDecode` threw `InvalidOperationException` on a type-100 lineage or a type-107 actorId with invalid UTF-8 or a lone-surrogate escape. Now an ill-typed property; xunit `SyncWireTests` + the fixture.

### Leftover processes
- Seen, not this lane's: pid 30479 (`--rate-limit 1 --secret ...`, parent a vitest worker of another session). Not touched.
