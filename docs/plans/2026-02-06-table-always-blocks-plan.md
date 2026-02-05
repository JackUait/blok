# Table Always-Blocks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every table cell always contain blocks (at minimum one paragraph), eliminating the dual plain-text/block-based mode.

**Architecture:** Every cell is a block container from creation. Cells never have `contenteditable` — their child blocks do. The `TableCellBlocks` class becomes the core cell content manager instead of an optional add-on. Block lifecycle events (insert, convert, remove) are intercepted to keep block DOM mounted inside cells.

**Tech Stack:** TypeScript, Vitest (unit), Playwright (E2E), DOM APIs

**Design doc:** `docs/plans/2026-02-06-table-always-blocks-design.md`

---

## Task 1: Update CellContent type and remove dual-mode type guard

**Files:**
- Modify: `src/tools/table/types.ts:8-15`
- Test: `test/unit/tools/table/table-cell-blocks.test.ts`

**Step 1: Write the failing test**

In `test/unit/tools/table/table-cell-blocks.test.ts`, update the existing `detectMarkdownListTrigger` tests to remove them (they test code we're deleting). But first, add a test for the new type:

```typescript
describe('CellContent type', () => {
  it('isCellWithBlocks always returns true for CellContent', async () => {
    const { isCellWithBlocks } = await import('../../../../src/tools/table/types');

    const cell = { blocks: ['block-1'] };

    expect(isCellWithBlocks(cell)).toBe(true);
  });
});
```

**Step 2: Run test to verify it passes (this is a type change, existing guard still works)**

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`

**Step 3: Update the types**

In `src/tools/table/types.ts`:

Change `CellContent` (line 8) from:
```typescript
export type CellContent = string | { blocks: string[] };
```
To:
```typescript
export type CellContent = { blocks: string[] };
```

Add a legacy input type for migration:
```typescript
export type LegacyCellContent = string | CellContent;
```

Update `isCellWithBlocks` (lines 13-15) — this becomes a migration helper:
```typescript
export const isCellWithBlocks = (cell: LegacyCellContent): cell is CellContent => {
  return typeof cell === 'object' && cell !== null && 'blocks' in cell;
};
```

Update `TableData.content` to use `LegacyCellContent` for input (loading data) and keep `CellContent` for runtime:
```typescript
export interface TableData extends BlockToolData {
  withHeadings: boolean;
  stretched?: boolean;
  content: LegacyCellContent[][];
  colWidths?: number[];
}
```

**Step 4: Fix any TypeScript errors caused by the type change**

Run: `yarn lint`

The compiler will flag every place that reads `CellContent` as a string. These are the exact locations we need to change in subsequent tasks. Note them but don't fix yet — we'll handle each in its own task.

**Step 5: Commit**

```bash
git add src/tools/table/types.ts test/unit/tools/table/table-cell-blocks.test.ts
git commit -m "refactor(table): update CellContent type to always-blocks model"
```

---

## Task 2: Remove markdown detection and plain-text conversion code

**Files:**
- Modify: `src/tools/table/table-cell-blocks.ts:7-18,115-182,326-427`
- Modify: `src/tools/table/index.ts:518-526`
- Test: `test/unit/tools/table/table-cell-blocks.test.ts`

**Step 1: Delete dead code tests**

In `test/unit/tools/table/table-cell-blocks.test.ts`, remove these test suites:
- `detectMarkdownListTrigger` (lines 65-111) — testing deleted function
- `handleCellInput` (lines 249-362) — testing deleted method
- `convertCellToBlocks` (lines 174-247) — testing deleted method

**Step 2: Run tests to confirm remaining tests still pass**

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`

**Step 3: Remove the dead code from source**

In `src/tools/table/table-cell-blocks.ts`:
- Delete `MARKDOWN_PATTERNS` constant (lines 14-18)
- Delete `detectMarkdownListTrigger()` function (lines 20-40 approximately)
- Delete `convertCellToBlocks()` method (lines 115-158)
- Delete `handleCellInput()` method (lines 163-182)
- Delete `revertCellToPlainText()` method (lines 367-388)
- Delete `findOrphanedReplacementBlock()` method (lines 396-425)
- Delete `observeCellBlockContainers()` method (lines 326-359) and its call in constructor
- Remove `cellBlocksObserver` property and its disconnect in `destroy()`

In `src/tools/table/index.ts`:
- Delete the `input` event listener in `initCellBlocks()` (lines 518-526)

Export `detectMarkdownListTrigger` is used in tests — make sure to remove the export too.

**Step 4: Run tests and lint**

Run: `yarn test test/unit/tools/table/ && yarn lint`

**Step 5: Commit**

```bash
git add src/tools/table/table-cell-blocks.ts src/tools/table/index.ts test/unit/tools/table/
git commit -m "refactor(table): remove markdown detection and plain-text reversion code"
```

---

## Task 3: Cell always renders as block container (no contenteditable on cell)

**Files:**
- Modify: `src/tools/table/table-core.ts:485-525`
- Test: `test/unit/tools/table/table-cell-blocks.test.ts` (or new test in `test/unit/tools/table/table-core.test.ts`)

**Step 1: Write the failing test**

Add a test that verifies cells are never contenteditable and always have a blocks container:

```typescript
describe('cell rendering', () => {
  it('cell should not be contenteditable', async () => {
    const { TableGrid } = await import('../../../../src/tools/table/table-core');
    const grid = new TableGrid({ readOnly: false });
    const gridEl = grid.createGrid(2, 2);
    const cells = gridEl.querySelectorAll('[data-blok-table-cell]');

    cells.forEach(cell => {
      expect(cell.getAttribute('contenteditable')).not.toBe('true');
    });
  });

  it('cell should have a blocks container', async () => {
    const { TableGrid } = await import('../../../../src/tools/table/table-core');
    const grid = new TableGrid({ readOnly: false });
    const gridEl = grid.createGrid(2, 2);
    const cells = gridEl.querySelectorAll('[data-blok-table-cell]');

    cells.forEach(cell => {
      const container = cell.querySelector('[data-blok-table-cell-blocks]');

      expect(container).not.toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-core.test.ts` (or wherever you placed it)
Expected: FAIL — cells currently have `contenteditable="true"` and no blocks container.

**Step 3: Update createCell in table-core.ts**

In `src/tools/table/table-core.ts`, modify `createCell()` (line 485):

- Remove: `cell.setAttribute('contenteditable', this.readOnly ? 'false' : 'true');` (line 500)
- Remove: focus/blur event handlers on cell (lines 502-522)
- Add: create a `<div data-blok-table-cell-blocks>` inside each cell

```typescript
private createCell(width?: number | string): HTMLElement {
  const cell = document.createElement('div');

  cell.className = twMerge(CELL_CLASSES);
  // ... existing style setup ...
  cell.setAttribute(CELL_ATTR, '');

  // Always create blocks container
  const blocksContainer = document.createElement('div');
  blocksContainer.setAttribute(CELL_BLOCKS_ATTR, '');
  cell.appendChild(blocksContainer);

  return cell;
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/table/`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/table/table-core.ts test/unit/tools/table/
git commit -m "refactor(table): cells always render as block containers, never contenteditable"
```

---

## Task 4: Initialize cells with paragraph blocks

**Files:**
- Modify: `src/tools/table/table-cell-blocks.ts`
- Modify: `src/tools/table/index.ts`
- Test: `test/unit/tools/table/table-cell-blocks.test.ts`

This is the core task: when a table is created or loaded, every cell gets at least one paragraph block mounted into it.

**Step 1: Write the failing test**

```typescript
describe('initializeCells', () => {
  it('should create a paragraph block for each empty cell', async () => {
    const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

    const mockInsert = vi.fn().mockReturnValue({
      id: 'block-1',
      holder: document.createElement('div'),
    });

    const api = {
      blocks: { insert: mockInsert },
    } as unknown as API;

    const gridElement = document.createElement('div');
    // Create a 1x1 grid with one cell containing a blocks container
    const row = document.createElement('div');
    row.setAttribute('data-blok-table-row', '');
    const cell = document.createElement('div');
    cell.setAttribute('data-blok-table-cell', '');
    const container = document.createElement('div');
    container.setAttribute('data-blok-table-cell-blocks', '');
    cell.appendChild(container);
    row.appendChild(cell);
    gridElement.appendChild(row);

    const cellBlocks = new TableCellBlocks({
      api,
      gridElement,
      tableBlockId: 'table-1',
    });

    cellBlocks.initializeCells([['']]);

    expect(mockInsert).toHaveBeenCalledWith(
      'paragraph',
      { text: '' },
      expect.anything(),
      undefined,
      false
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`
Expected: FAIL — `initializeCells` method doesn't exist yet.

**Step 3: Implement initializeCells**

In `src/tools/table/table-cell-blocks.ts`, add:

```typescript
/**
 * Initialize all cells with blocks.
 * - Empty cells or legacy string cells get a new paragraph block.
 * - Cells that already have block references get those blocks mounted.
 */
public initializeCells(content: LegacyCellContent[][]): CellContent[][] {
  const rows = this.gridElement.querySelectorAll(`[${ROW_ATTR}]`);
  const normalizedContent: CellContent[][] = [];

  content.forEach((rowData, rowIndex) => {
    const row = rows[rowIndex];
    if (!row) return;

    const cells = row.querySelectorAll(`[${CELL_ATTR}]`);
    const normalizedRow: CellContent[] = [];

    rowData.forEach((cellContent, colIndex) => {
      const cell = cells[colIndex] as HTMLElement | undefined;
      if (!cell) return;

      const container = cell.querySelector(`[${CELL_BLOCKS_ATTR}]`) as HTMLElement;
      if (!container) return;

      if (isCellWithBlocks(cellContent)) {
        // Already blocks — mount them into the cell
        this.mountBlocksInCell(container, cellContent.blocks);
        normalizedRow.push(cellContent);
      } else {
        // Legacy string or empty — create a paragraph block
        const text = typeof cellContent === 'string' ? cellContent : '';
        const block = this.api.blocks.insert('paragraph', { text }, {}, undefined, false);
        container.appendChild(block.holder);
        normalizedRow.push({ blocks: [block.id] });
      }
    });

    normalizedContent.push(normalizedRow);
  });

  return normalizedContent;
}

private mountBlocksInCell(container: HTMLElement, blockIds: string[]): void {
  for (const blockId of blockIds) {
    const index = this.api.blocks.getBlockIndex(blockId);
    if (index === undefined) continue;
    const block = this.api.blocks.getBlockByIndex(index);
    if (!block) continue;
    container.appendChild(block.holder);
  }
}
```

**Step 4: Wire up in Table.render()**

In `src/tools/table/index.ts`, update `render()` (around line 141) and `initCellBlocks()`:

After `this.initCellBlocks(gridEl)`, call:
```typescript
const normalizedContent = this.cellBlocks?.initializeCells(this.data.content);
if (normalizedContent) {
  this.data.content = normalizedContent;
}
```

Also update `fillGrid` call — since all cells are now block-based, `fillGrid` is no longer needed for content. The cell initialization handles everything. Either remove the `fillGrid` call or make it a no-op for the always-blocks path.

**Step 5: Run tests**

Run: `yarn test test/unit/tools/table/`

**Step 6: Commit**

```bash
git add src/tools/table/table-cell-blocks.ts src/tools/table/index.ts test/unit/tools/table/
git commit -m "feat(table): initialize all cells with paragraph blocks on creation and load"
```

---

## Task 5: Update getData() to always return block references

**Files:**
- Modify: `src/tools/table/table-core.ts:416-430`
- Test: `test/unit/tools/table/table-core.test.ts`

**Step 1: Write the failing test**

```typescript
describe('getData', () => {
  it('should return block references for all cells', async () => {
    const { TableGrid } = await import('../../../../src/tools/table/table-core');
    const grid = new TableGrid({ readOnly: false });
    const gridEl = grid.createGrid(1, 1);

    // Simulate a cell with a mounted block
    const cell = gridEl.querySelector('[data-blok-table-cell]') as HTMLElement;
    const container = cell.querySelector('[data-blok-table-cell-blocks]') as HTMLElement;
    const blockHolder = document.createElement('div');
    blockHolder.setAttribute('data-blok-block', 'block-123');
    container.appendChild(blockHolder);

    const data = grid.getData(gridEl);

    expect(data[0][0]).toEqual({ blocks: ['block-123'] });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-core.test.ts`

**Step 3: Simplify getCellContent**

In `src/tools/table/table-core.ts`, update `getCellContent()` (line 416):

```typescript
private getCellContent(cell: HTMLElement): CellContent {
  const blocksContainer = cell.querySelector(`[${CELL_BLOCKS_ATTR}]`);

  if (!blocksContainer) {
    return { blocks: [] };
  }

  const blockElements = blocksContainer.querySelectorAll(`[${DATA_ATTR.element}]`);
  const blockIds = Array.from(blockElements)
    .map(el => el.getAttribute(DATA_ATTR.element) ?? '')
    .filter(id => id !== '');

  return { blocks: blockIds };
}
```

Remove the `innerHTML` string fallback entirely.

**Step 4: Run tests**

Run: `yarn test test/unit/tools/table/`

**Step 5: Commit**

```bash
git add src/tools/table/table-core.ts test/unit/tools/table/
git commit -m "refactor(table): getData always returns block references"
```

---

## Task 6: Keyboard — Tab navigates between cells

**Files:**
- Modify: `src/tools/table/table-cell-blocks.ts`
- Modify: `src/tools/table/index.ts:493-508`
- Test: `test/unit/tools/table/table-cell-blocks.test.ts`

Since cells no longer have `contenteditable`, keyboard events bubble from block contenteditables inside cells. The keydown listener in `setupKeyboardNavigation` currently filters for `target.hasAttribute('data-blok-table-cell')` which won't match anymore (target is now a contenteditable inside a block inside a cell).

**Step 1: Write the failing test**

```typescript
describe('Tab navigation between cells', () => {
  it('should focus first block of next cell on Tab', async () => {
    // Setup: 1x2 grid, each cell has a contenteditable block
    const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

    const gridElement = document.createElement('div');
    const row = document.createElement('div');
    row.setAttribute('data-blok-table-row', '');

    // Cell 0 with a block
    const cell0 = document.createElement('div');
    cell0.setAttribute('data-blok-table-cell', '');
    const container0 = document.createElement('div');
    container0.setAttribute(CELL_BLOCKS_ATTR, '');
    const block0 = document.createElement('div');
    block0.setAttribute('data-blok-block', 'b0');
    const editable0 = document.createElement('div');
    editable0.setAttribute('contenteditable', 'true');
    block0.appendChild(editable0);
    container0.appendChild(block0);
    cell0.appendChild(container0);

    // Cell 1 with a block
    const cell1 = document.createElement('div');
    cell1.setAttribute('data-blok-table-cell', '');
    const container1 = document.createElement('div');
    container1.setAttribute(CELL_BLOCKS_ATTR, '');
    const block1 = document.createElement('div');
    block1.setAttribute('data-blok-block', 'b1');
    const editable1 = document.createElement('div');
    editable1.setAttribute('contenteditable', 'true');
    block1.appendChild(editable1);
    container1.appendChild(block1);
    cell1.appendChild(container1);

    row.appendChild(cell0);
    row.appendChild(cell1);
    gridElement.appendChild(row);

    const focusSpy = vi.spyOn(editable1, 'focus');

    const api = { blocks: {} } as unknown as API;
    const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1' });

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    const preventSpy = vi.spyOn(event, 'preventDefault');

    // Simulate Tab from cell 0
    cellBlocks.handleKeyDown(event, { row: 0, col: 0 });

    expect(preventSpy).toHaveBeenCalled();
    expect(focusSpy).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`

**Step 3: Update keyboard handling**

In `src/tools/table/table-cell-blocks.ts`, update `handleKeyDown()` and the navigation methods to:
1. Accept a cell position (row, col) — already does
2. On Tab: find the next cell's blocks container, find the first `[contenteditable="true"]` inside it, call `.focus()` on it
3. On Shift+Tab: find previous cell, focus the last `[contenteditable="true"]` in it

Update `navigateToCell()` (line 288) to focus the first/last contenteditable inside the target cell's blocks container.

In `src/tools/table/index.ts`, update `setupKeyboardNavigation()` (line 493):
- Change the `target` check to find the closest `[data-blok-table-cell]` ancestor (since `target` is now a contenteditable inside a block inside a cell)
- Remove the old `TableKeyboard` usage for cell navigation — `TableCellBlocks` handles it now

```typescript
private setupKeyboardNavigation(gridEl: HTMLElement): void {
  gridEl.addEventListener('keydown', (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    const cell = target.closest('[data-blok-table-cell]') as HTMLElement | null;

    if (!cell) {
      return;
    }

    const position = this.getCellPosition(gridEl, cell);

    if (position) {
      this.cellBlocks?.handleKeyDown(event, position);
    }
  });
}
```

**Step 4: Run tests**

Run: `yarn test test/unit/tools/table/`

**Step 5: Commit**

```bash
git add src/tools/table/table-cell-blocks.ts src/tools/table/index.ts test/unit/tools/table/
git commit -m "feat(table): Tab/Shift+Tab navigates between cell blocks"
```

---

## Task 7: Block lifecycle — intercept Enter to keep new blocks in cells

**Files:**
- Modify: `src/tools/table/table-cell-blocks.ts`
- Modify: `src/tools/table/index.ts`
- Test: `test/unit/tools/table/table-cell-blocks.test.ts`

When the user presses Enter in a paragraph inside a cell, the editor creates a new block in the main editor's DOM. We need to detect this and move the new block into the cell.

**Step 1: Write the failing test**

```typescript
describe('block lifecycle in cells', () => {
  it('should re-mount a newly inserted block into the correct cell', async () => {
    const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

    const gridElement = document.createElement('div');
    const row = document.createElement('div');
    row.setAttribute('data-blok-table-row', '');
    const cell = document.createElement('div');
    cell.setAttribute('data-blok-table-cell', '');
    const container = document.createElement('div');
    container.setAttribute(CELL_BLOCKS_ATTR, '');

    // Existing block in cell
    const existingBlock = document.createElement('div');
    existingBlock.setAttribute('data-blok-block', 'existing-1');
    container.appendChild(existingBlock);
    cell.appendChild(container);
    row.appendChild(cell);
    gridElement.appendChild(row);

    // New block that landed in the main editor (outside the cell)
    const newBlockHolder = document.createElement('div');
    newBlockHolder.setAttribute('data-blok-block', 'new-1');

    const api = {
      blocks: {
        getBlockIndex: vi.fn().mockReturnValue(1),
        getBlockByIndex: vi.fn().mockReturnValue({ holder: newBlockHolder, id: 'new-1' }),
      },
    } as unknown as API;

    const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1' });

    // Simulate: a block was added after 'existing-1', re-mount it
    cellBlocks.claimBlockForCell(cell, 'new-1');

    expect(container.contains(newBlockHolder)).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`
Expected: FAIL — `claimBlockForCell` doesn't exist.

**Step 3: Implement block claiming**

In `src/tools/table/table-cell-blocks.ts`, add a method to claim a block into a cell:

```typescript
/**
 * Move a block's DOM holder into a cell's blocks container.
 * Called when BlockManager creates a block that belongs to a cell
 * (e.g., Enter creating a new paragraph, or convert replacing a block).
 */
public claimBlockForCell(cell: HTMLElement, blockId: string): void {
  const container = cell.querySelector(`[${CELL_BLOCKS_ATTR}]`);
  if (!container) return;

  const index = this.api.blocks.getBlockIndex(blockId);
  if (index === undefined) return;

  const block = this.api.blocks.getBlockByIndex(index);
  if (!block) return;

  container.appendChild(block.holder);
}
```

Then wire this up to the editor's block lifecycle. In `src/tools/table/index.ts`, listen for block-added events and check if the new block should belong to a cell (by checking if the previous or next block in the flat list is mounted in a cell).

The exact wiring depends on how `api.events` works — the editor emits `block-added` events. Listen for these in the table's `rendered()` lifecycle hook:

```typescript
this.api.events.on('block-added', ({ detail }) => {
  // Check if the adjacent block is in a cell
  // If so, claim the new block for that cell
});
```

**Step 4: Run tests**

Run: `yarn test test/unit/tools/table/`

**Step 5: Commit**

```bash
git add src/tools/table/table-cell-blocks.ts src/tools/table/index.ts test/unit/tools/table/
git commit -m "feat(table): intercept block-added events to mount new blocks in cells"
```

---

## Task 8: Empty cell guarantee — prevent deleting last block

**Files:**
- Modify: `src/tools/table/table-cell-blocks.ts`
- Test: `test/unit/tools/table/table-cell-blocks.test.ts`

**Step 1: Write the failing test**

```typescript
describe('empty cell guarantee', () => {
  it('should insert a paragraph block when last block is removed from cell', async () => {
    const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

    const mockInsert = vi.fn().mockReturnValue({
      id: 'replacement-p',
      holder: document.createElement('div'),
    });

    const api = {
      blocks: { insert: mockInsert },
    } as unknown as API;

    const gridElement = document.createElement('div');
    const row = document.createElement('div');
    row.setAttribute('data-blok-table-row', '');
    const cell = document.createElement('div');
    cell.setAttribute('data-blok-table-cell', '');
    const container = document.createElement('div');
    container.setAttribute(CELL_BLOCKS_ATTR, '');
    cell.appendChild(container);
    row.appendChild(cell);
    gridElement.appendChild(row);

    const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1' });

    // Simulate: last block was removed, container is empty
    cellBlocks.ensureCellHasBlock(cell);

    expect(mockInsert).toHaveBeenCalledWith(
      'paragraph',
      { text: '' },
      expect.anything(),
      undefined,
      true
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`

**Step 3: Implement ensureCellHasBlock**

```typescript
/**
 * Ensure a cell has at least one block.
 * If the container is empty, insert an empty paragraph.
 */
public ensureCellHasBlock(cell: HTMLElement): void {
  const container = cell.querySelector(`[${CELL_BLOCKS_ATTR}]`) as HTMLElement;
  if (!container) return;

  const hasBlocks = container.querySelector(`[${DATA_ATTR.element}]`) !== null;
  if (hasBlocks) return;

  const block = this.api.blocks.insert('paragraph', { text: '' }, {}, undefined, true);
  container.appendChild(block.holder);
}
```

Wire this into the block-removed event listener (similar to Task 7):

```typescript
this.api.events.on('block-removed', ({ detail }) => {
  // Find which cell (if any) lost a block
  // Call ensureCellHasBlock on that cell
});
```

**Step 4: Run tests**

Run: `yarn test test/unit/tools/table/`

**Step 5: Commit**

```bash
git add src/tools/table/table-cell-blocks.ts test/unit/tools/table/
git commit -m "feat(table): ensure cells always have at least one paragraph block"
```

---

## Task 9: Update addRow/addColumn to create cells with paragraph blocks

**Files:**
- Modify: `src/tools/table/table-core.ts` or `src/tools/table/index.ts`
- Test: `test/unit/tools/table/table-cell-blocks.test.ts`

When the user adds a new row or column, each new cell needs a paragraph block — not just an empty contenteditable div.

**Step 1: Write the failing test**

```typescript
describe('addRow with blocks', () => {
  it('new row cells should each get a paragraph block', async () => {
    // Test that after addRow, each new cell's blocks container has a block holder
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Hook into addRow/addColumn**

After `this.grid.addRow()` or `this.grid.addColumn()` is called, iterate the new cells and call `ensureCellHasBlock()` on each. This can be done in the Table tool's `handleRowColAction()` method (line 373 of index.ts).

**Step 4: Run tests**

Run: `yarn test test/unit/tools/table/`

**Step 5: Commit**

```bash
git add src/tools/table/ test/unit/tools/table/
git commit -m "feat(table): new rows and columns get cells with paragraph blocks"
```

---

## Task 10: Remove old TableKeyboard (Enter-moves-down behavior)

**Files:**
- Modify: `src/tools/table/index.ts`
- Delete or gut: `src/tools/table/table-keyboard.ts`
- Test: `test/unit/tools/table/`

The old `TableKeyboard` class handled Enter → move to cell below (spreadsheet behavior) and Tab for plain text cells. With always-blocks, Enter creates new blocks in cell (handled by the editor's normal Enter flow), and Tab is handled by `TableCellBlocks`.

**Step 1: Write a test confirming Enter does NOT navigate to cell below**

```typescript
describe('Enter key in cell', () => {
  it('should not prevent default (let editor handle Enter normally)', async () => {
    // Setup cell with a paragraph block, simulate Enter keydown
    // Assert: event.preventDefault was NOT called by the table
  });
});
```

**Step 2: Run test to verify behavior**

**Step 3: Remove TableKeyboard**

- In `src/tools/table/index.ts`: remove `TableKeyboard` import, remove `this.keyboard` property, simplify `setupKeyboardNavigation()` to only delegate to `cellBlocks.handleKeyDown()`
- In `src/tools/table/table-keyboard.ts`: delete file or keep as empty/minimal if other code depends on it

**Step 4: Run tests and lint**

Run: `yarn test test/unit/tools/table/ && yarn lint`

**Step 5: Commit**

```bash
git add src/tools/table/
git commit -m "refactor(table): remove old TableKeyboard, Enter creates blocks in cell"
```

---

## Task 11: Update fillGrid for always-blocks model

**Files:**
- Modify: `src/tools/table/table-core.ts:71-96`
- Test: `test/unit/tools/table/table-core.test.ts`

`fillGrid()` currently sets `cell.innerHTML` for string cells and skips block cells. Since `initializeCells()` (Task 4) handles all cell content, `fillGrid` is no longer needed for content population. It should either be removed or reduced to a no-op.

**Step 1: Write a test**

```typescript
describe('fillGrid', () => {
  it('should not set innerHTML on cells (blocks handle content)', async () => {
    const { TableGrid } = await import('../../../../src/tools/table/table-core');
    const grid = new TableGrid({ readOnly: false });
    const gridEl = grid.createGrid(1, 1);

    grid.fillGrid(gridEl, [['Hello']]);

    const cell = gridEl.querySelector('[data-blok-table-cell]') as HTMLElement;
    // Cell's direct content should only be the blocks container, not "Hello"
    expect(cell.querySelector('[data-blok-table-cell-blocks]')).not.toBeNull();
    expect(cell.textContent).toBe('');
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Update fillGrid**

Make `fillGrid` a no-op or remove it. All content population is now handled by `TableCellBlocks.initializeCells()`.

```typescript
public fillGrid(_table: HTMLElement, _content: LegacyCellContent[][]): void {
  // Content is populated by TableCellBlocks.initializeCells()
  // This method is kept for API compatibility but does nothing.
}
```

**Step 4: Run tests**

Run: `yarn test test/unit/tools/table/`

**Step 5: Commit**

```bash
git add src/tools/table/table-core.ts test/unit/tools/table/
git commit -m "refactor(table): fillGrid is no-op, cell content handled by initializeCells"
```

---

## Task 12: Update E2E tests for always-blocks behavior

**Files:**
- Modify: `test/playwright/tests/tools/table-cell-lists.spec.ts`
- Possibly add: `test/playwright/tests/tools/table-always-blocks.spec.ts`

**Step 1: Update existing E2E tests**

The existing markdown shortcut tests (lines 134-356) need updating:
- Cells no longer start as contenteditable divs — they start as paragraph blocks
- Typing `- ` should still convert to a list, but via the editor's normal paragraph→list conversion, not via `handleCellInput`
- The cell reversion tests (lines 586-718) are no longer relevant — there's no "revert to plain text" path
- The skipped keyboard navigation tests (lines 389-583) should be un-skipped and updated

**Step 2: Write new E2E tests**

New tests to add:
- Creating a table shows cells with working paragraph blocks
- Typing in a cell works (text appears, inline formatting works)
- Enter creates a new paragraph in the same cell
- Tab moves to the next cell
- Shift+Tab moves to the previous cell
- Cell with multiple blocks (paragraph + list + paragraph) saves and loads correctly
- Deleting all content from a cell leaves one empty paragraph
- Adding a row creates cells with working paragraph blocks

**Step 3: Run E2E tests**

Run: `yarn e2e test/playwright/tests/tools/table-cell-lists.spec.ts`

**Step 4: Fix any failures**

**Step 5: Commit**

```bash
git add test/playwright/tests/tools/
git commit -m "test(table): update E2E tests for always-blocks cell model"
```

---

## Task 13: Hide block toolbar (+/☰) for blocks inside cells

**Files:**
- Modify: `src/components/modules/toolbar.ts` (or wherever toolbar visibility is controlled)
- Test: E2E test

Blocks inside table cells should not show the block toolbar (+ button and ☰ settings icon). The inline toolbar (bold/italic/link) should still work.

**Step 1: Write the failing E2E test**

```typescript
test('block toolbar should not appear for blocks inside table cells', async ({ page }) => {
  await createBlok(page, { tools: defaultTools, data: tableData });
  const cell = page.locator(CELL_SELECTOR).first();
  await cell.click();

  // The + button and ☰ should not be visible
  await expect(page.locator('[data-blok-testid="plus-button"]')).not.toBeVisible();
});
```

**Step 2: Implement toolbar suppression**

In the Toolbar module, check if the current block's holder is inside a `[data-blok-table-cell-blocks]` container. If so, don't show the toolbar.

**Step 3: Run tests**

**Step 4: Commit**

```bash
git add src/components/modules/ test/playwright/
git commit -m "feat(table): hide block toolbar for blocks inside table cells"
```

---

## Task 14: Final integration testing and cleanup

**Step 1: Run full test suite**

```bash
yarn test
yarn e2e
yarn lint
```

**Step 2: Fix any failures**

**Step 3: Clean up any remaining dead code**

- Remove unused imports
- Remove `isCellWithBlocks` if no longer needed (or keep for migration)
- Remove `LegacyCellContent` if migration is complete and no old data paths remain

**Step 4: Commit**

```bash
git add -A
git commit -m "chore(table): final cleanup for always-blocks model"
```

---

## Execution Order & Dependencies

```
Task 1 (types) ──────────────────────────────┐
Task 2 (remove dead code) ──────────────────┤
Task 3 (cell rendering) ───────────────────┤
                                             ├── Task 4 (initializeCells) ──┐
                                             │                              ├── Task 7 (block lifecycle)
Task 5 (getData) ──────────────────────────┘                              ├── Task 8 (empty cell guarantee)
                                                                           ├── Task 9 (addRow/addColumn)
Task 6 (Tab navigation) ──────────────────────────────────────────────────┤
Task 10 (remove TableKeyboard) ────────────────────────────────────────────┤
Task 11 (fillGrid) ────────────────────────────────────────────────────────┤
                                                                           ├── Task 12 (E2E tests)
Task 13 (hide toolbar) ────────────────────────────────────────────────────┤
                                                                           └── Task 14 (final cleanup)
```

Tasks 1-3 and 5-6 can be done in parallel. Task 4 depends on 1-3. Tasks 7-13 depend on 4. Task 14 is last.
