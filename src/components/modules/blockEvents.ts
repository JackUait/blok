/**
 * Contains keyboard and mouse events bound on each Block by Block Manager
 */
import Module from '../__module';
import * as _ from '../utils';
import SelectionUtils from '../selection';
import Flipper from '../flipper';
import type Block from '../block';
import { areBlocksMergeable } from '../utils/blocks';
import * as caretUtils from '../utils/caret';
import { focus } from '@editorjs/caret';

const KEYBOARD_EVENT_KEY_TO_KEY_CODE_MAP: Record<string, number> = {
  Backspace: _.keyCodes.BACKSPACE,
  Delete: _.keyCodes.DELETE,
  Enter: _.keyCodes.ENTER,
  Tab: _.keyCodes.TAB,
  ArrowDown: _.keyCodes.DOWN,
  ArrowRight: _.keyCodes.RIGHT,
  ArrowUp: _.keyCodes.UP,
  ArrowLeft: _.keyCodes.LEFT,
};

const PRINTABLE_SPECIAL_KEYS = new Set(['Enter', 'Process', 'Spacebar', 'Space', 'Dead']);
const EDITABLE_INPUT_SELECTOR = '[contenteditable="true"], textarea, input';

/**
 *
 */
export default class BlockEvents extends Module {
  /**
   * All keydowns on Block
   * @param {KeyboardEvent} event - keydown
   */
  public keydown(event: KeyboardEvent): void {
    /**
     * Run common method for all keydown events
     */
    this.beforeKeydownProcessing(event);

    if (this.handleSelectedBlocksDeletion(event)) {
      return;
    }

    /**
     * If event was already handled by something (e.g. tool), we should not handle it
     */
    if (event.defaultPrevented) {
      return;
    }

    const keyCode = this.getKeyCode(event);

    /**
     * Fire keydown processor by normalized keyboard code
     */
    switch (keyCode) {
      case _.keyCodes.BACKSPACE:
        this.backspace(event);
        break;

      case _.keyCodes.DELETE:
        this.delete(event);
        break;

      case _.keyCodes.ENTER:
        this.enter(event);
        break;

      case _.keyCodes.DOWN:
      case _.keyCodes.RIGHT:
        this.arrowRightAndDown(event);
        break;

      case _.keyCodes.UP:
      case _.keyCodes.LEFT:
        this.arrowLeftAndUp(event);
        break;

      case _.keyCodes.TAB:
        this.tabPressed(event);
        break;
    }

    /**
     * We check for "key" here since on different keyboard layouts "/" can be typed as "Shift + 7" etc
     * @todo probably using "beforeInput" event would be better here
     */
    if (event.key === '/' && !event.ctrlKey && !event.metaKey) {
      this.slashPressed(event);
    }

    /**
     * If user pressed "Ctrl + /" or "Cmd + /" — open Block Settings
     * We check for "code" here since on different keyboard layouts there can be different keys in place of Slash.
     */
    if (event.code === 'Slash' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.commandSlashPressed();
    }
  }

  /**
   * Tries to delete selected blocks when remove keys pressed.
   * @param event - keyboard event
   * @returns true if event was handled
   */
  private handleSelectedBlocksDeletion(event: KeyboardEvent): boolean {
    const { BlockSelection, BlockManager, Caret } = this.Editor;
    const isRemoveKey = event.key === 'Backspace' || event.key === 'Delete';
    const selectionExists = SelectionUtils.isSelectionExists;
    const selectionCollapsed = SelectionUtils.isCollapsed === true;
    const shouldHandleSelectionDeletion = isRemoveKey &&
      BlockSelection.anyBlockSelected &&
      (!selectionExists || selectionCollapsed);

    if (!shouldHandleSelectionDeletion) {
      return false;
    }

    const selectionPositionIndex = BlockManager.removeSelectedBlocks();

    if (selectionPositionIndex !== undefined) {
      const insertedBlock = BlockManager.insertDefaultBlockAtIndex(selectionPositionIndex, true);

      Caret.setToBlock(insertedBlock, Caret.positions.START);
    }

    BlockSelection.clearSelection(event);

    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();

    return true;
  }

  /**
   * Fires on keydown before event processing
   * @param {KeyboardEvent} event - keydown
   */
  public beforeKeydownProcessing(event: KeyboardEvent): void {
    /**
     * Do not close Toolbox on Tabs or on Enter with opened Toolbox
     */
    if (!this.needToolbarClosing(event)) {
      return;
    }

    /**
     * When user type something:
     *  - close Toolbar
     *  - clear block highlighting
     */
    if (!this.isPrintableKeyEvent(event)) {
      return;
    }

    this.Editor.Toolbar.close();

    /**
     * Allow to use shortcuts with selected blocks
     * @type {boolean}
     */
    const isShortcut = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;

    if (isShortcut) {
      return;
    }

    this.Editor.BlockSelection.clearSelection(event);
  }

  /**
   * Key up on Block:
   * - shows Inline Toolbar if something selected
   * - shows conversion toolbar with 85% of block selection
   * @param {KeyboardEvent} event - keyup event
   */
  public keyup(event: KeyboardEvent): void {
    /**
     * If shift key was pressed some special shortcut is used (eg. cross block selection via shift + arrows)
     */
    if (event.shiftKey) {
      return;
    }

    /**
     * Check if editor is empty on each keyup and add special css class to wrapper
     */
    this.Editor.UI.checkEmptiness();
  }


  /**
   * Copying selected blocks
   * Before putting to the clipboard we sanitize all blocks and then copy to the clipboard
   * @param {ClipboardEvent} event - clipboard event
   */
  public handleCommandC(event: ClipboardEvent): void {
    const { BlockSelection } = this.Editor;

    if (!BlockSelection.anyBlockSelected) {
      return;
    }

    // Copy Selected Blocks
    void BlockSelection.copySelectedBlocks(event);
  }

  /**
   * Copy and Delete selected Blocks
   * @param {ClipboardEvent} event - clipboard event
   */
  public handleCommandX(event: ClipboardEvent): void {
    const { BlockSelection, BlockManager, Caret } = this.Editor;

    if (!BlockSelection.anyBlockSelected) {
      return;
    }

    BlockSelection.copySelectedBlocks(event).then(() => {
      const selectionPositionIndex = BlockManager.removeSelectedBlocks();

      /**
       * Insert default block in place of removed ones
       */
      if (selectionPositionIndex !== undefined) {
        const insertedBlock = BlockManager.insertDefaultBlockAtIndex(selectionPositionIndex, true);

        Caret.setToBlock(insertedBlock, Caret.positions.START);
      }

      /** Clear selection */
      BlockSelection.clearSelection(event);
    })
      .catch(() => {
        // Handle copy operation failure silently
      });
  }

  /**
   * Tab pressed inside a Block.
   * @param {KeyboardEvent} event - keydown
   */
  private tabPressed(event: KeyboardEvent): void {
    const { InlineToolbar, Caret } = this.Editor;

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
   * '/' + 'command' keydown inside a Block
   */
  private commandSlashPressed(): void {
    if (this.Editor.BlockSelection.selectedBlocks.length > 1) {
      return;
    }

    this.activateBlockSettings();
  }

  /**
   * '/' keydown inside a Block
   * @param event - keydown
   */
  private slashPressed(event: KeyboardEvent): void {
    const wasEventTriggeredInsideEditor = this.Editor.UI.nodes.wrapper.contains(event.target as Node);

    if (!wasEventTriggeredInsideEditor) {
      return;
    }

    const currentBlock = this.Editor.BlockManager.currentBlock;
    const canOpenToolbox = currentBlock?.isEmpty;

    /**
     * @todo Handle case when slash pressed when several blocks are selected
     */

    /**
     * Toolbox will be opened only if Block is empty
     */
    if (!canOpenToolbox) {
      return;
    }

    /**
     * The Toolbox will be opened with immediate focus on the Search input,
     * and '/' will be added in the search input by default — we need to prevent it and add '/' manually
     */
    event.preventDefault();
    this.Editor.Caret.insertContentAtCaretPosition('/');

    this.activateToolbox();
  }

  /**
   * ENTER pressed on block
   * @param {KeyboardEvent} event - keydown
   */
  private enter(event: KeyboardEvent): void {
    const { BlockManager, UI } = this.Editor;
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
    if (event.shiftKey && !_.isIosDevice) {
      return;
    }

    /**
     * If enter has been pressed at the start of the text, just insert paragraph Block above
     */
    const blockToFocus = (() => {
      if (currentBlock.currentInput !== undefined && caretUtils.isCaretAtStartOfInput(currentBlock.currentInput) && !currentBlock.hasMedia) {
        this.Editor.BlockManager.insertDefaultBlockAtIndex(this.Editor.BlockManager.currentBlockIndex);

        return currentBlock;
      }

      /**
       * If caret is at very end of the block, just append the new block without splitting
       * to prevent unnecessary dom mutation observing
       */
      if (currentBlock.currentInput && caretUtils.isCaretAtEndOfInput(currentBlock.currentInput)) {
        return this.Editor.BlockManager.insertDefaultBlockAtIndex(this.Editor.BlockManager.currentBlockIndex + 1);
      }

      /**
       * Split the Current Block into two blocks
       * Renew local current node after split
       */
      return this.Editor.BlockManager.split();
    })();

    this.Editor.Caret.setToBlock(blockToFocus);

    /**
     * Show Toolbar
     */
    this.Editor.Toolbar.moveAndOpen(blockToFocus);

    event.preventDefault();
  }

  /**
   * Handle backspace keydown on Block
   * @param {KeyboardEvent} event - keydown
   */
  private backspace(event: KeyboardEvent): void {
    const { BlockManager, Caret } = this.Editor;
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
    if (!currentBlock.currentInput || !caretUtils.isCaretAtStartOfInput(currentBlock.currentInput)) {
      return;
    }

    /**
     * All the cases below have custom behaviour, so we don't need a native one
     */
    event.preventDefault();
    this.Editor.Toolbar.close();

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
   * @param {KeyboardEvent} event - keydown
   */
  private delete(event: KeyboardEvent): void {
    const { BlockManager, Caret } = this.Editor;
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
    if (!currentBlock.currentInput || !caretUtils.isCaretAtEndOfInput(currentBlock.currentInput)) {
      return;
    }

    /**
     * All the cases below have custom behaviour, so we don't need a native one
     */
    event.preventDefault();
    this.Editor.Toolbar.close();

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

      Caret.setToBlock(nextBlock, Caret.positions.START);

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
    const { BlockManager, Toolbar } = this.Editor;

    if (targetBlock.lastInput === undefined) {
      return;
    }

    focus(targetBlock.lastInput, false);

    BlockManager
      .mergeBlocks(targetBlock, blockToMerge)
      .then(() => {
        Toolbar.close();
      })
      .catch(() => {
        // Error handling for mergeBlocks
      });
  }

  /**
   * Handle right and down keyboard keys
   * @param {KeyboardEvent} event - keyboard event
   */
  private arrowRightAndDown(event: KeyboardEvent): void {
    const keyCode = this.getKeyCode(event);

    if (keyCode === null) {
      return;
    }

    const isFlipperCombination = Flipper.usedKeys.includes(keyCode) &&
      (!event.shiftKey || keyCode === _.keyCodes.TAB);

    /**
     * Arrows might be handled on toolbars by flipper
     * Check for Flipper.usedKeys to allow navigate by DOWN and disallow by RIGHT
     */
    if (this.Editor.UI.someToolbarOpened && isFlipperCombination) {
      return;
    }

    /**
     * Close Toolbar when user moves cursor, but keep toolbars open if the user
     * is extending selection with the Shift key so inline interactions remain available.
     */
    if (!event.shiftKey) {
      this.Editor.Toolbar.close();
    }

    const selection = SelectionUtils.get();

    if (selection?.anchorNode && !this.Editor.BlockSelection.anyBlockSelected) {
      this.Editor.BlockManager.setCurrentBlockByChildNode(selection.anchorNode);
    }

    const { currentBlock } = this.Editor.BlockManager;
    const eventTarget = event.target as HTMLElement | null;
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallbackInputCandidates: Array<HTMLElement | undefined | null> = [
      currentBlock?.inputs.find((input) => eventTarget !== null && input.contains(eventTarget)),
      currentBlock?.inputs.find((input) => activeElement !== null && input.contains(activeElement)),
      eventTarget?.closest(EDITABLE_INPUT_SELECTOR) as HTMLElement | null,
      activeElement?.closest(EDITABLE_INPUT_SELECTOR) as HTMLElement | null,
    ];
    const caretInput = currentBlock?.currentInput ?? fallbackInputCandidates.find((candidate): candidate is HTMLElement => {
      return candidate instanceof HTMLElement;
    });
    const caretAtEnd = caretInput !== undefined ? caretUtils.isCaretAtEndOfInput(caretInput) : undefined;
    const shouldEnableCBS = caretAtEnd || this.Editor.BlockSelection.anyBlockSelected;

    const isShiftDownKey = event.shiftKey && keyCode === _.keyCodes.DOWN;

    if (isShiftDownKey && shouldEnableCBS) {
      this.Editor.CrossBlockSelection.toggleBlockSelectedState();

      return;
    }

    if (isShiftDownKey) {
      void this.Editor.InlineToolbar.tryToShow();
    }

    const isPlainRightKey = keyCode === _.keyCodes.RIGHT && !event.shiftKey && !this.isRtl;

    const nbpsTarget = isPlainRightKey && caretInput instanceof HTMLElement
      ? caretUtils.findNbspAfterEmptyInline(caretInput)
      : null;

    if (nbpsTarget !== null) {
      SelectionUtils.setCursor(nbpsTarget.node as unknown as HTMLElement, nbpsTarget.offset);
      event.preventDefault();

      return;
    }

    const navigateNext = keyCode === _.keyCodes.DOWN || (keyCode === _.keyCodes.RIGHT && !this.isRtl);

    const isNavigated = navigateNext ? this.Editor.Caret.navigateNext() : this.Editor.Caret.navigatePrevious();

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
    _.delay(() => {
      /** Check currentBlock for case when user moves selection out of Editor */
      if (this.Editor.BlockManager.currentBlock) {
        this.Editor.BlockManager.currentBlock.updateCurrentInput();
      }
       
    }, 20)();

    /**
     * Clear blocks selection by arrows
     */
    this.Editor.BlockSelection.clearSelection(event);
  }

  /**
   * Handle left and up keyboard keys
   * @param {KeyboardEvent} event - keyboard event
   */
  private arrowLeftAndUp(event: KeyboardEvent): void {
    /**
     * Arrows might be handled on toolbars by flipper
     * Check for Flipper.usedKeys to allow navigate by UP and disallow by LEFT
     */
    const toolbarOpened = this.Editor.UI.someToolbarOpened;

    const keyCode = this.getKeyCode(event);

    if (keyCode === null) {
      return;
    }

    if (toolbarOpened && Flipper.usedKeys.includes(keyCode) && (!event.shiftKey || keyCode === _.keyCodes.TAB)) {
      return;
    }

    if (toolbarOpened) {
      this.Editor.UI.closeAllToolbars();
    }

    /**
     * Close Toolbar when user moves cursor, but preserve it for Shift-based selection changes.
     */
    if (!event.shiftKey) {
      this.Editor.Toolbar.close();
    }

    const selection = window.getSelection();

    if (selection?.anchorNode && !this.Editor.BlockSelection.anyBlockSelected) {
      this.Editor.BlockManager.setCurrentBlockByChildNode(selection.anchorNode);
    }

    const { currentBlock } = this.Editor.BlockManager;
    const eventTarget = event.target as HTMLElement | null;
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallbackInputCandidates: Array<HTMLElement | undefined | null> = [
      currentBlock?.inputs.find((input) => eventTarget !== null && input.contains(eventTarget)),
      currentBlock?.inputs.find((input) => activeElement !== null && input.contains(activeElement)),
      eventTarget?.closest(EDITABLE_INPUT_SELECTOR) as HTMLElement | null,
      activeElement?.closest(EDITABLE_INPUT_SELECTOR) as HTMLElement | null,
    ];
    const caretInput = currentBlock?.currentInput ?? fallbackInputCandidates.find((candidate): candidate is HTMLElement => {
      return candidate instanceof HTMLElement;
    });
    const caretAtStart = caretInput !== undefined ? caretUtils.isCaretAtStartOfInput(caretInput) : undefined;
    const shouldEnableCBS = caretAtStart || this.Editor.BlockSelection.anyBlockSelected;

    const isShiftUpKey = event.shiftKey && keyCode === _.keyCodes.UP;

    if (isShiftUpKey && shouldEnableCBS) {
      this.Editor.CrossBlockSelection.toggleBlockSelectedState(false);

      return;
    }

    if (isShiftUpKey) {
      void this.Editor.InlineToolbar.tryToShow();
    }

    const navigatePrevious = keyCode === _.keyCodes.UP || (keyCode === _.keyCodes.LEFT && !this.isRtl);
    const isNavigated = navigatePrevious ? this.Editor.Caret.navigatePrevious() : this.Editor.Caret.navigateNext();

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
    _.delay(() => {
      /** Check currentBlock for case when user ends selection out of Editor and then press arrow-key */
      if (this.Editor.BlockManager.currentBlock) {
        this.Editor.BlockManager.currentBlock.updateCurrentInput();
      }
       
    }, 20)();

    /**
     * Clear blocks selection by arrows
     */
    this.Editor.BlockSelection.clearSelection(event);
  }

  /**
   * Cases when we need to close Toolbar
   * @param {KeyboardEvent} event - keyboard event
   */
  private needToolbarClosing(event: KeyboardEvent): boolean {
    const keyCode = this.getKeyCode(event);
    const isEnter = keyCode === _.keyCodes.ENTER;
    const isTab = keyCode === _.keyCodes.TAB;
    const toolboxItemSelected = (isEnter && this.Editor.Toolbar.toolbox.opened);
    const blockSettingsItemSelected = (isEnter && this.Editor.BlockSettings.opened);
    const inlineToolbarItemSelected = (isEnter && this.Editor.InlineToolbar.opened);
    const flippingToolbarItems = isTab;

    /**
     * Do not close Toolbar in cases:
     * 1. ShiftKey pressed (or combination with shiftKey)
     * 2. When Toolbar is opened and Tab leafs its Tools
     * 3. When Toolbar's component is opened and some its item selected
     */
    return !(event.shiftKey ||
      flippingToolbarItems ||
      toolboxItemSelected ||
      blockSettingsItemSelected ||
      inlineToolbarItemSelected
    );
  }

  /**
   * If Toolbox is not open, then just open it and show plus button
   */
  private activateToolbox(): void {
    if (!this.Editor.Toolbar.opened) {
      this.Editor.Toolbar.moveAndOpen();
    } // else Flipper will leaf through it

    this.Editor.Toolbar.toolbox.open();
  }

  /**
   * Open Toolbar and show BlockSettings before flipping Tools
   */
  private activateBlockSettings(): void {
    if (!this.Editor.Toolbar.opened) {
      this.Editor.Toolbar.moveAndOpen();
    }

    /**
     * If BlockSettings is not open, then open BlockSettings
     * Next Tab press will leaf Settings Buttons
     */
    if (!this.Editor.BlockSettings.opened) {
      /**
       * @todo Debug the case when we set caret to some block, hovering another block
       *       — wrong settings will be opened.
       *       To fix it, we should refactor the Block Settings module — make it a standalone class, like the Toolbox
       */
      void Promise
        .resolve(this.Editor.BlockSettings.open())
        .catch(() => {
          // Error handling for BlockSettings.open
        });
    }
  }

  /**
   * Convert KeyboardEvent.key or code to the legacy numeric keyCode
   * @param event - keyboard event
   */
  private getKeyCode(event: KeyboardEvent): number | null {
    const keyFromEvent = event.key && KEYBOARD_EVENT_KEY_TO_KEY_CODE_MAP[event.key];

    if (keyFromEvent !== undefined && typeof keyFromEvent === 'number') {
      return keyFromEvent;
    }

    const codeFromEvent = event.code && KEYBOARD_EVENT_KEY_TO_KEY_CODE_MAP[event.code];

    if (codeFromEvent !== undefined && typeof codeFromEvent === 'number') {
      return codeFromEvent;
    }

    return null;
  }

  /**
   * Detect whether KeyDown should be treated as printable input
   * @param event - keyboard event
   */
  private isPrintableKeyEvent(event: KeyboardEvent): boolean {
    if (!event.key) {
      return false;
    }

    return event.key.length === 1 || PRINTABLE_SPECIAL_KEYS.has(event.key);
  }
}
