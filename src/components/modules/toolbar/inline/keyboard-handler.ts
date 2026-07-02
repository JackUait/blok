import { Flipper } from '../../../flipper';

import type { PopoverInline } from '../../../utils/popover/popover-inline';

/**
 * InlineKeyboardHandler handles keyboard events for inline toolbar.
 *
 * Responsibilities:
 * - Check if flipper has focus (user is navigating with keyboard)
 * - Check if nested popover is open
 * - Close nested popover if open
 * - Handle keydown events (close toolbar on vertical arrows, flip between
 *   items on horizontal arrows to honor the WAI-ARIA horizontal toolbar)
 */
export class InlineKeyboardHandler {
  /**
   * Getter function to access the popover instance
   */
  private getPopover: () => PopoverInline | null;

  /**
   * Callback to close the toolbar
   */
  private closeToolbar: () => void;

  constructor(
    getPopover: () => PopoverInline | null,
    closeToolbar: () => void
  ) {
    this.getPopover = getPopover;
    this.closeToolbar = closeToolbar;
  }

  /**
   * Check if flipper has focus (user is navigating with keyboard)
   */
  public get hasFlipperFocus(): boolean {
    const popoverInline = this.getPopover();

    if (popoverInline === null) {
      return false;
    }

    const mainFlipperHasFocus = popoverInline.flipper?.hasFocus() ?? false;

    return mainFlipperHasFocus || popoverInline.hasNestedPopoverOpen;
  }

  /**
   * Check if nested popover is open
   */
  public get hasNestedPopoverOpen(): boolean {
    const popoverInline = this.getPopover();

    if (popoverInline === null) {
      return false;
    }

    return popoverInline.hasNestedPopoverOpen;
  }

  /**
   * Close nested popover if open
   */
  public closeNestedPopover(): boolean {
    const popoverInline = this.getPopover();

    if (popoverInline === null) {
      return false;
    }

    if (!popoverInline.hasNestedPopoverOpen) {
      return false;
    }

    popoverInline.closeNestedPopover();

    return true;
  }

  /**
   * Handle keydown event
   */
  public handle(event: KeyboardEvent, opened: boolean): void {
    const isVerticalArrowKey = event.key === 'ArrowDown' || event.key === 'ArrowUp';
    const isHorizontalArrowKey = event.key === 'ArrowLeft' || event.key === 'ArrowRight';

    const popover = this.getPopover();
    const flipper = popover?.flipper;
    const mainFlipperHasFocus = flipper?.hasFocus() ?? false;
    const hasNestedPopover = popover?.hasNestedPopoverOpen ?? false;

    /**
     * Close inline toolbar when Up/Down arrow key is pressed without Shift
     * This allows the user to move the cursor and collapse the selection
     *
     * However, if the user has already started keyboard navigation within the toolbar
     * (by pressing Tab to focus on a toolbar item) or has opened a nested submenu,
     * we should keep the toolbar open and let the flipper handle navigation.
     */
    const shouldCheckForClose = isVerticalArrowKey && !event.shiftKey && opened;
    const shouldKeepOpen = mainFlipperHasFocus || hasNestedPopover;

    if (shouldCheckForClose && !shouldKeepOpen) {
      this.closeToolbar();

      return;
    }

    /**
     * Honor the horizontal ARIA toolbar orientation: when the flipper has focus
     * and no nested popover is open, Left/Right move focus between toolbar
     * items instead of being swallowed. When a nested popover IS open, defer to
     * it (its own flipper opens the submenu on Right and closes it on Left), so
     * we neither flip nor swallow the event here.
     */
    if (isHorizontalArrowKey && opened && mainFlipperHasFocus && !hasNestedPopover) {
      /**
       * The Flipper listens on BOTH document and window in capture mode.
       * stopPropagation() alone would not stop the Flipper's window listener
       * (same node as ours), letting it re-process this ArrowLeft/ArrowRight
       * after the flip and auto-open the newly-focused item's submenu — so we
       * must stop same-node listeners too. preventDefault() additionally lets
       * the Flipper's own defaultPrevented guard skip the event defensively.
       */
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (flipper instanceof Flipper) {
        this.flipToolbarItem(flipper, event.key);
      }

      return;
    }
  }

  /**
   * Move focus between horizontal toolbar items in the direction of the pressed arrow key
   */
  private flipToolbarItem(flipper: Flipper, key: string): void {
    if (key === 'ArrowRight') {
      flipper.flipRight();
    } else {
      flipper.flipLeft();
    }
  }

  /**
   * Check if the event is Shift+Arrow (should show toolbar)
   */
  public isShiftArrow(event: KeyboardEvent): boolean {
    return event.shiftKey &&
      (event.key === 'ArrowDown' || event.key === 'ArrowUp');
  }
}
