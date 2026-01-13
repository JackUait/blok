import { isPrintableKeyEvent } from '../utils/keyboard';
import { BlockEventComposer } from './__base';

/**
 * NavigationMode Composer handles Escape-key navigation mode.
 *
 * In navigation mode:
 * - ArrowUp/ArrowDown: navigate between blocks
 * - Enter: exit navigation mode and focus the block for editing
 * - Escape: exit navigation mode without focusing
 * - Any printable key: exits navigation mode and allows normal input
 */
export class NavigationMode extends BlockEventComposer {
  /**
   * Handles Escape key press to enable navigation mode.
   * Called when user presses Escape while editing a block.
   * @param event - keyboard event
   * @returns true if event was handled
   */
  public handleEscape(event: KeyboardEvent): boolean {
    if (event.key !== 'Escape') {
      return false;
    }

    const { BlockSelection, BlockSettings, InlineToolbar, Toolbar } = this.Blok;

    /**
     * If any toolbar is open, let the UI module handle closing it
     */
    if (BlockSettings.opened || InlineToolbar.opened || Toolbar.toolbox.opened) {
      return false;
    }

    /**
     * If blocks are selected, let the UI module handle clearing selection
     */
    if (BlockSelection.anyBlockSelected) {
      return false;
    }

    /**
     * Enable navigation mode
     */
    event.preventDefault();
    Toolbar.close();
    BlockSelection.enableNavigationMode();

    return true;
  }

  /**
   * Handles keyboard events when navigation mode is active.
   * @param event - keyboard event
   * @returns true if event was handled
   */
  public handleKey(event: KeyboardEvent): boolean {
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
        if (isPrintableKeyEvent(event)) {
          BlockSelection.disableNavigationMode(true);
        }

        return false;
    }
  }
}
