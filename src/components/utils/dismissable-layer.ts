/**
 * Shared dismissal-layer stack, adapted from Radix UI's DismissableLayer.
 *
 * Why this module exists
 * ----------------------
 * Blok has several floating surfaces (preview modal, crop editor, alt-text
 * popover, cover picker, notifier dialogs) that each hand-rolled their own
 * Escape / outside-click dismissal, using four different architectures. Some
 * listen on `document` in the bubble phase, some scope the listener to their
 * own element (which dies the moment focus moves out), and one registered a
 * listener it never removed.
 *
 * This module centralizes the contract: a caller registers a layer, and the
 * stack owns exactly one capture-phase `keydown` (Escape → dismiss the topmost
 * layer that opted into escape) and one capture-phase `pointerdown` (a press
 * outside the topmost layer → dismiss it). The listeners are installed lazily
 * on the first registration and removed when the stack empties — the same
 * module-registry idiom used by `top-layer.ts`.
 *
 * Only the topmost layer is dismissed per interaction, mirroring how nested
 * overlays behave: pressing Escape peels one layer at a time.
 */

/**
 * Why a layer is being dismissed. Escape and outside-pointer can map to
 * different actions (e.g. commit on click-away, cancel on Escape), so the
 * reason is forwarded to {@link DismissableLayerOptions.onDismiss}. It is
 * optional so pre-existing callers with a zero-arg `onDismiss` stay valid.
 */
export type DismissReason = 'escape' | 'outside';

/**
 * Options accepted when registering a dismissable layer.
 */
export interface DismissableLayerOptions {
  /**
   * The layer's root element. A pointerdown whose target is inside this
   * element (or inside {@link DismissableLayerOptions.anchor}) is treated as
   * "inside" and does not dismiss the layer.
   */
  element: HTMLElement;

  /**
   * Optional anchor/trigger element. Presses inside it are treated as inside
   * the layer, so clicking the element that opened the layer does not
   * immediately dismiss it.
   */
  anchor?: HTMLElement;

  /**
   * Called when the layer should be dismissed. Receives the dismissal reason
   * (`'escape'` or `'outside'`); the argument is optional so zero-arg handlers
   * remain valid.
   */
  onDismiss: (reason?: DismissReason) => void;

  /**
   * Whether Escape dismisses this layer. Defaults to `true`.
   */
  escape?: boolean;

  /**
   * Whether an outside pointerdown dismisses this layer. Defaults to `true`.
   */
  outside?: boolean;
}

/**
 * Internal stack entry with resolved defaults.
 */
interface LayerEntry {
  element: HTMLElement;
  anchor: HTMLElement | undefined;
  onDismiss: (reason?: DismissReason) => void;
  escape: boolean;
  outside: boolean;
}

/**
 * Module-level stack of registered layers. Topmost layer is the last entry.
 */
const stack: LayerEntry[] = [];

/**
 * Bound capture-phase keydown handler, non-null only while listeners are
 * installed.
 */
let boundKeyDown: ((event: KeyboardEvent) => void) | null = null;

/**
 * Bound capture-phase pointerdown handler, non-null only while listeners are
 * installed.
 */
let boundPointerDown: ((event: PointerEvent) => void) | null = null;

/**
 * Whether any registered layer participates in Escape dismissal. The popover
 * registry's capture-phase Escape backstop consults this to defer to the layer
 * stack, so one Escape press peels exactly one surface regardless of which
 * document listener was attached first.
 * @returns true when an escape-participating layer is registered
 */
export const hasEscapeLayer = (): boolean => stack.some((entry) => entry.escape);

/**
 * Returns true when the event target sits inside the layer's element or anchor.
 * @param entry - layer entry to test against
 * @param target - event target node
 */
const isInsideLayer = (entry: LayerEntry, target: Node): boolean => {
  if (entry.element.contains(target)) {
    return true;
  }

  return entry.anchor !== undefined && entry.anchor.contains(target);
};

/**
 * Handles Escape: dismisses the topmost layer that opted into escape
 * dismissal, walking DOWN the stack past layers that opted out (a toast with
 * `escape: false` must not shield a modal beneath it). Only one layer is
 * dismissed per press, mirroring Radix DismissableLayer branch semantics.
 * @param event - keydown event
 */
const handleKeyDown = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape') {
    return;
  }

  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = stack[i];

    if (!entry.escape) {
      continue;
    }

    /**
     * Consume the event: without this, a single Escape would also reach the
     * popover registry's capture backstop and the editor's bubble-phase
     * keyboard controller, peeling a second surface on the same press.
     */
    event.preventDefault();
    event.stopImmediatePropagation();

    entry.onDismiss('escape');

    return;
  }
};

/**
 * Handles outside pointerdown, walking DOWN the stack (topmost first):
 * a press inside ANY layer's surface dismisses nothing; otherwise the topmost
 * layer that opted into outside dismissal is dismissed. Layers that opted out
 * (`outside: false`, e.g. toasts) are skipped so they do not shield the layers
 * beneath them. Only one layer is dismissed per press.
 * @param event - pointerdown event
 */
const handlePointerDown = (event: PointerEvent): void => {
  const target = event.target;

  if (!(target instanceof Node)) {
    return;
  }

  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = stack[i];

    if (isInsideLayer(entry, target)) {
      return;
    }

    if (!entry.outside) {
      continue;
    }

    entry.onDismiss('outside');

    return;
  }
};

/**
 * Lazily installs the shared capture-phase document listeners on first
 * registration.
 */
const ensureListeners = (): void => {
  if (boundKeyDown !== null) {
    return;
  }

  boundKeyDown = handleKeyDown;
  boundPointerDown = handlePointerDown;

  document.addEventListener('keydown', boundKeyDown, true);
  document.addEventListener('pointerdown', boundPointerDown, true);
};

/**
 * Removes the shared document listeners once the stack empties.
 */
const removeListeners = (): void => {
  if (boundKeyDown === null || boundPointerDown === null) {
    return;
  }

  document.removeEventListener('keydown', boundKeyDown, true);
  document.removeEventListener('pointerdown', boundPointerDown, true);

  boundKeyDown = null;
  boundPointerDown = null;
};

/**
 * Registers a dismissable layer and returns an idempotent unregister function.
 *
 * The first registration installs the shared capture-phase keydown/pointerdown
 * listeners; the last unregister removes them.
 * @param options - layer configuration
 * @returns function that removes this layer from the stack
 */
export const registerLayer = (options: DismissableLayerOptions): (() => void) => {
  const entry: LayerEntry = {
    element: options.element,
    anchor: options.anchor,
    onDismiss: options.onDismiss,
    escape: options.escape ?? true,
    outside: options.outside ?? true,
  };

  stack.push(entry);
  ensureListeners();

  return (): void => {
    const index = stack.indexOf(entry);

    if (index === -1) {
      return;
    }

    stack.splice(index, 1);

    if (stack.length === 0) {
      removeListeners();
    }
  };
};
