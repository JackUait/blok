import type { API } from '../../../types';
import { DATA_ATTR } from '../../components/constants';
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

interface CellNavigationCallback {
  (position: CellPosition): void;
}

interface TableCellBlocksOptions {
  api: API;
  gridElement: HTMLElement;
  tableBlockId: string;
  onNavigateToCell?: CellNavigationCallback;
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
  private onNavigateToCell?: CellNavigationCallback;
  private cellBlocksObserver: MutationObserver | null = null;

  constructor(options: TableCellBlocksOptions) {
    this.api = options.api;
    this.gridElement = options.gridElement;
    this.tableBlockId = options.tableBlockId;
    this.onNavigateToCell = options.onNavigateToCell;
    this.observeCellBlockContainers();
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
    // eslint-disable-next-line no-param-reassign
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

    // Insert the block (this creates it in BlockManager, initially in the main editor)
    const block = this.api.blocks.insert(
      'list',
      listItemData,
      {},
      undefined, // index - append at end
      true // needToFocus
    );

    // Move the block's holder from the main editor into the cell container
    container.appendChild(block.holder);

    // Focus the list item's contenteditable so subsequent keystrokes go into it
    const editable = block.holder.querySelector<HTMLElement>('[contenteditable="true"]');

    if (editable) {
      editable.focus();
    }

    return { blocks: [block.id] };
  }

  /**
   * Handle input event on a cell to detect markdown triggers
   */
  async handleCellInput(cell: HTMLElement): Promise<void> {
    // Skip if cell already has blocks
    if (cell.querySelector(`[${CELL_BLOCKS_ATTR}]`)) {
      return;
    }

    // Skip if not contenteditable
    if (cell.getAttribute('contenteditable') !== 'true') {
      return;
    }

    const content = cell.textContent ?? '';
    const trigger = detectMarkdownListTrigger(content);

    if (!trigger) {
      return;
    }

    await this.convertCellToBlocks(cell, trigger.style, trigger.textAfter);
  }

  /**
   * Handle keyboard navigation within cell blocks
   * @param event - The keyboard event
   * @param _cell - The cell element (unused but available for future use)
   */
  handleKeyDown(event: KeyboardEvent, _cell: HTMLElement): void {
    const position = this._activeCellWithBlocks;

    if (!position) {
      return;
    }

    // Tab -> next cell
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      this.handleTabNavigation(position);

      return;
    }

    // Shift+Tab -> previous cell
    if (event.key === 'Tab' && event.shiftKey) {
      event.preventDefault();
      this.handleShiftTabNavigation(position);

      return;
    }

    // Shift+Enter -> exit to cell below
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      this.exitListToNextCell(position);

      return;
    }
  }

  /**
   * Handle Tab navigation to next cell
   */
  private handleTabNavigation(position: CellPosition): void {
    const nextCol = position.col + 1;
    const totalCols = this.getColumnCount();

    // Navigate to next column in same row
    if (nextCol < totalCols) {
      this.navigateToCell({ row: position.row, col: nextCol });

      return;
    }

    // Wrap to first column of next row
    const nextRow = position.row + 1;

    if (nextRow < this.getRowCount()) {
      this.navigateToCell({ row: nextRow, col: 0 });
    }
  }

  /**
   * Handle Shift+Tab navigation to previous cell
   */
  private handleShiftTabNavigation(position: CellPosition): void {
    const prevCol = position.col - 1;

    // Navigate to previous column in same row
    if (prevCol >= 0) {
      this.navigateToCell({ row: position.row, col: prevCol });

      return;
    }

    // Wrap to last column of previous row
    const prevRow = position.row - 1;

    if (prevRow >= 0) {
      this.navigateToCell({ row: prevRow, col: this.getColumnCount() - 1 });
    }
  }

  /**
   * Handle Enter key in a list item within a cell
   * @param isEmpty - whether the list item content is empty
   * @returns true if handled (exit list), false if not handled (let default behavior)
   */
  handleEnterInList(isEmpty: boolean): boolean {
    if (!this._activeCellWithBlocks) {
      return false;
    }

    // If empty, exit list and navigate to cell below
    if (isEmpty) {
      this.exitListToNextCell(this._activeCellWithBlocks);

      return true;
    }

    // Not empty - let default list behavior (create new item) occur
    return false;
  }

  /**
   * Navigate to a different cell
   */
  private navigateToCell(position: CellPosition): void {
    this.clearActiveCellWithBlocks();
    this.onNavigateToCell?.(position);
  }

  /**
   * Exit list and navigate to the cell below
   */
  private exitListToNextCell(currentPosition: CellPosition): void {
    const nextRow = currentPosition.row + 1;

    if (nextRow < this.getRowCount()) {
      this.navigateToCell({ row: nextRow, col: currentPosition.col });
    } else {
      this.clearActiveCellWithBlocks();
    }
  }

  /**
   * Get the number of rows in the table
   */
  private getRowCount(): number {
    return this.gridElement.querySelectorAll('[data-blok-table-row]').length;
  }

  /**
   * Get the number of columns in the table (based on first row)
   */
  private getColumnCount(): number {
    const firstRow = this.gridElement.querySelector('[data-blok-table-row]');

    return firstRow?.querySelectorAll('[data-blok-table-cell]').length ?? 0;
  }

  /**
   * Watch for block holders being removed from cell blocks containers.
   * When a container becomes empty (all blocks removed/converted), revert the cell to plain text.
   * Also schedules cleanup of non-list blocks that appear in cells after convert operations.
   */
  private observeCellBlockContainers(): void {
    this.cellBlocksObserver = new MutationObserver((mutations) => {
      const containersToCheck = new Set<HTMLElement>();

      for (const mutation of mutations) {
        if (mutation.type !== 'childList' || mutation.removedNodes.length === 0) {
          continue;
        }

        const target = mutation.target;

        if (!(target instanceof HTMLElement)) {
          continue;
        }

        // Check if the mutation happened on a cell blocks container
        const container = target.hasAttribute(CELL_BLOCKS_ATTR)
          ? target
          : target.closest<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

        if (!container) {
          continue;
        }

        // If the container has no more block holders, revert the cell
        if (container.querySelector(`[${DATA_ATTR.element}]`) === null) {
          this.revertCellToPlainText(container);
        } else {
          // Schedule a check for non-list blocks that may appear after a convert
          containersToCheck.add(container);
        }
      }

      // After processing all mutations, schedule cleanup of non-list blocks.
      // Use requestAnimationFrame to run after the current DOM batch settles.
      if (containersToCheck.size > 0) {
        requestAnimationFrame(() => {
          for (const container of containersToCheck) {
            if (container.isConnected) {
              this.removeNonListBlocksFromCell(container);
            }
          }
        });
      }
    });

    this.cellBlocksObserver.observe(this.gridElement, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Remove any non-list blocks from a cell blocks container, but only when
   * list blocks still remain. When a list item is converted to a paragraph
   * (e.g. Enter on empty item) while other list items exist, the paragraph's
   * holder ends up inside the cell. We detect and clean it up.
   *
   * If no list blocks remain, we skip (revertCellToPlainText handles that case).
   */
  private removeNonListBlocksFromCell(container: HTMLElement): void {
    const getToolName = (holder: HTMLElement): string | null =>
      holder.querySelector(`[${DATA_ATTR.tool}]`)?.getAttribute(DATA_ATTR.tool) ?? null;

    const blockHolders = Array.from(container.querySelectorAll<HTMLElement>(`[${DATA_ATTR.element}]`));
    const hasListBlocks = blockHolders.some(holder => getToolName(holder) === 'list');

    if (!hasListBlocks) {
      return;
    }

    const nonListHolders = blockHolders.filter(holder => getToolName(holder) !== 'list');

    for (const holder of nonListHolders) {
      const blockId = holder.getAttribute('data-blok-id');
      const blockIndex = blockId ? this.api.blocks.getBlockIndex(blockId) : undefined;

      if (blockIndex !== undefined) {
        void this.api.blocks.delete(blockIndex);
      }
    }
  }

  /**
   * Revert a block-based cell back to a plain text contenteditable cell.
   * When blocks are converted (e.g., list→paragraph via Backspace), the replacement
   * block ends up in the main editor. This method finds orphaned replacements,
   * extracts their text content, deletes them, and restores the cell.
   */
  private revertCellToPlainText(container: HTMLElement): void {
    const cell = container.closest<HTMLElement>(`[${CELL_ATTR}]`);

    if (!cell) {
      return;
    }

    const orphan = this.findOrphanedReplacementBlock();

    // Extract text from the orphaned block before deleting it
    const textContent = orphan?.text ?? '';

    container.remove();
    cell.setAttribute('contenteditable', 'true');
    // eslint-disable-next-line no-param-reassign
    cell.innerHTML = textContent;
    this.clearActiveCellWithBlocks();

    if (orphan !== null) {
      void this.api.blocks.delete(orphan.index);
    }
  }

  /**
   * Find a block that was orphaned by a convert operation.
   * When a cell block is converted (e.g., list→paragraph), the replacement block's
   * holder gets placed in the main editor working area instead of inside the cell.
   * Returns the orphan's index and text content, or null if none found.
   */
  private findOrphanedReplacementBlock(): { index: number; text: string } | null {
    const tableBlockIndex = this.api.blocks.getBlockIndex(this.tableBlockId);

    if (tableBlockIndex === undefined) {
      return null;
    }

    const blockCount = this.api.blocks.getBlocksCount();

    // Check blocks after the table — the orphan is placed relative to sibling blocks
    for (let i = tableBlockIndex + 1; i < blockCount; i++) { // eslint-disable-line no-restricted-syntax -- loop index required
      const block = this.api.blocks.getBlockByIndex(i);

      if (!block) {
        continue;
      }

      // Skip blocks inside table cells — those are legitimate cell blocks
      if (block.holder.closest(`[${CELL_ATTR}]`)) {
        continue;
      }

      return { index: i, text: block.holder.textContent ?? '' };
    }

    return null;
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    this._activeCellWithBlocks = null;
    this.cellBlocksObserver?.disconnect();
    this.cellBlocksObserver = null;
  }
}
