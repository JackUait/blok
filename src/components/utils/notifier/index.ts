import { alert, confirm, getWrapper, prompt } from './draw';
import type { NotifierOptions, ConfirmNotifierOptions, PromptNotifierOptions } from './types';

const DEFAULT_TIME = 8000;

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

    window.setTimeout(() => {
      alertElement.remove();
    }, time);

    return alertElement;
  })();

  if (wrapper && notify) {
    wrapper.appendChild(notify);
    notify.className = `${notify.className} animate-notify-bounce-in`;
    notify.setAttribute('data-blok-bounce-in', 'true');
  }
};

export const Notifier = {
  show,
};