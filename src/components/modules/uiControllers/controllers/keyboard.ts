import type { Block } from '../../../block';
import { SelectionUtils as Selection } from '../../../selection/index';
import { getCaretOffset } from '../../../utils/caret/selection';
import { PopoverRegistry } from '../../../utils/popover/popover-registry';
import { HEADER_TOOL_NAME } from '../../blockEvents/constants';
import { KEYS_REQUIRING_CARET_CAPTURE } from '../constants';

import { Controller } from './_base';

/**
 * Maps the "Turn into" shortcut digit (event.code) to the target heading level.
 * Mirrors Notion: Cmd+Opt+1…6 (Mac) or Ctrl+Shift+1…6 (Win/Linux) convert the
 * focused block to Heading 1–6 (Blok supports H1-H6), while 0 converts it back
 * to plain Text.
 */
const TURN_INTO_LEVEL_BY_CODE: Record<string, number> = {
  Digit0: 0,
  Digit1: 1,
  Digit2: 2,
  Digit3: 3,
  Digit4: 4,
  Digit5: 5,
  Digit6: 6,
};

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
   * Timestamp and identity of the last undo/redo dispatched, used to dedupe a
   * single physical keypress that emits duplicate keydown events. Keyed by
   * action so the guard only ever swallows an IDENTICAL repeat — a genuinely
   * distinct follow-up (e.g. redo right after undo) is never debounced.
   */
  private lastUndoRedoTime = 0;
  private lastUndoRedoAction: 'undo' | 'redo' | null = null;

  /**
   * Timestamp and digit of the last "Turn into" conversion dispatched, used to
   * dedupe a single physical keypress that emits duplicate keydown events (same
   * 50ms window rationale as the undo/redo guard above). Without this, one
   * Cmd+Opt+1 press could fire two conversions and leave two undo entries.
   */
  private lastTurnIntoTime = 0;
  private lastTurnIntoCode: string | null = null;

  /**
   * The redactor element for keydown capture
   */
  private redactorElement: HTMLElement | null = null;

  /**
   * The editor wrapper element for editor boundary checks.
   * Stored directly because the keyboard controller's Blok reference
   * (created by getModulesDiff) does not include the UI module itself.
   */
  private wrapperElement: HTMLElement | null = null;

  /**
   * Flag set when the controller is disabled (editor destroyed or read-only).
   * Used instead of checking this.Blok.UI which is unavailable to controllers
   * owned by the UI module (getModulesDiff excludes the owning module).
   */
  private isDisabled = false;

  /**
   * Stable handler references for deduplication via Listeners.findOne.
   * Storing as class properties ensures the same function reference is passed
   * to addEventListener on every enable() call, so the Listeners utility can
   * detect and skip duplicate registrations (e.g. when toggleReadOnly calls
   * enable() more than once via requestIdleCallback).
   */
  private readonly documentKeydownHandler = (event: Event): void => {
    if (event instanceof KeyboardEvent) {
      this.handleKeydown(event);
    }
  };

  private readonly redactorBeforeinputHandler = (): void => {
    // force: a beforeinput is the start of a fresh user edit, so the
    // caret-before is the caret right now — discard any stale pending snapshot
    // left dangling by a previous operation's no-op follow-up write.
    this.Blok.YjsManager.markCaretBeforeChange(true);
  };

  private readonly redactorKeydownHandler = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) {
      return;
    }

    const target = event.target;

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return;
    }

    // Skip events from nested editors
    if (target instanceof Element) {
      const closestEditor = target.closest('[data-blok-testid="blok-editor"]');

      if (closestEditor !== null && closestEditor !== this.wrapperElement) {
        return;
      }
    }

    if (KEYS_REQUIRING_CARET_CAPTURE.has(event.key)) {
      // force: this keydown begins a new gesture (Enter split, Backspace merge,
      // etc.). Re-capture so a stale pending from a prior operation's deferred
      // sync can't become this gesture's caret-before (which would reset the
      // caret to the wrong position on undo).
      this.Blok.YjsManager.markCaretBeforeChange(true);
    }
  };

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
   * Set the editor wrapper element for editor boundary checks
   */
  public setWrapperElement(element: HTMLElement): void {
    this.wrapperElement = element;
  }

  /**
   * Enable keyboard event listeners
   */
  public override enable(): void {
    if (!this.redactorElement) {
      return;
    }

    this.isDisabled = false;

    // Document-level keydown handler
    this.readOnlyMutableListeners.on(document, 'keydown', this.documentKeydownHandler, true);

    /**
     * Capture caret position before any input changes the DOM.
     * This ensures undo/redo restores the caret to the correct position.
     */
    this.readOnlyMutableListeners.on(this.redactorElement, 'beforeinput', this.redactorBeforeinputHandler, true);

    /**
     * Capture caret position on keydown for keys that tools commonly intercept.
     * Uses capture phase to run before tool handlers. Both this and the
     * beforeinput handler force a re-capture; when both fire for one keystroke
     * they capture the same pre-change caret, so the duplicate is harmless.
     */
    this.readOnlyMutableListeners.on(this.redactorElement, 'keydown', this.redactorKeydownHandler, true);
  }

  /**
   * Disable the controller — marks it as inactive so stale handlers bail out.
   */
  public override disable(): void {
    this.isDisabled = true;
    super.disable();
  }

  /**
   * Main keyboard event router
   * @param event - keyboard event
   */
  private handleKeydown(event: KeyboardEvent): void {
    /**
     * Guard against destroyed or disabled editor instances whose listeners
     * were not properly removed. When the controller is disabled the handler
     * bails out early so it does not throw or interfere with other editors.
     */
    if (this.isDisabled) {
      return;
    }

    const target = event.target;
    const key = event.key ?? '';

    /**
     * Skip input/textarea targets for most keys to avoid intercepting normal
     * typing.  Escape is exempted only for inputs inside popovers (e.g. the
     * search input) so the keyboard controller can close the popover.
     * Inputs elsewhere (e.g. database title edit inputs) keep their own
     * Escape handling.
     */
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const isInsidePopover = target.closest('[data-blok-popover]') !== null;

      if (key !== 'Escape' || !isInsidePopover) {
        return;
      }
    }

    if (target instanceof Element) {
      const closestEditor = target.closest('[data-blok-testid="blok-editor"]');

      if (closestEditor !== null && closestEditor !== this.wrapperElement) {
        return;
      }
    }

    /**
     * "Turn into" shortcuts (Notion parity): Cmd+Opt+0/1/2/3 (Mac) or
     * Ctrl+Shift+0/1/2/3 (Win/Linux). Matched on event.code (layout-independent)
     * because the shifted/option-modified `key` for a digit is unreliable
     * (Shift+1 = "!", Opt+1 = "¡"). Handled before the switch so the digit is
     * never inserted as text.
     */
    if (this.handleTurnInto(event)) {
      return;
    }

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

      case 'y':
      case 'Y':
        this.handleY(event);
        break;

      default:
        this.handleDefault(event);
        break;
    }
  }

  /**
   * Handle the "Turn into" shortcut (Cmd+Opt / Ctrl+Shift + digit).
   * Converts the focused block to a heading (1–6) or back to plain text (0).
   * @param event - keyboard event
   * @returns true when the shortcut was recognized and handled
   */
  private handleTurnInto(event: KeyboardEvent): boolean {
    // Mac = Cmd+Opt+digit, Win/Linux = Ctrl+Shift+digit.
    const matchesModifiers = (event.metaKey && event.altKey) || (event.ctrlKey && event.shiftKey);

    if (!matchesModifiers) {
      return false;
    }

    const level = TURN_INTO_LEVEL_BY_CODE[event.code];

    if (level === undefined) {
      return false;
    }

    const block = this.Blok.BlockManager.currentBlock;

    if (block === undefined) {
      return false;
    }

    // Don't replay the conversion while a drag is in progress (mirrors the
    // undo/redo guard in handleZ — mutating the tree under the drag is unsafe).
    if (this.Blok.DragManager.isDragging) {
      event.preventDefault();
      event.stopPropagation();

      return true;
    }

    event.preventDefault();
    event.stopPropagation();

    // Dedupe a single physical keypress that emits duplicate keydown events.
    const now = Date.now();

    if (event.code === this.lastTurnIntoCode && now - this.lastTurnIntoTime < 50) {
      return true;
    }
    this.lastTurnIntoTime = now;
    this.lastTurnIntoCode = event.code;

    void this.turnBlockInto(block, level);

    return true;
  }

  /**
   * Convert the given block to the target type and restore the caret.
   * Wrapped in stopCapturing() so the conversion is its own undo step (mirrors
   * the markdown shortcut conversions).
   * @param block - block to convert
   * @param level - 0 for plain text (paragraph), 1-6 for the heading level
   */
  private async turnBlockInto(block: Block, level: number): Promise<void> {
    const { BlockManager, Caret, YjsManager } = this.Blok;
    const isText = level === 0;
    // Core guarantees config.defaultBlock is populated at init; fall back to
    // 'paragraph' to satisfy the optional config type.
    const targetToolName = isText ? this.config.defaultBlock ?? 'paragraph' : HEADER_TOOL_NAME;
    const dataOverrides = isText ? {} : { level };

    // Capture the caret offset within the block BEFORE converting so the caret
    // can be restored to the same position in the converted block (Notion
    // parity), matching the inline-toolbar, block-tunes, markdown and
    // tool-shortcut conversion paths instead of forcing the caret to the end.
    const caretOffset = getCaretOffset();

    YjsManager.stopCapturing();

    const newBlock = await BlockManager.convert(block, targetToolName, dataOverrides);

    Caret.setToBlock(newBlock, Caret.positions.DEFAULT, caretOffset);

    YjsManager.stopCapturing();
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
     * so check it before the registry.
     *
     * stopPropagation() is required here: this handler runs in the capture phase
     * on document, BEFORE the block-level keydown handler.  If we let the event
     * continue bubbling after closing the toolbox, the block's keydown handler
     * (navigationMode.handleEscape) will see `toolbox.opened === false` and
     * incorrectly enable navigation mode, which calls `activeElement.blur()`
     * and drops focus to body.
     */
    if (this.Blok.Toolbar.toolbox.opened) {
      event.stopPropagation();
      this.Blok.Toolbar.toolbox.close();

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
     * Clear blocks selection by ESC (but not when entering navigation mode).
     *
     * Notion parity (BUG #19): Escape from the all-blocks selection (Cmd+A
     * twice) must clear the highlight AND return a text caret, so that case
     * restores the caret; partial selections just clear.
     */
    if (this.Blok.BlockSelection.anyBlockSelected) {
      if (this.Blok.BlockSelection.allBlocksSelected) {
        this.clearAllBlocksSelectionRestoringCaret(event);

        /**
         * Stop the event here so downstream Escape listeners (block.holder keydown,
         * navigation mode) don't run and blur the caret we just restored.
         */
        event.preventDefault();
        event.stopImmediatePropagation();
      } else {
        this.Blok.BlockSelection.clearSelection(event);
      }

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
     * enable navigation mode for keyboard-based block navigation.
     *
     * Skip navigation mode when a drag operation is in progress:
     * the drag's own keydown handler (DragController.onKeyDown) must receive
     * this Escape event to announce the cancellation and clean up drag state.
     * Enabling navigation mode here would call blur() on the active element,
     * then the block holder's bubbling keydown handler would see navigation
     * mode enabled and call event.stopPropagation(), preventing DragController
     * from ever receiving the event.
     */
    const target = event.target;
    const isTargetElement = target instanceof HTMLElement;
    const isInsideRedactor = this.redactorElement && isTargetElement && this.redactorElement.contains(target);
    const hasCurrentBlock = this.Blok.BlockManager.currentBlock !== undefined;

    if (isInsideRedactor && hasCurrentBlock && !this.Blok.DragManager.isDragging) {
      event.preventDefault();
      /**
       * Stop propagation so the block holder's bubble keydown handler (blockEvents.keydown)
       * does not see this same Escape event. Without this, the block-level NavigationMode
       * composer's handleKey() would receive the event AFTER navigation mode is enabled,
       * see navigationModeEnabled=true + key='Escape', and immediately disable it.
       */
      event.stopPropagation();
      this.Blok.Toolbar.close();
      this.Blok.BlockSelection.enableNavigationMode();

      return;
    }

    this.Blok.Toolbar.close();
  }

  /**
   * Clears an all-blocks selection on Escape and returns a text caret to the
   * editor (Notion parity, BUG #19). selectAllBlocks removed the native range,
   * so restore the saved selection; if nothing was restored, fall back to
   * focusing a previously selected block so the user never ends up caretless.
   * @param event - the Escape keydown event that triggered the clear
   */
  private clearAllBlocksSelectionRestoringCaret(event: KeyboardEvent): void {
    const { BlockSelection, Caret } = this.Blok;
    const [fallbackBlock] = BlockSelection.selectedBlocks;

    BlockSelection.clearSelection(event, true);

    /**
     * `selectAllBlocks` removed the native range, so `restoreSelection` has no real
     * caret to bring back, and any leftover range from the block selection is not
     * inside an editable block. Deterministically return the caret to the END of the
     * first formerly-selected block so focus lands back in the editor (Notion's
     * Escape behaviour) — gating on `isSelectionExists` skipped it, because that flag
     * can be true for a stale, non-editable range.
     */
    if (fallbackBlock !== undefined) {
      Caret.setToBlock(fallbackBlock, Caret.positions.END);
    }
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

    /**
     * Layer 18: block undo/redo while a drag is in progress.
     *
     * Regression: "wrong block dropped" family. `moveUndoStack` entries capture
     * `fromIndex`/`toIndex` at record time. Replaying them synchronously while
     * DragController still holds a live source/target reference mutates the
     * flat blocks array under the drag's feet — subsequent `handleDrop` then
     * operates on stale indices and silently drops an unrelated block.
     *
     * The Escape handler already guards on `DragManager.isDragging` (see
     * handleEscape above). Mirror that here: swallow the keystroke so the
     * drag completes cleanly, then the user can undo.
     */
    if (this.Blok.DragManager.isDragging) {
      event.preventDefault();
      event.stopPropagation();

      return;
    }

    // Dedupe a single physical keypress that emits duplicate keydown events,
    // but ONLY when the SAME action repeats inside the window. Duplicates of one
    // press always share the same modifiers, so an undo followed by a redo (Shift
    // toggled) is a genuinely distinct gesture and must never be swallowed —
    // sharing one timestamp across both wrongly dropped a redo issued right after
    // an undo (e.g. redoing a just-undone column creation did nothing).
    const now = Date.now();
    const action: 'undo' | 'redo' = event.shiftKey ? 'redo' : 'undo';

    if (action === this.lastUndoRedoAction && now - this.lastUndoRedoTime < 50) {
      event.preventDefault();

      return;
    }
    this.lastUndoRedoTime = now;
    this.lastUndoRedoAction = action;

    event.preventDefault();
    event.stopPropagation();

    if (action === 'redo') {
      this.Blok.YjsManager.redo();
    } else {
      this.Blok.YjsManager.undo();
    }
  }

  /**
   * Handle Ctrl+Y (redo) — the Windows/Linux redo alias. Notion accepts both
   * Ctrl+Shift+Z and Ctrl+Y for redo; the latter is routed here. Uses the same
   * drag guard and double-fire dedup as handleZ so a single press redoes once.
   *
   * The redo alias is Ctrl+Y WITHOUT Shift. Ctrl+Shift+Y is a distinct combo
   * (e.g. a block tool's "CMD+SHIFT+Y" insert shortcut), so when Shift is held
   * we must fall through to default handling and let the event keep propagating
   * to the tool-shortcut listener — otherwise the stopPropagation below swallows
   * it and a spurious redo fires.
   * @param event - keyboard event
   */
  private handleY(event: KeyboardEvent): void {
    if (!event.ctrlKey || event.shiftKey) {
      this.handleDefault(event);

      return;
    }

    if (this.Blok.DragManager.isDragging) {
      event.preventDefault();
      event.stopPropagation();

      return;
    }

    const now = Date.now();

    if (this.lastUndoRedoAction === 'redo' && now - this.lastUndoRedoTime < 50) {
      event.preventDefault();

      return;
    }
    this.lastUndoRedoTime = now;
    this.lastUndoRedoAction = 'redo';

    event.preventDefault();
    event.stopPropagation();

    this.Blok.YjsManager.redo();
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
