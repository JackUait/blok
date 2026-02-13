import type { API } from '../../../types';
import type { Block } from '../../components/block';

/**
 * List of block tools that are restricted from being inserted into table cells.
 * These tools create semantic or structural issues when nested in table cells.
 */
export const RESTRICTED_TOOLS = ['header', 'table'];

/**
 * Check if a block or element is inside a table cell.
 * Uses the data-blok-table-cell-blocks attribute to detect cell containers.
 *
 * @param block - Block instance or HTMLElement to check
 * @returns true if inside a table cell, false otherwise
 */
export const isInsideTableCell = (block: Block | HTMLElement | null | undefined): boolean => {
  if (!block) {
    return false;
  }

  const element = block instanceof HTMLElement ? block : block.holder;

  return element.closest('[data-blok-table-cell-blocks]') !== null;
};

/**
 * Check if a tool name is restricted inside table cells.
 *
 * @param toolName - Name of the block tool to check
 * @returns true if the tool is restricted in table cells, false otherwise
 */
export const isRestrictedInTableCell = (toolName: string): boolean => {
  return RESTRICTED_TOOLS.includes(toolName);
};

/**
 * Convert a restricted block to a paragraph block, preserving text content.
 * Replaces the original block in place.
 *
 * @param block - The block to convert
 * @param api - Blok API instance
 * @returns The newly created paragraph block
 * @throws Error if block index cannot be found
 */
export const convertToParagraph = (block: Block, api: API): Block => {
  const text = block.holder.textContent || '';
  const blockIndex = api.blocks.getBlockIndex(block.id);

  if (blockIndex === undefined) {
    throw new Error('Block index not found');
  }

  // Replace with paragraph, preserving text
  return api.blocks.insert(
    'paragraph',
    { text },
    {},
    blockIndex,
    false, // don't focus
    true,  // replace existing
    block.id
  ) as unknown as Block;
};
