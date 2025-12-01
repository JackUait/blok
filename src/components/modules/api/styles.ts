import type { Styles } from '../../../../types/api';
import Module from '../../__module';

/**
 * StylesAPI provides Tailwind CSS utility classes for tool authors.
 *
 * These classes can be extended using tailwind-merge:
 * @example
 * import { twMerge } from '@jackuait/blok/utils/tw';
 * const customBlock = twMerge(api.styles.block, 'my-4 bg-gray-100');
 */
export default class StylesAPI extends Module {
  /**
   * Exported Tailwind utility classes for tool styling
   */
  public get classes(): Styles {
    return {
      /**
       * Base Block styles - applied to block tool wrappers
       */
      block: 'py-[0.4em] px-0',

      /**
       * Inline Tools styles
       */
      inlineToolButton: 'flex justify-center items-center border-0 rounded h-full p-0 w-7 bg-transparent cursor-pointer leading-normal text-black',
      inlineToolButtonActive: 'bg-icon-active-bg text-icon-active-text',

      /**
       * UI elements
       */
      input: 'w-full rounded-[3px] border border-line-gray px-3 py-2.5 outline-none shadow-input',
      loader: 'relative border border-line-gray',
      button: 'p-[13px] rounded-[3px] border border-line-gray text-[14.9px] bg-white text-center cursor-pointer text-gray-text shadow-button-base',

      /**
       * Settings styles
       */
      settingsButton: 'inline-flex items-center justify-center rounded-[3px] cursor-pointer border-0 outline-none bg-transparent align-bottom text-inherit m-0 min-w-toolbox-btn min-h-toolbox-btn',
      settingsButtonActive: 'text-active-icon',
    };
  }
}
