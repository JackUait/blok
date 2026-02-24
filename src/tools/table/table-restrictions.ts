import type { API } from '../../../types';
import type { Block } from '../../components/block';

/**
 * Default block tools that are always restricted from being inserted into table cells.
 * These tools create semantic or structural issues when nested in table cells.
 */
const DEFAULT_RESTRICTED_TOOLS = ['header', 'table'];

/**
 * Additional restricted tools registered via table tool config.
 * Users can extend the default list by setting `restrictedTools` in the table tool config.
 */
const additionalRestrictedTools = new Map<string, number>();

/**
 * Register additional tools as restricted in table cells.
 * Called by the Table tool constructor when `restrictedTools` is set in the config.
 *
 * @param tools - Tool names to add to the restricted list
 * @returns Cleanup function to unregister these tools when the owner is destroyed
 */
export const registerAdditionalRestrictedTools = (tools: string[]): (() => void) => {
  const uniqueTools = [...new Set(tools)];

  for (const tool of uniqueTools) {
    const currentCount = additionalRestrictedTools.get(tool) ?? 0;

    additionalRestrictedTools.set(tool, currentCount + 1);
  }

  let isCleanedUp = false;

  return (): void => {
    if (isCleanedUp) {
      return;
    }

    isCleanedUp = true;

    for (const tool of uniqueTools) {
      const currentCount = additionalRestrictedTools.get(tool);

      if (currentCount === undefined) {
        continue;
      }

      if (currentCount <= 1) {
        additionalRestrictedTools.delete(tool);
      } else {
        additionalRestrictedTools.set(tool, currentCount - 1);
      }
    }
  };
};

/**
 * Clear all additional restricted tools.
 * Useful for cleanup when the editor is destroyed or in tests.
 */
export const clearAdditionalRestrictedTools = (): void => {
  additionalRestrictedTools.clear();
};

/**
 * Returns all restricted tool names (default + additional registered via config).
 * Used by the toolbox to hide restricted tools when inside table cells.
 *
 * @returns Array of all restricted tool names
 */
export const getRestrictedTools = (): string[] => {
  return [...DEFAULT_RESTRICTED_TOOLS, ...additionalRestrictedTools.keys()];
};

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
 * Checks both the default restricted list and any additional tools registered via config.
 *
 * @param toolName - Name of the block tool to check
 * @returns true if the tool is restricted in table cells, false otherwise
 */
export const isRestrictedInTableCell = (toolName: string): boolean => {
  return DEFAULT_RESTRICTED_TOOLS.includes(toolName) || additionalRestrictedTools.has(toolName);
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
