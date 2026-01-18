/**
 * Utility for finding descendant list items of a block
 * List items with greater depth are considered descendants
 */

import type { Block } from '../../../block';
import type { BlockManager } from '../../blockManager';

export class ListItemDescendants {
  constructor(private blockManager: BlockManager) {}

  /**
   * Gets the depth of a list item block from its DOM.
   * Returns null if the block is not a list item.
   * @param block - Block to check
   * @returns Depth number or null if not a list item
   */
  private getListItemDepth(block: Block): number | null {
    const listWrapper = block.holder.querySelector('[data-list-depth]');

    if (!listWrapper) {
      return null;
    }

    const depthAttr = listWrapper.getAttribute('data-list-depth');

    return depthAttr ? parseInt(depthAttr, 10) : 0;
  }

  /**
   * Gets all descendant list items of a block (direct children and their descendants).
   * Only includes items that are strictly deeper than the dragged item.
   * Stops when encountering a sibling (same depth) or parent (shallower depth).
   * @param block - Parent block to find descendants for
   * @returns Array of descendant blocks (empty if block is not a list item or has no descendants)
   */
  getDescendants(block: Block): Block[] {
    const parentDepth = this.getListItemDepth(block);

    if (parentDepth === null) {
      return [];
    }

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

    const nextDepth = this.getListItemDepth(nextBlock);

    // Stop if not a list item or depth <= parent depth (sibling or shallower level)
    // A sibling is an item at the same depth - it's not a child of the dragged item
    if (nextDepth === null || nextDepth <= parentDepth) {
      return acc;
    }

    // Only include items strictly deeper than the parent (children, grandchildren, etc.)
    return this.collectDescendants(index + 1, parentDepth, [...acc, nextBlock]);
  }
}
