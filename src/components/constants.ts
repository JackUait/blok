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
 * CSS selector for the main editor wrapper element
 * Used to identify the editor container in the DOM
 */
export const EDITOR_INTERFACE_SELECTOR = '[data-interface=editorjs]';
