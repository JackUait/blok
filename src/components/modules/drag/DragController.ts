import { Module } from '../../__module';
import type { Block } from '../../block';
import { DATA_ATTR } from '../../constants';
import { announce } from '../../utils/announcer';
import { hide as hideTooltip } from '../../utils/tooltip';

import { DragA11y } from './a11y/DragA11y';
import { DragOperations } from './operations/DragOperations';
import { DragPreview } from './preview/DragPreview';
import { DragStateMachine, isActuallyDragging, isDragActive } from './state/DragStateMachine';
import { DropTargetDetector } from './target/DropTargetDetector';
import { AutoScroll } from './utils/AutoScroll';
import { hasPassedThreshold } from './utils/drag.constants';
import { findScrollableAncestor } from './utils/findScrollableAncestor';
import { ListItemDescendants } from './utils/ListItemDescendants';

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
  private listItemDescendants: ListItemDescendants | null = null;
  private boundHandlers: BoundHandlers | null = null;

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
      this.cleanup();
    }
  }

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

  private onMouseUp(e: MouseEvent): void {
    const state = this.stateMachine.getState();
    const sourceBlock = this.stateMachine.getSourceBlock();
    const sourceBlocks = this.stateMachine.getSourceBlocks();

    if (!sourceBlock || !sourceBlocks || !isActuallyDragging(state)) {
      this.cleanup();
      return;
    }

    const { targetBlock, targetEdge } = state as { targetBlock: Block | null; targetEdge: 'top' | 'bottom' | null };

    if (!targetBlock || !targetEdge) {
      this.cleanup();
      return;
    }

    this.stateMachine.drop();

    if (!this.operations) {
      this.cleanup();
      return;
    }

    if (e.altKey) {
      void this.handleDuplicate(sourceBlocks, targetBlock, targetEdge);
    } else {
      this.handleDrop(sourceBlock, sourceBlocks, targetBlock, targetEdge);
    }

    this.cleanup(false, e.altKey);
  }

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

    if (this.a11y) {
      this.a11y.announceDuplicateComplete(result.duplicatedBlocks);
    }

    this.Blok.Toolbar.skipNextSettingsToggle();
    this.Blok.Toolbar.moveAndOpen(result.duplicatedBlocks[0]);
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
    }

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

  public destroy(): void {
    this.cleanup();
  }
}
