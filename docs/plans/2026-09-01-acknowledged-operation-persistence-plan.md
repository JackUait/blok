# Acknowledged Operation Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every accepted Yjs operation in an attributed, crash-durable journal and let the client remove pending work only after an exact server acknowledgement.

**Architecture:** `blok-sync.v2` carries stable operation IDs. The client queues before sending; the room appends before broadcasting or acknowledging; the operation journal is authoritative and whole-document JSON is only a projection. The same path is used with one user or many users.

**Tech Stack:** TypeScript, Yjs, lib0/IndexedDB, WebSocket/y-protocols, .NET 10.0, YDotNet, ASP.NET Core, Vitest, xUnit.

**Spec:** `docs/plans/2026-09-01-acknowledged-operation-persistence-design.md`

## Global Constraints

- Work directly on the existing `main` branch. Do not create a branch,
  worktree, detached checkout, or stash.
- Preserve unrelated working-tree changes. Stage only files owned by the current
  task.
- TDD is mandatory: add the named regression/contract test, run it and record
  the expected failure, then write the smallest implementation, then rerun it.
- Run only newly added or directly affected tests while developing. Run the full
  suites only at the final gate.
- Run ESLint only on changed files. Never run project-wide ESLint.
- Do not modify any `package.json`, TypeScript/Vite/Vitest/Playwright/ESLint
  config, or `.env` file.
- Do not advertise or negotiate v2 until the YDotNet safety gate passes.
- Types 0–3 and 100/101 remain byte-for-byte unchanged. Never add a field to a
  strict type-100 or type-101 payload.
- `connected` is content synchronization, not durable save confirmation.
- The operation journal, not the JSON document endpoint, is the acknowledgement
  boundary.
- Every wave must leave main green, be committed by staging only its owned paths,
  rebased onto origin (`git pull --rebase`; never a merge, never a stash), and
  pushed before the next wave.

---

## Risk Order

1. **Native process safety:** a hostile but authenticated raw Yjs update can
   currently abort YDotNet on a NUL string. This is a stop gate.
2. **Checkpoint completeness:** YDotNet does not expose pending updates; skipping
   journal records after an incomplete full-state checkpoint can lose data.
3. **Commit ordering:** today's room broadcasts before persistence. The new path
   must never expose an unjournalled update.
4. **v2 bootstrap:** today's symmetric SyncStep2 reply can upload offline edits
   outside their operation envelopes.
5. **Multi-tab replay:** any tab may resend another tab's outbox record; exact
   IDs and broadcast-to-sender are load-bearing.
6. **Storage identity:** an offline outbox without a principal scope can replay
   one person's edits under another person's ticket.
7. **Mixed versions:** v1 must remain interoperable without ever being described
   as acknowledged durability.
8. **Scale-out:** the current S3 store has no CAS or fence and cannot support v2.

## Locked Decisions

1. One Yjs update is one v2 operation in the first release. There is no batching
   layer or second commit queue.
2. `operationId` is random 128-bit lowercase hex. The server journal is the exact
   dedupe ledger; no browser sequence/high-water protocol is added.
3. `serverSequence` is a per-document-lineage `uint64`, encoded to JS as a
   decimal string.
4. `collaboration.offline` remains the disk-consent switch. `offlineScope` is
   required with it and partitions data by the host's signed-in identity.
5. Offline mode uses IndexedDB; non-offline mode uses the same outbox contract in
   memory.
6. ACK follows operation-store commit. It does not wait for peer delivery or JSON
   projection.
7. A commit failure after provisional YDoc apply closes and discards the room.
   The client retries against a fresh room.
8. On a room backed by an operation store, every v1 write is also journalled
   before broadcast with a server-generated ID, but v1 clients receive no save
   receipt. A working-set-only room (S3) keeps today's apply/broadcast/schedule
   path and never selects v2.
9. JSON PUT is scheduled only from a published checkpoint and on eviction/drain,
   not after every edit window.
10. The first durable stores are built-in local WAL and a public custom .NET
    store seam. Existing S3 remains v1-only.
11. A language-neutral backend implements the published WebSocket v2 contract.
    No duplicate raw-operation HTTP endpoint is added.
12. Operation payloads and attribution are not destructively pruned in this
    plan. History UI, diffs, restore, and retention controls are later work.

---

## File Impact Map

### New client files

- `src/components/modules/collaboration/operation-store.ts`
- `test/unit/components/modules/collaboration/operation-store.test.ts`

### Changed client files

- `src/components/modules/collaboration/index.ts`
- `src/components/modules/collaboration/provider.ts`
- `src/components/modules/collaboration/types.ts`
- `src/components/modules/collaboration/sync-wire.ts`
- `src/components/modules/collaboration/offline-cache.ts` (remove after the new
  store has parity; leave its old database untouched)
- `src/components/core.ts` (the `collaboration` config validation lives here)
- `types/configs/blok-config.d.ts`
- `types/events/editor-events.ts`
- `test/unit/components/core.test.ts`
- `test/unit/components/modules/collaboration/provider.test.ts`
- `test/unit/components/modules/collaboration/sync-wire.test.ts`
- `test/unit/components/modules/collaboration/sync-first-load.test.ts`
- `test/unit/components/modules/collaboration/offline-cache.test.ts` (move the
  surviving behaviors into `operation-store.test.ts`, then remove)
- `test/unit/components/events/CollaborationStatusChanged.test.ts`

### New server files

- `packages/server/dotnet/Blok.Server/Collab/CollabOperation.cs`
- `packages/server/dotnet/Blok.Server/Collab/ICollabOperationStore.cs`
- `packages/server/dotnet/Blok.Server/Collab/CollabJournalCodec.cs`
- `packages/server/dotnet/Blok.Server/Collab/LocalCollabOperationStore.cs`
- `packages/server/dotnet/Blok.Server.Tests/Collab/CollabJournalCodecTests.cs`
- `packages/server/dotnet/Blok.Server.Tests/Collab/LocalCollabOperationStoreTests.cs`
- `packages/server/protocol/blok-sync-v2.md`
- `test/unit/server-conformance/protocol-v2-contract.test.ts`

### Changed server files

- `packages/server/dotnet/Blok.Server/Blok.Server.csproj` (YDotNet only, if the
  safety-gate version passes)
- `packages/server/dotnet/Blok.Server/Collab/CollabRoom.cs`
- `packages/server/dotnet/Blok.Server/Collab/CollabRoomManager.cs`
- `packages/server/dotnet/Blok.Server/Collab/CollabRoomOptions.cs`
- `packages/server/dotnet/Blok.Server/Collab/CollabEditOps.cs`
- `packages/server/dotnet/Blok.Server/Collab/CollabWorkingSetCodec.cs`
- `packages/server/dotnet/Blok.Server/Collab/CollabWorkingSetTag.cs`
- `packages/server/dotnet/Blok.Server/Collab/DocEndpointClient.cs`
- `packages/server/dotnet/Blok.Server/Collab/ICollabDocConverter.cs`
- `packages/server/dotnet/Blok.Server/Collab/ICollabMember.cs`
- `packages/server/dotnet/Blok.Server/Collab/LocalCollabStore.cs`
- `packages/server/dotnet/Blok.Server/Collab/SyncWire.cs`
- `packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs`
- `packages/server/dotnet/Blok.Server.AspNetCore/BlokServerBuilderExtensions.cs`
- `packages/server/dotnet/Blok.Server.AspNetCore/BlokServerServiceCollectionExtensions.cs`
- `packages/server/dotnet/Blok.Server.AspNetCore/Collab/EditEndpoint.cs`
- `packages/server/dotnet/Blok.Server.AspNetCore/Collab/ResetEndpoint.cs`
- `packages/server/dotnet/Blok.Server.AspNetCore/Collab/SyncClose.cs`
- `packages/server/dotnet/Blok.Server.AspNetCore/Collab/SyncEndpoint.cs`
- `packages/server/dotnet/Blok.Server.AspNetCore/Collab/SyncHandshake.cs`
- `packages/server/dotnet/Blok.Server.AspNetCore/Collab/SyncSocketMember.cs`
- the matching files under `Blok.Server.Tests`,
  `Blok.Server.AspNetCore.Tests`, and `Blok.Server.Host.Tests` named in the tasks
  below
- `scripts/generate-sync-frames.mjs`
- `scripts/test-server-conformance.mjs`
- `test/unit/server-conformance/server-process.ts`
- `test/unit/server-conformance/fixtures/sync-frames.json`
- `test/unit/server-conformance/blok-client-contract.test.ts`
- `test/unit/server-conformance/sync-contract.test.ts`
- `packages/server/dotnet/Blok.Server.AspNetCore.Tests/Collab/SyncTestSupport.cs`

### Changed documentation

- `packages/server/README.md`
- `docs/src/components/server/server-data.ts`
- `docs/src/components/server/server-data.test.ts`
- `docs/src/i18n/en.json`
- `docs/src/i18n/ru.json`

---

## Wave 0 — Dependency and Baseline Gates

### Task 0.1: Prove YDotNet can reject NUL without killing the host

**Files:**

- Modify: `packages/server/dotnet/Blok.Server.Tests/Collab/YDotNetRuntimeProbeTests.cs`
- Modify: `packages/server/dotnet/Blok.Server.Tests/Collab/YDocConverterHardeningTests.cs`
- Modify only after a candidate passes: `packages/server/dotnet/Blok.Server/Blok.Server.csproj`

- [ ] Add a child-process test named
  `RawUpdateWithNulReturnsARejectionAndTheProcessStaysAlive`. The child applies a
  crafted raw update, tries the same read/export path that currently aborts,
  emits a managed result, and then successfully performs a second harmless Yjs
  operation.
- [ ] Run only that test against YDotNet 0.6.0 and record the red result: the
  child exits/aborts instead of reporting a managed rejection.

```bash
dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj \
  --filter 'FullyQualifiedName~RawUpdateWithNulReturnsARejectionAndTheProcessStaysAlive'
```

- [ ] Test the latest released YDotNet/YDotNet.Native pair in the existing
  runtime probe. Accept it only if the test turns green on every native RID the
  repository ships.
- [ ] If no released pair passes, stop this implementation. Keep v2 absent from
  the handshake and record the upstream blocker; do not substitute a client-only
  check, subprocess-per-update path, or unreviewed native fork.
- [ ] If a released pair passes, update the two package references together and
  rerun all YDotNet runtime/hardening tests.

```bash
dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj \
  --filter 'FullyQualifiedName~YDotNetRuntimeProbeTests|FullyQualifiedName~YDocConverterHardeningTests'
```

### Task 0.2: Prove checkpoints can observe pending updates

**Files:**

- Modify: `packages/server/dotnet/Blok.Server.Tests/Collab/YDotNetRuntimeProbeTests.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/ICollabDocConverter.cs`

- [ ] Add `PendingUpdateIsVisibleUntilItsDependencyArrives`: apply a dependency-
  missing update, assert the converter reports pending state, apply its
  dependency, and assert pending becomes empty.
- [ ] Run it against the selected binding and record the initial failure caused
  by the missing managed API.
- [ ] Add the smallest converter method that exposes only the boolean/count the
  checkpoint gate needs. Do not expose the raw YDoc or add a general YDotNet
  abstraction.
- [ ] Add `CheckpointCursorDoesNotAdvanceWhilePendingExists` to
  `CollabRoomTests.cs` before any checkpoint implementation, and update the doc
  comment of the existing `CompactionDropsAnUpdateThatIsStillPending` (same
  file), which already pins this data-loss shape; do not add a test that
  contradicts it.
- [ ] Run the two focused tests until green.

```bash
dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj \
  --filter 'FullyQualifiedName~PendingUpdateIsVisibleUntilItsDependencyArrives|FullyQualifiedName~CheckpointCursorDoesNotAdvanceWhilePendingExists'
```

- [ ] If the selected released binding cannot expose pending state, record
  `checkpoint advancement disabled`: the first release then ships without
  checkpoints at all — no `WriteCheckpointAsync` on the public interface, no
  `checkpoint`/`checkpointThrough` in the head, unbounded journal replay, and
  Task 5.1 is skipped. A public method that can never legally be called is
  worse than an absent one; it is added later as a default interface member.
  This does not relax Task 0.1; NUL safety remains a hard stop.

### Task 0.3: Repair the existing binary-seam baseline

**Files:**

- Modify: `test/unit/components/modules/collaboration/sync-first-load.test.ts`
- Modify: `test/unit/components/modules/collaboration/provider.test.ts`
- Modify: `test/unit/server-conformance/blok-client-contract.test.ts`
- Modify: `src/components/modules/collaboration/index.ts`

- [ ] Add a test that builds the real collaboration seam and subscribes through
  `onAnyDocUpdate`.
- [ ] Run it and the type checker. Record that `Collaboration.seam()` and the
  seam fixtures in `provider.test.ts` and `blok-client-contract.test.ts` omit
  the method required by `CollabDocSeam`.

```bash
yarn test test/unit/components/modules/collaboration/sync-first-load.test.ts
yarn lint:types
```

- [ ] Add the pass-through in `Collaboration.seam()` and both seam fixtures. Do
  not alter update filtering.
- [ ] Record the remaining baseline: `offline-cache.ts` lines 303, 309, 361,
  389, 412 and 434 fail TS2353/TS2345 against lib0's narrow `idb` JSDoc types
  on main today. They are retired when Task 4.1 replaces the file, not fixed in
  place. `tsc` needs `NODE_OPTIONS=--max-old-space-size=8192` on this machine.
- [ ] Rerun those two commands.

### Wave 0 gate

- [ ] Confirm NUL safety is green, or stop the whole plan with v2 unadvertised.
- [ ] Confirm the pending-state result is recorded as either `supported` or
  `checkpoint advancement disabled`.
- [ ] Run the full .NET collaboration core tests and the two affected client
  tests.
- [ ] Commit and push Wave 0 only.

---

## Wave 1 — Normative v2 Wire Contract

### Task 1.1: Write shared v2 fixtures first

**Files:**

- Create: `packages/server/protocol/blok-sync-v2.md` (repository-only; the
  server package's `files` list is not touched)
- Modify: `scripts/generate-sync-frames.mjs`
- Modify: `test/unit/server-conformance/fixtures/sync-frames.json`

`sync-frames.json` is consumed by `sync-wire.test.ts` and
`SyncWireFramingTests.cs` only; `collab-fixtures.freshness.test.ts` reads the
`fixtures/collab` case directories and has nothing to do with frames.

- [ ] Write the normative layouts for frames 102–104: 102 is two
  length-prefixed sections (var-string metadata, then the update as a
  var-uint-length-prefixed byte string — a shape 100/101 do not have); keys are
  emitted in exactly the order `{lineage, operationId}`,
  `{lineage, operationId, serverSequence}`, `{lineage, operationId, code}` and
  the fixtures pin those bytes; IDs are 32 lowercase hex; `serverSequence`
  matches `^(0|[1-9][0-9]*)$` and never exceeds `18446744073709551615`; full
  input consumption; rejection codes; the envelope-only write rule with the
  post-drain residual diff; the narrow ACK meaning.
- [ ] Add generated positive fixtures for one operation, one acknowledgement,
  and every rejection code, produced by the real encoders as the generator's
  header demands.
- [ ] Add a hand-assembled `negative` section to the generator and amend its
  "never assembled by hand" header to say so; extend the typed
  `SyncFramesFixture` shape `SyncWireFramingTests.cs` deserialises. Cases:
  uppercase/short IDs, non-matching or over-range server sequences,
  missing/extra keys, duplicate keys, `\uXXXX`-escaped duplicate keys, any
  backslash in metadata, invalid UTF-8, empty/truncated updates, trailing
  bytes, and unknown outer types.
- [ ] Regenerate and run both fixture consumers.

```bash
node scripts/generate-sync-frames.mjs
yarn test test/unit/components/modules/collaboration/sync-wire.test.ts
```

### Task 1.2: Add strict TypeScript codecs

**Files:**

- Modify: `test/unit/components/modules/collaboration/sync-wire.test.ts`
- Modify: `src/components/modules/collaboration/sync-wire.ts`
- Modify: `src/components/modules/collaboration/types.ts`

- [ ] Add failing tests:
  - `round-trips an operation byte-identically`;
  - `round-trips an exact acknowledgement with a decimal server sequence`;
  - `round-trips every stable rejection code`;
  - `rejects every malformed v2 fixture`;
  - `keeps every v1 fixture byte-identical`;
  - `ignores an unknown outer type`.
- [ ] Add discriminated v2 frame types and strict encoders/decoders. Do not touch
  the existing control/limits key sets.
- [ ] Run only the codec and fixture tests.

```bash
yarn test test/unit/components/modules/collaboration/sync-wire.test.ts
```

### Task 1.3: Add matching C# codecs

**Files:**

- Modify: `packages/server/dotnet/Blok.Server.Tests/Collab/SyncWireTests.cs`
- Modify: `packages/server/dotnet/Blok.Server.Tests/Collab/SyncWireFramingTests.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/SyncWire.cs`

- [ ] Add fixture-driven tests with the same positive and negative cases.
- [ ] Run them red before adding the new records and parser branches.
- [ ] Implement strict decode/encode with full input consumption and bounded
  allocation. Keep types 0–3/100/101 unchanged.
- [ ] Rerun both test classes.

```bash
dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj \
  --filter 'FullyQualifiedName~SyncWireTests|FullyQualifiedName~SyncWireFramingTests'
```

### Task 1.4: Negotiate v2 without breaking tickets

**Files:**

- Modify: `packages/server/dotnet/Blok.Server.AspNetCore.Tests/Collab/SyncHandshakeTests.cs`
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore/Collab/SyncHandshake.cs`
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore/Collab/SyncEndpoint.cs`
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore/BlokServerServiceCollectionExtensions.cs`
  (`SyncHandshake` is constructed with options, limiter and clock only; it
  learns whether an operation store exists through an optional constructor
  dependency registered here)
- Modify: `src/components/modules/collaboration/types.ts`
- Modify: `src/components/modules/collaboration/provider.ts`
- Modify: `test/unit/components/modules/collaboration/provider.test.ts`
- Modify: `test/unit/components/modules/collaboration/sync-first-load.test.ts`

- [ ] Add the complete handshake matrix: v1 only, v2+v1, v2+v1+ticket,
  v1+ticket, invalid ticket between protocol offers, and old-server v1
  selection.
- [ ] Assert the ticket search excludes both known protocol tokens.
- [ ] Add the selected `protocol` value to `WebSocketLike` and to every socket
  fixture (`provider.test.ts`, the `MockSocket` in `sync-first-load.test.ts`).
  Make the offer list one constant that still reads `[v1, ticket]` in this
  wave; Task 4.5 flips it to `[v2, v1, ticket]` once the client can drain v2.
  A client that offers v2 earlier is selected into a protocol it cannot honour.
- [ ] Assert the client still offers `[v1, ticket]` unchanged.
- [ ] Make v2 selectable only when an `ICollabOperationStore` is registered
  AND a server-side advertise constant is on; the constant stays off until
  Task 3.3 flips it, so a main that has Wave 2's local store but not Wave 3's
  commit path never selects a protocol it cannot serve. S3-only registration
  selects v1; the local directory store becomes an operation store through
  Task 2.4's migration.
- [ ] Run focused handshake/provider tests.

```bash
dotnet test packages/server/dotnet/Blok.Server.AspNetCore.Tests/Blok.Server.AspNetCore.Tests.csproj \
  --filter 'FullyQualifiedName~SyncHandshakeTests'
yarn test test/unit/components/modules/collaboration/provider.test.ts
```

### Wave 1 gate

- [ ] Generate fixtures once more and prove JS and C# consume the same bytes.
- [ ] Run all sync-wire/handshake tests.
- [ ] Commit and push the server-capable but not-yet-advertised wire layer.

---

## Wave 2 — Public Operation-Store Contract and Local WAL

### Task 2.1: Define the smallest public storage seam

**Files:**

- Create: `packages/server/dotnet/Blok.Server/Collab/CollabOperation.cs`
- Create: `packages/server/dotnet/Blok.Server/Collab/ICollabOperationStore.cs`
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore.Tests/BlokServerRegistrationTests.cs`
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore/BlokServerBuilderExtensions.cs`
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore/BlokServerServiceCollectionExtensions.cs`

The public shape must carry these semantics without exposing YDotNet:

```csharp
public interface ICollabOperationStore
{
  ValueTask<ICollabOperationSession> OpenAsync(
      string documentId,
      CancellationToken cancellationToken = default);
}

public interface ICollabOperationSession : IAsyncDisposable
{
  CollabOperationOpenResult OpenResult { get; }

  ValueTask<CollabOperationAppendResult> AppendAsync(
      CollabOperationCandidate candidate,
      CancellationToken cancellationToken = default);

  ValueTask WriteCheckpointAsync(
      CollabOperationCheckpoint checkpoint,
      CancellationToken cancellationToken = default);

  ValueTask<CollabOperationResetResult> ResetAsync(
      CollabOperationReset reset,
      CancellationToken cancellationToken = default);
}
```

`OpenResult` contains a public `CollabDocumentHead` (format, epoch, lineage,
durable-through; `CollabWorkingSetTag` is `internal` and cannot appear here),
the exact baseline frames, the checkpoint cursor when checkpoints exist, and the
ordered journal tail. `AppendAsync` atomically assigns the sequence and returns
`Committed`, `Duplicate`, or `Conflict`; an implementation may group-commit
concurrent appends as long as completion still means durable. `OpenAsync` on a
document another live process holds returns a `DocumentOpenElsewhere` outcome.
`WriteCheckpointAsync` exists only if Task 0.2 recorded `supported`. The open
session is the fence; every method must reject a stale session.

- [ ] Add compile-time/DI tests proving a consumer implementation can be
  registered with `UseCollabOperationStore<T>()` (interface-named, like
  `UseAuthorization<T>` for `IBlokAuthorization`) and replaces only the
  operation store, and that registering one stops the local
  `ICollabWorkingSetStore` registration for the same directory.
- [ ] Add a fake in-memory store in `CollabRoomTestSupport.cs` that can pause,
  fail, return an unknown outcome, deduplicate, and expose committed records.
- [ ] Run the registration tests red, add only the interface/records/extension,
  and make them green.

```bash
dotnet test packages/server/dotnet/Blok.Server.AspNetCore.Tests/Blok.Server.AspNetCore.Tests.csproj \
  --filter 'FullyQualifiedName~BlokServerRegistrationTests'
```

### Task 2.2: Specify and implement the journal codec

**Files:**

- Create: `packages/server/dotnet/Blok.Server.Tests/Collab/CollabJournalCodecTests.cs`
- Create: `packages/server/dotnet/Blok.Server/Collab/CollabJournalCodec.cs`

- [ ] Add failing tests:
  - `RoundTripsEveryRecordField`;
  - `RejectsOversizedLengthsBeforeAllocating`;
  - `RejectsInvalidIdsAndSequences`;
  - `DetectsPayloadDigestMismatch`;
  - `HttpEditDigestCoversTheCanonicalBodyNotTheUpdate`;
  - `RecognizesOnlyAnIncompleteFinalRecordAsTorn`;
  - `FailsClosedOnMiddleCorruption`;
  - `PreservesUnknownActorAsNull`.
- [ ] Implement bounded length-prefixed records, explicit codec version, SHA-256
  digest, and a completion/checksum field. Do not serialize YDotNet objects.
- [ ] Run only the new codec tests.

```bash
dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj \
  --filter 'FullyQualifiedName~CollabJournalCodecTests'
```

### Task 2.3: Implement crash-safe local append and fencing

**Files:**

- Create: `packages/server/dotnet/Blok.Server.Tests/Collab/LocalCollabOperationStoreTests.cs`
- Create: `packages/server/dotnet/Blok.Server/Collab/LocalCollabOperationStore.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/LocalCollabStore.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/CollabWorkingSetCodec.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/CollabWorkingSetTag.cs`

- [ ] Add failing tests:
  - `AppendReopensAtTheAcknowledgedSequence`;
  - `DuplicateSameDigestReturnsTheOriginalCommit`;
  - `DuplicateDifferentDigestConflicts`;
  - `AppendAndDedupeIndexShareOneDurabilityBoundary`;
  - `RecoveryTruncatesOnlyATornTail`;
  - `MiddleCorruptionFailsClosed`;
  - `SecondOpenFencesTheFirstSession`;
  - `StaleSessionCannotAppendCheckpointOrReset`;
  - `AStaleSessionCannotAppendEvenWithItsFileHandleStillOpen`;
  - `OpenWhileAnotherLiveProcessHoldsTheDocumentReportsOpenElsewhere`;
  - `ResetSealsTheOldLineage`;
  - `CheckpointPublicationPreservesJournalHistory`.
- [ ] Lay the store out as a per-document subdirectory
  (`<CollabDocKey>/journal`, `manifest`, `lock`); today's BKW2 file sits at
  `<CollabDocKey>` itself, so the two can coexist until Task 2.4 publishes.
- [ ] Persist a monotonic fence token in the manifest and re-verify it on every
  append, checkpoint and reset; the exclusive lock file is an optimisation on
  top, because a file lock is advisory and a holder with a stale descriptor can
  still write. Append + `Flush(flushToDisk: true)`, checked manifest
  publication (including on Windows, where today's directory sync returns
  early), and fail-closed recovery. Do not swallow directory-sync failures at
  the ACK boundary. One process per collaboration directory is a hard
  constraint the docs state.
- [ ] Run only the new local-store tests.

```bash
dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj \
  --filter 'FullyQualifiedName~LocalCollabOperationStoreTests'
```

### Task 2.4: Import BKW2 as the sequence-zero baseline

**Files:**

- Modify: `packages/server/dotnet/Blok.Server.Tests/Collab/LocalCollabOperationStoreTests.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/LocalCollabOperationStore.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/CollabWorkingSetCodec.cs`

- [ ] Add failing tests:
  - `ImportsBkw2WithoutChangingFormatEpochLineageOrFrameOrder`;
  - `DoesNotInventHistoryActorsForBkw2Frames`;
  - `MigrationCrashBeforePublishRetriesIdempotently`;
  - `MigrationCrashAfterPublishOpensBkw3`;
  - `CorruptBkw2FailsClosedInsteadOfReseeding`.
- [ ] Preserve the exact legacy frame section as baseline data. Do not reduce it
  to a full-state update while pending-update safety is uncertain.
- [ ] Publish BKW3 atomically before serving, and leave the old BKW2 source until
  publication is complete.
- [ ] Run the focused migration tests.

### Wave 2 gate

- [ ] Run all codec/local-store/registration tests.
- [ ] Confirm current S3 registration does not expose v2 capability.
- [ ] Commit and push the public seam plus local reference store.

---

## Wave 3 — Journal-Before-Observation Server Path

### Task 3.1: Carry authenticated actor and protocol mode into the room

**Files:**

- Modify: `packages/server/dotnet/Blok.Server/Collab/ICollabMember.cs`
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore/Collab/SyncHandshake.cs`
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore/Collab/SyncEndpoint.cs`
  (constructs `SyncSocketMember`)
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore/Collab/SyncSocketMember.cs`
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore.Tests/Collab/SyncHandshakeTests.cs`
- Modify: `packages/server/dotnet/Blok.Server.Tests/Collab/CollabRoomTests.cs`

- [ ] Add tests `TicketUserBecomesJournalActor`,
  `ApplicationNameIdentifierBecomesJournalActor`,
  `TicketWithoutAUserClaimHasNullJournalActor`,
  `NoAuthConnectionHasNullJournalActor`, and
  `TheRateLimitKeyIsNeverTheJournalActor`.
- [ ] Add immutable `ActorId` and negotiated protocol fields to the member.
  Derive the actor from the ticket's `User` claim when non-empty, else the
  principal's `NameIdentifier`/name, else null. Never from
  `SyncAccepted.Principal`: that is the rate-limit key and starts as
  `addr:<ip>`, which would put IP addresses into un-prunable history. Never
  from frames, awareness, or collaboration config.
- [ ] Run the focused tests.

### Task 3.2: Replace apply/broadcast/schedule with provisional apply/commit/broadcast

**Files:**

- Modify: `packages/server/dotnet/Blok.Server.Tests/Collab/CollabRoomTests.cs`
- Modify: `packages/server/dotnet/Blok.Server.Tests/Collab/CollabRoomTestSupport.cs`
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore.Tests/Collab/SyncTestSupport.cs`
  (builds `CollabRoomManager` directly with its own fake working-set store)
- Modify: `packages/server/dotnet/Blok.Server/Collab/CollabRoom.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/CollabRoomManager.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/ICollabMember.cs`
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore/Collab/SyncClose.cs`

- [ ] Add failing tests:
  - `DoesNotAckOrBroadcastBeforeAppendCompletes`;
  - `AcknowledgesAndBroadcastsToEveryV2MemberIncludingTheSubmitterAfterCommit`;
  - `AppendFailureClosesEveryMemberWithCommitUnavailable`;
  - `AppendFailureClosesAndDiscardsTheRoomWithoutObservation`;
  - `UnknownCommitOutcomeClosesAndRetryResolvesById`;
  - `RepeatedAppendFailureDoesNotReloadTheDocumentPerRetry`;
  - `AnAppendPastTheStoreTimeoutIsCommitUnavailable`;
  - `OpenElsewhereRefusesTheJoinAsUnavailable`;
  - `LostAckRetryReturnsTheSameCommitWithoutRebroadcast`;
  - `SameIdDifferentBytesRejectsWithoutApply`;
  - `CommittedOperationsBroadcastInServerSequenceOrder`;
  - `ReloadReplaysEveryAcknowledgedOperationAfterTheCheckpoint`;
  - `UnjournalledProvisionalStateNeverExportsOrCheckpoints`.
- [ ] Retarget `ASlowStoreDoesNotStallTheLane` and
  `AStoreTimeoutDuringAnApplyIsLoggedRetriedAndStillExports` at a
  working-set-only room instead of deleting them; that path stays alive for
  S3. On an operation-store room a slow commit backpressures that document.
- [ ] Add `CollabCloseReason.CommitUnavailable` and a matching `SyncClose`
  frame on the existing 4503 status with its own reason text
  (`commit unavailable, retry`). `CloseLocked(null)` only forgets members
  without closing a socket, and reusing `Reset` maps to 4409, which the client
  treats as a relineage and would quarantine retryable rows.
- [ ] Give `CollabRoomManager` a per-document commit-failure cooldown
  (`RetryBackoff`/`RetryBackoffCap`) so a persistently failing append does not
  reload baseline + tail on every join.
- [ ] Bound the in-lane append: a v1 or stock member is limited by the inbound
  token bucket (`CollabInboundFramesPerSecond`), so a document pays at most
  that many appends per second per connection; an append past the store
  timeout is a commit-unavailable outcome. A v2 member is self-limiting (one
  operation in flight). Record measured append latency in Task 5.2.
- [ ] Broadcast to the submitter only on the v2 commit path (`except: null`);
  v1 keeps `except: membership`, because v1 bytes must not change.
- [ ] Keep today's apply/broadcast/schedule path for a room whose store is
  working-set-only (S3); the commit primitive runs only while an operation-store
  session is open. Add `WorkingSetOnlyRoomKeepsTheLegacyRelayPath`.
- [ ] Refactor the YDoc local-update observer so it captures the resulting update
  but does not broadcast implicitly.
- [ ] Lookup duplicate before provisional apply. Apply new bytes, await append
  inside the room lane, then broadcast to all members and ACK the submitting
  member.
- [ ] On append exception/timeout/unknown result, prevent all export/checkpoint
  paths, close members, dispose the room, and let the manager create a fresh one.
- [ ] Run only the room tests until green.

```bash
dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj \
  --filter 'FullyQualifiedName~CollabRoomTests'
```

### Task 3.3: Make v2 writes envelope-only

**Files:**

- Modify: `packages/server/dotnet/Blok.Server.AspNetCore.Tests/Collab/SyncEndpointTests.cs`
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore/Collab/SyncEndpoint.cs`
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore/Collab/SyncClose.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/CollabRoom.cs`

- [ ] Add tests that a v2 join receives exactly the v1 handshake bytes: control,
  limits, the server's SyncStep1, and SyncStep2 answers. The handshake does not
  change; only what the client may send back does.
- [ ] Add tests that the v2 server answers every inbound SyncStep1 (initial or
  resync) with SyncStep2 followed by its own SyncStep1, so a client that has
  just drained its outbox can learn the fresh server state vector.
- [ ] Add tests that v2 accepts operation frames and awareness but drops an
  inbound SyncStep2/SyncUpdate and closes with a new `SyncClose` policy
  violation frame (`raw write on a v2 session`).
- [ ] Assert operation frames are rejected as `not-synced` until the initial
  server SyncStep2 is queued.
- [ ] Flip the server-side v2 advertise constant from Task 1.4 here, once the
  commit path (Task 3.2) and this task are green.
- [ ] Run endpoint and room sync tests.

```bash
dotnet test packages/server/dotnet/Blok.Server.AspNetCore.Tests/Blok.Server.AspNetCore.Tests.csproj \
  --filter 'FullyQualifiedName~SyncEndpointTests'
```

### Task 3.4: Journal v1 writes without claiming a v1 receipt

**Files:**

- Modify: `packages/server/dotnet/Blok.Server.Tests/Collab/CollabRoomTests.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/CollabRoom.cs`

- [ ] Add `V1UpdateIsJournalledBeforeBroadcastWithAServerGeneratedId`,
  `V1DuplicateStateConvergesButHasNoClientReceipt` and
  `AnEmptyV1UpdateIsNotJournalled` (a stock client answering SyncStep1 while
  already in sync sends the two-byte empty update; skip the commit when the
  state vector does not move).
- [ ] Route v1 SyncStep2/SyncUpdate through the same commit primitive with source
  `client-v1` and a server-generated ID. This applies to stock y-websocket
  members too: they negotiate no subprotocol and take the v1 write path.
- [ ] Do not send frame 103 to a v1 member.
- [ ] Run the two focused tests and the existing stock-provider contract.

### Task 3.5: Route HTTP edits and reset through the store

**Files:**

- Modify: `packages/server/dotnet/Blok.Server.AspNetCore.Tests/Collab/EditEndpointTests.cs`
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore.Tests/Collab/ResetEndpointTests.cs`
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore/Collab/EditEndpoint.cs`
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore/Collab/ResetEndpoint.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/CollabEditOps.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/CollabRoom.cs`
- Modify: `packages/server/README.md` and
  `docs/src/components/server/server-data.ts` (+ its test): the edit call is
  documented as one step with no key today; the header lands in the same
  commit as the requirement

The edit endpoint is not in any release, so requiring the key is not a
contract break.

- [ ] Add tests:
  - `EditRequiresAnIdempotencyKey` (`Blok-Idempotency-Key` header, 1–128
    printable ASCII characters; missing or malformed → 400);
  - `EditReturnsOnlyAfterDurableCommit`;
  - `EditRetryWithSameKeyAppliesOnce`;
  - `SameEditKeyWithDifferentBodyReturns409`;
  - `EditJournalActorComesFromThePrincipal`;
  - `ResetCommitsANewLineageBeforeReturning`;
  - `OldLineageCannotAppendAfterReset`.
- [ ] Normalize the key into the operation ID namespace; do not re-run semantic
  edit planning for a committed duplicate. The duplicate digest for
  `source = http-edit` is SHA-256 of the canonical request body, not of the
  derived update: the update bytes depend on the room's per-load random Yjs
  client id, so a retry against a recreated room would otherwise look like an
  `operation-id-conflict`.
- [ ] Return lineage and server sequence in response headers. Keep the existing
  NUL and semantic block validation.
- [ ] Make reset a fenced store transaction before sockets close. The current
  `ResetAsync` reads the tag through `store.ReadAsync` while the room is `New`;
  with an operation store it must open the fenced session first.
- [ ] Run only edit/reset tests.

```bash
dotnet test packages/server/dotnet/Blok.Server.AspNetCore.Tests/Blok.Server.AspNetCore.Tests.csproj \
  --filter 'FullyQualifiedName~EditEndpointTests|FullyQualifiedName~ResetEndpointTests'
```

### Task 3.6: Demote whole JSON to checkpoint/eviction projection

**Files:**

- Modify: `packages/server/dotnet/Blok.Server.Tests/Collab/CollabRoomTests.cs`
- Modify: `packages/server/dotnet/Blok.Server.Tests/Collab/DocEndpointClientTests.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/CollabRoom.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/DocEndpointClient.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/CollabRoomOptions.cs`

- [ ] Add tests:
  - `OperationAckDoesNotWaitForJsonProjection`;
  - `EditsDoNotScheduleAWholeJsonPutPerDebounceWindow`;
  - `PublishedCheckpointSchedulesOneProjection`;
  - `EvictionAndDrainProjectTheLatestCommittedSequence`;
  - `ProjectionCarriesLineageAndServerSequence`;
  - `FailedProjectionStaysDirtyAndRetries`;
  - `EvictionWaitsForADirtyProjection` (the dirty flag is in memory; evicting
    past a failed projection would leave the consumer's record behind until
    the next edit — the Phase 2 law "evict must not drop a room whose persist
    failed" now applies to the projection; reuse the existing backoff);
  - `OlderProjectionCannotOverwriteANewerSequenceWhenConsumerUsesHeaders`.
- [ ] Remove operation-by-operation `MarkDirty` scheduling. Schedule projection
  after checkpoint publication and on eviction/drain only.
- [ ] Add `Blok-Doc-Lineage` and `Blok-Doc-Sequence` request headers. Keep
  `Blok-Doc-Version` compatibility.
- [ ] Keep seed/load and explicit reset semantics unchanged.
- [ ] Run the focused room/endpoint tests.

### Task 3.7: Retire the working-set path inside an operation-store room

**Files:**

- Modify: `packages/server/dotnet/Blok.Server.Tests/Collab/CollabRoomTests.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/CollabRoom.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/CollabRoomManager.cs`

A journal-backed room must not keep a second, unfenced copy of the document.
Today `CollabRoom.cs` loads through `TryLoadLocked` (`store.ReadAsync` +
hydrate), writes through `SchedulePersistLocked` (`blobVersion`,
`persistedVersion`, `inFlightPersist`), refuses eviction while those differ in
`EvictLocked`, and calls `CompactLocked` from four sites: `TryLoadLocked`,
`ApplyFromMemberLocked`, `EditAsync`, and `FlushLocked` on every drain and
eviction. `CompactLocked` drops dependency-pending updates, so the drain path
alone is Risk 2 firing even if no checkpoint cursor ever advances.

- [ ] Add failing tests:
  - `OperationStoreRoomNeverWritesTheWorkingSetStore`;
  - `OperationStoreRoomNeverCompacts`;
  - `OperationStoreRoomLoadsBaselineAndTailThroughTheFencedSession`;
  - `OperationStoreRoomEvictsWithoutWaitingForABlobWrite`.
- [ ] In operation-store mode: load = open the fenced session and hydrate
  baseline + tail; skip persist scheduling, blob version tracking, the
  blob-write eviction hold, and all four compaction calls. The projection's
  dirty hold from Task 3.6 stays. Working-set-only rooms keep every one of
  them.
- [ ] Run only the room tests.

### Wave 3 gate

- [ ] Run all Blok.Server and ASP.NET collaboration tests.
- [ ] Verify a journal failure never emits an ACK, broadcast, checkpoint, or JSON
  PUT.
- [ ] Commit and push the full server path before enabling the client.

---

## Wave 4 — Client Outbox and Acknowledged Provider

### Task 4.1: Replace the unreleased offline cache with the operation store

**Files:**

- Create: `src/components/modules/collaboration/operation-store.ts`
- Create: `test/unit/components/modules/collaboration/operation-store.test.ts`
- Modify, then remove: `src/components/modules/collaboration/offline-cache.ts`
- Modify, then remove: `test/unit/components/modules/collaboration/offline-cache.test.ts`

The internal contract is (reuse the existing `WorkingSetTag` and
`OfflineCacheLocks` types):

```ts
type SessionProtocol = 'v1' | 'v2';

interface OperationStoreOptions {
  url: string;                  // canonical server URL
  doc: string;
  offlineScope: string | null;  // null = memory mode, no IndexedDB
  locks?: OfflineCacheLocks;    // existing compaction lock seam
}

interface StoredDocument {
  meta: {
    format: number;
    epoch: number;
    lineage: string;
    writeDenied: boolean;
    protocol: SessionProtocol;  // negotiated at the last completed sync
    savedAt: number;
  };
  updates: Uint8Array[];        // cache rows for the adopted lineage
  pendingOperations: number;
}

interface PendingOperation {
  operationId: string;          // 32 lowercase hex
  lineage: string;
  localOrder: number;
  bytes: Uint8Array;
  createdAt: number;
}

interface OperationStoreStats {
  pendingOperations: number;
  pendingBytes: number;
  quarantinedOperations: number;
  appendInFlight: boolean;
}

interface OperationStore {
  open(): Promise<StoredDocument | null>;
  /** Replaces today's saveMeta: tag, write verdict, protocol and the optional
   *  first snapshot, ordered internally in one call. */
  recordSession(
    tag: WorkingSetTag,
    writeDenied: boolean,
    protocol: SessionProtocol,
    snapshot?: Uint8Array,
  ): Promise<void>;
  /** Local edit on a v2 session: one transaction writes `updates` + `outbox`. */
  appendLocal(update: Uint8Array): Promise<PendingOperation>;
  /** Local edit on a v1 session: `updates` only, no outbox row, no receipt. */
  appendCached(update: Uint8Array): Promise<void>;
  /** Inbound server update: `updates` only. */
  appendRemote(update: Uint8Array): Promise<void>;
  oldestPending(): Promise<PendingOperation | null>;
  /** Resolves on IDBTransaction.oncomplete; an aborted delete keeps the row. */
  acknowledge(operationId: string): Promise<void>;
  /** One transaction: every row of `lineage` plus the recovery snapshot move to
   *  `quarantine`. Returns the number of quarantined outbox rows. */
  quarantineLineage(lineage: string, reason: string, snapshot: Uint8Array): Promise<number>;
  stats(): Promise<OperationStoreStats>;
  /** Payload-free hint that this or another tab committed a change. Listeners
   *  must re-read; the hint is lossy by design. */
  onCommitted(listener: () => void): () => void;
  clearAdoptable(): Promise<void>;
  close(): Promise<void>;
}
```

Local edits route by the session protocol: v2 → `appendLocal`, v1 →
`appendCached`. A cache-adopted offline boot reuses the protocol recorded in
`meta`, so a v1-only deployment never accumulates outbox rows it cannot drain.

`appendLocal` stamps the lineage the module currently holds: the adopted
`meta` or the last validated control frame. A local update with no lineage
cannot happen by construction — editing is blocked until one exists (first
sync or cache adoption) — so the store throws instead of parking rows. The
same holds for `meta.protocol`: a cold first boot is read-only until the
handshake names the protocol. Today's cache silently drops such appends; the
new store must not.

lib0's `idb` helpers carry narrow JSDoc types (`put`/`del`/`addAutoKey`
reject the `IDBValidKey`/object shapes this module stores) — the source of the
six TS errors `offline-cache.ts` carries on main. Wrap them once in
`operation-store.ts` with typed signatures rather than reproducing the errors.
Compaction keeps its opportunistic `navigator.locks` request (`ifAvailable`);
correctness never depends on it.

- [ ] Port the current cache lineage, epoch, writeDenied, adoption, self-replay,
  clear-ordering, compaction, and multi-tab tests first.
- [ ] Add failing tests:
  - `generates one lowercase 128-bit id and never regenerates it on retry`;
  - `commits cache row and outbox row in one transaction`;
  - `does not resolve appendLocal before transaction completion`;
  - `recordSession orders meta before the first snapshot in one call`;
  - `v1 session local edit writes an updates row and no outbox row`;
  - `two tabs allocate distinct localOrder values without a lock`;
  - `acknowledges only the exact operation id`;
  - `acknowledge resolves only on transaction completion and an abort keeps the row`;
  - `duplicate acknowledgement is a no-op`;
  - `a tab woken by another tab's onCommitted hint re-reads the oldest row`;
  - `cache compaction never touches outbox or quarantine`;
  - `boot renders cache while retaining pending rows`;
  - `lineage quarantine is atomic and not adoptable`;
  - `storage failure preserves the in-memory update and reports failure`;
  - `memory mode opens no IndexedDB database`;
  - `a prepopulated legacy blok-collab-* database stays untouched`.
- [ ] Implement the new database under a new name and version with `meta`,
  `updates`, `outbox`, and `quarantine` stores. Resolve every write on
  `IDBTransaction.oncomplete`, never on request success; the current cache
  awaits request success (`offline-cache.ts` `append`), which is not durable.
- [ ] Implement the same queue contract in memory when offline is false.
- [ ] Leave the old development database (`blok-collab-${key}`) untouched. Do not
  dual-write or infer attribution from its mixed update rows.
- [ ] Run only the new store tests. Keep `offline-cache.ts` until Task 4.3 has
  moved its importers in `index.ts`; delete the old source and test at the
  Wave 4 gate.

```bash
yarn test test/unit/components/modules/collaboration/operation-store.test.ts
```

### Task 4.2: Require a principal-scoped offline partition

**Files:**

- Modify: `types/configs/blok-config.d.ts`
- Modify: `src/components/core.ts` (beside the existing `collaboration.offline`
  boolean check)
- Modify: `test/unit/components/core.test.ts`
- Modify: `src/components/modules/collaboration/index.ts`
- Modify: `test/unit/components/modules/collaboration/sync-first-load.test.ts`

- [ ] Add failing config tests in `core.test.ts`:
  - `offline true requires a non-empty string offlineScope`;
  - `offline false ignores offlineScope and opens no database`.
- [ ] Add failing partition tests in `sync-first-load.test.ts`:
  - `offlineScope partitions the same server and document`;
  - `a different offlineScope opens a different database and never reads or
    mutates the other scope's rows`;
  - `returning to a scope finds its outbox intact`.
- [ ] Add `offlineScope?: string` beside `offline?: boolean`; document it as an
  opaque stable signed-in identity partition, never authorization or display
  identity.
- [ ] Validate in `core.ts` before any module opens IndexedDB. Do not derive it
  from a rotating ticket, presence, or `collaboration.user`.
- [ ] Key the database by canonical server URL + doc + scope only. Lineage stays
  in `meta` and on rows, because the module opens the database before the
  first control frame names a lineage.
- [ ] Run the focused config/module tests and `yarn lint:types`.

### Task 4.3: Capture local updates for the module lifetime

**Files:**

- Modify: `src/components/modules/collaboration/index.ts`
- Modify: `src/components/modules/collaboration/provider.ts`
- Modify: `src/components/modules/collaboration/types.ts`
- Modify: `test/unit/components/modules/collaboration/provider.test.ts`
- Modify: `test/unit/components/modules/collaboration/sync-first-load.test.ts`

- [ ] Add failing tests:
  - `captures a local update before any socket exists (cache-adopted boot)`;
  - `captures while reconnecting and offline`;
  - `does not enqueue a provider-origin broadcast`;
  - `sends nothing before appendLocal resolves`;
  - `storage failure blocks editing and sends nothing`;
  - `destroy detaches capture only after the final buffered Yjs flush`.
- [ ] Two module-lifetime taps, not one: the existing `onAnyDocUpdate` tap in
  `index.ts` keeps feeding the cache (`appendRemote`/`appendCached` by origin),
  and a new local-only tap (`onDocUpdate`, which already excludes remote
  origins) feeds `appendLocal`. Neither lives in per-socket `hookSeam`, which
  today drops a local update outright when the socket is absent or not ready.
  Collapsing the two would journal remote updates into the outbox.
- [ ] Route incoming server updates to `appendRemote` only in offline mode.
- [ ] Preserve the existing CACHE/provider origin suppression laws.
- [ ] Run the two focused tests.

### Task 4.4: Implement v2 drain, exact ACK, retry, and rejection

**Files:**

- Modify: `src/components/modules/collaboration/provider.ts`
- Modify: `src/components/modules/collaboration/types.ts`
- Modify: `test/unit/components/modules/collaboration/provider.test.ts`

- [ ] Add failing tests:
  - `v2 never answers a server SyncStep1 with a raw SyncStep2`;
  - `drains only after applying the server SyncStep2`;
  - `a server SyncStep1 is ignored while the outbox is non-empty and
    re-requested once it drains`;
  - `residual local state after draining is enveloped as one operation`;
  - `v1-era cached edits reach a v2 server after an upgrade`;
  - `keeps one operation in flight per provider`;
  - `resends the same id after disconnect before ack`;
  - `ack deletes the exact row and drains the next`;
  - `ack from another tab is harmless`;
  - `ack timeout reconnects without deleting`;
  - `broadcast from the submitting socket applies idempotently`;
  - `lineage mismatch quarantines before reset`;
  - `a buffered Yjs write in flight during relineage lands in quarantine, not
    the new lineage`;
  - `final rejection quarantines the dependent tail`;
  - `transient server close leaves every row pending`;
  - `commit-unavailable close (4503) keeps every row, quarantines nothing, and
    reconnects with backoff`;
  - `message-size validation includes the v2 wrapper`.
- [ ] Order relineage as: flush the Yjs write buffer (the same flush
  `Collaboration.destroy` performs) → await every outstanding `appendLocal` →
  `quarantineLineage(old, reason, encodeStateAsUpdate())` → the existing
  synchronous `resetForRelineage` → adopt the new lineage. The provider awaits
  that preparation before it reconnects. Today the flush happens inside
  `YjsManager.resetForRelineage`, after the cache is already being cleared.
- [ ] In v2, replace direct local type-0 sends with frame 102. Retain type-0 only
  for v1 mode and server broadcasts.
- [ ] On a server SyncStep1 under v2: ignore it while the outbox is non-empty;
  once the outbox drains, send SyncStep1 again; on the fresh server state
  vector compute the local diff and, if non-empty, `appendLocal(diff)` and drain
  it as one operation. This is the only path by which edits cached under a v1
  session (`appendCached`) reach a server that has since gained a durable store.
- [ ] On frame 103, validate lineage/ID/sequence, await exact store deletion, then
  drain again.
- [ ] On frame 104, distinguish reset from final rejection exactly as the spec
  states. Treat reason text as untrusted and do not add it to the stable code.
- [ ] Run only provider and wire tests.

```bash
yarn test test/unit/components/modules/collaboration/provider.test.ts \
  test/unit/components/modules/collaboration/sync-wire.test.ts
```

### Task 4.5: Keep mixed-version fallback honest

**Files:**

- Modify: `test/unit/components/modules/collaboration/provider.test.ts`
- Modify: `test/unit/components/modules/collaboration/sync-first-load.test.ts`
- Modify: `src/components/modules/collaboration/provider.ts`
- Modify: `src/components/modules/collaboration/index.ts`

- [ ] Add tests:
  - `v1 selected with no v2 rows keeps current behavior`;
  - `v1 selected with pending v2 rows sends none and blocks editing`;
  - `v1 never deletes or acknowledges a v2 row`;
  - `v2 reconnect later sends and acknowledges the retained row`;
  - `stock provider behavior is unchanged`.
- [ ] Select protocol mode before enabling post-sync editing.
- [ ] Preserve v1's raw SyncStep2 resync answer. Under negotiated v2 the answer
  is always enveloped (Task 4.4).
- [ ] Run focused provider/module tests.

### Task 4.6: Expose save state independently from connection state

**Files:**

- Modify: `types/events/editor-events.ts`
- Modify: `src/components/modules/collaboration/types.ts`
- Modify: `src/components/modules/collaboration/index.ts`
- Modify: `test/unit/components/events/CollaborationStatusChanged.test.ts`
- Modify: `test/unit/components/modules/collaboration/sync-first-load.test.ts`

Add this optional, backward-compatible payload member:

```ts
save?: {
  state: 'saved' | 'pending' | 'blocked' | 'quarantined' | 'unavailable';
  reason?: 'local-storage-failed' | 'operation-rejected' | 'legacy-protocol';
  pendingOperations: number;
  pendingBytes: number;
  quarantinedOperations: number;
  serverSequence?: string;
};
```

Do not extend `CollaborationTerminalReason`: its documented contract is "the
editor will not reconnect", and a broken local store or a rejected operation
does not stop the socket. Persistence reasons live in `save.reason`.

- [ ] Add failing tests:
  - `connected may report pending`;
  - `saved requires zero rows and no append transaction`;
  - `v1 reports legacy unavailable and never saved`;
  - `storage failure reports blocked with reason local-storage-failed and leaves
    the terminal reason union unchanged`;
  - `reset reports quarantined count after reconnect`;
  - `server sequence remains a decimal string`;
  - `a host subscribing right after isReady receives the current save state`;
  - `memory mode arms the beforeunload guard while pending; offline mode does not`.
- [ ] Emit status when save state changes even if connectivity did not change.
  Coalesce identical payloads; do not emit one event per retry timer tick.
- [ ] Re-emit the latest coalesced payload in a macrotask after the editor's
  ready promise resolves; `EventsDispatcher` has no replay, and the module
  starts connecting during load, before a host can subscribe.
- [ ] In memory mode register the same `beforeunload` guard
  `src/components/utils/persistence.ts` uses while rows are pending (mirror
  the pattern; that file is not modified). In offline mode rows survive the
  reload, so no guard.
- [ ] Run event/module tests and type checking.

### Wave 4 gate

- [ ] Run all collaboration/Yjs unit tests, including the moved offline-cache laws.
- [ ] Run scoped ESLint on only changed client/test/type files.
- [ ] Commit and push the client only after the server v2 path is already on main.

---

## Wave 5 — Checkpoints, Replay, Projection, and Process Proof

### Task 5.1: Publish only complete checkpoints

Skip this task entirely if Task 0.2 recorded `checkpoint advancement disabled`.

**Files:**

- Modify: `packages/server/dotnet/Blok.Server.Tests/Collab/CollabRoomTests.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/CollabRoom.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/CollabRoomOptions.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs`

- [ ] Add tests:
  - `CheckpointThroughNeverExceedsDurableThrough`;
  - `PendingYjsStatePreventsCheckpointAdvancement`;
  - `CheckpointThenTailReplaysTheExactDocument`;
  - `CheckpointPublicationDoesNotDeleteOperationHistory`;
  - `CrashBeforeManifestPublishUsesTheOldCheckpointAndFullTail`.
- [ ] Trigger checkpoint work from the existing frame/byte thresholds, but write
  only committed state.
- [ ] If Task 0.2 recorded `checkpoint advancement disabled`, retain the full
  journal and skip cursor advancement; never guess that pending state is empty.
- [ ] Run focused room/store tests.

### Task 5.2: Prove hard-kill recovery

**Files:**

- Modify: `packages/server/dotnet/Blok.Server.Host.Tests/HostCollabTests.cs`
- Modify: `test/unit/server-conformance/server-process.ts`
- Modify: `scripts/test-server-conformance.mjs`
- Create: `test/unit/server-conformance/protocol-v2-contract.test.ts`

- [ ] Add the new v2 contract file to `test-server-conformance.mjs` before using
  `--test-name-pattern`; the runner must actually execute every test named below.
- [ ] Add real-process tests:
  - `AcknowledgedOperationSurvivesKillAndRestart`;
  - `KilledBeforeAckResendCommitsExactlyOnce`;
  - `AckLostAfterCommitReplaysOneHistoryRecord`;
  - `CheckpointLagReplaysJournalTail`;
  - `DrainNeverAcknowledgesAnUncommittedOperation`;
  - `MiddleJournalCorruptionRefusesStartup`.
- [ ] Use process exit/kill, a real local collaboration directory, and a late
  join. Do not simulate restart by constructing another room in the same
  process. The PascalCase names above are .NET host tests; the JS conformance
  file's tests are lowercase sentences, which is what `--test-name-pattern`
  (vitest `-t`, case-sensitive) matches.
- [ ] Run only host/conformance tests.

```bash
dotnet test packages/server/dotnet/Blok.Server.Host.Tests/Blok.Server.Host.Tests.csproj \
  --filter 'FullyQualifiedName~HostCollabTests'
node scripts/test-server-conformance.mjs --target csharp \
  --test-name-pattern 'acknowledged|restart|journal|checkpoint'
```

### Task 5.3: Prove mixed-client and multi-tab behavior

**Files:**

- Modify: `test/unit/server-conformance/blok-client-contract.test.ts`
- Modify: `test/unit/server-conformance/sync-contract.test.ts`
- Modify: `test/unit/server-conformance/protocol-v2-contract.test.ts`

- [ ] Add black-box tests:
  - v2/v2 operation ACK and late join;
  - v1 client with v2 server, journal-before-broadcast and no receipt;
  - v2 client with v1 server, unavailable state and retained outbox;
  - stock y-websocket reader with v2 writer;
  - two tabs send the same IndexedDB row and produce one journal record;
  - tab B submits tab A's row and both tabs converge;
  - read-only and reset races preserve/quarantine pending bytes;
  - actor comes from the ticket, not offline scope or presence.
- [ ] Run only the three conformance files.

```bash
yarn test test/unit/server-conformance/protocol-v2-contract.test.ts \
  test/unit/server-conformance/blok-client-contract.test.ts \
  test/unit/server-conformance/sync-contract.test.ts
```

### Task 5.4: Record the rollback boundary

**Files:**

- Modify: `packages/server/README.md`
- Modify: `docs/src/components/server/server-data.ts`
- Modify: `docs/src/components/server/server-data.test.ts`

- [ ] Add a docs test that refuses the claim “an old server can be restored
  immediately after v2 ACKs.”
- [ ] Document that BKW3 journal commits can be ahead of a BKW2 checkpoint. A
  rollback to a binary that cannot replay the journal requires a drained,
  checkpointed export performed by the new binary first.
- [ ] Add an operator runbook test/fixture that performs: stop admission, drain,
  publish checkpoint/projection, verify cursor equals durable-through, then
  permit rollback.
- [ ] Do not add a hidden dual whole-document write merely to preserve instant
  rollback.

### Wave 5 gate

- [ ] Run the .NET solution in Release and the three server-conformance files.
- [ ] Kill/restart proof must pass on the current host platform.
- [ ] Commit and push recovery/conformance separately from documentation.

---

## Wave 6 — Public Custom-Backend Contract and Documentation

### Task 6.1: Publish language-neutral behavior cases

**Files:**

- Modify: `packages/server/protocol/blok-sync-v2.md`
- Modify: `scripts/test-server-conformance.mjs`
- Modify: `test/unit/server-conformance/protocol-v2-contract.test.ts`
- Modify: `test/unit/server-conformance/fixtures/sync-frames.json`

- [ ] Add normative scenarios for:
  - duplicate same ID/same digest;
  - same ID/different digest;
  - ACK then hard restart;
  - failed journal append;
  - checkpoint lag and replay;
  - compaction preserving history;
  - reset lineage isolation;
  - authenticated actor and read-only rejection.
- [ ] State plainly that the repository's conformance runner drives only the
  built C# host (`--target csharp`; it builds `Blok.Server.Host.csproj` and
  passes host-only flags). A non-.NET backend runs the published fixtures and
  scenario definitions in its own harness; durable certification additionally
  requires that harness to restart the backend, fail the next append, and
  inspect history. No external-target mode is added in this plan.
- [ ] Make the C# reference server pass every scenario before calling the spec
  stable.
- [ ] Do not add a package export or CLI `bin` entry in `package.json`; the
  protocol document is repository-only.

### Task 6.2: Document the .NET custom store

**Files:**

- Modify: `packages/server/README.md`
- Modify: `docs/src/components/server/server-data.ts`
- Modify: `docs/src/components/server/server-data.test.ts`

- [ ] `packages/server/README.md` has no collaboration section: add one. Fix
  the claims v2 makes wrong — "the current packages store no documents", the
  routes table (`/health`, `/unfurl`, `/upload`, `/upload-by-url` only), and
  "the `doc` claim is reserved for future document-scoped routes".
- [ ] Add one complete `UseCollabOperationStore<T>()` example showing an
  ASP.NET host registering its transactional implementation.
- [ ] State every required atomicity/fence/idempotency law beside the example.
- [ ] Explain that a non-.NET backend implements `blok-sync.v2` directly and runs
  the same durable scenarios.
- [ ] State that stock y-websocket is compatible only with the non-acknowledged
  profile.
- [ ] State that current S3 configuration remains v1-only.

### Task 6.3: Document single-user save, offline scope, and status

**Files:**

- Modify: `docs/src/components/server/server-data.ts`
- Modify: `docs/src/components/server/server-data.test.ts`
- Modify: `docs/src/i18n/en.json`
- Modify: `docs/src/i18n/ru.json`
- Modify: `types/configs/blok-config.d.ts`
- Modify: `types/events/editor-events.ts`

- [ ] Use the `blok-translations` skill for all locale changes.
- [ ] Add examples for:
  - one-user collaboration as the recommended acknowledged save path;
  - `offline: true` with a stable opaque `offlineScope`;
  - rendering `connected + pending`, `saved`, `unavailable`, and `quarantined`;
  - the exact ACK boundary and browser-eviction caveat;
  - legacy whole-JSON persistence as compatibility, not history.
- [ ] Remove any wording that equates sync, socket send, or JSON projection with
  durable acknowledgement.
- [ ] Add English/Russian docs tests for the new guarantees and caveats. Expect
  to update the pins that already exist: `server-data.test.ts` asserts the
  exact ordered `serverLimits` id list (count in the test title), whitelists
  every `--flag` named in prose, and pins the position of
  `collab-replaces-persistence`; `docs/src/i18n/index.test.ts` requires a ru
  twin per en leaf with real Russian under `server.limits.`; the ru purity
  test renders the server page and fails on visible Latin prose.
- [ ] Run only docs translation validation and the affected docs tests first.

```bash
yarn i18n:check:docs
yarn --cwd docs test server-data.test.ts i18n ru-language-purity
```

### Wave 6 gate

- [ ] Run the protocol fixture tests, docs tests, docs build, and published-type
  type check.
- [ ] Commit and push docs/specs after the implementation they describe is green.

---

## Final Verification and Landing

### Task 7.1: Review for minimality and contract drift

- [ ] Review the current-session diff for scope and delete anything not required
  by this specification.
- [ ] Remove any second retry queue, leader election, sparse sequence tracker,
  raw HTTP operation route, speculative S3 path, or per-block audit parser that
  entered the implementation.
- [ ] Verify the public TypeScript types do not import `src/`.
- [ ] Verify every new server public type has XML docs and neither a YDotNet
  type nor an `internal` type (such as `CollabWorkingSetTag`) in its signature.
- [ ] Verify no change touched a prohibited config/package file except the
  explicitly planned YDotNet `.csproj` reference.

### Task 7.2: Run final gates

Run scoped ESLint only on changed JS/TS files:

```bash
yarn eslint \
  src/components/core.ts \
  src/components/modules/collaboration/index.ts \
  src/components/modules/collaboration/provider.ts \
  src/components/modules/collaboration/types.ts \
  src/components/modules/collaboration/sync-wire.ts \
  src/components/modules/collaboration/operation-store.ts \
  types/configs/blok-config.d.ts \
  types/events/editor-events.ts \
  test/unit/components/modules/collaboration/operation-store.test.ts \
  test/unit/components/modules/collaboration/provider.test.ts \
  test/unit/components/modules/collaboration/sync-wire.test.ts \
  test/unit/components/modules/collaboration/sync-first-load.test.ts \
  test/unit/components/core.test.ts \
  test/unit/components/events/CollaborationStatusChanged.test.ts \
  test/unit/server-conformance/blok-client-contract.test.ts \
  test/unit/server-conformance/protocol-v2-contract.test.ts
```

Then run full verification. The .NET commands match CI verbatim; on this
machine a restore needs `-p:NuGetAudit=false` on the command line (never in
config — `Directory.Build.props` turns audit warnings into errors), and
`dotnet format` needs `--no-restore`. CI also enforces the server coverage gate
(`scripts/check-server-coverage.mjs`, 80% lines and branches), so the new
store, codec and room code must carry tests in proportion.

```bash
NODE_OPTIONS=--max-old-space-size=8192 yarn lint:types
yarn test
dotnet test packages/server/dotnet/Blok.Server.slnx --configuration Release
dotnet format packages/server/dotnet/Blok.Server.slnx --verify-no-changes
yarn i18n:check:docs
yarn --cwd docs test
yarn --cwd docs build
node scripts/test-server-conformance.mjs --target csharp
```

- [ ] On any failure, run `git diff --name-only`, classify session-owned versus
  pre-existing failures, and dispatch one parallel agent per owned failure
  category before retrying the gate.
- [ ] Invoke `superpowers:requesting-code-review` and verify every finding before
  applying it.
- [ ] Invoke `superpowers:verification-before-completion`; record fresh command
  output instead of relying on an earlier run.

### Task 7.3: Land safely on main

- [ ] Confirm no stash exists and no unrelated working-tree file is staged.
- [ ] Rebase onto origin (`git pull --rebase`); never merge, never stash.
- [ ] Commit any remaining verified wave by staging only the paths that wave owns.
- [ ] Push main.
- [ ] Confirm `git status` says main is up to date with origin and only the
  user's pre-existing unrelated changes remain.
- [ ] Record the release order: server first, client second. A server without a
  durable operation store must select v1; a client must never infer v2 from a
  control frame.

---

## Parallel Execution Map

Use parallel subagents only where file ownership is disjoint:

- **Wave 0:** YDotNet probe and client seam baseline may run in parallel.
- **Wave 1:** TypeScript wire fixtures/codecs and C# codecs may run in parallel
  after the fixture schema is frozen; handshake follows both.
- **Wave 2:** public interface/registration and journal codec may run in
  parallel; local store follows the codec.
- **Wave 3:** actor plumbing and JSON projection tests may start in parallel;
  all `CollabRoom.cs` edits funnel through one agent.
- **Wave 4:** operation-store implementation and public status types may start
  in parallel; provider integration follows the store contract.
- **Wave 5:** hard-kill host tests and JS mixed-client harness work may run in
  parallel after the server path is green.
- **Wave 6:** protocol docs and user docs may run in parallel; locale edits stay
  with one translation agent.

Never let two agents edit `CollabRoom.cs`, `provider.ts`, `index.ts`, or a shared
fixture at the same time.

## Completion Criteria

The feature is complete only when all of these are true:

- An official client edit is not socket-sendable before its outbox append
  commits.
- A v2 ACK cannot precede durable attributed journal commit.
- Retry after lost ACK produces one history record and one logical change.
- An append failure exposes no change and leaves the client operation pending.
- Hard-kill after ACK restores both document state and attributed history.
- Checkpoint lag cannot lose a committed operation.
- Reset cannot replay old-lineage pending work.
- Two tabs can duplicate-send without a leader and still produce one record.
- v1 and stock clients still converge but never receive a false durability claim.
- Single-user collaboration uses exactly the same operation path.
- A consumer can replace the .NET store or implement the language-neutral v2
  contract without using Blok's hosted backend.
- Frequent whole-document JSON PUT is no longer the durability mechanism.
- S3 is clearly reported as v1-only until a separate CAS/fencing plan lands.
