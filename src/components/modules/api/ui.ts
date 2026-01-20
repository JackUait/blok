import type { Ui, UiNodes } from '../../../../types/api';
import { Module } from '../../__module';

/**
 * API module allowing to access some Blok UI elements
 */
export class UiAPI extends Module {
  /**
   * Available methods / getters
   */
  public get methods(): Ui {
    // Capture the UI module reference in a closure
    const uiModule = this.Blok.UI;

    return {
      nodes: this.blokNodes,
      get isMobile(): boolean {
        return uiModule.isMobile;
      },
      /**
       * There can be added some UI methods, like toggleThinMode() etc
       */
    };
  }

  /**
   * Exported classes
   */
  private get blokNodes(): UiNodes {
    return {
      /**
       * Top-level blok instance wrapper
       */
      wrapper: this.Blok.UI.nodes.wrapper,

      /**
       * Element that holds all the Blocks
       */
      redactor: this.Blok.UI.nodes.redactor,
    };
  }
}
