/**
 * In dev/test, BlockOperations warns when the flat block array is not the
 * contentIds tree walk once its outermost operation ends. It never throws,
 * and it stays quiet while a drag's move group is open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { ToggleItem } from '../../../../../src/tools/toggle';
import { ColumnList } from '../../../../../src/tools/column-list';
import { Column } from '../../../../../src/tools/column';
import { Table } from '../../../../../src/tools/table';
import { addColumnToList } from '../../../../../src/tools/column-drop';
import type { API, OutputBlockData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  blocks: API['blocks'];
  caret: API['caret'];
  module: {
    blockManager: {
      blocks: Block[];
      getBlockById: (id: string) => Block | undefined;
      move: (toIndex: number, fromIndex: number) => void;
      setBlockParent: (block: Block, parentId: string | null) => void;
    };
    yjsManager: { transactMoves: (fn: () => void) => void };
    paste: { processText: (data: string, isHTML?: boolean) => Promise<void> };
  };
}

const P = (id: string, parent?: string): OutputBlockData => ({
  id,
  type: 'paragraph',
  data: { text: id },
  ...(parent !== undefined ? { parent } : {}),
});

const T = (id: string, content: string[], parent?: string): OutputBlockData => ({
  id,
  type: 'toggle',
  data: { text: id, isOpen: true },
  content,
  ...(parent !== undefined ? { parent } : {}),
});

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const nextFrames = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
};

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      toggle: ToggleItem,
      column_list: ColumnList,
      column: Column,
      table: Table,
    },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();
  await nextFrames(3);

  return instance;
};

const treeOrderWarnings = (warn: { mock: { calls: unknown[][] } }): string[] =>
  warn.mock.calls
    .map(call => call.map(String).join(' '))
    .filter(text => text.includes('Tree order broken at BlockOperations'));

describe('BlockOperations tree-order warning (dev/test)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('warns once, without throwing, when an operation leaves the flat array out of tree order', async () => {
    // Known bug (followups Step 4 (b)): the promoted children keep their flat
    // slot between the column_list and its next column.
    const instance = await boot([
      { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2', 'c3'] },
      { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['tog'] },
      T('tog', ['x1', 'x2'], 'c1'),
      P('x1', 'tog'),
      P('x2', 'tog'),
      { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
      P('p2', 'c2'),
      { id: 'c3', type: 'column', data: {}, parent: 'cl1', content: ['p3'] },
      P('p3', 'c3'),
    ]);
    const warn = vi.spyOn(console, 'warn');

    await expect(instance.blocks.delete(instance.blocks.getBlockIndex('tog'))).resolves.toBeUndefined();
    await settle();

    const warnings = treeOrderWarnings(warn);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('BlockOperations.removeBlock');
  }, 30_000);

  it('stays quiet while a drag move group is open, even when a flat move breaks the order mid-group', async () => {
    const instance = await boot([T('t', ['c']), P('c', 't'), P('x')]);
    const { blockManager, yjsManager } = instance.module;
    const x = blockManager.getBlockById('x');

    if (x === undefined) {
      throw new Error('no x');
    }
    const warn = vi.spyOn(console, 'warn');

    yjsManager.transactMoves(() => {
      blockManager.move(1, blockManager.blocks.indexOf(x));
      blockManager.setBlockParent(x, 't');
    });
    await settle();

    expect(blockManager.blocks.map(block => block.id)).toEqual(['t', 'x', 'c']);
    expect(treeOrderWarnings(warn)).toEqual([]);
  }, 30_000);

  // Known gap: the paste handler inserts each block by index as a root block
  // between the toggle's children, and only then calls setBlockParent. The
  // insert is its own outermost operation, so it ends out of tree order.
  it.fails('does not warn for a multi-block paste after a toggle child', async () => {
    const instance = await boot([T('t', ['a', 'b']), P('a', 't'), P('b', 't'), P('z')]);
    const warn = vi.spyOn(console, 'warn');

    instance.caret.setToBlock('a', 'end');
    await instance.module.paste.processText('<p>one</p><p>two</p>', true);
    await settle();

    expect(treeOrderWarnings(warn)).toEqual([]);
  }, 30_000);

  it('does not warn when a column is added to a column list', async () => {
    const instance = await boot([
      P('a'),
      { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['t1'] },
      T('t1', ['t1c'], 'c1'),
      P('t1c', 't1'),
      { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['q'] },
      P('q', 'c2'),
      P('z'),
    ]);
    const warn = vi.spyOn(console, 'warn');

    const column = addColumnToList(instance as unknown as API, 'c1', ['z'], 'right');
    await settle();

    expect(treeOrderWarnings(warn)).toEqual([]);
    expect(instance.blocks.getChildren('cl').map(block => block.id)).toEqual(['c1', column, 'c2']);
    expect(instance.blocks.getChildren(String(column)).map(block => block.id)).toEqual(['z']);
  }, 30_000);

  it('does not warn for insertInsideParent into a table', async () => {
    const instance = await boot([
      P('before'),
      { id: 'tbl', type: 'table', data: { withHeadings: false, content: [['a', 'b'], ['c', 'd']] } },
      P('end'),
    ]);
    const endIndex = instance.blocks.getBlockIndex('end');

    if (endIndex === undefined) {
      throw new Error('no end block');
    }
    const warn = vi.spyOn(console, 'warn');

    const child = instance.blocks.insertInsideParent('tbl', endIndex);
    await settle();

    expect(treeOrderWarnings(warn)).toEqual([]);
    expect(instance.blocks.getChildren('tbl').map(block => block.id)).toContain(child.id);
  }, 30_000);
});
