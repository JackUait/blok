import { alert, confirm, getWrapper, prompt } from './draw';
import type { NotifierOptions, ConfirmNotifierOptions, PromptNotifierOptions, NotifierPosition } from './types';
import { DEFAULT_NOTIFIER_POSITION } from './types';

const DEFAULT_TIME = 8000;

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
 * Appends the notification to the wrapper and starts its auto-dismiss timer.
 */
const appendNotify = (wrapper: HTMLElement, notify: HTMLElement, position: NotifierPosition, time: number): void => {
  wrapper.appendChild(notify);
  notify.classList.add(getSlideInClass(position));
  notify.setAttribute('data-blok-bounce-in', 'true');

  window.setTimeout(() => {
    // Guard: element may have already been replaced
    if (notify.isConnected) {
      dismissWithAnimation(notify, position);
    }
  }, time);
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

  const existing = wrapper.querySelector('[data-blok-testid]') as HTMLElement | null;

  if (existing) {
    // Cancel any in-progress swap-out on the existing element so we don't double-fire
    existing.classList.remove('animate-notify-swap-out');

    swapOut(existing, () => {
      const notify = buildNotify();

      appendNotify(wrapper, notify, position, time);
    });
  } else {
    const notify = buildNotify();

    appendNotify(wrapper, notify, position, time);
  }
};

export const Notifier = {
  show,
};
