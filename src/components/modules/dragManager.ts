/**
 * @class DragManager
 * @classdesc Manages pointer-based (non-native) drag and drop for blocks
 * Uses mousedown/mousemove/mouseup instead of HTML5 drag API
 * This allows full control over the cursor during drag operations
 * @module DragManager
 */
import Module from '../__module';
import type Block from '../block';
import $ from '../dom';
import * as tooltip from '../utils/tooltip';
import { BLOK_DRAGGING_ATTR, BLOK_ELEMENT_SELECTOR } from '../constants';
import { twMerge } from '../utils/tw';

/**
 * Styles for the drag preview element
 */
const PREVIEW_STYLES = {
  base: 'fixed pointer-events-none z-[10000] opacity-80 transition-none',
  content: 'relative mx-auto max-w-content',
};

/**
 * Configuration for drag behavior
 */
const DRAG_CONFIG = {
  /** Offset from cursor to preview element */
  previewOffsetX: 20,
  previewOffsetY: 0,
  /** Minimum distance to start drag (prevents accidental drags) */
  dragThreshold: 5,
  /** Auto-scroll configuration */
  autoScrollZone: 50,
  autoScrollSpeed: 10,
};

/**
 * State of the current drag operation
 */
interface DragState {
  /** Block being dragged */
  sourceBlock: Block;
  /** Current drop target block */
  targetBlock: Block | null;
  /** Edge of target block ('top' or 'bottom') */
  targetEdge: 'top' | 'bottom' | null;
  /** Drag preview element */
  previewElement: HTMLElement;
  /** Starting mouse position */
  startX: number;
  startY: number;
  /** Whether drag has actually started (passed threshold) */
  isDragging: boolean;
  /** Auto-scroll interval */
  autoScrollInterval: number | null;
}

export default class DragManager extends Module {
  /**
   * Current drag state
   */
  private dragState: DragState | null = null;

  /**
   * Returns true if a drag operation is currently in progress
   */
  public get isDragging(): boolean {
    return this.dragState?.isDragging ?? false;
  }

  /**
   * Cancels any pending drag tracking without performing a drop
   * Call this when something else (like opening a menu) should take precedence
   */
  public cancelTracking(): void {
    if (this.dragState && !this.dragState.isDragging) {
      this.cleanup();
    }
  }

  /**
   * Bound event handlers for cleanup
   */
  private boundHandlers: {
    onMouseMove: (e: MouseEvent) => void;
    onMouseUp: (e: MouseEvent) => void;
    onKeyDown: (e: KeyboardEvent) => void;
  } | null = null;

  /**
   * Module preparation
   */
  public async prepare(): Promise<void> {
    // No preparation needed
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
    const contentElement = block.holder.querySelector('[data-blok-element-content]') as HTMLElement | null;

    if (!contentElement) {
      return;
    }

    // Create preview element (hidden until drag threshold is passed)
    const preview = this.createPreview(contentElement, block.stretched);

    preview.style.display = 'none';
    document.body.appendChild(preview);

    this.dragState = {
      sourceBlock: block,
      targetBlock: null,
      targetEdge: null,
      previewElement: preview,
      startX: e.clientX,
      startY: e.clientY,
      isDragging: false,
      autoScrollInterval: null,
    };

    // Bind handlers
    this.boundHandlers = {
      onMouseMove: this.onMouseMove.bind(this),
      onMouseUp: this.onMouseUp.bind(this),
      onKeyDown: this.onKeyDown.bind(this),
    };

    document.addEventListener('mousemove', this.boundHandlers.onMouseMove);
    document.addEventListener('mouseup', this.boundHandlers.onMouseUp);
    document.addEventListener('keydown', this.boundHandlers.onKeyDown);
  }

  /**
   * Creates the drag preview element
   * @param contentElement - Element to clone for preview
   * @param isStretched - Whether block is stretched
   * @returns Preview element
   */
  private createPreview(contentElement: HTMLElement, isStretched: boolean): HTMLElement {
    const preview = $.make('div', PREVIEW_STYLES.base);
    const clone = contentElement.cloneNode(true) as HTMLElement;

    // Reset styles on clone
    clone.className = twMerge(PREVIEW_STYLES.content, isStretched ? 'max-w-none' : '');

    preview.appendChild(clone);

    return preview;
  }

  /**
   * Handles mouse move during drag
   * @param e - Mouse event
   */
  private onMouseMove(e: MouseEvent): void {
    if (!this.dragState) {
      return;
    }

    const { startX, startY, isDragging, previewElement } = this.dragState;

    // Check if we've passed the drag threshold and start actual drag
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const shouldStartDrag = !isDragging && distance >= DRAG_CONFIG.dragThreshold;

    if (shouldStartDrag) {
      this.startDrag();
    }

    // Update preview position
    previewElement.style.left = `${e.clientX + DRAG_CONFIG.previewOffsetX}px`;
    previewElement.style.top = `${e.clientY + DRAG_CONFIG.previewOffsetY}px`;

    // Find drop target
    this.updateDropTarget(e.clientX, e.clientY);

    // Handle auto-scroll
    this.handleAutoScroll(e.clientY);
  }

  /**
   * Starts the actual drag operation
   */
  private startDrag(): void {
    if (!this.dragState) {
      return;
    }

    this.dragState.isDragging = true;
    this.dragState.previewElement.style.display = 'block';

    // Set global dragging state
    this.Blok.UI.nodes.wrapper.setAttribute(BLOK_DRAGGING_ATTR, 'true');

    // Clear selection and hide tooltips
    this.Blok.BlockSelection.clearSelection();
    tooltip.hide(true);
    this.Blok.Toolbar.close();
  }

  /**
   * Updates the drop target based on cursor position
   * @param clientX - Cursor X position
   * @param clientY - Cursor Y position
   */
  private updateDropTarget(clientX: number, clientY: number): void {
    if (!this.dragState) {
      return;
    }

    // Clear previous indicator
    if (this.dragState.targetBlock) {
      this.dragState.targetBlock.holder.removeAttribute('data-drop-indicator');
    }

    // Find element under cursor (temporarily hide preview)
    this.dragState.previewElement.style.display = 'none';
    const elementUnderCursor = document.elementFromPoint(clientX, clientY);

    this.dragState.previewElement.style.display = 'block';

    if (!elementUnderCursor) {
      this.dragState.targetBlock = null;
      this.dragState.targetEdge = null;

      return;
    }

    // Find block holder
    const blockHolder = elementUnderCursor.closest(BLOK_ELEMENT_SELECTOR) as HTMLElement | null;

    if (!blockHolder) {
      this.dragState.targetBlock = null;
      this.dragState.targetEdge = null;

      return;
    }

    // Find the block instance
    const targetBlock = this.Blok.BlockManager.blocks.find(b => b.holder === blockHolder);

    if (!targetBlock || targetBlock === this.dragState.sourceBlock) {
      this.dragState.targetBlock = null;
      this.dragState.targetEdge = null;

      return;
    }

    // Determine edge (top or bottom half of block)
    const rect = blockHolder.getBoundingClientRect();
    const edge: 'top' | 'bottom' = clientY < rect.top + rect.height / 2 ? 'top' : 'bottom';

    this.dragState.targetBlock = targetBlock;
    this.dragState.targetEdge = edge;

    // Show drop indicator (only bottom edge supported in current implementation)
    if (edge === 'bottom') {
      blockHolder.setAttribute('data-drop-indicator', 'bottom');
    }
  }

  /**
   * Handles auto-scrolling when cursor is near edges
   * @param clientY - Cursor Y position
   */
  private handleAutoScroll(clientY: number): void {
    if (!this.dragState) {
      return;
    }

    const redactor = this.Blok.UI.nodes.redactor;
    const rect = redactor.getBoundingClientRect();

    // Clear existing auto-scroll
    if (this.dragState.autoScrollInterval !== null) {
      cancelAnimationFrame(this.dragState.autoScrollInterval);
      this.dragState.autoScrollInterval = null;
    }

    const scrollUp = clientY < rect.top + DRAG_CONFIG.autoScrollZone;
    const scrollDown = clientY > rect.bottom - DRAG_CONFIG.autoScrollZone;

    if (!scrollUp && !scrollDown) {
      return;
    }

    const scroll = (): void => {
      if (!this.dragState || !this.dragState.isDragging) {
        return;
      }

      const direction = scrollUp ? -1 : 1;

      redactor.scrollTop += direction * DRAG_CONFIG.autoScrollSpeed;
      this.dragState.autoScrollInterval = requestAnimationFrame(scroll);
    };

    this.dragState.autoScrollInterval = requestAnimationFrame(scroll);
  }

  /**
   * Handles mouse up to complete or cancel drag
   * @param e - Mouse event
   */
  private onMouseUp(_e: MouseEvent): void {
    if (!this.dragState) {
      return;
    }

    const { isDragging, sourceBlock, targetBlock, targetEdge } = this.dragState;

    if (isDragging && targetBlock && targetEdge) {
      // Perform the drop
      this.handleDrop(sourceBlock, targetBlock, targetEdge);
    }

    this.cleanup();
  }

  /**
   * Handles escape key to cancel drag
   * @param e - Keyboard event
   */
  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.cleanup();
    }
  }

  /**
   * Handles the actual block drop
   * @param sourceBlock - Block being dragged
   * @param targetBlock - Block dropped onto
   * @param edge - Edge of target ('top' or 'bottom')
   */
  private handleDrop(sourceBlock: Block, targetBlock: Block, edge: 'top' | 'bottom'): void {
    const fromIndex = this.Blok.BlockManager.getBlockIndex(sourceBlock);
    const targetIndex = this.Blok.BlockManager.getBlockIndex(targetBlock);

    // Calculate the new index based on drop position
    const baseIndex = edge === 'top' ? targetIndex : targetIndex + 1;

    // Adjust index if moving from before the target
    const toIndex = fromIndex < baseIndex ? baseIndex - 1 : baseIndex;

    // Only move if position actually changed
    if (fromIndex === toIndex) {
      return;
    }

    this.Blok.BlockManager.move(toIndex, fromIndex, false);

    // Select the moved block to provide visual feedback
    const movedBlock = this.Blok.BlockManager.getBlockByIndex(toIndex);

    if (movedBlock) {
      this.Blok.BlockSelection.selectBlock(movedBlock);
    }

    // Re-open toolbar on the dropped block
    this.Blok.Toolbar.skipNextSettingsToggle();
    this.Blok.Toolbar.moveAndOpen(sourceBlock);
  }

  /**
   * Cleans up drag state and event listeners
   */
  private cleanup(): void {
    if (!this.dragState) {
      return;
    }

    // Clear auto-scroll
    if (this.dragState.autoScrollInterval !== null) {
      cancelAnimationFrame(this.dragState.autoScrollInterval);
    }

    // Clear drop indicator
    if (this.dragState.targetBlock) {
      this.dragState.targetBlock.holder.removeAttribute('data-drop-indicator');
    }

    // Remove preview
    if (this.dragState.previewElement.parentNode) {
      this.dragState.previewElement.remove();
    }

    // Remove global dragging state
    this.Blok.UI.nodes.wrapper.removeAttribute(BLOK_DRAGGING_ATTR);

    // Remove event listeners
    if (this.boundHandlers) {
      document.removeEventListener('mousemove', this.boundHandlers.onMouseMove);
      document.removeEventListener('mouseup', this.boundHandlers.onMouseUp);
      document.removeEventListener('keydown', this.boundHandlers.onKeyDown);
      this.boundHandlers = null;
    }

    this.dragState = null;
  }

  /**
   * Module destruction
   */
  public destroy(): void {
    this.cleanup();
  }
}
