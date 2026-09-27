import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import type { Block } from '../../../../src/components/block';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Table } from '../../../../src/tools/table';
import { ToggleItem } from '../../../../src/tools/toggle';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
  module: {
    blockManager: { blocks: Block[] };
    dragManager: { setupDragHandle: (handle: HTMLElement, block: Block) => () => void };
  };
}

const paragraph = (id: string, parent?: string): OutputBlockData => ({
  id,
  type: 'paragraph',
  data: { text: id },
  ...(parent === undefined ? {} : { parent }),
});

const afterFrame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()));

const settle = async (): Promise<void> => {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await afterFrame();
  await afterFrame();
};

const cellOrder = async (editor: TestEditor): Promise<string[]> => {
  const saved = await editor.save();
  const content = saved.blocks.find(block => block.id === 'table')?.data.content;
  const row: unknown = Array.isArray(content) ? content[0] : undefined;
  const cell: unknown = Array.isArray(row) ? row[0] : undefined;

  if (typeof cell !== 'object' || cell === null || !('blocks' in cell) || !Array.isArray(cell.blocks)) {
    throw new Error('first table cell is missing');
  }

  return cell.blocks.filter((id): id is string => typeof id === 'string');
};

const domCellOrder = (holder: HTMLElement): string[] =>
  Array.from(holder.querySelectorAll('[data-blok-table-cell-row="0"][data-blok-table-cell-col="0"] > [data-blok-table-cell-blocks] > [data-blok-id]'))
    .map(element => element.getAttribute('data-blok-id') ?? '');

const cellOf = (editor: TestEditor, id: string): string => {
  const cell = editor.blocks.getById(id)?.holder.closest('[data-blok-table-cell]');

  return cell === null || cell === undefined
    ? 'outside'
    : `${cell.getAttribute('data-blok-table-cell-row')},${cell.getAttribute('data-blok-table-cell-col')}`;
};

const dragBelow = (editor: TestEditor, sourceId: string, targetId: string): void => {
  const source = editor.module.blockManager.blocks.find(block => block.id === sourceId);
  const target = editor.module.blockManager.blocks.find(block => block.id === targetId);

  if (source === undefined || target === undefined) {
    throw new Error('drag source or target is missing');
  }

  const handle = document.createElement('button');
  const cleanup = editor.module.dragManager.setupDragHandle(handle, source);
  const priorElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');

  vi.spyOn(target.holder, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 200, 100, 50));
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target.holder });

  try {
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 50, clientY: 100 }));
    target.holder.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 60, clientY: 100 }));
    target.holder.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 245 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 50, clientY: 245 }));
  } finally {
    cleanup();
    if (priorElementFromPoint === undefined) {
      Reflect.deleteProperty(document, 'elementFromPoint');
    } else {
      Object.defineProperty(document, 'elementFromPoint', priorElementFromPoint);
    }
  }
};

describe('table cell drag undo', () => {
  let holder: HTMLDivElement;
  let editor: TestEditor | null;

  const boot = async (blocks: OutputBlockData[], paragraphTool: typeof Paragraph = Paragraph): Promise<TestEditor> => {
    const instance = new Blok({ holder, tools: { paragraph: paragraphTool, table: Table, toggle: ToggleItem }, data: { blocks } }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;
    await settle();

    return instance;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    editor = null;
  });

  afterEach(() => {
    editor?.destroy();
    holder.remove();
    vi.restoreAllMocks();
  });

  it('calls moved once when dragging a block out of a table cell', async () => {
    let movedCalls = 0;

    class CountingParagraph extends Paragraph {
      public moved(): void {
        movedCalls += 1;
      }
    }

    const instance = await boot([
      { id: 'table', type: 'table', data: { content: [[{ blocks: ['x', 'y'] }]] }, content: ['x', 'y'] },
      paragraph('x', 'table'),
      paragraph('y', 'table'),
      paragraph('outside'),
    ], CountingParagraph);

    dragBelow(instance, 'x', 'outside');
    await settle();

    expect(movedCalls).toBe(1);
    expect(cellOf(instance, 'x')).toBe('outside');
  });

  it('undoes a drag out of a table cell with its cell reference', async () => {
    const instance = await boot([
      { id: 'table', type: 'table', data: { content: [[{ blocks: ['x', 'y'] }, { blocks: ['w'] }]] }, content: ['x', 'y', 'w'] },
      paragraph('x', 'table'),
      paragraph('y', 'table'),
      paragraph('w', 'table'),
      paragraph('outside'),
    ]);

    dragBelow(instance, 'x', 'outside');
    await settle();

    expect(cellOf(instance, 'x')).toBe('outside');
    expect(await cellOrder(instance)).toEqual(['y']);

    instance.history.undo();
    await settle();

    expect({
      cell: cellOf(instance, 'x'),
      dom: domCellOrder(holder),
      tree: instance.blocks.getChildren('table').map(block => block.id),
      parent: instance.blocks.getById('x')?.parentId,
      saved: await cellOrder(instance),
    }).toEqual({ cell: '0,0', dom: ['x', 'y'], tree: ['x', 'y', 'w'], parent: 'table', saved: ['x', 'y'] });
  });

  it('removes a direct cell reference when dragging its block into a toggle', async () => {
    const instance = await boot([
      { id: 'table', type: 'table', data: { content: [[{ blocks: ['x', 'toggle'] }]] }, content: ['x', 'toggle'] },
      paragraph('x', 'table'),
      { id: 'toggle', type: 'toggle', data: { text: 'toggle', isOpen: true }, parent: 'table', content: ['child'] },
      paragraph('child', 'toggle'),
    ]);

    dragBelow(instance, 'x', 'toggle');
    await settle();

    expect(await cellOrder(instance)).toEqual(['toggle']);
    expect(instance.blocks.getById('x')?.parentId).toBe('toggle');
    expect(instance.blocks.getChildren('toggle').map(block => block.id)).toEqual(['x', 'child']);
  });

  it('undoes a child drag out of a toggle within one cell', async () => {
    const instance = await boot([
      { id: 'table', type: 'table', data: { content: [[{ blocks: ['toggle', 'x'] }]] }, content: ['toggle', 'x'] },
      { id: 'toggle', type: 'toggle', data: { text: 'toggle', isOpen: true }, parent: 'table', content: ['child'] },
      paragraph('child', 'toggle'),
      paragraph('x', 'table'),
    ]);

    dragBelow(instance, 'child', 'x');
    await settle();

    expect(instance.blocks.getById('child')?.parentId).toBe('table');

    instance.history.undo();
    await settle();

    expect(instance.blocks.getById('child')?.parentId).toBe('toggle');
    expect(await cellOrder(instance)).toEqual(['toggle', 'x']);
    expect(instance.blocks.getChildren('toggle').map(block => block.id)).toEqual(['child']);
  });

  it('undoes a nested-block drag within one cell with its cell order', async () => {
    const instance = await boot([
      { id: 'table', type: 'table', data: { content: [[{ blocks: ['toggle', 'x'] }]] }, content: ['toggle', 'x'] },
      { id: 'toggle', type: 'toggle', data: { text: 'toggle', isOpen: true }, parent: 'table', content: ['child'] },
      paragraph('child', 'toggle'),
      paragraph('x', 'table'),
    ]);

    dragBelow(instance, 'toggle', 'x');
    await settle();

    expect(await cellOrder(instance)).toEqual(['x', 'toggle']);

    instance.history.undo();
    await settle();

    expect({
      saved: await cellOrder(instance),
      dom: domCellOrder(holder),
      tree: instance.blocks.getChildren('table').map(block => block.id),
      childParent: instance.blocks.getById('child')?.parentId,
    }).toEqual({ saved: ['toggle', 'x'], dom: ['toggle', 'x'], tree: ['toggle', 'x'], childParent: 'toggle' });
  });
});

const savedCell = async (editor: TestEditor, tableId: string, row: number, col: number): Promise<string[]> => {
  const saved = await editor.save();
  const content = saved.blocks.find(block => block.id === tableId)?.data.content;
  const cells: unknown = Array.isArray(content) ? content[row] : undefined;
  const cell: unknown = Array.isArray(cells) ? cells[col] : undefined;

  if (typeof cell !== 'object' || cell === null || !('blocks' in cell) || !Array.isArray(cell.blocks)) {
    throw new Error(`cell ${row},${col} of ${tableId} is missing`);
  }

  return cell.blocks.filter((id): id is string => typeof id === 'string');
};

const domCell = (editor: TestEditor, tableId: string, row: number, col: number): string[] => {
  const table = editor.blocks.getById(tableId)?.holder;
  const cell = Array.from(table?.querySelectorAll(`[data-blok-table-cell-row="${row}"][data-blok-table-cell-col="${col}"]`) ?? [])
    .find(element => element.closest('[data-blok-element]') === table);

  return Array.from(cell?.querySelectorAll(':scope > [data-blok-table-cell-blocks] > [data-blok-id]') ?? [])
    .map(element => element.getAttribute('data-blok-id') ?? '');
};

const select = (editor: TestEditor, ids: string[]): void => {
  for (const block of editor.module.blockManager.blocks) {
    block.selected = ids.includes(block.id);
  }
};

describe('table cell drag undo across cells', () => {
  let holder: HTMLDivElement;
  let editor: TestEditor | null;

  const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
    const instance = new Blok({ holder, tools: { paragraph: Paragraph, table: Table }, data: { blocks } }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;
    await settle();

    return instance;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    editor = null;
  });

  afterEach(() => {
    editor?.destroy();
    holder.remove();
    vi.restoreAllMocks();
  });

  it('undoes in one step a multi-block drag from two cells out of the table', async () => {
    const instance = await boot([
      { id: 'table', type: 'table', data: { content: [[{ blocks: ['x', 'y'] }, { blocks: ['w', 'v'] }]] }, content: ['x', 'y', 'w', 'v'] },
      paragraph('x', 'table'),
      paragraph('y', 'table'),
      paragraph('w', 'table'),
      paragraph('v', 'table'),
      paragraph('outside'),
    ]);

    select(instance, ['x', 'w']);
    dragBelow(instance, 'x', 'outside');
    await settle();

    expect([cellOf(instance, 'x'), cellOf(instance, 'w')]).toEqual(['outside', 'outside']);
    expect([await savedCell(instance, 'table', 0, 0), await savedCell(instance, 'table', 0, 1)]).toEqual([['y'], ['v']]);

    instance.history.undo();
    await settle();

    expect({
      cells: [cellOf(instance, 'x'), cellOf(instance, 'w')],
      dom: [domCell(instance, 'table', 0, 0), domCell(instance, 'table', 0, 1)],
      parents: [instance.blocks.getById('x')?.parentId, instance.blocks.getById('w')?.parentId],
      saved: [await savedCell(instance, 'table', 0, 0), await savedCell(instance, 'table', 0, 1)],
    }).toEqual({
      cells: ['0,0', '0,1'],
      dom: [['x', 'y'], ['w', 'v']],
      parents: ['table', 'table'],
      saved: [['x', 'y'], ['w', 'v']],
    });
  });

  it('undoes in one step a multi-block drag of a cell block and a root block', async () => {
    const instance = await boot([
      paragraph('root'),
      { id: 'table', type: 'table', data: { content: [[{ blocks: ['x', 'y'] }]] }, content: ['x', 'y'] },
      paragraph('x', 'table'),
      paragraph('y', 'table'),
      paragraph('outside'),
    ]);

    select(instance, ['root', 'x']);
    dragBelow(instance, 'root', 'outside');
    await settle();

    expect(cellOf(instance, 'x')).toBe('outside');
    expect(await savedCell(instance, 'table', 0, 0)).toEqual(['y']);

    instance.history.undo();
    await settle();

    expect({
      cell: cellOf(instance, 'x'),
      dom: domCell(instance, 'table', 0, 0),
      parent: instance.blocks.getById('x')?.parentId,
      saved: await savedCell(instance, 'table', 0, 0),
      order: (await instance.save()).blocks.filter(block => block.parent === undefined).map(block => block.id),
    }).toEqual({ cell: '0,0', dom: ['x', 'y'], parent: 'table', saved: ['x', 'y'], order: ['root', 'table', 'outside'] });
  });

  it('undoes in one step a drag from a nested table cell onto its outer cell', async () => {
    const instance = await boot([
      { id: 'outer', type: 'table', data: { content: [[{ blocks: ['inner', 'p'] }]] }, content: ['inner', 'p'] },
      { id: 'inner', type: 'table', data: { content: [[{ blocks: ['q', 'r'] }]] }, parent: 'outer', content: ['q', 'r'] },
      paragraph('q', 'inner'),
      paragraph('r', 'inner'),
      paragraph('p', 'outer'),
    ]);

    dragBelow(instance, 'q', 'p');
    await settle();

    const landed = instance.blocks.getById('q')?.parentId;

    expect(await savedCell(instance, 'inner', 0, 0)).toEqual(['r']);

    instance.history.undo();
    await settle();

    expect({
      landed,
      dom: domCell(instance, 'inner', 0, 0),
      parent: instance.blocks.getById('q')?.parentId,
      inner: await savedCell(instance, 'inner', 0, 0),
      outer: await savedCell(instance, 'outer', 0, 0),
    }).toEqual({ landed: null, dom: ['q', 'r'], parent: 'inner', inner: ['q', 'r'], outer: ['inner', 'p'] });
  });

  it('undoes in one step a drag from an outer cell onto a nested table cell', async () => {
    const instance = await boot([
      { id: 'outer', type: 'table', data: { content: [[{ blocks: ['p', 'inner'] }]] }, content: ['p', 'inner'] },
      paragraph('p', 'outer'),
      { id: 'inner', type: 'table', data: { content: [[{ blocks: ['q'] }]] }, parent: 'outer', content: ['q'] },
      paragraph('q', 'inner'),
    ]);

    dragBelow(instance, 'p', 'q');
    await settle();

    const landed = instance.blocks.getById('p')?.parentId;
    const afterDrag = await savedCell(instance, 'outer', 0, 0);

    instance.history.undo();
    await settle();

    expect({
      landed,
      afterDrag,
      dom: domCell(instance, 'outer', 0, 0),
      parent: instance.blocks.getById('p')?.parentId,
      inner: await savedCell(instance, 'inner', 0, 0),
      outer: await savedCell(instance, 'outer', 0, 0),
    }).toEqual({ landed: 'outer', afterDrag: ['inner', 'p'], dom: ['p', 'inner'], parent: 'outer', inner: ['q'], outer: ['p', 'inner'] });
  });
});
