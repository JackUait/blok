import { LIST_TOOL_NAME } from '../constants';
import { BlockEventComposer } from './__base';
import { SelectionUtils } from '../../../selection';
import type { Block } from '../../../block';

/**
 * BlockSelectionKeys Composer handles keyboard interactions when blocks are selected.
 *
 * Handles:
 * - Multi-select with Shift+Arrow keys
 * - Delete/Backspace of selected blocks
 * - Cmd+C / Cmd+X for copy/cut of selected blocks
 * - List indent/outdent with Tab/Shift+Tab
 */
export class BlockSelectionKeys extends BlockEventComposer {
  /**
   * Get the depth of a list block from its data attribute.
   * @param block - the block to get depth from
   * @returns depth value (0 if not found or not a list)
   */
  private getListBlockDepth(block: Block): number {
    const depthAttr = block.holder?.querySelector('[data-list-depth]')?.getAttribute('data-list-depth');

    return depthAttr ? parseInt(depthAttr, 10) : 0;
  }

  /**
   * Check if all selected list items can be indented.
   * Each item must have a previous list item, and its depth must be <= previous item's depth.
   * @returns true if all selected items can be indented
   */
  private canIndentSelectedListItems(): boolean {
    const { BlockSelection, BlockManager } = this.Blok;

    for (const block of BlockSelection.selectedBlocks) {
      const blockIndex = BlockManager.getBlockIndex(block);

      if (blockIndex === undefined || blockIndex === 0) {
        return false;
      }

      const previousBlock = BlockManager.getBlockByIndex(blockIndex - 1);

      if (!previousBlock || previousBlock.name !== LIST_TOOL_NAME) {
        return false;
      }

      if (this.getListBlockDepth(block) > this.getListBlockDepth(previousBlock)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if all selected list items can be outdented (all have depth > 0).
   * @returns true if all selected items can be outdented
   */
  private canOutdentSelectedListItems(): boolean {
    return this.Blok.BlockSelection.selectedBlocks.every((block) => this.getListBlockDepth(block) > 0);
  }

  /**
   * Update depth of all selected list items.
   * @param delta - depth change (+1 for indent, -1 for outdent)
   */
  private async updateSelectedListItemsDepth(delta: number): Promise<void> {
    const { BlockSelection, BlockManager } = this.Blok;

    const blockIndices = BlockSelection.selectedBlocks
      .map((block) => BlockManager.getBlockIndex(block))
      .filter((index): index is number => index >= 0)
      .sort((a, b) => a - b);

    for (const blockIndex of blockIndices) {
      const block = BlockManager.getBlockByIndex(blockIndex);

      if (!block) {
        continue;
      }

      const savedData = await block.save();
      const newBlock = await BlockManager.update(block, {
        ...savedData,
        depth: Math.max(0, this.getListBlockDepth(block) + delta),
      });

      newBlock.selected = true;
    }

    BlockSelection.clearCache();
  }

  /**
   * Handles Tab/Shift+Tab for multi-selected list items.
   * @param event - keyboard event
   * @returns true if the event was handled, false to fall through to default behavior
   */
  public handleIndent(event: KeyboardEvent): boolean {
    const { BlockSelection } = this.Blok;

    if (!BlockSelection.anyBlockSelected) {
      return false;
    }

    const allListItems = BlockSelection.selectedBlocks.every(
      (block) => block.name === LIST_TOOL_NAME
    );

    if (!allListItems) {
      return false;
    }

    event.preventDefault();

    const isOutdent = event.shiftKey;

    if (isOutdent && this.canOutdentSelectedListItems()) {
      void this.updateSelectedListItemsDepth(-1);

      return true;
    }

    if (!isOutdent && this.canIndentSelectedListItems()) {
      void this.updateSelectedListItemsDepth(1);
    }

    return true;
  }

  /**
   * Tries to delete selected blocks when remove keys pressed.
   * @param event - keyboard event
   * @returns true if event was handled
   */
  public handleDeletion(event: KeyboardEvent): boolean {
    const { BlockSelection, BlockManager, Caret, BlockSettings } = this.Blok;

    /**
     * Ignore delete/backspace from inside the BlockSettings popover (e.g., search input)
     */
    if (BlockSettings.contains(event.target as HTMLElement)) {
      return false;
    }

    const isRemoveKey = event.key === 'Backspace' || event.key === 'Delete';

    if (!isRemoveKey) {
      return false;
    }

    const selectionExists = SelectionUtils.isSelectionExists;
    const selectionCollapsed = SelectionUtils.isCollapsed === true;
    const shouldHandleSelectionDeletion = BlockSelection.anyBlockSelected &&
      (!selectionExists || selectionCollapsed);

    if (!shouldHandleSelectionDeletion) {
      return false;
    }

    const insertedBlock = BlockManager.deleteSelectedBlocksAndInsertReplacement();

    if (insertedBlock) {
      Caret.setToBlock(insertedBlock, Caret.positions.START);
    }

    BlockSelection.clearSelection(event);

    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();

    return true;
  }

  /**
   * Copying selected blocks.
   * Before putting to the clipboard we sanitize all blocks and then copy to the clipboard.
   * @param event - clipboard event
   */
  public handleCopy(event: ClipboardEvent): void {
    const { BlockSelection } = this.Blok;

    if (!BlockSelection.anyBlockSelected) {
      return;
    }

    void BlockSelection.copySelectedBlocks(event);
  }

  /**
   * Copy and Delete selected Blocks.
   * @param event - clipboard event
   */
  public handleCut(event: ClipboardEvent): void {
    const { BlockSelection, BlockManager, Caret } = this.Blok;

    if (!BlockSelection.anyBlockSelected) {
      return;
    }

    BlockSelection.copySelectedBlocks(event).then(() => {
      const insertedBlock = BlockManager.deleteSelectedBlocksAndInsertReplacement();

      if (insertedBlock) {
        Caret.setToBlock(insertedBlock, Caret.positions.START);
      }

      BlockSelection.clearSelection(event);
    })
      .catch(() => {
        // Handle copy operation failure silently
      });
  }
}
