import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import type { TableData, TableConfig, CellContent } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions, HTMLPasteEvent } from '../../../../types';

/**
 * INVARIANT under test:
 *
 *   In edit mode, every table cell must contain at least one editable target
 *   (`[contenteditable="true"]`). No cell is ever left non-editable.
 *
 * This guards a class of bug where a stored empty cell `{ blocks: [] }`
 * (produced by migrating empty source cells in older published articles) ends
 * up with ZERO editable target, so the user cannot click into / type in it.
 *
 * A targeted fix already landed for the read-only → edit toggle path
 * (setReadOnly(false) now runs ensureCellHasBlock on every cell). These tests
 * prove the invariant holds across EVERY edit-mode entry point:
 *
 *   1. Fresh edit render of `{ blocks: [] }` cells (multiple empty, multiple rows)
 *   2. read-only render → setReadOnly(false) toggle
 *   3. Multiple toggle cycles (edit ↔ read-only)
 *   4. setData() in edit mode with new empty `{ blocks: [] }` cells
 *   5. onPaste() of an HTML table with empty <td></td> cells
 *   6. Legacy string cell shapes ('' plain string + `{ blocks: [] }`)
 *   7. Deleting the only block in a cell → auto-repair via ensureCellHasBlock
 *
 * Harness mirrors test/unit/tools/table/table-empty-cell-editable.repro.test.ts
 * verbatim (createMockAPI + createTableOptions + getCell + countEditables).
 * The insert mock builds a holder containing a [contenteditable="true"] child,
 * mirroring how a real paragraph block renders, so editable targets are
 * assertable. NO production code is modified.
 */

const createMockAPI = (overrides: Partial<Record<string, unknown>> = {}): API => {
  const { blocks: blocksOverrides, events: eventsOverrides, ...restOverrides } = overrides;

  return {
    styles: {
      block: 'blok-block',
      inlineToolbar: 'blok-inline-toolbar',
      inlineToolButton: 'blok-inline-tool-button',
      inlineToolButtonActive: 'blok-inline-tool-button--active',
      input: 'blok-input',
      loader: 'blok-loader',
      button: 'blok-button',
      settingsButton: 'blok-settings-button',
      settingsButtonActive: 'blok-settings-button--active',
    },
    i18n: {
      t: (key: string) => key,
    },
    blocks: {
      delete: vi.fn(),
      getChildren: vi.fn().mockReturnValue([]),
      getById: vi.fn().mockReturnValue(null),
      insert: vi.fn().mockImplementation(() => {
        const holder = document.createElement('div');
        const id = `mock-${Math.random().toString(36).slice(2, 8)}`;

        holder.setAttribute('data-blok-id', id);

        // Real paragraph blocks render a contenteditable element inside their
        // holder. The mock mirrors that so we can assert on editable targets.
        const editable = document.createElement('div');

        editable.setAttribute('contenteditable', 'true');
        holder.appendChild(editable);

        return { id, holder };
      }),
      getCurrentBlockIndex: vi.fn().mockReturnValue(0),
      getBlocksCount: vi.fn().mockReturnValue(0),
      getBlockIndex: vi.fn().mockReturnValue(undefined),
      getBlockByIndex: vi.fn().mockReturnValue(undefined),
      setBlockParent: vi.fn(),
      transactWithoutCapture: vi.fn((fn: () => void) => fn()),
      ...(blocksOverrides as Record<string, unknown>),
    },
    events: {
      on: vi.fn(),
      off: vi.fn(),
      ...(eventsOverrides as Record<string, unknown>),
    },
    ...restOverrides,
  } as unknown as API;
};

const createTableOptions = (
  data: Partial<TableData> = {},
  config: TableConfig = {},
  apiOverrides: Partial<Record<string, unknown>> = {},
  readOnly = false,
): BlockToolConstructorOptions<TableData, TableConfig> => ({
  data: { withHeadings: false, withHeadingColumn: false, content: [], ...data } as TableData,
  config,
  api: createMockAPI(apiOverrides),
  readOnly,
  block: { id: 'table-invariant-test' } as never,
});

/**
 * Create an HTMLPasteEvent containing a simple HTML table.
 * `cell` values are placed verbatim as the innerHTML of each <td> — pass ''
 * for an empty cell (renders as `<td></td>`).
 */
const createPasteEvent = (rows: string[][]): HTMLPasteEvent => {
  const tableHtml = `<table>${rows.map(
    row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`
  ).join('')}</table>`;

  const parser = new DOMParser();
  const doc = parser.parseFromString(tableHtml, 'text/html');
  const tableEl = doc.querySelector('table') as HTMLTableElement;

  return {
    detail: { data: tableEl },
  } as unknown as HTMLPasteEvent;
};

/**
 * Find the cell element at a given row/col inside the rendered wrapper.
 */
const getCell = (wrapper: HTMLElement, row: number, col: number): HTMLElement => {
  const rows = wrapper.querySelectorAll<HTMLElement>('[data-blok-table-row]');
  const rowEl = rows[row];

  const cell = rowEl.querySelector<HTMLElement>(`[data-blok-table-cell-col="${col}"]`);

  if (!cell) {
    throw new Error(`cell (${row}, ${col}) not found`);
  }

  return cell;
};

/**
 * Count the editable targets ([contenteditable="true"]) inside a cell.
 */
const countEditables = (cell: HTMLElement): number =>
  cell.querySelectorAll('[contenteditable="true"]').length;

/**
 * Assert the invariant for EVERY cell of the rendered table: in edit mode each
 * cell must have at least one editable target.
 */
const assertEveryCellEditable = (wrapper: HTMLElement): void => {
  const rowEls = wrapper.querySelectorAll<HTMLElement>('[data-blok-table-row]');

  rowEls.forEach((rowEl, rowIndex) => {
    const cells = rowEl.querySelectorAll<HTMLElement>('[data-blok-table-cell]');

    cells.forEach((cell, colIndex) => {
      expect(
        countEditables(cell),
        `cell (${rowIndex}, ${colIndex}) must have >0 editable targets in edit mode`
      ).toBeGreaterThan(0);
    });
  });
};

describe('Table cell editability invariant', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  describe('Scenario 1 — fresh edit render with empty { blocks: [] } cells', () => {
    it('gives every empty cell an editable target across multiple rows/cols', () => {
      // 2×3 grid; the diagonal-ish spread of empty cells plus a real-value cell.
      const content: CellContent[][] = [
        [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
        [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
      ];

      const options = createTableOptions({ content });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      // Spot-check specific empty cells and then assert the whole grid.
      expect(countEditables(getCell(element, 0, 0))).toBeGreaterThan(0);
      expect(countEditables(getCell(element, 0, 2))).toBeGreaterThan(0);
      expect(countEditables(getCell(element, 1, 1))).toBeGreaterThan(0);

      assertEveryCellEditable(element);
    });
  });

  describe('Scenario 2 — read-only render then setReadOnly(false) toggle', () => {
    it('empty cell has 0 editables in read-only, >0 after toggling to edit', () => {
      const content: CellContent[][] = [
        [{ blocks: [] }, { blocks: [] }],
      ];

      const options = createTableOptions({ content }, {}, {}, true);
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      // Read-only: no editable targets in the empty cells (expected).
      expect(countEditables(getCell(element, 0, 0))).toBe(0);
      expect(countEditables(getCell(element, 0, 1))).toBe(0);

      table.setReadOnly(false);

      // Edit mode: every cell must now be editable.
      assertEveryCellEditable(element);
    });
  });

  describe('Scenario 3 — multiple read-only ↔ edit toggle cycles', () => {
    it('empty cell stays editable after repeated toggling', () => {
      const content: CellContent[][] = [
        [{ blocks: [] }, { blocks: [] }],
        [{ blocks: [] }, { blocks: [] }],
      ];

      // Start in edit mode.
      const options = createTableOptions({ content });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      assertEveryCellEditable(element);

      // Cycle edit → read-only → edit several times.
      for (let cycle = 0; cycle < 3; cycle++) {
        table.setReadOnly(true);

        // Read-only mode: editable targets are removed.
        expect(countEditables(getCell(element, 0, 0))).toBe(0);

        table.setReadOnly(false);

        // Back in edit mode: every cell must be editable again.
        assertEveryCellEditable(element);
      }
    });
  });

  describe('Scenario 4 — setData() in edit mode with empty { blocks: [] } cells', () => {
    it('every cell from the new content is editable', () => {
      // Start with simple string content, then replace with empty-cell content.
      const options = createTableOptions({ content: [['A', 'B']] });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      const newContent: CellContent[][] = [
        [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
        [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
      ];

      table.setData({ content: newContent });

      const newWrapper = container.firstElementChild as HTMLElement;

      assertEveryCellEditable(newWrapper);
    });
  });

  describe('Scenario 5 — onPaste() of an HTML table with empty <td></td> cells', () => {
    it('every pasted cell is editable, including the empty ones', () => {
      const options = createTableOptions({ content: [['A']] });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      // 2×3 pasted table: a mix of filled and empty <td></td> cells.
      const pasteEvent = createPasteEvent([
        ['X', '', 'Z'],
        ['', 'Q', ''],
      ]);

      table.onPaste(pasteEvent);

      const newWrapper = container.firstElementChild as HTMLElement;

      // Spot-check the empty cells specifically.
      expect(countEditables(getCell(newWrapper, 0, 1))).toBeGreaterThan(0);
      expect(countEditables(getCell(newWrapper, 1, 0))).toBeGreaterThan(0);
      expect(countEditables(getCell(newWrapper, 1, 2))).toBeGreaterThan(0);

      assertEveryCellEditable(newWrapper);
    });
  });

  describe('Scenario 6 — legacy string cell shapes mixed with { blocks: [] }', () => {
    it('plain empty string cell and empty-blocks cell both become editable', () => {
      // A row mixing a plain empty legacy string '' and an empty { blocks: [] }.
      // LegacyCellContent permits string entries, so the row is heterogeneous.
      const content: TableData['content'] = [
        ['', { blocks: [] }, 'text'],
      ];

      const options = createTableOptions({ content });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      // Empty legacy string cell.
      expect(countEditables(getCell(element, 0, 0))).toBeGreaterThan(0);
      // Empty { blocks: [] } cell.
      expect(countEditables(getCell(element, 0, 1))).toBeGreaterThan(0);

      assertEveryCellEditable(element);
    });
  });

  describe('Scenario 7 — deleting the only block in a cell auto-repairs editability', () => {
    /**
     * The mock CAN drive a block-removed event because TableCellBlocks
     * registers its handler synchronously in its constructor via
     * api.events.on('block changed', handler). We capture that handler from
     * the events.on mock, then invoke it with a synthetic block-removed event.
     *
     * The repair flow exercised:
     *   handleBlockRemoved → model.removeBlockFromCell + schedule pending check
     *   → queueMicrotask → ensureCellHasBlock (insert paragraph) on the empty cell.
     *
     * ensureCellHasBlock uses api.blocks.insert (mock builds a contenteditable)
     * and api.blocks.transactWithoutCapture (mock runs fn synchronously), so a
     * fresh editable target is synthesized. We await a microtask flush before
     * asserting.
     */
    it('re-synthesizes an editable target after the cell loses its only block', async () => {
      // Capture the 'block changed' handler the TableCellBlocks constructor
      // registers, so we can drive a block-removed event through it.
      let blockChangedHandler: ((data: unknown) => void) | null = null;

      const eventsOn = vi.fn((eventName: string, handler: (data: unknown) => void) => {
        if (eventName === 'block changed') {
          blockChangedHandler = handler;
        }
      });

      // A 1×1 table whose single cell holds one referenced block 'p-0'.
      const cellBlockId = 'p-0';
      const cellHolder = document.createElement('div');

      cellHolder.setAttribute('data-blok-id', cellBlockId);

      const editable = document.createElement('div');

      editable.setAttribute('contenteditable', 'true');
      cellHolder.appendChild(editable);

      const blockRecord = {
        id: cellBlockId,
        name: 'paragraph',
        holder: cellHolder,
        parentId: 'table-invariant-test',
        preservedData: { text: 'value' },
      };

      const apiOverrides = {
        blocks: {
          getBlockIndex: vi.fn((id: string) => (id === cellBlockId ? 0 : undefined)),
          getBlockByIndex: vi.fn((index: number) => (index === 0 ? blockRecord : undefined)),
          getById: vi.fn((id: string) => (id === cellBlockId ? blockRecord : null)),
          getChildren: vi.fn().mockReturnValue([blockRecord]),
          getBlocksCount: vi.fn().mockReturnValue(1),
        },
        events: { on: eventsOn, off: vi.fn() },
      };

      const content: CellContent[][] = [
        [{ blocks: [cellBlockId] }],
      ];

      const options = createTableOptions({ content }, {}, apiOverrides);
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      const cell = getCell(element, 0, 0);

      // The referenced block mounted with its editable target.
      expect(countEditables(cell)).toBeGreaterThan(0);
      expect(blockChangedHandler).not.toBeNull();

      // Simulate the user deleting the only block: remove its holder from the
      // cell (as the editor would) and drive the block-removed event.
      cellHolder.remove();

      if (blockChangedHandler === null) {
        throw new Error('block changed handler was not registered');
      }

      const handler: (data: unknown) => void = blockChangedHandler;

      handler({
        event: {
          type: 'block-removed',
          detail: {
            target: { id: cellBlockId, holder: cellHolder },
            index: 0,
          },
        },
      });

      // ensureCellHasBlock is scheduled on a microtask; flush it.
      await Promise.resolve();
      await Promise.resolve();

      // The cell must have auto-repaired with a fresh editable target.
      expect(countEditables(cell)).toBeGreaterThan(0);
    });
  });

  describe('Scenario 8 — merged-origin empty cell through read-only → edit toggle', () => {
    it('an empty merged origin cell becomes editable after toggling to edit', () => {
      // Origin cell (0,0) spans 2 columns and is EMPTY; (0,1) is covered by the
      // merge. Rendered via the merge-aware grid path (createGridFromModel).
      const content: CellContent[][] = [
        [{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
        [{ blocks: [] }, { blocks: [] }],
      ];

      const options = createTableOptions({ content }, {}, {}, true);
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      // Read-only: the empty origin cell has no editable target.
      expect(countEditables(getCell(element, 0, 0))).toBe(0);

      table.setReadOnly(false);

      // Edit mode: the merged origin cell must be editable, and so must every
      // other (non-covered) cell in the grid.
      expect(countEditables(getCell(element, 0, 0))).toBeGreaterThan(0);
      assertEveryCellEditable(element);
    });
  });

  describe('Scenario 9 — empty heading cells through read-only → edit toggle', () => {
    it('empty header row and header column cells become editable after toggling', () => {
      // First row are headings, first column is a heading column. All cells
      // empty so every header/body cell is the malformed { blocks: [] } shape.
      const content: CellContent[][] = [
        [{ blocks: [] }, { blocks: [] }],
        [{ blocks: [] }, { blocks: [] }],
      ];

      const options = createTableOptions(
        { content, withHeadings: true, withHeadingColumn: true },
        {},
        {},
        true
      );
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      // Read-only: the empty heading cell (0,0) has no editable target.
      expect(countEditables(getCell(element, 0, 0))).toBe(0);

      table.setReadOnly(false);

      // Edit mode: heading cells must be editable too — no cell left behind.
      expect(countEditables(getCell(element, 0, 0))).toBeGreaterThan(0);
      expect(countEditables(getCell(element, 0, 1))).toBeGreaterThan(0);
      assertEveryCellEditable(element);
    });
  });
});
