import type { ListItemStyle } from '../list/types';
import { CELL_ATTR } from './table-core';

export const CELL_BLOCKS_ATTR = 'data-blok-table-cell-blocks';

interface MarkdownListTrigger {
  style: ListItemStyle;
  textAfter: string;
}

const MARKDOWN_PATTERNS: Array<{ pattern: RegExp; style: ListItemStyle }> = [
  { pattern: /^-\s(.*)$/, style: 'unordered' },
  { pattern: /^1\.\s(.*)$/, style: 'ordered' },
  { pattern: /^\[\]\s(.*)$/, style: 'checklist' },
];

/**
 * Detect if cell content starts with a markdown list trigger
 * Returns the list style and any text after the trigger, or null if no match
 */
export function detectMarkdownListTrigger(content: string): MarkdownListTrigger | null {
  const trimmed = content.trimStart();

  for (const { pattern, style } of MARKDOWN_PATTERNS) {
    const match = trimmed.match(pattern);

    if (match) {
      return { style, textAfter: match[1] ?? '' };
    }
  }

  return null;
}

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
