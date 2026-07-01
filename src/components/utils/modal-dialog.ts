/**
 * Shared modal Dialog primitive, adapted from Radix UI's Dialog contract.
 *
 * Why this module exists
 * ----------------------
 * Blok grew three hand-rolled modal implementations (the file preview modal,
 * the image crop editor, and the notifier confirm/prompt dialogs). Each one
 * missed a different accessibility piece:
 *
 *   - preview-modal declared `aria-modal` but never trapped focus or `inert`-ed
 *     the background, so Tab/AT could reach the page behind it;
 *   - crop-modal restored focus without checking `isConnected`, throwing when
 *     the previously-focused node had been detached;
 *   - the notifier's private `makeModal` trapped Tab but left the background
 *     fully clickable, sat in the `z-[9999]` toast wrapper *below* the CSS Top
 *     Layer, and its focusable-element query missed `a[href]`, `select`, and
 *     `textarea`.
 *
 * `openModalDialog` centralizes the full contract on top of the Wave 1
 * primitives (`promoteToTopLayer` + `registerLayer`):
 *
 *   1. mounts and promotes the dialog into the CSS Top Layer;
 *   2. applies `inert` to the sibling body subtrees while open (the same trick
 *      that `src/tools/video/controls.ts` uses on its parked menu pane);
 *   3. traps Tab focus with a complete tabbable selector and pulls focus back
 *      via a capture-phase `focusin` guard;
 *   4. captures `document.activeElement` on open and restores it on close only
 *      when the node is still connected;
 *   5. registers Escape / outside-pointer dismissal through the shared
 *      dismissable-layer stack instead of a bespoke listener;
 *   6. runs one shared exit-animation settle before teardown.
 */

import { registerLayer } from './dismissable-layer';
import { promoteToTopLayer, removeFromTopLayer } from './top-layer';

/**
 * The ARIA role for the dialog surface. `alertdialog` is used for
 * confirm/prompt style interruptions; `dialog` for everything else.
 */
export type DialogRole = 'dialog' | 'alertdialog';

/**
 * Why the dialog is being dismissed. Escape and outside-pointer can map to
 * different actions (the alt-text popover commits on click-away but cancels on
 * Escape), so the reason is forwarded to the caller.
 */
export type ModalDismissReason = 'escape' | 'outside';

/**
 * Complete tabbable selector. Covers every natively focusable element type
 * plus explicit `tabindex` opt-ins, and excludes `tabindex="-1"`.
 */
const TABBABLE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Time budget for the close animation before forcing teardown (ms). */
const CLOSE_ANIMATION_FALLBACK_MS = 260;

/**
 * Options accepted by {@link openModalDialog}.
 */
export interface OpenModalDialogOptions {
  /**
   * The element mounted into the DOM and promoted to the Top Layer. For a
   * backdrop + panel design this is the backdrop; for a bare panel it is the
   * panel itself.
   */
  content: HTMLElement;

  /**
   * The dialog surface that carries the ARIA attributes and defines the
   * focus-trap / "inside" boundary. Defaults to {@link content}.
   */
  surface?: HTMLElement;

  /** ARIA role for the surface. Defaults to `dialog`. */
  role?: DialogRole;

  /** Value for `aria-label` on the surface. */
  label?: string;

  /** Value for `aria-labelledby` on the surface. */
  labelledBy?: string;

  /** Value for `aria-describedby` on the surface. */
  describedBy?: string;

  /** Resolves the element that should receive focus once the dialog opens. */
  initialFocus?: () => HTMLElement | null;

  /** Called when the dialog is dismissed via Escape or an outside pointer. */
  onDismiss: (reason: ModalDismissReason) => void;

  /**
   * Extra teardown run during close (after focus restore). Used by callers
   * that own side effects like scroll locks.
   */
  onClose?: () => void;

  /**
   * Parent to append {@link content} to on open. Pass `null` when the caller
   * mounts the element itself (the notifier appends into its toast wrapper).
   * Defaults to `document.body`.
   */
  container?: HTMLElement | null;

  /** Promote {@link content} into the CSS Top Layer. Defaults to `true`. */
  topLayer?: boolean;

  /** Anchor treated as "inside" for outside-pointer dismissal. */
  anchor?: HTMLElement;

  /** Whether Escape dismisses the dialog. Defaults to `true`. */
  escape?: boolean;

  /** Whether an outside pointerdown dismisses the dialog. Defaults to `true`. */
  outside?: boolean;

  /**
   * Element whose CSS animation is awaited by {@link ModalDialogHandle.closeAnimated}.
   * Defaults to {@link surface}.
   */
  animationTarget?: HTMLElement;

  /**
   * Element that must stay interactive; its top-level body ancestor is spared
   * when sibling subtrees are marked `inert`. Defaults to {@link content}.
   */
  interactiveRoot?: HTMLElement;
}

/**
 * Handle returned by {@link openModalDialog}.
 */
export interface ModalDialogHandle {
  /** The mounted/promoted element. */
  readonly content: HTMLElement;

  /** The dialog surface carrying ARIA + focus boundary. */
  readonly surface: HTMLElement;

  /** Tear the dialog down immediately, with no exit animation. */
  close: () => void;

  /** Play the exit animation on the animation target, then tear down. */
  closeAnimated: () => void;
}

/**
 * Collects the tabbable descendants of a container in DOM order, filtering out
 * disabled, `tabindex="-1"`, hidden and `aria-hidden` elements.
 * @param container - element to search within
 * @returns tabbable elements in document order
 */
export const getTabbables = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter((el) => {
    // Attribute/property checks only — jsdom has no layout, so offsetParent /
    // computed visibility would wrongly reject every element here.
    const isDisabled = 'disabled' in el && (el as HTMLButtonElement | HTMLInputElement).disabled === true;

    if (isDisabled || el.hasAttribute('disabled')) {
      return false;
    }

    if (el.getAttribute('tabindex') === '-1') {
      return false;
    }

    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') {
      return false;
    }

    return true;
  });

/**
 * Reads the resolved CSS animation-name of an element, tolerating environments
 * without `getComputedStyle`.
 * @param el - element to inspect
 * @returns the animation-name string, or empty when unavailable
 */
const readAnimationName = (el: Element): string => {
  if (typeof window === 'undefined') {
    return '';
  }
  try {
    return window.getComputedStyle(el).animationName || '';
  } catch {
    return '';
  }
};

/**
 * jsdom has no animation engine; skip the exit-animation wait there so closes
 * stay synchronous in unit tests.
 * @returns whether CSS animations should be awaited
 */
const supportsAnimations = (): boolean => {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return !/jsdom/i.test(navigator.userAgent);
};

/**
 * @returns whether the user has requested reduced motion.
 */
const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

/**
 * Walks up from a node to the child of `<body>` that contains it.
 * @param node - starting element
 * @returns the body-level ancestor, or null when the node is not under body
 */
const bodyLevelAncestor = (node: HTMLElement): HTMLElement | null => {
  if (typeof document === 'undefined' || document.body === null) {
    return null;
  }

  let current: HTMLElement | null = node;

  while (current !== null && current.parentElement !== document.body) {
    current = current.parentElement;
  }

  return current;
};

/**
 * Opens a modal dialog around a pre-built element.
 * @param options - dialog configuration
 * @returns a handle that closes the dialog (immediately or animated)
 */
export const openModalDialog = (options: OpenModalDialogOptions): ModalDialogHandle => {
  const content = options.content;
  const surface = options.surface ?? content;
  const container = options.container === undefined ? document.body : options.container;
  const topLayer = options.topLayer ?? true;
  const interactiveRoot = options.interactiveRoot ?? content;
  const animationTarget = options.animationTarget ?? surface;

  surface.setAttribute('role', options.role ?? 'dialog');
  surface.setAttribute('aria-modal', 'true');

  if (options.label !== undefined) {
    surface.setAttribute('aria-label', options.label);
  }
  if (options.labelledBy !== undefined) {
    surface.setAttribute('aria-labelledby', options.labelledBy);
  }
  if (options.describedBy !== undefined) {
    surface.setAttribute('aria-describedby', options.describedBy);
  }

  const previouslyFocused = document.activeElement;

  if (container !== null) {
    container.appendChild(content);
  }

  if (topLayer) {
    promoteToTopLayer(content);
  }

  const state = { closed: false };

  // Only elements we set `inert` on get it cleared, so pre-existing inert
  // subtrees survive teardown untouched.
  const inertedElements: HTMLElement[] = [];
  const inertState = { applied: false };

  const applyInert = (): void => {
    if (inertState.applied || typeof document === 'undefined' || document.body === null) {
      return;
    }
    inertState.applied = true;

    const keep = bodyLevelAncestor(interactiveRoot);

    for (const child of Array.from(document.body.children)) {
      if (child === keep || !(child instanceof HTMLElement)) {
        continue;
      }
      if (child.hasAttribute('inert')) {
        continue;
      }
      child.setAttribute('inert', '');
      inertedElements.push(child);
    }
  };

  const removeInert = (): void => {
    for (const el of inertedElements) {
      el.removeAttribute('inert');
    }
    inertedElements.length = 0;
  };

  const onKeyDownTrap = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') {
      return;
    }

    const focusables = getTabbables(surface);

    if (focusables.length === 0) {
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onFocusIn = (event: FocusEvent): void => {
    if (state.closed || !surface.isConnected) {
      return;
    }

    const target = event.target;

    if (target instanceof Node && surface.contains(target)) {
      return;
    }

    const focusables = getTabbables(surface);
    const fallback = focusables[0] ?? surface;

    fallback.focus();
  };

  surface.addEventListener('keydown', onKeyDownTrap);
  document.addEventListener('focusin', onFocusIn, true);

  const unregister = registerLayer({
    element: surface,
    anchor: options.anchor,
    escape: options.escape ?? true,
    outside: options.outside ?? true,
    onDismiss: (reason?: ModalDismissReason) => {
      options.onDismiss(reason ?? 'outside');
    },
  });

  const focusInitial = (): boolean => {
    const target = options.initialFocus?.() ?? getTabbables(surface)[0] ?? null;

    if (target !== null && target.isConnected) {
      target.focus();

      return true;
    }

    return false;
  };

  // Inert needs the element connected. Preview/crop/alt mount synchronously
  // (container appends immediately); the notifier appends into its toast
  // wrapper only after this returns, so defer to the microtask in that case.
  if (content.isConnected) {
    applyInert();
  }

  // Focus synchronously when the target already exists (preview's close button
  // is present at open). Callers that build the surface contents right after
  // this returns (the crop editor mounts its buttons post-return) or append the
  // element later (the notifier) fall back to a microtask retry.
  if (!focusInitial()) {
    queueMicrotask(() => {
      if (state.closed) {
        return;
      }
      applyInert();
      focusInitial();
    });
  }

  const finalize = (): void => {
    if (state.closed) {
      return;
    }
    state.closed = true;

    surface.removeEventListener('keydown', onKeyDownTrap);
    document.removeEventListener('focusin', onFocusIn, true);
    unregister();
    removeInert();

    if (topLayer) {
      removeFromTopLayer(content);
    }

    content.remove();

    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
      previouslyFocused.focus();
    }

    options.onClose?.();
  };

  const closeAnimated = (): void => {
    if (state.closed) {
      return;
    }

    content.setAttribute('data-blok-closing', 'true');

    if (prefersReducedMotion() || !supportsAnimations()) {
      finalize();

      return;
    }

    const animationName = readAnimationName(animationTarget);

    if (animationName === '' || animationName === 'none') {
      finalize();

      return;
    }

    const settle = { done: false, fallback: 0 };

    const finishClose = (): void => {
      if (settle.done) {
        return;
      }
      settle.done = true;
      animationTarget.removeEventListener('animationend', onAnimationEnd);
      if (settle.fallback !== 0) {
        window.clearTimeout(settle.fallback);
      }
      finalize();
    };

    const onAnimationEnd = (event: AnimationEvent): void => {
      if (event.target !== animationTarget) {
        return;
      }
      finishClose();
    };

    animationTarget.addEventListener('animationend', onAnimationEnd);
    settle.fallback = window.setTimeout(finishClose, CLOSE_ANIMATION_FALLBACK_MS);
  };

  return {
    content,
    surface,
    close: finalize,
    closeAnimated,
  };
};
