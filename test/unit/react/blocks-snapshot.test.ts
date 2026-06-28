import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { snapshotNodes, resolveInsertIndex, resolveMoveIndex, type BlocksReader, type IndexReader } from '../../../src/react/blocks-snapshot';

/** Build a BlocksReader over a fixed flat list of {id,name,parentId}. */
const readerOf = (
  rows: Array<{ id: string; name?: string; parentId?: string | null }>
): BlocksReader => {
  const list = rows.map((r) => ({ id: r.id, name: r.name ?? 'paragraph', parentId: r.parentId ?? null }));
  return {
    getBlocksCount: () => list.length,
    getBlockByIndex: (i: number) => list[i],
  };
};

describe('snapshotNodes', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('returns every block in flat order as a BlockNode', () => {
    const nodes = snapshotNodes(readerOf([
      { id: 'a' },
      { id: 'b', name: 'header' },
    ]));
    expect(nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(nodes[1]).toMatchObject({ id: 'b', type: 'header', parentId: null });
  });

  it('fills contentIds from children that name the node as parent, in flat order', () => {
    const nodes = snapshotNodes(readerOf([
      { id: 'toggle', name: 'toggle' },
      { id: 'c1', parentId: 'toggle' },
      { id: 'c2', parentId: 'toggle' },
      { id: 'root2' },
    ]));
    const toggle = nodes.find((n) => n.id === 'toggle');
    expect(toggle?.contentIds).toEqual(['c1', 'c2']);
    const root2 = nodes.find((n) => n.id === 'root2');
    expect(root2?.contentIds).toEqual([]);
  });
});

const indexReaderOf = (
  rows: Array<{ id: string; name?: string; parentId?: string | null }>
): IndexReader => {
  const list = rows.map((r) => ({ id: r.id, name: r.name ?? 'paragraph', parentId: r.parentId ?? null }));
  return {
    getBlocksCount: () => list.length,
    getBlockByIndex: (i: number) => list[i],
    getBlockIndex: (id: string) => {
      const idx = list.findIndex((b) => b.id === id);
      return idx === -1 ? undefined : idx;
    },
  };
};

describe('resolveInsertIndex', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('root start = 0, root end = block count', () => {
    const r = indexReaderOf([{ id: 'a' }, { id: 'b' }]);
    expect(resolveInsertIndex(r, null, 'start')).toBe(0);
    expect(resolveInsertIndex(r, null, 'end')).toBe(2);
  });

  it('root before/after a sibling resolves to that sibling flat index (+1 for after)', () => {
    const r = indexReaderOf([{ id: 'a' }, { id: 'b' }]);
    expect(resolveInsertIndex(r, null, { before: 'b' })).toBe(1);
    expect(resolveInsertIndex(r, null, { after: 'a' })).toBe(1);
  });

  it('parent end = after the parent last child', () => {
    const r = indexReaderOf([{ id: 'p', name: 'toggle' }, { id: 'c1', parentId: 'p' }, { id: 'after' }]);
    expect(resolveInsertIndex(r, 'p', 'end')).toBe(2);
  });

  it('empty parent end = right after the parent', () => {
    const r = indexReaderOf([{ id: 'p', name: 'toggle' }, { id: 'after' }]);
    expect(resolveInsertIndex(r, 'p', 'end')).toBe(1);
  });

  it('parent end inserts after the last descendant, not the last direct child', () => {
    const r = indexReaderOf([
      { id: 'p', name: 'toggle' },
      { id: 'c1', parentId: 'p' },
      { id: 'g', parentId: 'c1' },
      { id: 'after' },
    ]);
    expect(resolveInsertIndex(r, 'p', 'end')).toBe(3);
  });

  it('{ after } skips the ref entire subtree, not just the ref itself', () => {
    const r = indexReaderOf([
      { id: 'p', name: 'toggle' },
      { id: 'c1', parentId: 'p' },
      { id: 'g', parentId: 'c1' },
      { id: 'tail' },
    ]);
    // after 'p' must land past p's whole subtree (c1, g) → before 'tail'
    expect(resolveInsertIndex(r, null, { after: 'p' })).toBe(3);
  });

  it('{ after } inside a parent skips the ref child subtree', () => {
    const r = indexReaderOf([
      { id: 'p', name: 'toggle' },
      { id: 'c1', parentId: 'p' },
      { id: 'g', parentId: 'c1' },
      { id: 'tail' },
    ]);
    // after sibling 'c1' (a child of p) must skip its descendant 'g'
    expect(resolveInsertIndex(r, 'p', { after: 'c1' })).toBe(3);
  });

  it('{ before } inside a parent resolves to the ref flat index', () => {
    const r = indexReaderOf([
      { id: 'p', name: 'toggle' },
      { id: 'c1', parentId: 'p' },
      { id: 'c2', parentId: 'p' },
    ]);
    expect(resolveInsertIndex(r, 'p', { before: 'c2' })).toBe(2);
  });

  it('before/after a ref in a DIFFERENT parent falls back to the requested parent end', () => {
    const r = indexReaderOf([
      { id: 'p1', name: 'toggle' },
      { id: 'a', parentId: 'p1' },
      { id: 'p2', name: 'toggle' },
      { id: 'b', parentId: 'p2' },
    ]);
    // want a child of p2, but ref 'a' lives in p1 → append at p2 end (index 4)
    expect(resolveInsertIndex(r, 'p2', { after: 'a' })).toBe(4);
    expect(resolveInsertIndex(r, 'p2', { before: 'a' })).toBe(4);
  });

  it('before/after a missing ref falls back to the requested parent end', () => {
    const r = indexReaderOf([
      { id: 'p', name: 'toggle' },
      { id: 'c1', parentId: 'p' },
      { id: 'tail' },
    ]);
    // missing ref → append at the END OF PARENT p (index 2, before 'tail'),
    // NOT the document end (3) — 'tail' makes the two distinguishable.
    expect(resolveInsertIndex(r, 'p', { after: 'nope' })).toBe(2);
  });

  it('root insert before/after a nested ref falls back to root end', () => {
    const r = indexReaderOf([
      { id: 'p', name: 'toggle' },
      { id: 'c1', parentId: 'p' },
      { id: 'root2' },
    ]);
    // ref 'c1' is nested; a root-level insert ignores it → root end (index 3)
    expect(resolveInsertIndex(r, null, { after: 'c1' })).toBe(3);
  });
});

describe('resolveMoveIndex', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('toIndex passthrough, before/after resolve via sibling flat index', () => {
    const r = indexReaderOf([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(resolveMoveIndex(r, { toIndex: 2 })).toBe(2);
    expect(resolveMoveIndex(r, { before: 'c' })).toBe(2);
    expect(resolveMoveIndex(r, { after: 'a' })).toBe(1);
  });

  it('{ after } skips the ref entire subtree', () => {
    const r = indexReaderOf([
      { id: 'p', name: 'toggle' },
      { id: 'c1', parentId: 'p' },
      { id: 'g', parentId: 'c1' },
      { id: 'tail' },
    ]);
    // moving after 'p' must target past p's whole subtree → before 'tail'
    expect(resolveMoveIndex(r, { after: 'p' })).toBe(3);
  });
});
