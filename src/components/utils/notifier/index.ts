import { alert, confirm, createProgressBar, getWrapper, prompt } from './draw';
import type { NotifierOptions, ConfirmNotifierOptions, PromptNotifierOptions } from './types';

const DEFAULT_TIME = 8000;

/**
 * Applies the exit animation and removes the element after it finishes.
 */
const dismissWithAnimation = (element: HTMLElement): void => {
  element.classList.add('animate-notify-slide-out');

  element.addEventListener('animationend', () => {
    element.remove();
  }, { once: true });
};

/**
 * Prepare wrapper for notifications
 * @returns {HTMLElement}
 */
const prepare_ = (): HTMLElement => {
  const existingWrapper = document.querySelector('[data-blok-testid="notifier-container"]') as HTMLElement;

  if (existingWrapper) {
    return existingWrapper;
  }

  const wrapper = getWrapper();

  document.body.appendChild(wrapper);

  return wrapper;
};

/**
 * Show new notification
 * @param {NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions} options - notification options
 */
export const show = (options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions): void => {
  if (!options.message) {
    return;
  }

  const wrapper = prepare_();

  const time = options.time || DEFAULT_TIME;

  const notify: HTMLElement = (() => {
    const type = options.type;

    if (type === 'confirm') {
      return confirm(options as ConfirmNotifierOptions);
    }

    if (type === 'prompt') {
      return prompt(options as PromptNotifierOptions);
    }

    // type is 'alert' or undefined
    const alertElement = alert(options);

    // Add progress bar for auto-dismissing alerts
    const progressBar = createProgressBar(options.style, time);

    alertElement.appendChild(progressBar);

    // Wire up the close button to use animated dismissal
    const crossBtn = alertElement.querySelector('[data-blok-testid="notification-cross"]');

    if (crossBtn) {
      // Replace the basic remove handler with animated dismissal
      const newCross = crossBtn.cloneNode(true) as HTMLElement;

      crossBtn.replaceWith(newCross);
      newCross.addEventListener('click', () => dismissWithAnimation(alertElement));
    }

    window.setTimeout(() => {
      dismissWithAnimation(alertElement);
    }, time);

    return alertElement;
  })();

  if (wrapper && notify) {
    wrapper.appendChild(notify);
    notify.className = `${notify.className} animate-notify-slide-in`;
    notify.setAttribute('data-blok-bounce-in', 'true');
  }
};

export const Notifier = {
  show,
};
