/**
 * Tailwind CSS class names for popover component
 *
 * Classes are organized into:
 * - Structural classes (blok-popover*): Keep BEM naming for CSS variable support and complex state selectors
 * - Utility classes: Pure Tailwind utilities for simple, static styles
 */
export const css = {
  // Structural classes - require CSS file for CSS variables and state-based selectors
  popover: 'blok-popover',
  popoverContainer: 'blok-popover__container',
  popoverOpenTop: 'blok-popover--open-top',
  popoverOpenLeft: 'blok-popover--open-left',
  popoverOpened: 'blok-popover--opened',
  popoverNested: 'blok-popover--nested',
  popoverInline: 'blok-popover--inline',
  overlay: 'blok-popover__overlay',
  getPopoverNestedClass: (level: number) => `blok-popover--nested-level-${level.toString()}`,

  // Utility classes - pure Tailwind
  search: 'mb-1.5',
  items: 'blok-popover__items overflow-y-auto overscroll-contain',
  overlayHidden: 'is-hidden',
  nothingFoundMessage: 'hidden cursor-default text-sm leading-5 font-medium whitespace-nowrap overflow-hidden text-ellipsis text-gray-text p-[3px]',
  nothingFoundMessageDisplayed: '!block',
  popoverHeader: 'flex items-center mb-2 mt-1',
};

/**
 * Data attribute name for opened state
 */
export const DATA_ATTRIBUTE_OPENED = 'data-blok-popover-opened';

/**
 * Data attribute name for nested state
 */
export const DATA_ATTRIBUTE_NESTED = 'data-blok-nested';

/**
 * Data attribute name for open-top state
 */
export const DATA_ATTRIBUTE_OPEN_TOP = 'data-blok-popover-open-top';

/**
 * Data attribute name for open-left state
 */
export const DATA_ATTRIBUTE_OPEN_LEFT = 'data-blok-popover-open-left';

/**
 * Data attribute name for nothing found message displayed state
 */
export const DATA_ATTRIBUTE_NOTHING_FOUND_DISPLAYED = 'data-blok-nothing-found-displayed';

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
