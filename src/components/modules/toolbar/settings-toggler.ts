import type { Block } from '../../block';
import type { BlokModules } from '../../../types-internal/blok-modules';
import type { ClickDragHandler } from './click-handler';
import { createTooltipContent } from './tooltip';
import { Dom as $ } from '../../dom';
import { DATA_ATTR } from '../../constants';
import { onHover } from '../../utils/tooltip';
import { IconMenu } from '../../icons';
import type { ToolbarNodes } from './types';
import { hide } from '../../utils/tooltip';

/**
 * SettingsTogglerHandler manages the settings toggler (drag handle) behavior.
 * Creates the settings toggler element with tooltip.
 */
export class SettingsTogglerHandler {
  /**
   * Reference to the Blok modules for accessing BlockManager, BlockSettings, etc.
   */
  private Blok: BlokModules;

  /**
   * The block near which we display the Toolbar
   */
  private hoveredBlock: Block | null = null;

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
   * @param blok - Reference to Blok modules
   * @param clickDragHandler - Click-vs-drag handler instance
   * @param callbacks - Object containing callback functions
   */
  constructor(
    blok: BlokModules,
    clickDragHandler: ClickDragHandler,
    callbacks: {
      setHoveredBlock: (block: Block) => void;
      getToolboxOpened: () => boolean;
      closeToolbox: () => void;
    }
  ) {
    this.Blok = blok;
    this.clickDragHandler = clickDragHandler;
    this.setHoveredBlockCallback = callbacks.setHoveredBlock;
    this.getToolboxOpened = callbacks.getToolboxOpened;
    this.closeToolbox = callbacks.closeToolbox;
  }

  /**
   * Gets the current hovered block
   */
  public get getHoveredBlock(): Block | null {
    return this.hoveredBlock;
  }

  /**
   * Sets the hovered block
   */
  public setHoveredBlock(block: Block | null): void {
    this.hoveredBlock = block;
  }

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
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- CSS getter now returns Tailwind classes
      this.Blok.Toolbar.CSS.settingsToggler,
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
      this.Blok.I18n.t('a11y.dragHandle')
    );
    settingsToggler.setAttribute(
      'aria-roledescription',
      this.Blok.I18n.t('a11y.dragHandleRole')
    );

    // eslint-disable-next-line no-param-reassign -- nodes is mutated by design
    nodes.settingsToggler = settingsToggler;

    /**
     * Add events to show/hide tooltip for settings toggler
     */
    const blockTunesTooltip = createTooltipContent([
      this.Blok.I18n.t('blockSettings.dragToMove'),
      this.Blok.I18n.t('blockSettings.clickToOpenMenu'),
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
    /**
     * Cancel any pending drag tracking since we're opening the settings menu
     * This prevents the drag from starting when the user moves their mouse to the menu
     */
    this.Blok.DragManager.cancelTracking();

    /**
     * Prefer the hovered block (desktop), fall back to the current block (mobile) so tapping the toggler still works
     */
    const targetBlock = this.hoveredBlock ?? this.Blok.BlockManager.currentBlock;

    if (!targetBlock) {
      return;
    }

    this.hoveredBlock = targetBlock;
    this.setHoveredBlockCallback(targetBlock);
    this.Blok.BlockManager.currentBlock = targetBlock;

    if (this.Blok.BlockSettings.opened) {
      this.Blok.BlockSettings.close();
    } else {
      void this.Blok.BlockSettings.open(targetBlock, this.Blok.Toolbar.nodes.settingsToggler);
    }
  }
}
