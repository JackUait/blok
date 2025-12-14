/**
 * Debounce timeout for selection change event
 * {@link modules/ui.ts}
 */
export const selectionChangeDebounceTimeout = 180;

/**
 * Timeout for batching of DOM changes used by the ModificationObserver
 * {@link modules/modificationsObserver.ts}
 */
export const modificationsObserverBatchTimeout = 400;

/**
 * The data-blok-interface attribute name
 * Used as a single source of truth for the data-blok-interface attribute
 */
export const DATA_INTERFACE_ATTRIBUTE = 'data-blok-interface';

/**
 * Value for the data-blok-interface attribute on blok wrapper elements
 * Used as a single source of truth for blok identification
 */
export const BLOK_INTERFACE_VALUE = 'blok';

/**
 * Value for the data-blok-interface attribute on inline toolbar elements
 * Used as a single source of truth for inline toolbar identification
 */
export const INLINE_TOOLBAR_INTERFACE_VALUE = 'inline-toolbar';

/**
 * Value for the data-blok-interface attribute on tooltip elements
 * Used as a single source of truth for tooltip identification
 */
export const TOOLTIP_INTERFACE_VALUE = 'tooltip';

/**
 * CSS selector for the main blok wrapper element
 * Used to identify the blok container in the DOM
 */
export const BLOK_INTERFACE_SELECTOR = '[data-blok-interface=blok]';

/**
 * CSS selector for tooltip elements
 * Used to identify tooltip elements in the DOM
 */
export const TOOLTIP_INTERFACE_SELECTOR = '[data-blok-interface="tooltip"]';

/**
 * CSS selector for inline toolbar elements
 * Used to identify inline toolbar elements in the DOM
 */
export const INLINE_TOOLBAR_INTERFACE_SELECTOR = '[data-blok-interface=inline-toolbar]';

/**
 * Platform-specific modifier key for keyboard shortcuts
 * Returns 'Meta' on macOS (darwin) and 'Control' on other platforms
 * Used in tests for keyboard shortcut interactions
 */
export const MODIFIER_KEY = (() => {
  // Check if we're in a Node.js environment
  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'darwin' ? 'Meta' : 'Control';
  }

  // Browser environment: detect macOS using navigator
  if (typeof navigator !== 'undefined') {
    const userAgent = navigator.userAgent.toLowerCase();
    const isMacOS = userAgent.includes('mac');

    return isMacOS ? 'Meta' : 'Control';
  }

  // Fallback to Control if platform detection fails
  return 'Control';
})();

/* ============================================
 * Data Attribute Constants
 * ============================================
 * These replace CSS class-based selectors with data attributes
 * for better separation of concerns (styling vs behavior/testing)
 */

/**
 * Block element wrapper attribute
 */
export const BLOK_ELEMENT_ATTR = 'data-blok-element';
export const BLOK_ELEMENT_SELECTOR = '[data-blok-element]';

/**
 * Block element content wrapper attribute
 */
export const BLOK_ELEMENT_CONTENT_ATTR = 'data-blok-element-content';
export const BLOK_ELEMENT_CONTENT_SELECTOR = '[data-blok-element-content]';

/**
 * Editor wrapper attribute
 */
export const BLOK_EDITOR_ATTR = 'data-blok-editor';
export const BLOK_EDITOR_SELECTOR = '[data-blok-editor]';

/**
 * Redactor zone attribute
 */
export const BLOK_REDACTOR_ATTR = 'data-blok-redactor';
export const BLOK_REDACTOR_SELECTOR = '[data-blok-redactor]';

/**
 * Narrow mode state attribute
 */
export const BLOK_NARROW_ATTR = 'data-blok-narrow';
export const BLOK_NARROW_SELECTOR = '[data-blok-narrow="true"]';

/**
 * RTL mode state attribute
 */
export const BLOK_RTL_ATTR = 'data-blok-rtl';
export const BLOK_RTL_SELECTOR = '[data-blok-rtl="true"]';

/**
 * Fake cursor attribute
 */
export const BLOK_FAKE_CURSOR_ATTR = 'data-blok-fake-cursor';
export const BLOK_FAKE_CURSOR_SELECTOR = '[data-blok-fake-cursor]';

/**
 * Selection overlay attribute
 */
export const BLOK_OVERLAY_ATTR = 'data-blok-overlay';
export const BLOK_OVERLAY_SELECTOR = '[data-blok-overlay]';

/**
 * Selection overlay container attribute
 */
export const BLOK_OVERLAY_CONTAINER_ATTR = 'data-blok-overlay-container';
export const BLOK_OVERLAY_CONTAINER_SELECTOR = '[data-blok-overlay-container]';

/**
 * Selection overlay rectangle attribute
 */
export const BLOK_OVERLAY_RECTANGLE_ATTR = 'data-blok-overlay-rectangle';
export const BLOK_OVERLAY_RECTANGLE_SELECTOR = '[data-blok-overlay-rectangle]';

/**
 * Scroll zone attribute with value for direction
 */
export const BLOK_SCROLL_ZONE_ATTR = 'data-blok-scroll-zone';
export const BLOK_SCROLL_ZONE_TOP_SELECTOR = '[data-blok-scroll-zone="top"]';
export const BLOK_SCROLL_ZONE_BOTTOM_SELECTOR = '[data-blok-scroll-zone="bottom"]';

/**
 * Toolbar attribute
 */
export const BLOK_TOOLBAR_ATTR = 'data-blok-toolbar';
export const BLOK_TOOLBAR_SELECTOR = '[data-blok-toolbar]';

/**
 * Settings toggler attribute (used as drag handle)
 */
export const BLOK_SETTINGS_TOGGLER_ATTR = 'data-blok-settings-toggler';
export const BLOK_SETTINGS_TOGGLER_SELECTOR = '[data-blok-settings-toggler]';

/**
 * Drag handle attribute for SortableJS block reordering
 * Used by SortableJS to identify the draggable element
 */
export const BLOK_DRAG_HANDLE_ATTR = 'data-blok-drag-handle';
export const BLOK_DRAG_HANDLE_SELECTOR = '[data-blok-drag-handle]';

/**
 * Tool type attribute for block tools
 * Value specifies the tool name: "paragraph", "header", "stub", etc.
 */
export const BLOK_TOOL_ATTR = 'data-blok-tool';
export const BLOK_TOOL_PARAGRAPH_SELECTOR = '[data-blok-tool="paragraph"]';
export const BLOK_TOOL_HEADER_SELECTOR = '[data-blok-tool="header"]';
export const BLOK_TOOL_STUB_SELECTOR = '[data-blok-tool="stub"]';
export const BLOK_TOOL_LIST_SELECTOR = '[data-blok-tool="list"]';

/**
 * Stub-specific attributes
 */
export const BLOK_STUB_ATTR = 'data-blok-stub';
export const BLOK_STUB_INFO_ATTR = 'data-blok-stub-info';
export const BLOK_STUB_TITLE_ATTR = 'data-blok-stub-title';
export const BLOK_STUB_SUBTITLE_ATTR = 'data-blok-stub-subtitle';

/* ============================================
 * State Attribute Constants
 * ============================================
 */

/**
 * Block selected state attribute
 */
export const BLOK_SELECTED_ATTR = 'data-blok-selected';
export const BLOK_SELECTED_SELECTOR = '[data-blok-selected="true"]';

/**
 * Block stretched state attribute
 */
export const BLOK_STRETCHED_ATTR = 'data-blok-stretched';
export const BLOK_STRETCHED_SELECTOR = '[data-blok-stretched="true"]';

/**
 * Hidden state attribute (for redactor)
 */
export const BLOK_HIDDEN_ATTR = 'data-blok-hidden';
export const BLOK_HIDDEN_SELECTOR = '[data-blok-hidden="true"]';

/**
 * Empty editor state attribute
 */
export const BLOK_EMPTY_ATTR = 'data-blok-empty';
export const BLOK_EMPTY_SELECTOR = '[data-blok-empty="true"]';

/**
 * Dragging state attribute
 */
export const BLOK_DRAGGING_ATTR = 'data-blok-dragging';
export const BLOK_DRAGGING_SELECTOR = '[data-blok-dragging="true"]';

/**
 * Multi-block dragging state attribute
 */
export const BLOK_DRAGGING_MULTI_ATTR = 'data-blok-dragging-multi';
export const BLOK_DRAGGING_MULTI_SELECTOR = '[data-blok-dragging-multi="true"]';

/**
 * Toolbox opened state attribute
 */
export const BLOK_TOOLBOX_OPENED_ATTR = 'data-blok-toolbox-opened';
export const BLOK_TOOLBOX_OPENED_SELECTOR = '[data-blok-toolbox-opened="true"]';

/**
 * Focused state attribute (for popover items)
 */
export const BLOK_FOCUSED_ATTR = 'data-blok-focused';
export const BLOK_FOCUSED_SELECTOR = '[data-blok-focused="true"]';
