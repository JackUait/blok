# Version History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hosts can list, read, compare, restore and delete versions of a collaborative document. Blok ships data and operations; the host builds the UI.

**Architecture:** An optional public store interface (`ICollabOperationHistoryStore`) reads every lineage of the operation journal; the local store gains an append-only lineage ledger. The server groups records into versions, replays any point to Blok JSON, and restores a point as one forward edit planned inside the room's lane. The client gets `diffOutputData` in `@bloklabs/core/view`.

**Tech Stack:** C# / .NET 10, xUnit (server, `packages/server/dotnet`); TypeScript, Vitest (client).

**Spec:** `docs/plans/2026-10-07-version-history-design.md` (read it before any task; it is the source of truth for behaviour, statuses and JSON shapes).

## Global Constraints

- Worktree: `/Users/jackuait/Packages/.blok-undo/version-history`, branch `feat/version-history`. Never work in `/Users/jackuait/Packages/blok` (another session uses it).
- TDD: write the failing test, run it, see it fail for the right reason, then implement.
- Run only the tests you touch: `dotnet test packages/server/dotnet/Blok.Server.Tests --filter "FullyQualifiedName~<Class>"` (or `Blok.Server.AspNetCore.Tests`); `yarn test <file>`. Never the full suite.
- Never run two `dotnet test` processes in the same worktree at once (shared `obj/`).
- Commit with explicit paths: `git commit -m "…" -- <paths>`. End every message with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Comments: short, plain, only what silently breaks if changed. Match surrounding style (C#: `///` summaries on public members, 2-space indent as in the files).
- Unit TS tests: no `any`, no `!`, no `@ts-ignore`.
- `ICollabOperationStore`, the `/edit` wire, and saved data must not change. Nothing here is BREAKING.
- History routes: times are Unix ms; unknown → `null`; `Cache-Control: no-store`; history headers are `Blok-History-Lineage` / `Blok-History-Sequence` (never `Blok-Doc-*`, never an ETag on a version read).

## Review Focus

1. A restore that moves a block with children must keep the children (the first planner draft lost them). Pinned in Task 6.
2. An oversized restore must answer 413 and leave the room open for every member. Pinned in Task 7.
3. A document never opened since the upgrade must still list its current lineage. Pinned in Task 2.
4. A retried restore with the same idempotency key must get the first receipt, not 409. Pinned in Task 7.
5. An HTML save and a segments save of the same text must not show as changed in `diffOutputData`. Pinned in Task 1.

## Task order and parallelism

- Task 0 (DONE, commit d028dd67): `Blok.Server/Collab/ICollabOperationHistoryStore.cs` holds the public interface, `CollabLineageInfo` (Epoch is `long`), `CollabRecordHeader`, `CollabLineageDeleteOutcome`. Every later task uses it as is; nobody re-creates it.
- Wave 1 (parallel, disjoint files, each agent in its OWN worktree branched from `feat/version-history`): Task 1 (TS), Task 2 (store), Task 3 (timeline), Task 4 (replay), Task 5 (C# LIS).
- C# red steps: add the new types as stubs that throw `NotImplementedException` first, so each test fails on its assertion, not on a compile error.
- Wave 2: Task 6 (planner; needs Task 5).
- Wave 3: Task 7 (room + manager; needs 2, 3, 4, 6).
- Wave 4: Task 8 (routes; needs 7).
- Wave 5: Task 9 (docs).

Shared fixture already committed: `test/fixtures/version-history/lis-cases.json` (`{ cases: [{ positions: number[], kept: number[] }] }`).

---

### Task 1: `diffOutputData` (client)

**Files:**
- Create: `src/view/longest-kept-order.ts`, `src/view/diff-output-data.ts`, `test/unit/view/diff-output-data.test.ts`, `test/unit/view/longest-kept-order.test.ts`
- Modify: `src/view/index.ts` (line-start `export { diffOutputData } from './diff-output-data';` + `export type { OutputDataDiff, OutputBlockChange, OutputBlockMove, DiffOutputDataOptions } from './diff-output-data';`), `types/view.d.ts` (declarations from spec §7; existing import line 1 already brings the OutputData types), `test/unit/view/index.purity.test.ts` (add `diffOutputData` to the spot-check)

**Interfaces:**
- Produces: `longestKeptOrder(positions: readonly number[]): number[]` (spec LIS rule), `diffOutputData(before, after, options?)` exactly as spec §7.

- [ ] **Step 1: LIS test from the shared fixture**

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { longestKeptOrder } from '../../../src/view/longest-kept-order';

interface LisCase { positions: number[]; kept: number[] }
const isCases = (value: unknown): value is { cases: LisCase[] } =>
  typeof value === 'object' && value !== null && Array.isArray((value as { cases?: unknown }).cases);
const raw: unknown = JSON.parse(readFileSync(resolve(__dirname, '../../fixtures/version-history/lis-cases.json'), 'utf8'));
const cases = isCases(raw) ? raw.cases : [];

describe('longestKeptOrder', () => {
  it('has fixture cases', () => {
    expect(cases.length).toBeGreaterThan(5);
  });

  it.each(cases)('keeps $kept for $positions', ({ positions, kept }) => {
    expect(longestKeptOrder(positions)).toEqual(kept);
  });
});
```

- [ ] **Step 2:** `yarn test test/unit/view/longest-kept-order.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement**

```ts
/**
 * Indexes of the longest strictly increasing run of `positions`.
 * Tie-breaks must match the C# restore planner (CollabLongestKeptOrder):
 * both run test/fixtures/version-history/lis-cases.json.
 */
export const longestKeptOrder = (positions: readonly number[]): number[] => {
  const tails: number[] = [];
  const back: Array<number | undefined> = [];

  positions.forEach((position, index) => {
    let low = 0;
    let high = tails.length;

    while (low < high) {
      const middle = (low + high) >> 1;

      if (positions[tails[middle]] >= position) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }

    back[index] = low > 0 ? tails[low - 1] : undefined;
    tails[low] = index;
  });

  const kept: number[] = [];
  let cursor: number | undefined = tails[tails.length - 1];

  while (cursor !== undefined) {
    kept.push(cursor);
    cursor = back[cursor];
  }

  return kept.reverse();
};
```

- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: diff tests** in `test/unit/view/diff-output-data.test.ts` (node env, import from `'../../../src/view'`). One `it` per behaviour, each asserting the full `OutputDataDiff`:
  1. identical docs → all four arrays empty;
  2. added block (in `after` order) and removed block (in `before` order);
  3. data change → `changed[0].fields` = `['data']`;
  4. type change and tunes change → fields `['type']`, `['tunes']`; missing `tunes` vs `{}` → no change;
  5. **HTML vs segments**: before `{ id:'p', type:'paragraph', data:{ text:'<b>hi</b>' } }`, after the same text as segments (`[{ text: 'hi', marks: { bold: true } }]`, the shape in `types/rich-text.d.ts`) → no change (Review Focus 5);
  6. custom tool `{ type:'note', data:{ body:'<b>x</b>' } }` vs segments: unchanged only with `richTextFields: t => t === 'note' ? ['body'] : []`, changed without it;
  7. swap two roots `[a,b]` → `[b,a]`: positions in after order are `[1,0]`, the rule keeps index 1 (`a`), so `moved` = `[b]`, nothing changed;
  8. parent change → moved; moved AND changed both listed;
  9. id-less blocks → added/removed, never matched; duplicate id → first wins, the later one counts as added/removed;
  10. ignored keys: `indent`, `content`, `lastEditedAt`, `lastEditedBy`, document `time`/`version`/`id` changes → empty diff;
  11. `null`/`undefined` input → treated as no blocks;
  12. `LooseOutputData` with `id: null`, `data: null` → normalized (`null` data compares as `{}`).
- [ ] **Step 6:** run → FAIL.
- [ ] **Step 7: Implement `src/view/diff-output-data.ts`.** Use `normalizeOutputBlocks` (`src/shared/output-data.ts:232`), `outputBlocksToCanonicalSegments` (`src/shared/rich-text/block-data.ts:227`), `htmlToSegmentsNode` (`src/view/rich-text-parse5.ts:39`), `CURRENT_RICH_TEXT_FIELDS` from `src/shared/rich-text/fields.ts` (the table `html-to-blocks.ts` uses; its resolver at ~1397 is local, not exported), `deepEqual` (`src/shared/deep-equal.ts`), `longestKeptOrder`. Canonicalize only for comparison; results carry normalized input blocks. Child order of a parent = flat order of blocks whose `parent` equals it (root = no parent). Moved: matched block with a different parent, or, among matched blocks sharing the same parent in both, not kept by `longestKeptOrder(currentPositions in after order)`.
- [ ] **Step 8:** run diff + LIS + purity tests → PASS. Then `yarn test test/unit/architecture/published-types-no-src-refs.test.ts test/unit/architecture/view-entry-law.test.ts`.
- [ ] **Step 9:** `npx eslint src/view/diff-output-data.ts src/view/longest-kept-order.ts test/unit/view/diff-output-data.test.ts test/unit/view/longest-kept-order.test.ts` and `npx tsc --noEmit -p tsconfig.json` (use `NODE_OPTIONS=--max-old-space-size=8192`).
- [ ] **Step 10: Commit** `feat(view): diffOutputData compares two documents by block id` with the paths above.

---

### Task 2: History store interface + local ledger + fake store

**Files:**
- Create: `packages/server/dotnet/Blok.Server/Collab/CollabLineageLedger.cs`, `packages/server/dotnet/Blok.Server.Tests/Collab/LocalCollabOperationHistoryTests.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/LocalCollabOperationStore.cs` (implement interface; ledger hooks in `ResetAsync` and `Open`; rewrite comment at ~1369-1391), `packages/server/dotnet/Blok.Server.Tests/Collab/LocalCollabOperationStoreTests.cs:134` (5 → 6 files), `packages/server/dotnet/Blok.Server.Tests/Collab/CollabRoomTestSupport.cs` (`FakeCollabOperationStore` implements the interface and keeps superseded lineages), `packages/server/dotnet/Blok.Server.Tests/CollabDurabilityArchitectureTests.cs` (register the new delete and append)

**Interfaces:**
- Consumes (already committed, Task 0): `ICollabOperationHistoryStore`, `CollabLineageInfo(string Lineage, long Epoch, int Format, DateTimeOffset? CreatedAt, bool Current)`, `CollabRecordHeader`, `CollabLineageDeleteOutcome`. Lineage strings use the same text form as `CollabDocumentHead.Lineage`.
- Internal: `CollabLineageLedger` (encode/decode entries, append, read). Entry: kind byte (1 published, 2 deleted), generation u64, generation fence u64, lineage 16 bytes, epoch i64, format i32, created-at ticks i64 (`long.MinValue` = unknown), SHA-256 of the preceding bytes truncated to 8 bytes. FIXED size, and the decoder steps by entry size, so a torn or bad entry is skipped (logged as a warning) and the next one still decodes. The semaphore guards one process only; document that two processes sharing one root are not supported (the lock file already enforces one holder for writes).

- [ ] **Step 1: Failing tests** (`LocalCollabOperationHistoryTests`, setup copied from `LocalCollabOperationStoreTests`: temp root, `OpenAsync`, `Reset`, `Candidate` helpers):
  1. three resets with appends → `ListLineagesAsync` returns 3 lineages oldest first, correct epoch/format, only the last `Current`;
  2. `ReadHeadersAsync` of an old lineage returns its sequences 1..n with actors and times; unknown lineage → empty;
  3. `ReadBaselineAsync` returns the frames passed to that reset; unknown → null;
  4. `ReadRecordsAsync(through: 2)` returns records 1..2 with update bytes; `through` past the end stops at the end;
  5. reads work while another session holds the lock and keeps appending (no fence taken);
  6. a journal with a torn tail: headers stop before it and the file length is unchanged;
  7. **never-opened-since-upgrade** (Review Focus 3): create a doc, dispose the session, delete the `lineages` file, then on a FRESH store instance (without opening) `ListLineagesAsync` → the current lineage, `CreatedAt == null`, and the `lineages` file was NOT created; a sibling test reads that lineage's headers and baseline through the same in-memory entry;
  8. backfill on open: delete `lineages`, open once → the file exists with the current generation;
  9. orphan generation: plant `journal.9.99` and `baseline.9.99` by hand in the doc directory → not listed;
  10. `DeleteLineageAsync` on an old lineage → `Deleted`, its `journal`/`baseline`/`checkpoint` files are gone, it is no longer listed; on the current → `Current`; unknown → `NotFound`; with the `purged` marker present → `Purged`;
  11. torn last ledger entry (append 5 garbage bytes) → listing ignores it;
  12. 20 concurrent `DeleteLineageAsync`/reset calls do not corrupt the ledger (every entry decodes);
  13. purge removes `lineages`;
  14. two ledger entries with the same lineage (append one by hand) → listed once, as the newer; deleting that lineage deletes the newer generation's files only;
  15. best-effort appends: make `lineages` a DIRECTORY, then reset and reopen → both succeed, and an error is logged (capture with a test logger);
  16. a bad entry in the middle (flip a byte) → skipped, logged, later entries still listed.
- [ ] **Step 2:** run `--filter "FullyQualifiedName~LocalCollabOperationHistoryTests"` → FAIL (types missing).
- [ ] **Step 3: Implement.**
  - Interface file with `///` docs stating the rules from spec §1.
  - Ledger: per-document `SemaphoreSlim` in a `ConcurrentDictionary<string, SemaphoreSlim>` on the store; appends open the file with `FileMode.Append`, write one entry, `Flush(true)`. EVERY append (reset entry, after swap, open backfill) is wrapped in try/catch that logs and continues. Skip the unseeded generation 0 everywhere.
  - `ResetAsync`: after `RequireFence()`, ensure the outgoing generation has an entry; after `journal = swapped; index.Clear()` (~1519-1520), append the new one. Nothing between `Republish` (~1499) and the swap.
  - `Open`: after `ImportWorkingSet` (~303), ensure the current generation has an entry.
  - **Durability law:** `CollabDurabilityArchitectureTests.FindTruncationViolations` flags any `Delete`/`SetLength`/`FileMode.Create` in `LocalCollabOperationStore.cs` outside its `Shortenings` list, and `TheOnlyDeleterHasOneScopedCallSite` limits `TryDelete`. Keep the lineage delete INSIDE `LocalCollabOperationStore.cs` (moving it to `CollabLineageLedger.cs` would dodge the scan silently) and add a `Shortenings` entry with its reason (never the current generation, under the semaphore, `purged` checked). Add the ledger append to `Boundaries` so its `Flush(true)` is enforced.
  - `ListLineagesAsync`: read ledger, apply `deleted` tombstones, dedupe by lineage (newest wins), add the manifest's current generation in memory if missing (`ReadManifest`, no lock), mark `Current` by matching the manifest's generation + fence.
  - Reads: resolve `(generation, fence)` from the ledger; open `journal.G.F` with `FileShare.ReadWrite | FileShare.Delete`; decode records one at a time with `CollabJournalCodec.TryDecodeRecord` over a buffer that grows on `Incomplete` until EOF (the codec's header size is private); stop at EOF on `Incomplete`; throw on `Invalid`. Baseline via `ReadBaseline(Manifest.Unseeded with { Generation = g, GenerationFence = f })`.
  - Delete: under the semaphore; `purged` marker → `Purged`; manifest current → `Current`; delete files, append tombstone.
  - Comment rewrite at ~1369-1391 per spec §2.
  - Fake store: keep a `List<FakeLineage>` per doc (baseline, records, head, created-at); `ResetAsync` pushes the old one instead of discarding it; implement the interface over that list.
- [ ] **Step 4:** run the new class + `LocalCollabOperationStoreTests` + `FakeCollabOperationStoreTests` + `CollabDurabilityArchitectureTests` → PASS (fix the file-count test to 6 with a comment naming the ledger).
- [ ] **Step 5: Commit** `feat(server): history store reads every lineage of the operation journal`.

---

### Task 3: `CollabVersionTimeline`

**Files:** Create `packages/server/dotnet/Blok.Server/Collab/CollabVersionTimeline.cs`, `packages/server/dotnet/Blok.Server.Tests/Collab/CollabVersionTimelineTests.cs`.

**Interfaces:**
- Consumes: `CollabLineageInfo`, `CollabRecordHeader` (Task 0, already committed).
- Produces: `internal sealed record CollabVersion(string Lineage, ulong Sequence, DateTimeOffset? StartedAt, DateTimeOffset? SavedAt, IReadOnlyList<string> Actors);` and `internal static IReadOnlyList<CollabVersion> CollabVersionTimeline.Group(IReadOnlyList<(CollabLineageInfo Lineage, IReadOnlyList<CollabRecordHeader> Headers)> lineagesOldestFirst)`. Constants `IdleGap = TimeSpan.FromMinutes(2)`, `MaxSpan = TimeSpan.FromMinutes(10)`.

- [ ] **Step 1: Failing tests:** baseline version per lineage (sequence 0, times = created-at, empty actors); gap exactly 2 min → same group; 2 min + 1 tick → new group; span exactly 10 min → new group at that record; negative gap → same group; actors distinct, first-seen order, nulls skipped; output newest first across lineages; a lineage with no records yields only its baseline.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement (rule in spec §3). **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(server): group journal records into versions`.

---

### Task 4: `CollabHistoryReplay`

**Files:** Create `packages/server/dotnet/Blok.Server/Collab/CollabHistoryReplay.cs`, `packages/server/dotnet/Blok.Server.Tests/Collab/CollabHistoryReplayTests.cs`.

**Interfaces:**
- Produces: `internal static async ValueTask<YDoc> CollabHistoryReplay.BuildAsync(IReadOnlyList<ReadOnlyMemory<byte>> baseline, IAsyncEnumerable<CollabOperationRecord> records, CancellationToken ct)` — fresh `new YDoc()`, each update through `UpdateInspector.Inspect` then `doc.ApplyUpdate` (mirror `CollabRoom.ApplyRemoteLocked`, `CollabRoom.cs:2217-2241`); an inspector refusal throws `CollabHistoryReplayException` (internal) naming the sequence.

- [ ] **Step 1: Failing tests:**
  1. **prefix equals live** (no room; the `CollabRoomTests` helpers are private and plain-text): seed a doc with `YDocConverter` (as `YDocConverterEditTests` does), take its full state as the baseline, then apply 4 edit requests with `ApplyOpsAsync`, capturing each emitted update (subscribe to the doc's update event as `YDocConverterEditTests` does) as records 1..4 and `YDocConverter`'s export after each as the live snapshot. For N = 0..4 replay baseline + records 1..N and export; blocks equal the snapshot at N;
  2. parked dependency: a second plain doc client A types "a" (update u1) then "b" (u2, which depends on u1). Records are [u2, u1] in that order. Replay to 1 → text lacks "b" (u2 is parked, no error); replay to 2 → text is "ab";
  3. format-1 lineage: baseline holding a plain `YText("<b>x</b>")` paragraph (see `CollabDocConverterTests.cs:131` for the doc shape) → replay + `ExportAsync` gives bold segments;
  4. a record the inspector refuses (nesting deeper than 256) → `CollabHistoryReplayException`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(server): replay a journal point into a document`.

---

### Task 5: C# longest kept order

**Files:** Create `packages/server/dotnet/Blok.Server/Collab/CollabLongestKeptOrder.cs`, `packages/server/dotnet/Blok.Server.Tests/Collab/CollabLongestKeptOrderTests.cs`; modify `Blok.Server.Tests.csproj` to copy the fixture:

```xml
<None Include="../../../../test/fixtures/version-history/lis-cases.json"
      Link="Fixtures/lis-cases.json"
      CopyToOutputDirectory="PreserveNewest" />
```

**Interfaces:** Produces `internal static int[] CollabLongestKeptOrder.Of(IReadOnlyList<int> positions)` — same algorithm and tie-break as the TS `longestKeptOrder` in Task 1 (strict increase; replace the first tail whose position is `>=`; rebuild from the last tail).

- [ ] **Step 1:** test reads `Fixtures/lis-cases.json` from `AppContext.BaseDirectory` (see how `tickets.json` is read in the existing tests) and asserts every case; plus an assertion that there are more than 5 cases.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(server): longest kept order shared with the client diff`.

---

### Task 6: `CollabRestorePlanner`

**Files:** Create `packages/server/dotnet/Blok.Server/Collab/CollabRestorePlanner.cs`, `packages/server/dotnet/Blok.Server.Tests/Collab/CollabRestorePlannerTests.cs`; modify `packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs` (add an internal read-only structure describer).

**Interfaces:**
- Consumes: `CollabLongestKeptOrder.Of` (Task 5), `CollabEditOp.Insert/Update/Remove` (`CollabEditOps.cs:18-42`).
- Produces:
  - `internal sealed record CollabDocStructure(IReadOnlyDictionary<string, CollabKeyShape> Keys, IReadOnlyList<string> RootOrder, IReadOnlySet<string> ReachedInMainPass);` and `internal sealed record CollabKeyShape(bool IsBlock, string? StoredParent, IReadOnlyList<string>? ListedChildren);` built by `internal static CollabDocStructure YDocConverter.DescribeStructure(YDoc doc)` — reads the blocks map and root order the same way export does (`DeriveOrderedIds`/`ProjectHierarchy`, ~2836-3290) and records which ids the main pass (from the root order) reached.
  - `internal static IReadOnlyList<CollabEditOp> CollabRestorePlanner.Plan(JsonArray currentBlocks, CollabDocStructure current, JsonArray targetBlocks)` — algorithm exactly spec §5 steps 1-6.
  - `internal static JsonArray CollabRestorePlanner.NormalizeTarget(JsonArray targetBlocks)`.

- [ ] **Step 1: Failing tests.** Helper: build a doc from blocks (`YDocConverter` seed path used by `YDocConverterEditTests`), export it as `current`, plan against a `target`, apply the ops with `ApplyOpsAsync`, export again, and assert the blocks equal `NormalizeTarget(target)` ignoring `lastEditedAt`/`lastEditedBy`. Cases (spec Testing list): swap roots; **move a block with children to another parent (children kept)** (Review Focus 1); move a parent whose children stay; delete a parent whose child moves to root (grandchild kept); type change on a block with children; tunes change; data change of a moved block; orphan child its parent does not list; root block missing from the root order; dangling parent in target (→ root); non-block key whose id the target uses; parent without a children list gets a child; identical docs → empty plan; data-only change → exactly one `Update`; re-inserted blocks carry the target's `lastEditedAt`/`lastEditedBy` (assert those keys in this one test).
- [ ] **Step 2:** FAIL. **Step 3:** implement `DescribeStructure`, then the planner. Data comparison: canonical JSON with object keys sorted recursively. **Step 4:** PASS; also run `YDocConverterEditTests` to prove nothing else moved.
- [ ] **Step 5: Commit** `feat(server): plan a restore as block edits`.

---

### Task 7: Room + manager

**Files:** Modify `packages/server/dotnet/Blok.Server/Collab/CollabRoom.cs` (ops-factory overload of `EditAsync`, size gate), `packages/server/dotnet/Blok.Server/Collab/CollabRoomManager.cs` (history methods); create `packages/server/dotnet/Blok.Server.Tests/Collab/CollabHistoryManagerTests.cs`.

**Interfaces:**
- Consumes: Tasks 2, 3, 4, 6.
- Produces (internal, on `CollabRoomManager`):
  - `ValueTask<CollabHistoryListResult> HistoryAsync(string docId, CancellationToken ct)` → `(Status, IReadOnlyList<CollabLineageInfo> Lineages, IReadOnlyList<CollabVersion> Versions)`
  - `ValueTask<CollabHistoryReadResult> ReadVersionAsync(string docId, string lineage, ulong sequence, CancellationToken ct)` → `(Status, byte[] Json, DateTimeOffset? Time)`
  - `ValueTask<(CollabHistoryStatus Status, CollabLineageDeleteOutcome? Outcome)> DeleteLineageAsync(string docId, string lineage, CancellationToken ct)`
  - `ValueTask<CollabRestoreResult> RestoreAsync(string docId, string lineage, ulong sequence, string operationId, string? actorId, CollabEditPrecondition? expect, CancellationToken ct)` with `internal sealed record CollabRestoreResult(CollabHistoryStatus History, CollabEditResult? Edit)` (`Edit` set only when `History == Ready`). Do NOT add members to `CollabEditStatus`.
  - `enum CollabHistoryStatus { Ready, NoHistory, NotFound, Purged, Unavailable, ExportFailed, Corrupt }`
- `CollabRoom.EditAsync(Func<YDoc, CancellationToken, ValueTask<IReadOnlyList<CollabEditOp>>> planOps, string operationId, ReadOnlyMemory<byte> digest, string? actorId, CollabEditPrecondition? expect, CancellationToken ct)`; the existing signature delegates with `(_, _) => ValueTask.FromResult(ops)`. Async because planning calls `converter.ExportAsync` (custom rich fields live there; `YDocConverter.Export` alone would plan spurious updates on hosts with custom fields).
- Tests use the real converter: `new CollabDocConverter(time, RichTextRuntime.Reader)` with `FakeDocEndpoint.HoldsDocument` (the `CollabRoomTests` helpers are private and plain-text).

- [ ] **Step 1: Failing tests:**
  1. no history store → `NoHistory` from all four methods;
  2. list after two resets and edits → lineages + versions as the timeline groups them;
  3. read point N → JSON blocks equal the export at N, `time` = record N's time; point 0 of a lineage with unknown created-at → no `time` key; sequence past head → `NotFound`; unknown lineage → `NotFound`; purged doc → `Purged`; a corrupt record (flip a byte through the fake store) → `Corrupt`; restore of an unknown point → `History == NotFound`;
  4. **restore end-to-end**: edits A→B→C, restore the point after A → `/state`-equivalent blocks equal point-A blocks (ignoring edit stamps), result `Applied` with a new sequence, journal record source `HttpEdit` with the actor;
  5. **retry** (Review Focus 4): same operation id twice → second returns `Applied` with the first sequence;
  6. stale `expect` → `PreconditionFailed`;
  7. **oversized** (Review Focus 2): options `AnnouncedMaxMessageBytes = 2048`, a joined member, restore a point whose plan inserts ~8 KB → `Edit.Status == TooLarge`, no new committed record in the fake store, no `SyncUpdateFrame` in the member's received frames, export unchanged; and a borderline plan just under the limit is applied;
  8. restore to the current point → `Applied`, no new journal record;
  9. delete current → `Current`; delete old → `Deleted`;
  10. the existing `/edit` path still passes: run `CollabRoomTests` filtered to `Edit`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. Size gate inside the factory path: before applying to the live doc, build a scratch doc with the live doc's client id (`new YDoc(doc.ClientId)` or the matching ctor) + `ApplyUpdate(doc.EncodeStateAsUpdate())`, record the live state vector, apply the ops to the scratch doc with `ApplyOpsAsync` (capture updates on the scratch doc the way `resetDoc` does near `CollabRoom.cs:1990`, so nothing reaches `localUpdates`), then measure `SyncWire.Encode(new SyncUpdateFrame(scratch.EncodeStateAsUpdate(liveStateVector))).Length` (the frame the room broadcasts, `CollabRoom.cs:2204`) against `options.AnnouncedMaxMessageBytes ?? (1 << 20)`; over → `TooLarge` before touching the live doc. Digest for restore: SHA-256 of UTF-8 `"restore\n{lineage}\n{sequence}"`. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(server): list, read, delete and restore versions in the room manager`.

---

### Task 8: HTTP routes

**Files:** Create `packages/server/dotnet/Blok.Server.AspNetCore/Collab/HistoryEndpoint.cs`, `packages/server/dotnet/Blok.Server.AspNetCore.Tests/Collab/HistoryEndpointTests.cs`; modify `packages/server/dotnet/Blok.Server.AspNetCore/BlokServerEndpointRouteBuilderExtensions.cs`.

**Interfaces:** Consumes Task 7 manager methods; reuses `CollabEditOps.TryNormalizeIdempotencyKey`, `EditEndpoint.TryParseEntityTag` (make it `internal`), `EditEndpoint.WriteHead`/`EntityTag`, `SyncEndpoint.RouteDoc/IsSingleSegment/RefuseAsync/RefuseRetryLaterAsync`, `SyncHandshake.DeriveActor`. Authorization: copy `ResetEndpoint.cs:28-47` (doc-claim check, then `IBlokAuthorization`); GET routes require `CanReadDocumentAsync`, DELETE and restore require both `CanReadDocumentAsync` and `CanWriteDocumentAsync` (the guard checks only ticket validity and `claims.Write`; with auth `none` it checks nothing).

- [ ] **Step 1: Failing tests** (pattern: `StateEndpointTests.cs`), one per row/status in spec §6: list 200 JSON shape; read 200 with `Blok-History-*` headers and no ETag; read 404 unknown lineage / past head; read 400 non-numeric sequence; delete 204/404/409; delete without write ticket → 403; restore 204 with `Blok-Doc-*` head; restore missing idempotency key → 400; restore 404 (unknown lineage, sequence past head); restore 409 (same key, different point); restore 412; restore 413; restore 501; 501 on all four without journal; 403 purged (read, delete, restore); read 503 with `Retry-After` on a converter transient failure; read 500 on a corrupt record, logged at Error; ticket for another doc → 403 on all four; an `IBlokAuthorization` that denies read → 403 on delete and restore even with write allowed; after restore, `GET /state` blocks equal the version's blocks; `Cache-Control: no-store` on all; a cross-origin read with an allowed origin exposes `Blok-History-Lineage`/`Blok-History-Sequence` in `Access-Control-Expose-Headers`; `Allow` on 405 lists the right methods (`DELETE, OPTIONS` for the delete route, no `HEAD` for the new GET routes); a DELETE preflight succeeds; startup warning lists the new routes.
- [ ] **Step 2:** FAIL. **Step 3:** implement `HistoryEndpoint` (four handlers) and map in `MapShell`: explicit arm per pattern (its default arm is the upload-by-url handler); `Guard(handler, requireWrite: method != "GET")`; per-route `Allow` (today non-GET routes are hard-coded `"OPTIONS, POST"`); add a `WriteHistoryHead` that sets the two history headers and merges them into `Access-Control-Expose-Headers` like `EditEndpoint.WriteHead`; change `LogOpenSyncRoutes` to one `{Routes}` parameter joined from the route list (`LoggerMessage.Define` stops at 6 type arguments; `SyncEndpointTests.cs:107` uses `Contains`, so it still passes). **Step 4:** PASS; also run `StateEndpointTests` and `EditEndpointTests`.
- [ ] **Step 5: Commit** `feat(server): history routes for versions`.

---

### Task 9: Docs

**Files:** `packages/server/README.md` (routes table ~285-296 + a short "Version history" section), `packages/server/protocol/blok-sync-v2.md` (HTTP section ~825-912), `docs/src/components/server/server-data.ts` (new `serverLimits` entry `collab-version-history`), `docs/src/components/server/server-data.test.ts` (pinned id list + count), `docs/src/components/api/api-data.ts` (`diffOutputData(before, after)` after `restoreHeadingAnchors(data)` in `view-api`, with example), `docs/src/components/api/api-data.view.test.ts` (method list), `docs/src/i18n/en.json`, `docs/src/i18n/ru.json`, `docs/src/seo/lastmod-ledger.json`.

- [ ] **Step 1:** update the two docs tests first (ids/method list) → run `cd docs && yarn vitest run src/components/server/server-data.test.ts src/components/api/api-data.view.test.ts` → FAIL.
- [ ] **Step 2:** write the content. Reference-prose law (`docs/CLAUDE.md`): Prose grammar only, sentences < 34 words, no dash joins, same block shape in en and ru. Content: what a point is, the four routes, statuses, "hosts store points", "history starts at this release", trimming = reset then delete, `501` without the journal.
- [ ] **Step 3:** run those tests + `src/i18n/reference-prose.test.ts` + `src/components/api/api-data.ru-coverage.test.ts` → PASS.
- [ ] **Step 4:** `node docs/scripts/update-lastmod-ledger.mjs`, run `src/seo/lastmod-ledger.test.ts` → PASS.
- [ ] **Step 5: Commit** `docs: version history routes and diffOutputData`.

---

## Final gate (after Task 9)

- `dotnet test packages/server/dotnet/Blok.Server.Tests --filter "FullyQualifiedName~Collab"` and `dotnet test packages/server/dotnet/Blok.Server.AspNetCore.Tests --filter "FullyQualifiedName~Collab"`.
- `yarn test test/unit/view test/unit/architecture/published-types-no-src-refs.test.ts test/unit/architecture/view-entry-law.test.ts`.
- Scoped eslint on changed TS files; `tsc --noEmit`.
- Whole-branch review by a fresh reviewer.
- Merge `feat/version-history` into `main`, push (trunk-based), remove the worktree per CLAUDE.md.
