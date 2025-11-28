import type { Toolbar } from '../../../../types/api';
import Module from '../../__module';
import * as _ from './../../utils';
/**
 * @class ToolbarAPI
 * Provides methods for working with the Toolbar
 */
export default class ToolbarAPI extends Module {
  /**
   * Available methods
   * @returns {Toolbar}
   */
  public get methods(): Toolbar {
    return {
      close: (): void => this.close(),
      open: (): void => this.open(),
      toggleBlockSettings: (openingState?: boolean): void => this.toggleBlockSettings(openingState),
      toggleToolbox: (openingState?: boolean): void => this.toggleToolbox(openingState),
    };
  }

  /**
   * Open toolbar
   */
  public open(): void {
    this.Blok.Toolbar.moveAndOpen();
  }

  /**
   * Close toolbar and all included elements
   */
  public close(): void {
    this.Blok.Toolbar.close();
  }

  /**
   * Toggles Block Setting of the current block
   * @param {boolean} openingState —  opening state of Block Setting
   */
  public toggleBlockSettings(openingState?: boolean): void {
    if (this.Blok.BlockManager.currentBlockIndex === -1) {
      _.logLabeled('Could\'t toggle the Toolbar because there is no block selected ', 'warn');

      return;
    }

    /** Check that opening state is set or not */
    const canOpenBlockSettings = openingState ?? !this.Blok.BlockSettings.opened;

    if (canOpenBlockSettings) {
      this.Blok.Toolbar.moveAndOpen();
      void this.Blok.BlockSettings.open();
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
      _.logLabeled('Could\'t toggle the Toolbox because there is no block selected ', 'warn');

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
