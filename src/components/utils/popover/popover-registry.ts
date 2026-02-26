import type { PopoverAbstract } from './popover-abstract';

/**
 * Entry in the popover registry stack
 */
interface PopoverRegistryEntry {
  popover: PopoverAbstract;
  triggerElement: HTMLElement;
}

/**
 * Singleton registry that manages open popovers.
 * Enforces mutual exclusion (only one popover open at a time)
 * and handles click-outside-to-close behavior.
 */
export class PopoverRegistry {
  /**
   * Singleton instance
   */
  private static _instance: PopoverRegistry | null = null;

  /**
   * Returns the singleton instance, creating it if necessary
   */
  static get instance(): PopoverRegistry {
    if (PopoverRegistry._instance === null) {
      PopoverRegistry._instance = new PopoverRegistry();
    }

    return PopoverRegistry._instance;
  }

  /**
   * Resets the singleton for testing purposes.
   * Destroys the existing instance and creates a fresh one.
   */
  static resetForTests(): PopoverRegistry {
    PopoverRegistry._instance?.destroy();
    PopoverRegistry._instance = new PopoverRegistry();

    return PopoverRegistry._instance;
  }

  /**
   * Stack of currently registered popover entries
   */
  private stack: PopoverRegistryEntry[] = [];

  /**
   * Bound reference to the pointerdown handler for add/remove symmetry
   */
  private boundPointerDown: ((e: PointerEvent) => void) | null = null;

  /**
   * Registers a popover with mutual exclusion.
   * Closes all existing popovers, then adds the new one to the stack.
   * @param popover - the popover instance to register
   * @param triggerElement - the element that triggered this popover
   */
  public register(popover: PopoverAbstract, triggerElement: HTMLElement): void {
    const existingEntries = [...this.stack];

    for (const entry of existingEntries) {
      if (entry.popover === popover) {
        continue;
      }
      entry.popover.hide();
      this.removeFromStack(entry.popover);
    }

    this.stack.push({ popover, triggerElement });
    this.ensureDocumentListener();
  }

  /**
   * Unregisters a popover, removing it from the stack.
   * Removes the document listener if the stack becomes empty.
   * @param popover - the popover instance to unregister
   */
  public unregister(popover: PopoverAbstract): void {
    this.removeFromStack(popover);

    if (this.stack.length === 0) {
      this.removeDocumentListener();
    }
  }

  /**
   * Closes the topmost popover on the stack by calling hide().
   * @returns true if a popover was closed, false if the stack was empty
   */
  public closeTopmost(): boolean {
    if (this.stack.length === 0) {
      return false;
    }

    const topmost = this.stack[this.stack.length - 1];

    topmost.popover.hide();

    return true;
  }

  /**
   * Checks whether any popovers are currently registered
   */
  public hasOpenPopovers(): boolean {
    return this.stack.length > 0;
  }

  /**
   * Cleans up the registry: removes the document listener and clears the stack
   */
  public destroy(): void {
    this.removeDocumentListener();
    this.stack = [];
  }

  /**
   * Handles pointerdown events on the document.
   * Walks the stack in reverse (topmost first). For each entry:
   * - If the click target is inside the popover, stop (click is inside).
   * - If the click target is inside the trigger element, stop (click is on trigger).
   * - Otherwise, close the popover by calling hide().
   * @param event - the pointerdown event
   */
  private handleDocumentPointerDown(event: PointerEvent): void {
    const target = event.target;

    if (!(target instanceof Node)) {
      return;
    }

    const entriesToClose: PopoverRegistryEntry[] = [];

    for (const entry of [...this.stack].reverse()) {
      if (entry.popover.hasNode(target)) {
        break;
      }

      if (entry.triggerElement.contains(target)) {
        break;
      }

      entriesToClose.push(entry);
    }

    for (const entry of entriesToClose) {
      entry.popover.hide();
    }
  }

  /**
   * Lazily adds the pointerdown listener to the document when there are entries in the stack
   */
  private ensureDocumentListener(): void {
    if (this.boundPointerDown !== null) {
      return;
    }

    this.boundPointerDown = (e: PointerEvent): void => this.handleDocumentPointerDown(e);
    document.addEventListener('pointerdown', this.boundPointerDown);
  }

  /**
   * Removes the pointerdown listener from the document
   */
  private removeDocumentListener(): void {
    if (this.boundPointerDown === null) {
      return;
    }

    document.removeEventListener('pointerdown', this.boundPointerDown);
    this.boundPointerDown = null;
  }

  /**
   * Removes a popover from the stack by reference
   * @param popover - popover to remove
   */
  private removeFromStack(popover: PopoverAbstract): void {
    const index = this.stack.findIndex(entry => entry.popover === popover);

    if (index !== -1) {
      this.stack.splice(index, 1);
    }
  }
}
