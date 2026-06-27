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
