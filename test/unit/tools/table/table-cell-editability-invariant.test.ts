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

  describe('Scenario 10 — ragged/jagged rows (live KB shape)', () => {
    it('synthesizes editable targets for trailing gap cells in short rows', () => {
      // Mirrors the deployed KB table (block DQfJHidzTi): a 3-column-wide grid
      // whose later rows store FEWER cells than the widest row. The widest row
      // sets the rendered column count, so createGrid pads every short row out
      // to 3 DOM cells — but initializeCells() iterates only the STORED (short)
      // row, so the trailing gap cells were never visited and got no paragraph
      // block → zero contenteditable target → impossible to click into or type.
      const content: CellContent[][] = [
        [{ blocks: [] }, { blocks: [] }, { blocks: [] }], // 3 cols (widest)
        [{ blocks: [] }, { blocks: [] }],                 // 2 cols — col 2 is a gap
        [{ blocks: [] }],                                 // 1 col  — cols 1,2 are gaps
      ];

      const options = createTableOptions({ content });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      // The gap cells the stored rows never described must still be editable.
      expect(countEditables(getCell(element, 1, 2))).toBeGreaterThan(0);
      expect(countEditables(getCell(element, 2, 1))).toBeGreaterThan(0);
      expect(countEditables(getCell(element, 2, 2))).toBeGreaterThan(0);

      assertEveryCellEditable(element);
    });
  });

  describe('Scenario 11 — ragged HTML paste (uneven <td> counts)', () => {
    it('pads short pasted rows so every cell is editable', () => {
      const options = createTableOptions({ content: [['A']] });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      // Pasted HTML where the first row is widest (3 cells) and later rows are
      // short — the gap cells must still synthesize an editable target.
      const pasteEvent = createPasteEvent([
        ['X', 'Y', 'Z'],
        ['P', 'Q'],
        ['R'],
      ]);

      table.onPaste(pasteEvent);

      const newWrapper = container.firstElementChild as HTMLElement;

      expect(countEditables(getCell(newWrapper, 1, 2))).toBeGreaterThan(0);
      expect(countEditables(getCell(newWrapper, 2, 1))).toBeGreaterThan(0);
      expect(countEditables(getCell(newWrapper, 2, 2))).toBeGreaterThan(0);

      assertEveryCellEditable(newWrapper);
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

  describe('Scenario 12 — empty rows widen via grid fallback (maxCols 0)', () => {
    it('keeps every rendered cell editable when stored rows carry no cells', () => {
      // Pathological-but-possible stored shape: rows exist but each is empty, so
      // maxCols === 0. createFlatGrid then falls back to DEFAULT_COLS, rendering
      // columns the model never described. If model width is not reconciled with
      // the rendered grid, those cells get no block → non-editable. This is the
      // same model-vs-grid mismatch class as ragged rows, via a different door.
      const content: CellContent[][] = [[], []];

      const options = createTableOptions({ content });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      assertEveryCellEditable(element);
    });
  });

  describe('Scenario 14 — split (unmerge) reveals editable cells', () => {
    it('gives every revealed cell an editable target after merge → split', () => {
      // Merge collapses N cells into one origin (revealed cells -> blocks: []),
      // then split restores them. splitCellInternal deliberately empties the
      // revealed cells and rebuildTableBody only re-mounts EXISTING holders — so
      // without a backstop the revealed cells have no paragraph and cannot be
      // clicked into or typed in. This is the same non-editable-cell bug class
      // via the merge/split door (the initializeCells sweep skips merge tables).
      const content: CellContent[][] = [
        [{ blocks: [] }, { blocks: [] }],
        [{ blocks: [] }, { blocks: [] }],
      ];

      const table = new Table(createTableOptions({ content }));
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      const internals = table as unknown as {
        model: {
          mergeCells: (r: { minRow: number; maxRow: number; minCol: number; maxCol: number }) => void;
          splitCell: (r: number, c: number) => void;
        };
        rebuildTableBody: () => void;
      };

      internals.model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
      internals.rebuildTableBody();

      internals.model.splitCell(0, 0);
      internals.rebuildTableBody();

      // Every revealed cell — not just the origin — must be editable again.
      expect(countEditables(getCell(element, 0, 1))).toBeGreaterThan(0);
      expect(countEditables(getCell(element, 1, 0))).toBeGreaterThan(0);
      expect(countEditables(getCell(element, 1, 1))).toBeGreaterThan(0);
      assertEveryCellEditable(element);

      // Save integrity: the backstop must not duplicate any block holder, and
      // the split must leave no merge metadata behind in the persisted model.
      const holderIds = Array.from(element.querySelectorAll('[data-blok-id]'))
        .map(el => el.getAttribute('data-blok-id'));

      expect(new Set(holderIds).size).toBe(holderIds.length);

      element.querySelectorAll('td').forEach(td => {
        expect(td.colSpan).toBeLessThanOrEqual(1);
        expect(td.rowSpan).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('Scenario 15 — delete a row/col straddling a merge reveals editable cells', () => {
    const getGridEl = (wrapper: HTMLElement): HTMLElement => {
      const scrollContainer = wrapper.firstElementChild as HTMLElement;

      return scrollContainer.firstElementChild as HTMLElement;
    };

    const invokeAction = (table: Table, gridEl: HTMLElement, action: unknown): void => {
      const subsystems = (table as unknown as {
        subsystems: { handleRowColAction: (g: HTMLElement, a: unknown) => void };
      }).subsystems;

      subsystems.handleRowColAction(gridEl, action);
    };

    it('keeps the promoted cell editable after deleting the origin row of a vertical merge', () => {
      // Vertical merge: cell (0,0) rowspan 2 covers (1,0). Deleting row 0 (the
      // merge-origin row) makes the model promote the covered cell (1,0) into a
      // real standalone cell with blocks. But the DOM delete path (grid.deleteRow)
      // only removes the <tr> + reindexes — it never creates a <td> for the
      // promoted cell, so it has no editable target and its block holder is
      // orphaned. rebuildTableBody (used by merge/split) is the only primitive
      // that re-creates <td>s for revealed cells + runs the editability backstop.
      const content: CellContent[][] = [
        [{ blocks: [], rowspan: 2 }, { blocks: [] }],
        [{ blocks: [], mergedInto: [0, 0] }, { blocks: [] }],
      ];

      const table = new Table(createTableOptions({ content }));
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      const gridEl = getGridEl(element);

      invokeAction(table, gridEl, { type: 'delete-row', index: 0 });

      // One row remains; the model has 2 columns, so the DOM must render 2 cells
      // and BOTH must be editable (the promoted cell is the one that used to be
      // merge-covered).
      const rows = element.querySelectorAll<HTMLElement>('[data-blok-table-row]');

      expect(rows).toHaveLength(1);
      expect(rows[0].querySelectorAll('[data-blok-table-cell]')).toHaveLength(2);
      assertEveryCellEditable(element);
    });

    it('keeps the promoted cell editable after deleting the origin column of a horizontal merge', () => {
      // Horizontal mirror: cell (0,0) colspan 2 covers (0,1). Deleting column 0
      // promotes the covered cell; the DOM must re-render it editable.
      const content: CellContent[][] = [
        [{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
        [{ blocks: [] }, { blocks: [] }],
      ];

      const table = new Table(createTableOptions({ content }));
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      const gridEl = getGridEl(element);

      invokeAction(table, gridEl, { type: 'delete-col', index: 0 });

      const rows = element.querySelectorAll<HTMLElement>('[data-blok-table-row]');

      expect(rows).toHaveLength(2);
      rows.forEach(row => {
        expect(row.querySelectorAll('[data-blok-table-cell]')).toHaveLength(1);
      });
      assertEveryCellEditable(element);

      // The rebuild must also reconcile the <colgroup>: one column remains, so
      // exactly one <col> must survive — a stale extra <col> desyncs the grid
      // width and getColumnCount() from the model.
      expect(gridEl.querySelectorAll('colgroup col')).toHaveLength(1);
    });
  });

  describe('Scenario 13 — fuzz: arbitrary jagged shapes across every entry point', () => {
    // The durable regression net. Any future code path that lets the stored
    // model and the rendered grid disagree on width re-opens the non-editable
    // cell bug. This drives a deterministic spread of jagged shapes through
    // EVERY edit-mode entry point and asserts the invariant holds for all of
    // them, so the bug class cannot silently return in a new shape.
    //
    // Seeded LCG (Date.now/Math.random are unavailable) → identical shapes every
    // run, so a regression reproduces deterministically.
    let seed = 0x5eed;
    const next = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const makeJaggedShape = (): CellContent[][] => {
      const rowCount = 1 + Math.floor(next() * 4); // 1..4 rows
      const widest = 1 + Math.floor(next() * 3);   // 1..3 cols on the widest row

      return Array.from({ length: rowCount }, (_, r) => {
        // First row is the widest so the grid column count is deterministic;
        // later rows are randomly shorter (the ragged gap), down to 1 cell.
        const len = r === 0 ? widest : 1 + Math.floor(next() * widest);

        return Array.from({ length: len }, () => ({ blocks: [] as string[] }));
      });
    };

    // Each case builds 20 full tables synchronously. That fits comfortably in the
    // 5s default in isolation, but under a saturated full-suite run the worker is
    // preempted and a single case can blow the wall-clock budget. Give the heavy
    // fuzz cases generous headroom so contention spikes don't flake them — a real
    // hang still trips this ceiling.
    const FUZZ_TIMEOUT_MS = 20_000;

    it('constructor render: every cell editable for all shapes', () => {
      for (let t = 0; t < 20; t++) {
        const local = document.createElement('div');

        document.body.appendChild(local);

        const table = new Table(createTableOptions({ content: makeJaggedShape() }));
        const element = table.render();

        local.appendChild(element);
        table.rendered();

        assertEveryCellEditable(element);
        local.remove();
      }
    }, FUZZ_TIMEOUT_MS);

    it('setData in edit mode: every cell editable for all shapes', () => {
      for (let t = 0; t < 20; t++) {
        const local = document.createElement('div');

        document.body.appendChild(local);

        // Start from a simple table, then replace its data with a jagged shape.
        const table = new Table(createTableOptions({ content: [['seed']] }));
        const element = table.render();

        local.appendChild(element);
        table.rendered();

        table.setData({ content: makeJaggedShape() });

        const wrapper = local.firstElementChild as HTMLElement;

        assertEveryCellEditable(wrapper);
        local.remove();
      }
    }, FUZZ_TIMEOUT_MS);

    it('onPaste: every cell editable for all shapes', () => {
      for (let t = 0; t < 20; t++) {
        const local = document.createElement('div');

        document.body.appendChild(local);

        const table = new Table(createTableOptions({ content: [['seed']] }));
        const element = table.render();

        local.appendChild(element);
        table.rendered();

        const shape = makeJaggedShape().map(row => row.map((_, i) => `c${i}`));

        table.onPaste(createPasteEvent(shape));

        const wrapper = local.firstElementChild as HTMLElement;

        assertEveryCellEditable(wrapper);
        local.remove();
      }
    }, FUZZ_TIMEOUT_MS);

    it('read-only render then setReadOnly(false): every cell editable for all shapes', () => {
      for (let t = 0; t < 20; t++) {
        const local = document.createElement('div');

        document.body.appendChild(local);

        const table = new Table(createTableOptions({ content: makeJaggedShape() }, {}, {}, true));
        const element = table.render();

        local.appendChild(element);
        table.rendered();

        table.setReadOnly(false);

        assertEveryCellEditable(element);
        local.remove();
      }
    }, FUZZ_TIMEOUT_MS);
  });

  /**
   * Scenario 16 — the MODEL side of the invariant.
   *
   * Scenarios 1-15 assert the DOM half: an empty `{ blocks: [] }` cell gets an
   * editable target. This asserts the half that survives a save: the synthesized
   * paragraph must also be RECORDED in the table model, so `save()` emits a real
   * reference for that cell.
   *
   * Both halves are load-bearing and fail in opposite directions:
   * - A DOM-only repair (holder mounted, model not updated) is lost on save: the
   *   cell reverts to `{ blocks: [] }` and the block becomes a top-level orphan.
   * - A model-only repair (id recorded, no holder) leaves a dangling reference
   *   that resolves to nothing on reload.
   *
   * This is the assertion the e2e `table-migrated-cell-content-preserve` spec was
   * groping at when it demanded an empty cell "stay empty" — which contradicts the
   * editability invariant. An empty cell CANNOT stay `{ blocks: [] }` in edit mode;
   * it must reference exactly ONE empty paragraph (its editable target), and no
   * populated cell may lose a reference to it.
   */
  describe('Scenario 16 — the synthesized editable target is recorded in saved data', () => {
    const TABLE_ID = 'table-invariant-test';

    interface RegistryBlock {
      id: string;
      holder: HTMLElement;
      parentId: string | null;
      name: string;
      preservedData: Record<string, unknown>;
    }

    /**
     * A block registry the table's save() path can actually resolve.
     *
     * The shared harness stubs getById → null, which makes save() filter EVERY
     * reference out (it keeps only ids whose block is parented to this table),
     * so it cannot see the model. This registry mirrors BlockManager closely
     * enough for the read-only mount (getBlockIndex/getBlockByIndex), the
     * empty-cell repair (insert/setBlockParent) and save() (getById/parentId).
     */
    const createRegistryApi = (seedIds: string[]): {
      overrides: Partial<Record<string, unknown>>;
      blocks: RegistryBlock[];
    } => {
      const makeHolder = (id: string): HTMLElement => {
        const holder = document.createElement('div');

        holder.setAttribute('data-blok-id', id);

        const editable = document.createElement('div');

        editable.setAttribute('contenteditable', 'true');
        holder.appendChild(editable);

        return holder;
      };

      // Seeded children are parented to the table, mirroring the real load: the
      // Renderer's normalizeTableChildParents pre-step backfills `parent` on
      // cell-referenced children before the tool renders (the read-only mount
      // path itself deliberately never mutates block state).
      const blocks: RegistryBlock[] = seedIds.map(id => ({
        id,
        holder: makeHolder(id),
        parentId: TABLE_ID,
        name: 'paragraph',
        preservedData: { text: id },
      }));

      let counter = 0;

      const overrides = {
        blocks: {
          insert: vi.fn().mockImplementation(() => {
            counter += 1;

            const block: RegistryBlock = {
              id: `synth-${counter}`,
              holder: makeHolder(`synth-${counter}`),
              parentId: null,
              name: 'paragraph',
              preservedData: { text: '' },
            };

            blocks.push(block);

            return block;
          }),
          getBlocksCount: vi.fn().mockImplementation(() => blocks.length),
          getBlockIndex: vi.fn().mockImplementation((id: string) => {
            const index = blocks.findIndex(block => block.id === id);

            return index === -1 ? undefined : index;
          }),
          getBlockByIndex: vi.fn().mockImplementation((index: number) => blocks[index]),
          getById: vi.fn().mockImplementation(
            (id: string) => blocks.find(block => block.id === id) ?? null
          ),
          getChildren: vi.fn().mockImplementation(
            (parentId: string) => blocks.filter(block => block.parentId === parentId)
          ),
          setBlockParent: vi.fn().mockImplementation((id: string, parentId: string) => {
            const block = blocks.find(candidate => candidate.id === id);

            if (block) {
              block.parentId = parentId;
            }
          }),
          delete: vi.fn(),
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          transactWithoutCapture: vi.fn((fn: () => void) => fn()),
        },
      };

      return { overrides, blocks };
    };

    /** Every block id referenced by the saved content, in row-major order. */
    const savedRefs = (content: CellContent[][]): string[] =>
      content
        .flat()
        .flatMap(cell => (typeof cell === 'string' || !('blocks' in cell) ? [] : cell.blocks));

    const MIXED_CONTENT = (): CellContent[][] => [
      [{ blocks: ['m1', 'm2'] }, { blocks: ['m3'] }],
      [{ blocks: [] }, { blocks: ['m4'] }],
    ];

    it('an empty cell saves exactly one reference, matching the mounted editable block', () => {
      const { overrides } = createRegistryApi(['m1', 'm2', 'm3', 'm4']);
      const table = new Table(createTableOptions({ content: MIXED_CONTENT() }, {}, overrides, true));
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      table.setReadOnly(false);

      assertEveryCellEditable(element);

      const emptyCell = (table.save(element).content as CellContent[][])[1][0];

      if (typeof emptyCell === 'string' || !('blocks' in emptyCell)) {
        throw new Error('the repaired cell must save in the block-reference shape');
      }

      // Exactly one reference — the paragraph that makes the cell editable.
      expect(emptyCell.blocks).toHaveLength(1);

      // …and it is the block actually mounted in that cell's DOM, not a phantom id.
      const mountedId = getCell(element, 1, 0)
        .querySelector<HTMLElement>('[data-blok-id]')
        ?.getAttribute('data-blok-id');

      expect(mountedId).not.toBeNull();
      expect(emptyCell.blocks[0]).toBe(mountedId);
    });

    it('repairing the empty cell does not drop references from the populated cells', () => {
      const { overrides } = createRegistryApi(['m1', 'm2', 'm3', 'm4']);
      const table = new Table(createTableOptions({ content: MIXED_CONTENT() }, {}, overrides, true));
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      table.setReadOnly(false);

      const refs = savedRefs(table.save(element).content as CellContent[][]);

      for (const populated of ['m1', 'm2', 'm3', 'm4']) {
        expect(refs).toContain(populated);
      }

      // 4 populated + exactly 1 synthesized target for the empty cell.
      expect(refs).toHaveLength(5);
    });

    it('a fresh edit-mode render records the empty cell reference too (no path drift)', () => {
      const { overrides } = createRegistryApi(['m1', 'm2', 'm3', 'm4']);
      const table = new Table(createTableOptions({ content: MIXED_CONTENT() }, {}, overrides, false));
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      assertEveryCellEditable(element);

      const refs = savedRefs(table.save(element).content as CellContent[][]);

      expect(refs).toHaveLength(5);
      for (const populated of ['m1', 'm2', 'm3', 'm4']) {
        expect(refs).toContain(populated);
      }
    });
  });
});
