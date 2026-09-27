import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Table } from '../../../../src/tools/table/index';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
}

const blocks: OutputBlockData[] = [
  {
    id: 'outer',
    type: 'table',
    data: {
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: ['inner'] }, { blocks: ['right'], color: '#00ff00', placement: 'bottom-right' }],
        [{ blocks: ['bottom-left'] }, { blocks: ['bottom-right'] }],
      ],
    },
    content: ['inner', 'right', 'bottom-left', 'bottom-right'],
  },
  {
    id: 'inner',
    type: 'table',
    parent: 'outer',
    data: {
      withHeadings: true,
      withHeadingColumn: true,
      content: [
        [{ blocks: ['i00'] }, { blocks: ['i01'], color: '#ff0000', placement: 'middle-center' }],
        [{ blocks: ['i10'] }, { blocks: ['i11'] }],
      ],
    },
    content: ['i00', 'i01', 'i10', 'i11'],
  },
  ...['i00', 'i01', 'i10', 'i11'].map(id => ({ id, type: 'paragraph', parent: 'inner', data: { text: id } })),
  { id: 'right', type: 'paragraph', parent: 'outer', data: { text: 'Right' } },
  { id: 'bottom-left', type: 'paragraph', parent: 'outer', data: { text: 'Bottom left' } },
  { id: 'bottom-right', type: 'paragraph', parent: 'outer', data: { text: 'Bottom right' } },
];

const savedCell = (block: OutputBlockData | undefined, row: number, col: number): unknown => {
  const content: unknown = block?.data.content;
  const cells: unknown = Array.isArray(content) ? content[row] : undefined;

  return Array.isArray(cells) ? cells[col] : undefined;
};

describe('merging a table that contains another table', () => {
  let holder: HTMLDivElement;
  let editor: TestEditor | null;

  const table = (id: string): HTMLTableElement => {
    const element = holder.querySelector<HTMLTableElement>(`[data-blok-id="${id}"] table`);

    if (element === null) {
      throw new Error(`table ${id} is missing`);
    }

    return element;
  };

  const cell = (id: string, row: number, col: number): HTMLTableCellElement => {
    const tableRow = table(id).tBodies[0]?.rows[row];
    const element = Array.from(tableRow?.cells ?? []).find(candidate =>
      candidate.getAttribute('data-blok-table-cell-col') === String(col)
    );

    if (element === undefined) {
      throw new Error(`cell ${id} ${row},${col} is missing`);
    }

    return element;
  };

  const mergeRow = (row: number): void => {
    const start = cell('outer', row, 0);
    const end = cell('outer', row, 1);

    start.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    const priorElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');

    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => end });
    try {
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 1, clientY: 1 }));
    } finally {
      if (priorElementFromPoint === undefined) {
        Reflect.deleteProperty(document, 'elementFromPoint');
      } else {
        Object.defineProperty(document, 'elementFromPoint', priorElementFromPoint);
      }
    }
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    const pill = holder.querySelector<HTMLElement>('[data-blok-table-selection-pill]');

    if (pill === null) {
      throw new Error('selection menu is missing');
    }
    pill.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    pill.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));

    const action = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-popover-item]'))
      .find(item => item.querySelector('[data-blok-popover-item-title]')?.textContent === 'Merge cells');

    if (action === undefined) {
      throw new Error('merge action is missing');
    }
    action.click();
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    editor = new Blok({ holder, tools: { table: Table, paragraph: Paragraph }, data: { blocks } }) as unknown as TestEditor;
    await editor.isReady;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });

  afterEach(() => {
    editor?.destroy();
    holder.remove();
    vi.restoreAllMocks();
  });

  it('keeps an outer cell block out of the nested table after merge', () => {
    mergeRow(1);

    const right = editor?.blocks.getById('right');
    const outerRightBlocks = cell('outer', 0, 1).firstElementChild;

    expect(right?.holder.parentElement).toBe(outerRightBlocks);
  });

  it('keeps the nested table heading row, heading column, and roles after merge', () => {
    mergeRow(1);

    expect(table('inner').tBodies[0]?.rows[0]?.hasAttribute('data-blok-table-heading')).toBe(true);
    expect(cell('inner', 1, 0).hasAttribute('data-blok-table-heading-col')).toBe(true);
    expect(cell('inner', 0, 0).getAttribute('role')).toBe('columnheader');
    expect(cell('inner', 1, 0).getAttribute('role')).toBe('rowheader');
  });

  it('keeps outer and nested cell colors and placements after merge', () => {
    mergeRow(1);

    expect(cell('outer', 0, 1).style.backgroundColor).toBe('rgb(0, 255, 0)');
    expect(cell('outer', 0, 1).firstElementChild?.getAttribute('data-blok-cell-placement')).toBe('bottom-right');
    expect(cell('inner', 0, 1).style.backgroundColor).toBe('rgb(255, 0, 0)');
    expect(cell('inner', 0, 1).firstElementChild?.getAttribute('data-blok-cell-placement')).toBe('middle-center');
  });

  it('does not insert an outer-owned block into an empty nested cell', async () => {
    const index = editor?.blocks.getBlockIndex('i01');

    if (index === undefined) {
      throw new Error('inner cell block is missing');
    }
    await editor?.blocks.delete(index, false);
    mergeRow(1);

    const innerCell = cell('inner', 0, 1);
    const ids = Array.from(innerCell.firstElementChild?.children ?? [])
      .map(child => child.getAttribute('data-blok-id'))
      .filter((id): id is string => id !== null);

    expect(ids.map(id => editor?.blocks.getById(id)?.parentId)).not.toContain('outer');
  });

  it('rejects moving an outer cell block into the nested table with blocks.moveTo', async () => {
    mergeRow(1);
    const outerCell = cell('outer', 0, 1).firstElementChild;
    const right = editor?.blocks.getById('right');

    expect(right?.holder.parentElement).toBe(outerCell);
    expect(() => editor?.blocks.moveTo('right', { parentId: 'inner', position: { before: 'i01' } }))
      .toThrow(/cannot move.*table cells/);
    expect(right?.holder.parentElement).toBe(outerCell);
    expect(right?.parentId).toBe('outer');
    const saved = await editor?.save();
    const outer = saved?.blocks.find(block => block.id === 'outer');
    const inner = saved?.blocks.find(block => block.id === 'inner');

    expect(savedCell(outer, 0, 1)).toMatchObject({ blocks: ['right'] });
    expect(savedCell(inner, 0, 1)).toMatchObject({ blocks: ['i01'] });
  });

  it('leaves an outer cell block in place when blocks.move targets a nested cell', async () => {
    mergeRow(1);
    const outerCell = cell('outer', 0, 1).firstElementChild;
    const right = editor?.blocks.getById('right');
    const from = editor?.blocks.getBlockIndex('right');
    const to = editor?.blocks.getBlockIndex('i01');

    if (from === undefined || to === undefined) {
      throw new Error('move endpoints are missing');
    }
    expect(right?.holder.parentElement).toBe(outerCell);
    editor?.blocks.move(to, from);

    expect(right?.holder.parentElement).toBe(outerCell);
    expect(right?.parentId).toBe('outer');
    const saved = await editor?.save();
    const outer = saved?.blocks.find(block => block.id === 'outer');
    const inner = saved?.blocks.find(block => block.id === 'inner');

    expect(savedCell(outer, 0, 1)).toMatchObject({ blocks: ['right'] });
    expect(savedCell(inner, 0, 1)).toMatchObject({ blocks: ['i01'] });
  });

  it('saves alignment on an outer cell after nested rows', async () => {
    const target = cell('outer', 1, 1);

    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    const pill = holder.querySelector<HTMLElement>('[data-blok-table-selection-pill]');

    if (pill === null) {
      throw new Error('selection menu is missing');
    }
    pill.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    pill.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));

    const alignment = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-popover-item]'))
      .find(item => item.querySelector('[data-blok-popover-item-title]')?.textContent === 'Alignment');

    if (alignment === undefined) {
      throw new Error('alignment action is missing');
    }
    alignment.click();

    const bottomRight = document.querySelector<HTMLElement>('[data-placement="bottom-right"]');

    if (bottomRight === null) {
      throw new Error('bottom-right placement is missing');
    }
    bottomRight.click();

    const saved = await editor?.save();
    const outer = saved?.blocks.find(block => block.id === 'outer');
    const content = outer?.data.content;

    if (!Array.isArray(content)) {
      throw new Error('outer table content is missing');
    }
    expect(content[1][1]).toMatchObject({ placement: 'bottom-right' });
  });
});
