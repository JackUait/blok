import { CELL_ATTR } from './table-core';

export const CELL_BLOCKS_ATTR = 'data-blok-table-cell-blocks';

/**
 * Check if an element is inside a block-based table cell
 */
export function isInCellBlock(element: HTMLElement): boolean {
  const cellBlocksContainer = element.closest(`[${CELL_BLOCKS_ATTR}]`);

  return cellBlocksContainer !== null;
}

/**
 * Get the cell element that contains the given element
 */
export function getCellFromElement(element: HTMLElement): HTMLElement | null {
  return element.closest(`[${CELL_ATTR}]`) as HTMLElement | null;
}
