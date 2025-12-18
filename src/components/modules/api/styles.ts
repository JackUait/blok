import type { Styles } from '../../../../types/api';
import { Module } from '../../__module';

/**
 * StylesAPI provides CSS class names for tool authors.
 *
 * These are single class names that can be safely used with classList.add():
 * @example
 * element.classList.add(api.styles.block);
 *
 * They can also be extended using tailwind-merge:
 * @example
 * import { twMerge } from '@jackuait/blok/utils/tw';
 * const customBlock = twMerge(api.styles.block, 'my-4 bg-gray-100');
 */
export class StylesAPI extends Module {
  /**
   * Exported CSS class names for tool styling.
   * These are single class names that can be safely used with classList.add().
   * The actual styles are defined in src/styles/main.css using @apply.
   */
  public get classes(): Styles {
    return {
      /**
       * Base Block styles - applied to block tool wrappers
       * Includes placeholder styling via pseudo-element
       */
      block: 'blok-block',

      /**
       * Inline Tools styles
       */
      inlineToolButton: 'blok-inline-tool-button',
      inlineToolButtonActive: 'blok-inline-tool-button--active',

      /**
       * Input element styles with Firefox placeholder workaround
       */
      input: 'blok-input',

      /**
       * Loader styles with spinning animation
       */
      loader: 'blok-loader',

      /**
       * Button styles with hover state
       */
      button: 'blok-button',

      /**
       * Settings button base styles with mobile responsive sizing
       */
      settingsButton: 'blok-settings-button',

      /**
       * Settings button active state
       */
      settingsButtonActive: 'blok-settings-button--active',

      /**
       * Settings button focused state
       */
      settingsButtonFocused: 'blok-settings-button--focused',

      /**
       * Settings button focused with animation
       */
      settingsButtonFocusedAnimated: 'blok-settings-button--focused-animated',
    };
  }
}
