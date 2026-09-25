# Migrating Blok to Notion's block model — research

Date: 2026-09-24. Six read-only research agents; nothing edited. Every claim cites file:line; "unverified" marks the rest.

## Target model (Notion)

- Blocks live in an id-keyed map. Order lives ONLY in each parent's `content`. `parent` is an upward pointer (Notion uses it for permissions).
- Positions are sibling-relative (`listAfter`/`listBefore` with a sibling id; public API `start | end | after_block`). No global index.
- A move is one transaction: remove from old `content`, set `parent_id`, insert into new `content`.

## Key finding: Blok is already half-migrated

| Layer | Model today | Evidence |
|---|---|---|
| Yjs document | **Notion-shaped** since schema v2 (ecf404d8, v1.13.0): `Y.Map('blocks')` + `Y.Array('root')` + per-block `contentIds`; flat order derived by DFS; `applyPlacement {parentId, afterId}` | `yjs/document-store.ts:101-154, 494-596, 778-822` |
| .NET server | **Notion-shaped**, lockstep port; ops are Insert(parent, after)/Update/Remove | `YDocConverter.cs:77-78, 389-393, 565-705` |
| Undo | **Placement-based**, no flat indexes | `yjs/types.ts:122-149`, `undo-history.ts:620-641` |
| Adapters (React/Vue/Angular) | **Sibling API** (`InsertSpec.position`, `MoveTarget {before/after}`), translated to indexes underneath | `blocks-tree.ts:33-110, 443-521` |
| `BlockAPI.insertChild` | Sibling API (`'start'|'end'|{before}|{after}`) | `types/api/block.d.ts:9,198` |
| **Editor core (memory)** | **Flat array is the truth.** `Block.contentIds` is DERIVED from flat order | `hierarchy.ts:145-175, 494-499`; `saver.ts:270-296`; `hierarchy-invariant.ts:322-330` |
| Saved JSON | Flat array, depth-first; roots ordered by array only | `renderer.ts:38-99`; `saver.ts` |
| /view, markdown, plain text | Order siblings by ARRAY order, not `content` | `view/document-model.ts:412-424`; `markdown/blocks-to-markdown-core.ts:932-960` |
| Public `Blocks` API + events | Index-based | `types/api/blocks.d.ts:97-283`; `types/events/block/*.ts` |

So the job is not "move to Notion's model" but "invert the direction of derivation in the editor core": today `contentIds ← flat array`; target `flat array ← root order + contentIds`. `yjs-sync.ts` currently translates flat indexes ↔ placements in both directions (`yjs-sync.ts:1221-1300, 1959-1985`; `document-store.ts:1211-1237`).

The Yjs doc is filled on every load, collab or not: `blockManager.ts:621-626` calls `YjsManager.fromJSON` unless `skipYjsSync`.

### Two names, two objects

- `Y.Array contentIds` in the Yjs doc: already the source of child order.
- `Block.contentIds` in memory: a cache derived from flat order.
- Public reads disagree too: `blocks.getChildren` orders by flat array (`api/blocks.ts:159-165`), `BlockAPI.contentIds` returns the stored list (`block/api.ts:207`).

### Open inconsistency (pre-existing)

`document-store.ts:970-971` says table cell blocks "name the table as parent while deliberately living outside its `contentIds`". In memory, `setBlockParent` adds them to the table's `contentIds` (`hierarchy.ts:494-499`; called from `table-cell-blocks.ts:784, 846, 1067`). Whether the Yjs side really keeps them out is **unverified**. If it does, memory and doc disagree today; a content-is-truth model would push cells into the orphan tail.

## What changes, by area

### Core editor (largest)
- 578 non-comment index-API lines across 42 files outside `tools/`.
- Three kinds: document-order walks (derivable), index arithmetic `i±1` (derivable, but each is a rewrite), stored indexes (must become block refs anyway).
- Stored indexes: `_currentBlockIndex` (`blockManager.ts:256`), `navigationFocusIndex` (`blockSelection.ts:68`), `stackOfSelected` (`rectangleSelection.ts:108`).
- Nothing internal truly needs a stored global order; only published contracts do.
- Riskiest: `blocks.ts` DOM anchoring by neighbour-guessing (`:208-360`), `yjs-sync.ts`, `hierarchy.ts` live-array splicing (`:208-285`), `DropTargetDetector`/`DragOperations`, `caret.ts`/`keyboardNavigation.ts`.
- `getBlockById` is `array.find` (`repository.ts:111`), 162 call sites. No id map.

### Saved format
- Option A (recommended, NOT breaking): roots keep array order; children ordered by `content`; keep emitting depth-first arrays.
- Option B (root `content` field) and C (page block) are BREAKING: `blokDocumentSchema` has `additionalProperties: false` (`view/document-schema.ts:28-29, 45`).
- Keep today's tolerance for children missing from `content` (append). Notion's "not listed = invisible" would hide content in stored documents.
- Non-breaking fixes: saver builds `content` from live `contentIds`; `validateFlatOrder` uses `contentIds`; /view + markdown order children by `content` first. Today a hand-written doc whose `content` order differs from array order renders differently in the editor vs /view.

### Public API
- Every index method shipped in v1.15.2 (`git diff v1.15.2..HEAD` empty for `types/api`, `types/events`). Changing signatures = BREAKING.
- 94856fd5 ("index implies parent") is NOT released (`git tag --contains` empty).
- Additive route: new `insertAt(tool, data, {parentId, position})` / `moveTo(id, {parentId, position})` with `Position = 'start'|'end'|{before}|{after}`; index methods become `@deprecated` shims (derive `(parent, position)` via `parentImpliedByIndex`, `block-insertion.ts:697-791`); events gain `parentId`/`previousSiblingId`/`oldParentId`.
- Read views `getBlockByIndex`/`getBlockIndex`/`getBlocksCount`/`getCurrentBlockIndex` can stay as DFS views forever.
- Adapters then delete `resolveInsertIndex`/`resolveMoveIndex` and the post-hoc `setBlockParent` patch (`blocks-api.ts:626-702, ~850`).
- Unverified risk: adapter "move by index, then setBlockParent" may now relocate twice after 94856fd5.
- `splitBlock(..., currentIndex + 1)` in 3 tools lands before the block's children; `{after: id}` skips the subtree, so a split of a block with children needs `{parentId: id, position: 'start'}`.

### Collab / server / undo
- Yjs schema migration: NOT needed. Server: none unless saved JSON stops being depth-first.
- Change `DocumentStore.moveBlock(id, toIndex)` / `addBlock(data, index)` to take placements. Est. 1–3 days (judgement).
- Must keep: `deriveOrderedIds` + `reconcileStructure` repair, identical in client and C#.

### Tools
| Tool | Effort | Risk | Note |
|---|---|---|---|
| Toggle, toggle heading, callout | S | Low | already tree-based; ~6 index idioms |
| Columns | M | Medium | column order relies on flat → contentIds (`column-drop.ts:273-281`) |
| **List** | **L** | **High** | TWO nesting models: Tab = structural, drag/loaded data = flat `data.depth` (`list/index.ts:59-66, 471-488`). Numbering/depth/cascades walk the flat array and read depth from DOM `margin-left` (`marker-calculator.ts:160-257`). Needs `depth → parent` data migration (BREAKING saved field) |
| Table | L | Very high | cells are children of the table; grid in `content[r][c].blocks`; membership inferred from flat neighbours (`table-cell-blocks.ts:1076-1100, 1320-1370, 1590-1670`). Recommend keeping `content[][]` + `SELF_PLACING_PARENTS` |
| Database | S–M | Medium | rows ordered by fractional `data.position` synced to backend; keep it (Notion also keeps DB rows outside `content`) |
| Code, file, image, embed | S | Low | self-relative inserts; image lightbox needs a document-order iterator |

149 index-API calls under `src/tools` (table-cell-blocks 32, list-keyboard 13, column-drop 13).

### Tests and docs
- Index-API lines: 979 in 155 unit files, 342 in 48 e2e files (`getBlockByIndex|getBlocksCount|blocks\.move\(|toIndex|fromIndex`). Most keep working if read views stay.
- Laws to delete/rewrite: `validateFlatOrder`, `toDepthFirstOrder`, `tool-tail-append-law`, `top-level-block-enumeration-law`, the 94856fd5 property tests.
- Docs: `docs/src/components/api/api-data.ts` (~90 lines), `i18n/en.json`/`ru.json`, `ConceptsContent.tsx:41-57`, `types/data-formats/output-data.d.ts:78-161`, `MIGRATION.md`.

## What it buys (judgement)

Of ~20 hierarchy fix commits: class A (flat order drifts from tree; 24efcab9, 63c98d99, 323edced, 63d21d41, bb1ded71, 94856fd5) and class D (index APIs/sync; 55a4f967) disappear structurally — roughly 35–45%. Class B (DOM slot mounting) and C (parent ↔ content upkeep) remain, as they do in Notion. Class E (own-element DOM reads) is unrelated.

## Plan

- **Phase 0 — decide before the next release.** 94856fd5 is unreleased. Shipping it means BREAKING #1 now (index implies parent) and BREAKING #2 later on the same methods. Alternative: ship Phase 1's additive sibling API in the same release and point 94856fd5's migration notes at it.
- **Phase 1 — core inversion, non-breaking.** Id map; mutations write root order + `contentIds`; flat array is a cached DFS; `Blocks.insert/move` take `{parentId, afterId}`; holders placed by home slot + previous sibling holder (`hierarchy.ts:299`), deleting neighbour-guessing; stored indexes → block refs; `yjs-sync` translation shrinks; saver/view/markdown read `content`; additive public API + event fields; adapters delegate directly.
- **Phase 2 — lists, BREAKING.** Structural nesting only; migrate `data.depth` → parent chain; numbering over siblings in `content`; delete cascades.
- **Phase 3 — tables, probably never.** Keep `content[r][c].blocks`.
- **Phase 4 — remove index API, BREAKING.** Positional `insert`, `move(to, from)`, `delete(index)`, `splitBlock(insertIndex)`, event `index`/`fromIndex`/`toIndex`, `setToBlock(number)`, adapter `{toIndex}` / `insertOutputData({index})`.

## Status (2026-09-25)

Done and on origin/main (8ade1d5d): wave 1 (id index, stored refs, view/markdown content order, insertAt/moveTo/BlockPlacementError, cell pin) and wave 2 steps 0, 1, 2a, 2b, 2c, 3, 4, 5a (doc store + yjs-sync replay), 5b, 5c (columns + database), 6 (parts 1-2). Every step: TDD, a separate reviewer agent, differential probes base vs branch.

What the core now does:
- Order truth = root order + each block's contentIds. Inserts, moves, reparents, paste, split, remote/undo/redo replay and Yjs writes all go through placements ({parentId, afterId}) via BlockHierarchy.placeBlock / YjsManager.addBlockAt / moveBlockTo.
- The flat array still exists as a derived depth-first view (read APIs getBlockByIndex etc. unchanged); save() builds output + content[] from dfsOrder (contentIds first).
- Dev/test: warn-only tree-order check after the outermost operation; save gate = validateTreeOrder.

Deliberately NOT done (decisions):
- Tables: cell inserts stay on the index path (5c-tables dropped); data.content[r][c].blocks remains the grid truth.
- Lists: flat data.depth nesting (drag) kept — phase 2, BREAKING (saved field).
- Public index API kept (non-breaking); removal is phase 4, BREAKING.
- Drag still moves the flat array first, then reparents (placementImpliedByFlat bridge).

Working notes, release-note lines and queued bugs: ~/Packages/.blok-undo/notion/{wave2.md,followups.md}.
