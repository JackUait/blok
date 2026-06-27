import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { snapshotNodes, type BlocksReader } from '../../../src/react/blocks-snapshot';

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
