import { registerLayer } from '../dismissable-layer';
import { promoteToTopLayer, removeFromTopLayer } from '../top-layer';

import { alert, confirm, getWrapper, modalCleanups, prompt } from './draw';
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
const startToastLifecycle = (wrapper: HTMLElement, notify: HTMLElement, position: NotifierPosition, time: number): void => {
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
  };

  const dismiss = (): void => {
    const wasConnected = notify.isConnected;

    dispose();

    if (!wasConnected) {
      return;
    }

    notify.setAttribute('data-state', 'closed');
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

  const timer = createPausableTimer(time, dismiss);

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

  timer.resume();
};

/**
 * Appends the notification to the wrapper and, for transient toasts, starts
 * their auto-dismiss lifecycle.
 */
const appendNotify = (wrapper: HTMLElement, notify: HTMLElement, position: NotifierPosition, time: number, autoDismiss: boolean): void => {
  wrapper.appendChild(notify);
  notify.classList.add(getSlideInClass(position));
  notify.setAttribute('data-blok-bounce-in', 'true');

  // Modal dialogs (confirm/prompt) stay until the user resolves them.
  if (!autoDismiss) {
    return;
  }

  startToastLifecycle(wrapper, notify, position, time);
};

/**
 * Show new notification
 * @param {NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions} options - notification options
 * @param {NotifierPosition} position - notification container position
 */
export const show = (options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions, position: NotifierPosition = DEFAULT_NOTIFIER_POSITION): void => {
  if (!options.message) {
    return;
  }

  const wrapper = prepare_(position);
  const time = options.time || DEFAULT_TIME;
  const autoDismiss = options.type !== 'confirm' && options.type !== 'prompt';

  const buildNotify = (): HTMLElement => {
    const type = options.type;

    if (type === 'confirm') {
      return confirm(options as ConfirmNotifierOptions);
    }

    if (type === 'prompt') {
      return prompt(options as PromptNotifierOptions);
    }

    return alert(options);
  };

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
      appendNotify(wrapper, buildNotify(), position, time, autoDismiss);

      return;
    }

    swapOut(existing, () => {
      const notify = buildNotify();

      appendNotify(wrapper, notify, position, time, autoDismiss);
    });
  } else {
    const notify = buildNotify();

    appendNotify(wrapper, notify, position, time, autoDismiss);
  }
};

export const Notifier = {
  show,
};
