# Go server parity ledger: agent

Area: `Blok.Server/Agent` (BlokAgentExecutor, BlokAgentSession, IBlokAgentExecutor, RoomAgentHistory, RoomEditTranslator), its tests, the room lanes it shares with EditEndpoint/HistoryEndpoint, and the agent conformance fixtures.

All paths are relative to `packages/server/dotnet/` unless they start with `src/`, `test/` or `scripts/`. Line numbers come from the working tree on 2026-10-31.

## 0. Facts that shape the port

1. **The agent executor has no HTTP route.** A grep for `IBlokAgentExecutor|BlokAgentExecutor|BlokAgentOptions` across `Blok.Server.Host` and `Blok.Server.AspNetCore` finds only the DI registration (`Blok.Server.AspNetCore/BlokDocumentsServiceCollectionExtensions.cs:79-86`). Neither `EditEndpoint.cs` nor `HistoryEndpoint.cs` mentions "agent". The executor is a **library API** that host apps embed. The standalone Host never calls it.
2. **Almost all agent logic runs in JS.** C# runs the embedded bundle `Blok.Server.Runtime.blok-server-runtime.js` (`Blok.Server/Blok.Server.csproj:48-49`) through `IBlokRuntime.InvokeAsync(operation, inputJson, timeout, ct)` (`Blok.Server/Runtime/IBlokRuntime.cs:3-17`). It uses four operations: `manifest`, `agentExecute`, `agentPagesNeeded`, `agentPlanHost` (`src/view/server-runtime.ts:619-718`). So Go must host the same bundle in a JS engine. **The engine is owned by the documents-runtime area, and this area cannot start before it exists.** Which Go JS engine to use, and how it behaves on ReDoS, deep recursion and timeouts, is UNVERIFIED.
3. **What C# owns itself.** These parts must be hand-ported:
   - orchestration: dispatch order, host callbacks and page create/cleanup;
   - every `Failure(...)` it writes itself (§2c);
   - live-room undo history (`RoomAgentHistory`);
   - the edit→room-op translator;
   - `WithHead` revision rewriting;
   - session step bounding.
4. **No black-box conformance test reaches the executor.** `mcp-agent-participant.test.ts` drives a TS MCP server, which joins the room as a WebSocket peer (`test/unit/server-conformance/mcp-agent-participant.test.ts:46-47, 182-240`). It exercises sync, awareness, tickets and `/history`. It does not exercise `IBlokAgentExecutor`. Agent parity today is proven only **in-process** (xunit), against shared fixtures.
5. **Package-placement decision (open).** The old Go tree had only `cmd/` and `internal/` (`git ls-tree -r ad5782d7^ packages/server`: no agent code), and its module was `github.com/JackUait/blok/packages/server` (`git show ad5782d7^:packages/server/go.mod`). Go's `internal/` cannot be imported by consumers. The page-target callbacks (`IBlokPageTarget`, `BlokPageLocation.Stored` delegates) only work in-process. **Proposal:**
   - an exported package `packages/server/blokagent` for the public types;
   - `packages/server/internal/agent/{roomhistory,translate}` for the helpers.

   The plan must decide this.

## 1. Oracle legend

| Key | Oracle | How Go runs it |
|---|---|---|
| CORPUS | `test/fixtures/agent-commands/{cases,evals,goldens}` + `normalizer-cases.json`. The C# readers (`Blok.Server.Tests/Agent/AgentParityCorpus.cs:108-150`) skip cases with `services` and evals with `parityExcluded`. That leaves **52 cases** (39 cases + 13 evals): `python3` count over the dirs printed `39 13 52`. The normalizer has 9 cases. | In-process `go test`: stored runner and room runner, with the expectation keys `jint`/`room` (`test/unit/agent/parity/corpus.ts:7`) and a port of `AgentParityNormalizer.cs`. |
| MOVES | `test/unit/server-conformance/fixtures/agent-moves.json` (seed + 4 cases), written by `agent-move-fixture.test.ts` | In-process; C# reader at `Blok.Server.Tests/Collab/AgentRoomOpsTests.cs:57-108` |
| PFIELDS | `test/unit/server-conformance/fixtures/agent-page-fields.json` (4 steps), written by `agent-page-fields-fixture.test.ts` | In-process; C# reader at `AgentRoomOpsTests.cs:13` |
| MCP | `test/unit/server-conformance/mcp-agent-participant.test.ts` (5 `it`s, lines 182, 242, 279, 294, 318), gated on `BLOK_CONFORMANCE_SERVER` | Black-box. Needs host flags `--listen --auth ticket --storage-dir '' --rate-limit 0 --collab --collab-dir --doc-endpoint --conformance-journal --allow-origin` (lines 152-157). It covers room attribution and journal actors only, not the executor. |
| SCEN | **Proposed** `test/fixtures/agent-server-scenarios/*.json` (see §6) | In-process; both xunit and `go test` read it |
| NONE | No oracle exists yet. The ledger's NONE rows each name the SCEN family to add. | n/a |

## 2. Parity ledger

Columns: ID | C# location | What it does | Oracle | Go home. Go homes use `ba/` = `packages/server/blokagent`, `ia/` = `packages/server/internal/agent`.

### 2a. Public surface

| ID | C# location | What it does | Oracle | Go home |
|---|---|---|---|---|
| P1 | `Blok.Server/Agent/IBlokAgentExecutor.cs:13-15` | `ExecuteAsync(documentJson, batchJson, actor, options?, ct)` runs a batch on a stored doc. It returns a document only on success. | CORPUS (stored runner) | `ba/executor.go` `Execute` |
| P2 | `IBlokAgentExecutor.cs:25-26` | `GetContractAsync(options?)` returns the plain-call contract JSON. That contract has no `history.undo/redo`. | NONE: SCEN `contract-*` | `ba/executor.go` `Contract` |
| P3 | `IBlokAgentExecutor.cs:36-38` | `GetRoomContractAsync` defaults to `GetContractAsync` (a default interface method). | NONE: SCEN `contract-*` | `ba/executor.go`; Go has no default methods, so use an optional interface or an embedded base |
| P4 | `IBlokAgentExecutor.cs:49-50` | `OpenSession` by default throws `NotSupportedException("This executor keeps no agent sessions.")`. | NONE (host-executor only) | `ba/executor.go`; optional interface `SessionOpener` |
| P5 | `IBlokAgentExecutor.cs:59-61` | `ExecuteInRoomAsync(docId, batchJson, actor, options?, ct)` runs a batch on a live room. | CORPUS (room runner) | `ba/executor.go` `ExecuteInRoom` |
| P6 | `IBlokAgentExecutor.cs:68` | `BlokAgentActor(Id, Name, OnBehalfOf?)` is the agent identity. | CORPUS | `ba/types.go` `Actor` |
| P7 | `IBlokAgentExecutor.cs:74` | `BlokAgentExecution(ResultJson, DocumentJson?, Revision)` is the result. Revision is a content hash (stored) or `lineage:seq` (room). | CORPUS | `ba/types.go` `Execution` |
| P8 | `IBlokAgentExecutor.cs:77-96` | `BlokAgentOptions`: `PageTitles`, `PageTarget`, `CustomToolsJson`, `OverridesJson`, and `BuiltInComments`, which **defaults to true** (line 95). | NONE: SCEN `options-*` (C# coverage today: `BlokAgentExecutorTests.cs` theories at 257-312; `JintCommentHostTests.cs`) | `ba/types.go` `Options`; a zero-value bool flips the default, so use `DisableBuiltInComments` or `*bool` |
| P9 | `IBlokAgentExecutor.cs:99-108` | `IBlokPageTarget.ResolveAsync(pageId, actor)` returns a location, or null when not found or forbidden. | NONE: SCEN `page-action-*` | `ba/pages.go` `PageTarget` |
| P10 | `IBlokAgentExecutor.cs:116-126` | `IBlokPageCreator : IBlokPageTarget`. `CreateAsync(actor)` returns a new page id; null or empty means FORBIDDEN. | NONE: SCEN `page-create-*` | `ba/pages.go` `PageCreator` (detected with a type assertion) |
| P11 | `IBlokAgentExecutor.cs:129-145` | `BlokPageLocation` is a closed union: `Stored(LoadAsync, SaveAsync)` or `Room(DocId)`. | NONE: SCEN `page-action-*` | `ba/pages.go` sealed interface + 2 structs |
| P12 | `Blok.Server/Agent/BlokAgentSession.cs:13-56` | `BlokAgentSession`: `Actor`, `GetContractAsync` (the contract offers history.*), `ExecuteAsync(doc, batch)`. Not thread-safe (line 11). | CORPUS (the Jint runner uses one session per case: `JintAgentParityTests.cs:27`) | `ba/session.go` |
| P13 | `Blok.Server/Documents/BlokDocuments.cs:136-143` | `CreateAgentExecutor(poolSize?, timeout?, allocationBudgetBytes?)` builds an executor over a fresh engine pool. It throws `ArgumentOutOfRangeException` naming the param. | NONE: SCEN not applicable (startup). Go unit test mirroring `BlokAgentExecutorTests.FactoryForwardsPoolAndStartupConstraints` (3 rows) | `ba/factory.go` `New(opts)`, returning an error |
| P14 | `Blok.Server.AspNetCore/BlokDocumentsServiceCollectionExtensions.cs:79-86` | DI: one singleton. It gets rooms only when `BlokServerOptions.CollabEnabled`, in either registration order. A host-registered executor wins (TryAdd). | NONE (Go has no DI; port as a constructor option `WithRooms`). Mirror `BlokAgentExecutorRegistrationTests.cs` (7 cases) | `ba/factory.go`; host wiring in `cmd/blok-server` is optional |
| P15 | `BlokDocumentsServiceCollectionExtensions.cs:72-73` | Timeout and budget are validated up front, not in the lazy factory. | NONE: Go unit test | `ba/factory.go` |

### 2b. Host↔bundle wire (Go must send and read exactly these keys)

| ID | C# location | What it does | Oracle | Go home |
|---|---|---|---|---|
| W1 | `BlokAgentExecutor.cs:1169-1202` `Common` | Input keys:<br>• `services`: `["pageBackend"]` iff PageTitles && PageTarget≠null.<br>• `prepares`: `["page"]` iff PageTarget is a creator.<br>• `customTools` and `overrides`: parsed JSON, not strings.<br>• `comments: false` iff BuiltInComments is false. | CORPUS (partly). Option combos: NONE, use SCEN `options-*` | `ia/wire.go` |
| W2 | `BlokAgentExecutor.cs:1205-1219` `RoomCommon` | Adds `runtime: "csharp-live"`. When the journal keeps history it also adds `"versionHistory"` to services and sets `restores: true`. | NONE: SCEN `contract-room-*` | `ia/wire.go` |
| W3 | `BlokAgentExecutor.cs:1221-1231` | Actor node: `{id, name, kind:"agent", onBehalfOf?}`. The bundle validates it (`src/view/server-runtime.ts:442-446`). | CORPUS | `ia/wire.go` |
| W4 | `BlokAgentExecutor.cs:53-77`; `server-runtime.ts:619-660` | `agentExecute` input: `document`, `batch`, `actor`, plus optional `history`, `createdPages`, `versionHistory`. Output: `{result, document, edits, history?, restore?}`. Bad input makes the bundle throw a `TypeError` (lines 624-631). | CORPUS | `ia/wire.go` |
| W5 | `BlokAgentExecutor.cs:138-147`; `server-runtime.ts:663-689` | `agentPagesNeeded` returns `{count}`, or `{count:0, result}` when the batch is refused. | NONE: SCEN `page-create-*` | `ia/wire.go` |
| W6 | `BlokAgentExecutor.cs:222-237`; `server-runtime.ts:692-718` | `agentPlanHost` returns `{result, plan, batch, view}`. C# reads `batch.commands[0].{name,args}` and `view.blocks[0].data.pageId`. | NONE: SCEN `page-action-*` | `ia/wire.go` |
| W7 | `BlokAgentExecutor.cs:338-373` | `manifest` call: C# returns only `output.contract`, re-serialized. The session contract sends `history:{}` (line 354); the room contract uses `RoomCommon`. | NONE: SCEN `contract-*` | `ia/wire.go` |
| W8 | `BlokAgentExecutor.cs:83-104` | When the runtime output is missing `result`, `document` (on ok) or `history` (in a session), C# throws `InvalidOperationException`. | NONE: Go unit test with a fake runtime (as `BlokAgentExecutorTests` does) | `ba/executor.go` returns an error |
| W9 | `BlokAgentExecutorTests.cs:405-419` | When the caller cancels, the call throws `OperationCanceledException`. It never becomes an AgentResult. The token is passed to every runtime op. | NONE: Go unit test (`ctx.Err()`) | `ba/executor.go` |

### 2c. Failures C# writes itself (Go must hand-write each one)

Shape (`BlokAgentExecutor.cs:1132-1149`): `{ok:false, error:{code,message,retryable,details?}, warnings:[], revision?}`. `revision` appears only when it is non-empty.

| ID | C# location | Code / retryable / details / revision. Message is exact. | Oracle | Go home |
|---|---|---|---|---|
| F1 | `:165` | FORBIDDEN / false / – / –. "The host does not let this agent create a page here. Nothing was written." After ≥1 page was made it becomes F4. | NONE: SCEN `page-create-forbidden` (C# today: `BlokAgentPageCreateTests.AHostThatRefusesTheActor…`) | `ba/failures.go` |
| F2 | `:181-182` | CANCELLED / false. "The batch was cancelled. Nothing was written." Used only after pages were made, always wrapped by F4. | NONE: SCEN `page-create-stop-cancel` | `ba/failures.go` |
| F3 | `:183` | APPLY_FAILED / **true**. "The batch stopped on a server error. Nothing was written." Wrapped by F4. | NONE: SCEN `page-create-stop-error` | `ba/failures.go` |
| F4 | `:192-206` | ORPHANED_SIDE_EFFECT / false / `{orphaned:[{command:"block.insert",type:"page",prepared:{pageId}}…], cause}` / the failed result's revision. Message: "The batch failed after the host did work for it ({cause.message}). Clean up the listed items." It does not wrap again when the cause is already ORPHANED_SIDE_EFFECT or has no error object. | NONE: SCEN `page-create-*` | `ba/failures.go` |
| F5 | `:310-333` | PRECONDITION_FAILED / false / `{pageId?}` / the source revision. "The page block points at no page this server can open." Warnings are copied from the source. | NONE: SCEN `page-action-unresolved` | `ba/failures.go` |
| F6 | `:289-302` | Target failure: the target's error plus `details.pageId`, the source revision, and warnings = source + target. | NONE: SCEN `page-action-target-fails` | `ba/pageaction.go` |
| F7 | `:305` | Page-action success: `results = [{pageId, applied:true}]`, other fields from the source result. | NONE: SCEN `page-action-ok` | `ba/pageaction.go` |
| F8 | `:390`, `:1151-1167` | COMMAND_UNAVAILABLE / false / `{reason:"runtime"}` / –. "Live rooms need collaboration on this server." | NONE: SCEN `room-no-collab` (C#: `RoomsReturnAStructuredRuntimeRefusal…`, `WithoutCollabTheRoomPathIsUnavailable`) | `ba/failures.go` |
| F9 | `:403` | INVALID_ARGS / false. "In a room, expectRevision is the journal head \"lineage:sequence\" a result returned. Read the room again and pass its revision." | NONE: SCEN `room-expect-malformed` | `ba/failures.go` |
| F10 | `:423`, `:470`, `:836` | APPLY_FAILED / **true**. "The room could not be read. Nothing was written." | NONE: SCEN `room-unreadable` | `ba/failures.go` |
| F11 | `:428`, `:841`, `:795`, `:905`, `:1016` | STALE / **true** / `{revision: head}` / head. "The room changed since you read it. Read it again, then retry." | NONE: SCEN `room-stale-*` | `ba/failures.go` |
| F12 | `:1013-1036` | Rich STALE: C# re-runs Jint against the current room with `batch.expectRevision = head`. It uses Jint's STALE (with `details.current`) and falls back to F11. | NONE: SCEN `room-stale-current` (C#: `AStaleHeadCarriesTheCurrentBlocks`) | `ba/room.go` |
| F13 | `:595` | INVALID_ARGS / false. "This room keeps no journal, so expectRevision cannot be checked. Send the batch without it." | NONE: SCEN `room-nojournal-expect` | `ba/failures.go` |
| F14 | `:597-601` | APPLY_FAILED. Retryable iff status ∈ {Overloaded, Unavailable, Draining, SeedFailed}. Details `{status:"<enum name>"}`, plus head. "The room refused the edit ({Status}). Nothing was written." | NONE: SCEN `room-refused-*` | `ba/failures.go`; enum names must print as the C# names |
| F15 | `:673-675`, `:713-716` | NOTHING_TO_UNDO "This session has no step to undo." and NOTHING_TO_REDO "This session has no undone step to redo." / false. | NONE: SCEN `room-undo-empty` | `ba/failures.go` |
| F16 | `:678`, `:708` | CONFLICT / **true**. "The room was reset or reloaded since this step, so it can no longer be {undone\|redone}. Re-read the document." | NONE: SCEN `room-undo-reset` | `ba/failures.go` |
| F17 | `:720` | UNDO_OTHER_DOCUMENT / false. "The last batch wrote another document (a sub-page title or icon). history.undo cannot undo it. To revert it, run that command again with the old value." | NONE: SCEN `room-undo-page-action` | `ba/failures.go` |
| F18 | `:730` | CONFLICT / **true**. "Someone else changed what this step wrote, so it can no longer be {verb}. Re-read the document before retrying." | NONE: SCEN `room-undo-peer-conflict` | `ba/failures.go` |
| F19 | `:736-739` | APPROVAL_REQUIRED / false / `{reason:"no-channel", approval:{kind:"database.unlock", blockId}}`. Message names the database and "undo"/"redo". | NONE: SCEN `room-undo-unlock` | `ba/failures.go` |
| F20 | `:744-747` | APPROVAL_REQUIRED / false / `{reason:"no-channel", approval:{kind:"database.share", blockId, viewId}}`. | NONE: SCEN `room-undo-share` | `ba/failures.go` |
| F21 | `:781-791` | Undo/redo success is built by C#: `{ok:true, revision:head, results:[{}], refs:{}, changed:{created:[],updated:[],moved:[],removed:[]}, warnings:[]}`. | NONE: SCEN `room-undo-ok` | `ba/roomhistory.go` |
| F22 | `:796-798` | APPLY_FAILED. "The room refused the {undo\|redo} ({Status}). Nothing was written." Same retryable set as F14. | NONE: SCEN `room-undo-refused` | `ba/failures.go` |
| F23 | `:831` | TOOL_ACTION_FAILED / false. "The version history failed: this document was deleted." Purged rooms only. | NONE: SCEN `version-purged` | `ba/failures.go` |
| F24 | `:891` | VERSION_NOT_FOUND / false. "There is no version \"{version}\". history.versions lists them." | NONE: SCEN `version-restore-unknown` | `ba/failures.go` |
| F25 | `:893-894`, `:1065` | TOOL_ACTION_FAILED. "The version history failed: the restore could not run ({History})." Retryable = `RestoreRetryable` (W/H rows). | NONE: SCEN + port `AFailedRestoreIsRetryable…` (5 rows) | `ba/failures.go` |
| F26 | `:909-912` | APPLY_FAILED. "The room refused the restore ({Status}). Nothing was written." | NONE: SCEN `version-restore-refused` | `ba/failures.go` |
| F27 | `:946`, `:1001` | Loader refusals go to Jint as `{failed:"The version history could not be read ({Status}).", status:<http>}` and `"Version \"{v}\" could not be read ({Status})."`. Jint decides whether a retry can help (`server-runtime.ts:466-486`). | NONE: SCEN `version-load-failed` | `ia/versions.go` |
| F28 | `:449-457` | History gate: Jint's refusal is passed through with `revision` **removed** and Revision "". | NONE: SCEN `room-undo-not-offered` (C#: `RefusesUndoTheContractDoesNotOffer`) | `ba/room.go` |

### 2d. Stored path and sessions

| ID | C# location | What it does | Oracle | Go home |
|---|---|---|---|---|
| S1 | `BlokAgentExecutor.cs:91-104` | Returns a document only when `result.ok`. Revision = `result.revision` or "". | CORPUS | `ba/executor.go` |
| S2 | `BlokAgentExecutor.cs:58-65` | A page action with PageTitles and a target goes to the host-action path, with no Jint `agentExecute` on the source. | NONE: SCEN `page-action-*` | `ba/pageaction.go` |
| S3 | `BlokAgentExecutor.cs:213-217` | A page action is any command named `page.rename` or `page.setIcon`, anywhere in the batch. Jint's plan refuses mixed batches (C# test `RefusesAPageActionInAMixedBatch…`). | NONE: SCEN `page-action-mixed` | `ba/pageaction.go` |
| S4 | `BlokAgentExecutor.cs:247-274` | Builds the inner batch `doc.setTitle {title}` or `doc.setIcon {icon}`. It runs on the target **with options = null**, then calls `SaveAsync` only if the target returned a document. It checks cancellation before the save. | NONE: SCEN `page-action-stored` | `ba/pageaction.go` |
| S5 | `BlokAgentExecutor.cs:111-123` | After a successful page action, a session pushes `"other"` onto `history.past`. | NONE: SCEN `session-page-action` (C#: `AnswersUndoOtherDocumentAfterAPageAction`) | `ba/session.go` |
| S6 | `BlokAgentExecutor.cs:130-175` | Page pre-create: counts pages with `agentPagesNeeded`, then calls `CreateAsync` count times, checking cancellation before each. The ids go to Jint as `createdPages`. | NONE: SCEN `page-create-*` | `ba/pagecreate.go` |
| S7 | `BlokAgentExecutor.cs:87-90` | A runtime throw after pages were made becomes F2/F3 wrapped in F4. With no pages made, the exception propagates. | NONE: SCEN `page-create-stop-*` | `ba/pagecreate.go` |
| S8 | `server-runtime.ts:510-553` | The bundle hands out created ids in batch order. Unused ids or a shortage give STALE/ORPHANED_SIDE_EFFECT inside Jint. | CORPUS does not cover this (no creator). NONE: SCEN `page-create-count-drift` | bundle (shared) |
| S9 | `BlokAgentSession.cs:15-17,59-74` | Session caps: 100 steps and 4 MiB "chars". Trim drops **past first, then future**, and always keeps the newest step. | NONE: SCEN `session-trim-*` (C#: `TrimsTooMany{Steps,Bytes}BeforeTheyReachJint`) | `ba/session.go` |
| S10 | `BlokAgentSession.cs:50-53` | A failed or missing `history` from the runtime keeps the old steps. | NONE: SCEN `session-*` | `ba/session.go` |
| S11 | `server-runtime.ts:505-523` | Carried history is dropped (`lost`) when the doc's content revision differs from the one recorded. That gives CONFLICT on undo. | NONE: SCEN `session-foreign-save` (C#: `RefusesToUndoOverSomeoneElsesSave`) | bundle (shared) |
| S12 | `BlokAgentExecutor.cs:34-39` | `OpenSession(null)` throws `ArgumentNullException`. | NONE: Go unit test | `ba/executor.go` |

### 2e. Room path: dispatch order (reordering changes answers)

| ID | C# location | What it does | Oracle | Go home |
|---|---|---|---|---|
| R1 | `BlokAgentExecutor.cs:384-391` | Empty docId throws. With no rooms or converter the answer is F8. | NONE: SCEN `room-no-collab` | `ba/room.go` |
| R2 | `:393-405`, `:1118-1130` | `expectRevision` is **removed** before Jint and parsed with `ParseHead`. Bad input → F9. | NONE: SCEN `room-expect-*` | `ba/room.go` |
| R3 | `:411-414`, `:809-815` | Step 1: if **`commands[0]`** is a version command, take the version-read path (V rows). | NONE: SCEN `version-*` | `ba/versions.go` |
| R4 | `:417-442` | Step 2: page action. It reads the room state, checks expect (F11), and runs S2-S4. On success it adds `Step{Other=true}`, then `WithHead(current)`. | NONE: SCEN `room-page-action` | `ba/room.go` |
| R5 | `:444-460`, `:633-640` | Step 3: history gate. It applies only when the batch is exactly one command with ≤2 keys, named history.undo/redo, with `args:{}`. Jint runs on `{blocks:[]}`, and only NOTHING_TO_UNDO/REDO lets the room replay. | NONE: SCEN `room-undo-*` | `ba/room.go` |
| R6 | `:464-489` | Step 4: page pre-create, outside the lane. It checks expect first (stale → F12, no page made). | NONE: SCEN `room-page-create-stale` | `ba/room.go` |
| R7 | `:496-546` | Step 5: lane edit. Export, run Jint `agentExecute`, translate. A not-ok result writes nothing. Zero ops with no journal also write nothing. `wrote` = edits non-empty. After apply, the step is recorded (`Between`). | CORPUS (room runner) | `ba/room.go` |
| R8 | `:496-498` | operationId = new GUID "N" for each call. digest = SHA-256(`"agent\n{actor.Id}\n{rawBatchJson}"`). | NONE (internal; see trap T7) | `ba/room.go` |
| R9 | `:547-561` | A refusal or a read without a journal returns the planned result with the revision **removed**. A throw after pages were made gives F2/F3+F4, but only if `RoomLinksNoneAsync`. Otherwise it rethrows. | NONE: SCEN `room-page-create-throw-after-commit` | `ba/room.go` |
| R10 | `:565-583`, `:587-603` | On a status other than Applied: F11/F12 (PreconditionFailed), F13 (PreconditionRequired), F14 (else). With created pages the answer is wrapped in F4, but only if the room links none of them. | NONE: SCEN `room-refused-*` | `ba/room.go` |
| R11 | `:609-630` | `RoomLinksNoneAsync` reads with `CancellationToken.None`. A read error or missing blocks counts as "linked" (fails closed). | NONE: SCEN `room-page-create-*` | `ba/room.go` |
| R12 | `:1081-1113` | `WithHead`: sets or removes `revision` at the top level, in each `results[i]` that has `revision`, and in `error.details.revision`. | CORPUS (room runner checks codes only). NONE for the shapes: SCEN `room-revision-shape` | `ba/room.go` |
| R13 | `:563`, `:1050` | Head string = `"{lineage}:{serverSequence}"`. An empty head means no revision. | MCP (indirectly: `serverSequence` string). NONE: SCEN | `ba/room.go` |

### 2f. Room undo/redo (`RunRoomHistory*`, `RoomAgentHistory`)

| ID | C# location | What it does | Oracle | Go home |
|---|---|---|---|---|
| H1 | `BlokAgentExecutor.cs:647-660` | Retries up to 3 attempts on STALE, but only when the caller sent no expectRevision. | NONE: SCEN `room-undo-retry` | `ba/roomhistory.go` |
| H2 | `:668-698` | Pre-lane check: no top step → F15. The step's lineage must match the current head lineage, else F16. The current head is pinned as expect. | NONE: SCEN `room-undo-reset` | `ba/roomhistory.go` |
| H3 | `:702-758` | In the lane: re-reads Top, checks lineage, empty, Other (F17), projection equality (F18), unlock (F19) and share (F20). Then plans with `CollabRestorePlanner.Plan(...)` + `Stamps(wanted)`. | NONE: SCEN `room-undo-*` | `ba/roomhistory.go` (needs collab's restore planner) |
| H4 | `:760-770` | After apply: `Replayed` moves the step and stores what the room now holds. | NONE: SCEN `room-undo-redo-cycle` | `ia/roomhistory/history.go` |
| H5 | `:759` | Undo digest = SHA-256(`"agent-{verb}\n{actorId}\n{newGuid}"`). It never deduplicates. | NONE | `ba/roomhistory.go` |
| H6 | `RoomAgentHistory.cs:15-23` | Key = (docId, actorId, onBehalfOf). Caps: 100 steps and 4 MiB. Idle limit 1 hour. | NONE: SCEN `room-undo-per-person` (C#: `OnePersonCannotUndoTheBatchTheAgentWroteForAnother`) | `ia/roomhistory/history.go` |
| H7 | `RoomAgentHistory.cs:53-68,148-156` | `Top` and `Add` prune idle keys and touch LastUsed. `Replayed` and `Forget` do not prune. | NONE: SCEN `room-undo-idle` (needs a fake clock: C# takes a `TimeProvider`) | same |
| H8 | `RoomAgentHistory.cs:119-146` | `Add`: append to Done. Clear Undone unless the step is Other. Then trim **Done only**, from the oldest, while steps > 100, or while Done > 1 and chars > 4 MiB. | NONE: SCEN `room-undo-cap` (C#: `UndoStopsAtTheOldestKeptStep`) | same |
| H9 | `RoomAgentHistory.cs:74-104` | `Replayed`: false when the key is gone or the step is not the top by **reference identity**. | NONE: SCEN `room-undo-concurrent` (C#: `TwoUndosAtOnceTakeTheStepBackOnce`) | same |
| H10 | `RoomAgentHistory.cs:107-116`; `BlokAgentExecutor.cs:23-26`; `CollabRoomManager.cs:332,824,1080` | `Forget(docId)` runs on DocumentReplaced, which fires on reset (332), on an applied restore (824) and before purge (1080). | NONE: SCEN `room-undo-forget-{reset,restore,purge}` | same + collab event |
| H11 | `RoomAgentHistory.cs:159-198,446-454` | `Between`: changed ids = ids whose `"{prevSibling}\n{unstampedJson}"` differs. Changed page keys = `"{map}/{key}"` over maps `["page","values"]` (`YDocConverter.cs:86`) whose Fingerprint differs. | NONE: SCEN `room-undo-*` | `ia/roomhistory/project.go` |
| H12 | `RoomAgentHistory.cs:205-249` | `Project`: `{blocks:{id→{block(unstamped),after}\|null}, order:[ids in doc order], page:{key→fingerprint}, stamps:{id→{at,by,with}}}`. Ids and keys are ordinal-sorted. | NONE | same |
| H13 | `RoomAgentHistory.cs:326-329` | `Same` compares blocks, order and page by **serialized JSON string** (stamps ignored). | NONE | same |
| H14 | `RoomAgentHistory.cs:255-269` | `Unlocks`: a database whose title property has `databaseLocked:true` now, still present in wanted, and not locked there. Mirrors `src/shared/agent/approval.ts` unlockedBetween. | NONE: SCEN `room-undo-unlock` | same |
| H15 | `RoomAgentHistory.cs:277-323` | `Shares`: compares raw `[formIsNullOrObject, form.closed, form.public, form.anonymous, form.submissionAccess, calendarSync]` per view. A view with no id compares against the defaults. Fails closed on unreadable values. | NONE: SCEN `room-undo-share` (3 C# inline rows) | same |
| H16 | `RoomAgentHistory.cs:332-384` | `Restore`: put the wanted blocks back after their `after` sibling, or else at the parent's first slot, or else at the end. Page keys are set or removed. | NONE: SCEN `room-undo-move` (C#: `PutsAMovedBlockBackAndTakesBackATitle`) | same |
| H17 | `RoomAgentHistory.cs:390-402` | `Stamps`: re-emit `SetMetadata(id, at, by, with)`. `at` is parsed from the JSON text, because a long fails `TryGetValue<double>`. | NONE | same |
| H18 | `RoomAgentHistory.cs:481-491` | `Fingerprint`: `"absent"`, the plain value as JSON, or `"shared:{TypeName}"` for a Y type. | NONE | same |

### 2g. Translator (`RoomEditTranslator`)

| ID | C# location | What it does | Oracle | Go home |
|---|---|---|---|---|
| T-1 | `RoomEditTranslator.cs:48-49,114-159` | `insert` → `Insert(id, {type,data,tunes?,createdAt?,createdBy?,createdWith?}, afterId, parentId)`, recursing into children in order. createdWith is only kept when createdBy is present. | MOVES (partly). NONE for co-author stamps: SCEN `translate-insert` (C#: `CarriesTheCoAuthorIdsTheJsonApplierWrote`) | `ia/translate/translate.go` |
| T-2 | `:51-59` | `remove` → `Lift(id)` then `Remove(id)`, unless `withChildren === true`. | NONE: SCEN `translate-remove` (C#: `ARemoveThatKeepsChildrenLiftsThemAndStampsThem`) | same |
| T-3 | `:60-62` | `move` → `Move(id, afterId, parentId)`. | MOVES | same |
| T-4 | `:27-37,63-65` | `setData`/`setRichText` collapse into ONE `Update(id, finalData)`, placed at the last such edit. | CORPUS (room runner) | same |
| T-5 | `:66-78` | `setTunes` → `SetTunes(id, {name→final value or null})` for each tune named. | NONE: SCEN `translate-tunes` | same |
| T-6 | `:79-84` | `replaceType` → `Retype(id, finalType, finalData)`. | CORPUS (`EditAndRetypeInOneBatch…` 4 rows) | same |
| T-7 | `:85-89` | `setPageField` → `SetPageField(key, value)`. | PFIELDS | same |
| T-8 | `:93-109` | Stamps every id in changed.{created,updated,moved} (distinct) with `SetMetadata(at, by, with)`, but only when `lastEditedBy` is a string and `lastEditedAt` is a number. | NONE: SCEN `translate-stamps` | same |
| T-9 | `:43,121,165` | A non-object edit or field, or a block without an id, throws `InvalidDataException`. Unknown ops are ignored. | NONE: Go unit test | same |

### 2h. Version history via the agent (shares HistoryEndpoint's lanes)

| ID | C# location | What it does | Oracle | Go home |
|---|---|---|---|---|
| V1 | `BlokAgentExecutor.cs:823-864` | Reads room state. Purged → F23, unreadable → F10, stale expect → F11. Loads `versionHistory` only if the journal keeps it (`CollabRoomManager.cs:370`), then runs Jint. | NONE: SCEN `version-*` | `ba/versions.go` |
| V2 | `:937-971` | `history.versions`: `group` counts only if it is a JSON **int** 1/15/60. Each entry is `{version:"lin:seq", savedAt, startedAt (unix ms or null), actors[], beforeReset?:true}`. | NONE: SCEN `version-list` (C#: `ListsReadsAndComparesTheRoomVersions`) | `ia/versions.go` |
| V3 | `:973-1005` | `history.read` and `history.changes` load `documents{version→doc\|null}`. A version that will not parse, or a NotFound, gives null. | NONE: SCEN `version-read-unknown` (Jint answers INVALID_ARGS at `/commands/0/args/version`) | `ia/versions.go` |
| V4 | `:921-935` | `history.restore` loads the list AND the named document. | NONE: SCEN `version-restore` | `ia/versions.go` |
| V5 | `:857-861`, `:871-914` | When Jint names `restore`, `rooms.RestoreAsync(lineage, seq, newGuid, actorId, expect ?? currentHead)` runs. That is the same call `POST …/restore` makes (`HistoryEndpoint.cs:249+`). | NONE: SCEN `version-restore-*` | `ba/versions.go` |
| V6 | `:1065-1074` | `HttpStatus`: NoHistory→501, NotFound→404, Purged→403, Unavailable→503, else 500. `RestoreRetryable` = status is 429, or ≥500 but not 500 or 501. So only Unavailable is retryable. It mirrors `HistoryEndpoint.cs:497-546` and `src/shared/agent/version-history.ts` ask(retry=false). | NONE: SCEN + port the 5-row theory | `ia/versions.go` |

### 2i. Shared lanes and HTTP touch-points (owned by collab/http-host; listed so nothing drops)

| ID | C# location | What it does | Oracle | Go home |
|---|---|---|---|---|
| L1 | `CollabRoomManager.cs:401-424` | `AgentEditAsync`: expect without a journal → PreconditionRequired. Otherwise it is the same `EditInRoomAsync` lane as `POST /sync/{doc}/edit` (`EditEndpoint.cs:124-131`). | MCP (lane exists). NONE for the agent: SCEN | collab area |
| L2 | `CollabRoomManager.cs:426-468` | Lane statuses Purged, Draining and Unavailable (commit cooldown) come before the plan runs. | NONE: SCEN `room-refused-*` | collab area |
| L3 | `EditEndpoint.cs:276-308` vs `BlokAgentExecutor.cs:1118-1130` | HTTP `If-Match` is strict (one strong tag, `IsLineage`, no leading zeros). The agent's `expectRevision` is lax (see trap T4). | protocol-v2/server-contract (HTTP side). NONE (agent side) | collab + `ba/room.go` |
| L4 | `HistoryEndpoint.cs:44-91` | The HTTP list shape (`lineages[]`, `versions[{lineage,sequence,…}]`) is NOT the agent's shape (V2). | server-contract (HTTP) | http-host |
| L5 | `mcp-agent-participant.test.ts:225-230` | `lastEditedBy` = the person and `lastEditedWith` = the agent. `/history` lists the agent actor. | MCP | collab/sync area |

## 3. C# tests that need Go equivalents

Case counts are Facts + InlineData rows + MemberData rows. MemberData sizes:
- corpus 52 (computed above);
- normalizer 9 (`python3 … len(cases)` printed 9);
- LockedDelete `Removals` 3 (`BlokAgentLockedDeleteTests.cs:31-36`);
- PageCreate `Failures` 2 (`BlokAgentPageCreateTests.cs:213`), used by 2 theories;
- `AgentRoomOpsTests.MoveCases` 4 (agent-moves cases).

| File | Cases | Notes |
|---|---|---|
| `Blok.Server.Tests/Agent/JintAgentParityTests.cs` | 52 | Stored runner over CORPUS. One session per case. |
| `Agent/RoomAgentParityTests.cs` | 52 | Room runner over CORPUS. Real converter, fake journal (lines 71-86). |
| `Agent/AgentParityNormalizerTests.cs` | 9 | Port `AgentParityNormalizer.cs` (354 lines) + `AgentParityCorpus.cs` (170 lines, the loader). |
| `Agent/BlokAgentExecutorTests.cs` | 33 | 8 facts + 25 inline. Fake-runtime wire tests (W1-W9). |
| `Agent/BlokAgentPageActionTests.cs` | 29 | 9 + 20. |
| `Agent/BlokAgentPageCreateTests.cs` | 20 | 14 + 2×2 member + 2 inline. |
| `Agent/BlokAgentRoomHistoryTests.cs` | 17 | 14 + 3. |
| `Agent/BlokAgentRoomTests.cs` | 17 | 13 + 4. |
| `Agent/BlokAgentVersionHistoryTests.cs` | 17 | 12 + 5. |
| `Agent/BlokAgentSessionTests.cs` | 8 | |
| `Agent/JintDatabaseUnlockTests.cs` | 6 | 3 + 3. Bundle behaviour; a smoke test for the Go engine. |
| `Agent/BlokAgentLockedDeleteTests.cs` | 3 | Bundle behaviour. |
| `Agent/JintFormulaLimitsTests.cs` | 3 | **Engine-sensitive**: needs < 5 s wall clock (line 90). |
| `Agent/JintDatabaseLinkedRowsTests.cs` | 3 | Bundle. |
| `Agent/RoomEditTranslatorTests.cs` | 3 | |
| `Agent/AgentRoomMoveTests.cs` | 2 | Peer typing survives move/retype (Yjs-level). |
| `Agent/JintAttributionTests.cs` | 2 | Bundle. |
| `Agent/JintCommentHostTests.cs` | 2 | `BuiltInComments`. |
| `Agent/JintComputedReadTests.cs` | 2 | Bundle; large-read perf. |
| `Collab/AgentRoomOpsTests.cs` | 16 | 12 + 4 MOVES. The room ops Insert/Move/Lift/Retype/SetTunes/SetMetadata/SetPageField. Shared with the collab area. |
| `Blok.Server.AspNetCore.Tests/BlokAgentExecutorRegistrationTests.cs` | 7 | 5 + 2. DI → Go constructor tests. |
| **Total** | **303** | |

## 4. Orphan check: Blok.Server.Tests root and Runtime

Counts below are Facts + InlineData. Theories fed by MemberData were not expanded.

| File | Facts/Theories/InlineData | Proposed owner |
|---|---|---|
| `BlokTicketTests.cs` | 8/1/3 | tickets → likely http-host, confirm |
| `TicketVerifierTests.cs` | 9/1/8 | tickets → likely http-host, confirm |
| `GuardedOutboundFetcherTests.cs` | 37/5/13 | fetch guard → likely http-host, confirm |
| `GuardedOutboundPolicyTests.cs` | 2/7/38 | fetch guard → likely http-host, confirm |
| `OutboundClientArchitectureTests.cs` | 12/2/8 | fetch guard architecture law → likely http-host, confirm |
| `UnfurlMetadataParserTests.cs` | 13/5/14 | unfurl → likely http-host, confirm |
| `LocalBlobStoreTests.cs` | 9/2/13 | storage (not a named area) → likely http-host, confirm |
| `S3BlobStoreTests.cs` | 27/3/5 | storage (not a named area) → likely http-host, confirm |
| `CollabDurabilityArchitectureTests.cs` | 28/0/0 | collab (pins the journal's fsync/durability calls, lines 8-15) |
| `TestHostThreadPool.cs` + `TestHostThreadPoolTests.cs` | 1/0/0 | test-only xunit thread-pool tuning (`TestHostThreadPool.cs` comment). **No Go port.** |
| `Runtime/JintBlokRuntimeTests.cs` | 15/5/12 | documents-runtime. The agent area depends on it (engine pool, timeouts, memory budget, recursion survival). |
| `Agent/AgentParityCorpus.cs`, `Agent/AgentParityNormalizer.cs` | helpers | agent (this ledger) |

## 5. Traps (a direct port would get these wrong silently)

| # | Trap | Evidence |
|---|---|---|
| T1 | **The caps count escaped UTF-16 units, not bytes or runes.** `ToJsonString().Length` counts the output of System.Text.Json's default encoder, which escapes non-ASCII and `<>&'+`. A Go `len(json.Marshal(...))` gives a different number, so steps drop at different points. | Probe `/private/tmp/claude-501/-Users-jackuait-Packages-blok/1972ea3d-88af-4e14-951b-0edd9367e8e3/scratchpad/agent/probe.fsx`: `{"t":"🚀<a>&'+é"…}` printed `"🚀<a>&'+é"` `len=105`. Code: `BlokAgentSession.cs:63`, `RoomAgentHistory.cs:42`. |
| T2 | **The two trims differ.** The session trims past and then future, and keeps the newest step. The room trims **Done only**. After an `Other` step (Undone is not cleared), Done=1 and Undone=100 gives 101 > 100, so the step **just added is evicted**. Derived from code, not executed. | `BlokAgentSession.cs:65-71` vs `RoomAgentHistory.cs:135-144`. |
| T3 | **`group: 15.0` has no effect.** C# `TryGetValue<int>` refuses `15.0`, so C# loads the default grouping. JS treats 15.0 as 15 and believes it grouped. Go's float64 decoding would group by 15, which diverges from C#. Decide which side is correct. | Probe `probe2.fsx`: `15.0 -> false`. `BlokAgentExecutor.cs:939`; `src/shared/agent/version-history.ts:276`. |
| T4 | **The agent `expectRevision` is lax.** It splits at the LAST `:`, accepts leading zeros (`x:01` = `x:1`), and does not check `IsLineage`. HTTP If-Match refuses all three. | `BlokAgentExecutor.cs:1125-1129` vs `EditEndpoint.cs:286-303`. |
| T5 | **The runtime vocabulary has no slot for Go.** The bundle knows only `'jint'` and `'csharp-live'` (and the TS `node*`). The contract's undo availability depends on it. Corpus expectation keys are only `jint`/`room`. **Decision:** either Go sends `csharp-live`/omits it, or add `'go-live'` to the bundle and to `RunnerName`. | `src/view/server-runtime.ts:497-498`; `src/shared/tool-manifest.ts:341,377,392`; `test/unit/agent/parity/corpus.ts:7`. |
| T6 | **A data race on `recorded.Lineage`.** It is set after the step is already in the shared history and outside its lock. `go test -race` will flag a direct port. Set it before `Add`, or under the lock. Derived from code, not executed. | `BlokAgentExecutor.cs:542-544` (Add inside the applied callback) vs `:575-578` (Lineage assigned later). |
| T7 | **The digest's idempotency never fires.** Each call uses a new GUID operationId, so the SHA-256 digest is never compared against an existing id. Do not "fix" this by reusing ids: an agent retry would then answer from history. | `BlokAgentExecutor.cs:496-498`, `:758-759`. |
| T8 | **`Replayed` checks reference identity** (`ReferenceEquals`). A port that copies steps by value breaks the race guard for concurrent undo. | `RoomAgentHistory.cs:85`. |
| T9 | **The STALE retry is self-only.** Undo/redo retries ×3 only when the caller sent no expectRevision. | `BlokAgentExecutor.cs:654-658`. |
| T10 | **`RoomLinksNoneAsync` fails closed.** It uses `CancellationToken.None`, and a read error counts as "linked", so a host never deletes a page in use. A Go port that passes the request ctx would report pages orphaned after a cancel. | `BlokAgentExecutor.cs:609-630`. |
| T11 | **Projection equality is string equality.** System.Text.Json keeps insertion order and the original number text (`1.0` stays `1.0`, `1e3` stays `1e3`). Go `map[string]any` sorts keys and re-formats numbers. That is internally consistent but more permissive. Keep the key order (e.g. a `json.RawMessage`/ordered map) if `Same` must refuse the same cases. | Probe: `{"x":1.0,"y":1e3}` round-tripped unchanged. `RoomAgentHistory.cs:326-329`. |
| T12 | **`Stamps` parses `at` from the JSON text**, because the export may hold a long. Go must accept int and float. | `RoomAgentHistory.cs:394-396`. |
| T13 | **The history gate is narrow.** An undo with a `ref` key (3 keys) or extra args skips the gate and goes down the edit path. Its outcome code there is **UNVERIFIED**. | `BlokAgentExecutor.cs:633-640`; probe `count=3`. |
| T14 | **Only `commands[0]` is checked for a version command.** A version command at index > 0 takes the edit path without `versionHistory` loaded. The outcome is **UNVERIFIED**. | `BlokAgentExecutor.cs:809-815`. |
| T15 | **A page action's target runs with `options = null`.** No custom tools, overrides or comments flag are passed to the target batch. | `BlokAgentExecutor.cs:262`, `:270`. |
| T16 | **The default `BuiltInComments` is true.** Go's zero-value bool is false, so a naive struct silently turns comment commands off. | `IBlokAgentExecutor.cs:95`; `BlokAgentExecutor.cs:1196-1199`. |
| T17 | **Enum names leak into the wire.** `details.status` and messages print C# enum names (`Overloaded`, `SeedFailed`, `PreconditionFailed`, `ExportFailed`…). Go must print the same PascalCase strings. | `BlokAgentExecutor.cs:600-601`, `:797-798`, `:893`, `:911`. |
| T18 | **The idle prune is lazy.** It runs only on `Top`/`Add`, against an injectable clock. Go needs a clock seam for the test. | `RoomAgentHistory.cs:13,55-58,121-123`. |
| T19 | **Formula and regex limits are engine-sensitive.** `(a+)+$`, `a*a*a*$` and a 1e9 repeat must read "unavailable" in < 5 s. A different JS engine's regex backtracking (and the sticky-regex note in memory) may differ. **UNVERIFIED for any Go engine.** | `JintFormulaLimitsTests.cs` (AnEvilPattern…, Stopwatch < 5 s). |
| T20 | **`Forget` must hook all three DocumentReplaced sites.** Missing the restore site makes undo after an agent restore replay the pre-restore step. The C# test expects NOTHING_TO_UNDO. | `CollabRoomManager.cs:332,824,1080`; `BlokAgentVersionHistoryTests.AnUndoAfterTheAgentRestored…`. |
| T21 | **Failure JSON has a fixed key order** (`ok, error, warnings, revision`), and `revision` is absent (not `""`) when empty. Consumers comparing raw strings would see a difference. | `BlokAgentExecutor.cs:1141-1146`. |

## 6. Proposed shared oracle for the NONE rows

A language-neutral scenario fixture at `test/fixtures/agent-server-scenarios/<family>-<name>.json`. Both an xunit `[Theory]` and a Go table test read it in-process, against the real bundle and a real room with fake stores, as `RoomAgentParityTests` does today:

```json
{
  "name": "room-undo-peer-conflict",
  "seed": { "blocks": [ ... ] },
  "room": { "collab": true, "journal": true, "history": true },
  "options": { "pageTitles": false, "builtInComments": true,
               "pages": { "kind": "none|target|creator", "refuseCreate": false,
                          "throwAfter": null, "cancelAfter": null, "locations": { "pg": "stored|room|missing" } } },
  "steps": [
    { "do": "agent", "actor": { "id": "a", "name": "A", "onBehalfOf": "h1" }, "mode": "room|stored|session",
      "batch": { "commands": [ ... ] },
      "expect": { "ok": false, "code": "CONFLICT", "retryable": true,
                  "revision": "head|absent|hash", "detailsKeys": ["…"], "committedDelta": 0,
                  "orphanedPages": 0, "messageExact": "…optional…" } },
    { "do": "peer", "batch": { "commands": [ ... ] } },
    { "do": "reset" }, { "do": "restore", "version": "@first" }, { "do": "purge" },
    { "do": "clock", "advanceMs": 3600001 }
  ]
}
```

Families, so each NONE row has a home:
- `contract-*`
- `options-*`
- `page-action-*`
- `page-create-*`
- `session-*`
- `room-expect-*`
- `room-stale-*`
- `room-refused-*`
- `room-undo-*`
- `room-page-*`
- `room-revision-shape`
- `translate-*`
- `version-*`

Assert codes, `retryable`, revision shape and the committed-op delta. Do not assert whole result strings, because the bundle owns most result text. Exact messages are asserted only for the C#-written F-rows.

**Alternative (not recommended first):** a conformance-only route behind a flag such as `--conformance-agent` (precedent: `Blok.Server.Host/ConformanceArguments.cs:40` `--conformance-journal`, which accepts Go-style single-dash flags too). The TS suite could then drive both servers black-box. It would also need TS-side fake page hosts reachable from the server, and a route that never ships enabled.
