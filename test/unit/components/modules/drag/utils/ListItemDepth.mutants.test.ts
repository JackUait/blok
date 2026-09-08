import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ListItemDepth } from '../../../../../../src/components/modules/drag/utils/ListItemDepth';

import type { Block } from '../../../../../../src/components/block';
import type { BlockManager } from '../../../../../../src/components/modules/blockManager';

/**
 * Mutant notes for src/components/modules/drag/utils/ListItemDepth.ts
 *
 * PROVEN EQUIVALENT — EqualityOperator on line 58, `previousDepth > 0` widened
 * to `previousDepth >= 0`.
 * The two conditions differ for exactly one value, previousDepth === 0, and
 * there the mutated branch returns `previousDepth` — 0 — which is the same
 * number the untouched fall-through on the last line returns. Every other value
 * takes the same branch under both. So no input can distinguish them.
 */

/** The class reads only these two members of the manager. */
type DepthManager = Pick<BlockManager, 'getBlockIndex' | 'getBlockByIndex'>;

const makeBlock = (depth?: string): Block => {
  const holder = document.createElement('div');

  if (depth !== undefined) {
    holder.setAttribute('data-list-depth', depth);
  }

  const block: Pick<Block, 'holder'> = { holder };

  return block as Block;
};

const makeDepth = (blocks: Block[]): ListItemDepth => {
  const manager: DepthManager = {
    getBlockIndex: (block: Block): number => blocks.indexOf(block),
    // Mirrors BlockManager's repository: index -1 means the LAST block.
    getBlockByIndex: (index: number): Block | undefined => blocks[index === -1 ? blocks.length - 1 : index],
  };

  return new ListItemDepth(manager as BlockManager);
};

describe('ListItemDepth.calculateTargetDepth', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('returns root depth above the first block', () => {
    const first = makeBlock('2');
    const second = makeBlock('3');

    expect(makeDepth([first, second]).calculateTargetDepth(first, 'top')).toBe(0);
  });

  it('matches the depth of the following item when it is nested one level deeper', () => {
    const first = makeBlock('2');
    const second = makeBlock('3');

    expect(makeDepth([first, second]).calculateTargetDepth(first, 'bottom')).toBe(3);
  });

  it('matches the depth of the preceding item when the following one is at root', () => {
    const first = makeBlock('2');
    const second = makeBlock();

    expect(makeDepth([first, second]).calculateTargetDepth(first, 'bottom')).toBe(2);
  });

  it('returns root depth when nothing precedes the drop position', () => {
    const stranded = makeBlock('2');

    // Unknown block: the manager reports index -1, so the drop position has no
    // preceding block at all.
    expect(makeDepth([makeBlock('1')]).calculateTargetDepth(stranded, 'top')).toBe(0);
  });

  it('never returns a negative depth when the preceding item stores one', () => {
    const first = makeBlock('-1');
    const second = makeBlock();

    expect(makeDepth([first, second]).calculateTargetDepth(first, 'bottom')).toBe(0);
  });
});
