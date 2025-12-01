import type { Styles } from '../../../../types/api';
import Module from '../../__module';

/**
 *
 */
export default class StylesAPI extends Module {
  /**
   * Exported classes
   */
  public get classes(): Styles {
    return {
      /**
       * Base Block styles
       */
      block: 'blok-base-element',

      /**
       * Inline Tools styles
       */
      inlineToolButton: 'blok-inline-tool',
      inlineToolButtonActive: 'is-active',

      /**
       * UI elements
       */
      input: 'blok-base-input',
      loader: 'blok-base-loader',
      button: 'blok-base-button',

      /**
       * Settings styles
       */
      settingsButton: 'blok-base-settings-button',
      settingsButtonActive: 'is-active',
    };
  }
}
