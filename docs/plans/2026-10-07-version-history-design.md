# Version history — design

Date: 2026-10-07. Research: `docs/plans/2026-10-07-version-history-research.md` (main checkout, gitignored). Revision 2, after three adversarial reviews (server code, restore algorithm, client).

## Goal

Hosts can list past versions of a collaborative document, read any one, compare two, restore one, and delete old history. Blok ships the data and the operations. The host builds the UI.

## Decisions (USER, 2026-10-07)

1. Blok ships data, routes, diff and restore. The host builds the history UI.
2. Hosts without the operation journal get only the full-document save. No history for them.
3. History reaches past resets and the format 1→2 migration.
4. The host deletes history. Blok has no retention policy.

## Non-goals

- No history panel, no named versions, no retention timer in Blok. A host that names versions stores `(lineage, sequence)` pairs itself.
- No history for the working-set store (journal off) or the S3 prefix.
- No `tunes` field on the `/edit` `update` op. Restore re-inserts a block whose tunes changed.
- No pruning inside one lineage. To trim, the host resets the document (`POST /sync/{doc}/reset`), then deletes the old lineage.
- Generations a local journal wrote before this release are not listed. Their lineage, epoch and format were never stored on disk, and after any open the manifest names only the current one (`LocalCollabOperationStore.cs:287-292` republishes on open). The built-in journal is reachable from a shipped config only since v1.16.0. History starts with the generation current when this release first touches a document.
- No CHANGELOG edit. Changelog entries are written at release time; the release note is owed.

## Concepts

- **Lineage**: one unbroken run of journal records. A reset, a first seed or the format migration starts a new one. It has a baseline (sequence 0) and records 1, 2, 3…
- **Point**: `(lineage, sequence)`, from 0 to the lineage's durable head. A point is the stable address of a version.
- **Version list**: points grouped by time for display. The newest group grows while edits arrive. Hosts store points, never list positions.

## 1. Store: `ICollabOperationHistoryStore` (new, public, optional)

File: `packages/server/dotnet/Blok.Server/Collab/ICollabOperationHistoryStore.cs`.

```csharp
public interface ICollabOperationHistoryStore
{
  // Every lineage still held for the document, oldest first.
  ValueTask<IReadOnlyList<CollabLineageInfo>> ListLineagesAsync(string documentId, CancellationToken ct = default);

  // The lineage's baseline frames. Null when the lineage is unknown.
  ValueTask<IReadOnlyList<ReadOnlyMemory<byte>>?> ReadBaselineAsync(string documentId, string lineage, CancellationToken ct = default);

  // Record headers in sequence order, without update bytes. Empty for an unknown lineage.
  IAsyncEnumerable<CollabRecordHeader> ReadHeadersAsync(string documentId, string lineage, CancellationToken ct = default);

  // Records 1..through in sequence order. Stops early if the lineage holds fewer.
  IAsyncEnumerable<CollabOperationRecord> ReadRecordsAsync(string documentId, string lineage, ulong through, CancellationToken ct = default);

  // Deletes a lineage that is not current.
  ValueTask<CollabLineageDeleteOutcome> DeleteLineageAsync(string documentId, string lineage, CancellationToken ct = default);
}

public sealed record CollabLineageInfo(string Lineage, ulong Epoch, int Format, DateTimeOffset? CreatedAt, bool Current);
public sealed record CollabRecordHeader(ulong ServerSequence, DateTimeOffset CommittedAt, string? ActorId);
public enum CollabLineageDeleteOutcome { Deleted, NotFound, Current, Purged }
```

Rules:
- **Optional.** Found by a type check on the registered `ICollabOperationStore`. A store without it keeps working; only the history routes answer `501`. (Purge, by contrast, throws `NotSupportedException` when a purge is requested, `CollabRoomManager.cs:483-489`.)
- **No fence, no document lock for reads.** A live room keeps writing while history is read.
- **Reads come from the store's durable records.** A record is durable before it is acknowledged (`ICollabOperationStore.cs:318-324`), and the next holder adopts every complete record, so the store's complete records are the truth. No room-head cap.
- **Streaming.** Headers and records are enumerated, so listing never holds update bytes and a read holds one record at a time.
- **Lineage ids are unique in the list.** If two entries ever share a lineage (the adopt path reuses a stored working-set lineage, `CollabRoom.cs:1932-1952`), the newest wins and older ones are hidden.
- `ICollabOperationStore` does not change.

## 2. Local store: lineage ledger

`LocalCollabOperationStore` implements the interface.

- New file `lineages` in the document's `.journal` directory. Append-only entries, each with its own checksum: kind (`published` / `deleted`), generation, generation fence, lineage (16 bytes), epoch, format, created-at (UTC ticks or "unknown"). A torn or bad entry is skipped and logged.
- Entries are keyed by `(generation, fence)`, which names the files exactly. Orphans from failed resets are never listed. Listing reads the ledger; it never globs.
- **One writer at a time.** A per-document `SemaphoreSlim` inside the store guards every ledger append and every delete.
- **Reset.** At the start of `ResetAsync`, append the outgoing generation if it has no entry. After the journal swap (`journal = swapped; index.Clear()`), append the new generation. Never between `Republish` and the swap: that gap must not throw (`:1468-1472`). Ledger appends are best-effort: a failure is logged and the reset still succeeds.
- **Open.** After `ImportWorkingSet` (`:302-305`), append the current generation if it has no entry.
- **List without opening.** If the ledger lacks the manifest's current generation, `ListLineagesAsync` adds it in memory from `ReadManifest` (static, no lock), created-at unknown. So a document never opened since the upgrade still shows its current lineage.
- **Reads.** `journal.G.F` is opened read-only with `FileShare.ReadWrite | FileShare.Delete` and decoded one record at a time with `CollabJournalCodec.TryDecodeRecord`, stopping at a torn tail without truncating. The baseline is read with the existing sealed reader (`ReadSealed` + `TryDecodeFrames`).
- **Delete.** Under the semaphore: refuse if the `purged` marker exists (`Purged`), refuse the manifest's current lineage (`Current`), else delete `journal.G.F`, `baseline.G.F` and every `checkpoint.G.*`, then append a `deleted` entry. Deleting generation N-1 gives up the older-manifest-slot fallback for it; that only matters after media corruption. Documented.
- `PurgeAsync` already deletes everything but `lock` and `purged`, ledger included.
- Rewrite the stale comment at `:1369-1391`: shipped configs reach this store (`CollabOperationStoreSource.cs:26-27`); superseded generations are history and must not be collected; stale checkpoints of other fences are still a leak.
- Update `LocalCollabOperationStoreTests.cs:134`, which counts 5 files after a reset (now 6).

## 3. Version grouping

Internal pure `CollabVersionTimeline`.

- One version per lineage baseline: sequence 0, time = created-at (may be null).
- Records are walked in sequence order. Let `t` be a record's time, `prev` the previous record's, `start` the current group's first. A new group starts when `t − prev > 2 min` or `t − start ≥ 10 min`. A negative gap counts as 0 (the store clock is wall time).
- A group's version: `sequence` = its last record, `startedAt`/`savedAt` = first/last time, `actors` = distinct non-null `ActorId`s in first-seen order.
- Output newest first: lineages newest first (ledger order reversed), versions within a lineage newest first.
- Known limit: a record whose Yjs dependency arrived later shows its text at the later record, so the author can be credited to a later group.

## 4. Reading a point

Internal `CollabHistoryReplay`: a fresh `YDoc`, apply the baseline frames, then records 1..N, each through `UpdateInspector.Inspect` (stateless, depth limit only) and `ApplyUpdate`. Then `ICollabDocConverter.ExportAsync`, which reads format-1 HTML as segments (`CollabDocConverterTests.cs:131`). The answer's `time` is replaced by the point's time (record N's `CommittedAt`, or the lineage created-at for 0), and omitted when unknown. Export stamps the export time otherwise (`CollabDocConverter.cs:121-125`).

## 5. Restore

Restore runs **inside the room's lane**, against the live document, through the same path as `/edit`.

- `CollabRoom.EditAsync` gains an overload that takes an ops factory `Func<YDoc, IReadOnlyList<CollabEditOp>>` instead of a fixed op list. It runs the duplicate check, then the precondition check, then calls the factory with the live doc, then continues as today. The existing `/edit` path passes a factory that returns its parsed ops.
- The manager first replays the target point (section 4) outside the lane. The factory then plans against the live doc.
- **Digest.** The idempotency digest hashes the request (`restore`, lineage, sequence), never the planned ops. A retry with the same key gets the first receipt. An empty plan is a no-op answered `Applied` at the current head.
- **Size gate.** Before touching the live doc, the factory's ops are applied to a scratch copy (`new YDoc` + the live state) and the produced update is measured. The limit is the size of the sync frame that would carry the update to peers, against `CollabRoomOptions.AnnouncedMaxMessageBytes`, or 1 MiB when unset (the local store's default append limit, `LocalCollabOperationStore.cs:94`; the room does not know a custom store's own limit). Over it → `TooLarge`, nothing changes. Without this gate an oversized update fails the commit and closes the room for every member (`CollabRoom.cs:2720-2726`, `:2801-2805`).
- `If-Match` is checked as for `/edit`. Without it there is no race: planning happens under the lane.

### Planner: `CollabRestorePlanner`

Inputs, read from the live doc: the export (blocks with parent, data, tunes, edit stamps) and the raw structure (every key in the blocks map; whether it is a valid block; its stored `parentId`; its listed children; the root order; which blocks the export reached in its main pass). Target: the replayed export.

1. **Normalize the target.** A `parent` that names no target block becomes root, keeping export order. Restore reproduces `normalize(target)`.
2. **Anchorable current blocks.** A current block may stay only if it is a valid block, the export reached it in its main pass, its stored `parentId` equals its exported parent, and its parent (or the root order) lists it.
3. **Stay set.** For each target parent: take the anchorable current blocks that have the same parent in both, in target order, and keep the longest run whose current positions increase (the LIS rule below). Blocks whose `type` or `tunes` changed cannot stay. A target parent whose current block has no children list cannot stay (insert refuses such a parent).
4. **Removals.** Mark: current keys not in the target; non-block keys whose id the target uses; present blocks that do not stay. Compute the removal closure by following stored `parentId` over every key, as `PlanRemove` does. Remove every id in the stay set that the closure covers. Emit `remove` only for marked ids not already taken by an earlier remove.
5. **Updates.** For each staying block whose `data` differs (compared in canonical JSON, keys sorted), emit `update`.
6. **Inserts.** Every target block not staying, in target pre-order: `parent` = target parent, `after` = previous sibling in target order. The block carries `type`, `data`, `tunes`, `lastEditedAt`, `lastEditedBy` (all accepted by insert, `CollabEditOps.cs:268-276`).

### LIS rule (shared with the client diff)

Positions `p[0..n)` in target order. Standard patience method: `tails` holds, for each length, the index of the smallest last position; each new `p[i]` replaces the first tail whose position is `≥ p[i]` (strict increase), with a back-link to the tail before it. The kept run is rebuilt from the last tail. C# and TS implement exactly this, and both test suites run the shared fixture file `test/fixtures/version-history/lis-cases.json` (positions in, kept indexes out).

## 6. HTTP routes

All behind the existing guard and the ticket doc-claim check.

| Route | Gate | Answer |
|---|---|---|
| `GET /sync/{doc}/history` | read | `200 { lineages, versions }` |
| `GET /sync/{doc}/history/{lineage}/{sequence}` | read | `200 { time?, blocks }`, headers `Blok-History-Lineage`, `Blok-History-Sequence`. No ETag. |
| `DELETE /sync/{doc}/history/{lineage}` | read + write | `204`; `404` unknown; `409` current |
| `POST /sync/{doc}/history/{lineage}/{sequence}/restore` | read + write | as `/edit`: `204` with the new head (`Blok-Doc-Lineage`/`Blok-Doc-Sequence`), `412`, `409`, `413`, `503`… Needs `Blok-Idempotency-Key`; optional `If-Match`. |

- History headers are deliberately not `Blok-Doc-*`: those name the live head and feed `If-Match`.
- No journal, or a store without the interface: `501 history needs a journal that keeps it`.
- Unknown lineage, or a sequence past the durable head: `404`. A sequence that is not a `ulong`: `400`.
- Purged document: `403`, as `/state`. Converter transient failure: `503` with `Retry-After`, as `/state`. Replay refused by the inspector or a corrupt record: `500`, logged.
- `Cache-Control: no-store` everywhere. Times are Unix milliseconds; unknown times are `null`.
- `MapShell` (`BlokServerEndpointRouteBuilderExtensions.cs:135-157`) gets an explicit arm per new pattern (its default arm is the upload-by-url handler), requires write for every non-GET method, advertises `Allow` per route without `HEAD` on the new GET routes, and the new routes join `WarnOpenSyncRoutes`.
- List JSON:
  ```json
  { "lineages": [{ "lineage": "…", "epoch": 2, "format": 2, "createdAt": 1760000000000, "current": true }],
    "versions": [{ "lineage": "…", "sequence": 41, "startedAt": 1760000000000, "savedAt": 1760000300000, "actors": ["u1"] }] }
  ```

## 7. Client: `diffOutputData` in `@bloklabs/core/view`

`src/view/diff-output-data.ts`, declared in `types/view.d.ts`. Sync, DOM-free.

```ts
export interface OutputBlockChange { id: string; before: OutputBlockData; after: OutputBlockData; fields: Array<'type' | 'data' | 'tunes'> }
export interface OutputBlockMove { id: string; before: OutputBlockData; after: OutputBlockData }
export interface OutputDataDiff { added: OutputBlockData[]; removed: OutputBlockData[]; changed: OutputBlockChange[]; moved: OutputBlockMove[] }
export interface DiffOutputDataOptions { richTextFields?: (type: string) => string[] }
export declare function diffOutputData(before: OutputData | LooseOutputData | null | undefined, after: OutputData | LooseOutputData | null | undefined, options?: DiffOutputDataOptions): OutputDataDiff;
```

- Inputs go through `normalizeOutputBlocks` (`src/shared/output-data.ts:232`). Results carry the normalized blocks, never the canonical copies.
- Matched by `id`. A block without an id is never matched. With duplicate ids the first wins; later duplicates count as id-less.
- **Moved**: a different parent, or not in the LIS-rule run of its parent's children (child order = flat order of blocks with that parent). Same rule and fixtures as the planner. A block can be moved and changed.
- **Changed**: `fields` lists `type`, `data`, `tunes` that differ. `data` is compared after canonicalizing rich text (`outputBlocksToCanonicalSegments` with `htmlToSegmentsNode`). Rich-text fields come from `options.richTextFields`, else the built-in current-field table (the one `html-to-blocks.ts` uses, not the legacy table). Fields of unknown tools are compared raw. Missing `tunes` equals `{}`.
- Ignored: `indent`, `content`, `lastEditedAt`, `lastEditedBy`, document `id`/`time`/`version`.
- Order: `added` and `changed`/`moved` in `after` order, `removed` in `before` order.

## Testing

- Store: ledger on reset, backfill on open, in-memory current for never-opened docs, orphans hidden, list/headers/read/delete over 3 lineages, delete refuses current and purged, torn ledger tail, concurrent ledger appends, purge removes the ledger, updated file-count test. `FakeCollabOperationStore` gains the interface and keeps superseded lineages.
- Timeline: exact 2 min gap (same group), just over (new group), exact 10 min span (new group), negative gap, actors, order.
- Replay: every prefix of a real room's journal equals the live export at that sequence; a format-1 lineage replays and exports.
- Planner (each a request applied to a real doc, then export compared to `normalize(target)`): swap roots; move with children; move parent whose children stay; delete parent whose child moves; type change with children; tunes change; data change of a moved block; orphan child not listed; root missing from root order; dangling target parent; non-block key whose id the target uses; parent without a children list. Plus the shared LIS fixtures.
- Routes: every status in section 6; after restore `/state` blocks equal the version's blocks (ignoring edit stamps); stale `If-Match` → `412`; retried restore → first receipt; oversized restore → `413` and the room stays open.
- Client: diff cases, HTML vs segments equality, custom resolver, duplicate ids, order, shared LIS fixtures, node-env purity, docs list test.

## Surface and compatibility

Additions only: a public interface, records and enum; four routes; one `view` function and its types. `ICollabOperationStore`, the `/edit` wire and saved data do not change. Not BREAKING.

## Docs

- `packages/server/README.md` routes table and prose; `packages/server/protocol/blok-sync-v2.md` HTTP section.
- Docs site: a new `serverLimits` entry `collab-version-history` in `docs/src/components/server/server-data.ts` (update the pinned id list in `server-data.test.ts` and its count), `diffOutputData` in the `view-api` section of `api-data.ts` (after `restoreHeadingAnchors`, update `api-data.view.test.ts`), `en.json` and `ru.json` keys, reference-prose law, then `node docs/scripts/update-lastmod-ledger.mjs`.
