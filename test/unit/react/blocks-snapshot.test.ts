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
});
