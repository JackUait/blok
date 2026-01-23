/**
 * DropTargetDetector - Finds and validates drop targets during drag operations
 */

import type { Block } from '../../../block';
import { DATA_ATTR, createSelector } from '../../../constants';
import type { BlockManager } from '../../blockManager';
import { DRAG_CONFIG } from '../utils/drag.constants';
import { ListItemDepth } from '../utils/ListItemDepth';

export interface DropTarget {
  block: Block;
  edge: 'top' | 'bottom';
  depth: number;
}

export interface ContentRect {
  left: number;
}

export interface UIAdapter {
  contentRect: ContentRect;
}

export interface BlockManagerAdapter {
  getBlockByIndex(index: number): Block | undefined;
  getBlockIndex(block: Block): number;
  blocks: Block[];
}

export class DropTargetDetector {
  private ui: UIAdapter;
  private blockManager: BlockManagerAdapter;
  private sourceBlocks: Block[] = [];
  private listItemDepth: ListItemDepth;

  constructor(ui: UIAdapter, blockManager: BlockManagerAdapter) {
    this.ui = ui;
    this.blockManager = blockManager;
    this.listItemDepth = new ListItemDepth(blockManager as BlockManager);
  }

  /**
   * Set the source blocks to exclude them from being valid targets
   */
  setSourceBlocks(blocks: Block[]): void {
    this.sourceBlocks = blocks;
  }

  /**
   * Finds the drop target block from an element or by checking the left drop zone
   * @param elementUnderCursor - Element directly under the cursor
   * @param clientX - Cursor X position
   * @param clientY - Cursor Y position
   * @returns Object with block and holder, or nulls if no valid target found
   */
  findDropTargetBlock(
    elementUnderCursor: Element,
    clientX: number,
    clientY: number
  ): { block: Block | undefined; holder: HTMLElement | null } {
    // First try: find block holder directly under cursor
    const directHolder = elementUnderCursor.closest(createSelector(DATA_ATTR.element));

    if (directHolder instanceof HTMLElement) {
      const block = this.blockManager.blocks.find(b => b.holder === directHolder);

      return { block, holder: directHolder };
    }

    // Fallback: check if cursor is in the left drop zone
    const leftZoneBlock = this.findBlockInLeftDropZone(clientX, clientY);

    if (leftZoneBlock) {
      return { block: leftZoneBlock, holder: leftZoneBlock.holder };
    }

    return { block: undefined, holder: null };
  }

  /**
   * Finds a block by vertical position when cursor is in the left drop zone
   * Used as a fallback when elementFromPoint doesn't find a block directly
   * @param clientX - Cursor X position
   * @param clientY - Cursor Y position
   * @returns Block at the vertical position, or null if not in left zone or no block found
   */
  findBlockInLeftDropZone(clientX: number, clientY: number): Block | null {
    const contentRect = this.ui.contentRect;
    const leftEdge = contentRect.left;

    // Check if cursor is within left drop zone (between leftEdge - leftDropZone and leftEdge)
    const distanceFromEdge = leftEdge - clientX;

    if (distanceFromEdge < 0 || distanceFromEdge > DRAG_CONFIG.leftDropZone) {
      return null;
    }

    // Find block by Y position
    for (const block of this.blockManager.blocks) {
      // Skip source blocks
      if (this.sourceBlocks.includes(block)) {
        continue;
      }

      const rect = block.holder.getBoundingClientRect();

      if (clientY >= rect.top && clientY <= rect.bottom) {
        return block;
      }
    }

    return null;
  }

  /**
   * Determines the drop target and edge based on cursor position
   * @param elementUnderCursor - Element under cursor
   * @param clientX - Cursor X position
   * @param clientY - Cursor Y position
   * @param sourceBlock - The primary block being dragged
   * @returns Drop target info or null if no valid target
   */
  determineDropTarget(
    elementUnderCursor: Element,
    clientX: number,
    clientY: number,
    sourceBlock: Block
  ): DropTarget | null {
    const { block: targetBlock, holder: blockHolder } = this.findDropTargetBlock(elementUnderCursor, clientX, clientY);

    if (!blockHolder || !targetBlock || targetBlock === sourceBlock) {
      return null;
    }

    // Prevent dropping into the middle of a multi-block selection
    if (this.sourceBlocks.length > 1 && this.sourceBlocks.includes(targetBlock)) {
      return null;
    }

    // Determine edge (top or bottom half of block)
    const rect = blockHolder.getBoundingClientRect();
    const isTopHalf = clientY < rect.top + rect.height / 2;
    const targetIndex = this.blockManager.getBlockIndex(targetBlock);

    // Normalize: convert "top of block N" to "bottom of block N-1" (except for the first block)
    // This ensures we only ever show one indicator per drop position
    const previousBlock = targetIndex > 0
      ? this.blockManager.getBlockByIndex(targetIndex - 1)
      : null;
    const canUsePreviousBlock = previousBlock && !this.sourceBlocks.includes(previousBlock);

    if (isTopHalf && targetIndex > 0 && canUsePreviousBlock) {
      const targetDepth = this.calculateTargetDepth(previousBlock, 'bottom');
      return { block: previousBlock, edge: 'bottom', depth: targetDepth };
    }

    // First block top half, or any block bottom half
    const edge: 'top' | 'bottom' = isTopHalf ? 'top' : 'bottom';
    const targetDepth = this.calculateTargetDepth(targetBlock, edge);

    return { block: targetBlock, edge, depth: targetDepth };
  }

  /**
   * Calculates the target depth for list item nesting
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

    const previousDepth = this.listItemDepth.getDepth(previousBlock) ?? 0;

    // Get the block that will be immediately after the drop position
    const nextBlock = this.blockManager.getBlockByIndex(dropIndex);
    const nextDepth = nextBlock ? (this.listItemDepth.getDepth(nextBlock) ?? 0) : 0;

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
