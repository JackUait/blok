import { PopoverItemParams } from './popover-item';
import type { Flipper } from '../../../src/components/flipper';
import { PopoverEvent } from './popover-event';

/**
 * Params required to render popover
 */
export interface PopoverParams {
  /**
   * Popover items config
   */
  items: PopoverItemParams[];

  /**
   * Element of the page that creates 'scope' of the popover.
   * Depending on its size popover position will be calculated
   */
  scopeElement?: HTMLElement;

  /**
   * Element relative to which the popover should be positioned
   */
  trigger?: HTMLElement;

  /**
   * Optional position (DOMRect) to use for positioning instead of trigger element.
   * When provided, this takes precedence over trigger's getBoundingClientRect().
   * Useful for positioning at caret location or other dynamic positions.
   */
  position?: DOMRect;

  /**
   * True if popover should contain search field
   */
  searchable?: boolean;

  /**
   * False if keyboard navigation should be disabled.
   * True by default
   */
  flippable?: boolean;

  /**
   * Optional flipper instance to reuse for keyboard navigation
   */
  flipper?: Flipper;

  /**
   * Allow keyboard navigation from contenteditable elements.
   * When true, arrow keys will navigate the popover even when focus is in a contenteditable.
   * False by default.
   */
  handleContentEditableNavigation?: boolean;

  /**
   * Popover texts overrides
   */
  messages?: PopoverMessages

  /**
   * CSS class name for popover root element
   */
  class?: string;

  /**
   * Popover nesting level. 0 value means that it is a root popover
   */
  nestingLevel?: number;

  /**
   * Callback fired when user navigates back (ArrowLeft) from nested popover.
   * Used to close nested popover and return focus to parent.
   */
  onNavigateBack?: () => void;

  /**
   * Width of the popover. Defaults to '280px'.
   * Use 'auto' to fit content width.
   */
  width?: string;

  /**
   * Minimum width of the popover in pixels (e.g. '250px').
   * When width is 'auto', the measured content width is clamped
   * to at least this value.
   */
  minWidth?: string;

  /**
   * Optional element whose left edge should be used for horizontal positioning.
   * When provided, the popover's left position uses this element's left coordinate
   * instead of the trigger's left. Useful for aligning the toolbox popover to the
   * block content area rather than to the plus button.
   */
  leftAlignElement?: HTMLElement;

  /**
   * When true, the popover is placed to the left of the trigger (right edge sits
   * one offset-gap before trigger's left edge) and vertically centered against the
   * trigger. Clamping to scope boundaries still applies.
   */
  placeLeftOfAnchor?: boolean;

  /**
   * Minimum distance (in pixels) between the popover and the viewport top/bottom
   * edges. Applied only together with placeLeftOfAnchor. Keeps the popover fully
   * inside the viewport — shifting upward if centered placement would overflow
   * the bottom — so it stays visible and close to the trigger.
   */
  viewportMargin?: number;

  /**
   * When true, the first item is focused when the popover opens (default behavior).
   * When false, no item is pre-focused — focus only appears after keyboard navigation.
   * Defaults to true. Has no effect when a search field is present (search receives focus instead).
   */
  autoFocusFirstItem?: boolean;
}


/**
 * Texts used inside popover
 */
export interface PopoverMessages {
  /** Text displayed when search has no results */
  nothingFound?: string;

  /** Search input label */
  search?: string
}


/**
 * Events fired by the Popover
 */
export interface PopoverEventMap {
  /**
   * Fired when popover closes
   */
  [PopoverEvent.Closed]: undefined;

  /**
   * Fired when popover closes because item with 'closeOnActivate' property set was clicked
   * Value is the item that was clicked
   */
  [PopoverEvent.ClosedOnActivate]: undefined;
}

/**
 * HTML elements required to display popover
 */
export interface PopoverNodes {
  /** Root popover element */
  popover: HTMLElement;

  /** Wraps all the visible popover elements, has background and rounded corners */
  popoverContainer: HTMLElement;

  /** Message displayed when no items found while searching */
  nothingFoundMessage: HTMLElement;

  /** Popover items wrapper */
  items: HTMLElement;

  /** Top scroll haze gradient overlay */
  scrollHazeTop: HTMLElement;

  /** Bottom scroll haze gradient overlay */
  scrollHazeBottom: HTMLElement;
}

/**
 * HTML elements required to display mobile popover
 */
export interface PopoverMobileNodes extends PopoverNodes {
  /** Popover header element */
  header: HTMLElement;

  /** Overlay, displayed under popover on mobile */
  overlay: HTMLElement;
}
