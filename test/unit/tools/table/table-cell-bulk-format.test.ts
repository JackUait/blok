import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TableSubsystems } from '../../../../src/tools/table/table-subsystems';
import type { TableHost } from '../../../../src/tools/table/table-subsystems';
import { TableGrid } from '../../../../src/tools/table/table-core';
import { TableModel } from '../../../../src/tools/table/table-model';
import { CELL_BLOCKS_ATTR } from '../../../../src/tools/table/table-cell-blocks';
import type { TableCellBlocks } from '../../../../src/tools/table/table-cell-blocks';
import type { TableData } from '../../../../src/tools/table/types';
import type { API, BlockAPI } from '../../../../types';

const CELL_ROW_ATTR = 'data-blok-table-cell-row';
const CELL_COL_ATTR = 'data-blok-table-cell-col';

const makeData = (): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: [
    [{ blocks: [] }, { blocks: [] }],
    [{ blocks: [] }, { blocks: [] }],
  ],
});

interface Harness {
  subsystems: TableSubsystems;
  gridEl: HTMLTableElement;
  transactSpy: ReturnType<typeof vi.fn>;
  blocks: Map<string, BlockAPI>;
  dispatchChange: ReturnType<typeof vi.fn>;
  cellOf: (row: number, col: number) => HTMLElement;
  editablesOf: (row: number, col: number) => HTMLElement[];
}

/**
 * Attach a paragraph-like block (holder + contenteditable) to a cell, mirroring
 * what TableCellBlocks renders into `[data-blok-table-cell-blocks]`.
 */
const attachBlock = (
  cell: HTMLElement,
  id: string,
  html: string,
  blocks: Map<string, BlockAPI>,
  dispatchChange: () => void
): void => {
  const container = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

  if (!container) {
    throw new Error('cell has no blocks container');
  }

  const holder = document.createElement('div');

  holder.setAttribute('data-blok-id', id);

  const editable = document.createElement('div');

  editable.setAttribute('contenteditable', 'true');
  editable.innerHTML = html;
  holder.appendChild(editable);
  container.appendChild(holder);

  blocks.set(id, {
    id,
    name: 'paragraph',
    holder,
    dispatchChange,
    preservedData: { text: html },
    preservedTunes: {},
  } as unknown as BlockAPI);
};

const createHarness = (): Harness => {
  const model = new TableModel(makeData());
  const grid = new TableGrid({ readOnly: false });
  const gridEl = grid.createGrid(2, 2, undefined);

  const element = document.createElement('div');
  const scrollContainer = document.createElement('div');
  const gripOverlay = document.createElement('div');

  element.appendChild(scrollContainer);
  scrollContainer.appendChild(gridEl);
  element.appendChild(gripOverlay);
  document.body.appendChild(element);

  const blocks = new Map<string, BlockAPI>();
  const dispatchChange = vi.fn();

  const cellOf = (row: number, col: number): HTMLElement => {
    const cell = gridEl.querySelector<HTMLElement>(`[${CELL_ROW_ATTR}="${row}"][${CELL_COL_ATTR}="${col}"]`);

    if (!cell) {
      throw new Error(`cell ${row},${col} not found`);
    }

    return cell;
  };

  const editablesOf = (row: number, col: number): HTMLElement[] =>
    Array.from(cellOf(row, col).querySelectorAll<HTMLElement>('[contenteditable="true"]'));

  let nextId = 100;

  const api = {
    i18n: { t: (key: string) => key },
    rectangleSelection: {
      isRectActivated: () => false,
      clearSelection: vi.fn(),
      startSelection: vi.fn(),
      endSelection: vi.fn(),
    },
    toolbar: { close: vi.fn() },
    blocks: {
      setPointerDragActive: vi.fn(),
      getBlocksCount: () => blocks.size,
      setBlockParent: vi.fn(),
      getById: (id: string): BlockAPI | null => blocks.get(id) ?? null,
      insert: (tool: string, data: { text?: string }): BlockAPI => {
        const id = `new-${nextId++}`;
        const holder = document.createElement('div');

        holder.setAttribute('data-blok-id', id);

        const editable = document.createElement('div');

        editable.setAttribute('contenteditable', 'true');
        editable.innerHTML = typeof data.text === 'string' ? data.text : '';
        holder.appendChild(editable);

        const blockApi = {
          id,
          name: tool,
          holder,
          dispatchChange,
          preservedData: data,
          preservedTunes: {},
        } as unknown as BlockAPI;

        blocks.set(id, blockApi);

        return blockApi;
      },
      getBlockIndex: (id: string): number | undefined => (blocks.has(id) ? 0 : undefined),
      getBlockByIndex: (): BlockAPI | undefined => undefined,
      delete: vi.fn(() => Promise.resolve()),
    },
    caret: { setToBlock: vi.fn() },
  } as unknown as API;

  const cellBlocks = {
    getBlockIdsFromCells: (cells: Element[] | NodeListOf<Element>): string[] =>
      Array.from(cells).flatMap((cell) =>
        Array.from(cell.querySelectorAll('[data-blok-id]'))
          .map((el) => el.getAttribute('data-blok-id'))
          .filter((id): id is string => id !== null)
      ),
    deleteBlocks: (ids: string[]): void => {
      ids.forEach((id) => {
        blocks.get(id)?.holder.remove();
        blocks.delete(id);
      });
    },
    ensureCellHasBlock: vi.fn(),
    focusClearedCell: vi.fn(),
  } as unknown as TableCellBlocks;

  const transactSpy = vi.fn();

  const host: TableHost = {
    api,
    readOnly: false,
    blockId: 'table-1',
    model,
    grid,
    cellBlocks,
    element,
    gridElement: gridEl,
    scrollContainer,
    gripOverlay,
    setDataGeneration: 0,
    runStructuralOp: <T>(fn: () => T): T => fn(),
    runTransactedStructuralOp: <T>(fn: () => T): T => {
      transactSpy();

      return fn();
    },
    ensureScrollContainer: (): HTMLDivElement => scrollContainer,
    rebuildTableBody: vi.fn(),
  };

  const subsystems = new TableSubsystems(host);

  subsystems.initAll(gridEl);

  // Seed one paragraph block per cell.
  [0, 1].forEach((r) => {
    [0, 1].forEach((c) => {
      attachBlock(cellOf(r, c), `b-${r}-${c}`, `cell ${r}${c}`, blocks, dispatchChange);
    });
  });

  return { subsystems, gridEl, transactSpy, blocks, dispatchChange, cellOf, editablesOf };
};

const pressShortcut = (target: HTMLElement, key: string, modifiers: Partial<KeyboardEventInit> = {}): void => {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      metaKey: true,
      ...modifiers,
    })
  );
};

describe('table bulk cell formatting and fill', () => {
  let harness: Harness;

  beforeEach(() => {
    vi.clearAllMocks();
    harness = createHarness();
  });

  afterEach(() => {
    harness.subsystems.teardown();
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
  });

  const selectAll = (): void => {
    harness.subsystems.cellSelectionSubsystem?.selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
  };

  describe('bulk formatting (Gap 2)', () => {
    it('Cmd+B bolds every block of every cell in the rectangle', () => {
      selectAll();
      pressShortcut(harness.cellOf(0, 0), 'b');

      [0, 1].forEach((r) => {
        [0, 1].forEach((c) => {
          expect(harness.editablesOf(r, c)[0].innerHTML).toBe(`<strong>cell ${r}${c}</strong>`);
        });
      });
    });

    it('applies the whole rectangle inside ONE transaction (one undo step)', () => {
      selectAll();
      harness.transactSpy.mockClear();

      pressShortcut(harness.cellOf(0, 0), 'b');

      expect(harness.transactSpy).toHaveBeenCalledTimes(1);
    });

    it('notifies each mutated block so its data is persisted', () => {
      selectAll();
      harness.dispatchChange.mockClear();

      pressShortcut(harness.cellOf(0, 0), 'b');

      expect(harness.dispatchChange).toHaveBeenCalledTimes(4);
    });

    it('toggles the mark off when every cell already carries it', () => {
      selectAll();
      pressShortcut(harness.cellOf(0, 0), 'b');
      pressShortcut(harness.cellOf(0, 0), 'b');

      expect(harness.editablesOf(0, 0)[0].innerHTML).toBe('cell 00');
      expect(harness.editablesOf(1, 1)[0].innerHTML).toBe('cell 11');
    });

    it('bolds the cells that lack the mark instead of unbolding the ones that have it', () => {
      harness.editablesOf(0, 0)[0].innerHTML = '<strong>cell 00</strong>';

      selectAll();
      pressShortcut(harness.cellOf(0, 0), 'b');

      expect(harness.editablesOf(0, 0)[0].innerHTML).toBe('<strong>cell 00</strong>');
      expect(harness.editablesOf(0, 1)[0].innerHTML).toBe('<strong>cell 01</strong>');
    });

    it.each([
      ['i', {}, 'i'],
      ['u', {}, 'u'],
      ['e', {}, 'code'],
      ['s', { shiftKey: true }, 's'],
    ] as const)('Cmd+%s wraps every cell in <%s>', (key, modifiers, tag) => {
      selectAll();
      pressShortcut(harness.cellOf(0, 0), key, modifiers);

      expect(harness.editablesOf(0, 1)[0].innerHTML).toBe(`<${tag}>cell 01</${tag}>`);
    });

    it('treats an existing <b> as bold (does not double-wrap)', () => {
      [0, 1].forEach((r) => {
        [0, 1].forEach((c) => {
          harness.editablesOf(r, c)[0].innerHTML = `<b>cell ${r}${c}</b>`;
        });
      });

      selectAll();
      pressShortcut(harness.cellOf(0, 0), 'b');

      expect(harness.editablesOf(0, 0)[0].innerHTML).toBe('cell 00');
    });
  });

  describe('fill right / fill down (Gap 3)', () => {
    it('Cmd+R copies the leftmost column across the rectangle', () => {
      selectAll();
      pressShortcut(harness.cellOf(0, 0), 'r');

      expect(harness.editablesOf(0, 1)[0].textContent).toBe('cell 00');
      expect(harness.editablesOf(1, 1)[0].textContent).toBe('cell 10');
      // Source column is untouched
      expect(harness.editablesOf(0, 0)[0].textContent).toBe('cell 00');
      expect(harness.editablesOf(1, 0)[0].textContent).toBe('cell 10');
    });

    it('Cmd+D copies the top row down the rectangle', () => {
      selectAll();
      pressShortcut(harness.cellOf(0, 0), 'd');

      expect(harness.editablesOf(1, 0)[0].textContent).toBe('cell 00');
      expect(harness.editablesOf(1, 1)[0].textContent).toBe('cell 01');
      expect(harness.editablesOf(0, 0)[0].textContent).toBe('cell 00');
    });

    it('fills inside ONE transaction (one undo step)', () => {
      selectAll();
      harness.transactSpy.mockClear();

      pressShortcut(harness.cellOf(0, 0), 'r');

      expect(harness.transactSpy).toHaveBeenCalledTimes(1);
    });
  });
});
