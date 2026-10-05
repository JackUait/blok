import { registerLayer } from '../dismissable-layer';
import { syncPortalDirection } from '../portal-direction';
import { promoteToTopLayer, removeFromTopLayer } from '../top-layer';

import { alert, confirm, drawResolved, drawSettled, getWrapper, modalCleanups, prompt, setToastDismisser } from './draw';
import type { NotifierOptions, ConfirmNotifierOptions, PromptNotifierOptions, NotifierPosition } from './types';
import { DEFAULT_NOTIFIER_POSITION } from './types';

const DEFAULT_TIME = 8000;

/**
 * Selector matching any rendered notification inside the toast wrapper.
 */
const NOTIFICATION_SELECTOR = '[data-blok-testid^="notification"]';

/**
 * Per-toast teardown handlers, keyed by the toast element. Lets the
 * replacement path (swap-out) tear down a superseded toast's timer and
 * dismissal layer before it is animated away.
 */
const toastCleanups = new WeakMap<HTMLElement, () => void>();

// Keyed by the caller's options object so `dismiss` closes only the toast that caller showed.
const toastsByOptions = new WeakMap<NotifierOptions, HTMLElement>();
const toastDismiss = new WeakMap<HTMLElement, () => void>();

/**
 * Cards waiting behind the front card, oldest first. Each is drawn only when it
 * reaches the front: a detached element would read as closed to `isClosed`.
 */
const waiting: { options: NotifierOptions; mount: () => void }[] = [];

// Cards dropped from the stack before anyone saw them; `isClosed` reports them closed.
const dropped = new WeakSet<NotifierOptions>();

/** Cards drawn behind the front one. More waiting cards do not add depth. */
const MAX_BEHIND = 2;

const isCard = (options: NotifierOptions): boolean =>
  options.type !== 'confirm' && options.type !== 'prompt' && options.actions !== undefined && options.actions.length > 0;

const frontCard = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-blok-testid="notifier-container"] > [data-blok-toast="card"][data-state="open"]');

/**
 * The wrapper draws the waiting cards as edges peeking out behind the front one.
 */
const syncBehind = (): void => {
  const wrapper = document.querySelector('[data-blok-testid="notifier-container"]');

  if (wrapper === null) {
    return;
  }
  if (waiting.length === 0) {
    wrapper.removeAttribute('data-blok-toast-behind');
  } else {
    wrapper.setAttribute('data-blok-toast-behind', String(Math.min(waiting.length, MAX_BEHIND)));
  }
};

const dropWaiting = (): void => {
  waiting.splice(0).forEach((entry) => dropped.add(entry.options));
  syncBehind();
};

/**
 * @param options - the object passed to `show`
 * @returns true when that card was still waiting and is now out of the stack
 */
const unqueue = (options: NotifierOptions): boolean => {
  const index = waiting.findIndex((entry) => entry.options === options);

  if (index === -1) {
    return false;
  }
  waiting.splice(index, 1);
  syncBehind();

  return true;
};

/**
 * Pins a leaving card where it is, so the next card can take its place underneath it.
 */
const pinInPlace = (notify: HTMLElement): void => {
  notify.style.setProperty('position', 'absolute');
  notify.style.setProperty('left', `${notify.offsetLeft}px`);
  notify.style.setProperty('top', `${notify.offsetTop}px`);
  notify.style.setProperty('width', `${notify.offsetWidth}px`);
  notify.style.setProperty('margin', '0');
};

/**
 * A pausable auto-dismiss timer. Instead of a fixed `setTimeout` (which keeps
 * counting while the user reads or interacts — a WCAG 2.2.1 failure), it tracks
 * the wall-clock `deadline` and the `remaining` time so it can be paused on
 * hover/focus and resumed on leave/blur (Radix Toast / Sonner behavior).
 */
interface PausableTimer {
  /** Freeze the countdown, banking the remaining time. */
  pause(): void;
  /** Resume counting down from the banked remaining time. */
  resume(): void;
  /** Cancel the timer permanently. */
  clear(): void;
}

/**
 * Creates a {@link PausableTimer}. The timer does not start until `resume()` is
 * called for the first time.
 * @param {number} durationMs - total time before expiry
 * @param {() => void} onExpire - invoked once when the countdown reaches zero
 * @returns {PausableTimer}
 */
const createPausableTimer = (durationMs: number, onExpire: () => void): PausableTimer => {
  const state = { remaining: durationMs, deadline: 0, handle: null as number | null };

  const resume = (): void => {
    if (state.handle !== null || state.remaining <= 0) {
      return;
    }

    state.deadline = Date.now() + state.remaining;
    state.handle = window.setTimeout(() => {
      state.handle = null;
      state.remaining = 0;
      onExpire();
    }, state.remaining);
  };

  const pause = (): void => {
    if (state.handle === null) {
      return;
    }

    window.clearTimeout(state.handle);
    state.handle = null;
    state.remaining = Math.max(0, state.deadline - Date.now());
  };

  const clear = (): void => {
    if (state.handle !== null) {
      window.clearTimeout(state.handle);
      state.handle = null;
    }
    state.remaining = 0;
  };

  return { pause, resume, clear };
};

/**
 * Returns the slide-in animation class based on position.
 * Top positions slide down, bottom positions slide up.
 */
const getSlideInClass = (position: NotifierPosition): string => {
  return position.startsWith('top') ? 'animate-notify-slide-in-top' : 'animate-notify-slide-in';
};

/**
 * Returns the slide-out animation class based on position.
 */
const getSlideOutClass = (position: NotifierPosition): string => {
  return position.startsWith('top') ? 'animate-notify-slide-out-top' : 'animate-notify-slide-out';
};

/**
 * Applies the exit animation and removes the element after it finishes.
 */
const dismissWithAnimation = (element: HTMLElement, position: NotifierPosition): void => {
  element.classList.add(getSlideOutClass(position));

  element.addEventListener('animationend', () => {
    element.remove();
  }, { once: true });
};

/**
 * Fades and scales the element out quickly (replacement case), then calls onDone.
 */
const swapOut = (element: HTMLElement, onDone: () => void): void => {
  element.classList.add('animate-notify-swap-out');

  element.addEventListener('animationend', () => {
    element.remove();
    onDone();
  }, { once: true });
};

/**
 * Prepare wrapper for notifications.
 * If position changes, removes the old wrapper and creates a fresh one.
 * @param {NotifierPosition} position - desired position
 * @returns {HTMLElement}
 */
const prepare_ = (position: NotifierPosition = DEFAULT_NOTIFIER_POSITION): HTMLElement => {
  const existingWrapper = document.querySelector('[data-blok-testid="notifier-container"]') as HTMLElement;

  if (existingWrapper) {
    // If position has changed, recreate the wrapper at the new location
    if (existingWrapper.getAttribute('data-blok-position') !== position) {
      existingWrapper.remove();
    } else {
      return existingWrapper;
    }
  }

  const wrapper = getWrapper(position);

  document.body.appendChild(wrapper);

  return wrapper;
};

/**
 * Wires the transient toast's full lifecycle (Radix Toast / Sonner parity):
 * a pause-on-hover/focus auto-dismiss timer, a labeled dismiss button,
 * Escape-to-dismiss via the shared dismissal layer, `data-state` animation
 * hooks, and Top-Layer promotion of the wrapper.
 */
const startToastLifecycle = (wrapper: HTMLElement, notify: HTMLElement, position: NotifierPosition, time: number, sticky: boolean): void => {
  notify.setAttribute('data-state', 'open');

  // Promote the toast wrapper into the CSS Top Layer so it renders above host
  // page content. The wrapper keeps its corner positioning via the top-layer
  // CSS reset (see top-layer.ts).
  promoteToTopLayer(wrapper);

  const lifecycle = { disposed: false };

  const dispose = (): void => {
    if (lifecycle.disposed) {
      return;
    }
    lifecycle.disposed = true;
    timer.clear();
    unregisterLayer();
    toastCleanups.delete(notify);
    setToastDismisser(notify, null);
  };

  const dismiss = (): void => {
    const wasConnected = notify.isConnected;

    dispose();

    if (!wasConnected) {
      return;
    }

    notify.setAttribute('data-state', 'closed');

    const next = waiting.shift();

    if (next !== undefined) {
      const hadFocus = notify.contains(document.activeElement);

      pinInPlace(notify);
      next.mount();
      syncBehind();
      if (hadFocus) {
        frontCard()?.querySelector<HTMLElement>('[data-blok-testid="notification-dismiss"]')?.focus();
      }
    }
    dismissWithAnimation(notify, position);

    // Release the Top Layer once the toast has finished animating out and no
    // other notification remains in the wrapper. Registered after
    // dismissWithAnimation so it runs *after* that handler removes the node.
    notify.addEventListener('animationend', () => {
      if (wrapper.querySelector(NOTIFICATION_SELECTOR) === null) {
        removeFromTopLayer(wrapper);
      }
    }, { once: true });
  };

  // A toast with actions waits for the user. Never pass Infinity instead:
  // setTimeout treats delays above 2^31-1 ms as ~1 ms.
  const timer: PausableTimer = sticky
    ? { pause: () => undefined, resume: () => undefined, clear: () => undefined }
    : createPausableTimer(time, dismiss);

  const unregisterLayer = registerLayer({
    element: notify,
    onDismiss: dismiss,
    escape: true,
    // Toasts are non-interruptive: an outside click should not dismiss them.
    outside: false,
  });

  // Pause the countdown while the user hovers or keyboard-focus is inside the
  // toast (WCAG 2.2.1). Hover and focus are a union: the timer resumes only
  // when BOTH are gone, so leaving with the pointer while focus is still
  // inside (or vice versa) keeps it paused.
  const interaction = { hovered: false, focused: false };

  const resumeIfIdle = (): void => {
    if (!interaction.hovered && !interaction.focused) {
      timer.resume();
    }
  };

  notify.addEventListener('pointerenter', () => {
    interaction.hovered = true;
    timer.pause();
  });
  notify.addEventListener('pointerleave', () => {
    interaction.hovered = false;
    resumeIfIdle();
  });
  notify.addEventListener('focusin', () => {
    interaction.focused = true;
    timer.pause();
  });
  notify.addEventListener('focusout', () => {
    interaction.focused = false;
    resumeIfIdle();
  });

  toastCleanups.set(notify, dispose);
  setToastDismisser(notify, dismiss);
  toastDismiss.set(notify, dismiss);

  timer.resume();
};

/**
 * Appends the notification to the wrapper and, for transient toasts, starts
 * their auto-dismiss lifecycle.
 */
const appendNotify = (wrapper: HTMLElement, notify: HTMLElement, position: NotifierPosition, time: number, autoDismiss: boolean, sticky: boolean, rise = false): void => {
  wrapper.appendChild(notify);
  if (rise) {
    notify.setAttribute('data-blok-toast-rise', 'true');
  } else {
    notify.classList.add(getSlideInClass(position));
    notify.setAttribute('data-blok-bounce-in', 'true');
  }

  // Modal dialogs (confirm/prompt) stay until the user resolves them.
  if (!autoDismiss) {
    return;
  }

  startToastLifecycle(wrapper, notify, position, time, sticky);
};

/**
 * Show new notification
 * @param {NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions} options - notification options
 * @param {NotifierPosition} position - notification container position
 * @param directionSource - element whose direction the toast takes
 */
export const show = (
  options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions,
  position: NotifierPosition = DEFAULT_NOTIFIER_POSITION,
  directionSource?: Element | null
): void => {
  if (!options.message) {
    return;
  }

  const wrapper = prepare_(position);
  const time = options.time || DEFAULT_TIME;
  const autoDismiss = options.type !== 'confirm' && options.type !== 'prompt';
  const sticky = options.actions !== undefined && options.actions.length > 0;

  // The wrapper is shared by every editor on the page, so each toast carries its own direction.
  const buildNotify = (): HTMLElement => {
    const notify = buildByType();

    syncPortalDirection(notify, { source: directionSource });

    return notify;
  };

  const buildByType = (): HTMLElement => {
    const type = options.type;

    if (type === 'confirm') {
      return confirm(options as ConfirmNotifierOptions);
    }

    if (type === 'prompt') {
      return prompt(options as PromptNotifierOptions);
    }

    const notify = alert(options);

    toastsByOptions.set(options, notify);

    return notify;
  };

  if (isCard(options) && frontCard() !== null) {
    waiting.push({ options, mount: () => appendNotify(prepare_(position), buildNotify(), position, time, autoDismiss, sticky, true) });
    syncBehind();

    return;
  }

  dropWaiting();

  const existing = wrapper.querySelector<HTMLElement>('[data-blok-testid]');

  if (existing) {
    // Cancel any in-progress swap-out on the existing element so we don't double-fire
    existing.classList.remove('animate-notify-swap-out');

    // Tear down the superseded toast's timer + dismissal layer before it is
    // animated away, so it can't fire after being replaced.
    toastCleanups.get(existing)?.();

    // A superseded confirm/prompt is a modal dialog: close its handle so the
    // page-wide `inert` and its dismissal layer are released.
    modalCleanups.get(existing)?.();

    // Closing a modal handle removes its element synchronously; with nothing
    // left to swap-animate (animationend would never fire), mount immediately.
    if (!existing.isConnected) {
      appendNotify(wrapper, buildNotify(), position, time, autoDismiss, sticky);

      return;
    }

    swapOut(existing, () => {
      const notify = buildNotify();

      appendNotify(wrapper, notify, position, time, autoDismiss, sticky);
    });
  } else {
    const notify = buildNotify();

    appendNotify(wrapper, notify, position, time, autoDismiss, sticky);
  }
};

/**
 * Close the toast shown with exactly this options object, if it is still open.
 * @param options - the object passed to `show`
 */
export const dismiss = (options: NotifierOptions): void => {
  if (unqueue(options)) {
    return;
  }
  const notify = toastsByOptions.get(options);

  if (notify?.isConnected === true) {
    toastDismiss.get(notify)?.();
  }
};

/**
 * @param options - the object passed to `show`
 * @returns true once that toast was drawn and has closed; false while it is still mounting
 */
export const isClosed = (options: NotifierOptions): boolean => {
  if (dropped.has(options)) {
    return true;
  }
  const notify = toastsByOptions.get(options);

  return notify !== undefined && (!notify.isConnected || notify.getAttribute('data-state') !== 'open');
};

/**
 * How long a resolved card stays before it closes itself.
 */
export const RESOLVED_HOLD_MS = 1600;

/**
 * Show the success state on the card shown with these options, then close it.
 * @param options - the object passed to `show`
 * @param message - plain text, e.g. "Image restored"
 */
export const resolve = (options: NotifierOptions, message: string): void => {
  if (unqueue(options)) {
    return;
  }
  const notify = toastsByOptions.get(options);

  if (notify?.isConnected !== true || notify.hasAttribute('data-resolved')) {
    return;
  }
  drawResolved(notify, message);
  window.setTimeout(() => toastDismiss.get(notify)?.(), RESOLVED_HOLD_MS);
};

/**
 * Stop the busy spinner on the card shown with these options, so its actions work again.
 * @param options - the object passed to `show`
 */
export const settle = (options: NotifierOptions): void => {
  const notify = toastsByOptions.get(options);

  if (notify?.isConnected === true) {
    drawSettled(notify);
  }
};

export const Notifier = {
  show,
  dismiss,
  resolve,
  settle,
  isClosed,
};
