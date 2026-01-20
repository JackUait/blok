/**
 * @class DragController
 * @classdesc Main orchestrator for pointer-based drag and drop for blocks
 * Coordinates all drag-related components to provide a clean API
 * @module DragController
 */
import { Module } from '../../__module';
import type { Block } from '../../block';
import { DATA_ATTR } from '../../constants';
import { announce } from '../../utils/announcer';
import { hide as hideTooltip } from '../../utils/tooltip';

// Drag components
import { DragA11y } from './a11y/DragA11y';
import { DragOperations } from './operations/DragOperations';
import { DragPreview } from './preview/DragPreview';
import { DragStateMachine, isActuallyDragging, isDragActive } from './state/DragStateMachine';
import { DropTargetDetector } from './target/DropTargetDetector';
import { AutoScroll } from './utils/AutoScroll';
import { hasPassedThreshold } from './utils/drag.constants';
import { findScrollableAncestor } from './utils/findScrollableAncestor';
import { ListItemDescendants } from './utils/ListItemDescendants';

/**
 * Bound event handlers for cleanup
 */
interface BoundHandlers {
  onMouseMove: (e: MouseEvent) => void;
  onMouseUp: (e: MouseEvent) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onKeyUp: (e: KeyboardEvent) => void;
}

/**
 * DragController - Main orchestrator for drag and drop operations
 * Extends Module to integrate with the Blok module system
 */
export class DragController extends Module {
  /**
   * State machine for managing drag state transitions
   */
  private stateMachine: DragStateMachine = new DragStateMachine();

  /**
   * Preview element manager
   */
  private preview: DragPreview = new DragPreview();

  /**
   * Drop target detector
   */
  private targetDetector: DropTargetDetector | null = null;

  /**
   * Drag operations executor
   */
  private operations: DragOperations | null = null;

  /**
   * Accessibility announcer
   */
  private a11y: DragA11y | null = null;

  /**
   * Auto-scroll handler
   */
  private autoScroll: AutoScroll | null = null;

  /**
   * List item descendants finder
   */
  private listItemDescendants: ListItemDescendants | null = null;

  /**
   * Bound event handlers for cleanup
   */
  private boundHandlers: BoundHandlers | null = null;

  /**
   * Flag indicating toolbar was already reopened by a handler
   */
  private toolbarHandled = false;

  /**
   * Returns true if a drag operation is currently in progress
   */
  public get isDragging(): boolean {
    return isActuallyDragging(this.stateMachine.getState());
  }

  /**
   * Module preparation
   * Note: DragManager is not in the modulesToPrepare list, so this method is never called.
   * Initialization happens lazily in startDragTracking instead.
   */
  public async prepare(): Promise<void> {
    // No preparation needed - initialization happens lazily
  }

  /**
   * Lazily initialize dependencies that require Blok modules
   * This is called when the first drag operation begins
   */
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

  /**
   * Cancels any pending drag tracking without performing a drop
   * Call this when something else (like opening a menu) should take precedence
   */
  public cancelTracking(): void {
    if (isDragActive(this.stateMachine.getState()) && !isActuallyDragging(this.stateMachine.getState())) {
      this.cleanup();
    }
  }

  /**
   * Starts listening for drag on the given drag handle
   * Called by Block when toolbar moves to it
   * @param dragHandle - Element to use as drag handle
   * @param block - Block that will be dragged
   * @returns Cleanup function
   */
  public setupDragHandle(dragHandle: HTMLElement, block: Block): () => void {
    const onMouseDown = (e: MouseEvent): void => {
      // Only handle left mouse button
      if (e.button !== 0) {
        return;
      }

      // Don't start drag when any popover is open
      if (document.querySelector(`[${DATA_ATTR.popoverOpened}]`) !== null) {
        return;
      }

      this.startDragTracking(e, block);
    };

    dragHandle.addEventListener('mousedown', onMouseDown);

    return (): void => {
      dragHandle.removeEventListener('mousedown', onMouseDown);
    };
  }

  /**
   * Starts tracking mouse for potential drag
   * @param e - Mouse event
   * @param block - Block to drag
   */
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

    // For single-block list item drags, include all descendants
    const descendants = !isBlockSelected && this.listItemDescendants
      ? this.listItemDescendants.getDescendants(block)
      : [];
    const blocksToMove = descendants.length > 0
      ? [block, ...descendants]
      : initialBlocks;

    // Create appropriate preview (single or multi-block)
    if (blocksToMove.length > 1) {
      this.preview.createMulti(blocksToMove);
    } else {
      this.preview.createSingle(contentElement, block.stretched);
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

  /**
   * Handles mouse move during drag
   * @param e - Mouse event
   */
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

  /**
   * Starts the actual drag operation (after threshold is passed)
   * @param blockCount - Number of blocks being dragged
   */
  private startActualDrag(blockCount: number): void {
    this.stateMachine.startDrag();

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
    this.Blok.Toolbar.close();

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

  /**
   * Updates the drop target based on cursor position
   * @param clientX - Cursor X position
   * @param clientY - Cursor Y position
   */
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
    }

    // Find element under cursor (temporarily hide preview)
    this.preview.hide();
    const elementUnderCursor = document.elementFromPoint(clientX, clientY);
    this.preview.show();

    if (!elementUnderCursor) {
      this.stateMachine.updateTarget(null, null);
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
      return;
    }

    // Update state with new target
    this.stateMachine.updateTarget(dropTarget.block, dropTarget.edge);

    // Show drop indicator
    dropTarget.block.holder.setAttribute('data-drop-indicator', dropTarget.edge);
    dropTarget.block.holder.style.setProperty('--drop-indicator-depth', String(dropTarget.depth));

    // Announce drop position change to screen readers
    if (this.a11y) {
      this.a11y.announceDropPosition(dropTarget.block, dropTarget.edge);
    }
  }

  /**
   * Handles mouse up to complete or cancel drag
   * @param e - Mouse event
   */
  private onMouseUp(e: MouseEvent): void {
    const state = this.stateMachine.getState();
    const sourceBlock = this.stateMachine.getSourceBlock();
    const sourceBlocks = this.stateMachine.getSourceBlocks();

    if (!sourceBlock || !sourceBlocks || !isActuallyDragging(state)) {
      this.cleanup();
      return;
    }

    const initialState = this.stateMachine.getState();

    // Fallback: if no target is set (e.g., when dragging to off-page target),
    // use the first visible block as the target
    const needsFallback = initialState.type === 'dragging' && !initialState.targetBlock;
    const firstVisibleBlock = needsFallback
      ? this.Blok.BlockManager.blocks.find(b => {
          if (b === sourceBlock || sourceBlocks.includes(b)) {
            return false;
          }
          const rect = b.holder.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < window.innerHeight;
        })
      : undefined;

    if (firstVisibleBlock !== undefined) {
      this.stateMachine.updateTarget(firstVisibleBlock, 'top');
    }

    const currentState = this.stateMachine.getState();

    if (currentState.type !== 'dragging' || !currentState.targetBlock || !currentState.targetEdge) {
      this.cleanup();
      return;
    }

    const { targetBlock, targetEdge } = currentState;

    // Drop to complete the state transition
    this.stateMachine.drop();

    // Check Alt key state at drop time to determine operation
    if (!this.operations) {
      this.cleanup();
      return;
    }

    if (e.altKey) {
      void this.handleDuplicate(sourceBlocks, targetBlock, targetEdge);
    } else {
      this.handleDrop(sourceBlock, sourceBlocks, targetBlock, targetEdge);
    }

    this.cleanup();
  }

  /**
   * Handles the actual block drop
   * @param sourceBlock - Primary block being dragged
   * @param sourceBlocks - All blocks being dragged
   * @param targetBlock - Block dropped onto
   * @param edge - Edge of target ('top' or 'bottom')
   */
  private handleDrop(
    sourceBlock: Block,
    sourceBlocks: Block[],
    targetBlock: Block,
    edge: 'top' | 'bottom'
  ): void {
    const isMultiBlockDrag = sourceBlocks.length > 1;

    // Execute move operation
    if (!this.operations) {
      return;
    }
    const result = this.operations.moveBlocks(sourceBlocks, targetBlock, edge);

    // Announce successful drop to screen readers
    const movedBlock = this.Blok.BlockManager.getBlockByIndex(result.targetIndex);
    if (this.a11y && movedBlock) {
      this.a11y.announceDropComplete(movedBlock, sourceBlocks, isMultiBlockDrag);
    }
  }

  /**
   * Handles block duplication instead of move
   * @param sourceBlocks - Blocks to duplicate
   * @param targetBlock - Block to insert duplicates near
   * @param edge - Edge of target ('top' or 'bottom')
   */
  private async handleDuplicate(
    sourceBlocks: Block[],
    targetBlock: Block,
    edge: 'top' | 'bottom'
  ): Promise<void> {
    if (!this.operations) {
      return;
    }
    const result = await this.operations.duplicateBlocks(sourceBlocks, targetBlock, edge);

    if (result.duplicatedBlocks.length === 0) {
      return;
    }

    // Announce duplication to screen readers
    if (this.a11y) {
      this.a11y.announceDuplicateComplete(result.duplicatedBlocks);
    }

    // Store the duplicated block for toolbar reopening in cleanup
    // We can't pass it through stateMachine, so we reopen directly here
    this.Blok.Toolbar.skipNextSettingsToggle();
    this.Blok.Toolbar.moveAndOpen(result.duplicatedBlocks[0]);

    // Signal cleanup that toolbar was already handled
    this.toolbarHandled = true;
  }

  /**
   * Handles escape key to cancel drag and Alt key to toggle duplication mode
   * @param e - Keyboard event
   */
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

  /**
   * Handles Alt key release to toggle off duplication mode
   * @param e - Keyboard event
   */
  private onKeyUp(e: KeyboardEvent): void {
    if (e.key === 'Alt' && isActuallyDragging(this.stateMachine.getState())) {
      this.setDuplicationMode(false);
    }
  }

  /**
   * Sets duplication mode visual feedback on or off
   * @param isDuplicating - Whether duplication mode should be visually indicated
   */
  private setDuplicationMode(isDuplicating: boolean): void {
    const wrapper = this.Blok.UI.nodes.wrapper;

    if (isDuplicating) {
      wrapper.setAttribute(DATA_ATTR.duplicating, 'true');
    } else {
      wrapper.removeAttribute(DATA_ATTR.duplicating);
    }
  }

  /**
   * Cleans up drag state and event listeners
   * @param wasCancelled - Whether the drag was cancelled (not dropped)
   */
  private cleanup(wasCancelled = false): void {
    // Announce cancellation to screen readers if drag was in progress and cancelled
    if (wasCancelled && isActuallyDragging(this.stateMachine.getState())) {
      announce(
        this.Blok.I18n.t('a11y.dropCancelled'),
        { politeness: 'polite' }
      );
    }

    // Stop auto-scroll
    if (this.autoScroll) {
      this.autoScroll.destroy();
      this.autoScroll = null;
    }

    // Reset a11y state
    if (this.a11y) {
      this.a11y.reset();
    }

    // Clear drop indicator
    const state = this.stateMachine.getState();
    if ((state.type === 'dragging' || state.type === 'dropped') && state.targetBlock) {
      state.targetBlock.holder.removeAttribute('data-drop-indicator');
      state.targetBlock.holder.style.removeProperty('--drop-indicator-depth');
    }

    // Destroy preview
    this.preview.destroy();

    // Remove global dragging state
    const wrapper = this.Blok.UI.nodes.wrapper;
    wrapper.removeAttribute(DATA_ATTR.dragging);
    wrapper.removeAttribute(DATA_ATTR.draggingMulti);
    wrapper.removeAttribute(DATA_ATTR.duplicating);

    // Remove event listeners
    if (this.boundHandlers) {
      document.removeEventListener('mousemove', this.boundHandlers.onMouseMove);
      document.removeEventListener('mouseup', this.boundHandlers.onMouseUp);
      document.removeEventListener('keydown', this.boundHandlers.onKeyDown);
      document.removeEventListener('keyup', this.boundHandlers.onKeyUp);
      this.boundHandlers = null;
    }

    // Reset state machine
    const sourceBlock = this.stateMachine.getSourceBlock();
    this.stateMachine.reset();

    // Reset target detector
    if (this.targetDetector) {
      this.targetDetector.setSourceBlocks([]);
    }

    /**
     * Reopen toolbar on the moved block after drag completes
     * This ensures the toolbar is available for further interactions
     */
    if (wasCancelled) {
      return;
    }

    // Skip if toolbar was already handled (e.g., for duplication)
    if (this.toolbarHandled) {
      this.toolbarHandled = false;
      return;
    }

    const blockToShow = sourceBlock ?? this.Blok.BlockManager.currentBlock;
    if (!blockToShow) {
      return;
    }
    this.Blok.Toolbar.skipNextSettingsToggle();
    this.Blok.Toolbar.moveAndOpen(blockToShow);
  }

  /**
   * Module destruction
   */
  public destroy(): void {
    this.cleanup();
  }
}
