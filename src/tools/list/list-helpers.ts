/**
 * List Helpers - Helper functions for ListItem operations.
 *
 * Extracted from ListItem to reduce file size.
 */

import { INDENT_PER_LEVEL, TOOL_NAME } from './constants';
import type { ListDepthValidator } from './depth-validator';
import type { BlocksAPI , ListMarkerCalculator } from './marker-calculator';
import type { ListItemStyle } from './types';

/**
 * Get the content element from a list item wrapper
 */
export const getContentElement = (
  element: HTMLElement | null,
  style: ListItemStyle
): HTMLElement | null => {
  if (!element) return null;

  if (style === 'checklist') {
    const contentEditable = element.querySelector('[contenteditable]');
    return contentEditable instanceof HTMLElement ? contentEditable : null;
  }

  const contentContainer = element.querySelector('[data-blok-testid="list-content-container"]');
  return contentContainer instanceof HTMLElement ? contentContainer : null;
}

/**
 * Update the checkbox state for checklist items
 */
export const updateCheckboxState = (
  element: HTMLElement | null,
  checked: boolean
): void => {
  const checkbox = element?.querySelector('input[type="checkbox"]');

  if (!(checkbox instanceof HTMLInputElement)) {
    return;
  }

  checkbox.checked = checked;
}

/**
 * Adjust the depth of a list item to the specified value
 */
export const adjustDepthTo = (
  element: HTMLElement | null,
  data: { depth?: number },
  newDepth: number
): void => {
  // Update the data-list-depth attribute on the wrapper
  if (element) {
    element.setAttribute('data-list-depth', String(newDepth));
  }

  // Update DOM element's indentation
  const listItemEl = element?.querySelector('[role="listitem"]');

  if (listItemEl instanceof HTMLElement) {
    listItemEl.style.marginLeft = newDepth > 0
      ? `${newDepth * INDENT_PER_LEVEL}px`
      : '';
  }

  // Update data depth after DOM updates
  // eslint-disable-next-line no-param-reassign
  data.depth = newDepth;
};

/**
 * Get the depth of a block by reading from its DOM
 */
export const getBlockDepth = (
  block: ReturnType<BlocksAPI['getBlockByIndex']>,
  depthValidator: ListDepthValidator
): number => {
  return depthValidator.getBlockDepth(block);
}

/**
 * Get the style of a block by reading from its DOM
 */
export const getBlockStyle = (
  block: ReturnType<BlocksAPI['getBlockByIndex']>,
  markerCalculator: ListMarkerCalculator
): ListItemStyle | null => {
  return markerCalculator.getBlockStyle(block);
}

/**
 * Get the appropriate bullet character based on nesting depth
 */
export const getBulletCharacter = (
  depth: number,
  markerCalculator: ListMarkerCalculator
): string => {
  return markerCalculator.getBulletCharacter(depth);
}

/**
 * Get the sibling index for marker calculation
 */
export const getSiblingIndex = (
  blockId: string | undefined,
  currentDepth: number,
  style: ListItemStyle,
  blocks: BlocksAPI,
  markerCalculator: ListMarkerCalculator
): number => {
  const currentBlockIndex = blockId
    ? blocks.getBlockIndex(blockId) ?? blocks.getCurrentBlockIndex()
    : blocks.getCurrentBlockIndex();

  if (currentBlockIndex <= 0) {
    return 0;
  }

  return markerCalculator.getSiblingIndex(currentBlockIndex, currentDepth, style);
}

/**
 * Get the starting number for this list group
 */
export const getListStartValue = (
  siblingIndex: number,
  targetDepth: number,
  blockId: string | undefined,
  data: { start?: number; style: ListItemStyle },
  blocks: BlocksAPI,
  markerCalculator: ListMarkerCalculator
): number => {
  if (siblingIndex === 0) {
    return data.start ?? 1;
  }

  const currentBlockIndex = blockId
    ? blocks.getBlockIndex(blockId) ?? blocks.getCurrentBlockIndex()
    : blocks.getCurrentBlockIndex();

  const firstItemIndex = markerCalculator.findFirstItemIndex(
    currentBlockIndex - 1,
    targetDepth,
    siblingIndex,
    data.style
  );
  if (firstItemIndex === null) {
    return 1;
  }

  return markerCalculator.getBlockStartValue(firstItemIndex);
}

/**
 * Get the ordered list marker text based on depth and index
 */
export const getOrderedMarkerText = (
  index: number,
  depth: number,
  data: { start?: number; style: ListItemStyle },
  blockId: string | undefined,
  blocks: BlocksAPI,
  markerCalculator: ListMarkerCalculator
): string => {
  const startValue = getListStartValue(index, depth, blockId, data, blocks, markerCalculator);
  const actualNumber = startValue + index;
  return markerCalculator.formatNumber(actualNumber, depth);
}

/**
 * Find the starting index of a list group by walking backwards
 */
export const findListGroupStartIndex = (
  currentBlockIndex: number,
  currentDepth: number,
  currentStyle: ListItemStyle,
  markerCalculator: ListMarkerCalculator
): number => {
  return markerCalculator.findGroupStart(currentBlockIndex, currentDepth, currentStyle);
}

/**
 * Update the marker of a specific block
 */
export const updateBlockMarker = (
  block: ReturnType<BlocksAPI['getBlockByIndex']>,
  blocks: BlocksAPI,
  depthValidator: ListDepthValidator,
  markerCalculator: ListMarkerCalculator
): void => {
  if (!block) {
    return;
  }

  const blockHolder = block.holder;
  const listItemEl = blockHolder?.querySelector('[data-list-style="ordered"]');
  if (!listItemEl) {
    return;
  }

  const marker = listItemEl.querySelector('[data-list-marker]');
  if (!marker) {
    return;
  }

  const blockIndex = blocks.getBlockIndex(block.id);
  if (blockIndex === undefined || blockIndex === null) {
    return;
  }

  const blockDepth = getBlockDepth(block, depthValidator);
  const blockStyle = getBlockStyle(block, markerCalculator) || 'ordered';
  const siblingIndex = markerCalculator.getSiblingIndex(blockIndex, blockDepth, blockStyle);

  const startValue = markerCalculator.getGroupStartValue(blockIndex, blockDepth, siblingIndex, blockStyle);
  const actualNumber = startValue + siblingIndex;
  const markerText = markerCalculator.formatNumber(actualNumber, blockDepth);

  marker.textContent = markerText;
}

/**
 * Update markers for all list items in a range
 */
export const updateMarkersInRange = (
  startIndex: number,
  endIndex: number,
  skipIndex: number,
  targetDepth: number,
  targetStyle: ListItemStyle,
  blocks: BlocksAPI,
  depthValidator: ListDepthValidator,
  markerCalculator: ListMarkerCalculator
): void => {
  const processBlock = (index: number): void => {
    if (index >= endIndex) {
      return;
    }

    if (index === skipIndex) {
      processBlock(index + 1);
      return;
    }

    const block = blocks.getBlockByIndex(index);
    if (!block || block.name !== TOOL_NAME) {
      return;
    }

    const blockDepth = getBlockDepth(block, depthValidator);
    if (blockDepth < targetDepth) {
      return;
    }

    if (blockDepth > targetDepth) {
      processBlock(index + 1);
      return;
    }

    const blockStyle = getBlockStyle(block, markerCalculator);
    if (blockStyle !== targetStyle) {
      return;
    }

    updateBlockMarker(block, blocks, depthValidator, markerCalculator);

    processBlock(index + 1);
  };

  processBlock(startIndex);
}

/**
 * Update markers on all ordered list items
 */
export const updateAllOrderedListMarkers = (
  blocks: BlocksAPI,
  depthValidator: ListDepthValidator,
  markerCalculator: ListMarkerCalculator
): void => {
  const blocksCount = blocks.getBlocksCount();

  Array.from({ length: blocksCount }, (_, i) => i).forEach(i => {
    const block = blocks.getBlockByIndex(i);
    if (!block || block.name !== TOOL_NAME) {
      return;
    }

    const blockHolder = block.holder;
    const listItemEl = blockHolder?.querySelector('[data-list-style="ordered"]');
    if (!listItemEl) {
      return;
    }

    updateBlockMarker(block, blocks, depthValidator, markerCalculator);
  });
}
