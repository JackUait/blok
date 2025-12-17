/**
 * Style class names for tool styling.
 * These are single CSS class names that can be safely used with element.classList.add().
 * The actual styles are defined using Tailwind's @apply directive in the CSS.
 *
 * @example
 * // Add styles to an element
 * element.classList.add(api.styles.block);
 *
 * // Combine with other classes using tailwind-merge
 * import { twMerge } from '@jackuait/blok/utils/tw';
 * element.className = twMerge(api.styles.block, 'my-4 bg-gray-100');
 */
export interface Styles {
  /**
   * Base block styles - applied to block tool wrappers.
   * Provides vertical padding for consistent block spacing.
   * Includes placeholder styling via pseudo-element.
   *
   * @example 'blok-block'
   */
  block: string;

  /**
   * Styles for Inline Toolbar button.
   * Provides flexbox centering, transparent background, and proper sizing.
   *
   * @example 'blok-inline-tool-button'
   */
  inlineToolButton: string;

  /**
   * Styles for active Inline Toolbar button.
   * Apply alongside inlineToolButton when the tool is active.
   *
   * @example 'blok-inline-tool-button--active'
   */
  inlineToolButtonActive: string;

  /**
   * Styles for input elements.
   * Provides full width, border, padding, shadow, and Firefox placeholder workaround.
   *
   * @example 'blok-input'
   */
  input: string;

  /**
   * Loader styles for loading states.
   * Provides relative positioning, border, and spinning animation.
   *
   * @example 'blok-loader'
   */
  loader: string;

  /**
   * Styles for Settings box buttons.
   * Provides flexbox centering, transparent background, minimum sizing,
   * mobile responsive sizing, and hover states.
   *
   * @example 'blok-settings-button'
   */
  settingsButton: string;

  /**
   * Styles for active Settings box buttons.
   * Apply alongside settingsButton when the button is active.
   *
   * @example 'blok-settings-button--active'
   */
  settingsButtonActive: string;

  /**
   * Styles for focused Settings box buttons.
   * Apply alongside settingsButton when the button has focus.
   *
   * @example 'blok-settings-button--focused'
   */
  settingsButtonFocused: string;

  /**
   * Styles for focused Settings box buttons with animation.
   * Apply alongside settingsButton and settingsButtonFocused for click animation.
   *
   * @example 'blok-settings-button--focused-animated'
   */
  settingsButtonFocusedAnimated: string;

  /**
   * Styles for general buttons.
   * Provides padding, border, background, shadow, hover states, and SVG styling.
   *
   * @example 'blok-button'
   */
  button: string;
}
