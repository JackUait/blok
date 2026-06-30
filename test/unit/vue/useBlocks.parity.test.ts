import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h, type Ref, ref } from 'vue';
import { mount } from '@vue/test-utils';

import { useBlocks } from '../../../src/vue/useBlocks';
import type { UseBlocksApi } from '../../../src/vue/blocks-snapshot';
import type { Blok } from '../../../types';

/**
 * Every method the SHARED UseBlocksApi core exposes — the React surface. The Vue
 * adapter must wire all of them (parity is the whole point of the shared core),
 * so this list is the contract the wrapper is checked against.
 */
const ALL_METHODS = [
  'getById',
  'getChildren',
  'insert',
  'insertMany',
  'insertTree',
  'insertMarkdown',
  'move',
  'nest',
  'unnest',
  'remove',
  'update',
  'convert',
  'transact',
  'transactWithoutCapture',
  'getBlocksCount',
  'getCurrentBlockIndex',
  'getBlockByIndex',
  'getBlockByElement',
  'getBlockData',
  'getBlockIndex',
  'composeBlockData',
  'renderFromHTML',
  'insertOutputData',
  'splitBlock',
  'insertInsideParent',
  'render',
  'clear',
  'isSyncingFromYjs',
] as const;

type FakeRecord = { id: string; name: string; parentId: string | null };

interface FakeEditor {
  editor: Blok;
  flat: FakeRecord[];
  spies: Record<string, ReturnType<typeof vi.fn>>;
}

/**
 * A faithful flat-list fake editor: insert/insertMany/move/delete/setBlockParent
 * actually mutate the list (so subtree-aware behavior is observable), while the
 * pure delegations (update/convert/render/…) are spies returning sensible values.
 */
const makeFakeEditor = (initial: FakeRecord[]): FakeEditor => {
  const flat: FakeRecord[] = [...initial];
  const wrap = (r: FakeRecord): { id: string; name: string; parentId: string | null; preservedData: unknown; preservedTunes: unknown } => ({
    id: r.id,
    name: r.name,
    parentId: r.parentId,
    preservedData: { v: r.id },
    preservedTunes: {},
  });

  let counter = 0;
  const insert = vi.fn(
    (type?: string, _data?: unknown, _config?: unknown, index?: number, _f?: boolean, _r?: boolean, id?: string) => {
      const rec: FakeRecord = { id: id ?? `ins-${counter++}`, name: type ?? 'paragraph', parentId: null };

      flat.splice(typeof index === 'number' ? index : flat.length, 0, rec);

      return wrap(rec);
    }
  );
  const insertMany = vi.fn((blocks: Array<{ id?: string; type?: string; parent?: string | null }>, index?: number) => {
    const created = blocks.map((b) => ({ id: b.id ?? `ins-${counter++}`, name: b.type ?? 'paragraph', parentId: b.parent ?? null }));

    flat.splice(typeof index === 'number' ? index : flat.length, 0, ...created);

    return created.map(wrap);
  });
  const insertInsideParent = vi.fn((parentId: string, insertIndex: number) => {
    const rec: FakeRecord = { id: `child-${counter++}`, name: 'paragraph', parentId };

    flat.splice(insertIndex, 0, rec);

    return wrap(rec);
  });
  const setBlockParent = vi.fn((blockId: string, parentId: string | null) => {
    const rec = flat.find((b) => b.id === blockId);

    if (rec) {
      rec.parentId = parentId;
    }
  });
  const move = vi.fn((toIndex: number, fromIndex: number) => {
    if (fromIndex < 0 || fromIndex >= flat.length || toIndex < 0 || toIndex >= flat.length) {
      return;
    }
    const [rec] = flat.splice(fromIndex, 1);

    flat.splice(toIndex, 0, rec);
  });
  const del = vi.fn((index?: number) => {
    if (typeof index === 'number' && index >= 0 && index < flat.length) {
      flat.splice(index, 1);
    }

    return Promise.resolve();
  });

  const spies = {
    insert,
    insertMany,
    insertInsideParent,
    setBlockParent,
    move,
    delete: del,
    update: vi.fn(() => Promise.resolve(wrap(flat[0]))),
    convert: vi.fn(() => Promise.resolve(wrap(flat[0]))),
    composeBlockData: vi.fn(() => Promise.resolve({ composed: true })),
    render: vi.fn(() => Promise.resolve()),
    renderFromHTML: vi.fn(() => Promise.resolve()),
    clear: vi.fn(() => Promise.resolve()),
    splitBlock: vi.fn((_id: string, _d: unknown, _t: string, _nd: unknown, insertIndex: number) => {
      const rec: FakeRecord = { id: 'split-new', name: 'paragraph', parentId: null };

      flat.splice(insertIndex, 0, rec);

      return wrap(rec);
    }),
    getCurrentBlockIndex: vi.fn(() => 1),
    getBlockByElement: vi.fn(() => wrap(flat[0])),
    transact: vi.fn((fn: () => void) => fn()),
    transactWithoutCapture: vi.fn((fn: () => void) => fn()),
    setToBlock: vi.fn(),
  };

  const blocks = {
    getBlocksCount: (): number => flat.length,
    getBlockByIndex: (i: number) => (flat[i] === undefined ? undefined : wrap(flat[i])),
    getBlockIndex: (id: string) => {
      const idx = flat.findIndex((b) => b.id === id);

      return idx === -1 ? undefined : idx;
    },
    getById: (id: string) => {
      const rec = flat.find((b) => b.id === id);

      return rec === undefined ? null : wrap(rec);
    },
    getChildren: (parentId: string) => flat.filter((b) => b.parentId === parentId).map(wrap),
    isSyncingFromYjs: false,
    ...spies,
  };

  const editor = {
    blocks,
    caret: { setToBlock: spies.setToBlock },
    on: (): void => undefined,
    off: (): void => undefined,
  } as unknown as Blok;

  return { editor, flat, spies };
};

const mountUseBlocks = (editorRef: Ref<Blok | null>): { api: UseBlocksApi; unmount: () => void } => {
  let apiRef: UseBlocksApi;
  const Harness = defineComponent({
    setup() {
      apiRef = useBlocks(editorRef);

      return () => h('div');
    },
  });
  const wrapper = mount(Harness);

  return { api: apiRef!, unmount: () => wrapper.unmount() };
};

describe('useBlocks (Vue) — React parity surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes every method of the shared UseBlocksApi (full 28-method parity)', () => {
    const { editor } = makeFakeEditor([{ id: 'a', name: 'paragraph', parentId: null }]);
    const { api } = mountUseBlocks(ref<Blok | null>(editor));

    for (const method of ALL_METHODS) {
      expect(typeof (api as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });

  it('insertMany delegates through the single-insert path and returns created nodes', () => {
    const { editor, spies } = makeFakeEditor([{ id: 'a', name: 'paragraph', parentId: null }]);
    const { api } = mountUseBlocks(ref<Blok | null>(editor));

    const created = api.insertMany([{ type: 'paragraph' }, { type: 'header' }]);

    expect(spies.insert).toHaveBeenCalledTimes(2);
    expect(created).toHaveLength(2);
  });

  it('insertTree composes a nested subtree via core insertMany', () => {
    const { editor, spies } = makeFakeEditor([{ id: 'a', name: 'paragraph', parentId: null }]);
    const { api } = mountUseBlocks(ref<Blok | null>(editor));

    const root = api.insertTree({ type: 'toggle', children: [{ type: 'paragraph' }, { type: 'paragraph' }] });

    expect(spies.insertMany).toHaveBeenCalledTimes(1);
    // root + 2 children flattened into one DFS pre-order batch.
    expect(spies.insertMany.mock.calls[0][0]).toHaveLength(3);
    expect(root).not.toBeNull();
  });

  it('update and convert delegate to core (own history step, not wrapped in transact)', () => {
    const { editor, spies } = makeFakeEditor([{ id: 'a', name: 'paragraph', parentId: null }]);
    const { api } = mountUseBlocks(ref<Blok | null>(editor));

    api.update('a', { text: 'x' });
    api.convert('a', 'header');

    expect(spies.update).toHaveBeenCalledWith('a', { text: 'x' }, undefined);
    expect(spies.convert).toHaveBeenCalledWith('a', 'header', undefined);
  });

  it('splitBlock and insertInsideParent delegate to core and return the new node', () => {
    const { editor, spies } = makeFakeEditor([{ id: 'p', name: 'toggle', parentId: null }]);
    const { api } = mountUseBlocks(ref<Blok | null>(editor));

    const child = api.insertInsideParent('p', 1, { text: 'c' });

    expect(spies.insertInsideParent).toHaveBeenCalledWith('p', 1, { text: 'c' });
    expect(child).not.toBeNull();

    const split = api.splitBlock('p', { text: 'a' }, 'paragraph', { text: 'b' }, 1);

    expect(spies.splitBlock).toHaveBeenCalled();
    expect(split).not.toBeNull();
  });

  it('getCurrentBlockIndex / getBlockByIndex / getBlockData / isSyncingFromYjs delegate', () => {
    const { editor } = makeFakeEditor([{ id: 'a', name: 'paragraph', parentId: null }]);
    const { api } = mountUseBlocks(ref<Blok | null>(editor));

    expect(api.getCurrentBlockIndex()).toBe(1);
    expect(api.getBlockByIndex(0)?.id).toBe('a');
    expect(api.getBlockData('a')).toEqual({ data: { v: 'a' }, tunes: {} });
    expect(api.isSyncingFromYjs()).toBe(false);
  });

  it('transactWithoutCapture runs the callback through core', () => {
    const { editor, spies } = makeFakeEditor([{ id: 'a', name: 'paragraph', parentId: null }]);
    const { api } = mountUseBlocks(ref<Blok | null>(editor));
    const fn = vi.fn();

    api.transactWithoutCapture(fn);

    expect(spies.transactWithoutCapture).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('remove is subtree-aware: deletes the block AND its descendants deepest-first', () => {
    const fake = makeFakeEditor([
      { id: 'p', name: 'toggle', parentId: null },
      { id: 'c1', name: 'paragraph', parentId: 'p' },
      { id: 'c2', name: 'paragraph', parentId: 'p' },
    ]);
    const { api } = mountUseBlocks(ref<Blok | null>(fake.editor));

    api.remove('p');

    // Old naive remove called delete once and stranded the children; the shared
    // core deletes all three (deepest-first), leaving the document empty.
    expect(fake.spies.delete).toHaveBeenCalledTimes(3);
    expect(fake.flat).toHaveLength(0);
  });

  it('async document primitives (render/clear/renderFromHTML/composeBlockData) delegate', async () => {
    const { editor, spies } = makeFakeEditor([{ id: 'a', name: 'paragraph', parentId: null }]);
    const { api } = mountUseBlocks(ref<Blok | null>(editor));

    await api.render({ blocks: [] } as never);
    await api.clear();
    await api.renderFromHTML('<p>x</p>');
    await api.composeBlockData('paragraph');

    expect(spies.render).toHaveBeenCalledTimes(1);
    expect(spies.clear).toHaveBeenCalledTimes(1);
    expect(spies.renderFromHTML).toHaveBeenCalledWith('<p>x</p>');
    expect(spies.composeBlockData).toHaveBeenCalledWith('paragraph');
  });

  it('insertOutputData inserts a saved fragment via core insertMany', () => {
    const { editor, spies } = makeFakeEditor([{ id: 'a', name: 'paragraph', parentId: null }]);
    const { api } = mountUseBlocks(ref<Blok | null>(editor));

    const created = api.insertOutputData([{ id: 'x', type: 'paragraph', data: {} } as never]);

    expect(spies.insertMany).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
  });
});
