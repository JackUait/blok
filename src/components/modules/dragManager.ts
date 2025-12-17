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
import { DATA_ATTR, createSelector } from '../constants';
import { twMerge } from '../utils/tw';
import { announce } from '../utils/announcer';

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
  previewOffsetX: 10,
  previewOffsetY: 0,
  /** Minimum distance to start drag (prevents accidental drags) */
  dragThreshold: 5,
  /** Auto-scroll configuration */
  autoScrollZone: 50,
  autoScrollSpeed: 10,
  /** Throttle delay for drop position announcements (ms) */
  announcementThrottleMs: 300,
};

/**
 * State of the current drag operation
 */
interface DragState {
  /** Primary block being dragged (the one with the drag handle) */
  sourceBlock: Block;
  /** All blocks being dragged (single block or multiple selected blocks) */
  sourceBlocks: Block[];
  /** Whether this is a multi-block drag operation */
  isMultiBlockDrag: boolean;
  /** Current drop target block */
  targetBlock: Block | null;
  /** Edge of target block ('top' or 'bottom') */
  targetEdge: 'top' | 'bottom' | null;
  /** Last announced drop position (to avoid duplicate announcements) */
  lastAnnouncedDropIndex: number | null;
  /** Pending drop position to announce (for throttling) */
  pendingAnnouncementIndex: number | null;
  /** Timeout ID for throttled announcement */
  announcementTimeoutId: ReturnType<typeof setTimeout> | null;
  /** Drag preview element */
  previewElement: HTMLElement;
  /** Starting mouse position */
  startX: number;
  startY: number;
  /** Whether drag has actually started (passed threshold) */
  isDragging: boolean;
  /** Auto-scroll interval */
  autoScrollInterval: number | null;
  /** Scrollable container for auto-scroll (null means use window) */
  scrollContainer: HTMLElement | null;
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
    onKeyUp: (e: KeyboardEvent) => void;
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

    // Determine if this is a multi-block drag
    const isBlockSelected = block.selected;
    const initialBlocks = isBlockSelected
      ? this.Blok.BlockSelection.selectedBlocks
      : [block];

    // For single-block list item drags, include all descendants
    const descendants = !isBlockSelected
      ? this.getListItemDescendants(block)
      : [];
    const blocksToMove = descendants.length > 0
      ? [block, ...descendants]
      : initialBlocks;

    const isMultiBlock = blocksToMove.length > 1;

    // Create appropriate preview (single or multi-block)
    const preview = isMultiBlock
      ? this.createMultiBlockPreview(blocksToMove)
      : this.createPreview(contentElement, block.stretched);

    preview.style.display = 'none';
    document.body.appendChild(preview);

    this.dragState = {
      sourceBlock: block,
      sourceBlocks: blocksToMove,
      isMultiBlockDrag: isMultiBlock,
      targetBlock: null,
      targetEdge: null,
      lastAnnouncedDropIndex: null,
      pendingAnnouncementIndex: null,
      announcementTimeoutId: null,
      previewElement: preview,
      startX: e.clientX,
      startY: e.clientY,
      isDragging: false,
      autoScrollInterval: null,
      scrollContainer: this.findScrollableAncestor(this.Blok.UI.nodes.wrapper),
    };

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

    // Reset margin on the tool's rendered element (first child) to prevent offset
    const toolElement = clone.firstElementChild as HTMLElement | null;

    if (toolElement) {
      toolElement.className = twMerge(toolElement.className, '!m-0');
    }

    preview.appendChild(clone);

    return preview;
  }

  /**
   * Creates a stacked preview element for multiple blocks
   * @param blocks - Array of blocks to preview
   * @returns Preview element with stacked blocks and count badge
   */
  private createMultiBlockPreview(blocks: Block[]): HTMLElement {
    const preview = $.make('div', PREVIEW_STYLES.base);

    // Get block holder dimensions to capture actual spacing
    const blockInfo = blocks.map((block) => {
      const holderRect = block.holder.getBoundingClientRect();
      const contentElement = block.holder.querySelector('[data-blok-element-content]') as HTMLElement | null;

      if (!contentElement) {
        return { width: 0, height: 0, element: null, holderHeight: 0 };
      }

      const contentRect = contentElement.getBoundingClientRect();

      return {
        width: contentRect.width,
        height: contentRect.height,
        element: contentElement,
        holderHeight: holderRect.height, // Includes margins/padding
      };
    });

    // Calculate cumulative top positions using actual block holder heights
    const positions = blockInfo.reduce<number[]>((acc, _, index) => {
      if (index === 0) {
        acc.push(0);
      } else {
        const previousTop = acc[index - 1];
        const previousHolderHeight = blockInfo[index - 1].holderHeight;

        acc.push(previousTop + previousHolderHeight);
      }

      return acc;
    }, []);

    // Calculate total dimensions
    const maxWidth = Math.max(...blockInfo.map(info => info.width), 0);
    const lastIndex = blockInfo.length - 1;
    const totalHeight = lastIndex >= 0
      ? positions[lastIndex] + blockInfo[lastIndex].height
      : 0;

    // Create stacked blocks
    blocks.forEach((block, index) => {
      const info = blockInfo[index];

      if (!info.element) {
        return;
      }

      const clone = info.element.cloneNode(true) as HTMLElement;

      clone.className = twMerge(PREVIEW_STYLES.content, block.stretched ? 'max-w-none' : '');

      // Reset margin on the tool's rendered element (first child) to prevent offset
      const toolElement = clone.firstElementChild as HTMLElement | null;

      if (toolElement) {
        toolElement.className = twMerge(toolElement.className, '!m-0');
      }

      // Position with cumulative offset
      clone.style.position = 'absolute';
      clone.style.top = `${positions[index]}px`;
      clone.style.left = '0';
      clone.style.zIndex = `${blocks.length - index}`;

      preview.appendChild(clone);
    });

    // Set explicit dimensions on the preview container
    // This is necessary because absolutely positioned children don't contribute to parent size
    preview.style.width = `${maxWidth}px`;
    preview.style.height = `${totalHeight}px`;

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
    const wrapper = this.Blok.UI.nodes.wrapper;

    wrapper.setAttribute(DATA_ATTR.dragging, 'true');

    // Add multi-block dragging attribute if applicable
    if (this.dragState.isMultiBlockDrag) {
      wrapper.setAttribute(DATA_ATTR.draggingMulti, 'true');
    }

    // Clear selection for single-block drags only
    // For multi-block drags, keep selection visible for visual feedback
    if (!this.dragState.isMultiBlockDrag) {
      this.Blok.BlockSelection.clearSelection();
    }

    tooltip.hide(true);
    this.Blok.Toolbar.close();

    // Announce drag started to screen readers
    this.announceDragStarted();
  }

  /**
   * Announces that a drag operation has started
   * Note: This is only called from startDrag() which guarantees dragState exists
   */
  private announceDragStarted(): void {
    const blockCount = this.dragState!.sourceBlocks.length;

    if (blockCount > 1) {
      const message = this.Blok.I18n.t('a11y.dragStartedMultiple', { count: blockCount });

      announce(message, { politeness: 'assertive' });
    } else {
      announce(
        this.Blok.I18n.t('a11y.dragStarted'),
        { politeness: 'assertive' }
      );
    }
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
      this.dragState.targetBlock.holder.style.removeProperty('--drop-indicator-depth');
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
    const blockHolder = elementUnderCursor.closest(createSelector(DATA_ATTR.element)) as HTMLElement | null;

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

    // Prevent dropping into the middle of a multi-block selection
    if (this.dragState.isMultiBlockDrag && this.dragState.sourceBlocks.includes(targetBlock)) {
      this.dragState.targetBlock = null;
      this.dragState.targetEdge = null;

      return;
    }

    // Determine edge (top or bottom half of block)
    const rect = blockHolder.getBoundingClientRect();
    const isTopHalf = clientY < rect.top + rect.height / 2;
    const targetIndex = this.Blok.BlockManager.getBlockIndex(targetBlock);

    // Normalize: convert "top of block N" to "bottom of block N-1" (except for the first block)
    // This ensures we only ever show one indicator per drop position
    const previousBlock = targetIndex > 0
      ? this.Blok.BlockManager.getBlockByIndex(targetIndex - 1)
      : null;
    const canUsePreviousBlock = previousBlock && !this.dragState.sourceBlocks.includes(previousBlock);

    if (isTopHalf && targetIndex > 0 && canUsePreviousBlock) {
      this.dragState.targetBlock = previousBlock;
      this.dragState.targetEdge = 'bottom';
      previousBlock.holder.setAttribute('data-drop-indicator', 'bottom');

      const targetDepth = this.calculateTargetDepth(previousBlock, 'bottom');

      previousBlock.holder.style.setProperty('--drop-indicator-depth', String(targetDepth));

      return;
    }

    if (isTopHalf && targetIndex > 0) {
      // Previous block is part of selection, can't drop here
      this.dragState.targetBlock = null;
      this.dragState.targetEdge = null;

      return;
    }

    // First block top half, or any block bottom half
    const edge: 'top' | 'bottom' = isTopHalf ? 'top' : 'bottom';

    this.dragState.targetBlock = targetBlock;
    this.dragState.targetEdge = edge;
    blockHolder.setAttribute('data-drop-indicator', edge);

    const targetDepth = this.calculateTargetDepth(targetBlock, edge);

    blockHolder.style.setProperty('--drop-indicator-depth', String(targetDepth));

    // Announce drop position change to screen readers
    this.announceDropPosition();
  }

  /**
   * Announces the current drop position to screen readers
   * Throttled to avoid overwhelming screen readers with rapid announcements
   * Only announces if the position has changed since the last announcement
   */
  private announceDropPosition(): void {
    if (!this.dragState?.targetBlock || !this.dragState.targetEdge) {
      return;
    }

    const targetIndex = this.Blok.BlockManager.getBlockIndex(this.dragState.targetBlock);
    const dropIndex = this.dragState.targetEdge === 'top' ? targetIndex : targetIndex + 1;

    // Don't announce if position hasn't changed
    if (this.dragState.lastAnnouncedDropIndex === dropIndex) {
      return;
    }

    // Store the pending announcement
    this.dragState.pendingAnnouncementIndex = dropIndex;

    // If there's already a pending timeout, let it handle the announcement
    if (this.dragState.announcementTimeoutId !== null) {
      return;
    }

    // Schedule the announcement with throttling
    this.dragState.announcementTimeoutId = setTimeout(() => {
      if (!this.dragState || this.dragState.pendingAnnouncementIndex === null) {
        return;
      }

      const pendingIndex = this.dragState.pendingAnnouncementIndex;

      // Clear the timeout state
      this.dragState.announcementTimeoutId = null;
      this.dragState.pendingAnnouncementIndex = null;

      // Don't announce if it's the same as what we already announced
      if (this.dragState.lastAnnouncedDropIndex === pendingIndex) {
        return;
      }

      this.dragState.lastAnnouncedDropIndex = pendingIndex;

      const total = this.Blok.BlockManager.blocks.length;
      const message = this.Blok.I18n.t('a11y.dropPosition', {
        position: pendingIndex + 1,
        total,
      });

      announce(message, { politeness: 'polite' });
    }, DRAG_CONFIG.announcementThrottleMs);
  }

  /**
   * Finds the scrollable ancestor of an element
   * @param element - Starting element
   * @returns The scrollable element or null if window should be used
   */
  private findScrollableAncestor(element: HTMLElement | null): HTMLElement | null {
    if (!element || element === document.body) {
      return null;
    }

    const parent = element.parentElement;

    if (!parent || parent === document.body) {
      return null;
    }

    const style = window.getComputedStyle(parent);
    const overflowY = style.overflowY;
    const isScrollable = overflowY === 'auto' || overflowY === 'scroll';
    const canScroll = parent.scrollHeight > parent.clientHeight;

    if (isScrollable && canScroll) {
      return parent;
    }

    return this.findScrollableAncestor(parent);
  }

  /**
   * Handles auto-scrolling when cursor is near viewport edges
   * @param clientY - Cursor Y position
   */
  private handleAutoScroll(clientY: number): void {
    if (!this.dragState) {
      return;
    }

    // Clear existing auto-scroll
    if (this.dragState.autoScrollInterval !== null) {
      cancelAnimationFrame(this.dragState.autoScrollInterval);
      this.dragState.autoScrollInterval = null;
    }

    // Determine scroll zones based on viewport
    const viewportHeight = window.innerHeight;
    const scrollUp = clientY < DRAG_CONFIG.autoScrollZone;
    const scrollDown = clientY > viewportHeight - DRAG_CONFIG.autoScrollZone;

    if (!scrollUp && !scrollDown) {
      return;
    }

    const { scrollContainer } = this.dragState;

    const scroll = (): void => {
      if (!this.dragState || !this.dragState.isDragging) {
        return;
      }

      const direction = scrollUp ? -1 : 1;
      const scrollAmount = direction * DRAG_CONFIG.autoScrollSpeed;

      if (scrollContainer) {
        scrollContainer.scrollTop += scrollAmount;
      } else {
        window.scrollBy(0, scrollAmount);
      }

      this.dragState.autoScrollInterval = requestAnimationFrame(scroll);
    };

    this.dragState.autoScrollInterval = requestAnimationFrame(scroll);
  }

  /**
   * Handles mouse up to complete or cancel drag
   * @param e - Mouse event
   */
  private onMouseUp(e: MouseEvent): void {
    if (!this.dragState) {
      return;
    }

    const { isDragging, sourceBlock, sourceBlocks, targetBlock, targetEdge } = this.dragState;
    const canDrop = isDragging && targetBlock !== null && targetEdge !== null;

    if (!canDrop) {
      this.cleanup();

      return;
    }

    // Check Alt key state at drop time to determine operation
    if (e.altKey) {
      void this.handleDuplicate(sourceBlocks, targetBlock, targetEdge);
    } else {
      this.handleDrop(sourceBlock, targetBlock, targetEdge);
    }

    this.cleanup();
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
    if (e.key === 'Alt' && this.dragState?.isDragging) {
      this.setDuplicationMode(true);
    }
  }

  /**
   * Handles Alt key release to toggle off duplication mode
   * @param e - Keyboard event
   */
  private onKeyUp(e: KeyboardEvent): void {
    if (e.key === 'Alt' && this.dragState?.isDragging) {
      this.setDuplicationMode(false);
    }
  }

  /**
   * Sets duplication mode visual feedback on or off.
   * The actual duplication decision is made by checking e.altKey at drop time,
   * this method only controls the visual indicator for user feedback.
   * @param isDuplicating - Whether duplication mode should be visually indicated
   */
  private setDuplicationMode(isDuplicating: boolean): void {
    if (!this.dragState) {
      return;
    }

    const wrapper = this.Blok.UI.nodes.wrapper;

    if (isDuplicating) {
      wrapper.setAttribute(DATA_ATTR.duplicating, 'true');
    } else {
      wrapper.removeAttribute(DATA_ATTR.duplicating);
    }
  }

  /**
   * Handles the actual block drop
   * @param sourceBlock - Block being dragged
   * @param targetBlock - Block dropped onto
   * @param edge - Edge of target ('top' or 'bottom')
   */
  private handleDrop(sourceBlock: Block, targetBlock: Block, edge: 'top' | 'bottom'): void {
    const { isMultiBlockDrag, sourceBlocks } = this.dragState!;

    if (isMultiBlockDrag) {
      this.handleMultiBlockDrop(sourceBlocks, targetBlock, edge);
    } else {
      this.handleSingleBlockDrop(sourceBlock, targetBlock, edge);
    }

    // Announce successful drop to screen readers
    this.announceDropComplete(sourceBlock, sourceBlocks, isMultiBlockDrag);

    // Re-open toolbar on the dropped block
    this.Blok.Toolbar.skipNextSettingsToggle();
    this.Blok.Toolbar.moveAndOpen(sourceBlock);
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
    const manager = this.Blok.BlockManager;

    // Sort blocks by current index to preserve order
    const sortedBlocks = [...sourceBlocks].sort((a, b) =>
      manager.getBlockIndex(a) - manager.getBlockIndex(b)
    );

    // Calculate target insertion point
    const targetIndex = manager.getBlockIndex(targetBlock);
    const baseInsertIndex = edge === 'top' ? targetIndex : targetIndex + 1;

    // Save all blocks concurrently and filter out failures
    const saveResults = await Promise.all(
      sortedBlocks.map(async (block) => {
        const saved = await block.save();

        if (!saved) {
          return null;
        }

        return {
          saved,
          toolName: block.name,
        };
      })
    );

    const validResults = saveResults.filter(
      (result): result is NonNullable<typeof result> => result !== null
    );

    if (validResults.length === 0) {
      return;
    }

    // Insert duplicated blocks
    const duplicatedBlocks = validResults.map(({ saved, toolName }, index) =>
      manager.insert({
        tool: toolName,
        data: saved.data,
        tunes: saved.tunes,
        index: baseInsertIndex + index,
        needToFocus: false,
      })
    );

    // Announce duplication to screen readers
    this.announceDuplicateComplete(duplicatedBlocks);

    // Select all duplicated blocks
    this.Blok.BlockSelection.clearSelection();
    duplicatedBlocks.forEach(block => {
      this.Blok.BlockSelection.selectBlock(block);
    });

    // Re-open toolbar on the first duplicated block
    if (duplicatedBlocks.length > 0) {
      this.Blok.Toolbar.skipNextSettingsToggle();
      this.Blok.Toolbar.moveAndOpen(duplicatedBlocks[0]);
    }
  }

  /**
   * Announces that a duplication operation has completed
   * @param duplicatedBlocks - The blocks that were duplicated
   */
  private announceDuplicateComplete(duplicatedBlocks: Block[]): void {
    const firstBlock = duplicatedBlocks[0];

    if (!firstBlock) {
      return;
    }

    const newIndex = this.Blok.BlockManager.getBlockIndex(firstBlock);
    const count = duplicatedBlocks.length;

    if (count > 1) {
      const message = this.Blok.I18n.t('a11y.blocksDuplicated', {
        count,
        position: newIndex + 1,
      });

      announce(message, { politeness: 'assertive' });
    } else {
      const total = this.Blok.BlockManager.blocks.length;
      const message = this.Blok.I18n.t('a11y.blockDuplicated', {
        position: newIndex + 1,
        total,
      });

      announce(message, { politeness: 'assertive' });
    }
  }

  /**
   * Announces that a drop operation has completed
   * @param sourceBlock - The primary block that was dropped
   * @param sourceBlocks - All blocks that were dropped
   * @param isMultiBlockDrag - Whether this was a multi-block drag
   */
  private announceDropComplete(sourceBlock: Block, sourceBlocks: Block[], isMultiBlockDrag: boolean): void {
    const newIndex = this.Blok.BlockManager.getBlockIndex(sourceBlock);
    const total = this.Blok.BlockManager.blocks.length;

    if (isMultiBlockDrag) {
      const message = this.Blok.I18n.t('a11y.blocksMoved', {
        count: sourceBlocks.length,
        position: newIndex + 1,
      });

      announce(message, { politeness: 'assertive' });
    } else {
      const message = this.Blok.I18n.t('a11y.blockMoved', {
        position: newIndex + 1,
        total,
      });

      announce(message, { politeness: 'assertive' });
    }
  }

  /**
   * Handles dropping a single block
   * @param sourceBlock - Block being dragged
   * @param targetBlock - Block dropped onto
   * @param edge - Edge of target ('top' or 'bottom')
   */
  private handleSingleBlockDrop(sourceBlock: Block, targetBlock: Block, edge: 'top' | 'bottom'): void {
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

    if (!movedBlock) {
      return;
    }

    this.Blok.BlockSelection.selectBlock(movedBlock);
  }

  /**
   * Handles dropping multiple selected blocks
   * @param sourceBlocks - Array of blocks being dragged
   * @param targetBlock - Block dropped onto
   * @param edge - Edge of target ('top' or 'bottom')
   */
  private handleMultiBlockDrop(
    sourceBlocks: Block[],
    targetBlock: Block,
    edge: 'top' | 'bottom'
  ): void {
    const manager = this.Blok.BlockManager;

    // Sort blocks by current index
    const sortedBlocks = [...sourceBlocks].sort((a, b) =>
      manager.getBlockIndex(a) - manager.getBlockIndex(b)
    );

    // Calculate target insertion point
    const targetIndex = manager.getBlockIndex(targetBlock);
    const insertIndex = edge === 'top' ? targetIndex : targetIndex + 1;

    // Determine if we're moving blocks up or down
    const firstBlockIndex = manager.getBlockIndex(sortedBlocks[0]);
    const movingDown = insertIndex > firstBlockIndex;

    // Execute the move based on direction
    if (movingDown) {
      this.moveBlocksDown(sortedBlocks, insertIndex);
    } else {
      this.moveBlocksUp(sortedBlocks, insertIndex);
    }

    // Clear selection first, then re-select all moved blocks
    this.Blok.BlockSelection.clearSelection();
    sortedBlocks.forEach(block => {
      this.Blok.BlockSelection.selectBlock(block);
    });
  }

  /**
   * Moves blocks down (to a higher index)
   * @param sortedBlocks - Blocks sorted by current index
   * @param insertIndex - Target insertion index
   */
  private moveBlocksDown(sortedBlocks: Block[], insertIndex: number): void {
    const manager = this.Blok.BlockManager;

    // When moving down, start with insertIndex - 1 and decrement for each block
    // This ensures blocks maintain their relative order
    const reversedBlocks = [...sortedBlocks].reverse();

    reversedBlocks.forEach((block, index) => {
      const currentIndex = manager.getBlockIndex(block);
      const targetPosition = insertIndex - 1 - index;

      manager.move(targetPosition, currentIndex, false);
    });
  }

  /**
   * Moves blocks up (to a lower index)
   * @param sortedBlocks - Blocks sorted by current index
   * @param baseInsertIndex - Base target insertion index
   */
  private moveBlocksUp(sortedBlocks: Block[], baseInsertIndex: number): void {
    const manager = this.Blok.BlockManager;

    // Track how many blocks we've inserted to adjust the target index
    sortedBlocks.forEach((block, index) => {
      const currentIndex = manager.getBlockIndex(block);
      const targetIndex = baseInsertIndex + index;

      if (currentIndex === targetIndex) {
        return;
      }

      manager.move(targetIndex, currentIndex, false);
    });
  }

  /**
   * Cleans up drag state and event listeners
   * @param wasCancelled - Whether the drag was cancelled (not dropped)
   */
  private cleanup(wasCancelled = false): void {
    if (!this.dragState) {
      return;
    }

    // Announce cancellation to screen readers if drag was in progress and cancelled
    if (wasCancelled && this.dragState.isDragging) {
      announce(
        this.Blok.I18n.t('a11y.dropCancelled'),
        { politeness: 'polite' }
      );
    }

    // Clear auto-scroll
    if (this.dragState.autoScrollInterval !== null) {
      cancelAnimationFrame(this.dragState.autoScrollInterval);
    }

    // Clear pending announcement timeout
    if (this.dragState.announcementTimeoutId !== null) {
      clearTimeout(this.dragState.announcementTimeoutId);
    }

    // Clear drop indicator
    if (this.dragState.targetBlock) {
      this.dragState.targetBlock.holder.removeAttribute('data-drop-indicator');
      this.dragState.targetBlock.holder.style.removeProperty('--drop-indicator-depth');
    }

    // Remove preview
    if (this.dragState.previewElement.parentNode) {
      this.dragState.previewElement.remove();
    }

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

    this.dragState = null;
  }

  /**
   * Gets the depth of a list item block from its DOM.
   * Returns null if the block is not a list item.
   * @param block - Block to check
   * @returns Depth number or null if not a list item
   */
  private getListItemDepth(block: Block): number | null {
    const listWrapper = block.holder.querySelector('[data-list-depth]');

    if (!listWrapper) {
      return null;
    }

    const depthAttr = listWrapper.getAttribute('data-list-depth');

    return depthAttr ? parseInt(depthAttr, 10) : 0;
  }

  /**
   * Calculates the target depth for a block dropped at the given position.
   * This determines what nesting level the block will have after being dropped.
   * @param targetBlock - Block being dropped onto
   * @param targetEdge - Edge of target ('top' or 'bottom')
   * @returns The target depth (0 for root level, 1+ for nested)
   */
  private calculateTargetDepth(targetBlock: Block, targetEdge: 'top' | 'bottom'): number {
    const targetIndex = this.Blok.BlockManager.getBlockIndex(targetBlock);
    const dropIndex = targetEdge === 'top' ? targetIndex : targetIndex + 1;

    // First position always has depth 0
    if (dropIndex === 0) {
      return 0;
    }

    // Get the block that will be immediately before the drop position
    const previousBlock = this.Blok.BlockManager.getBlockByIndex(dropIndex - 1);

    if (!previousBlock) {
      return 0;
    }

    const previousDepth = this.getListItemDepth(previousBlock) ?? 0;

    // Get the block that will be immediately after the drop position
    const nextBlock = this.Blok.BlockManager.getBlockByIndex(dropIndex);
    const nextDepth = nextBlock ? (this.getListItemDepth(nextBlock) ?? 0) : 0;

    // If next item is nested, match its depth (become sibling)
    if (nextDepth > 0 && nextDepth <= previousDepth + 1) {
      return nextDepth;
    }

    // If previous item is nested, match its depth
    if (previousDepth > 0) {
      return previousDepth;
    }

    return 0;
  }

  /**
   * Gets all descendant list items of a block (direct children and their descendants).
   * Only includes items that are strictly deeper than the dragged item.
   * Stops when encountering a sibling (same depth) or parent (shallower depth).
   * @param block - Parent block to find descendants for
   * @returns Array of descendant blocks (empty if block is not a list item or has no descendants)
   */
  private getListItemDescendants(block: Block): Block[] {
    const parentDepth = this.getListItemDepth(block);

    if (parentDepth === null) {
      return [];
    }

    const blockIndex = this.Blok.BlockManager.getBlockIndex(block);
    const totalBlocks = this.Blok.BlockManager.blocks.length;

    const collectDescendants = (index: number, acc: Block[]): Block[] => {
      if (index >= totalBlocks) {
        return acc;
      }

      const nextBlock = this.Blok.BlockManager.getBlockByIndex(index);

      if (!nextBlock) {
        return acc;
      }

      const nextDepth = this.getListItemDepth(nextBlock);

      // Stop if not a list item or depth <= parent depth (sibling or shallower level)
      // A sibling is an item at the same depth - it's not a child of the dragged item
      if (nextDepth === null || nextDepth <= parentDepth) {
        return acc;
      }

      // Only include items strictly deeper than the parent (children, grandchildren, etc.)
      return collectDescendants(index + 1, [...acc, nextBlock]);
    };

    return collectDescendants(blockIndex + 1, []);
  }

  /**
   * Module destruction
   */
  public destroy(): void {
    this.cleanup();
  }
}
