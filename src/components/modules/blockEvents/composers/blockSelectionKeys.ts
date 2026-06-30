import type { Block } from '../../../block';
import { SelectionUtils } from '../../../selection/index';
import { LIST_TOOL_NAME } from '../constants';

import { BlockEventComposer } from './__base';
import { getPrecedingSibling, getFollowingSiblings } from './structural-siblings';

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
   * Check if all of the given list items can be indented.
   * Each item must have a previous list item, and its depth must be <= previous item's depth.
   * @param listItems - the list blocks to test
   * @returns true if all of them can be indented
   */
  private canIndentListItems(listItems: Block[]): boolean {
    const { BlockManager } = this.Blok;
    const selectedSet = new Set(listItems);

    for (const block of listItems) {
      const blockIndex = BlockManager.getBlockIndex(block);

      if (blockIndex === undefined) {
        return false;
      }

      const previousBlock = blockIndex > 0
        ? BlockManager.getBlockByIndex(blockIndex - 1)
        : undefined;

      const isFirstInGroup = !previousBlock || previousBlock.name !== LIST_TOOL_NAME;

      // First-in-group items can nest one level; mid-list items can't exceed previous depth
      if (isFirstInGroup && this.getListBlockDepth(block) >= 1) {
        return false;
      }
      if (isFirstInGroup) {
        continue;
      }

      /**
       * If the predecessor is also selected, both will be indented together,
       * so the relative depth difference is preserved — skip the check.
       */
      if (selectedSet.has(previousBlock)) {
        continue;
      }

      if (this.getListBlockDepth(block) > this.getListBlockDepth(previousBlock)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if all of the given list items can be outdented (all have depth > 0).
   * @param listItems - the list blocks to test
   * @returns true if all of them can be outdented
   */
  private canOutdentListItems(listItems: Block[]): boolean {
    return listItems.every((block) => this.getListBlockDepth(block) > 0);
  }

  /**
   * Update depth of the given list items.
   * @param listItems - the list blocks to re-depth
   * @param delta - depth change (+1 for indent, -1 for outdent)
   */
  private async updateListItemsDepth(listItems: Block[], delta: number): Promise<void> {
    const { BlockSelection, BlockManager } = this.Blok;

    const blockIndices = listItems
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

    const selectedBlocks = BlockSelection.selectedBlocks;
    const listItems = selectedBlocks.filter((block) => block.name === LIST_TOOL_NAME);
    const structuralItems = selectedBlocks.filter((block) => block.name !== LIST_TOOL_NAME);

    const allListItems = structuralItems.length === 0;

    if (allListItems) {
      event.preventDefault();

      const isOutdent = event.shiftKey;

      if (isOutdent && this.canOutdentListItems(listItems)) {
        void this.updateListItemsDepth(listItems, -1);

        return true;
      }

      if (!isOutdent && this.canIndentListItems(listItems)) {
        void this.updateListItemsDepth(listItems, 1);
      }

      return true;
    }

    /**
     * Non-list and MIXED selections indent/outdent each block by its own mechanism,
     * the same way single-block Tab nesting does (Notion parity): structural blocks
     * (paragraph/header/…) nest under their preceding sibling, while list items move
     * by their data-driven depth. A mixed selection is no longer a no-op — each kind
     * is handled independently and the relative structure of each is preserved.
     */
    event.preventDefault();

    if (event.shiftKey) {
      if (listItems.length > 0 && this.canOutdentListItems(listItems)) {
        void this.updateListItemsDepth(listItems, -1);
      }
      this.outdentSelectedBlocksStructurally(structuralItems);
    } else {
      if (listItems.length > 0 && this.canIndentListItems(listItems)) {
        void this.updateListItemsDepth(listItems, 1);
      }
      this.indentSelectedBlocksStructurally(structuralItems);
    }

    return true;
  }

  /**
   * Nest the whole selection one level deeper, under the preceding sibling of the
   * first selected block. Only the selection's top-level blocks are reparented;
   * their descendants follow automatically. No-op when the first block has no
   * preceding sibling (nothing to nest under).
   * @param blocks - the selected blocks, in document order
   */
  private indentSelectedBlocksStructurally(blocks: Block[]): void {
    const { BlockManager } = this.Blok;
    const first = blocks[0];

    if (first === undefined) {
      return;
    }

    const precedingSibling = getPrecedingSibling(BlockManager, first);

    if (precedingSibling === null) {
      return;
    }

    const originalParentId = first.parentId;

    for (const block of blocks) {
      if (block.parentId === originalParentId) {
        BlockManager.setBlockParent(block, precedingSibling.id);
      }
    }
  }

  /**
   * Outdent the whole selection one level: each top-level selected block becomes a
   * sibling of its former parent (a child of the grandparent). The siblings that
   * follow the last selected block are adopted under it, mirroring single-block
   * Shift+Tab. No-op when the selection is already at the document root.
   * @param blocks - the selected blocks, in document order
   */
  private outdentSelectedBlocksStructurally(blocks: Block[]): void {
    const { BlockManager } = this.Blok;
    const first = blocks[0];
    const last = blocks[blocks.length - 1];

    if (first === undefined || last === undefined || first.parentId === null) {
      return;
    }

    const parent = BlockManager.getBlockById(first.parentId);

    if (parent === undefined) {
      return;
    }

    const grandparentId = parent.parentId;
    const originalParentId = first.parentId;

    /**
     * Capture and adopt the following siblings BEFORE reparenting (reparenting
     * mutates the parent's contentIds) so the content below the selection stays
     * nested beneath the outdented group.
     */
    for (const sibling of getFollowingSiblings(BlockManager, last)) {
      BlockManager.setBlockParent(sibling, last.id);
    }

    for (const block of blocks) {
      if (block.parentId === originalParentId) {
        BlockManager.setBlockParent(block, grandparentId);
      }
    }
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
