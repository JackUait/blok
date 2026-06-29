/**
 * @class BlockShortcuts
 * @classdesc Handles keyboard shortcuts for block movement
 * @module BlockShortcuts
 */
import { Shortcut } from '../../utils/shortcut';

/**
 * Shortcut handler callbacks
 */
export interface BlockShortcutsHandlers {
  /** Handler for moving block up */
  onMoveUp: () => void;
  /** Handler for moving block down */
  onMoveDown: () => void;
  /** Handler for copying the selection as Markdown (Notion's Cmd/Ctrl+Shift+C) */
  onCopyAsMarkdown: () => void;
  /** Handler for duplicating the current block / selection (Notion's Cmd/Ctrl+D) */
  onDuplicate: () => void;
}

/**
 * BlockShortcuts handles keyboard shortcuts for block movement
 *
 * Responsibilities:
 * - Register/unregister keyboard shortcuts (CMD+SHIFT+UP, CMD+SHIFT+DOWN)
 * - Check if shortcut should be handled (is target within editor)
 * - Delegate to provided handlers for move up/down actions
 */
export class BlockShortcuts {
  private readonly wrapper: HTMLElement;
  private readonly handlers: BlockShortcutsHandlers;

  /**
   * This editor's own keydown shortcuts, bound directly to `document`.
   *
   * We deliberately do NOT use the global `Shortcuts` singleton here: it keys
   * handlers by (element, name) and throws on a duplicate, so two editors on the
   * same page would evict each other's `document`-level CMD+D / move handlers —
   * leaving every editor but the last-initialized one silently dead. Per-instance
   * `Shortcut` objects coexist; `shouldHandleShortcut` keeps each editor scoped
   * to its own wrapper/selection so they never cross-fire.
   */
  private shortcuts: Shortcut[] = [];

  /**
   * Pending registration timer, so unregister() can cancel a not-yet-fired register().
   */
  private registerTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param wrapper - Editor wrapper element
   * @param handlers - Shortcut handler callbacks
   */
  constructor(wrapper: HTMLElement, handlers: BlockShortcutsHandlers) {
    this.wrapper = wrapper;
    this.handlers = handlers;
  }

  /**
   * Register keyboard shortcuts for block movement
   * Uses setTimeout to wait for UI to be ready (same pattern as History module)
   */
  public register(): void {
    // Idempotent: tear down any prior/pending registration so re-registering
    // never stacks duplicate listeners on document.
    this.unregister();

    this.registerTimeout = setTimeout(() => {
      this.registerTimeout = null;

      const definitions: Array<{ name: string; handler: () => void }> = [
        // Move block up/down: Cmd/Ctrl+Shift+Arrow.
        { name: 'CMD+SHIFT+UP', handler: this.handlers.onMoveUp },
        { name: 'CMD+SHIFT+DOWN', handler: this.handlers.onMoveDown },
        // Copy selection as Markdown: Cmd/Ctrl+Shift+C.
        { name: 'CMD+SHIFT+C', handler: this.handlers.onCopyAsMarkdown },
        // Duplicate block(s): Cmd/Ctrl+D.
        { name: 'CMD+D', handler: this.handlers.onDuplicate },
      ];

      for (const { name, handler } of definitions) {
        this.shortcuts.push(new Shortcut({
          name,
          on: document,
          callback: (event: KeyboardEvent) => {
            if (!this.shouldHandleShortcut(event)) {
              return;
            }
            event.preventDefault();
            handler();
          },
        }));
      }
    }, 0);
  }

  /**
   * Unregister all keyboard shortcuts
   */
  public unregister(): void {
    if (this.registerTimeout !== null) {
      clearTimeout(this.registerTimeout);
      this.registerTimeout = null;
    }

    for (const shortcut of this.shortcuts) {
      shortcut.remove();
    }
    this.shortcuts = [];
  }

  /**
   * Determines whether the block movement shortcut should be handled.
   *
   * The common case is a caret inside a block: the event targets a
   * contenteditable within the wrapper. But block-level / navigation selection
   * blurs that contenteditable, so the keydown then targets document.body —
   * outside the wrapper — even though THIS editor still owns the selection.
   * Without a fallback, Cmd+Shift+Arrow / Cmd+D silently do nothing whenever a
   * block is selected. Fall back to "does this wrapper currently hold a selected
   * block?", which stays multi-editor safe because each instance only inspects
   * its own subtree.
   * @param event - Keyboard event
   * @returns true if shortcut should be handled
   */
  private shouldHandleShortcut(event: KeyboardEvent): boolean {
    const target = event.target;

    if (target instanceof HTMLElement && this.wrapper.contains(target)) {
      return true;
    }

    return this.wrapper.querySelector('[data-blok-selected="true"], [data-blok-navigation-focused="true"]') !== null;
  }
}
