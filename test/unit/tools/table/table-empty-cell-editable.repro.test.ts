import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import type { TableData, TableConfig, CellContent } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

/**
 * Reproduction tests for non-editable table cells observed in a deployed KB
 * article (older published blok ~0.14.1). Two malformed stored cell shapes were
 * found in the live table data:
 *
 *   1. EMPTY cells stored as `{ blocks: [] }` — rendered as an empty cell blocks
 *      container with ZERO child blocks and ZERO contenteditable targets. The
 *      cell becomes completely non-editable (clicking focuses nothing).
 *
 *   2. An over-stuffed cell referencing 5 blocks whose paragraph texts are
 *      ["31.05", "", "", "", ""] — 1 real value + 4 trailing EMPTY paragraphs,
 *      which render a stack of placeholder hints.
 *
 * These tests determine whether current local master (0.15.1) reproduces the
 * problems. They do NOT modify production code.
 *
 * Harness mirrors test/unit/tools/table/table-lifecycle-rebuild.test.ts:
 * createMockAPI + createTableOptions, render() → append → rendered().
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
  block: { id: 'table-repro-test' } as never,
});

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

describe('Table empty-cell editability (repro)', () => {
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

  describe('TEST A — fresh edit render of an empty { blocks: [] } cell', () => {
    it('synthesizes an editable paragraph for a stored empty cell', () => {
      // A 1x2 table where cell (0,1) is the malformed empty cell.
      const content: CellContent[][] = [
        [{ blocks: [] }, { blocks: [] }],
      ];

      const options = createTableOptions({ content });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      const emptyCell = getCell(element, 0, 1);

      // The empty cell MUST end up with at least one editable target so the
      // user can click and type.
      expect(countEditables(emptyCell)).toBeGreaterThan(0);
    });
  });

  describe('TEST B — read-only render then setReadOnly(false) toggle', () => {
    // REGRESSION: setReadOnly(false) used to rebuild cell blocks via
    // initCellBlocks() only (constructs TableCellBlocks) and did NOT synthesize
    // paragraphs for empty cells, so a stored `{ blocks: [] }` cell that mounted
    // nothing in read-only mode got no editable target when toggled to edit mode
    // → the cell stayed non-editable. Fixed by ensuring every cell has a block
    // in the setReadOnly(false) exit branch.
    it('gives the previously-empty cell an editable paragraph after toggling to edit', () => {
      const content: CellContent[][] = [
        [{ blocks: [] }, { blocks: [] }],
      ];

      const options = createTableOptions({ content }, {}, {}, true);
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      // In read-only mode the empty cell has no editable targets (expected).
      const emptyCellRo = getCell(element, 0, 1);

      expect(countEditables(emptyCellRo)).toBe(0);

      // Toggle to edit mode in place.
      table.setReadOnly(false);

      const emptyCellEdit = getCell(element, 0, 1);

      // After toggling to edit mode the previously-empty cell MUST have an
      // editable contenteditable paragraph.
      expect(countEditables(emptyCellEdit)).toBeGreaterThan(0);
    });
  });

  describe('TEST C — over-stuffed cell referencing empty paragraphs', () => {
    it('reports how many blocks/editables and whether stray placeholders leak in edit mode', () => {
      // The over-stuffed cell references 5 existing paragraph blocks whose
      // texts are ["31.05", "", "", "", ""] — 1 real value + 4 empty.
      const texts = ['31.05', '', '', '', ''];
      const blockIds = texts.map((_, i) => `p-${i}`);

      // Build holders for the 5 referenced paragraph blocks. Each empty
      // paragraph carries an active placeholder attribute, mirroring how empty
      // paragraph blocks render their placeholder hint.
      const holders = texts.map((text, i) => {
        const holder = document.createElement('div');

        holder.setAttribute('data-blok-id', blockIds[i]);

        const editable = document.createElement('div');

        editable.setAttribute('contenteditable', 'true');
        editable.textContent = text;

        if (text === '') {
          editable.setAttribute('data-blok-placeholder-active', '');
        }
        holder.appendChild(editable);

        return holder;
      });

      const indexById = new Map(blockIds.map((id, i) => [id, i] as const));

      const blockRecords = blockIds.map((id, i) => ({
        id,
        name: 'paragraph',
        holder: holders[i],
        parentId: 'table-repro-test',
        preservedData: { text: texts[i] },
      }));

      const apiOverrides = {
        blocks: {
          getBlockIndex: vi.fn((id: string) => indexById.get(id)),
          getBlockByIndex: vi.fn((index: number) => blockRecords[index]),
          getById: vi.fn((id: string) => {
            const idx = indexById.get(id);

            return idx === undefined ? null : blockRecords[idx];
          }),
          getChildren: vi.fn().mockReturnValue(blockRecords),
          getBlocksCount: vi.fn().mockReturnValue(blockRecords.length),
        },
      };

      // 1x1 table whose single cell references all 5 blocks.
      const content: CellContent[][] = [
        [{ blocks: [...blockIds] }],
      ];

      const options = createTableOptions({ content }, {}, apiOverrides);
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      const cell = getCell(element, 0, 0);

      const mountedBlocks = cell.querySelectorAll('[data-blok-id]').length;
      const editables = countEditables(cell);
      const leakedPlaceholders = cell.querySelectorAll('[data-blok-placeholder-active]').length;

      // Diagnostic report. Findings on current master:
      //  - All 5 referenced blocks ARE mounted (the structural over-stuffing
      //    persists — 1 real value + 4 trailing empty paragraphs remain).
      //  - All 5 have editable targets.
      //  - NO placeholder hints leak: initializeCells() calls
      //    stripPlaceholders() on the container, removing every
      //    data-blok-placeholder-active attribute in edit mode. So the visual
      //    "stack of placeholder hints" problem does NOT reproduce here; the
      //    empty paragraphs render as blank (non-hinted) editable lines.
      expect({ mountedBlocks, editables, leakedPlaceholders }).toEqual({
        mountedBlocks: 5,
        editables: 5,
        leakedPlaceholders: 0,
      });
    });
  });
});
