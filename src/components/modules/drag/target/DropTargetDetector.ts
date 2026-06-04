/**
 * DropTargetDetector - Finds and validates drop targets during drag operations
 */

import type { Block } from '../../../block';
import { DATA_ATTR, createSelector } from '../../../constants';
import type { BlockManager } from '../../blockManager';
import { DRAG_CONFIG } from '../utils/drag.constants';
import { ListItemDepth } from '../utils/ListItemDepth';

export interface DropTarget {
  block: Block;
  edge: 'top' | 'bottom' | 'left' | 'right';
  depth: number;
  parentId: string | null;
}

export interface ContentRect {
  left: number;
}

export interface UIAdapter {
  contentRect: ContentRect;
}

export interface BlockManagerAdapter {
  getBlockByIndex(index: number): Block | undefined;
  getBlockIndex(block: Block): number;
  getBlockById(id: string): Block | undefined;
  blocks: Block[];
}

export class DropTargetDetector {
  private ui: UIAdapter;
  private blockManager: BlockManagerAdapter;
  private sourceBlocks: Block[] = [];
  private listItemDepth: ListItemDepth;

  constructor(ui: UIAdapter, blockManager: BlockManagerAdapter) {
    this.ui = ui;
    this.blockManager = blockManager;
    this.listItemDepth = new ListItemDepth(blockManager as BlockManager);
  }

  /**
   * Set the source blocks to exclude them from being valid targets
   */
  setSourceBlocks(blocks: Block[]): void {
    this.sourceBlocks = blocks;
  }

  /**
   * Finds the drop target block from an element or by checking the left drop zone
   * @param elementUnderCursor - Element directly under the cursor
   * @param clientX - Cursor X position
   * @param clientY - Cursor Y position
   * @returns Object with block and holder, or nulls if no valid target found
   */
  findDropTargetBlock(
    elementUnderCursor: Element,
    clientX: number,
    clientY: number
  ): { block: Block | undefined; holder: HTMLElement | null } {
    // Check if cursor is on a toggle body placeholder — route to the toggle block
    const bodyPlaceholder = elementUnderCursor.closest('[data-blok-toggle-body-placeholder]');

    if (bodyPlaceholder) {
      const toggleHolder = bodyPlaceholder.closest(createSelector(DATA_ATTR.element));

      if (!(toggleHolder instanceof HTMLElement)) {
        return { block: undefined, holder: null };
      }

      const block = this.blockManager.blocks.find(b => b.holder === toggleHolder);

      if (block) {
        return { block, holder: toggleHolder };
      }
    }

    // First try: find block holder directly under cursor
    const directHolder = elementUnderCursor.closest(createSelector(DATA_ATTR.element));

    if (directHolder instanceof HTMLElement) {
      const block = this.blockManager.blocks.find(b => b.holder === directHolder);

      return { block, holder: directHolder };
    }

    // Fallback: check if cursor is in the left drop zone
    const leftZoneBlock = this.findBlockInLeftDropZone(clientX, clientY);

    if (leftZoneBlock) {
      return { block: leftZoneBlock, holder: leftZoneBlock.holder };
    }

    return { block: undefined, holder: null };
  }

  /**
   * Finds a block by vertical position when cursor is in the left drop zone
   * Used as a fallback when elementFromPoint doesn't find a block directly
   * @param clientX - Cursor X position
   * @param clientY - Cursor Y position
   * @returns Block at the vertical position, or null if not in left zone or no block found
   */
  findBlockInLeftDropZone(clientX: number, clientY: number): Block | null {
    const contentRect = this.ui.contentRect;
    const leftEdge = contentRect.left;

    // Check if cursor is within left drop zone (between leftEdge - leftDropZone and leftEdge)
    const distanceFromEdge = leftEdge - clientX;

    if (distanceFromEdge < 0 || distanceFromEdge > DRAG_CONFIG.leftDropZone) {
      return null;
    }

    // Find block by Y position
    for (const block of this.blockManager.blocks) {
      // Skip source blocks
      if (this.sourceBlocks.includes(block)) {
        continue;
      }

      const rect = block.holder.getBoundingClientRect();

      if (clientY >= rect.top && clientY <= rect.bottom) {
        return block;
      }
    }

    return null;
  }

  /**
   * Determines the drop target and edge based on cursor position
   * @param elementUnderCursor - Element under cursor
   * @param clientX - Cursor X position
   * @param clientY - Cursor Y position
   * @param sourceBlock - The primary block being dragged
   * @returns Drop target info or null if no valid target
   */
  determineDropTarget(
    elementUnderCursor: Element,
    clientX: number,
    clientY: number,
    sourceBlock: Block
  ): DropTarget | null {
    // A drop on the inter-column gutter (a resize separator) inserts a NEW column
    // between the two columns it divides — the natural "drop on the divider"
    // gesture. Without this, the separator resolves to the column_list holder and
    // the side-drop is rejected, leaving the gutter a dead zone. Runs first, before
    // findDropTargetBlock climbs to the column_list.
    const gapTarget = this.determineColumnGapTarget(elementUnderCursor);

    if (gapTarget && gapTarget.block !== sourceBlock) {
      return gapTarget;
    }

    const { block: targetBlock, holder: blockHolder } = this.findDropTargetBlock(elementUnderCursor, clientX, clientY);

    if (!blockHolder || !targetBlock || targetBlock === sourceBlock) {
      return null;
    }

    // Prevent dropping into the middle of a multi-block selection
    if (this.sourceBlocks.length > 1 && this.sourceBlocks.includes(targetBlock)) {
      return null;
    }

    /**
     * If the target block is inside a table cell and the source block is NOT
     * in the same cell, redirect the drop target to the table block itself.
     * This prevents blocks from being dropped into table cells via drag & drop.
     */
    const targetCellContainer = targetBlock.holder.closest('[data-blok-table-cell-blocks]');
    const sourceCellContainer = sourceBlock.holder.closest('[data-blok-table-cell-blocks]');
    const isTargetInCell = targetCellContainer !== null;
    const isCrossCellDrop = sourceCellContainer !== targetCellContainer;

    if (isTargetInCell && isCrossCellDrop) {
      return this.redirectToTableBlock(targetCellContainer, clientY);
    }

    // Horizontal (side) drop detection: when the cursor hovers near the left/right
    // edge of a target within its central vertical band, route the drop sideways so
    // the integrator can create / extend a column layout. Columns stack below 651px,
    // so disable side-drops entirely on narrow viewports.
    const horizontalTarget = this.determineHorizontalTarget(targetBlock, blockHolder, clientX, clientY);

    if (horizontalTarget) {
      return horizontalTarget;
    }

    // Determine edge (top or bottom half of block)
    const rect = blockHolder.getBoundingClientRect();
    const isTopHalf = clientY < rect.top + rect.height / 2;
    const targetIndex = this.blockManager.getBlockIndex(targetBlock);

    // Normalize: convert "top of block N" to "bottom of block N-1" (except for the first block)
    // This ensures we only ever show one indicator per drop position
    const previousBlock = targetIndex > 0
      ? this.blockManager.getBlockByIndex(targetIndex - 1)
      : null;
    // Only normalize within the same toggle context — don't cross toggle boundaries.
    // If previousBlock is inside a toggle and targetBlock is not (or vice versa),
    // normalization would trap the block inside the toggle.
    const canUsePreviousBlock = previousBlock &&
      !this.sourceBlocks.includes(previousBlock) &&
      previousBlock.parentId === targetBlock.parentId;

    if (isTopHalf && targetIndex > 0 && canUsePreviousBlock) {
      const targetDepth = this.calculateTargetDepth(previousBlock, 'bottom', sourceBlock);

      return this.resolveToggleNesting({ block: previousBlock, edge: 'bottom', depth: targetDepth, parentId: null }, elementUnderCursor);
    }

    // First block top half, or any block bottom half
    const edge: 'top' | 'bottom' = isTopHalf ? 'top' : 'bottom';
    const targetDepth = this.calculateTargetDepth(targetBlock, edge, sourceBlock);

    return this.resolveToggleNesting({ block: targetBlock, edge, depth: targetDepth, parentId: null }, elementUnderCursor);
  }

  /**
   * Detects a horizontal (side) drop near the left/right edge of the target.
   *
   * Returns a DropTarget with edge 'left' or 'right' when the cursor is on the
   * left/right side of the content box — the outer DRAG_CONFIG.sideZoneRatio of
   * the content width (floored at sideZoneMin) AND the whole margin beyond it, at
   * any distance — while inside the central vertical band (DRAG_CONFIG.sideBandRatio
   * of the block height) to avoid fighting top/bottom near corners. Only the
   * central reorder band between the two side zones falls through to top/bottom.
   * Side-drops are disabled below 651px (columns stack) and for container blocks
   * (column / column_list), which are never drop targets.
   *
   * @param targetBlock - The resolved target block
   * @param blockHolder - The target block's holder element
   * @param clientX - Cursor X position
   * @param clientY - Cursor Y position
   * @returns A horizontal DropTarget, or null to fall through to top/bottom logic
   */
  private determineHorizontalTarget(
    targetBlock: Block,
    blockHolder: HTMLElement,
    clientX: number,
    clientY: number
  ): DropTarget | null {
    // Columns stack below this breakpoint — no side-by-side layout.
    if (window.innerWidth < 651) {
      return null;
    }

    // Container blocks are never drop targets themselves.
    if (targetBlock.name === 'column' || targetBlock.name === 'column_list') {
      return null;
    }

    // Measure side zones against the visible content box, not the holder. The
    // holder spans the full editor width (gutters included) while content is
    // centered/narrower, so holder-edge zones never sit where the user actually
    // drops. Fall back to the holder when no content element exists (test stubs,
    // tools without the standard wrapper).
    const contentEl = blockHolder.querySelector('[data-blok-element-content]');
    const rect = contentEl instanceof HTMLElement
      ? contentEl.getBoundingClientRect()
      : blockHolder.getBoundingClientRect();

    // A block INSIDE a column_list gives a SINGLE, unambiguous indicator over a
    // column body: it always falls through to a top/bottom reorder, which
    // reparents the dropped block INTO that column (resolveParentForDrop). The
    // ONLY side-drop (new column) that fires over a body is at the OUTER edge of
    // the whole row — the left edge of the first column or the right edge of the
    // last — which appends a column at the start/end. Between-column insertion is
    // the gutter separator's job (determineColumnGapTarget, runs first). Inner
    // body edges deliberately do NOT side-drop: they used to, which made the
    // indicator flip between a horizontal "stack in" line and a vertical "new
    // column" line as the cursor crossed a column boundary — read by users as
    // "two drop lines". This removes that flip.
    const columnsContainer = blockHolder.closest('[data-blok-columns]');

    if (columnsContainer instanceof HTMLElement) {
      const bandInset = rect.height * (1 - DRAG_CONFIG.sideBandRatio) / 2;
      const inBand = clientY >= rect.top + bandInset && clientY <= rect.bottom - bandInset;

      if (!inBand) {
        return null;
      }

      const sideZone = Math.max(rect.width * DRAG_CONFIG.sideZoneRatio, DRAG_CONFIG.sideZoneMin);
      const nearLeft = clientX <= rect.left + sideZone;
      const nearRight = clientX >= rect.right - sideZone;

      // Left edge fires only on the FIRST column, right edge only on the LAST —
      // the row's outer edges. Every inner position (including inner edges)
      // falls through to into-column.
      if (nearLeft && this.isFirstColumnChild(targetBlock)) {
        return { block: targetBlock, edge: 'left', depth: 0, parentId: this.findEnclosingColumnId(targetBlock) };
      }

      if (nearRight && this.isLastColumnChild(targetBlock)) {
        return { block: targetBlock, edge: 'right', depth: 0, parentId: this.findEnclosingColumnId(targetBlock) };
      }

      return null;
    }

    // Standalone block (not in a column): keep the Notion-style outer side zones
    // with a central reorder band, gated to the central vertical band so a
    // top/bottom reorder wins near the block's own top/bottom corners.
    const bandInset = rect.height * (1 - DRAG_CONFIG.sideBandRatio) / 2;
    const inBand = clientY >= rect.top + bandInset && clientY <= rect.bottom - bandInset;

    if (!inBand) {
      return null;
    }

    // No inner bound: anything left of the left zone boundary counts as a left
    // side-drop (including the entire left margin, at any distance), and likewise
    // on the right. Only the central reorder band between the two zones falls
    // through to top/bottom.
    const sideZone = Math.max(rect.width * DRAG_CONFIG.sideZoneRatio, DRAG_CONFIG.sideZoneMin);
    const nearLeft = clientX <= rect.left + sideZone;
    const nearRight = clientX >= rect.right - sideZone;

    if (!nearLeft && !nearRight) {
      return null;
    }

    const edge: 'left' | 'right' = nearLeft ? 'left' : 'right';

    return {
      block: targetBlock,
      edge,
      depth: 0,
      parentId: this.findEnclosingColumnId(targetBlock),
    };
  }

  /**
   * The column holder element that owns a block, or null if the block is not a
   * direct child of a column. Walks block holder → [data-blok-column] wrapper →
   * enclosing [data-blok-element] (the column's holder).
   */
  private columnHolderOf(targetBlock: Block): HTMLElement | null {
    const columnWrapper = targetBlock.holder.closest('[data-blok-column]');

    if (!(columnWrapper instanceof HTMLElement)) {
      return null;
    }

    const columnHolder = columnWrapper.closest(createSelector(DATA_ATTR.element));

    return columnHolder instanceof HTMLElement ? columnHolder : null;
  }

  /**
   * Whether a block sits in the FIRST column of its row — i.e. there is no
   * preceding sibling column holder (only separators / nothing before it). Used
   * to gate the left outer-edge side-drop so only the row's far-left edge spawns
   * a column at the start. False when the block is not in a column.
   */
  private isFirstColumnChild(targetBlock: Block): boolean {
    const columnHolder = this.columnHolderOf(targetBlock);

    return columnHolder !== null && this.previousColumnHolder(columnHolder) === null;
  }

  /**
   * Whether a block sits in the LAST column of its row — no following sibling
   * column holder. Gates the right outer-edge side-drop. False when not in a
   * column.
   */
  private isLastColumnChild(targetBlock: Block): boolean {
    const columnHolder = this.columnHolderOf(targetBlock);

    return columnHolder !== null && this.nextColumnHolder(columnHolder) === null;
  }

  /**
   * The next sibling column holder after `columnHolder` within a column_list,
   * skipping the resize separator that sits between columns. Null if none.
   */
  private nextColumnHolder(element: Element): HTMLElement | null {
    const sibling = element.nextElementSibling;

    if (sibling === null) {
      return null;
    }

    if (sibling instanceof HTMLElement && sibling.matches(createSelector(DATA_ATTR.element))) {
      return sibling;
    }

    return this.nextColumnHolder(sibling);
  }

  /**
   * The previous sibling column holder before `columnHolder` within a
   * column_list, skipping the resize separator. Null if none (the block is in
   * the first column).
   */
  private previousColumnHolder(element: Element): HTMLElement | null {
    const sibling = element.previousElementSibling;

    if (sibling === null) {
      return null;
    }

    if (sibling instanceof HTMLElement && sibling.matches(createSelector(DATA_ATTR.element))) {
      return sibling;
    }

    return this.previousColumnHolder(sibling);
  }

  /**
   * The first content block inside a column's holder element, or undefined when
   * the column has no resolvable child block.
   */
  private firstBlockInColumnHolder(columnHolder: HTMLElement): Block | undefined {
    const childHolder = columnHolder.querySelector(createSelector(DATA_ATTR.element));

    return childHolder instanceof HTMLElement
      ? this.blockManager.blocks.find(block => block.holder === childHolder)
      : undefined;
  }

  /**
   * Detects a drop on the inter-column gutter — a resize separator that divides
   * two columns — and routes it to a "between columns" side-drop.
   *
   * The separator's next sibling is the right-adjacent column's holder. We target
   * that column's FIRST inner block with a 'left' edge so the integrator inserts a
   * new column BEFORE it (addColumnToList side 'left'), i.e. between the two
   * columns the separator divides. Reusing a real child block keeps the indicator
   * and drop path identical to an inner-edge side-drop.
   *
   * Returns null (fall through to normal detection) when not on a separator, on a
   * stacked layout (< 651px, separators hidden), or the right column has no
   * resolvable child block.
   *
   * @param elementUnderCursor - Element directly under the cursor
   * @returns A horizontal DropTarget that inserts between columns, or null
   */
  private determineColumnGapTarget(elementUnderCursor: Element): DropTarget | null {
    // Columns stack below this breakpoint — separators are hidden, no gutter.
    if (window.innerWidth < 651) {
      return null;
    }

    const resizer = elementUnderCursor.closest('[data-blok-column-resizer]');

    if (!(resizer instanceof HTMLElement)) {
      return null;
    }

    // The separator sits between two column holders; the next one is the
    // right-adjacent column. Its first child block is the side-drop target.
    const rightColumnHolder = this.nextColumnHolder(resizer);
    const childBlock = rightColumnHolder !== null
      ? this.firstBlockInColumnHolder(rightColumnHolder)
      : undefined;

    if (childBlock === undefined) {
      return null;
    }

    return {
      block: childBlock,
      edge: 'left',
      depth: 0,
      parentId: this.findEnclosingColumnId(childBlock),
    };
  }

  /**
   * Walks up the parentId chain from a target block to find the nearest
   * ancestor block whose name is 'column'. Returns that column's id, or null
   * if the target is not inside a column.
   */
  private findEnclosingColumnId(targetBlock: Block): string | null {
    const walk = (parentId: string | null): string | null => {
      if (parentId === null) {
        return null;
      }

      const parent = this.blockManager.getBlockById(parentId);

      if (parent === undefined) {
        return null;
      }
      if (parent.name === 'column') {
        return parent.id;
      }

      return walk(parent.parentId);
    };

    return walk(targetBlock.parentId);
  }

  /**
   * Calculates the target depth for list item nesting.
   * When a sourceBlock is provided and is a list item, the depth is calculated
   * to match what ListDepthValidator.getTargetDepthForMove will produce post-drop,
   * ensuring the visual indicator accurately predicts the final depth.
   *
   * @param targetBlock - Block being dropped onto
   * @param targetEdge - Edge of target ('top' or 'bottom')
   * @param sourceBlock - Optional block being dragged (for accurate list item depth prediction)
   * @returns The target depth (0 for root level, 1+ for nested)
   */
  calculateTargetDepth(targetBlock: Block, targetEdge: 'top' | 'bottom', sourceBlock?: Block): number {
    const targetIndex = this.blockManager.getBlockIndex(targetBlock);
    const dropIndex = targetEdge === 'top' ? targetIndex : targetIndex + 1;

    // First position always has depth 0
    if (dropIndex === 0) {
      return 0;
    }

    // Get the block that will be immediately before the drop position
    const previousBlock = this.blockManager.getBlockByIndex(dropIndex - 1);

    if (!previousBlock) {
      return 0;
    }

    const previousDepth = this.listItemDepth.getDepth(previousBlock);
    const previousIsListItem = previousDepth !== null;
    const prevDepthValue = previousDepth ?? 0;

    // Get the block that will be immediately after the drop position
    const nextBlock = this.blockManager.getBlockByIndex(dropIndex);
    const nextDepth = nextBlock ? this.listItemDepth.getDepth(nextBlock) : null;
    const nextIsListItem = nextDepth !== null;
    const nextDepthValue = nextDepth ?? 0;

    // When dragging a list item, predict the exact depth ListDepthValidator will
    // compute post-drop — so the visual indicator matches the actual result.
    const sourceDepth = sourceBlock ? this.listItemDepth.getDepth(sourceBlock) : null;

    if (sourceDepth !== null) {
      return this.predictListItemDepth(
        sourceDepth, prevDepthValue, previousIsListItem, nextDepthValue, nextIsListItem
      );
    }

    // For non-list blocks (or when sourceBlock not provided), use neighbor-based
    // depth for cosmetic indicator positioning only.
    if (nextDepthValue > 0 && nextDepthValue <= prevDepthValue + 1) {
      return nextDepthValue;
    }

    if (prevDepthValue > 0) {
      return prevDepthValue;
    }

    return 0;
  }

  /**
   * Mirrors ListDepthValidator.getTargetDepthForMove to predict the exact
   * post-drop depth for a list item. This ensures the visual indicator
   * shows the same depth the item will actually have after being dropped.
   */
  private predictListItemDepth(
    currentDepth: number,
    previousDepth: number,
    previousIsListItem: boolean,
    nextDepth: number,
    nextIsListItem: boolean
  ): number {
    const maxAllowedDepth = previousIsListItem ? previousDepth + 1 : 0;

    // Cap current depth at max allowed
    if (currentDepth > maxAllowedDepth) {
      return maxAllowedDepth;
    }

    // Match next depth if it's deeper than current and within bounds
    if (nextIsListItem && nextDepth > currentDepth && nextDepth <= maxAllowedDepth) {
      return nextDepth;
    }

    // Match previous depth if deeper than current and no next list item
    if (previousIsListItem && !nextIsListItem && previousDepth > currentDepth && previousDepth <= maxAllowedDepth) {
      return previousDepth;
    }

    return currentDepth;
  }

  /**
   * Checks whether a block is an open toggle (has data-blok-toggle-open="true" inside it).
   */
  private isOpenToggle(block: Block): boolean {
    return block.holder.querySelector('[data-blok-toggle-open="true"]') !== null;
  }

  /**
   * Calculates the indicator depth for a child being dropped inside a toggle.
   * Returns 0 so the drop indicator is full-width and visually consistent with
   * root-level indicators, regardless of toggle nesting depth.
   */
  private getToggleChildIndicatorDepth(_toggleBlock: Block): number {
    return 0;
  }

  /**
   * Post-processes a DropTarget to add toggle nesting information.
   * Determines whether the drop should nest inside a toggle block.
   */
  private resolveToggleNesting(target: DropTarget, _elementUnderCursor: Element): DropTarget {
    const { block: targetBlock, edge } = target;

    // Case 1: Bottom edge of an open toggle → "insert as first child"
    if (edge === 'bottom' && this.isOpenToggle(targetBlock)) {
      // If all source blocks are already children of this toggle, don't re-enter it.
      // This allows blocks to be dragged OUT of a toggle by hovering over its bottom area.
      const allSourcesAreChildren = this.sourceBlocks.length > 0 &&
        this.sourceBlocks.every(b => b.parentId === targetBlock.id);

      if (!allSourcesAreChildren) {
        const toggleDepth = this.getToggleChildIndicatorDepth(targetBlock);

        return { ...target, parentId: targetBlock.id, depth: toggleDepth };
      }
    }

    // Case 2: Target block is a child of an open toggle
    if (targetBlock.parentId !== null) {
      const parentBlock = this.blockManager.getBlockById(targetBlock.parentId);

      if (parentBlock !== undefined && this.isOpenToggle(parentBlock)) {
        const childDepth = this.getToggleChildIndicatorDepth(parentBlock);

        return { ...target, parentId: parentBlock.id, depth: childDepth };
      }
    }

    return { ...target, parentId: null };
  }

  /**
   * Redirect a drop target to the table block that contains the given cell container.
   * Finds the outermost [data-blok-element] ancestor and returns it as the target.
   *
   * @param cellContainer - The [data-blok-table-cell-blocks] element containing the target
   * @param clientY - Cursor Y position for edge calculation
   * @returns Drop target pointing to the table block, or null if table block not found
   */
  private redirectToTableBlock(cellContainer: Element, clientY: number): DropTarget | null {
    const tableHolder = cellContainer.closest(createSelector(DATA_ATTR.element));
    const tableBlock = tableHolder
      ? this.blockManager.blocks.find(b => b.holder === tableHolder)
      : undefined;

    if (!tableBlock) {
      return null;
    }

    const tableRect = tableBlock.holder.getBoundingClientRect();
    const isTopHalf = clientY < tableRect.top + tableRect.height / 2;

    return { block: tableBlock, edge: isTopHalf ? 'top' : 'bottom', depth: 0, parentId: null };
  }

}
