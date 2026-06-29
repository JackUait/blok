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
      convert: vi.fn(() => Promise.resolve({})),
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
    // An absolute toIndex pointing into the moved block's own descendant range
    // would make core auto-heal the block under its own child — a cycle that
    // core's guard THROWS on. Guard it as a no-op.
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

  it('move with an absolute toIndex OUTSIDE the block own subtree still delegates', () => {
    const { editor } = makeFakeEditor([
      { id: 'P', name: 'toggle' },
      { id: 'c1', parentId: 'P' },
      { id: 'c2', parentId: 'P' },
      { id: 'tail' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.move('P', { toIndex: 3 })); // index 3 == tail, outside the subtree
    expect(editor.blocks.move).toHaveBeenCalledWith(3, 0);
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
    act(() => result.current.convert('a', 'header', { level: 2 }));
    expect(editor.blocks.convert).toHaveBeenCalledWith('a', 'header', { level: 2 });
  });

  it('is a no-op when the id is unknown (silent getById probe)', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const getBlockIndexSpy = vi.spyOn(editor.blocks, 'getBlockIndex');
    const { result } = renderHook(() => useBlocks(editor));
    act(() => result.current.convert('ghost', 'header'));
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

  it('an idempotent-id hit in the batch returns the existing node and inserts no duplicate', () => {
    // A spec whose explicit id already exists is insert-if-absent: it must NOT
    // create a second block. Only the two genuinely-new specs reach core.insert,
    // yet the returned array still includes the pre-existing node in its slot.
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
    // The existing node is returned in its slot, keeping its ORIGINAL type.
    expect(created).toHaveLength(3);
    expect(created[1]).toMatchObject({ id: 'a', type: 'header' });
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

describe('useBlocks pre-ready API (editor is null)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('mutators are no-ops and read methods return empty/null', () => {
    const { result } = renderHook(() => useBlocks(null));
    expect(result.current.getById('x')).toBeNull();
    expect(result.current.getChildren(null)).toEqual([]);
    expect(result.current.insert({ type: 'paragraph' })).toBeNull();
    expect(result.current.insertMany([{ type: 'paragraph' }])).toEqual([]);
    expect(result.current.move('x', { toIndex: 0 })).toBeUndefined();
    expect(result.current.nest('a', 'b')).toBeUndefined();
    expect(result.current.unnest('a')).toBeUndefined();
    expect(result.current.remove('a')).toBeUndefined();
    expect(result.current.update('a', { text: 'x' })).toBeUndefined();
    expect(result.current.convert('a', 'header')).toBeUndefined();
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
