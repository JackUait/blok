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
       * Includes placeholder styling via pseudo-element
       */
      block: 'py-[theme(spacing.block-padding-vertical)] px-0 [&::-webkit-input-placeholder]:!leading-normal',

      /**
       * Inline Tools styles
       */
      inlineToolButton: 'flex justify-center items-center border-0 rounded h-full p-0 w-7 bg-transparent cursor-pointer leading-normal text-black',
      inlineToolButtonActive: 'bg-icon-active-bg text-icon-active-text',

      /**
       * Input element styles with Firefox placeholder workaround
       */
      input: 'w-full rounded-[3px] border border-line-gray px-3 py-2.5 outline-none shadow-input [&[data-blok-placeholder]]:before:!static [&[data-blok-placeholder]]:before:inline-block [&[data-blok-placeholder]]:before:w-0 [&[data-blok-placeholder]]:before:whitespace-nowrap [&[data-blok-placeholder]]:before:pointer-events-none',

      /**
       * Loader styles with spinning animation
       */
      loader: 'relative border border-line-gray before:absolute before:left-1/2 before:top-1/2 before:w-[18px] before:h-[18px] before:rounded-full before:content-[\'\'] before:-ml-[11px] before:-mt-[11px] before:border-2 before:border-line-gray before:border-l-active-icon before:animate-rotation',

      /**
       * Button styles with hover state
       */
      button: 'p-[13px] rounded-[3px] border border-line-gray text-[14.9px] bg-white text-center cursor-pointer text-gray-text shadow-button-base hover:bg-[#fbfcfe] hover:shadow-button-base-hover [&_svg]:h-5 [&_svg]:mr-[0.2em] [&_svg]:-mt-0.5',

      /**
       * Settings button base styles with mobile responsive sizing
       */
      settingsButton: 'inline-flex items-center justify-center rounded-[3px] cursor-pointer border-0 outline-none bg-transparent align-bottom text-inherit m-0 min-w-toolbox-btn min-h-toolbox-btn [&_svg]:w-auto [&_svg]:h-auto mobile:w-toolbox-btn-mobile mobile:h-toolbox-btn-mobile mobile:rounded-lg mobile:[&_svg]:w-icon-mobile mobile:[&_svg]:h-icon-mobile can-hover:hover:bg-bg-light',

      /**
       * Settings button active state
       */
      settingsButtonActive: 'text-active-icon',

      /**
       * Settings button focused state
       */
      settingsButtonFocused: 'shadow-button-focused bg-item-focus-bg',

      /**
       * Settings button focused with animation
       */
      settingsButtonFocusedAnimated: 'animate-button-clicked',
    };
  }
}
