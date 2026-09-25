/**
 * The adapters' shared `useBlocks` engine against a REAL editor: every
 * sibling-relative insert and move must land the block in the named slot and
 * parent, keep the flat array depth-first, and keep holders in their home slot.
 * The save gate (`Saver.assertTreePlacement`) throws under NODE_ENV=test, so a
 * resolving `save()` is the placement check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import type { Block } from '../../../../src/components/block';
import { Paragraph } from '../../../../src/tools/paragraph';
import { ToggleItem } from '../../../../src/tools/toggle';
import { createBlocksApiForEditor } from '../../../../src/components/utils/blocks-api';
import type { UseBlocksApi } from '../../../../src/components/utils/blocks-tree';
import type { API, Blok as BlokType, OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
  module: {
    blockManager: { blocks: Block[] };
    yjsManager: { stopCapturing: () => void; toJSON: () => OutputBlockData[] };
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

/** a, T{c1, c2}, b */
const doc = (): OutputBlockData[] => [
  P('a'),
  T('t', ['c1', 'c2']),
  P('c1', 't'),
  P('c2', 't'),
  P('b'),
];

const boot = async (blocks: OutputBlockData[] = doc()): Promise<{ instance: TestEditor; api: UseBlocksApi }> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, toggle: ToggleItem },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();
  await nextFrames(2);
  instance.module.yjsManager.stopCapturing();

  return { instance, api: createBlocksApiForEditor(instance as unknown as BlokType) };
};

/** `id^parent` for every block, in flat order. */
const flat = (instance: TestEditor): string[] =>
  instance.module.blockManager.blocks.map(block => `${block.id}^${block.parentId ?? '-'}`);

/** Saved `id^parent` in saved order; the save itself asserts tree placement. */
const saved = async (instance: TestEditor): Promise<string[]> => {
  const output = await instance.save();

  return output.blocks.map(block => `${block.id ?? '?'}^${block.parent ?? '-'}`);
};

const contentOf = (instance: TestEditor, id: string): string[] =>
  instance.module.blockManager.blocks.find(block => block.id === id)?.contentIds ?? [];

const INITIAL = ['a^-', 't^-', 'c1^t', 'c2^t', 'b^-'];

describe('useBlocks engine: sibling-relative placement on a real editor', () => {
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

  describe('insert', () => {
    const cases: Array<{ name: string; spec: Parameters<UseBlocksApi['insert']>[0]; expected: string[]; tContent: string[] }> = [
      { name: 'root start', spec: { id: 'n', data: { text: 'n' }, position: 'start' }, expected: ['n^-', ...INITIAL], tContent: ['c1', 'c2'] },
      { name: 'root end (after the toggle subtree, not in it)', spec: { id: 'n', data: { text: 'n' }, position: 'end' }, expected: [...INITIAL, 'n^-'], tContent: ['c1', 'c2'] },
      { name: 'toggle start', spec: { id: 'n', data: { text: 'n' }, parentId: 't', position: 'start' }, expected: ['a^-', 't^-', 'n^t', 'c1^t', 'c2^t', 'b^-'], tContent: ['n', 'c1', 'c2'] },
      { name: 'toggle end', spec: { id: 'n', data: { text: 'n' }, parentId: 't', position: 'end' }, expected: ['a^-', 't^-', 'c1^t', 'c2^t', 'n^t', 'b^-'], tContent: ['c1', 'c2', 'n'] },
      { name: 'before a toggle child', spec: { id: 'n', data: { text: 'n' }, parentId: 't', position: { before: 'c2' } }, expected: ['a^-', 't^-', 'c1^t', 'n^t', 'c2^t', 'b^-'], tContent: ['c1', 'n', 'c2'] },
      { name: 'after a toggle child', spec: { id: 'n', data: { text: 'n' }, parentId: 't', position: { after: 'c1' } }, expected: ['a^-', 't^-', 'c1^t', 'n^t', 'c2^t', 'b^-'], tContent: ['c1', 'n', 'c2'] },
      { name: 'after the last toggle child', spec: { id: 'n', data: { text: 'n' }, parentId: 't', position: { after: 'c2' } }, expected: ['a^-', 't^-', 'c1^t', 'c2^t', 'n^t', 'b^-'], tContent: ['c1', 'c2', 'n'] },
      { name: 'after the toggle at root (skips its subtree)', spec: { id: 'n', data: { text: 'n' }, position: { after: 't' } }, expected: ['a^-', 't^-', 'c1^t', 'c2^t', 'n^-', 'b^-'], tContent: ['c1', 'c2'] },
      { name: 'before the toggle at root', spec: { id: 'n', data: { text: 'n' }, position: { before: 't' } }, expected: ['a^-', 'n^-', 't^-', 'c1^t', 'c2^t', 'b^-'], tContent: ['c1', 'c2'] },
      { name: 'before a root block after the toggle', spec: { id: 'n', data: { text: 'n' }, position: { before: 'b' } }, expected: ['a^-', 't^-', 'c1^t', 'c2^t', 'n^-', 'b^-'], tContent: ['c1', 'c2'] },
    ];

    it.each(cases)('$name', async ({ spec, expected, tContent }) => {
      const { instance, api } = await boot();

      expect(api.insert(spec)?.id).toBe('n');
      expect(flat(instance)).toEqual(expected);
      expect(contentOf(instance, 't')).toEqual(tContent);
      expect(await saved(instance)).toEqual(expected);
    }, 30_000);

    it('is one undo step', async () => {
      const { instance, api } = await boot();

      api.insert({ id: 'n', data: { text: 'n' }, parentId: 't', position: { after: 'c1' } });
      instance.module.yjsManager.stopCapturing();
      instance.history.undo();
      await nextFrames(3);

      expect(await saved(instance)).toEqual(INITIAL);
    }, 30_000);
  });

  describe('move', () => {
    const cases: Array<{ name: string; id: string; target: Parameters<UseBlocksApi['move']>[1]; expected: string[] }> = [
      { name: 'root leaf into a toggle, after a child', id: 'a', target: { after: 'c1' }, expected: ['t^-', 'c1^t', 'a^t', 'c2^t', 'b^-'] },
      { name: 'root leaf into a toggle, before the first child', id: 'b', target: { before: 'c1' }, expected: ['a^-', 't^-', 'b^t', 'c1^t', 'c2^t'] },
      { name: 'toggle child out to root, after the toggle', id: 'c1', target: { after: 't' }, expected: ['a^-', 't^-', 'c2^t', 'c1^-', 'b^-'] },
      { name: 'toggle child out to root, before the first block', id: 'c2', target: { before: 'a' }, expected: ['c2^-', 'a^-', 't^-', 'c1^t', 'b^-'] },
      { name: 'reorder inside the toggle', id: 'c2', target: { before: 'c1' }, expected: ['a^-', 't^-', 'c2^t', 'c1^t', 'b^-'] },
      { name: 'toggle with children forward, after a root block', id: 't', target: { after: 'b' }, expected: ['a^-', 'b^-', 't^-', 'c1^t', 'c2^t'] },
      { name: 'toggle with children backward, before a root block', id: 't', target: { before: 'a' }, expected: ['t^-', 'c1^t', 'c2^t', 'a^-', 'b^-'] },
      { name: 'root leaf backward before the toggle', id: 'b', target: { before: 't' }, expected: ['a^-', 'b^-', 't^-', 'c1^t', 'c2^t'] },
      { name: 'root leaf forward after the toggle', id: 'a', target: { after: 't' }, expected: ['t^-', 'c1^t', 'c2^t', 'a^-', 'b^-'] },
    ];

    it.each(cases)('$name', async ({ id, target, expected }) => {
      const { instance, api } = await boot();

      api.move(id, target);

      expect(flat(instance)).toEqual(expected);
      expect(await saved(instance)).toEqual(expected);
    }, 30_000);

    it('a toggle with children into another toggle', async () => {
      const { instance, api } = await boot([...doc(), T('u', ['d1']), P('d1', 'u')]);

      api.move('t', { after: 'd1' });

      const expected = ['a^-', 'b^-', 'u^-', 'd1^u', 't^u', 'c1^t', 'c2^t'];

      expect(flat(instance)).toEqual(expected);
      expect(await saved(instance)).toEqual(expected);
    }, 30_000);

    const undoCases: Array<{ name: string; id: string; target: Parameters<UseBlocksApi['move']>[1] }> = [
      { name: 'a toggle with children', id: 't', target: { after: 'b' } },
      { name: 'a leaf to after a toggle', id: 'a', target: { after: 't' } },
      { name: 'a toggle child out to root', id: 'c1', target: { after: 't' } },
      { name: 'a leaf into a toggle', id: 'a', target: { after: 'c1' } },
      { name: 'a leaf reordered at root', id: 'b', target: { before: 't' } },
    ];

    it.each(undoCases)('is one undo step: $name', async ({ id, target }) => {
      const { instance, api } = await boot();

      api.move(id, target);
      instance.module.yjsManager.stopCapturing();
      instance.history.undo();
      await nextFrames(3);

      expect(await saved(instance)).toEqual(INITIAL);
    }, 30_000);
  });

  describe('nest / unnest', () => {
    it('nest a root leaf under the toggle', async () => {
      const { instance, api } = await boot();

      api.nest('b', 't');

      const expected = ['a^-', 't^-', 'c1^t', 'c2^t', 'b^t'];

      expect(flat(instance)).toEqual(expected);
      expect(await saved(instance)).toEqual(expected);
    }, 30_000);

    it('unnest the first toggle child', async () => {
      const { instance, api } = await boot();

      api.unnest('c1');

      const expected = ['a^-', 't^-', 'c2^t', 'c1^-', 'b^-'];

      expect(flat(instance)).toEqual(expected);
      expect(await saved(instance)).toEqual(expected);
    }, 30_000);
  });
  /**
   * Batch inserts go through core insertMany, which used to drop a parent
   * outside the batch and land the blocks at the root.
   */
  describe('batch inserts under an existing parent', () => {
    /** Doc `id^parent` in doc order, compared with save() order. */
    const docShape = (instance: TestEditor): string[] =>
      instance.module.yjsManager.toJSON().map(block => `${block.id ?? '?'}^${block.parent ?? '-'}`);

    it('insertTree lands the subtree under the parent', async () => {
      const { instance, api } = await boot();

      api.insertTree({ id: 'n', type: 'toggle', data: { text: 'n', isOpen: true }, parentId: 't', children: [{ id: 'm', data: { text: 'm' } }] });
      await settle();

      const expected = ['a^-', 't^-', 'c1^t', 'c2^t', 'n^t', 'm^n', 'b^-'];

      expect(await saved(instance)).toEqual(expected);
      expect(contentOf(instance, 't')).toEqual(['c1', 'c2', 'n']);
      expect(docShape(instance)).toEqual(expected);
    }, 30_000);

    it('insertMarkdown lands the converted blocks under the parent', async () => {
      const { instance, api } = await boot();

      const created = await api.insertMarkdown('one\n\ntwo', { parentId: 't' });

      await settle();

      const ids = created.map(node => node.id);

      expect(ids).toHaveLength(2);

      const expected = ['a^-', 't^-', 'c1^t', 'c2^t', `${ids[0]}^t`, `${ids[1]}^t`, 'b^-'];

      expect(await saved(instance)).toEqual(expected);
      expect(docShape(instance)).toEqual(expected);
    }, 30_000);

    it('insertOutputData keeps a parent that is already in the document', async () => {
      const { instance, api } = await boot();

      api.insertOutputData([P('q', 't')], { index: 4 });
      await settle();

      const expected = ['a^-', 't^-', 'c1^t', 'c2^t', 'q^t', 'b^-'];

      expect(await saved(instance)).toEqual(expected);
      expect(docShape(instance)).toEqual(expected);
    }, 30_000);
  });
});
