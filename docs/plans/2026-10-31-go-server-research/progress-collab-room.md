# Progress: collab-room lane (after round 2, 2026-11-03)

Branch `go/collab-room`, worktree `/Users/jackuait/Packages/.blok-go/collab-room`, rebased onto `origin/main` at `5aef1d9e`. Not pushed. Hashes below are the rebased ones (`git log origin/main..HEAD`).

Scope: collab.md 2.R, 2.M, 2.G, 2.E, 2.S, 2.Y, 2.O, 2.T, section 3, the section 6 traps handed over (T1 black-box, T21), and the collab rows http-host deferred (H18-H21, H33-H38, H41, L1 collab part, L2, L4, L5, L9, L13-L16, R4, R8, R22).

Every row is DONE or DEFERRED with a reason. Nothing is left as "IMPL, no oracle".

## Where things live

| Go path | Ports |
| --- | --- |
| `internal/collab/room` | `CollabRoom.cs`, `CollabRoomManager.cs` (incl. history), `CollabRoomOptions.cs`, `CollabVersionTimeline.cs`, `CollabVersionChanges.cs`, `CollabRestorePlanner.cs`. `lane.go` is SemaphoreSlim(1,1) with FIFO waiters. `ordered.go` enumerates like a .NET Dictionary/HashSet (slot reuse last-freed-first, probed with `dotnet fsi`). |
| `internal/collab/collabhttp` | `EditEndpoint.cs`, `StateEndpoint.cs`, `ResetEndpoint.cs`, `HistoryEndpoint.cs` |
| `internal/collab/synchttp/shared.go` | `IsSingleSegment`, `Refuse`, `DeriveActor` for collabhttp |
| `blokserver/collab.go` | lazy room manager, local or S3 working set, doc endpoint client, lazy converter pool, built-in journal; `Options.Logger`, `Server.RecheckAccess`, `Server.PurgeDocument`, open-routes warning |
| `blokserver/collabstore` | public aliases of the store, history, record and activity seams (T1-T5) |
| `blokserver/server.go` | `/sync/{doc}` plus reset, edit, state and five history routes, only when collab is on |
| `cmd/blok-server/collablog.go`, `conformance.go` | stderr filter for `Blok.Server.Collab`; `--conformance-journal` |

## Final runs on `70f192f2` (this round, rebased tree)

- `go vet ./...` clean; `gofmt -l` empty; `go.mod`/`go.sum` identical to `origin/main`.
- `go test -p 2 ./internal/collab/... ./blokserver/... ./cmd/blok-server/...`: all ok. `go test -race -count=3 ./internal/collab/room/`: ok.
- `--target go` (unfiltered): 12 files, 327 passed, 1 skipped, 1 min 16 s. The skip is routing-contract's malformed-escape case (Go's http.Server answers 400 before any handler; reason at the skip site, http-host lane).
- `--target csharp`: 12 files, 328 passed, 1 min 33 s.
- `--target interop`: 6 passed, 18 s.
- Collab fixture files (`server-concurrent-loss*`, `collab-fixtures*`, `collab-format1-fixtures`): 366 passed, 48 skipped by their own per-case gates, none target-keyed.
- C# `CollabRoomManagerTests` + `CollabJournalStoreCaptureTests`: 61 passed.
- Leftover processes: none of ours. One `Blok.Server.Host` from `/Users/jackuait/Packages/blok/.dev/` is the user's dev server, left alone.

## This round's slices

- `b9bd1d14` CI: the interop step's `setup-go` now uses main's v7.0.0 pin (main bumped it during the rebase); `ci-critical-path-law` updated, 34/34 with `server-go-parity-law`.
- `52980bde` P13 gaps: two new scenarios in C# `CollabJournalStoreCaptureTests` (`a-stale-session-closing-releases-nothing`, `every-call-after-close-is-disposed`); Go reads the same `scenarios.json`. Mutant (drop the closed check in `requireFence`) failed it.
- `d997a6ca` G1: new C# theory `ACallQueuedBehindAClosingRoomIsRetriedOnAFreshOne` (join, state, reset; a C# mutant that stops the join retry fails it; a reset leaves 0 live rooms, measured). Go twin over all four loops (join, edit, state, reset): each `m.forget(r)` retry mutated in turn, each failed. Go also pins the check order on join, edit and state: purging before draining (purge, drain, call → Purged) and draining before the cooldown (failed append → Unavailable; drain → Draining). All six order swaps failed it. C# order read at `CollabRoomManager.cs:264-283,431-447,949-962`. 16 attempts run out only with a hook; the count is pinned by `collab-room-constants.json`.
- `70f192f2` H38: routing-contract, health-only host: a WebSocket upgrade on `/sync/x`, and `/sync/x/state`, `/sync/x/edit`, `/sync/x/history` get the 404 catch-all on both servers (C# maps them only under `CollabEnabled`, `BlokServerEndpointRouteBuilderExtensions.cs:98`; `UseWebSockets` only with collab, `HostCollab.cs:55-64`).

## Ledger rows

SC = sync-contract, PV = protocol-v2-contract, BC = blok-client-contract, ST = sync-transport-contract, CH = collab-http-contract, JI = journal-interop-contract, RC = routing-contract.

| Row | Status | Oracle |
| --- | --- | --- |
| R1 | DONE | SC |
| R2, R7, R8 | DONE | ST |
| R3, R4, R5 | DONE | RC collab host (preflights, 405 Allow lists), `4e8dc0ea` |
| R6 | DONE | Go unit, L9 warning `6922a720` |
| R9 | DONE | Go unit `9f9c6000` (Retry-After shape); no black-box: an overloaded runtime cannot be staged |
| M1, M2, M4, M6, M7, M9, M10, M16, M20, M21, M23-M27, M29 | DONE | SC, PV, BC, CH (round 1, `4e8dc0ea`, `2fd86b1e`) |
| M3 | DONE | Go twins `1ef1b82d` |
| M5, M11 | DONE | ST both targets `69e46cf9` |
| M8, M19 | DONE | PV |
| M12, M13 | DONE | Go twins of 20 `CollabRoomTests` cases `54800466` |
| M14, M22, M30 | DONE | Go unit `4a2584ea` |
| M15 | DONE | Go twins `f974886e`, `df75a445` |
| M17 | DONE | CH 413 restore `2d98dcc8` |
| M18 | DONE | Go unit `e8590e20` |
| M28 | DONE | Go twins `86b33c35` |
| M31 | DONE | Go twins + threshold `199ad357` |
| M32 | DONE | Go twin `a02efed4` |
| G1 | DONE | `d997a6ca` (C# theory + Go twins, retry and check order) |
| G2 | DONE | PV |
| G3, G4, G6, G7, G8, G10, G11 | DONE | CH |
| G5 | DONE | Go unit `a2d592a8` (C# by reading `CollabRoomManager.cs:333,832,1088`) |
| G9 | DONE | CH truncation `2d98dcc8` |
| G12 | DONE | Go twin `a02efed4` |
| E1, E2 (header), E3, E4, E8 | DONE | CH |
| E2 (parse), E5, E6, E9, E10 | DONE | collab-core lane (`canonical-edit-digest.json`, converter twins) |
| E7 | DONE | CH + `5bd5639f` result table |
| S1, S2, S4 | DONE | CH |
| S3 | DONE | CH (Purged, Unavailable) + `e8590e20` (Overloaded, ExportFailed) |
| Y1-Y3, Y5, Y6, Y8-Y10 | DONE | CH |
| Y4, Y12, Y13 | DONE | C# capture `collab-history/*.json` + Go twins `305c8e1e` |
| Y7, Y11 | DONE | CH `2d98dcc8` |
| O1, O7, O10 | DONE | CH / host runs |
| O2-O6 | DONE | `fixtures/options-validate.json` (both servers) + `host-cli-contract` (http-host lane) |
| O8 | DONE | BC |
| O9 | DONE | H37 Go unit |
| T1-T5, T7 | DONE | `blokserver/collabstore` + `collabstore_test.go` `25dd5f3c`, `cb44e1a3`; store semantics per P13 below |
| T6 | DONE | `Server.RecheckAccess`, `Server.PurgeDocument` `6922a720` |
| Section 3 constants | DONE | `collab-room-constants.json` (C# reflection capture) + Go `constants_test.go` `3e78a6f9`; codec/wire/socket constants by collab-core and collab-transport fixtures |
| Section 6 T1 black-box | DONE | PV on Go |
| Section 6 T21 | DONE | the journal opens before the working set is read (`seedJournalLocked`); JI |
| H18, H19, H20, H21, H36, H37, H41 | DONE | Go unit + host runs (round 1) |
| H33 | DONE | collab-transport lane (`sync_deadline_test.go`) |
| H34 | DONE | `e13881a6` (30 s grace, `TestTheShutdownDrainOutlastsASlowDocEndpoint`) |
| H35 | DONE | BC |
| H38 | DONE | RC `70f192f2` |
| L1 (collab part) | DONE | T6; `ICollabWorkingSetStore` is internal in C#, so no working-set seam |
| L2 | DONE | lazy pool, by code (`blokserver/collab.go`) |
| L4 | DONE | CH fake-S3 `114576d2` |
| L5, L16 | DONE | `--conformance-journal` runs PV and JI |
| L9 | DONE | Go unit `6922a720` |
| L13 | DONE | `Options.CollabOperationStore`, `Options.CollabActivityObserver` `25dd5f3c` |
| L14 | DONE elsewhere | documents-runtime H1 (floors checked up front), R8 (pool), H3 (warm-up); host wiring H2/H4 is that lane's hand-off to http-host |
| L15 | DONE elsewhere | documents-runtime H3 (`TestWarmsUpOffTheStartupPathWithALongArticle`, `TestIgnoresAWarmUpThatFails`) |
| R22 | DONE | one limiter shared by `syncEndpoint` and `guard`, by code |
| U8 | DONE | JI both directions `8ad745a4` |

## P13: the store contract, case by case

C#'s `FakeCollabOperationStoreTests` is the source. Each case against the real stores (C# `LocalCollabOperationStore` and Go `journal.Store`, both through `collab-journal/scenarios.json`):

| Fake case | Real-store oracle |
| --- | --- |
| AssignsSequencesFromOne… | `seed-append-find-reopen` (Committed 1, 2, 3) |
| ReportsWhetherAnOperationIdIsAlreadyCommitted | same (find Duplicate, Conflict, NotCommitted) |
| DeduplicatesARetryAndConflicts… | same (append Duplicate, Conflict) |
| FailsAnAppendWithoutJournallingIt | Go `TestAnAppendWhoseFlushFailsIsUndone` (injected failure; the fake's switch has no real-store form) |
| KeepsAnUnknownOutcomeDurable… | `a-write-that-landed-without-its-answer-is-read-back` |
| HoldsAnAppendUntilTheStoreIsReleased | none needed: it tests the fake's own gate, not a store rule |
| ReportsASecondOpenAsHeldElsewhere… | `a-second-open-is-refused-while-the-first-is-live`; Go `TestOpenWhileAnotherProcessHoldsTheDocumentReportsOpenElsewhere` |
| RefusesEveryCallOnceTheFenceIsLost | `the-fence-not-the-lock-decides` (append, find, checkpoint, reset FenceLost) |
| OpensAnUnseededDocumentWithNoHead | every scenario's first open (head null) |
| HandsTheCheckpointAndTheTailAfterIt… | `checkpoints` (reopen) |
| RefusesACheckpointPastTheCommittedSequence | `checkpoints` steps 7, 8, 11 |
| AcceptsARepublishedCheckpoint… | `checkpoints` step 10 |
| ForgetsOperationIdsFromASupersededLineage | `history-lists-reads-and-deletes` step 9 (old id commits as 1 on the new lineage) |
| ReleasesNothingOnDisposeOnceTheFenceIsLost | NEW `a-stale-session-closing-releases-nothing` `52980bde` |
| ThrowsObjectDisposedOnEveryCallAfterDisposal | NEW `every-call-after-close-is-disposed` `52980bde` |
| KeepsSupersededLineagesForHistory | `history-lists-reads-and-deletes` |
| DeletesOnlyASupersededLineage | same (Current, NotFound, Deleted) |

## Deferred, with reasons

- P13 as an exported Go helper (`collabtest.RunStoreContract(t, store)`): C# ships no such suite, so it would be new public Go API with no C# counterpart. Every case it would run is pinned against both real stores above.
- P7 (a conformance-only activity sink printing each record to stderr): M14, M15 and T5 are pinned by Go twins of the C# activity tests (`4a2584ea`, `f974886e`, `df75a445`) and by `collabstore_test.go` (an observer hears `doc u1 Edited`). A black-box sink adds a flag to both hosts for no new fact.
- CI time on a runner: UNVERIFIED. Local: full Go suite 1 min 16 s, full C# suite 1 min 33 s, interop 18 s. The Go step runs the unfiltered suite in Server Security; interop runs in Server Delivery with its own `setup-go`. Check both jobs against the 7-minute budget on the first main run; move interop to its own job only if the 20-job cap allows (19 jobs per delivery-ci).
- `-race` in CI: delivery-ci's call (its progress file, G1). Run locally on `internal/collab/room` every round.

## Decisions

- C# passes no `MaxUpdateBytes` to the built-in journal (`CollabOperationStoreSource.cs:26-28`); Go matches.
- The lane is FIFO. UNVERIFIED that SemaphoreSlim's async waiters are strictly FIFO; the posted checkpoint relies only on running after the current holder.
- Log texts follow C#'s where they state the same facts; only the stderr lines are observable, and no suite pins their wording.
- The open-routes warning names Go's knob (`Options.Authorization`).
- `Options.RichTextFields` is a Go map, so entries are sorted by block type before `NewRichTextFields`; only the first-bad-entry error could differ, and options validation runs first.

## C# bugs

None found.
