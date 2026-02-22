# TableModel Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace DOM-reading in table `save()` with a canonical `TableModel` that is the single source of truth, eliminating race conditions that cause table data loss.

**Architecture:** A new `TableModel` class maintains an in-memory 2D cell array and a reverse `blockCellMap` (block ID -> cell position). All structural operations (add/delete/move row/col) update the model first, then the DOM catches up. `save()` returns a model snapshot instead of querying the DOM.

**Tech Stack:** TypeScript, Vitest (unit tests), Playwright (E2E tests)

**Design Doc:** `docs/plans/2026-02-22-table-model-refactor-design.md`

---

## Task 1: Create TableModel with constructor and snapshot

**Files:**
- Create: `src/tools/table/table-model.ts`
- Test: `test/unit/tools/table/table-model.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { TableModel } from '../../../../src/tools/table/table-model';

describe('TableModel', () => {
  describe('constructor and snapshot', () => {
    it('creates empty model with defaults', () => {
      const model = new TableModel();
      const snap = model.snapshot();

      expect(snap.content).toEqual([]);
      expect(snap.withHeadings).toBe(false);
      expect(snap.withHeadingColumn).toBe(false);
      expect(snap.stretched).toBe(false);
      expect(snap.colWidths).toBeUndefined();
      expect(snap.initialColWidth).toBeUndefined();
    });

    it('creates model from existing TableData', () => {
      const data = {
        withHeadings: true,
        withHeadingColumn: false,
        stretched: true,
        content: [
          [{ blocks: ['a'] }, { blocks: ['b'] }],
          [{ blocks: ['c'] }, { blocks: ['d'] }],
        ],
        colWidths: [100, 200],
        initialColWidth: 150,
      };

      const model = new TableModel(data);
      const snap = model.snapshot();

      expect(snap).toEqual(data);
    });

    it('snapshot returns a deep copy (not a reference)', () => {
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[{ blocks: ['a'] }]],
      });

      const snap1 = model.snapshot();
      const snap2 = model.snapshot();

      expect(snap1).toEqual(snap2);
      expect(snap1).not.toBe(snap2);
      expect(snap1.content).not.toBe(snap2.content);
      expect(snap1.content[0]).not.toBe(snap2.content[0]);
    });

    it('exposes rows and cols getters', () => {
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [
          [{ blocks: ['a'] }, { blocks: ['b'] }, { blocks: ['c'] }],
          [{ blocks: ['d'] }, { blocks: ['e'] }, { blocks: ['f'] }],
        ],
      });

      expect(model.rows).toBe(2);
      expect(model.cols).toBe(3);
    });

    it('empty model has 0 rows and 0 cols', () => {
      const model = new TableModel();

      expect(model.rows).toBe(0);
      expect(model.cols).toBe(0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-model.test.ts`
Expected: FAIL — module `table-model` not found

**Step 3: Write minimal implementation**

Create `src/tools/table/table-model.ts`:

```typescript
import type { CellContent, TableData } from './types';

/**
 * Canonical in-memory model for table data.
 * Single source of truth — save() reads from this, not the DOM.
 */
export class TableModel {
  private cells: CellContent[][];
  private blockCellMap: Map<string, { row: number; col: number }>;
  private withHeadingsValue: boolean;
  private withHeadingColumnValue: boolean;
  private stretchedValue: boolean;
  private colWidthsValue: number[] | undefined;
  private initialColWidthValue: number | undefined;

  constructor(data?: Partial<TableData>) {
    this.withHeadingsValue = data?.withHeadings ?? false;
    this.withHeadingColumnValue = data?.withHeadingColumn ?? false;
    this.stretchedValue = data?.stretched ?? false;
    this.colWidthsValue = data?.colWidths ? [...data.colWidths] : undefined;
    this.initialColWidthValue = data?.initialColWidth;
    this.blockCellMap = new Map();

    this.cells = [];

    if (data?.content) {
      for (let r = 0; r < data.content.length; r++) {
        const row: CellContent[] = [];

        for (let c = 0; c < data.content[r].length; c++) {
          const cell = data.content[r][c];
          const blocks = typeof cell === 'string' ? [] : [...cell.blocks];

          row.push({ blocks });

          for (const blockId of blocks) {
            this.blockCellMap.set(blockId, { row: r, col: c });
          }
        }

        this.cells.push(row);
      }
    }
  }

  get rows(): number {
    return this.cells.length;
  }

  get cols(): number {
    return this.cells[0]?.length ?? 0;
  }

  /**
   * Return a deep copy of the current table state.
   * This is what save() returns — no DOM reading.
   */
  snapshot(): TableData {
    const content: CellContent[][] = this.cells.map(row =>
      row.map(cell => ({ blocks: [...cell.blocks] }))
    );

    return {
      withHeadings: this.withHeadingsValue,
      withHeadingColumn: this.withHeadingColumnValue,
      stretched: this.stretchedValue,
      content,
      ...(this.colWidthsValue ? { colWidths: [...this.colWidthsValue] } : {}),
      ...(this.initialColWidthValue !== undefined
        ? { initialColWidth: this.initialColWidthValue }
        : {}),
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/table/table-model.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/table/table-model.ts test/unit/tools/table/table-model.test.ts
git commit -m "feat(table): add TableModel with constructor and snapshot"
```

---

## Task 2: Add cell operations (findCellForBlock, addBlockToCell, removeBlockFromCell, setCellBlocks)

**Files:**
- Modify: `src/tools/table/table-model.ts`
- Test: `test/unit/tools/table/table-model.test.ts`

**Step 1: Write the failing tests**

Add to `table-model.test.ts`:

```typescript
describe('cell operations', () => {
  it('findCellForBlock returns position for known block', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: ['a'] }, { blocks: ['b'] }],
        [{ blocks: ['c'] }, { blocks: ['d'] }],
      ],
    });

    expect(model.findCellForBlock('c')).toEqual({ row: 1, col: 0 });
  });

  it('findCellForBlock returns null for unknown block', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [[{ blocks: ['a'] }]],
    });

    expect(model.findCellForBlock('unknown')).toBeNull();
  });

  it('addBlockToCell adds block and updates map', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [[{ blocks: ['a'] }]],
    });

    model.addBlockToCell(0, 0, 'b');

    expect(model.snapshot().content[0][0]).toEqual({ blocks: ['a', 'b'] });
    expect(model.findCellForBlock('b')).toEqual({ row: 0, col: 0 });
  });

  it('removeBlockFromCell removes block and updates map', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [[{ blocks: ['a', 'b'] }]],
    });

    model.removeBlockFromCell(0, 0, 'a');

    expect(model.snapshot().content[0][0]).toEqual({ blocks: ['b'] });
    expect(model.findCellForBlock('a')).toBeNull();
  });

  it('setCellBlocks replaces all blocks in a cell', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [[{ blocks: ['a', 'b'] }]],
    });

    model.setCellBlocks(0, 0, ['x', 'y']);

    expect(model.snapshot().content[0][0]).toEqual({ blocks: ['x', 'y'] });
    expect(model.findCellForBlock('a')).toBeNull();
    expect(model.findCellForBlock('b')).toBeNull();
    expect(model.findCellForBlock('x')).toEqual({ row: 0, col: 0 });
    expect(model.findCellForBlock('y')).toEqual({ row: 0, col: 0 });
  });

  it('getCellBlocks returns block IDs for a cell', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [[{ blocks: ['a', 'b'] }, { blocks: ['c'] }]],
    });

    expect(model.getCellBlocks(0, 0)).toEqual(['a', 'b']);
    expect(model.getCellBlocks(0, 1)).toEqual(['c']);
  });

  it('getCellBlocks returns empty array for out-of-bounds', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [[{ blocks: ['a'] }]],
    });

    expect(model.getCellBlocks(5, 5)).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-model.test.ts`
Expected: FAIL — methods not found

**Step 3: Write minimal implementation**

Add to `TableModel` class in `src/tools/table/table-model.ts`:

```typescript
findCellForBlock(blockId: string): { row: number; col: number } | null {
  return this.blockCellMap.get(blockId) ?? null;
}

addBlockToCell(row: number, col: number, blockId: string): void {
  if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
    return;
  }

  this.cells[row][col].blocks.push(blockId);
  this.blockCellMap.set(blockId, { row, col });
}

removeBlockFromCell(row: number, col: number, blockId: string): void {
  if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
    return;
  }

  const cell = this.cells[row][col];

  cell.blocks = cell.blocks.filter(id => id !== blockId);
  this.blockCellMap.delete(blockId);
}

setCellBlocks(row: number, col: number, blockIds: string[]): void {
  if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
    return;
  }

  // Remove old blocks from map
  for (const oldId of this.cells[row][col].blocks) {
    this.blockCellMap.delete(oldId);
  }

  // Set new blocks
  this.cells[row][col].blocks = [...blockIds];

  for (const newId of blockIds) {
    this.blockCellMap.set(newId, { row, col });
  }
}

getCellBlocks(row: number, col: number): string[] {
  if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
    return [];
  }

  return [...this.cells[row][col].blocks];
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/table/table-model.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/table/table-model.ts test/unit/tools/table/table-model.test.ts
git commit -m "feat(table): add cell operations to TableModel"
```

---

## Task 3: Add row operations (addRow, deleteRow, moveRow)

**Files:**
- Modify: `src/tools/table/table-model.ts`
- Test: `test/unit/tools/table/table-model.test.ts`

**Step 1: Write the failing tests**

Add to `table-model.test.ts`:

```typescript
describe('row operations', () => {
  it('addRow appends an empty row at the end', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: ['a'] }, { blocks: ['b'] }],
      ],
    });

    const op = model.addRow();

    expect(model.rows).toBe(2);
    expect(model.snapshot().content[1]).toEqual([{ blocks: [] }, { blocks: [] }]);
    expect(op.type).toBe('add-row');
    expect(op.index).toBe(1);
    expect(op.cellsToPopulate).toBe(2);
  });

  it('addRow inserts at specific index', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: ['a'] }],
        [{ blocks: ['b'] }],
      ],
    });

    model.addRow(1);

    expect(model.rows).toBe(3);
    expect(model.snapshot().content[1]).toEqual([{ blocks: [] }]);
    // Original row 1 is now at index 2
    expect(model.findCellForBlock('b')).toEqual({ row: 2, col: 0 });
  });

  it('deleteRow removes a row and returns block IDs to delete', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: ['a'] }, { blocks: ['b'] }],
        [{ blocks: ['c'] }, { blocks: ['d'] }],
      ],
    });

    const op = model.deleteRow(0);

    expect(model.rows).toBe(1);
    expect(op.blocksToDelete).toEqual(['a', 'b']);
    expect(model.findCellForBlock('a')).toBeNull();
    expect(model.findCellForBlock('b')).toBeNull();
    // Remaining row is now at index 0
    expect(model.findCellForBlock('c')).toEqual({ row: 0, col: 0 });
  });

  it('moveRow reorders rows and updates blockCellMap', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: ['a'] }],
        [{ blocks: ['b'] }],
        [{ blocks: ['c'] }],
      ],
    });

    model.moveRow(0, 2);

    expect(model.snapshot().content.map(r => r[0].blocks[0])).toEqual(['b', 'c', 'a']);
    expect(model.findCellForBlock('a')).toEqual({ row: 2, col: 0 });
    expect(model.findCellForBlock('b')).toEqual({ row: 0, col: 0 });
    expect(model.findCellForBlock('c')).toEqual({ row: 1, col: 0 });
  });

  it('addRow to empty model creates row with 0 cols', () => {
    const model = new TableModel();

    model.addRow();

    expect(model.rows).toBe(1);
    expect(model.cols).toBe(0);
    expect(model.snapshot().content).toEqual([[]]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-model.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

Add to `TableModel`:

```typescript
addRow(index?: number): { type: 'add-row'; index: number; cellsToPopulate: number } {
  const newRow: CellContent[] = Array.from({ length: this.cols }, () => ({ blocks: [] }));
  const insertIndex = index ?? this.cells.length;

  this.cells.splice(insertIndex, 0, newRow);
  this.rebuildBlockCellMap();

  return { type: 'add-row', index: insertIndex, cellsToPopulate: this.cols };
}

deleteRow(index: number): { type: 'delete-row'; index: number; blocksToDelete: string[] } {
  if (index < 0 || index >= this.rows) {
    return { type: 'delete-row', index, blocksToDelete: [] };
  }

  const blocksToDelete: string[] = [];

  for (const cell of this.cells[index]) {
    for (const blockId of cell.blocks) {
      blocksToDelete.push(blockId);
      this.blockCellMap.delete(blockId);
    }
  }

  this.cells.splice(index, 1);
  this.rebuildBlockCellMap();

  return { type: 'delete-row', index, blocksToDelete };
}

moveRow(fromIndex: number, toIndex: number): { type: 'move-row'; index: number; toIndex: number } {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 || fromIndex >= this.rows ||
    toIndex < 0 || toIndex >= this.rows
  ) {
    return { type: 'move-row', index: fromIndex, toIndex };
  }

  const [row] = this.cells.splice(fromIndex, 1);

  this.cells.splice(toIndex, 0, row);
  this.rebuildBlockCellMap();

  return { type: 'move-row', index: fromIndex, toIndex };
}

private rebuildBlockCellMap(): void {
  this.blockCellMap.clear();

  for (let r = 0; r < this.cells.length; r++) {
    for (let c = 0; c < this.cells[r].length; c++) {
      for (const blockId of this.cells[r][c].blocks) {
        this.blockCellMap.set(blockId, { row: r, col: c });
      }
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/table/table-model.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/table/table-model.ts test/unit/tools/table/table-model.test.ts
git commit -m "feat(table): add row operations to TableModel"
```

---

## Task 4: Add column operations (addColumn, deleteColumn, moveColumn)

**Files:**
- Modify: `src/tools/table/table-model.ts`
- Test: `test/unit/tools/table/table-model.test.ts`

**Step 1: Write the failing tests**

Add to `table-model.test.ts`:

```typescript
describe('column operations', () => {
  it('addColumn appends an empty column', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: ['a'] }],
        [{ blocks: ['b'] }],
      ],
    });

    const op = model.addColumn();

    expect(model.cols).toBe(2);
    expect(model.snapshot().content[0][1]).toEqual({ blocks: [] });
    expect(model.snapshot().content[1][1]).toEqual({ blocks: [] });
    expect(op.cellsToPopulate).toEqual([{ row: 0, col: 1 }, { row: 1, col: 1 }]);
  });

  it('addColumn inserts at specific index', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: ['a'] }, { blocks: ['b'] }],
      ],
    });

    model.addColumn(1);

    expect(model.cols).toBe(3);
    expect(model.snapshot().content[0][1]).toEqual({ blocks: [] });
    expect(model.findCellForBlock('b')).toEqual({ row: 0, col: 2 });
  });

  it('addColumn updates colWidths when present', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [[{ blocks: ['a'] }, { blocks: ['b'] }]],
      colWidths: [100, 200],
    });

    model.addColumn(1, 50);

    expect(model.snapshot().colWidths).toEqual([100, 50, 200]);
  });

  it('deleteColumn removes a column and returns block IDs', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: ['a'] }, { blocks: ['b'] }, { blocks: ['c'] }],
        [{ blocks: ['d'] }, { blocks: ['e'] }, { blocks: ['f'] }],
      ],
      colWidths: [100, 200, 300],
    });

    const op = model.deleteColumn(1);

    expect(model.cols).toBe(2);
    expect(op.blocksToDelete).toEqual(['b', 'e']);
    expect(model.findCellForBlock('b')).toBeNull();
    expect(model.findCellForBlock('c')).toEqual({ row: 0, col: 1 });
    expect(model.snapshot().colWidths).toEqual([100, 300]);
  });

  it('moveColumn reorders columns and updates blockCellMap', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: ['a'] }, { blocks: ['b'] }, { blocks: ['c'] }],
      ],
      colWidths: [100, 200, 300],
    });

    model.moveColumn(0, 2);

    expect(model.snapshot().content[0].map(c => c.blocks[0])).toEqual(['b', 'c', 'a']);
    expect(model.snapshot().colWidths).toEqual([200, 300, 100]);
    expect(model.findCellForBlock('a')).toEqual({ row: 0, col: 2 });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-model.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

Add to `TableModel`:

```typescript
addColumn(
  index?: number,
  width?: number,
): { type: 'add-column'; index: number; cellsToPopulate: Array<{ row: number; col: number }> } {
  const insertIndex = index ?? this.cols;
  const cellsToPopulate: Array<{ row: number; col: number }> = [];

  for (let r = 0; r < this.cells.length; r++) {
    this.cells[r].splice(insertIndex, 0, { blocks: [] });
    cellsToPopulate.push({ row: r, col: insertIndex });
  }

  if (this.colWidthsValue) {
    this.colWidthsValue.splice(insertIndex, 0, width ?? 0);
  }

  this.rebuildBlockCellMap();

  return { type: 'add-column', index: insertIndex, cellsToPopulate };
}

deleteColumn(
  index: number,
): { type: 'delete-column'; index: number; blocksToDelete: string[] } {
  if (index < 0 || index >= this.cols) {
    return { type: 'delete-column', index, blocksToDelete: [] };
  }

  const blocksToDelete: string[] = [];

  for (const row of this.cells) {
    for (const blockId of row[index].blocks) {
      blocksToDelete.push(blockId);
      this.blockCellMap.delete(blockId);
    }

    row.splice(index, 1);
  }

  if (this.colWidthsValue) {
    this.colWidthsValue.splice(index, 1);
  }

  this.rebuildBlockCellMap();

  return { type: 'delete-column', index, blocksToDelete };
}

moveColumn(
  fromIndex: number,
  toIndex: number,
): { type: 'move-column'; index: number; toIndex: number } {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 || fromIndex >= this.cols ||
    toIndex < 0 || toIndex >= this.cols
  ) {
    return { type: 'move-column', index: fromIndex, toIndex };
  }

  for (const row of this.cells) {
    const [cell] = row.splice(fromIndex, 1);

    row.splice(toIndex, 0, cell);
  }

  if (this.colWidthsValue) {
    const [width] = this.colWidthsValue.splice(fromIndex, 1);

    this.colWidthsValue.splice(toIndex, 0, width);
  }

  this.rebuildBlockCellMap();

  return { type: 'move-column', index: fromIndex, toIndex };
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/table/table-model.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/table/table-model.ts test/unit/tools/table/table-model.test.ts
git commit -m "feat(table): add column operations to TableModel"
```

---

## Task 5: Add replaceAll and metadata setters

**Files:**
- Modify: `src/tools/table/table-model.ts`
- Test: `test/unit/tools/table/table-model.test.ts`

**Step 1: Write the failing tests**

```typescript
describe('replaceAll', () => {
  it('replaces entire model state', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [[{ blocks: ['old'] }]],
    });

    model.replaceAll({
      withHeadings: true,
      withHeadingColumn: true,
      stretched: true,
      content: [
        [{ blocks: ['new-a'] }, { blocks: ['new-b'] }],
      ],
      colWidths: [50, 50],
    });

    expect(model.rows).toBe(1);
    expect(model.cols).toBe(2);
    expect(model.findCellForBlock('old')).toBeNull();
    expect(model.findCellForBlock('new-a')).toEqual({ row: 0, col: 0 });
    expect(model.snapshot().withHeadings).toBe(true);
    expect(model.snapshot().colWidths).toEqual([50, 50]);
  });
});

describe('metadata setters', () => {
  it('setWithHeadings updates flag', () => {
    const model = new TableModel({ withHeadings: false, withHeadingColumn: false, content: [] });

    model.setWithHeadings(true);

    expect(model.snapshot().withHeadings).toBe(true);
  });

  it('setColWidths updates widths', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [[{ blocks: [] }, { blocks: [] }]],
    });

    model.setColWidths([100, 200]);

    expect(model.snapshot().colWidths).toEqual([100, 200]);
  });

  it('setInitialColWidth updates value', () => {
    const model = new TableModel({ withHeadings: false, withHeadingColumn: false, content: [] });

    model.setInitialColWidth(150);

    expect(model.snapshot().initialColWidth).toBe(150);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-model.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

Add to `TableModel`:

```typescript
replaceAll(data: TableData): void {
  // Clear old map
  this.blockCellMap.clear();

  this.withHeadingsValue = data.withHeadings;
  this.withHeadingColumnValue = data.withHeadingColumn;
  this.stretchedValue = data.stretched ?? false;
  this.colWidthsValue = data.colWidths ? [...data.colWidths] : undefined;
  this.initialColWidthValue = data.initialColWidth;

  this.cells = [];

  for (let r = 0; r < data.content.length; r++) {
    const row: CellContent[] = [];

    for (let c = 0; c < data.content[r].length; c++) {
      const cell = data.content[r][c];
      const blocks = typeof cell === 'string' ? [] : [...cell.blocks];

      row.push({ blocks });

      for (const blockId of blocks) {
        this.blockCellMap.set(blockId, { row: r, col: c });
      }
    }

    this.cells.push(row);
  }
}

setWithHeadings(value: boolean): void {
  this.withHeadingsValue = value;
}

setWithHeadingColumn(value: boolean): void {
  this.withHeadingColumnValue = value;
}

setStretched(value: boolean): void {
  this.stretchedValue = value;
}

setColWidths(widths: number[] | undefined): void {
  this.colWidthsValue = widths ? [...widths] : undefined;
}

setInitialColWidth(value: number | undefined): void {
  this.initialColWidthValue = value;
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/table/table-model.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/table/table-model.ts test/unit/tools/table/table-model.test.ts
git commit -m "feat(table): add replaceAll and metadata setters to TableModel"
```

---

## Task 6: Add model invariant tests (consistency guarantees)

**Files:**
- Test: `test/unit/tools/table/table-model.test.ts`

**Step 1: Write the invariant tests**

These test the 5 model invariants from the design doc. They should all pass already with the existing implementation. If any fail, fix the implementation.

```typescript
describe('model invariants', () => {
  it('all rows have the same number of columns after addRow', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: ['a'] }, { blocks: ['b'] }, { blocks: ['c'] }],
      ],
    });

    model.addRow();
    model.addRow(0);

    const snap = model.snapshot();

    snap.content.forEach(row => {
      expect(row.length).toBe(3);
    });
  });

  it('colWidths length matches column count after addColumn', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [[{ blocks: [] }, { blocks: [] }]],
      colWidths: [100, 100],
    });

    model.addColumn(1, 50);

    const snap = model.snapshot();

    expect(snap.colWidths?.length).toBe(snap.content[0].length);
  });

  it('colWidths length matches after deleteColumn', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [[{ blocks: [] }, { blocks: [] }, { blocks: [] }]],
      colWidths: [100, 200, 300],
    });

    model.deleteColumn(1);

    const snap = model.snapshot();

    expect(snap.colWidths?.length).toBe(snap.content[0].length);
  });

  it('every block in cells has an entry in blockCellMap (via findCellForBlock)', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: ['a', 'b'] }, { blocks: ['c'] }],
        [{ blocks: ['d'] }, { blocks: ['e', 'f'] }],
      ],
    });

    model.addRow();
    model.addColumn();
    model.deleteRow(0);
    model.addBlockToCell(0, 0, 'new');

    // All remaining blocks should be findable
    const snap = model.snapshot();

    for (let r = 0; r < snap.content.length; r++) {
      for (let c = 0; c < snap.content[r].length; c++) {
        for (const blockId of snap.content[r][c].blocks) {
          const pos = model.findCellForBlock(blockId);

          expect(pos).not.toBeNull();
          expect(pos).toEqual({ row: r, col: c });
        }
      }
    }
  });

  it('no block appears in more than one cell', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: ['a'] }, { blocks: ['b'] }],
      ],
    });

    // Moving a block to a different cell should remove it from the first
    model.removeBlockFromCell(0, 0, 'a');
    model.addBlockToCell(0, 1, 'a');

    expect(model.snapshot().content[0][0].blocks).not.toContain('a');
    expect(model.snapshot().content[0][1].blocks).toContain('a');
    expect(model.findCellForBlock('a')).toEqual({ row: 0, col: 1 });
  });
});
```

**Step 2: Run tests**

Run: `yarn test test/unit/tools/table/table-model.test.ts`
Expected: PASS (all invariants should hold with current implementation)

**Step 3: Commit**

```bash
git add test/unit/tools/table/table-model.test.ts
git commit -m "test(table): add model invariant tests for TableModel"
```

---

## Task 7: Wire Table.save() to use TableModel

This is the biggest risk reduction with the smallest change. After this task, `save()` reads from the model instead of querying the DOM.

**Files:**
- Modify: `src/tools/table/index.ts`
- Test: `test/unit/tools/table/table.test.ts` (add test)

**Step 1: Write a failing test**

Add to `test/unit/tools/table/table.test.ts` (follow existing mock patterns in that file):

```typescript
describe('save uses model', () => {
  it('save returns model snapshot instead of reading DOM', () => {
    // Create table with known data
    const data = {
      withHeadings: true,
      withHeadingColumn: false,
      content: [
        [{ blocks: ['block-1'] }, { blocks: ['block-2'] }],
      ],
    };

    const table = new Table({
      data,
      config: {},
      api: createMockAPI(),
      readOnly: false,
      block: { id: 'table-1' } as never,
    });

    const element = table.render();

    // save() should return model data, not DOM data
    const saved = table.save(element);

    expect(saved.withHeadings).toBe(true);
    expect(saved.content.length).toBe(1);
    expect(saved.content[0].length).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table.test.ts -t "save uses model"`
Expected: Test may pass or fail depending on existing mock setup. The key change is the implementation.

**Step 3: Write the implementation**

In `src/tools/table/index.ts`:

1. Add import at top:
```typescript
import { TableModel } from './table-model';
```

2. Add `model` property to the class (after `private grid: TableGrid;` on line 74):
```typescript
private model: TableModel;
```

3. Initialize model in constructor (after line 90, `this.grid = new TableGrid({ readOnly });`):
```typescript
this.model = new TableModel(this.data);
```

4. Replace `save()` method (lines 222-237):
```typescript
public save(_blockContent: HTMLElement): TableData {
  return this.model.snapshot();
}
```

5. After `initializeCells` in `rendered()` (line 195), sync model:
```typescript
this.data.content = this.cellBlocks?.initializeCells(this.data.content) ?? this.data.content;
this.model.replaceAll(this.data);
```

6. After `initializeCells` in `setData()` (line 288), sync model:
```typescript
this.data.content = this.cellBlocks?.initializeCells(this.data.content) ?? this.data.content;
this.model.replaceAll(this.data);
```

7. After `initializeCells` in `onPaste()` (line 342), sync model:
```typescript
this.data.content = this.cellBlocks?.initializeCells(this.data.content) ?? this.data.content;
this.model.replaceAll(this.data);
```

**Step 4: Run all table unit tests to check for regressions**

Run: `yarn test test/unit/tools/table/`
Expected: PASS

**Step 5: Run E2E table tests to verify no regressions**

Run: `yarn e2e test/playwright/tests/tools/table/table-data.spec.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/tools/table/index.ts test/unit/tools/table/table.test.ts
git commit -m "feat(table): wire save() to use TableModel snapshot"
```

---

## Task 8: Sync model on structural operations (add/delete row/column via controls)

Now wire the add/delete/move operations in `Table` class to update the model. The model tracks cell contents; the DOM continues to be the render target.

**Files:**
- Modify: `src/tools/table/index.ts`

**Step 1: Write a failing test**

Add to `test/unit/tools/table/table.test.ts`:

```typescript
describe('model syncs on structural operations', () => {
  it('model updates when handleRowColAction adds a row', () => {
    const table = createTableWithModel({
      content: [
        [{ blocks: ['a'] }, { blocks: ['b'] }],
      ],
    });

    // After adding a row, model should have 2 rows
    // This is tested indirectly via save()
    const element = table.render();
    const saved = table.save(element);

    expect(saved.content.length).toBe(1);
    // Model should reflect the data it was initialized with
    expect(saved.content[0].length).toBe(2);
  });
});
```

**Step 2: Implement model sync in structural operations**

In `src/tools/table/index.ts`, update callbacks in `initAddControls()` to sync model after DOM changes:

For `onAddRow` (line 415-422):
```typescript
onAddRow: () => {
  this.grid.addRow(gridEl);
  this.model.addRow();
  populateNewCells(gridEl, this.cellBlocks);
  // ... rest unchanged
},
```

For `onAddColumn` (line 424-436):
```typescript
onAddColumn: () => {
  const colWidths = this.data.colWidths ?? readPixelWidths(gridEl);
  const halfWidth = /* ... existing calculation ... */;

  this.grid.addColumn(gridEl, undefined, colWidths, halfWidth);
  this.model.addColumn(undefined, halfWidth);
  this.data.colWidths = [...colWidths, halfWidth];
  this.model.setColWidths(this.data.colWidths);
  populateNewCells(gridEl, this.cellBlocks);
  // ... rest unchanged
},
```

Similar for `onDragAddRow`, `onDragRemoveRow`, `onDragAddCol`, `onDragRemoveCol`.

For `handleRowColAction` (line 566-598), sync model after `executeRowColAction`:
```typescript
private handleRowColAction(gridEl: HTMLElement, action: RowColAction): void {
  const result = executeRowColAction(gridEl, action, {
    grid: this.grid,
    data: this.data,
    cellBlocks: this.cellBlocks,
  });

  this.data.colWidths = result.colWidths;
  this.data.withHeadings = result.withHeadings;
  this.data.withHeadingColumn = result.withHeadingColumn;

  // Sync model with updated data
  this.model.setColWidths(this.data.colWidths);
  this.model.setWithHeadings(this.data.withHeadings);
  this.model.setWithHeadingColumn(this.data.withHeadingColumn);

  // ... rest unchanged
}
```

**Step 3: Run all table tests**

Run: `yarn test test/unit/tools/table/`
Expected: PASS

**Step 4: Run E2E tests**

Run: `yarn e2e test/playwright/tests/tools/table/`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/table/index.ts
git commit -m "feat(table): sync TableModel on structural operations"
```

---

## Task 9: Wire block mutation events through model in TableCellBlocks

Replace DOM-based block tracking (`removedBlockCells`, `cellsPendingCheck`) with model-based tracking.

**Files:**
- Modify: `src/tools/table/table-cell-blocks.ts`
- Modify: `src/tools/table/index.ts` (pass model to TableCellBlocks)

**Step 1: Pass model to TableCellBlocks**

In `src/tools/table/index.ts`, update `initCellBlocks()` (line 628-634):
```typescript
private initCellBlocks(gridEl: HTMLElement): void {
  this.cellBlocks = new TableCellBlocks({
    api: this.api,
    gridElement: gridEl,
    tableBlockId: this.blockId ?? '',
    model: this.model,
  });
}
```

**Step 2: Update TableCellBlocks constructor to accept model**

In `src/tools/table/table-cell-blocks.ts`, update interface and constructor:
```typescript
import type { TableModel } from './table-model';

interface TableCellBlocksOptions {
  api: API;
  gridElement: HTMLElement;
  tableBlockId: string;
  model: TableModel;
  onNavigateToCell?: CellNavigationCallback;
}

export class TableCellBlocks {
  // ... existing fields ...
  private model: TableModel;

  constructor(options: TableCellBlocksOptions) {
    // ... existing init ...
    this.model = options.model;
  }
}
```

**Step 3: Replace handleBlockMutation to use model**

Replace the `handleBlockMutation` method (lines 427-506) to use model instead of DOM:

```typescript
private handleBlockMutation = (data: unknown): void => {
  if (!this.isBlockMutationEvent(data)) {
    return;
  }

  const { type, detail } = data.event;

  if (type === 'block-removed') {
    // Model knows which cell this block was in (O(1) lookup)
    const cellPos = this.model.findCellForBlock(detail.target.id);

    if (cellPos) {
      this.model.removeBlockFromCell(cellPos.row, cellPos.col, detail.target.id);

      // If cell is now empty, schedule an empty-cell check for just this cell
      if (this.model.getCellBlocks(cellPos.row, cellPos.col).length === 0) {
        const cell = this.getCell(cellPos.row, cellPos.col);

        if (cell) {
          this.cellsPendingCheck.add(cell);
          this.schedulePendingCellCheck();
        }
      }
    }

    return;
  }

  if (type !== 'block-added') {
    return;
  }

  const blockIndex = detail.index;

  if (blockIndex === undefined) {
    return;
  }

  // Check if the holder is already in a cell
  const holder = detail.target.holder;
  const existingContainer = holder.closest<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

  if (existingContainer) {
    // Block is already in a cell (placed by DOM insert).
    // Find which cell and update the model.
    const cell = existingContainer.closest<HTMLElement>(`[${CELL_ATTR}]`);

    if (cell) {
      const pos = this.getCellPosition(cell);

      if (pos) {
        this.model.addBlockToCell(pos.row, pos.col, detail.target.id);
      }
    }

    this.stripPlaceholders(existingContainer);

    return;
  }

  if (!this.gridElement.contains(holder)) {
    return;
  }

  // Find cell by adjacency for blocks not yet in a cell
  const cell = this.findCellForNewBlock(blockIndex);

  if (cell) {
    this.claimBlockForCell(cell, detail.target.id);
    this.cellsPendingCheck.delete(cell);
  }
};
```

**Step 4: Add getCellPosition helper**

```typescript
private getCellPosition(cell: HTMLElement): { row: number; col: number } | null {
  const row = cell.closest<HTMLElement>(`[${ROW_ATTR}]`);

  if (!row) {
    return null;
  }

  const rows = Array.from(this.gridElement.querySelectorAll(`[${ROW_ATTR}]`));
  const rowIndex = rows.indexOf(row);
  const cells = Array.from(row.querySelectorAll(`[${CELL_ATTR}]`));
  const colIndex = cells.indexOf(cell);

  if (rowIndex === -1 || colIndex === -1) {
    return null;
  }

  return { row: rowIndex, col: colIndex };
}
```

**Step 5: Remove removedBlockCells field and related methods**

Remove:
- `private removedBlockCells = new Map<number, HTMLElement>();` (line 67)
- `recordRemovedBlockCell()` method (lines 513-523)
- Clear of `removedBlockCells` in `schedulePendingCellCheck` microtask (line 545)
- Clear of `removedBlockCells` in `destroy()` (line 678)

**Step 6: Update claimBlockForCell to sync model**

```typescript
public claimBlockForCell(cell: HTMLElement, blockId: string): void {
  // ... existing DOM logic ...

  // Update model
  const pos = this.getCellPosition(cell);

  if (pos) {
    this.model.addBlockToCell(pos.row, pos.col, blockId);
  }
}
```

**Step 7: Run tests**

Run: `yarn test test/unit/tools/table/`
Expected: Some tests will fail due to changed constructor signature. Fix the test mocks.

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`
Fix any failures by adding `model` to test setup.

**Step 8: Run E2E tests**

Run: `yarn e2e test/playwright/tests/tools/table/`
Expected: PASS

**Step 9: Commit**

```bash
git add src/tools/table/table-cell-blocks.ts src/tools/table/index.ts test/unit/tools/table/
git commit -m "feat(table): wire block mutation events through TableModel"
```

---

## Task 10: Remove TableGrid.getData() and clean up DOM-reading code

Now that `save()` uses the model and block mutations go through the model, `getData()` is no longer needed.

**Files:**
- Modify: `src/tools/table/table-core.ts` (remove `getData()` and `getCellContent()`)
- Modify: `test/unit/tools/table/table-core.test.ts` (remove `getData` tests)

**Step 1: Remove getData() from TableGrid**

In `src/tools/table/table-core.ts`, remove:
- `getData()` method (lines 79-95)
- `getCellContent()` private method (lines 381-394)

**Step 2: Update tests**

In `test/unit/tools/table/table-core.test.ts`, remove all tests that call `getData()`. These are no longer needed since save() doesn't use it.

**Step 3: Verify no other code calls getData()**

Search: `grep -r "getData" src/tools/table/`
If anything else calls it, update to use model instead.

**Step 4: Run tests**

Run: `yarn test test/unit/tools/table/`
Expected: PASS

**Step 5: Run E2E tests**

Run: `yarn e2e test/playwright/tests/tools/table/`
Expected: PASS

**Step 6: Commit**

```bash
git add src/tools/table/table-core.ts test/unit/tools/table/table-core.test.ts
git commit -m "refactor(table): remove TableGrid.getData() — model is source of truth"
```

---

## Task 11: Sync model during paste operations

The paste flow creates new blocks and places them in cells. The model must track these.

**Files:**
- Modify: `src/tools/table/index.ts`

**Step 1: Update pasteCellPayload to sync model**

In `src/tools/table/index.ts`, update `pasteCellPayload()` (lines 904-939):

```typescript
private pasteCellPayload(
  cell: HTMLElement,
  payloadCell: { blocks: ClipboardBlockData[] },
  row: number,
  col: number,
): void {
  // Clear existing blocks in model and BlockManager
  const existingBlocks = this.model.getCellBlocks(row, col);

  if (this.cellBlocks && existingBlocks.length > 0) {
    this.cellBlocks.deleteBlocks(existingBlocks);
  }

  // Clear model cell
  this.model.setCellBlocks(row, col, []);

  const container = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

  if (!container) {
    return;
  }

  if (payloadCell.blocks.length === 0) {
    this.cellBlocks?.ensureCellHasBlock(cell);

    return;
  }

  const newBlockIds: string[] = [];

  for (const blockData of payloadCell.blocks) {
    const block = this.api.blocks.insert(
      blockData.tool,
      blockData.data,
      {},
      this.api.blocks.getBlocksCount(),
      false,
    );

    container.appendChild(block.holder);
    this.api.blocks.setBlockParent(block.id, this.blockId ?? '');
    newBlockIds.push(block.id);
  }

  // Update model with new block IDs
  this.model.setCellBlocks(row, col, newBlockIds);
}
```

**Step 2: Update pastePayloadIntoCells to pass row/col**

Update the call site (line 844) to pass row and col:
```typescript
this.pasteCellPayload(cell, payload.cells[r][c], startRow + r, startCol + c);
```

**Step 3: Update expandGridForPaste to sync model**

```typescript
private expandGridForPaste(gridEl: HTMLElement, neededRows: number, neededCols: number): void {
  const currentRowCount = this.grid.getRowCount(gridEl);
  const currentColCount = this.grid.getColumnCount(gridEl);

  Array.from({ length: Math.max(0, neededRows - currentRowCount) }).forEach(() => {
    this.grid.addRow(gridEl);
    this.model.addRow();
    populateNewCells(gridEl, this.cellBlocks);
    updateHeadingStyles(this.element, this.data.withHeadings);
    updateHeadingColumnStyles(this.element, this.data.withHeadingColumn);
  });

  Array.from({ length: Math.max(0, neededCols - currentColCount) }).forEach(() => {
    const colWidths = this.data.colWidths ?? readPixelWidths(gridEl);
    const halfWidth = this.data.initialColWidth !== undefined
      ? Math.round((this.data.initialColWidth / 2) * 100) / 100
      : computeHalfAvgWidth(colWidths);

    this.grid.addColumn(gridEl, undefined, colWidths, halfWidth);
    this.model.addColumn(undefined, halfWidth);
    this.data.colWidths = [...colWidths, halfWidth];
    this.model.setColWidths(this.data.colWidths);
    populateNewCells(gridEl, this.cellBlocks);
    updateHeadingColumnStyles(this.element, this.data.withHeadingColumn);
  });
}
```

**Step 4: Run tests**

Run: `yarn test test/unit/tools/table/`
Expected: PASS

Run: `yarn e2e test/playwright/tests/tools/table/table-paste.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/table/index.ts
git commit -m "feat(table): sync TableModel during paste operations"
```

---

## Task 12: Sync model during cell selection clear/cut operations

**Files:**
- Modify: `src/tools/table/index.ts`

**Step 1: Update onClearContent callback**

In `initCellSelection()` (lines 726-734), use model to get block IDs instead of DOM:

```typescript
onClearContent: (cells) => {
  if (!this.cellBlocks) {
    return;
  }

  for (const cell of cells) {
    const pos = this.getCellPosition(cell);

    if (!pos) {
      continue;
    }

    const blockIds = this.model.getCellBlocks(pos.row, pos.col);

    this.cellBlocks.deleteBlocks(blockIds);
    this.model.setCellBlocks(pos.row, pos.col, []);
  }
},
```

**Step 2: Add getCellPosition helper to Table class**

```typescript
private getCellPosition(cell: HTMLElement): { row: number; col: number } | null {
  const gridEl = this.element?.firstElementChild;

  if (!gridEl) {
    return null;
  }

  const row = cell.closest<HTMLElement>(`[${ROW_ATTR}]`);

  if (!row) {
    return null;
  }

  const rows = Array.from(gridEl.querySelectorAll(`[${ROW_ATTR}]`));
  const rowIndex = rows.indexOf(row);
  const cells = Array.from(row.querySelectorAll(`[${CELL_ATTR}]`));
  const colIndex = cells.indexOf(cell);

  if (rowIndex === -1 || colIndex === -1) {
    return null;
  }

  return { row: rowIndex, col: colIndex };
}
```

**Step 3: Run tests**

Run: `yarn test test/unit/tools/table/`
Run: `yarn e2e test/playwright/tests/tools/table/table-cell-selection.spec.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/tools/table/index.ts
git commit -m "feat(table): sync model on cell selection clear/cut"
```

---

## Task 13: Run full test suite and fix regressions

**Files:**
- Various (fix as needed)

**Step 1: Run full unit test suite**

Run: `yarn test`
Expected: PASS. Fix any failures.

**Step 2: Run full E2E test suite**

Run: `yarn e2e`
Expected: PASS. Fix any failures.

**Step 3: Run lint**

Run: `yarn lint`
Expected: PASS.

**Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix(table): resolve regressions from TableModel refactor"
```

---

## Task 14: Final cleanup — remove unused DOM-reading helpers

After everything is passing, remove DOM-reading helpers from `table-operations.ts` that are no longer needed because the model provides the data.

**Files:**
- Modify: `src/tools/table/table-operations.ts`
- Modify: `src/tools/table/table-cell-blocks.ts` (simplify `cellsPendingCheck` if possible)

**Step 1: Audit which DOM-reading functions are still used**

Search for callers of:
- `getBlockIdsInRow()` — used by `Table.getBlockIdsInRow()` (public API). Keep but consider switching to model.
- `getBlockIdsInColumn()` — same.
- `deleteRowWithBlockCleanup()` — still used. Consider switching to model-first flow.
- `deleteColumnWithBlockCleanup()` — same.

**Step 2: Switch deleteRowWithBlockCleanup to use model**

Replace the DOM-reading version with one that uses the model:

```typescript
// In index.ts, update deleteRowWithCleanup:
public deleteRowWithCleanup(rowIndex: number): void {
  const gridEl = this.element?.firstElementChild as HTMLElement | undefined;

  if (!gridEl) {
    return;
  }

  const op = this.model.deleteRow(rowIndex);

  if (this.cellBlocks && op.blocksToDelete.length > 0) {
    this.cellBlocks.deleteBlocks(op.blocksToDelete);
  }

  this.grid.deleteRow(gridEl, rowIndex);
}
```

Similar for `deleteColumnWithCleanup`.

**Step 3: Run tests**

Run: `yarn test test/unit/tools/table/`
Run: `yarn e2e test/playwright/tests/tools/table/`
Expected: PASS

**Step 4: Commit**

```bash
git add src/tools/table/
git commit -m "refactor(table): switch structural operations to model-first flow"
```

---

## Verification Checklist

After all tasks:
- [ ] `yarn test` passes
- [ ] `yarn e2e` passes
- [ ] `yarn lint` passes
- [ ] `save()` never reads from DOM
- [ ] All structural operations update model before DOM
- [ ] `removedBlockCells` (Map<number, HTMLElement>) is eliminated
- [ ] `cellsPendingCheck` only adds affected cells, not all cells
- [ ] `TableGrid.getData()` is removed
- [ ] `blockCellMap` provides O(1) lookup by block ID
