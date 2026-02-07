import { SelectionUtils as Selection } from '../../../selection/index';
import { PopoverRegistry } from '../../../utils/popover/popover-registry';
import { KEYS_REQUIRING_CARET_CAPTURE } from '../constants';

import { Controller } from './_base';

/**
 * KeyboardController handles all document-level keyboard events.
 *
 * Responsibilities:
 * - Route keypress to appropriate handler (Enter, Backspace, Escape, Tab, Z)
 * - Manage keyboard-specific state (lastUndoRedoTime)
 * - Coordinate with BlockManager, BlockSelection, Caret, Toolbar
 */
export class KeyboardController extends Controller {
  /**
   * Reference to the UI module's someToolbarOpened getter
   * This is passed in during construction to avoid circular dependencies
   */
  private someToolbarOpened: () => boolean;

  /**
   * Timestamp of last undo/redo call to prevent double-firing
   */
  private lastUndoRedoTime = 0;

  /**
   * The redactor element for keydown capture
   */
  private redactorElement: HTMLElement | null = null;

  constructor(options: {
    config: Controller['config'];
    eventsDispatcher: Controller['eventsDispatcher'];
    someToolbarOpened: () => boolean;
  }) {
    super(options);
    this.someToolbarOpened = options.someToolbarOpened;
  }

  /**
   * Set the redactor element for keydown capture
   */
  public setRedactorElement(element: HTMLElement): void {
    this.redactorElement = element;
  }

  /**
   * Enable keyboard event listeners
   */
  public override enable(): void {
    if (!this.redactorElement) {
      return;
    }

    // Document-level keydown handler
    this.readOnlyMutableListeners.on(document, 'keydown', (event: Event) => {
      if (event instanceof KeyboardEvent) {
        this.handleKeydown(event);
      }
    }, true);

    /**
     * Capture caret position before any input changes the DOM.
     * This ensures undo/redo restores the caret to the correct position.
     */
    this.readOnlyMutableListeners.on(this.redactorElement, 'beforeinput', () => {
      this.Blok.YjsManager.markCaretBeforeChange();
    }, true);

    /**
     * Capture caret position on keydown for keys that tools commonly intercept.
     * Uses capture phase to run before tool handlers.
     * markCaretBeforeChange() is idempotent - if beforeinput also fires, the second call is ignored.
     */
    this.readOnlyMutableListeners.on(this.redactorElement, 'keydown', (event: Event) => {
      if (!(event instanceof KeyboardEvent)) {
        return;
      }

      if (KEYS_REQUIRING_CARET_CAPTURE.has(event.key)) {
        this.Blok.YjsManager.markCaretBeforeChange();
      }
    }, true);
  }

  /**
   * Main keyboard event router
   * @param event - keyboard event
   */
  private handleKeydown(event: KeyboardEvent): void {
    const key = event.key ?? '';

    switch (key) {
      case 'Enter':
        this.handleEnter(event);
        break;

      case 'Backspace':
      case 'Delete':
        this.handleBackspace(event);
        break;

      case 'Escape':
        this.handleEscape(event);
        break;

      case 'Tab':
        this.handleTab(event);
        break;

      case 'z':
      case 'Z':
        this.handleZ(event);
        break;

      default:
        this.handleDefault(event);
        break;
    }
  }

  /**
   * Handle Enter key press
   * @param event - keyboard event
   */
  private handleEnter(event: KeyboardEvent): void {
    const { BlockManager, BlockSelection, BlockEvents } = this.Blok;

    if (this.someToolbarOpened()) {
      return;
    }

    /**
     * If navigation mode is enabled, delegate to BlockEvents to handle Enter.
     * This will set the caret at the end of the current block.
     */
    if (BlockSelection.navigationModeEnabled) {
      BlockEvents.keydown(event);

      return;
    }

    const hasPointerToBlock = BlockManager.currentBlockIndex >= 0;
    const selectionExists = Selection.isSelectionExists;
    const selectionCollapsed = Selection.isCollapsed;

    /**
     * If any block selected and selection doesn't exists on the page (that means no other editable element is focused),
     * remove selected blocks
     */
    if (BlockSelection.anyBlockSelected && (!selectionExists || selectionCollapsed === true)) {
      /** Clear selection */
      BlockSelection.clearSelection(event);

      /**
       * Stop propagations
       * Manipulation with BlockSelections is handled in global enterPress because they may occur
       * with CMD+A or RectangleSelection
       */
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();

      return;
    }

    /**
     * If Caret is not set anywhere, event target on Enter is always Element that we handle
     * In our case it is document.body
     *
     * So, BlockManager points some Block and Enter press is on Body
     * We can create a new block
     */
    if (!this.someToolbarOpened() && hasPointerToBlock && (event.target as HTMLElement).tagName === 'BODY') {
      /**
       * Insert the default typed Block
       */
      const newBlock = this.Blok.BlockManager.insert();

      /**
       * Prevent default enter behaviour to prevent adding a new line (<div><br></div>) to the inserted block
       */
      event.preventDefault();
      this.Blok.Caret.setToBlock(newBlock);

      /**
       * Move toolbar and show plus button because new Block is empty
       */
      this.Blok.Toolbar.moveAndOpen(newBlock);
    }

    this.Blok.BlockSelection.clearSelection(event);
  }

  /**
   * Handle Backspace/Delete key press
   * @param event - keyboard event
   */
  private handleBackspace(event: KeyboardEvent): void {
    /**
     * Ignore backspace/delete from inside the BlockSettings popover (e.g., search input)
     */
    if (this.Blok.BlockSettings.contains(event.target as HTMLElement)) {
      return;
    }

    const { BlockManager, BlockSelection, Caret } = this.Blok;

    const selectionExists = Selection.isSelectionExists;
    const selectionCollapsed = Selection.isCollapsed;

    /**
     * If any block selected and selection doesn't exists on the page (that means no other editable element is focused),
     * remove selected blocks
     */
    const shouldRemoveSelection = BlockSelection.anyBlockSelected && (
      !selectionExists ||
      selectionCollapsed === true ||
      this.Blok.CrossBlockSelection.isCrossBlockSelectionStarted
    );

    if (!shouldRemoveSelection) {
      return;
    }

    const insertedBlock = BlockManager.deleteSelectedBlocksAndInsertReplacement();

    if (insertedBlock) {
      Caret.setToBlock(insertedBlock, Caret.positions.START);
    }

    BlockSelection.clearSelection(event);

    /**
     * Stop propagations
     * Manipulation with BlockSelections is handled in global backspacePress because they may occur
     * with CMD+A or RectangleSelection and they can be handled on document event
     */
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  /**
   * Handle Escape key press
   * If some of Toolbar components are opened, then close it otherwise close Toolbar.
   * If focus is in editor content and no toolbars are open, enable navigation mode.
   * @param event - escape keydown event
   */
  private handleEscape(event: KeyboardEvent): void {
    /**
     * If navigation mode is already enabled, disable it and return
     */
    if (this.Blok.BlockSelection.navigationModeEnabled) {
      this.Blok.BlockSelection.disableNavigationMode(false);

      return;
    }

    /**
     * Toolbox needs specific Escape handling for caret restoration,
     * so check it before the registry
     */
    if (this.Blok.Toolbar.toolbox.opened) {
      this.Blok.Toolbar.toolbox.close();
      this.Blok.BlockManager.currentBlock &&
        this.Blok.Caret.setToBlock(this.Blok.BlockManager.currentBlock, this.Blok.Caret.positions.END);

      return;
    }

    /**
     * Close any open popover via registry (BlockSettings, table grips, future popovers).
     * Must come before block selection clearing to prevent navigation mode
     * from being enabled when closing block settings.
     */
    if (PopoverRegistry.instance.hasOpenPopovers()) {
      PopoverRegistry.instance.closeTopmost();

      return;
    }

    /**
     * Clear blocks selection by ESC (but not when entering navigation mode)
     */
    if (this.Blok.BlockSelection.anyBlockSelected) {
      this.Blok.BlockSelection.clearSelection(event);

      return;
    }

    /**
     * If a nested popover is open (like convert-to dropdown),
     * close only the nested popover, not the entire inline toolbar.
     * We use stopImmediatePropagation to prevent other keydown listeners
     * (like the one on block.holder) from also handling this event.
     */
    if (this.Blok.InlineToolbar.opened && this.Blok.InlineToolbar.hasNestedPopoverOpen) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      this.Blok.InlineToolbar.closeNestedPopover();

      return;
    }

    if (this.Blok.InlineToolbar.opened) {
      this.Blok.InlineToolbar.close();

      return;
    }

    /**
     * If focus is inside editor content and no toolbars are open,
     * enable navigation mode for keyboard-based block navigation
     */
    const target = event.target;
    const isTargetElement = target instanceof HTMLElement;
    const isInsideRedactor = this.redactorElement && isTargetElement && this.redactorElement.contains(target);
    const hasCurrentBlock = this.Blok.BlockManager.currentBlock !== undefined;

    if (isInsideRedactor && hasCurrentBlock) {
      event.preventDefault();
      this.Blok.Toolbar.close();
      this.Blok.BlockSelection.enableNavigationMode();

      return;
    }

    this.Blok.Toolbar.close();
  }

  /**
   * Handle Tab key press for multi-select indent/outdent
   * @param event - keyboard event
   */
  private handleTab(event: KeyboardEvent): void {
    const { BlockSelection } = this.Blok;

    /**
     * Only handle Tab when blocks are selected (for multi-select indent)
     * Otherwise, let the default behavior handle it (e.g., toolbar navigation)
     */
    if (!BlockSelection.anyBlockSelected) {
      this.handleDefault(event);

      return;
    }

    /**
     * Forward to BlockEvents to handle the multi-select indent/outdent.
     * BlockEvents.keydown will call preventDefault if needed.
     */
    this.Blok.BlockEvents.keydown(event);

    /**
     * When blocks are selected, always prevent default Tab behavior (focus navigation)
     * even if the indent operation couldn't be performed (e.g., mixed block types).
     * This ensures Tab doesn't unexpectedly move focus or trigger single-block indent.
     * We call preventDefault AFTER BlockEvents.keydown so that check for defaultPrevented passes.
     * We also stop propagation to prevent the event from reaching block-level handlers
     * (like ListItem's handleKeyDown) which might try to handle the Tab independently.
     */
    event.preventDefault();
    event.stopPropagation();
  }

  /**
   * Handle Cmd/Ctrl+Z (undo) and Cmd/Ctrl+Shift+Z (redo)
   * @param event - keyboard event
   */
  private handleZ(event: KeyboardEvent): void {
    const isMeta = event.metaKey || event.ctrlKey;

    if (!isMeta) {
      this.handleDefault(event);

      return;
    }

    // Prevent double-firing within 50ms
    const now = Date.now();

    if (now - this.lastUndoRedoTime < 50) {
      event.preventDefault();

      return;
    }
    this.lastUndoRedoTime = now;

    event.preventDefault();
    event.stopPropagation();

    if (event.shiftKey) {
      this.Blok.YjsManager.redo();
    } else {
      this.Blok.YjsManager.undo();
    }
  }

  /**
   * Handle default key behavior when no special keys are pressed
   * @param event - keyboard event
   */
  private handleDefault(event: KeyboardEvent): void {
    const { currentBlock } = this.Blok.BlockManager;
    const target = event.target;
    const isTargetElement = target instanceof HTMLElement;
    const keyDownOnBlok = isTargetElement ? target.closest('[data-blok-testid="blok-editor"]') : null;
    const isMetaKey = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;

    /**
     * Ignore keydowns from inside the BlockSettings popover (e.g., search input)
     * to prevent closing the popover when typing
     */
    if (isTargetElement && this.Blok.BlockSettings.contains(target)) {
      return;
    }

    /**
     * Handle navigation mode keys even when focus is outside the editor
     * Skip if event was already handled (e.g., by block holder listener)
     */
    if (this.Blok.BlockSelection.navigationModeEnabled && !event.defaultPrevented) {
      this.Blok.BlockEvents.keydown(event);
    }

    if (this.Blok.BlockSelection.navigationModeEnabled) {
      return;
    }

    /**
     * When some block is selected, but the caret is not set inside the blok, treat such keydowns as keydown on selected block.
     */
    if (currentBlock !== undefined && keyDownOnBlok === null) {
      this.Blok.BlockEvents.keydown(event);

      return;
    }

    /**
     * Ignore keydowns on blok and meta keys
     */
    if (keyDownOnBlok || (currentBlock && isMetaKey)) {
      return;
    }

    /**
     * Remove all highlights and remove caret
     */
    this.Blok.BlockManager.unsetCurrentBlock();

    /**
     * Close Toolbar
     */
    this.Blok.Toolbar.close();
  }
}
