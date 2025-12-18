import { Module } from '../../__module';
import type { Ui, UiNodes } from '../../../../types/api';

/**
 * API module allowing to access some Blok UI elements
 */
export class UiAPI extends Module {
  /**
   * Available methods / getters
   */
  public get methods(): Ui {
    return {
      nodes: this.blokNodes,
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
