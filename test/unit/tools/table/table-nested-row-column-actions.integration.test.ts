import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Table } from '../../../../src/tools/table';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: API['history'];
  module: {
    yjsManager: {
      getBlockDataObject: (id: string) => Record<string, unknown> | undefined;
      onPendingBlockWritesSettled: (callback: () => void) => () => void;
    };
  };
}

const savedCellBlocks = (block: OutputBlockData | undefined, row: number, col: number): unknown => {
  const content: unknown = block?.data.content;
  const cells: unknown = Array.isArray(content) ? content[row] : undefined;
  const cell: unknown = Array.isArray(cells) ? cells[col] : undefined;

  return typeof cell === 'object' && cell !== null && 'blocks' in cell ? cell.blocks : undefined;
};

// No generated ID sorts higher, so undo cannot pass by the peer tie-break.
const RIGHT_ID = 'zzzzzzzzzz';

const blocks: OutputBlockData[] = [
  {
    id: 'outer',
    type: 'table',
    data: {
      withHeadings: false,
      content: [
        [{ blocks: ['inner'] }, { blocks: [RIGHT_ID] }],
        [{ blocks: ['bottom-left'] }, { blocks: ['bottom-right'] }],
      ],
    },
    content: ['inner', RIGHT_ID, 'bottom-left', 'bottom-right'],
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
    content: ['i00', 'i01', 'i10', 'i11', 'i20', 'i21'],
  },
  ...['i00', 'i01', 'i10', 'i11', 'i20', 'i21'].map(id => ({
    id,
    type: 'paragraph',
    parent: 'inner',
    data: { text: id },
  })),
  { id: RIGHT_ID, type: 'paragraph', parent: 'outer', data: { text: 'right' } },
  { id: 'bottom-left', type: 'paragraph', parent: 'outer', data: { text: 'bottom-left' } },
  { id: 'bottom-right', type: 'paragraph', parent: 'outer', data: { text: 'bottom-right' } },
];

describe('outer table row and column actions beside a nested table', () => {
  let holder: HTMLDivElement;
  let editor: TestEditor | null;

  const grid = (id: string): HTMLTableElement => {
    const element = holder.querySelector<HTMLTableElement>(`[data-blok-id="${id}"] table`);

    if (!element) {
      throw new Error(`table ${id} is missing`);
    }

    return element;
  };

  const grip = (kind: 'row' | 'col', index: number): HTMLElement => {
    const wrapper = grid('outer').closest('[data-blok-tool="table"]');
    const element = Array.from(wrapper?.querySelectorAll<HTMLElement>(`[data-blok-table-grip-${kind}="${index}"]`) ?? [])
      .find(candidate => candidate.closest('[data-blok-tool="table"]') === wrapper);

    if (!element) {
      throw new Error(`outer ${kind} grip ${index} is missing`);
    }

    return element;
  };

  const drag = (kind: 'row' | 'col', index: number, startX: number, startY: number, endX: number, endY: number): void => {
    const handle = grip(kind, index);

    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: startX, clientY: startY }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: endX, clientY: endY }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: endX, clientY: endY }));
  };

  beforeEach(async () => {
    vi.clearAllMocks();
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
    vi.restoreAllMocks();
  });

  it('moves an outer cell block into the inner table without a stale outer reference', async () => {
    editor?.blocks.setBlockParent(RIGHT_ID, 'inner');
    await Promise.resolve();

    const innerFirstCell = grid('inner').tBodies[0].rows[0].cells[0];

    expect(editor?.blocks.getById(RIGHT_ID)?.holder.parentElement).toBe(innerFirstCell.firstElementChild);
    const saved = await editor?.save();
    const outer = saved?.blocks.find(block => block.id === 'outer');
    const inner = saved?.blocks.find(block => block.id === 'inner');

    expect(savedCellBlocks(outer, 0, 1)).not.toContain(RIGHT_ID);
    expect(savedCellBlocks(inner, 0, 0)).toEqual(['i00', RIGHT_ID]);

    await new Promise<void>(resolve => editor?.module.yjsManager.onPendingBlockWritesSettled(resolve));
    expect(JSON.stringify(editor?.module.yjsManager.getBlockDataObject('outer')?.content)).not.toContain(`"${RIGHT_ID}"`);
    expect(JSON.stringify(editor?.module.yjsManager.getBlockDataObject('inner')?.content)).toContain(`"${RIGHT_ID}"`);
  });

  it('mounts an outer cell block in its own cell, not a nested cell', () => {
    const outerRightCell = grid('outer').tBodies[0].rows[0].cells[1];

    expect(editor?.blocks.getById(RIGHT_ID)?.holder.parentElement).toBe(outerRightCell.firstElementChild);
  });

  it('deletes the second outer row without deleting a nested row', async () => {
    grip('row', 1).dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }));
    // Clear contents is destructive too; Delete is the last destructive item.
    const deleteItem = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-popover-item-destructive]')).at(-1);

    if (!deleteItem) {
      throw new Error('delete row action is missing');
    }
    deleteItem.click();

    expect(grid('inner').tBodies[0].rows).toHaveLength(3);
    expect(grid('outer').tBodies[0].rows).toHaveLength(1);
    const saved = await editor?.save();

    expect(saved?.blocks.find(block => block.id === 'inner')?.data.content).toHaveLength(3);
  });

  it('inserts an outer row below the nested table without touching its rows', () => {
    grip('row', 0).dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }));
    const insertItem = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-popover-item]'))
      .find(item => item.querySelector('[data-blok-popover-item-title]')?.textContent === 'Insert row below');

    if (!insertItem) {
      throw new Error('insert row below action is missing');
    }
    insertItem.click();

    expect(grid('inner').tBodies[0].rows).toHaveLength(3);
    expect(grid('outer').tBodies[0].rows).toHaveLength(3);
  });

  it('moves the second outer row above the first without moving a nested row', () => {
    const outer = grid('outer');

    Object.defineProperty(outer, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(0, 0, 100, 80),
    });
    Array.from(outer.tBodies[0].rows).forEach((row, index) => {
      Object.defineProperty(row, 'offsetTop', { configurable: true, value: index * 40 });
      Object.defineProperty(row, 'offsetHeight', { configurable: true, value: 40 });
    });
    drag('row', 1, 0, 40, 0, 0);

    expect(grid('outer').tBodies[0].rows[0].textContent).toContain('bottom-left');
    expect(grid('inner').tBodies[0].rows).toHaveLength(3);
    expect(grid('outer').tBodies[0].rows).toHaveLength(2);
  });

  it('moves the second outer column left without moving a nested cell', () => {
    const outer = grid('outer');

    Object.defineProperty(outer, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(0, 0, 100, 80),
    });
    drag('col', 1, 50, 0, 0, 0);

    expect(grid('outer').tBodies[0].rows[0].cells[0].textContent).toContain('right');
    expect(grid('inner').tBodies[0].rows[0].cells).toHaveLength(2);
    expect(grid('outer').tBodies[0].rows[0].cells).toHaveLength(2);
  });

  it('restores an outer cell block after immediate delete and undo', async () => {
    if (!editor) {
      throw new Error('editor is missing');
    }

    await editor.blocks.delete(editor.blocks.getBlockIndex(RIGHT_ID), false);
    editor.history.undo();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const { yjsManager } = editor.module;

    await new Promise<void>(resolve => yjsManager.onPendingBlockWritesSettled(resolve));

    const rightCell = grid('outer').tBodies[0].rows[0].cells[1];

    expect(editor.blocks.getById(RIGHT_ID)?.holder.parentElement).toBe(rightCell.firstElementChild);
    expect(Array.from(rightCell.firstElementChild?.children ?? [], child => child.getAttribute('data-blok-id'))).toEqual([RIGHT_ID]);
    expect(savedCellBlocks((await editor.save()).blocks.find(block => block.id === 'outer'), 0, 1)).toEqual([RIGHT_ID]);
    const yjsContent = editor.module.yjsManager.getBlockDataObject('outer')?.content as { blocks: string[] }[][] | undefined;

    expect(yjsContent?.[0]?.[1]?.blocks).toEqual([RIGHT_ID]);
  });

  it('removes the empty-cell repair when undo restores the outer block', async () => {
    if (!editor) {
      throw new Error('editor is missing');
    }

    await editor.blocks.delete(editor.blocks.getBlockIndex(RIGHT_ID), false);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const rightCell = grid('outer').tBodies[0].rows[0].cells[1];
    const repairId = rightCell.firstElementChild?.firstElementChild?.getAttribute('data-blok-id');

    if (!repairId || repairId === RIGHT_ID) {
      throw new Error('empty-cell repair is missing');
    }

    editor.history.undo();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const { yjsManager } = editor.module;

    await new Promise<void>(resolve => yjsManager.onPendingBlockWritesSettled(resolve));

    const restoredCell = grid('outer').tBodies[0].rows[0].cells[1];

    expect(Array.from(restoredCell.firstElementChild?.children ?? [], child => child.getAttribute('data-blok-id'))).toEqual([RIGHT_ID]);
    expect(savedCellBlocks((await editor.save()).blocks.find(block => block.id === 'outer'), 0, 1)).toEqual([RIGHT_ID]);
    const yjsContent = editor.module.yjsManager.getBlockDataObject('outer')?.content as { blocks: string[] }[][] | undefined;

    expect(yjsContent?.[0]?.[1]?.blocks).toEqual([RIGHT_ID]);
  });

  it('restores an outer lower-row block to its outer cell, not the nested cell with the same coordinates', async () => {
    if (!editor) {
      throw new Error('editor is missing');
    }

    await editor.blocks.delete(editor.blocks.getBlockIndex('bottom-left'), false);
    editor.history.undo();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const { yjsManager } = editor.module;

    await new Promise<void>(resolve => yjsManager.onPendingBlockWritesSettled(resolve));

    const outerCell = grid('outer').tBodies[0].rows[1].cells[0];

    expect(editor.blocks.getById('bottom-left')?.holder.parentElement).toBe(outerCell.firstElementChild);
    expect(Array.from(grid('inner').tBodies[0].rows[1].cells[0].firstElementChild?.children ?? [], child => child.getAttribute('data-blok-id'))).toEqual(['i10']);
  });
});
