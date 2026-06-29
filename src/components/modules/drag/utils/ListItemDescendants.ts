/**
 * Utility for finding nesting descendants of a block.
 *
 * "Descendants" are the consecutive following blocks nested more deeply than the
 * dragged block, using the unified flat list-nesting depth ({@link getBlockNestingDepth}):
 * list items via `data-list-depth`, and any other block via its flat
 * `data-blok-indent`. This lets a Tab-indented paragraph/header travel with its
 * visual parent on drag, matching Notion's structural Tab nesting.
 */

import type { Block } from '../../../block';

import { getBlockNestingDepth } from './depthUtils';

/**
 * Minimal interface for BlockManager dependency
 * Used by ListItemDescendants to access block collection
 */
export interface BlockManagerAdapter {
  blocks: Block[];
  getBlockIndex(block: Block): number;
  getBlockByIndex(index: number): Block | null | undefined;
}

export class ListItemDescendants {
  constructor(private blockManager: BlockManagerAdapter) {}

  /**
   * Gets all descendant list items of a block (direct children and their descendants).
   * Only includes items that are strictly deeper than the dragged item.
   * Stops when encountering a sibling (same depth) or parent (shallower depth).
   * @param block - Parent block to find descendants for
   * @returns Array of descendant blocks (empty if block is not a list item or has no descendants)
   */
  getDescendants(block: Block): Block[] {
    // A root/un-indented block has effective depth 0: it still hosts any
    // following blocks indented under it (depth > 0).
    const parentDepth = getBlockNestingDepth(block) ?? 0;

    const blockIndex = this.blockManager.getBlockIndex(block);

    return this.collectDescendants(blockIndex + 1, parentDepth, []);
  }

  /**
   * Recursively collects descendant blocks
   * @param index - Current block index to check
   * @param parentDepth - Depth of the parent block
   * @param acc - Accumulator for collected descendants
   * @returns Array of descendant blocks
   */
  private collectDescendants(index: number, parentDepth: number, acc: Block[]): Block[] {
    if (index >= this.blockManager.blocks.length) {
      return acc;
    }

    const nextBlock = this.blockManager.getBlockByIndex(index);

    if (!nextBlock) {
      return acc;
    }

    // A root/un-indented follower has effective depth 0.
    const nextDepth = getBlockNestingDepth(nextBlock) ?? 0;

    // Stop at a sibling (same depth) or shallower block — only strictly deeper
    // blocks are nested under the dragged block.
    if (nextDepth <= parentDepth) {
      return acc;
    }

    // Only include items strictly deeper than the parent (children, grandchildren, etc.)
    return this.collectDescendants(index + 1, parentDepth, [...acc, nextBlock]);
  }
}
