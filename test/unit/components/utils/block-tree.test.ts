import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dfsOrder,
  flatIndexForPlacement,
  placementImpliedByFlat,
  subtreeEnd
} from '../../../../src/components/utils/block-tree';
import type { BlockTreeView, TreeBlock } from '../../../../src/components/utils/block-tree';

interface Spec {
  id: string;
  parentId?: string | null;
  contentIds?: string[];
}

const tree = (specs: Spec[]): BlockTreeView => {
  const blocks = specs.map(spec => ({ id: spec.id, parentId: spec.parentId ?? null, contentIds: spec.contentIds ?? [] }));
  const byId = new Map(blocks.map(block => [block.id, block]));

  return { blocks, getById: id => byId.get(id) };
};

const ids = (blocks: readonly TreeBlock[]): string[] => blocks.map(block => block.id);

const at = (view: BlockTreeView, id: string): TreeBlock => {
  const block = view.getById(id);

  if (block === undefined) {
    throw new Error(`no block ${id}`);
  }

  return block;
};

/** mulberry32: small, fast, deterministic. */
const rng = (seed: number): () => number => {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** A random forest, flat array in depth-first order, contentIds matching it. */
const randomTree = (random: () => number): BlockTreeView => {
  const specs: Spec[] = [];
  let counter = 0;

  const make = (parentId: string | null, depth: number): string => {
    const spec: Spec = { id: `b${counter++}`, parentId, contentIds: [] };

    specs.push(spec);
    const childCount = depth >= 3 ? 0 : Math.floor(random() * 3.5);

    spec.contentIds = Array.from({ length: childCount }, () => make(spec.id, depth + 1));

    return spec.id;
  };

  const roots = 1 + Math.floor(random() * 4);

  for (let i = 0; i < roots; i++) {
    make(null, 0);
  }

  return tree(specs);
};

const descendantCount = (view: BlockTreeView, block: TreeBlock): number =>
  view.blocks.filter(candidate => candidate.parentId === block.id)
    .reduce((sum, child) => sum + 1 + descendantCount(view, child), 0);

describe('block-tree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('subtreeEnd', () => {
    it('ends right after the last descendant', () => {
      const view = tree([
        { id: 'a' },
        { id: 'b', parentId: 'a' },
        { id: 'c', parentId: 'b' },
        { id: 'd' },
      ]);

      expect(subtreeEnd(view, 0)).toBe(3);
      expect(subtreeEnd(view, 1)).toBe(3);
      expect(subtreeEnd(view, 2)).toBe(3);
      expect(subtreeEnd(view, 3)).toBe(4);
    });

    it('stops at the first block outside the subtree even when later blocks are inside it', () => {
      const view = tree([
        { id: 'a' },
        { id: 'x' },
        { id: 'b', parentId: 'a' },
      ]);

      expect(subtreeEnd(view, 0)).toBe(1);
    });

    it('treats a dangling parent as the end of the chain', () => {
      const view = tree([
        { id: 'a' },
        { id: 'b', parentId: 'ghost' },
      ]);

      expect(subtreeEnd(view, 0)).toBe(1);
    });

    it('does not loop on a parent cycle', () => {
      const view = tree([
        { id: 'a' },
        { id: 'p', parentId: 'q' },
        { id: 'q', parentId: 'p' },
      ]);

      expect(subtreeEnd(view, 0)).toBe(1);
    });

    it('throws for an index outside the array', () => {
      const view = tree([{ id: 'a' }]);

      expect(() => subtreeEnd(view, -1)).toThrow(RangeError);
      expect(() => subtreeEnd(view, 1)).toThrow(RangeError);
    });
  });

  describe('flatIndexForPlacement', () => {
    const view = tree([
      { id: 'a', contentIds: ['b', 'd'] },
      { id: 'b', parentId: 'a', contentIds: ['c'] },
      { id: 'c', parentId: 'b' },
      { id: 'd', parentId: 'a' },
      { id: 'e' },
    ]);

    it('puts a first root at index 0', () => {
      expect(flatIndexForPlacement(view, { parentId: null, afterId: null })).toBe(0);
    });

    it('puts a first child right after its parent', () => {
      expect(flatIndexForPlacement(view, { parentId: 'a', afterId: null })).toBe(1);
      expect(flatIndexForPlacement(view, { parentId: 'd', afterId: null })).toBe(4);
    });

    it('puts a block after its previous sibling\'s whole subtree', () => {
      expect(flatIndexForPlacement(view, { parentId: 'a', afterId: 'b' })).toBe(3);
      expect(flatIndexForPlacement(view, { parentId: null, afterId: 'a' })).toBe(4);
      expect(flatIndexForPlacement(view, { parentId: null, afterId: 'e' })).toBe(5);
    });

    it('throws when afterId is not a child of parentId', () => {
      expect(() => flatIndexForPlacement(view, { parentId: 'a', afterId: 'c' })).toThrow(/not a child/);
      expect(() => flatIndexForPlacement(view, { parentId: null, afterId: 'b' })).toThrow(/not a child/);
    });

    it('throws for an unknown parent or sibling', () => {
      expect(() => flatIndexForPlacement(view, { parentId: 'ghost', afterId: null })).toThrow(/ghost/);
      expect(() => flatIndexForPlacement(view, { parentId: null, afterId: 'ghost' })).toThrow(/ghost/);
    });

    it('throws for a parent the lookup knows but the array does not hold', () => {
      const full = tree([{ id: 'a' }, { id: 'b' }]);
      const rest = { blocks: full.blocks.filter(block => block.id !== 'b'), getById: full.getById };

      expect(() => flatIndexForPlacement(rest, { parentId: 'b', afterId: null })).toThrow(/"b"/);
      expect(() => flatIndexForPlacement(rest, { parentId: null, afterId: 'b' })).toThrow(/"b"/);
    });

    it('reads a sibling with a dangling parent as a root', () => {
      const dangling = tree([{ id: 'a' }, { id: 'b', parentId: 'ghost' }]);

      expect(flatIndexForPlacement(dangling, { parentId: null, afterId: 'b' })).toBe(2);
    });
  });

  describe('dfsOrder', () => {
    it('orders children by contentIds, not by the flat array', () => {
      const view = tree([
        { id: 'a', contentIds: ['c', 'b'] },
        { id: 'b', parentId: 'a' },
        { id: 'c', parentId: 'a' },
      ]);

      expect(ids(dfsOrder(view))).toEqual(['a', 'c', 'b']);
    });

    it('keeps roots in array order', () => {
      const view = tree([
        { id: 'y' },
        { id: 'x' },
      ]);

      expect(ids(dfsOrder(view))).toEqual(['y', 'x']);
    });

    it('appends children missing from contentIds after the listed ones, in flat order', () => {
      const view = tree([
        { id: 'a', contentIds: ['d'] },
        { id: 'b', parentId: 'a' },
        { id: 'c', parentId: 'a' },
        { id: 'd', parentId: 'a' },
      ]);

      expect(ids(dfsOrder(view))).toEqual(['a', 'd', 'b', 'c']);
    });

    it('skips contentIds entries that dangle, repeat, or name a block with another parent', () => {
      const view = tree([
        { id: 'a', contentIds: ['ghost', 'c', 'c', 'x'] },
        { id: 'b', parentId: 'a' },
        { id: 'c', parentId: 'a' },
        { id: 'x' },
      ]);

      expect(ids(dfsOrder(view))).toEqual(['a', 'c', 'b', 'x']);
    });

    it('reads a dangling parent as the root', () => {
      const view = tree([
        { id: 'a', contentIds: [] },
        { id: 'b', parentId: 'ghost' },
      ]);

      expect(ids(dfsOrder(view))).toEqual(['a', 'b']);
    });

    it('appends blocks caught in a parent cycle at the end, in flat order', () => {
      const view = tree([
        { id: 'p', parentId: 'q', contentIds: ['q'] },
        { id: 'a' },
        { id: 'q', parentId: 'p', contentIds: ['p'] },
      ]);

      expect(ids(dfsOrder(view))).toEqual(['a', 'p', 'q']);
    });
  });

  describe('placementImpliedByFlat', () => {
    const view = tree([
      { id: 'a', contentIds: ['b', 'd'] },
      { id: 'b', parentId: 'a', contentIds: ['c'] },
      { id: 'c', parentId: 'b' },
      { id: 'd', parentId: 'a' },
      { id: 'e' },
    ]);

    it('names the previous sibling in flat order', () => {
      expect(placementImpliedByFlat(view, at(view, 'd'))).toEqual({ parentId: 'a', afterId: 'b' });
      expect(placementImpliedByFlat(view, at(view, 'e'))).toEqual({ parentId: null, afterId: 'a' });
    });

    it('names no sibling for a first child or the first root', () => {
      expect(placementImpliedByFlat(view, at(view, 'b'))).toEqual({ parentId: 'a', afterId: null });
      expect(placementImpliedByFlat(view, at(view, 'c'))).toEqual({ parentId: 'b', afterId: null });
      expect(placementImpliedByFlat(view, at(view, 'a'))).toEqual({ parentId: null, afterId: null });
    });

    it('reads a dangling parent as the root', () => {
      const dangling = tree([{ id: 'a' }, { id: 'b', parentId: 'ghost' }]);

      expect(placementImpliedByFlat(dangling, at(dangling, 'b'))).toEqual({ parentId: null, afterId: 'a' });
    });

    it('throws for a block the array does not hold', () => {
      expect(() => placementImpliedByFlat(view, { id: 'z', parentId: null, contentIds: [] })).toThrow(/"z"/);
    });
  });

  describe('seeded random trees', () => {
    const SEEDS = 200;

    it('dfsOrder reproduces a depth-first flat array', () => {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const view = randomTree(rng(seed));

        expect(ids(dfsOrder(view)), `seed ${seed}`).toEqual(ids(view.blocks));
      }
    });

    it('subtreeEnd spans the block and all its descendants', () => {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const view = randomTree(rng(seed));

        view.blocks.forEach((block, index) => {
          expect(subtreeEnd(view, index), `seed ${seed} block ${block.id}`).toBe(index + 1 + descendantCount(view, block));
        });
      }
    });

    it('placing a removed subtree at its implied placement restores the array', () => {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const view = randomTree(rng(seed));

        view.blocks.forEach((block, index) => {
          const end = subtreeEnd(view, index);
          const moving = view.blocks.slice(index, end);
          const rest = { blocks: [...view.blocks.slice(0, index), ...view.blocks.slice(end)], getById: view.getById };
          const target = flatIndexForPlacement(rest, placementImpliedByFlat(view, block));
          const restored = [...rest.blocks.slice(0, target), ...moving, ...rest.blocks.slice(target)];

          expect(ids(restored), `seed ${seed} block ${block.id}`).toEqual(ids(view.blocks));
        });
      }
    });

    it('dfsOrder follows shuffled contentIds', () => {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const random = rng(seed);
        const view = randomTree(random);

        view.blocks.forEach(block => {
          block.contentIds.sort(() => random() - 0.5);
        });

        const expected: string[] = [];
        const walk = (block: TreeBlock): void => {
          expected.push(block.id);
          block.contentIds.forEach(childId => walk(at(view, childId)));
        };

        view.blocks.filter(block => block.parentId === null).forEach(walk);

        expect(ids(dfsOrder(view)), `seed ${seed}`).toEqual(expected);
      }
    });
  });
});
