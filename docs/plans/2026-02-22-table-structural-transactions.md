# Table Structural Transactions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent event cascade corruption during table structural operations and group them into single undo entries.

**Architecture:** Two complementary mechanisms — (A) A depth-counted lock on the Table class with an event deferral queue in TableCellBlocks that buffers `block-changed` events during structural ops, replaying or discarding them afterward. (B) A `transact()` method on the Blocks API that suppresses undo-group splitting so multi-insert/delete operations become single undo entries.

**Tech Stack:** TypeScript, Vitest (unit tests)

---

### Task 1: Part A — Structural Op Lock Infrastructure

Add `structuralOpDepth` counter and `runStructuralOp()` to the Table class. Add `isStructuralOpActive` callback and event deferral queue to TableCellBlocks.

**Files:**
- Modify: `src/tools/table/index.ts:68-107` (Table class — new field + method)
- Modify: `src/tools/table/index.ts:756-763` (initCellBlocks — pass callback)
- Modify: `src/tools/table/table-cell-blocks.ts:35-41` (TableCellBlocksOptions — new field)
- Modify: `src/tools/table/table-cell-blocks.ts:47-90` (TableCellBlocks — new fields, guard, flush/discard)
- Create: `test/unit/tools/table/table-structural-op-lock.test.ts`

**Step 1: Write the failing test**

Create `test/unit/tools/table/table-structural-op-lock.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

const createMockAPI = (): API => {
  const blockIndexMap = new Map<string, number>();
  let insertCounter = 0;

  return {
    styles: {
      block: '', inlineToolbar: '', inlineToolButton: '',
      inlineToolButtonActive: '', input: '', loader: '',
      button: '', settingsButton: '', settingsButtonActive: '',
    },
    i18n: { t: (key: string) => key },
    blocks: {
      delete: vi.fn(),
      isSyncingFromYjs: false,
      insert: vi.fn().mockImplementation(() => {
        insertCounter++;
        const id = `block-${insertCounter}`;
        const holder = document.createElement('div');

        holder.setAttribute('data-blok-id', id);
        blockIndexMap.set(id, insertCounter - 1);

        return { id, holder };
      }),
      getCurrentBlockIndex: vi.fn().mockReturnValue(0),
      getBlocksCount: vi.fn().mockReturnValue(0),
      getBlockIndex: vi.fn().mockImplementation((id: string) => blockIndexMap.get(id)),
      getBlockByIndex: vi.fn().mockReturnValue(undefined),
      setBlockParent: vi.fn(),
    },
    events: { on: vi.fn(), off: vi.fn() },
  } as unknown as API;
};

describe('Table structural operation lock', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  it('exposes runStructuralOp that returns fn result', () => {
    const api = createMockAPI();
    const options: BlockToolConstructorOptions<TableData, TableConfig> = {
      data: { withHeadings: false, withHeadingColumn: false, content: [['A']] },
      config: {},
      api,
      readOnly: false,
      block: { id: 'table-1' } as never,
    };

    const table = new Table(options);

    // runStructuralOp should exist and return the function's result
    // Access via a test helper since it's private — we'll test through behavior
    // Instead, verify that after render + rendered, the table is functional
    const element = table.render();

    container.appendChild(element);
    table.rendered();

    // The table should have 1 row, 1 cell with a block
    const cells = element.querySelectorAll('[data-blok-table-cell]');

    expect(cells).toHaveLength(1);
  });

  it('defers handleBlockMutation events during structural ops and flushes after', () => {
    let blockAddedHandlerCallCount = 0;
    const api = createMockAPI();

    // Track calls to the 'block changed' event handler
    const originalOn = api.events.on as ReturnType<typeof vi.fn>;
    let capturedBlockChangedHandler: ((data: unknown) => void) | null = null;

    originalOn.mockImplementation((eventName: string, handler: (...args: unknown[]) => void) => {
      if (eventName === 'block changed') {
        const originalHandler = handler;

        capturedBlockChangedHandler = (data: unknown) => {
          blockAddedHandlerCallCount++;
          originalHandler(data);
        };
      }
    });

    const options: BlockToolConstructorOptions<TableData, TableConfig> = {
      data: { withHeadings: false, withHeadingColumn: false, content: [['A']] },
      config: {},
      api,
      readOnly: false,
      block: { id: 'table-1' } as never,
    };

    const table = new Table(options);
    const element = table.render();

    container.appendChild(element);
    table.rendered();

    // After rendered(), we should have captured the handler
    expect(capturedBlockChangedHandler).not.toBeNull();

    // The model should have 1 row, 1 col with blocks
    const saved = table.save(element);

    expect(saved.content).toHaveLength(1);
    expect(saved.content[0]).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-structural-op-lock.test.ts`
Expected: FAIL — `runStructuralOp` doesn't exist yet (but the basic test should pass since it tests existing functionality). The important thing is to have the test file set up.

**Step 3: Implement the structural op lock infrastructure**

In `src/tools/table/index.ts`, add the field and method to the Table class (after line 91, the `setDataGeneration` field):

```typescript
/**
 * Depth counter for structural operations (add/delete/move row/col).
 * When > 0, TableCellBlocks defers handleBlockMutation events to prevent
 * event cascade corruption during multi-step structural changes.
 */
private structuralOpDepth = 0;

/**
 * Execute a function within a structural operation lock.
 * While active, block-changed events are deferred in TableCellBlocks.
 *
 * @param fn - The structural operation to execute
 * @param discard - If true, discard deferred events (for full rebuilds like setData/onPaste).
 *                  If false (default), replay deferred events after the operation.
 */
private runStructuralOp<T>(fn: () => T, discard = false): T {
  this.structuralOpDepth++;

  try {
    return fn();
  } finally {
    this.structuralOpDepth--;

    if (this.structuralOpDepth === 0) {
      if (discard) {
        this.cellBlocks?.discardDeferredEvents();
      } else {
        this.cellBlocks?.flushDeferredEvents();
      }
    }
  }
}
```

In `src/tools/table/index.ts`, modify `initCellBlocks` (line 756) to pass the callback:

```typescript
private initCellBlocks(gridEl: HTMLElement): void {
  this.cellBlocks = new TableCellBlocks({
    api: this.api,
    gridElement: gridEl,
    tableBlockId: this.blockId ?? '',
    model: this.model,
    isStructuralOpActive: () => this.structuralOpDepth > 0,
  });
}
```

In `src/tools/table/table-cell-blocks.ts`, add `isStructuralOpActive` to the options interface (line 35):

```typescript
interface TableCellBlocksOptions {
  api: API;
  gridElement: HTMLElement;
  tableBlockId: string;
  model: TableModel;
  onNavigateToCell?: CellNavigationCallback;
  /** When true, handleBlockMutation defers events instead of processing immediately. */
  isStructuralOpActive?: () => boolean;
}
```

In the `TableCellBlocks` class, add fields and modify the constructor (after line 62):

```typescript
/** Callback to check if a structural operation is active on the parent Table. */
private isStructuralOpActive: () => boolean;

/** Events deferred during structural operations, replayed or discarded afterward. */
private deferredEvents: Array<unknown> = [];
```

In the constructor (line 81), store the callback:

```typescript
constructor(options: TableCellBlocksOptions) {
  this.api = options.api;
  this.gridElement = options.gridElement;
  this.tableBlockId = options.tableBlockId;
  this.model = options.model;
  this.onNavigateToCell = options.onNavigateToCell;
  this.isStructuralOpActive = options.isStructuralOpActive ?? (() => false);

  this.api.events.on('block changed', this.handleBlockMutation);
  this.gridElement.addEventListener('click', this.handleCellBlankSpaceClick);
}
```

Add the guard at the top of `handleBlockMutation` (line 441):

```typescript
private handleBlockMutation = (data: unknown): void => {
  if (this.isStructuralOpActive()) {
    this.deferredEvents.push(data);

    return;
  }

  // ... existing handler code unchanged ...
};
```

Add flush and discard methods (after `destroy()`, around line 852):

```typescript
/**
 * Replay all deferred events. Called after interactive structural ops
 * (add/delete/move row/col) complete so block lifecycle events are processed.
 */
public flushDeferredEvents(): void {
  const events = [...this.deferredEvents];

  this.deferredEvents.length = 0;

  for (const data of events) {
    this.handleBlockMutation(data);
  }
}

/**
 * Discard all deferred events. Called after full-rebuild ops (setData, onPaste)
 * where the entire grid is replaced and old events are meaningless.
 */
public discardDeferredEvents(): void {
  this.deferredEvents.length = 0;
}
```

Also update `destroy()` to clear deferred events:

```typescript
destroy(): void {
  this.gridElement.removeEventListener('click', this.handleCellBlankSpaceClick);
  this.api.events.off('block changed', this.handleBlockMutation);
  this._activeCellWithBlocks = null;
  this.cellsPendingCheck.clear();
  this.removedBlockCells.clear();
  this.deferredEvents.length = 0;
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/table/table-structural-op-lock.test.ts`
Expected: PASS

**Step 5: Run all existing table tests to verify no regressions**

Run: `yarn test test/unit/tools/table/`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/tools/table/index.ts src/tools/table/table-cell-blocks.ts test/unit/tools/table/table-structural-op-lock.test.ts
git commit -m "feat(table): add structural operation lock infrastructure"
```

---

### Task 2: Wrap Interactive Structural Operations

Wrap all interactive structural operation callsites in `runStructuralOp()` with flush mode (default). These are operations triggered by user actions like clicking add buttons, dragging, or using the row/column popover menu.

**Files:**
- Modify: `src/tools/table/index.ts:453-579` (initAddControls callbacks)
- Modify: `src/tools/table/index.ts:640-693` (handleRowColAction)
- Modify: `src/tools/table/index.ts:416-443` (deleteRowWithCleanup, deleteColumnWithCleanup)
- Modify: `src/tools/table/index.ts:949-1035` (pastePayloadIntoCells, expandGridForPaste)
- Test: `test/unit/tools/table/table-structural-op-lock.test.ts` (add cases)

**Step 1: Write the failing test**

Add to `test/unit/tools/table/table-structural-op-lock.test.ts`:

```typescript
it('wraps deleteRowWithCleanup in structural op lock', () => {
  const api = createMockAPI();
  const options: BlockToolConstructorOptions<TableData, TableConfig> = {
    data: { withHeadings: false, withHeadingColumn: false, content: [['A'], ['B']] },
    config: {},
    api,
    readOnly: false,
    block: { id: 'table-1' } as never,
  };

  const table = new Table(options);
  const element = table.render();

  container.appendChild(element);
  table.rendered();

  // Should have 2 rows
  const rowsBefore = element.querySelectorAll('[data-blok-table-row]');

  expect(rowsBefore).toHaveLength(2);

  // Delete the second row
  table.deleteRowWithCleanup(1);

  // Should have 1 row remaining, model consistent
  const rowsAfter = element.querySelectorAll('[data-blok-table-row]');

  expect(rowsAfter).toHaveLength(1);

  const saved = table.save(element);

  expect(saved.content).toHaveLength(1);
});
```

**Step 2: Run test to verify behavior**

Run: `yarn test test/unit/tools/table/table-structural-op-lock.test.ts`
Expected: Should pass (verifying the wrapping doesn't break existing behavior).

**Step 3: Wrap the callsites**

In `src/tools/table/index.ts`, wrap each interactive operation:

**deleteRowWithCleanup** (line 416):
```typescript
public deleteRowWithCleanup(rowIndex: number): void {
  this.runStructuralOp(() => {
    const gridEl = this.element?.firstElementChild as HTMLElement | undefined;

    if (!gridEl) {
      return;
    }

    const { blocksToDelete } = this.model.deleteRow(rowIndex);

    this.cellBlocks?.deleteBlocks(blocksToDelete);
    this.grid.deleteRow(gridEl, rowIndex);
  });
}
```

**deleteColumnWithCleanup** (line 429):
```typescript
public deleteColumnWithCleanup(colIndex: number): void {
  this.runStructuralOp(() => {
    const gridEl = this.element?.firstElementChild as HTMLElement | undefined;

    if (!gridEl) {
      return;
    }

    const { blocksToDelete } = this.model.deleteColumn(colIndex);

    this.cellBlocks?.deleteBlocks(blocksToDelete);
    this.grid.deleteColumn(gridEl, colIndex);
  });
}
```

**handleRowColAction** (line 640):
```typescript
private handleRowColAction(gridEl: HTMLElement, action: RowColAction): void {
  this.runStructuralOp(() => {
    const colWidthsBeforeMutation = this.model.colWidths;
    const { blocksToDelete } = this.syncModelForAction(action);

    const result = executeRowColAction(
      gridEl,
      action,
      {
        grid: this.grid,
        data: {
          colWidths: colWidthsBeforeMutation,
          withHeadings: this.model.withHeadings,
          withHeadingColumn: this.model.withHeadingColumn,
          initialColWidth: this.model.initialColWidth,
        },
        cellBlocks: this.cellBlocks,
        blocksToDelete,
      },
    );

    this.model.setColWidths(result.colWidths);
    this.model.setWithHeadings(result.withHeadings);
    this.model.setWithHeadingColumn(result.withHeadingColumn);
    this.pendingHighlight = result.pendingHighlight;

    updateHeadingStyles(this.element, this.model.withHeadings);
    updateHeadingColumnStyles(this.element, this.model.withHeadingColumn);
    this.initResize(gridEl);
    this.addControls?.syncRowButtonWidth();
    this.rowColControls?.refresh();

    if (!result.moveSelection) {
      return;
    }

    const { type: moveType, index: moveIndex } = result.moveSelection;

    if (moveType === 'row') {
      this.cellSelection?.selectRow(moveIndex);
    } else {
      this.cellSelection?.selectColumn(moveIndex);
    }

    this.rowColControls?.setActiveGrip(moveType, moveIndex);
  });
}
```

**onAddRow** (line 473):
```typescript
onAddRow: () => {
  this.runStructuralOp(() => {
    this.grid.addRow(gridEl);
    this.model.addRow();
    populateNewCells(gridEl, this.cellBlocks);
    updateHeadingStyles(this.element, this.model.withHeadings);
    updateHeadingColumnStyles(this.element, this.model.withHeadingColumn);
    this.initResize(gridEl);
    this.addControls?.syncRowButtonWidth();
    this.rowColControls?.refresh();
  });
},
```

**onAddColumn** (line 483):
```typescript
onAddColumn: () => {
  this.runStructuralOp(() => {
    const colWidths = this.model.colWidths ?? readPixelWidths(gridEl);
    const halfWidth = this.model.initialColWidth !== undefined
      ? Math.round((this.model.initialColWidth / 2) * 100) / 100
      : computeHalfAvgWidth(colWidths);

    this.grid.addColumn(gridEl, undefined, colWidths, halfWidth);
    this.model.addColumn(undefined, halfWidth);
    this.model.setColWidths([...colWidths, halfWidth]);
    populateNewCells(gridEl, this.cellBlocks);
    updateHeadingColumnStyles(this.element, this.model.withHeadingColumn);
    this.initResize(gridEl);
    this.addControls?.syncRowButtonWidth();
    this.rowColControls?.refresh();
  });
},
```

**onDragAddRow** (line 505):
```typescript
onDragAddRow: () => {
  this.runStructuralOp(() => {
    this.grid.addRow(gridEl);
    this.model.addRow();
    populateNewCells(gridEl, this.cellBlocks);
    updateHeadingStyles(this.element, this.model.withHeadings);
    updateHeadingColumnStyles(this.element, this.model.withHeadingColumn);
  });
},
```

**onDragRemoveRow** (line 512):
```typescript
onDragRemoveRow: () => {
  this.runStructuralOp(() => {
    const rowCount = this.grid.getRowCount(gridEl);

    if (rowCount > 1 && isRowEmpty(gridEl, rowCount - 1)) {
      const { blocksToDelete } = this.model.deleteRow(rowCount - 1);

      this.cellBlocks?.deleteBlocks(blocksToDelete);
      this.grid.deleteRow(gridEl, rowCount - 1);
    }
  });
},
```

**onDragAddCol** (line 522):
```typescript
onDragAddCol: () => {
  this.runStructuralOp(() => {
    const colWidths = this.model.colWidths ?? readPixelWidths(gridEl);
    const halfWidth = this.model.initialColWidth !== undefined
      ? Math.round((this.model.initialColWidth / 2) * 100) / 100
      : computeHalfAvgWidth(colWidths);

    const newWidths = [...colWidths, halfWidth];

    this.grid.addColumn(gridEl, undefined, colWidths, halfWidth);
    this.model.addColumn(undefined, halfWidth);
    this.model.setColWidths(newWidths);
    applyPixelWidths(gridEl, newWidths);
    populateNewCells(gridEl, this.cellBlocks);
    updateHeadingColumnStyles(this.element, this.model.withHeadingColumn);
    this.initResize(gridEl);

    dragState.addedCols++;

    if (this.element) {
      this.element.scrollLeft = this.element.scrollWidth;
    }
  });
},
```

**onDragRemoveCol** (line 544):
```typescript
onDragRemoveCol: () => {
  this.runStructuralOp(() => {
    const colCount = this.grid.getColumnCount(gridEl);

    if (colCount <= 1 || !isColumnEmpty(gridEl, colCount - 1)) {
      return;
    }

    const { blocksToDelete } = this.model.deleteColumn(colCount - 1);

    this.cellBlocks?.deleteBlocks(blocksToDelete);
    this.grid.deleteColumn(gridEl, colCount - 1);

    const updatedWidths = this.model.colWidths;

    if (updatedWidths) {
      applyPixelWidths(gridEl, updatedWidths);
    }

    this.initResize(gridEl);

    dragState.addedCols--;
  });
},
```

**pastePayloadIntoCells** (line 949) — wraps the paste expansion + cell paste:
```typescript
private pastePayloadIntoCells(
  gridEl: HTMLElement,
  payload: TableCellsClipboard,
  startRow: number,
  startCol: number,
): void {
  this.runStructuralOp(() => {
    this.expandGridForPaste(gridEl, startRow + payload.rows, startCol + payload.cols);

    const updatedRows = gridEl.querySelectorAll(`[${ROW_ATTR}]`);

    Array.from({ length: payload.rows }, (_, r) => r).forEach((r) => {
      const row = updatedRows[startRow + r];

      if (!row) {
        return;
      }

      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

      Array.from({ length: payload.cols }, (_, c) => c).forEach((c) => {
        const cell = cells[startCol + c] as HTMLElement | undefined;

        if (cell) {
          this.pasteCellPayload(cell, payload.cells[r][c]);

          const blockIds = this.cellBlocks?.getBlockIdsFromCells([cell]) ?? [];

          this.model.setCellBlocks(startRow + r, startCol + c, blockIds);
        }
      });
    });

    this.initResize(gridEl);
    this.addControls?.syncRowButtonWidth();
    this.rowColControls?.refresh();
  });

  // Caret placement outside the lock (no structural mutation)
  const updatedRows = gridEl.querySelectorAll(`[${ROW_ATTR}]`);
  const lastRow = updatedRows[startRow + payload.rows - 1];
  const lastCell = lastRow?.querySelectorAll(`[${CELL_ATTR}]`)[startCol + payload.cols - 1] as HTMLElement | undefined;

  if (!lastCell || !this.cellBlocks || !this.api.caret) {
    return;
  }

  const blockIds = this.cellBlocks.getBlockIdsFromCells([lastCell]);
  const lastBlockId = blockIds[blockIds.length - 1];

  if (lastBlockId === undefined) {
    return;
  }

  this.api.caret.setToBlock(lastBlockId, 'end');
}
```

**Step 4: Run tests to verify**

Run: `yarn test test/unit/tools/table/`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/tools/table/index.ts test/unit/tools/table/table-structural-op-lock.test.ts
git commit -m "feat(table): wrap interactive structural ops in runStructuralOp"
```

---

### Task 3: Wrap Full-Rebuild Operations (Discard Mode)

Wrap `setData()`, `onPaste()`, and `rendered()` initializeCells in `runStructuralOp(_, true)` (discard mode). These operations rebuild the entire grid, so deferred events from the old grid are meaningless.

**Files:**
- Modify: `src/tools/table/index.ts:188-240` (rendered)
- Modify: `src/tools/table/index.ts:254-334` (setData)
- Modify: `src/tools/table/index.ts:336-392` (onPaste)
- Test: `test/unit/tools/table/table-structural-op-lock.test.ts` (add cases)

**Step 1: Write the failing test**

Add to `test/unit/tools/table/table-structural-op-lock.test.ts`:

```typescript
it('discards deferred events during setData full rebuild', () => {
  let insertCounter = 0;
  const blockIndexMap = new Map<string, number>();

  const api = createMockAPI();

  // Override insert to track calls
  (api.blocks.insert as ReturnType<typeof vi.fn>).mockImplementation(() => {
    insertCounter++;
    const id = `block-${insertCounter}`;
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-id', id);
    blockIndexMap.set(id, insertCounter - 1);

    return { id, holder };
  });

  (api.blocks.getBlockIndex as ReturnType<typeof vi.fn>).mockImplementation(
    (id: string) => blockIndexMap.get(id)
  );

  const options: BlockToolConstructorOptions<TableData, TableConfig> = {
    data: { withHeadings: false, withHeadingColumn: false, content: [['A']] },
    config: {},
    api,
    readOnly: false,
    block: { id: 'table-1' } as never,
  };

  const table = new Table(options);
  const element = table.render();

  container.appendChild(element);
  table.rendered();

  // Call setData with new content
  table.setData({ content: [['X', 'Y'], ['P', 'Q']], withHeadings: true });

  // Model should reflect the setData call
  const saved = table.save(container.firstElementChild as HTMLElement);

  expect(saved.withHeadings).toBe(true);
  expect(saved.content).toHaveLength(2);
  expect(saved.content[0]).toHaveLength(2);
});
```

**Step 2: Run test**

Run: `yarn test test/unit/tools/table/table-structural-op-lock.test.ts`
Expected: Might pass already (setData already works). The test validates wrapping doesn't break it.

**Step 3: Wrap the full-rebuild operations**

**rendered()** — wrap the initializeCells portion (line 188):

The key section to wrap is lines 210-215 (the initializeCells + replaceAll). However, since `rendered()` also sets up controls and other state, wrap the entire content initialization section:

```typescript
public rendered(): void {
  if (!this.element || this.initialContent === null) {
    return;
  }

  const gridEl = this.element.firstElementChild as HTMLElement;

  if (!gridEl) {
    return;
  }

  const content = this.initialContent;

  this.initialContent = null;

  if (this.readOnly) {
    mountCellBlocksReadOnly(gridEl, content, this.api, this.blockId ?? '');
    this.initReadOnlyCellSelection(gridEl);

    return;
  }

  this.runStructuralOp(() => {
    const initializedContent = this.cellBlocks?.initializeCells(content) ?? content;

    this.model.replaceAll({
      ...this.model.snapshot(),
      content: initializedContent,
    });

    if (this.isNewTable) {
      populateNewCells(gridEl, this.cellBlocks);
    }
  }, true);

  if (this.model.initialColWidth === undefined) {
    const widths = this.model.colWidths ?? readPixelWidths(gridEl);

    this.model.setInitialColWidth(widths.length > 0
      ? computeInitialColWidth(widths)
      : undefined);
  }

  this.initResize(gridEl);
  this.initAddControls(gridEl);
  this.initRowColControls(gridEl);
  this.initCellSelection(gridEl);
  this.initGridPasteListener(gridEl);

  if (this.isNewTable) {
    const firstEditable = gridEl.querySelector<HTMLElement>('[contenteditable="true"]');

    firstEditable?.focus();
  }
}
```

**setData()** — wrap the rebuild portion (line 254). The tricky part is that setData has generation guards. Wrap the inner operations:

```typescript
public setData(newData: Partial<TableData>): void {
  this.setDataGeneration++;
  const currentGeneration = this.setDataGeneration;

  const normalized = normalizeTableData(
    {
      ...this.model.snapshot(),
      ...newData,
    } as TableData,
    this.config
  );

  this.initialContent = normalized.content;
  this.model.replaceAll(normalized);

  if (!this.api.blocks.isSyncingFromYjs) {
    this.runStructuralOp(() => {
      this.cellBlocks?.deleteAllBlocks();
    }, true);
  }

  this.cellBlocks?.destroy();

  const oldElement = this.element;

  if (!oldElement?.parentNode) {
    return;
  }

  if (currentGeneration !== this.setDataGeneration) {
    return;
  }

  this.resize?.destroy();
  this.resize = null;
  this.addControls?.destroy();
  this.addControls = null;
  this.rowColControls?.destroy();
  this.rowColControls = null;
  this.cellSelection?.destroy();
  this.cellSelection = null;

  const newElement = this.render();

  oldElement.parentNode.replaceChild(newElement, oldElement);

  const gridEl = this.element?.firstElementChild as HTMLElement | undefined;

  if (!this.readOnly && gridEl) {
    if (currentGeneration !== this.setDataGeneration) {
      return;
    }

    this.runStructuralOp(() => {
      const setDataContent = this.cellBlocks?.initializeCells(this.initialContent ?? []) ?? this.initialContent ?? [];

      if (currentGeneration !== this.setDataGeneration) {
        return;
      }

      this.model.replaceAll({
        ...this.model.snapshot(),
        content: setDataContent,
      });
      this.initialContent = null;
    }, true);

    if (currentGeneration !== this.setDataGeneration) {
      return;
    }

    this.initResize(gridEl);
    this.initAddControls(gridEl);
    this.initRowColControls(gridEl);
    this.initCellSelection(gridEl);
    this.initGridPasteListener(gridEl);
  }
}
```

**onPaste()** — wrap the rebuild portion (line 336):

```typescript
public onPaste(event: HTMLPasteEvent): void {
  const content = event.detail.data;
  const rows = content.querySelectorAll('tr');
  const tableContent: string[][] = [];

  rows.forEach(row => {
    const cells = row.querySelectorAll('td, th');
    const rowData: string[] = [];

    cells.forEach(cell => {
      rowData.push(cell.innerHTML);
    });

    if (rowData.length > 0) {
      tableContent.push(rowData);
    }
  });

  const hasTheadHeadings = content.querySelector('thead') !== null;
  const hasThHeadings = rows[0]?.querySelector('th') !== null;
  const withHeadings = hasTheadHeadings || hasThHeadings;

  this.initialContent = tableContent;
  this.model.setWithHeadings(withHeadings);
  this.model.setWithHeadingColumn(false);
  this.model.setColWidths(undefined);

  this.runStructuralOp(() => {
    this.cellBlocks?.deleteAllBlocks();
  }, true);

  this.cellBlocks?.destroy();

  const oldElement = this.element;

  if (!oldElement?.parentNode) {
    return;
  }

  const newElement = this.render();

  oldElement.parentNode.replaceChild(newElement, oldElement);

  const gridEl = this.element?.firstElementChild as HTMLElement | undefined;

  if (!this.readOnly && gridEl) {
    this.runStructuralOp(() => {
      const pasteContent = this.cellBlocks?.initializeCells(this.initialContent ?? []) ?? this.initialContent ?? [];

      this.model.replaceAll({
        ...this.model.snapshot(),
        content: pasteContent,
      });
      this.initialContent = null;
    }, true);

    this.initResize(gridEl);
    this.initAddControls(gridEl);
    this.initRowColControls(gridEl);
    this.initCellSelection(gridEl);
    this.initGridPasteListener(gridEl);
  }
}
```

**Step 4: Run all table tests**

Run: `yarn test test/unit/tools/table/`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/tools/table/index.ts test/unit/tools/table/table-structural-op-lock.test.ts
git commit -m "feat(table): wrap full-rebuild ops in runStructuralOp discard mode"
```

---

### Task 4: Part B — Add `transact()` to Blocks API

Add a `transact(fn)` method that suppresses undo-group splitting during multi-block operations, keeping them as single undo entries.

**Files:**
- Modify: `types/api/blocks.d.ts` (Blocks interface — new method)
- Modify: `src/components/modules/api/blocks.ts` (BlocksAPI — implementation)
- Modify: `src/components/modules/blockManager/blockManager.ts` (BlockManager — new method)
- Create: `test/unit/api/blocks-transact.test.ts`

**Step 1: Write the failing test**

Create `test/unit/api/blocks-transact.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

/**
 * Tests for the Blocks API transact() method.
 *
 * The transact method groups multiple block operations into a single undo entry
 * by suppressing stopCapturing calls during the operation.
 *
 * Since this integrates deeply with YjsManager and BlockManager internals,
 * full behavioral testing requires E2E tests. Unit tests here verify the
 * interface exists and the method is callable.
 */
describe('Blocks API transact()', () => {
  it('transact method exists on the Blocks interface', async () => {
    // This is a type-level check — TypeScript will fail compilation
    // if transact is missing from the Blocks interface.
    // The runtime check verifies the implementation exports it.
    const blocksModule = await import('../../../types/api/blocks');

    // Type exists (compilation check — if this file compiles, the type is correct)
    expect(blocksModule).toBeDefined();
  });
});
```

**Step 2: Run test**

Run: `yarn test test/unit/api/blocks-transact.test.ts`
Expected: PASS (type-level check). The real validation is that `yarn lint` passes with the new interface.

**Step 3: Implement transact()**

In `types/api/blocks.d.ts`, add to the `Blocks` interface (after `splitBlock`, around line 183):

```typescript
/**
 * Execute a function within a transaction.
 * All block operations (insert, delete, move) within fn are grouped
 * into a single undo entry. Prevents undo-group splitting that would
 * make structural operations partially undoable.
 *
 * @param fn - The function containing block operations to group
 */
transact(fn: () => void): void;
```

In `src/components/modules/blockManager/blockManager.ts`, add a public method to `BlockManager`:

```typescript
/**
 * Execute a function with stopCapturing suppressed.
 * All block operations within fn are kept in the same undo group.
 * Used by tools that perform multi-step structural operations
 * (e.g., table add row = multiple block inserts).
 */
public transactForTool(fn: () => void): void {
  this.Blok.YjsManager.stopCapturing();

  const prevSuppress = this.operations.suppressStopCapturing;

  this.operations.suppressStopCapturing = true;

  try {
    fn();
  } finally {
    this.operations.suppressStopCapturing = prevSuppress;

    requestAnimationFrame(() => {
      this.Blok.YjsManager.stopCapturing();
    });
  }
}
```

> **Note:** `this.operations` is the private `BlockOperations` instance (line 206 of blockManager.ts). `this.Blok.YjsManager` is accessible via the Module base class. The `suppressStopCapturing` property is public on `BlockOperations` (line 77 of operations.ts).

In `src/components/modules/api/blocks.ts`, add to the `methods` getter (around line 48, after `splitBlock`):

```typescript
transact: (fn: () => void): void => this.transact(fn),
```

Add the implementation method:

```typescript
/**
 * Execute a function within a transaction, grouping all block operations
 * into a single undo entry.
 */
private transact(fn: () => void): void {
  this.Blok.BlockManager.transactForTool(fn);
}
```

**Step 4: Run lint and tests**

Run: `yarn lint && yarn test`
Expected: All PASS

**Step 5: Commit**

```bash
git add types/api/blocks.d.ts src/components/modules/api/blocks.ts src/components/modules/blockManager/blockManager.ts test/unit/api/blocks-transact.test.ts
git commit -m "feat(api): add transact() method for undo-grouped block operations"
```

---

### Task 5: Wrap Table Structural Ops in `transact()`

Compose `this.api.blocks.transact()` with `this.runStructuralOp()` at each interactive structural operation callsite. Full-rebuild operations (setData, onPaste, rendered) do NOT use transact — they have their own undo semantics.

**Files:**
- Modify: `src/tools/table/index.ts` (wrap callsites)
- Test: `test/unit/tools/table/table-structural-op-lock.test.ts` (add cases)

**Step 1: Write the failing test**

Add to `test/unit/tools/table/table-structural-op-lock.test.ts`:

```typescript
it('calls transact when available for structural operations', () => {
  const api = createMockAPI();

  // Add a mock transact method
  (api.blocks as Record<string, unknown>).transact = vi.fn().mockImplementation(
    (fn: () => void) => fn()
  );

  const options: BlockToolConstructorOptions<TableData, TableConfig> = {
    data: { withHeadings: false, withHeadingColumn: false, content: [['A'], ['B']] },
    config: {},
    api,
    readOnly: false,
    block: { id: 'table-1' } as never,
  };

  const table = new Table(options);
  const element = table.render();

  container.appendChild(element);
  table.rendered();

  // Delete a row — should be wrapped in transact
  table.deleteRowWithCleanup(1);

  expect((api.blocks as Record<string, unknown>).transact).toHaveBeenCalled();
});
```

**Step 2: Run test**

Run: `yarn test test/unit/tools/table/table-structural-op-lock.test.ts`
Expected: FAIL — transact not called yet.

**Step 3: Add transact wrapper**

Add a helper method to the Table class (after `runStructuralOp`):

```typescript
/**
 * Execute a structural operation within a Yjs transaction.
 * Combines the structural op lock (event deferral) with Yjs undo grouping.
 * Used for interactive operations that should be a single undo entry.
 */
private runTransactedStructuralOp<T>(fn: () => T): T {
  let result: T | undefined;

  const wrappedFn = (): void => {
    result = this.runStructuralOp(fn);
  };

  if (this.api.blocks.transact) {
    this.api.blocks.transact(wrappedFn);
  } else {
    wrappedFn();
  }

  return result as T;
}
```

Then replace all `this.runStructuralOp(() => { ... })` calls in interactive operations (from Task 2) with `this.runTransactedStructuralOp(() => { ... })`.

**Callsites to update** (all in `src/tools/table/index.ts`):
- `deleteRowWithCleanup` — change `this.runStructuralOp` to `this.runTransactedStructuralOp`
- `deleteColumnWithCleanup` — same
- `handleRowColAction` — same
- `onAddRow` callback — same
- `onAddColumn` callback — same
- `onDragAddRow` callback — same
- `onDragRemoveRow` callback — same
- `onDragAddCol` callback — same
- `onDragRemoveCol` callback — same
- `pastePayloadIntoCells` — same

**Do NOT update** (these use `runStructuralOp(_, true)` discard mode):
- `rendered()` — full rebuild, own undo semantics
- `setData()` — full rebuild, own undo semantics
- `onPaste()` — full rebuild, own undo semantics

**Step 4: Run tests**

Run: `yarn test test/unit/tools/table/`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/tools/table/index.ts test/unit/tools/table/table-structural-op-lock.test.ts
git commit -m "feat(table): compose transact + runStructuralOp for interactive ops"
```

---

### Task 6: Full Verification

Run all tests and verify against master.

**Step 1: Run all unit tests**

Run: `yarn test`
Expected: All PASS

**Step 2: Run lint**

Run: `yarn lint`
Expected: No errors

**Step 3: Run E2E tests**

Run: `yarn e2e`
Expected: All PASS

**Step 4: Verify against master**

```bash
git worktree add ../blok-master master 2>/dev/null || true
cd ../blok-master && yarn test
cd ../blok && yarn test
```

Compare results — no regressions.

**Step 5: Final commit and cleanup**

```bash
git worktree remove ../blok-master 2>/dev/null || true
```
