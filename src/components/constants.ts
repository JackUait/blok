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
 * Value for the data-blok-interface attribute on editor wrapper elements
 * Used as a single source of truth for editor identification
 */
export const EDITOR_INTERFACE_VALUE = 'editorjs';

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
 * CSS selector for the main editor wrapper element
 * Used to identify the editor container in the DOM
 */
export const EDITOR_INTERFACE_SELECTOR = '[data-blok-interface=editorjs]';

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
