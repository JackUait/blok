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
