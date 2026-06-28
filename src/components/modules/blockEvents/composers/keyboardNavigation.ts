import type { Block } from '../../../block';
import { Flipper } from '../../../flipper';
import { SelectionUtils } from '../../../selection';
import { keyCodes, delay, isIosDevice } from '../../../utils';
import { areBlocksMergeable } from '../../../utils/blocks';
import { findNbspAfterEmptyInline, focus, isCaretAtEndOfInput, isCaretAtStartOfInput } from '../../../utils/caret/index';
import { EDITABLE_INPUT_SELECTOR, HEADER_TOOL_NAME, LIST_TOOL_NAME, QUOTE_TOOL_NAME } from '../constants';
import { keyCodeFromEvent } from '../utils/keyboard';

import { BlockEventComposer } from './__base';

/**
 * Checks if the keyboard event is a block movement shortcut (Cmd/Ctrl+Shift+Arrow)
 * @param event - keyboard event
 * @param direction - 'up' or 'down'
 * @returns true if this is a block movement shortcut
 */
const isBlockMovementShortcut = (event: KeyboardEvent, direction: 'up' | 'down'): boolean => {
  const targetKey = direction === 'up' ? 'ArrowUp' : 'ArrowDown';

  return event.key === targetKey &&
    event.shiftKey &&
    (event.ctrlKey || event.metaKey);
};

/**
 * KeyboardNavigation Composer handles caret and block navigation via keyboard.
 *
 * Handles:
 * - Arrow keys for navigation (both horizontal and vertical)
 * - Enter key for block creation/splitting
 * - Tab key for navigating between inputs
 * - NBSP handling after empty inline elements
 * - Block merging on Backspace/Delete when at boundaries
 */
export class KeyboardNavigation extends BlockEventComposer {
  /**
   * Determine if we're using RTL layout.
   * In RTL, right/left navigation is inverted.
   */
  private get isRtl(): boolean {
    const ui = this.Blok.UI as unknown as { isRtl?: boolean };
    return ui.isRtl ?? false;
  }

  /**
   * Check if the current block is inside a table cell.
   * Used to prevent closing the toolbar when the user navigates
   * within a table — closing it makes the toolbar permanently
   * disappear because the hover controller deduplicates by block id
   * and all cells resolve to the same parent table block.
   */
  private get isCurrentBlockInsideTableCell(): boolean {
    const currentBlock = this.Blok.BlockManager.currentBlock;

    return Boolean(currentBlock?.holder?.closest('[data-blok-table-cell-blocks]'));
  }

  /**
   * Resolve the table-cell-blocks container element that owns the given block,
   * or null if the block is not inside a table cell.
   */
  private getTableCellContainer(block: Block | null | undefined): HTMLElement | null {
    return block?.holder?.closest<HTMLElement>('[data-blok-table-cell-blocks]') ?? null;
  }

  /**
   * True when `a` and `b` live inside the same table cell (same
   * `[data-blok-table-cell-blocks]` container). Used to decide whether
   * a Backspace/Delete merge would cross a cell boundary.
   */
  private areBlocksInSameTableCell(a: Block | null | undefined, b: Block | null | undefined): boolean {
    const cellA = this.getTableCellContainer(a);
    const cellB = this.getTableCellContainer(b);

    return cellA !== null && cellA === cellB;
  }

  /**
   * Fully close the toolbar if the current block is NOT inside a table cell.
   * Used for destructive operations (Backspace, Delete, merge) where the
   * toolbar should be dismissed — unlike arrow navigation where
   * hideBlockActions() is preferred to allow reopening.
   */
  private closeToolbarIfNotInTableCell(): void {
    if (this.isCurrentBlockInsideTableCell) {
      return;
    }

    this.Blok.Toolbar.close();
  }

  /**
   * Tab pressed inside a Block.
   * @param event - keydown event
   */
  public handleTab(event: KeyboardEvent): void {
    const { InlineToolbar, Caret, BlockSelection } = this.Blok;

    const isFlipperActivated = InlineToolbar.opened;

    if (isFlipperActivated) {
      return;
    }

    /**
     * Skip Tab handling for blocks inside table cells — the table's own grid-level
     * handler (setupKeyboardNavigation) manages cell-to-cell and table-exit navigation.
     */
    if (this.isCurrentBlockInsideTableCell) {
      return;
    }

    /**
     * Notion-style indentation: Tab nests the current block under the preceding
     * sibling; Shift+Tab outdents. Handled for a single block (no multi-block
     * selection — that path belongs to blockSelectionKeys.handleIndent). When the
     * block can't be indented/outdented (first block, already at min/max depth's
     * navigation cases), fall through to caret navigation so Tab can still move
     * focus / leave the editor for accessibility.
     */
    if (!BlockSelection.anyBlockSelected) {
      const handled = event.shiftKey ? this.outdentCurrentBlock() : this.indentCurrentBlock();

      if (handled) {
        event.preventDefault();

        return;
      }
    }

    const isNavigated = event.shiftKey ? Caret.navigatePrevious(true) : Caret.navigateNext(true);

    /**
     * Prevent default Tab behaviour only when navigation occurred within the
     * editor. When navigateNext/navigatePrevious returns false (no next/prev
     * block), allow the browser default so focus can leave the editor to
     * external elements (e.g. inputs after the editor).
     *
     * Nested editors (e.g. database card drawer) are safe because the table
     * cell guard above returns early, and those editors handle Tab themselves.
     */
    if (isNavigated) {
      event.preventDefault();
    }
  }

  /**
   * Indent the current block one level deeper, nesting it under the immediately
   * preceding sibling (the block right above it at the same parent level). Uses
   * the flat list-nesting indent, clamped so a block can never be more than one
   * level deeper than its predecessor — matching Notion's Tab rule.
   *
   * @returns true if Tab was consumed (indented, or already at max depth);
   *   false to let the caller fall back to caret navigation.
   */
  private indentCurrentBlock(): boolean {
    const { BlockManager } = this.Blok;
    const { currentBlock, previousBlock } = BlockManager;

    if (currentBlock === undefined || currentBlock.name === LIST_TOOL_NAME) {
      return false;
    }

    /**
     * Nothing to nest under: no preceding block, or the preceding block lives in a
     * different parent (so it is not a preceding sibling). Fall back to navigation.
     */
    if (previousBlock === null || previousBlock.parentId !== currentBlock.parentId) {
      return false;
    }

    const currentIndent = currentBlock.indent ?? 0;
    const maxIndent = (previousBlock.indent ?? 0) + 1;
    const nextIndent = Math.min(currentIndent + 1, maxIndent);

    if (nextIndent !== currentIndent) {
      BlockManager.setBlockIndent(currentBlock, nextIndent);
    }

    /**
     * Already at max depth: consume Tab anyway so it does not hijack the caret to
     * the next block (Notion leaves the caret in place when it can't indent further).
     */
    return true;
  }

  /**
   * Outdent the current block one level. Uses the flat list-nesting indent.
   *
   * @returns true if the block was outdented; false (already at root indent) to
   *   let the caller fall back to caret navigation.
   */
  private outdentCurrentBlock(): boolean {
    const { BlockManager } = this.Blok;
    const { currentBlock } = BlockManager;

    if (currentBlock === undefined || currentBlock.name === LIST_TOOL_NAME) {
      return false;
    }

    const currentIndent = currentBlock.indent ?? 0;

    if (currentIndent <= 0) {
      return false;
    }

    BlockManager.setBlockIndent(currentBlock, currentIndent - 1);

    return true;
  }

  /**
   * ENTER pressed on block
   * @param event - keydown event
   */
  public handleEnter(event: KeyboardEvent): void {
    const { BlockManager, UI } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    if (currentBlock === undefined) {
      return;
    }

    /**
     * Don't handle Enter keydowns when Tool sets enableLineBreaks to true.
     * Uses for Tools like <code> where line breaks should be handled by default behaviour.
     */
    if (currentBlock.tool.isLineBreaksEnabled) {
      return;
    }

    /**
     * Opened Toolbars uses Flipper with own Enter handling
     * Allow split block when no one button in Flipper is focused
     */
    if (UI.someToolbarOpened && UI.someFlipperButtonFocused) {
      return;
    }

    /**
     * Allow to create line breaks by Shift+Enter
     *
     * Note. On iOS devices, Safari automatically treats enter after a period+space (". |") as Shift+Enter
     * (it used for capitalizing of the first letter of the next sentence)
     * We don't need to lead soft line break in this case — new block should be created
     */
    if (event.shiftKey && !isIosDevice) {
      return;
    }

    /**
     * Capture caret position before block creation so undo can restore it.
     * Must run before stopCapturing/block insertion since the keyboard capture
     * handler fires AFTER handleEnter (document capture runs before redactor capture).
     */
    this.Blok.YjsManager.markCaretBeforeChange();

    /**
     * Use transactForTool to keep the entire Enter operation in a single undo entry:
     * 1. Calls stopCapturing() to separate from previous typing
     * 2. Suppresses stopCapturing during block creation + caret movement
     *    (prevents currentBlockIndex setter from splitting the undo entry
     *    before async table cell content sync completes)
     * 3. Calls stopCapturing() in rAF after all async syncs complete
     */
    this.Blok.BlockManager.transactForTool(() => {
      const blockToFocus = this.createBlockOnEnter(currentBlock);

      this.Blok.Caret.setToBlock(blockToFocus);

      /**
       * Refresh the "after" caret snapshot now that focus has moved to the new
       * block. Yjs `stack-item-added` fires inside createBlockOnEnter (the split
       * / insert transaction) BEFORE setToBlock runs, so the snapshot captured
       * there still points at the original block. Without this, redo restores
       * the caret to the old block instead of the newly created one.
       */
      this.Blok.YjsManager.updateLastCaretAfterPosition();

      /**
       * Show Toolbar
       */
      this.Blok.Toolbar.moveAndOpen(blockToFocus);
    });

    event.preventDefault();
  }

  /**
   * Determines which block to create when Enter is pressed and returns the block to focus.
   * Handles three cases:
   * 1. Caret at start of block → insert empty block above, focus stays on current
   * 2. Caret at end of block → insert empty block below, focus moves to new block
   * 3. Caret in middle → split block, focus moves to new block
   *
   * @param currentBlock - the block where Enter was pressed
   * @returns the block that should receive focus after the operation
   */
  /**
   * If the current block is an empty last child of a toggle, promotes it to a
   * sibling after the toggle (like pressing Enter on an empty last list item).
   * Returns the promoted block, or null if no promotion occurred.
   */
  private promoteLastEmptyToggleChild(currentBlock: Block): Block | null {
    if (!currentBlock.isEmpty || currentBlock.parentId == null || this.isCurrentBlockInsideTableCell) {
      return null;
    }

    const parentBlock = this.Blok.BlockManager.getBlockById(currentBlock.parentId);
    const isLastChild = parentBlock !== undefined &&
      parentBlock.contentIds[parentBlock.contentIds.length - 1] === currentBlock.id;

    if (!isLastChild || parentBlock === undefined) {
      return null;
    }

    const isToggleParent = parentBlock.holder.querySelector('[data-blok-toggle-open]') !== null;

    if (isToggleParent) {
      /**
       * Toggle children should never be promoted out — pressing Enter on an
       * empty last child creates a new sibling inside the toggle instead.
       * The caller (createBlockOnEnter) handles this via the normal Case 2
       * path: insertDefaultBlockAtIndex + setBlockParent to inherit the parent.
       */
      return null;
    }

    /**
     * Columns must never be unwrapped by Enter. A 'column' is a single-child
     * non-toggle container whose own parent is a 'column_list'. Promoting its
     * empty sole child after the parent index would insert a new block at the
     * document root (parentId=null), escaping the column and stranding the
     * holder at the workingArea root. Returning null falls through to the
     * normal Case 2 path, which re-parents the new sibling into the same
     * column and leaves the column_list intact.
     */
    if (parentBlock.name === 'column' || parentBlock.name === 'column_list') {
      return null;
    }

    /**
     * Non-toggle containers (e.g. callout): when the only child is empty,
     * exit by inserting a new block after the container. The container and
     * its child are preserved so the user can return to it.
     */
    if (parentBlock.contentIds.length !== 1) {
      return null;
    }

    const parentIndex = this.Blok.BlockManager.getBlockIndex(parentBlock);

    return this.Blok.BlockManager.insertDefaultBlockAtIndex(parentIndex + 1);
  }

  private createBlockOnEnter(currentBlock: Block): Block {
    /**
     * When the current block is top-level (parentId === null), pass forceTopLevel
     * so the new block's DOM holder is anchored at workingArea root level even if
     * the previous block in the flat array is nested inside a callout/toggle/table.
     * Without this, insertAdjacentElement('afterend', previousBlock.holder) drops
     * the new holder inside the nested container — the Enter-after-callout bug.
     */
    const isCurrentTopLevel = currentBlock.parentId === null;

    /**
     * Empty heading + Enter: convert the heading to a plain paragraph IN PLACE
     * (preserving its position), instead of leaving the empty heading behind. The
     * caret stays in the now-paragraph. Toggle headings are excluded — their
     * open state nests a new child via the Case 2 toggle path below.
     */
    const isToggleHeading = currentBlock.holder.querySelector('[data-blok-toggle-open]') !== null;

    if (currentBlock.isEmpty && currentBlock.name === HEADER_TOOL_NAME && !isToggleHeading) {
      return this.Blok.BlockManager.replace(currentBlock, this.Blok.Tools.defaultTool.name, { text: '' });
    }

    /**
     * Case 1: Caret at start - insert block above.
     *
     * For an EMPTY non-default block (e.g. a heading), inserting above and keeping
     * the caret would trap it in the still-empty heading. Notion instead exits the
     * heading: a new default paragraph is created below and the caret moves into it.
     * So empty non-default blocks skip Case 1 and fall through to Case 2.
     * (An empty default paragraph keeps Case 1 — inserting above with the caret on
     * the now-lower block is equivalent to inserting below and moving down.)
     */
    const isEmptyNonDefaultBlock = currentBlock.isEmpty && !currentBlock.tool.isDefault;

    if (currentBlock.currentInput !== undefined && isCaretAtStartOfInput(currentBlock.currentInput) && !currentBlock.hasMedia && (currentBlock.parentId === null || !currentBlock.isEmpty) && !isEmptyNonDefaultBlock) {
      const newBlock = this.Blok.BlockManager.insertDefaultBlockAtIndex(this.Blok.BlockManager.currentBlockIndex, false, false, isCurrentTopLevel);

      /**
       * When the current block is a child of a toggle, the new block inserted above
       * should also be a child of the same parent.
       */
      if (currentBlock.parentId !== null) {
        this.Blok.BlockManager.setBlockParent(newBlock, currentBlock.parentId);
      }

      return currentBlock;
    }

    // Case 2: Caret at end - insert block below
    if (currentBlock.currentInput && isCaretAtEndOfInput(currentBlock.currentInput)) {
      /**
       * When the current block is an empty last child of a toggle, pressing Enter
       * should exit the toggle — promote the block to be a sibling after the toggle,
       * similar to how pressing Enter on an empty list item exits the list.
       */
      const promotedBlock = this.promoteLastEmptyToggleChild(currentBlock);

      if (promotedBlock !== null) {
        return promotedBlock;
      }

      /**
       * When the current block is an open toggle (heading or list item),
       * the new block should become a child of the toggle rather than a sibling.
       * Detect via the data-blok-toggle-open DOM attribute set by toggle tools.
       *
       * forceTopLevel is safe to pass only when the current block is top-level
       * AND is not an open toggle (which intentionally nests the new block as its child).
       */
      const toggleWrapper = currentBlock.holder.querySelector('[data-blok-toggle-open]');
      const isToggleOpen = toggleWrapper?.getAttribute('data-blok-toggle-open') === 'true';
      const forceTopLevelCase2 = isCurrentTopLevel && !isToggleOpen;

      const newBlock = this.Blok.BlockManager.insertDefaultBlockAtIndex(this.Blok.BlockManager.currentBlockIndex + 1, false, false, forceTopLevelCase2);

      if (isToggleOpen) {
        this.Blok.BlockManager.setBlockParent(newBlock, currentBlock.id);
      } else if (currentBlock.parentId !== null && newBlock.parentId !== currentBlock.parentId) {
        this.Blok.BlockManager.setBlockParent(newBlock, currentBlock.parentId);
      }

      return newBlock;
    }

    // Case 3: Caret in middle - split block
    return this.Blok.BlockManager.split();
  }

  /**
   * Handle backspace keydown on Block
   * @param event - keydown event
   */
  public handleBackspace(event: KeyboardEvent): void {
    const { BlockManager, Caret } = this.Blok;
    const { currentBlock, previousBlock } = BlockManager;

    if (currentBlock === undefined) {
      return;
    }

    /**
     * If some fragment is selected, leave native behaviour
     */
    if (!SelectionUtils.isCollapsed) {
      return;
    }

    /**
     * If caret is not at the start, leave native behaviour
     */
    if (!currentBlock.currentInput || !isCaretAtStartOfInput(currentBlock.currentInput)) {
      return;
    }

    /**
     * All the cases below have custom behaviour, so we don't need a native one
     */
    event.preventDefault();

    this.closeToolbarIfNotInTableCell();

    const isFirstInputFocused = currentBlock.currentInput === currentBlock.firstInput;

    /**
     * For example, caret at the start of the Quote second input (caption) — just navigate previous input
     */
    if (!isFirstInputFocused) {
      Caret.navigatePrevious();

      return;
    }

    /**
     * When the caret is at the start of a toggle child block, keep navigation
     * within the toggle rather than promoting (un-nesting) the block to root level.
     *
     * If there is no previous sibling in the same parent (i.e. this is the first
     * or only child):
     *   - If the block is empty and a next sibling exists in the same parent,
     *     remove it and focus the next sibling (acts like deleting an empty line).
     *   - Otherwise do nothing — the block must stay inside the toggle.
     * If a previous sibling exists in the same parent, fall through to the
     * normal merge/remove logic below so the interaction stays within the toggle.
     *
     * Skip this guard for table cell blocks — they use a separate mechanism.
     */
    const hasNoPreviousSiblingInParent = previousBlock === null ||
      previousBlock.parentId !== currentBlock.parentId;

    if (currentBlock.parentId != null && !this.isCurrentBlockInsideTableCell && hasNoPreviousSiblingInParent) {
      // A column's sole empty child collapses the column itself; otherwise
      // fall back to the toggle-child behaviour (remove + focus next sibling).
      if (!this.removeSoleEmptyColumnChild(currentBlock)) {
        this.removeEmptyToggleChildAndFocusNext(currentBlock);
      }

      return;
    }
    // Previous sibling exists in the same parent — fall through to merge/remove logic

    /**
     * Don't merge across table cell boundaries.
     * When the caret is at the start of the FIRST block in a table cell, Backspace
     * must be a no-op rather than merging the previous cell's last block into the
     * current cell. Merges within the same cell (e.g. the user hit Enter to split a
     * paragraph and now wants to undo it) must still work.
     */
    if (this.isCurrentBlockInsideTableCell && !this.areBlocksInSameTableCell(currentBlock, previousBlock)) {
      return;
    }

    /**
     * Notion-style "reset block type to text first" cascade.
     *
     * Pressing Backspace at the start of a styled single-line text block converts
     * it to a plain paragraph — preserving its text and inline formatting —
     * instead of merging into the previous block or deleting an empty block. A
     * subsequent Backspace then runs the normal merge/remove logic on the
     * now-paragraph block.
     *
     * This central handler covers the styled blocks whose own tools do NOT already
     * reset to text on Backspace: headings and quotes. The list, callout and
     * toggle tools self-convert to a paragraph in their own keydown handlers
     * (which preventDefault), so they never reach here.
     *
     * Toggle headings are excluded: their own element-level keydown handler resets
     * the toggle state first (and preventDefault()s, so this central handler does
     * not run for the empty case). They are detected via the toggle-open marker the
     * header tool renders on its holder.
     */
    const isToggleHeading = currentBlock.holder.querySelector('[data-blok-toggle-open]') !== null;
    const resetsToTextOnBackspace = currentBlock.name === HEADER_TOOL_NAME || currentBlock.name === QUOTE_TOOL_NAME;

    if (resetsToTextOnBackspace && !isToggleHeading) {
      const defaultToolName = this.Blok.Tools.defaultTool.name;
      const text = currentBlock.currentInput.innerHTML;
      const newBlock = BlockManager.replace(currentBlock, defaultToolName, { text });

      Caret.setToBlock(newBlock, Caret.positions.START);

      return;
    }

    /**
     * Backspace at the start of the first Block should do nothing
     */
    if (previousBlock === null) {
      return;
    }

    /**
     * If prev Block is empty, it should be removed just like a character
     */
    if (previousBlock.isEmpty) {
      void BlockManager.removeBlock(previousBlock);

      return;
    }

    /**
     * If current Block is empty, just remove it and set cursor to the previous Block (like we're removing line break char)
     */
    if (currentBlock.isEmpty) {
      void BlockManager.removeBlock(currentBlock);

      const newCurrentBlock = BlockManager.currentBlock;

      newCurrentBlock && Caret.setToBlock(newCurrentBlock, Caret.positions.END);

      return;
    }

    const bothBlocksMergeable = areBlocksMergeable(previousBlock, currentBlock);

    /**
     * If Blocks could be merged, do it
     * Otherwise, just navigate previous block
     */
    if (bothBlocksMergeable) {
      this.mergeBlocks(previousBlock, currentBlock);
    } else {
      Caret.setToBlock(previousBlock, Caret.positions.END);
    }
  }

  /**
   * Handles delete keydown on Block
   * Removes char after the caret.
   * If caret is at the end of the block, merge next block with current
   * @param event - keydown event
   */
  public handleDelete(event: KeyboardEvent): void {
    const { BlockManager, Caret } = this.Blok;
    const { currentBlock, nextBlock } = BlockManager;

    if (currentBlock === undefined) {
      return;
    }

    /**
     * If some fragment is selected, leave native behaviour
     */
    if (!SelectionUtils.isCollapsed) {
      return;
    }

    /**
     * If caret is not at the end, leave native behaviour
     */
    if (!currentBlock.currentInput || !isCaretAtEndOfInput(currentBlock.currentInput)) {
      return;
    }

    /**
     * All the cases below have custom behaviour, so we don't need a native one
     */
    event.preventDefault();

    this.closeToolbarIfNotInTableCell();

    const isLastInputFocused = currentBlock.currentInput === currentBlock.lastInput;

    /**
     * For example, caret at the end of the Quote first input (quote text) — just navigate next input (caption)
     */
    if (!isLastInputFocused) {
      Caret.navigateNext();

      return;
    }

    /**
     * Delete at the end of the last Block should do nothing
     */
    if (nextBlock === null) {
      return;
    }

    /**
     * Don't cross parent block boundaries (e.g., don't operate on blocks outside a toggle).
     * When the next block is in a different parent context, treat it as if there's no next block.
     */
    if (nextBlock.parentId !== currentBlock.parentId) {
      return;
    }

    /**
     * Don't merge across table cell boundaries.
     * When the caret is at the end of the LAST block in a table cell, Delete must
     * be a no-op rather than pulling the next cell's first block into the current
     * cell. Merges within the same cell must still work.
     */
    if (this.isCurrentBlockInsideTableCell && !this.areBlocksInSameTableCell(currentBlock, nextBlock)) {
      return;
    }

    /**
     * If next Block is empty, it should be removed just like a character
     */
    if (nextBlock.isEmpty) {
      void BlockManager.removeBlock(nextBlock);

      return;
    }

    /**
     * If current Block is empty, just remove it and set cursor to the next Block (like we're removing line break char)
     */
    if (currentBlock.isEmpty) {
      /**
       * If the current block is inside a parent (e.g., toggle), keep navigation within that parent.
       * When there is no previous sibling in the same parent, do nothing to prevent the cursor
       * from exiting the toggle after the flat-array index is decremented past the parent block.
       */
      const prevBlock = BlockManager.previousBlock;

      const hasNoPrevSiblingInParent = prevBlock === null || prevBlock.parentId !== currentBlock.parentId;

      if (currentBlock.parentId !== null && hasNoPrevSiblingInParent) {
        // A column's sole empty child collapses the column itself rather than
        // being a no-op like a toggle child.
        const collapsed = this.removeSoleEmptyColumnChild(currentBlock);

        collapsed && this.closeToolbarIfNotInTableCell();

        return;
      }

      void BlockManager.removeBlock(currentBlock);

      /**
       * After removing current block, the next block (if any) should become current.
       * Use Caret to position cursor at the start of the next block.
       * Then close toolbar to prevent it from staying open on the removed block.
       */
      const newCurrentBlock = BlockManager.currentBlock;

      newCurrentBlock && Caret.setToBlock(newCurrentBlock, Caret.positions.START);
      this.closeToolbarIfNotInTableCell();

      return;
    }

    const bothBlocksMergeable = areBlocksMergeable(currentBlock, nextBlock);

    /**
     * If Blocks could be merged, do it
     * Otherwise, just navigate to the next block
     */
    if (bothBlocksMergeable) {
      this.mergeBlocks(currentBlock, nextBlock);
    } else {
      Caret.setToBlock(nextBlock, Caret.positions.START);
    }
  }

  /**
   * Merge passed Blocks
   * @param targetBlock - to which Block we want to merge
   * @param blockToMerge - what Block we want to merge
   */
  private mergeBlocks(targetBlock: Block, blockToMerge: Block): void {
    const { BlockManager } = this.Blok;

    if (targetBlock.lastInput === undefined) {
      return;
    }

    focus(targetBlock.lastInput, false);

    BlockManager
      .mergeBlocks(targetBlock, blockToMerge)
      .then(() => {
        this.closeToolbarIfNotInTableCell();
      })
      .catch(() => {
        // Error handling for mergeBlocks
      });
  }

  /**
   * Handle right and down keyboard keys
   * @param event - keyboard event
   */
  public handleArrowRightAndDown(event: KeyboardEvent): void {
    const keyCode = keyCodeFromEvent(event);

    if (keyCode === null) {
      return;
    }

    /**
     * Skip handling if this is a block movement shortcut (Cmd/Ctrl+Shift+Down)
     * Let the shortcut system handle it instead
     */
    if (isBlockMovementShortcut(event, 'down')) {
      return;
    }

    const isFlipperCombination = Flipper.usedKeys.includes(keyCode) &&
      (!event.shiftKey || keyCode === keyCodes.TAB);

    /**
     * Arrows might be handled on toolbars by flipper
     * Check for Flipper.usedKeys to allow navigate by DOWN and disallow by RIGHT
     */
    if (this.Blok.UI.someToolbarOpened && isFlipperCombination) {
      return;
    }

    /**
     * Close Toolbar when user moves cursor, but keep toolbars open if the user
     * is extending selection with the Shift key so inline interactions remain available.
     * Skip closing when inside a table cell — the toolbar belongs to the parent
     * table block and the hover controller won't re-emit BlockHovered for it.
     */
    if (!event.shiftKey && !this.isCurrentBlockInsideTableCell) {
      this.Blok.InlineToolbar.close();
    }

    const selection = SelectionUtils.get();

    if (selection?.anchorNode && !this.Blok.BlockSelection.anyBlockSelected) {
      this.Blok.BlockManager.setCurrentBlockByChildNode(selection.anchorNode);
    }

    const { currentBlock } = this.Blok.BlockManager;
    const eventTarget = event.target as HTMLElement | null;
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallbackInputCandidates: Array<HTMLElement | undefined | null> = [
      currentBlock?.inputs.find((input) => eventTarget !== null && input.contains(eventTarget)),
      currentBlock?.inputs.find((input) => activeElement !== null && input.contains(activeElement)),
      eventTarget?.closest(EDITABLE_INPUT_SELECTOR) as HTMLElement | null,
      activeElement?.closest(EDITABLE_INPUT_SELECTOR) as HTMLElement | null,
    ];
    const caretInput = currentBlock?.currentInput ?? fallbackInputCandidates.find(
      (candidate): candidate is HTMLElement => candidate instanceof HTMLElement
    );
    const caretAtEnd = caretInput !== undefined ? isCaretAtEndOfInput(caretInput) : undefined;
    const shouldEnableCBS = caretAtEnd || this.Blok.BlockSelection.anyBlockSelected;

    const isShiftDownKey = event.shiftKey && keyCode === keyCodes.DOWN;

    if (isShiftDownKey && shouldEnableCBS) {
      this.Blok.CrossBlockSelection.toggleBlockSelectedState();

      return;
    }

    if (isShiftDownKey) {
      void this.Blok.InlineToolbar.tryToShow();
    }

    const isPlainRightKey = keyCode === keyCodes.RIGHT && !event.shiftKey && !this.isRtl;

    const nbpsTarget = isPlainRightKey && caretInput instanceof HTMLElement
      ? findNbspAfterEmptyInline(caretInput)
      : null;

    if (nbpsTarget !== null) {
      SelectionUtils.setCursor(nbpsTarget.node as unknown as HTMLElement, nbpsTarget.offset);
      event.preventDefault();

      return;
    }

    /**
     * Determine navigation type based on key pressed:
     * - Arrow Down: use vertical navigation (Notion-style line-by-line)
     * - Arrow Right: use horizontal navigation (character-by-character)
     */
    const isDownKey = keyCode === keyCodes.DOWN;
    const isRightKey = keyCode === keyCodes.RIGHT && !this.isRtl;

    const isNavigated = (() => {
      if (isDownKey) {
        /**
         * Arrow Down: Notion-style vertical navigation
         * Only navigate to next block when caret is at the last line.
         * Pass allowBlockCreation=false so arrowing past the last block never
         * spawns a trailing paragraph (only Enter creates blocks, like Notion).
         */
        return this.Blok.Caret.navigateVerticalNext(false);
      }

      if (isRightKey) {
        /**
         * Arrow Right: horizontal navigation
         * Navigate to next block when caret is at the end of input. Block creation
         * is disabled so the caret never spawns a trailing paragraph on Arrow Right.
         */
        return this.Blok.Caret.navigateNext(false, false);
      }

      return false;
    })();

    if (isNavigated) {
      /**
       * Default behaviour moves cursor by 1 character, we need to prevent it
       */
      event.preventDefault();

      /**
       * Reposition the toolbar at the new block, but keep the block-action gutter
       * (plus button + settings toggler) hidden — caret navigation should not pop
       * the handles, matching Notion where they appear on hover only. Positioning
       * still happens so a later hover/click lands at the right place.
       */
      this.Blok.Toolbar.moveAndOpen(this.Blok.BlockManager.currentBlock);
      this.Blok.Toolbar.hideBlockActions();

      return;
    }

    /**
     * After caret is set, update Block input index
     */
    delay(() => {
      /** Check currentBlock for case when user moves selection out of Blok */
      if (this.Blok.BlockManager.currentBlock) {
        this.Blok.BlockManager.currentBlock.updateCurrentInput();
      }

    }, 20)();

    /**
     * Clear blocks selection by arrows
     */
    this.Blok.BlockSelection.clearSelection(event);
  }

  /**
   * Handle left and up keyboard keys
   * @param event - keyboard event
   */
  public handleArrowLeftAndUp(event: KeyboardEvent): void {
    /**
     * Arrows might be handled on toolbars by flipper
     * Check for Flipper.usedKeys to allow navigate by UP and disallow by LEFT
     */
    const toolbarOpened = this.Blok.UI.someToolbarOpened;

    const keyCode = keyCodeFromEvent(event);

    if (keyCode === null) {
      return;
    }

    /**
     * Skip handling if this is a block movement shortcut (Cmd/Ctrl+Shift+Up)
     * Let the shortcut system handle it instead
     */
    if (isBlockMovementShortcut(event, 'up')) {
      return;
    }

    if (toolbarOpened && Flipper.usedKeys.includes(keyCode) && (!event.shiftKey || keyCode === keyCodes.TAB)) {
      return;
    }

    if (toolbarOpened && !this.isCurrentBlockInsideTableCell) {
      this.Blok.UI.closeAllToolbars();
    }

    /**
     * Close Toolbar when user moves cursor, but preserve it for Shift-based selection changes.
     * Skip closing when inside a table cell — the toolbar belongs to the parent
     * table block and the hover controller won't re-emit BlockHovered for it.
     */
    if (!event.shiftKey && !this.isCurrentBlockInsideTableCell) {
      this.Blok.InlineToolbar.close();
    }

    const selection = window.getSelection();

    if (selection?.anchorNode && !this.Blok.BlockSelection.anyBlockSelected) {
      this.Blok.BlockManager.setCurrentBlockByChildNode(selection.anchorNode);
    }

    const { currentBlock } = this.Blok.BlockManager;
    const eventTarget = event.target as HTMLElement | null;
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallbackInputCandidates: Array<HTMLElement | undefined | null> = [
      currentBlock?.inputs.find((input) => eventTarget !== null && input.contains(eventTarget)),
      currentBlock?.inputs.find((input) => activeElement !== null && input.contains(activeElement)),
      eventTarget?.closest(EDITABLE_INPUT_SELECTOR) as HTMLElement | null,
      activeElement?.closest(EDITABLE_INPUT_SELECTOR) as HTMLElement | null,
    ];
    const caretInput = currentBlock?.currentInput ?? fallbackInputCandidates.find(
      (candidate): candidate is HTMLElement => candidate instanceof HTMLElement
    );
    const caretAtStart = caretInput !== undefined ? isCaretAtStartOfInput(caretInput) : undefined;
    const shouldEnableCBS = caretAtStart || this.Blok.BlockSelection.anyBlockSelected;

    const isShiftUpKey = event.shiftKey && keyCode === keyCodes.UP;

    if (isShiftUpKey && shouldEnableCBS) {
      this.Blok.CrossBlockSelection.toggleBlockSelectedState(false);

      return;
    }

    if (isShiftUpKey) {
      void this.Blok.InlineToolbar.tryToShow();
    }

    /**
     * Determine navigation type based on key pressed:
     * - Arrow Up: use vertical navigation (Notion-style line-by-line)
     * - Arrow Left: use horizontal navigation (character-by-character)
     */
    const isUpKey = keyCode === keyCodes.UP;
    const isLeftKey = keyCode === keyCodes.LEFT && !this.isRtl;

    const isNavigated = (() => {
      if (isUpKey) {
        /**
         * Arrow Up: Notion-style vertical navigation
         * Only navigate to previous block when caret is at the first line
         */
        return this.Blok.Caret.navigateVerticalPrevious();
      }

      if (isLeftKey) {
        /**
         * Arrow Left: horizontal navigation
         * Navigate to previous block when caret is at the start of input
         */
        return this.Blok.Caret.navigatePrevious();
      }

      return false;
    })();

    if (isNavigated) {
      /**
       * Default behaviour moves cursor by 1 character, we need to prevent it
       */
      event.preventDefault();

      /**
       * Reposition the toolbar at the new block, but keep the block-action gutter
       * (plus button + settings toggler) hidden — caret navigation should not pop
       * the handles, matching Notion where they appear on hover only. Positioning
       * still happens so a later hover/click lands at the right place.
       */
      this.Blok.Toolbar.moveAndOpen(this.Blok.BlockManager.currentBlock);
      this.Blok.Toolbar.hideBlockActions();

      return;
    }

    /**
     * After caret is set, update Block input index
     */
    delay(() => {
      /** Check currentBlock for case when user ends selection out of Blok and then press arrow-key */
      if (this.Blok.BlockManager.currentBlock) {
        this.Blok.BlockManager.currentBlock.updateCurrentInput();
      }

    }, 20)();

    /**
     * Clear blocks selection by arrows
     */
    this.Blok.BlockSelection.clearSelection(event);
  }

  /**
   * When Backspace is pressed at the start of an empty toggle child block that has no
   * previous sibling in the same parent, remove the block and move the caret to the
   * next sibling (if one exists in the same parent).
   */
  private removeEmptyToggleChildAndFocusNext(block: Block): void {
    if (!block.isEmpty) {
      return;
    }

    const { BlockManager, Caret } = this.Blok;
    const nextBlock = BlockManager.nextBlock;

    if (nextBlock !== null && nextBlock.parentId === block.parentId) {
      void BlockManager.removeBlock(block);
      Caret.setToBlock(nextBlock, Caret.positions.START);
    }
  }

  /**
   * When `block` is the SOLE child of a `column` and is empty, remove it so the
   * now-empty column is dropped: a column is pure layout and must not linger
   * empty. BlockManager.removeBlock cascades — deleting the last child removes
   * the column, which unwraps the column_list if it collapses to one column.
   *
   * Returns true when it handled the removal. A column with OTHER children is
   * left to the generic empty-child path so the column survives, so this only
   * fires for the sole-child case (returns false otherwise — including for
   * non-column parents such as toggles/callouts).
   */
  private removeSoleEmptyColumnChild(block: Block): boolean {
    if (!block.isEmpty || block.parentId === null) {
      return false;
    }

    const parentBlock = this.Blok.BlockManager.getBlockById(block.parentId);

    if (parentBlock === undefined || parentBlock.name !== 'column' || parentBlock.contentIds.length > 1) {
      return false;
    }

    const { BlockManager, Caret } = this.Blok;

    void BlockManager.removeBlock(block);

    const newCurrentBlock = BlockManager.currentBlock;

    if (newCurrentBlock) {
      Caret.setToBlock(newCurrentBlock, Caret.positions.END);
    }

    return true;
  }

}
