/**
 * Column paths must keep the flat block array a depth-first walk of the tree
 * and every holder in its home slot. The save gate
 * (`Saver.assertTreePlacement`) throws under NODE_ENV=test, so `save()`
 * resolving is the placement check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import type { Block } from '../../../src/components/block';
import { Paragraph } from '../../../src/tools/paragraph';
import { Header } from '../../../src/tools/header';
import { ColumnList } from '../../../src/tools/column-list';
import { Column } from '../../../src/tools/column';
import { ToggleItem } from '../../../src/tools/toggle';
import { addColumnToList, wrapBlocksInColumns, wrapInNewColumnList } from '../../../src/tools/column-drop';
import type { API, OutputBlockData, OutputData } from '../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
  module: {
    blockManager: { blocks: Block[]; getBlockById: (id: string) => Block | undefined };
    yjsManager: {
      stopCapturing: () => void;
      beginGesture: (kind: 'typing' | 'discrete') => void;
      holdCapture: () => void;
      releaseCapture: () => void;
      toJSON: () => OutputBlockData[];
    };
    dragManager: { duplicateBlocksInPlace: (block: Block) => Promise<Block[]> };
    paste: { processText: (data: string, isHTML?: boolean) => Promise<void> };
    caret: { setToBlock: (...args: unknown[]) => boolean };
  };
  caret: API['caret'];
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
      header: Header,
      column_list: ColumnList,
      column: Column,
      toggle: ToggleItem,
    },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();
  instance.module.yjsManager.stopCapturing();

  return instance;
};

/** `id^parent` for every block, in flat order. */
const flat = (instance: TestEditor): string[] =>
  instance.module.blockManager.blocks.map(block => `${block.id}^${block.parentId ?? '-'}`);

const parentById = (blocks: OutputBlockData[]): Record<string, string | undefined> =>
  Object.fromEntries(blocks.map(block => [block.id ?? '?', block.parent]));

const twoColumns = (): OutputBlockData[] => [
  { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
  { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['empty'] },
  P('empty', 'c1'),
  { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['right'] },
  P('right', 'c2'),
];

/** Every column of `listId` directly followed by its own subtree. */
const columnsOf = (instance: TestEditor, listId: string): string[] =>
  instance.blocks.getChildren(listId).map(column => column.id);

describe('column paths keep the tree placement', () => {
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

  describe('a rogue non-column child of a column_list', () => {
    it('does not break a save made before its scheduled eviction, and is evicted after', async () => {
      const instance = await boot([
        { id: 'cl1', type: 'column_list', data: { columnCount: 2 }, content: ['c1', 'c2', 'rogue'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['h1'] },
        { id: 'h1', type: 'header', data: { text: 'Left', level: 3 }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['m2'] },
        P('m2', 'c2'),
        P('rogue', 'cl1'),
      ]);

      // The list's rendered() mounts the columns; save in that same frame.
      const columnsMounted = (): boolean =>
        holder?.querySelectorAll('[data-blok-columns] > [data-blok-element]').length === 2;

      while (!columnsMounted()) {
        await nextFrames(1);
      }

      await expect(instance.save()).resolves.toBeDefined();

      await nextFrames(3);

      expect(flat(instance)).toContain('rogue^-');
    }, 30_000);

    it('interleaved between columns is ejected to right after the column_list', async () => {
      const instance = await boot([
        { id: 'cl1', type: 'column_list', data: { columnCount: 2 }, content: ['c1', 'rogue', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['h1'] },
        { id: 'h1', type: 'header', data: { text: 'Left', level: 3 }, parent: 'c1' },
        P('rogue', 'cl1'),
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['m2'] },
        P('m2', 'c2'),
      ]);

      await nextFrames(3);

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['cl1^-', 'c1^cl1', 'h1^c1', 'c2^cl1', 'm2^c2', 'rogue^-']);
    }, 30_000);

    it('ejected before a following root block keeps that block after it', async () => {
      const instance = await boot([
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'rogue', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['h1'] },
        P('h1', 'c1'),
        P('rogue', 'cl1'),
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['m2'] },
        P('m2', 'c2'),
        P('z'),
      ]);

      await nextFrames(3);

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['cl1^-', 'c1^cl1', 'h1^c1', 'c2^cl1', 'm2^c2', 'rogue^-', 'z^-']);
    }, 30_000);

    it('keeps several interleaved rogues in their order and carries their children', async () => {
      const instance = await boot([
        { id: 'cl1', type: 'column_list', data: {}, content: ['r1', 'c1', 'r2', 'c2'] },
        P('r1', 'cl1'),
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['h1'] },
        P('h1', 'c1'),
        T('r2', ['r2c'], 'cl1'),
        P('r2c', 'r2'),
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['m2'] },
        P('m2', 'c2'),
      ]);

      await nextFrames(3);

      expect(instance.blocks.getById('r2')?.parentId ?? null).toBeNull();
      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['cl1^-', 'c1^cl1', 'h1^c1', 'c2^cl1', 'm2^c2', 'r1^-', 'r2^-', 'r2c^r2']);
    }, 30_000);

    it('keeps an empty last column when a rogue passes through it', async () => {
      const instance = await boot([
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'rogue', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['h1'] },
        P('h1', 'c1'),
        P('rogue', 'cl1'),
        { id: 'c2', type: 'column', data: {}, parent: 'cl1' },
      ]);

      await nextFrames(3);
      await settle();

      expect(instance.blocks.getById('rogue')?.parentId ?? null).toBeNull();
      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['cl1^-', 'c1^cl1', 'h1^c1', 'c2^cl1', 'rogue^-']);
    }, 30_000);
  });

  describe('inserting a column_list preset', () => {
    it('inside a column (replacing its empty paragraph) seeds each column right before its own paragraph', async () => {
      const instance = await boot(twoColumns());

      const nested = instance.blocks.insert('column_list', { columnCount: 2 }, undefined, 2, true, true, undefined, undefined, 'user');

      await settle();

      await expect(instance.save()).resolves.toBeDefined();
      const [first, second] = columnsOf(instance, nested.id);
      const [firstPara] = columnsOf(instance, first);
      const [secondPara] = columnsOf(instance, second);

      expect(flat(instance)).toEqual([
        'cl1^-', 'c1^cl1', `${nested.id}^c1`,
        `${first}^${nested.id}`, `${firstPara}^${first}`,
        `${second}^${nested.id}`, `${secondPara}^${second}`,
        'c2^cl1', 'right^c2',
      ]);
    }, 30_000);

    it('at the root with three columns keeps each seeded paragraph under its column', async () => {
      const instance = await boot([P('a'), P('z')]);

      const list = instance.blocks.insert('column_list', { columnCount: 3 }, undefined, 1, true, false, undefined, undefined, 'user');

      await settle();

      await expect(instance.save()).resolves.toBeDefined();
      const columns = columnsOf(instance, list.id);

      expect(columns).toHaveLength(3);
      expect(flat(instance)).toEqual([
        'a^-', `${list.id}^-`,
        ...columns.flatMap(col => [`${col}^${list.id}`, ...columnsOf(instance, col).map(p => `${p}^${col}`)]),
        'z^-',
      ]);
    }, 30_000);

    it('survives undo and redo of the insert', async () => {
      const instance = await boot(twoColumns());

      instance.blocks.insert('column_list', { columnCount: 2 }, undefined, 2, true, true, undefined, undefined, 'user');
      await settle();
      instance.module.yjsManager.stopCapturing();

      instance.history.undo();
      await settle();
      await expect(instance.save()).resolves.toBeDefined();

      instance.history.redo();
      await settle();
      await nextFrames(2);
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    // The slash menu holds the undo step while it is open, and closes when
    // the first seeded column's paragraph takes the caret, before the second
    // column is inserted.
    it('picked from the slash menu stays one undo step, so undo and redo keep both columns in the list', async () => {
      const instance = await boot([P('p0')]);
      const { yjsManager } = instance.module;

      instance.caret.setToBlock('p0');
      yjsManager.beginGesture('typing');
      await settle();

      const { caret } = instance.module;
      const setToBlock = caret.setToBlock.bind(caret);
      const menu = { open: true };

      vi.spyOn(caret, 'setToBlock').mockImplementation((...args) => {
        if (menu.open) {
          menu.open = false;
          yjsManager.releaseCapture();
        }

        return setToBlock(...args);
      });

      yjsManager.holdCapture();

      // A click inside the menu starts no gesture of its own.
      await settle();
      instance.blocks.insert('column_list', { columnCount: 2 }, undefined, 0, undefined, true, undefined, undefined, 'user');
      await settle();
      await nextFrames(2);

      expect(menu.open, 'the menu closed mid-seed').toBe(false);

      instance.history.undo();
      await settle();
      await nextFrames(2);
      instance.history.redo();
      await settle();
      await nextFrames(2);

      const saved = await instance.save();
      const lists = saved.blocks.filter(block => block.type === 'column_list');
      const columns = saved.blocks.filter(block => block.type === 'column');
      const dump = saved.blocks.map(block => `${block.id}:${block.type}<-${block.parent ?? 'ROOT'}`).join(' | ');

      expect(columns.map(column => column.parent), dump).toEqual([lists[0]?.id, lists[0]?.id]);
      expect(lists, dump).toHaveLength(1);
      expect(parentById(yjsManager.toJSON())).toEqual(parentById(saved.blocks));
    }, 30_000);
  });

  describe('deleting a container in a column', () => {
    // Known bug: the promoted children go to the root but keep their flat
    // position between the column_list and its next column. With two columns
    // the list unwraps and hides it; with three the save rejects the tree.
    it.fails('keeps the tree walk when the list has three columns', async () => {
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

      await nextFrames(3);

      await instance.blocks.delete(instance.blocks.getBlockIndex('tog'));
      await nextFrames(5);
      await settle();

      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);
  });

  describe('other column paths', () => {
    const undo = async (instance: TestEditor): Promise<void> => {
      await settle();
      instance.module.yjsManager.stopCapturing();
      instance.history.undo();
      await settle();
      await nextFrames(2);
      await expect(instance.save(), 'after undo').resolves.toBeDefined();
    };

    const undoRedo = async (instance: TestEditor): Promise<void> => {
      await undo(instance);
      instance.history.redo();
      await settle();
      await nextFrames(2);
      await expect(instance.save(), 'after redo').resolves.toBeDefined();
    };

    const withToggleColumns = (): OutputBlockData[] => [
      P('a'),
      { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['t1'] },
      T('t1', ['t1c'], 'c1'),
      P('t1c', 't1'),
      { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['q'] },
      P('q', 'c2'),
      P('z'),
    ];

    it('deleting one of two columns unwraps the list in tree order, and undo/redo keep it', async () => {
      const instance = await boot(withToggleColumns());

      await instance.blocks.delete(instance.blocks.getBlockIndex('c2'), false);
      await settle();
      await settle();

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['a^-', 't1^-', 't1c^t1', 'z^-']);
      await undoRedo(instance);
    }, 30_000);

    it('deleting one of two columns of a NESTED list unwraps into the outer column in tree order', async () => {
      const instance = await boot([
        { id: 'out', type: 'column_list', data: {}, content: ['o1', 'o2'] },
        { id: 'o1', type: 'column', data: {}, parent: 'out', content: ['cl'] },
        { id: 'cl', type: 'column_list', data: {}, parent: 'o1', content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['t1'] },
        T('t1', ['t1c'], 'c1'),
        P('t1c', 't1'),
        { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['q'] },
        P('q', 'c2'),
        { id: 'o2', type: 'column', data: {}, parent: 'out', content: ['r'] },
        P('r', 'o2'),
      ]);

      await instance.blocks.delete(instance.blocks.getBlockIndex('c1'), false);
      await settle();
      await settle();

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['out^-', 'o1^out', 'q^o1', 'o2^out', 'r^o2']);
      await undoRedo(instance);
    }, 30_000);

    it('wrapping a toggle with children beside a later block puts the list at that block, subtree in its column', async () => {
      const instance = await boot([T('t', ['tc']), P('tc', 't'), P('m'), P('b')]);

      const listId = String(wrapInNewColumnList(instance as unknown as API, 'b', ['t'], 'left'));

      await expect(instance.save()).resolves.toBeDefined();
      const [first, second] = columnsOf(instance, listId);

      const wrapped = [
        'm^-', `${listId}^-`, `${first}^${listId}`, `t^${first}`, 'tc^t', `${second}^${listId}`, `b^${second}`,
      ];

      expect(flat(instance)).toEqual(wrapped);
      await undoRedo(instance);
      expect(flat(instance)).toEqual(wrapped);
    }, 30_000);

    it('turning a selection with a toggle subtree into columns keeps each subtree in its column', async () => {
      const instance = await boot([P('a'), T('t', ['tc']), P('tc', 't'), P('b')]);

      const listId = String(wrapBlocksInColumns(instance as unknown as API, ['a', 't', 'b']));

      await expect(instance.save()).resolves.toBeDefined();
      const [c1, c2, c3] = columnsOf(instance, listId);

      expect(flat(instance)).toEqual([
        `${listId}^-`, `${c1}^${listId}`, `a^${c1}`, `${c2}^${listId}`, `t^${c2}`, 'tc^t', `${c3}^${listId}`, `b^${c3}`,
      ]);
      await undoRedo(instance);
    }, 30_000);

    it.each(['left', 'right'] as const)('adding a column on the %s of a column keeps tree order through undo and redo', async (side) => {
      const instance = await boot(withToggleColumns());

      addColumnToList(instance as unknown as API, 'c1', ['z'], side);

      await expect(instance.save()).resolves.toBeDefined();
      await undoRedo(instance);
    }, 30_000);

    it('duplicating a column_list copies exactly its columns, in tree order', async () => {
      const instance = await boot(withToggleColumns());
      const list = instance.module.blockManager.getBlockById('cl');

      if (list === undefined) {
        throw new Error('no list');
      }

      const copies = await instance.module.dragManager.duplicateBlocksInPlace(list);

      await settle();
      await nextFrames(2);

      expect(copies.filter(copy => copy.name === 'column')).toHaveLength(2);
      expect(instance.module.blockManager.blocks.filter(block => block.name === 'column'), 'no seeded phantom columns').toHaveLength(4);
      await expect(instance.save()).resolves.toBeDefined();
      await undoRedo(instance);
    }, 30_000);

    it('pasting several paragraphs into a column keeps them in that column in tree order', async () => {
      const instance = await boot(twoColumns());

      instance.caret.setToBlock('empty', 'start');
      await instance.module.paste.processText('<p>one</p><p>two</p><p>three</p>', true);
      await settle();

      await expect(instance.save()).resolves.toBeDefined();
      expect(instance.blocks.getChildren('c1').length).toBeGreaterThanOrEqual(3);
      expect(instance.blocks.getChildren('c2').map(child => child.id)).toEqual(['right']);
      await undoRedo(instance);
    }, 30_000);
  });

  describe('the shared doc holds what save() returns', () => {
    const dataById = (blocks: OutputBlockData[]): Record<string, unknown> =>
      Object.fromEntries(blocks.map(block => [block.id ?? '?', block.data]));

    const docMatchesSave = async (run: (api: API) => unknown): Promise<void> => {
      const instance = await boot([P('r'), P('s')]);

      // Past the load's own sync window, which holds parent syncs back.
      await nextFrames(2);
      run(instance as unknown as API);

      // The doc catches up through async saves.
      await vi.waitFor(async () => {
        const saved = await instance.save();

        expect(dataById(instance.module.yjsManager.toJSON())).toEqual(dataById(saved.blocks));
      }, { timeout: 3000 });
    };

    it('after a side-drop wrap', async () => {
      await docMatchesSave(api => wrapInNewColumnList(api, 'r', ['s'], 'right'));
    }, 30_000);

    it('after wrapping a selection', async () => {
      await docMatchesSave(api => wrapBlocksInColumns(api, ['r', 's']));
    }, 30_000);

    // Known gap: the seeded columns keep their noFocus hint in the doc (the
    // column_list used to keep columnCount instead). Saved JSON is clean.
    it.fails('after seeding a column preset', async () => {
      await docMatchesSave(api => api.blocks.insert('column_list', { columnCount: 3 }, undefined, 2, true, false, 'cl', undefined, 'user'));
    }, 30_000);
  });

  describe('a column emptied by a column drop removes itself', () => {
    const soleChildColumns = (): OutputBlockData[] => [
      { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['a'] },
      P('a', 'c1'),
      { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['b'] },
      P('b', 'c2'),
      P('r'),
    ];

    // DragController.reseedEmptiedColumns re-fires rendered() on each emptied
    // source column right after the drop, in the same task.
    const reseed = (instance: TestEditor): void => {
      instance.module.blockManager.getBlockById('c1')?.call('rendered');
    };

    const quiet = async (): Promise<void> => {
      await settle();
      await nextFrames(3);
      await settle();
    };

    it('when its sole block becomes a new column of the same list', async () => {
      const instance = await boot(soleChildColumns());

      // Past the load's own sync window, where a column never deletes itself.
      await nextFrames(2);

      const created = addColumnToList(instance as unknown as API, 'c2', ['a'], 'right');
      reseed(instance);

      await expect.poll(() => instance.blocks.getById('c1'), { timeout: 3000 }).toBeNull();
      await quiet();

      expect(columnsOf(instance, 'cl1')).toEqual(['c2', created]);
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    it('when its sole block is wrapped beside a root block', async () => {
      const instance = await boot(soleChildColumns());

      // Past the load's own sync window, where a column never deletes itself.
      await nextFrames(2);

      wrapInNewColumnList(instance as unknown as API, 'r', ['a'], 'right');
      reseed(instance);

      await expect.poll(() => instance.blocks.getById('c1'), { timeout: 3000 }).toBeNull();
      await quiet();
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);
  });
});
