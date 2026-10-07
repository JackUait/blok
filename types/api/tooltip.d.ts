/**
 * Tooltip API
 */

/**
 * Tooltip supported content
 */
export type TooltipContent = HTMLElement | DocumentFragment | Node | string;

/**
 * Base options interface for tooltips
 */
export interface TooltipOptions {
  /**
   * Tooltip placement: top|bottom|left|right
   */
  placement?: string;

  /**
   * Tooltip top margin
   */
  marginTop?: number;

  /**
   * Tooltip left margin
   */
  marginLeft?: number;

  /**
   * Tooltip right margin
   */
  marginRight?: number;

  /**
   * Tooltip bottom margin
   */
  marginBottom?: number;

  /**
   * Milliseconds to wait before the hint shows. Defaults to 500.
   * Values below 300 are raised to 300: a hint never shows instantly.
   */
  delay?: number;
}

export interface Tooltip {
  /**
   * Show tooltip after `delay`
   *
   * @param {HTMLElement} element
   * @param {TooltipContent} content
   * @param {TooltipOptions} options
   */
  show: (element: HTMLElement, content: TooltipContent, options?: TooltipOptions) => void;

  /**
   * Hides tooltip
   */
  hide: () => void;

  /**
   * Show the tooltip when the pointer hovers `element`, after `delay`.
   * Focus does not show it.
   *
   * @param {HTMLElement} element
   * @param {TooltipContent} content
   * @param {TooltipOptions} options
   */
  onHover: (element: HTMLElement, content: TooltipContent, options?: TooltipOptions) => void;

}
