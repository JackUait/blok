/**
 * DropTargetDetector - Finds and validates drop targets during drag operations
 */

import type { Block } from '../../../block';
import { DATA_ATTR, createSelector } from '../../../constants';
import { DRAG_CONFIG } from '../utils/drag.constants';
import { getBlockNestingDepth, getListItemDepth } from '../utils/depthUtils';
import { resolveTargetDepth, selectPointerDepth } from '../../../../tools/list/depth-validator';
import { INDENT_PER_LEVEL } from '../../../../tools/list/constants';

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

  constructor(ui: UIAdapter, blockManager: BlockManagerAdapter) {
    this.ui = ui;
    this.blockManager = blockManager;
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
    const gapTarget = this.determineColumnGapTarget(elementUnderCursor, clientY);

    if (gapTarget && gapTarget.block !== sourceBlock) {
      return gapTarget;
    }

    const resolved = this.findDropTargetBlock(elementUnderCursor, clientX, clientY);

    if (!resolved.holder || !resolved.block || resolved.block === sourceBlock) {
      return null;
    }

    // Empty space below a column's blocks resolves (via closest) to the column
    // CONTAINER block, whose holder is itself a [data-blok-element]. Left as-is,
    // a top/bottom drop on the container shows an indicator at the column's
    // bottom edge AND reparents at the column_list level — spawning a NEW column
    // beside the one the cursor is over (resolveParentForDrop reads the
    // container's parentId). Redirect into the column instead: target its LAST
    // child with a bottom edge, so the single indicator and the drop both land at
    // the end of the column (stack INTO it), matching a drop over a real block.
    const { block: targetBlock, holder: blockHolder } =
      this.redirectColumnContainerTarget(resolved.block, resolved.holder);

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
      const targetDepth = this.calculateTargetDepth(previousBlock, 'bottom', sourceBlock, clientX);

      return this.resolveToggleNesting({ block: previousBlock, edge: 'bottom', depth: targetDepth, parentId: null }, elementUnderCursor);
    }

    // First block top half, or any block bottom half
    const edge: 'top' | 'bottom' = isTopHalf ? 'top' : 'bottom';
    const targetDepth = this.calculateTargetDepth(targetBlock, edge, sourceBlock, clientX);

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

    // A drop in the OUTER editor margin beside a whole column_list resolves (via
    // elementFromPoint hitting the full-width container holder, not a narrow
    // column child, which only lives inside the content row) to the column_list
    // block itself. Treat the entire left/right margin as a new-column dropzone —
    // identical to a standalone block in an empty editor — so existing columns
    // get the SAME outer dropzone: far-left prepends a column at the row's start,
    // far-right appends one at its end.
    if (targetBlock.name === 'column_list') {
      return this.outerColumnListTarget(targetBlock, blockHolder, clientX, clientY);
    }

    // The column container itself is never a drop target.
    if (targetBlock.name === 'column') {
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
   * Side-drop detection for a drop that resolved to a whole column_list block —
   * i.e. the cursor is in the outer editor margin beside the row, where the
   * full-width container holder (not a narrow column child) sits under the
   * pointer. Mirrors the standalone-block outer zones exactly (central vertical
   * band, outer sideZone with no inner bound so the whole margin is live) so the
   * dropzone is identical whether or not columns already exist.
   *
   * A left margin drop prepends a new column at the start of the row, a right
   * margin drop appends one at the end. It does so by targeting the first/last
   * column's first child block with a 'left'/'right' edge and that column's id as
   * parentId — exactly the shape the row's inner outer-edge side-drop produces,
   * so handleColumnDrop routes both through addColumnToList. Returns null when
   * the row has no resolvable column child, or the cursor falls in the central
   * reorder band / outside the vertical band (→ top/bottom reorders the list).
   */
  private outerColumnListTarget(
    columnListBlock: Block,
    blockHolder: HTMLElement,
    clientX: number,
    clientY: number
  ): DropTarget | null {
    const contentEl = blockHolder.querySelector('[data-blok-element-content]');
    const rect = contentEl instanceof HTMLElement
      ? contentEl.getBoundingClientRect()
      : blockHolder.getBoundingClientRect();

    const bandInset = rect.height * (1 - DRAG_CONFIG.sideBandRatio) / 2;
    const inBand = clientY >= rect.top + bandInset && clientY <= rect.bottom - bandInset;

    if (!inBand) {
      return null;
    }

    const sideZone = Math.max(rect.width * DRAG_CONFIG.sideZoneRatio, DRAG_CONFIG.sideZoneMin);
    const nearLeft = clientX <= rect.left + sideZone;
    const nearRight = clientX >= rect.right - sideZone;

    if (!nearLeft && !nearRight) {
      return null;
    }

    const edge: 'left' | 'right' = nearLeft ? 'left' : 'right';
    const columns = this.blockManager.blocks.filter(block => block.parentId === columnListBlock.id);
    const column = edge === 'left' ? columns[0] : columns[columns.length - 1];

    if (column === undefined) {
      return null;
    }

    const child = this.blockManager.blocks.find(block => block.parentId === column.id);

    if (child === undefined) {
      return null;
    }

    return { block: child, edge, depth: 0, parentId: column.id };
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
   * The LAST child block of a column, in document order, or undefined when the
   * column has no children. Uses the flat block list filtered by parentId rather
   * than the DOM — a column's children are contiguous and ordered there, and this
   * avoids the column's multi-level wrapper nesting (and nested grandchild blocks,
   * e.g. list items) confusing a DOM walk.
   */
  private lastChildOfColumn(columnBlock: Block): Block | undefined {
    const children = this.blockManager.blocks.filter(block => block.parentId === columnBlock.id);

    return children[children.length - 1];
  }

  /**
   * Redirects a drop that resolved to a column CONTAINER block into the column
   * itself. The empty space below a column's blocks resolves (via closest) to the
   * column block, whose holder is a [data-blok-element]; a top/bottom drop there
   * shows a container-edge indicator and spawns a new column. Instead, anchor on
   * the column's LAST child with the caller's later top/bottom logic so the drop
   * appends INTO the column. Non-column targets, and columns with no usable child
   * (or whose last child is itself being dragged), pass through unchanged.
   */
  private redirectColumnContainerTarget(
    block: Block,
    holder: HTMLElement
  ): { block: Block; holder: HTMLElement } {
    if (block.name !== 'column') {
      return { block, holder };
    }

    const lastChild = this.lastChildOfColumn(block);

    if (lastChild === undefined || this.sourceBlocks.includes(lastChild)) {
      return { block, holder };
    }

    return { block: lastChild, holder: lastChild.holder };
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
   * The separator spans the FULL row height, so its lower strip overlaps the
   * empty gap below whichever column is shorter. A drop there reads visually as
   * "the bottom of that column", not "between the columns" — so when clientY lies
   * in one column's dead gap (past its content but still beside the other's),
   * stack INTO that column instead of inserting a new one. Only when both columns
   * have content beside the cursor is it a true between-columns insertion.
   *
   * @param elementUnderCursor - Element directly under the cursor
   * @param clientY - Cursor Y position
   * @returns A DropTarget (between-columns side-drop, or into-column stack), or null
   */
  private determineColumnGapTarget(elementUnderCursor: Element, clientY: number): DropTarget | null {
    // Columns stack below this breakpoint — separators are hidden, no gutter.
    if (window.innerWidth < 651) {
      return null;
    }

    const resizer = elementUnderCursor.closest('[data-blok-column-resizer]');

    if (!(resizer instanceof HTMLElement)) {
      return null;
    }

    // The separator divides a left and a right column. If the cursor is in the
    // dead gap below the shorter one, redirect into it (stack at its end) rather
    // than between the two.
    const gapStack = this.stackIntoGapColumn(resizer, clientY);

    if (gapStack !== null) {
      return gapStack;
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
   * When the cursor sits on a separator but in the empty gap below one of the two
   * columns it divides, returns a bottom-edge target stacking into that (shorter)
   * column's last child. Returns null when the cursor is beside content on BOTH
   * sides (a real between-columns insertion), below/above both, or either column
   * is unresolvable — letting the caller fall back to the between-columns drop.
   */
  private stackIntoGapColumn(resizer: HTMLElement, clientY: number): DropTarget | null {
    const leftHolder = this.previousColumnHolder(resizer);
    const rightHolder = this.nextColumnHolder(resizer);

    if (leftHolder === null || rightHolder === null) {
      return null;
    }

    const leftColumn = this.blockManager.blocks.find(block => block.holder === leftHolder);
    const rightColumn = this.blockManager.blocks.find(block => block.holder === rightHolder);

    if (leftColumn === undefined || rightColumn === undefined) {
      return null;
    }

    const leftBottom = this.columnContentBottom(leftColumn);
    const rightBottom = this.columnContentBottom(rightColumn);

    if (leftBottom === null || rightBottom === null) {
      return null;
    }

    // Cursor past the left column's content but still beside the right's → in the
    // left column's gap. The mirror case targets the right column.
    if (clientY > leftBottom && clientY <= rightBottom) {
      return this.stackIntoColumnTarget(leftColumn);
    }
    if (clientY > rightBottom && clientY <= leftBottom) {
      return this.stackIntoColumnTarget(rightColumn);
    }

    return null;
  }

  /**
   * The bottom of a column's content — the bottom of its last child's content box
   * (falling back to the child's holder). Null when the column has no last child.
   */
  private columnContentBottom(columnBlock: Block): number | null {
    const lastChild = this.lastChildOfColumn(columnBlock);

    if (lastChild === undefined) {
      return null;
    }

    const content = lastChild.holder.querySelector('[data-blok-element-content]');
    const rect = content instanceof HTMLElement
      ? content.getBoundingClientRect()
      : lastChild.holder.getBoundingClientRect();

    return rect.bottom;
  }

  /**
   * A bottom-edge DropTarget that appends into a column (its last child). Null
   * when the column has no usable last child or it is itself being dragged.
   */
  private stackIntoColumnTarget(columnBlock: Block): DropTarget | null {
    const lastChild = this.lastChildOfColumn(columnBlock);

    if (lastChild === undefined || this.sourceBlocks.includes(lastChild)) {
      return null;
    }

    return { block: lastChild, edge: 'bottom', depth: 0, parentId: null };
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
   * Calculates the nesting depth a dragged block will land at, for any block
   * type. List items carry their depth via `data-list-depth`; every other block
   * carries a flat `indent` via `data-blok-indent`. Both are read uniformly via
   * {@link getBlockNestingDepth}, so a header/paragraph/image/etc. nests inside a
   * list exactly like a list item would. The result drives BOTH the drop
   * indicator and the depth applied on drop, so the preview always matches.
   *
   * When `clientX` is supplied, the cursor's horizontal position picks the
   * nesting depth (Notion's drag-to-indent): it snaps to a discrete indent step
   * relative to the editor content's left edge and is clamped to the legal range
   * by {@link resolveTargetDepth}. Omitting `clientX` (unit tests, the parity
   * guard) falls back to the neighbour-based auto-resolution unchanged.
   *
   * @param targetBlock - Block being dropped onto
   * @param targetEdge - Edge of target ('top' or 'bottom')
   * @param sourceBlock - Optional block being dragged (for accurate depth prediction)
   * @param clientX - Optional cursor X position to drive cursor-controlled depth
   * @returns The target depth (0 for root level, 1+ for nested)
   */
  calculateTargetDepth(targetBlock: Block, targetEdge: 'top' | 'bottom', sourceBlock?: Block, clientX?: number): number {
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

    // Choose the neighbour depth reader to MATCH what actually applies the depth
    // post-drop, so the indicator never lies:
    //   - a dragged list item gets its depth from the list tool's moved() hook,
    //     which considers ONLY list-item neighbours (data-list-depth) — so read
    //     neighbours list-only too.
    //   - any other dragged block gets a flat `indent` applied by the drop, which
    //     nests relative to ANY nesting context (list item OR indented block) —
    //     so read neighbours generically.
    const sourceIsList = sourceBlock !== undefined && getListItemDepth(sourceBlock) !== null;
    const depthOf = (block: Block): number | null =>
      sourceIsList ? getListItemDepth(block) : getBlockNestingDepth(block);

    const previousDepth = depthOf(previousBlock);
    // "Nesting context" = a block a following block may nest one level under:
    // any list item, or any already-indented block. Plain root blocks are not.
    const previousIsNestingContext = previousDepth !== null;
    const prevDepthValue = previousDepth ?? 0;

    // Get the block that will be immediately after the drop position
    const nextBlock = this.blockManager.getBlockByIndex(dropIndex);
    const nextDepth = nextBlock ? depthOf(nextBlock) : null;
    const nextIsNestingContext = nextDepth !== null;
    const nextDepthValue = nextDepth ?? 0;

    // Predict the exact post-drop depth for ANY dragged block via the SAME
    // resolveTargetDepth the list tool's move hook uses, so the indicator can
    // never predict a depth different from the one the drop applies. The source's
    // current depth is its list depth (list items) or its flat indent (others),
    // defaulting to 0 — including the defensive no-source case (production always
    // supplies the dragged block), so every path goes through one rule.
    const sourceDepth = sourceBlock ? depthOf(sourceBlock) ?? 0 : 0;

    // The cursor's horizontal position, snapped to a discrete indent step,
    // overrides the auto-promotion when a nesting predecessor exists. The depth-0
    // anchor is the editor content's left edge (this.ui.contentRect.left).
    const pointerDepth = clientX !== undefined
      ? selectPointerDepth(clientX, this.ui.contentRect.left, INDENT_PER_LEVEL)
      : undefined;

    return resolveTargetDepth({
      currentDepth: sourceDepth,
      previousIsListItem: previousIsNestingContext,
      previousDepth: prevDepthValue,
      nextIsListItem: nextIsNestingContext,
      nextDepth: nextDepthValue,
      pointerDepth,
    });
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
