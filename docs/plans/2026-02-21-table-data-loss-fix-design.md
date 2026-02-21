# Table Data Loss Fix Design

## Problem

Users lose data when editing tables, and Yjs throws "Length exceeded!" errors during table paste and drag-and-drop operations. Root cause analysis identified 4 distinct failure modes related to Yjs synchronization and index management.

### "Length exceeded!" Error Context

The Yjs "Length exceeded!" error is an index out-of-bounds error thrown by `typeListInsertGenerics` and `typeListDelete` in `ytype.js`. It fires when:
- `Y.Array.insert(index, content)` with `index > array.length`
- `Y.Array.delete(index, length)` where the range exceeds available elements

Tables are disproportionately susceptible because they involve multiple coordinated array operations (table block + N child cell blocks), and the `moveBlock()` delete-then-insert pattern can produce stale indices.

### RC0: Yjs array operations lack bounds guards (CRITICAL)

`DocumentStore` performs `Y.Array.insert()` and `Y.Array.delete()` without validating indices against current array length. The `moveBlock()` method does delete-then-insert without clamping `toIndex` after the delete shortens the array. When `toIndex` equals the pre-delete array length, the post-delete insert exceeds bounds.

**Trigger:** Drag-and-drop a block to the last position, paste a table creating multiple blocks, or any operation where concurrent modifications shift array indices.

**Files:**
- `src/components/modules/yjs/document-store.ts:71` — `addBlock()` insert without bounds check
- `src/components/modules/yjs/document-store.ts:122-127` — `moveBlock()` delete+insert without post-delete clamping

**References:**
- [yjs/yjs#314](https://github.com/yjs/yjs/issues/314) — out-of-bounds insert silently corrupts state
- [yjs/yjs#297](https://github.com/yjs/yjs/issues/297) — multiple insert/delete in single transaction corrupts internal `_length` (fixed v13.5.7)
- [yjs/yjs#569](https://github.com/yjs/yjs/issues/569) — unhelpful stack traces for this error (fixed ~v13.6.8)

## Root Causes

### RC1: `setData()` fails silently during undo/redo (CRITICAL)

The Table tool does not implement `setData()`. When Yjs undo/redo fires `handleYjsUpdate()`, it calls `block.setData(data)` which returns `false` for tables. The return value is ignored (`void block.setData(data)`). The table DOM stays stale, and subsequent saves capture wrong data.

**Trigger:** Undo/redo of any table structural change (add/remove rows/columns, toggle headings, resize columns).

**Files:**
- `src/tools/table/index.ts` — no `setData()` method
- `src/components/block/data-persistence-manager.ts:104-146` — fallback fails for tables
- `src/components/modules/blockManager/yjs-sync.ts:233-236` — ignores return value

### RC2: Undo of table deletion loses cell content (CRITICAL)

When a table is removed during Yjs undo, `Table.destroy()` calls `deleteAllBlocks()`, deleting child blocks from BlockManager AND Yjs. When the table is restored via redo, `initializeCells()` can't find the deleted blocks and creates empty paragraphs.

**Trigger:** Delete a table block, then undo, then redo.

**Files:**
- `src/tools/table/index.ts:295-309` — `destroy()` calls `deleteAllBlocks()`
- `src/tools/table/table-cell-blocks.ts:614-619` — `deleteAllBlocks()` deletes from BlockManager
- `src/components/modules/blockManager/yjs-sync.ts:296-320` — `handleYjsRemove()`

### RC3: Parent table data not synced after cell structural changes (HIGH)

When blocks are added/removed in cells via `setBlockParent()`, the parent table's data is updated in memory but not explicitly synced to Yjs. While DOM mutation observation catches most cases, timing issues can cause `Table.save()` to capture incomplete state before new blocks are fully claimed.

**Files:**
- `src/components/modules/blockManager/hierarchy.ts:52-76` — no Yjs sync after `setBlockParent()`
- `src/components/modules/blockManager/blockManager.ts:879-929` — `blockDidMutated` only syncs `BlockChangedMutationType`

## Design

### Fix 0: Bounds-check guards in DocumentStore

**Location:** `src/components/modules/yjs/document-store.ts`

Add index validation before every `yblocks.insert()` and `yblocks.delete()` call. This prevents "Length exceeded!" crashes regardless of what upstream code passes.

```typescript
// addBlock(): clamp insertIndex to valid range
const insertIndex = Math.min(index ?? this.yblocks.length, this.yblocks.length);
this.yblocks.insert(insertIndex, [yblock]);

// moveBlock(): clamp toIndex after delete shortens the array
this.yblocks.delete(fromIndex, 1);
const clampedToIndex = Math.min(toIndex, this.yblocks.length);
this.yblocks.insert(clampedToIndex, [this.serializer.outputDataToYBlock(blockData)]);
```

The `removeBlock()` method is already safe — `findBlockIndex()` returns -1 if not found, and the method exits early. The `fromJSON()` method uses `delete(0, yblocks.length)` which is self-referential and safe.

### Fix 1: yjs-sync fallback on `setData()` failure

**Location:** `src/components/modules/blockManager/yjs-sync.ts` — `handleYjsUpdate()` method

When `block.setData(data)` returns `false`, fall back to full block recreation (the same pattern already used when tunes change at lines 214-230).

```typescript
// Current (broken):
this.yjsSyncCount++;
void block.setData(data).finally(() => {
  this.yjsSyncCount--;
});

// Fixed:
this.yjsSyncCount++;
block.setData(data).then(success => {
  if (!success) {
    const blockIndex = this.handlers.getBlockIndex(block);
    const newBlock = this.factory.composeBlock({
      id: block.id,
      tool: block.name,
      data,
      tunes: block.preservedTunes,
      bindEventsImmediately: true,
    });
    this.handlers.replaceBlock(blockIndex, newBlock);
  }
}).finally(() => {
  this.yjsSyncCount--;
});
```

This is a general safety net that fixes ALL tools that don't implement `setData()`.

### Fix 2: Table `setData()` method

**Location:** `src/tools/table/index.ts`

Implement `setData()` following the existing `onPaste()` pattern (lines 243-293):

1. Update `this.data` with new data
2. Delete old cell blocks via `cellBlocks.deleteAllBlocks()`
3. Destroy old `cellBlocks` instance
4. Call `render()` to create new DOM
5. Replace old DOM element with new one
6. Reinitialize all controllers (resize, add controls, row/col controls, selection, paste listener)
7. Call `initializeCells()` to mount existing blocks or create new ones

This provides optimized table handling and prevents the yjs-sync fallback from doing full block recreation unnecessarily.

### Fix 3: Skip `deleteAllBlocks()` during Yjs-driven removal

**Location:** `src/tools/table/index.ts` — `destroy()` method

When the table is being destroyed due to Yjs undo (not user action), skip `deleteAllBlocks()`. Yjs manages block lifecycle during undo/redo — the table shouldn't interfere.

Detection: Check if the destruction is happening within a Yjs sync context. The `api` object provides access to check this state.

```typescript
public destroy(): void {
  // Only delete cell blocks if this is a user-initiated removal,
  // not a Yjs undo/redo operation. During Yjs undo, Yjs manages
  // block lifecycle and will handle child block removal.
  if (!this.isYjsSyncing()) {
    this.cellBlocks?.deleteAllBlocks();
  }

  this.resize?.destroy();
  // ... rest of cleanup ...
}
```

The `isYjsSyncing()` check needs access to the Yjs sync state. Options:
- Pass a flag through the destroy chain
- Check via the API (if exposed)
- Add a block-level property set by the removal flow

### Fix 4: Deferred parent sync after `setBlockParent()`

**Location:** `src/components/modules/blockManager/blockManager.ts`

After `setBlockParent()` changes a block's parent, schedule a deferred sync of the parent block's data to Yjs. Use microtask batching to avoid multiple syncs during batch operations (e.g., initializing all cells in a new row).

```typescript
private parentsSyncScheduled = new Set<string>();

// Called after setBlockParent changes parent
private scheduleParentSync(parentId: string): void {
  if (this.parentsSyncScheduled.size === 0) {
    queueMicrotask(() => this.flushParentSyncs());
  }
  this.parentsSyncScheduled.add(parentId);
}

private flushParentSyncs(): void {
  for (const parentId of this.parentsSyncScheduled) {
    const parent = this.repository.getBlockById(parentId);
    if (parent) {
      void this.syncBlockDataToYjs(parent);
    }
  }
  this.parentsSyncScheduled.clear();
}
```

## Implementation Order

| Step | Fix | Priority | Risk |
|------|-----|----------|------|
| 1 | Fix 0: Bounds-check guards | P0 | Low — pure validation, no behavior change |
| 2 | Fix 1: yjs-sync fallback | P0 | Low — follows existing pattern |
| 3 | Fix 2: Table `setData()` | P0 | Medium — complex lifecycle |
| 4 | Fix 3: Skip delete during Yjs removal | P1 | Low-Medium — needs flag plumbing |
| 5 | Fix 4: Deferred parent sync | P2 | Medium — timing sensitivity |

## Testing Strategy

Each fix requires regression tests written BEFORE the fix (TDD):

0. **Fix 0 tests:**
   - Unit: `addBlock()` with index > array length inserts at end instead of throwing
   - Unit: `moveBlock()` with toIndex at array boundary doesn't throw "Length exceeded"
   - Unit: `moveBlock()` from last position to first position works correctly
1. **Fix 1 test:** Unit test that verifies `handleYjsUpdate()` recreates a block when `setData()` returns false
2. **Fix 2 tests:**
   - E2E: Add row to table → undo → verify table has original row count and cell content
   - E2E: Toggle heading → undo → verify heading state restored
   - Unit: Table `setData()` updates DOM and reinitializes controllers
3. **Fix 3 tests:**
   - E2E: Delete table → undo → redo → verify cell content preserved
4. **Fix 4 tests:**
   - Unit: Adding block to cell triggers parent sync to Yjs after microtask
