import type { Block } from '../../../block';
import { Flipper } from '../../../flipper';
import { SelectionUtils } from '../../../selection';
import { keyCodes, delay, isIosDevice } from '../../../utils';
import { areBlocksMergeable } from '../../../utils/blocks';
import { findNbspAfterEmptyInline, focus, isCaretAtEndOfInput, isCaretAtStartOfInput } from '../../../utils/caret/index';
import { EDITABLE_INPUT_SELECTOR } from '../constants';
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
   * Close toolbar only if the current block is NOT inside a table cell.
   * Extracted to avoid nested-if lint violations and provide a single
   * point for the table-cell guard logic.
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
    const { InlineToolbar, Caret } = this.Blok;

    const isFlipperActivated = InlineToolbar.opened;

    if (isFlipperActivated) {
      return;
    }

    const isNavigated = event.shiftKey ? Caret.navigatePrevious(true) : Caret.navigateNext(true);

    /**
     * If we have next Block/input to focus, then focus it. Otherwise, leave native Tab behaviour
     */
    if (isNavigated) {
      event.preventDefault();
    }
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

    // Force new undo group so block creation is separate from previous typing
    this.Blok.YjsManager.stopCapturing();

    const blockToFocus = this.createBlockOnEnter(currentBlock);

    this.Blok.Caret.setToBlock(blockToFocus);

    /**
     * Show Toolbar
     */
    this.Blok.Toolbar.moveAndOpen(blockToFocus);

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
  private createBlockOnEnter(currentBlock: Block): Block {
    // Case 1: Caret at start - insert block above
    if (currentBlock.currentInput !== undefined && isCaretAtStartOfInput(currentBlock.currentInput) && !currentBlock.hasMedia && (currentBlock.parentId === null || !currentBlock.isEmpty)) {
      this.Blok.BlockManager.insertDefaultBlockAtIndex(this.Blok.BlockManager.currentBlockIndex);

      // Force new undo group so typing in the new block is separate from block creation
      this.Blok.YjsManager.stopCapturing();

      return currentBlock;
    }

    // Case 2: Caret at end - insert block below
    if (currentBlock.currentInput && isCaretAtEndOfInput(currentBlock.currentInput)) {
      const newBlock = this.Blok.BlockManager.insertDefaultBlockAtIndex(this.Blok.BlockManager.currentBlockIndex + 1);

      // Force new undo group so typing in the new block is separate from block creation
      this.Blok.YjsManager.stopCapturing();

      return newBlock;
    }

    // Case 3: Caret in middle - split block
    // Note: split() uses transact() internally, so it's already atomic - no stopCapturing needed
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
      this.Blok.Toolbar.close();
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
         * Only navigate to next block when caret is at the last line
         */
        return this.Blok.Caret.navigateVerticalNext();
      }

      if (isRightKey) {
        /**
         * Arrow Right: horizontal navigation
         * Navigate to next block when caret is at the end of input
         */
        return this.Blok.Caret.navigateNext();
      }

      return false;
    })();

    if (isNavigated) {
      /**
       * Default behaviour moves cursor by 1 character, we need to prevent it
       */
      event.preventDefault();

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
      this.Blok.Toolbar.close();
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

}
