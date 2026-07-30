/*
 * The corner drag may shrink the table, but it must never carry away typed
 * content: a populated trailing column stops the inward walk. The guard lives in
 * the options TableSubsystems hands the corner drag, so the drag class is mocked
 * to capture them — a simulated pointer drag cannot reach this in jsdom, where
 * every rect the geometry walk reads is zero.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TableGrid, ROW_ATTR, CELL_COL_ATTR } from '../../../../src/tools/table/table-core';
import { CELL_BLOCKS_ATTR } from '../../../../src/tools/table/table-cell-blocks';
import { TableModel } from '../../../../src/tools/table/table-model';
import { TableSubsystems } from '../../../../src/tools/table/table-subsystems';
import type { TableHost } from '../../../../src/tools/table/table-subsystems';
import type { TableCornerDragOptions } from '../../../../src/tools/table/table-corner-drag';
import type { TableData } from '../../../../src/tools/table/types';
import type { API } from '../../../../types';

const captured = vi.hoisted(() => ({ options: [] as unknown[] }));

vi.mock('../../../../src/tools/table/table-corner-drag', () => ({
  TableCornerDrag: class {
    public constructor(options: unknown) {
      captured.options.push(options);
    }

    public destroy = vi.fn();
    public syncPosition = vi.fn();
    public attachScrollContainer = vi.fn();
    public setDisplay = vi.fn();
    public setInteractive = vi.fn();
  },
}));

const makeData = (): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: [
    [{ blocks: [] }, { blocks: [] }],
    [{ blocks: [] }, { blocks: [] }],
  ],
});

const createMockAPI = (): API => ({
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
    insert: vi.fn(),
    getBlocksCount: () => 0,
    setBlockParent: vi.fn(),
    beginTransaction: vi.fn(),
    endTransaction: vi.fn(),
  },
  caret: { setToBlock: vi.fn() },
} as unknown as API);

const createCornerDragOptions = (): { options: TableCornerDragOptions; gridEl: HTMLElement } => {
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

  const host: TableHost = {
    api: createMockAPI(),
    readOnly: false,
    blockId: 'table-1',
    model,
    grid,
    cellBlocks: null,
    element,
    gridElement: gridEl,
    scrollContainer,
    gripOverlay,
    setDataGeneration: 0,
    runStructuralOp: <T>(fn: () => T): T => fn(),
    runTransactedStructuralOp: <T>(fn: () => T): T => fn(),
    ensureScrollContainer: (): HTMLDivElement => scrollContainer,
    rebuildTableBody: vi.fn(),
    fitToPageWidth: vi.fn(),
  };

  new TableSubsystems(host).initAll(gridEl);

  const options = captured.options.at(-1);

  if (options === undefined) {
    throw new Error('corner drag was never constructed');
  }

  return { options: options as TableCornerDragOptions, gridEl };
};

/** Give a cell the block container real content lives in, and type into it. */
const writeIntoCell = (gridEl: HTMLElement, rowIndex: number, colIndex: number, text: string): void => {
  const row = gridEl.querySelectorAll(`[${ROW_ATTR}]`)[rowIndex];
  const cell = row?.querySelector<HTMLElement>(`[${CELL_COL_ATTR}="${colIndex}"]`);

  if (!cell) {
    throw new Error(`no cell at ${rowIndex},${colIndex}`);
  }

  let container = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

  if (!container) {
    container = document.createElement('div');
    container.setAttribute(CELL_BLOCKS_ATTR, '');
    cell.appendChild(container);
  }

  container.textContent = text;
};

describe('corner drag content guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.options.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('allows removing an empty trailing column', () => {
    const { options } = createCornerDragOptions();

    expect(options.canRemoveLastColumn()).toBe(true);
  });

  it('refuses to remove a trailing column that holds content', () => {
    const { options, gridEl } = createCornerDragOptions();

    writeIntoCell(gridEl, 1, 1, 'keep me');

    expect(options.canRemoveLastColumn()).toBe(false);
  });

  it('still allows removing a trailing column when only earlier columns hold content', () => {
    const { options, gridEl } = createCornerDragOptions();

    writeIntoCell(gridEl, 0, 0, 'keep me');

    expect(options.canRemoveLastColumn()).toBe(true);
  });
});
