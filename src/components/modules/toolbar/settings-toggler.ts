import type { BlokModules } from '../../../types-internal/blok-modules';
import type { Block } from '../../block';
import { DATA_ATTR, TEST_ID } from '../../constants';
import { Dom as $ } from '../../dom';
import { IconMenu } from '../../icons';
import { getUserOS } from '../../utils';
import { hide, onHover } from '../../utils/tooltip';
import { twJoin } from '../../utils/tw';

import type { ClickDragHandler } from './click-handler';
import { createTooltipContent } from './tooltip';
import type { ToolbarNodes } from './types';


/**
 * Cursor classes that advertise the drag gesture. Applied only while editing —
 * read-only suppresses dragging, so the handle must read as a plain click target.
 */
const DRAG_CURSOR_CLASSES = [
  'active:cursor-grabbing',
  'can-hover:hover:cursor-grab',
  'group-data-[blok-dragging=true]:cursor-grabbing',
];

/**
 * SettingsTogglerHandler manages the settings toggler (drag handle) behavior.
 * Creates the settings toggler element with tooltip.
 */
export class SettingsTogglerHandler {
  /**
   * Getter function to access Blok modules dynamically
   * This ensures the handler always has access to the current state
   */
  private getBlok: () => BlokModules;

  /**
   * Click-vs-drag handler instance
   */
  private clickDragHandler: ClickDragHandler;

  /**
   * Flag to ignore the next mouseup on settings toggler after a block drop
   * Prevents the settings menu from opening when the cursor is over the toggler after drop
   */
  private ignoreNextSettingsMouseUp = false;

  /**
   * Callback to set the hovered block
   */
  private setHoveredBlockCallback: (block: Block) => void;

  /**
   * Callback to check if toolbox is opened
   */
  private getToolboxOpened: () => boolean;

  /**
   * Callback to close the toolbox
   */
  private closeToolbox: () => void;

  /**
   * Reference to the settings toggler element.
   * Stored here because Toolbar module excludes itself from its own Blok reference via getModulesDiff(),
   * so accessing blok.Toolbar.nodes.settingsToggler would be undefined.
   */
  private settingsTogglerElement: HTMLElement | null = null;

  /**
   * @param getBlok - Function to get Blok modules reference
   * @param clickDragHandler - Click-vs-drag handler instance
   * @param callbacks - Object containing callback functions
   */
  constructor(
    getBlok: () => BlokModules,
    clickDragHandler: ClickDragHandler,
    callbacks: {
      setHoveredBlock: (block: Block) => void;
      getToolboxOpened: () => boolean;
      closeToolbox: () => void;
    }
  ) {
    this.getBlok = getBlok;
    this.clickDragHandler = clickDragHandler;
    this.setHoveredBlockCallback = callbacks.setHoveredBlock;
    this.getToolboxOpened = callbacks.getToolboxOpened;
    this.closeToolbox = callbacks.closeToolbox;
  }

  /**
   * Gets the current hovered block
   */
  get hoveredBlock(): Block | null {
    return this.hoveredBlockInternal;
  }

  /**
   * Sets the hovered block
   */
  setHoveredBlock(block: Block | null): void {
    this.hoveredBlockInternal = block;
  }

  /**
   * Internal storage for the hovered block
   */
  private hoveredBlockInternal: Block | null = null;

  /**
   * Prevents the settings menu from opening on the next mouseup event
   * Used after block drop to avoid accidental menu opening
   */
  public skipNextToggle(): void {
    this.ignoreNextSettingsMouseUp = true;
  }

  /**
   * Creates the settings toggler element with tooltip
   * @param nodes - Toolbar nodes object to populate with the settings toggler
   * @returns The created settings toggler element
   */
  public make(nodes: ToolbarNodes): HTMLElement {
    const settingsToggler = $.make('span', [
      twJoin(
        // Base toolbox-button styles
        'text-text-secondary cursor-pointer w-[18px] h-6 rounded-[5px] inline-flex justify-center items-center select-none',
        // SVG sizing
        '[&_svg]:h-[22px] [&_svg]:w-[22px] [&_svg]:shrink-0',
        // Hover (can-hover)
        'can-hover:hover:bg-bg-light',
        // Hide when the toolbox popover is open
        'group-data-[blok-toolbox-opened=true]:hidden',
        // Hide while the block settings popover is open (matches plus-button)
        'group-data-[blok-block-settings-opened=true]:hidden',
        // Mobile styles (static positioning with overlay-pane appearance)
        'mobile:bg-popover-bg mobile:border mobile:border-mobile-border mobile:shadow-overlay-pane mobile:rounded-[6px] mobile:z-2',
        'mobile:w-toolbox-btn-mobile mobile:h-toolbox-btn-mobile'
      ),
    ], {
      innerHTML: IconMenu,
    });

    settingsToggler.setAttribute(DATA_ATTR.settingsToggler, '');
    settingsToggler.setAttribute(DATA_ATTR.dragHandle, '');
    settingsToggler.setAttribute(DATA_ATTR.testid, TEST_ID.settingsToggler);

    // Accessibility: make the drag handle accessible to screen readers
    // Using tabindex="-1" keeps it accessible but removes from tab order
    // Users can move blocks with keyboard shortcuts (Cmd/Ctrl+Shift+Arrow)
    settingsToggler.setAttribute('role', 'button');
    settingsToggler.setAttribute('tabindex', '-1');

    /**
     * Keyboard activation: Enter / Space open the block settings menu, mirroring
     * the plus button's handler. Space is prevented from scrolling the page.
     */
    settingsToggler.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') {
        return;
      }

      e.preventDefault();
      this.handleClick();
    });

    // eslint-disable-next-line no-param-reassign -- nodes is mutated by design
    nodes.settingsToggler = settingsToggler;

    this.settingsTogglerElement = settingsToggler;

    this.refreshTooltip();
    this.refreshCursor();
    this.refreshAriaLabel();

    return settingsToggler;
  }

  /**
   * Matches what assistive tech announces to the current read-only state.
   * Read-only suppresses both the drag gesture and the Cmd/Ctrl+Shift+Arrow
   * block-move shortcut, so there the handle is announced as a plain button
   * that opens the block menu.
   * Called on creation and whenever read-only is toggled.
   */
  public refreshAriaLabel(): void {
    const settingsToggler = this.settingsTogglerElement;

    if (settingsToggler === null) {
      return;
    }

    const blok = this.getBlok();

    if (blok.ReadOnly.isEnabled) {
      settingsToggler.setAttribute('aria-label', blok.I18n.t('blockSettings.clickToOpenMenu'));
      settingsToggler.removeAttribute('aria-roledescription');
      settingsToggler.removeAttribute('aria-keyshortcuts');

      return;
    }

    settingsToggler.setAttribute('aria-label', blok.I18n.t('a11y.dragHandle'));
    settingsToggler.setAttribute('aria-roledescription', blok.I18n.t('a11y.dragHandleRole'));

    /**
     * Surface the keyboard block-move shortcut (previously documented only in a
     * source comment) to assistive tech. aria-keyshortcuts uses the standard
     * key-token syntax (not translated); the modifier is platform-branched to
     * match the actual binding — Meta on mac, Control on Windows.
     */
    const keyshortcutModifier = getUserOS().win ? 'Control' : 'Meta';

    settingsToggler.setAttribute(
      'aria-keyshortcuts',
      `${keyshortcutModifier}+Shift+ArrowUp ${keyshortcutModifier}+Shift+ArrowDown`
    );
  }

  /**
   * Matches the settings toggler cursor to the current read-only state: the
   * grab cursors only in edit mode, the base pointer everywhere else.
   * Called on creation and whenever read-only is toggled.
   */
  public refreshCursor(): void {
    if (this.settingsTogglerElement === null) {
      return;
    }

    const draggable = !this.getBlok().ReadOnly.isEnabled;

    DRAG_CURSOR_CLASSES.forEach((className) => {
      this.settingsTogglerElement?.classList.toggle(className, draggable);
    });
  }

  /**
   * Binds the settings toggler tooltip to match the current read-only state.
   * Read-only suppresses both the drag gesture and the Cmd/Ctrl+Slash shortcut
   * (block keydown handlers are unbound), so the tooltip there promises only a click.
   * Called on creation and whenever read-only is toggled.
   */
  public refreshTooltip(): void {
    if (this.settingsTogglerElement === null) {
      return;
    }

    const blok = this.getBlok();
    const openMenuAction = { text: blok.I18n.t('blockSettings.openMenuAction'), highlight: false };
    const clickAction = { text: blok.I18n.t('blockSettings.clickAction'), highlight: true };

    const shortcut = getUserOS().win
      ? blok.I18n.t('blockSettings.menuShortcutWin')
      : blok.I18n.t('blockSettings.menuShortcutMac');

    const lines = blok.ReadOnly.isEnabled
      ? [[clickAction, openMenuAction]]
      : [
        blok.I18n.t('blockSettings.dragToMove'),
        [
          clickAction,
          { text: blok.I18n.t('blockSettings.orConjunction'), highlight: false },
          { text: shortcut, highlight: true },
          openMenuAction,
        ],
      ];

    onHover(this.settingsTogglerElement, createTooltipContent(lines), {
      delay: 500,
    });
  }

  /**
   * Creates a mousedown event handler for the settings toggler
   * This should be called from the Toolbar's enableModuleBindings method
   * @returns A function to be used as the mousedown event handler
   */
  public createMousedownHandler(): (e: Event) => void {
    return (e: Event) => {
      /**
       * Prevent focus from moving away from the currently-active contenteditable block.
       * Without this, clicking the settings toggler steals DOM focus, causing subsequent
       * keystrokes to land in the wrong block (text-jumping bug).
       */
      (e as MouseEvent).preventDefault();
      hide();

      this.clickDragHandler.setup(
        e as MouseEvent,
        () => {
          this.handleClick();

          if (this.getToolboxOpened()) {
            this.closeToolbox();
          }
        },
        {
          /**
           * Check if we should ignore this mouseup (e.g., after a block drop)
           */
          beforeCallback: () => {
            if (this.ignoreNextSettingsMouseUp) {
              this.ignoreNextSettingsMouseUp = false;
              return false;
            }

            return true;
          },
        }
      );
    };
  }

  /**
   * Handles the settings toggler click
   */
  private handleClick(): void {
    const blok = this.getBlok();

    /**
     * Cancel any pending drag tracking since we're opening the settings menu
     * This prevents the drag from starting when the user moves their mouse to the menu
     */
    blok.DragManager.cancelTracking();

    /**
     * Prefer the hovered block (desktop), fall back to the current block (mobile) so tapping the toggler still works
     */
    const targetBlock = this.hoveredBlockInternal ?? blok.BlockManager.currentBlock;

    if (!targetBlock) {
      return;
    }

    this.hoveredBlockInternal = targetBlock;
    // Don't change hoveredBlock when opening settings - this prevents toolbar from repositioning
    // The settings menu should open for the targetBlock without affecting the toolbar position
    blok.BlockManager.currentBlock = targetBlock;

    if (blok.BlockSettings.opened) {
      blok.BlockSettings.close();
    } else {
      void blok.BlockSettings.open(targetBlock, this.settingsTogglerElement ?? undefined);
    }
  }
}
