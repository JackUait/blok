import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h, computed, nextTick, type Ref, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

import { useBlocks } from '../../../packages/vue/src/useBlocks';
import type { UseBlocksApi } from '../../../packages/vue/src/blocks-snapshot';
import type { Blok } from '../../../types';
import { fakePlacement } from '../helpers/fake-placement';

/**
 * A record in the fake editor's in-memory FLAT block list. The shape mirrors
 * what core's `blocks.getBlockByIndex` exposes (id/name/parentId), so the shared
 * tree resolvers run against real positions.
 */
type FakeRecord = { id: string; name: string; parentId: string | null };

interface FakeEditor {
  editor: Blok;
  emitChanged: () => void;
  flat: FakeRecord[];
  spies: {
    insertInsideParent: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    setBlockParent: ReturnType<typeof vi.fn>;
    insertAt: ReturnType<typeof vi.fn>;
    moveTo: ReturnType<typeof vi.fn>;
    move: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    transact: ReturnType<typeof vi.fn>;
  };
}

/** Build a fake Blok whose `blocks` API is backed by an editable flat list. */
const makeFakeEditor = (initial: FakeRecord[]): FakeEditor => {
  const flat: FakeRecord[] = [...initial];
  const listeners = new Map<string, Set<(payload?: unknown) => void>>();

  const wrap = (r: FakeRecord): { id: string; name: string; parentId: string | null } => ({
    id: r.id,
    name: r.name,
    parentId: r.parentId,
  });

  const insertInsideParent = vi.fn((parentId: string, insertIndex: number, _data?: unknown) => {
    const rec: FakeRecord = { id: `child-${flat.length}`, name: 'paragraph', parentId };

    flat.splice(insertIndex, 0, rec);

    return wrap(rec);
  });
  const insert = vi.fn((_type?: string, _data?: unknown, _config?: unknown, index?: number) => {
    const rec: FakeRecord = { id: `ins-${flat.length}`, name: 'paragraph', parentId: null };

    flat.splice(typeof index === 'number' ? index : flat.length, 0, rec);

    return wrap(rec);
  });
  const setBlockParent = vi.fn((blockId: string, parentId: string | null) => {
    const rec = flat.find((b) => b.id === blockId);

    if (rec) {
      rec.parentId = parentId;
    }
  });
  const move = vi.fn();
  const del = vi.fn();
  const transact = vi.fn((fn: () => void) => fn());
  const placement = fakePlacement({
    blocks: () => flat,
    insert: (type, data, index) => insert(type, data, {}, index),
    moveFlat: (toIndex, fromIndex) => {
      flat.splice(toIndex, 0, ...flat.splice(fromIndex, 1));
    },
    setParent: (blockId, parentId) => setBlockParent(blockId, parentId),
  });
  const insertAt = vi.fn(placement.insertAt);
  const moveTo = vi.fn(placement.moveTo);

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
    insert,
    insertInsideParent,
    setBlockParent,
    insertAt,
    moveTo,
    move,
    delete: del,
    transact,
  };

  const editor = {
    blocks,
    on: (name: string, handler: (payload?: unknown) => void): void => {
      const set = listeners.get(name) ?? new Set();

      set.add(handler);
      listeners.set(name, set);
    },
    off: (name: string, handler: (payload?: unknown) => void): void => {
      listeners.get(name)?.delete(handler);
    },
  } as unknown as Blok;

  return {
    editor,
    flat,
    emitChanged: (): void => {
      listeners.get('block changed')?.forEach((h) => h());
    },
    spies: { insertInsideParent, insert, setBlockParent, insertAt, moveTo, move, delete: del, transact },
  };
};

/** Mount a component that calls useBlocks and exposes the api + a reactive probe. */
const mountUseBlocks = (
  editorRef: Ref<Blok | null>
): { api: UseBlocksApi; childCount: () => number; unmount: () => void } => {
  let apiRef: UseBlocksApi;
  let childCountRef: () => number;

  const Harness = defineComponent({
    setup() {
      const blocks = useBlocks(editorRef);

      apiRef = blocks;
      // A computed that reads the tree — re-runs only if reads are reactive.
      const rootCount = computed(() => blocks.getChildren(null).length);

      childCountRef = (): number => rootCount.value;

      return () => h('div');
    },
  });

  const wrapper = mount(Harness);

  return { api: apiRef!, childCount: childCountRef!, unmount: () => wrapper.unmount() };
};

describe('useBlocks (Vue)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a stable no-op API while the editor is null', () => {
    const editorRef = ref<Blok | null>(null);
    const { api } = mountUseBlocks(editorRef);

    expect(api.getChildren(null)).toEqual([]);
    expect(api.getById('x')).toBeNull();
    expect(api.getBlocksCount()).toBe(0);
    expect(api.insert()).toBeNull();
  });

  it('reads the block tree by id and parent', () => {
    const { editor } = makeFakeEditor([
      { id: 'p', name: 'toggle', parentId: null },
      { id: 'a', name: 'paragraph', parentId: 'p' },
      { id: 'b', name: 'paragraph', parentId: 'p' },
      { id: 'root2', name: 'paragraph', parentId: null },
    ]);
    const editorRef = ref<Blok | null>(editor);
    const { api } = mountUseBlocks(editorRef);

    expect(api.getChildren(null).map((n) => n.id)).toEqual(['p', 'root2']);
    expect(api.getChildren('p').map((n) => n.id)).toEqual(['a', 'b']);

    const node = api.getById('p');

    expect(node?.type).toBe('toggle');
    expect(node?.contentIds).toEqual(['a', 'b']);
  });

  it('insert under a parent lands at the resolved flat index and re-nests (honoring type)', () => {
    const { editor, spies } = makeFakeEditor([
      { id: 'p', name: 'toggle', parentId: null },
      { id: 'a', name: 'paragraph', parentId: 'p' },
    ]);
    const editorRef = ref<Blok | null>(editor);
    const { api } = mountUseBlocks(editorRef);

    const node = api.insert({ type: 'database-row', data: { rows: 1 }, parentId: 'p', position: 'end' });

    expect(spies.insertAt).toHaveBeenCalledWith('database-row', { rows: 1 }, {
      parentId: 'p',
      position: 'end',
      id: undefined,
      tunes: undefined,
      focus: false,
    });
    expect(node?.parentId).toBe('p');
    expect(api.getChildren('p').map((n) => n.id)).toEqual(['a', node?.id]);
    expect(spies.transact).toHaveBeenCalled();
  });

  it('insert rejects a dangling parentId without touching core', () => {
    const { editor, spies } = makeFakeEditor([{ id: 'p', name: 'toggle', parentId: null }]);
    const editorRef = ref<Blok | null>(editor);
    const { api } = mountUseBlocks(editorRef);

    const result = api.insert({ parentId: 'does-not-exist' });

    expect(result).toBeNull();
    expect(spies.insertAt).not.toHaveBeenCalled();
  });

  it('nest and unnest delegate to moveTo', () => {
    const { editor, spies } = makeFakeEditor([
      { id: 'p', name: 'toggle', parentId: null },
      { id: 'x', name: 'paragraph', parentId: null },
    ]);
    const editorRef = ref<Blok | null>(editor);
    const { api } = mountUseBlocks(editorRef);

    api.nest('x', 'p');
    expect(spies.moveTo).toHaveBeenCalledWith('x', { parentId: 'p', position: 'end' });
    expect(api.getById('x')?.parentId).toBe('p');

    api.unnest('x');
    expect(spies.moveTo).toHaveBeenLastCalledWith('x', { parentId: null, position: { after: 'p' } });
    expect(api.getById('x')?.parentId).toBeNull();
  });

  it('remove resolves the id to a flat index and delegates to delete', () => {
    const { editor, spies } = makeFakeEditor([
      { id: 'a', name: 'paragraph', parentId: null },
      { id: 'b', name: 'paragraph', parentId: null },
    ]);
    const editorRef = ref<Blok | null>(editor);
    const { api } = mountUseBlocks(editorRef);

    api.remove('b');
    // Subtree-aware remove deletes deepest-first with setCaret=false (a
    // programmatic delete must not move the caret).
    expect(spies.delete).toHaveBeenCalledWith(1, false);
  });

  it('transact runs the callback through the editor transact', () => {
    const { editor, spies } = makeFakeEditor([{ id: 'a', name: 'paragraph', parentId: null }]);
    const editorRef = ref<Blok | null>(editor);
    const { api } = mountUseBlocks(editorRef);

    const fn = vi.fn();

    api.transact(fn);
    expect(spies.transact).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reads are reactive: a computed re-runs when the editor emits "block changed"', async () => {
    const fake = makeFakeEditor([{ id: 'r1', name: 'paragraph', parentId: null }]);
    const editorRef = ref<Blok | null>(fake.editor);
    const { childCount } = mountUseBlocks(editorRef);

    expect(childCount()).toBe(1);

    // Mutate the underlying model and notify.
    fake.flat.push({ id: 'r2', name: 'paragraph', parentId: null });
    fake.emitChanged();
    await nextTick();

    expect(childCount()).toBe(2);
  });

  it('passes a toRaw (non-reactive) editor to core handoffs', async () => {
    const fake = makeFakeEditor([{ id: 'a', name: 'paragraph', parentId: null }]);
    // A deeply-reactive ref would proxy-wrap the editor; the composable must
    // unwrap it before reading the blocks API / handing ids to core.
    const editorRef = ref<Blok | null>(fake.editor);
    const { api } = mountUseBlocks(editorRef);

    await flushPromises();
    api.remove('a');

    // delete still reached the real (raw) blocks API on the unwrapped editor.
    expect(fake.spies.delete).toHaveBeenCalledWith(0, false);
  });
});
