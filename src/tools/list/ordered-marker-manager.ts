/**
 * Ordered Marker Manager - Handles ordered list marker DOM updates.
 *
 * This class extracts marker update logic for ordered lists from ListItem,
 * making it testable and reusable.
 */

import { TOOL_NAME } from './constants';
import { ListDepthValidator } from './depth-validator';
import { ListMarkerCalculator, type BlocksAPI } from './marker-calculator';
import type { ListItemStyle } from './types';

/**
 * Static state to deduplicate marker updates across all instances.
 * Prevents redundant updates when multiple list items respond to the same event.
 */
const pendingState = { value: false };

/**
 * Reset the pending marker update flag.
 * Called after updates are scheduled.
 */
export const resetPendingMarkerUpdate = (): void => {
  pendingState.value = false;
};

/**
 * Get the current pending marker update state.
 */
export const getPendingMarkerUpdate = (): boolean => pendingState.value;

/**
 * Set the pending marker update flag.
 */
export const setPendingMarkerUpdate = (value: boolean): void => {
  pendingState.value = value;
};

/**
 * Manager for ordered list marker updates.
 * Only instantiated for ordered lists; bullet/checklist use static helpers.
 */
export class OrderedMarkerManager {
  private depthValidator: ListDepthValidator;
  private markerCalculator: ListMarkerCalculator;

  constructor(private blocks: BlocksAPI) {
    this.depthValidator = new ListDepthValidator(blocks);
    this.markerCalculator = new ListMarkerCalculator(blocks);
  }

  /**
   * Update this block's marker element with the correct index.
   *
   * @param blockHolder - The block's holder element
   * @param blockIndex - The block's index
   * @param blockDepth - The block's depth
   */
  updateMarker(blockHolder: HTMLElement, blockIndex: number, blockDepth: number): void {
    const marker = blockHolder.querySelector('[data-list-marker]');
    if (!marker) {
      return;
    }

    const siblingIndex = this.markerCalculator.getSiblingIndex(blockIndex, blockDepth, 'ordered');
    const startValue = this.markerCalculator.getGroupStartValue(blockIndex, blockDepth, siblingIndex, 'ordered');

    // If this is the first item in the group, read its start value from the data attribute
    const actualStartValue = (siblingIndex === 0 && startValue === 1)
      ? (() => {
        const startAttr = blockHolder.querySelector('[data-list-style]')?.getAttribute('data-list-start');
        if (!startAttr) return startValue;
        const parsedStart = parseInt(startAttr, 10);
        return isNaN(parsedStart) ? startValue : parsedStart;
      })()
      : startValue;

    const actualNumber = actualStartValue + siblingIndex;
    const markerText = this.markerCalculator.formatNumber(actualNumber, blockDepth);

    marker.textContent = markerText;
  }

  /**
   * Update markers on all sibling ordered list items.
   * Called when this block is moved to ensure all list numbers are correct.
   * Respects style boundaries - only updates items with the same style.
   *
   * @param currentBlockIndex - Current block's index
   * @param currentDepth - Current block's depth
   */
  updateSiblingMarkers(currentBlockIndex: number, currentDepth: number): void {
    const blocksCount = this.blocks.getBlocksCount();

    // Find the start of this list group by walking backwards (respecting style boundaries)
    const groupStartIndex = this.findListGroupStartIndex(currentBlockIndex, currentDepth, 'ordered');

    // Update all ordered list items from groupStartIndex forward
    this.updateMarkersInRange(groupStartIndex, blocksCount, currentBlockIndex, currentDepth, 'ordered');
  }

  /**
   * Update markers on all ordered list items in the editor.
   * Called when a list item is removed to ensure correct renumbering.
   */
  updateAllMarkers(): void {
    const blocksCount = this.blocks.getBlocksCount();

    for (const i of Array.from({ length: blocksCount }, (_, idx) => idx)) {
      const block = this.blocks.getBlockByIndex(i);
      if (!block || block.name !== TOOL_NAME) {
        continue;
      }

      const blockHolder = block.holder;
      const listItemEl = blockHolder?.querySelector('[data-list-style="ordered"]');
      if (!listItemEl) {
        continue; // Not an ordered list
      }

      this.updateBlockMarker(block);
    }
  }

  /**
   * Schedule an update of all markers for the next frame.
   * Uses a static flag to deduplicate multiple calls in the same frame.
   */
  scheduleUpdateAll(): void {
    // Deduplicate: only schedule one update per frame across all instances
    if (pendingState.value) {
      return;
    }

    pendingState.value = true;
    requestAnimationFrame(() => {
      pendingState.value = false;
      this.updateAllMarkers();
    });
  }

  /**
   * Find the starting index of a list group by walking backwards.
   * Stops at style boundaries at the same depth.
   */
  private findListGroupStartIndex(currentBlockIndex: number, currentDepth: number, currentStyle: ListItemStyle): number {
    return this.markerCalculator.findGroupStart(currentBlockIndex, currentDepth, currentStyle);
  }

  /**
   * Update markers for all list items in a range at the given depth.
   * Stops at style boundaries at the same depth.
   */
  private updateMarkersInRange(
    startIndex: number,
    endIndex: number,
    skipIndex: number,
    targetDepth: number,
    targetStyle: ListItemStyle
  ): void {
    const indices = Array.from({ length: endIndex - startIndex }, (_, idx) => startIndex + idx);

    for (const i of indices) {
      if (i === skipIndex) {
        continue;
      }

      const block = this.blocks.getBlockByIndex(i);
      if (!block || block.name !== TOOL_NAME) {
        return; // Stop when we hit a non-list block
      }

      const blockDepth = this.depthValidator.getBlockDepth(block);
      if (blockDepth < targetDepth) {
        return; // Hit a parent, stop searching forward
      }

      // If at deeper depth, skip it and continue
      if (blockDepth > targetDepth) {
        continue;
      }

      // At same depth - check style boundary
      const blockStyle = this.getBlockStyle(block);
      if (blockStyle !== targetStyle) {
        return; // Style boundary at same depth - stop updating
      }

      // Same depth and same style - update marker and continue
      this.updateBlockMarker(block);
    }
  }

  /**
   * Get the style of a block by reading from its DOM.
   */
  private getBlockStyle(block: ReturnType<BlocksAPI['getBlockByIndex']>): ListItemStyle | null {
    return this.markerCalculator.getBlockStyle(block);
  }

  /**
   * Update the marker of a specific block.
   */
  private updateBlockMarker(block: ReturnType<BlocksAPI['getBlockByIndex']>): void {
    if (!block) {
      return;
    }

    const blockHolder = block.holder;
    const listItemEl = blockHolder?.querySelector('[data-list-style="ordered"]');
    if (!listItemEl) {
      return; // Not an ordered list
    }

    const marker = listItemEl.querySelector('[data-list-marker]');
    if (!marker) {
      return;
    }

    const blockIndex = this.blocks.getBlockIndex(block.id);
    if (blockIndex === undefined || blockIndex === null) {
      return;
    }

    const blockDepth = this.depthValidator.getBlockDepth(block);
    const blockStyle = this.getBlockStyle(block) || 'ordered';
    const siblingIndex = this.markerCalculator.getSiblingIndex(blockIndex, blockDepth, blockStyle);
    const startValue = this.markerCalculator.getGroupStartValue(blockIndex, blockDepth, siblingIndex, blockStyle);

    // If this is the first item in the group, read its start value from the data attribute
    const actualStartValue = (siblingIndex === 0 && startValue === 1)
      ? (() => {
        const startAttr = listItemEl.getAttribute('data-list-start');
        if (!startAttr) return startValue;
        const parsedStart = parseInt(startAttr, 10);
        return isNaN(parsedStart) ? startValue : parsedStart;
      })()
      : startValue;

    const actualNumber = actualStartValue + siblingIndex;
    const markerText = this.markerCalculator.formatNumber(actualNumber, blockDepth);

    marker.textContent = markerText;
  }
}
