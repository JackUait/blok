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

  private constructor() {}

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
}
