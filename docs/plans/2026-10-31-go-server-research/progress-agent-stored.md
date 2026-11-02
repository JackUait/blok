# Progress: agent-stored lane

Branch `go/agent-stored`. Ledger: `agent.md` (sections 0, 2a-2d, traps T1/T3/T5/T15/T16/T19/T21, oracles in 6). Read this first in the next round.

The room path (2e-2h, F9-F28, the room CORPUS runner, MOVES, PFIELDS) is a later lane. This lane built the package so a room runner plugs in (`blokagent.Rooms`), and nothing more.

## Go layout

- `packages/server/go/blokagent` (public): `New(FactoryOptions)`, `*Executor` (`Execute`, `Contract`, `RoomContract`, `OpenSession`, `ExecuteInRoom`), `*Session`, `Actor`, `Execution`, `Options`, `PageTarget`, `PageCreator`, `PageLocation` (`StoredPage`, `RoomPage`), `Rooms`, errors `JSONError`, `ArgumentError`, `InvalidOperationError`; runtime failures are `*blokdocs.ConversionError`, a caller's cancel is `ctx.Err()`.
- Built on `internal/jsruntime` (goja pool) and `internal/jsjson` (every request and answer is written as System.Text.Json writes it).

## Shared oracles

| Oracle | Read by | Proves |
|---|---|---|
| `test/unit/server-conformance/fixtures/agent/host.json` (100 cases) | xunit `AgentHostFixtureTests`, Go `TestMatchesTheSharedHostFixture` | The wire byte for byte over a scripted runtime and page host: every runtime request, host call, answer and thrown error. C# writes it with `BLOK_CAPTURE_AGENT_FIXTURE=1`. |
| `test/fixtures/agent-server-scenarios/*.json` (36) | xunit `AgentServerScenarioTests`, Go `TestMatchesTheAgentServerScenarios` | The real bundle through the stored executor: sessions, page actions, page create, contracts, options, and (`bundle-*`) the C# bundle tests. Expectations are C#'s answers. |
| CORPUS `test/fixtures/agent-commands` (52 stored cases) + `normalizer-cases.json` (9) | xunit `JintAgentParityTests`, `AgentParityNormalizerTests`; Go `TestMatchesTheAgentCommandCorpus`, `TestNormalizerMatchesTheTypeScriptNormalizer` | The stored runner with the `jint` expectations, through a Go twin of `AgentParityNormalizer.cs`. |
| `test/unit/server-conformance/fixtures/agent/formula-dates.json` | xunit `AgentFormulaDatesFixtureTests`, Go `TestReadsFormulaDatesInTheHostZoneAsJintDoes` | Formula dates per host zone (six zones, one property with a named zone `Asia/Yekaterinburg`). goja has no Intl and answers as Jint does. |

Re-checked this round: `dotnet test Blok.Server.Tests --filter "AgentHostFixtureTests|AgentServerScenarioTests|AgentFormulaDatesFixtureTests|JintFormulaLimitsTests"` passed 131/131; `go test ./blokagent` passed.

## Hand-ported tests (a fixture cannot express them)

- `TestNewRefusesLimitsBelowTheirFloorsBeforeLoading`: `BlokAgentExecutorTests.FactoryForwardsPoolAndStartupConstraints` (3 rows).
- `TestRoomsPlugIntoExecuteInRoomAndTheRoomContract`: the room seam, and `RoomCommon` (`BlokAgentExecutor.cs:1205-1219`) with history. Mutation-checked: dropping the `HasHistory` branch turns it red.
- `TestConcurrentCallsAnswerAsTheyDoAlone`: six sessions on one executor, `-race`.
- `formula_limits_test.go`: `JintFormulaLimitsTests` (T19), same wall-clock bounds. goja finishes each in under 0.4 s.
- `TestAFullReadOfALargeDatabaseFinishes`: `JintComputedReadTests.AFullReadOfALargeDatabaseFinishes` (1500 rows inside the 10 s default; goja 0.6 s).

## C# test files and their Go oracle

| C# file | Go oracle |
|---|---|
| `BlokAgentExecutorTests`, `BlokAgentPageActionTests`, `BlokAgentPageCreateTests`, `BlokAgentSessionTests` | host.json (fake runtime, byte for byte) + scenarios `contract-*`, `options-*`, `page-*`, `session-*` (real bundle) |
| `JintAgentParityTests`, `AgentParityNormalizerTests` | CORPUS, normalizer cases |
| `JintFormulaLimitsTests` | `formula_limits_test.go` |
| `JintComputedReadTests` | scenario `bundle-computed-read` + `TestAFullReadOfALargeDatabaseFinishes` |
| `JintDatabaseUnlockTests` (6) | scenarios `bundle-database-unlock-refused`, `bundle-database-share` (5 steps) |
| `BlokAgentLockedDeleteTests` (3) | scenarios `bundle-locked-delete-row` (2 steps), `bundle-locked-delete-column` |
| `JintDatabaseLinkedRowsTests` (3) | scenarios `bundle-linked-view-add-row` (2 sessions), `bundle-linked-view-other-document` |
| `JintAttributionTests` (2) | scenarios `bundle-attribution-created`, `bundle-attribution-read-ids`. `createdAt` is a clock value and the matchers have no type check, so only `createdBy`/`createdWith` are pinned. The unlock and attribution C# tests use an actor without `onBehalfOf`; the scenario actor has one (`human-1`), which the attribution test needs anyway. |
| `JintCommentHostTests` (2) | scenarios `options-comments-on`, `options-comments-off` |
| `BlokAgentExecutorRegistrationTests` (7, DI) | N/A in Go: no DI; `FactoryOptions.Rooms` + `TestNewRefuses…` |
| `BlokAgentRoomTests`, `BlokAgentRoomHistoryTests`, `BlokAgentVersionHistoryTests`, `RoomAgentParityTests`, `RoomEditTranslatorTests`, `AgentRoomMoveTests`, `Collab/AgentRoomOpsTests` (MOVES, PFIELDS) | DEFERRED to the room lane (see below) |

The `bundle-*` scenarios and the T15 host case passed on Go at the first run: the stored port already behaved as C# does, so there was no red step. Each was checked to be live: a wrong expectation (`f: 43`) fails Go, and forwarding options to the page target fails five host cases.

## Ledger rows

### 2a. Public surface

| Row | State | Oracle |
|---|---|---|
| P1 Execute | DONE | CORPUS; host.json `execute:*` |
| P2 Contract | DONE | host.json `contract:*`; scenarios `contract-*` |
| P3 RoomContract default | DONE (N/A part) | Go has no default interface methods and no Go code consumes an executor interface (there is no route, ledger 0.1). `Executor.RoomContract` is concrete; host.json `room contract: without rooms…`, Go `TestRoomsPlug…` |
| P4 OpenSession default throws | N/A | It is a default method for host-written executors. Go's `Executor` always keeps sessions; there is no interface to default. |
| P5 ExecuteInRoom | DONE for this lane | host.json `room:*` (no collaboration → COMMAND_UNAVAILABLE, empty id → argument error); `Rooms` seam pinned by `TestRoomsPlug…`. The room runner itself is the room lane. |
| P6 Actor, P7 Execution | DONE | host.json, CORPUS |
| P8 Options | DONE | host.json `execute: built-in comments…`, `custom tools…`, `overrides…`; scenarios `options-*`. T16: `DisableBuiltInComments` so the zero value keeps comments on. |
| P9-P11 page target, creator, location | DONE | host.json `page action:*`, `page create:*`; scenarios `page-action-*`, `page-create-*` |
| P12 Session | DONE | host.json `session:*`; scenarios `session-*`; CORPUS (one session per case) |
| P13 factory | DONE | `TestNewRefusesLimitsBelowTheirFloorsBeforeLoading` |
| P14 DI registration | DONE (as a constructor) | Go has no DI. `FactoryOptions.Rooms` is the registration's "rooms only with collab"; a host builds its own executor, which is TryAdd's "host wins". |
| P15 validated up front | DONE | `TestNewRefuses…` (limits fail before the bundle loads) |

### 2b. Wire

W1-W9 DONE: host.json pins each request byte for byte (W1 option combos, W2 room contract, W3 actor, W4-W6 the three ops, W7 the three contracts, W8 missing `result`/`document`/`history`, W9 caller cancel stays `ctx.Err()`).

### 2c. Failures C# writes itself

- F1-F7 DONE: host.json `page create:*` / `page action:*` (exact bytes), scenarios `page-create-forbidden*`, `page-action-unresolved`, `page-action-stored`.
- F8 DONE: host.json `room: without collaboration answers unavailable and never runs`.
- F9-F28 DEFERRED to the room lane: they are written on the room path (`RunRoomAsync`, `RoomAgentHistory`, version history), which needs a Go `CollabEditOp` applier over a live YDoc. None exists in `packages/server/go` yet.

### 2d. Stored path and sessions

| Row | State | Oracle |
|---|---|---|
| S1 | DONE | CORPUS; host.json `execute: success…`, `a failure…` |
| S2-S4 | DONE | host.json `page action:*`; scenarios `page-action-*` (S3 mixed batch: `page-action-mixed`). T15 (target runs with options nil): host.json `page action: the target runs with no options, not the source batch's` (source sends custom tools, overrides, comments off; the target sends none) |
| S5 | DONE | host.json `page action: in a session…`; scenario `session-page-action` |
| S6, S7 | DONE | host.json `page create:*`; scenarios `page-create-*` |
| S8 | DONE | scenario `page-create-forged-id` (bundle) |
| S9 | DONE | host.json `session: too many steps…`, `the char cap counts escaped UTF-16 units` (T1), `keeps the newest step…`; scenario `session-cap` |
| S10 | DONE | host.json `page create: in a session…keeps the steps`, `page action: in a session a failed action keeps the steps` |
| S11 | DONE | scenario `session-foreign-save` |
| S12 OpenSession(null) | N/A | `Actor` is a Go value type; a nil actor cannot be passed. |

## Decisions

- **T5 runtime name: Go reports what C# reports; no bundle change.** The bundle reads `input.runtime` only as a capability switch: `src/view/server-runtime.ts:497-498` (`csharp-live` or else `jint` + `carriesHistory`), used by `src/shared/tool-manifest.ts:376-378` (`PREPARES_INSERT`), `:392` and `:535` (`UNDO_RUNNERS`), `:423`/`:534` (editor-only commands) and `:434` (comments). The name never appears in an answer: the contract's `runtime` field is the command's own `'any'|'editor'` (`tool-manifest.ts:547,566`). Go sends the same input bytes as C# (host.json pins the stored inputs with no `runtime` and the room contract with `csharp-live`), so every answer matches. A `go-live` name would only copy `csharp-live`'s capabilities and change the shared bundle, whose bytes the bundle law ties to the C# copy (U9).
- **T3 `group: 15.0`: DEFERRED to the room lane.** It is read only in `RunVersionReadAsync` (`BlokAgentExecutor.cs:938-941`), a room-only path. C# `TryGetValue<int>` refuses `15.0` (per the ledger's probe `probe2.fsx`, not re-run this round), so the list falls back to no grouping. The room lane needs a jsjson integer read that refuses number text with a fraction or exponent (`15.0`, `1.5e1`).
- **T21 failure key order**: host.json pins the exact failure bytes (`ok, error, warnings, revision`, no empty `revision`).
- **Observation (bundle, not ported code)**: a session batch `{"name":"history.undo"}` with no `args` makes the bundle throw, and Go returns `*blokdocs.ConversionError` (InvalidDocument) rather than an INVALID_ARGS result. Same bundle bytes run in Jint; that C# answers the same is UNVERIFIED.

## Deferred to the room lane (with the reason)

All of these run on the live-room path, which needs a Go `CollabEditOp` applier over a YDoc and the collab room manager. Neither exists in `packages/server/go` (no `ApplyOps`/`SetPageField` anywhere under it). The room runner plugs into `blokagent.Rooms` (`FactoryOptions.Rooms`); `RoomContract` already sends `RoomCommon`'s bytes.

- 2e-2h (dispatch order, room undo/redo, translator, version history) and F9-F28.
- The room CORPUS runner (52 cases with the `room` expectations).
- MOVES (`agent-moves.json`) and PFIELDS (`agent-page-fields.json`): `AgentRoomOpsTests` applies `CollabEditOp.Move`/`SetPageField` to a YDoc through `RichTextRuntime.ApplyOps`; they test room ops, not the stored executor. Owner: collab ledger row E10 (`collab.md:214`, agent-only ops, fixtures `agent-moves.json` and `agent-page-fields.json`).
- T2, T4, T6-T14, T17, T18, T20 (room traps). T3 as above.
- 2i shared lanes (collab/http-host).

## Round log

- Round 1: committed the factory/room-seam/concurrency tests; re-proved the C# side (131/131, then 138/138 with the new cases); added the T15 host case and nine `bundle-*` scenarios (36/36 on C#, all pass on Go); hand-ported the large read; full `go test -race -p 2 ./blokagent` passed (777 s).
