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
   *
   * @example 'py-[0.4em] px-0'
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
   * Provides full width, border, padding, and shadow.
   *
   * @example 'w-full rounded-[3px] border border-line-gray px-3 py-2.5 outline-none'
   */
  input: string;

  /**
   * Loader styles for loading states.
   * Provides relative positioning and border. Combine with CSS animation.
   *
   * @example 'relative border border-line-gray'
   */
  loader: string;

  /**
   * Styles for Settings box buttons.
   * Provides flexbox centering, transparent background, and minimum sizing.
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
   * Styles for general buttons.
   * Provides padding, border, background, and shadow.
   *
   * @example 'p-[13px] rounded-[3px] border border-line-gray text-[14.9px] bg-white'
   */
  button: string;
}
