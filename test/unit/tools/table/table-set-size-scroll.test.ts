import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TableGrid } from '../../../../src/tools/table/table-core';
import { TableModel } from '../../../../src/tools/table/table-model';
import { TableSubsystems } from '../../../../src/tools/table/table-subsystems';
import type { TableHost } from '../../../../src/tools/table/table-subsystems';
import type { API } from '../../../../types';
import type * as Direction from '../../../../src/tools/table/table-direction';

const scrolls = vi.hoisted(() => ({ calls: 0 }));

vi.mock('../../../../src/tools/table/table-direction', async (importOriginal) => {
  const actual = await importOriginal<typeof Direction>();

  return {
    ...actual,
    scrollToInlineEnd: (scroller: HTMLElement): void => {
      scrolls.calls++;
      actual.scrollToInlineEnd(scroller);
    },
  };
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
    getBlockIndex: () => undefined,
    setBlockParent: vi.fn(),
    beginTransaction: vi.fn(),
    endTransaction: vi.fn(),
  },
  caret: { setToBlock: vi.fn() },
} as unknown as API);

const createTable = (): { subsystems: TableSubsystems; gridEl: HTMLElement } => {
  const model = new TableModel({ withHeadings: false, withHeadingColumn: false, content: [[{ blocks: [] }, { blocks: [] }]] });
  const grid = new TableGrid({ readOnly: false });
  const gridEl = grid.createGrid(1, 2, undefined);
  const element = document.createElement('div');
  const scrollContainer = document.createElement('div');
  const gripOverlay = document.createElement('div');

  element.append(scrollContainer, gripOverlay);
  scrollContainer.appendChild(gridEl);
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
  const subsystems = new TableSubsystems(host);

  subsystems.initAll(gridEl);

  return { subsystems, gridEl };
};

describe('TableSubsystems.setSize scrolling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scrolls.calls = 0;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('scrolls to the new columns once, however many it adds: each scroll lays out the whole table', () => {
    const { subsystems, gridEl } = createTable();

    subsystems.setSize(gridEl, 1, 12);

    expect(scrolls.calls).toBe(1);
  });

  it('does not scroll when no column is added', () => {
    const { subsystems, gridEl } = createTable();

    subsystems.setSize(gridEl, 5, 2);

    expect(scrolls.calls).toBe(0);
  });
});
