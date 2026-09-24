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
import type { API, BlockMutationEvent, BlockPosition, OutputBlockData, OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
  module: {
    blockManager: { blocks: Block[]; currentBlockIndex: number };
    yjsManager: { stopCapturing: () => void };
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

const boot = async (blocks: OutputBlockData[] = doc()): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, toggle: ToggleItem, only: ParagraphsOnly, owner: Owner },
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

    it('reports parentId, oldParentId and previousSiblingId on block-moved', async () => {
      const instance = await boot();
      const seen = events(instance);

      instance.blocks.moveTo('a', { position: { after: 'c1' } });

      const last = seen.filter(event => event.type === 'block-moved').at(-1);

      expect(last?.detail.target.id).toBe('a');
      expect(last === undefined ? undefined : pickMoved({ ...last.detail })).toEqual({ parentId: 't', oldParentId: null, previousSiblingId: 'c1' });
    }, 30_000);
  });
});

/** The placement fields of a block-added detail. */
const pick = (detail: Record<string, unknown>): { parentId?: unknown; previousSiblingId?: unknown } => {
  return { parentId: detail.parentId, previousSiblingId: detail.previousSiblingId };
};

/** The placement fields of a block-moved detail. */
const pickMoved = (detail: Record<string, unknown>): { parentId?: unknown; oldParentId?: unknown; previousSiblingId?: unknown } => {
  return { parentId: detail.parentId, oldParentId: detail.oldParentId, previousSiblingId: detail.previousSiblingId };
};
