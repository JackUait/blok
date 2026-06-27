// test/unit/react/useBlocks.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBlocks } from '../../../src/react/useBlocks';
import type { Blok } from '../../../types';

/** A controllable fake editor exposing only what useBlocks consumes. */
const makeFakeEditor = (
  rows: Array<{ id: string; name?: string; parentId?: string | null }>
) => {
  let list = rows.map((r) => ({ id: r.id, name: r.name ?? 'paragraph', parentId: r.parentId ?? null }));
  const listeners = new Set<() => void>();
  const editor = {
    blocks: {
      getBlocksCount: () => list.length,
      getBlockByIndex: (i: number) => list[i],
      getBlockIndex: (id: string) => {
        const idx = list.findIndex((b) => b.id === id);
        return idx === -1 ? undefined : idx;
      },
      getById: (id: string) => list.find((b) => b.id === id) ?? null,
      insert: vi.fn((type?: string, data?: unknown, _cfg?: unknown, index?: number) => {
        const id = `new-${list.length}`;
        const row = { id, name: type ?? 'paragraph', parentId: null };
        const at = index ?? list.length;
        list.splice(at, 0, row);
        return { id, name: row.name, parentId: row.parentId };
      }),
      setBlockParent: vi.fn(),
      delete: vi.fn(),
      transact: vi.fn((fn: () => void) => fn()),
    },
    events: {
      on: (_name: string, cb: () => void) => listeners.add(cb),
      off: (_name: string, cb: () => void) => listeners.delete(cb),
    },
  };
  return {
    editor: editor as unknown as Blok,
    /** Mutate the underlying list and fire 'block changed'. */
    emitChange: (next: Array<{ id: string; name?: string; parentId?: string | null }>) => {
      list = next.map((r) => ({ id: r.id, name: r.name ?? 'paragraph', parentId: r.parentId ?? null }));
      listeners.forEach((cb) => cb());
    },
  };
};

describe('useBlocks reads', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('getById returns a BlockNode or null', () => {
    const { editor } = makeFakeEditor([{ id: 'a', name: 'header' }]);
    const { result } = renderHook(() => useBlocks(editor));
    expect(result.current.getById('a')).toMatchObject({ id: 'a', type: 'header', parentId: null });
    expect(result.current.getById('missing')).toBeNull();
  });

  it('getChildren(null) returns root blocks; getChildren(id) returns that node children', () => {
    const { editor } = makeFakeEditor([
      { id: 'p', name: 'toggle' },
      { id: 'c1', parentId: 'p' },
      { id: 'root2' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));
    expect(result.current.getChildren(null).map((n) => n.id)).toEqual(['p', 'root2']);
    expect(result.current.getChildren('p').map((n) => n.id)).toEqual(['c1']);
  });

  it('re-renders when the editor emits "block changed"', () => {
    const { editor, emitChange } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    expect(result.current.getChildren(null).map((n) => n.id)).toEqual(['a']);

    act(() => emitChange([{ id: 'a' }, { id: 'b' }]));
    expect(result.current.getChildren(null).map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('returns a stable no-op API when editor is null', () => {
    const { result } = renderHook(() => useBlocks(null));
    expect(result.current.getById('x')).toBeNull();
    expect(result.current.getChildren(null)).toEqual([]);
  });
});

describe('useBlocks mutators (delegation)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('nest delegates to setBlockParent(id, parentId)', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'p', name: 'toggle' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.nest('a', 'p'));
    expect(editor.blocks.setBlockParent).toHaveBeenCalledWith('a', 'p');
  });

  it('unnest delegates to setBlockParent(id, null)', () => {
    const { editor } = makeFakeEditor([{ id: 'a', parentId: 'p' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.unnest('a'));
    expect(editor.blocks.setBlockParent).toHaveBeenCalledWith('a', null);
  });

  it('remove resolves the flat index then delegates to delete', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.remove('b'));
    expect(editor.blocks.delete).toHaveBeenCalledWith(1);
  });

  it('remove is a no-op when the id is unknown', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.remove('ghost'));
    expect(editor.blocks.delete).not.toHaveBeenCalled();
  });

  it('transact delegates to editor.blocks.transact', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    const fn = vi.fn();
    act(() => result.current.transact(fn));
    expect(editor.blocks.transact).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('useBlocks insert', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('root insert at end calls editor.blocks.insert with flat index = count', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insert> = null;
    act(() => { created = result.current.insert({ type: 'header', data: { text: 'hi' } }); });
    expect(editor.blocks.insert).toHaveBeenCalledWith('header', { text: 'hi' }, {}, 2);
    expect(created).toMatchObject({ type: 'header' });
  });

  it('root insert before a sibling uses that sibling flat index', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => { result.current.insert({ type: 'paragraph', position: { before: 'b' } }); });
    expect(editor.blocks.insert).toHaveBeenCalledWith('paragraph', {}, {}, 1);
  });

  it('parented insert wraps insert + setBlockParent in a single transact', () => {
    const { editor } = makeFakeEditor([{ id: 'p', name: 'toggle' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => { result.current.insert({ type: 'paragraph', parentId: 'p' }); });
    expect(editor.blocks.transact).toHaveBeenCalledTimes(1);
    expect(editor.blocks.insert).toHaveBeenCalledTimes(1);
    expect(editor.blocks.setBlockParent).toHaveBeenCalledWith('new-1', 'p');
  });

  it('returns null when editor.blocks.insert yields no block', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    (editor.blocks.insert as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insert> = null;
    act(() => { created = result.current.insert({}); });
    expect(created).toBeNull();
  });
});
