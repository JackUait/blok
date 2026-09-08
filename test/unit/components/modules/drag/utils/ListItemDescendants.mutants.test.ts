import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ListItemDescendants } from '../../../../../../src/components/modules/drag/utils/ListItemDescendants';

import type { BlockManagerAdapter } from '../../../../../../src/components/modules/drag/utils/ListItemDescendants';
import type { Block } from '../../../../../../src/components/block';

/**
 * Mutant notes for src/components/modules/drag/utils/ListItemDescendants.ts
 *
 * PROVEN EQUIVALENT — the three mutants on line 53 that delete or weaken the
 * `index >= this.blockManager.blocks.length` guard (ConditionalExpression
 * false, BlockStatement {}, and EqualityOperator `index > ...length`).
 * Falling past that guard immediately runs
 * `const nextBlock = this.blockManager.getBlockByIndex(index)` followed by
 * `if (!nextBlock) return acc`. For any adapter whose `blocks` array IS the
 * collection `getBlockByIndex` indexes — the real BlockManager reads
 * `blocksStore[index]` while `blocks` returns `blocksStore.array` — a lookup at
 * an index at or past `blocks.length` yields undefined, so the second guard
 * returns the same accumulator the first one would have. The length check is a
 * fast path, not a decision. Distinguishing the mutants needs an adapter that
 * resolves a block OUTSIDE its own `blocks` array, which contradicts `blocks`
 * being that collection. The mirror case IS declared and is tested below:
 * `getBlockByIndex` returns `Block | null | undefined`, so an adapter may
 * fail to resolve an index that sits inside `blocks` — nothing grants the
 * reverse.
 */

const makeBlock = (listDepth?: string, blokDepth?: string): Block => {
  const holder = document.createElement('div');

  if (listDepth !== undefined) {
    holder.setAttribute('data-list-depth', listDepth);
  }

  if (blokDepth !== undefined) {
    holder.setAttribute('data-blok-depth', blokDepth);
  }

  const block: Pick<Block, 'holder'> = { holder };

  return block as Block;
};

/**
 * `unresolvedIndex` models the nullable half of BlockManagerAdapter: a lookup
 * the adapter cannot answer even though the index is inside `blocks`.
 */
const makeDescendants = (blocks: Block[], unresolvedIndex?: number): ListItemDescendants => {
  const adapter: BlockManagerAdapter = {
    blocks,
    getBlockIndex: (block: Block): number => blocks.indexOf(block),
    getBlockByIndex: (index: number): Block | null | undefined => (
      index === unresolvedIndex ? null : blocks[index]
    ),
  };

  return new ListItemDescendants(adapter);
};

describe('ListItemDescendants.getDescendants', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('collects the deeper followers and stops at the next sibling', () => {
    const parent = makeBlock('1');
    const child = makeBlock('2');
    const grandChild = makeBlock('3');
    const sibling = makeBlock('1');

    const descendants = makeDescendants([parent, child, grandChild, sibling]).getDescendants(parent);

    expect(descendants).toStrictEqual([child, grandChild]);
  });

  it('treats a shallower follower as no descendant at all', () => {
    const parent = makeBlock('2');
    const shallower = makeBlock('1');

    expect(makeDescendants([parent, shallower]).getDescendants(parent)).toStrictEqual([]);
  });

  it('lets an un-indented block host the blocks indented under it', () => {
    const parent = makeBlock();
    const indented = makeBlock(undefined, '1');
    const following = makeBlock();

    expect(makeDescendants([parent, indented, following]).getDescendants(parent)).toStrictEqual([indented]);
  });

  it('stops when the manager cannot resolve the next index', () => {
    const parent = makeBlock('1');
    const child = makeBlock('2');
    const grandChild = makeBlock('3');

    expect(makeDescendants([parent, child, grandChild], 1).getDescendants(parent)).toStrictEqual([]);
  });

  it('returns nothing at the end of the document', () => {
    const parent = makeBlock('1');

    expect(makeDescendants([parent]).getDescendants(parent)).toStrictEqual([]);
  });
});
