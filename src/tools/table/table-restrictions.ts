import type { Block } from '../../components/block';

/**
 * Check if a block or element is inside a table cell.
 * Uses the data-blok-table-cell-blocks attribute to detect cell containers.
 *
 * @param block - Block instance or HTMLElement to check
 * @returns true if inside a table cell, false otherwise
 */
export function isInsideTableCell(block: Block | HTMLElement | null | undefined): boolean {
  if (!block) {
    return false;
  }

  const element = block instanceof HTMLElement ? block : block.holder;

  return element.closest('[data-blok-table-cell-blocks]') !== null;
}
