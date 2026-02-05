import type { API } from '../../../types';
import type { ListItemData, ListItemStyle } from '../list/types';

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
   * Convert a plain text cell to a block-based cell
   * @returns The cell content object with block IDs
   */
  async convertCellToBlocks(
    cell: HTMLElement,
    style: ListItemStyle,
    initialText: string
  ): Promise<{ blocks: string[] }> {
    // Remove contenteditable from cell
    cell.setAttribute('contenteditable', 'false');
    cell.innerHTML = '';

    // Create blocks container
    const container = document.createElement('div');

    container.setAttribute(CELL_BLOCKS_ATTR, '');
    cell.appendChild(container);

    // Create the first list item block
    const listItemData: ListItemData = {
      text: initialText,
      style,
      depth: 0,
    };

    // Insert the block (this creates it in BlockManager)
    const block = this.api.blocks.insert(
      'listItem',
      listItemData,
      {},
      undefined, // index - append at end
      true // needToFocus
    );

    // The block's DOM will be mounted by the BlockManager
    // We need to move it into our container
    // For now, return the block ID - actual DOM mounting will be handled in integration

    return { blocks: [block.id] };
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    this._activeCellWithBlocks = null;
  }
}
