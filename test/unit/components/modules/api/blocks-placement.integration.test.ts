/**
 * `blocks.insertAt` / `blocks.moveTo`: sibling-relative placement on a real
 * editor. The save gate (`Saver.assertTreePlacement`) throws under
 * NODE_ENV=test, so a resolving `save()` also proves the flat order is
 * depth-first and every holder sits in its home slot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { BlockChanged } from '../../../../../src/components/events/BlockChanged';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { ToggleItem } from '../../../../../src/tools/toggle';
import { Header } from '../../../../../src/tools/header';
import { Table } from '../../../../../src/tools/table/index';
import { ColumnList } from '../../../../../src/tools/column-list';
import { Column } from '../../../../../src/tools/column';
import type { API, BlockMutationEvent, OutputBlockData, OutputData } from '../../../../../types';
import type { BlockPosition } from '../../../../../types/api';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
  module: {
    blockManager: { blocks: Block[]; currentBlockIndex: number };
    yjsManager: { stopCapturing: () => void };
    paste: { processText: (data: string, isHTML?: boolean) => Promise<void> };
  };
}

interface Dispatcher {
  on: (name: typeof BlockChanged, cb: (payload: { event: BlockMutationEvent }) => void) => void;
}

const P = (id: string, parent?: string, content?: string[]): OutputBlockData => ({
  id,
  type: 'paragraph',
  data: { text: id },
  ...(parent !== undefined ? { parent } : {}),
  ...(content !== undefined ? { content } : {}),
});

const T = (id: string, content: string[], parent?: string): OutputBlockData => ({
  id,
  type: 'toggle',
  data: { text: id, isOpen: true },
  content,
  ...(parent !== undefined ? { parent } : {}),
});

/** A container that only takes paragraphs. */
class ParagraphsOnly {
  public static get childTools(): { allow: string[] } {
    return { allow: ['paragraph'] };
  }

  public render(): HTMLElement {
    return document.createElement('div');
  }

  public save(): Record<string, never> {
    return {};
  }
}

/** A container whose children are its own machinery. */
class Owner {
  public static get ownsChildren(): boolean {
    return true;
  }

  public render(): HTMLElement {
    return document.createElement('div');
  }

  public save(): Record<string, never> {
    return {};
  }
}

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

/** a, t{c1, c2}, b */
const doc = (): OutputBlockData[] => [
  P('a'),
  T('t', ['c1', 'c2']),
  P('c1', 't'),
  P('c2', 't'),
  P('b'),
];

const INITIAL = ['a^-', 't^-', 'c1^t', 'c2^t', 'b^-'];

/** The name of the error `run` throws, or 'no throw'. */
const thrownName = (run: () => void): string => {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.name : 'not an Error';
  }

  return 'no throw';
};

const table = (id: string): OutputBlockData => ({
  id,
  type: 'table',
  data: {
    withHeadings: false,
    content: [
      [{ blocks: [], text: 'a1' }, { blocks: [], text: 'a2' }],
    ],
  },
});

const H = (id: string): OutputBlockData => ({ id, type: 'header', data: { text: id, level: 2 } });

/** Root-level ids, in flat order. */
const roots = (instance: TestEditor): string[] =>
  instance.module.blockManager.blocks.filter(block => block.parentId === null).map(block => block.id);

const boot = async (blocks: OutputBlockData[] = doc()): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, toggle: ToggleItem, header: Header, table: Table, column_list: ColumnList, column: Column, only: ParagraphsOnly, owner: Owner },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();
  await nextFrames(2);
  instance.module.yjsManager.stopCapturing();

  return instance;
};

/** `id^parent` for every block, in flat order. */
const flat = (instance: TestEditor): string[] =>
  instance.module.blockManager.blocks.map(block => `${block.id}^${block.parentId ?? '-'}`);

/** Saved `id^parent`; the save itself asserts tree placement. */
const saved = async (instance: TestEditor): Promise<string[]> => {
  const output = await instance.save();

  return output.blocks.map(block => `${block.id ?? '?'}^${block.parent ?? '-'}`);
};

const contentOf = (instance: TestEditor, id: string): string[] =>
  instance.module.blockManager.blocks.find(block => block.id === id)?.contentIds ?? [];

const undoOnce = async (instance: TestEditor): Promise<void> => {
  instance.module.yjsManager.stopCapturing();
  instance.history.undo();
  await nextFrames(3);
};

const events = (instance: TestEditor): BlockMutationEvent[] => {
  const seen: BlockMutationEvent[] = [];
  const dispatcher = (instance.module.blockManager as unknown as { eventsDispatcher: Dispatcher }).eventsDispatcher;

  dispatcher.on(BlockChanged, ({ event }) => {
    seen.push(event);
  });

  return seen;
};

describe('blocks.insertAt / blocks.moveTo', () => {
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

  describe('insertAt', () => {
    const cases: Array<{ name: string; parentId?: string | null; position?: BlockPosition; expected: string[] }> = [
      { name: 'defaults to the root end', expected: [...INITIAL, 'n^-'] },
      { name: 'root start', parentId: null, position: 'start', expected: ['n^-', ...INITIAL] },
      { name: 'root end is after the toggle subtree', parentId: null, position: 'end', expected: [...INITIAL, 'n^-'] },
      { name: 'toggle start', parentId: 't', position: 'start', expected: ['a^-', 't^-', 'n^t', 'c1^t', 'c2^t', 'b^-'] },
      { name: 'toggle end', parentId: 't', position: 'end', expected: ['a^-', 't^-', 'c1^t', 'c2^t', 'n^t', 'b^-'] },
      { name: 'before a child, parent from the ref', position: { before: 'c2' }, expected: ['a^-', 't^-', 'c1^t', 'n^t', 'c2^t', 'b^-'] },
      { name: 'after a child, explicit parent', parentId: 't', position: { after: 'c1' }, expected: ['a^-', 't^-', 'c1^t', 'n^t', 'c2^t', 'b^-'] },
      { name: 'after the last child', position: { after: 'c2' }, expected: ['a^-', 't^-', 'c1^t', 'c2^t', 'n^t', 'b^-'] },
      { name: 'after the toggle skips its subtree', position: { after: 't' }, expected: ['a^-', 't^-', 'c1^t', 'c2^t', 'n^-', 'b^-'] },
      { name: 'before the toggle', parentId: null, position: { before: 't' }, expected: ['a^-', 'n^-', 't^-', 'c1^t', 'c2^t', 'b^-'] },
    ];

    it.each(cases)('$name', async ({ parentId, position, expected }) => {
      const instance = await boot();
      const options = {
        id: 'n',
        ...(parentId !== undefined ? { parentId } : {}),
        ...(position !== undefined ? { position } : {}),
      };

      const block = instance.blocks.insertAt('paragraph', { text: 'n' }, options);

      expect(block.id).toBe('n');
      expect(flat(instance)).toEqual(expected);
      expect(contentOf(instance, 't')).toEqual(expected.filter(entry => entry.endsWith('^t')).map(entry => entry.split('^')[0]));
      expect(await saved(instance)).toEqual(expected);
    }, 30_000);

    it('uses the default tool when type is omitted', async () => {
      const instance = await boot();

      expect(instance.blocks.insertAt(undefined, { text: 'n' }, { parentId: 't' }).name).toBe('paragraph');
    }, 30_000);

    it('does not move the current block unless focus is set', async () => {
      const instance = await boot();

      instance.module.blockManager.currentBlockIndex = 0;
      instance.blocks.insertAt('paragraph', { text: 'n' }, { id: 'n', position: 'start' });

      expect(instance.module.blockManager.blocks[instance.module.blockManager.currentBlockIndex].id).toBe('a');

      instance.blocks.insertAt('paragraph', { text: 'f' }, { id: 'f', parentId: 't', focus: true });

      expect(instance.module.blockManager.blocks[instance.module.blockManager.currentBlockIndex].id).toBe('f');
    }, 30_000);

    it.each([
      { name: 'into a toggle', options: { id: 'n', parentId: 't', position: { after: 'c1' } } },
      { name: 'at the root', options: { id: 'n', position: { after: 't' } } },
    ])('is one undo step: $name', async ({ options }) => {
      const instance = await boot();

      instance.blocks.insertAt('paragraph', { text: 'n' }, options);
      await undoOnce(instance);

      expect(await saved(instance)).toEqual(INITIAL);
    }, 30_000);

    it('replace takes the replaced block\'s slot and parent', async () => {
      const instance = await boot();

      const block = instance.blocks.insertAt('paragraph', { text: 'n' }, { id: 'n', replace: 'c1' });

      expect(block.id).toBe('n');
      expect(await saved(instance)).toEqual(['a^-', 't^-', 'n^t', 'c2^t', 'b^-']);
    }, 30_000);

    it.each([
      { name: 'an unknown parent', options: { parentId: 'nope' }, message: /parent block "nope" not found/ },
      { name: 'an unknown ref', options: { position: { after: 'nope' } }, message: /block "nope" not found/ },
      { name: 'a ref that is not a child of parentId', options: { parentId: null, position: { after: 'c1' } }, message: /"c1" is not a child of the root/ },
      { name: 'a ref that is not a child of a parent', options: { parentId: 't', position: { before: 'a' } }, message: /"a" is not a child of "t"/ },
      { name: 'an unknown replace target', options: { replace: 'nope' }, message: /block "nope" not found/ },
      { name: 'replace with a position', options: { replace: 'c1', position: 'end' as const }, message: /replace cannot be combined/ },
    ])('throws on $name and inserts nothing', async ({ options, message }) => {
      const instance = await boot();

      expect(() => instance.blocks.insertAt('paragraph', { text: 'n' }, options)).toThrow(message);
      expect(flat(instance)).toEqual(INITIAL);
    }, 30_000);

    it.each([
      { name: 'the root end of a document ending in a table', position: 'end' as const },
      { name: 'right after a table', position: { after: 'tbl' } },
    ])('keeps a header a header at $name', async ({ position }) => {
      const instance = await boot([P('a'), table('tbl')]);

      const block = instance.blocks.insertAt('header', { text: 'h', level: 2 }, { id: 'h', position });

      expect(block.name).toBe('header');
      expect(block.parentId).toBeNull();
      expect(roots(instance)).toEqual(['a', 'tbl', 'h']);
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    /** Every block-added that names a placement names the block's final one. */
    const placementsAreTrue = (instance: TestEditor, seen: BlockMutationEvent[]): Array<{ id: string; said: unknown; is: unknown }> =>
      seen
        .filter(event => event.type === 'block-added' && 'parentId' in event.detail)
        .map(event => ({
          id: event.detail.target.id,
          said: pick({ ...event.detail }),
          is: pickActual(instance, event.detail.target.id),
        }))
        .filter(entry => JSON.stringify(entry.said) !== JSON.stringify(entry.is));

    it('reports the real parent for a split (Enter) inside a toggle', async () => {
      const instance = await boot();
      const seen = events(instance);

      instance.blocks.splitBlock('c1', { text: 'c' }, 'paragraph', { text: '1' }, 3);

      const added = seen.filter(event => event.type === 'block-added').at(-1);

      expect(pick({ ...added?.detail })).toEqual({ parentId: 't', previousSiblingId: 'c1' });
      expect(placementsAreTrue(instance, seen)).toEqual([]);
    }, 30_000);

    it('reports the real parent for an index insert that infers its parent', async () => {
      const instance = await boot();
      const seen = events(instance);

      instance.blocks.insert('paragraph', { text: 'n' }, {}, 3);

      expect(pick({ ...seen.filter(event => event.type === 'block-added').at(-1)?.detail })).toEqual({ parentId: 't', previousSiblingId: 'c1' });
      expect(placementsAreTrue(instance, seen)).toEqual([]);
    }, 30_000);

    it('reports the real parent for insertMany', async () => {
      const instance = await boot();
      const seen = events(instance);

      instance.blocks.insertMany([{ id: 'm', type: 'paragraph', data: { text: 'm' } }]);

      expect(pick({ ...seen.filter(event => event.type === 'block-added').at(-1)?.detail })).toEqual({ parentId: null, previousSiblingId: 'b' });
      expect(placementsAreTrue(instance, seen)).toEqual([]);
    }, 30_000);

    it('never reports a wrong parent for a paste into a toggle child', async () => {
      const instance = await boot();
      const seen = events(instance);

      instance.module.blockManager.currentBlockIndex = 2;
      await instance.module.paste.processText('<p>one</p><p>two</p>', true);
      await nextFrames(2);

      expect(seen.some(event => event.type === 'block-added')).toBe(true);
      expect(placementsAreTrue(instance, seen)).toEqual([]);
    }, 30_000);

    it('reports parentId and previousSiblingId on block-added', async () => {
      const instance = await boot();
      const seen = events(instance);

      instance.blocks.insertAt('paragraph', { text: 'n' }, { id: 'n', parentId: 't', position: { after: 'c1' } });
      instance.blocks.insertAt('paragraph', { text: 'm' }, { id: 'm', parentId: 't', position: 'start' });
      instance.blocks.insertAt('paragraph', { text: 'r' }, { id: 'r', position: { after: 't' } });

      const added = seen
        .filter(event => event.type === 'block-added')
        .map(event => ({ id: event.detail.target.id, ...pick({ ...event.detail }) }));

      expect(added).toEqual([
        { id: 'n', parentId: 't', previousSiblingId: 'c1' },
        { id: 'm', parentId: 't', previousSiblingId: null },
        { id: 'r', parentId: null, previousSiblingId: 't' },
      ]);
    }, 30_000);
  });

  describe('moveTo', () => {
    const cases: Array<{ name: string; id: string; parentId?: string | null; position: BlockPosition; expected: string[] }> = [
      { name: 'a root leaf into a toggle, after a child', id: 'a', position: { after: 'c1' }, expected: ['t^-', 'c1^t', 'a^t', 'c2^t', 'b^-'] },
      { name: 'a root leaf to the toggle start', id: 'b', parentId: 't', position: 'start', expected: ['a^-', 't^-', 'b^t', 'c1^t', 'c2^t'] },
      { name: 'a root leaf to the toggle end', id: 'a', parentId: 't', position: 'end', expected: ['t^-', 'c1^t', 'c2^t', 'a^t', 'b^-'] },
      { name: 'a child out to after the toggle', id: 'c1', position: { after: 't' }, expected: ['a^-', 't^-', 'c2^t', 'c1^-', 'b^-'] },
      { name: 'the last child out to after the toggle', id: 'c2', position: { after: 't' }, expected: ['a^-', 't^-', 'c1^t', 'c2^-', 'b^-'] },
      { name: 'a child to the root start', id: 'c2', parentId: null, position: 'start', expected: ['c2^-', 'a^-', 't^-', 'c1^t', 'b^-'] },
      { name: 'a child to the root end', id: 'c1', parentId: null, position: 'end', expected: ['a^-', 't^-', 'c2^t', 'b^-', 'c1^-'] },
      { name: 'a reorder inside the toggle', id: 'c2', position: { before: 'c1' }, expected: ['a^-', 't^-', 'c2^t', 'c1^t', 'b^-'] },
      { name: 'the toggle with children forward', id: 't', position: { after: 'b' }, expected: ['a^-', 'b^-', 't^-', 'c1^t', 'c2^t'] },
      { name: 'the toggle with children backward', id: 't', position: { before: 'a' }, expected: ['t^-', 'c1^t', 'c2^t', 'a^-', 'b^-'] },
      { name: 'a root leaf backward', id: 'b', position: { before: 't' }, expected: ['a^-', 'b^-', 't^-', 'c1^t', 'c2^t'] },
      { name: 'a root leaf forward past the toggle', id: 'a', position: { after: 't' }, expected: ['t^-', 'c1^t', 'c2^t', 'a^-', 'b^-'] },
      { name: 'to where it already is', id: 'c1', position: { before: 'c2' }, expected: INITIAL },
    ];

    it.each(cases)('$name', async ({ id, parentId, position, expected }) => {
      const instance = await boot();

      instance.blocks.moveTo(id, { position, ...(parentId !== undefined ? { parentId } : {}) });

      expect(flat(instance)).toEqual(expected);
      expect(contentOf(instance, 't')).toEqual(expected.filter(entry => entry.endsWith('^t')).map(entry => entry.split('^')[0]));
      expect(await saved(instance)).toEqual(expected);
    }, 30_000);

    it.each(cases.filter(({ expected }) => expected !== INITIAL))('is one undo step and redoes: $name', async ({ id, parentId, position, expected }) => {
      const instance = await boot();

      instance.blocks.moveTo(id, { position, ...(parentId !== undefined ? { parentId } : {}) });
      await undoOnce(instance);

      expect(await saved(instance)).toEqual(INITIAL);

      instance.history.redo();
      await nextFrames(3);

      expect(await saved(instance)).toEqual(expected);
    }, 30_000);

    it('moves a toggle with children into another toggle', async () => {
      const instance = await boot([...doc(), T('u', ['d1']), P('d1', 'u')]);

      instance.blocks.moveTo('t', { parentId: 'u', position: 'end' });

      const expected = ['a^-', 'b^-', 'u^-', 'd1^u', 't^u', 'c1^t', 'c2^t'];

      expect(flat(instance)).toEqual(expected);
      expect(await saved(instance)).toEqual(expected);
    }, 30_000);

    it('carries the children of a parent without a child slot', async () => {
      const instance = await boot([P('x', undefined, ['x1']), P('x1', 'x'), P('y'), P('z')]);

      instance.blocks.moveTo('x', { position: { after: 'z' } });

      const expected = ['y^-', 'z^-', 'x^-', 'x1^x'];

      expect(flat(instance)).toEqual(expected);
      expect(await saved(instance)).toEqual(expected);

      await undoOnce(instance);

      expect(await saved(instance)).toEqual(['x^-', 'x1^x', 'y^-', 'z^-']);
    }, 30_000);

    it.each([
      { name: 'an unknown block', id: 'nope', target: { position: 'end' as const }, message: /block "nope" not found/ },
      { name: 'an unknown ref', id: 'a', target: { position: { after: 'nope' } }, message: /block "nope" not found/ },
      { name: 'an unknown parent', id: 'a', target: { parentId: 'nope', position: 'end' as const }, message: /parent block "nope" not found/ },
      { name: 'the block itself as the ref', id: 'a', target: { position: { after: 'a' } }, message: /relative to itself/ },
      { name: 'a ref inside its own subtree', id: 't', target: { position: { after: 'c1' } }, message: /inside its own subtree/ },
      { name: 'itself as the parent', id: 't', target: { parentId: 't', position: 'end' as const }, message: /inside its own subtree/ },
      { name: 'a ref that is not a child of parentId', id: 'a', target: { parentId: 't', position: { after: 'b' } }, message: /"b" is not a child of "t"/ },
    ])('throws on $name and moves nothing', async ({ id, target, message }) => {
      const instance = await boot();

      expect(() => instance.blocks.moveTo(id, target)).toThrow(message);
      expect(flat(instance)).toEqual(INITIAL);
    }, 30_000);

    it('throws when the parent does not allow the tool', async () => {
      const instance = await boot([...doc(), { id: 'o', type: 'only', data: {} }]);

      expect(() => instance.blocks.moveTo('t', { parentId: 'o', position: 'end' })).toThrow(/does not allow "toggle"/);
      expect(flat(instance)).toEqual([...INITIAL, 'o^-']);
    }, 30_000);

    it('throws when the parent owns its children', async () => {
      const instance = await boot([...doc(), { id: 'w', type: 'owner', data: {} }]);

      expect(() => instance.blocks.moveTo('a', { parentId: 'w', position: 'end' })).toThrow(/owns its children/);
      expect(flat(instance)).toEqual([...INITIAL, 'w^-']);
    }, 30_000);

    // BlockManager.move refuses a header whose pre-removal neighbour is a cell
    // block, even for the slot right after the table. moveTo throws on it.
    it.fails('blocks.move puts a header right after a table', async () => {
      const instance = await boot([H('h'), P('a'), table('tbl'), P('z')]);
      const beforeZ = (instance.blocks.getBlockIndex('z') ?? 0) - 1;

      instance.blocks.move(beforeZ, 0);

      expect(roots(instance)).toEqual(['a', 'tbl', 'h', 'z']);
    }, 30_000);

    it('throws instead of silently not moving a header to right after a table', async () => {
      const instance = await boot([H('h'), P('a'), table('tbl'), P('z')]);

      expect(() => instance.blocks.moveTo('h', { position: { after: 'tbl' } })).toThrow(/next to a table cell block/);
      expect(roots(instance)).toEqual(['h', 'a', 'tbl', 'z']);
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    it('moves a paragraph to right after a table', async () => {
      const instance = await boot([P('p'), P('a'), table('tbl'), P('z')]);

      instance.blocks.moveTo('p', { position: { after: 'tbl' } });

      expect(roots(instance)).toEqual(['a', 'tbl', 'p', 'z']);
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    const columns = (): OutputBlockData[] => [
      { id: 'cl', type: 'column_list', data: {}, content: ['k1', 'k2'] },
      { id: 'k1', type: 'column', data: {}, parent: 'cl', content: ['x1'] },
      P('x1', 'k1'),
      { id: 'k2', type: 'column', data: {}, parent: 'cl', content: ['y1'] },
      P('y1', 'k2'),
      P('r'),
    ];
    const COLUMNS = ['cl^-', 'k1^cl', 'x1^k1', 'k2^cl', 'y1^k2', 'r^-'];

    // Column membership belongs to the drag UI, as with blocks.move.
    it.each([
      { name: 'a root block into a column', id: 'r', target: { parentId: 'k2', position: 'start' as const } },
      { name: 'the last child out of a column', id: 'x1', target: { position: { after: 'cl' } } },
      { name: 'a column out of its column_list', id: 'k1', target: { parentId: null, position: 'end' as const } },
      { name: 'a child from one column to another', id: 'x1', target: { parentId: 'k2', position: 'end' as const } },
    ])('throws and changes nothing when moving $name', async ({ id, target }) => {
      const instance = await boot(columns());

      expect(thrownName(() => instance.blocks.moveTo(id, target))).toBe('BlockPlacementError');
      await nextFrames(2);
      expect(flat(instance)).toEqual(COLUMNS);
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    it('reorders inside a column', async () => {
      const instance = await boot([
        { id: 'cl', type: 'column_list', data: {}, content: ['k1', 'k2'] },
        { id: 'k1', type: 'column', data: {}, parent: 'cl', content: ['x1', 'x2'] },
        P('x1', 'k1'),
        P('x2', 'k1'),
        { id: 'k2', type: 'column', data: {}, parent: 'cl', content: ['y1'] },
        P('y1', 'k2'),
        P('r'),
      ]);

      expect(flat(instance)).toEqual(['cl^-', 'k1^cl', 'x1^k1', 'x2^k1', 'k2^cl', 'y1^k2', 'r^-']);

      instance.blocks.moveTo('x2', { position: { before: 'x1' } });

      expect(flat(instance)).toEqual(['cl^-', 'k1^cl', 'x2^k1', 'x1^k1', 'k2^cl', 'y1^k2', 'r^-']);
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    it.each([
      { name: 'to the root', target: { parentId: null, position: 'end' as const } },
      { name: 'into a toggle outside the table', target: { parentId: 't', position: 'end' as const } },
    ])('throws and changes nothing when moving a table cell block $name', async ({ target }) => {
      const instance = await boot([...doc(), table('tbl')]);
      const before = flat(instance);
      const cellBlock = instance.module.blockManager.blocks.find(block => block.parentId === 'tbl');

      expect(cellBlock).toBeDefined();
      expect(thrownName(() => instance.blocks.moveTo(cellBlock?.id ?? '', target))).toBe('BlockPlacementError');
      expect(flat(instance)).toEqual(before);
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    it('throws and changes nothing when moving a root block into a table cell', async () => {
      const instance = await boot([...doc(), table('tbl')]);
      const before = flat(instance);
      const cellBlock = instance.module.blockManager.blocks.find(block => block.parentId === 'tbl');

      expect(thrownName(() => instance.blocks.moveTo('a', { position: { before: cellBlock?.id ?? '' } }))).toBe('BlockPlacementError');
      expect(flat(instance)).toEqual(before);
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    it('throws when moving a block straight into a column_list', async () => {
      const instance = await boot([
        { id: 'cl', type: 'column_list', data: {}, content: ['k1'] },
        { id: 'k1', type: 'column', data: {}, parent: 'cl', content: ['x1'] },
        P('x1', 'k1'),
        P('r'),
      ]);

      expect(() => instance.blocks.moveTo('r', { parentId: 'cl', position: 'end' })).toThrow(/owns its children/);
    }, 30_000);

    it('reports parentId, oldParentId and previousSiblingId on block-moved', async () => {
      const instance = await boot();
      const seen = events(instance);

      instance.blocks.moveTo('a', { position: { after: 'c1' } });

      const moved = seen.filter(event => event.type === 'block-moved');

      // No event may report a placement the block does not have yet.
      expect(moved.map(event => ({ id: event.detail.target.id, ...pickMoved({ ...event.detail }) }))).toEqual([
        ...moved.slice(0, -1).map(event => ({ id: event.detail.target.id, parentId: undefined, oldParentId: undefined, previousSiblingId: undefined })),
        { id: 'a', parentId: 't', oldParentId: null, previousSiblingId: 'c1' },
      ]);

    }, 30_000);

    it('reports the placement of a same-parent moveTo', async () => {
      const instance = await boot();
      const seen = events(instance);

      instance.blocks.moveTo('c2', { position: { before: 'c1' } });

      const last = seen.filter(event => event.type === 'block-moved').at(-1);

      expect(last?.detail.target.id).toBe('c2');
      expect(pickMoved({ ...last?.detail })).toEqual({ parentId: 't', oldParentId: 't', previousSiblingId: null });
    }, 30_000);

    it('reports the placement of a plain blocks.move', async () => {
      const instance = await boot();
      const seen = events(instance);

      instance.blocks.move(2, 3);

      const last = seen.filter(event => event.type === 'block-moved').at(-1);

      expect(last?.detail.target.id).toBe('c2');
      expect(pickMoved({ ...last?.detail })).toEqual({ parentId: 't', oldParentId: 't', previousSiblingId: null });

      instance.blocks.move(3, 0);

      expect(pickMoved({ ...seen.filter(event => event.type === 'block-moved').at(-1)?.detail })).toEqual({ parentId: 't', oldParentId: null, previousSiblingId: 'c1' });
    }, 30_000);
  });
});

/** The placement fields of a block-added detail. */
const pick = (detail: Record<string, unknown>): { parentId?: unknown; previousSiblingId?: unknown } => {
  return { parentId: detail.parentId, previousSiblingId: detail.previousSiblingId };
};

/** A block's actual parent and previous sibling, as block-added reports them. */
const pickActual = (instance: TestEditor, id: string): { parentId: unknown; previousSiblingId: unknown } => {
  const blocks = instance.module.blockManager.blocks;
  const block = blocks.find(candidate => candidate.id === id);
  const parentId = block?.parentId ?? null;
  const siblings = blocks.filter(candidate => candidate.parentId === parentId).map(candidate => candidate.id);
  const at = siblings.indexOf(id);

  return { parentId, previousSiblingId: at > 0 ? siblings[at - 1] : null };
};

/** The placement fields of a block-moved detail. */
const pickMoved = (detail: Record<string, unknown>): { parentId?: unknown; oldParentId?: unknown; previousSiblingId?: unknown } => {
  return { parentId: detail.parentId, oldParentId: detail.oldParentId, previousSiblingId: detail.previousSiblingId };
};
