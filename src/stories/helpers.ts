/**
 * Storybook test helpers for Blok editor stories.
 * These utilities help work around browser environment differences in Chromatic.
 */

import { Blok } from '../blok';
import type { OutputData, BlokConfig, ToolConstructable, ToolSettings, I18nConfig } from '@/types';

/**
 * Test ID selectors used in story tests
 */
export const TOOLBAR_TESTID = '[data-blok-testid="toolbar"]';

/**
 * Configuration options for the shared editor factory
 */
export interface EditorFactoryOptions {
  /** Minimum height of the editor container in pixels */
  minHeight?: number;
  /** Width of the editor container in pixels (optional, defaults to auto) */
  width?: number;
  /** Initial data to populate the editor */
  data?: OutputData;
  /** Whether the editor is read-only */
  readOnly?: boolean;
  /** Placeholder text for empty blocks */
  placeholder?: string;
  /** Whether to autofocus the editor */
  autofocus?: boolean;
  /** Tools configuration */
  tools?: { [toolName: string]: ToolConstructable | ToolSettings };
  /** i18n configuration (e.g., for RTL support) */
  i18n?: I18nConfig;
}

/**
 * Extended HTMLElement interface that stores the Blok editor instance
 */
export interface EditorContainer extends HTMLElement {
  __blokEditor?: Blok;
}

/** Shared editor state to avoid let declarations */
const editorState: { editor: Blok | null; holder: HTMLElement | null } = {
  editor: null,
  holder: null,
};

/**
 * Creates an editor container with a Blok editor instance.
 * Reuses a single shared editor instance across stories when possible.
 *
 * @param options - Configuration options for the editor
 * @returns HTMLElement container with the editor
 */
export const createEditorContainer = (options: EditorFactoryOptions = {}): HTMLElement => {
  const {
    minHeight = 300,
    width,
    data,
    readOnly = false,
    placeholder,
    autofocus = false,
    tools,
    i18n,
  } = options;

  const container = document.createElement('div') as EditorContainer;

  container.style.border = '1px solid #e0e0e0';
  container.style.borderRadius = '8px';
  container.style.padding = '16px';
  container.style.minHeight = `${minHeight}px`;
  container.style.backgroundColor = '#fff';
  container.setAttribute('data-story-container', 'true');

  if (width) {
    container.style.width = `${width}px`;
  }

  const editorHolder = document.createElement('div');

  editorHolder.id = `blok-editor-${Date.now()}`;
  container.appendChild(editorHolder);

  const config: BlokConfig = {
    holder: editorHolder,
    autofocus,
    readOnly,
    data,
    placeholder,
    tools,
    i18n,
  };

  // Clean up and initialize editor after DOM is ready
  setTimeout(async () => {
    // Destroy previous editor if it exists and holder changed
    if (editorState.editor && editorState.holder !== editorHolder) {
      try {
        await editorState.editor.destroy();
      } catch {
        // Editor may already be destroyed
      }
      editorState.editor = null;
    }

    // Create new editor instance
    const editor = new Blok(config);

    await editor.isReady;
    await waitForIdleCallback();

    // Store references
    editorState.editor = editor;
    editorState.holder = editorHolder;
    container.__blokEditor = editor;
  }, 0);

  return container;
};

/**
 * Gets the current shared editor instance (if available)
 */
export const getSharedEditor = (): Blok | null => editorState.editor;

/**
 * Cleans up the shared editor instance
 */
export const destroySharedEditor = async (): Promise<void> => {
  if (editorState.editor) {
    try {
      await editorState.editor.destroy();
    } catch {
      // Editor may already be destroyed
    }
    editorState.editor = null;
    editorState.holder = null;
  }
};

/**
 * Simulates a full click sequence (mousedown → mouseup → click) with proper event bubbling.
 * This is needed because userEvent.click() doesn't properly trigger mousedown events
 * in headless browser environments like Chromatic.
 */
export const simulateClick = (element: Element): void => {
  const rect = element.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;

  const eventOptions = {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button: 0,
  };

  element.dispatchEvent(new MouseEvent('mousedown', eventOptions));
  element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
  element.dispatchEvent(new MouseEvent('click', eventOptions));

  if (element instanceof HTMLElement) {
    element.focus();
  }
};

/**
 * Waits for requestIdleCallback to fire, ensuring toolbar is fully initialized.
 * This is needed because toolbar UI is created in requestIdleCallback.
 */
export const waitForIdleCallback = (): Promise<void> => {
  return new Promise<void>((resolve) => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 100 });
    } else {
      setTimeout(resolve, 0);
    }
  });
};

/**
 * Waits for the toolbar element to be present in the DOM.
 * The toolbar is created in requestIdleCallback with a 2000ms timeout,
 * so we need to poll for its existence.
 * @param container - The container element to search within
 * @param timeout - Maximum time to wait in ms (default: 3000)
 */
export const waitForToolbar = (container: Element, timeout = 3000): Promise<Element> => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const checkInterval = 50;

    const check = (): void => {
      const toolbar = container.querySelector(TOOLBAR_TESTID);

      if (toolbar) {
        resolve(toolbar);

        return;
      }

      if (Date.now() - startTime >= timeout) {
        reject(new Error(`Toolbar not found within ${timeout}ms`));

        return;
      }

      setTimeout(check, checkInterval);
    };

    check();
  });
};

/**
 * Key codes used for keyboard event simulation
 */
const KEY_CODES: Record<string, number> = {
  TAB: 9,
  ENTER: 13,
  ARROW_LEFT: 37,
  ARROW_UP: 38,
  ARROW_RIGHT: 39,
  ARROW_DOWN: 40,
};

/**
 * Dispatches a keyboard event from a target element or finds a suitable target.
 * This is needed because userEvent.keyboard() may not properly trigger
 * document-level event listeners in headless browser environments.
 * @param key - The key to simulate (e.g., 'ArrowDown', 'Enter', 'Tab')
 * @param options - Additional event options (ctrlKey, metaKey, shiftKey, target)
 */
export const dispatchKeyboardEvent = (
  key: string,
  options: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; target?: Element } = {}
): void => {
  const keyCode = KEY_CODES[key.toUpperCase().replace('ARROW', 'ARROW_')] ?? 0;

  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key,
    code: key,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
  });

  // Set keyCode for older browser compatibility
  Object.defineProperty(event, 'keyCode', { get: () => keyCode });
  Object.defineProperty(event, 'which', { get: () => keyCode });

  // Dispatch from the target element if provided, otherwise from body
  // This ensures event.target has proper DOM methods like closest()
  const targetElement = options.target ?? document.activeElement ?? document.body;

  targetElement.dispatchEvent(event);
};

/**
 * Simulates typing text by dispatching keyboard events and input events.
 * This is needed for search/filter functionality that listens to document-level events.
 * @param text - The text to type
 */
export const simulateTyping = (text: string): void => {
  for (const char of text) {
    const keydownEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: char,
      code: `Key${char.toUpperCase()}`,
    });

    document.dispatchEvent(keydownEvent);

    // Also dispatch keypress for compatibility
    const keypressEvent = new KeyboardEvent('keypress', {
      bubbles: true,
      cancelable: true,
      key: char,
      code: `Key${char.toUpperCase()}`,
    });

    document.dispatchEvent(keypressEvent);
  }
};

/**
 * Triggers a select-all action using the cross-platform shortcut.
 * Uses Ctrl+A which works in Chromium browser (used by storybook tests).
 * @param element - The element to focus before triggering select-all
 */
export const triggerSelectAll = (element: Element): void => {
  if (element instanceof HTMLElement) {
    element.focus();
  }

  // Dispatch Ctrl+A (works in Chromium, which is used for storybook tests)
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'a',
    code: 'KeyA',
    ctrlKey: true,
    metaKey: false,
  });

  Object.defineProperty(event, 'keyCode', { get: () => 65 });
  Object.defineProperty(event, 'which', { get: () => 65 });

  element.dispatchEvent(event);
};

/**
 * Selects text within a block, handling DOM normalization (e.g., <b> → <strong>).
 * Focuses the contenteditable element and creates a proper selection.
 * @param block - The block wrapper element containing the contenteditable
 * @param selector - CSS selector for the element to select (e.g., 'strong', 'em', 'a')
 * @param contentEditableSelector - Selector for the contenteditable element
 * @returns True if selection was created successfully
 */
export const selectTextInBlock = (
  block: Element,
  selector: string,
  contentEditableSelector = '[contenteditable="true"]'
): boolean => {
  const contentEditable = block.querySelector(contentEditableSelector);
  const targetElement = block.querySelector(selector);

  if (!contentEditable || !targetElement) {
    return false;
  }

  // Focus the contenteditable first to ensure selection is rendered
  if (contentEditable instanceof HTMLElement) {
    contentEditable.focus();
  }

  // Create and apply the selection
  const range = document.createRange();

  range.selectNodeContents(targetElement);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);

  // Dispatch selectionchange event to trigger toolbar
  document.dispatchEvent(new Event('selectionchange'));

  return true;
};

/**
 * Focuses the popover search input and types text into it.
 * This is needed because userEvent.keyboard() types into the wrong element.
 * @param text - The text to type into the search input
 * @param searchInputSelector - Selector for the search input
 * @returns True if search was performed successfully
 */
export const focusSearchInput = (
  text: string,
  searchInputSelector = '[data-blok-testid="popover-search-input"]'
): boolean => {
  const searchInput = document.querySelector(searchInputSelector) as HTMLInputElement | null;

  if (!searchInput) {
    return false;
  }

  searchInput.focus();
  searchInput.value = text;
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));

  return true;
};

/**
 * Waits for an element to have pointer-events enabled.
 * This is needed because popover containers start with pointer-events: none.
 * @param selector - CSS selector for the element to check
 * @param timeout - Maximum time to wait in ms (default: 3000)
 */
export const waitForPointerEvents = (selector: string, timeout = 3000): Promise<Element> => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const checkInterval = 50;

    const check = (): void => {
      const isTimedOut = Date.now() - startTime >= timeout;
      const element = document.querySelector(selector);

      if (!element && isTimedOut) {
        reject(new Error(`Element ${selector} did not get pointer-events enabled within ${timeout}ms`));

        return;
      }

      if (!element) {
        setTimeout(check, checkInterval);

        return;
      }

      const computedStyle = window.getComputedStyle(element);

      if (computedStyle.pointerEvents !== 'none') {
        resolve(element);

        return;
      }

      if (isTimedOut) {
        reject(new Error(`Element ${selector} did not get pointer-events enabled within ${timeout}ms`));

        return;
      }

      setTimeout(check, checkInterval);
    };

    check();
  });
};
