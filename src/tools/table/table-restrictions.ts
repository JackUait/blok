import type { Block } from '../../components/block';

/**
 * List of block tools that are restricted from being inserted into table cells.
 * These tools create semantic or structural issues when nested in table cells.
 */
const RESTRICTED_TOOLS = ['header', 'table'];

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

/**
 * Check if a tool name is restricted inside table cells.
 *
 * @param toolName - Name of the block tool to check
 * @returns true if the tool is restricted in table cells, false otherwise
 */
export function isRestrictedInTableCell(toolName: string): boolean {
  return RESTRICTED_TOOLS.includes(toolName);
}
