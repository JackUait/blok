import { selectionChangeDebounceTimeout } from '../../../constants';
import { SelectionUtils as Selection } from '../../../selection';
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
    this.handleSelectionChange();
  }, selectionChangeDebounceTimeout);

  /**
   * Set the wrapper element for selection change handling
   */
  public setWrapperElement(element: HTMLElement): void {
    this.wrapperElement = element;
  }

  /**
   * Enable selection change listeners
   */
  public override enable(): void {
    this.listeners.on(document, 'selectionchange', this.selectionChangeDebounced);
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

    /**
     * Ignore transient selection changes triggered by fake background wrappers (used by inline tools
     * like Convert) while the Inline Toolbar is already open. Otherwise, the toolbar gets torn down
     * and re-rendered, which closes nested popovers before a user can click their items.
     */
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

    void this.Blok.InlineToolbar.tryToShow(true);
  }

  /**
   * Guard for fake background elements that trigger transient selection changes
   * @returns true if selection change should be ignored
   */
  private shouldIgnoreSelectionChange(): boolean {
    const hasFakeBackground = document.querySelector('[data-blok-fake-background="true"]') !== null;

    return hasFakeBackground && this.Blok?.InlineToolbar?.opened;
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
    /**
     * Always update current block when focus moves to a different block.
     * This handles Tab key navigation, programmatic focus, and accessibility tools.
     */
    return true;
  }
}
