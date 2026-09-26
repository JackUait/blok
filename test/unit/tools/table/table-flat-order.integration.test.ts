/**
 * A table's cell blocks must sit in the flat block array right after the
 * table, before the table's next sibling (depth-first order). The save gate
 * (`Saver.assertTreePlacement`) throws under NODE_ENV=test, so these tests
 * check the order with `validateTreeOrder` first, then that `save()` resolves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Table } from '../../../../src/tools/table/index';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Header } from '../../../../src/tools/header';
import { ToggleItem } from '../../../../src/tools/toggle';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { validateTreeOrder } from '../../../../src/components/utils/hierarchy-invariant';
import type { API, OutputBlockData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<unknown>;
  destroy: () => void;
  blocks: API['blocks'];
  caret: API['caret'];
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      header: Header,
      toggle: ToggleItem,
      table: Table,
      database: DatabaseTool,
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

const liveBlocks = (instance: TestEditor): Array<{ id: string; name: string; parentId: string | null; contentIds: readonly string[] }> =>
  Array.from({ length: instance.blocks.getBlocksCount() }, (_, index) => {
    const block = instance.blocks.getBlockByIndex(index);

    if (block === undefined) {
      throw new Error(`no block at ${index}`);
    }

    return { id: block.id, name: block.name, parentId: block.parentId, contentIds: block.contentIds };
  });

const expectDepthFirst = async (instance: TestEditor): Promise<void> => {
  expect(validateTreeOrder(liveBlocks(instance)).map(v => v.message)).toEqual([]);
  await expect(instance.save()).resolves.toBeDefined();
};

const TABLE_ID = 'tbl';

const tableWithTextCells = (): OutputBlockData => ({
  id: TABLE_ID,
  type: 'table',
  data: {
    withHeadings: false,
    content: [
      [{ blocks: [], text: 'a1' }, { blocks: [], text: 'a2' }],
      [{ blocks: [], text: 'b1' }, { blocks: [], text: 'b2' }],
    ],
  },
});

const P = (id: string): OutputBlockData => ({ id, type: 'paragraph', data: { text: id } });

describe('table cell blocks keep the flat array depth-first', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('places cells created from `text` right after the table, not after the blocks below it', async () => {
    const instance = await boot([tableWithTextCells(), P('after'), P('last')]);

    await expectDepthFirst(instance);
  });

  it('places the merged origin cell created from `text` right after the table', async () => {
    const instance = await boot([
      {
        id: TABLE_ID,
        type: 'table',
        data: {
          withHeadings: false,
          content: [
            [{ blocks: [], colspan: 2, text: 'Merged' }, { blocks: [], mergedInto: [0, 0] }],
            [{ blocks: [], text: 'A' }, { blocks: [], text: 'B' }],
          ],
        },
      },
      P('after'),
    ]);

    await expectDepthFirst(instance);
  });

  it('places the cells of a table inserted through the API above other blocks inside its run', async () => {
    const instance = await boot([P('before'), P('after')]);

    instance.blocks.insert('table', { content: [['x', 'y']] }, {}, 1);
    await settle();

    await expectDepthFirst(instance);
  });

  it('places the blocks of a row added to a table with blocks below it inside the table run', async () => {
    const instance = await boot([tableWithTextCells(), P('after')]);
    const addRow = holder?.querySelector<HTMLElement>('[data-blok-table-add-row]');

    if (addRow === null || addRow === undefined) {
      throw new Error('no add-row button');
    }
    // jsdom has no pointer capture.
    addRow.setPointerCapture = vi.fn();
    addRow.releasePointerCapture = vi.fn();
    addRow.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    addRow.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    await settle();

    expect(holder?.querySelectorAll('[data-blok-table-row]')).toHaveLength(3);
    await expectDepthFirst(instance);
  });

  it.each([
    { name: 'row', button: 'data-blok-table-add-row' },
    { name: 'column', button: 'data-blok-table-add-col' },
  ])('lists the cells of an added $name in grid order among the table\'s children', async ({ button }) => {
    const instance = await boot([tableWithTextCells(), P('after')]);
    const add = holder?.querySelector<HTMLElement>(`[${button}]`);

    if (add === null || add === undefined) {
      throw new Error('no add button');
    }
    // jsdom has no pointer capture.
    add.setPointerCapture = vi.fn();
    add.releasePointerCapture = vi.fn();
    add.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    add.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    await settle();

    const saved = (await instance.save()) as { blocks: OutputBlockData[] };
    const content = saved.blocks.find(block => block.id === TABLE_ID)?.data.content as Array<Array<{ blocks: string[] }>>;
    const gridIds = content.flat().flatMap(cell => cell.blocks);

    expect(gridIds).toHaveLength(6);
    expect(instance.blocks.getChildren(TABLE_ID).map(child => child.id)).toEqual(gridIds);
  });

  it('puts the block created by leaving the last cell after the whole table, not between the table and its cells', async () => {
    const instance = await boot([
      P('before'),
      { id: TABLE_ID, type: 'table', data: { withHeadings: false, content: [['a1', 'a2']] } },
    ]);
    // jsdom does not reflect `contentEditable` to an attribute, so find the tool root.
    const editables = holder?.querySelectorAll<HTMLElement>('[data-blok-table-cell] [data-blok-element-content] > *') ?? [];
    const lastEditable = editables[editables.length - 1];

    if (lastEditable === undefined) {
      throw new Error('no cell editable');
    }
    lastEditable.focus();
    lastEditable.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await settle();

    const blocks = liveBlocks(instance);

    expect(blocks).toHaveLength(5);
    expect(blocks.filter(block => block.parentId === null).map(block => block.name)).toEqual(['paragraph', 'table', 'paragraph']);
    await expectDepthFirst(instance);
  });

  it('places the cells of a table pasted as Blok JSON right after the table', async () => {
    const instance = await boot([{ id: 'target', type: 'paragraph', data: { text: '' } }, P('after')]);
    const target = holder?.querySelector<HTMLElement>('[data-blok-id="target"] [data-blok-element-content] > *');

    if (target === null || target === undefined) {
      throw new Error('no paste target');
    }
    const payload = JSON.stringify([
      { id: 'lead', tool: 'paragraph', data: { text: 'lead' } },
      { id: 't', tool: 'table', data: { withHeadings: false, content: [[{ blocks: ['c1'] }, { blocks: ['c2'] }]] } },
      { id: 'c1', tool: 'paragraph', data: { text: 'c1' }, parentId: 't' },
      { id: 'c2', tool: 'paragraph', data: { text: 'c2' }, parentId: 't' },
      { id: 'tail', tool: 'header', data: { text: 'tail', level: 2 } },
    ]);
    const data: Record<string, string> = { 'application/x-blok': payload, 'text/plain': 'lead' };

    target.focus();
    instance.caret.setToBlock('target');
    target.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: { getData: (type: string): string => data[type] ?? '', types: Object.keys(data) },
    }));
    await settle();
    await settle();

    const blocks = liveBlocks(instance);

    expect(blocks.filter(block => block.name === 'table')).toHaveLength(1);
    expect(blocks.filter(block => block.name === 'header' && block.parentId === null)).toHaveLength(1);
    expect(holder?.querySelector('[data-blok-table-cell] [data-blok-component="header"]')).toBeNull();
    await expectDepthFirst(instance);
  });

  it('appends a block through the API after a table that ends the document at root, outside the last cell', async () => {
    const instance = await boot([
      P('before'),
      { id: TABLE_ID, type: 'table', data: { withHeadings: false, content: [['a1', 'a2']] } },
    ]);

    const appended = instance.blocks.insert('paragraph', { text: 'end' }, {}, instance.blocks.getBlocksCount());

    await settle();

    expect(appended.holder.closest('[data-blok-table-cell]')).toBeNull();
    expect(instance.blocks.getById(appended.id)?.parentId ?? null).toBeNull();
    await expectDepthFirst(instance);
  });

  it('keeps a header inserted right after a table\'s cells a header at root', async () => {
    const instance = await boot([
      P('before'),
      { id: TABLE_ID, type: 'table', data: { withHeadings: false, content: [['a1', 'a2']] } },
    ]);

    const header = instance.blocks.insert('header', { text: 'H', level: 2 }, {}, instance.blocks.getBlocksCount());

    await settle();

    expect(header.name).toBe('header');
    expect(header.holder.closest('[data-blok-table-cell]')).toBeNull();
    expect(instance.blocks.getById(header.id)?.parentId ?? null).toBeNull();
    await expectDepthFirst(instance);
  });

  it('places a block inserted between a toggle ending in a table and the next root block at root, outside the cells', async () => {
    const instance = await boot([
      { id: 'tg', type: 'toggle', data: { text: 'tg', isOpen: true }, content: [TABLE_ID] },
      { id: TABLE_ID, type: 'table', data: { withHeadings: false, content: [['a1', 'a2']] }, parent: 'tg' },
      P('after'),
    ]);
    const afterIndex = instance.blocks.getBlockIndex('after');

    if (afterIndex === undefined) {
      throw new Error('no after block');
    }
    const appended = instance.blocks.insert('paragraph', { text: 'end' }, {}, afterIndex);

    await settle();

    expect(appended.holder.closest('[data-blok-table-cell]')).toBeNull();
    // Same as after a toggle's last paragraph: the shallowest level wins.
    expect(instance.blocks.getById(appended.id)?.parentId ?? null).toBeNull();
    await expectDepthFirst(instance);
  });

  it('builds the cells of a table nested in a toggle inside the table, not the toggle', async () => {
    const instance = await boot([
      { id: 'tg', type: 'toggle', data: { text: 'tg', isOpen: true }, content: [TABLE_ID, 'p2'] },
      { ...tableWithTextCells(), parent: 'tg' },
      { ...P('p2'), parent: 'tg' },
      P('after'),
    ]);
    const blocks = liveBlocks(instance);

    expect(blocks.filter(block => block.parentId === TABLE_ID)).toHaveLength(4);
    expect(blocks.filter(block => block.parentId === 'tg').map(block => block.id)).toEqual([TABLE_ID, 'p2']);
    expect(holder?.querySelectorAll('[data-blok-table-cell] [data-blok-id]')).toHaveLength(4);
    await expectDepthFirst(instance);
  });

  it('nests a block inserted after a table that has a sibling below it in the toggle', async () => {
    const instance = await boot([
      { id: 'tg', type: 'toggle', data: { text: 'tg', isOpen: true }, content: [TABLE_ID, 'p2'] },
      { id: TABLE_ID, type: 'table', data: { withHeadings: false, content: [['a1', 'a2']] }, parent: 'tg' },
      { ...P('p2'), parent: 'tg' },
      P('after'),
    ]);
    const p2Index = instance.blocks.getBlockIndex('p2');

    if (p2Index === undefined) {
      throw new Error('no p2');
    }
    const inserted = instance.blocks.insert('paragraph', { text: 'mid' }, {}, p2Index);

    await settle();

    expect(instance.blocks.getById(inserted.id)?.parentId).toBe('tg');
    expect(inserted.holder.closest('[data-blok-table-cell]')).toBeNull();
    expect(inserted.holder.closest('[data-blok-id="tg"]')).not.toBeNull();
    await expectDepthFirst(instance);
  });

  it('adds a database row inside the database run and keeps the flat array depth-first', async () => {
    const instance = await boot([
      {
        id: 'db',
        type: 'database',
        data: {
          title: 'Tasks',
          schema: [{ id: 'p1', name: 'Name', type: 'title', position: 'a0' }],
          views: [{ id: 'v1', name: 'All', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['p1'] }],
          activeViewId: 'v1',
        },
        content: ['r1'],
      },
      { id: 'r1', type: 'database-row', data: { properties: { p1: 'one' }, position: 'a0', title: 'one' }, parent: 'db' },
      P('after'),
    ]);
    const dbIndex = instance.blocks.getBlockIndex('db');

    if (dbIndex === undefined) {
      throw new Error('no database');
    }
    instance.blocks.insert('database-row', { properties: { p1: 'two' }, position: 'a1', title: 'two' }, {}, dbIndex + 1, false, false, 'r2');
    instance.blocks.setBlockParent('r2', 'db');
    await settle();

    expect(liveBlocks(instance).map(block => block.id)).toEqual(['db', 'r1', 'r2', 'after']);
    await expectDepthFirst(instance);
  });
});
