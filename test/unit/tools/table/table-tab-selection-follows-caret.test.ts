import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Table } from '../../../../src/tools/table/index';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

const CELL_ATTR = 'data-blok-table-cell';
const CELL_ROW_ATTR = 'data-blok-table-cell-row';
const CELL_COL_ATTR = 'data-blok-table-cell-col';
const SELECTED_ATTR = 'data-blok-table-cell-selected';

/**
 * A cell block holder that carries a real contenteditable, the way a paragraph
 * block does. Tab navigation focuses the first contenteditable inside the
 * target cell, so a holder without one would make the test vacuous.
 */
const createParagraphHolder = (id: string): HTMLElement => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-id', id);

  const editable = document.createElement('div');

  editable.setAttribute('contenteditable', 'true');
  holder.appendChild(editable);

  return holder;
};

const createMockAPI = (): API => {
  let counter = 0;

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
    i18n: { t: (key: string) => key },
    blocks: {
      delete: vi.fn(),
      getById: vi.fn().mockReturnValue(undefined),
      insert: vi.fn(() => {
        counter += 1;

        const id = `cell-block-${counter}`;

        return { id, holder: createParagraphHolder(id) };
      }),
      getChildren: vi.fn().mockReturnValue([]),
      getBlockIndex: vi.fn().mockReturnValue(0),
      getBlockByIndex: vi.fn().mockReturnValue(undefined),
      getCurrentBlockIndex: vi.fn().mockReturnValue(0),
      getBlocksCount: vi.fn().mockReturnValue(1),
      setBlockParent: vi.fn(),
    },
    caret: { setToBlock: vi.fn() },
    events: { on: vi.fn(), off: vi.fn() },
  } as unknown as API;
};

const createOptions = (): BlockToolConstructorOptions<TableData, TableConfig> => ({
  data: { withHeadings: false, content: [] } as unknown as TableData,
  config: {},
  api: createMockAPI(),
  readOnly: false,
  block: { id: 'table-block-1' },
} as unknown as BlockToolConstructorOptions<TableData, TableConfig>);

const cellAt = (grid: HTMLElement, row: number, col: number): HTMLElement => {
  const cell = grid.querySelector<HTMLElement>(
    `[${CELL_ATTR}][${CELL_ROW_ATTR}="${row}"][${CELL_COL_ATTR}="${col}"]`
  );

  if (cell === null) {
    throw new Error(`cell ${row},${col} not found`);
  }

  return cell;
};

const pressTab = (from: HTMLElement, shiftKey = false): void => {
  const editable = from.querySelector<HTMLElement>('[contenteditable="true"]');

  if (editable === null) {
    throw new Error('cell has no contenteditable');
  }

  editable.focus();
  editable.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    bubbles: true,
    cancelable: true,
  }));
};

const selectedCoords = (grid: HTMLElement): string[] =>
  Array.from(grid.querySelectorAll<HTMLElement>(`[${SELECTED_ATTR}]`))
    .map(cell => `${cell.getAttribute(CELL_ROW_ATTR)},${cell.getAttribute(CELL_COL_ATTR)}`);

describe('table — the cell selection box follows the caret', () => {
  let table: Table;
  let wrapper: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();

    table = new Table(createOptions());
    wrapper = table.render();
    document.body.appendChild(wrapper);
    table.rendered();
  });

  afterEach(() => {
    table.destroy?.();
    wrapper.remove();
    vi.restoreAllMocks();
  });

  it('paints the box on the first cell of a new table', () => {
    const grid = wrapper.querySelector('table') as HTMLElement;

    expect(selectedCoords(grid)).toEqual(['0,0']);
  });

  it('moves the box to the next cell on Tab', () => {
    const grid = wrapper.querySelector('table') as HTMLElement;

    pressTab(cellAt(grid, 0, 0));

    expect(selectedCoords(grid)).toEqual(['0,1']);
  });

  it('moves the box to the previous cell on Shift+Tab', () => {
    const grid = wrapper.querySelector('table') as HTMLElement;

    pressTab(cellAt(grid, 1, 1), true);

    expect(selectedCoords(grid)).toEqual(['1,0']);
  });

  it('wraps the box to the next row when Tab leaves the last column', () => {
    const grid = wrapper.querySelector('table') as HTMLElement;

    pressTab(cellAt(grid, 0, 2));

    expect(selectedCoords(grid)).toEqual(['1,0']);
  });

  /**
   * The box tracks FOCUS, not Tab. Arrow keys cross cells through the core's
   * caret navigation, which the table never sees as a key event — it only ever
   * observes the resulting focus. A Tab-only fix would leave the box stale for
   * every arrow-key move.
   */
  it('follows a caret moved into a cell by any means, not just Tab', () => {
    const grid = wrapper.querySelector('table') as HTMLElement;
    const editable = cellAt(grid, 1, 2).querySelector<HTMLElement>('[contenteditable="true"]');

    editable?.focus();

    expect(selectedCoords(grid)).toEqual(['1,2']);
  });

  /**
   * The other half of the same rule: no cell holds the caret, so no cell may
   * look focused. Tabbing out of the last cell used to leave the box painted on
   * it while the caret was already editing the block below.
   */
  it('clears the box when the caret leaves the table', () => {
    const grid = wrapper.querySelector('table') as HTMLElement;
    const outside = document.createElement('div');

    outside.setAttribute('contenteditable', 'true');
    document.body.appendChild(outside);

    expect(selectedCoords(grid)).toEqual(['0,0']);

    outside.focus();

    expect(selectedCoords(grid)).toEqual([]);
    expect(grid.querySelector('[data-blok-table-selection-overlay]')).toBeNull();

    outside.remove();
  });
});
