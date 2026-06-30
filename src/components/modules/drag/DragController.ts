import { Module } from '../../__module';
import { BlockToolAPI } from '../../block';
import type { Block } from '../../block';
import { DATA_ATTR } from '../../constants';
import { announce } from '../../utils/announcer';
import { highlightBlockArrival } from '../../utils/highlight-block-arrival';
import { hide as hideTooltip } from '../../utils/tooltip';

import { addColumnToList, wrapInNewColumnList } from '../../../tools/column-drop';
import { INDENT_PER_LEVEL } from '../../../tools/list/constants';
import { LIST_TEST_IDS } from '../../../tools/list/dom-builder';
import { DragA11y } from './a11y/DragA11y';
import { DragOperations } from './operations/DragOperations';
import { DragPreview } from './preview/DragPreview';
import { DragStateMachine, isActuallyDragging, isDragActive } from './state/DragStateMachine';
import { DropTargetDetector } from './target/DropTargetDetector';
import { AutoScroll } from './utils/AutoScroll';
import {
  finishColumnDropAnimations,
  settleDragPreview,
} from './utils/ColumnDropAnimation';
import { ToggleSpringLoader } from './utils/ToggleSpringLoader';
import { hasPassedThreshold } from './utils/drag.constants';
import { findScrollableAncestor } from './utils/findScrollableAncestor';
import { ListItemDescendants } from './utils/ListItemDescendants';
import { getListItemDepth } from './utils/depthUtils';

interface BoundHandlers {
  onMouseMove: (e: MouseEvent) => void;
  onMouseUp: (e: MouseEvent) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onKeyUp: (e: KeyboardEvent) => void;
}

export class DragController extends Module {
  private stateMachine: DragStateMachine = new DragStateMachine();
  private preview: DragPreview = new DragPreview();
  private targetDetector: DropTargetDetector | null = null;
  private operations: DragOperations | null = null;
  private a11y: DragA11y | null = null;
  private autoScroll: AutoScroll | null = null;
  private springLoader: ToggleSpringLoader = new ToggleSpringLoader();
  private listItemDescendants: ListItemDescendants | null = null;
  private boundHandlers: BoundHandlers | null = null;
  /**
   * Tracks the active mousedown cleanup per drag-handle element.
   *
   * The toolbar reuses a single settings-toggler element across blocks, so
   * `setupDragHandle` gets called repeatedly for the same element with
   * different `Block` references. Any stale listener from a previous block
   * must be removed before attaching a new one — otherwise multiple
   * listeners fire on the same mousedown and the oldest (wrong, unrelated)
   * block wins the race inside the state machine.
   */
  private dragHandleCleanups: WeakMap<HTMLElement, () => void> = new WeakMap();

  /**
   * Unsubscribers returned by `Block.addDestroyCallback` for every block
   * participating in the current drag. If any source block is destroyed
   * mid-drag (Yjs remote update, block conversion, blockManager.update)
   * the associated callback cancels the drag before the state machine's
   * stale reference can reach the drop handler.
   */
  private sourceBlockDestroyUnsubs: Array<() => void> = [];

  public get isDragging(): boolean {
    return isActuallyDragging(this.stateMachine.getState());
  }

  public async prepare(): Promise<void> {
    // No preparation needed - initialization happens lazily
  }

  private lazyInit(): void {
    if (this.targetDetector && this.operations && this.a11y && this.listItemDescendants) {
      return; // Already initialized
    }

    this.targetDetector = new DropTargetDetector(
      { contentRect: this.Blok.UI.contentRect },
      this.Blok.BlockManager
    );

    this.operations = new DragOperations(
      this.Blok.BlockManager,
      this.Blok.YjsManager,
      this.Blok.BlockSelection
    );

    this.a11y = new DragA11y(
      this.Blok.BlockManager,
      this.Blok.I18n,
      { announce }
    );

    this.listItemDescendants = new ListItemDescendants(this.Blok.BlockManager);
  }

  public cancelTracking(): void {
    if (isDragActive(this.stateMachine.getState()) && !isActuallyDragging(this.stateMachine.getState())) {
      // Skip reopening toolbar when cancelling drag tracking
      // This prevents unwanted toolbar movement when called from settings toggler click
      this.cleanup(false, true);
    }
  }

  /**
   * Invoked when any participating source block is destroyed mid-drag.
   * Cancels the drag cleanly so the state machine never reaches mouseup
   * with a stale Block reference.
   */
  private onSourceBlockDestroyed(): void {
    if (!isDragActive(this.stateMachine.getState())) {
      return;
    }

    this.cleanup(true, true);
  }

  public setupDragHandle(dragHandle: HTMLElement, block: Block): () => void {
    // Remove any previously-registered listener on this element so we never
    // end up with two handlers racing on the same mousedown. See the comment
    // on `dragHandleCleanups` for the failure mode this guards against.
    this.dragHandleCleanups.get(dragHandle)?.();

    const onMouseDown = (e: MouseEvent): void => {
      // Only handle left mouse button
      if (e.button !== 0) {
        return;
      }

      // Don't start drag when any popover is open
      if (document.querySelector(`[${DATA_ATTR.popoverOpened}]`) !== null) {
        return;
      }

      /**
       * Resolve the source block FRESH at mousedown time by reading the
       * `data-blok-id` off the drag handle's nearest block-holder ancestor.
       * The closure-captured `block` parameter is only a hint — the Toolbar
       * shares ONE settings-toggler across every block and re-parents it on
       * hover, so by the time the user presses down the handle can live in
       * a different block than the one passed at bind time. Trusting the
       * closure alone is the last theoretical path to "wrong block dropped";
       * this lookup kills it. If the handle has no id ancestor (orphaned
       * fixture in tests, or a pre-attachment race) fall back to the closure
       * block — it's the best available reference.
       *
       * Zombie-id guard (Layer 8): if the handle DOES sit inside a holder
       * with a `data-blok-id` but that id resolves to no Block (the block
       * was destroyed and its DOM not yet reaped, or yjs deleted it
       * mid-hover), the closure hint is almost certainly ALSO stale. Abort
       * the drag — a known-dead id is a stronger signal than silence.
       */
      const holderAncestor = dragHandle.closest(`[${DATA_ATTR.id}]`);
      const liveId = holderAncestor?.getAttribute(DATA_ATTR.id) ?? null;

      if (liveId !== null) {
        const liveBlock = this.Blok.BlockManager.getBlockById(liveId);

        if (liveBlock === undefined) {
          return;
        }

        this.startDragTracking(e, liveBlock);

        return;
      }

      this.startDragTracking(e, block);
    };

    dragHandle.addEventListener('mousedown', onMouseDown);

    const cleanup = (): void => {
      dragHandle.removeEventListener('mousedown', onMouseDown);
      if (this.dragHandleCleanups.get(dragHandle) === cleanup) {
        this.dragHandleCleanups.delete(dragHandle);
      }
    };

    this.dragHandleCleanups.set(dragHandle, cleanup);

    return cleanup;
  }

  private startDragTracking(e: MouseEvent, block: Block): void {
    // Initialize dependencies lazily on first drag
    this.lazyInit();

    const contentElement = block.holder.querySelector('[data-blok-element-content]');

    if (!contentElement || !(contentElement instanceof HTMLElement)) {
      return;
    }

    // Determine if this is a multi-block drag
    const isBlockSelected = block.selected;
    const initialBlocks = isBlockSelected
      ? this.Blok.BlockSelection.selectedBlocks
      : [block];

    // For single-block drags, include all descendants (list items via depth, toggles via contentIds)
    const listDescendants = !isBlockSelected && this.listItemDescendants
      ? this.listItemDescendants.getDescendants(block)
      : [];

    // If no list descendants found, check for hierarchy children (toggle blocks)
    const hasHierarchyChildren = !isBlockSelected && block.contentIds?.length > 0;
    const hierarchyDescendants = listDescendants.length === 0 && hasHierarchyChildren
      ? this.getHierarchyDescendants(block)
      : [];
    const descendants = listDescendants.length > 0 ? listDescendants : hierarchyDescendants;

    const blocksToMove = descendants.length > 0
      ? [block, ...descendants]
      : initialBlocks;

    // Create appropriate preview (single or multi-block).
    // For toggles with hierarchy children, use a single-block preview with a badge
    // rather than a stacked multi preview — the toggle is conceptually one unit,
    // and the multi preview would show children twice (nested in the clone + stacked).
    //
    // For multi-block selections (e.g. after Cmd+A), selectedBlocks includes nested
    // blocks such as table cell blocks (parentId points to another selected block).
    // Filter them out before building the preview so they don't appear as separate
    // stacked clones outside their parent's clone (which already contains them via
    // cloneNode). This mirrors the identical filter in DragOperations.moveMultipleBlocks.
    const sourceIds = new Set(blocksToMove.map(b => b.id));
    const previewBlocks = blocksToMove.filter(
      b => b.parentId === null || !sourceIds.has(b.parentId)
    );

    if (previewBlocks.length > 1 && hierarchyDescendants.length === 0) {
      this.preview.createMulti(previewBlocks);
    } else {
      this.preview.createSingle(contentElement, block.stretched, block);
    }

    // Initially hide preview
    this.preview.hide();

    // Add preview to DOM
    const previewElement = this.preview.getElement();
    if (previewElement) {
      document.body.appendChild(previewElement);
    }

    // Start tracking in state machine
    this.stateMachine.startTracking(
      block,
      blocksToMove,
      e.clientX,
      e.clientY
    );

    // Subscribe to destruction of every participating block. If any source
    // is replaced/destroyed mid-drag, cancel the drag immediately so the
    // state machine never holds a stale Block reference at drop time.
    this.sourceBlockDestroyUnsubs = blocksToMove
      .filter((b): b is Block & { addDestroyCallback: (cb: () => void) => () => void } =>
        typeof (b as { addDestroyCallback?: unknown }).addDestroyCallback === 'function'
      )
      .map((b) => b.addDestroyCallback(() => this.onSourceBlockDestroyed()));

    // Initialize auto-scroll with scrollable container
    const scrollContainer = findScrollableAncestor(this.Blok.UI.nodes.wrapper);
    this.autoScroll = new AutoScroll(scrollContainer);

    // Update target detector with source blocks
    if (this.targetDetector) {
      this.targetDetector.setSourceBlocks(blocksToMove);
    }

    // Bind handlers
    this.boundHandlers = {
      onMouseMove: this.onMouseMove.bind(this),
      onMouseUp: this.onMouseUp.bind(this),
      onKeyDown: this.onKeyDown.bind(this),
      onKeyUp: this.onKeyUp.bind(this),
    };

    document.addEventListener('mousemove', this.boundHandlers.onMouseMove);
    document.addEventListener('mouseup', this.boundHandlers.onMouseUp);
    document.addEventListener('keydown', this.boundHandlers.onKeyDown);
    document.addEventListener('keyup', this.boundHandlers.onKeyUp);
  }

  private onMouseMove(e: MouseEvent): void {
    const state = this.stateMachine.getState();
    const sourceBlock = this.stateMachine.getSourceBlock();
    const sourceBlocks = this.stateMachine.getSourceBlocks();

    if (!sourceBlock || !sourceBlocks) {
      return;
    }

    // Check if we've passed the drag threshold and start actual drag
    const { startX, startY } = state as { startX: number; startY: number };
    const shouldStartDrag = !isActuallyDragging(state) && hasPassedThreshold(startX, startY, e.clientX, e.clientY);

    if (shouldStartDrag) {
      this.startActualDrag(sourceBlocks.length);
    }

    // Update preview position
    this.preview.updatePosition(e.clientX, e.clientY);

    // Find drop target and update indicator
    this.updateDropTarget(e.clientX, e.clientY);

    // Handle auto-scroll
    if (this.autoScroll && isActuallyDragging(state)) {
      this.autoScroll.start(e.clientY);
    }
  }

  private startActualDrag(blockCount: number): void {
    // A previous drop's motion may still be in flight; finish it instantly so
    // this drag measures settled rects, not mid-animation ones.
    finishColumnDropAnimations();

    this.stateMachine.startDrag();

    // Prevent settings menu from opening after drag completes
    // Must be called when drag actually starts (after threshold) so that
    // simple clicks don't get affected, but before mouseup so the flag
    // is set when ClickDragHandler's beforeCallback checks it
    this.Blok.Toolbar.skipNextSettingsToggle();

    // Show preview
    this.preview.show();

    // Set global dragging state
    const wrapper = this.Blok.UI.nodes.wrapper;
    wrapper.setAttribute(DATA_ATTR.dragging, 'true');

    // Add multi-block dragging attribute if applicable
    if (blockCount > 1) {
      wrapper.setAttribute(DATA_ATTR.draggingMulti, 'true');
    }

    // Clear selection for single-block drags only
    if (blockCount === 1) {
      this.Blok.BlockSelection.clearSelection();
    }

    hideTooltip();
    // Close toolbar without setting explicitlyClosed flag, so it can reopen after drag is cancelled
    this.Blok.Toolbar.close({ setExplicitlyClosed: false });

    // Announce drag started to screen readers
    const announcementKey = blockCount > 1
      ? 'a11y.dragStartedMultiple'
      : 'a11y.dragStarted';
    const announcementParams = blockCount > 1
      ? { count: blockCount }
      : undefined;

    announce(
      this.Blok.I18n.t(announcementKey, announcementParams),
      { politeness: 'assertive' }
    );
  }

  private updateDropTarget(clientX: number, clientY: number): void {
    const state = this.stateMachine.getState();
    const sourceBlock = this.stateMachine.getSourceBlock();

    if (!isActuallyDragging(state) || !sourceBlock || !this.targetDetector) {
      return;
    }

    // Clear previous indicator from state
    const currentState = this.stateMachine.getState();
    if (currentState.type === 'dragging' && currentState.targetBlock) {
      currentState.targetBlock.holder.removeAttribute('data-drop-indicator');
      currentState.targetBlock.holder.style.removeProperty('--drop-indicator-depth');
      this.clearContentIndicatorOffsets(currentState.targetBlock);
    }

    // Find element under cursor (temporarily hide preview)
    this.preview.hide();
    const elementUnderCursor = document.elementFromPoint(clientX, clientY);
    this.preview.show();

    if (!elementUnderCursor) {
      this.stateMachine.updateTarget(null, null);
      this.springLoader.update(null);
      return;
    }

    // Determine drop target
    const dropTarget = this.targetDetector.determineDropTarget(
      elementUnderCursor,
      clientX,
      clientY,
      sourceBlock
    );

    if (!dropTarget) {
      this.stateMachine.updateTarget(null, null);
      this.springLoader.update(null);
      return;
    }

    // Update state with new target
    this.stateMachine.updateTarget(dropTarget.block, dropTarget.edge, dropTarget.parentId);
    // Spring-load closed toggles: auto-expand after 500ms hover
    this.springLoader.update(dropTarget.block);

    // Show drop indicator
    dropTarget.block.holder.setAttribute('data-drop-indicator', dropTarget.edge);
    dropTarget.block.holder.style.setProperty('--drop-indicator-depth', String(dropTarget.depth));

    // Confine the indicator to the visible content box. The holder spans the
    // full editor width (gutters included), so without these offsets the
    // top/bottom reorder line stretches across the whole screen and the side
    // bars land out in the margins. Applies to every edge.
    //
    // The indicator is tucked to the predicted nesting depth for ANY dragged
    // block — a header/paragraph/etc. nests into a list just like a list item,
    // so the preview must show the same indented slot the block will land at.
    this.applyContentIndicatorOffsets(dropTarget.block, dropTarget.edge, dropTarget.depth);

    // For a column side-drop, stretch the vertical indicator bar to the full
    // height of the column row, not just the single target block.
    this.applySideIndicatorHeight(dropTarget.block, dropTarget.edge);

    // ...and center it on the gutter between the columns, so the line clearly
    // marks an insertion BETWEEN them rather than at one column's edge.
    this.centerSideIndicatorInGutter(dropTarget.block, dropTarget.edge);

    // Announce drop position change to screen readers
    if (this.a11y) {
      this.a11y.announceDropPosition(dropTarget.block, dropTarget.edge);
    }
  }

  /**
   * Sets the `--drop-indicator-side-left/right` custom properties on a block's
   * holder so the drop indicator (top/bottom line and left/right side bars) is
   * confined to the visible content box instead of the full-width holder. Falls
   * back to no offset when the standard content wrapper is absent.
   *
   * @param block - The drop target block
   */
  private applyContentIndicatorOffsets(
    block: Block,
    edge: 'top' | 'bottom' | 'left' | 'right',
    depth: number
  ): void {
    const content = block.holder.querySelector('[data-blok-element-content]');

    if (!(content instanceof HTMLElement)) {
      return;
    }

    const holderRect = block.holder.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();

    block.holder.style.setProperty('--drop-indicator-side-left', `${contentRect.left - holderRect.left}px`);
    block.holder.style.setProperty('--drop-indicator-side-right', `${holderRect.right - contentRect.right}px`);

    // For a list item reorder (top/bottom line), tuck the indicator under the
    // text: start it where the text begins (past the bullet/number marker) and
    // cut it where the text ends, rather than running across the full content
    // width. Side drops (columns) keep the content-box offsets above. Applies to
    // any dragged block — a non-list block nests into a list too, so its preview
    // must sit at the same indented slot it will land at.
    if (edge === 'top' || edge === 'bottom') {
      this.applyListItemTextOffsets(block, holderRect, depth);
    }
  }

  /**
   * Aligns the horizontal drop indicator with a list item: `--drop-indicator-
   * side-left` to the item's start (the marker, at the predicted nesting depth)
   * and `--drop-indicator-side-right` to the text end. The full indent is baked
   * into the left offset, so `--drop-indicator-depth` is zeroed to cancel the
   * CSS depth multiplier. No-op for non-list blocks.
   *
   * @param block - The drop target block
   * @param holderRect - The block holder's bounding rect (already measured)
   * @param predictedDepth - The depth the dropped item will land at
   */
  private applyListItemTextOffsets(block: Block, holderRect: DOMRect, predictedDepth: number): void {
    const container = block.holder.querySelector(
      `[data-blok-testid="${LIST_TEST_IDS.contentContainer}"], [data-blok-testid="${LIST_TEST_IDS.checklistContent}"]`
    );

    if (!(container instanceof HTMLElement)) {
      return;
    }

    // The blue line starts at the very beginning of the list item — the marker
    // (bullet/number/checkbox) — which is the left edge of the listitem element.
    // It falls back to the text container if the listitem wrapper is missing.
    const item = block.holder.querySelector('[role="listitem"]');
    const startRect = item instanceof HTMLElement
      ? item.getBoundingClientRect()
      : container.getBoundingClientRect();

    const containerRect = container.getBoundingClientRect();

    // Shift the line to the PREDICTED depth relative to the target item's own
    // depth. The shift is signed: a deeper predicted depth pushes the line right
    // (nest), a shallower one (e.g. a block landing at root next to a nested
    // item) pulls it back toward the editor edge — without this, the indicator
    // would tuck under the nested item yet the block would land at root, the
    // exact indicator-vs-drop mismatch this whole path exists to prevent.
    const targetDepth = getListItemDepth(block) ?? 0;
    const depthShift = (predictedDepth - targetDepth) * INDENT_PER_LEVEL;

    const textRight = this.measureTextRight(container) ?? containerRect.right;
    const left = Math.max(0, startRect.left - holderRect.left + depthShift);
    const right = Math.max(0, holderRect.right - textRight);

    block.holder.style.setProperty('--drop-indicator-side-left', `${left}px`);
    block.holder.style.setProperty('--drop-indicator-side-right', `${right}px`);
    block.holder.style.setProperty('--drop-indicator-depth', '0');

    // Enable the grayish lead-in segment (editor edge → blue line start) only
    // when the line is actually offset from the editor edge (left > 0). A list
    // reorder always tucks under the marker (left = the bullet/number gap), so it
    // keeps the lead even at depth 0; a block landing flush at root (left = 0) is
    // full-width and gets no lead — leaving it on would falsely preview a nest.
    if (left > 0) {
      block.holder.setAttribute('data-drop-indicator-lead', '');
    } else {
      block.holder.removeAttribute('data-drop-indicator-lead');
    }
  }

  /**
   * Returns the x-coordinate where the rendered text inside a container ends, by
   * measuring its content range. Returns null when the range has no measurable
   * width (empty text, or environments without layout) so callers can fall back
   * to the container edge.
   *
   * @param container - The contenteditable text container of a list item
   */
  private measureTextRight(container: HTMLElement): number | null {
    const range = document.createRange();

    range.selectNodeContents(container);

    if (typeof range.getBoundingClientRect !== 'function') {
      return null;
    }

    const rect = range.getBoundingClientRect();

    return rect.width > 0 ? rect.right : null;
  }

  /**
   * For a left/right (column) drop whose target sits inside a column_list,
   * stretch the vertical indicator bar to the full height of the column row by
   * setting `--drop-indicator-side-top/bottom` to the row container's top/bottom
   * offset relative to the block holder (negative, so the bar grows past the
   * single block). No-op for top/bottom edges or targets outside a column.
   *
   * @param block - The drop target block
   * @param edge - The resolved drop edge
   */
  private applySideIndicatorHeight(block: Block, edge: 'top' | 'bottom' | 'left' | 'right'): void {
    if (edge !== 'left' && edge !== 'right') {
      return;
    }

    const columns = block.holder.closest('[data-blok-columns]');

    if (!(columns instanceof HTMLElement)) {
      return;
    }

    const holderRect = block.holder.getBoundingClientRect();
    const columnsRect = columns.getBoundingClientRect();

    block.holder.style.setProperty('--drop-indicator-side-top', `${columnsRect.top - holderRect.top}px`);
    block.holder.style.setProperty('--drop-indicator-side-bottom', `${holderRect.bottom - columnsRect.bottom}px`);
  }

  /**
   * Centers a column side-drop indicator on the gutter (the resize separator)
   * between the two columns it divides, instead of sitting on the target column's
   * content edge. The indicator marks an insertion BETWEEN columns, so the bar
   * belongs in the gutter — overrides `--drop-indicator-side-left/right` to the
   * separator's horizontal center. No-op when the edge isn't horizontal or there
   * is no adjacent separator (an outer edge of the first/last column).
   *
   * @param block - The drop target block
   * @param edge - The resolved drop edge
   */
  private centerSideIndicatorInGutter(block: Block, edge: 'top' | 'bottom' | 'left' | 'right'): void {
    if (edge !== 'left' && edge !== 'right') {
      return;
    }

    const columnWrapper = block.holder.closest('[data-blok-column]');
    const columnHolder = columnWrapper instanceof HTMLElement
      ? columnWrapper.closest('[data-blok-element]')
      : null;

    if (!(columnHolder instanceof HTMLElement)) {
      return;
    }

    const separator = edge === 'left'
      ? columnHolder.previousElementSibling
      : columnHolder.nextElementSibling;

    if (!(separator instanceof HTMLElement) || !separator.hasAttribute('data-blok-column-resizer')) {
      return;
    }

    const holderRect = block.holder.getBoundingClientRect();
    const separatorRect = separator.getBoundingClientRect();
    const separatorCenter = separatorRect.left + separatorRect.width / 2;
    /*
     * The CSS pulls side bars out into the gutter by −var(--blok-space-2)
     * (content-edge anchoring). Here the offset is already the exact separator
     * center, so add the nudge back to cancel it. translateX(±50%) centers the
     * bar on the computed position, so no half-width offset is needed.
     */
    const nudge = parseFloat(getComputedStyle(block.holder).getPropertyValue('--blok-space-2')) || 0;

    if (edge === 'left') {
      block.holder.style.setProperty('--drop-indicator-side-left', `${separatorCenter - holderRect.left + nudge}px`);
    } else {
      block.holder.style.setProperty('--drop-indicator-side-right', `${holderRect.right - separatorCenter + nudge}px`);
    }
  }

  /**
   * Removes the side-drop offset custom properties set by
   * {@link applyContentIndicatorOffsets} and {@link applySideIndicatorHeight}.
   *
   * @param block - The block to clear
   */
  private clearContentIndicatorOffsets(block: Block): void {
    block.holder.style.removeProperty('--drop-indicator-side-left');
    block.holder.style.removeProperty('--drop-indicator-side-right');
    block.holder.style.removeProperty('--drop-indicator-side-top');
    block.holder.style.removeProperty('--drop-indicator-side-bottom');
    block.holder.removeAttribute('data-drop-indicator-lead');
  }

  private onMouseUp(e: MouseEvent): void {
    const state = this.stateMachine.getState();
    const sourceBlock = this.stateMachine.getSourceBlock();
    const sourceBlocks = this.stateMachine.getSourceBlocks();

    if (!sourceBlock || !sourceBlocks || !isActuallyDragging(state)) {
      this.cleanup();
      return;
    }

    const { targetBlock, targetEdge, targetParentId } = state as {
      targetBlock: Block | null;
      targetEdge: 'top' | 'bottom' | 'left' | 'right' | null;
      targetParentId: string | null;
    };

    if (!targetBlock || !targetEdge) {
      this.cleanup();
      return;
    }

    this.stateMachine.drop();

    if (!this.operations) {
      this.cleanup();
      return;
    }

    // Horizontal drops route to the column-drop helper (wired by integration),
    // never to moveBlocks — its signature stays 'top' | 'bottom'.
    if (targetEdge === 'left' || targetEdge === 'right') {
      this.handleColumnDrop(sourceBlock, sourceBlocks, targetBlock, targetEdge, targetParentId);
      this.cleanup(false, e.altKey);
      return;
    }

    if (e.altKey) {
      void this.handleDuplicate(sourceBlocks, targetBlock, targetEdge);
    } else {
      this.handleDrop(sourceBlock, sourceBlocks, targetBlock, targetEdge, e.clientX);
    }

    this.cleanup(false, e.altKey);
  }

  /**
   * Handles a horizontal (side) drop near a block's left/right edge.
   *
   * @param sourceBlock - The primary block being dragged
   * @param sourceBlocks - All blocks being dragged
   * @param targetBlock - The block whose side was targeted
   * @param edge - Which side of the target the drop occurred on
   * @param targetParentId - The enclosing column id, or null if the target is at root
   */
  private handleColumnDrop(
    sourceBlock: Block,
    sourceBlocks: Block[],
    targetBlock: Block,
    edge: 'left' | 'right',
    targetParentId: string | null
  ): void {
    const api = this.Blok.API.methods;

    // Sources are the dragged blocks in document order; never the target.
    const dragged = (sourceBlocks.length > 0 ? sourceBlocks : [sourceBlock])
      .filter(block => block.id !== targetBlock.id);
    const draggedIds = new Set(dragged.map(block => block.id));

    // Drop only the TOP-LEVEL dragged blocks into the new/added column. A
    // container's descendants are included in sourceBlocks (e.g. a callout
    // carries its child paragraph), but they must ride along with their parent —
    // reparenting them directly into the column would steal them out of their
    // container, stranding the grandchild under the column instead of the
    // callout. Mirrors the previewBlocks filter and handleDropImpl's
    // parentIsBeingMoved skip.
    const sourceIds = dragged
      .filter(block => block.parentId === null || !draggedIds.has(block.parentId))
      .map(block => block.id);

    if (sourceIds.length === 0) {
      return;
    }

    // Snapshot the sources' current parent columns before the move. When a source
    // is the LAST block of its column, moving it into the new column empties that
    // source column — and unlike the vertical-drop path (handleDropImpl re-renders
    // affected parents), this side-drop reparents via raw setBlockParent and never
    // touches the emptied source. Re-seed those columns afterwards so they never
    // become dead, uninteractable empty boxes.
    const sourceParentIds = new Set(
      sourceIds
        .map(id => this.Blok.BlockManager.getBlockById(id)?.parentId)
        .filter((parentId): parentId is string => parentId !== null && parentId !== undefined)
    );

    // targetParentId is the enclosing column when the target already lives in a
    // column_list (→ add a sibling column), or null for a top-level target
    // (→ wrap target + sources into a brand new column_list).
    const createdId = targetParentId !== null
      ? addColumnToList(api, targetParentId, sourceIds, edge)
      : wrapInNewColumnList(api, targetBlock.id, sourceIds, edge);

    this.reseedEmptiedColumns(sourceParentIds);

    if (createdId !== null) {
      this.settleDroppedPreview(sourceIds[0]);
    }
  }

  /**
   * Fly the drag preview to the first dropped block's landed position instead
   * of letting cleanup() vanish it on mouseup. The element is released from
   * DragPreview first so the upcoming cleanup() can't double-destroy it
   * mid-flight.
   *
   * @param firstDroppedId - The first top-level block that moved into the new column
   */
  private settleDroppedPreview(firstDroppedId: string): void {
    const preview = this.preview.release();

    if (preview === null) {
      return;
    }

    const holder = this.Blok.BlockManager.getBlockById(firstDroppedId)?.holder;
    const content = holder?.querySelector('[data-blok-element-content]') ?? holder;

    if (content === undefined || content === null) {
      preview.remove();

      return;
    }

    const rect = content.getBoundingClientRect();

    settleDragPreview({ preview, targetRect: { left: rect.left, top: rect.top } });
  }

  /**
   * Re-seed any column among `columnIds` that a move left childless. A column is
   * pure layout that always hosts at least one block; an empty one is a dead box
   * the user can't click into. Firing the column's rendered() hook re-runs its
   * empty-column seed, inserting a fresh empty paragraph — the same recovery the
   * vertical-drop path gets for free when it re-renders affected parents.
   */
  private reseedEmptiedColumns(columnIds: Set<string>): void {
    for (const columnId of columnIds) {
      const column = this.Blok.BlockManager.getBlockById(columnId);

      if (column !== undefined && column.name === 'column' && column.contentIds.length === 0) {
        column.call('rendered');
      }
    }
  }

  private handleDrop(
    sourceBlock: Block,
    sourceBlocks: Block[],
    targetBlock: Block,
    edge: 'top' | 'bottom',
    clientX?: number
  ): void {
    // History integration: wrap the entire drop (array move + every
    // subsequent `setBlockParent`) in a single `YjsManager.transactMoves`
    // group so the user's drag lands as ONE atomic undo entry.
    //
    // Without this wrapper, a drag-reparent emits two independent entries
    // on two separate history stacks — `BlockManager.move` records to the
    // custom `moveUndoStack`, while `BlockManager.setBlockParent` writes
    // `parentId` / `contentIds` through `YjsManager.transact('local')` which
    // lands on the Y.UndoManager stack. `UndoHistory.undo()` pops the
    // custom stack first and returns, so the first Cmd+Z restores the
    // block's flat position but leaves `parentId` pointing at the new
    // parent. A second Cmd+Z is needed to finish reversing the drag.
    //
    // Wrapping in `transactMoves` opens a move group AND sets the
    // `isMoveGroupActive` flag on the YjsManager; `YjsSyncCoordinator`
    // routes setBlockParent's Yjs writes through `transactWithoutCapture`
    // while that flag is true, so the parent change attaches to the move
    // entry instead of landing on Y.UndoManager as a separate stack item.
    const yjsManager = this.Blok.YjsManager;

    if (yjsManager !== undefined && typeof yjsManager.transactMoves === 'function') {
      yjsManager.transactMoves(() => {
        this.handleDropImpl(sourceBlock, sourceBlocks, targetBlock, edge, clientX);
      }, true);

      return;
    }

    this.handleDropImpl(sourceBlock, sourceBlocks, targetBlock, edge, clientX);
  }

  private handleDropImpl(
    sourceBlock: Block,
    sourceBlocks: Block[],
    targetBlock: Block,
    edge: 'top' | 'bottom',
    clientX?: number
  ): void {
    const isMultiBlockDrag = sourceBlocks.length > 1;

    // Execute move operation
    if (!this.operations) {
      return;
    }

    // Snapshot pre-move parentIds before moveBlocks mutates them. resolveParentForDrop
    // must read source parents as they existed at drag start, not after reparenting.
    const preMoveParentIds = new Map<string, string | null>();

    for (const block of sourceBlocks) {
      preMoveParentIds.set(block.id, block.parentId);
    }

    // Predict the flat list-nesting depth for the drop slot BEFORE the move (it
    // reads the target's current neighbours). This is the SAME value the drop
    // indicator showed, so the block lands exactly where the preview promised.
    // Applied below to non-list blocks; list items derive their own depth via
    // the list tool's moved() hook.
    const dropDepth = this.targetDetector
      ? this.targetDetector.calculateTargetDepth(targetBlock, edge, sourceBlock, clientX)
      : 0;

    const result = this.operations.moveBlocks(sourceBlocks, targetBlock, edge);

    // Layer 13: stale-drop abort guard.
    //
    // When moveBlocks aborts because the target or a source went stale mid-drag
    // (Layer 9), it returns `{ movedBlocks: [], targetIndex: -1 }`. Everything
    // downstream in handleDrop assumes the move succeeded:
    //   - resolveParentForDrop reads `targetBlock.parentId` (may be stale)
    //   - getBlockByIndex(-1) returns undefined → a11y guard catches it
    //   - Toolbar.moveAndOpen fires on a possibly-dead source holder
    //
    // None of those cause wrong-block-dropped, but they leak stale state into
    // the toolbar and a11y layers. Abort cleanly so "moveBlocks aborted" has a
    // single, observable contract: nothing happens downstream.
    if (result.movedBlocks.length === 0) {
      return;
    }

    // Update parent-child relationships after move
    const newParentId = this.resolveParentForDrop(targetBlock, edge, sourceBlocks, preMoveParentIds);
    const movedBlockIds = new Set(result.movedBlocks.map(b => b.id));
    const reparentedBlocks: Block[] = [];
    const affectedParentIds = new Set<string>();
    // List blocks whose structural parent this drop actually CHANGED. Only these
    // need their moved() hook re-fired below — a flat-depth list dragged without a
    // structural reparent must keep the depth its in-move moved() already computed
    // (re-firing would re-run the flat maxAllowedDepth cap and collapse a subtree).
    const reparentedListIds = new Set<string>();

    for (const movedBlock of result.movedBlocks) {
      // Skip blocks whose parent is also being moved — their internal hierarchy is preserved
      const parentIsBeingMoved = movedBlock.parentId !== null && movedBlockIds.has(movedBlock.parentId);

      if (parentIsBeingMoved) {
        // The physical move() displaced this block's DOM holder from its parent's
        // [data-blok-toggle-children] container. Re-establish DOM placement without
        // changing the logical parent relationship.
        this.Blok.BlockManager.setBlockParent(movedBlock, movedBlock.parentId);
        continue;
      }
      if (movedBlock.parentId === newParentId && newParentId !== null) {
        // The block is being reordered within its current toggle parent.
        // moveBlocks() updated the flat array but not the DOM order inside
        // [data-blok-toggle-children]. Call setBlockParent to sync the DOM.
        this.Blok.BlockManager.setBlockParent(movedBlock, newParentId);
        continue;
      }
      const oldParentId = movedBlock.parentId;

      if (oldParentId !== null) {
        affectedParentIds.add(oldParentId);
      }
      if (newParentId !== null) {
        affectedParentIds.add(newParentId);
      }
      this.Blok.BlockManager.setBlockParent(movedBlock, newParentId);
      reparentedBlocks.push(movedBlock);
      if (newParentId !== null && movedBlock.name === 'list') {
        reparentedListIds.add(movedBlock.id);
      }
    }

    // Apply STRUCTURAL nesting so a block dropped at a visual depth becomes a
    // real child in the block tree. List items derive their depth from their own
    // moved() hook (skip them). Blocks dropped INTO an explicit container
    // (toggle/column) already got their parent above. Blocks dropped at "root"
    // with dropDepth > 0 are re-homed under the preceding block at dropDepth-1.
    if (newParentId === null) {
      this.applyStructuralDropDepth(reparentedBlocks, dropDepth, movedBlockIds, affectedParentIds, reparentedListIds);
    }

    // A list item derives its nesting depth from its position in the block tree.
    // The moved() hook fired during the flat-array move ran BEFORE the reparenting
    // above set each item's FINAL structural parent, so it read a stale parent.
    // Re-fire moved() now that parentId is final, so the list tool recomputes its
    // depth/indent/marker/numbering from the actual tree — keeping data.depth
    // consistent with the structural parent (no stale flat depth leaking into save()).
    for (const movedBlock of result.movedBlocks) {
      if (movedBlock.name !== 'list' || !reparentedListIds.has(movedBlock.id)) {
        continue;
      }

      const listIndex = this.Blok.BlockManager.getBlockIndex(movedBlock);

      movedBlock.call(BlockToolAPI.MOVED, { fromIndex: listIndex, toIndex: listIndex });
    }

    // Notify affected parent blocks so toggle tools update their visual state
    // (e.g. hide/show body placeholder when children are added/removed)
    for (const parentId of affectedParentIds) {
      const parentBlock = this.Blok.BlockManager.getBlockById(parentId);

      if (parentBlock !== undefined) {
        parentBlock.call('rendered');
      }
    }

    // If dropped into a collapsed toggle, hide newly reparented blocks
    if (newParentId !== null && reparentedBlocks.length > 0) {
      this.hideBlocksIfParentCollapsed(newParentId, reparentedBlocks);
    }

    // Announce successful drop to screen readers
    const movedBlock = this.Blok.BlockManager.getBlockByIndex(result.targetIndex);
    if (this.a11y && movedBlock) {
      this.a11y.announceDropComplete(movedBlock, sourceBlocks, isMultiBlockDrag);
    }

    this.Blok.Toolbar.moveAndOpen(sourceBlock);
  }

  /**
   * Maps a drop-slot depth (what the indicator showed) to a STRUCTURAL parent:
   * the nearest preceding block (not part of the moving group) whose depth is one
   * less than the target depth. Returns null for a root-level drop (depth 0) or
   * when there is no suitable ancestor at this position.
   * @param movedBlock - the block that was dropped
   * @param dropDepth - the visual depth the drop indicator showed
   * @param movingIds - ids of every block in the moving group (skipped as anchors)
   */
  private resolveStructuralParentForDepth(
    movedBlock: Block,
    dropDepth: number,
    movingIds: Set<string>
  ): string | null {
    if (dropDepth <= 0) {
      return null;
    }

    const index = this.Blok.BlockManager.getBlockIndex(movedBlock);
    const preceding = this.Blok.BlockManager.blocks.slice(0, index).reverse();

    for (const candidate of preceding) {
      if (movingIds.has(candidate.id)) {
        continue;
      }

      const candidateDepth = this.Blok.BlockManager.getBlockDepth(candidate);

      if (candidateDepth === dropDepth - 1) {
        return candidate.id;
      }

      // A shallower block than the target parent depth means there is no valid
      // ancestor at this slot — fall back to root rather than over-nesting.
      if (candidateDepth < dropDepth - 1) {
        return null;
      }
    }

    return null;
  }

  /**
   * Re-homes each dropped root block under the preceding block at dropDepth-1 so
   * a block dropped at a visual depth becomes a real structural child. List items
   * nest only under a preceding LIST item (resolvePrecedingListParentForDepth);
   * every other block nests under any preceding block at dropDepth-1
   * (resolveStructuralParentForDepth). No-ops when the parent is already correct.
   * @param reparentedBlocks - the dropped blocks that landed at root level
   * @param dropDepth - the visual depth the drop indicator showed
   * @param movingIds - ids of the moving group (skipped as anchors)
   * @param affectedParentIds - accumulator of parents to notify afterwards
   */
  private applyStructuralDropDepth(
    reparentedBlocks: Block[],
    dropDepth: number,
    movingIds: Set<string>,
    affectedParentIds: Set<string>,
    reparentedListIds: Set<string>
  ): void {
    for (const movedBlock of reparentedBlocks) {
      const structuralParentId = movedBlock.name === 'list'
        ? this.resolvePrecedingListParentForDepth(movedBlock, dropDepth, movingIds)
        : this.resolveStructuralParentForDepth(movedBlock, dropDepth, movingIds);

      if (structuralParentId === movedBlock.parentId) {
        continue;
      }

      this.Blok.BlockManager.setBlockParent(movedBlock, structuralParentId);

      // This list item's structural parent genuinely changed — its moved() hook
      // must re-derive depth from the final tree (see the re-fire loop in onDrop).
      if (movedBlock.name === 'list') {
        reparentedListIds.add(movedBlock.id);
      }

      if (structuralParentId !== null) {
        affectedParentIds.add(structuralParentId);
      }
    }
  }

  /**
   * Maps a list item's drop-slot depth to its STRUCTURAL list parent: the nearest
   * preceding LIST block (not part of the moving group) whose structural depth is
   * one less than the drop depth. A list item nests only under a preceding list
   * item — never under a paragraph — so a non-list predecessor (or a shallower
   * block than the target parent depth) breaks the run and lands the item at root.
   * Returns null for a root-level drop (depth 0) or when no such list parent exists.
   * @param movedBlock - the list block that was dropped
   * @param dropDepth - the visual depth the drop indicator showed
   * @param movingIds - ids of every block in the moving group (skipped as anchors)
   */
  private resolvePrecedingListParentForDepth(
    movedBlock: Block,
    dropDepth: number,
    movingIds: Set<string>
  ): string | null {
    if (dropDepth <= 0) {
      return null;
    }

    const index = this.Blok.BlockManager.getBlockIndex(movedBlock);
    const preceding = this.Blok.BlockManager.blocks.slice(0, index).reverse();

    for (const candidate of preceding) {
      if (movingIds.has(candidate.id)) {
        continue;
      }

      if (candidate.name !== 'list') {
        return null;
      }

      const candidateDepth = this.Blok.BlockManager.getBlockDepth(candidate);

      if (candidateDepth === dropDepth - 1) {
        return candidate.id;
      }

      // A list item shallower than the target parent depth means there is no valid
      // list ancestor at this slot — fall back to root rather than over-nesting.
      if (candidateDepth < dropDepth - 1) {
        return null;
      }
    }

    return null;
  }

  /**
   * Determines the correct parentId for blocks dropped at a given target position.
   *
   * @param targetBlock - The block that was the drop target
   * @param edge - Which edge of the target the drop occurred on
   * @param sourceBlocks - The blocks being dragged
   * @returns The parentId for the dropped blocks, or null for root level
   */
  private resolveParentForDrop(
    targetBlock: Block,
    edge: 'top' | 'bottom',
    sourceBlocks: Block[],
    preMoveParentIds?: Map<string, string | null>
  ): string | null {
    // If dropping below a toggleable block, the block becomes a child of the toggle.
    // Detect via DOM attribute (covers both toggle list blocks AND toggle headings).
    if (edge === 'bottom' && this.isToggleableBlock(targetBlock) && this.isOpenToggle(targetBlock)) {
      // Don't re-enter the toggle if all source blocks are already its children.
      // This allows a child to escape its own toggle parent by dragging to the bottom edge.
      // Use pre-move snapshot when available; moveBlocks may have already rewritten parentId.
      const allSourcesAreChildren = sourceBlocks.length > 0 &&
        sourceBlocks.every((b) => {
          const parentId = preMoveParentIds?.has(b.id) === true
            ? preMoveParentIds.get(b.id)
            : b.parentId;

          return parentId === targetBlock.id;
        });

      if (!allSourcesAreChildren) {
        return targetBlock.id;
      }
    }

    // If the target block is itself a child, the dropped block becomes a sibling
    // (child of the same parent)
    if (targetBlock.parentId !== null) {
      return targetBlock.parentId;
    }

    // Otherwise, the block goes to root level
    return null;
  }

  /**
   * Checks whether a block is a toggleable block (toggle list or toggle heading)
   * by looking for the data-blok-toggle-open DOM attribute on its holder.
   */
  private isToggleableBlock(block: Block): boolean {
    return block.holder.querySelector('[data-blok-toggle-open]') !== null;
  }

  /**
   * Checks whether a toggleable block is currently open (expanded).
   * Returns false for closed (collapsed) toggles.
   */
  private isOpenToggle(block: Block): boolean {
    return block.holder.querySelector('[data-blok-toggle-open="true"]') !== null;
  }

  /**
   * Hides blocks if their parent toggle is currently collapsed.
   * This prevents newly reparented or duplicated blocks from appearing
   * visually when their parent is in a collapsed state.
   */
  private hideBlocksIfParentCollapsed(parentId: string, blocks: Block[]): void {
    if (blocks.length === 0) {
      return;
    }
    const parentBlock = this.Blok.BlockManager.getBlockById(parentId);

    if (parentBlock === undefined) {
      return;
    }
    const toggleEl = parentBlock.holder.querySelector('[data-blok-toggle-open]');
    const isCollapsed = toggleEl?.getAttribute('data-blok-toggle-open') === 'false';

    if (isCollapsed) {
      for (const block of blocks) {
        block.holder.classList.add('hidden');
      }
    }
  }

  private async handleDuplicate(
    sourceBlocks: Block[],
    targetBlock: Block,
    edge: 'top' | 'bottom'
  ): Promise<void> {
    if (!this.operations) {
      return;
    }

    // Run the async prep (block.save() awaits + stale guards) OUTSIDE the
    // undo group — transactForTool is a synchronous bracket and awaiting
    // inside it would leak writes out of the group. The returned plan holds
    // everything `applyDuplicates` needs to run its inserts + reparents
    // synchronously inside the bracket below.
    const prep = await this.operations.prepareDuplicates(sourceBlocks, targetBlock, edge);

    if (prep.aborted) {
      return;
    }

    // History integration: wrap the sync tail of the alt-drag — every insert
    // from `applyDuplicates` AND the follow-up `setBlockParent` loop that
    // reparents duplicates to the drop target — in a single
    // `BlockManager.transactForTool` group.
    //
    // Without this wrapper, an alt-drag fragments into N+M independent Y.UndoManager
    // entries (one per insert inside `applyDuplicates`, one per setBlockParent in
    // the reparent loop), so undoing the operation requires N+M Cmd+Z presses.
    //
    // `transactForTool` suppresses per-insert `stopCapturing` and brackets the
    // group with `stopCapturing` boundaries before/after — exactly the right
    // primitive for pure-creation bursts like duplicate (whereas `transactMoves`
    // is move-specific and not applicable here).
    const resultRef: { current: { duplicatedBlocks: Block[]; targetIndex: number } } = {
      current: {
        duplicatedBlocks: [],
        targetIndex: prep.baseInsertIndex,
      },
    };

    const applyAndReparent = (): void => {
      if (!this.operations) {
        return;
      }
      resultRef.current = this.operations.applyDuplicates(prep);

      if (resultRef.current.duplicatedBlocks.length === 0) {
        return;
      }

      // Set parent relationships for duplicated blocks
      const dropParentId = this.resolveParentForDrop(targetBlock, edge, sourceBlocks);

      for (const dupBlock of resultRef.current.duplicatedBlocks) {
        if (dupBlock.parentId === dropParentId) {
          continue;
        }
        this.Blok.BlockManager.setBlockParent(dupBlock, dropParentId);
      }
    };

    if (typeof this.Blok.BlockManager.transactForTool === 'function') {
      this.Blok.BlockManager.transactForTool(applyAndReparent);
    } else {
      applyAndReparent();
    }

    const result = resultRef.current;

    if (result.duplicatedBlocks.length === 0) {
      return;
    }

    // Recompute the affected-parent set from the final duplicate state so
    // toggle tools still receive their `rendered` nudge after the group
    // closes. Only parents that actually received a duplicate need notifying.
    const newParentId = this.resolveParentForDrop(targetBlock, edge, sourceBlocks);
    const affectedParentIds = new Set<string>();

    for (const dupBlock of result.duplicatedBlocks) {
      if (dupBlock.parentId === newParentId && newParentId !== null) {
        affectedParentIds.add(newParentId);
      }
    }

    // Notify affected parent blocks so toggle tools update their visual state
    for (const parentId of affectedParentIds) {
      const parentBlock = this.Blok.BlockManager.getBlockById(parentId);

      if (parentBlock !== undefined) {
        parentBlock.call('rendered');
      }
    }

    // If duplicated into a collapsed toggle, hide the new blocks
    if (newParentId !== null) {
      const blocksToHide = result.duplicatedBlocks.filter(b => b.parentId === newParentId);

      this.hideBlocksIfParentCollapsed(newParentId, blocksToHide);
    }

    if (this.a11y) {
      this.a11y.announceDuplicateComplete(result.duplicatedBlocks);
    }

    this.Blok.Toolbar.moveAndOpen(result.duplicatedBlocks[0]);
  }

  /**
   * Duplicate a block (or the active block selection) in place — directly below
   * the source group and in the same parent — for the Cmd/Ctrl+D shortcut. A
   * single block is expanded to its full subtree (list/flat-indent followers via
   * depth, toggle/callout children via contentIds) so the copy carries its
   * children, mirroring alt-drag duplication.
   * @param block - the block the shortcut fired on (or a selected block)
   * @returns the duplicated blocks (empty when nothing was duplicated)
   */
  public async duplicateBlocksInPlace(block: Block): Promise<Block[]> {
    // Drag internals initialize lazily on the first drag; Cmd+D can fire before
    // any drag has happened, so ensure operations/descendant helpers exist.
    this.lazyInit();

    if (!this.operations) {
      return [];
    }

    const isBlockSelected = block.selected;
    const baseBlocks = isBlockSelected
      ? this.Blok.BlockSelection.selectedBlocks
      : [block];

    // Expand EVERY base block to its full subtree (list/flat-indent followers
    // via depth, toggle/callout children via contentIds), de-duplicating across
    // the set. The expansion must run for multi-block selections too: a selected
    // block's nested descendants are usually not themselves selected, yet they
    // must travel with their parent into the copy (Notion's Cmd+D parity).
    const seen = new Set<string>();
    const sourceBlocks = baseBlocks
      .flatMap((baseBlock) => [baseBlock, ...this.collectDuplicateDescendants(baseBlock)])
      .filter((member) => {
        if (seen.has(member.id)) {
          return false;
        }

        seen.add(member.id);

        return true;
      });

    if (sourceBlocks.length === 0) {
      return [];
    }

    /**
     * Anchor the copies after the LAST block of the source group (in document
     * order), so the whole group is duplicated below itself in the same parent.
     */
    const anchor = sourceBlocks.reduce((latest, candidate) =>
      this.Blok.BlockManager.getBlockIndex(candidate) > this.Blok.BlockManager.getBlockIndex(latest)
        ? candidate
        : latest
    );

    const prep = await this.operations.prepareDuplicates(sourceBlocks, anchor, 'bottom');

    if (prep.aborted) {
      return [];
    }

    const resultRef: { current: { duplicatedBlocks: Block[]; targetIndex: number } } = {
      current: { duplicatedBlocks: [], targetIndex: prep.baseInsertIndex },
    };

    const applyAndReparent = (): void => {
      if (!this.operations) {
        return;
      }

      resultRef.current = this.operations.applyDuplicates(prep);

      /**
       * applyDuplicates wires up internal child→parent links among the
       * duplicated set. The remaining job is to keep each ROOT of the set (a
       * block whose original parent is NOT itself being duplicated) in the same
       * parent as its source — insert() only auto-inherits a column parent, so
       * a root copied from inside a toggle/callout would otherwise escape it.
       */
      resultRef.current.duplicatedBlocks.forEach((dup, index) => {
        const original = prep.sortedBlocks[index];

        if (original === undefined) {
          return;
        }

        const originalParentId = original.parentId;
        const isRootOfSet = originalParentId === null || !prep.sourceIds.has(originalParentId);

        if (isRootOfSet && dup.parentId !== originalParentId) {
          this.Blok.BlockManager.setBlockParent(dup, originalParentId);
        }
      });
    };

    if (typeof this.Blok.BlockManager.transactForTool === 'function') {
      this.Blok.BlockManager.transactForTool(applyAndReparent);
    } else {
      applyAndReparent();
    }

    const duplicated = resultRef.current.duplicatedBlocks;

    if (duplicated.length > 0) {
      const [firstCopy] = duplicated;

      if (isBlockSelected) {
        /**
         * The source was a BLOCK selection (Cmd/Ctrl+D on selected blocks), so
         * mirror Notion by keeping the NEW copies block-selected — the duplicate
         * move can then be repeated. Clear the originals' selection first (and the
         * copies that applyDuplicates already selected), then select only the
         * copies so a follow-up Cmd+D acts on them, not the originals too.
         */
        this.Blok.BlockSelection.clearSelection();
        duplicated.forEach((dup) => this.Blok.BlockSelection.selectBlock(dup));
      } else if (this.Blok.Caret !== undefined) {
        /**
         * applyDuplicates block-selects the copies — correct for alt-drag, but the
         * single text-caret Cmd/Ctrl+D path mirrors Notion by landing a text caret
         * in the new copy ready to edit. Clear that lingering block selection and
         * focus the first copy instead. Guarded because narrow drag test harnesses
         * omit Caret.
         */
        this.Blok.BlockSelection.clearSelection();
        this.Blok.Caret.setToBlock(firstCopy, this.Blok.Caret.positions.END);
      }

      /**
       * Signal that the copy is "just added" with the blue arrival pulse (the
       * same cue a hash-navigated block gets) — Notion highlights a freshly
       * duplicated block. Landing the caret alone left no visible indication of
       * what appeared.
       */
      highlightBlockArrival(firstCopy.holder);

      this.Blok.Toolbar.moveAndOpen(firstCopy);
    }

    return duplicated;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.cleanup(true);
      return;
    }

    // Toggle duplication mode on Alt/Option key press
    if (e.key === 'Alt' && isActuallyDragging(this.stateMachine.getState())) {
      this.setDuplicationMode(true);
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.key === 'Alt' && isActuallyDragging(this.stateMachine.getState())) {
      this.setDuplicationMode(false);
    }
  }

  private setDuplicationMode(isDuplicating: boolean): void {
    const wrapper = this.Blok.UI.nodes.wrapper;

    if (isDuplicating) {
      wrapper.setAttribute(DATA_ATTR.duplicating, 'true');
    } else {
      wrapper.removeAttribute(DATA_ATTR.duplicating);
    }
  }

  private cleanup(wasCancelled = false, skipToolbarReopen = false): void {
    if (wasCancelled && isActuallyDragging(this.stateMachine.getState())) {
      announce(
        this.Blok.I18n.t('a11y.dropCancelled'),
        { politeness: 'polite' }
      );
    }

    // Reset block hover state after drag cancellation to allow toolbar to show on next hover
    if (wasCancelled) {
      // Check if method exists (may not in test environment)
      this.Blok.UI.resetBlockHoverState?.();
      this.Blok.Toolbar.resetExplicitlyClosed?.();
    }

    if (this.autoScroll) {
      this.autoScroll.destroy();
      this.autoScroll = null;
    }

    if (this.a11y) {
      this.a11y.reset();
    }

    const state = this.stateMachine.getState();
    if ((state.type === 'dragging' || state.type === 'dropped') && state.targetBlock) {
      state.targetBlock.holder.removeAttribute('data-drop-indicator');
      state.targetBlock.holder.style.removeProperty('--drop-indicator-depth');
      this.clearContentIndicatorOffsets(state.targetBlock);
    }

    this.springLoader.cancel();
    this.preview.destroy();

    const wrapper = this.Blok.UI.nodes.wrapper;
    wrapper.removeAttribute(DATA_ATTR.dragging);
    wrapper.removeAttribute(DATA_ATTR.draggingMulti);
    wrapper.removeAttribute(DATA_ATTR.duplicating);

    if (this.boundHandlers) {
      document.removeEventListener('mousemove', this.boundHandlers.onMouseMove);
      document.removeEventListener('mouseup', this.boundHandlers.onMouseUp);
      document.removeEventListener('keydown', this.boundHandlers.onKeyDown);
      document.removeEventListener('keyup', this.boundHandlers.onKeyUp);
      this.boundHandlers = null;
    }

    // Drop all destroy-callback subscriptions on participating blocks.
    this.sourceBlockDestroyUnsubs.forEach((unsub) => unsub());
    this.sourceBlockDestroyUnsubs = [];

    const sourceBlock = this.stateMachine.getSourceBlock();
    this.stateMachine.reset();

    if (this.targetDetector) {
      this.targetDetector.setSourceBlocks([]);
    }

    if (wasCancelled || skipToolbarReopen) {
      return;
    }

    const blockToShow = sourceBlock ?? this.Blok.BlockManager.currentBlock;
    if (!blockToShow) {
      return;
    }
    this.Blok.Toolbar.moveAndOpen(blockToShow);
  }

  /**
   * Collects a block's full set of duplicable descendants, unifying the two
   * nesting carriers: list/flat-indent followers (via `data-list-depth`) take
   * precedence, otherwise toggle/callout children via `parentId`/`contentIds`.
   * Returns an empty array for a leaf block.
   * @param block - block whose subtree should be collected
   * @returns descendant blocks (excluding the block itself)
   */
  private collectDuplicateDescendants(block: Block): Block[] {
    const listDescendants = this.listItemDescendants
      ? this.listItemDescendants.getDescendants(block)
      : [];

    if (listDescendants.length > 0) {
      return listDescendants;
    }

    if (block.contentIds?.length > 0) {
      return this.getHierarchyDescendants(block);
    }

    return [];
  }

  /**
   * Recursively collects all descendants of a block via the parentId/contentIds hierarchy.
   * Used for toggle blocks and other parent-child structures that don't use data-list-depth.
   * @param block - Parent block to collect descendants for
   * @returns Array of descendant blocks
   */
  private getHierarchyDescendants(block: Block): Block[] {
    const descendants: Block[] = [];

    const collectChildren = (parentBlock: Block): void => {
      for (const childId of parentBlock.contentIds) {
        const child = this.Blok.BlockManager.getBlockById(childId);

        if (child !== undefined) {
          descendants.push(child);
          collectChildren(child);
        }
      }
    };

    collectChildren(block);

    return descendants;
  }

  public destroy(): void {
    // A settling ghost / row interpolation is detached from the preview's
    // lifecycle; finish it now so nothing outlives the editor instance.
    finishColumnDropAnimations();
    this.cleanup();
  }
}
