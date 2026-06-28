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
      move: vi.fn(),
      transact: vi.fn((fn: () => void) => fn()),
    },
    on: (_name: string, cb: () => void) => listeners.add(cb),
    off: (_name: string, cb: () => void) => listeners.delete(cb),
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

  it('remove resolves the flat index then delegates to delete without stealing the caret', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.remove('b'));
    // setCaret=false: programmatic removal must not move the user's caret.
    expect(editor.blocks.delete).toHaveBeenCalledWith(1, false);
  });

  it('remove is a no-op when the id is unknown', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.remove('ghost'));
    expect(editor.blocks.delete).not.toHaveBeenCalled();
  });

  it('remove deletes the whole subtree (descendants first) instead of promoting children to root', () => {
    const { editor } = makeFakeEditor([
      { id: 'p', name: 'toggle' },
      { id: 'c', parentId: 'p' },
      { id: 'g', parentId: 'c' },
      { id: 'tail' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.remove('p'));
    // Deepest-first by descending flat index so each index stays valid: g(2), c(1), p(0).
    const deleteMock = editor.blocks.delete as ReturnType<typeof vi.fn>;
    const calls = deleteMock.mock.calls.map((args) => args[0] as number);
    expect(calls).toEqual([2, 1, 0]);
    // 'tail' (index 3) must be left untouched.
    expect(calls).not.toContain(3);
    // Every subtree deletion suppresses the caret move.
    deleteMock.mock.calls.forEach((args) => expect(args[1]).toBe(false));
  });

  it('groups a subtree remove in a single transact', () => {
    const { editor } = makeFakeEditor([
      { id: 'p', name: 'toggle' },
      { id: 'c', parentId: 'p' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.remove('p'));
    expect(editor.blocks.transact).toHaveBeenCalledTimes(1);
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

/**
 * A fake editor whose `delete` mutates a live list AND cascades: removing the
 * last child of a `column` auto-removes the (now empty) column — mirroring Blok
 * core's container teardown. This exercises remove()'s index handling under
 * deletions that shift/invalidate other blocks' indices mid-loop.
 */
const makeCascadingEditor = (
  rows: Array<{ id: string; name?: string; parentId?: string | null }>
) => {
  const list = rows.map((r) => ({ id: r.id, name: r.name ?? 'paragraph', parentId: r.parentId ?? null }));
  const editor = {
    blocks: {
      getBlocksCount: () => list.length,
      getBlockByIndex: (i: number) => list[i],
      getBlockIndex: (id: string) => {
        const idx = list.findIndex((b) => b.id === id);

        return idx === -1 ? undefined : idx;
      },
      delete: vi.fn((index: number) => {
        const removed = list[index];

        if (removed === undefined) {
          return;
        }
        list.splice(index, 1);

        // Cascade: if the removed block's parent (a column) now has no remaining
        // children, core auto-removes the empty container too.
        if (removed.parentId === null) {
          return;
        }
        if (list.some((b) => b.parentId === removed.parentId)) {
          return;
        }
        const parentIdx = list.findIndex((b) => b.id === removed.parentId);

        if (parentIdx !== -1) {
          list.splice(parentIdx, 1);
        }
      }),
      transact: vi.fn((fn: () => void) => fn()),
    },
    on: () => undefined,
    off: () => undefined,
  };

  return { editor: editor as unknown as Blok };
};

describe('useBlocks remove — resilience to cascading deletions', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('does not delete an unrelated block when a core delete cascades to remove the container', () => {
    // [column, child(of column), tail]. Removing the column means deleting its
    // child, which cascades to auto-remove the empty column. A naive pre-captured
    // index loop would then delete index 0 again — hitting 'tail'.
    const { editor } = makeCascadingEditor([
      { id: 'column', name: 'column' },
      { id: 'child', parentId: 'column' },
      { id: 'tail' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));

    act(() => result.current.remove('column'));

    // The whole column subtree is gone; the unrelated 'tail' must survive.
    expect(result.current.getById('column')).toBeNull();
    expect(result.current.getById('child')).toBeNull();
    expect(result.current.getById('tail')).not.toBeNull();
    expect(result.current.getChildren(null).map((n) => n.id)).toEqual(['tail']);
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
    // needToFocus=false: programmatic creation must not steal the caret.
    // Trailing args: replace=false, id=undefined, tunes=undefined.
    expect(editor.blocks.insert).toHaveBeenCalledWith('header', { text: 'hi' }, {}, 2, false, false, undefined, undefined);
    expect(created).toMatchObject({ type: 'header' });
  });

  it('root insert before a sibling uses that sibling flat index', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => { result.current.insert({ type: 'paragraph', position: { before: 'b' } }); });
    expect(editor.blocks.insert).toHaveBeenCalledWith('paragraph', {}, {}, 1, false, false, undefined, undefined);
  });

  it('focuses the new block only when spec.focus is true', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => { result.current.insert({ type: 'paragraph', focus: true }); });
    expect(editor.blocks.insert).toHaveBeenCalledWith('paragraph', {}, {}, 1, true, false, undefined, undefined);
  });

  it('forwards replace to core so a block can be replaced ("turn into") in place', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => { result.current.insert({ type: 'header', position: { before: 'b' }, replace: true }); });
    // replace=true (6th arg); flat index of 'b' = 1.
    expect(editor.blocks.insert).toHaveBeenCalledWith('header', {}, {}, 1, false, true, undefined, undefined);
  });

  it('forwards an explicit id to core', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => { result.current.insert({ type: 'paragraph', id: 'fixed-id' }); });
    expect(editor.blocks.insert).toHaveBeenCalledWith('paragraph', {}, {}, 1, false, false, 'fixed-id', undefined);
  });

  it('forwards tunes to core so tune state can be set at creation', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    const tunes = { align: 'center' };
    act(() => { result.current.insert({ type: 'paragraph', tunes }); });
    expect(editor.blocks.insert).toHaveBeenCalledWith('paragraph', {}, {}, 1, false, false, undefined, tunes);
  });

  it('is idempotent when an explicit id already exists (insert-if-absent)', () => {
    const { editor } = makeFakeEditor([{ id: 'a', name: 'header' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insert> = null;
    act(() => { created = result.current.insert({ id: 'a', type: 'paragraph' }); });
    // The id is already present → return the existing node, never insert a duplicate.
    expect(editor.blocks.insert).not.toHaveBeenCalled();
    expect(created).toMatchObject({ id: 'a', type: 'header' });
  });

  it('returns null (does not throw) when the tool type is unknown', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    (editor.blocks.insert as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('Could not compose Block. Tool «nope» not found.');
    });
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insert> = null;
    let threw = false;
    act(() => {
      try {
        created = result.current.insert({ type: 'nope' });
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
    expect(created).toBeNull();
  });

  it('explicit-id insert-if-absent probes existence WITHOUT the warning-emitting getBlockIndex', () => {
    // The idempotency check must not call editor.blocks.getBlockIndex with the
    // new id: core's getBlockIndex logs a `warn` for any unknown id, so probing
    // with it spams the console on the recommended insert-if-absent happy path.
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const getBlockIndexSpy = vi.spyOn(editor.blocks, 'getBlockIndex');
    const { result } = renderHook(() => useBlocks(editor));
    act(() => { result.current.insert({ id: 'brand-new', position: 'end' }); });
    expect(editor.blocks.insert).toHaveBeenCalledTimes(1);
    expect(getBlockIndexSpy).not.toHaveBeenCalledWith('brand-new');
  });

  it('re-throws an UNEXPECTED core error instead of masking it as a null return', () => {
    // The catch exists only to honor the null contract for the unknown-tool
    // case ("…not found"). A genuine bug (any other error) must surface, not be
    // silently swallowed into a null.
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    (editor.blocks.insert as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('kaboom: unexpected core failure');
    });
    const { result } = renderHook(() => useBlocks(editor));
    let threw = false;
    act(() => {
      try {
        result.current.insert({ type: 'paragraph' });
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(true);
  });

  it('returns null and never inserts when parentId does not resolve', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insert> = null;
    act(() => { created = result.current.insert({ parentId: 'ghost' }); });
    expect(created).toBeNull();
    expect(editor.blocks.insert).not.toHaveBeenCalled();
    expect(editor.blocks.setBlockParent).not.toHaveBeenCalled();
  });

  it('wraps a root insert in a transact so it is a single atomic undo step', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => { result.current.insert({ type: 'paragraph' }); });
    expect(editor.blocks.transact).toHaveBeenCalledTimes(1);
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

describe('useBlocks move', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('move with toIndex delegates to editor.blocks.move(toIndex, fromIndex)', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.move('a', { toIndex: 2 }));
    expect(editor.blocks.move).toHaveBeenCalledWith(2, 0);
  });

  it('move after a sibling resolves to sibling index + 1', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.move('c', { after: 'a' }));
    expect(editor.blocks.move).toHaveBeenCalledWith(1, 2);
  });

  it('move is a no-op when the moved id is unknown', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.move('ghost', { toIndex: 0 }));
    expect(editor.blocks.move).not.toHaveBeenCalled();
  });

  it('move after a later sibling (forward) compensates for the post-removal shift', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.move('a', { after: 'b' }));
    // resolveMoveIndex({after:'b'}) = 2; forward move from 0 → decremented to 1.
    expect(editor.blocks.move).toHaveBeenCalledWith(1, 0);
  });

  it('move before a later sibling (forward) compensates for the post-removal shift', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.move('a', { before: 'c' }));
    // resolveMoveIndex({before:'c'}) = 2; forward move from 0 → decremented to 1.
    expect(editor.blocks.move).toHaveBeenCalledWith(1, 0);
  });

  it('move of a block that has descendants delegates a single subtree-aware move', () => {
    // A has a nested child A1. Moving A past root-sibling B delegates ONE move of
    // the named block; carrying DOM-contained descendants is core's job (the hook
    // does not relocate the subtree for move, unlike nest). The toIndex is
    // computed past B's whole subtree.
    const { editor } = makeFakeEditor([
      { id: 'A', name: 'toggle' },
      { id: 'A1', parentId: 'A' },
      { id: 'B' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.move('A', { after: 'B' }));
    // resolveMoveIndex({after:'B'}) = subtreeEnd(B)+1 = 3; forward from 0 → 2.
    expect(editor.blocks.move).toHaveBeenCalledTimes(1);
    expect(editor.blocks.move).toHaveBeenCalledWith(2, 0);
  });

  it('move after the last block (forward to end) stays within Blok bounds', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.move('a', { after: 'c' }));
    // resolveMoveIndex({after:'c'}) = 3 (= length); decremented to 2 so Blok's
    // toIndex<length guard doesn't silently drop the move.
    expect(editor.blocks.move).toHaveBeenCalledWith(2, 0);
  });
});
