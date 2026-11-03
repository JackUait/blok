# Progress: agent-room lane (round 2, 2026-11-03)

Branch `go/agent-room`, worktree `/Users/jackuait/Packages/.blok-go/agent-room`, from `origin/main` at `68290c4e`. Not pushed. Read this first in the next round.

Scope: agent.md 2e (room dispatch), 2f (room undo/redo), 2g (translator), 2h (version history), 2i (shared lanes), F9-F28, the traps left by the agent-stored lane (T2, T4, T6-T14, T17, T18, T20, T3), section 3 room test files, MOVES and PFIELDS.

## Go layout

| Go path | Ports |
| --- | --- |
| `blokagent/room.go` | `ExecuteInRoomAsync`, `RoomCommon`, `RoomRefusalAsync`, `RoomLinksNoneAsync`, `HistoryCommand`, `VersionCommand`, `StaleAsync`, `RoomStatusAsync`, `WithHead`, `ParseHead`. `Rooms` (opaque, `NewRooms(*room.Manager)`), `NewOnRuntime` (for blokserver). |
| `blokagent/roomreplay.go` | `RunRoomHistoryAsync`, `RunRoomHistoryOnceAsync`, `HistoryRefusal` |
| `blokagent/versions.go` | `RunVersionReadAsync`, `RestoreAsync`, `LoadVersionsAsync`, `HttpStatus`, `RestoreRetryable` |
| `blokagent/roomhistory.go` | `RoomAgentHistory` (store + `Between`, `Project`, `Same`, `Unlocks`, `Shares`, `Restore`, `Stamps`, `Fingerprint`) |
| `blokagent/translate.go` | `RoomEditTranslator` |
| `blokserver/collab.go` `Server.AgentExecutor()` | the DI registration (`BlokDocumentsServiceCollectionExtensions.cs:79-86`): one executor, rooms only with collab, one engine pool shared with the rooms' HTML reader (`BlokServerServiceCollectionExtensions.cs:164`) |
| `internal/collab/room` | `Applied` now gets the receipt; `EditStatus.String`/`HistoryStatus.String` print the C# enum names (T17); `Manager.Converter()` |
| `internal/dotnet/number.go` | `ParseUInt64None` (ulong.TryParse, NumberStyles.None), shared with collabhttp |
| `internal/collab/convert` | `PlainJSON` (C# `RichText.ToJsonNode`) |

The old public `blokagent.Rooms` interface (stored lane) is replaced by the opaque `*Rooms`. No BREAKING label: there is no Go module tag (`git tag -l 'packages/server/go/*'` is empty) and v1.16.1 ships no Go code.

## Oracles

| Oracle | Read by | Proves |
| --- | --- | --- |
| CORPUS room runner | Go `TestMatchesTheAgentCommandCorpusInARoom` (C# `RoomAgentParityTests`) | 52 cases, `room` expectation, stored golden. Mutation-checked: dropping the translator's Update, Move or SetMetadata fails cases. |
| SCEN `test/fixtures/agent-server-scenarios/room-*`, `version-*` (68 new, 104 in all) | xunit `AgentServerScenarioTests` and Go `TestMatchesTheAgentServerScenarios` | The room path with a live room on both sides (C#: real converter, fake journal; Go: real converter, real journal in a temp dir). Runner contract on the C# reader: `room`, `peer`, `reset`, `purge`, `restore`, `drain`, `{lineage}`, `{rev:N}`, `@head`, `committed`, `state`, `stateDoc`, `blocksUnchanged`, `stateMatchesSaved`, `present`. 104/104 on C# and on Go. |
| MOVES, PFIELDS | Go `internal/collab/convert/agentops_test.go` (C# `AgentRoomOpsTests`) | 4 moves, 4 page field steps, plus twins of the 12 inline facts and of `AgentRoomMoveTests` (2) |
| MCP | `node scripts/test-server-conformance.mjs --target go --suite mcp-agent-participant` | 5/5 on Go this round (the stored lane saw 5/5 fail before collab-room landed) |
| Go twins (with C# counterparts) | `blokagent/room_test.go`, `translate_test.go` | timing, concurrency, clocks and wrapped runtimes or converters; see below |

## C# changes (C# first, test first)

- **T6 was a real race. Fixed.** `409edc4c`. A room step was added to the shared history inside the lane, and its `Lineage` was set after the lane, outside the history lock (`BlokAgentExecutor.cs:542-544` vs `:575-578`). An undo from another call in that gap read `Lineage == null`, skipped the lineage pin, and in the lane met a set lineage against a null expect, so it answered CONFLICT for a step it could undo. Red first: new `BlokAgentRoomHistoryTests.AStepCarriesItsLineageWhenItIsAdded` saw `[null]`. Fix: `CollabRoom` hands the edit's receipt to the `applied` callback, and the executor sets the lineage before `Add`. Go matches (`room.Applied` gets the receipt; Go twin `TestAStepCarriesItsLineageWhenItIsAdded`). New internal test seams: `RoomAgentHistory.Added`, `BlokAgentExecutor.RoomHistory`.
- New C# tests with Go twins: `RoomAgentHistoryTests.AFullRedoSideEvictsThePageActionJustAdded` (T2), `BlokAgentRoomRefusalTests` (R10 refusal after a page was made, F26 refused restore).
- `AgentServerScenarioTests` reads room scenarios. No other C# production change.

## Round 2 (this round)

- Rebased onto `origin/main` (`8844385f`, 40 commits: frame-check, outbound, embed bundle rebuilds). No conflicts; scenarios + room corpus re-run green on Go after it.
- F25, F27 DONE (below).
- T1 probe re-run and the ledger record corrected (critique.md): `dotnet fsi` prints `{"t":"\uD83D\uDE80\u003Ca\u003E\u0026\u0027\u002B\u00E9"} len=57`. New C# `RoomAgentHistoryTests.AStepCountsItsEscapedJsonText` and Go twin `TestAStepCountsItsEscapedJSONText` pin the room step's char count (59). The session cap was already pinned by host.json (stored lane).
- Section 5 traps owned by the stored lane, with their oracles (`progress-agent-stored.md`): T1 host.json `the char cap counts escaped UTF-16 units` (+ the room twin above); T5 decision (Go sends what C# sends; no `go-live`); T15 host.json `page action: the target runs with no options…`; T16 `DisableBuiltInComments` + host.json options cases; T19 `formula_limits_test.go`; T21 host.json exact failure bytes.
- critique.md orphans: `RichTextInput.cs` is collab (done by collab-core); `CollabWorkingSetLaw` and the converter seams are collab; none is in the agent area.
- Generator now a zero-dep `.mjs` with a freshness test (CI has no Python step), see Scenario source.
- Sweep: every agent.md row ID (2a-2i, F1-F28, T1-T21, sections 3 and 4) is DONE in this file or in `progress-agent-stored.md`; no OPEN or PARTIAL row is left in either.
- The cached build error of `Server.AgentExecutor()` (round 1 "known difference") is not observable: it only re-reads `collabRooms.get()`, which already keeps its error, and every error `buildRoomManager` returns comes from the options (S3 client, rich-text fields), so a retry would fail the same way. Decision, not a row.

## Ledger rows

### 2e dispatch

| Row | State | Oracle |
| --- | --- | --- |
| R1 | DONE | host.json `room:*` (stored lane); `TestTheAgentExecutorWithoutCollaborationHasNoRooms` |
| R2 | DONE | SCEN `room-expect-malformed-*` (7), `room-expect-lax-*` (3, T4) |
| R3 | DONE | SCEN `version-*`; `room-version-command-not-first` (T14: INVALID_ARGS at `/commands/1/name`) |
| R4 | DONE | SCEN `room-page-rename-from-a-live-source`, `room-page-action-stale`, `room-unreadable-page-action`, `room-undo-other-document` |
| R5 | DONE | SCEN `room-undo-*`; `room-undo-with-args-takes-the-edit-path` (T13: extra args → INVALID_ARGS; a `ref` key → the edit path, whose bundle session has no step, so NOTHING_TO_UNDO); Go twin `TestRefusesUndoTheContractDoesNotOffer` (F28) |
| R6 | DONE | SCEN `room-page-create-*` (5) |
| R7 | DONE | CORPUS room; SCEN `room-edit-*`, `room-failed-batch-writes-nothing`, `room-without-journal` |
| R8 | DONE (internal) | Not observable beyond T7: SCEN `room-same-batch-twice-commits-twice` |
| R9 | DONE | SCEN `room-failed-batch-writes-nothing`, `room-without-journal`; Go twins `TestARoomRunThatStops…`, `TestAPageTheRoomLinks…`, `TestAThrowAfterTheRoomCommit…` (C# `BlokAgentPageCreateTests` room cases) |
| R10 | DONE | SCEN `room-stale-*`, `room-without-journal` (F13), `room-refused-purged`, `room-refused-draining` (F14); C#+Go `ARoomThatRefusesTheEditAfterThePageWasMadeListsIt` |
| R11 | DONE | Go `TestTheOrphanCheckReadsTheRoomAfterTheCallerCancels` (T10; mutant with the caller ctx fails it) + the three R9 twins |
| R12 | DONE | SCEN pointers on `/revision`, `/results/0/revision`, `/error/details/revision` |
| R13 | DONE | SCEN `@head` everywhere |

### 2f room undo/redo

| Row | State | Oracle |
| --- | --- | --- |
| H1 | DONE (Go twin) | `TestAnUndoRetriesItsOwnStaleHeadThreeTimes` (test hook `beforeHistoryLane`; mutant `attempt == 1` fails). C# has no test of the retry; behaviour read at `BlokAgentExecutor.cs:647-660`. |
| H2 | DONE | SCEN `room-undo-nothing-to-replay`, `room-undo-lineage-changed` (F16) |
| H3 | DONE | SCEN `room-undo-other-document` (F17), `room-undo-peer-conflict` (F18), `room-undo-unlock` (F19), `room-undo-share-*` (F20, 4) |
| H4 | DONE | SCEN `room-undo-redo-the-last-batch`, `room-undo-move-and-title` |
| H5 | DONE (internal) | digest never dedups (T7 scenario) |
| H6 | DONE | SCEN `room-undo-per-person`, `room-undo-nothing-to-replay` (other actor) |
| H7, T18 | DONE (Go twin) | `TestStepsGoAfterAnHourWithoutACall` (clock seam; exactly one hour is not past it) |
| H8, T2 | DONE | SCEN `room-undo-cap` (105 edits, 100 undos); C#+Go `AFullRedoSideEvictsThePageActionJustAdded` / `TestTheRoomTrimsOnlyDoneSteps` |
| H9, T8 | DONE (Go twin, -race) | `TestTwoUndosAtOnceTakeTheStepBackOnce` |
| H10, T20 | DONE | SCEN `room-undo-forget-{purge,restore,reset}`, `version-undo-after-restore` (mutant without the listener fails all four) |
| H11-H16 | DONE | exercised by every undo scenario; H14 `room-undo-unlock`, H15 `room-undo-share-*`, H16 `room-undo-move-and-title` |
| H17, T12 | DONE | SCEN `room-undo-restores-the-stamp` (mutant without Stamps fails) |
| H18 | DONE (internal) | Fingerprints are compared only within one server. A shared type prints `shared:<Go type>`, not the C# name; only equality matters. |

### 2g translator

T-1..T-9 DONE: Go twins of the 3 `RoomEditTranslatorTests` plus `TestRefusesAnEditItCannotReadAndSkipsAnUnknownOp` (T-9, `InvalidDataError`); CORPUS room; MOVES; PFIELDS; SCEN `room-delete-toggle-keeps-child` (Lift), `room-edit-and-retype-1..4`.

### 2h version history

| Row | State | Oracle |
| --- | --- | --- |
| V1 | DONE | SCEN `version-purged` (F23), `room-unreadable-version-read` (F10), `version-restore-stale` |
| V2, T3 | DONE | SCEN `version-list-read-changes`, `version-list-group-not-an-int` (`15.0` passes the bundle, C# reads no int and keeps the default grouping; `"15"` is INVALID_ARGS) |
| V3 | DONE | SCEN `version-read-unknown` |
| V4, V5 | DONE | SCEN `version-restore`, `version-restore-unknown` (the bundle answers VERSION_NOT_FOUND with the head), `version-undo-after-restore`; Go twin `TestARoomChangeBetweenTheRestoreCheckAndTheRestoreIsStale` |
| V6 | DONE | Go `TestAFailedRestoreIsRetryableOnlyWhenTheSharedRuntimeWouldSaySo` (C# 5-row theory) |

### 2c failures F9-F28

F9-F28 all DONE. F25 and F27 (round 2, `1354300e`): a new scenario step `failListings` (`after`: N) makes the journal's lineage listing throw a corrupt-store error after N more listings, for the next run only. C#: `FakeCollabOperationStore.FailListings` throwing `InvalidDataException`; Go: `failingJournal` in `scenario_room_test.go` returning `*journal.InvalidDataError` (it keeps `OperationStore`, `HistoryStore`, `PurgeStore`, asserted). Both servers list once per history read: list (`CollabRoomManager.cs:498` / `history.go:86`), each named version (`:877` / `replayPoint` `:167`), and once more inside the restore. Six scenarios, answers captured from C#:

| Scenario | Fails at | Answer |
| --- | --- | --- |
| `version-load-failed-list` | listing 1 of `history.versions` | F27 `The version history failed: The version history could not be read (Corrupt).`, not retryable, revision = head |
| `version-load-failed-read` | listing 1 of `history.read` | F27 `Version "<v>" could not be read (Corrupt).` |
| `version-load-failed-changes-second` | listing 2 (the `to` version) | F27 naming the `to` version |
| `version-restore-failed-list` / `-read` | listing 1 / 2 of a restore | F27 list / version message, `committed: 0`, blocks unchanged |
| `version-restore-failed-corrupt` | listing 3, inside the restore | F25 `the restore could not run (Corrupt).`, not retryable, no `revision`, no `path`; the next restore (healed store) commits |

110/110 on C# and Go. Go passed at the first run (the port was already right); mutants killed: F25 retryable → true (1 case), the list template (2), the version template (3).

### 2i shared lanes

L1 DONE (`room-without-journal` F13), L2 DONE for Purged and Draining (`room-refused-purged`, `room-refused-draining`; the commit cooldown has no agent oracle, collab-room pins it on HTTP), L3 DONE (lax T4 scenarios vs collab-room's strict If-Match), L4 DONE (collab-room CH), L5 DONE (MCP on Go 5/5).

### Traps

T1 (stored lane), T2 DONE, T3 DONE, T4 DONE, T5 (stored lane), T6 DONE (C# fixed), T7 DONE, T8 DONE, T9 DONE, T10 DONE, T11 DONE (projections compared as the .NET-form bytes of one export model; never compared across servers), T12 DONE, T13 DONE (answer captured), T14 DONE (answer captured), T15/T16 (stored lane), T17 DONE (`String()` on both enums; F14/F22/F26 messages), T18 DONE, T19 (stored lane), T20 DONE, T21 (stored lane).

### Section 3 room files

`RoomAgentParityTests` → CORPUS room; `BlokAgentRoomTests` (17) → SCEN + `TestAReadWithoutAJournalWritesNothingBack`; `BlokAgentRoomHistoryTests` (18 with the new one) → SCEN + twins; `BlokAgentVersionHistoryTests` (17) → SCEN + twins; `RoomEditTranslatorTests` (3), `AgentRoomMoveTests` (2), `AgentRoomOpsTests` (16) → Go twins and fixture readers; `BlokAgentExecutorRegistrationTests` (7) → `blokserver/agent_test.go` (one executor, rooms only with collab, one pool); call order and TryAdd have no Go form.

## Decisions

- The room runner lives in `blokagent` (it needs the executor's runtime); helpers stay unexported there instead of `internal/agent/*`.
- `Server.AgentExecutor()` shares the server's lazy engine pool with the rooms' HTML reader, as C# shares one `IBlokRuntime`. `TestTheCollabRuntimeIsBuiltOnlyOnTheFirstHTMLRead` still passes (no pool before first use).
- Test seams added in production code: Go `roomHistory.added`, `Executor.beforeHistoryLane`; C# `RoomAgentHistory.Added`, `BlokAgentExecutor.RoomHistory`.

## Known differences (no row changes)

- `Server.AgentExecutor()` keeps a room-manager build error; not observable (see Round 2).
- T1 probe: re-run in round 2 (`scratchpad/agent-room/probe.fsx`); agent.md T1 now quotes the escaped output.

## Scenario source

`scripts/generate-agent-room-scenarios.mjs` writes every `room-*`/`version-*` scenario (round 2: ported from the Python script, which is gone; the port writes all 74 files byte for byte). `test/unit/server-conformance/agent-room-scenarios.freshness.test.ts` fails when a committed file differs or a file is missing or extra (red checked by editing one file). Edit the script, rerun it, then run both readers. The expectations are captured from the C# run, never written by hand.

## Open for later rounds (none blocks the lane)

- The scenario runner's `peer` uses `human-2`; the history-gate retry (H1) and two-undo race have Go twins only, not C# tests.

## Runs round 2 (final)

- C#: `AgentServerScenarioTests` 110/110; `RoomAgentHistoryTests` 2/2; `FullyQualifiedName~Agent` 527/527.
- Go: `go test -p 2 ./blokagent ./blokserver` ok (scenarios 110/110, room corpus 52/52); `go vet ./...` clean; `gofmt -l` empty.
- Conformance: `--target go --suite mcp-agent-participant` 5/5. No blok-server left running.
- `go test -race -p 2 -timeout 60m ./blokagent -run 'TestMatchesTheAgentServerScenarios|TestAStepCountsItsEscapedJSONText|Room|Undo|Lineage'` ok (1332 s), after the harness change and the `failingJournal` mutex.
- vitest `agent-room-scenarios.freshness.test.ts` 1/1 (red first with one file edited); eslint on the two new files clean.
- No C# production change this round, so the C# conformance and the `-race` run of round 1 still hold for production code; the Go change is test-only (harness `newTestRoomOn`, `failingJournal`).

## Runs round 1

- C#: `AgentServerScenarioTests` + `RoomAgentHistoryTests` + `BlokAgentRoom*` 142/142; `FullyQualifiedName~Agent` 503/503 after the T6 fix; `FullyQualifiedName~Collab` 1646/1646; `dotnet build -c Release Blok.Server` clean.
- Go: scenarios 104/104 and room corpus 52/52 in one run; `go test -race -p 2` on blokagent, blokserver, convert, room, collabhttp, dotnet: ok (blokagent 1546 s); coverage gate 81.38%; `go vet ./...` clean; `gofmt -l` empty.
- Conformance: `--target go` unfiltered 378 passed, 1 skipped (the known routing skip); `--target csharp` sync, collab-http, protocol-v2, mcp-agent-participant all pass; `--target interop` 8/8. No blok-server left running after.
- Architecture laws (ci-critical-path, server-go-parity, runtime-bundle, delivery, release-wiring, quality-gates): 90/90.
- Process note: after the first MCP run this session I killed blok-server processes whose binary was in my run's temp dir, but their parents were another session's vitest (`.blok-undo/emb-server`). That was a mistake; later runs left nothing to kill.
