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
 * The data-interface attribute name
 * Used as a single source of truth for the data-interface attribute
 */
export const DATA_INTERFACE_ATTRIBUTE = 'data-interface';

/**
 * Value for the data-interface attribute on editor wrapper elements
 * Used as a single source of truth for editor identification
 */
export const EDITOR_INTERFACE_VALUE = 'editorjs';

/**
 * Value for the data-interface attribute on inline toolbar elements
 * Used as a single source of truth for inline toolbar identification
 */
export const INLINE_TOOLBAR_INTERFACE_VALUE = 'inline-toolbar';

/**
 * Value for the data-interface attribute on tooltip elements
 * Used as a single source of truth for tooltip identification
 */
export const TOOLTIP_INTERFACE_VALUE = 'tooltip';

/**
 * CSS selector for the main editor wrapper element
 * Used to identify the editor container in the DOM
 */
export const EDITOR_INTERFACE_SELECTOR = '[data-interface=editorjs]';

/**
 * CSS selector for tooltip elements
 * Used to identify tooltip elements in the DOM
 */
export const TOOLTIP_INTERFACE_SELECTOR = '[data-interface="tooltip"]';

/**
 * CSS selector for inline toolbar elements
 * Used to identify inline toolbar elements in the DOM
 */
export const INLINE_TOOLBAR_INTERFACE_SELECTOR = '[data-interface=inline-toolbar]';
