/**
 * Describes styles API - provides Tailwind CSS utility classes for tool styling.
 *
 * All values are Tailwind utility class strings that can be extended using tailwind-merge.
 *
 * @example
 * // Basic usage
 * element.className = api.styles.block;
 *
 * @example
 * // Extending with custom styles using tailwind-merge
 * import { twMerge } from 'tailwind-merge';
 * const customBlock = twMerge(api.styles.block, 'my-4 bg-gray-100');
 *
 * @since 2.0.0 - Changed from BEM class names to Tailwind utility strings
 */
export interface Styles {
  /**
   * Base block styles - applied to block tool wrappers.
   * Provides vertical padding for consistent block spacing.
   * Includes placeholder styling via pseudo-element.
   *
   * @example 'py-[theme(spacing.block-padding-vertical)] px-0 [&::-webkit-input-placeholder]:!leading-normal'
   */
  block: string;

  /**
   * Styles for Inline Toolbar button.
   * Provides flexbox centering, transparent background, and proper sizing.
   *
   * @example 'flex justify-center items-center border-0 rounded h-full p-0 w-7 bg-transparent cursor-pointer'
   */
  inlineToolButton: string;

  /**
   * Styles for active Inline Toolbar button.
   * Apply alongside inlineToolButton when the tool is active.
   *
   * @example 'bg-icon-active-bg text-icon-active-text'
   */
  inlineToolButtonActive: string;

  /**
   * Styles for input elements.
   * Provides full width, border, padding, shadow, and Firefox placeholder workaround.
   *
   * @example 'w-full rounded-[3px] border border-line-gray px-3 py-2.5 outline-none shadow-input'
   */
  input: string;

  /**
   * Loader styles for loading states.
   * Provides relative positioning, border, and spinning animation.
   *
   * @example 'relative border border-line-gray before:animate-rotation'
   */
  loader: string;

  /**
   * Styles for Settings box buttons.
   * Provides flexbox centering, transparent background, minimum sizing,
   * mobile responsive sizing, and hover states.
   *
   * @example 'inline-flex items-center justify-center rounded-[3px] cursor-pointer'
   */
  settingsButton: string;

  /**
   * Styles for active Settings box buttons.
   * Apply alongside settingsButton when the button is active.
   *
   * @example 'text-active-icon'
   */
  settingsButtonActive: string;

  /**
   * Styles for focused Settings box buttons.
   * Apply alongside settingsButton when the button has focus.
   *
   * @example 'shadow-button-focused bg-item-focus-bg'
   */
  settingsButtonFocused: string;

  /**
   * Styles for focused Settings box buttons with animation.
   * Apply alongside settingsButton and settingsButtonFocused for click animation.
   *
   * @example 'animate-button-clicked'
   */
  settingsButtonFocusedAnimated: string;

  /**
   * Styles for general buttons.
   * Provides padding, border, background, shadow, hover states, and SVG styling.
   *
   * @example 'p-[13px] rounded-[3px] border border-line-gray text-[14.9px] bg-white'
   */
  button: string;
}
