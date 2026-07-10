import { hasEscapeLayer } from '../dismissable-layer';

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
   * Bound reference to the capture-phase keydown handler for add/remove symmetry
   */
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;

  /**
   * Bound reference to the capture-phase focusin handler for add/remove symmetry
   */
  private boundFocusIn: ((e: FocusEvent) => void) | null = null;

  /**
   * Registers a popover with mutual exclusion.
   *
   * Closes existing sibling popovers, then adds the new one to the stack. A
   * popover that is a DOM descendant of an already-registered popover (a nested
   * submenu appended inside its parent) is treated as a child: registering it
   * does NOT close its ancestor, so the parent stays open beneath the child.
   * @param popover - the popover instance to register
   * @param triggerElement - the element that triggered this popover
   */
  public register(popover: PopoverAbstract, triggerElement: HTMLElement): void {
    const newElement: HTMLElement | undefined = popover.getElement?.();
    const existingEntries = [...this.stack];

    for (const entry of existingEntries) {
      if (entry.popover === popover) {
        continue;
      }

      /**
       * Keep ancestors open: if the entry's popover contains the newly
       * registered popover's element, the new one is a nested child. Closing
       * it here would wrongly tear down the parent chain.
       */
      if (newElement !== undefined && entry.popover.hasNode(newElement)) {
        continue;
      }

      entry.popover.hide();
      this.removeFromStack(entry.popover);
    }

    /**
     * Dedupe guard: a second show() without an intervening hide() must refresh
     * the existing entry instead of pushing a duplicate — otherwise a single
     * unregister leaves a stale entry and hasOpenPopovers() sticks true.
     */
    const existingIndex = this.stack.findIndex(entry => entry.popover === popover);

    if (existingIndex !== -1) {
      this.stack.splice(existingIndex, 1);
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
    const { triggerElement } = topmost;

    /**
     * Eagerly drop the entry so a second dismissal path cannot close it again.
     * The editor's keyboard controller and this registry's own capture-phase
     * Escape backstop both route through closeTopmost; a real popover's hide()
     * unregisters itself, but removing here also protects callers whose hide()
     * does not, keeping the close single. removeFromStack is idempotent, so the
     * subsequent unregister inside hide() is a no-op.
     */
    this.removeFromStack(topmost.popover);

    if (this.stack.length === 0) {
      this.removeDocumentListener();
    }

    topmost.popover.hide();

    /**
     * Return keyboard focus to the element that opened the popover (Radix
     * DismissableLayer restore-focus contract). Only when the trigger is still
     * in the document — a stale trigger would throw or steal focus.
     */
    if (triggerElement.isConnected) {
      triggerElement.focus();
    }

    return true;
  }

  /**
   * Checks whether any popovers are currently registered
   */
  public hasOpenPopovers(): boolean {
    return this.stack.length > 0;
  }

  /**
   * Cleans up the registry: removes the document listeners and clears the stack
   */
  public destroy(): void {
    this.removeDocumentListener();
    this.stack = [];
  }

  /**
   * Capture-phase Escape backstop. The editor's keyboard controller already
   * routes Escape to {@link closeTopmost} in the common case, but it bails out
   * for two situations where a popover can still be open: focus in a
   * non-popover input, and read-only mode (where the redactor keydown listener
   * isn't registered). This document-level capture handler covers both by
   * closing the topmost popover whenever one is open. In the common case the
   * keyboard controller has already closed it, so the stack is empty here and
   * this is a no-op.
   * @param event - the keydown event
   */
  private handleDocumentKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return;
    }

    /**
     * Another dismissal path already consumed this press (the dismissable-layer
     * stack preventDefaults when it dismisses). One Escape = one dismissal.
     */
    if (event.defaultPrevented) {
      return;
    }

    /**
     * Defer to the dismissable-layer stack when it has an escape-participating
     * layer (toast/modal). Both registries attach capture-phase listeners on
     * document in unknowable order; this check makes the layer stack win in
     * both orderings, so a single Escape never peels a popover AND a layer.
     */
    if (hasEscapeLayer()) {
      return;
    }

    if (this.stack.length === 0) {
      return;
    }

    this.closeTopmost();
  }

  /**
   * Capture-phase focusin handler. Closes the topmost popover when focus lands
   * outside its subtree — outside the popover element, its trigger, and its
   * active-descendant host (the combobox contentEditable that owns focus for
   * search-driven popovers such as the Toolbox). Mirrors Radix
   * DismissableLayer's focus-out dismissal.
   * @param event - the focusin event
   */
  private handleDocumentFocusIn(event: FocusEvent): void {
    const target = event.target;

    if (!(target instanceof Node)) {
      return;
    }

    const topmost = this.stack[this.stack.length - 1];

    if (topmost === undefined) {
      return;
    }

    if (topmost.popover.hasNode(target)) {
      return;
    }

    if (topmost.triggerElement.contains(target)) {
      return;
    }

    const focusHost = topmost.popover.getFocusHost?.() ?? null;

    if (focusHost !== null && (focusHost === target || focusHost.contains(target))) {
      return;
    }

    topmost.popover.hide();
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
   * Lazily adds the document listeners when there are entries in the stack.
   * Escape and focusin use the capture phase so they fire before the target's
   * own handlers can swallow the event.
   */
  private ensureDocumentListener(): void {
    if (this.boundPointerDown !== null) {
      return;
    }

    this.boundPointerDown = (e: PointerEvent): void => this.handleDocumentPointerDown(e);
    this.boundKeyDown = (e: KeyboardEvent): void => this.handleDocumentKeyDown(e);
    this.boundFocusIn = (e: FocusEvent): void => this.handleDocumentFocusIn(e);

    document.addEventListener('pointerdown', this.boundPointerDown);
    document.addEventListener('keydown', this.boundKeyDown, true);
    document.addEventListener('focusin', this.boundFocusIn, true);
  }

  /**
   * Removes the document listeners
   */
  private removeDocumentListener(): void {
    if (this.boundPointerDown !== null) {
      document.removeEventListener('pointerdown', this.boundPointerDown);
      this.boundPointerDown = null;
    }

    if (this.boundKeyDown !== null) {
      document.removeEventListener('keydown', this.boundKeyDown, true);
      this.boundKeyDown = null;
    }

    if (this.boundFocusIn !== null) {
      document.removeEventListener('focusin', this.boundFocusIn, true);
      this.boundFocusIn = null;
    }
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
