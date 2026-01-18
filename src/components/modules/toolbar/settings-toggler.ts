import type { BlokModules } from '../../../types-internal/blok-modules';
import type { Block } from '../../block';
import { DATA_ATTR } from '../../constants';
import { Dom as $ } from '../../dom';
import { IconMenu } from '../../icons';
import { hide, onHover } from '../../utils/tooltip';
import { twJoin } from '../../utils/tw';

import type { ClickDragHandler } from './click-handler';
import { createTooltipContent } from './tooltip';
import type { ToolbarNodes } from './types';


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
    const blok = this.getBlok();
    const settingsToggler = $.make('span', [
      twJoin(
        // Base toolbox-button styles
        'text-dark cursor-pointer w-toolbox-btn h-toolbox-btn rounded-[7px] inline-flex justify-center items-center select-none',
        // SVG sizing
        '[&_svg]:h-6 [&_svg]:w-6',
        // Active state
        'active:cursor-grabbing',
        // Hover (can-hover)
        'can-hover:hover:bg-bg-light can-hover:hover:cursor-grab',
        // When toolbox is opened, use pointer cursor on hover
        'group-data-[blok-toolbox-opened=true]:can-hover:hover:cursor-pointer',
        // When block settings is opened, show hover background and pointer cursor
        'group-data-[blok-block-settings-opened=true]:bg-bg-light',
        'group-data-[blok-block-settings-opened=true]:can-hover:hover:cursor-pointer',
        // Mobile styles (static positioning with overlay-pane appearance)
        'mobile:bg-white mobile:border mobile:border-[#e8e8eb] mobile:shadow-overlay-pane mobile:rounded-[6px] mobile:z-[2]',
        'mobile:w-toolbox-btn-mobile mobile:h-toolbox-btn-mobile',
        // Not-mobile styles
        'not-mobile:w-6'
      ),
      'group-data-[blok-dragging=true]:cursor-grabbing',
    ], {
      innerHTML: IconMenu,
    });

    settingsToggler.setAttribute(DATA_ATTR.settingsToggler, '');
    settingsToggler.setAttribute(DATA_ATTR.dragHandle, '');
    settingsToggler.setAttribute('data-blok-testid', 'settings-toggler');

    // Accessibility: make the drag handle accessible to screen readers
    // Using tabindex="-1" keeps it accessible but removes from tab order
    // Users can move blocks with keyboard shortcuts (Cmd/Ctrl+Shift+Arrow)
    settingsToggler.setAttribute('role', 'button');
    settingsToggler.setAttribute('tabindex', '-1');
    settingsToggler.setAttribute(
      'aria-label',
      blok.I18n.t('a11y.dragHandle')
    );
    settingsToggler.setAttribute(
      'aria-roledescription',
      blok.I18n.t('a11y.dragHandleRole')
    );

    // eslint-disable-next-line no-param-reassign -- nodes is mutated by design
    nodes.settingsToggler = settingsToggler;

    this.settingsTogglerElement = settingsToggler;

    /**
     * Add events to show/hide tooltip for settings toggler
     */
    const blockTunesTooltip = createTooltipContent([
      blok.I18n.t('blockSettings.dragToMove'),
      blok.I18n.t('blockSettings.clickToOpenMenu'),
    ]);

    onHover(settingsToggler, blockTunesTooltip, {
      delay: 500,
    });

    return settingsToggler;
  }

  /**
   * Creates a mousedown event handler for the settings toggler
   * This should be called from the Toolbar's enableModuleBindings method
   * @returns A function to be used as the mousedown event handler
   */
  public createMousedownHandler(): (e: Event) => void {
    return (e: Event) => {
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
    this.setHoveredBlockCallback(targetBlock);
    blok.BlockManager.currentBlock = targetBlock;

    if (blok.BlockSettings.opened) {
      blok.BlockSettings.close();
    } else {
      void blok.BlockSettings.open(targetBlock, this.settingsTogglerElement ?? undefined);
    }
  }
}
