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
   * Timeout before showing
   */
  delay?: number;
}

export interface Tooltip {
  /**
   * Show tooltip
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
   * Decorator for showing Tooltip by mouseenter/mouseleave
   *
   * @param {HTMLElement} element
   * @param {TooltipContent} content
   * @param {TooltipOptions} options
   */
  onHover: (element: HTMLElement, content: TooltipContent, options?: TooltipOptions) => void;

}
