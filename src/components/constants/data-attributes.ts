/**
 * Centralized data attributes used across the Blok editor.
 * This is the single source of truth for all data-blok-* attributes.
 *
 * Exported as Blok.DATA_ATTR for users.
 *
 * Naming convention:
 * - Remove 'data-blok-' prefix and convert to camelCase
 * - Global attributes: hidden, disabled, focused
 * - Component prefixed: popover, popoverItem, toolbar, etc.
 */
export const DATA_ATTR = {
  // ============================================
  // Core Element Identifiers
  // ============================================

  /** Interface type identifier (blok, inline-toolbar, tooltip) */
  interface: 'data-blok-interface',
  /** Block element wrapper */
  element: 'data-blok-element',
  /** Block element content wrapper */
  elementContent: 'data-blok-element-content',
  /** Editor wrapper container */
  editor: 'data-blok-editor',
  /** Redactor zone */
  redactor: 'data-blok-redactor',

  // ============================================
  // Block Identifiers
  // ============================================

  /** Block unique identifier */
  id: 'data-blok-id',
  /** Block component/tool type */
  component: 'data-blok-component',
  /** Tool type attribute */
  tool: 'data-blok-tool',
  /** Block nesting depth */
  depth: 'data-blok-depth',

  // ============================================
  // Global States
  // ============================================

  /** Element is hidden from view */
  hidden: 'data-blok-hidden',
  /** Element is disabled and non-interactive */
  disabled: 'data-blok-disabled',
  /** Element is focused via keyboard navigation */
  focused: 'data-blok-focused',
  /** Block is selected */
  selected: 'data-blok-selected',
  /** Block is stretched */
  stretched: 'data-blok-stretched',
  /** Editor or element is empty */
  empty: 'data-blok-empty',

  // ============================================
  // Editor Modes
  // ============================================

  /** Narrow mode state */
  narrow: 'data-blok-narrow',
  /** Right-to-left mode */
  rtl: 'data-blok-rtl',

  // ============================================
  // Drag and Drop
  // ============================================

  /** Block is being dragged */
  dragging: 'data-blok-dragging',
  /** Multiple blocks being dragged */
  draggingMulti: 'data-blok-dragging-multi',
  /** Block is being duplicated (Alt+drag) */
  duplicating: 'data-blok-duplicating',
  /** Drag handle element */
  dragHandle: 'data-blok-drag-handle',

  // ============================================
  // Toolbar
  // ============================================

  /** Toolbar element */
  toolbar: 'data-blok-toolbar',
  /** Settings toggler button */
  settingsToggler: 'data-blok-settings-toggler',
  /** Toolbox is open */
  toolboxOpened: 'data-blok-toolbox-opened',
  /** Block settings is open */
  blockSettingsOpened: 'data-blok-block-settings-opened',
  /** Element is opened (generic) */
  opened: 'data-blok-opened',

  // ============================================
  // Popover Container
  // ============================================

  /** Root popover element */
  popover: 'data-blok-popover',
  /** Popover container wrapper */
  popoverContainer: 'data-blok-popover-container',
  /** Popover items list */
  popoverItems: 'data-blok-popover-items',
  /** Popover overlay element */
  popoverOverlay: 'data-blok-popover-overlay',
  /** Popover custom content area */
  popoverCustomContent: 'data-blok-popover-custom-content',
  /** Popover custom class */
  popoverCustomClass: 'data-blok-popover-custom-class',
  /** Inline popover variant */
  popoverInline: 'data-blok-popover-inline',
  /** Popover is open */
  popoverOpened: 'data-blok-popover-opened',
  /** Popover opens upward */
  popoverOpenTop: 'data-blok-popover-open-top',
  /** Popover opens leftward */
  popoverOpenLeft: 'data-blok-popover-open-left',

  // ============================================
  // Popover Nesting
  // ============================================

  /** Nested popover indicator */
  nested: 'data-blok-nested',
  /** Nesting level value */
  nestedLevel: 'data-blok-nested-level',

  // ============================================
  // Popover Header
  // ============================================

  /** Header container */
  popoverHeader: 'data-blok-popover-header',
  /** Header text element */
  popoverHeaderText: 'data-blok-popover-header-text',
  /** Back button in nested popover */
  popoverHeaderBackButton: 'data-blok-popover-header-back-button',

  // ============================================
  // Popover Items
  // ============================================

  /** Item container */
  popoverItem: 'data-blok-popover-item',
  /** Item icon wrapper */
  popoverItemIcon: 'data-blok-popover-item-icon',
  /** Chevron icon for nested items */
  popoverItemIconChevronRight: 'data-blok-popover-item-icon-chevron-right',
  /** Item title text */
  popoverItemTitle: 'data-blok-popover-item-title',
  /** Item secondary title */
  popoverItemSecondaryTitle: 'data-blok-popover-item-secondary-title',
  /** Item is active/selected */
  popoverItemActive: 'data-blok-popover-item-active',
  /** Confirmation state */
  popoverItemConfirmation: 'data-blok-popover-item-confirmation',
  /** Disable hover styling */
  popoverItemNoHover: 'data-blok-popover-item-no-hover',
  /** Disable focus handling */
  popoverItemNoFocus: 'data-blok-popover-item-no-focus',
  /** Wobble animation */
  popoverItemWobble: 'data-blok-popover-item-wobble',
  /** Destructive action item (e.g. delete) */
  popoverItemDestructive: 'data-blok-popover-item-destructive',
  /** Separator item */
  popoverItemSeparator: 'data-blok-popover-item-separator',
  /** Separator line element */
  popoverItemSeparatorLine: 'data-blok-popover-item-separator-line',
  /** HTML-based item */
  popoverItemHtml: 'data-blok-popover-item-html',
  /** Item has child menu */
  hasChildren: 'data-blok-has-children',
  /** Item name identifier */
  itemName: 'data-blok-item-name',
  /** No search results shown */
  nothingFoundDisplayed: 'data-blok-nothing-found-displayed',

  // ============================================
  // Overlay / Selection
  // ============================================

  /** Selection overlay */
  overlay: 'data-blok-overlay',
  /** Overlay container */
  overlayContainer: 'data-blok-overlay-container',
  /** Selection rectangle */
  overlayRectangle: 'data-blok-overlay-rectangle',
  /** Overlay is hidden */
  overlayHidden: 'data-blok-overlay-hidden',
  /** Fake cursor indicator */
  fakeCursor: 'data-blok-fake-cursor',
  /** Fake background for selection */
  fakeBackground: 'data-blok-fake-background',

  // ============================================
  // Scroll
  // ============================================

  /** Auto-scroll zone (top/bottom) */
  scrollZone: 'data-blok-scroll-zone',
  /** Scroll is locked */
  scrollLocked: 'data-blok-scroll-locked',
  /** Hard scroll lock */
  scrollLockedHard: 'data-blok-scroll-locked-hard',

  // ============================================
  // Caret
  // ============================================

  /** Shadow caret element */
  shadowCaret: 'data-blok-shadow-caret',

  // ============================================
  // Placeholders
  // ============================================

  /** Placeholder text */
  placeholder: 'data-blok-placeholder',
  /** Active placeholder text */
  placeholderActive: 'data-blok-placeholder-active',

  // ============================================
  // Mutation Tracking
  // ============================================

  /** Element excluded from mutation tracking */
  mutationFree: 'data-blok-mutation-free',

  // ============================================
  // Navigation
  // ============================================

  /** Block has navigation focus */
  navigationFocused: 'data-blok-navigation-focused',
  /** Flipper navigation target */
  flipperNavigationTarget: 'data-blok-flipper-navigation-target',

  // ============================================
  // Inline Toolbar
  // ============================================

  /** Inline toolbar enabled on external element */
  inlineToolbar: 'data-blok-inline-toolbar',

  // ============================================
  // Link Tool
  // ============================================

  /** Link tool is active */
  linkToolActive: 'data-blok-link-tool-active',
  /** Link tool unlink mode */
  linkToolUnlink: 'data-blok-link-tool-unlink',
  /** Link tool input is opened */
  linkToolInputOpened: 'data-blok-link-tool-input-opened',

  // ============================================
  // Bold Tool
  // ============================================

  /** Bold collapsed length tracking */
  boldCollapsedLength: 'data-blok-bold-collapsed-length',
  /** Bold collapsed active state */
  boldCollapsedActive: 'data-blok-bold-collapsed-active',
  /** Bold previous length tracking */
  boldPrevLength: 'data-blok-bold-prev-length',
  /** Bold leading whitespace */
  boldLeadingWs: 'data-blok-bold-leading-ws',
  /** Bold marker */
  boldMarker: 'data-blok-bold-marker',

  // ============================================
  // Tooltip
  // ============================================

  /** Tooltip is shown */
  shown: 'data-blok-shown',
  /** Tooltip placement */
  placement: 'data-blok-placement',

  // ============================================
  // Notifier
  // ============================================

  /** Bounce in animation */
  bounceIn: 'data-blok-bounce-in',

  // ============================================
  // Announcer (Accessibility)
  // ============================================

  /** Live region announcer */
  announcer: 'data-blok-announcer',

  // ============================================
  // Stub Block
  // ============================================

  /** Stub block element */
  stub: 'data-blok-stub',
  /** Stub info section */
  stubInfo: 'data-blok-stub-info',
  /** Stub title */
  stubTitle: 'data-blok-stub-title',
  /** Stub subtitle */
  stubSubtitle: 'data-blok-stub-subtitle',

  // ============================================
  // Testing
  // ============================================

  /** Test identifier (for E2E tests) */
  testid: 'data-blok-testid',
  /** Force hover state (for tests/storybook) */
  forceHover: 'data-blok-force-hover',
} as const;

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
export const createSelector = (attr: DataAttrValue, value?: string | boolean): string => {
  if (value === undefined) {
    return `[${attr}]`;
  }

  return `[${attr}="${value}"]`;
};
