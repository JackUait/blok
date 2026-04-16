import { twJoin } from '../tw';

import type { NotifierOptions, ConfirmNotifierOptions, PromptNotifierOptions, NotifierPosition } from './types';
import { DEFAULT_NOTIFIER_POSITION } from './types';

export const CSS = {
  /**
   * The wrapper class is built dynamically per-position.
   * See getPositionClasses().
   */
  wrapper: 'fixed z-[9999]',
  notification: twJoin(
    'relative flex items-center justify-center mt-2 py-[10px] px-6',
    'bg-[#1c1c1e] text-[#f5f5f5]',
    'text-[15px] font-normal leading-[1.4] tracking-[-0.015em] wrap-break-word overflow-hidden',
    'rounded-[14px]',
    'shadow-[0_8px_32px_rgba(0,0,0,0.4),0_1px_4px_rgba(0,0,0,0.25)]',
    'border border-white/[0.08]'
  ),
  messageWrapper: 'flex-1 min-w-0',
  btnsWrapper: 'flex flex-row flex-nowrap mt-[8px] gap-2',
  btn: 'border-none rounded-[7px] text-[13px] py-[5px] px-3 cursor-pointer outline-hidden font-medium',
  okBtn: 'bg-white/15 text-[#f5f5f5] hover:bg-white/25',
  cancelBtn: 'bg-white/8 text-[#a1a1aa] hover:bg-white/12',
  input: twJoin(
    'max-w-[140px] py-[5px] px-3 bg-white/10 border border-white/10 rounded-[7px]',
    'text-[13px] text-[#e4e4e7] outline-hidden',
    'placeholder:text-white/30 focus:border-white/20'
  ),
};

/**
 * Maps NotifierPosition to Tailwind positioning classes.
 */
export const getPositionClasses = (position: NotifierPosition = DEFAULT_NOTIFIER_POSITION): string => {
  const map: Record<NotifierPosition, string> = {
    'bottom-left': 'bottom-5 left-5',
    'bottom-right': 'bottom-5 right-5',
    'bottom-center': 'bottom-5 left-1/2 -translate-x-1/2',
    'top-left': 'top-5 left-5',
    'top-right': 'top-5 right-5',
    'top-center': 'top-5 left-1/2 -translate-x-1/2',
  };

  return map[position] ?? map['bottom-left'];
};

/**
 * @param {NotifierOptions} options - options for the notification
 * @returns {HTMLElement} - the notification element
 */
export const alert = (options: NotifierOptions): HTMLElement => {
  const notify = document.createElement('DIV');
  const style = options.style;

  notify.className = CSS.notification;

  if (style) {
    notify.setAttribute('data-blok-testid', `notification-${style}`);
  } else {
    notify.setAttribute('data-blok-testid', 'notification');
  }

  // Message wrapper
  const messageWrapper = document.createElement('div');

  messageWrapper.className = CSS.messageWrapper;
  messageWrapper.setAttribute('data-blok-testid', 'notification-message');
  messageWrapper.innerHTML = options.message;
  notify.appendChild(messageWrapper);

  return notify;
};

/**
 * @param {ConfirmNotifierOptions} options - options for the confirmation notification
 * @returns {HTMLElement} - the notification element
 */
export const confirm = (options: ConfirmNotifierOptions): HTMLElement => {
  const notify = alert(options);
  const messageWrapper = notify.querySelector('[data-blok-testid="notification-message"]') as HTMLElement;
  const btnsWrapper = document.createElement('div');
  const okBtn = document.createElement('button');
  const cancelBtn = document.createElement('button');
  const cancelHandler = options.cancelHandler;
  const okHandler = options.okHandler;

  btnsWrapper.className = CSS.btnsWrapper;
  btnsWrapper.setAttribute('data-blok-testid', 'notification-buttons-wrapper');

  okBtn.innerHTML = options.okText || 'Confirm';
  cancelBtn.innerHTML = options.cancelText || 'Cancel';

  okBtn.className = twJoin(CSS.btn, CSS.okBtn);
  cancelBtn.className = twJoin(CSS.btn, CSS.cancelBtn);

  okBtn.setAttribute('data-blok-testid', 'notification-confirm-button');
  cancelBtn.setAttribute('data-blok-testid', 'notification-cancel-button');

  if (cancelHandler && typeof cancelHandler === 'function') {
    cancelBtn.addEventListener('click', cancelHandler);
  }

  if (okHandler && typeof okHandler === 'function') {
    okBtn.addEventListener('click', okHandler);
  }

  okBtn.addEventListener('click', () => notify.remove());
  cancelBtn.addEventListener('click', () => notify.remove());

  btnsWrapper.appendChild(okBtn);
  btnsWrapper.appendChild(cancelBtn);

  if (messageWrapper) {
    messageWrapper.appendChild(btnsWrapper);
  } else {
    notify.appendChild(btnsWrapper);
  }

  return notify;
};

/**
 * @param {PromptNotifierOptions} options - options for the prompt notification
 * @returns {HTMLElement} - the notification element
 */
export const prompt = (options: PromptNotifierOptions): HTMLElement => {
  const notify = alert(options);
  const messageWrapper = notify.querySelector('[data-blok-testid="notification-message"]') as HTMLElement;
  const btnsWrapper = document.createElement('div');
  const okBtn = document.createElement('button');
  const input = document.createElement('input');
  const cancelHandler = options.cancelHandler;
  const okHandler = options.okHandler;

  btnsWrapper.className = CSS.btnsWrapper;

  okBtn.innerHTML = options.okText || 'Ok';
  okBtn.className = twJoin(CSS.btn, CSS.okBtn);

  input.className = CSS.input;
  input.setAttribute('data-blok-testid', 'notification-input');

  if (options.placeholder) {
    input.setAttribute('placeholder', options.placeholder);
  }

  if (options.default) {
    input.value = options.default;
  }

  if (options.inputType) {
    input.type = options.inputType;
  }

  if (cancelHandler && typeof cancelHandler === 'function') {
    const crossBtn = notify.querySelector('[data-blok-testid="notification-cross"]');

    if (crossBtn) {
      crossBtn.addEventListener('click', cancelHandler);
    }
  }

  if (okHandler && typeof okHandler === 'function') {
    okBtn.addEventListener('click', () => {
      okHandler(input.value);
    });
  }

  okBtn.addEventListener('click', () => notify.remove());

  btnsWrapper.appendChild(input);
  btnsWrapper.appendChild(okBtn);

  if (messageWrapper) {
    messageWrapper.appendChild(btnsWrapper);
  } else {
    notify.appendChild(btnsWrapper);
  }

  return notify;
};

export const getWrapper = (position: NotifierPosition = DEFAULT_NOTIFIER_POSITION): HTMLElement => {
  const wrapper = document.createElement('DIV');
  const positionClasses = getPositionClasses(position);

  wrapper.className = twJoin(CSS.wrapper, positionClasses);
  wrapper.setAttribute('data-blok-testid', 'notifier-container');
  wrapper.setAttribute('data-blok-position', position);

  return wrapper;
};
