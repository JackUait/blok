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

      /**
       * List nesting is STRUCTURAL (parentId/contentIds), the same as single-item
       * Tab — not a flat `data.depth` bump (Notion parity M-9/M-8). The list tool's
       * `moved()` hook derives `data.depth` from the new tree position, so the
       * visual indent and the saved tree stay in sync.
       *
       * Tab nests every selected item but the first: it nests under the preceding
       * sibling of the first selected item, or — when the first selected item has
       * no preceding sibling (it is the first item of its list and cannot indent,
       * Notion) — the remaining items nest under that first item.
       *
       * Shift+Tab outdents each item with a parent INDIVIDUALLY, leaving items
       * already at the document root (leftmost) in place. Items nested via the
       * FLAT `data.depth` carrier (authored/drag-nested, no structural parent) are
       * outdented by decrementing that carrier — all-or-nothing across the flat
       * items, so a selection that includes a depth-0 flat item is a no-op.
       */
      if (event.shiftKey) {
        this.outdentListItemsStructurally(listItems);
        this.outdentFlatListItems(listItems);
      } else {
        this.indentSelectedBlocksStructurally(listItems);
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
   * Nest the selection one level deeper. The anchor is the preceding sibling of
   * the first selected block, or — when the first selected block has no preceding
   * sibling (it is the first item of its list and cannot indent, Notion) — the
   * first selected block itself. Every selected top-level block EXCEPT the anchor
   * is reparented under the anchor; their descendants follow automatically.
   *
   * So a selection that starts at the very top of a list still indents every item
   * but the first (the first becomes the new parent), while a selection with room
   * above it nests entirely under that preceding sibling.
   * @param blocks - the selected blocks, in document order
   */
  private indentSelectedBlocksStructurally(blocks: Block[]): void {
    const { BlockManager } = this.Blok;
    const first = blocks[0];

    if (first === undefined) {
      return;
    }

    const precedingSibling = getPrecedingSibling(BlockManager, first);
    const anchor = precedingSibling ?? first;
    const originalParentId = first.parentId;

    for (const block of blocks) {
      if (block === anchor) {
        continue;
      }

      if (block.parentId === originalParentId) {
        BlockManager.setBlockParent(block, anchor.id);
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
   * Outdent the FLAT-carrier list items in the selection (no structural parent but
   * `data.depth` > 0, e.g. authored/drag-nested). Decrement is all-or-nothing across
   * the flat items, so a selection that includes a depth-0 flat item is a no-op —
   * matching the legacy flat multi-select semantics. Structurally nested items are
   * handled separately by {@link outdentListItemsStructurally}.
   * @param listItems - the selected list blocks, in document order
   */
  private outdentFlatListItems(listItems: Block[]): void {
    const flatItems = listItems.filter((block) => block.parentId === null);

    if (flatItems.length > 0 && flatItems.every((block) => this.getListBlockDepth(block) > 0)) {
      void this.updateListItemsDepth(flatItems, -1);
    }
  }

  /**
   * Outdent each selected list item that has a structural parent (depth > 0) by one
   * level — Notion's per-item Shift+Tab on a mixed-depth selection (M-8). Items
   * already at the document root (leftmost) stay put instead of failing the whole
   * group, and an item whose ancestor is also selected is carried along by that
   * ancestor's move, so it is not reparented directly (preserving relative nesting).
   * @param listItems - the selected list blocks, in document order
   */
  private outdentListItemsStructurally(listItems: Block[]): void {
    const { BlockManager } = this.Blok;
    const selectedIds = new Set(listItems.map((block) => block.id));

    /**
     * Resolve each eligible item's target parent (its grandparent) BEFORE mutating
     * the tree, so one item's move can't shift a sibling's computed grandparent.
     */
    const moves: Array<{ block: Block; grandparentId: string | null }> = [];

    for (const block of listItems) {
      // Already leftmost — nothing to outdent.
      if (block.parentId === null) {
        continue;
      }

      // A selected ancestor will carry this block along; don't move it directly.
      if (this.hasSelectedAncestor(block, selectedIds)) {
        continue;
      }

      const parent = BlockManager.getBlockById(block.parentId);

      if (parent === undefined) {
        continue;
      }

      moves.push({ block, grandparentId: parent.parentId });
    }

    for (const { block, grandparentId } of moves) {
      BlockManager.setBlockParent(block, grandparentId);
    }
  }

  /**
   * True when any ancestor of `block` (walking the parentId chain) is itself in
   * the selection.
   * @param block - the block whose ancestors to test
   * @param selectedIds - ids of every block in the current selection
   */
  private hasSelectedAncestor(block: Block, selectedIds: Set<string>): boolean {
    const { BlockManager } = this.Blok;
    const { parentId } = block;

    if (parentId === null) {
      return false;
    }

    if (selectedIds.has(parentId)) {
      return true;
    }

    const parent = BlockManager.getBlockById(parentId);

    return parent !== undefined ? this.hasSelectedAncestor(parent, selectedIds) : false;
  }

  /**
   * Cmd/Ctrl+Enter toggles the `checked` state of every selected checklist (to-do)
   * list item in place, via the public block update API — matching Notion's keyboard
   * checkbox toggle across a multi-selection (m-12). Non-checklist blocks in the
   * selection are left untouched.
   * @param event - keyboard event
   * @returns true if at least one checklist item was toggled
   */
  public handleToggleCheckbox(event: KeyboardEvent): boolean {
    const { BlockSelection } = this.Blok;

    /**
     * Self-guard on the Cmd/Ctrl modifier (like handleDeletion guards on its key)
     * so the dispatch site can call this unconditionally on Enter — a plain Enter
     * must still split / create a new item, never toggle.
     */
    if (!event.metaKey && !event.ctrlKey) {
      return false;
    }

    if (!BlockSelection.anyBlockSelected) {
      return false;
    }

    const checklistItems = BlockSelection.selectedBlocks.filter(
      (block) => this.getChecklistCheckbox(block) !== null
    );

    if (checklistItems.length === 0) {
      return false;
    }

    event.preventDefault();
    void this.toggleCheckboxes(checklistItems);

    return true;
  }

  /**
   * Returns a checklist (to-do) list item's checkbox input, or null when the block
   * is not a checklist list item. Only the checklist style renders a checkbox, so
   * its presence is a synchronous, reliable test for "this is a to-do item".
   * @param block - the block to test
   */
  private getChecklistCheckbox(block: Block): HTMLInputElement | null {
    if (block.name !== LIST_TOOL_NAME) {
      return null;
    }

    const checkbox = block.holder?.querySelector('input[type="checkbox"]');

    return checkbox instanceof HTMLInputElement ? checkbox : null;
  }

  /**
   * Flip `checked` on each selected checklist item through BlockManager.update
   * (which merges the partial data onto the existing tool data). The current state
   * is read from the rendered checkbox — the same source the click-toggle uses.
   * @param checklistItems - the selected checklist list blocks to toggle
   */
  private async toggleCheckboxes(checklistItems: Block[]): Promise<void> {
    const { BlockSelection, BlockManager } = this.Blok;

    for (const block of checklistItems) {
      const checkbox = this.getChecklistCheckbox(block);

      if (checkbox === null) {
        continue;
      }

      const newBlock = await BlockManager.update(block, { checked: !checkbox.checked });

      newBlock.selected = true;
    }

    BlockSelection.clearCache();
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
