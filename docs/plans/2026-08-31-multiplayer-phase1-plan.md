# Phase 1 Implementation Plan — Doc Schema v2 + Binary Seam (multiplayer, client-internal)

Produced by the planning pass on 2026-08-31 against main + Phase 0. Scope per
`2026-08-31-multiplayer-design.md` §2c/§2d and the research map
`2026-08-31-multiplayer-research-client-crdt.md`. Everything lands behind the
existing facades; single-player behavior unchanged; nothing persists the doc yet,
so the format is free to change.

**Phase 0 note:** §2b's deep-nested-event fix landed first (event.path walk in
block-observer); Task 3's observer rewrite rebases on it.

## Part I — Per-file impact (summary)

**document-store.ts** — epicenter. `Y.Array('blocks')` → `Y.Map('blocks')`
(id → block Y.Map) + `Y.Array<string>('root')`; public `yblocks` replaced by
accessors + an `undoScope` getter. `fromJSON` = clear + set per block + root ids.
`toJSON` = derived DFS over root/contentIds, global dedupe FIRST OCCURRENCE WINS,
unreachable entries appended sorted by id (cross-peer determinism law).
`getBlockById` O(1). `moveBlock`: the delete+reinsert-a-clone DIES — id-string
order edits only; block Y.Map identity survives moves. NEW
`applyPlacement(id, {parentId, afterId}, origin)` — one transaction owning
parentId set/delete + order-array membership (missing afterId → append; missing
parent → orphan tolerance). NEW binary seam: `applyRemoteUpdate`, `onUpdate`
(echo-filtered via a remoteOrigins set), `getStateVector`,
`encodeStateAsUpdate`; destroy unhooks before `ydoc.destroy()`.
`updateBlockData`/`deepAssign*` gain a Y.Array element-wise diff branch.

**block-observer.ts** — second-largest rewrite. observeDeep on both roots.
Same-id add+remove move heuristic DOES NOT SURVIVE v2 (moves no longer
add/remove maps) → transaction-scoped classification: blocks-map key add/delete
= add/remove (key IS the id; the `_map` internals hack dies); order-array events
for ids not added/removed in-transaction = 'move'; nested events = 'update' via
parent-chain/path walk. Emission order preserved (moves → adds → removes; pin
FIRST — Task 3a). `mapTransactionOrigin` + LOCAL_ORIGIN_TAGS + the
`satisfies never` enumeration test: byte-for-byte untouched.

**types.ts** — `SingleMoveEntry` absolute indices → placements
`{blockId, from: {parentId, afterId}, to: {...}}`. Everything else unchanged.

**undo-history.ts** — UndoManager scope = [blocksMap, rootOrder]; captureTimeout
500 + trackedOrigins {'local'} unchanged. Move stacks record/replay placements
through one placement callback (applyPlacement + in-memory reparent). Caret
stacks structurally untouched. `stopCapturing`/`undo`/`redo` gain the Task 4
flush barrier.

**yjs/index.ts** — v2 scope wiring; moveCallback/parentRestoreCallback collapse
into the placement callback (the :100-109 parentId-delete workaround dies —
applyPlacement owns deletes). moveBlock captures from-placement BEFORE the
mutation. Seam delegations + flush barriers on stopCapturing/undo/redo/
transact/transactMoves/toJSON/fromJSON/getBlockDataObject/destroy.

**serializer.ts** — conversion rule (Task 5): non-empty plain array whose
elements are ALL plain objects/arrays → Y.Array of converted elements;
primitive arrays and EMPTY arrays stay atomic plain leaves (closes the
representation-flip hole). Per-block shape (id/type/data/tunes/parentId/
contentIds/lastEdited*) unchanged — the reconciler read contract survives.

**blockManager.ts** — setBlockParent yjs branch + syncParentContentIds* helpers
→ applyPlacement delegation (also maintains the root array). blockDidMutated →
coalescer enqueue; syncBlockDataToYjs becomes the flush body. Dangling-parent
tolerance + reconcile* unchanged.

**yjs-sync.ts** — insulated, verify-not-change: consumes the facade
(getBlockById same-shaped Y.Map; toJSON same flat ordered list). Its 2607-line
test file staying green (mocked YjsManager) is the insulation proof. NEW
capability for free: remote contentIds-only reorders (invisible today) emit
'move' → full-order resync. New integration test.

**block-mutation.ts / block-insertion.ts / block-removal.ts** — call sites
unchanged (flat-index translation lives in DocumentStore).

**table-model.ts** — normalizeContent pads ragged grids (concurrent col-insert +
row-insert artifact).

**Verified unaffected:** saver.ts (reads BlockManager.blocks :119/:479/:578);
modificationsObserver.ts (onChange driven by BlockChanged, emitted synchronously
before enqueue — the 400ms window and delivery-latency law tests stay green
UNEDITED); drag controllers/api/blockEvents (flat-index level); renderer levers;
types/*.d.ts (no public surface in Phase 1).

## Part II — TDD tasks

**Task 1 — binary seam** (prerequisite: schema-v2 law tests are written THROUGH
the seam; ydoc stays private per yjs-access-guard.test.ts).
`document-store-binary-seam.test.ts`: two-store SV/update round-trip; seam
transactions classify 'remote'; undo ignores them; echo filtering;
unhook-on-destroy; local-tag origin rejected (dev assert).

**Task 2 — schema v2 core (DocumentStore).** Most existing document-store tests
assert via toJSON and survive; rewrite moveBlock/fromJSON internals describes.
New law tests: dedupe first-wins; orphan renders at end sorted by id; root+
contentIds double-listing → first DFS occurrence; Y.Map identity stable across
moves; TWO-DOC CONVERGENCE via seam: concurrent move+edit → edit survives;
move+move → exists once, deterministic order; remove cleans map+orders.
Interim: moveBlock keeps flat-index signature until Task 6.

**Task 3 — observer v2 + wiring.** 3a: pin emission order against CURRENT impl
first. 3b: rewrite block-observer. 3c: yjs/index wiring. 3d: blockManager
applyPlacement delegation (captured + no-capture flavors; from-placement read
before write). Rewrite move/batch-add/top-level describes to v2 fixtures built
through DocumentStore APIs; mapTransactionOrigin describes NOT edited. Nets:
hierarchy/convert/repository unit; yjs-sync.test.ts near-zero diff; Playwright
block-movement, undo-redo, drag-drop, columns.

**Task 4 — write coalescing.** Verified trace: input → Block.didMutated →
BlockManager.blockDidMutated → emits BlockChanged synchronously (onChange path,
untouched) → per-mutation yjs transaction (today). Design: VALUE BUFFER with
synchronous flush; leading flush (first write of an idle block lands at today's
timing — preserves captureTimeout anchor + caret listener timing), trailing
flush at the existing 400ms constant; window never extends.
markCaretBeforeChange at enqueue. Metadata bump at flush. Enqueue suppressed
while isSyncingFromYjs. FLUSH-BARRIER LAW (one test each): stopCapturing, undo,
redo, moveBlock, addBlock, removeBlock, replaceBlockContent, transact,
transactMoves, toJSON, fromJSON, getBlockDataObject, destroy,
encodeStateAsUpdate, getStateVector, applyRemoteUpdate. stopCapturing flushes
BEFORE undoManager.stopCapturing() — closes the 100ms-boundary vs 400ms-trailing
race. Tests: write-coalescing.test.ts (fake timers, ≤2 transactions/window,
word-boundary grouping preserved); delivery-latency + smart-grouping laws stay
green UNEDITED; Playwright undo-redo :115/:412.

**Task 5 — per-cell grids.** Representation: recursive Y.Array conversion per
the serializer rule; NEVER index-keyed maps (Y.Array item identity is what lets
concurrent row-insert + cell-edit both apply). Table: content → Y.Array(rows) →
Y.Array(cells) → Y.Map(cell fields); cell.blocks (string[]) atomic; colWidths/
mergedInto atomic. Diff: two-ended deepAssignYArray (skip equal prefix/suffix;
equal-length middle recurses; unequal → single splice). Cell edit = one nested
write; row move = rewrites two rows (accepted). Law tests via seam: same-cell
different keys merge; same-key LWW; row-insert+cell-edit both apply; concurrent
row inserts both survive; row-delete+edit-in-it → edit vanishes (documented);
ragged rows padded by normalizeContent. Blast radius (round-trip + undo test
each): table content, cell.blockData, database schema/views, list styles
(verify primitive arrays stay atomic).

**Task 6 — placement-based undo move stacks** (after 2–3). Capture from-
placement BEFORE mutation (YjsManager.moveBlock; drag path before
applyPlacement, recordParentChangeForPendingMove merges first-write-wins).
Replay via one placement callback. Missing afterId → append; missing parent →
orphan tolerance. Rewrite move-undo describes to placement fixtures;
"chronological undo across moves and edits" passes UNCHANGED (law). NEW
acceptance: local move + remote index-shifting insert via seam + undo → lands
after sibling S under parent P, not stale index. Nets: Playwright undo-redo
move group, drag-drop, columns matrix, container-undo-redo-orphan-matrix.

**Task 7 — integration hardening.** Unmocked-YjsManager reconciler tests:
remote move via seam → syncBlockOrderFromYjs; remote add/remove/batch-add;
remote contentIds-only reorder (new capability). NEW invariant test:
BlockManager.blocks order === YjsManager.toJSON() order after mixed ops. Full
unit + Playwright sweep.

## Part III — Interactions (musts)

1. Caret stacks: blockId-addressed, kind-interleave preserved; leading-edge
   flush keeps first-write timing.
2. Origin classification: NO new origin tags; unknown → 'remote' branch carries
   the provider origin; enumeration test untouched.
3. 'move' EVENT heuristic dies (order-array detection replaces it); 'move'
   ORIGIN TAG survives byte-identical. replaceBlockContent same-id hazard
   becomes structurally impossible; keep it as-is.
4. Serializer per-block shape unchanged; document assembly moves to
   DocumentStore; array rule per Task 5.
5. Saver unaffected (BlockManager.blocks reads pinned by saver tests).

## Part IV — Parallelization

Wave 1 (3 agents, disjoint): A=Task 1 (seam, additive), B=Task 4 (coalescing,
blockManager region + buffer file; small additive barrier hooks), C=Task 5a-b
(serializer conversion + Y.Array diff + table-model padding).
Wave 2 (ONE agent, sequential): Task 2 → Task 3a-d. No parallel work in the
yjs module during this wave.
Wave 3 (one agent): Task 6.
Wave 4: Task 7 sweep (parallel test-runners OK; fixes funnel through one).
Hard edges: 1→2; {2,3}→6; 3a before 3b; Task 5 observer-event portion needs 3b
(or Phase 0's landed path-walk).

## Part V — Risks / nets

Schema v2 through observer/order-derivation = highest risk → yjs-sync.test.ts
(2607 lines, unchanged facade), 109-test undo-redo Playwright, block-movement,
drag-drop(+touch), columns matrix, table suites, dev tripwires
(assertDomOrderInvariantInDev, assertHierarchy). Coalescing vs undo → barrier
law + smart-grouping pins + Playwright :412. Derived order divergence → Task 7
invariant + Saver DOM-order guard. Per-cell diff cost → two-ended O(changed);
no-op writes pinned. Orphan determinism → sorted-by-id law (Y.Map iteration
order is not a cross-peer guarantee). Undo of deletion → simpler than today;
pinned by existing suites.
