/**
 * Mutation-directed tests for moveDestination: 34 of the 42 recorded live
 * mutants die here. The eight that stay alive are equivalent.
 *
 * 1. Line 26, `block === root` replaced by `false`. `Node.contains` counts a
 *    node as its own inclusive descendant, so `root.holder.contains(root.holder)`
 *    is already true and the identity check is pure short-circuit. No pair of
 *    arguments can tell the two versions apart.
 *
 * 2. Line 78, `deduplicatedSources.length === 0` replaced by `false`. The only
 *    inputs that reach the difference are an empty source set, and an empty set
 *    filters down to an empty `sourceRoots`, which the guard on line 96 rejects
 *    with the same `null`.
 *
 * 3-8. The range guard on line 149 and its body. `finalFirstIndex` is provably
 *    inside the array:
 *      - `rawInsertionIndex` is a live `targetIndex` plus zero or one, so it
 *        lies between 0 and `blocks.length`.
 *      - `removedBeforeInsertion` only counts footprint members positioned
 *        before that boundary, so it never exceeds it, which keeps
 *        `finalFirstIndex` at zero or above.
 *      - The boundary equals `blocks.length` only for a bottom drop on the last
 *        block, and then every footprint member sits before it. The footprint
 *        always holds at least the source root itself, so at least one member is
 *        removed and the final index lands at `blocks.length - 1` or lower.
 *    So the body is unreachable: emptying it, forcing the condition to `false`
 *    (whole condition or either operand), and weakening the `||` to `&&` or the
 *    `>=` to `>` are all invisible. Tightening the lower bound to `<= 0` IS
 *    observable and dies on the final-index-of-zero test.
 *
 * Techniques that made the rest observable: a `parentId` accessor with a read
 *  budget, so the three mutants that break the cycle guard die by exception
 *  instead of hanging the worker; two source blocks sharing one holder, the
 *  only way to empty `sourceRoots` past the earlier guards; and a target whose
 *  logical parent chain reaches a source through an undragged intermediate.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hasLogicalSourceAncestor,
  isMoveTargetValid,
  resolveMoveDestination,
} from '../../../../../../src/components/modules/drag/utils/moveDestination';
import type { Block } from '../../../../../../src/components/block';

/**
 * How many `parentId` reads the ancestor walk gets before the fixture calls it
 * a non-terminating loop. The real walk over the cyclic fixture reads twice.
 */
const CYCLE_READ_BUDGET = 50;

interface TestBlock {
  id: string;
  name: string;
  parentId: string | null;
  contentIds: string[];
  holder: HTMLElement;
}

const asBlock = (block: TestBlock): Block => block as unknown as Block;

const createBlock = (
  id: string,
  options: { parentId?: string | null; holder?: HTMLElement } = {}
): TestBlock => ({
  id,
  name: 'paragraph',
  parentId: options.parentId ?? null,
  contentIds: [],
  holder: options.holder ?? document.createElement('div'),
});

interface CyclicPair {
  first: TestBlock;
  second: TestBlock;
  reads: () => number;
}

const createCyclicPair = (): CyclicPair => {
  const state = { reads: 0 };

  const guardedRead = (parentId: string): string => {
    state.reads += 1;

    if (state.reads > CYCLE_READ_BUDGET) {
      throw new Error('parentId read budget exhausted: the ancestor walk never terminated');
    }

    return parentId;
  };

  const make = (id: string, parentId: string): TestBlock => ({
    id,
    name: 'paragraph',
    contentIds: [],
    holder: document.createElement('div'),
    get parentId(): string | null {
      return guardedRead(parentId);
    },
  });

  return {
    first: make('a', 'b'),
    second: make('b', 'a'),
    reads: (): number => state.reads,
  };
};

const nest = (parent: TestBlock, child: TestBlock): void => {
  parent.holder.appendChild(child.holder);
};

describe('moveDestination mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('source roots', () => {
    it('counts a repeated source once', () => {
      const source = createBlock('s');
      const middle = createBlock('a');
      const target = createBlock('t');
      const blocks = [source, middle, target].map(asBlock);

      const destination = resolveMoveDestination(
        blocks,
        [asBlock(source), asBlock(source)],
        asBlock(target),
        'bottom'
      );

      expect(destination?.sourceRoots).toEqual([asBlock(source)]);
    });

    it('keeps only the outermost block of a nested source pair', () => {
      const parent = createBlock('p');
      const child = createBlock('c', { parentId: 'p' });
      const target = createBlock('t');

      nest(parent, child);

      const blocks = [parent, child, target].map(asBlock);

      const destination = resolveMoveDestination(
        blocks,
        [asBlock(parent), asBlock(child)],
        asBlock(target),
        'bottom'
      );

      expect(destination?.sourceRoots).toEqual([asBlock(parent)]);
      expect(destination?.footprint).toEqual([asBlock(parent), asBlock(child)]);
    });

    it('orders the roots by document position, not by selection order', () => {
      const first = createBlock('a');
      const second = createBlock('b');
      const target = createBlock('t');
      const blocks = [first, second, target].map(asBlock);

      const destination = resolveMoveDestination(
        blocks,
        [asBlock(second), asBlock(first)],
        asBlock(target),
        'bottom'
      );

      expect(destination?.sourceRoots).toEqual([asBlock(first), asBlock(second)]);
    });

    it('refuses a set in which no source qualifies as a root', () => {
      const sharedHolder = document.createElement('div');
      const first = createBlock('s1', { holder: sharedHolder });
      const second = createBlock('s2', { holder: sharedHolder });
      const target = createBlock('t');
      const blocks = [first, second, target].map(asBlock);

      expect(
        resolveMoveDestination(
          blocks,
          [asBlock(first), asBlock(second)],
          asBlock(target),
          'top'
        )
      ).toBeNull();
    });
  });

  describe('participant validation', () => {
    it('refuses a target that is not in the block array', () => {
      const source = createBlock('s');
      const middle = createBlock('a');
      const target = createBlock('t');
      const blocks = [source, middle].map(asBlock);

      expect(
        resolveMoveDestination(blocks, [asBlock(source)], asBlock(target), 'bottom')
      ).toBeNull();
    });

    it('refuses the move when one source of several is not in the block array', () => {
      const present = createBlock('s1');
      const absent = createBlock('s2');
      const target = createBlock('t');
      const blocks = [present, createBlock('a'), target].map(asBlock);

      expect(
        resolveMoveDestination(
          blocks,
          [asBlock(present), asBlock(absent)],
          asBlock(target),
          'bottom'
        )
      ).toBeNull();
    });

    it('refuses a target that sits inside the moved footprint', () => {
      const source = createBlock('s');
      const target = createBlock('t');
      const trailing = createBlock('a');

      nest(source, target);

      const blocks = [source, target, trailing].map(asBlock);

      expect(
        resolveMoveDestination(blocks, [asBlock(source)], asBlock(target), 'bottom')
      ).toBeNull();
    });

    it('refuses a target whose logical parent chain reaches a source', () => {
      const source = createBlock('s');
      const middle = createBlock('m', { parentId: 's' });
      const target = createBlock('t', { parentId: 'm' });
      const trailing = createBlock('a');
      const blocks = [source, middle, target, trailing].map(asBlock);

      expect(
        resolveMoveDestination(blocks, [asBlock(source)], asBlock(target), 'bottom')
      ).toBeNull();
    });

    it('accepts a target whose parent id names no live block', () => {
      const source = createBlock('s');
      const target = createBlock('t', { parentId: 'ghost' });
      const trailing = createBlock('a');
      const blocks = [source, target, trailing].map(asBlock);

      const destination = resolveMoveDestination(
        blocks,
        [asBlock(source)],
        asBlock(target),
        'bottom'
      );

      expect(destination?.finalFirstIndex).toBe(1);
    });
  });

  describe('insertion arithmetic', () => {
    it('anchors a top-edge drop on the target index itself', () => {
      const source = createBlock('s');
      const middle = createBlock('a');
      const target = createBlock('t');
      const blocks = [source, middle, target].map(asBlock);

      const destination = resolveMoveDestination(
        blocks,
        [asBlock(source)],
        asBlock(target),
        'top'
      );

      expect(destination?.rawInsertionIndex).toBe(2);
      expect(destination?.finalFirstIndex).toBe(1);
    });

    it('leaves a source that already follows the target where it is', () => {
      const target = createBlock('t');
      const source = createBlock('s');
      const blocks = [target, source].map(asBlock);

      const destination = resolveMoveDestination(
        blocks,
        [asBlock(source)],
        asBlock(target),
        'bottom'
      );

      expect(destination).toMatchObject({
        rawInsertionIndex: 1,
        finalFirstIndex: 1,
        total: 2,
      });
    });

    it('accepts a final index of zero', () => {
      const source = createBlock('s');
      const target = createBlock('t');
      const blocks = [source, target].map(asBlock);

      const destination = resolveMoveDestination(
        blocks,
        [asBlock(source)],
        asBlock(target),
        'top'
      );

      expect(destination?.finalFirstIndex).toBe(0);
    });
  });

  describe('isMoveTargetValid', () => {
    it('accepts a target outside every source subtree', () => {
      const source = createBlock('s');
      const target = createBlock('t');
      const blocks = [source, target].map(asBlock);

      expect(isMoveTargetValid(blocks, [asBlock(source)], asBlock(target))).toBe(true);
    });

    it('rejects a target carried by a source', () => {
      const source = createBlock('s');
      const target = createBlock('t');

      nest(source, target);

      const blocks = [source, target].map(asBlock);

      expect(isMoveTargetValid(blocks, [asBlock(source)], asBlock(target))).toBe(false);
    });
  });

  describe('hasLogicalSourceAncestor', () => {
    it('finds a direct logical parent', () => {
      const source = createBlock('s');
      const child = createBlock('c', { parentId: 's' });
      const blocks = [source, child].map(asBlock);

      expect(hasLogicalSourceAncestor(blocks, [asBlock(source)], asBlock(child))).toBe(true);
    });

    it('walks the chain through an undragged intermediate block', () => {
      const source = createBlock('s');
      const middle = createBlock('m', { parentId: 's' });
      const leaf = createBlock('c', { parentId: 'm' });
      const blocks = [source, middle, leaf].map(asBlock);

      expect(hasLogicalSourceAncestor(blocks, [asBlock(source)], asBlock(leaf))).toBe(true);
    });

    it('reports no ancestor for an unrelated block', () => {
      const source = createBlock('s');
      const other = createBlock('o');
      const blocks = [source, other].map(asBlock);

      expect(hasLogicalSourceAncestor(blocks, [asBlock(source)], asBlock(other))).toBe(false);
    });

    it('stops on a parent-id cycle instead of walking forever', () => {
      const cycle = createCyclicPair();
      const source = createBlock('s');
      const start = createBlock('start', { parentId: 'a' });
      const blocks = [source, cycle.first, cycle.second, start].map(asBlock);

      expect(hasLogicalSourceAncestor(blocks, [asBlock(source)], asBlock(start))).toBe(false);
      expect(cycle.reads()).toBeLessThan(CYCLE_READ_BUDGET);
    });
  });
});
