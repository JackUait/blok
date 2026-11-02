# Progress: collab-room lane (round 1, 2026-11-02)

Branch `go/collab-room`, worktree `/Users/jackuait/Packages/.blok-go/collab-room`. Read this first next round.

Scope: collab.md 2.R, 2.M, 2.G, 2.E, 2.S, 2.Y, 2.O, 2.T, section 3, and the collab rows http-host deferred (H18-H21, H33-H38, H41, L1 collab part, L2, L4, L5, L9, L13-L16, R4, R8, R22).

## Where things live

| Go path | Ports |
| --- | --- |
| `internal/collab/room` | `CollabRoom.cs`, `CollabRoomManager.cs` (incl. history), `CollabRoomOptions.cs`, `CollabVersionTimeline.cs`, `CollabVersionChanges.cs`, `CollabRestorePlanner.cs`. `lane.go` is SemaphoreSlim(1,1) with FIFO waiters; `ordered.go` enumerates like a .NET Dictionary/HashSet (slot reuse last-freed-first, probed with `dotnet fsi`) so the identities frame and awareness removals list entries in C#'s order |
| `internal/collab/collabhttp` | `EditEndpoint.cs`, `StateEndpoint.cs`, `ResetEndpoint.cs`, `HistoryEndpoint.cs` |
| `internal/collab/synchttp/shared.go` | exports `IsSingleSegment`, `Refuse`, `DeriveActor` for collabhttp |
| `blokserver/collab.go` | the service registration: lazy room manager (built on first use, like C#'s singletons), local or S3 working set, doc endpoint client (30 s), converter with a lazy engine pool, the built-in journal when `CollabJournal` or the conformance journal is on; `Options.Logger` (slog, `category` attribute), `Server.RecheckAccess`, `Server.PurgeDocument`, the open-routes warning |
| `blokserver/server.go` | maps `/sync/{doc}` plus reset, edit, state and the five history routes through `shell` (guard, preflight, 405) |
| `cmd/blok-server/collablog.go` | `CollabStandardErrorLoggerProvider`: only `Blok.Server.Collab`, Warning and up, `warning: …` / `error: …` |
| `cmd/blok-server/conformance.go` | `--conformance-journal` calls `UseConformanceJournal`; the stand-in rooms are gone |
| `internal/yjs/types.go` | `Map.HeadID` (C# `YMap.Map[key].Id`), for the page-field fingerprint |

## Oracles

- Black-box, both targets: `sync-contract` 16/16, `protocol-v2-contract` 14/14, `blok-client-contract` 12/12, `mcp-agent-participant`, `routing-contract` (the collab-host block un-skipped), `sync-transport-contract` (the v2 case un-skipped), NEW `collab-http-contract` 34/34 (written and run on C# first, then Go; two Go mutants killed). Full Go run: 12 files, 315 passed, 1 skipped (routing's malformed-escape case: Go's http.Server answers 400 before any handler; reason written at the skip site, http-host lane).
- NEW `journal-interop-contract` (runner target `interop`, builds both servers): C# writes, Go serves, then C# again; and the reverse. Document (state without the export stamp), history, a point read byte for byte, edit receipts (retry dedupes, other body 409), the tail after a SIGKILL, a working set without a journal. 6/6.
- Go unit (`internal/collab/room`, `-race -count=3`): lane FIFO and cancel, .NET enumeration order, join frame order, 8 concurrent writers, drain (flush, 1001, joins refused), linger eviction, v2 relay-then-ack with lineage first, activity (Joined, one Active per window, Left, anonymous silent). Mutants killed: v2 broadcast without the sender, drain without flush, activity stamp dropped, .NET slot order FIFO.
- Go unit (`blokserver`, `cmd`): L9 warning and its absence, RecheckAccess on an unloaded doc, purge refusals and tombstone, H37 stderr filter, H20 flag-vs-environment warning, R9 Retry-After.
- CI: the Go step runs every suite (`--target go`, no `--suite`); `server-go-parity-law` fails if it is narrowed again, and requires an `--target interop` step (Server Delivery job, with setup-go).

## Ledger rows

DONE (oracle): R1 (SC), R2/R7/R8 (transport BB), R3, R4, R5 (routing collab host: preflights, 405 Allow lists), R6/L9 (Go unit), R9 (unit; no BB: an overloaded runtime cannot be staged), M1, M2, M4, M6, M7, M8 (PV S4), M9, M10, M14 (unit), M16, M18, M19 (PV), M20, M21, M22 (unit), M23, M24, M25, M26, M27, M29, M30 (unit), G2 (PV), G3, G4, G6, G7, G8, G10, G11, G12, E1, E2 (header half), E3, E4, E7 (all but Overloaded/TooLarge), E8, S1, S2, S4, Y1, Y2, Y3, Y5, Y6, Y8, Y9, Y10, O1, O7, O8 (BC), O9 (H37), O10, H18, H19, H20, H21, H35 (BC), H36, H37, H41, L2 (lazy pool, by code), L5, L16, R22 (one limiter: `syncEndpoint` and `guard` share `s.limiter`, by code), W18, T21 (journal opened before the working set is read: `seedJournalLocked` reads the store only after `Open`).

IMPL, no direct oracle yet (next round):
- M3 Forbidden/Purged/SeedFailed join outcomes (transport GU covers the mapping), M5 raw write on v2 (C14), M11 malformed-awareness close, M12/M13 awareness ownership and withdraw (P11 fixture), M15 activity queue bound, M17 restore size gate, M28 export give-up, M31 compaction thresholds, M32 recheck expel on a loaded room.
- G1 join retry, G5 DocumentReplaced (fires; agent lane consumes), G9 changes truncation (200 rows / 4 MiB).
- S3 Purged/Overloaded/ExportFailed statuses, Y4 grouping windows (P8), Y7 truncation, Y11 corrupt and 503 paths, Y12 changes semantics (P10), Y13 restore planner (P9). The pure functions should get C# captures as collab-core did (timeline, changes, planner).
- L4 S3 working-set selection (code path only; no fake-S3 collab run).
- Section 3 constants: all in `room/options.go` and the history constants; each value read from C#, not each tested.

DEFERRED, with reasons:
- T1-T5, T7, L1 collab part, L13: a host-supplied operation store, history store or activity observer needs a PUBLIC Go seam. The room's interfaces are in `internal/collab/room`, which a consumer cannot name. Designing that package (and P13, the store contract suite a custom store must pass) is its own slice; `Server.RecheckAccess`/`PurgeDocument` cover T6.
- H34: Go's `shutdownGrace` is 1.5 s (http-host chose it to stay under the harness's 2 s SIGKILL); C# allows 30 s. The drain passes every suite, but a slow doc endpoint gets 1.5 s on Go. Needs a decision (the harness wait vs C#'s value).
- H38: Go always has WebSockets (as H2).
- L14, L15: documents lane.
- O2-O6 startup refusals: validated in `blokserver/options.go` by http-host; P12 contract not written.

## Decisions

- collab-core's hand-off said to pass `CollabMaxMessageBytes` as the journal's `MaxUpdateBytes`. C# does not: `CollabOperationStoreSource` builds `new LocalCollabOperationStore(options.CollabDirectory)` with the 1 MiB default (`CollabOperationStoreSource.cs:26-28`, `LocalCollabOperationStore.cs:100,150`). Go matches C#.
- The lane is FIFO. UNVERIFIED that SemaphoreSlim's async waiters are strictly FIFO; the posted checkpoint relies only on running after the current holder.
- Log texts follow C#'s where they are the same facts; exception messages differ (Go errors). Only the stderr lines are observable, and no suite pins their wording.
- The open-routes warning names Go's knob (`Options.Authorization`), not `UseAuthorization<T>()`.
- Rich text field config: `Options.RichTextFields` is a Go map, so entries are sorted by block type before `NewRichTextFields`; C# keeps JSON input order. Only the first-bad-entry error could differ, and options validation runs first.
- `go.sum` gains entries when `go vet`/`go test -race` run here (toolchain go1.27.3); they were reverted before every commit, never committed.

## CI time (UNVERIFIED on a runner)

Local: full Go suite 1 min 16 s (was 1 min 15 s for the six-suite subset on CI per delivery-ci); interop target about 1 min 30 s (two dotnet builds, one go build, 6 tests). Server Security was projected at 4-5 min before; Server Delivery at about 2 min 45 s plus sidecar and collab-http-contract, now plus setup-go and interop. Both must be checked against the 7-minute budget on the first main run; split interop to its own job only if the 20-job cap allows (19 jobs today).

## C# bugs

None found this round.

## Leftover processes

None: `ps` shows no blok-server or Blok.Server.Host after the runs.
