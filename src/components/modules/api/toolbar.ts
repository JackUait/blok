import type { Toolbar, ToolbarBlockSettingsOptions, ToolbarCloseOptions } from '../../../../types/api';
import type { BlockControlsPosition } from '../../../../types/configs/blok-config';
import { Module } from '../../__module';

import { logLabeled } from './../../utils';
/**
 * @class ToolbarAPI
 * Provides methods for working with the Toolbar
 */
export class ToolbarAPI extends Module {
  /**
   * Available methods
   * @returns {Toolbar}
   */
  public get methods(): Toolbar {
    return {
      close: (options?: ToolbarCloseOptions): void => this.close(options),
      open: (): void => this.open(),
      toggleBlockSettings: (openingState?: boolean, trigger?: HTMLElement, options?: ToolbarBlockSettingsOptions): void => this.toggleBlockSettings(openingState, trigger, options),
      toggleToolbox: (openingState?: boolean): void => this.toggleToolbox(openingState),
      setHidden: (hidden: boolean): void => this.setHidden(hidden),
      setPosition: (position: BlockControlsPosition): void => this.setPosition(position),
    };
  }

  /**
   * Runtime setter for `config.hideToolbar`: hides/shows the hover toolbar
   * and collapses/restores the editor gutter reserved for it.
   * @param hidden - true to hide the hover toolbar
   */
  public setHidden(hidden: boolean): void {
    this.Blok.Toolbar.setHidden(hidden);
  }

  /**
   * Runtime setter for `config.toolbarPosition`: moves the floating block
   * controls between the editor's inline-start and inline-end gutters.
   * @param position - 'left' for the inline-start gutter, 'right' for inline-end
   */
  public setPosition(position: BlockControlsPosition): void {
    this.Blok.Toolbar.setPosition(position);
  }

  /**
   * Open toolbar
   */
  public open(): void {
    this.Blok.Toolbar.moveAndOpen();
  }

  /**
   * Close toolbar and all included elements
   * @param options - Optional configuration
   */
  public close(options?: ToolbarCloseOptions): void {
    this.Blok.Toolbar.close(options);
  }

  /**
   * Toggles Block Settings. With a trigger inside a block, the menu opens for that
   * block and it becomes the current block; otherwise it opens for the current block.
   * @param {boolean} openingState —  opening state of Block Setting
   * @param {HTMLElement} trigger — element to anchor the settings popover to
   * @param {ToolbarBlockSettingsOptions} options — additional popover placement overrides
   */
  public toggleBlockSettings(openingState?: boolean, trigger?: HTMLElement, options?: ToolbarBlockSettingsOptions): void {
    /** Check that opening state is set or not */
    const canOpenBlockSettings = openingState ?? !this.Blok.BlockSettings.opened;

    /**
     * Resolve the block from the trigger: pointerup on a non-editable button resets
     * currentBlock to the block that holds the caret. The write matters too: the
     * Delete tune deletes currentBlock, not the block passed to open().
     */
    const triggerBlock = canOpenBlockSettings && trigger !== undefined
      ? this.Blok.BlockManager.setCurrentBlockByChildNode(trigger)
      : undefined;

    if (this.Blok.BlockManager.currentBlockIndex === -1) {
      logLabeled('Could\'t toggle the Toolbar because there is no block selected ', 'warn');

      return;
    }

    if (canOpenBlockSettings) {
      this.Blok.Toolbar.moveAndOpen(triggerBlock);
      void this.Blok.BlockSettings.open(triggerBlock, trigger, options);
    } else {
      this.Blok.BlockSettings.close();
    }
  }


  /**
   * Open toolbox
   * @param {boolean} openingState - Opening state of toolbox
   */
  public toggleToolbox(openingState?: boolean): void {
    if (this.Blok.BlockManager.currentBlockIndex === -1) {
      logLabeled('Could\'t toggle the Toolbox because there is no block selected ', 'warn');

      return;
    }

    const canOpenToolbox = openingState ?? !this.Blok.Toolbar.toolbox.opened;

    if (canOpenToolbox) {
      this.Blok.Toolbar.moveAndOpen();
      this.Blok.Toolbar.toolbox.open();
    } else {
      this.Blok.Toolbar.toolbox.close();
    }
  }
}
