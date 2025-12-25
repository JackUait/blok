/**
 * Contains keyboard and mouse events bound on each Block by Block Manager
 */
import { Module } from '../__module';
import { delay, isIosDevice, keyCodes } from '../utils';
import { SelectionUtils } from '../selection';
import { Flipper } from '../flipper';
import type { Block } from '../block';
import { areBlocksMergeable } from '../utils/blocks';
import { findNbspAfterEmptyInline, focus, isCaretAtEndOfInput, isCaretAtStartOfInput } from '../utils/caret';

const KEYBOARD_EVENT_KEY_TO_KEY_CODE_MAP: Record<string, number> = {
  Backspace: keyCodes.BACKSPACE,
  Delete: keyCodes.DELETE,
  Enter: keyCodes.ENTER,
  Tab: keyCodes.TAB,
  ArrowDown: keyCodes.DOWN,
  ArrowRight: keyCodes.RIGHT,
  ArrowUp: keyCodes.UP,
  ArrowLeft: keyCodes.LEFT,
};

const PRINTABLE_SPECIAL_KEYS = new Set(['Enter', 'Process', 'Spacebar', 'Space', 'Dead']);
const EDITABLE_INPUT_SELECTOR = '[contenteditable="true"], textarea, input';

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
 *
 */
export class BlockEvents extends Module {
  /**
   * Tool name for list items
   */
  private static readonly LIST_TOOL_NAME = 'list';

  /**
   * Tool name for headers
   */
  private static readonly HEADER_TOOL_NAME = 'header';

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

      if (!previousBlock || previousBlock.name !== BlockEvents.LIST_TOOL_NAME) {
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
  private handleSelectedBlocksIndent(event: KeyboardEvent): boolean {
    const { BlockSelection } = this.Blok;

    if (!BlockSelection.anyBlockSelected) {
      return false;
    }

    const allListItems = BlockSelection.selectedBlocks.every(
      (block) => block.name === BlockEvents.LIST_TOOL_NAME
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
   * All keydowns on Block
   * @param {KeyboardEvent} event - keydown
   */
  public keydown(event: KeyboardEvent): void {
    /**
     * Handle navigation mode keys first
     */
    if (this.handleNavigationModeKeys(event)) {
      return;
    }

    /**
     * Handle Escape key to enable navigation mode
     */
    if (event.key === 'Escape') {
      this.handleEscapeToEnableNavigation(event);

      return;
    }

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
      case keyCodes.BACKSPACE:
        this.backspace(event);
        break;

      case keyCodes.DELETE:
        this.delete(event);
        break;

      case keyCodes.ENTER:
        this.enter(event);
        break;

      case keyCodes.DOWN:
      case keyCodes.RIGHT:
        this.arrowRightAndDown(event);
        break;

      case keyCodes.UP:
      case keyCodes.LEFT:
        this.arrowLeftAndUp(event);
        break;

      case keyCodes.TAB:
        if (this.handleSelectedBlocksIndent(event)) {
          return;
        }
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
    const { BlockSelection, BlockManager, Caret, BlockSettings } = this.Blok;

    /**
     * Ignore delete/backspace from inside the BlockSettings popover (e.g., search input)
     */
    if (BlockSettings.contains(event.target as HTMLElement)) {
      return false;
    }

    const isRemoveKey = event.key === 'Backspace' || event.key === 'Delete';
    const selectionExists = SelectionUtils.isSelectionExists;
    const selectionCollapsed = SelectionUtils.isCollapsed === true;
    const shouldHandleSelectionDeletion = isRemoveKey &&
      BlockSelection.anyBlockSelected &&
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
   * Handles Escape key press to enable navigation mode.
   * Called when user presses Escape while editing a block.
   * @param event - keyboard event
   */
  private handleEscapeToEnableNavigation(event: KeyboardEvent): void {
    const { BlockSelection, BlockSettings, InlineToolbar, Toolbar } = this.Blok;

    /**
     * If any toolbar is open, let the UI module handle closing it
     */
    if (BlockSettings.opened || InlineToolbar.opened || Toolbar.toolbox.opened) {
      return;
    }

    /**
     * If blocks are selected, let the UI module handle clearing selection
     */
    if (BlockSelection.anyBlockSelected) {
      return;
    }

    /**
     * Enable navigation mode
     */
    event.preventDefault();
    Toolbar.close();
    BlockSelection.enableNavigationMode();
  }

  /**
   * Handles keyboard events when navigation mode is active.
   * In navigation mode:
   * - ArrowUp/ArrowDown: navigate between blocks
   * - Enter: exit navigation mode and focus the block for editing
   * - Escape: exit navigation mode without focusing
   * @param event - keyboard event
   * @returns true if event was handled
   */
  private handleNavigationModeKeys(event: KeyboardEvent): boolean {
    const { BlockSelection } = this.Blok;

    if (!BlockSelection.navigationModeEnabled) {
      return false;
    }

    const key = event.key;

    switch (key) {
      case 'ArrowDown':
        event.preventDefault();
        event.stopPropagation();
        BlockSelection.navigateNext();

        return true;

      case 'ArrowUp':
        event.preventDefault();
        event.stopPropagation();
        BlockSelection.navigatePrevious();

        return true;

      case 'Enter':
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        BlockSelection.disableNavigationMode(true);

        return true;

      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        BlockSelection.disableNavigationMode(false);

        return true;

      default:
        /**
         * Any other key exits navigation mode and allows normal input
         */
        if (this.isPrintableKeyEvent(event)) {
          BlockSelection.disableNavigationMode(true);
        }

        return false;
    }
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

    this.Blok.Toolbar.close();

    /**
     * Allow to use shortcuts with selected blocks
     * @type {boolean}
     */
    const isShortcut = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;

    if (isShortcut) {
      return;
    }

    this.Blok.BlockSelection.clearSelection(event);
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
     * Check if blok is empty on each keyup and add special css class to wrapper
     */
    this.Blok.UI.checkEmptiness();
  }

  /**
   * Regex patterns for detecting list shortcuts.
   * Matches patterns like "1. ", "1) ", "2. ", etc. at the start of text
   * Captures remaining content after the shortcut in group 2
   */
  private static readonly ORDERED_LIST_PATTERN = /^(\d+)[.)]\s([\s\S]*)$/;

  /**
   * Regex pattern for detecting checklist shortcuts.
   * Matches patterns like "[] ", "[ ] ", "[x] ", "[X] " at the start of text
   * Captures remaining content after the shortcut in group 2
   */
  private static readonly CHECKLIST_PATTERN = /^\[(x|X| )?\]\s([\s\S]*)$/;

  /**
   * Regex pattern for detecting bulleted list shortcuts.
   * Matches patterns like "- " or "* " at the start of text
   * Captures remaining content after the shortcut in group 1
   */
  private static readonly UNORDERED_LIST_PATTERN = /^[-*]\s([\s\S]*)$/;

  /**
   * Regex pattern for detecting header shortcuts.
   * Matches patterns like "# ", "## ", "### " etc. at the start of text (1-6 hashes)
   * Captures remaining content after the shortcut in group 2
   */
  private static readonly HEADER_PATTERN = /^(#{1,6})\s([\s\S]*)$/;

  /**
   * Input event handler for Block
   * Detects markdown-like shortcuts for auto-converting to lists or headers
   * @param {InputEvent} event - input event
   */
  public input(event: InputEvent): void {
    /**
     * Only handle insertText events (typing) that end with a space
     */
    if (event.inputType !== 'insertText' || event.data !== ' ') {
      return;
    }

    this.handleListShortcut();
    this.handleHeaderShortcut();
  }

  /**
   * Check if current block content matches a list shortcut pattern
   * and convert to appropriate list type.
   * Supports conversion even when there's existing text after the shortcut.
   * Preserves HTML content and maintains caret position.
   */
  private handleListShortcut(): void {
    const { BlockManager, Tools } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    if (!currentBlock) {
      return;
    }

    /**
     * Only convert default blocks (paragraphs)
     */
    if (!currentBlock.tool.isDefault) {
      return;
    }

    /**
     * Check if list tool is available
     */
    const listTool = Tools.blockTools.get('list');

    if (!listTool) {
      return;
    }

    const currentInput = currentBlock.currentInput;

    if (!currentInput) {
      return;
    }

    /**
     * Use textContent to match the shortcut pattern
     */
    const textContent = currentInput.textContent || '';

    /**
     * Get the depth from the block holder if it was previously a nested list item
     * This preserves nesting when converting back to a list
     */
    const depthAttr = currentBlock.holder.getAttribute('data-blok-depth');
    const depth = depthAttr ? parseInt(depthAttr, 10) : 0;

    /**
     * Check for checklist pattern (e.g., "[] ", "[ ] ", "[x] ", "[X] ")
     */
    const checklistMatch = BlockEvents.CHECKLIST_PATTERN.exec(textContent);

    if (checklistMatch) {
      /**
       * Determine if the checkbox should be checked
       * [x] or [X] means checked, [] or [ ] means unchecked
       */
      const isChecked = checklistMatch[1]?.toLowerCase() === 'x';

      /**
       * Extract remaining content (group 2) and calculate shortcut length
       * Shortcut length: "[" + optional char + "]" + " " = 3 or 4 chars
       */
      const shortcutLength = checklistMatch[1] !== undefined ? 4 : 3;
      const remainingHtml = this.extractRemainingHtml(currentInput, shortcutLength);
      const caretOffset = this.getCaretOffset(currentInput) - shortcutLength;

      const newBlock = BlockManager.replace(currentBlock, 'list', {
        text: remainingHtml,
        style: 'checklist',
        checked: isChecked,
        ...(depth > 0 ? { depth } : {}),
      });

      this.setCaretAfterConversion(newBlock, caretOffset);

      return;
    }

    /**
     * Check for unordered/bulleted list pattern (e.g., "- " or "* ")
     */
    const unorderedMatch = BlockEvents.UNORDERED_LIST_PATTERN.exec(textContent);

    if (unorderedMatch) {
      /**
       * Extract remaining content (group 1) and calculate shortcut length
       * Shortcut length: "-" or "*" + " " = 2 chars
       */
      const shortcutLength = 2;
      const remainingHtml = this.extractRemainingHtml(currentInput, shortcutLength);
      const caretOffset = this.getCaretOffset(currentInput) - shortcutLength;

      const newBlock = BlockManager.replace(currentBlock, 'list', {
        text: remainingHtml,
        style: 'unordered',
        checked: false,
        ...(depth > 0 ? { depth } : {}),
      });

      this.setCaretAfterConversion(newBlock, caretOffset);

      return;
    }

    /**
     * Check for ordered list pattern (e.g., "1. " or "1) ")
     */
    const orderedMatch = BlockEvents.ORDERED_LIST_PATTERN.exec(textContent);

    if (!orderedMatch) {
      return;
    }

    /**
     * Extract the starting number from the pattern
     */
    const startNumber = parseInt(orderedMatch[1], 10);

    /**
     * Extract remaining content (group 2) and calculate shortcut length
     * Shortcut length: number digits + "." or ")" + " " = orderedMatch[1].length + 2
     */
    const shortcutLength = orderedMatch[1].length + 2;
    const remainingHtml = this.extractRemainingHtml(currentInput, shortcutLength);
    const caretOffset = this.getCaretOffset(currentInput) - shortcutLength;

    /**
     * Convert to ordered list with the captured start number
     */
    const listData: { text: string; style: string; checked: boolean; start?: number; depth?: number } = {
      text: remainingHtml,
      style: 'ordered',
      checked: false,
    };

    // Only include start if it's not 1 (the default)
    if (startNumber !== 1) {
      listData.start = startNumber;
    }

    // Preserve depth if the block was previously nested
    if (depth > 0) {
      listData.depth = depth;
    }

    const newBlock = BlockManager.replace(currentBlock, 'list', listData);

    this.setCaretAfterConversion(newBlock, caretOffset);
  }

  /**
   * Check if current block matches a header shortcut pattern and convert it.
   */
  private handleHeaderShortcut(): void {
    const { BlockManager, Tools } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    if (!currentBlock?.tool.isDefault) {
      return;
    }

    const headerTool = Tools.blockTools.get(BlockEvents.HEADER_TOOL_NAME);

    if (!headerTool) {
      return;
    }

    const currentInput = currentBlock.currentInput;

    if (!currentInput) {
      return;
    }

    const textContent = currentInput.textContent || '';
    const { levels, shortcuts } = headerTool.settings as { levels?: number[]; shortcuts?: Record<number, string> };
    const match = shortcuts === undefined
      ? this.matchDefaultHeaderShortcut(textContent)
      : this.matchCustomHeaderShortcut(textContent, shortcuts);

    if (!match || (levels && !levels.includes(match.level))) {
      return;
    }

    const remainingHtml = this.extractRemainingHtml(currentInput, match.shortcutLength);
    const caretOffset = this.getCaretOffset(currentInput) - match.shortcutLength;

    const newBlock = BlockManager.replace(currentBlock, BlockEvents.HEADER_TOOL_NAME, {
      text: remainingHtml,
      level: match.level,
    });

    this.setCaretAfterConversion(newBlock, caretOffset);
  }

  private matchDefaultHeaderShortcut(text: string): { level: number; shortcutLength: number } | null {
    const match = BlockEvents.HEADER_PATTERN.exec(text);

    return match ? { level: match[1].length, shortcutLength: match[1].length + 1 } : null;
  }

  private matchCustomHeaderShortcut(
    text: string,
    shortcuts: Record<number, string>
  ): { level: number; shortcutLength: number } | null {
    // Sort by prefix length descending to match longer prefixes first (e.g., "!!" before "!")
    for (const [levelStr, prefix] of Object.entries(shortcuts).sort((a, b) => b[1].length - a[1].length)) {
      if (text.length <= prefix.length || !text.startsWith(prefix)) {
        continue;
      }

      const charAfterPrefix = text.charCodeAt(prefix.length);

      // 32 = regular space, 160 = non-breaking space (contenteditable uses nbsp)
      if (charAfterPrefix === 32 || charAfterPrefix === 160) {
        return { level: parseInt(levelStr, 10), shortcutLength: prefix.length + 1 };
      }
    }

    return null;
  }

  /**
   * Extract HTML content after a shortcut prefix
   * @param input - the input element
   * @param shortcutLength - length of the shortcut in text characters
   * @returns HTML string with the content after the shortcut
   */
  private extractRemainingHtml(input: HTMLElement, shortcutLength: number): string {
    const innerHTML = input.innerHTML || '';

    /**
     * Create a temporary element to manipulate the HTML
     */
    const temp = document.createElement('div');

    temp.innerHTML = innerHTML;

    /**
     * Walk through text nodes and collect nodes to modify
     */
    const walker = document.createTreeWalker(temp, NodeFilter.SHOW_TEXT, null);
    const nodesToModify = this.collectNodesToModify(walker, shortcutLength);

    /**
     * Apply modifications
     */
    for (const { node, removeCount } of nodesToModify) {
      const text = node.textContent || '';

      if (removeCount >= text.length) {
        node.remove();
      } else {
        node.textContent = text.slice(removeCount);
      }
    }

    return temp.innerHTML;
  }

  /**
   * Collect text nodes that need modification to remove shortcut characters
   * @param walker - TreeWalker for text nodes
   * @param charsToRemove - total characters to remove
   * @returns array of nodes with their removal counts
   */
  private collectNodesToModify(
    walker: TreeWalker,
    charsToRemove: number
  ): Array<{ node: Text; removeCount: number }> {
    const result: Array<{ node: Text; removeCount: number }> = [];

    if (charsToRemove <= 0 || !walker.nextNode()) {
      return result;
    }

    const textNode = walker.currentNode as Text;
    const nodeLength = textNode.textContent?.length || 0;

    if (nodeLength <= charsToRemove) {
      result.push({ node: textNode, removeCount: nodeLength });

      return result.concat(this.collectNodesToModify(walker, charsToRemove - nodeLength));
    }

    result.push({ node: textNode, removeCount: charsToRemove });

    return result;
  }

  /**
   * Get the current caret offset within the input element
   * @param input - the input element
   * @returns offset in text characters from the start
   */
  private getCaretOffset(input: HTMLElement): number {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return 0;
    }

    const range = selection.getRangeAt(0);

    /**
     * Create a range from start of input to current caret position
     */
    const preCaretRange = document.createRange();

    preCaretRange.selectNodeContents(input);
    preCaretRange.setEnd(range.startContainer, range.startOffset);

    /**
     * Get the text length up to the caret
     */
    return preCaretRange.toString().length;
  }

  /**
   * Set caret position in the new block after conversion
   * @param block - the new block
   * @param offset - desired caret offset in text characters
   */
  private setCaretAfterConversion(block: Block, offset: number): void {
    const { Caret } = this.Blok;

    /**
     * If offset is 0 or negative, set to start
     */
    if (offset <= 0) {
      Caret.setToBlock(block, Caret.positions.START);

      return;
    }

    /**
     * Set caret to the specific offset
     */
    Caret.setToBlock(block, Caret.positions.DEFAULT, offset);
  }

  /**
   * Copying selected blocks
   * Before putting to the clipboard we sanitize all blocks and then copy to the clipboard
   * @param {ClipboardEvent} event - clipboard event
   */
  public handleCommandC(event: ClipboardEvent): void {
    const { BlockSelection } = this.Blok;

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

  /**
   * Tab pressed inside a Block.
   * @param {KeyboardEvent} event - keydown
   */
  private tabPressed(event: KeyboardEvent): void {
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
   * '/' + 'command' keydown inside a Block
   */
  private commandSlashPressed(): void {
    if (this.Blok.BlockSelection.selectedBlocks.length > 1) {
      return;
    }

    this.activateBlockSettings();
  }

  /**
   * '/' keydown inside a Block
   * @param event - keydown
   */
  private slashPressed(event: KeyboardEvent): void {
    const wasEventTriggeredInsideBlok = this.Blok.UI.nodes.wrapper.contains(event.target as Node);

    if (!wasEventTriggeredInsideBlok) {
      return;
    }

    const currentBlock = this.Blok.BlockManager.currentBlock;
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
    this.Blok.Caret.insertContentAtCaretPosition('/');

    this.activateToolbox();
  }

  /**
   * ENTER pressed on block
   * @param {KeyboardEvent} event - keydown
   */
  private enter(event: KeyboardEvent): void {
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

    // Force new undo group for block creation
    this.Blok.YjsManager.stopCapturing();

    /**
     * If enter has been pressed at the start of the text, just insert paragraph Block above
     */
    const blockToFocus = (() => {
      if (currentBlock.currentInput !== undefined && isCaretAtStartOfInput(currentBlock.currentInput) && !currentBlock.hasMedia) {
        this.Blok.BlockManager.insertDefaultBlockAtIndex(this.Blok.BlockManager.currentBlockIndex);

        return currentBlock;
      }

      /**
       * If caret is at very end of the block, just append the new block without splitting
       * to prevent unnecessary dom mutation observing
       */
      if (currentBlock.currentInput && isCaretAtEndOfInput(currentBlock.currentInput)) {
        return this.Blok.BlockManager.insertDefaultBlockAtIndex(this.Blok.BlockManager.currentBlockIndex + 1);
      }

      /**
       * Split the Current Block into two blocks
       * Renew local current node after split
       */
      return this.Blok.BlockManager.split();
    })();

    this.Blok.Caret.setToBlock(blockToFocus);

    /**
     * Show Toolbar
     */
    this.Blok.Toolbar.moveAndOpen(blockToFocus);

    event.preventDefault();
  }

  /**
   * Handle backspace keydown on Block
   * @param {KeyboardEvent} event - keydown
   */
  private backspace(event: KeyboardEvent): void {
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
    this.Blok.Toolbar.close();

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
    this.Blok.Toolbar.close();

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
    const { BlockManager, Toolbar } = this.Blok;

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
     */
    if (!event.shiftKey) {
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
    const caretInput = currentBlock?.currentInput ?? fallbackInputCandidates.find((candidate): candidate is HTMLElement => {
      return candidate instanceof HTMLElement;
    });
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
   * @param {KeyboardEvent} event - keyboard event
   */
  private arrowLeftAndUp(event: KeyboardEvent): void {
    /**
     * Arrows might be handled on toolbars by flipper
     * Check for Flipper.usedKeys to allow navigate by UP and disallow by LEFT
     */
    const toolbarOpened = this.Blok.UI.someToolbarOpened;

    const keyCode = this.getKeyCode(event);

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

    if (toolbarOpened) {
      this.Blok.UI.closeAllToolbars();
    }

    /**
     * Close Toolbar when user moves cursor, but preserve it for Shift-based selection changes.
     */
    if (!event.shiftKey) {
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
    const caretInput = currentBlock?.currentInput ?? fallbackInputCandidates.find((candidate): candidate is HTMLElement => {
      return candidate instanceof HTMLElement;
    });
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

  /**
   * Cases when we need to close Toolbar
   * @param {KeyboardEvent} event - keyboard event
   */
  private needToolbarClosing(event: KeyboardEvent): boolean {
    const keyCode = this.getKeyCode(event);
    const isEnter = keyCode === keyCodes.ENTER;
    const isTab = keyCode === keyCodes.TAB;
    const toolboxItemSelected = (isEnter && this.Blok.Toolbar.toolbox.opened);
    const blockSettingsItemSelected = (isEnter && this.Blok.BlockSettings.opened);
    const inlineToolbarItemSelected = (isEnter && this.Blok.InlineToolbar.opened);
    const flippingToolbarItems = isTab;

    /**
     * When Toolbox is open, allow typing for inline slash search filtering.
     * Only close on Enter (to select item) or Tab (to navigate).
     */
    const toolboxOpenForInlineSearch = this.Blok.Toolbar.toolbox.opened && !isEnter && !isTab;

    /**
     * Do not close Toolbar in cases:
     * 1. ShiftKey pressed (or combination with shiftKey)
     * 2. When Toolbar is opened and Tab leafs its Tools
     * 3. When Toolbar's component is opened and some its item selected
     * 4. When Toolbox is open for inline slash search (allow typing to filter)
     */
    return !(event.shiftKey ||
      flippingToolbarItems ||
      toolboxItemSelected ||
      blockSettingsItemSelected ||
      inlineToolbarItemSelected ||
      toolboxOpenForInlineSearch
    );
  }

  /**
   * If Toolbox is not open, then just open it and show plus button
   */
  private activateToolbox(): void {
    if (!this.Blok.Toolbar.opened) {
      this.Blok.Toolbar.moveAndOpen();
    } // else Flipper will leaf through it

    this.Blok.Toolbar.toolbox.open();
  }

  /**
   * Open Toolbar and show BlockSettings before flipping Tools
   */
  private activateBlockSettings(): void {
    if (!this.Blok.Toolbar.opened) {
      this.Blok.Toolbar.moveAndOpen();
    }

    /**
     * If BlockSettings is not open, then open BlockSettings
     * Next Tab press will leaf Settings Buttons
     */
    if (!this.Blok.BlockSettings.opened) {
      /**
       * @todo Debug the case when we set caret to some block, hovering another block
       *       — wrong settings will be opened.
       *       To fix it, we should refactor the Block Settings module — make it a standalone class, like the Toolbox
       */
      void Promise
        .resolve(this.Blok.BlockSettings.open())
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
