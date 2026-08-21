/**
 * Centralized data attributes used across the Blok editor.
 * This is the single source of truth for all data-blok-* attributes.
 *
 * Access via Blok.DATA_ATTR
 *
 * AUTO-GENERATED from `src/components/constants/data-attributes.ts` by
 * `scripts/generate-data-attributes-dts.mjs`. Do NOT edit by hand — re-run the
 * script. Kept self-contained (no `../src` re-export) so consumers' `tsc` never
 * pulls raw implementation source into their program. Enforced by
 * `test/unit/architecture/published-types-no-src-refs.test.ts`.
 */
export const DATA_ATTR: {
  // Core Element Identifiers

  /** Interface type identifier (blok, inline-toolbar, tooltip) */
  readonly interface: 'data-blok-interface';
  /** Block element wrapper */
  readonly element: 'data-blok-element';
  /** Block element content wrapper */
  readonly elementContent: 'data-blok-element-content';
  /** Editor wrapper container */
  readonly editor: 'data-blok-editor';
  /** Per-instance discriminator on the editor wrapper (a monotonic counter, as a
   *  string). Two editors on one page share every other scope attribute, so this
   *  is what lets a page-level stylesheet — Blok's own injected `style.fontSize`
   *  sheet, or a host rule — address ONE editor. Public styling hook. */
  readonly instance: 'data-blok-instance';
  /** Redactor zone */
  readonly redactor: 'data-blok-redactor';
  /** Present on the editor wrapper once a `blocks.render()` batch has finished
   *  inserting blocks into the DOM; removed while a re-render is in flight.
   *  Acts as a stable render-readiness gate for consumers (e.g. E2E waits). */
  readonly rendered: 'data-blok-rendered';
  /** Blok version number stamped on the editor wrapper (e.g. '1.10.0', 'dev').
   *  Consumed by browser extensions to identify the running version. */
  readonly version: 'data-blok-version';

  // Block Identifiers

  /** Block unique identifier */
  readonly id: 'data-blok-id';
  /** Block component/tool type */
  readonly component: 'data-blok-component';
  /** Tool type attribute */
  readonly tool: 'data-blok-tool';
  /** Block nesting depth (derived from the parentId chain) */
  readonly depth: 'data-blok-depth';
  /** Flat list-nesting indentation level (0 = root); tool-agnostic, mirrors list depth */
  readonly indent: 'data-blok-indent';
  /** Header tool's heading level (1-6). Public styling hook — keyed by level rather
   *  than by tag name, so a level remapped to a custom tag via `levelOverrides[n].tag`
   *  (types/tools/header.d.ts) still matches its level's typography rules. */
  readonly headingLevel: 'data-blok-heading-level';

  // Global States

  /** Element is hidden from view */
  readonly hidden: 'data-blok-hidden';
  /** Element is disabled and non-interactive */
  readonly disabled: 'data-blok-disabled';
  /** Element is focused via keyboard navigation */
  readonly focused: 'data-blok-focused';
  /** Block is selected */
  readonly selected: 'data-blok-selected';
  /** Block is stretched */
  readonly stretched: 'data-blok-stretched';
  /** Editor or element is empty */
  readonly empty: 'data-blok-empty';
  /** Present on the editor wrapper while read-only mode is active.
   *  Public styling hook — lets hosts key rules off the editing state
   *  without JS. Deliberately does NOT collapse the gutter: plain
   *  read-only still shows the block-hover copy-link control there, and
   *  in-place readOnly.set() flips must not shift the layout. */
  readonly readonly: 'data-blok-readonly';
  /** Present on the editor wrapper while read-only mode hides ALL editor
   *  controls (readOnly: { hideControls: true }). Public styling hook —
   *  drives the gutter auto-collapse for genuinely chromeless read-only. */
  readonly controlsHidden: 'data-blok-controls-hidden';
  /** Present on the editor wrapper when config.hideToolbar is true.
   *  Public styling hook — drives the gutter auto-collapse (the gutter
   *  exists solely to house the toolbar's +/⠿ controls). */
  readonly toolbarHidden: 'data-blok-toolbar-hidden';
  /** Which gutter the floating block controls occupy: 'left' (default,
   *  inline-start) or 'right' (inline-end). Written on the editor wrapper from
   *  config.toolbarPosition and kept in sync by `toolbar.setPosition()`.
   *  Public styling hook — drives the gutter swap and the actions-bar side. */
  readonly toolbarPosition: 'data-blok-toolbar-position';

  // Editor Modes

  /** Content alignment mode (left, center, right) */
  readonly contentAlign: 'data-blok-content-align';
  /** Right-to-left mode */
  readonly rtl: 'data-blok-rtl';
  /** Editor content width mode (present with value "full" for wide mode; absent = narrow) */
  readonly width: 'data-blok-width';
  /** Present on the editor wrapper when config.style.nativeSelection is true.
   *  Public styling hook — disables Blok's ::selection repaint (preflight.css)
   *  and re-points the fake-background highlight at the UA Highlight color
   *  (colors.css), so selection falls back to native/host-defined colors. */
  readonly nativeSelection: 'data-blok-native-selection';
  /** Present on the editor wrapper while a cross-block TEXT selection is painted.
   *  Suppresses the engine's own ::selection paint (main.css) so the
   *  ::highlight() sub-ranges are the only thing drawn — Chromium and Firefox
   *  paint such a range natively too and would otherwise double it up. */
  readonly crossSelection: 'data-blok-cross-selection';

  // Drag and Drop

  /** Block is being dragged */
  readonly dragging: 'data-blok-dragging';
  /** Multiple blocks being dragged */
  readonly draggingMulti: 'data-blok-dragging-multi';
  /** Block is being duplicated (Alt+drag) */
  readonly duplicating: 'data-blok-duplicating';
  /** Drag handle element */
  readonly dragHandle: 'data-blok-drag-handle';

  // Toolbar

  /** Toolbar element */
  readonly toolbar: 'data-blok-toolbar';
  /** The floating block-controls bar (plus button + drag/settings handle)
   *  inside the toolbar. Public styling hook — the side it docks to is driven
   *  from the wrapper's `data-blok-toolbar-position`. */
  readonly toolbarActions: 'data-blok-toolbar-actions';
  /** Settings toggler button */
  readonly settingsToggler: 'data-blok-settings-toggler';
  /** Toolbox is open */
  readonly toolboxOpened: 'data-blok-toolbox-opened';
  /** Block settings is open */
  readonly blockSettingsOpened: 'data-blok-block-settings-opened';
  /** Element is opened (generic) */
  readonly opened: 'data-blok-opened';

  // Popover Container

  /** Root popover element */
  readonly popover: 'data-blok-popover';
  /** Popover container wrapper */
  readonly popoverContainer: 'data-blok-popover-container';
  /** Popover items list */
  readonly popoverItems: 'data-blok-popover-items';
  /** Custom, engine-independent scrollbar thumb overlaid on the popover items */
  readonly popoverScrollbar: 'data-blok-popover-scrollbar';
  /** Stamped on the custom scrollbar thumb while it is being dragged (keeps it revealed) */
  readonly popoverScrollbarDragging: 'data-blok-dragging';
  /** Stamped on a scroll container while it is actively scrolling (reveals the auto-hidden scrollbar thumb) */
  readonly scrolling: 'data-blok-scrolling';
  /** Popover overlay element */
  readonly popoverOverlay: 'data-blok-popover-overlay';
  /** Popover custom content area */
  readonly popoverCustomContent: 'data-blok-popover-custom-content';
  /** Popover custom class */
  readonly popoverCustomClass: 'data-blok-popover-custom-class';
  /** Inline popover variant */
  readonly popoverInline: 'data-blok-popover-inline';
  /** Popover is open */
  readonly popoverOpened: 'data-blok-popover-opened';
  /** Popover opens upward */
  readonly popoverOpenTop: 'data-blok-popover-open-top';
  /** Popover opens leftward */
  readonly popoverOpenLeft: 'data-blok-popover-open-left';

  // Popover Nesting

  /** Nested popover indicator */
  readonly nested: 'data-blok-nested';
  /** Nesting level value */
  readonly nestedLevel: 'data-blok-nested-level';
  /** Group label for promoted search results from nested children */
  readonly promotedGroupLabel: 'data-blok-promoted-group-label';
  /** Group label for top-level matches in search results */
  readonly topLevelGroupLabel: 'data-blok-top-level-group-label';

  // Popover Header

  /** Header container */
  readonly popoverHeader: 'data-blok-popover-header';
  /** Header text element */
  readonly popoverHeaderText: 'data-blok-popover-header-text';
  /** Back button in nested popover */
  readonly popoverHeaderBackButton: 'data-blok-popover-header-back-button';

  // Popover Items

  /** Item container */
  readonly popoverItem: 'data-blok-popover-item';
  /** Item icon wrapper */
  readonly popoverItemIcon: 'data-blok-popover-item-icon';
  /** Chevron icon for nested items */
  readonly popoverItemIconChevronRight: 'data-blok-popover-item-icon-chevron-right';
  /** Item title text */
  readonly popoverItemTitle: 'data-blok-popover-item-title';
  /** Item secondary title */
  readonly popoverItemSecondaryTitle: 'data-blok-popover-item-secondary-title';
  /** Item is active/selected */
  readonly popoverItemActive: 'data-blok-popover-item-active';
  /** Item's child menu is currently open — keeps the trigger looking selected */
  readonly popoverItemChildrenOpen: 'data-blok-popover-item-children-open';
  /** Confirmation state */
  readonly popoverItemConfirmation: 'data-blok-popover-item-confirmation';
  /** Disable hover styling */
  readonly popoverItemNoHover: 'data-blok-popover-item-no-hover';
  /** Disable focus handling */
  readonly popoverItemNoFocus: 'data-blok-popover-item-no-focus';
  /** Destructive action item (e.g. delete) */
  readonly popoverItemDestructive: 'data-blok-popover-item-destructive';
  /** Separator item */
  readonly popoverItemSeparator: 'data-blok-popover-item-separator';
  /** Separator line element */
  readonly popoverItemSeparatorLine: 'data-blok-popover-item-separator-line';
  /** HTML-based item */
  readonly popoverItemHtml: 'data-blok-popover-item-html';
  /** Item has child menu */
  readonly hasChildren: 'data-blok-has-children';
  /** Item name identifier */
  readonly itemName: 'data-blok-item-name';
  /** No search results shown */
  readonly nothingFoundDisplayed: 'data-blok-nothing-found-displayed';

  // Overlay / Selection

  /** Selection overlay */
  readonly overlay: 'data-blok-overlay';
  /** Overlay container */
  readonly overlayContainer: 'data-blok-overlay-container';
  /** Selection rectangle */
  readonly overlayRectangle: 'data-blok-overlay-rectangle';
  /** Overlay is hidden */
  readonly overlayHidden: 'data-blok-overlay-hidden';
  /** Fake cursor indicator */
  readonly fakeCursor: 'data-blok-fake-cursor';
  /** Fake background for selection */
  readonly fakeBackground: 'data-blok-fake-background';

  // Scroll

  /** Auto-scroll zone (top/bottom) */
  readonly scrollZone: 'data-blok-scroll-zone';
  /** Scroll is locked */
  readonly scrollLocked: 'data-blok-scroll-locked';
  /** Hard scroll lock */
  readonly scrollLockedHard: 'data-blok-scroll-locked-hard';

  // Caret

  /** Shadow caret element */
  readonly shadowCaret: 'data-blok-shadow-caret';

  // Placeholders

  /** Placeholder text */
  readonly placeholder: 'data-blok-placeholder';
  /** Active placeholder text */
  readonly placeholderActive: 'data-blok-placeholder-active';

  // Columns Layout

  /** The columns row rendered by the column_list tool (the flex container).
   *  Public styling hook — its direct `[data-blok-element]` children are the
   *  column holders, whose shrink floor reads `--blok-column-min-width` and
   *  whose gutter reads `--blok-column-gutter`. */
  readonly columns: 'data-blok-columns';
  /** A single column inside a columns row. */
  readonly column: 'data-blok-column';
  /** Drag-to-resize separator between two adjacent columns. Present only in
   *  edit mode — the separators ARE the gutter there. */
  readonly columnResizer: 'data-blok-column-resizer';
  /** Present on a columns row whose gutter comes from the container's own
   *  column-gap instead of from resizer elements. Set in read-only mode, where
   *  no resizers are built — the discriminator between an editable row and a
   *  published one. */
  readonly columnsStaticGutter: 'data-blok-columns-static-gutter';

  // Nested Blocks

  /** Container that hosts nested block holders (table cells, toggle/callout/header children).
   *  Used as a universal guard: before moving a block holder via appendChild,
   *  check `holder.closest([nestedBlocks])` — if truthy, the holder is already
   *  claimed by another container and must not be stolen. */
  readonly nestedBlocks: 'data-blok-nested-blocks';

  // Mutation Tracking

  /** Element excluded from mutation tracking */
  readonly mutationFree: 'data-blok-mutation-free';

  // Keyboard Ownership

  /** Marks a subtree whose keyboard belongs to the Tool that rendered it, not to
   *  the editor. Blok's block-level keydown/keyup handling stands down entirely
   *  for events originating inside it — Escape, Tab, the arrows, "/" and the
   *  Enter/Backspace/Delete structural keys all reach the element untouched.
   *
   *  Blok already exempts native `<input>`/`<textarea>` from the STRUCTURAL keys
   *  (Enter/Backspace/Delete and "/") because those are contenteditable-shaped
   *  and would splice the document around a form field. Escape/Tab/arrows are
   *  deliberately NOT exempt — they are how a user leaves a field. That default
   *  is right for a one-line title input and wrong for a field with its own
   *  keyboard semantics (Tab between sub-fields, Escape to cancel an edit, arrows
   *  to walk a suggestion list), which is exactly what this attribute is for.
   *  Public authoring hook. */
  readonly keyboardOwner: 'data-blok-keyboard-owner';

  // Navigation

  /** Block has navigation focus */
  readonly navigationFocused: 'data-blok-navigation-focused';
  /** Flipper navigation target */
  readonly flipperNavigationTarget: 'data-blok-flipper-navigation-target';

  // Inline Toolbar

  /** Inline toolbar enabled on external element */
  readonly inlineToolbar: 'data-blok-inline-toolbar';

  // Link Tool

  /** Link tool is active */
  readonly linkToolActive: 'data-blok-link-tool-active';
  /** Link tool unlink mode */
  readonly linkToolUnlink: 'data-blok-link-tool-unlink';
  /** Link tool input is opened */
  readonly linkToolInputOpened: 'data-blok-link-tool-input-opened';

  // Bold Tool

  /** Bold collapsed length tracking */
  readonly boldCollapsedLength: 'data-blok-bold-collapsed-length';
  /** Bold collapsed active state */
  readonly boldCollapsedActive: 'data-blok-bold-collapsed-active';
  /** Bold previous length tracking */
  readonly boldPrevLength: 'data-blok-bold-prev-length';
  /** Bold leading whitespace */
  readonly boldLeadingWs: 'data-blok-bold-leading-ws';
  /** Bold marker */
  readonly boldMarker: 'data-blok-bold-marker';

  // Tooltip

  /** Tooltip is shown */
  readonly shown: 'data-blok-shown';
  /** Tooltip placement */
  readonly placement: 'data-blok-placement';

  // Notifier

  /** Bounce in animation */
  readonly bounceIn: 'data-blok-bounce-in';

  // Announcer (Accessibility)

  /** Live region announcer */
  readonly announcer: 'data-blok-announcer';

  // Stub Block

  /** Stub block element */
  readonly stub: 'data-blok-stub';
  /** Stub info section */
  readonly stubInfo: 'data-blok-stub-info';
  /** Stub title */
  readonly stubTitle: 'data-blok-stub-title';
  /** Stub subtitle */
  readonly stubSubtitle: 'data-blok-stub-subtitle';

  // Slash Search

  /** Slash search active on content editable */
  readonly slashSearch: 'data-blok-slash-search';

  // Testing

  /** Test identifier (for E2E tests) */
  readonly testid: 'data-blok-testid';
  /** Force hover state (for tests/storybook) */
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
