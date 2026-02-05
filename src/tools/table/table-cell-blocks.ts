import type { API } from '../../../types';
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
export const detectMarkdownListTrigger = (content: string): MarkdownListTrigger | null => {
  const trimmed = content.trimStart();

  for (const { pattern, style } of MARKDOWN_PATTERNS) {
    const match = trimmed.match(pattern);

    if (match) {
      return { style, textAfter: match[1] ?? '' };
    }
  }

  return null;
};

/**
 * Check if an element is inside a block-based table cell
 */
export const isInCellBlock = (element: HTMLElement): boolean => {
  const cellBlocksContainer = element.closest(`[${CELL_BLOCKS_ATTR}]`);

  return cellBlocksContainer !== null;
};

/**
 * Get the cell element that contains the given element
 */
export const getCellFromElement = (element: HTMLElement): HTMLElement | null => {
  return element.closest<HTMLElement>(`[${CELL_ATTR}]`);
};

interface CellPosition {
  row: number;
  col: number;
}

interface TableCellBlocksOptions {
  api: API;
  gridElement: HTMLElement;
  tableBlockId: string;
}

/**
 * Manages nested blocks within table cells.
 * Handles markdown triggers, block lifecycle, and keyboard navigation.
 */
export class TableCellBlocks {
  private api: API;
  private gridElement: HTMLElement;
  private tableBlockId: string;
  private _activeCellWithBlocks: CellPosition | null = null;

  constructor(options: TableCellBlocksOptions) {
    this.api = options.api;
    this.gridElement = options.gridElement;
    this.tableBlockId = options.tableBlockId;
  }

  /**
   * Get the currently active cell that contains blocks
   */
  get activeCellWithBlocks(): CellPosition | null {
    return this._activeCellWithBlocks;
  }

  /**
   * Set the active cell with blocks (when focus enters a nested block)
   */
  setActiveCellWithBlocks(position: CellPosition): void {
    this._activeCellWithBlocks = position;
  }

  /**
   * Clear the active cell tracking (when focus leaves nested blocks)
   */
  clearActiveCellWithBlocks(): void {
    this._activeCellWithBlocks = null;
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    this._activeCellWithBlocks = null;
  }
}
