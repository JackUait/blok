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
   * Called when the layer should be dismissed (Escape or outside pointerdown).
   */
  onDismiss: () => void;

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
  onDismiss: () => void;
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
 * Handles Escape: dismisses the topmost layer that opted into escape dismissal.
 * @param event - keydown event
 */
const handleKeyDown = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape') {
    return;
  }

  const topmost = stack[stack.length - 1];

  if (topmost === undefined || !topmost.escape) {
    return;
  }

  topmost.onDismiss();
};

/**
 * Handles outside pointerdown: dismisses the topmost layer when the press
 * lands outside its element (and anchor).
 * @param event - pointerdown event
 */
const handlePointerDown = (event: PointerEvent): void => {
  const target = event.target;

  if (!(target instanceof Node)) {
    return;
  }

  const topmost = stack[stack.length - 1];

  if (topmost === undefined || !topmost.outside) {
    return;
  }

  if (isInsideLayer(topmost, target)) {
    return;
  }

  topmost.onDismiss();
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
