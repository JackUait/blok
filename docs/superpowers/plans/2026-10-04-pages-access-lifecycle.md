# Page Access Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a host expel revoked live readers, permanently purge one document's sidecar state without resurrection, and explicitly forget a whole user's offline scope after showing unsent work.

**Architecture:** The host owns grants, trash, retention, document tombstones and authorization. A room-lane recheck closes affected WebSocket members without resetting the document. A separate in-process purge call checks host authorization, bars new room work, quiesces without flushing, and deletes the fenced journal and working set; IndexedDB scope inspection/forget is a client-only operation and never substitutes for server deletion.

**Tech Stack:** .NET/C# xUnit, ASP.NET Core WebSockets, local and S3 collaboration stores, TypeScript, Vitest with fake-indexeddb.

**Spec:** `docs/superpowers/specs/2026-10-04-headless-page-platform-design.md`, especially lines 17–27, 53–57, 75–92. The independent slice C plan is `docs/superpowers/plans/2026-10-04-pages-links-access.md`.

## Global Constraints

- The host commits an ACL or permanent-delete tombstone before it asks Blok to recheck or purge. Host authorization and consumer GET/PUT must deny deleted documents; Blok does not create grants, trash records, retention jobs or a trash UI.
- A trashed document is **not** purged. Restore reuses its existing document ID, body, working set and journal. Purge is permanent and an opaque ID is never reused.
- Revocation is a `4403 forbidden` close, not reset's `4409`; do not change the lineage, discard pending client operations, or close allowed peers.
- The journal is authoritative when registered. Reset keeps old generations, so reset is never a purge. A registered journal without the optional purge capability makes purge fail closed before deleting anything.
- Purge must stop joins, WebSocket writes, HTTP edits, resets and deferred exports for that document, wait for in-flight room work, take the journal's exclusive fence, remove every working-set and journal payload, and retain a durable deletion marker. Failure leaves admission barred and is retryable. Without a journal, the host must quiesce every sidecar instance and keep its consumer tombstone/authorization denial durable across restarts; the local manager gate alone cannot fence another process.
- An S3 current-object DELETE cannot promise erasure of versioned object history, replicas or backups. The host/operator must handle those under its retention policy; the integration recipe must not call a single DELETE physical erasure.
- Offline partition names are `blok-ops-${escape(url)}|${escape(doc)}|${escape(offlineScope)}`; `escapePartitionSegment` escapes `%` before `|`. A complete forget touches `meta`, `updates`, `outbox` and `quarantine` by deleting each matching database, not `clearAdoptable()`.
- The host must close or switch every tab using the old `offlineScope` before forget. Already-offline devices cannot be remotely erased until they reconnect. Missing `indexedDB.databases()`, a blocked delete, or partial deletion must reject, not report success.
- Use TDD for each code task: add its named test first, observe RED by running that file only, write minimal code, observe GREEN, then refactor. Unit tests call `vi.clearAllMocks()` in `beforeEach` and `vi.restoreAllMocks()` in `afterEach`; no `any`, `@ts-ignore` or non-null assertions. Lint only changed files while iterating.
- Do not edit `package.json`, `vite.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json`, `eslint.config.mjs` or `.env`. Preserve unrelated work on the dirty shared `main`. Do not branch, worktree, stash, commit or push under this planning request.
- Before editing server reference copy, read `docs/src/i18n/reference-prose.test.ts`; keep any duplicated English literal in `server-data.ts` in sync with `en.json`, translate the matching Russian shape, and run the relevant docs test.

## Review Focus

1. An authorization call races a join admitted before the ACL commit: the final room-lane check or recheck closes the revoked member before any later frame is served (Task 1).
2. A revoked writer has an inbound frame queued while recheck runs: after recheck completes, no further write from that membership commits or relays, and allowed peers stay connected (Task 1).
3. A purge fails after the journal tombstone but before working-set deletion: retry finishes without ever opening or re-seeding old content (Tasks 2–3).
4. A process restarts after purge while a consumer endpoint still returns an old document: the durable journal tombstone refuses open, and an old session cannot republish payload (Task 2).
5. A logout scope has an empty v2 outbox but v1 cached edits, quarantine, and same-ID documents for two users: inspection warns conservatively and forget removes only the exact requested scope (Task 4).

---

## File map and interface contracts

| Unit | Files | Responsibility |
| --- | --- | --- |
| Live authorization | `CollabRoom.cs`, `CollabRoomManager.cs`, `ICollabMember.cs`, `ICollabRoomManager.cs`, ASP.NET `SyncHandshake.cs`, `SyncEndpoint.cs`, `SyncSocketMember.cs`, `SyncClose.cs` | Fresh policy checks inside the room lane and targeted `4403` expulsion. |
| Journal purge | `ICollabOperationStore.cs`, `LocalCollabOperationStore.cs` | Optional additive purge capability; same per-document fence and a durable tombstone. |
| Working set and orchestrator | `ICollabWorkingSetStore.cs`, `LocalCollabStore.cs`, `S3CollabStore.cs`, `CollabRoom.cs`, `CollabRoomManager.cs`, new `ICollabDocumentPurger.cs` | Fail-closed in-process purge with no final flush. |
| Browser scope | `src/components/modules/collaboration/offline-scope.ts`, `src/blok.ts`, `types/index.d.ts` | Inspect and deliberately delete every IndexedDB partition of one identity. |
| Host recipe | `docs/src/components/server/server-data.ts`, `docs/src/i18n/en.json`, `docs/src/i18n/ru.json`, ASP.NET integration tests | Ordering and limits of revoke, trash/restore, purge and logout. |

### Task 1: Recheck live memberships without reset

**Files:**
- Modify: `packages/server/dotnet/Blok.Server/Collab/ICollabMember.cs`, `CollabRoom.cs`, `CollabRoomManager.cs`, `ICollabRoomManager.cs`
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore/Collab/SyncHandshake.cs`, `SyncEndpoint.cs`, `SyncSocketMember.cs`, `SyncClose.cs`
- Test: `packages/server/dotnet/Blok.Server.Tests/Collab/CollabRoomManagerTests.cs`, `packages/server/dotnet/Blok.Server.AspNetCore.Tests/Collab/SyncEndpointTests.cs`

**Interfaces:**
- Produces: `ICollabRoomManager.RecheckAccessAsync(string documentId, CancellationToken cancellationToken = default): ValueTask<int>`; returned count is expelled members, not all examined members.
- Produces internally: `ICollabMember.RecheckAccessAsync(CancellationToken): ValueTask<bool>`; false means read access is gone **or** an admitted writer no longer has write access. This callback asks `IBlokAuthorization` with the verified ticket principal or `HttpContext.User` captured at admission. No registered hook means true.
- Produces internally: `CollabCloseReason.Forbidden` mapped to `SyncClose.Forbidden` (`4403`); `CollabJoinStatus.Forbidden` for the room-lane admission check.
- Consumes: existing `IBlokAuthorization.CanReadDocumentAsync` and `CanWriteDocumentAsync`; neither gets a new required method. The host calls recheck after committing a permission change, on each server instance serving that document.

- [ ] **Step 1: Write failing tests.** Extend the manager test's fake member with a mutable `Allowed` verdict and check the public interface, not `ExpelLocked`:

```csharp
var revoked = new FakeMember();
var allowed = new FakeMember();
await manager.JoinAsync("doc-a", revoked);
await manager.JoinAsync("doc-a", allowed);
revoked.Allowed = false;

var closed = await ((ICollabRoomManager)manager).RecheckAccessAsync("doc-a");

Assert.Equal(1, closed);
Assert.Equal([CollabCloseReason.Forbidden], revoked.Closes);
Assert.Empty(allowed.Closes);
Assert.Equal(0, await ((ICollabRoomManager)manager).RecheckAccessAsync("doc-absent"));
```

Add a gate-controlled race: queue a receive behind recheck and assert that no update from the expelled membership reaches the peer or journal. Add a join queued against the same lane during recheck and assert `Forbidden`; the callback is checked at join even after a successful handshake. In `SyncEndpointTests`, use two ticket users with a mutable authorization fake: revoke one's read or write, call the public recheck, assert that member closes `(4403, "forbidden")`, the other stays live, and a new connection fails admission. Also assert the close is not `4409`, and an authorization exception fails closed rather than leaving an admitted writer active.

- [ ] **Step 2: Run only the changed test files, one command per file.** `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter FullyQualifiedName~CollabRoomManagerTests`; then the ASP.NET test project with `--filter FullyQualifiedName~SyncEndpointTests`. Expected RED: no recheck method or forbidden room close.
- [ ] **Step 3: Add the callback and lane operations.** Carry the actual `ClaimsPrincipal` out of `SyncHandshake` in `SyncAccepted`; a ticket's verified principal is not `HttpContext.User`. Construct the member callback from the singleton hook and the originally admitted `CanWrite`. Check it at the start of the room lane before `TryLoadLocked` or `members.Add`, so an unauthorized join cannot load or seed a room:

```csharp
if (!await member.RecheckAccessAsync(cancellationToken))
{
  return new CollabJoinResult(CollabJoinStatus.Forbidden, null, null);
}
```

For recheck, snapshot the members in `CollabRoom.RecheckAccessAsync` under its lane; for each false or thrown policy check, call `ExpelLocked(membership, CollabCloseReason.Forbidden)`. Do not call `ResetAsync`, `FlushLocked`, or change the tag. A forbidden join before the WebSocket upgrade answers 403; already-open sockets receive `4403`. Make `SyncClose.For`'s exhaustive switch cover the new reason. If a policy call throws, log it and fail closed for that member; do not silently treat it as allowed.

- [ ] **Step 4: Run the two tests to GREEN and check changed files.** Repeat the two filtered `dotnet test` commands separately. Run changed-file C# formatting/build checks using the existing project conventions; inspect `git diff --check`.
- [ ] **Step 5: Review checkpoint.** Check that read-only tickets never gain write access, that losing only write access expels a writer to renegotiate read-only, that allowed peers remain connected, and that a recheck finding no live room is a no-op.

### Task 2: Add a fenced journal purge capability

**Files:**
- Modify: `packages/server/dotnet/Blok.Server/Collab/ICollabOperationStore.cs`, `packages/server/dotnet/Blok.Server/Collab/LocalCollabOperationStore.cs`
- Test: `packages/server/dotnet/Blok.Server.Tests/Collab/LocalCollabOperationStoreTests.cs`

**Interfaces:**
- Produces additive `ICollabOperationPurgeStore` beside, not on, `ICollabOperationStore`:
```csharp
public enum CollabDocumentPurgeOutcome { Purged, DocumentOpenElsewhere }

public interface ICollabOperationPurgeStore
{
  ValueTask<CollabDocumentPurgeOutcome> PurgeAsync(
      string documentId, CancellationToken cancellationToken = default);
}
```
- Adds `CollabDocumentOpenOutcome.Purged` and `CollabDocumentOpen.Purged` so a durable tombstone cannot be misread as an unseeded document. Room/endpoint propagation belongs to Task 3.
- An external journal may opt in by implementing this second interface; no source or binary change is required of existing `ICollabOperationStore` implementations. A journal without it makes manager purge unavailable.

- [ ] **Step 1: Write the failing local-store tests.** Seed a baseline, append one operation, publish a checkpoint, then call the capability:

```csharp
var purger = (ICollabOperationPurgeStore)store;
Assert.Equal(CollabDocumentPurgeOutcome.Purged, await purger.PurgeAsync("doc-a"));
Assert.Equal(CollabDocumentOpenOutcome.Purged, (await store.OpenAsync("doc-a")).Outcome);
Assert.Equal(CollabDocumentPurgeOutcome.Purged, await purger.PurgeAsync("doc-a"));
```

Use the existing test fixture's `OpenAsync`, `Reset`, `Candidate`, `OperationId`, `DocDirectory` and `JournalPath` helpers for the seed and assertions. Dispose the session before purging. Assert that baseline, journal, checkpoint and manifest bytes are gone while a durable tombstone and the lock file remain. Task 3, not this journal capability, deletes the legacy unsuffixed working set. Add a live-session test returning `DocumentOpenElsewhere` with untouched bytes; a failure-injected delete test must leave the tombstone and retry to success; a reopen with a stale session must not append, reset or seed after purge. A simulated process restart means constructing a new store on the same directory, not reusing one instance.

- [ ] **Step 2: Run the journal test file alone.** `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter FullyQualifiedName~LocalCollabOperationStoreTests`. Expected RED: no purge capability and a purged document currently opens as unseeded.
- [ ] **Step 3: Implement purge under the existing file fence.** Keep the document's `lock` inode. Acquire that same exclusive hold, publish/fsync a tombstone **before** deleting payloads, remove every generation and orphan file including historical reset generations, fsync the directory, then return `Purged`. Never delete the lock while a session may hold it: unlinking it would let a second process lock a new inode. Make `OpenAsync` check the tombstone after taking the hold and return `CollabDocumentOpen.Purged` without importing a working set or seeding. Make the session fence check reject a tombstone. If the hold is occupied by a live process, return `DocumentOpenElsewhere` and change nothing. A failed deletion throws; a retry sees the marker and completes cleanup. Do not call journal `ResetAsync`, which retains prior generations.

- [ ] **Step 4: Run the journal test to GREEN.** Repeat the filtered command; then run changed-file build/format checks and `git diff --check`.
- [ ] **Step 5: Review checkpoint.** Confirm no payload bytes remain in the journal directory after success, no old session can write into the new document name, and a crash after tombstone publication cannot cause an empty re-seed.

### Task 3: Quiesce and purge a document's sidecar state

**Files:**
- Create: `packages/server/dotnet/Blok.Server/Collab/ICollabDocumentPurger.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/ICollabWorkingSetStore.cs`, `LocalCollabStore.cs`, `S3CollabStore.cs`, `CollabRoom.cs`, `CollabRoomManager.cs`
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore/BlokServerServiceCollectionExtensions.cs`, `Collab/EditEndpoint.cs`, `Collab/ResetEndpoint.cs`, `Collab/SyncEndpoint.cs`
- Test: `packages/server/dotnet/Blok.Server.Tests/Collab/CollabRoomManagerTests.cs`, `LocalCollabStoreTests.cs`, `S3CollabStoreTests.cs`; `packages/server/dotnet/Blok.Server.AspNetCore.Tests/Collab/SyncEndpointTests.cs`

**Interfaces:**
- Produces public in-process DI service, with no HTTP purge route:
```csharp
public interface ICollabDocumentPurger
{
  ValueTask<CollabDocumentPurgeOutcome> PurgeDocumentAsync(
      string documentId,
      Func<CancellationToken, ValueTask<bool>> authorize,
      CancellationToken cancellationToken = default);
}
```
- Produces internal `ICollabWorkingSetStore.DeleteAsync(string documentId, CancellationToken)`; absence is success, other errors throw. The manager implements `ICollabDocumentPurger` and ASP.NET registers that interface to the existing singleton.
- Consumes Task 2's `ICollabOperationPurgeStore.PurgeAsync`. If a journal exists without this capability, reject before changing room or store state. `DocumentOpenElsewhere` is retryable and leaves the process-local admission gate shut.

- [ ] **Step 1: Write failing purge tests.** In `CollabRoomManagerTests`, pass `_ => ValueTask.FromResult(false)` and assert `UnauthorizedAccessException` before any close/delete. Then authorize after a host tombstone fake is committed, hold an edit and an export in flight, and assert:

```csharp
var outcome = await purger.PurgeDocumentAsync(
    "doc-a", _ => ValueTask.FromResult(true));
Assert.Equal(CollabDocumentPurgeOutcome.Purged, outcome);
Assert.Equal(CollabJoinStatus.Purged,
    (await manager.JoinAsync("doc-a", new FakeMember())).Status);
Assert.Equal(CollabEditStatus.Purged,
    (await manager.EditAsync("doc-a", [Insert("late")])).Status);
Assert.Equal([CollabCloseReason.Forbidden], member.Closes);
```

Prove no final export/flush writes the deleted body back to the consumer, and an old queued WebSocket frame cannot repopulate it. Inject journal delete failure and working-set delete failure separately: the gate stays shut, a second call retries, and no stale data is served between attempts. With a registered non-purge journal, assert nothing is deleted. With no journal, assert the working set is deleted and the host tombstone refuses seeding on a new manager. Add local tests for the keyed file plus `.unreadable-*` sibling; add S3 tests for the exact current-object key and delete failure. In ASP.NET tests, a new sync, edit and reset after purge must be forbidden/unavailable, never create a room, and a restarted manager with journal tombstone must not seed from an old consumer GET.

- [ ] **Step 2: Run each changed test class separately.** Run `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter FullyQualifiedName~CollabRoomManagerTests`, then repeat that command with `LocalCollabStoreTests` and `S3CollabStoreTests`; run `dotnet test packages/server/dotnet/Blok.Server.AspNetCore.Tests/Blok.Server.AspNetCore.Tests.csproj --filter FullyQualifiedName~SyncEndpointTests`. Expected RED: no public purger, no store delete, and current joins can re-seed.
- [ ] **Step 3: Add the fail-closed orchestrator and store deletion.** Validate a nonempty single-segment document ID and the non-null authorization callback. Call it before touching state; false throws. Set a per-document manager gate under `rooms` lock before any room work and keep it through success or failure. Under the room lane, wait for in-flight persist/export, close all members as `Forbidden`, dispose its journal session, and **do not** call `FlushLocked`. After the room is quiescent, call the optional journal purge first; on `DocumentOpenElsewhere` return that outcome without working-set deletion. Then call working-set `DeleteAsync`. A journal tombstone plus process gate protects a failed working-set delete. Keep a successfully purged document barred for the manager's life; an opaque ID is not reused. Joins, edits, resets and checkpoint paths all inspect the same gate, including retry loops and the path after a closed room.

```csharp
if (operationStore is not null &&
    operationStore is not ICollabOperationPurgeStore)
{
  throw new NotSupportedException("the operation journal cannot purge documents");
}
```

The local working-set deletion removes its exact `CollabDocKey.For(documentId)` file, matching unreadable-aside siblings, and the legacy unsuffixed working set after quiescence, without touching another document's key. Do not delete unrelated random `.blok-collab-*` temporary files under a guessed name: current temporary names carry no document ID. Change the temporary filename format to include the keyed document name in this task, then delete those keyed temporaries too; test a failed write leaving one. S3 deletion uses existing `S3BlobStore.DeleteObjectAsync(KeyFor(docId))`, with a not-found result treated as idempotent success only after verifying the client behavior. Propagate `Purged` through journal-open/room/HTTP statuses; a deleted document may never be treated as an unseeded one. Do not add a public purge HTTP route.

- [ ] **Step 4: Run tests to GREEN.** Repeat the four filtered test commands independently. Run the server build and changed-file formatting/checks; inspect `git diff --check`.
- [ ] **Step 5: Review checkpoint.** Verify authorization denial changes nothing; a busy remote journal leaves the gate shut; success removes working-set and journal payload; retry is idempotent; trash/restore calls no purge seam.

### Task 4: Inspect and explicitly forget a complete offline scope

**Files:**
- Create: `src/components/modules/collaboration/offline-scope.ts`, `test/unit/components/modules/collaboration/offline-scope.test.ts`
- Modify: `src/components/modules/collaboration/operation-store.ts` only if exporting the partition-name parser is necessary; `src/blok.ts`, `src/full.ts`, `types/index.d.ts`
- Test: `test/unit/components/modules/collaboration/operation-store.test.ts` (related regression), `test/unit/architecture/published-types-no-src-refs.test.ts`

**Interfaces:**
- Produces named core exports:
```ts
export interface OfflinePartitionReport {
  url: string;
  doc: string;
  outbox: { count: number; bytes: number };
  quarantine: { count: number; bytes: number };
  updates: { count: number; bytes: number };
  mayHaveUnsentV1Edits: boolean;
}
export interface OfflineScopeReport {
  partitions: readonly OfflinePartitionReport[];
}
export interface OfflineScopeForgetResult {
  deletedPartitions: number;
  discarded: OfflineScopeReport;
}
export function inspectOfflineScope(offlineScope: string): Promise<OfflineScopeReport>;
export function forgetOfflineScope(
  offlineScope: string,
  options: { discardPending: true }
): Promise<OfflineScopeForgetResult>;
```
- Produces internal filtered seam for slice F, not another registry:
```ts
export function forgetOfflinePartitions(
  offlineScope: string,
  select: (partition: OfflinePartitionReport) => boolean,
  options: { discardPending: true }
): Promise<OfflineScopeForgetResult>;
```
- Consumes `escapePartitionSegment` and the existing four stores from `operation-store.ts`. `discardPending: true` is an explicit host decision, not a silent default. No tab is force-closed by this helper; blocked deletion rejects.

- [ ] **Step 1: Write the failing new test.** Use the `IDBFactory`/real `createOperationStore` fixture pattern from `operation-store.test.ts`; construct two URLs and docs in scope A, one same-ID document in scope B, v2 pending outbox, quarantine, and a v1 `appendCached` edit. Assert the defect first:

```ts
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

it('forgets only the selected identity after explicit discard', async () => {
  const report = await inspectOfflineScope('user-a');
  expect(report.partitions).toHaveLength(2);
  expect(report.partitions.some((part) => part.outbox.count > 0)).toBe(true);
  expect(report.partitions.some((part) => part.mayHaveUnsentV1Edits)).toBe(true);

  await expect(forgetOfflineScope('user-a', { discardPending: true }))
    .resolves.toMatchObject({ deletedPartitions: 2 });
  expect((await inspectOfflineScope('user-a')).partitions).toEqual([]);
  expect((await inspectOfflineScope('user-b')).partitions).toHaveLength(1);
});
```

Add tests that missing `discardPending: true` rejects at runtime (JS caller), an open IDB handle triggers `blocked` and rejects without a success result, `indexedDB.databases` unavailable rejects before deletion, malformed or unrelated DB names remain, escaped `|`/`%` segments cannot cross scopes, and a failure after one deletion rejects with partial progress rather than claiming all erased. Ensure quarantine snapshots count toward bytes and an unknown/v1 meta plus cached rows sets the conservative unsent flag. Add a `clearAdoptable()` contrast asserting it leaves outbox and quarantine, so it cannot be reused here.

- [ ] **Step 2: Run only the new test file.** `yarn test test/unit/components/modules/collaboration/offline-scope.test.ts`. Expected RED: neither public function exists.
- [ ] **Step 3: Implement enumeration, report and explicit deletion.** Parse only names with the exact `blok-ops-` prefix and exactly two unescaped `|` separators; reverse the escape without ambiguous `decodeURIComponent` behavior. Enumerate with `indexedDB.databases()`; reject when absent. Inspect stores read-only and count bytes from each row's `bytes`, including quarantine snapshots. Mark `mayHaveUnsentV1Edits` when cached updates exist with v1 or unreadable/unknown meta, because v1 has no outbox receipts. Fail if a partition cannot be inspected rather than hiding it. For forget, inspect first, select exact partitions, issue `indexedDB.deleteDatabase(name)` once per selected database, and resolve only on `onsuccess`. Reject on `onblocked` or `onerror` and report which databases were already deleted in the error. Never delete databases from another scope. The host closes/switches tabs before the call and treats any failure as incomplete logout cleanup.

- [ ] **Step 4: Run the new test to GREEN, then adjacent gates.** Run `yarn test test/unit/components/modules/collaboration/offline-scope.test.ts`, `yarn test test/unit/components/modules/collaboration/operation-store.test.ts` and `yarn test test/unit/architecture/published-types-no-src-refs.test.ts` separately. Run ESLint on only the changed TS files and `git diff --check`.
- [ ] **Step 5: Review checkpoint.** Confirm both `src/blok.ts` and `src/full.ts` runtime exports match the hand-authored declarations, a pending outbox never disappears without `discardPending: true`, and per-page forget in slice F filters this report rather than inventing another IndexedDB registry.

### Task 5: Host recipe and real access lifecycle acceptance

**Files:**
- Modify: `docs/src/components/server/server-data.ts`, `docs/src/i18n/en.json`, `docs/src/i18n/ru.json`
- Test: `docs/src/components/server/server-data.test.ts`, `packages/server/dotnet/Blok.Server.AspNetCore.Tests/Collab/SyncEndpointTests.cs`
- Read before copy: `docs/src/i18n/reference-prose.test.ts`

**Interfaces:** Documents Tasks 1–4's exact signatures and host obligations. Adds no Blok trash, restore, ACL, page-catalog or sidebar API.

- [ ] **Step 1: Add failing docs and two-user acceptance assertions.** In `server-data.test.ts`, assert the rendered server reference describes the ordering: commit host ACL then `RecheckAccessAsync`; trash retains content and restore changes only host state; permanent-delete tombstone precedes `PurgeDocumentAsync`; logout inspects and explicitly discards the whole scope after closing/switching tabs. Pin the warnings that parent documents must have legacy `page.data.cache` removed from consumer record **and** working set/journal before unauthorized readers receive them, and that offline devices cannot be remotely erased. In the ASP.NET test harness, use two authorized users and two tabs, revoke one user, await recheck, and prove that user receives no later frames while the other can still write; then trash/restore without purge, and permanently delete with a stale consumer GET and restart to prove the journal tombstone blocks re-seed. Use host fakes whose ACL/tombstone state is explicit; do not claim a test of host retention policy itself.

- [ ] **Step 2: Run scoped tests RED.** `yarn test docs/src/components/server/server-data.test.ts`; separately run the ASP.NET project filtered to `SyncEndpointTests`. Expected RED: lifecycle recipe/acceptance is absent.
- [ ] **Step 3: Write the short integration recipe.** Keep the existing docs data-module plus locale mechanism. Show the host ordering in literal C# and TypeScript snippets:

```csharp
await host.CommitRevocationAsync(documentId, userId);
await rooms.RecheckAccessAsync(documentId);

await host.CommitPermanentTombstoneAsync(documentId);
var result = await purger.PurgeDocumentAsync(
    documentId,
    token => host.CanPurgeAsync(operatorUser, documentId, token));
```

```ts
const report = await inspectOfflineScope(oldScope);
showDiscardWarning(report);
await closeEditorsAndSwitchScope(oldScope);
await forgetOfflineScope(oldScope, { discardPending: true });
```

Label these as host pseudocode, not Blok-provided `host` or `showDiscardWarning` APIs. Explain the return `DocumentOpenElsewhere` as a retry, failed partial purge as still barred, no reset for ACL changes, and that a client already offline may keep its bytes until it reconnects. A purge deletes sidecar bytes but the host separately deletes its canonical page record and any parent pointer after its own policy checks. No access UI is supplied by Blok.

- [ ] **Step 4: Run docs and server tests to GREEN.** Run the same scoped commands, then `yarn test docs/src/i18n/reference-prose.test.ts`, `node scripts/i18n/check-translations.mjs`, and changed-file lint/format checks. Run the final project gates required at execution time only after distinguishing failures in the shared checkout from this slice. Inspect `git diff --check`.
- [ ] **Step 5: Independent review.** Have a separate reviewer trace revocation, purge retries/restarts, and offline logout against the approved spec and current source. Re-run any targeted failing test before claiming the slice delivered; preserve unrelated dirty files.

## Delivery boundary

The result of this plan is host-callable primitives plus a recipe, not host policy or UI. Do not run its implementation steps while writing the plan. Before an implementation later changes a shipped public contract, compare the latest tag and `git log <tag>..HEAD -- <file>`; label and explain a genuinely breaking change under the repository rule.
