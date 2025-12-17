/**
 * Centralized data attributes used across the Blok editor.
 * This is the single source of truth for all data-blok-* attributes.
 *
 * Access via Blok.DATA_ATTR
 */
export const DATA_ATTR: {
  // Core Element Identifiers
  readonly interface: 'data-blok-interface';
  readonly element: 'data-blok-element';
  readonly elementContent: 'data-blok-element-content';
  readonly editor: 'data-blok-editor';
  readonly redactor: 'data-blok-redactor';

  // Block Identifiers
  readonly id: 'data-blok-id';
  readonly component: 'data-blok-component';
  readonly tool: 'data-blok-tool';
  readonly depth: 'data-blok-depth';

  // Global States
  readonly hidden: 'data-blok-hidden';
  readonly disabled: 'data-blok-disabled';
  readonly focused: 'data-blok-focused';
  readonly selected: 'data-blok-selected';
  readonly stretched: 'data-blok-stretched';
  readonly empty: 'data-blok-empty';

  // Editor Modes
  readonly narrow: 'data-blok-narrow';
  readonly rtl: 'data-blok-rtl';

  // Drag and Drop
  readonly dragging: 'data-blok-dragging';
  readonly draggingMulti: 'data-blok-dragging-multi';
  readonly duplicating: 'data-blok-duplicating';
  readonly dragHandle: 'data-blok-drag-handle';

  // Toolbar
  readonly toolbar: 'data-blok-toolbar';
  readonly settingsToggler: 'data-blok-settings-toggler';
  readonly toolboxOpened: 'data-blok-toolbox-opened';
  readonly opened: 'data-blok-opened';

  // Popover Container
  readonly popover: 'data-blok-popover';
  readonly popoverContainer: 'data-blok-popover-container';
  readonly popoverItems: 'data-blok-popover-items';
  readonly popoverOverlay: 'data-blok-popover-overlay';
  readonly popoverCustomContent: 'data-blok-popover-custom-content';
  readonly popoverCustomClass: 'data-blok-popover-custom-class';
  readonly popoverInline: 'data-blok-popover-inline';
  readonly popoverOpened: 'data-blok-popover-opened';
  readonly popoverOpenTop: 'data-blok-popover-open-top';
  readonly popoverOpenLeft: 'data-blok-popover-open-left';

  // Popover Nesting
  readonly nested: 'data-blok-nested';
  readonly nestedLevel: 'data-blok-nested-level';

  // Popover Header
  readonly popoverHeader: 'data-blok-popover-header';
  readonly popoverHeaderText: 'data-blok-popover-header-text';
  readonly popoverHeaderBackButton: 'data-blok-popover-header-back-button';

  // Popover Items
  readonly popoverItem: 'data-blok-popover-item';
  readonly popoverItemIcon: 'data-blok-popover-item-icon';
  readonly popoverItemIconChevronRight: 'data-blok-popover-item-icon-chevron-right';
  readonly popoverItemTitle: 'data-blok-popover-item-title';
  readonly popoverItemSecondaryTitle: 'data-blok-popover-item-secondary-title';
  readonly popoverItemActive: 'data-blok-popover-item-active';
  readonly popoverItemConfirmation: 'data-blok-popover-item-confirmation';
  readonly popoverItemNoHover: 'data-blok-popover-item-no-hover';
  readonly popoverItemNoFocus: 'data-blok-popover-item-no-focus';
  readonly popoverItemWobble: 'data-blok-popover-item-wobble';
  readonly popoverItemSeparator: 'data-blok-popover-item-separator';
  readonly popoverItemSeparatorLine: 'data-blok-popover-item-separator-line';
  readonly popoverItemHtml: 'data-blok-popover-item-html';
  readonly hasChildren: 'data-blok-has-children';
  readonly itemName: 'data-blok-item-name';
  readonly nothingFoundDisplayed: 'data-blok-nothing-found-displayed';

  // Overlay / Selection
  readonly overlay: 'data-blok-overlay';
  readonly overlayContainer: 'data-blok-overlay-container';
  readonly overlayRectangle: 'data-blok-overlay-rectangle';
  readonly overlayHidden: 'data-blok-overlay-hidden';
  readonly fakeCursor: 'data-blok-fake-cursor';
  readonly fakeBackground: 'data-blok-fake-background';

  // Scroll
  readonly scrollZone: 'data-blok-scroll-zone';
  readonly scrollLocked: 'data-blok-scroll-locked';
  readonly scrollLockedHard: 'data-blok-scroll-locked-hard';

  // Caret
  readonly shadowCaret: 'data-blok-shadow-caret';

  // Placeholders
  readonly placeholder: 'data-blok-placeholder';
  readonly placeholderActive: 'data-blok-placeholder-active';

  // Mutation Tracking
  readonly mutationFree: 'data-blok-mutation-free';

  // Navigation
  readonly navigationFocused: 'data-blok-navigation-focused';
  readonly flipperNavigationTarget: 'data-blok-flipper-navigation-target';

  // Inline Toolbar
  readonly inlineToolbar: 'data-blok-inline-toolbar';

  // Link Tool
  readonly linkToolActive: 'data-blok-link-tool-active';
  readonly linkToolUnlink: 'data-blok-link-tool-unlink';
  readonly linkToolInputOpened: 'data-blok-link-tool-input-opened';

  // Bold Tool
  readonly boldCollapsedLength: 'data-blok-bold-collapsed-length';
  readonly boldCollapsedActive: 'data-blok-bold-collapsed-active';
  readonly boldPrevLength: 'data-blok-bold-prev-length';
  readonly boldLeadingWs: 'data-blok-bold-leading-ws';
  readonly boldMarker: 'data-blok-bold-marker';

  // Tooltip
  readonly shown: 'data-blok-shown';
  readonly placement: 'data-blok-placement';

  // Notifier
  readonly bounceIn: 'data-blok-bounce-in';

  // Announcer (Accessibility)
  readonly announcer: 'data-blok-announcer';

  // Stub Block
  readonly stub: 'data-blok-stub';
  readonly stubInfo: 'data-blok-stub-info';
  readonly stubTitle: 'data-blok-stub-title';
  readonly stubSubtitle: 'data-blok-stub-subtitle';

  // Testing
  readonly testid: 'data-blok-testid';
  readonly forceHover: 'data-blok-force-hover';
};

/**
 * Type for DATA_ATTR keys
 */
export type DataAttrKey = keyof typeof DATA_ATTR;

/**
 * Type for DATA_ATTR values
 */
export type DataAttrValue = (typeof DATA_ATTR)[DataAttrKey];

/**
 * Helper function to create a CSS selector from an attribute
 *
 * @param attr - The data attribute name from DATA_ATTR
 * @param value - Optional value for the attribute (defaults to presence selector)
 * @returns CSS selector string
 *
 * @example
 * createSelector(DATA_ATTR.element) // '[data-blok-element]'
 * createSelector(DATA_ATTR.selected, true) // '[data-blok-selected="true"]'
 * createSelector(DATA_ATTR.tool, 'paragraph') // '[data-blok-tool="paragraph"]'
 */
export const createSelector: (attr: DataAttrValue, value?: string | boolean) => string;
