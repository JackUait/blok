# Table Cell Lists Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to create one-level deep lists inside table cells using markdown shortcuts.

**Architecture:** Table cells can contain either plain text (string) or block references (`{ blocks: string[] }`). When a user types `- `, `1. `, or `[] ` in a cell, it converts to a block-based cell containing ListItem blocks. A new `table-cell-blocks.ts` module handles markdown detection, block lifecycle, focus management, and keyboard navigation.

**Tech Stack:** TypeScript, existing ListItem tool, existing BlockManager API, Vitest for unit tests, Playwright for E2E tests.

---

## Task 1: Update TableData Type

**Files:**
- Modify: `src/tools/table/types.ts`
- Test: `test/unit/tools/table/types.test.ts`

**Step 1: Write the failing test**

Create a new test file:

```typescript
// test/unit/tools/table/types.test.ts
import { describe, it, expect } from 'vitest';
import type { TableData, CellContent } from '../../../../src/tools/table/types';

describe('TableData types', () => {
  it('should accept string cell content for backwards compatibility', () => {
    const data: TableData = {
      withHeadings: false,
      content: [['Hello', 'World']],
    };

    expect(data.content[0][0]).toBe('Hello');
  });

  it('should accept block-based cell content', () => {
    const data: TableData = {
      withHeadings: false,
      content: [
        ['Plain text', { blocks: ['block-1', 'block-2'] }],
      ],
    };

    const cell = data.content[0][1];
    expect(typeof cell).toBe('object');
    expect((cell as { blocks: string[] }).blocks).toEqual(['block-1', 'block-2']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/types.test.ts`

Expected: FAIL - CellContent type doesn't exist

**Step 3: Write minimal implementation**

```typescript
// src/tools/table/types.ts
import type { BlockToolData } from '../../../types';

/**
 * Cell content can be either:
 * - A string (plain text/HTML, backwards compatible)
 * - An object with block IDs (for nested blocks like lists)
 */
export type CellContent = string | { blocks: string[] };

/**
 * Type guard to check if cell content contains blocks
 */
export function isCellWithBlocks(cell: CellContent): cell is { blocks: string[] } {
  return typeof cell === 'object' && cell !== null && 'blocks' in cell;
}

/**
 * Data format for the Table tool.
 */
export interface TableData extends BlockToolData {
  /** Whether the first row is a heading row */
  withHeadings: boolean;
  /** Whether the table is full-width */
  stretched?: boolean;
  /** 2D array of cell content (string or block references) */
  content: CellContent[][];
  /** Column widths in pixels */
  colWidths?: number[];
}

/**
 * Table tool configuration
 */
export interface TableConfig {
  /** Initial number of rows (default: 2) */
  rows?: number;
  /** Initial number of columns (default: 2) */
  cols?: number;
  /** Whether to start with heading row enabled */
  withHeadings?: boolean;
  /** Whether to start stretched */
  stretched?: boolean;
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/table/types.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/table/types.ts test/unit/tools/table/types.test.ts
git commit -m "feat(table): add CellContent type for block-based cells"
```

---

## Task 2: Create table-cell-blocks Module - Type Guard Helper

**Files:**
- Create: `src/tools/table/table-cell-blocks.ts`
- Test: `test/unit/tools/table/table-cell-blocks.test.ts`

**Step 1: Write the failing test**

```typescript
// test/unit/tools/table/table-cell-blocks.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('TableCellBlocks', () => {
  describe('isInCellBlock', () => {
    it('should return true when element is inside a cell block container', () => {
      // Create DOM structure: cell > container > block > content
      const cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');

      const container = document.createElement('div');
      container.setAttribute('data-blok-table-cell-blocks', '');
      cell.appendChild(container);

      const block = document.createElement('div');
      block.setAttribute('data-blok-block', 'block-1');
      container.appendChild(block);

      const content = document.createElement('div');
      content.setAttribute('contenteditable', 'true');
      block.appendChild(content);

      // Import after setting up DOM
      const { isInCellBlock } = await import('../../../../src/tools/table/table-cell-blocks');

      expect(isInCellBlock(content)).toBe(true);
    });

    it('should return false when element is in plain text cell', () => {
      const cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');
      cell.setAttribute('contenteditable', 'true');

      const { isInCellBlock } = await import('../../../../src/tools/table/table-cell-blocks');

      expect(isInCellBlock(cell)).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`

Expected: FAIL - module doesn't exist

**Step 3: Write minimal implementation**

```typescript
// src/tools/table/table-cell-blocks.ts
import { CELL_ATTR } from './table-core';

export const CELL_BLOCKS_ATTR = 'data-blok-table-cell-blocks';

/**
 * Check if an element is inside a block-based table cell
 */
export function isInCellBlock(element: HTMLElement): boolean {
  const cellBlocksContainer = element.closest(`[${CELL_BLOCKS_ATTR}]`);
  return cellBlocksContainer !== null;
}

/**
 * Get the cell element that contains the given element
 */
export function getCellFromElement(element: HTMLElement): HTMLElement | null {
  return element.closest(`[${CELL_ATTR}]`) as HTMLElement | null;
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/table/table-cell-blocks.ts test/unit/tools/table/table-cell-blocks.test.ts
git commit -m "feat(table): add isInCellBlock helper for detecting nested blocks"
```

---

## Task 3: Add Markdown Pattern Detection

**Files:**
- Modify: `src/tools/table/table-cell-blocks.ts`
- Test: `test/unit/tools/table/table-cell-blocks.test.ts`

**Step 1: Write the failing test**

Add to existing test file:

```typescript
describe('detectMarkdownListTrigger', () => {
  it('should detect unordered list trigger "- "', () => {
    const { detectMarkdownListTrigger } = await import('../../../../src/tools/table/table-cell-blocks');

    const result = detectMarkdownListTrigger('- ');
    expect(result).toEqual({ style: 'unordered', textAfter: '' });
  });

  it('should detect ordered list trigger "1. "', () => {
    const { detectMarkdownListTrigger } = await import('../../../../src/tools/table/table-cell-blocks');

    const result = detectMarkdownListTrigger('1. ');
    expect(result).toEqual({ style: 'ordered', textAfter: '' });
  });

  it('should detect checklist trigger "[] "', () => {
    const { detectMarkdownListTrigger } = await import('../../../../src/tools/table/table-cell-blocks');

    const result = detectMarkdownListTrigger('[] ');
    expect(result).toEqual({ style: 'checklist', textAfter: '' });
  });

  it('should capture text after trigger', () => {
    const { detectMarkdownListTrigger } = await import('../../../../src/tools/table/table-cell-blocks');

    const result = detectMarkdownListTrigger('- Hello world');
    expect(result).toEqual({ style: 'unordered', textAfter: 'Hello world' });
  });

  it('should return null for non-matching content', () => {
    const { detectMarkdownListTrigger } = await import('../../../../src/tools/table/table-cell-blocks');

    expect(detectMarkdownListTrigger('Hello world')).toBeNull();
    expect(detectMarkdownListTrigger('--')).toBeNull();
    expect(detectMarkdownListTrigger('2. ')).toBeNull(); // Only "1. " triggers
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`

Expected: FAIL - detectMarkdownListTrigger doesn't exist

**Step 3: Write minimal implementation**

Add to `src/tools/table/table-cell-blocks.ts`:

```typescript
import type { ListItemStyle } from '../list/types';

interface MarkdownListTrigger {
  style: ListItemStyle;
  textAfter: string;
}

const MARKDOWN_PATTERNS: Array<{ pattern: RegExp; style: ListItemStyle }> = [
  { pattern: /^-\s(.*)$/, style: 'unordered' },
  { pattern: /^1\.\s(.*)$/, style: 'ordered' },
  { pattern: /^\[\]\s(.*)$/, style: 'checklist' },
];

/**
 * Detect if cell content starts with a markdown list trigger
 * Returns the list style and any text after the trigger, or null if no match
 */
export function detectMarkdownListTrigger(content: string): MarkdownListTrigger | null {
  const trimmed = content.trimStart();

  for (const { pattern, style } of MARKDOWN_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return { style, textAfter: match[1] ?? '' };
    }
  }

  return null;
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/table/table-cell-blocks.ts test/unit/tools/table/table-cell-blocks.test.ts
git commit -m "feat(table): add markdown list trigger detection"
```

---

## Task 4: Create TableCellBlocks Class - Basic Structure

**Files:**
- Modify: `src/tools/table/table-cell-blocks.ts`
- Test: `test/unit/tools/table/table-cell-blocks.test.ts`

**Step 1: Write the failing test**

Add to test file:

```typescript
import type { API } from '../../../../types';

describe('TableCellBlocks class', () => {
  let mockApi: API;
  let gridEl: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();

    mockApi = {
      blocks: {
        insert: vi.fn().mockReturnValue({ id: 'new-block-id' }),
        delete: vi.fn(),
        getBlockByIndex: vi.fn(),
        getBlockIndex: vi.fn(),
        getCurrentBlockIndex: vi.fn().mockReturnValue(0),
        getBlocksCount: vi.fn().mockReturnValue(1),
      },
    } as unknown as API;

    gridEl = document.createElement('div');
  });

  it('should instantiate with API and grid element', () => {
    const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

    const cellBlocks = new TableCellBlocks({
      api: mockApi,
      gridElement: gridEl,
      tableBlockId: 'table-1',
    });

    expect(cellBlocks).toBeInstanceOf(TableCellBlocks);
  });

  it('should track active cell with blocks', () => {
    const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

    const cellBlocks = new TableCellBlocks({
      api: mockApi,
      gridElement: gridEl,
      tableBlockId: 'table-1',
    });

    expect(cellBlocks.activeCellWithBlocks).toBeNull();

    cellBlocks.setActiveCellWithBlocks({ row: 0, col: 1 });
    expect(cellBlocks.activeCellWithBlocks).toEqual({ row: 0, col: 1 });

    cellBlocks.clearActiveCellWithBlocks();
    expect(cellBlocks.activeCellWithBlocks).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`

Expected: FAIL - TableCellBlocks class doesn't exist

**Step 3: Write minimal implementation**

Add to `src/tools/table/table-cell-blocks.ts`:

```typescript
import type { API } from '../../../types';

interface CellPosition {
  row: number;
  col: number;
}

interface TableCellBlocksOptions {
  api: API;
  gridElement: HTMLElement;
  tableBlockId: string;
}

/**
 * Manages nested blocks within table cells.
 * Handles markdown triggers, block lifecycle, and keyboard navigation.
 */
export class TableCellBlocks {
  private api: API;
  private gridElement: HTMLElement;
  private tableBlockId: string;
  private _activeCellWithBlocks: CellPosition | null = null;

  constructor(options: TableCellBlocksOptions) {
    this.api = options.api;
    this.gridElement = options.gridElement;
    this.tableBlockId = options.tableBlockId;
  }

  /**
   * Get the currently active cell that contains blocks
   */
  get activeCellWithBlocks(): CellPosition | null {
    return this._activeCellWithBlocks;
  }

  /**
   * Set the active cell with blocks (when focus enters a nested block)
   */
  setActiveCellWithBlocks(position: CellPosition): void {
    this._activeCellWithBlocks = position;
  }

  /**
   * Clear the active cell tracking (when focus leaves nested blocks)
   */
  clearActiveCellWithBlocks(): void {
    this._activeCellWithBlocks = null;
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    this._activeCellWithBlocks = null;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/table/table-cell-blocks.ts test/unit/tools/table/table-cell-blocks.test.ts
git commit -m "feat(table): add TableCellBlocks class with focus tracking"
```

---

## Task 5: Implement Cell Conversion to Block-Based

**Files:**
- Modify: `src/tools/table/table-cell-blocks.ts`
- Test: `test/unit/tools/table/table-cell-blocks.test.ts`

**Step 1: Write the failing test**

Add to test file:

```typescript
describe('convertCellToBlocks', () => {
  let mockApi: API;
  let gridEl: HTMLElement;
  let cell: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();

    mockApi = {
      blocks: {
        insert: vi.fn().mockReturnValue({ id: 'list-item-1' }),
      },
    } as unknown as API;

    gridEl = document.createElement('div');

    // Create a cell
    cell = document.createElement('div');
    cell.setAttribute('data-blok-table-cell', '');
    cell.setAttribute('contenteditable', 'true');
    cell.textContent = '- Item text';
    gridEl.appendChild(cell);
  });

  it('should convert cell from contenteditable to block container', async () => {
    const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

    const cellBlocks = new TableCellBlocks({
      api: mockApi,
      gridElement: gridEl,
      tableBlockId: 'table-1',
    });

    const result = await cellBlocks.convertCellToBlocks(cell, 'unordered', 'Item text');

    // Cell should no longer be contenteditable
    expect(cell.getAttribute('contenteditable')).toBe('false');

    // Should have a blocks container
    const container = cell.querySelector('[data-blok-table-cell-blocks]');
    expect(container).not.toBeNull();

    // Should return block IDs
    expect(result.blocks).toContain('list-item-1');
  });

  it('should insert a listItem block with correct data', async () => {
    const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

    const cellBlocks = new TableCellBlocks({
      api: mockApi,
      gridElement: gridEl,
      tableBlockId: 'table-1',
    });

    await cellBlocks.convertCellToBlocks(cell, 'ordered', 'First item');

    expect(mockApi.blocks.insert).toHaveBeenCalledWith(
      'listItem',
      expect.objectContaining({
        text: 'First item',
        style: 'ordered',
        depth: 0,
      }),
      expect.any(Object),
      expect.any(Number),
      true // needToFocus
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`

Expected: FAIL - convertCellToBlocks doesn't exist

**Step 3: Write minimal implementation**

Add to `TableCellBlocks` class:

```typescript
import type { ListItemStyle, ListItemData } from '../list/types';
import type { CellContent } from './types';

// In the class:

/**
 * Convert a plain text cell to a block-based cell
 * @returns The cell content object with block IDs
 */
async convertCellToBlocks(
  cell: HTMLElement,
  style: ListItemStyle,
  initialText: string
): Promise<{ blocks: string[] }> {
  // Remove contenteditable from cell
  cell.setAttribute('contenteditable', 'false');
  cell.innerHTML = '';

  // Create blocks container
  const container = document.createElement('div');
  container.setAttribute(CELL_BLOCKS_ATTR, '');
  cell.appendChild(container);

  // Create the first list item block
  const listItemData: ListItemData = {
    text: initialText,
    style,
    depth: 0,
  };

  // Insert the block (this creates it in BlockManager)
  const block = this.api.blocks.insert(
    'listItem',
    listItemData,
    {},
    undefined, // index - append at end
    true // needToFocus
  );

  // The block's DOM will be mounted by the BlockManager
  // We need to move it into our container
  // For now, return the block ID - actual DOM mounting will be handled in integration

  return { blocks: [block.id] };
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/table/table-cell-blocks.ts test/unit/tools/table/table-cell-blocks.test.ts
git commit -m "feat(table): add convertCellToBlocks method"
```

---

## Task 6: Add Input Listener for Markdown Triggers

**Files:**
- Modify: `src/tools/table/table-cell-blocks.ts`
- Test: `test/unit/tools/table/table-cell-blocks.test.ts`

**Step 1: Write the failing test**

```typescript
describe('handleCellInput', () => {
  let mockApi: API;
  let gridEl: HTMLElement;
  let cell: HTMLElement;
  let cellBlocks: TableCellBlocks;
  let convertSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockApi = {
      blocks: {
        insert: vi.fn().mockReturnValue({ id: 'list-item-1' }),
      },
    } as unknown as API;

    gridEl = document.createElement('div');
    const row = document.createElement('div');
    row.setAttribute('data-blok-table-row', '');
    gridEl.appendChild(row);

    cell = document.createElement('div');
    cell.setAttribute('data-blok-table-cell', '');
    cell.setAttribute('contenteditable', 'true');
    row.appendChild(cell);

    const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

    cellBlocks = new TableCellBlocks({
      api: mockApi,
      gridElement: gridEl,
      tableBlockId: 'table-1',
    });

    convertSpy = vi.spyOn(cellBlocks, 'convertCellToBlocks').mockResolvedValue({ blocks: ['b1'] });
  });

  it('should detect markdown trigger and convert cell', async () => {
    cell.textContent = '- ';

    await cellBlocks.handleCellInput(cell);

    expect(convertSpy).toHaveBeenCalledWith(cell, 'unordered', '');
  });

  it('should pass text after trigger to convertCellToBlocks', async () => {
    cell.textContent = '1. Start typing';

    await cellBlocks.handleCellInput(cell);

    expect(convertSpy).toHaveBeenCalledWith(cell, 'ordered', 'Start typing');
  });

  it('should not convert if no markdown trigger detected', async () => {
    cell.textContent = 'Regular text';

    await cellBlocks.handleCellInput(cell);

    expect(convertSpy).not.toHaveBeenCalled();
  });

  it('should not convert if cell already has blocks', async () => {
    const container = document.createElement('div');
    container.setAttribute('data-blok-table-cell-blocks', '');
    cell.appendChild(container);
    cell.setAttribute('contenteditable', 'false');

    await cellBlocks.handleCellInput(cell);

    expect(convertSpy).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`

Expected: FAIL - handleCellInput doesn't exist

**Step 3: Write minimal implementation**

Add to `TableCellBlocks` class:

```typescript
/**
 * Handle input event on a cell to detect markdown triggers
 */
async handleCellInput(cell: HTMLElement): Promise<void> {
  // Skip if cell already has blocks
  if (cell.querySelector(`[${CELL_BLOCKS_ATTR}]`)) {
    return;
  }

  // Skip if not contenteditable
  if (cell.getAttribute('contenteditable') !== 'true') {
    return;
  }

  const content = cell.textContent ?? '';
  const trigger = detectMarkdownListTrigger(content);

  if (!trigger) {
    return;
  }

  await this.convertCellToBlocks(cell, trigger.style, trigger.textAfter);
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/table/table-cell-blocks.ts test/unit/tools/table/table-cell-blocks.test.ts
git commit -m "feat(table): add handleCellInput for markdown trigger detection"
```

---

## Task 7: Integrate TableCellBlocks into Table Tool

**Files:**
- Modify: `src/tools/table/index.ts`
- Test: `test/unit/tools/table/index.test.ts` (or add to existing)

**Step 1: Write the failing test**

```typescript
// test/unit/tools/table/table-cell-blocks-integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { API } from '../../../../types';

describe('Table tool with cell blocks integration', () => {
  let mockApi: API;

  beforeEach(() => {
    vi.clearAllMocks();

    mockApi = {
      blocks: {
        insert: vi.fn().mockReturnValue({ id: 'list-1' }),
        getCurrentBlockIndex: vi.fn().mockReturnValue(0),
      },
      i18n: {
        t: vi.fn((key: string) => key),
      },
    } as unknown as API;
  });

  it('should initialize TableCellBlocks when rendered', async () => {
    const { Table } = await import('../../../../src/tools/table/index');

    const table = new Table({
      data: { withHeadings: false, content: [['', '']] },
      config: {},
      api: mockApi,
      readOnly: false,
      block: { id: 'table-1' } as any,
    });

    const element = table.render();

    // Should have grid element
    expect(element.querySelector('[data-blok-table-row]')).not.toBeNull();
  });

  it('should handle input events on cells', async () => {
    const { Table } = await import('../../../../src/tools/table/index');

    const table = new Table({
      data: { withHeadings: false, content: [['', '']] },
      config: {},
      api: mockApi,
      readOnly: false,
      block: { id: 'table-1' } as any,
    });

    const element = table.render();
    const cell = element.querySelector('[data-blok-table-cell]') as HTMLElement;

    // Simulate typing "- "
    cell.textContent = '- ';
    cell.dispatchEvent(new InputEvent('input', { bubbles: true }));

    // The cell blocks module should have been called
    // (We'll verify this through the cell conversion in integration)
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-cell-blocks-integration.test.ts`

Expected: FAIL or incomplete (integration needs wiring)

**Step 3: Write minimal implementation**

Modify `src/tools/table/index.ts`:

```typescript
// Add import at top
import { TableCellBlocks } from './table-cell-blocks';

// Add property to class
private cellBlocks: TableCellBlocks | null = null;

// In render() method, after creating grid:
if (!this.readOnly) {
  this.cellBlocks = new TableCellBlocks({
    api: this.api,
    gridElement: gridEl,
    tableBlockId: this.blockId ?? '',
  });
  this.setupCellBlocksListeners(gridEl);
}

// Add new method:
private setupCellBlocksListeners(gridEl: HTMLElement): void {
  gridEl.addEventListener('input', (event: Event) => {
    const target = event.target as HTMLElement;
    if (!target.hasAttribute('data-blok-table-cell')) {
      return;
    }
    this.cellBlocks?.handleCellInput(target);
  });
}

// In destroy() method:
this.cellBlocks?.destroy();
this.cellBlocks = null;
```

Also add `blockId` storage in constructor:

```typescript
private blockId: string | undefined;

// In constructor:
if (block) {
  this.blockId = block.id;
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/table/table-cell-blocks-integration.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/table/index.ts test/unit/tools/table/table-cell-blocks-integration.test.ts
git commit -m "feat(table): integrate TableCellBlocks into Table tool"
```

---

## Task 8: Update table-core to Handle Block-Based Cells

**Files:**
- Modify: `src/tools/table/table-core.ts`
- Test: `test/unit/tools/table/table-core.test.ts`

**Step 1: Write the failing test**

```typescript
// test/unit/tools/table/table-core-blocks.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TableGrid } from '../../../../src/tools/table/table-core';
import type { CellContent } from '../../../../src/tools/table/types';

describe('TableGrid with block-based cells', () => {
  let grid: TableGrid;

  beforeEach(() => {
    grid = new TableGrid({ readOnly: false });
  });

  describe('fillGrid with mixed content', () => {
    it('should handle string cells normally', () => {
      const table = grid.createGrid(1, 2);
      const content: CellContent[][] = [['Hello', 'World']];

      grid.fillGrid(table, content);

      const cells = table.querySelectorAll('[data-blok-table-cell]');
      expect(cells[0].innerHTML).toBe('Hello');
      expect(cells[1].innerHTML).toBe('World');
    });

    it('should skip block-based cells (handled separately)', () => {
      const table = grid.createGrid(1, 2);
      const content: CellContent[][] = [['Plain text', { blocks: ['b1', 'b2'] }]];

      grid.fillGrid(table, content);

      const cells = table.querySelectorAll('[data-blok-table-cell]');
      expect(cells[0].innerHTML).toBe('Plain text');
      // Block cell should be empty (blocks mounted separately)
      expect(cells[1].innerHTML).toBe('');
    });
  });

  describe('getData with mixed content', () => {
    it('should return string for plain text cells', () => {
      const table = grid.createGrid(1, 2);
      const cells = table.querySelectorAll('[data-blok-table-cell]');
      (cells[0] as HTMLElement).innerHTML = 'Hello';
      (cells[1] as HTMLElement).innerHTML = 'World';

      const data = grid.getData(table);

      expect(data[0][0]).toBe('Hello');
      expect(data[0][1]).toBe('World');
    });

    it('should return block object for cells with block container', () => {
      const table = grid.createGrid(1, 2);
      const cells = table.querySelectorAll('[data-blok-table-cell]');

      // First cell is plain text
      (cells[0] as HTMLElement).innerHTML = 'Plain';

      // Second cell has blocks
      const cell = cells[1] as HTMLElement;
      cell.setAttribute('contenteditable', 'false');
      cell.innerHTML = '';

      const container = document.createElement('div');
      container.setAttribute('data-blok-table-cell-blocks', '');

      const block1 = document.createElement('div');
      block1.setAttribute('data-blok-block', 'block-1');
      container.appendChild(block1);

      const block2 = document.createElement('div');
      block2.setAttribute('data-blok-block', 'block-2');
      container.appendChild(block2);

      cell.appendChild(container);

      const data = grid.getData(table);

      expect(data[0][0]).toBe('Plain');
      expect(data[0][1]).toEqual({ blocks: ['block-1', 'block-2'] });
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-core-blocks.test.ts`

Expected: FAIL - getData returns string, not block object

**Step 3: Write minimal implementation**

Modify `src/tools/table/table-core.ts`:

```typescript
import type { CellContent } from './types';
import { isCellWithBlocks } from './types';
import { CELL_BLOCKS_ATTR } from './table-cell-blocks';

// Modify fillGrid to handle CellContent[][] instead of string[][]
public fillGrid(table: HTMLElement, content: CellContent[][]): void {
  const rows = table.querySelectorAll(`[${ROW_ATTR}]`);

  content.forEach((rowData, rowIndex) => {
    if (rowIndex >= rows.length) {
      return;
    }

    const cells = rows[rowIndex].querySelectorAll(`[${CELL_ATTR}]`);

    rowData.forEach((cellContent, colIndex) => {
      if (colIndex >= cells.length) {
        return;
      }

      const cell = cells[colIndex] as HTMLElement;

      // Skip block-based cells - they're mounted separately
      if (isCellWithBlocks(cellContent)) {
        return;
      }

      cell.innerHTML = cellContent;
    });
  });
}

// Modify getData to return CellContent[][]
public getData(table: HTMLElement): CellContent[][] {
  const rows = table.querySelectorAll(`[${ROW_ATTR}]`);
  const result: CellContent[][] = [];

  rows.forEach(row => {
    const cells = row.querySelectorAll(`[${CELL_ATTR}]`);
    const rowData: CellContent[] = [];

    cells.forEach(cell => {
      rowData.push(this.getCellContent(cell as HTMLElement));
    });

    result.push(rowData);
  });

  return result;
}

// Modify getCellContent to return CellContent
private getCellContent(cell: HTMLElement): CellContent {
  // Check if cell has blocks
  const blocksContainer = cell.querySelector(`[${CELL_BLOCKS_ATTR}]`);

  if (blocksContainer) {
    const blockElements = blocksContainer.querySelectorAll('[data-blok-block]');
    const blockIds = Array.from(blockElements).map(
      el => el.getAttribute('data-blok-block') ?? ''
    ).filter(id => id !== '');

    return { blocks: blockIds };
  }

  return cell.innerHTML;
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/table/table-core-blocks.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/table/table-core.ts test/unit/tools/table/table-core-blocks.test.ts
git commit -m "feat(table): update TableGrid to handle block-based cells"
```

---

## Task 9: Add Keyboard Navigation for Cell Blocks

**Files:**
- Modify: `src/tools/table/table-cell-blocks.ts`
- Test: `test/unit/tools/table/table-cell-blocks.test.ts`

**Step 1: Write the failing test**

```typescript
describe('handleKeyDown in cell blocks', () => {
  let mockApi: API;
  let gridEl: HTMLElement;
  let cellBlocks: TableCellBlocks;
  let cell: HTMLElement;
  let onNavigateToCell: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockApi = {
      blocks: {
        delete: vi.fn(),
      },
    } as unknown as API;

    // Create grid with rows
    gridEl = document.createElement('div');

    const row1 = document.createElement('div');
    row1.setAttribute('data-blok-table-row', '');

    cell = document.createElement('div');
    cell.setAttribute('data-blok-table-cell', '');
    row1.appendChild(cell);

    const cell2 = document.createElement('div');
    cell2.setAttribute('data-blok-table-cell', '');
    cell2.setAttribute('contenteditable', 'true');
    row1.appendChild(cell2);

    gridEl.appendChild(row1);

    const row2 = document.createElement('div');
    row2.setAttribute('data-blok-table-row', '');

    const cell3 = document.createElement('div');
    cell3.setAttribute('data-blok-table-cell', '');
    cell3.setAttribute('contenteditable', 'true');
    row2.appendChild(cell3);

    gridEl.appendChild(row2);

    onNavigateToCell = vi.fn();

    const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

    cellBlocks = new TableCellBlocks({
      api: mockApi,
      gridElement: gridEl,
      tableBlockId: 'table-1',
      onNavigateToCell,
    });

    cellBlocks.setActiveCellWithBlocks({ row: 0, col: 0 });
  });

  it('should navigate to next cell on Tab', () => {
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');

    cellBlocks.handleKeyDown(event, cell);

    expect(preventDefault).toHaveBeenCalled();
    expect(onNavigateToCell).toHaveBeenCalledWith({ row: 0, col: 1 });
  });

  it('should navigate to previous cell on Shift+Tab', () => {
    cellBlocks.setActiveCellWithBlocks({ row: 0, col: 1 });

    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true });

    cellBlocks.handleKeyDown(event, cell);

    expect(onNavigateToCell).toHaveBeenCalledWith({ row: 0, col: 0 });
  });

  it('should navigate to cell below on Shift+Enter', () => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true });

    cellBlocks.handleKeyDown(event, cell);

    expect(onNavigateToCell).toHaveBeenCalledWith({ row: 1, col: 0 });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`

Expected: FAIL - handleKeyDown doesn't exist or onNavigateToCell callback not implemented

**Step 3: Write minimal implementation**

Update `TableCellBlocksOptions` interface and class:

```typescript
interface TableCellBlocksOptions {
  api: API;
  gridElement: HTMLElement;
  tableBlockId: string;
  onNavigateToCell?: (position: CellPosition) => void;
}

// In constructor:
private onNavigateToCell?: (position: CellPosition) => void;

constructor(options: TableCellBlocksOptions) {
  this.api = options.api;
  this.gridElement = options.gridElement;
  this.tableBlockId = options.tableBlockId;
  this.onNavigateToCell = options.onNavigateToCell;
}

/**
 * Handle keydown event when focus is in a cell block
 */
handleKeyDown(event: KeyboardEvent, cell: HTMLElement): void {
  const position = this._activeCellWithBlocks;
  if (!position) {
    return;
  }

  // Tab -> next cell
  if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault();
    const nextCol = position.col + 1;
    const totalCols = this.getColumnCount();

    if (nextCol < totalCols) {
      this.navigateToCell({ row: position.row, col: nextCol });
    } else {
      // Wrap to next row
      const nextRow = position.row + 1;
      if (nextRow < this.getRowCount()) {
        this.navigateToCell({ row: nextRow, col: 0 });
      }
    }
    return;
  }

  // Shift+Tab -> previous cell
  if (event.key === 'Tab' && event.shiftKey) {
    event.preventDefault();
    const prevCol = position.col - 1;

    if (prevCol >= 0) {
      this.navigateToCell({ row: position.row, col: prevCol });
    } else {
      // Wrap to previous row
      const prevRow = position.row - 1;
      if (prevRow >= 0) {
        const totalCols = this.getColumnCount();
        this.navigateToCell({ row: prevRow, col: totalCols - 1 });
      }
    }
    return;
  }

  // Shift+Enter -> exit to cell below
  if (event.key === 'Enter' && event.shiftKey) {
    event.preventDefault();
    this.exitListToNextCell(position);
    return;
  }
}

private navigateToCell(position: CellPosition): void {
  this.clearActiveCellWithBlocks();
  this.onNavigateToCell?.(position);
}

private exitListToNextCell(currentPosition: CellPosition): void {
  const nextRow = currentPosition.row + 1;

  if (nextRow < this.getRowCount()) {
    this.navigateToCell({ row: nextRow, col: currentPosition.col });
  } else {
    // Last row - stay in cell (clear tracking but don't navigate)
    this.clearActiveCellWithBlocks();
  }
}

private getRowCount(): number {
  return this.gridElement.querySelectorAll('[data-blok-table-row]').length;
}

private getColumnCount(): number {
  const firstRow = this.gridElement.querySelector('[data-blok-table-row]');
  return firstRow?.querySelectorAll('[data-blok-table-cell]').length ?? 0;
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/table/table-cell-blocks.ts test/unit/tools/table/table-cell-blocks.test.ts
git commit -m "feat(table): add keyboard navigation for cell blocks"
```

---

## Task 10: Handle Enter Key in Cell List Items

**Files:**
- Modify: `src/tools/table/table-cell-blocks.ts`
- Test: `test/unit/tools/table/table-cell-blocks.test.ts`

**Step 1: Write the failing test**

```typescript
describe('handleEnterInList', () => {
  it('should exit to cell below when Enter pressed on empty list item', async () => {
    const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

    // Setup...
    const onNavigateToCell = vi.fn();
    const cellBlocks = new TableCellBlocks({
      api: mockApi,
      gridElement: gridEl,
      tableBlockId: 'table-1',
      onNavigateToCell,
      onDeleteBlock: vi.fn(),
    });

    cellBlocks.setActiveCellWithBlocks({ row: 0, col: 0 });

    // Simulate empty list item
    const isEmpty = true;
    const result = cellBlocks.handleEnterInList(isEmpty);

    expect(result).toBe(true); // Handled
    expect(onNavigateToCell).toHaveBeenCalledWith({ row: 1, col: 0 });
  });

  it('should return false (not handled) for non-empty list item', async () => {
    const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

    const onNavigateToCell = vi.fn();
    const cellBlocks = new TableCellBlocks({
      api: mockApi,
      gridElement: gridEl,
      tableBlockId: 'table-1',
      onNavigateToCell,
    });

    cellBlocks.setActiveCellWithBlocks({ row: 0, col: 0 });

    const isEmpty = false;
    const result = cellBlocks.handleEnterInList(isEmpty);

    expect(result).toBe(false); // Not handled, let default behavior occur
    expect(onNavigateToCell).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`

Expected: FAIL - handleEnterInList doesn't exist

**Step 3: Write minimal implementation**

Add to `TableCellBlocks` class:

```typescript
/**
 * Handle Enter key in a list item within a cell
 * @param isEmpty - whether the list item content is empty
 * @returns true if handled (exit list), false if not handled (let default behavior)
 */
handleEnterInList(isEmpty: boolean): boolean {
  if (!this._activeCellWithBlocks) {
    return false;
  }

  // If empty, exit list and navigate to cell below
  if (isEmpty) {
    this.exitListToNextCell(this._activeCellWithBlocks);
    return true;
  }

  // Not empty - let default list behavior (create new item) occur
  return false;
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/table/table-cell-blocks.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/table/table-cell-blocks.ts test/unit/tools/table/table-cell-blocks.test.ts
git commit -m "feat(table): handle Enter key to exit list on empty item"
```

---

## Task 11: Update Table.save() for Block-Based Cells

**Files:**
- Modify: `src/tools/table/index.ts`
- Test: `test/unit/tools/table/index.test.ts`

**Step 1: Write the failing test**

```typescript
describe('Table.save() with block-based cells', () => {
  it('should save block references for cells with nested blocks', async () => {
    const { Table } = await import('../../../../src/tools/table/index');

    const mockApi = {
      blocks: {},
      i18n: { t: (k: string) => k },
    } as unknown as API;

    const table = new Table({
      data: { withHeadings: false, content: [['', '']] },
      config: {},
      api: mockApi,
      readOnly: false,
      block: { id: 'table-1' } as any,
    });

    const element = table.render();

    // Manually set up a block-based cell
    const cell = element.querySelector('[data-blok-table-cell]') as HTMLElement;
    cell.setAttribute('contenteditable', 'false');
    cell.innerHTML = '';

    const container = document.createElement('div');
    container.setAttribute('data-blok-table-cell-blocks', '');

    const block = document.createElement('div');
    block.setAttribute('data-blok-block', 'list-1');
    container.appendChild(block);

    cell.appendChild(container);

    const saved = table.save(element);

    expect(saved.content[0][0]).toEqual({ blocks: ['list-1'] });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/table/index.test.ts`

Expected: Likely PASS if table-core.ts changes are already integrated

**Step 3: Verify implementation**

The `Table.save()` method calls `this.grid.getData()` which we already updated. Verify the integration is complete.

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/table/index.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add test/unit/tools/table/index.test.ts
git commit -m "test(table): add save test for block-based cells"
```

---

## Task 12: Update Sanitizer Config

**Files:**
- Modify: `src/tools/table/index.ts`
- Test: E2E test later

**Step 1: Update sanitizer**

In `src/tools/table/index.ts`, update the static `sanitize` getter:

```typescript
public static get sanitize(): ToolSanitizerConfig {
  return {
    content: {
      br: true,
      b: true,
      i: true,
      a: { href: true },
      ul: true,
      ol: true,
      li: true,
      input: { type: true, checked: true },
    },
  };
}
```

**Step 2: Commit**

```bash
git add src/tools/table/index.ts
git commit -m "feat(table): expand sanitizer to allow list elements"
```

---

## Task 13: E2E Test - Create List via Markdown Shortcut

**Files:**
- Create: `test/e2e/table-cell-lists.spec.ts`

**Step 1: Write the failing E2E test**

```typescript
// test/e2e/table-cell-lists.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Table cell lists', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should convert cell to unordered list when typing "- "', async ({ page }) => {
    // Create a table
    await page.keyboard.type('/table');
    await page.keyboard.press('Enter');

    // Wait for table to render
    await expect(page.locator('[data-blok-tool="table"]')).toBeVisible();

    // Focus first cell
    const firstCell = page.locator('[data-blok-table-cell]').first();
    await firstCell.click();

    // Type markdown trigger
    await page.keyboard.type('- ');

    // Should convert to block-based cell
    await expect(page.locator('[data-blok-table-cell-blocks]')).toBeVisible();

    // Should have a list item
    await expect(page.locator('[data-blok-tool="listItem"]')).toBeVisible();
  });

  test('should convert cell to ordered list when typing "1. "', async ({ page }) => {
    // Create a table
    await page.keyboard.type('/table');
    await page.keyboard.press('Enter');

    await expect(page.locator('[data-blok-tool="table"]')).toBeVisible();

    const firstCell = page.locator('[data-blok-table-cell]').first();
    await firstCell.click();

    await page.keyboard.type('1. First item');

    await expect(page.locator('[data-blok-table-cell-blocks]')).toBeVisible();

    // Verify it's an ordered list style
    const listItem = page.locator('[data-blok-tool="listItem"]');
    await expect(listItem).toBeVisible();
  });

  test('should convert cell to checklist when typing "[] "', async ({ page }) => {
    await page.keyboard.type('/table');
    await page.keyboard.press('Enter');

    await expect(page.locator('[data-blok-tool="table"]')).toBeVisible();

    const firstCell = page.locator('[data-blok-table-cell]').first();
    await firstCell.click();

    await page.keyboard.type('[] Todo item');

    await expect(page.locator('[data-blok-table-cell-blocks]')).toBeVisible();

    // Checklist should have a checkbox
    await expect(page.locator('input[type="checkbox"]')).toBeVisible();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn e2e test/e2e/table-cell-lists.spec.ts`

Expected: FAIL - conversion not yet working end-to-end

**Step 3: Debug and fix integration issues**

This is where integration issues will surface. Common issues:
- Block mounting into cell container
- Focus management after conversion
- Event propagation

**Step 4: Run test to verify it passes**

Run: `yarn e2e test/e2e/table-cell-lists.spec.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add test/e2e/table-cell-lists.spec.ts
git commit -m "test(table): add E2E tests for cell list creation"
```

---

## Task 14: E2E Test - Keyboard Navigation

**Files:**
- Modify: `test/e2e/table-cell-lists.spec.ts`

**Step 1: Write the test**

```typescript
test.describe('Keyboard navigation in cell lists', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Create table and list in first cell
    await page.keyboard.type('/table');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-blok-tool="table"]')).toBeVisible();

    const firstCell = page.locator('[data-blok-table-cell]').first();
    await firstCell.click();
    await page.keyboard.type('- Item 1');
  });

  test('Tab should navigate to next cell', async ({ page }) => {
    await page.keyboard.press('Tab');

    // Focus should be in second cell
    const secondCell = page.locator('[data-blok-table-cell]').nth(1);
    await expect(secondCell).toBeFocused();
  });

  test('Shift+Tab should navigate to previous cell', async ({ page }) => {
    // First go to second cell
    await page.keyboard.press('Tab');

    // Then Shift+Tab back
    await page.keyboard.press('Shift+Tab');

    // Should be back in first cell's list
    const firstCell = page.locator('[data-blok-table-cell]').first();
    await expect(firstCell.locator('[data-blok-table-cell-blocks]')).toBeVisible();
  });

  test('Enter on empty item should exit to cell below', async ({ page }) => {
    // Create empty item
    await page.keyboard.press('Enter');

    // Press Enter again on the empty item
    await page.keyboard.press('Enter');

    // Should navigate to cell below (first column, second row)
    const cellBelow = page.locator('[data-blok-table-row]').nth(1).locator('[data-blok-table-cell]').first();
    await expect(cellBelow).toBeFocused();
  });

  test('Shift+Enter should exit list immediately', async ({ page }) => {
    await page.keyboard.type(' with content');
    await page.keyboard.press('Shift+Enter');

    // Should navigate to cell below
    const cellBelow = page.locator('[data-blok-table-row]').nth(1).locator('[data-blok-table-cell]').first();
    await expect(cellBelow).toBeFocused();
  });
});
```

**Step 2: Run tests**

Run: `yarn e2e test/e2e/table-cell-lists.spec.ts`

**Step 3: Fix any issues**

**Step 4: Commit**

```bash
git add test/e2e/table-cell-lists.spec.ts
git commit -m "test(table): add E2E tests for cell list keyboard navigation"
```

---

## Task 15: Handle Row/Column Operations with Block Cells

**Files:**
- Modify: `src/tools/table/index.ts`
- Test: `test/unit/tools/table/row-col-operations.test.ts`

**Step 1: Write failing test**

```typescript
describe('Row/column operations with block cells', () => {
  it('should delete blocks when deleting a row with block cells', async () => {
    const mockDeleteBlock = vi.fn();
    // Setup table with block cell...

    // Delete row
    // Verify blocks were deleted
    expect(mockDeleteBlock).toHaveBeenCalledWith('block-1');
  });

  it('should clone blocks when duplicating a row with block cells', async () => {
    // Setup and verify new block IDs are generated
  });
});
```

**Step 2: Implement block cleanup on row/column delete**

In the `handleRowColAction` method, before calling `this.grid.deleteRow()`, collect block IDs from cells in that row and delete them.

**Step 3: Run tests**

**Step 4: Commit**

```bash
git add src/tools/table/index.ts test/unit/tools/table/row-col-operations.test.ts
git commit -m "feat(table): handle block cleanup on row/column delete"
```

---

## Task 16: Final Integration Testing

**Files:**
- Review all test files

**Step 1: Run all unit tests**

```bash
yarn test
```

**Step 2: Run all E2E tests**

```bash
yarn e2e
```

**Step 3: Run lint and type check**

```bash
yarn lint
```

**Step 4: Manual testing checklist**

- [ ] Type `- ` in cell → creates unordered list
- [ ] Type `1. ` in cell → creates ordered list
- [ ] Type `[] ` in cell → creates checklist
- [ ] Enter in list → creates new item
- [ ] Enter on empty item → exits to cell below
- [ ] Shift+Enter → exits to cell below
- [ ] Tab → navigates to next cell
- [ ] Shift+Tab → navigates to previous cell
- [ ] Last row exit → stays in cell
- [ ] Backspace on empty first item → converts back to plain cell
- [ ] Delete row with list → removes list blocks
- [ ] Save and reload → preserves list data

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(table): address integration testing feedback"
```

---

## Summary

| Task | Description | Files Changed |
|------|-------------|---------------|
| 1 | Update TableData type | types.ts |
| 2 | Create table-cell-blocks module | table-cell-blocks.ts |
| 3 | Add markdown pattern detection | table-cell-blocks.ts |
| 4 | Create TableCellBlocks class | table-cell-blocks.ts |
| 5 | Implement cell conversion | table-cell-blocks.ts |
| 6 | Add input listener | table-cell-blocks.ts |
| 7 | Integrate into Table tool | index.ts |
| 8 | Update table-core for blocks | table-core.ts |
| 9 | Add keyboard navigation | table-cell-blocks.ts |
| 10 | Handle Enter in list items | table-cell-blocks.ts |
| 11 | Update Table.save() | index.ts |
| 12 | Update sanitizer config | index.ts |
| 13 | E2E: Create list via markdown | E2E tests |
| 14 | E2E: Keyboard navigation | E2E tests |
| 15 | Row/column operations | index.ts |
| 16 | Final integration testing | All |
