/**
 * Shortcut definition for keyboard shortcuts
 */
export interface ShortcutDefinition {
  /** The key to listen for (lowercase, e.g., 'b' for Cmd+B) */
  key: string;
  /** Whether Meta key (Cmd on Mac) is required */
  meta?: boolean;
  /** Whether Ctrl key is required */
  ctrl?: boolean;
}

/**
 * Handler interface for inline tool events
 */
export interface InlineToolEventHandler {
  /** Called when keyboard shortcut fires */
  onShortcut?(event: KeyboardEvent, selection: Selection): void;

  /**
   * Called when a shortcut matches, before the event is intercepted. Return
   * false to let the keystroke fall through to the browser's default handling
   * (i.e. do NOT preventDefault / call onShortcut). Used by bold/italic to let
   * the browser apply its native pending inline-format on a collapsed caret,
   * which is race-free and works consistently across engines (WebKit only
   * applies pending format via its own default handler, not scripted commands).
   */
  shouldHandleShortcut?(selection: Selection): boolean;

  /** Called on selection changes */
  onSelectionChange?(selection: Selection): void;

  /** Called after input events */
  onInput?(event: Event, selection: Selection): void;

  /** Called before input - return true to prevent default */
  onBeforeInput?(event: InputEvent, selection: Selection): boolean;

  /** Shortcut definition */
  shortcut?: ShortcutDefinition;

  /** Check if this handler applies to current selection context */
  isRelevant?(selection: Selection): boolean;
}

/**
 * Singleton manager for inline tool document-level events
 */
export class InlineToolEventManager {
  private static instance: InlineToolEventManager | null = null;
  private readonly handlers = new Map<string, InlineToolEventHandler>();
  private listenersRegistered = false;

  private constructor() {
    this.initializeListeners();
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): InlineToolEventManager {
    if (!InlineToolEventManager.instance) {
      InlineToolEventManager.instance = new InlineToolEventManager();
    }

    return InlineToolEventManager.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  public static reset(): void {
    if (InlineToolEventManager.instance) {
      InlineToolEventManager.instance.removeListeners();
      InlineToolEventManager.instance.handlers.clear();
    }
    InlineToolEventManager.instance = null;
  }

  /**
   * Register a handler for an inline tool
   * @param toolName - Unique identifier for the tool
   * @param handler - Event handler configuration
   */
  public register(toolName: string, handler: InlineToolEventHandler): void {
    this.handlers.set(toolName, handler);
  }

  /**
   * Unregister a handler
   * @param toolName - The tool to unregister
   */
  public unregister(toolName: string): void {
    this.handlers.delete(toolName);
  }

  /**
   * Check if a handler is registered
   * @param toolName - The tool to check
   */
  public hasHandler(toolName: string): boolean {
    return this.handlers.has(toolName);
  }

  /**
   * Initialize document-level event listeners
   */
  private initializeListeners(): void {
    if (typeof document === 'undefined' || this.listenersRegistered) {
      return;
    }

    document.addEventListener('selectionchange', this.handleSelectionChange, true);
    document.addEventListener('input', this.handleInput, true);
    document.addEventListener('beforeinput', this.handleBeforeInput, true);
    document.addEventListener('keydown', this.handleKeydown, true);

    this.listenersRegistered = true;
  }

  /**
   * Remove document-level event listeners
   */
  private removeListeners(): void {
    if (typeof document === 'undefined' || !this.listenersRegistered) {
      return;
    }

    document.removeEventListener('selectionchange', this.handleSelectionChange, true);
    document.removeEventListener('input', this.handleInput, true);
    document.removeEventListener('beforeinput', this.handleBeforeInput, true);
    document.removeEventListener('keydown', this.handleKeydown, true);

    this.listenersRegistered = false;
  }

  /**
   * Get current selection if available
   */
  private getSelection(): Selection | null {
    return typeof window !== 'undefined' ? window.getSelection() : null;
  }

  /**
   * Handle selectionchange events
   */
  private handleSelectionChange = (): void => {
    const selection = this.getSelection();

    if (!selection) {
      return;
    }

    this.handlers.forEach((handler) => {
      if (handler.isRelevant && !handler.isRelevant(selection)) {
        return;
      }

      handler.onSelectionChange?.(selection);
    });
  };

  /**
   * Handle input events
   */
  private handleInput = (event: Event): void => {
    const selection = this.getSelection();

    if (!selection) {
      return;
    }

    this.handlers.forEach((handler) => {
      if (handler.isRelevant && !handler.isRelevant(selection)) {
        return;
      }

      handler.onInput?.(event, selection);
    });
  };

  /**
   * Handle beforeinput events
   */
  private handleBeforeInput = (event: Event): void => {
    const inputEvent = event as InputEvent;
    const selection = this.getSelection();

    if (!selection) {
      return;
    }

    this.handlers.forEach((handler) => {
      if (handler.isRelevant && !handler.isRelevant(selection)) {
        return;
      }

      const shouldPrevent = handler.onBeforeInput?.(inputEvent, selection);

      if (shouldPrevent) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    });
  };

  /**
   * Handle keydown events for shortcuts
   */
  private handleKeydown = (event: KeyboardEvent): void => {
    const selection = this.getSelection();

    if (!selection || !selection.rangeCount) {
      return;
    }

    this.handlers.forEach((handler) => {
      if (!handler.shortcut || !handler.onShortcut) {
        return;
      }

      if (!this.matchesShortcut(event, handler.shortcut)) {
        return;
      }

      if (handler.isRelevant && !handler.isRelevant(selection)) {
        return;
      }

      // Let the handler opt out of interception so the browser applies its own
      // native behavior for this keystroke (e.g. pending bold on a collapsed
      // caret). When opted out we neither preventDefault nor run onShortcut.
      if (handler.shouldHandleShortcut && !handler.shouldHandleShortcut(selection)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      handler.onShortcut(event, selection);
    });
  };

  /**
   * Check if a keyboard event matches a shortcut definition
   */
  private matchesShortcut(event: KeyboardEvent, shortcut: ShortcutDefinition): boolean {
    if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) {
      return false;
    }

    if (event.altKey) {
      return false;
    }

    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
    const isMac = userAgent.includes('mac');

    const primaryModifier = isMac ? event.metaKey : event.ctrlKey;
    const metaRequired = shortcut.meta && !primaryModifier;

    if (metaRequired) {
      return false;
    }

    if (shortcut.ctrl && !event.ctrlKey) {
      return false;
    }

    return true;
  }
}
