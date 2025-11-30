/**
 * CSS class names to be used in popover
 * Uses Tailwind-compatible class names defined in popover.css
 */
export const css = {
  popover: 'blok-popover',
  popoverContainer: 'blok-popover__container',
  popoverOpenTop: 'blok-popover--open-top',
  popoverOpenLeft: 'blok-popover--open-left',
  popoverOpened: 'blok-popover--opened',
  search: 'blok-popover__search',
  nothingFoundMessage: 'blok-popover__nothing-found-message',
  nothingFoundMessageDisplayed: 'blok-popover__nothing-found-message--displayed',
  items: 'blok-popover__items',
  overlay: 'blok-popover__overlay',
  overlayHidden: 'blok-popover__overlay--hidden',
  popoverNested: 'blok-popover--nested',
  getPopoverNestedClass: (level: number) => `blok-popover--nested-level-${level.toString()}`,
  popoverInline: 'blok-popover--inline',
  popoverHeader: 'blok-popover-header',
};

/**
 * CSS variables names to be used in popover
 */
export enum CSSVariables {
  /**
   * Stores nesting level of the popover
   */
  NestingLevel = '--nesting-level',

  /**
   * Stores actual popover height. Used for desktop popovers
   */
  PopoverHeight = '--popover-height',

  /**
   * Width of the inline popover
   */
  InlinePopoverWidth = '--inline-popover-width',

  /**
   * Offset from left of the inline popover item click on which triggers the nested popover opening
   */
  TriggerItemLeft = '--trigger-item-left',

  /**
   * Offset from top of the desktop popover item click on which triggers the nested popover opening
   */
  TriggerItemTop = '--trigger-item-top',
}
