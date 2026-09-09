import { selectionChangeDebounceTimeout } from '../../../constants';
import { Dom as $ } from '../../../dom';
import { SelectionUtils as Selection } from '../../../selection/index';
import { debounce } from '../../../utils';

import { Controller } from './_base';

/**
 * SelectionController manages selection changes and coordinates InlineToolbar visibility.
 *
 * Responsibilities:
 * - Listen to selectionchange events (debounced)
 * - Determine if inline toolbar should show/hide
 * - Update current block based on selection focus
 * - Handle cross-block selection edge cases
 */
export class SelectionController extends Controller {
  /**
   * The wrapper element for this Blok instance
   */
  private wrapperElement: HTMLElement | null = null;

  /**
   * Handle selection change to manipulate Inline Toolbar appearance
   */
  private selectionChangeDebounced = debounce(() => {
    if (this.isEnabled) {
      this.handleSelectionChange();
    }
  }, selectionChangeDebounceTimeout);

  private isEnabled = false;

  /**
   * Set the wrapper element for selection change handling
   */
  public setWrapperElement(element: HTMLElement): void {
    this.wrapperElement = element;
  }

  private isPointerDown = false;

  private pointerUpFrame: number | null = null;

  // Range objects are live; preserve boundary values before the browser changes them.
  private pointerSelection: Pick<Range, 'startContainer' | 'startOffset' | 'endContainer' | 'endOffset'> | null = null;

  private handlePointerDown = (event: Event): void => {
    this.isPointerDown = true;

    // Another press can arrive before the previous release frame.
    if (this.pointerSelection !== null && this.Blok.InlineToolbar.opened) {
      return;
    }

    this.pointerSelection = null;

    const editable = event.target instanceof Element
      ? event.target.closest('[contenteditable]')
      : null;
    const range = Selection.range;

    if (this.Blok.InlineToolbar.opened && range &&
      editable instanceof HTMLElement && $.isContentEditable(editable) &&
      this.wrapperElement?.contains(editable)) {
      this.pointerSelection = {
        startContainer: range.startContainer,
        startOffset: range.startOffset,
        endContainer: range.endContainer,
        endOffset: range.endOffset,
      };
    }
  };

  private handlePointerUp = (event: Event): void => {
    this.isPointerDown = false;

    if (this.pointerUpFrame !== null) {
      cancelAnimationFrame(this.pointerUpFrame);
      this.pointerUpFrame = null;
    }

    const editable = event.target instanceof Element
      ? event.target.closest('[contenteditable]')
      : null;

    // Menu clicks need selection handling before their click handlers run.
    if (!(editable instanceof HTMLElement) || !$.isContentEditable(editable)) {
      this.handleSelectionChange();
      this.pointerSelection = null;

      return;
    }

    // Mouseup can collapse the old selection after pointerup has fired.
    this.pointerUpFrame = requestAnimationFrame(() => {
      this.pointerUpFrame = null;
      if (this.isEnabled && !this.isPointerDown) {
        this.handleSelectionChange();
        this.pointerSelection = null;
      }
    });
  };

  /**
   * A cancelled pointer interaction (e.g. the gesture is taken over by the
   * browser) never fires pointerup, so clear the flag to avoid stranding the
   * toolbar in a permanently-suppressed state.
   */
  private handlePointerCancel = (): void => {
    this.isPointerDown = false;
    this.handleSelectionChange();
    this.pointerSelection = null;
  };

  /**
   * Enable selection change listeners
   */
  public override enable(): void {
    this.isEnabled = true;
    this.listeners.on(document, 'selectionchange', this.selectionChangeDebounced);
    this.listeners.on(document, 'pointerdown', this.handlePointerDown);
    this.listeners.on(document, 'pointerup', this.handlePointerUp);
    this.listeners.on(document, 'pointercancel', this.handlePointerCancel);
  }

  /**
   * Disable selection change listeners and queued work
   */
  public override disable(): void {
    this.isEnabled = false;
    this.isPointerDown = false;
    this.pointerSelection = null;
    if (this.pointerUpFrame !== null) {
      cancelAnimationFrame(this.pointerUpFrame);
      this.pointerUpFrame = null;
    }
    super.disable();
  }

  /**
   * Main selection change handler
   */
  private handleSelectionChange(): void {
    const { CrossBlockSelection, BlockSelection } = this.Blok;
    const focusedElement = Selection.anchorElement;

    if (CrossBlockSelection.isCrossBlockSelectionStarted && BlockSelection.anyBlockSelected) {
      // Removes all ranges when any Block is selected
      Selection.get()?.removeAllRanges();
    }

    if (this.shouldIgnoreSelectionChange()) {
      return;
    }

    /**
     * Usual clicks on some controls, for example, Block Tunes Toggler
     */
    if (!focusedElement && !Selection.range) {
      /**
       * If there is no selected range, close inline toolbar
       * @todo Make this method more straightforward
       */
      this.Blok.InlineToolbar.close();
    }

    if (!focusedElement) {
      return;
    }

    /**
     * Event can be fired on clicks at non-block-content elements,
     * for example, at the Inline Toolbar or some Block Tune element.
     * We also make sure that the closest block belongs to the current blok and not a parent
     */
    const closestBlock = focusedElement.closest('[data-blok-testid="block-content"]');
    const clickedOutsideBlockContent = !this.wrapperElement ||
      closestBlock === null ||
      (closestBlock.closest('[data-blok-testid="blok-editor"]') !== this.wrapperElement);

    const inlineToolbarEnabledForExternalTool = (focusedElement as HTMLElement).getAttribute('data-blok-inline-toolbar') === 'true';
    const shouldCloseInlineToolbar = clickedOutsideBlockContent && !this.Blok.InlineToolbar.containsNode(focusedElement);

    /**
     * If the inline toolbar is already open without a nested popover,
     * don't close or re-render it. This prevents the toolbar from flickering
     * when the user closes a nested popover (e.g., via Esc key).
     *
     * However, if the selection is now collapsed or empty (e.g., user deleted the selected text),
     * we should close the inline toolbar since there's nothing to format.
     *
     * Important: Don't close the toolbar if a flipper item is focused (user is navigating
     * with Tab/Arrow keys). In some browsers (webkit), keyboard navigation within the
     * popover can trigger selectionchange events that make the selection appear empty.
     */
    if (this.shouldCloseInlineToolbar()) {
      this.Blok.InlineToolbar.close();

      return;
    }

    const previousRange = this.pointerSelection;
    const range = Selection.range;

    if (this.Blok.InlineToolbar.opened && previousRange &&
      (!range || range.startContainer !== previousRange.startContainer ||
        range.startOffset !== previousRange.startOffset ||
        range.endContainer !== previousRange.endContainer ||
        range.endOffset !== previousRange.endOffset)) {
      this.Blok.InlineToolbar.close();
      this.pointerSelection = null;
    }

    if (this.Blok.InlineToolbar.opened && !this.Blok.InlineToolbar.hasNestedPopoverOpen) {
      return;
    }

    if (shouldCloseInlineToolbar) {
      /**
       * If new selection is not on Inline Toolbar, we need to close it
       */
      this.Blok.InlineToolbar.close();
    }

    if (clickedOutsideBlockContent && !inlineToolbarEnabledForExternalTool) {
      /**
       * Case when we click on external tool elements,
       * for example some Block Tune element.
       * If this external content editable element has data-inline-toolbar="true"
       */
      return;
    }

    /**
     * Always update current block when focus moves to a different block.
     * This handles Tab key navigation, programmatic focus, and accessibility tools.
     * Without this, currentBlockIndex would remain stale and caret restoration
     * during undo/redo would target the wrong block.
     */
    if (this.shouldUpdateCurrentBlock()) {
      this.Blok.BlockManager.setCurrentBlockByChildNode(focusedElement);
    }

    /**
     * While the pointer is held down the user is still dragging out the
     * selection. Keep the toolbar hidden until they release (handlePointerUp),
     * so it appears in one motion at the final selection rather than popping up
     * mid-drag.
     */
    if (this.isPointerDown) {
      return;
    }

    void this.Blok.InlineToolbar.tryToShow(true);
  }

  /**
   * Menu focus can clear the document range before an item click fires.
   * Outside-click dismissal remains with the click handler.
   * @returns true if selection change should be ignored
   */
  private shouldIgnoreSelectionChange(): boolean {
    const inlineToolbar = this.Blok?.InlineToolbar;

    if (!inlineToolbar?.opened) {
      return false;
    }

    const hasFakeBackground = document.querySelector('[data-blok-fake-background="true"]') !== null;
    const activeElement = document.activeElement;
    const hasNestedPopoverFocus = inlineToolbar.hasNestedPopoverOpen &&
      activeElement !== null &&
      inlineToolbar.containsNode(activeElement);

    return hasFakeBackground || inlineToolbar.hasDirectMenuOpen || hasNestedPopoverFocus;
  }

  /**
   * Guard for closing inline toolbar
   * @returns true if inline toolbar should be closed
   */
  private shouldCloseInlineToolbar(): boolean {
    const currentSelection = Selection.get();
    const selectionIsEmpty = !currentSelection || currentSelection.isCollapsed || Selection.text.length === 0;
    const hasFlipperFocus = this.Blok.InlineToolbar.hasFlipperFocus;

    return selectionIsEmpty && this.Blok.InlineToolbar.opened && !hasFlipperFocus;
  }

  /**
   * Guard for updating current block
   * @returns true if current block should be updated
   */
  private shouldUpdateCurrentBlock(): boolean {
    const focusedElement = Selection.anchorElement;

    if (!focusedElement || !this.wrapperElement) {
      return false;
    }

    /**
     * Skip updating current block when focus is inside a nested editor instance.
     * The closest editor wrapper must match this instance's wrapper.
     */
    const closestEditor = focusedElement.closest('[data-blok-testid="blok-editor"]');

    if (closestEditor !== null && closestEditor !== this.wrapperElement) {
      return false;
    }

    return true;
  }
}
