/**
 * Contains keyboard and mouse events bound on each Block by Block Manager
 */
import { Module } from '../../__module';
import { keyCodes } from '../../utils';
import { YjsManager } from '../yjs';

import { BlockSelectionKeys } from './composers/blockSelectionKeys';
import { KeyboardNavigation } from './composers/keyboardNavigation';
import { MarkdownShortcuts } from './composers/markdownShortcuts';
import { NavigationMode } from './composers/navigationMode';
import { isPrintableKeyEvent, keyCodeFromEvent } from './utils/keyboard';

/**
 * All keydowns on Block
 * @param {KeyboardEvent} event - keydown
 */
export class BlockEvents extends Module {
  /**
   * Lazy-loaded composer instances
   */
  private _navigationMode?: NavigationMode;
  private _markdownShortcuts?: MarkdownShortcuts;
  private _blockSelectionKeys?: BlockSelectionKeys;
  private _keyboardNavigation?: KeyboardNavigation;

  /**
   * Get the NavigationMode composer instance
   */
  private get navigationMode(): NavigationMode {
    if (!this._navigationMode) {
      this._navigationMode = new NavigationMode(this.Blok);
    }
    return this._navigationMode;
  }

  /**
   * Get the MarkdownShortcuts composer instance
   */
  private get markdownShortcuts(): MarkdownShortcuts {
    if (!this._markdownShortcuts) {
      this._markdownShortcuts = new MarkdownShortcuts(this.Blok);
    }
    return this._markdownShortcuts;
  }

  /**
   * Get the BlockSelectionKeys composer instance
   */
  private get blockSelectionKeys(): BlockSelectionKeys {
    if (!this._blockSelectionKeys) {
      this._blockSelectionKeys = new BlockSelectionKeys(this.Blok);
    }
    return this._blockSelectionKeys;
  }

  /**
   * Get the KeyboardNavigation composer instance
   */
  private get keyboardNavigation(): KeyboardNavigation {
    if (!this._keyboardNavigation) {
      this._keyboardNavigation = new KeyboardNavigation(this.Blok);
    }
    return this._keyboardNavigation;
  }

  /**
   * All keydowns on Block
   * @param {KeyboardEvent} event - keydown
   */
  public keydown(event: KeyboardEvent): void {
    /**
     * Handle navigation mode keys first
     */
    if (this.navigationMode.handleKey(event)) {
      return;
    }

    /**
     * Handle Escape key to enable navigation mode
     */
    if (this.navigationMode.handleEscape(event)) {
      return;
    }

    /**
     * Run common method for all keydown events
     */
    this.beforeKeydownProcessing(event);

    if (this.blockSelectionKeys.handleDeletion(event)) {
      return;
    }

    /**
     * If event was already handled by something (e.g. tool), we should not handle it
     */
    if (event.defaultPrevented) {
      return;
    }

    const keyCode = keyCodeFromEvent(event);

    /**
     * Fire keydown processor by normalized keyboard code
     */
    switch (keyCode) {
      case keyCodes.BACKSPACE:
        this.keyboardNavigation.handleBackspace(event);
        break;

      case keyCodes.DELETE:
        this.keyboardNavigation.handleDelete(event);
        break;

      case keyCodes.ENTER:
        /**
         * Cmd/Ctrl+Enter toggles the checkbox of every selected to-do item
         * (Notion parity). The handler self-guards on the modifier and on the
         * presence of a block selection, so a plain Enter falls through to split.
         */
        if (this.blockSelectionKeys.handleToggleCheckbox(event)) {
          return;
        }
        this.keyboardNavigation.handleEnter(event);
        break;

      case keyCodes.DOWN:
      case keyCodes.RIGHT:
        this.keyboardNavigation.handleArrowRightAndDown(event);
        break;

      case keyCodes.UP:
      case keyCodes.LEFT:
        this.keyboardNavigation.handleArrowLeftAndUp(event);
        break;

      case keyCodes.TAB:
        if (this.blockSelectionKeys.handleIndent(event)) {
          return;
        }
        this.keyboardNavigation.handleTab(event);
        break;

      case null:
        break; // Unknown key code, skip handling
    }

    /**
     * Home/End move the caret horizontally to the line start/end via the
     * browser's native handling. Like ArrowLeft/Right, a horizontal move must
     * reset the sticky vertical goal column so the next ArrowUp/Down aims at the
     * caret's new X instead of a stale column captured by an earlier move.
     */
    if (event.key === 'Home' || event.key === 'End') {
      this.Blok.Caret.resetGoalColumn();
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
   * Input event handler for Block
   * Detects markdown-like shortcuts for auto-converting to lists or headers
   * @param {InputEvent} event - input event
   */
  public input(event: InputEvent): void {
    /**
     * Ensure currentBlock is set from the input target.
     * The debounced selectionchange handler may not have fired yet,
     * leaving currentBlock undefined for blocks inside table cells.
     */
    if (event.target instanceof Node) {
      this.Blok.BlockManager.setCurrentBlockByChildNode(event.target);
    }

    /**
     * Typing starts a fresh vertical-navigation column: the next ArrowUp/Down
     * should aim at the caret's new X, not a stale goal column from earlier.
     */
    this.Blok.Caret.resetGoalColumn();

    // Handle smart grouping for undo
    this.handleSmartGrouping(event);

    // Handle markdown shortcuts
    this.markdownShortcuts.handleInput(event);
  }

  /**
   * Copying selected blocks
   * Before putting to the clipboard we sanitize all blocks and then copy to the clipboard
   * @param {ClipboardEvent} event - clipboard event
   */
  public handleCommandC(event: ClipboardEvent): void {
    this.blockSelectionKeys.handleCopy(event);
  }

  /**
   * Copy and Delete selected Blocks
   * @param {ClipboardEvent} event - clipboard event
   */
  public handleCommandX(event: ClipboardEvent): void {
    this.blockSelectionKeys.handleCut(event);
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
     * When user types something, clear block highlighting.
     * The toolbar stays visible — it should persist during typing.
     */
    if (!isPrintableKeyEvent(event)) {
      return;
    }

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
   * Handle smart grouping logic for undo based on boundary characters.
   * Boundary characters (space, punctuation) followed by a pause create undo checkpoints.
   * @param event - input event
   */
  private handleSmartGrouping(event: InputEvent): void {
    const { YjsManager: yjsManager } = this.Blok;

    // Only handle text input
    if (event.inputType !== 'insertText' || event.data === null) {
      return;
    }

    const char = event.data;

    // Check if previous boundary has timed out (user resumed typing after pause)
    yjsManager.checkAndHandleBoundary();

    // Access static method via constructor
    if (YjsManager.isBoundaryCharacter(char)) {
      // Mark boundary - will create checkpoint if followed by pause
      yjsManager.markBoundary();

      return;
    }

    if (yjsManager.hasPendingBoundary()) {
      // Non-boundary character typed quickly after boundary - clear pending state
      yjsManager.clearBoundary();
    }
  }

  /**
   * '/' + 'command' keydown inside a Block
   */
  private commandSlashPressed(): void {
    if (this.Blok.BlockSelection.selectedBlocks.length > 1) {
      this.activateBlockSettingsForMultipleBlocks();

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

    /**
     * Eagerly update currentBlock from the event target.
     * The debounced selectionchange handler (180ms) may not have fired yet
     * if '/' was typed quickly after clicking into a different block (e.g. a table cell).
     * Without this, currentBlockIndex is stale and the toolbox checks
     * the wrong block for table-cell containment, failing to hide restricted tools.
     */
    if (event.target instanceof Node) {
      this.Blok.BlockManager.setCurrentBlockByChildNode(event.target);
    }

    /**
     * Notion parity: "/" only opens the command menu in text-like blocks. In
     * blocks such as Code (or Table) "/" is a literal character — the menu must
     * not open. Bail out (without preventing default) so the slash is typed
     * normally. Generalizes to ALL non-text blocks via the tool's own settings.
     */
    if (!this.isTextLikeBlock()) {
      return;
    }

    /**
     * @todo Handle case when slash pressed when several blocks are selected
     */

    /**
     * Notion parity: "/" opens the toolbox regardless of caret position or
     * block emptiness. On an empty (or slash-only) block the chosen tool
     * replaces the block in place; on a non-empty block it inserts a NEW block
     * after the current one and strips the typed "/query" (handled by the
     * Toolbox). Both flows just need the "/" inserted at the caret and the
     * toolbox activated.
     */

    /**
     * The Toolbox will be opened with immediate focus on the Search input,
     * and '/' will be added in the search input by default — we need to prevent it and add '/' manually
     */
    event.preventDefault();
    this.Blok.Caret.insertContentAtCaretPosition('/');

    /**
     * Drop the plus-button focus-restoration context: the user has committed
     * to the new block by pressing '/'. activateToolbox() calls moveAndOpen(),
     * which closes-and-reopens the toolbox; without this, the Closed handler
     * would yank the caret back to the pre-plus block and subsequent keystrokes
     * (the search query) would land in the wrong block.
     */
    this.Blok.Toolbar.discardPlusContext();

    this.activateToolbox();
  }

  /**
   * Whether the current block is "text-like" — i.e. a block where "/" should
   * open the command menu (paragraph, header, list, quote…) rather than be
   * inserted as a literal character (code, table…).
   *
   * A block is treated as text-like when its tool is the default block, or
   * when it opts into the inline toolbar AND does not manage its own line
   * breaks. Tools that manage line breaks (Code, Table) own the full keyboard
   * inside their content, so "/" must stay a literal character there.
   *
   * When no block can be resolved the prior behavior is preserved (treat as
   * text-like) so the regular paragraph/header slash menu is never blocked.
   */
  private isTextLikeBlock(): boolean {
    const tool = this.Blok.BlockManager.currentBlock?.tool;

    if (tool === undefined) {
      return true;
    }

    if (tool.isDefault) {
      return true;
    }

    if (tool.isLineBreaksEnabled) {
      return false;
    }

    return tool.enabledInlineTools !== false;
  }

  /**
   * If Toolbox is not open, then just open it and show plus button
   */
  private activateToolbox(): void {
    this.Blok.Toolbar.moveAndOpen();

    this.Blok.Toolbar.toolbox.open();
  }

  /**
   * Open Toolbar and show BlockSettings before flipping Tools
   */
  /**
   * Open the Block Settings / turn-into menu for a multi-block selection.
   *
   * Notion parity: Cmd/Ctrl+/ with 2+ blocks selected opens the block actions
   * menu for the whole selection (turn-into, delete, etc.). We anchor the
   * toolbar to the first selected block via the multi-block path (mirrors the
   * settings-toggler click flow) and then open BlockSettings, which already
   * builds a multi-selection menu when several blocks are selected.
   */
  private activateBlockSettingsForMultipleBlocks(): void {
    if (!this.Blok.Toolbar.opened) {
      this.Blok.Toolbar.moveAndOpenForMultipleBlocks();
    }

    if (!this.Blok.BlockSettings.opened) {
      Promise
        .resolve(this.Blok.BlockSettings.open())
        .catch(() => {
          // Error handling for BlockSettings.open
        });
    }
  }

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
      Promise
        .resolve(this.Blok.BlockSettings.open())
        .catch(() => {
          // Error handling for BlockSettings.open
        });
    }
  }

  /**
   * Cases when we need to close Toolbar
   * @param {KeyboardEvent} event - keyboard event
   */
  private needToolbarClosing(event: KeyboardEvent): boolean {
    const keyCode = keyCodeFromEvent(event);
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

}
