/**
 * Indicator-vs-drop depth PARITY guard.
 *
 * The drag drop-indicator predicts a nesting depth (DropTargetDetector
 * .calculateTargetDepth) and, for a dragged LIST item, the actual drop applies a
 * depth via the list tool's moved() hook (ListDepthValidator.getTargetDepthForMove).
 * If these two ever disagree the indicator LIES — it previews one depth while the
 * block lands at another. That is the exact class of bug behind "nest from the
 * bottom" and "list item dropped after a paragraph previews at root but lands
 * nested".
 *
 * This test drives BOTH real public entry points over the full matrix of
 * neighbour configurations and asserts they agree for every one. It must keep
 * passing forever: if anyone re-forks the depth rule into two implementations
 * that drift, this fails loudly. (For non-list sources the applied indent IS the
 * indicator value — same calculateTargetDepth call — so parity is structural and
 * needs no separate guard.)
 */

import { describe, it, expect } from 'vitest';
import { DropTargetDetector } from '../../../../../src/components/modules/drag/target/DropTargetDetector';
import type { BlockManagerAdapter } from '../../../../../src/components/modules/drag/target/DropTargetDetector';
import { ListDepthValidator } from '../../../../../src/tools/list/depth-validator';
import type { BlocksAPI } from '../../../../../src/tools/list/marker-calculator';
import type { Block } from '../../../../../src/components/block';
import { DATA_ATTR } from '../../../../../src/components/constants';

/** A neighbour around the drop slot: either absent, a list item at a depth, or a non-list block. */
type Neighbour = { kind: 'none' } | { kind: 'list'; depth: number } | { kind: 'other' };

const NEIGHBOURS: Neighbour[] = [
  { kind: 'none' },
  { kind: 'other' },
  { kind: 'list', depth: 0 },
  { kind: 'list', depth: 1 },
  { kind: 'list', depth: 2 },
];
const SOURCE_DEPTHS = [0, 1, 2, 3];

/** Build a DropTargetDetector list-item indicator block (depth via data-list-depth). */
const indicatorListBlock = (id: string, depth: number): Block => {
  const holder = document.createElement('div');
  holder.setAttribute(DATA_ATTR.element, 'block');
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-list-depth', String(depth));
  holder.appendChild(wrapper);

  return { id, holder, name: 'list', stretched: false } as Block;
};

/** Build a DropTargetDetector non-list indicator block. */
const indicatorOtherBlock = (id: string): Block => {
  const holder = document.createElement('div');
  holder.setAttribute(DATA_ATTR.element, 'block');

  return { id, holder, name: 'paragraph', stretched: false } as Block;
};

/** An indicator block for a neighbour, or undefined when the neighbour is absent. */
const indicatorNeighbour = (n: Neighbour, id: string): Block | undefined => {
  if (n.kind === 'list') {
    return indicatorListBlock(id, n.depth);
  }
  if (n.kind === 'other') {
    return indicatorOtherBlock(id);
  }

  return undefined;
};

/**
 * The depth the INDICATOR previews for a dragged list item dropped at the bottom
 * edge of `previous` (so the slot sits between `previous` and `next`).
 */
const indicatorDepth = (previous: Neighbour, next: Neighbour, sourceDepth: number): number => {
  // target == the "previous" block; bottom edge → dropIndex = targetIndex + 1, so
  // calculateTargetDepth reads previous = index 0 (the target) and next = index 1.
  // ('none' previous can't be a bottom-edge target; the matrix skips it.)
  const previousBlock = indicatorNeighbour(previous, 'prev') ?? indicatorOtherBlock('prev');
  const nextBlock = indicatorNeighbour(next, 'next');
  const source = indicatorListBlock('source', sourceDepth);

  const byIndex: (Block | undefined)[] = [previousBlock, nextBlock];
  const blockManager: BlockManagerAdapter = {
    blocks: [previousBlock, ...(nextBlock ? [nextBlock] : [])],
    getBlockByIndex: (index: number) => byIndex[index],
    getBlockIndex: () => 0,
    getBlockById: () => undefined,
  };
  const detector = new DropTargetDetector({ contentRect: { left: 0 } }, blockManager);

  return detector.calculateTargetDepth(previousBlock, 'bottom', source);
};

/** Build a ListDepthValidator block (depth via [role=listitem] margin-left). */
const validatorBlock = (kind: 'list' | 'other', depth: number): ReturnType<BlocksAPI['getBlockByIndex']> => {
  const roleItem = document.createElement('div');
  roleItem.setAttribute('role', 'listitem');
  if (depth > 0) {
    roleItem.style.marginLeft = `${depth * 27}px`;
  }

  return {
    id: `${kind}-${Math.random()}`,
    name: kind === 'list' ? 'list' : 'paragraph',
    holder: { querySelector: (s: string) => (s === '[role="listitem"]' ? roleItem : null) },
  };
};

/**
 * The depth the DROP applies (list moved() → getTargetDepthForMove) for a list
 * item moved into the same slot between `previous` and `next`.
 */
const appliedDepth = (previous: Neighbour, next: Neighbour, sourceDepth: number): number => {
  // blocks = [previous, moved-placeholder, next]; the moved block sits at index 1,
  // so getTargetDepthForMove reads previous=index0 and next=index2.
  const prev = previous.kind === 'list'
    ? validatorBlock('list', previous.depth)
    : validatorBlock('other', 0);
  const placeholder = validatorBlock('list', sourceDepth);
  const blocks: ReturnType<BlocksAPI['getBlockByIndex']>[] = [prev, placeholder];
  if (next.kind === 'list') {
    blocks.push(validatorBlock('list', next.depth));
  } else if (next.kind === 'other') {
    blocks.push(validatorBlock('other', 0));
  }

  const blocksAPI: BlocksAPI = {
    getBlockByIndex: (index: number) => blocks[index] ?? undefined,
    getBlockIndex: () => 0,
    getBlocksCount: () => blocks.length,
    getCurrentBlockIndex: () => 0,
  };

  return new ListDepthValidator(blocksAPI).getTargetDepthForMove({ blockIndex: 1, currentDepth: sourceDepth });
};

/** Every (previous, next, sourceDepth) combination — 'previous' must be a real block. */
const SCENARIOS: { previous: Neighbour; next: Neighbour; sourceDepth: number }[] =
  NEIGHBOURS
    .filter((previous) => previous.kind !== 'none')
    .flatMap((previous) =>
      NEIGHBOURS.flatMap((next) =>
        SOURCE_DEPTHS.map((sourceDepth) => ({ previous, next, sourceDepth }))
      )
    );

describe('drag indicator depth == applied drop depth (list-item source parity)', () => {
  it('never previews a depth different from the one the drop applies', () => {
    const mismatches = SCENARIOS
      .map(({ previous, next, sourceDepth }) => ({
        previous, next, sourceDepth,
        indicator: indicatorDepth(previous, next, sourceDepth),
        applied: appliedDepth(previous, next, sourceDepth),
      }))
      .filter((r) => r.indicator !== r.applied)
      .map((r) =>
        `prev=${JSON.stringify(r.previous)} next=${JSON.stringify(r.next)} source=${r.sourceDepth}: indicator=${r.indicator} applied=${r.applied}`
      );

    expect(mismatches, `\n${mismatches.join('\n')}\n`).toEqual([]);
  });
});
