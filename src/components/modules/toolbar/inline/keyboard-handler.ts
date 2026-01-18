import type { PopoverInline } from '../../../utils/popover/popover-inline';

/**
 * InlineKeyboardHandler handles keyboard events for inline toolbar.
 *
 * Responsibilities:
 * - Check if flipper has focus (user is navigating with keyboard)
 * - Check if nested popover is open
 * - Close nested popover if open
 * - Handle keydown events (close toolbar on arrow keys, prevent horizontal navigation)
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
    const nestedPopover = (popoverInline as unknown as { nestedPopover?: { flipper?: { hasFocus(): boolean } } | null }).nestedPopover;
    const nestedFlipperHasFocus = nestedPopover?.flipper?.hasFocus() ?? false;

    return mainFlipperHasFocus || nestedFlipperHasFocus;
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

    const popoverWithFlipper = this.getPopover();
    const mainFlipperHasFocus = popoverWithFlipper?.flipper?.hasFocus() ?? false;
    const nestedPopover = popoverWithFlipper !== null
      ? (popoverWithFlipper as unknown as { nestedPopover?: { flipper?: { hasFocus(): boolean } } | null }).nestedPopover
      : null;
    const hasNestedPopover = nestedPopover !== null && nestedPopover !== undefined;
    const nestedFlipperHasFocus = nestedPopover?.flipper?.hasFocus() ?? false;

    /**
     * Close inline toolbar when Up/Down arrow key is pressed without Shift
     * This allows the user to move the cursor and collapse the selection
     *
     * However, if the user has already started keyboard navigation within the toolbar
     * (by pressing Tab to focus on a toolbar item), we should allow arrow key navigation
     * within the toolbar instead of closing it.
     *
     * Left/Right arrow keys should have no effect within the inline toolbar,
     * so we don't close the toolbar when they are pressed.
     */
    const shouldCheckForClose = isVerticalArrowKey && !event.shiftKey && opened;
    const shouldKeepOpen = mainFlipperHasFocus || hasNestedPopover || nestedFlipperHasFocus;

    if (shouldCheckForClose && !shouldKeepOpen) {
      this.closeToolbar();

      return;
    }

    /**
     * When the inline toolbar is open and the flipper has focus,
     * prevent horizontal arrow keys from doing anything (no navigation, no closing)
     */
    if (isHorizontalArrowKey && opened && mainFlipperHasFocus) {
      event.preventDefault();
      event.stopPropagation();

      return;
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
