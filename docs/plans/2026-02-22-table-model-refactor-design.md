# TableModel Refactor: Snapshot-Based Save with Model as Source of Truth

**Date:** 2026-02-22
**Status:** Approved
**Branch:** feat/table

## Problem

Table data loss occurs because the current architecture reads from the DOM in `save()`, which races with structural operations (add/delete/move rows/columns, paste). Five parallel research agents identified 12+ data loss vectors across critical, high, and medium severity.

### Root Cause: DOM as Source of Truth

The current flow:
```
User edits -> DOM changes -> save() reads DOM -> returns data
                                ^ race conditions
Operations -> DOM changes ------/
```

When `save()` calls `TableGrid.getData(gridEl)`, it queries the DOM for `[data-blok-table-row]` and `[data-blok-table-cell]` elements. If a structural operation is modifying the DOM concurrently, `getData()` can return:
- Ragged row dimensions (some rows with more cells than others)
- Orphaned block IDs (blocks that were mid-move)
- Duplicate block IDs (block in both old and new cell)
- Empty block arrays (cell container removed mid-read)

### Documented Data Loss Vectors

#### Critical

| ID | Issue | Trigger |
|----|-------|---------|
| C1 | `removedBlockCells` keyed by index not block ID | Block insert/remove shifts indices; replacement block claimed by wrong cell |
| C2 | Paste operation lacks `withAtomicOperation()` wrapper | Yjs syncs mid-paste; intermediate state persists |
| C3 | `cellsPendingCheck` adds ALL cells on every `block-removed` | Delete column triggers spurious paragraphs in unrelated cells |
| C4 | Stale `contentIds` in `flushParentSyncs()` | Rapid structural operations; microtask fires with stale hierarchy |

#### High

| ID | Issue | Trigger |
|----|-------|---------|
| H1 | `yjsSyncCount` deferred via RAF leaves mutations suppressed | Rapid undo/redo before RAF fires |
| H2 | `syncBlockDataToYjs()` async but not cancelled on block removal | Edit cell then delete table before save resolves |
| H3 | `save()` reads DOM during structural operation | Auto-save while add/delete row in progress |
| H4 | Paste `findCellForNewBlock()` always picks adjacent cell | Multi-cell paste: all blocks land in first cell |
| H5 | `deleteBlocks()` fires async deletes without index shift accounting | Delete column with many blocks |
| H6 | `this.data.content` not updated after paste grid expansion | Paste expands grid; Yjs sync uses stale structure |

#### Medium

| ID | Issue | Trigger |
|----|-------|---------|
| M1 | `getCellContent()` silently returns empty for missing containers | DOM corruption or async cell removal |
| M2 | `mountBlocksInCell()` silently skips missing blocks | Block not found during undo restoration |
| M3 | Promise-based `yjsSyncCount` decrement can hang | `setData()` promise never settles |
| M4 | `contentIds` mutated during `setBlockParent()` callback | Re-entrant hierarchy changes |

## Solution: TableModel as Single Source of Truth

### Architecture

```
User edits -> block mutation event -> TableModel.updateCell() -> model is truth
Operations -> TableModel.addRow()  -> renders to DOM            -> DOM is render target
save()     -> model.snapshot()     -> no DOM reading            -> no race conditions
```

### New Class: TableModel

Location: `src/tools/table/table-model.ts`

```typescript
class TableModel {
  // Canonical state
  private cells: CellContent[][];
  private colWidthsInternal: number[] | undefined;
  private withHeadingsInternal: boolean;
  private withHeadingColumnInternal: boolean;
  private stretchedInternal: boolean;
  private initialColWidthInternal: number | undefined;

  // Reverse lookup: block ID -> cell position (O(1))
  private blockCellMap: Map<string, { row: number; col: number }>;

  // Structural operations (update model, return instructions for DOM)
  addRow(index?: number): RowOperation;
  deleteRow(index: number): RowOperation;
  moveRow(from: number, to: number): RowOperation;
  addColumn(index?: number, width?: number): ColumnOperation;
  deleteColumn(index: number): ColumnOperation;
  moveColumn(from: number, to: number): ColumnOperation;

  // Cell operations
  setCellBlocks(row: number, col: number, blockIds: string[]): void;
  addBlockToCell(row: number, col: number, blockId: string): void;
  removeBlockFromCell(row: number, col: number, blockId: string): void;
  findCellForBlock(blockId: string): { row: number; col: number } | null;

  // Bulk update (for setData/undo/redo)
  replaceAll(data: TableData): void;

  // Snapshot (replaces DOM reading in save())
  snapshot(): TableData;

  // Dimensions
  get rows(): number;
  get cols(): number;
}
```

### Operation Return Types

Structural operations return instructions rather than mutating DOM directly:

```typescript
interface RowOperation {
  type: 'add-row' | 'delete-row' | 'move-row';
  index: number;
  toIndex?: number;
  blocksToDelete?: string[];
  cellsToPopulate?: number;
}

interface ColumnOperation {
  type: 'add-column' | 'delete-column' | 'move-column';
  index: number;
  toIndex?: number;
  width?: number;
  blocksToDelete?: string[];
  cellsToPopulate?: Array<{ row: number; col: number }>;
}
```

### Model Consistency Invariants

TableModel enforces at all times:
1. All rows have the same number of columns
2. `colWidths` array length matches column count (when present)
3. Every block ID in `cells` has an entry in `blockCellMap`
4. Every entry in `blockCellMap` points to a valid cell position
5. No block ID appears in more than one cell

## Key Changes

### save() -- Pure Model Read

```typescript
// Before (reads DOM, races with operations):
public save(blockContent: HTMLElement): TableData {
  const gridEl = blockContent.firstElementChild as HTMLElement;
  const content = this.grid.getData(gridEl);  // DOM query
  return { ...this.data, content };
}

// After (reads model, no race possible):
public save(_blockContent: HTMLElement): TableData {
  return this.model.snapshot();
}
```

### setData() -- Model-First Update

```typescript
public setData(newData: Partial<TableData>): void {
  this.model.replaceAll(
    normalizeTableData({ ...this.model.snapshot(), ...newData }, this.config)
  );

  if (!this.api.blocks.isSyncingFromYjs) {
    this.cellBlocks?.deleteAllBlocks();
  }

  this.rerender();
}
```

### Block Mutation Sync (model <- DOM events)

When block-added/block-removed events fire, TableCellBlocks updates the model instead of querying DOM:

```typescript
// On block-removed:
const cell = this.model.findCellForBlock(blockId);  // O(1) via blockCellMap
if (cell) {
  this.model.removeBlockFromCell(cell.row, cell.col, blockId);
}

// On block-added (replacement):
const cell = this.model.findCellForBlock(removedBlockId);  // O(1)
if (cell) {
  this.model.addBlockToCell(cell.row, cell.col, newBlockId);
}
```

### Structural Operations (Model-First)

Example -- deleteRow:
```typescript
// Before (DOM-first, races):
deleteRowWithBlockCleanup(gridEl, rowIndex, grid, cellBlocks);

// After (Model-first, atomic):
const op = this.model.deleteRow(rowIndex);
this.cellBlocks.deleteBlocks(op.blocksToDelete);
this.grid.deleteRow(gridEl, op.index);
```

Example -- paste:
```typescript
// Before: expandGridForPaste -> DOM changes -> pasteCellPayload per cell
// After: expand model -> paste into model -> single DOM re-render
for (let r = 0; r < neededNewRows; r++) this.model.addRow();
for (let c = 0; c < neededNewCols; c++) this.model.addColumn(undefined, halfWidth);
// ... create blocks, update model cells ...
this.rerender();
```

## Eliminations

### removedBlockCells (Map<number, HTMLElement>)

**Why it existed:** Track which cell a removed block was in so replacements go to the correct cell. Used flat-list index as key, which shifts when other blocks change.

**Eliminated by:** `blockCellMap` provides O(1) lookup by block ID. No index shifting. No DOM queries.

### cellsPendingCheck (Set<HTMLElement>)

**Why it existed:** After block removal, defer empty-cell checks to avoid spurious paragraphs during replace operations. Added ALL cells to the set on every removal.

**Eliminated by:** Model knows exactly which cell lost a block. Check only that specific cell. Replace operations update model atomically (remove + add in same cell), so the cell is never transiently empty.

## File Changes

### New Files
- `src/tools/table/table-model.ts` -- TableModel class

### Modified Files
- `src/tools/table/index.ts` -- Use TableModel; change save(), setData(), operations
- `src/tools/table/table-cell-blocks.ts` -- Update model instead of DOM queries; remove cellsPendingCheck and removedBlockCells
- `src/tools/table/table-core.ts` -- Remove getData() (no longer needed)
- `src/tools/table/table-operations.ts` -- Operations get block IDs from model, not DOM
- `src/tools/table/table-row-col-action-handler.ts` -- Use model for structural operations

### Unchanged Files
- `src/tools/table/table-resize.ts` -- Visual-only DOM operations
- `src/tools/table/table-cell-clipboard.ts` -- Parse/serialize unchanged
- `src/tools/table/table-cell-selection.ts` -- DOM-based selection unchanged
- `src/tools/table/table-add-controls.ts` -- Callbacks unchanged
- `src/tools/table/table-row-col-drag.ts` -- DOM drag unchanged
- `src/tools/table/types.ts` -- CellContent, TableData unchanged

## Migration Strategy

Each step is independently verifiable with existing E2E tests:

1. Build TableModel with full unit test coverage
2. Wire Table.save() to use model (biggest risk reduction, smallest change)
3. Wire structural operations (addRow, deleteRow, etc.) through model
4. Wire block mutation events through model
5. Remove DOM-reading fallbacks, cellsPendingCheck, removedBlockCells
6. Remove TableGrid.getData()

## Risks

| Risk | Mitigation |
|------|------------|
| Model-DOM divergence (new bug class) | Model invariant assertions; E2E tests at each migration step |
| Regression in undo/redo | Existing E2E undo/redo tests; add new ones for structural operations |
| Performance (extra data structure) | Map lookups are O(1); model is tiny relative to DOM |
| Scope creep | Strict migration steps; each step independently shippable |
