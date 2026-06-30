// test/unit/react/useBlocks.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBlocks } from '../../../src/react/useBlocks';
import type { BlockNode } from '../../../src/react/blocks-snapshot';
import { ToolNotFoundError } from '../../../src/components/errors/tool-not-found';
import type { Blok } from '../../../types';

/** A controllable fake editor exposing only what useBlocks consumes. */
const makeFakeEditor = (
  rows: Array<{ id: string; name?: string; parentId?: string | null }>
) => {
  let list = rows.map((r) => ({ id: r.id, name: r.name ?? 'paragraph', parentId: r.parentId ?? null }));
  // Name-aware event bus (the real editor dispatches per event name). Keeping the
  // 'block changed' and 'blocks:rendered' buses distinct lets a test assert that
  // the document-load lifecycle ('blocks:rendered') is reacted to independently.
  const buses = new Map<string, Set<() => void>>();
  const busFor = (name: string): Set<() => void> => {
    let bus = buses.get(name);

    if (bus === undefined) {
      bus = new Set();
      buses.set(name, bus);
    }

    return bus;
  };
  const emit = (name: string): void => buses.get(name)?.forEach((cb) => cb());
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
      // Faithful to Blok's Blocks.move(): toIndex is POST-removal index space
      // (splice out fromIndex, then re-insert at toIndex). Actually mutating the
      // list lets the hook re-read each block's new flat index — which the
      // nest/unnest relocation-success check depends on.
      move: vi.fn((toIndex: number, fromIndex: number) => {
        const [moved] = list.splice(fromIndex, 1);

        if (moved !== undefined) {
          list.splice(toIndex, 0, moved);
        }
      }),
      update: vi.fn(() => Promise.resolve({})),
      // Faithful to core's convert(): it routes through replace(), which
      // generates a BRAND-NEW block id (the old block is removed). The resolved
      // BlockAPI carries that new id. Keeping the old id here would mask the
      // stale-id caret bug, so regenerate the id in place and surface it.
      convert: vi.fn((id: string, newType: string) => {
        const idx = list.findIndex((b) => b.id === id);

        if (idx === -1) {
          return Promise.resolve(undefined);
        }
        const newId = `converted-${list.length}`;
        const parentId = list[idx].parentId;

        list.splice(idx, 1, { id: newId, name: newType, parentId });
        return Promise.resolve({ id: newId, name: newType, parentId });
      }),
      transact: vi.fn((fn: () => void) => fn()),
      transactWithoutCapture: vi.fn((fn: () => void) => fn()),
      getCurrentBlockIndex: vi.fn(() => 0),
      getBlockByElement: vi.fn((_el: HTMLElement) => undefined as { id: string } | undefined),
      composeBlockData: vi.fn((type: string) => Promise.resolve({ composedFrom: type })),
      splitBlock: vi.fn((currentId: string, _curData: unknown, newType: string, _newData: unknown, insertIndex: number) => {
        const id = `split-${list.length}`;

        list.splice(insertIndex, 0, { id, name: newType, parentId: null });
        return { id, name: newType, parentId: null };
      }),
      insertMany: vi.fn((blocks: Array<{ id?: string; type?: string; parent?: string | null }>, index?: number) => {
        const at = index ?? list.length;
        const created = blocks.map((b, i) => ({
          id: b.id ?? `raw-${list.length + i}`,
          name: b.type ?? 'paragraph',
          parentId: b.parent ?? null,
        }));

        list.splice(at, 0, ...created);
        return created.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }));
      }),
      // Faithful to core's insertInsideParent: creates one child block under
      // parentId at the given flat index and returns a BlockAPI-like `{ id }`.
      insertInsideParent: vi.fn((parentId: string, insertIndex: number, _childData?: unknown) => {
        const id = `child-${list.length}`;
        const row = { id, name: 'paragraph', parentId };

        list.splice(insertIndex, 0, row);
        return { id, name: row.name, parentId };
      }),
      // Faithful to core's document-LOAD render(): clear() empties the list and
      // fires 'block changed' (so the hook paints the empty doc), THEN Renderer
      // inserts the new blocks SILENTLY (no 'block changed') and fires only
      // 'blocks:rendered'. The await between the two steps lets React commit the
      // cleared state first — so a hook that ignores 'blocks:rendered' stays
      // frozen on the empty document, exactly the production symptom.
      render: vi.fn(async (data: { blocks: Array<{ id: string; type?: string; parent?: string | null }> }) => {
        list = [];
        emit('block changed');
        await Promise.resolve();
        list = data.blocks.map((b) => ({ id: b.id, name: b.type ?? 'paragraph', parentId: b.parent ?? null }));
        emit('blocks:rendered');
      }),
      clear: vi.fn(() => Promise.resolve()),
      // Read-only flag on core; the hook's isSyncingFromYjs() reads it LIVE.
      isSyncingFromYjs: false,
    },
    caret: {
      setToBlock: vi.fn((_idOrIndex: unknown, _position?: string, _offset?: number) => true),
    },
    on: (name: string, cb: () => void) => busFor(name).add(cb),
    off: (name: string, cb: () => void) => buses.get(name)?.delete(cb),
  };
  return {
    editor: editor as unknown as Blok,
    /** Live count of 'block changed' subscribers — asserts subscribe/cleanup. */
    listenerCount: (): number => buses.get('block changed')?.size ?? 0,
    /** Live count of 'blocks:rendered' subscribers — asserts the render-lifecycle subscription + its cleanup. */
    renderedListenerCount: (): number => buses.get('blocks:rendered')?.size ?? 0,
    /** Mutate the underlying list and fire 'block changed'. */
    emitChange: (next: Array<{ id: string; name?: string; parentId?: string | null }>) => {
      list = next.map((r) => ({ id: r.id, name: r.name ?? 'paragraph', parentId: r.parentId ?? null }));
      emit('block changed');
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

  it('reads from and stays reactive to a swapped-in second editor instance', () => {
    // Switching the editor instance must not leave reads bound to the old one,
    // and the new editor's 'block changed' must still drive re-renders (the
    // monotonic version is reset on the editor swap so it doesn't carry over).
    const first = makeFakeEditor([{ id: 'a' }]);
    const second = makeFakeEditor([{ id: 'x' }]);
    const { result, rerender } = renderHook(({ editor }) => useBlocks(editor), {
      initialProps: { editor: first.editor },
    });
    expect(result.current.getChildren(null).map((n) => n.id)).toEqual(['a']);

    rerender({ editor: second.editor });
    expect(result.current.getChildren(null).map((n) => n.id)).toEqual(['x']);

    act(() => second.emitChange([{ id: 'x' }, { id: 'y' }]));
    expect(result.current.getChildren(null).map((n) => n.id)).toEqual(['x', 'y']);
  });

  it('returns a stable no-op API when editor is null', () => {
    const { result } = renderHook(() => useBlocks(null));
    expect(result.current.getById('x')).toBeNull();
    expect(result.current.getChildren(null)).toEqual([]);
  });

  it('detaches its "block changed" listener on unmount', () => {
    // A dropped cleanup would leak one handler per mounted hook. The swap test
    // alone wouldn't catch it (the new editor stays reactive regardless), so
    // assert the listener Set empties on unmount.
    const { editor, listenerCount } = makeFakeEditor([{ id: 'a' }]);
    const { unmount } = renderHook(() => useBlocks(editor));
    expect(listenerCount()).toBe(1);
    unmount();
    expect(listenerCount()).toBe(0);
  });

  it('detaches the previous editor listener when the editor instance is swapped', () => {
    const first = makeFakeEditor([{ id: 'a' }]);
    const second = makeFakeEditor([{ id: 'x' }]);
    const { rerender } = renderHook(({ editor }) => useBlocks(editor), {
      initialProps: { editor: first.editor },
    });
    expect(first.listenerCount()).toBe(1);

    rerender({ editor: second.editor });
    expect(first.listenerCount()).toBe(0);
    expect(second.listenerCount()).toBe(1);
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

  it('unnest is a no-op for a block already at root (no setBlockParent, move, or transact)', () => {
    // The already-at-root early return must short-circuit BEFORE any relocate or
    // reparent work; a regression removing it would needlessly reorder a root
    // block and fire setBlockParent/transact.
    const { editor } = makeFakeEditor([{ id: 'a' }]); // a is root (parentId null)
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.unnest('a'));
    expect(editor.blocks.setBlockParent).not.toHaveBeenCalled();
    expect(editor.blocks.move).not.toHaveBeenCalled();
    expect(editor.blocks.transact).not.toHaveBeenCalled();
  });

  it('nest is a no-op when the target parent is the block itself or its own descendant', () => {
    // Nesting a block under itself (or under one of its own descendants) would
    // form a cycle. Core's setBlockParent THROWS on a cycle, so the hook must
    // guard it up front as a no-op instead of crashing the caller.
    const { editor } = makeFakeEditor([{ id: 'A', name: 'toggle' }, { id: 'A1', parentId: 'A' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.nest('A', 'A'));   // self
    act(() => result.current.nest('A', 'A1'));  // own descendant
    expect(editor.blocks.setBlockParent).not.toHaveBeenCalled();
  });

  it('nest is a no-op when an id is unknown, probed WITHOUT the warning-emitting getBlockIndex', () => {
    // getBlockIndex logs a `warn` for any unknown id; the existence probe on this
    // expected-absent no-op path must use the silent snapshot lookup instead.
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'p', name: 'toggle' }]);
    const getBlockIndexSpy = vi.spyOn(editor.blocks, 'getBlockIndex');
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.nest('ghost', 'p'));
    act(() => result.current.nest('a', 'ghost'));
    expect(editor.blocks.setBlockParent).not.toHaveBeenCalled();
    expect(getBlockIndexSpy).not.toHaveBeenCalledWith('ghost');
  });

  it('unnest is a no-op when the id is unknown, probed via the silent getById', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const getBlockIndexSpy = vi.spyOn(editor.blocks, 'getBlockIndex');
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.unnest('ghost'));
    expect(editor.blocks.setBlockParent).not.toHaveBeenCalled();
    expect(getBlockIndexSpy).not.toHaveBeenCalledWith('ghost');
  });

  it('groups a nest in a single transact (one undo step)', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'p', name: 'toggle' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.nest('a', 'p'));
    expect(editor.blocks.transact).toHaveBeenCalledTimes(1);
  });

  it('groups an unnest in a single transact (one undo step)', () => {
    const { editor } = makeFakeEditor([{ id: 'a', parentId: 'p' }, { id: 'p', name: 'toggle' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.unnest('a'));
    expect(editor.blocks.transact).toHaveBeenCalledTimes(1);
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

  it('terminates (no infinite loop) when the parentId graph contains a cycle', () => {
    // A concurrent remote Yjs reparent could momentarily produce a parentId
    // cycle (a→b→a). The subtree DFS that remove() relies on must guard against
    // re-visiting a node, or it would spin forever. Each id is deleted exactly
    // once; the test would time out against an unguarded traversal.
    const { editor } = makeFakeEditor([
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.remove('a'));
    const deleteMock = editor.blocks.delete as ReturnType<typeof vi.fn>;
    const indices = deleteMock.mock.calls.map((args) => args[0] as number);
    // Exactly two deletions, one per unique block — no duplicates, no hang.
    expect(indices).toHaveLength(2);
    expect(new Set(indices).size).toBe(2);
  }, 2000);

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

  it('insert with a missing before/after ref is a no-op (returns null), not an end-append', () => {
    // A relative position whose ref does not exist must NOT silently fall through
    // to resolveInsertIndex's end-slot fallback (which would dump the block at the
    // document end). An unresolved ref is a no-op — mirroring move(), which already
    // bails on a missing ref. The DX footgun is the surprise end-append.
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insert> = { id: 'sentinel' } as never;

    act(() => { created = result.current.insert({ type: 'paragraph', position: { after: 'ghost' } }); });

    expect(created).toBeNull();
    expect(editor.blocks.insert).not.toHaveBeenCalled();
  });

  it('root insert at end does not redundantly call setBlockParent', () => {
    // The created block already lands at root, so the landedParentId === parentId
    // guard must skip setBlockParent — no wasted reparent / extra Yjs write.
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => { result.current.insert({ type: 'paragraph' }); });
    expect(editor.blocks.setBlockParent).not.toHaveBeenCalled();
  });

  it('root insert after a block clears the ref whole subtree', () => {
    const { editor } = makeFakeEditor([
      { id: 'p', name: 'toggle' },
      { id: 'c1', parentId: 'p' },
      { id: 'tail' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => { result.current.insert({ type: 'paragraph', position: { after: 'p' } }); });
    // 'after p' lands past p's child c1 → flat index 2 (before 'tail').
    expect(editor.blocks.insert).toHaveBeenCalledWith('paragraph', {}, {}, 2, false, false, undefined, undefined);
  });

  it('parented insert at start lands at the parent first-child slot', () => {
    const { editor } = makeFakeEditor([
      { id: 'p', name: 'toggle' },
      { id: 'c1', parentId: 'p' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => { result.current.insert({ type: 'paragraph', parentId: 'p', position: 'start' }); });
    // start under non-empty p → before its first child c1 (flat index 1).
    expect(editor.blocks.insert).toHaveBeenCalledWith('paragraph', {}, {}, 1, false, false, undefined, undefined);
    expect(editor.blocks.setBlockParent).toHaveBeenCalledWith('new-2', 'p');
  });

  it('parented insert before a child resolves to that child slot', () => {
    const { editor } = makeFakeEditor([
      { id: 'p', name: 'toggle' },
      { id: 'c1', parentId: 'p' },
      { id: 'c2', parentId: 'p' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => { result.current.insert({ type: 'paragraph', parentId: 'p', position: { before: 'c2' } }); });
    expect(editor.blocks.insert).toHaveBeenCalledWith('paragraph', {}, {}, 2, false, false, undefined, undefined);
  });

  it('parented insert after a child clears that child subtree', () => {
    const { editor } = makeFakeEditor([
      { id: 'p', name: 'toggle' },
      { id: 'c1', parentId: 'p' },
      { id: 'g', parentId: 'c1' },
      { id: 'c2', parentId: 'p' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => { result.current.insert({ type: 'paragraph', parentId: 'p', position: { after: 'c1' } }); });
    // after sibling c1 must skip its descendant g → flat index 3 (before c2).
    expect(editor.blocks.insert).toHaveBeenCalledWith('paragraph', {}, {}, 3, false, false, undefined, undefined);
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

  it('replace of a NESTED block targets that block own flat index, not root end', () => {
    const { editor } = makeFakeEditor([
      { id: 'p', name: 'toggle' },
      { id: 'child', parentId: 'p' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => { result.current.insert({ type: 'header', position: { before: 'child' }, replace: true }); });
    // 'child' is nested under p at flat index 1. The documented turn-into pattern
    // must overwrite IT (index 1), not fall back to root end (index 2).
    expect(editor.blocks.insert).toHaveBeenCalledWith('header', {}, {}, 1, false, true, undefined, undefined);
  });

  it('replace of a NESTED block keeps the replacement under the same parent', () => {
    const { editor } = makeFakeEditor([
      { id: 'p', name: 'toggle' },
      { id: 'child', parentId: 'p' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => { result.current.insert({ type: 'header', position: { before: 'child' }, replace: true }); });
    // A replace is a positional type-swap that PRESERVES the parent link: the new
    // block (fake insert returns parentId null) is re-parented back under 'p'.
    expect(editor.blocks.setBlockParent).toHaveBeenCalledWith('new-2', 'p');
  });

  it('replace of a ROOT block must not adopt the caller parentId', () => {
    const { editor } = makeFakeEditor([
      { id: 'p', name: 'toggle' },
      { id: 'root', parentId: null },
    ]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => {
      result.current.insert({ type: 'header', parentId: 'p', position: { before: 'root' }, replace: true });
    });
    // The replace target 'root' lives at the document root (parentId null). A
    // replace is a positional type-swap that PRESERVES the overwritten block's
    // own parent, so the caller's parentId 'p' is irrelevant — the replacement
    // must stay at root and NOT be nested under 'p'.
    expect(editor.blocks.setBlockParent).not.toHaveBeenCalled();
  });

  it('replace ignores a non-resolving parentId instead of bailing to null', () => {
    const { editor } = makeFakeEditor([
      { id: 'p', name: 'toggle' },
      { id: 'child', parentId: 'p' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => {
      result.current.insert({ type: 'header', parentId: 'ghost', position: { before: 'child' }, replace: true });
    });
    // Under replace the target's OWN parent governs, so parentId is irrelevant —
    // a stale parentId must NOT short-circuit to null; the replace still runs at
    // the target's slot (index 1).
    expect(editor.blocks.insert).toHaveBeenCalledWith('header', {}, {}, 1, false, true, undefined, undefined);
  });

  it('replace runs even when an explicit id already exists (replace is not insert-if-absent)', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => { result.current.insert({ type: 'header', id: 'a', position: { before: 'a' }, replace: true }); });
    // id 'a' exists, but replace is an explicit overwrite — the insert-if-absent
    // short-circuit must NOT swallow it. Resolves to 'a' own slot (0) with id 'a'.
    expect(editor.blocks.insert).toHaveBeenCalledWith('header', {}, {}, 0, false, true, 'a', undefined);
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
      throw new ToolNotFoundError('nope');
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

  it('re-throws a non-tool error EVEN when its message contains "not found" (typed, not substring)', () => {
    // The unknown-tool swallow must key on the typed ToolNotFoundError, NOT a
    // brittle message.includes('not found') match — otherwise an unrelated bug
    // whose message happens to contain "not found" (e.g. a failed network lookup)
    // would be silently masked as a null no-op. Only a real ToolNotFoundError is
    // swallowed; everything else surfaces.
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    (editor.blocks.insert as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('remote resource not found');
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

  it('replace with a missing before/after ref returns null and inserts nothing (no parentId)', () => {
    // Can't "turn into" a block that does not exist. Under replace the position
    // ref IS the target being overwritten, so a missing ref must abort with null
    // instead of falling through to the end-slot fallback and overwriting/inserting
    // at the wrong place.
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insert> = null;
    act(() => { created = result.current.insert({ type: 'header', position: { before: 'ghost' }, replace: true }); });
    expect(created).toBeNull();
    expect(editor.blocks.insert).not.toHaveBeenCalled();
    expect(editor.blocks.setBlockParent).not.toHaveBeenCalled();
  });

  it('replace with a missing ref returns null even with a dangling parentId', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insert> = null;
    act(() => { created = result.current.insert({ type: 'header', parentId: 'ghost', position: { after: 'nope' }, replace: true }); });
    expect(created).toBeNull();
    expect(editor.blocks.insert).not.toHaveBeenCalled();
    expect(editor.blocks.setBlockParent).not.toHaveBeenCalled();
  });

  it('replace with a non-object position returns null and inserts nothing (no target ref)', () => {
    // A replace overwrites a specific target block named by a before/after ref.
    // With position 'start'/'end' (or omitted) there is no target ref, so replace
    // must abort with null instead of silently overwriting whatever sits at the
    // resolved slot.
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let createdEnd: ReturnType<typeof result.current.insert> = null;
    let createdStart: ReturnType<typeof result.current.insert> = null;
    act(() => { createdEnd = result.current.insert({ type: 'header', replace: true }); });
    act(() => { createdStart = result.current.insert({ type: 'header', position: 'start', replace: true }); });
    expect(createdEnd).toBeNull();
    expect(createdStart).toBeNull();
    expect(editor.blocks.insert).not.toHaveBeenCalled();
    expect(editor.blocks.setBlockParent).not.toHaveBeenCalled();
  });

  it('a dangling parentId is probed via the silent getById, not the warning-emitting getBlockIndex', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const getBlockIndexSpy = vi.spyOn(editor.blocks, 'getBlockIndex');
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insert> = null;
    act(() => { created = result.current.insert({ parentId: 'ghost' }); });
    expect(created).toBeNull();
    expect(editor.blocks.insert).not.toHaveBeenCalled();
    expect(getBlockIndexSpy).not.toHaveBeenCalledWith('ghost');
  });

  it('replace with a missing ref returns null even with a valid parentId', () => {
    const { editor } = makeFakeEditor([
      { id: 'p', name: 'toggle' },
      { id: 'child', parentId: 'p' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insert> = null;
    act(() => { created = result.current.insert({ type: 'header', parentId: 'p', position: { before: 'ghost' }, replace: true }); });
    expect(created).toBeNull();
    expect(editor.blocks.insert).not.toHaveBeenCalled();
    expect(editor.blocks.setBlockParent).not.toHaveBeenCalled();
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

  it('move of a block that has descendants relocates the WHOLE subtree (not just the root)', () => {
    // A has an indent (parentId-nested) child A1. Core's single move() carries
    // only DOM-contained descendants, so a one-shot move of A would strand A1
    // before A in flat order. move() must instead relocate the whole subtree and
    // re-assert each descendant's parent, leaving [B, A, A1] with A1 still a
    // child of A.
    const { editor } = makeFakeEditor([
      { id: 'A', name: 'toggle' },
      { id: 'A1', parentId: 'A' },
      { id: 'B' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.move('A', { after: 'B' }));
    // Subtree relocation issues more than one core move (root + each descendant).
    expect((editor.blocks.move as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
    // A1's parent is re-asserted to A after the relocation.
    expect(editor.blocks.setBlockParent).toHaveBeenCalledWith('A1', 'A');
    // Final flat order: A's subtree sits contiguously after B.
    expect(result.current.getChildren(null).map((n) => n.id)).toEqual(['B', 'A']);
    expect(result.current.getChildren('A').map((n) => n.id)).toEqual(['A1']);
  });

  it('move is a no-op when the relative target is a descendant of the moved block', () => {
    // Moving a block to sit relative to its OWN descendant is incoherent (a block
    // can't be a sibling of its child). Guard it as a no-op instead of letting
    // core attempt a self-referential relocation.
    const { editor } = makeFakeEditor([
      { id: 'A', name: 'toggle' },
      { id: 'A1', parentId: 'A' },
      { id: 'B' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.move('A', { after: 'A1' }));
    expect(editor.blocks.move).not.toHaveBeenCalled();
  });

  it('move is a no-op when the relative target is the moved block itself', () => {
    const { editor } = makeFakeEditor([{ id: 'A' }, { id: 'B' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.move('A', { before: 'A' }));
    expect(editor.blocks.move).not.toHaveBeenCalled();
  });

  it('move is a no-op when a relative before/after ref does not exist', () => {
    // A missing ref must NOT silently dump the block at the document end — that
    // is a surprising relocation. Treat an unresolved relative target as a no-op.
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.move('a', { after: 'ghost' }));
    act(() => result.current.move('a', { before: 'nope' }));
    expect(editor.blocks.move).not.toHaveBeenCalled();
  });

  it('move is a no-op when the moved id is unknown, probed WITHOUT getBlockIndex', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const getBlockIndexSpy = vi.spyOn(editor.blocks, 'getBlockIndex');
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.move('ghost', { toIndex: 0 }));
    expect(editor.blocks.move).not.toHaveBeenCalled();
    expect(getBlockIndexSpy).not.toHaveBeenCalledWith('ghost');
  });

  it('move with an absolute toIndex landing inside the block own subtree is a no-op', () => {
    // A toIndex pointing INSIDE the moved block's own subtree is covered by the
    // same rule as any toIndex on a descendant-having block: it is a graceful
    // no-op (enforced by the subtree branch — see the next test). This pins the
    // inside-subtree case specifically, since landing there would otherwise let
    // core auto-heal the block under its own child (a cycle core THROWS on).
    const { editor } = makeFakeEditor([
      { id: 'P', name: 'toggle' },
      { id: 'c1', parentId: 'P' },
      { id: 'c2', parentId: 'P' },
      { id: 'tail' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.move('P', { toIndex: 2 })); // index 2 == c2, inside P's subtree
    expect(editor.blocks.move).not.toHaveBeenCalled();
  });

  it('move with an absolute toIndex of a block that HAS descendants is a graceful no-op', () => {
    // An absolute toIndex can't unambiguously place a multi-block subtree (where
    // do k blocks land relative to one index?), and moving only the root would
    // strand the children. So a { toIndex } move of a block WITH descendants is a
    // documented graceful no-op — use { before }/{ after } to relocate a subtree.
    const { editor } = makeFakeEditor([
      { id: 'P', name: 'toggle' },
      { id: 'c1', parentId: 'P' },
      { id: 'c2', parentId: 'P' },
      { id: 'tail' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.move('P', { toIndex: 3 })); // index 3 == tail, outside the subtree
    expect(editor.blocks.move).not.toHaveBeenCalled();
    // Order unchanged — nothing was stranded.
    expect(result.current.getChildren(null).map((n) => n.id)).toEqual(['P', 'tail']);
  });

  it('move with an absolute toIndex still delegates a single move for a LEAF block', () => {
    // A leaf (no descendants) has an unambiguous toIndex placement, so the fast
    // single-move path is used.
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.move('a', { toIndex: 2 }));
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

describe('useBlocks update', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('delegates to editor.blocks.update with id, data and tunes', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    const tunes = { align: 'center' };
    act(() => result.current.update('a', { text: 'hi' }, tunes));
    expect(editor.blocks.update).toHaveBeenCalledWith('a', { text: 'hi' }, tunes);
  });

  it('is a no-op when the id is unknown (probed via the silent getById, not getBlockIndex)', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const getBlockIndexSpy = vi.spyOn(editor.blocks, 'getBlockIndex');
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.update('ghost', { text: 'x' }));
    expect(editor.blocks.update).not.toHaveBeenCalled();
    expect(getBlockIndexSpy).not.toHaveBeenCalledWith('ghost');
  });

  it('does NOT wrap in transact — core update forms its own async undo step', () => {
    // Core's update is async and manages its own Yjs/history grouping. Wrapping
    // the call in the synchronous transact would close the undo group before the
    // await resolves, so the hook must delegate directly.
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.update('a', { text: 'hi' }));
    expect(editor.blocks.transact).not.toHaveBeenCalled();
  });

  it('does not throw out of the hook when core update rejects', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    (editor.blocks.update as ReturnType<typeof vi.fn>).mockReturnValueOnce(Promise.reject(new Error('boom')));
    const { result } = renderHook(() => useBlocks(editor));
    let threw = false;
    act(() => {
      try {
        result.current.update('a', { text: 'hi' });
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
  });

  it('returns void', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let ret: unknown = 'sentinel';
    act(() => { ret = result.current.update('a', { text: 'hi' }); });
    expect(ret).toBeUndefined();
  });
});

describe('useBlocks convert', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('delegates to editor.blocks.convert with id, newType and dataOverrides', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    // convert is async (returns Promise<BlockNode|null>); don't return the
    // thenable to a sync act() — let it float (it's internally handled).
    act(() => { void result.current.convert('a', 'header', { level: 2 }); });
    expect(editor.blocks.convert).toHaveBeenCalledWith('a', 'header', { level: 2 });
  });

  it('is a no-op when the id is unknown (silent getById probe)', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const getBlockIndexSpy = vi.spyOn(editor.blocks, 'getBlockIndex');
    const { result } = renderHook(() => useBlocks(editor));
    act(() => { void result.current.convert('ghost', 'header'); });
    expect(editor.blocks.convert).not.toHaveBeenCalled();
    expect(getBlockIndexSpy).not.toHaveBeenCalledWith('ghost');
  });

  it('does not throw out of the hook when core convert rejects (non-convertible block)', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    (editor.blocks.convert as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      Promise.reject(new Error('Conversion from "a" to "header" is not possible.'))
    );
    const { result } = renderHook(() => useBlocks(editor));
    let threw = false;
    act(() => {
      try {
        result.current.convert('a', 'header');
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
  });
});

describe('useBlocks insertMany', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('inserts N blocks in document order within a SINGLE transact and returns N nodes', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insertMany> = [];
    act(() => {
      created = result.current.insertMany([
        { type: 'header', data: { text: 'one' } },
        { type: 'paragraph', data: { text: 'two' } },
        { type: 'paragraph', data: { text: 'three' } },
      ]);
    });
    expect(editor.blocks.insert).toHaveBeenCalledTimes(3);
    // One atomic undo step for the whole batch.
    expect(editor.blocks.transact).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(3);
    expect(created.map((n) => n.type)).toEqual(['header', 'paragraph', 'paragraph']);
  });

  it('returns [] and performs no transact side effects for an empty array', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insertMany> = ['sentinel'] as unknown as ReturnType<typeof result.current.insertMany>;
    act(() => { created = result.current.insertMany([]); });
    expect(created).toEqual([]);
    expect(editor.blocks.transact).not.toHaveBeenCalled();
    expect(editor.blocks.insert).not.toHaveBeenCalled();
  });

  it('filters out specs that fail to insert (e.g. a dangling parentId)', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insertMany> = [];
    act(() => {
      created = result.current.insertMany([
        { type: 'paragraph' },
        { type: 'paragraph', parentId: 'ghost' },
      ]);
    });
    // The dangling-parent spec returns null and is dropped from the result.
    expect(created).toHaveLength(1);
    expect(editor.blocks.transact).toHaveBeenCalledTimes(1);
  });

  it('an idempotent-id hit in the batch inserts no duplicate and is EXCLUDED from the created result', () => {
    // A spec whose explicit id already exists is insert-if-absent: it must NOT
    // create a second block. The documented contract is that insertMany returns
    // "only the successfully created nodes" — so an insert-if-absent hit (the
    // block already existed, nothing was created) must be DROPPED from the result,
    // not reported as freshly created.
    const { editor } = makeFakeEditor([{ id: 'a', name: 'header' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insertMany> = [];
    act(() => {
      created = result.current.insertMany([
        { type: 'paragraph' },
        { id: 'a', type: 'paragraph' },
        { type: 'paragraph' },
      ]);
    });
    // 'a' already exists → no insert for it; only the two new specs hit core.
    expect(editor.blocks.insert).toHaveBeenCalledTimes(2);
    expect(editor.blocks.transact).toHaveBeenCalledTimes(1);
    // Only the two genuinely-new nodes are returned; the pre-existing 'a' is not.
    expect(created).toHaveLength(2);
    expect(created.some((n) => n.id === 'a')).toBe(false);
  });

  it('a replace spec mixed with a normal insert forwards replace=true only for the replace spec', () => {
    // The batch shares one transact; each spec still routes through the single
    // insert path, so a normal insert stays replace=false while the replace spec
    // overwrites its before-ref target with replace=true.
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insertMany> = [];
    act(() => {
      created = result.current.insertMany([
        { type: 'paragraph' },
        { type: 'header', position: { before: 'b' }, replace: true },
      ]);
    });
    expect(created).toHaveLength(2);
    expect(editor.blocks.transact).toHaveBeenCalledTimes(1);
    // 1st spec: plain root append at end (index 2), replace=false.
    expect(editor.blocks.insert).toHaveBeenNthCalledWith(1, 'paragraph', {}, {}, 2, false, false, undefined, undefined);
    // 2nd spec: replace 'b' in place at its own flat index 1, replace=true.
    expect(editor.blocks.insert).toHaveBeenNthCalledWith(2, 'header', {}, {}, 1, false, true, undefined, undefined);
  });

  it('a focus:true spec in the batch focuses only that block, not its batch siblings', () => {
    // focus defaults to false so a programmatic batch never steals the caret;
    // only the spec that opts in passes needToFocus=true to core.
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => {
      result.current.insertMany([
        { type: 'paragraph' },
        { type: 'paragraph', focus: true },
      ]);
    });
    // 1st spec: needToFocus=false (5th arg).
    expect(editor.blocks.insert).toHaveBeenNthCalledWith(1, 'paragraph', {}, {}, 1, false, false, undefined, undefined);
    // 2nd spec: needToFocus=true.
    expect(editor.blocks.insert).toHaveBeenNthCalledWith(2, 'paragraph', {}, {}, 2, true, false, undefined, undefined);
  });

  it('inserts every spec even when core exposes no transact (fallback runs the batch directly)', () => {
    // A core build without the optional transact API must still insert each spec
    // — the batch falls back to running the loop directly instead of dropping it.
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    (editor.blocks as unknown as { transact?: (fn: () => void) => void }).transact = undefined;
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insertMany> = [];
    act(() => {
      created = result.current.insertMany([
        { type: 'paragraph' },
        { type: 'header' },
      ]);
    });
    expect(editor.blocks.insert).toHaveBeenCalledTimes(2);
    expect(created).toHaveLength(2);
    expect(created.map((n) => n.type)).toEqual(['paragraph', 'header']);
  });
});

describe('useBlocks contentIds', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('a parent node contentIds equals the ids of its direct children', () => {
    const { editor } = makeFakeEditor([
      { id: 'p', name: 'toggle' },
      { id: 'c1', parentId: 'p' },
      { id: 'c2', parentId: 'p' },
      { id: 'root2' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));
    const parent = result.current.getById('p');
    expect(parent?.contentIds).toEqual(result.current.getChildren('p').map((n) => n.id));
    expect(parent?.contentIds).toEqual(['c1', 'c2']);
    // A leaf has no children.
    expect(result.current.getById('root2')?.contentIds).toEqual([]);
  });
});

describe('useBlocks insertTree delegation', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('flattens the subtree DFS pre-order and delegates to core insertMany ONCE with (flat, flatIndex)', () => {
    const { editor } = makeFakeEditor([{ id: 'anchor' }]);
    const { result } = renderHook(() => useBlocks(editor));

    act(() => {
      result.current.insertTree({
        id: 'root',
        type: 'toggle',
        children: [
          { id: 'c1', type: 'paragraph' },
          { id: 'c2', type: 'header', children: [{ id: 'g', type: 'paragraph' }] },
        ],
      });
    });

    // Whole subtree lands via a SINGLE core.insertMany call (NOT per-node insert).
    expect(editor.blocks.insertMany).toHaveBeenCalledTimes(1);
    expect(editor.blocks.insert).not.toHaveBeenCalled();

    const [flat, flatIndex] = (editor.blocks.insertMany as ReturnType<typeof vi.fn>).mock.calls[0];

    // DFS pre-order, parent/content links wired from generated ids.
    expect((flat as Array<{ id: string }>).map((b) => b.id)).toEqual(['root', 'c1', 'c2', 'g']);
    expect((flat as Array<{ content?: string[] }>)[0].content).toEqual(['c1', 'c2']);
    expect((flat as Array<{ parent?: string }>)[3].parent).toBe('c2');
    // Appended at the document end (after the single existing anchor block).
    expect(flatIndex).toBe(1);
  });

  it('rejects a colliding explicit id without inserting anything', () => {
    const { editor } = makeFakeEditor([{ id: 'dup' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let root: ReturnType<typeof result.current.insertTree> = { id: 'x' } as never;

    act(() => { root = result.current.insertTree({ id: 'dup', type: 'paragraph' }); });
    expect(root).toBeNull();
    expect(editor.blocks.insertMany).not.toHaveBeenCalled();
  });

  it('is a no-op (returns null) when an object position references a missing block', () => {
    // A dangling { before|after } ref must NOT fall through to resolveInsertIndex's
    // end-slot fallback and silently append the subtree at the document end —
    // mirror insert()'s missing-ref guard and return null without inserting.
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let root: ReturnType<typeof result.current.insertTree> = { id: 'sentinel' } as never;

    act(() => { root = result.current.insertTree({ type: 'paragraph', position: { after: 'missing' } }); });
    expect(root).toBeNull();
    expect(editor.blocks.insertMany).not.toHaveBeenCalled();
  });

  it('inserts at the resolved slot when an object position references an EXISTING block', () => {
    // Positive counterpart to the missing-ref no-op: a VALID { after } ref must
    // NOT trip the dangling-ref early-return — the subtree is inserted at the slot
    // right after the ref (between 'a' and 'b'), proving the guard only rejects
    // genuinely-absent refs.
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }]);
    const { result } = renderHook(() => useBlocks(editor));

    act(() => { result.current.insertTree({ id: 'root', type: 'paragraph', position: { after: 'a' } }); });

    expect(editor.blocks.insertMany).toHaveBeenCalledTimes(1);
    const [flat, flatIndex] = (editor.blocks.insertMany as ReturnType<typeof vi.fn>).mock.calls[0];

    expect((flat as Array<{ id: string }>).map((b) => b.id)).toEqual(['root']);
    // Slot directly after 'a' (index 0), i.e. before 'b'.
    expect(flatIndex).toBe(1);
  });
});

describe('useBlocks pre-ready API (editor is null)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('mutators are no-ops and read methods return empty/null', async () => {
    const { result } = renderHook(() => useBlocks(null));
    expect(result.current.getById('x')).toBeNull();
    expect(result.current.getChildren(null)).toEqual([]);
    expect(result.current.insert({ type: 'paragraph' })).toBeNull();
    expect(result.current.insertMany([{ type: 'paragraph' }])).toEqual([]);
    expect(result.current.insertTree({ type: 'paragraph' })).toBeNull();
    expect(result.current.move('x', { toIndex: 0 })).toBeUndefined();
    expect(result.current.nest('a', 'b')).toBeUndefined();
    expect(result.current.unnest('a')).toBeUndefined();
    expect(result.current.remove('a')).toBeUndefined();
    expect(result.current.update('a', { text: 'x' })).toBeUndefined();
    await expect(result.current.convert('a', 'header')).resolves.toBeNull();
    // Additional surfaced APIs honor the pre-ready contract too.
    expect(result.current.getBlocksCount()).toBe(0);
    expect(result.current.getCurrentBlockIndex()).toBe(-1);
    expect(result.current.getBlockByIndex(0)).toBeNull();
    expect(result.current.getBlockByElement(document.createElement('div'))).toBeNull();
    expect(result.current.insertOutputData([{ type: 'paragraph', data: {} }])).toEqual([]);
    expect(result.current.splitBlock('a', {}, 'paragraph', {}, 0)).toBeNull();
  });

  it('pre-ready composeBlockData resolves to {} and transactWithoutCapture still runs its callback', async () => {
    const { result } = renderHook(() => useBlocks(null));
    const fn = vi.fn();

    act(() => result.current.transactWithoutCapture(fn));
    expect(fn).toHaveBeenCalledTimes(1);
    await expect(result.current.composeBlockData('header')).resolves.toEqual({});
  });

  it('pre-ready insertMarkdown resolves to [] without throwing (async no-op)', async () => {
    // The one async creator must still honor its empty-result contract pre-ready —
    // it must resolve to [], not reject (which would surface as an unhandled
    // rejection in the React caller).
    const { result } = renderHook(() => useBlocks(null));

    await expect(result.current.insertMarkdown('# heading')).resolves.toEqual([]);
  });

  it('transact still RUNS its callback even when the editor is null (not a no-op)', () => {
    // The pre-ready transact is the one exception: it invokes its callback so a
    // consumer wrapping conditional work in transact still executes that work.
    const { result } = renderHook(() => useBlocks(null));
    const fn = vi.fn();
    act(() => result.current.transact(fn));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('useBlocks transact fallback (editor.blocks.transact undefined)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('runs the callback directly when core exposes no transact', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    // Simulate a core build without the optional transact API.
    (editor.blocks as unknown as { transact?: (fn: () => void) => void }).transact = undefined;
    const { result } = renderHook(() => useBlocks(editor));
    const fn = vi.fn();
    act(() => result.current.transact(fn));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a single insert still runs (delegates to core.insert) without a transact', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    (editor.blocks as unknown as { transact?: (fn: () => void) => void }).transact = undefined;
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insert> = null;
    act(() => { created = result.current.insert({ type: 'paragraph' }); });
    expect(editor.blocks.insert).toHaveBeenCalledTimes(1);
    expect(created).toMatchObject({ type: 'paragraph' });
  });
});

describe('useBlocks additional read/creation APIs', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('getBlocksCount reflects the current block count', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }]);
    const { result } = renderHook(() => useBlocks(editor));
    expect(result.current.getBlocksCount()).toBe(2);
  });

  it('getCurrentBlockIndex delegates to core', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    (editor.blocks.getCurrentBlockIndex as ReturnType<typeof vi.fn>).mockReturnValue(3);
    const { result } = renderHook(() => useBlocks(editor));
    expect(result.current.getCurrentBlockIndex()).toBe(3);
  });

  it('getBlockByIndex returns a snapshot node or null when out of range', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b', name: 'header' }]);
    const { result } = renderHook(() => useBlocks(editor));
    expect(result.current.getBlockByIndex(1)).toMatchObject({ id: 'b', type: 'header' });
    expect(result.current.getBlockByIndex(9)).toBeNull();
  });

  it('getBlockByElement maps a DOM element back to its block node', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'target', name: 'header' }]);
    const el = document.createElement('div');

    (editor.blocks.getBlockByElement as ReturnType<typeof vi.fn>).mockImplementation((e: HTMLElement) =>
      e === el ? { id: 'target' } : undefined
    );
    const { result } = renderHook(() => useBlocks(editor));
    expect(result.current.getBlockByElement(el)).toMatchObject({ id: 'target', type: 'header' });
    expect(result.current.getBlockByElement(document.createElement('div'))).toBeNull();
  });

  it('composeBlockData delegates to core and resolves the default data', async () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    const data = await result.current.composeBlockData('header');

    expect(editor.blocks.composeBlockData).toHaveBeenCalledWith('header');
    expect(data).toEqual({ composedFrom: 'header' });
  });

  it('composeBlockData PROPAGATES a core rejection (unknown tool) instead of swallowing it', async () => {
    // The JSDoc promises composeBlockData "Rejects (via core) for an unknown
    // tool". Unlike update/convert (which swallow rejections to stay graceful
    // no-ops), this reader is a pure passthrough, so the caller can `await`/catch
    // it. Guard that the wrapper never starts swallowing the rejection.
    const { editor } = makeFakeEditor([{ id: 'a' }]);

    (editor.blocks.composeBlockData as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
      Promise.reject(new Error('Tool «ghost» not found'))
    );
    const { result } = renderHook(() => useBlocks(editor));

    await expect(result.current.composeBlockData('ghost')).rejects.toThrow('not found');
  });

  it('transactWithoutCapture delegates to core (no-undo grouping)', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    const fn = vi.fn();

    act(() => result.current.transactWithoutCapture(fn));
    expect(editor.blocks.transactWithoutCapture).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('splitBlock delegates and returns the new node', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let node: ReturnType<typeof result.current.splitBlock> = null;

    act(() => { node = result.current.splitBlock('a', { text: 'he' }, 'paragraph', { text: 'llo' }, 1); });
    expect(editor.blocks.splitBlock).toHaveBeenCalledWith('a', { text: 'he' }, 'paragraph', { text: 'llo' }, 1);
    expect(node).toMatchObject({ type: 'paragraph' });
  });

  it('insertOutputData inserts a raw OutputBlockData[] batch and returns the created nodes', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insertOutputData> = [];

    act(() => {
      created = result.current.insertOutputData([
        { id: 'r1', type: 'header', data: { text: 'H' } },
        { id: 'r2', type: 'paragraph', data: { text: 'P' }, parent: 'r1' },
      ]);
    });
    expect(editor.blocks.insertMany).toHaveBeenCalledTimes(1);
    expect(created.map((n) => n.id)).toEqual(['r1', 'r2']);
  });

  it('insertOutputData with no index delegates WITHOUT an index, inheriting core end-append', () => {
    // A no-index batch must NOT pass its own index — it inherits core's
    // `blocks.insertMany` default (the document end). Passing one here (e.g. a
    // recomputed `count - 1`) would re-introduce the before-last-block misplace
    // that the core default fix removed. Lock the delegation: exactly one arg.
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }]);
    const { result } = renderHook(() => useBlocks(editor));

    act(() => {
      result.current.insertOutputData([{ id: 'x', type: 'paragraph', data: {} }]);
    });

    const insertManyMock = editor.blocks.insertMany as ReturnType<typeof vi.fn>;
    expect(insertManyMock).toHaveBeenCalledTimes(1);
    expect(insertManyMock.mock.calls[0]).toHaveLength(1);
  });

  it('insert positions the caret in the new block when a caret target is given', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));

    act(() => { result.current.insert({ type: 'paragraph', caret: { offset: 3 } }); });
    // The fake's insert returns id `new-1` (list had length 1).
    expect(editor.caret.setToBlock).toHaveBeenCalledWith('new-1', 'default', 3);
  });

  it('insert does NOT move the caret on an insert-if-absent hit', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));

    act(() => { result.current.insert({ id: 'a', type: 'paragraph', caret: { offset: 2 } }); });
    expect(editor.caret.setToBlock).not.toHaveBeenCalled();
  });

  it('convert positions the caret in the NEW block (convert recreates it under a fresh id)', async () => {
    const { editor } = makeFakeEditor([{ id: 'a', name: 'paragraph' }]);
    const { result } = renderHook(() => useBlocks(editor));

    await act(async () => {
      result.current.convert('a', 'header', undefined, { caret: { position: 'end' } });
      // Flush the convert promise chain (Promise.resolve(convert()).then(setCaret)).
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(editor.blocks.convert).toHaveBeenCalledWith('a', 'header', undefined);
    // Core convert regenerates the block id, so the original 'a' is gone and the
    // caret MUST land on the regenerated id — never the stale 'a'.
    expect(result.current.getById('a')).toBeNull();
    expect(editor.caret.setToBlock).toHaveBeenCalledWith('converted-1', 'end', 0);
    expect(editor.caret.setToBlock).not.toHaveBeenCalledWith('a', 'end', 0);
  });

  it('convert resolves with the converted node carrying the regenerated id', async () => {
    // Convert is creation-by-transform: core's replace() regenerates the id, so a
    // consumer needs the new node to do follow-up work (caret, nest, update). The
    // resolved node must carry the NEW id, not the original.
    const { editor } = makeFakeEditor([{ id: 'a', name: 'paragraph' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let node: BlockNode | null = null;

    await act(async () => {
      node = await result.current.convert('a', 'header');
    });

    expect(node).not.toBeNull();
    expect((node as BlockNode | null)?.type).toBe('header');
    expect((node as BlockNode | null)?.id).not.toBe('a');
  });

  it('convert resolves with null for an unknown id (no convert attempted)', async () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let node: BlockNode | null | 'unset' = 'unset';

    await act(async () => {
      node = await result.current.convert('missing', 'header');
    });

    expect(node).toBeNull();
    expect(editor.blocks.convert).not.toHaveBeenCalled();
  });

  it('insert forwards a non-default caret position (e.g. "end") to setToBlock', () => {
    // The existing caret test only passes { offset: 3 } (position defaults to
    // 'default'). This pins that an explicit position string is forwarded too.
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));

    act(() => { result.current.insert({ type: 'paragraph', caret: { position: 'end' } }); });
    // offset defaults to 0 when omitted.
    expect(editor.caret.setToBlock).toHaveBeenCalledWith('new-1', 'end', 0);
  });

  it('insert forwards caret position "start" with an explicit offset', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));

    act(() => { result.current.insert({ type: 'paragraph', caret: { position: 'start', offset: 2 } }); });
    expect(editor.caret.setToBlock).toHaveBeenCalledWith('new-1', 'start', 2);
  });
});

describe('useBlocks — core-parity additions (insertInsideParent / render / clear / isSyncingFromYjs)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('insertInsideParent creates a child under the parent and returns the new node', () => {
    const { editor } = makeFakeEditor([{ id: 'p' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let node: ReturnType<typeof result.current.insertInsideParent> = null;

    act(() => { node = result.current.insertInsideParent('p', 1, { text: 'child' }); });
    expect(editor.blocks.insertInsideParent).toHaveBeenCalledWith('p', 1, { text: 'child' });
    expect(node).toMatchObject({ type: 'paragraph', parentId: 'p' });
  });

  it('insertInsideParent is a no-op (null) for a dangling parentId, without calling core', () => {
    const { editor } = makeFakeEditor([{ id: 'p' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let node: ReturnType<typeof result.current.insertInsideParent> = { id: 'x' } as never;

    act(() => { node = result.current.insertInsideParent('ghost', 0); });
    expect(node).toBeNull();
    expect(editor.blocks.insertInsideParent).not.toHaveBeenCalled();
  });

  it('insertInsideParent returns null (does not throw) when the child tool is unknown', () => {
    const { editor } = makeFakeEditor([{ id: 'p' }]);

    (editor.blocks.insertInsideParent as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new ToolNotFoundError('nope');
    });
    const { result } = renderHook(() => useBlocks(editor));
    let node: ReturnType<typeof result.current.insertInsideParent> = { id: 'x' } as never;
    let threw = false;

    act(() => {
      try {
        node = result.current.insertInsideParent('p', 0);
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
    expect(node).toBeNull();
  });

  it('insertInsideParent is NOT wrapped in the hook transact (core owns its atomic undo step)', () => {
    const { editor } = makeFakeEditor([{ id: 'p' }]);
    const { result } = renderHook(() => useBlocks(editor));

    act(() => { result.current.insertInsideParent('p', 1); });
    expect(editor.blocks.transact).not.toHaveBeenCalled();
  });

  it('render delegates to core.render', async () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    const data = { blocks: [{ id: 'x', type: 'paragraph', data: { text: 'hi' } }] };

    await act(async () => { await result.current.render(data); });
    expect(editor.blocks.render).toHaveBeenCalledWith(data);
  });

  it('render(doc) re-renders consumers with the new document (not frozen on the cleared doc)', async () => {
    // render() clears the doc (fires 'block changed' on the now-empty list) and
    // then loads the new blocks SILENTLY, signalling only via 'blocks:rendered'.
    // A hook that listens to 'block changed' alone re-renders for the clear and
    // then freezes on the empty document — the new blocks never paint.
    const harness = makeFakeEditor([{ id: 'old' }]);
    const seen: string[][] = [];
    const { result } = renderHook(() => {
      const api = useBlocks(harness.editor);

      seen.push(api.getChildren(null).map((n) => n.id));

      return api;
    });

    // The hook MUST subscribe to the document-load lifecycle, not just mutations.
    expect(harness.renderedListenerCount()).toBe(1);

    await act(async () => {
      await result.current.render({
        blocks: [
          { id: 'n1', type: 'paragraph', data: {} },
          { id: 'n2', type: 'header', data: {} },
        ],
      });
    });

    // The LAST committed snapshot must reflect the new document — NOT the empty
    // doc left by render()'s internal clear().
    expect(seen[seen.length - 1]).toEqual(['n1', 'n2']);
  });

  it('detaches the render-lifecycle listener on unmount (no leak)', () => {
    const harness = makeFakeEditor([{ id: 'a' }]);
    const { unmount } = renderHook(() => useBlocks(harness.editor));

    expect(harness.renderedListenerCount()).toBe(1);
    unmount();
    expect(harness.renderedListenerCount()).toBe(0);
  });

  it('clear delegates to core.clear', async () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));

    await act(async () => { await result.current.clear(); });
    expect(editor.blocks.clear).toHaveBeenCalledTimes(1);
  });

  it('isSyncingFromYjs reads the LIVE core flag (not a stale snapshot)', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));

    expect(result.current.isSyncingFromYjs()).toBe(false);
    // Flip the flag AFTER the api handle is memoized — a live read must see it.
    (editor.blocks as unknown as { isSyncingFromYjs: boolean }).isSyncingFromYjs = true;
    expect(result.current.isSyncingFromYjs()).toBe(true);
  });

  it('pre-ready (null editor): render/clear resolve, insertInsideParent is null, isSyncingFromYjs is false', async () => {
    const { result } = renderHook(() => useBlocks(null));

    expect(result.current.insertInsideParent('p', 0)).toBeNull();
    expect(result.current.isSyncingFromYjs()).toBe(false);
    await expect(result.current.render({ blocks: [] })).resolves.toBeUndefined();
    await expect(result.current.clear()).resolves.toBeUndefined();
  });
});

describe('useBlocks splitBlock — guards and error handling', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('is a no-op (returns null) when currentBlockId is unknown, without calling core', () => {
    // Every other id-taking mutator silently no-ops an unknown id; splitBlock must
    // do the same instead of forwarding a dangling id to core.
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let node: ReturnType<typeof result.current.splitBlock> = { id: 'sentinel' } as never;

    act(() => { node = result.current.splitBlock('ghost', {}, 'paragraph', {}, 0); });
    expect(node).toBeNull();
    expect(editor.blocks.splitBlock).not.toHaveBeenCalled();
  });

  it('is a no-op (returns null) for a negative insertIndex, without calling core', () => {
    // Consistency with insertOutputData, which silently no-ops a negative index
    // rather than forwarding the malformed value to core. A negative insertIndex
    // is meaningless for splitBlock too, so honor the same silent-no-op convention.
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let node: ReturnType<typeof result.current.splitBlock> = { id: 'sentinel' } as never;

    act(() => { node = result.current.splitBlock('a', {}, 'paragraph', {}, -1); });
    expect(node).toBeNull();
    expect(editor.blocks.splitBlock).not.toHaveBeenCalled();
  });

  it('returns null (does not throw) when the new block tool type is unknown', () => {
    // A split into an unknown tool throws a typed ToolNotFoundError from core's
    // compose path — mirror insert/insertTree and honor the null contract.
    const { editor } = makeFakeEditor([{ id: 'a' }]);

    (editor.blocks.splitBlock as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new ToolNotFoundError('nope');
    });
    const { result } = renderHook(() => useBlocks(editor));
    let node: ReturnType<typeof result.current.splitBlock> = { id: 'sentinel' } as never;
    let threw = false;

    act(() => {
      try {
        node = result.current.splitBlock('a', {}, 'nope', {}, 1);
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
    expect(node).toBeNull();
  });

  it('re-throws an UNEXPECTED core error instead of masking it as null (typed, not substring)', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);

    (editor.blocks.splitBlock as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('kaboom: unexpected core failure');
    });
    const { result } = renderHook(() => useBlocks(editor));
    let threw = false;

    act(() => {
      try {
        result.current.splitBlock('a', {}, 'paragraph', {}, 1);
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(true);
  });
});

describe('useBlocks insertOutputData — guards and error handling', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('returns [] and opens no transaction for an empty array', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insertOutputData> =
      ['sentinel'] as unknown as ReturnType<typeof result.current.insertOutputData>;

    act(() => { created = result.current.insertOutputData([]); });
    expect(created).toEqual([]);
    expect(editor.blocks.transact).not.toHaveBeenCalled();
    expect(editor.blocks.insertMany).not.toHaveBeenCalled();
  });

  it('returns [] (does not throw) when a block tool type is unknown', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);

    (editor.blocks.insertMany as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new ToolNotFoundError('nope');
    });
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insertOutputData> =
      ['sentinel'] as unknown as ReturnType<typeof result.current.insertOutputData>;
    let threw = false;

    act(() => {
      try {
        created = result.current.insertOutputData([{ type: 'nope', data: {} }]);
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
    expect(created).toEqual([]);
  });

  it('re-throws an UNEXPECTED core error instead of masking it as []', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);

    (editor.blocks.insertMany as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('kaboom: unexpected core failure');
    });
    const { result } = renderHook(() => useBlocks(editor));
    let threw = false;

    act(() => {
      try {
        result.current.insertOutputData([{ type: 'paragraph', data: {} }]);
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(true);
  });

  it('is a graceful no-op (returns [], no insert, no throw) for a negative index', () => {
    // A negative index is malformed input; core throws a bare validation Error.
    // Honor the silent-no-op convention instead — return [] without inserting.
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insertOutputData> =
      ['sentinel'] as unknown as ReturnType<typeof result.current.insertOutputData>;
    let threw = false;

    act(() => {
      try {
        created = result.current.insertOutputData([{ type: 'paragraph', data: {} }], { index: -1 });
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
    expect(created).toEqual([]);
    expect(editor.blocks.insertMany).not.toHaveBeenCalled();
  });

  it('returns nodes carrying the correct parentId for the explicit-index insert branch', () => {
    // The options.index branch was previously untested. Insert at an explicit
    // index and assert the in-batch parent link is reflected on the returned node.
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let created: ReturnType<typeof result.current.insertOutputData> = [];

    act(() => {
      created = result.current.insertOutputData([
        { id: 'r1', type: 'header', data: {} },
        { id: 'r2', type: 'paragraph', data: {}, parent: 'r1' },
      ], { index: 1 });
    });
    expect(editor.blocks.insertMany).toHaveBeenCalledWith(expect.any(Array), 1);
    expect(created.map((n) => n.id)).toEqual(['r1', 'r2']);
    expect(created.map((n) => n.parentId)).toEqual([null, 'r1']);
  });
});
