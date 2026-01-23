import { Module } from '../__module';
import type { Block } from '../block';
import { SelectionUtils } from '../selection/index';
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

    this.listeners.on(document, 'mouseover', this.onMouseOver);
    this.listeners.on(document, 'mouseup', this.onMouseUp);
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

    /**
     * Don't clear selection when clicking on toolbar elements (settings toggler, plus button, etc.)
     * This allows multi-block selection to be preserved when interacting with the toolbar
     */
    const toolbarElement = Toolbar.nodes.wrapper;
    if (toolbarElement && toolbarElement.contains(event.target as Node)) {
      return;
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
     * Probably, blok is not initialized yet
     */
    if (mouseEvent.relatedTarget === null && mouseEvent.target === null) {
      return;
    }

    const relatedBlock = BlockManager.getBlockByChildNode(mouseEvent.relatedTarget as Node) || this.lastSelectedBlock;
    const targetBlock = BlockManager.getBlockByChildNode(mouseEvent.target as Node);

    if (!relatedBlock || !targetBlock) {
      return;
    }

    if (targetBlock === relatedBlock) {
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
      relatedBlock.selected = false;
      targetBlock.selected = false;

      BlockSelection.clearCache();

      return;
    }

    this.Blok.InlineToolbar.close();

    this.toggleBlocksSelectedState(relatedBlock, targetBlock);
    this.lastSelectedBlock = targetBlock;
  };

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
