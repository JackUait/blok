/**
 * ListDepthValidator - Handles depth validation and hierarchy rules for list items.
 *
 * This class extracts the depth validation logic from ListItem,
 * making it testable in isolation without DOM rendering.
 */

import { TOOL_NAME, INDENT_PER_LEVEL } from './constants';
import type { BlocksAPI } from './marker-calculator';

/**
 * Depth validation options
 */
export interface DepthValidationOptions {
  /** Current block index */
  blockIndex: number;
  /** Current depth */
  currentDepth: number;
}

/**
 * Validates and adjusts depth values for list items.
 * Pure functions that read from the BlocksAPI but don't mutate state.
 */
export class ListDepthValidator {
  constructor(private blocks: BlocksAPI) {}

  /**
   * Calculate the maximum allowed depth at a given block index.
   *
   * Rules:
   * 1. First item (index 0) must be at depth 0
   * 2. For other items: maxDepth = previousListItem.depth + 1
   * 3. If previous block is not a list item, maxDepth = 0
   *
   * @param blockIndex - The index of the block
   * @returns The maximum allowed depth (0 or more)
   */
  getMaxAllowedDepth(blockIndex: number): number {
    // First item must be at depth 0
    if (blockIndex === 0) {
      return 0;
    }

    const previousBlock = this.blocks.getBlockByIndex(blockIndex - 1);

    // If previous block doesn't exist or isn't a list item, max depth is 0
    if (!previousBlock || previousBlock.name !== TOOL_NAME) {
      return 0;
    }

    // Max depth is previous item's depth + 1
    const previousBlockDepth = this.getBlockDepth(previousBlock);

    return previousBlockDepth + 1;
  }

  /**
   * Calculate the target depth for a list item dropped at the given index.
   * When dropping into a nested context, the item should match the sibling's depth.
   *
   * @param options - Depth validation options
   * @returns The target depth for the dropped item
   */
  getTargetDepthForMove(options: DepthValidationOptions): number {
    const { blockIndex, currentDepth } = options;
    const maxAllowedDepth = this.getMaxAllowedDepth(blockIndex);

    // If current depth exceeds max, cap it
    if (currentDepth > maxAllowedDepth) {
      return maxAllowedDepth;
    }

    // Check if we're inserting before a list item (next block)
    const nextBlock = this.blocks.getBlockByIndex(blockIndex + 1);
    const nextIsListItem = nextBlock && nextBlock.name === TOOL_NAME;
    const nextBlockDepth = nextIsListItem ? this.getBlockDepth(nextBlock) : 0;

    // If next block is a deeper list item, match its depth (become a sibling)
    // This prevents breaking list structure by inserting a shallower item
    const shouldMatchNextDepth = nextIsListItem
      && nextBlockDepth > currentDepth
      && nextBlockDepth <= maxAllowedDepth;

    if (shouldMatchNextDepth) {
      return nextBlockDepth;
    }

    // Check if previous block is a list item at a deeper level
    const previousBlock = blockIndex > 0 ? this.blocks.getBlockByIndex(blockIndex - 1) : undefined;
    const previousIsListItem = previousBlock && previousBlock.name === TOOL_NAME;
    const previousBlockDepth = previousIsListItem ? this.getBlockDepth(previousBlock) : 0;

    // If previous block is deeper and there's no next list item to guide us,
    // match the previous block's depth (append as sibling in the nested list)
    const shouldMatchPreviousDepth = previousIsListItem
      && !nextIsListItem
      && previousBlockDepth > currentDepth
      && previousBlockDepth <= maxAllowedDepth;

    if (shouldMatchPreviousDepth) {
      return previousBlockDepth;
    }

    return currentDepth;
  }

  /**
   * Validate if a depth is valid at the given position.
   *
   * @param blockIndex - The index of the block
   * @param depth - The depth to validate
   * @returns true if the depth is valid, false otherwise
   */
  isValidDepth(blockIndex: number, depth: number): boolean {
    const maxAllowedDepth = this.getMaxAllowedDepth(blockIndex);
    return depth >= 0 && depth <= maxAllowedDepth;
  }

  /**
   * Get the depth of a block by reading from its DOM.
   */
  getBlockDepth(block: ReturnType<BlocksAPI['getBlockByIndex']>): number {
    if (!block) {
      return 0;
    }

    const styleAttr = block.holder?.querySelector('[role="listitem"]')?.getAttribute('style');
    const marginMatch = styleAttr?.match(/margin-left:\s*(\d+)px/);
    return marginMatch ? Math.round(parseInt(marginMatch[1], 10) / INDENT_PER_LEVEL) : 0;
  }
}
