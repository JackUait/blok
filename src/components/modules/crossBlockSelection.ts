import { Module } from '../__module';
import type { Block } from '../block';
import { DATA_ATTR } from '../constants';
import { SelectionUtils } from '../selection/index';
import { announce } from '../utils/announcer';
import { mouseButtons } from '../utils';

/**
 *
 */
export class CrossBlockSelection extends Module {
  /**
   * Block where selection is started
   */
  private firstSelectedBlock: Block | null = null;

  /**
   * Last selected Block
   */
  private lastSelectedBlock: Block | null = null;

  /**
   * Ids of the blocks that were already selected when a Shift+pointer gesture
   * began. A Shift+DRAG must EXTEND this base set (Notion-additive), not replace
   * it, so we snapshot it on mousedown and re-apply it on every drag move.
   */
  private shiftDragBaseSelected: Set<string> | null = null;

  /**
   * The block the Shift+pointer gesture started on — the pivot the drag range
   * extends from.
   */
  private shiftDragClickedBlock: Block | null = null;

  /**
   * Whether the current Shift+pointer gesture became a drag (a mouseover reached
   * a different block before mouseup). A pure Shift+CLICK leaves this false and
   * the synchronous range-select from mousedown stands.
   */
  private shiftDragActive = false;

  /**
   * Whether the current drag gesture has selected a multi-line child-block
   * range inside a nested-blocks container (several "lines" in one table
   * cell). While false, a drag that stays on the anchor line is a plain
   * native TEXT selection and must not be hijacked into a block selection.
   */
  private nestedRangeDragActive = false;

  /**
   * Module preparation
   * @returns {Promise}
   */
  public async prepare(): Promise<void> {
    this.listeners.on(document, 'mousedown', (event: Event) => {
      this.enableCrossBlockSelection(event as MouseEvent);
    });
  }

  /**
   * Sets up listeners
   * @param {MouseEvent} event - mouse down event
   */
  public watchSelection(event: MouseEvent): void {
    if (event.button !== mouseButtons.LEFT) {
      return;
    }

    const { BlockManager } = this.Blok;

    const block = BlockManager.getBlock(event.target as HTMLElement);

    if (!block) {
      return;
    }

    this.firstSelectedBlock = block;
    this.lastSelectedBlock = block;
    this.nestedRangeDragActive = false;

    this.listeners.on(document, 'mouseover', this.onMouseOver);
    this.listeners.on(document, 'mouseup', this.onMouseUp);
  }

  /**
   * Handle a Shift+Click: select the inclusive block-level range from the anchor
   * block to the clicked block. The anchor is the first block of an in-progress
   * block selection if one exists, otherwise the block holding the caret. Mixed
   * list types and non-list blocks are all included (the range is purely
   * index-based, like drag selection).
   * @param event - the Shift+Click mouse down event
   * @returns true when a range was selected (caller should stop), false when
   *   there was nothing to anchor or target so the normal path should run
   */
  private handleShiftClick(event: MouseEvent): boolean {
    const { BlockManager } = this.Blok;

    const clickedBlock = BlockManager.getBlock(event.target as HTMLElement);

    if (!clickedBlock) {
      return false;
    }

    const targetBlock = BlockManager.resolveToRootBlock(clickedBlock);

    const anchorCandidate = this.firstSelectedBlock ?? BlockManager.currentBlock ?? null;

    if (!anchorCandidate) {
      return false;
    }

    const anchorBlock = BlockManager.resolveToRootBlock(anchorCandidate);

    /**
     * Prevent the native caret placement / text-selection extend so the gesture
     * reads as a pure block-range selection.
     */
    event.preventDefault();

    const countBefore = this.Blok.BlockSelection.selectedBlocks.length;

    this.selectBlockRange(anchorBlock, targetBlock);

    /**
     * Announce the new selection size — but only when the click actually
     * changed it, so re-clicking the same target stays silent.
     */
    if (this.Blok.BlockSelection.selectedBlocks.length !== countBefore) {
      this.announceSelectionCount();
    }

    return true;
  }

  /**
   * Start watching a Shift+pointer gesture for a drag after the synchronous
   * range-click has been applied. Snapshots the base selection and the clicked
   * pivot block so a subsequent drag can extend the selection additively.
   * @param baseSelected - ids of blocks selected before this gesture began
   */
  private beginShiftDragWatch(baseSelected: Set<string>): void {
    this.shiftDragBaseSelected = baseSelected;
    // selectBlockRange (via handleShiftClick) sets lastSelectedBlock to the clicked block.
    this.shiftDragClickedBlock = this.lastSelectedBlock;
    this.shiftDragActive = false;

    this.listeners.on(document, 'mouseover', this.onShiftDragOver);
    this.listeners.on(document, 'mouseup', this.onShiftDragUp);
  }

  /**
   * Mouse over handler for a Shift+DRAG. Re-selects the union of the pre-gesture
   * base selection and the inclusive range from the clicked pivot to the hovered
   * block, so dragging EXTENDS the existing selection rather than replacing it.
   * @param event - mouseover event
   */
  private onShiftDragOver = (event: Event): void => {
    const mouseEvent = event as MouseEvent;
    const { BlockManager, BlockSelection, DragManager } = this.Blok;

    if (!this.shiftDragClickedBlock || !this.shiftDragBaseSelected || DragManager.isDragging) {
      return;
    }

    const rawHover = BlockManager.getBlockByChildNode(mouseEvent.target as Node);

    if (!rawHover) {
      return;
    }

    const hoverBlock = BlockManager.resolveToRootBlock(rawHover);
    const anchorIndex = BlockManager.blocks.indexOf(this.shiftDragClickedBlock);
    const hoverIndex = BlockManager.blocks.indexOf(hoverBlock);

    if (anchorIndex === -1 || hoverIndex === -1 || anchorIndex === hoverIndex) {
      return;
    }

    const start = Math.min(anchorIndex, hoverIndex);
    const end = Math.max(anchorIndex, hoverIndex);

    this.shiftDragActive = true;
    SelectionUtils.get()?.removeAllRanges();

    BlockManager.blocks.forEach((block, index) => {
      const inDraggedRange = index >= start && index <= end;
      const inBaseSelection = this.shiftDragBaseSelected?.has(block.id) ?? false;

      BlockManager.blocks[index].selected = inDraggedRange || inBaseSelection;
    });

    BlockSelection.clearCache();

    this.firstSelectedBlock = this.shiftDragClickedBlock;
    this.lastSelectedBlock = hoverBlock;

    this.Blok.Toolbar.close();
  };

  /**
   * Mouse up handler ending a Shift+pointer gesture. Tears down the drag-watch
   * listeners and, when the gesture was a drag, re-opens the multi-block toolbar.
   */
  private onShiftDragUp = (): void => {
    this.listeners.off(document, 'mouseover', this.onShiftDragOver);
    this.listeners.off(document, 'mouseup', this.onShiftDragUp);

    const wasDrag = this.shiftDragActive;

    this.shiftDragBaseSelected = null;
    this.shiftDragClickedBlock = null;
    this.shiftDragActive = false;

    if (wasDrag && this.Blok.BlockSelection.anyBlockSelected) {
      this.Blok.UI.disableHoverForCooldown();
      this.Blok.UI.resetBlockHoverState();
      this.Blok.Toolbar.moveAndOpenForMultipleBlocks();
      this.announceSelectionCount();
    }
  };

  /**
   * Handle a Cmd/Ctrl+Shift+Click or Alt+Shift+Click: TOGGLE the clicked block
   * in or out of the current selection without collapsing any existing
   * (possibly non-adjacent) selection — Notion parity for non-contiguous
   * multi-block selection. The selection model stores a per-block `selected`
   * flag (BlockSelection.selectedBlocks is a filter over those flags), so gaps
   * are represented natively; no contiguous-range assumption is involved here.
   * @param event - the modifier+Shift+Click mouse down event
   * @returns true when a block was toggled (caller should stop), false when
   *   there was nothing to toggle so the normal path should run
   */
  private handleToggleClick(event: MouseEvent): boolean {
    const { BlockManager, BlockSelection } = this.Blok;

    const clickedBlock = BlockManager.getBlock(event.target as HTMLElement);

    if (!clickedBlock) {
      return false;
    }

    const targetBlock = BlockManager.resolveToRootBlock(clickedBlock);

    /**
     * Prevent native caret placement / text-selection extend so the gesture
     * reads as a pure block-level toggle.
     */
    event.preventDefault();

    SelectionUtils.get()?.removeAllRanges();

    targetBlock.selected = !targetBlock.selected;

    BlockSelection.clearCache();

    /**
     * Track the clicked block as the anchor so a subsequent Shift+Arrow /
     * Shift+Click extends from here. Seed firstSelectedBlock when this is the
     * first block being selected.
     */
    this.firstSelectedBlock = this.firstSelectedBlock ?? targetBlock;
    this.lastSelectedBlock = targetBlock;

    this.Blok.InlineToolbar.close();

    if (BlockSelection.anyBlockSelected) {
      this.Blok.Toolbar.moveAndOpenForMultipleBlocks();
    } else {
      this.firstSelectedBlock = this.lastSelectedBlock = null;
      this.Blok.Toolbar.close();
    }

    /**
     * Announce the updated selection size (a toggle always changes the count;
     * announceSelectionCount itself skips single-block/empty selections).
     */
    this.announceSelectionCount();

    return true;
  }

  /**
   * Select the inclusive range of blocks between two blocks (by flat index),
   * clearing any prior selection. Reuses the same Math.min/max index-range logic
   * the drag path uses. Records the anchor/target as first/last selected so a
   * subsequent Shift+Arrow or Shift+Click keeps extending from the same anchor.
   * @param anchorBlock - the block the range starts from
   * @param targetBlock - the block the range ends at
   */
  private selectBlockRange(anchorBlock: Block, targetBlock: Block): void {
    const { BlockManager, BlockSelection } = this.Blok;

    const fIndex = BlockManager.blocks.indexOf(anchorBlock);
    const lIndex = BlockManager.blocks.indexOf(targetBlock);

    if (fIndex === -1 || lIndex === -1) {
      return;
    }

    SelectionUtils.get()?.removeAllRanges();

    const start = Math.min(fIndex, lIndex);
    const end = Math.max(fIndex, lIndex);

    for (const block of BlockManager.blocks) {
      block.selected = false;
    }

    for (const i of Array.from({ length: end - start + 1 }, (_unused, idx) => start + idx)) {
      BlockManager.blocks[i].selected = true;
    }

    BlockSelection.clearCache();

    this.firstSelectedBlock = anchorBlock;
    this.lastSelectedBlock = targetBlock;

    this.Blok.InlineToolbar.close();
    this.Blok.Toolbar.moveAndOpenForMultipleBlocks();
  }

  /**
   * Return boolean is cross block selection started:
   * there should be at least 2 selected blocks
   */
  public get isCrossBlockSelectionStarted(): boolean {
    return !!this.firstSelectedBlock && !!this.lastSelectedBlock && this.firstSelectedBlock !== this.lastSelectedBlock;
  }

  /**
   * Change selection state of the next Block
   * Used for CBS via Shift + arrow keys
   * @param {boolean} next - if true, toggle next block. Previous otherwise
   */
  public toggleBlockSelectedState(next = true): void {
    const { BlockManager, BlockSelection } = this.Blok;

    const currentBlock = BlockManager.currentBlock;

    if (!this.lastSelectedBlock && !currentBlock) {
      return;
    }

    if (!this.lastSelectedBlock && currentBlock) {
      this.lastSelectedBlock = this.firstSelectedBlock = currentBlock;
    }

    if (this.firstSelectedBlock === this.lastSelectedBlock && this.firstSelectedBlock) {
      this.firstSelectedBlock.selected = true;

      BlockSelection.clearCache();
      SelectionUtils.get()?.removeAllRanges();

      /**
       * Hide the Toolbar when cross-block selection starts.
       */
      this.Blok.Toolbar.close();
    }

    if (!this.lastSelectedBlock) {
      return;
    }

    const nextBlockIndex = BlockManager.blocks.indexOf(this.lastSelectedBlock) + (next ? 1 : -1);
    const nextBlock = BlockManager.blocks[nextBlockIndex];

    if (!nextBlock) {
      return;
    }

    if (this.lastSelectedBlock.selected !== nextBlock.selected) {
      nextBlock.selected = true;

      BlockSelection.clearCache();
      this.Blok.Toolbar.close();
    } else {
      this.lastSelectedBlock.selected = false;

      BlockSelection.clearCache();
      this.Blok.Toolbar.close();
    }

    this.lastSelectedBlock = nextBlock;

    /** close InlineToolbar when Blocks selected */
    this.Blok.InlineToolbar.close();

    nextBlock.holder.scrollIntoView({
      block: 'nearest',
    });

    /**
     * Show toolbar for multi-block selection
     */
    if (this.isCrossBlockSelectionStarted) {
      this.Blok.Toolbar.moveAndOpenForMultipleBlocks();
    }

    /**
     * Announce the selection size as it grows via Shift+Arrow.
     */
    this.announceSelectionCount();
  }

  /**
   * Announce how many blocks are currently selected as the selection grows.
   * A single-block selection is not announced (nothing multi-block to convey).
   */
  private announceSelectionCount(): void {
    const count = this.Blok.BlockSelection.selectedBlocks.length;

    if (count <= 1) {
      return;
    }

    announce(
      this.Blok.I18n.t('a11y.blocksSelected', { count }),
      { politeness: 'polite' }
    );
  }

  /**
   * Clear saved state
   * @param {Event} reason - event caused clear of selection
   */
  public clear(reason?: Event): void {
    const { BlockManager, BlockSelection, Caret } = this.Blok;

    if (!this.firstSelectedBlock || !this.lastSelectedBlock) {
      return;
    }

    const fIndex = BlockManager.blocks.indexOf(this.firstSelectedBlock);
    const lIndex = BlockManager.blocks.indexOf(this.lastSelectedBlock);

    if (!BlockSelection.anyBlockSelected || fIndex === -1 || lIndex === -1) {
      this.firstSelectedBlock = this.lastSelectedBlock = null;

      return;
    }

    if (reason && reason instanceof KeyboardEvent) {
      /**
       * Set caret depending on pressed key if pressed key is an arrow.
       */
      switch (reason.key) {
        case 'ArrowDown':
        case 'ArrowRight':
          Caret.setToBlock(BlockManager.blocks[Math.max(fIndex, lIndex)], Caret.positions.END);
          break;

        case 'ArrowUp':
        case 'ArrowLeft':
          Caret.setToBlock(BlockManager.blocks[Math.min(fIndex, lIndex)], Caret.positions.START);
          break;
        default:
          Caret.setToBlock(BlockManager.blocks[Math.max(fIndex, lIndex)], Caret.positions.END);
      }
    }

    this.firstSelectedBlock = this.lastSelectedBlock = null;
  }

  /**
   * Enables Cross Block Selection
   * @param {MouseEvent} event - mouse down event
   */
  private enableCrossBlockSelection(event: MouseEvent): void {
    const { UI, Toolbar } = this.Blok;

    /**
     * UI might not be ready yet or editor might be destroyed
     */
    if (!UI.nodes.redactor) {
      return;
    }

    if (this.Blok.RectangleSelection.isRectActivated()) {
      return;
    }

    /**
     * Don't clear selection when clicking on toolbar elements (settings toggler, plus button, etc.)
     * This allows multi-block selection to be preserved when interacting with the toolbar
     */
    const toolbarElement = Toolbar.nodes.wrapper;
    if (toolbarElement && toolbarElement.contains(event.target as Node)) {
      return;
    }

    /**
     * Cmd/Ctrl+Shift+Click (or Alt+Shift+Click) TOGGLES the clicked block in/out
     * of the current selection, allowing a non-contiguous set — Notion parity.
     * Must be checked before the plain Shift+Click range path (which also sees
     * shiftKey) so the modifier gesture is not swallowed as a contiguous range.
     */
    if (
      event.shiftKey &&
      (event.metaKey || event.ctrlKey || event.altKey) &&
      event.button === mouseButtons.LEFT &&
      UI.nodes.redactor.contains(event.target as Node) &&
      this.handleToggleClick(event)
    ) {
      return;
    }

    /**
     * Shift+Click selects the inclusive block-level range from the anchor (the
     * caret's block, or the first block of an in-progress selection) to the
     * clicked block — Notion parity. Handled before the native-selection clear so
     * the new range overrides any leftover text selection.
     *
     * A Shift+mousedown is ambiguous: it may be a Shift+CLICK (range-select,
     * handled synchronously here) or the start of a Shift+DRAG (which must EXTEND
     * the existing selection additively). We resolve the range-click immediately
     * so pure clicks keep working, but also snapshot the pre-gesture selection and
     * start watching for a drag; if the pointer then reaches another block, the
     * drag re-applies `base ∪ dragged-range` instead of the replaced range.
     */
    if (
      event.shiftKey &&
      event.button === mouseButtons.LEFT &&
      UI.nodes.redactor.contains(event.target as Node)
    ) {
      const baseSelected = new Set(this.Blok.BlockSelection.selectedBlocks.map((block) => block.id));

      if (this.handleShiftClick(event)) {
        this.beginShiftDragWatch(baseSelected);

        return;
      }
    }

    /**
     * Each mouse down on must disable selectAll state
     */
    if (!SelectionUtils.isCollapsed) {
      this.Blok.BlockSelection.clearSelection(event);
    }

    /**
     * If mouse down is performed inside the blok, we should watch CBS
     */
    if (UI.nodes.redactor.contains(event.target as Node)) {
      this.watchSelection(event);
    } else {
      /**
       * Otherwise, clear selection
       */
      this.Blok.BlockSelection.clearSelection(event);
    }
  }

  /**
   * Mouse up event handler.
   * Removes the listeners and shows toolbar for multi-block selection
   */
  private onMouseUp = (): void => {
    this.listeners.off(document, 'mouseover', this.onMouseOver);
    this.listeners.off(document, 'mouseup', this.onMouseUp);

    this.nestedRangeDragActive = false;

    /**
     * Show toolbar for multi-block selection after mouse up
     */
    if (this.isCrossBlockSelectionStarted) {
      /**
       * Disable hover detection for a cooldown period and reset the hover state.
       * This prevents any pending throttled mousemove events from emitting
       * BlockHovered events that could move the toolbar before the user
       * intentionally hovers over a block.
       */
      this.Blok.UI.disableHoverForCooldown();
      this.Blok.UI.resetBlockHoverState();

      this.Blok.Toolbar.moveAndOpenForMultipleBlocks();
      this.announceSelectionCount();
    }
  };

  /**
   * Mouse over event handler
   * Gets target and related blocks and change selected state for blocks in between
   * @param {Event} event - mouse over event
   */
  private onMouseOver = (event: Event): void => {
    const mouseEvent = event as MouseEvent;
    const { BlockManager, BlockSelection, DragManager } = this.Blok;

    /**
     * Skip cross-block selection when a drag operation is in progress
     */
    if (DragManager.isDragging) {
      return;
    }

    /**
     * Skip cross-block selection when any toolbar/popover is open
     */
    if (this.Blok.UI.someToolbarOpened) {
      return;
    }

    /**
     * Skip cross-block selection when rectangle selection is active.
     * Both modules listen for mouse events during drag; without this guard
     * toggleBlocksSelectedState fights with trySelectNextBlock, causing
     * unpredictable skipped/deselected blocks.
     */
    if (this.Blok.RectangleSelection.isRectActivated()) {
      return;
    }

    /**
     * Probably, blok is not initialized yet
     */
    if (mouseEvent.relatedTarget === null && mouseEvent.target === null) {
      return;
    }

    const rawRelatedBlock = BlockManager.getBlockByChildNode(mouseEvent.relatedTarget as Node) || this.lastSelectedBlock;
    const rawTargetBlock = BlockManager.getBlockByChildNode(mouseEvent.target as Node);

    if (!rawRelatedBlock || !rawTargetBlock) {
      return;
    }

    /**
     * Resolve child blocks (e.g. paragraphs inside table cells) to their root parent.
     * Without this, dragging across a table would select individual cell blocks
     * from the flat blocks array instead of treating the table as a single unit.
     */
    const relatedBlock = BlockManager.resolveToRootBlock(rawRelatedBlock);
    const targetBlock = BlockManager.resolveToRootBlock(rawTargetBlock);

    if (targetBlock === relatedBlock) {
      /**
       * Both blocks live inside the same root container (e.g. a table).
       * Each child block is its own contenteditable, so the browser cannot
       * extend a native text selection across them — without this branch a
       * drag across several lines inside one table cell selects NOTHING.
       * When the drag stays inside one nested-blocks container (one cell),
       * select the child-block range, mirroring how a drag across top-level
       * blocks selects them.
       */
      this.handleSameRootHover(rawTargetBlock);

      return;
    }

    if (this.firstSelectedBlock && relatedBlock === this.firstSelectedBlock) {
      SelectionUtils.get()?.removeAllRanges();

      relatedBlock.selected = true;
      targetBlock.selected = true;

      BlockSelection.clearCache();

      return;
    }

    if (this.firstSelectedBlock && targetBlock === this.firstSelectedBlock) {
      const rIndex = BlockManager.blocks.indexOf(relatedBlock);
      const tIndex = BlockManager.blocks.indexOf(targetBlock);
      const start = Math.min(rIndex, tIndex);
      const end = Math.max(rIndex, tIndex);

      for (const i of Array.from({ length: end - start + 1 }, (_, idx) => start + idx)) {
        BlockManager.blocks[i].selected = false;
      }

      BlockSelection.clearCache();

      return;
    }

    this.Blok.InlineToolbar.close();

    /**
     * A drag that started inside a nested container (table cell) may have
     * selected child blocks before leaving the container's root — drop those
     * so the root-level range selection below is the only selection.
     */
    this.clearNestedBlockSelection();

    this.toggleBlocksSelectedState(relatedBlock, targetBlock);
    this.lastSelectedBlock = targetBlock;
  };

  /**
   * Return the nearest nested-blocks container (e.g. a table cell's blocks
   * wrapper) holding the given block, or null for top-level blocks.
   * @param block - the block whose container to find
   */
  private getNestedBlocksContainer(block: Block): HTMLElement | null {
    return block.holder.parentElement?.closest<HTMLElement>(`[${DATA_ATTR.nestedBlocks}]`) ?? null;
  }

  /**
   * Handle a drag hover where the hovered block and the drag anchor resolve to
   * the same root block. When the gesture started on a child block and the
   * hovered block is a DIFFERENT child of the SAME nested-blocks container
   * (several "lines" inside one table cell), select the child-block range
   * between them. When the hover leaves that container (e.g. crosses into
   * another cell, where the table's own rectangle selection takes over), drop
   * any child-block selection this path created.
   * @param rawTargetBlock - the (unresolved) block currently hovered
   */
  private handleSameRootHover(rawTargetBlock: Block): void {
    const anchorBlock = this.firstSelectedBlock;

    if (!anchorBlock) {
      return;
    }

    const targetContainer = this.getNestedBlocksContainer(rawTargetBlock);
    const anchorContainer = this.getNestedBlocksContainer(anchorBlock);

    if (targetContainer === null || targetContainer !== anchorContainer) {
      this.clearNestedBlockSelection();

      return;
    }

    if (rawTargetBlock === anchorBlock) {
      /**
       * The pointer is (back) on the anchor line. Only collapse the range to
       * the anchor when this gesture already selected a multi-line range —
       * otherwise this is a plain text drag inside one line (the pointer may
       * graze the cell padding and re-enter) and the native text selection
       * must be left alone.
       */
      if (this.nestedRangeDragActive) {
        this.selectNestedBlockRange(targetContainer, anchorBlock, anchorBlock);
      }

      return;
    }

    this.nestedRangeDragActive = true;
    this.selectNestedBlockRange(targetContainer, anchorBlock, rawTargetBlock);
  }

  /**
   * Select the DOM-ordered range of child blocks between two blocks of one
   * nested-blocks container, deselecting the container's other children.
   * @param container - the nested-blocks container (one table cell)
   * @param anchorBlock - the child block the drag started on
   * @param targetBlock - the child block currently hovered
   */
  private selectNestedBlockRange(container: HTMLElement, anchorBlock: Block, targetBlock: Block): void {
    const { BlockManager, BlockSelection } = this.Blok;

    /** Child blocks of THIS container only, in DOM order (not of nested containers deeper down). */
    const childBlocks = Array.from(container.querySelectorAll<HTMLElement>(`[${DATA_ATTR.element}]`))
      .filter((holder) => holder.parentElement?.closest(`[${DATA_ATTR.nestedBlocks}]`) === container)
      .map((holder) => BlockManager.getBlock(holder))
      .filter((block): block is Block => block !== undefined);

    const anchorIndex = childBlocks.indexOf(anchorBlock);
    const targetIndex = childBlocks.indexOf(targetBlock);

    if (anchorIndex === -1 || targetIndex === -1) {
      return;
    }

    /**
     * The native selection is confined to the anchor line's contenteditable
     * and cannot grow past it — replace it with a block-level selection.
     */
    SelectionUtils.get()?.removeAllRanges();

    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);

    childBlocks.forEach((_, index) => {
      childBlocks[index].selected = index >= start && index <= end;
    });

    BlockSelection.clearCache();

    this.firstSelectedBlock = anchorBlock;
    this.lastSelectedBlock = targetBlock;

    this.Blok.InlineToolbar.close();
    this.Blok.Toolbar.close();
  }

  /**
   * Deselect any child (nested) blocks selected by the intra-container drag
   * path. Top-level block selections are left untouched.
   */
  private clearNestedBlockSelection(): void {
    const { BlockManager, BlockSelection } = this.Blok;

    const selectedChildren = BlockManager.blocks.filter((block) => block.selected && block.parentId != null);

    if (selectedChildren.length === 0) {
      return;
    }

    selectedChildren.forEach((_, index) => {
      selectedChildren[index].selected = false;
    });

    BlockSelection.clearCache();
  }

  /**
   * Change blocks selection state between passed two blocks.
   * @param {Block} firstBlock - first block in range
   * @param {Block} lastBlock - last block in range
   */
  private toggleBlocksSelectedState(firstBlock: Block, lastBlock: Block): void {
    const { BlockManager, BlockSelection } = this.Blok;
    const fIndex = BlockManager.blocks.indexOf(firstBlock);
    const lIndex = BlockManager.blocks.indexOf(lastBlock);

    /**
     * If first and last block have the different selection state
     * it means we should't toggle selection of the first selected block.
     * In the other case we shouldn't toggle the last selected block.
     */
    const shouldntSelectFirstBlock = firstBlock.selected !== lastBlock.selected;

    const startIndex = Math.min(fIndex, lIndex);
    const endIndex = Math.max(fIndex, lIndex);

    for (const i of Array.from({ length: endIndex - startIndex + 1 }, (unused, idx) => startIndex + idx)) {
      const block = BlockManager.blocks[i];

      if (
        block !== this.firstSelectedBlock &&
        block !== (shouldntSelectFirstBlock ? firstBlock : lastBlock)
      ) {
        BlockManager.blocks[i].selected = !BlockManager.blocks[i].selected;

        BlockSelection.clearCache();
      }
    }

    /**
     * Do not keep the Toolbar visible while range selection is active.
     */
    this.Blok.Toolbar.close();
  }
}
