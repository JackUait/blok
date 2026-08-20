import { Module } from '../__module';
import type { Block } from '../block';
import { DATA_ATTR } from '../constants';
import { clearCrossBlockHighlight, isCrossBlockHighlightSupported, paintCrossBlockHighlight } from '../selection/cross-block-highlight';
import {
  applySpanningSelection,
  blocksBetween,
  caretPointFromCoords,
  focusEdgeForPointer,
  getEditingHost,
  hasEditableContent,
  pointAtInputBoundary,
  resolveCrossBlockTextSelection
} from '../selection/cross-block-range';
import type { CrossBlockTextSelection } from '../selection/cross-block-range';
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
   * Where the current pointer gesture started, as a DOM position. Captured
   * lazily on the first mousemove — a mousedown handler runs BEFORE the browser
   * has placed the caret, so reading the selection there yields the previous one.
   */
  private textDragAnchor: { node: Node; offset: number } | null = null;

  /**
   * Viewport point of the mousedown, used to recover the drag anchor when the
   * browser has not placed a caret we can read (e.g. the press landed on
   * padding rather than on text).
   */
  private textDragOrigin: { x: number; y: number } | null = null;

  /**
   * Whether the current gesture has produced a cross-block TEXT selection. While
   * true the block-level drag path stands down: the two are alternative readings
   * of the same gesture and must never both run.
   */
  private textDragActive = false;

  /**
   * The spanning range the drag last asked for, plus a one-shot permit to
   * re-assert it.
   *
   * Firefox performs its own (host-clamped) selection update as the mousemove's
   * DEFAULT action — i.e. AFTER our handler has run — so the range applied
   * during the handler is overwritten before it is ever painted. Re-asserting
   * from `selectionchange` fixes it on every engine without sniffing any of
   * them: whenever something else rewrites the selection mid-drag, we put ours
   * back. The permit is consumed per mousemove so an engine that clamped in
   * RESPONSE to our write could not drive an endless ping-pong.
   */
  private textDragIntent: {
    anchor: { node: Node; offset: number };
    focus: { node: Node; offset: number };
    applied: { startContainer: Node; startOffset: number; endContainer: Node; endOffset: number };
    reassertAllowed: boolean;
  } | null = null;

  /**
   * Module preparation
   * @returns {Promise}
   */
  public async prepare(): Promise<void> {
    this.listeners.on(document, 'mousedown', (event: Event) => {
      this.enableCrossBlockSelection(event as MouseEvent);
    });

    /**
     * Undebounced on purpose: this repaints the cross-block selection, so any
     * delay would show the range moving a frame behind the pointer. The handler
     * bails on the first cheap check for every ordinary (single-host) selection.
     */
    this.listeners.on(document, 'selectionchange', () => {
      this.reassertTextDragSelection();
      this.syncTextSelectionHighlight();
    });
  }

  /**
   * Release the document-global highlight registry entry on the way out — it
   * outlives this editor otherwise, leaving a painted selection over content
   * that is no longer there.
   */
  public override markDestroyed(): void {
    clearCrossBlockHighlight(this);
    this.Blok.UI?.nodes?.wrapper?.removeAttribute(DATA_ATTR.crossSelection);

    super.markDestroyed();
  }

  /**
   * The current cross-block TEXT selection, or null when the document selection
   * is collapsed, empty, single-block, or outside this editor.
   */
  public get textSelection(): CrossBlockTextSelection | null {
    const redactor = this.Blok.UI.nodes.redactor;

    if (!redactor) {
      return null;
    }

    return resolveCrossBlockTextSelection(
      redactor,
      (node) => this.Blok.BlockManager.getBlockByChildNode(node)
    );
  }

  /**
   * Promote a cross-block TEXT selection to a block-level selection of the same
   * blocks — what Escape does in Notion, and the way a user moves from "these
   * characters" to "these blocks" without re-dragging.
   * @returns true when there was a text selection to promote
   */
  public selectBlocksOfTextSelection(): boolean {
    const { BlockManager } = this.Blok;
    const selection = this.textSelection;

    if (selection === null) {
      return false;
    }

    const anchor = BlockManager.resolveToSelectableBlock(selection.startBlock);
    const target = BlockManager.resolveToSelectableBlock(selection.endBlock);

    if (!this.applySelectionRange(anchor, target)) {
      return false;
    }

    this.firstSelectedBlock = anchor;
    this.lastSelectedBlock = target;

    /** applySelectionRange dropped the range; drop the paint that went with it. */
    this.syncTextSelectionHighlight();

    this.Blok.InlineToolbar.close();
    this.Blok.Toolbar.moveAndOpenForMultipleBlocks();
    this.announceSelectionCount();

    return true;
  }

  /**
   * Drop a cross-block text selection outright: the document range goes, and so
   * does the paint. Used before editing over the selection, so the stale range
   * cannot be re-read once the DOM under it has changed.
   */
  public clearTextSelection(): void {
    SelectionUtils.get()?.removeAllRanges();
    this.syncTextSelectionHighlight();
  }

  /**
   * Repaint (or drop) the cross-block selection highlight to match the document
   * selection, and stamp the wrapper so the engine's own ::selection paint is
   * suppressed exactly while ours is up.
   */
  public syncTextSelectionHighlight(): void {
    if (this.isDestroyed) {
      return;
    }

    const wrapper = this.Blok.UI.nodes.wrapper;
    const selection = this.textSelection;

    /**
     * Written only on an actual transition: this runs on EVERY selectionchange,
     * and an attribute touch on the wrapper is a DOM mutation like any other.
     */
    const marked = wrapper !== undefined && wrapper.hasAttribute(DATA_ATTR.crossSelection);

    if (selection === null) {
      clearCrossBlockHighlight(this);

      if (marked) {
        wrapper?.removeAttribute(DATA_ATTR.crossSelection);
      }

      return;
    }

    paintCrossBlockHighlight(this, selection.subRanges.map((sub) => sub.range));

    /**
     * Only suppress the native paint when ours actually replaced it — on an
     * engine without the Custom Highlight API the selection would otherwise
     * become invisible.
     */
    if (!marked && isCrossBlockHighlightSupported()) {
      wrapper?.setAttribute(DATA_ATTR.crossSelection, '');
    }
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
    this.textDragActive = false;
    this.textDragAnchor = null;
    this.textDragIntent = null;
    this.textDragOrigin = { x: event.clientX,
      y: event.clientY };

    this.listeners.on(document, 'mouseover', this.onMouseOver);
    this.listeners.on(document, 'mousemove', this.onMouseMove);
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

    const targetBlock = BlockManager.resolveToSelectableBlock(clickedBlock);

    const anchorCandidate = this.firstSelectedBlock ?? BlockManager.currentBlock ?? null;

    if (!anchorCandidate) {
      return false;
    }

    const anchorBlock = BlockManager.resolveToSelectableBlock(anchorCandidate);

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

    const hoverBlock = BlockManager.resolveToSelectableBlock(rawHover);

    if (hoverBlock === this.shiftDragClickedBlock) {
      return;
    }

    const draggedRange = BlockManager.getSelectionSiblingRange(this.shiftDragClickedBlock, hoverBlock);

    if (draggedRange.length === 0) {
      return;
    }

    const draggedIds = new Set(draggedRange.map((block) => block.id));

    this.shiftDragActive = true;
    SelectionUtils.get()?.removeAllRanges();

    BlockManager.blocks.forEach((block, index) => {
      const inBaseSelection = this.shiftDragBaseSelected?.has(block.id) ?? false;

      BlockManager.blocks[index].selected = draggedIds.has(block.id) || inBaseSelection;
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

    const targetBlock = BlockManager.resolveToSelectableBlock(clickedBlock);

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
    if (!this.applySelectionRange(anchorBlock, targetBlock)) {
      return;
    }

    this.firstSelectedBlock = anchorBlock;
    this.lastSelectedBlock = targetBlock;

    this.Blok.InlineToolbar.close();
    this.Blok.Toolbar.moveAndOpenForMultipleBlocks();
  }

  /**
   * Select exactly the blocks a range gesture from `anchorBlock` to
   * `targetBlock` covers, deselecting everything else.
   *
   * The range comes from BlockManager.getSelectionSiblingRange, which lifts both
   * endpoints to siblings under their lowest common ancestor. Walking flat
   * indices between the endpoints instead selected every block STORED in
   * between — for a range crossing a toggle or callout that is the container
   * AND its children, so Duplicate duplicated the subtree twice.
   *
   * Assigning (rather than toggling) makes the call idempotent, so a drag that
   * reverses direction, jumps rows, or re-fires on the same row always ends up
   * with the selection its rectangle describes.
   * @param anchorBlock - the block the gesture started on
   * @param targetBlock - the block the gesture currently reaches
   * @returns true when a range was applied
   */
  private applySelectionRange(anchorBlock: Block, targetBlock: Block): boolean {
    const { BlockManager, BlockSelection } = this.Blok;

    const range = BlockManager.getSelectionSiblingRange(anchorBlock, targetBlock);

    if (range.length === 0) {
      return false;
    }

    SelectionUtils.get()?.removeAllRanges();

    const selectedIds = new Set(range.map((block) => block.id));

    for (const block of BlockManager.blocks) {
      block.selected = selectedIds.has(block.id);
    }

    BlockSelection.clearCache();

    return true;
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
    const { BlockManager } = this.Blok;

    const anchorCandidate = this.lastSelectedBlock ?? BlockManager.currentBlock;

    if (!anchorCandidate) {
      return;
    }

    if (!this.lastSelectedBlock) {
      this.lastSelectedBlock = this.firstSelectedBlock = anchorCandidate;
    }

    const anchorBlock = this.firstSelectedBlock;
    const movingEnd = this.lastSelectedBlock;

    if (anchorBlock === null || movingEnd === null) {
      return;
    }

    const nextBlock = this.siblingStep(movingEnd, next);

    if (nextBlock === null) {
      return;
    }

    if (!this.applySelectionRange(anchorBlock, nextBlock)) {
      return;
    }

    this.lastSelectedBlock = nextBlock;

    /** close InlineToolbar when Blocks selected */
    this.Blok.InlineToolbar.close();

    /**
     * Hide the Toolbar while the keyboard selection is growing.
     */
    this.Blok.Toolbar.close();

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
   * The block one step before/after `block` at ITS OWN level, climbing out of
   * the container when there is no sibling left.
   *
   * Stepping by flat index instead walks INTO the next container: Shift+Down on
   * a toggle heading landed on its first child, then on a table cell, so the
   * selection appeared frozen while the user pressed the key.
   * @param block - the moving end of the keyboard selection
   * @param next - true to step forward, false to step back
   */
  private siblingStep(block: Block, next: boolean): Block | null {
    const { BlockManager } = this.Blok;

    const cursor = BlockManager.resolveToSelectableBlock(block);
    const siblings = BlockManager.blocks.filter((candidate) => candidate.parentId === cursor.parentId);
    const step = siblings[siblings.indexOf(cursor) + (next ? 1 : -1)];

    if (step !== undefined) {
      return step;
    }

    const parent = cursor.parentId === null ? undefined : BlockManager.getBlockById(cursor.parentId);

    return parent === undefined ? null : this.siblingStep(parent, next);
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
    this.listeners.off(document, 'mousemove', this.onMouseMove);
    this.listeners.off(document, 'mouseup', this.onMouseUp);

    this.nestedRangeDragActive = false;

    /**
     * A text drag never selected blocks, so there is no multi-block toolbar to
     * open — and re-asserting the range one last time undoes the re-clamp the
     * engine performs on the mouseup itself.
     */
    if (this.textDragActive) {
      this.textDragActive = false;
      this.textDragAnchor = null;
      this.textDragOrigin = null;
      this.textDragIntent = null;
      this.syncTextSelectionHighlight();

      return;
    }

    this.textDragAnchor = null;
    this.textDragOrigin = null;
    this.textDragIntent = null;

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
   * Mouse move handler for a left-button drag: the cross-block TEXT selection.
   *
   * Runs on mousemove rather than mouseover because the focus must follow the
   * pointer character by character, and because every engine RE-CLAMPS the
   * selection to the anchor's editing host on each native move — the spanning
   * range has to be re-asserted per move or it survives only until the next one.
   * @param event - mouse move event
   */
  private onMouseMove = (event: Event): void => {
    const mouseEvent = event as MouseEvent;
    const { BlockManager, DragManager, RectangleSelection, UI } = this.Blok;

    /**
     * `textDragOrigin`, not `firstSelectedBlock`, marks a live gesture: entering
     * text mode deselects blocks, and BlockSelection.clearSelection calls this
     * module's own clear(), which nulls firstSelectedBlock — gating on it froze
     * the focus at the first block the drag reached.
     */
    if (
      this.textDragOrigin === null ||
      DragManager.isDragging ||
      RectangleSelection.isRectActivated() ||
      UI.someToolbarOpened
    ) {
      return;
    }

    /**
     * The button was released outside the window: mouseup never arrived, so the
     * gesture is over even though the listeners are still attached.
     */
    if ((mouseEvent.buttons & 1) === 0) {
      return;
    }

    const anchor = this.resolveTextDragAnchor();

    if (anchor === null) {
      return;
    }

    const anchorHost = getEditingHost(anchor.node);
    const anchorBlock = anchorHost === null ? undefined : BlockManager.getBlockByChildNode(anchorHost);

    if (anchorHost === null || anchorBlock === undefined) {
      return;
    }

    const focus = this.resolveTextDragFocus(mouseEvent, anchorHost);
    const focusHost = focus === null ? null : getEditingHost(focus.node);

    if (focus === null || focusHost === null) {
      return;
    }

    const focusBlock = BlockManager.getBlockByChildNode(focusHost);

    /**
     * The pointer is back inside the block it started in. The engine's own
     * within-host update is now the CORRECT selection, so the standing intent is
     * dropped — left armed, the re-assert would keep restoring the wider
     * cross-block range and the selection could never shrink back. `textDragActive`
     * stays set so the block-level path remains stood down; re-crossing re-arms
     * the intent on the next apply.
     */
    if (focusHost === anchorHost || focusBlock === anchorBlock) {
      this.textDragIntent = null;

      return;
    }

    if (focusBlock === undefined) {
      return;
    }

    /**
     * The drag left the territory a text selection may cover (another table cell,
     * a different container, a block with no text). Hand the gesture back: the
     * intent stops being re-asserted and the block-level path is re-enabled, so
     * whichever subsystem owns that drag — the table's cell selection, the
     * block-range path — can take it.
     */
    if (!this.canSelectTextAcross(anchorBlock, focusBlock)) {
      const wasTextDrag = this.textDragActive;

      this.textDragIntent = null;
      this.textDragActive = false;

      /**
       * Only take over when a text range was actually standing: mouseover fires
       * on boundary CROSSINGS, and the gesture has already crossed into this
       * block while the block path was stood down — so nothing else would
       * replace the now-illegal range before mouseup.
       */
      if (wasTextDrag) {
        this.takeOverWithBlockRange(anchorBlock, focusBlock);
      }

      return;
    }

    const applied = applySpanningSelection(anchor, focus);

    if (applied === null) {
      return;
    }

    this.textDragIntent = {
      anchor,
      focus,
      applied: {
        startContainer: applied.startContainer,
        startOffset: applied.startOffset,
        endContainer: applied.endContainer,
        endOffset: applied.endOffset,
      },
      reassertAllowed: true,
    };

    if (!this.textDragActive) {
      this.textDragActive = true;
      this.deselectAllBlocks();
      this.Blok.InlineToolbar.close();
      this.Blok.Toolbar.close();
    }

    this.syncTextSelectionHighlight();
  };

  /**
   * Replace a standing cross-block text range with the block-level range the
   * same gesture describes, for a drag that has left the territory a text
   * selection may cover.
   * @param anchorBlock - block the gesture started in
   * @param targetBlock - block the pointer is over
   */
  private takeOverWithBlockRange(anchorBlock: Block, targetBlock: Block): void {
    const { BlockManager } = this.Blok;
    const anchor = BlockManager.resolveToSelectableBlock(this.firstSelectedBlock ?? anchorBlock);
    const target = BlockManager.resolveToSelectableBlock(targetBlock);

    if (anchor === target) {
      return;
    }

    this.clearNestedBlockSelection();

    if (!this.applySelectionRange(anchor, target)) {
      return;
    }

    this.lastSelectedBlock = target;

    this.Blok.InlineToolbar.close();
    this.Blok.Toolbar.close();
  }

  /**
   * Put the drag's spanning range back when something else has rewritten the
   * selection mid-drag. See {@link textDragIntent} for why this is needed.
   */
  private reassertTextDragSelection(): void {
    const intent = this.textDragIntent;

    if (!this.textDragActive || intent === null || !intent.reassertAllowed) {
      return;
    }

    const selection = SelectionUtils.get();
    const range = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const matches = range !== null &&
      range.startContainer === intent.applied.startContainer &&
      range.startOffset === intent.applied.startOffset &&
      range.endContainer === intent.applied.endContainer &&
      range.endOffset === intent.applied.endOffset;

    if (matches) {
      return;
    }

    intent.reassertAllowed = false;
    applySpanningSelection(intent.anchor, intent.focus);
  }

  /**
   * The gesture's anchor position, captured once and reused for the rest of the
   * drag.
   *
   * It cannot be read in the mousedown handler: the browser places the caret as
   * the mousedown's DEFAULT action, so at handler time the selection still holds
   * the previous one. By the first mousemove it is correct, and caching it there
   * also survives our own spanning range replacing the selection (for a backwards
   * drag the range's START is the focus, not the anchor).
   */
  private resolveTextDragAnchor(): { node: Node; offset: number } | null {
    if (this.textDragAnchor !== null) {
      return this.textDragAnchor;
    }

    const selection = SelectionUtils.get();
    const anchorNode = selection?.anchorNode ?? null;
    const anchorHost = getEditingHost(anchorNode);

    const insideRedactor = anchorHost !== null && this.Blok.UI.nodes.redactor?.contains(anchorHost);

    if (anchorNode !== null && anchorHost !== null && insideRedactor) {
      this.textDragAnchor = { node: anchorNode,
        offset: selection?.anchorOffset ?? 0 };

      return this.textDragAnchor;
    }

    const origin = this.textDragOrigin;

    this.textDragAnchor = origin === null ? null : caretPointFromCoords(origin.x, origin.y, document);

    return this.textDragAnchor;
  }

  /**
   * Where the drag currently points. Falls back to the edge of the hovered block
   * the pointer actually reached when the hit test lands outside any editing
   * host — a pointer in a block's padding or in the sliver between two blocks
   * must still move the selection, not freeze it at the last character it
   * passed over. See {@link focusEdgeForPointer} for why the edge is chosen
   * from geometry rather than from the drag's direction.
   * @param event - the mouse move event
   * @param anchorHost - the editing host the gesture started in
   */
  private resolveTextDragFocus(
    event: MouseEvent,
    anchorHost: HTMLElement
  ): { node: Node; offset: number } | null {
    const point = caretPointFromCoords(event.clientX, event.clientY, document);

    if (point !== null && getEditingHost(point.node) !== null) {
      return point;
    }

    const hoveredBlock = this.Blok.BlockManager.getBlockByChildNode(event.target as Node);
    const hoveredInput = hoveredBlock?.firstInput;

    if (hoveredBlock === undefined || hoveredInput === undefined) {
      return null;
    }

    const anchorIsBefore = (anchorHost.compareDocumentPosition(hoveredInput) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const edge = focusEdgeForPointer(
      hoveredInput,
      hoveredBlock.lastInput ?? hoveredInput,
      event.clientY,
      anchorIsBefore
    );

    return pointAtInputBoundary(edge.input, edge.atEnd);
  }

  /**
   * Whether a drag between these two blocks should read as a TEXT selection
   * rather than a block-level one.
   *
   * Both endpoints must sit in the same nested-blocks container (both `null` for
   * top-level blocks) — a drag that leaves its container is a structural gesture
   * belonging to the block-level path, and merging across containers is refused
   * downstream anyway. Subtrees a tool claimed with `data-blok-keyboard-owner`
   * are excluded outright: their keyboard, and so their editing model, is not
   * Blok's to drive.
   * @param anchorBlock - block the gesture started in
   * @param targetBlock - block the pointer is over
   */
  private canSelectTextAcross(anchorBlock: Block, targetBlock: Block): boolean {
    const ownsKeyboard = (block: Block): boolean => {
      return block.holder.closest(`[${DATA_ATTR.keyboardOwner}]`) !== null;
    };

    if (ownsKeyboard(anchorBlock) || ownsKeyboard(targetBlock)) {
      return false;
    }

    if (this.getNestedBlocksContainer(anchorBlock) !== this.getNestedBlocksContainer(targetBlock)) {
      return false;
    }

    /**
     * A block with no editable host in between — an image, a divider — has no
     * text to take a share of the range, so a text selection would paint AROUND
     * it while still being deleted with it. Such a drag stays a block-level
     * gesture, which is also what it already looked like to the user.
     */
    return blocksBetween(this.Blok.BlockManager.blocks, anchorBlock, targetBlock)
      .every((block) => hasEditableContent(block.holder));
  }

  /**
   * Mouse over event handler
   * Gets target and related blocks and change selected state for blocks in between
   * @param {Event} event - mouse over event
   */
  private onMouseOver = (event: Event): void => {
    const mouseEvent = event as MouseEvent;
    const { BlockManager, DragManager } = this.Blok;

    /**
     * The gesture is already reading as a cross-block TEXT selection; the
     * block-level range would wipe the very range that path just applied.
     */
    if (this.textDragActive) {
      return;
    }

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
     * the drag range fights with trySelectNextBlock, causing
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
    const relatedBlock = BlockManager.resolveToSelectableBlock(rawRelatedBlock);
    const targetBlock = BlockManager.resolveToSelectableBlock(rawTargetBlock);

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

    this.Blok.InlineToolbar.close();

    /**
     * A drag that started inside a nested container (table cell) may have
     * selected child blocks before leaving the container's root — drop those
     * so the range selection below is the only selection.
     */
    this.clearNestedBlockSelection();

    /**
     * Recomputed from the drag's own anchor on every hover rather than toggled
     * incrementally: a mouseover can fire out of order, skip rows, or repeat on
     * the same row, and a toggle then leaves holes and stale edges behind.
     */
    this.applySelectionRange(this.firstSelectedBlock ?? relatedBlock, targetBlock);

    this.Blok.Toolbar.close();

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
   * between them.
   *
   * Residual trigger: a same-container drag the TEXT path declined — a line with
   * no editable host (an image line inside a cell), or a subtree a tool claimed
   * with `data-blok-keyboard-owner`. Ordinary text lines take the text path now. When the hover leaves that container (e.g. crosses into
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
   * Drop every block-level selection, without going through
   * BlockSelection.clearSelection — that also calls this module's clear(), which
   * would tear down the gesture state the in-progress drag still needs.
   */
  private deselectAllBlocks(): void {
    const { BlockManager, BlockSelection } = this.Blok;

    if (!BlockSelection.anyBlockSelected) {
      return;
    }

    BlockManager.blocks.forEach((_, index) => {
      BlockManager.blocks[index].selected = false;
    });

    BlockSelection.clearCache();
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
}
