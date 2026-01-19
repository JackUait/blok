/**
 * ListMarkerCalculator - Handles all marker-related logic for ordered lists.
 *
 * This class extracts the complex marker calculation logic from ListItem,
 * making it testable in isolation without DOM rendering.
 */

import { INDENT_PER_LEVEL, TOOL_NAME } from './constants';
import type { ListItemStyle } from './types';
import { numberToLowerAlpha, numberToLowerRoman } from './utils';

/**
 * Block API interface for accessing blocks
 */
export interface BlocksAPI {
  getBlockByIndex(index: number): { id: string; name: string; holder?: { querySelector(selector: string): Element | null } } | undefined;
  getBlockIndex(id: string): number | undefined;
  getBlocksCount(): number;
  getCurrentBlockIndex(): number;
}

/**
 * Options for getting marker text
 */
export interface MarkerOptions {
  /** Current block index */
  blockIndex: number;
  /** Current depth */
  depth: number;
  /** Current list style */
  style: ListItemStyle;
  /** Start value for the list (defaults to 1) */
  start?: number;
}

/**
 * Calculates marker text and sibling indices for list items.
 * Pure functions that read from the BlocksAPI but don't mutate state.
 */
export class ListMarkerCalculator {
  constructor(private blocks: BlocksAPI) {}

  /**
   * Get the marker text for a list item at a specific position and depth.
   * For unordered lists, returns the bullet character.
   * For ordered lists, returns the numbered marker.
   *
   * @param options - Marker calculation options
   * @returns The marker text (e.g., "1.", "a.", "i.", "•")
   */
  getMarkerText(options: MarkerOptions): string {
    const { blockIndex, depth, style, start } = options;

    if (style !== 'ordered') {
      return this.getBulletCharacter(depth);
    }

    const siblingIndex = this.getSiblingIndex(blockIndex, depth, style);
    const startValue = start ?? this.getGroupStartValue(blockIndex, depth, siblingIndex, style);
    const actualNumber = startValue + siblingIndex;

    return this.formatNumber(actualNumber, depth);
  }

  /**
   * Get the bullet character based on depth (unordered lists)
   */
  getBulletCharacter(depth: number): string {
    const bullets = ['•', '◦', '▪'];
    return bullets[depth % bullets.length];
  }

  /**
   * Calculate the sibling index (0-based) within a consecutive list group.
   * Siblings are consecutive list items at the same depth with the same style.
   *
   * @param blockIndex - The current block's index
   * @param depth - The depth to check for siblings
   * @param style - The list style (must match)
   * @returns The number of preceding siblings at the same depth and style
   */
  getSiblingIndex(blockIndex: number, depth: number, style: ListItemStyle): number {
    if (blockIndex <= 0) {
      return 0;
    }

    return this.countPrecedingAtDepth(blockIndex - 1, depth, style);
  }

  /**
   * Find the starting index of a list group by walking backwards.
   * Stops at style boundaries at the same depth (when encountering a different list style).
   * Items at deeper depths are skipped regardless of their style.
   *
   * @param blockIndex - The starting block index
   * @param depth - The target depth
   * @param style - The target style
   * @returns The starting index of the list group
   */
  findGroupStart(blockIndex: number, depth: number, style: ListItemStyle): number {
    return this.findGroupStartRecursive(blockIndex - 1, blockIndex, depth, style);
  }

  /**
   * Format a number based on depth (decimal, alpha, or roman).
   * Depth 0, 3, 6... → decimal (1, 2, 3...)
   * Depth 1, 4, 7... → alpha (a, b, c...)
   * Depth 2, 5, 8... → roman (i, ii, iii...)
   */
  formatNumber(number: number, depth: number): string {
    const style = depth % 3;

    if (style === 1) {
      return `${numberToLowerAlpha(number)}.`;
    }
    if (style === 2) {
      return `${numberToLowerRoman(number)}.`;
    }
    return `${number}.`;
  }

  /**
   * Get the start value for a list group.
   * Walks back to find the first item in the group and reads its start attribute.
   */
  getGroupStartValue(blockIndex: number, depth: number, siblingIndex: number, style: ListItemStyle): number {
    if (siblingIndex === 0) {
      return 1; // Caller should provide their own start value
    }

    const firstItemIndex = this.findFirstItemIndex(blockIndex - 1, depth, siblingIndex, style);
    if (firstItemIndex === null) {
      return 1;
    }

    return this.getBlockStartValue(firstItemIndex);
  }

  /**
   * Get the start value from a block's data-list-start attribute.
   */
  getBlockStartValue(blockIndex: number): number {
    const block = this.blocks.getBlockByIndex(blockIndex);
    if (!block) {
      return 1;
    }

    const startAttr = block.holder?.querySelector('[data-list-style]')?.getAttribute('data-list-start');
    return startAttr ? parseInt(startAttr, 10) : 1;
  }

  /**
   * Find the index of the first list item in a consecutive group.
   * Walks backwards counting items at the same depth and style.
   */
  findFirstItemIndex(index: number, targetDepth: number, remainingCount: number, targetStyle?: ListItemStyle): number | null {
    if (index < 0 || remainingCount <= 0) {
      return index + 1;
    }

    const block = this.blocks.getBlockByIndex(index);
    if (!block || block.name !== TOOL_NAME) {
      return index + 1;
    }

    const blockDepth = this.getBlockDepth(block);
    if (blockDepth < targetDepth) {
      return index + 1;
    }

    // If at deeper depth, skip it and continue
    if (blockDepth > targetDepth) {
      return this.findFirstItemIndex(index - 1, targetDepth, remainingCount, targetStyle);
    }

    // At same depth - check style boundary
    const blockStyle = this.getBlockStyle(block);
    if (targetStyle !== undefined && blockStyle !== targetStyle) {
      return index + 1;
    }

    // Same depth and same style - decrement count and continue
    return this.findFirstItemIndex(index - 1, targetDepth, remainingCount - 1, targetStyle);
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

  /**
   * Get the style of a block by reading from its DOM.
   */
  getBlockStyle(block: ReturnType<BlocksAPI['getBlockByIndex']>): ListItemStyle | null {
    if (!block) {
      return null;
    }

    const style = block.holder?.querySelector('[data-list-style]')?.getAttribute('data-list-style');
    return this.isValidListItemStyle(style) ? style : null;
  }

  /**
   * Type guard to check if a string is a valid ListItemStyle.
   */
  private isValidListItemStyle(style: string | null | undefined): style is ListItemStyle {
    return style === 'unordered' || style === 'ordered' || style === 'checklist';
  }

  /**
   * Recursively count preceding list items at the given depth and style starting from index.
   */
  private countPrecedingAtDepth(index: number, targetDepth: number, targetStyle: ListItemStyle): number {
    if (index < 0) {
      return 0;
    }

    const block = this.blocks.getBlockByIndex(index);
    if (!block || block.name !== TOOL_NAME) {
      return 0;
    }

    const blockDepth = this.getBlockDepth(block);
    if (blockDepth < targetDepth) {
      return 0;
    }

    // If at deeper depth, skip it and continue
    if (blockDepth > targetDepth) {
      return this.countPrecedingAtDepth(index - 1, targetDepth, targetStyle);
    }

    // At same depth - check style boundary
    const blockStyle = this.getBlockStyle(block);
    if (blockStyle !== targetStyle) {
      return 0;
    }

    // Same depth and same style - count it and continue
    return 1 + this.countPrecedingAtDepth(index - 1, targetDepth, targetStyle);
  }

  /**
   * Recursively find the start of a list group.
   */
  private findGroupStartRecursive(index: number, startIndex: number, depth: number, style: ListItemStyle): number {
    if (index < 0) {
      return startIndex;
    }

    const block = this.blocks.getBlockByIndex(index);
    if (!block || block.name !== TOOL_NAME) {
      return startIndex;
    }

    const blockDepth = this.getBlockDepth(block);
    if (blockDepth < depth) {
      return startIndex; // Hit a parent, stop
    }

    // If at deeper depth, skip it and continue
    if (blockDepth > depth) {
      return this.findGroupStartRecursive(index - 1, startIndex, depth, style);
    }

    // At same depth - check style boundary
    const blockStyle = this.getBlockStyle(block);
    if (blockStyle !== style) {
      return startIndex;
    }

    // Same depth and same style - update startIndex and continue
    return this.findGroupStartRecursive(index - 1, index, depth, style);
  }
}
