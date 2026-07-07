import { PopoverItemParams } from './popover-item';
import { PopoverEvent } from './popover-event';

/**
 * Public surface of the internal keyboard-navigation Flipper that a popover
 * exposes for reuse via {@link PopoverParams.flipper}.
 *
 * Declared structurally here (rather than imported from raw src) so the
 * published declarations stay self-contained: a bare `import` of the package
 * must never drag Blok's `.ts` source into a consumer's type program. The
 * concrete Flipper is internal — consumers never construct it; it is only
 * passed between Blok's own popovers.
 */
export interface Flipper {
  /** True while the flipper is handling keyboard navigation. */
  readonly isActivated: boolean;

  /** Begin handling keyboard navigation over the given items. */
  activate(items?: HTMLElement[], cursorPosition?: number): void;

  /** Stop handling keyboard navigation. */
  deactivate(): void;

  /** Focus the first navigable item. */
  focusFirst(): void;

  /** Focus the item at the given position. */
  focusItem(position: number, options?: { skipNextTab?: boolean }): void;

  /** True if a navigable item currently has focus. */
  hasFocus(): boolean;

  /** Register a callback fired on each flip (navigation step). */
  onFlip(cb: () => void): void;

  /** Remove a previously registered flip callback. */
  removeOnFlip(cb: () => void): void;

  /** Toggle handling of keydown events originating from contenteditable targets. */
  setHandleContentEditableTargets(value: boolean): void;

  /** Whether keydown events from contenteditable targets are handled. */
  getHandleContentEditableTargets(): boolean;

  /**
   * Sets the element that owns DOM focus while the popover is open. When set,
   * the iterator reflects the currently-highlighted item on it via
   * `aria-activedescendant`. Pass null to clear.
   */
  setActiveDescendantHost(host: HTMLElement | null): void;
}

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

  /**
   * Optional label describing what the popover targets (e.g. the active block name).
   * Rendered at the top, below the search input, before any items.
   */
  contextLabel?: string;

  /**
   * When true, the items container is exposed as an ARIA `listbox` (and its
   * default items as `option`s) instead of a `menu`. Used by search/combobox
   * surfaces such as the Toolbox.
   */
  listbox?: boolean;

  /**
   * Optional stable id applied to the items container (the `menu`/`listbox`
   * element). Lets an external combobox trigger reference it via `aria-controls`.
   */
  listboxId?: string;
}


/**
 * Texts used inside popover
 */
export interface PopoverMessages {
  /** Text displayed when search has no results */
  nothingFound?: string;

  /** Search input label */
  search?: string

  /** Group label shown above top-level matches in search results */
  actions?: string

  /**
   * Template announced to screen readers with the current result count while
   * filtering. Use the `{count}` placeholder, e.g. "{count} results".
   */
  searchResults?: string
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

  /** Visually-hidden polite live region announcing search result counts */
  resultsAnnouncer: HTMLElement;

  /** Optional label describing what the popover targets, rendered above items */
  contextLabel?: HTMLElement;

  /** Popover items wrapper */
  items: HTMLElement;
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
