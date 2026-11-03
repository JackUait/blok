# Progress: agent-room lane (round 1, 2026-11-03)

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

F9-F24, F26, F28 DONE (rows above). **F25 and F27 DEFERRED**: they need the history store to fail a read (`Corrupt`, `ExportFailed`) or a purge between the state read and the load. The C# fake store cannot fail a read, and there is no hook between the two reads on either server. The Go code writes the same message templates (`versions.go`) and the status mapping is pinned (V6). Next round: a Go test that corrupts a journal record on disk, plus a C# test over `LocalCollabOperationStore` in a temp dir, to share the captured messages.

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

## Open for later rounds

- F25, F27 (above).
- The scenario runner's `peer` uses `human-2`; the history-gate retry (H1) and two-undo race have Go twins only, not C# tests.

## Runs this round

- C#: `AgentServerScenarioTests` 104/104 (after the last fixture); `FullyQualifiedName~Agent` 503/503 after the T6 fix; `FullyQualifiedName~Collab` 1646/1646; `RoomAgentHistoryTests`, `BlokAgentRoomRefusalTests` pass.
- Go: scenarios 104/104, room corpus 52/52; `go vet ./...` clean; `gofmt -l` empty.
- `--suite mcp-agent-participant --target go`: 5/5.
