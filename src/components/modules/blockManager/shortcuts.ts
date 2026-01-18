/**
 * @class BlockShortcuts
 * @classdesc Handles keyboard shortcuts for block movement
 * @module BlockShortcuts
 */
import { Shortcuts } from '../../utils/shortcuts';

/**
 * Shortcut handler callbacks
 */
export interface BlockShortcutsHandlers {
  /** Handler for moving block up */
  onMoveUp: () => void;
  /** Handler for moving block down */
  onMoveDown: () => void;
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
  private readonly registeredShortcutNames: string[] = [];

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
    setTimeout(() => {
    const shortcutNames = ['CMD+SHIFT+UP', 'CMD+SHIFT+DOWN'];

    // Clear any existing shortcuts to avoid duplicate registration errors
    for (const name of this.registeredShortcutNames) {
      Shortcuts.remove(document, name);
    }
    this.registeredShortcutNames.length = 0;

    // Clear shortcuts with same names that might already be registered
    for (const name of shortcutNames) {
      Shortcuts.remove(document, name);
    }

    // Move block up: Cmd+Shift+ArrowUp (Mac) / Ctrl+Shift+ArrowUp (Windows/Linux)
    Shortcuts.add({
      name: 'CMD+SHIFT+UP',
      on: document,
      handler: (event: KeyboardEvent) => {
        if (!this.shouldHandleShortcut(event)) {
          return;
        }
        event.preventDefault();
        this.handlers.onMoveUp();
      },
    });
    this.registeredShortcutNames.push('CMD+SHIFT+UP');

    // Move block down: Cmd+Shift+ArrowDown (Mac) / Ctrl+Shift+ArrowDown (Windows/Linux)
    Shortcuts.add({
      name: 'CMD+SHIFT+DOWN',
      on: document,
      handler: (event: KeyboardEvent) => {
        if (!this.shouldHandleShortcut(event)) {
          return;
        }
        event.preventDefault();
        this.handlers.onMoveDown();
      },
    });
    this.registeredShortcutNames.push('CMD+SHIFT+DOWN');
    }, 0);
  }

  /**
   * Unregister all keyboard shortcuts
   */
  public unregister(): void {
    for (const name of this.registeredShortcutNames) {
      Shortcuts.remove(document, name);
    }
    this.registeredShortcutNames.length = 0;
  }

  /**
   * Determines whether the block movement shortcut should be handled
   * @param event - Keyboard event
   * @returns true if shortcut should be handled
   */
  private shouldHandleShortcut(event: KeyboardEvent): boolean {
    const target = event.target;

    return target instanceof HTMLElement &&
      this.wrapper.contains(target);
  }
}
