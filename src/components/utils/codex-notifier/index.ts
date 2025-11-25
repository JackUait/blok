import * as draw from './draw';
import type { NotifierOptions, ConfirmNotifierOptions, PromptNotifierOptions } from './types';
import './index.css';

const bounceInClass = 'cdx-notify--bounce-in';
const DEFAULT_TIME = 8000;

/**
 * Prepare wrapper for notifications
 * @returns {HTMLElement}
 */
const prepare_ = (): HTMLElement => {
  const existingWrapper = document.querySelector(`.${draw.CSS.wrapper}`) as HTMLElement;

  if (existingWrapper) {
    return existingWrapper;
  }

  const wrapper = draw.getWrapper();

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
    switch (options.type) {
      case 'confirm':
        return draw.confirm(options as ConfirmNotifierOptions);

      case 'prompt':
        return draw.prompt(options as PromptNotifierOptions);

      default: {
        const alert = draw.alert(options);

        window.setTimeout(() => {
          alert.remove();
        }, time);

        return alert;
      }
    }
  })();

  if (wrapper && notify) {
    wrapper.appendChild(notify);
    notify.classList.add(bounceInClass);
  }
};

export default {
  show,
};
