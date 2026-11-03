# Go vs C# gap research: collab core (rooms, persistence, history)

Date: 2026-11-04. Read-only. No repo file was edited. The Go probes ran through `go test -overlay` with the test files in `/private/tmp/claude-501/-Users-jackuait-Packages-blok/7aeb121a-f900-4200-b1af-4a934c2f36d6/scratchpad/probe/`, so the repo tree was not touched. The .NET facts were measured with `dotnet fsi` (`ts.fsx` and `tls.fsx` in the same folder).

Prior ledgers (`docs/plans/2026-10-31-go-server-research/progress-collab-core.md`, `progress-collab-room.md`) mark almost every row DONE. I spot-checked their claims against the code (see VERIFIED-AT-PARITY). The gaps below are new; the ledgers do not list them.

---

## CONFIRMED GAPS

### G1. Purge with an empty doc id: Go calls `authorize` first, then panics or fails late. C# refuses it up front. (Severity: MEDIUM. Host API panic.)

- **C#.** `CollabRoomManager.PurgeDocumentAsync` starts with `ArgumentException.ThrowIfNullOrEmpty(documentId)` (`packages/server/dotnet/Blok.Server/Collab/CollabRoomManager.cs:1033`). It throws before the authorize callback (`:1047`), before `DocumentReplaced` (`:1088`) and before any store call.
- **Go.** `Manager.Purge` (`packages/server/go/internal/collab/room/manager.go:272-331`) checks only `.`, `..`, `/`, `\`, `%2f` and `%5c` (`:273-276`). It has no empty check. The public entry `blokserver.Server.PurgeDocument` (`packages/server/go/blokserver/collab.go:204-223`) adds none either. Measured with an overlay probe in package `room`:
  - **No journal, local working-set store, directory exists.** `authorize` runs, then the code panics with `collab: an empty doc id has no key`. Path: `workingset/local.go:169` `DocKey(docID)` → `workingset/codec.go:28-29` panic.
  - **S3 working-set store.** `authorize` runs, then the same panic: `workingset/s3.go:35` `keyFor` → `DocKey`. This happens even with no directory.
  - **No journal, local store, directory not created yet.** `authorize` runs, and the call answers `Purged, nil`. Go reports success for an id that C# rejects. Path: `LocalStore.Delete` returns nil on `ErrNotExist` (`workingset/local.go:157-158`), before it reaches `DocKey`.
  - **Built-in journal.** `authorize` runs and `DocumentReplaced` fires for `""` (`manager.go:306`). Only then does `journal.Store.Purge` refuse it, with `The value cannot be an empty string.` (`journal/store.go:618`).
  - **A host's own `PurgeStore`.** It is handed `""` (`manager.go:319`). C# never passes an empty id to `ICollabOperationPurgeStore.PurgeAsync`.
- **Observable effect.** A host's authorize hook runs, and may log, audit or charge, for a request C# rejects as malformed. A `DocumentReplaced` listener sees `""`. Under a no-journal or S3 config, the host's goroutine panics.
- **Related, LOW.** `RecheckAccess("")`: C# throws `ArgumentException` (`CollabRoomManager.cs:988`). Go returns `0, nil` (`manager.go:240-248`; `blokserver/collab.go:190`).
- **Suggested oracle.** A Go twin of the C# argument guard on both working-set store kinds: `Server.PurgeDocument(ctx, "", auth)` returns an argument error, `auth` is never called, no DocumentReplaced fires, and nothing panics. Do the same for `RecheckAccess`. A C# xunit `[Theory]` over `""` and the separator cases would pin the ordering on the C# side. A shared list of purge-refused ids could live in a small fixture (for example `collab-purge-ids.json`) read by both sides.

### G2. Go hosts cannot tell purge failures apart: the error values are unexported. (Severity: MEDIUM. Public API.)

- **C#.** A host can catch three different exception types from `ICollabDocumentPurger.PurgeDocumentAsync`:
  - `ArgumentException` for a bad id (`CollabRoomManager.cs:1042`);
  - `UnauthorizedAccessException` when authorize says no (`:1049`);
  - `NotSupportedException` when the store cannot purge (`:1056`).
  `BlokServerBuilderExtensions.cs:47-50` documents the `NotSupportedException` contract.
- **Go.** `ErrNotSingleSegment`, `ErrPurgeNotAuthorized` and `ErrPurgeUnsupported` are declared only in `packages/server/go/internal/collab/room/manager.go:265-267`. Neither `blokserver` nor `blokserver/collabstore` re-exports them. A grep over all non-test Go files finds no other declaration. `Server.PurgeDocument` passes them through unwrapped (`blokserver/collab.go:215-217`). An embedding host outside the module cannot import `internal/...`, so it can only compare error strings.
- **Footnote, LOW.** C#'s unsupported message names the registered store type (`… the registered ICollabOperationStore (<FullName>) must also implement ICollabOperationPurgeStore`). Go's is fixed text with no type name (`manager.go:267`).
- **Suggested oracle.** An external-package test (`package blokserver_test`) that does `errors.Is(err, blokserver.ErrPurgeNotAuthorized)` (and the same for the other two) against a real `Server`. It fails to compile until the sentinels are exported. That mirrors C#'s exception-type contract.

### G4. A doc endpoint whose TLS handshake hangs fails after 10 s in C#, but after 30 s in Go. (Severity: LOW-MEDIUM.)

- **C#.** `DocEndpointClient.CreateHandler` sets `SocketsHttpHandler.ConnectTimeout = 10 s` (`DocEndpointClient.cs:204-213`). Measured with dotnet fsi (`/private/tmp/claude-501/-Users-jackuait-Packages-blok/7aeb121a-f900-4200-b1af-4a934c2f36d6/scratchpad/probe/tls.fsx`): against a TCP listener that accepts and never answers, with `ConnectTimeout = 2 s` and an 8 s request timeout, the call failed at **2.0 s**. The error was `TaskCanceledException` with the inner message "A connection could not be established within the configured ConnectTimeout." So ConnectTimeout bounds the TLS handshake too. `SendAsync` catches that `OperationCanceledException` and turns it into `collab: the doc endpoint GET timed out after 30s.` (`:367-374`).
- **Go.** The client's own `http.Transport` sets only `DialContext` with `net.Dialer{Timeout: 10 s}` (`docendpoint/client.go:86-92`). It has no `TLSHandshakeTimeout`, and net/http documents that "Zero means no timeout" (`$GOROOT/src/net/http/transport.go:188-190`). A hung TLS handshake therefore runs until the 30 s request timeout. The message is the same; it arrives after 30 s instead of 10 s. Each held-up load or save keeps its room waiting three times longer.
- **Related, UNVERIFIED.** Take a TCP connect that times out (SYN black-holed). Go's dial timeout is not a context timeout, so `send` returns the raw `dial tcp …: i/o timeout` error (`client.go:220-228`), not the `timed out after` `Error`. I infer that C# gives its `timed out after 30s.` text there, from the same ConnectTimeout path I measured for TLS. I did not stage a black-holed SYN. Only the log text differs: neither the room nor the endpoints branch on the endpoint's error type (grep for `DocEndpointException` and `docendpoint.Error` found no consumer outside the client).
- **Suggested oracle.** A Go twin with a silent TLS listener, `connectTimeout` lowered through a test seam: assert that the call fails at the connect timeout and the message reads `timed out after`. Add a C# xunit twin with the same listener. Neither `DocEndpointClientTests.cs` nor `docendpoint/*_test.go` has a connect-timeout test today (grep `connect`).
- I did not re-check the rest of the doc endpoint's behaviour (error mapping, 64 MiB cap, 512 B error prefix, no retries) this session. It rests on the ledger's D1-D7 Go twins.

### G3. C# logs a flush failure on reset, eviction and drain; Go has no such log lines. (Severity: LOW. Stderr only.)

- **C#.** Three callers wrap `FlushLocked` in try/catch and log what escapes:
  - `could not flush before a reset` (`CollabRoom.cs:1186`);
  - `could not flush while draining` (`:1316`);
  - `could not flush before eviction` (`:3510`).
  The manager also logs `could not be drained` and forgets the room when a room's `DrainAsync` throws (`CollabRoomManager.cs:1152-1166`).
- **Where C# can actually reach them.** Inside `FlushLocked` (`CollabRoom.cs:3550-3637`), the persist, export and save catches are filtered with `when (!lifetime.IsCancellationRequested)` (`:3586`, `:3605`, `:3633`). So once the room lifetime is cancelled, the exception (an `OperationCanceledException`) escapes to the caller, and the caller logs it.
- **Go.** `flushLocked` (`go/internal/collab/room/persist.go:281-337`) returns nothing. When `r.lifetime.Err() != nil` it returns silently (`:305`, `:315-317`, `:326-328`). The callers (`ops.go:451`, `ops.go:569`, `persist.go:260`) therefore have nothing to log, and no Go source has any of these four strings (grep of `internal`, `blokserver`).
- **Not claimed.** I am not claiming a behaviour difference from C#'s un-caught `CompactLocked()` (`:3576-3579`). Go's `compactLocked` error is logged and the flush continues (`persist.go:298-302`). But I found no throw path in C#'s `EncodeStateAsUpdate`, so whether that difference is reachable is UNVERIFIED. Whether any other throw escapes C#'s `SettleInFlightPersistLocked` or `SettleVersionLocked` is also UNVERIFIED.
- **Suggested oracle.** Not worth a shared fixture. If wanted: a Go twin that cancels the room lifetime during a drain-time export and asserts the `could not flush while draining:` line.

---

## DOCUMENTED / ACCEPTED DIFFERENCES

These are differences the ledgers already accept, or that fall under their rule: "log texts follow C#'s where they state the same facts; only the stderr lines are observable, and no suite pins their wording" (`progress-collab-room.md`, Decisions).

1. **Held-off duration in the cooldown log line.** C# prints `held off for {wait}`, where `wait` is a TimeSpan (`CollabRoomManager.cs:1246`). Measured with dotnet fsi, it prints `00:00:02`. Go prints `wait.String()`, which is `2s` (`room/manager.go:413`). Same fact, different spelling.
2. **Session-release timeout message.** C# uses `DisposeAsync().WaitAsync(CommitTimeout)` (`CollabRoom.cs:3660-3666`). On timeout it logs `… could not release its operation session: The operation has timed out.` (that message was measured with dotnet fsi). Go logs `… could not release its operation session: it did not answer within the commit timeout` (`room/room.go:434-435`). Also, Go's timer is wall-clock `time.After`, not the room clock (`options.Now`). That matters for tests only.
3. **Doc endpoint pooled-connection lifetime.** C# sets `PooledConnectionLifetime = 5 min`, so a DNS change is picked up even on a busy connection (`DocEndpointClient.cs:204-213`). Go sets only `IdleConnTimeout: 5 min` (`docendpoint/client.go:80-92`), so a connection that stays busy is never recycled. The ledger already lists this as a known gap (progress-collab-core D1-D7, "Pool lifetime 5 min: documented gap").
4. **Shape of the purge result type.** C# returns `CollabDocumentPurgeOutcome {Purged, DocumentOpenElsewhere}`. Go's `blokserver.PurgeOutcome {Purged, PurgeOpenElsewhere}` (`blokserver/collab.go:177-185`) is equivalent. The error side is G2.
5. **Rich-text field order.** `Options.RichTextFields` is a Go map, so it is sorted by block type (`blokserver/collab.go:142-155`). C# keeps input order. This is already a ledger decision: only the first-bad-entry error could differ, and options validation runs first.

---

## VERIFIED-AT-PARITY (checked this session)

- **Public store seams.** These C# interfaces map one-to-one, method for method, onto `room/seams.go:38-114` and the aliases in `blokserver/collabstore/collabstore.go`: `ICollabOperationStore` (`OpenAsync`), `ICollabOperationSession` (OpenResult, FindCommitted, Append, WriteCheckpoint, Reset, Dispose→Close), `ICollabOperationPurgeStore`, `ICollabOperationHistoryStore` (IsPurged, ListLineages, ReadBaseline, ReadHeaders, ReadRecords, DeleteLineage) and `ICollabActivityObserver`. Every C# public enum and record has an alias (outcomes, `CollabLineageInfo`, `CollabRecordHeader`, `CollabOperation*` records, `CollabOperationSource`; `ErrFenceLost` stands in for `CollabOperationFenceLostException`). `ICollabWorkingSetStore`, `ICollabMember` and `ICollabDocConverter` are `internal` in C#, so Go owes no public seam for them.
- **Host wiring.** `UseCollabOperationStore`/`UseCollabActivityObserver` map to `Options.CollabOperationStore`/`CollabActivityObserver`. `CollabOperationStoreSource` (registered store wins, else the built-in journal when `CollabJournal`; `MaxUpdateBytes` comes only from the built-in store) matches `blokserver/collab.go:113-127`. `ICollabRoomManager.DrainAsync` maps to `Server.Drain`, `RecheckAccessAsync` to `Server.RecheckAccess`, and `ICollabDocumentPurger` to `Server.PurgeDocument` (apart from G1 and G2).
- **Room options and constants.** All defaults in `CollabRoomOptions.cs` match `room/options.go` (and so does `Backoff`). All private constants in `CollabRoom`/`CollabRoomManager` (awareness/checkpoint/export limits, 55 s activity window, queue and stamp 256, 16 join attempts, changes cap 200 rows and 4 MiB, timeline 2 min / 10 min) are captured by C# reflection in `fixtures/collab-room-constants.json` (`CollabRoomConstantsCaptureTests.cs`) and read by Go `room/constants_test.go:11`. I grepped every `const`/`static readonly` in those two C# files. Every numeric and timing constant is in the fixture. `QueryAwareness` (a static frame byte array) is not; the wire-lane fixtures cover it.
- **Member and connection limits.** `CollabMaxConnectionsPerUserPerDoc` (default 8) and `CollabMaxConnections` are host options enforced by the connection table: C# `SyncConnectionTable`, Go `internal/collab/synchttp/conntable.go`, with options in `blokserver/options.go`. That is the collab-transport lane. `fixtures/options-defaults.json` and `options-validate.json` each have one C# reader and one Go reader. `CollabRoom` itself has no member cap; `MaxAwarenessClients` 256 is in the constants fixture.
- **History caps.** `room.MaxChangeRecords`/`MaxChangeBytes` (`room/history.go:34-35`) are used by `collabhttp/history.go:178,197`.
- **Activity observer.** Same null/empty actor skip, sweep-before-suppress, stamp only on a call made, heartbeat-first eviction from a full queue, one pump per room, a failure logged and dropped. Compared `CollabRoom.cs:1490-1680` with `room/activity.go`. `DeriveActor` never yields `""` in C# (`SyncHandshake.cs:247-268`), so Go's `== ""` test is equivalent.
- **Drain.** Both loop until no live room is left and drain the rooms concurrently (`CollabRoomManager.cs:1122-1135`; `room/manager.go:335-355`). Cooldown on a commit-unavailable or held-off load, reset on an ordinary close: same logic (`:1229-1258`; `manager.go:405-421`).
- **S3 working-set store.** `S3CollabStore.cs` matches `workingset/s3.go` method by method: prefix trim and empty refusal, a read through `DecodeOrAbsent`, a write with no read-before, a reset that reads and enforces the epoch raise, a retire that deletes only a readable object, and a delete.
- **Local working-set dir and file modes.** 0700/0600, plus a chmod of an existing directory with a one-time warning (`LocalCollabStore.cs:397-490`; `workingset/local.go:271-328`).
- **Purge ordering** (non-empty ids). Separator check, then authorize, then the unsupported-store check, then the per-doc purge lane, then DocumentReplaced, then room purge, then journal purge, then working-set delete. Same order on both sides (`CollabRoomManager.cs:1036-1113`; `manager.go:272-331`).
- **Agent room receipt fix `40300fa5`.** Go already hands the receipt to the applied callback inside the lane (`room/ops.go:62,175,204,230`).
- **Shared fixtures read by both sides.** Each fixture below has both a C# reader and a Go reader:
  - `collab-journal/scenarios.json` (`journal/store_scenario_test.go:45`), which includes the `bd60a20c` and `2954138e` scenarios;
  - `collab-history/{timeline,changes,restore-plans}.json` (`room/history_fixture_test.go:172,212,359`);
  - `collab-room-constants.json`;
  - `collab-disk/codecs.json`, `collab-edits`, `collab-hardening`, `collab-migrations`, `collab-structure`;
  - `canonical-edit-digest.json`, `converter-keys.json`, `rich-text-*`, `text-diff/*`;
  - `test/fixtures/version-history/{lis,kind}-cases.json`.

  C# iterates all 31 `collab-format1` rooms. All 31 are named by `collab-migrations/cases.json`, which Go reads (`convert/migrate_test.go:51`), so Go covers every room too. `DocumentReplaced` firing is pinned on both sides (C# `CollabHistoryManagerTests.DocumentReplacedFiresOnAResetAnAppliedRestoreAndAPurgeOnly`, Go `replaced_test.go`). Those are twins, not one fixture.
