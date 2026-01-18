/**
 * Utility for calculating list item nesting depth
 */

import type { Block } from '../../../block';
import type { BlockManager } from '../../blockManager';

export class ListItemDepth {
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
   * Gets the depth of a block.
   * Returns null if the block is not a list item.
   * @param block - Block to check
   * @returns Depth number or null if not a list item
   */
  getDepth(block: Block): number | null {
    return this.getListItemDepth(block);
  }

  /**
   * Calculates the target depth for a block dropped at the given position.
   * This determines what nesting level the block will have after being dropped.
   * @param targetBlock - Block being dropped onto
   * @param targetEdge - Edge of target ('top' or 'bottom')
   * @returns The target depth (0 for root level, 1+ for nested)
   */
  calculateTargetDepth(targetBlock: Block, targetEdge: 'top' | 'bottom'): number {
    const targetIndex = this.blockManager.getBlockIndex(targetBlock);
    const dropIndex = targetEdge === 'top' ? targetIndex : targetIndex + 1;

    // First position always has depth 0
    if (dropIndex === 0) {
      return 0;
    }

    // Get the block that will be immediately before the drop position
    const previousBlock = this.blockManager.getBlockByIndex(dropIndex - 1);

    if (!previousBlock) {
      return 0;
    }

    const previousDepth = this.getListItemDepth(previousBlock) ?? 0;

    // Get the block that will be immediately after the drop position
    const nextBlock = this.blockManager.getBlockByIndex(dropIndex);
    const nextDepth = nextBlock ? (this.getListItemDepth(nextBlock) ?? 0) : 0;

    // If next item is nested, match its depth (become sibling)
    if (nextDepth > 0 && nextDepth <= previousDepth + 1) {
      return nextDepth;
    }

    // If previous item is nested, match its depth
    if (previousDepth > 0) {
      return previousDepth;
    }

    return 0;
  }
}
