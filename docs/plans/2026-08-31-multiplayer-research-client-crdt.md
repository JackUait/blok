# Blok client-side Yjs/CRDT layer — map for multiplayer design

Researched 2026-08-31 against `main` (711e3f2f). All paths relative to `/Users/jackuait/Packages/blok`. yjs version: `13.6.32`, pinned in `package.json:292` and **bundled into dist** (`vite.config.mjs:44` — `external: []`, no peerDependencies entry for yjs).

Layer inventory:

| Piece | File | Role |
|---|---|---|
| `YjsManager` (module facade) | `src/components/modules/yjs/index.ts` | Registered as a core module (`src/components/modules/index.ts:44,96`); the ONLY thing the rest of the editor talks to |
| `DocumentStore` | `src/components/modules/yjs/document-store.ts` | Owns the `Y.Doc` (private) + `yblocks` Y.Array; all writes via origin-typed `transact` |
| `BlockObserver` | `src/components/modules/yjs/block-observer.ts` | `observeDeep` on yblocks → domain `BlockChangeEvent`s with classified origin |
| `YBlockSerializer` | `src/components/modules/yjs/serializer.ts` | JSON ↔ Y.Map conversion (recursive Y.Maps for nested objects) |
| `UndoHistory` | `src/components/modules/yjs/undo-history.ts` | Y.UndoManager + custom move stacks + caret stacks |
| `BlockYjsSync` (reconciler) | `src/components/modules/blockManager/yjs-sync.ts` | Applies undo/redo/**remote** Yjs events back onto DOM/BlockManager |

---

## 1. Exact shared-type structure of the Y.Doc

**Top level: a single `Y.Array<Y.Map>` named `'blocks'`** — flat, document-ordered, holding every block (root and nested alike; hierarchy is by `parentId`/`contentIds` fields, not by nesting shared types).

- `document-store.ts:28` — `private readonly ydoc: Y.Doc = new Y.Doc();`
- `document-store.ts:33` — `public readonly yblocks: Y.Array<Y.Map<unknown>> = this.ydoc.getArray('blocks');`

That is the **only** top-level shared type in the doc. No Y.Text, no Y.XmlFragment anywhere in the codebase.

**Per-block Y.Map keys** (written by `YBlockSerializer.outputDataToYBlock`, `serializer.ts:54-86`):

| Key | Type | Notes |
|---|---|---|
| `id` | plain string | logical block id (`serializer.ts:57`) |
| `type` | plain string | tool name (`serializer.ts:58`) |
| `data` | **nested `Y.Map`** | recursive: plain objects become nested Y.Maps (`objectToYMap`, `serializer.ts:151-163`); **primitives and ARRAYS stored as-is** |
| `tunes` | nested `Y.Map` | optional (`serializer.ts:65-67`) |
| `parentId` | plain string | optional; **deleted key = root**, not `null` (`serializer.ts:69-71`; delete path `index.ts:117-123`) |
| `contentIds` | `Y.Array<string>` | optional, child ordering (`serializer.ts:73-75`) |
| `lastEditedAt` / `lastEditedBy` | number / string | optional (`serializer.ts:77-83`) |

**Text is a plain string value in the `data` Y.Map** (e.g. `data.text` for paragraph). A Y.Map key write is a last-writer-wins register:

- `document-store.ts:237-241` — `ydata.set(key, ...)` for primitives.
- **Consequence: NO character-level merge for concurrent text editing.** Two clients typing in the same paragraph clobber each other whole-field (the entire HTML string of the block).
- **Arrays are atomic** — `document-store.ts:239` comment: "primitives/arrays are stored as-is (arrays are atomic here)". So a table's `data.content` (the full 2-D cell array) is ONE LWW register: concurrent edits to *different cells* of the same table still clobber each other entirely.
- The only sub-field merging that exists is **object-key-level**: `updateBlockData` deep-merges plain-object values into existing nested Y.Maps writing only changed leaves (`document-store.ts:217-227`, `deepAssignYMap` `:253-289`), explicitly "so concurrent edits to DIFFERENT sub-fields merge (field-level CRDT) rather than last-writer-wins" (`:215-217`). Field-level, never character-level.

**Local write API surface** (everything routes through `DocumentStore.transact(fn, LocalOriginTag)`, `document-store.ts:359-361`):
`fromJSON` (:49-58, origin `'load'`, deletes all + re-pushes), `addBlock` (:73-82, `'local'`), `removeBlock` (:88-98), `replaceBlockContent` (:118-131, in-place type+data swap — same Y.Map identity, emits `update` not remove+add), `moveBlock` (:139-174 — **delete + reinsert a serialized CLONE**, see §8), `updateBlockData` (:199-244), `updateBlockTune` (:297-308), `updateBlockMetadata` (:316-342), `transactWithoutCapture` (:370-372, origin `'no-capture'`).

## 2. One Y.Doc per editor instance

Yes — strictly per-instance, created in the module constructor chain, destroyed with the editor:

- `Core.constructModules` instantiates every module class per editor (`src/components/core.ts:386-397`); `YjsManager` is in the registry (`src/components/modules/index.ts:44,96`).
- `YjsManager` constructor (`yjs/index.ts:83-138`) → `new DocumentStore(...)` → field initializer `new Y.Doc()` (`document-store.ts:28`).
- Destroy: `Blok.destroy` walks all modules calling `destroy()` (`src/blok.ts:548-563`) → `YjsManager.destroy` (`yjs/index.ts:494-498`: observer → undoHistory → documentStore) → `ydoc.destroy()` (`document-store.ts:395-397`).

**Two editors on one page cannot collide**: separate Y.Docs, no shared registry, no room/document name anywhere (the array name `'blocks'` is per-doc). The doc also has no configured `guid` tied to content — each `new Y.Doc()` gets a random guid, which a provider layer will need to override/ignore when binding to a server-side document identity.

## 3. Origin tags

**Raw origins ever passed to `Y.Doc.transact`** — the whitelist `LOCAL_ORIGIN_TAGS` (`yjs/types.ts:40-47`):
`'local'`, `'load'`, `'no-capture'`, `'move'`, `'move-undo'`, `'move-redo'` — plus the `Y.UndoManager` instance itself (Yjs sets it as origin during undo/redo). `DocumentStore.transact` takes `LocalOriginTag` as a **type barrier** (`document-store.ts:359`), and the Y.Doc is private precisely so no caller can bypass it (`document-store.ts:19-27`).

**Classification** — `BlockObserver.mapTransactionOrigin` (`block-observer.ts:84-119`):

| Raw origin | Classified |
|---|---|
| the UndoManager instance | `'undo'` if `undoManager.undoing` else `'redo'` (:85-87) |
| `'local'`, `'no-capture'`, `'move'` | `'local'` (:94-95, :105-106, :107-108) |
| `'load'` | `'load'` (:96-97) |
| `'move-undo'` / `'move-redo'` | `'undo'` / `'redo'` (:109-112) |
| **anything else (unknown)** | **`'remote'`** (:89-91) |

The switch is exhaustive over the whitelist (`satisfies never` guard :113-117) and a CI enumeration test pins it; a new local tag that silently fell to `'remote'` is the documented bug class (`types.ts:34-38`).

**Undo scoping** — `undo-history.ts:121-124`:
```ts
this.undoManager = new Y.UndoManager(this.yblocks, {
  captureTimeout: CAPTURE_TIMEOUT_MS,   // 500ms, serializer.ts:30
  trackedOrigins: new Set(['local']),
});
```
Only `'local'`-origin transactions are captured. `'load'`, `'no-capture'`, `'move*'`, and **any unknown origin are NOT tracked**.

**What happens to an unrecognized origin:** the observer classifies it `'remote'` and `BlockYjsSync.subscribe` (yjs-sync.ts:219-229) **applies it to the DOM** exactly like undo/redo events; the UndoManager ignores it. This is the correct default semantics for a network provider with zero changes: apply remote updates under any non-whitelisted origin (e.g. the provider object itself, the y-protocols convention) and both classification and undo-exclusion fall out automatically. The `'remote'` path is already load-bearing in tests and comments (e.g. `handleYjsUpdate`'s remote-reparent handling, yjs-sync.ts:433-466; `blockManager.ts:407-410` "a remote peer may legally deliver a transiently-dangling parent id").

## 4. External update API: none — and the seam

There is **no** existing API to (a) apply a binary Yjs update, (b) subscribe to local updates as binary payloads, or (c) get a state vector. Verified: zero matches for `applyUpdate` (yjs's), `encodeStateAsUpdate`, `encodeStateVector`, `ydoc.on('update')` anywhere in `src/` or `types/` outside the i18n module's unrelated `applyUpdate` method. No y-websocket/y-webrtc/awareness dependency in `package.json` (only `yjs: 13.6.32`, line 292).

**Public surface today**: the app-facing API exposes only `api.history` (undo/redo/canUndo/canRedo/clear — `types/api/history.d.ts`, backed by `src/components/modules/api/history.ts:32-62`) and `api.blocks.isSyncingFromYjs` (`src/components/modules/api/blocks.ts:34-36`, `types/api/blocks.d.ts:37`). `YjsManager` itself is internal (`src/types-internal/blok-modules.d.ts:48,97`); `Blok.exportAPI` exports only API methods + configuration (`src/blok.ts:529-601`). No adapter or package reaches `moduleInstances`.

**Escape hatch that technically exists**: `YjsManager.getBlockById` returns a raw `Y.Map` (`yjs/index.ts:264-266`), and every yjs shared type carries `.doc` — so the Y.Doc is *reachable* today via `getBlockById(anyId).doc`. Do not build on it: it bypasses the origin type barrier the DocumentStore exists to enforce (`document-store.ts:19-27`).

**Smallest seam** — and why it should be **binary-only, not "expose the doc"**: yjs is *bundled* into the dist bundles (`vite.config.mjs:44` `external: []`, and yjs is not a peer dependency). A host-side provider imports its own yjs copy; handing it the raw `Y.Doc` crosses two yjs module instances, which is yjs's documented dual-import footgun (`instanceof` checks and internal struct sharing break). Binary payloads (`Uint8Array` updates / state vectors) are copy-safe. So add to `DocumentStore` (which owns `ydoc`) and delegate through `YjsManager`:

- `applyRemoteUpdate(update: Uint8Array, origin?: unknown)` → `Y.applyUpdate(this.ydoc, update, origin ?? REMOTE_ORIGIN)` — any origin not in `LOCAL_ORIGIN_TAGS` already classifies as `'remote'` (§3), so no observer/undo changes needed.
- `onUpdate(cb: (update: Uint8Array, origin: unknown) => void)` → wrap `this.ydoc.on('update', ...)`; the callback filters `origin` to skip echoing remote-applied updates back out (standard provider pattern). Yjs already emits every local transaction (including `'load'`, `'no-capture'` etc.) through this event.
- `getStateVector(): Uint8Array` → `Y.encodeStateVector(this.ydoc)`; plus `encodeStateAsUpdate(sv?)` for initial sync exchange.
- Unhook in `DocumentStore.destroy()` before `ydoc.destroy()` (`document-store.ts:395-397`).

Then decide separately how a provider reaches `YjsManager` (a `collaboration` config key wired per the "new config key = 4 edits" law, or a host callback handed the binary API — either keeps yjs single-copy).

## 5. Initial-load seeding — the dual-seeding footgun is fully armed

**Trace** (initial load): `Core.isReady` → `start()` → `render()` (`src/components/core.ts:58-59`) → `Renderer.render(config.data.blocks)` (`core.ts:346-381`) → `insertRenderedBlocks` (`renderer.ts:128-317`): per-block sanitize (`:295-297`) + `composeBlock(origin:'load')` (`:246-260`) → **`BlockManager.insertMany(blocks, 0, { skipYjsSync: false })`** (`renderer.ts:305`).

`insertMany` (`blockManager.ts:570-641`) builds `blockDataArray` from the composed blocks (`:591-602`) and — unless `skipYjsSync` — calls **`YjsManager.fromJSON(blockDataArray)`** (`:610-612`), deliberately BEFORE DOM insert so `rendered()`-hook nested inserts aren't wiped (`:585-590`). `fromJSON` clears undo history (`yjs/index.ts:155-160`) then in ONE transaction with origin **`'load'`** deletes the whole array and pushes freshly-created Y.Maps (`document-store.ts:49-58`). The observer emits events with origin `'load'`, which `BlockYjsSync.subscribe` ignores (only undo/redo/remote pass — `yjs-sync.ts:220-228`), so seeding does not re-render.

Additional seed writes: an empty document inserts a default paragraph (`renderer.ts:152-158` → `BlockManager.insert({origin:'load'})` — note that `origin` is the *block-creation* origin; the Yjs write goes through `DocumentStore.addBlock` with transaction origin `'local'`, `document-store.ts:76-79`). Container tools' `rendered()` hooks (table cell paragraphs etc.) also insert post-seed under `'local'`/`'no-capture'` (`blockManager.ts:585-590`, `block-insertion.ts:302,439,515,632,773`).

**Verdict: yes, the classic footgun.** Seeding is "delete everything, insert brand-new items" — each client's insertions are new CRDT items under its own clientID. If two clients each load the same JSON into their own Y.Doc and then sync:

- The merged `yblocks` contains **2N items** — every block twice, with duplicate logical `id` keys (the delete range in each client's `fromJSON` was empty at its origin, so it deletes nothing of the peer's).
- The DOM does *not* double, but only by accident: `handleYjsAdd`/`handleYjsBatchAdd` skip any id the repository already has (`yjs-sync.ts:589-591`, `:719-721`).
- The doc stays permanently corrupted: `YjsManager.toJSON()` yields 2N entries; `findBlockIndex` matches the first duplicate (`document-store.ts:349-351`); every index-based operation (`handleYjsAdd`'s `targetIndex` via `toJSON().findIndex`, `yjs-sync.ts:607-608`; `syncBlockOrderFromYjs`, `:901-931`) computes against the doubled array. `Saver` reads `BlockManager.blocks` (`saver.ts:119`), masking the corruption on save while the CRDT diverges.

**Design consequence**: a multiplayer flow must NOT run the current load path and then connect. Either (a) sync-first: create an empty editor (`skipYjsSync` render or no render), apply the server's canonical update, and let the `'remote'`/rebuild path materialize blocks; or (b) exactly one designated client (or the server) performs the JSON→Y.Doc seeding once, and everyone else receives it as updates. `repaintBlocks`/`render({skipYjsSync:true})` (`renderer.ts:92-97`, `blockManager.ts:210-218`) is the existing "rebuild view without touching the doc" lever that (a) can build on.

## 6. Remote-update render path — unsanitized (confirmed open issue)

`subscribe()` routes `'remote'` (and undo/redo) events into `syncBlockFromYjs` (`yjs-sync.ts:219-258`), which dispatches:

- **`handleYjsUpdate(blockId)`** (`yjs-sync.ts:419-583`): reads `data` via `yMapToObject(yblock.get('data'))` (`:427`); reconciles remote `parentId` drift through `setBlockParent` first (`:457-466`); if Yjs `type` differs from the in-memory tool, recreates via `composeBlock({... data, origin:'replay'})` (`:475-513`); if tunes changed, recreates (`:515-549`); else **`block.setData(data)` in-place** (`:556`), falling back to `composeBlock` on refusal (`:558-580`). All under `withAtomicOperation(±RAF)` so the apply doesn't echo back into Yjs (`:552-555`).
- **`handleYjsAdd(blockId)`** (`:588-656`): skip if id exists; read type/data/parentId off the Y.Map (`:600-604`); position from `toJSON().findIndex` (`:607-608`); `composeBlock(origin:'replay')` + `blocksStore.insert` + `onBlockAdded` + `setBlockParent` + orphaned-children reconcile (`:617-655`).
- **`handleYjsBatchAdd(blockIds)`** (`:712-779`): two-pass — pass 1 creates all blocks and adds to the array (no DOM) so parents' `rendered()` hooks can find children; pass 2 activates (DOM + RENDERED) and reparents.
- (`handleYjsRemove` `:784-877`, `handleYjsMove` `:883-931` — §8.)

**No sanitize pass anywhere on this path — confirmed.** Zero `sanitiz|clean(` matches in `yjs-sync.ts` and none in `factory.ts` (`composeBlock`, `factory.ts:67-134`, runs migrations only). The sink chain: `yjs-sync.ts:427` → `:556 block.setData(data)` → `Block.setData` (`src/components/block/index.ts:609-610`) → `DataPersistenceManager.setData` → **`pluginsContent.innerHTML = newText`** (`src/components/block/data-persistence-manager.ts:152`) or the tool's own `setData`; the composeBlock paths land in tool `render()` innerHTML sinks (e.g. paragraph). A hostile collaborator's Y.Map write executes markup on every connected client with no interaction. (Matches the open memory item `yjs-sync-unsanitized-remote-data`.)

**Fix recipe + hook points**: mirror the renderer's load path — `sanitizeBlocks` (`src/components/utils/sanitizer.ts:75`) + unconditional `stripUnsafeUrlsDeep` (`sanitizer.ts:339`), applied exactly as `Renderer.sanitizeToolData` does (`renderer.ts:328-342`: `sanitizeBlocks([{tool,data}], name => Tools.blockTools.get(name)?.sanitizeConfig, this.config.sanitizer)` then `stripUnsafeUrlsDeep(sanitized.data, toolSanitizeConfig)`). Hook points are the three read sites in yjs-sync: `handleYjsUpdate` (`:427`, before both the setData and composeBlock branches), `handleYjsAdd` (`:601`), `handleYjsBatchAdd` (`:730`). Tool sanitize configs are reachable from `BlockYjsSync` via `this.factory` (`factory.dependencies.moduleInstances.Tools` / add a small accessor on `BlockFactory`, `factory.ts:141-152`), and the global `config.sanitizer` via the module config. Gate it to `origin === 'remote'` if undo/redo must keep byte-identical restores (undo data was already sanitized on the way in for load/paste paths, but locally *authored* data is trusted by definition) — note `syncBlockFromYjs` (`yjs-sync.ts:243-258`) does not currently pass `event.origin` into the handlers, so that gate requires threading the origin parameter through the three handler signatures.

## 7. Undo/redo under collaboration

**Mostly correct by construction, with concrete index-based breakage:**

- **Correct**: `trackedOrigins: Set(['local'])` (`undo-history.ts:123`) means remote transactions are never captured; Y.UndoManager natively skips items deleted by other clients when undoing. The observer never suppresses events during undo/redo (`block-observer.ts:313-320`) so remote-style DOM application works for replays too. `BlockObserver` maps unknown → `'remote'` so a provider can't pollute the stacks.
- **Breakage 1 — move stacks are absolute-index based.** `SingleMoveEntry` stores flat-array `fromIndex`/`toIndex` integers (`yjs/types.ts:89-95`); undo replays `moveCallback(blockId, move.fromIndex, 'move-undo')` (`undo-history.ts:406-414`, redo `:421-429`). A remote insert/remove that shifts the array between record and replay makes the block land at the wrong position; `moveBlock` merely clamps out-of-range (`document-store.ts:168-172`). Same for `caretUndoStack` interleave ordering (kind:'move' vs 'edit' at the stack top, `undo-history.ts:293-294`, `:341-342`) — it assumes only local ops push entries, which stays true, but the *positions* those entries encode go stale.
- **Breakage 2 — undoing a data edit LWW-clobbers newer remote edits to the same key** (inherent Y.UndoManager map semantics: undo restores the previous key value). Field-granularity, same-key only; acceptable but should be a documented behavior.
- **Breakage 3 — undo of a local move after a remote edit of the moved block**: the move was a delete+clone (§8), so the peer's edit targeted a deleted item and is already lost before undo enters the picture.
- `updateLastCaretAfterPosition` / microtask `scheduleAfterSnapshotRefresh` (`undo-history.ts:225-265`) only touch local caret stacks — safe.
- Caret snapshots are blockId-addressed (`yjs/types.ts:59-63`) with offset clamping at restore — degrade gracefully under remote text drift.

## 8. Everything else load-bearing for multiplayer

**Moves are delete+reinsert of a CLONE — the #1 structural hazard.** `DocumentStore.moveBlock` (`document-store.ts:160-173`) serializes the yblock to JSON, deletes the original item, and inserts a **fresh Y.Map built from the clone** ("Y.Map can't be reinserted after deletion", `:163`). Under concurrency: (a) **move + remote edit** → the peer's edit lands on the deleted item and vanishes; (b) **move + move** → both clients delete the original (merges fine) but each inserts its own clone → **two array items with the same logical id**, the same corruption shape as dual-seeding. The observer classifies same-id add+remove within a transaction as `'move'` (`block-observer.ts:194-201`), which holds per-transaction but not across two peers' independent move transactions. Any serious multiplayer design must replace this with a fractional-index/order-key scheme (order as data, not array position) or Yjs's move feature — this is bigger than a provider-attachment detail.

**Reparents**: local reparent writes `parentId` (or deletes the key for root) plus both parents' `contentIds` (`blockManager.ts:1194-1220`; during drag move-groups via `transactWithoutCapture` + `recordParentChangeForPendingMove`, `yjs/index.ts:394-404`). Remote side: a `parentId`/`contentIds` write on the yblock itself fires `handleMapEvent` → `update` event (`block-observer.ts:252-283`), and `handleYjsUpdate` reconciles it through `setBlockParent` (`yjs-sync.ts:433-466`). Known blind spot (documented): a *deleted* `parentId` key is invisible to that handler — `yblock.has('parentId')` is false — so a remote non-root→root reparent silently skips (`yjs/index.ts:100-109` works around it for local history replays only). A remote peer's root-promotion will not reconcile.

**VERIFIED gap — deeply-nested remote data changes are dropped.** `handleMapEvent` recognizes only (a) top-level yblocks and (b) maps that are *directly* `yblock.get('data')` or `.tunes` (`findParentBlock`, `block-observer.ts:300-311`). But `objectToYMap` nests recursively and `deepAssignYMap` writes into grandchild maps (`document-store.ts:253-289`). Verified against real yjs 13.6.32: a write to `data.style.color` fires an `observeDeep` event whose target is the *inner* map — `isTopLevelYblock` false, `findParentBlock` no match → **no event emitted at all**. (Repro: event `path` was `[0,"data","style"]`.) Local editing masks this (DOM is already current; undo of such a write likely re-renders via other events), but a remote peer's nested-field edit will not reach the DOM. Fix is small: walk `event.target.parent` (or use `event.path[0]`) up to the yblocks member.

**Batching**: multi-block restores arrive as one `batch-add` (`block-observer.ts:204-218`) → two-pass materialization (`yjs-sync.ts:700-779`). Moves are microtask-coalesced: any number of `move` events in a batch trigger ONE full-order resync from `toJSON()` (`:883-931`). Every batch schedules exactly one holder-order reconcile via microtask; auto-fix only for remove-driven batches, invariant assert for all (`:260-294`).

**`skipYjsSync` convention**: "the doc already describes these blocks — rebuild view only." Threaded through `insert`/`insertMany`/`removeBlock`/`render` (`blockManager.ts:547,573,610-612,683-693,722`; `renderer.ts:92-97`). The inverse guard is `isSyncingFromYjs` (`yjs-sync.ts:69-76`) + `withAtomicOperation(±extendThroughRAF)` (`:138-207`) which suppress DOM-mutation echo-back into Yjs while applying doc→DOM; `operations.suppressStopCapturing` rides along (`:140-151`). `api.blocks.isSyncingFromYjs` exposes it to tools (`api/blocks.ts:34-36`). Remote-apply already runs under these; a provider needs nothing extra here.

**`composeBlock` origins**: `'replay'` for every yjs-sync materialization (containers must not seed default children — `yjs-sync.ts:487-497`), `'load'` for renderer, `'api'` default (`factory.ts:78`, `blockManager` types). Remote-created container blocks correctly arrive as `'replay'`.

**Destroy/teardown order**: modules `markDestroyed` first, then `destroy()` in registry order (`src/blok.ts:536-563`); `YjsManager.destroy` = observer → undoHistory → documentStore → `ydoc.destroy()` (`yjs/index.ts:494-498`, `document-store.ts:395-397`). A provider must detach (and flush pending updates) before `ydoc.destroy()` — the natural hook is the same `DocumentStore.destroy`/`YjsManager.destroy` chain, or a dedicated provider module destroyed before YjsManager in registry order.

**Save path**: `Saver` reads `BlockManager.blocks` (DOM/tool `save()`), not `YjsManager.toJSON()` (`saver.ts:119`) — the doc drives undo/remote reconciliation; persistence snapshots come from the reconciled in-memory state.

---

## Summary of what's missing to attach a provider

1. Binary update seam (`applyRemoteUpdate`/`onUpdate`/`getStateVector` on YjsManager→DocumentStore) — nothing exists; keep it binary because yjs is bundled (§4).
2. A sync-first (or single-seeder) load mode — current `fromJSON` seeding duplicates the doc across clients (§5).
3. Sanitize pass on the three remote read sites in yjs-sync (§6).
4. A move representation that survives concurrency — delete+clone loses edits and duplicates ids (§8).
5. Fixes for two observer/reconciler blind spots: deleted-`parentId` remote root-promotion, and deep-nested map events (verified) (§8).
6. Index-independent move/caret history entries if undo must stay correct under interleave (§7).
7. Awareness (presence/cursors) has no substrate at all — no awareness dep, no per-client metadata anywhere.
