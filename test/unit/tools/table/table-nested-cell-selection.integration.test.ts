import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Table } from '../../../../src/tools/table';
import type { OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

const SELECTED_ATTR = 'data-blok-table-cell-selected';
const INNER_IDS = ['i00', 'i01', 'i10', 'i11', 'i20', 'i21'];

const blocks: OutputBlockData[] = [
  {
    id: 'outer',
    type: 'table',
    data: {
      withHeadings: false,
      content: [
        [{ blocks: ['inner'] }, { blocks: ['top-right'] }],
        [{ blocks: ['bottom-left'] }, { blocks: ['bottom-right'] }],
      ],
    },
    content: ['inner', 'top-right', 'bottom-left', 'bottom-right'],
  },
  {
    id: 'inner',
    type: 'table',
    parent: 'outer',
    data: {
      withHeadings: false,
      content: [
        [{ blocks: ['i00'] }, { blocks: ['i01'] }],
        [{ blocks: ['i10'] }, { blocks: ['i11'] }],
        [{ blocks: ['i20'] }, { blocks: ['i21'] }],
      ],
    },
    content: INNER_IDS,
  },
  ...INNER_IDS.map(id => ({
    id,
    type: 'paragraph',
    parent: 'inner',
    data: { text: id },
  })),
  { id: 'top-right', type: 'paragraph', parent: 'outer', data: { text: 'top-right' } },
  { id: 'bottom-left', type: 'paragraph', parent: 'outer', data: { text: 'bottom-left' } },
  { id: 'bottom-right', type: 'paragraph', parent: 'outer', data: { text: 'bottom-right' } },
];

describe('cell selection with a nested table', () => {
  let holder: HTMLDivElement;
  let editor: TestEditor | null;
  let priorElementFromPoint: PropertyDescriptor | undefined;

  const grid = (id: string): HTMLTableElement => {
    const element = holder.querySelector<HTMLTableElement>(`[data-blok-id="${id}"] table`);

    if (!element) {
      throw new Error(`table ${id} is missing`);
    }

    return element;
  };

  const cell = (id: string, row: number, col: number): HTMLTableCellElement => grid(id).tBodies[0].rows[row].cells[col];

  const selectedCellsOf = (id: string): string[] =>
    Array.from(grid(id).tBodies[0].rows).flatMap((row, r) => Array.from(row.cells).map((td, c) => (td.hasAttribute(SELECTED_ATTR) ? `${r},${c}` : '')))
      .filter(Boolean);

  const pressDelete = (): void => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  };

  const savedIds = async (): Promise<string[]> => (await editor?.save())?.blocks.map(block => block.id ?? '') ?? [];

  const dragCells = (from: HTMLElement, to: HTMLElement): void => {
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => to });
    from.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    priorElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
    holder = document.createElement('div');
    document.body.appendChild(holder);
    editor = new Blok({
      holder,
      tools: { table: Table, paragraph: Paragraph },
      data: { blocks },
    }) as unknown as TestEditor;
    await editor.isReady;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

    if (!grid('outer').contains(grid('inner'))) {
      throw new Error('inner table is not mounted in the outer cell');
    }
  });

  afterEach(() => {
    editor?.destroy();
    holder.remove();

    if (priorElementFromPoint) {
      Object.defineProperty(document, 'elementFromPoint', priorElementFromPoint);
    } else {
      Reflect.deleteProperty(document, 'elementFromPoint');
    }
    vi.restoreAllMocks();
  });

  it('clearing a dragged outer row keeps the nested row with the same index', async () => {
    dragCells(cell('outer', 1, 0), cell('outer', 1, 1));

    expect(selectedCellsOf('inner')).toEqual([]);
    expect(selectedCellsOf('outer')).toEqual(['1,0', '1,1']);

    pressDelete();
    const ids = await savedIds();

    expect(ids).toEqual(expect.arrayContaining(INNER_IDS));
    expect(ids).not.toContain('bottom-left');
    expect(ids).not.toContain('bottom-right');
  });

  it('dragging inside the nested table does not select or clear outer cells', async () => {
    dragCells(cell('inner', 0, 0), cell('inner', 1, 1));

    // The outer cell holding the caret may keep its single-cell box.
    expect(selectedCellsOf('outer').filter(coord => coord !== '0,0')).toEqual([]);
    expect(selectedCellsOf('inner')).toEqual(['0,0', '0,1', '1,0', '1,1']);

    pressDelete();
    const ids = await savedIds();

    expect(ids).toEqual(expect.arrayContaining(['top-right', 'bottom-left', 'bottom-right', 'i20', 'i21']));
    expect(ids).not.toContain('i00');
    expect(ids).not.toContain('i11');
  });

  it('pasting a multi-cell table into a nested cell changes only the nested table', async () => {
    const outerBefore = (await editor?.save())?.blocks.find(block => block.id === 'outer')?.data.content;
    // Inner (1,1) shares its coordinates with the outer bottom-right cell.
    const target = cell('inner', 1, 1);

    target.setAttribute('tabindex', '0');
    target.focus();

    const event = new Event('paste', { bubbles: true, cancelable: true });

    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: (type: string): string => type === 'text/html'
          ? '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>'
          : '',
      },
    });
    target.dispatchEvent(event);

    const saved = await editor?.save();

    expect(saved?.blocks.find(block => block.id === 'outer')?.data.content).toEqual(outerBefore);
    expect(grid('outer').tBodies[0].rows).toHaveLength(2);
    expect(grid('outer').tBodies[0].rows[1].cells).toHaveLength(2);
    expect(cell('outer', 1, 1).textContent).toBe('bottom-right');
    expect(cell('inner', 1, 1).textContent).toBe('A');
    expect(cell('inner', 1, 2).textContent).toBe('B');
    expect(cell('inner', 2, 1).textContent).toBe('C');
    expect(cell('inner', 2, 2).textContent).toBe('D');
  });
});
