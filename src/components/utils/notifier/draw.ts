import { twMerge, twJoin } from '../tw';

import type { NotifierOptions, ConfirmNotifierOptions, PromptNotifierOptions } from './types';

export const CSS = {
  wrapper: twJoin(
    'fixed z-[2] bottom-5 left-5',
    'font-[-apple-system,BlinkMacSystemFont,"Segoe_UI","Roboto","Oxygen","Ubuntu","Cantarell","Fira_Sans","Droid_Sans","Helvetica_Neue",sans-serif]'
  ),
  notification: twJoin(
    'relative w-[230px] mt-[15px] py-[13px] px-4',
    'bg-white shadow-[0_11px_17px_0_rgba(23,32,61,0.13)] rounded-[5px]',
    'text-sm leading-[1.4em] break-words',
    'before:content-[""] before:absolute before:block before:top-0 before:left-0',
    'before:w-[3px] before:h-[calc(100%-6px)] before:m-[3px] before:rounded-[5px] before:bg-transparent'
  ),
  crossBtn: twJoin(
    'absolute top-[7px] right-[15px] w-2.5 h-2.5 p-[5px] opacity-55 cursor-pointer',
    'before:content-[""] before:absolute before:left-[9px] before:top-[5px] before:h-3 before:w-0.5 before:bg-[#575d67] before:rotate-[-45deg]',
    'after:content-[""] after:absolute after:left-[9px] after:top-[5px] after:h-3 after:w-0.5 after:bg-[#575d67] after:rotate-45',
    'hover:opacity-100'
  ),
  btnsWrapper: 'flex flex-row flex-nowrap mt-[5px]',
  btn: 'border-none rounded-[3px] text-[13px] py-[5px] px-2.5 cursor-pointer last:ml-2.5',
  okBtn: 'bg-[#34c992] shadow-[0_1px_1px_0_rgba(18,49,35,0.05)] text-white hover:bg-[#2db583]',
  cancelBtn: 'bg-[#f2f5f7] shadow-[0_2px_1px_0_rgba(16,19,29,0)] text-[#656b7c] hover:bg-[#e9ecee]',
  input: twJoin(
    'max-w-[130px] py-[5px] px-2.5 bg-[#f7f7f7] border-0 rounded-[3px]',
    'text-[13px] text-[#656b7c] outline-none',
    'placeholder:text-[#656b7c] focus:placeholder:text-[rgba(101,107,124,0.3)]'
  ),
  successNotification: twJoin(
    '!bg-[#fafffe]',
    'before:!bg-[#41ffb1]'
  ),
  errorNotification: twJoin(
    '!bg-[#fffbfb]',
    'before:!bg-[#fb5d5d]'
  ),
};

/**
 * @param {NotifierOptions} options - options for the notification
 * @returns {HTMLElement} - the notification element
 */
export const alert = (options: NotifierOptions): HTMLElement => {
  const notify = document.createElement('DIV');
  const cross = document.createElement('DIV');
  const message = options.message;
  const style = options.style;

  const getStyleClasses = (): string => {
    if (style === 'success') {
      return CSS.successNotification;
    }

    if (style === 'error') {
      return CSS.errorNotification;
    }

    return '';
  };

  notify.className = twMerge(CSS.notification, getStyleClasses());

  if (style) {
    notify.setAttribute('data-blok-testid', `notification-${style}`);
  } else {
    notify.setAttribute('data-blok-testid', 'notification');
  }

  notify.innerHTML = message;

  cross.className = CSS.crossBtn;
  cross.setAttribute('data-blok-testid', 'notification-cross');
  cross.addEventListener('click', () => notify.remove());

  notify.appendChild(cross);

  return notify;
};

/**
 * @param {ConfirmNotifierOptions} options - options for the confirmation notification
 * @returns {HTMLElement} - the notification element
 */
export const confirm = (options: ConfirmNotifierOptions): HTMLElement => {
  const notify = alert(options);
  const btnsWrapper = document.createElement('div');
  const okBtn = document.createElement('button');
  const cancelBtn = document.createElement('button');
  const crossBtn = notify.querySelector('[data-blok-testid="notification-cross"]');
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

  if (cancelHandler && typeof cancelHandler === 'function' && crossBtn) {
    crossBtn.addEventListener('click', cancelHandler);
  }

  if (okHandler && typeof okHandler === 'function') {
    okBtn.addEventListener('click', okHandler);
  }

  okBtn.addEventListener('click', () => notify.remove());
  cancelBtn.addEventListener('click', () => notify.remove());

  btnsWrapper.appendChild(okBtn);
  btnsWrapper.appendChild(cancelBtn);

  notify.appendChild(btnsWrapper);

  return notify;
};

/**
 * @param {PromptNotifierOptions} options - options for the prompt notification
 * @returns {HTMLElement} - the notification element
 */
export const prompt = (options: PromptNotifierOptions): HTMLElement => {
  const notify = alert(options);
  const btnsWrapper = document.createElement('div');
  const okBtn = document.createElement('button');
  const input = document.createElement('input');
  const crossBtn = notify.querySelector('[data-blok-testid="notification-cross"]');
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

  if (cancelHandler && typeof cancelHandler === 'function' && crossBtn) {
    crossBtn.addEventListener('click', cancelHandler);
  }

  if (okHandler && typeof okHandler === 'function') {
    okBtn.addEventListener('click', () => {
      okHandler(input.value);
    });
  }

  okBtn.addEventListener('click', () => notify.remove());

  btnsWrapper.appendChild(input);
  btnsWrapper.appendChild(okBtn);

  notify.appendChild(btnsWrapper);

  return notify;
};

export const getWrapper = (): HTMLElement => {
  const wrapper = document.createElement('DIV');

  wrapper.className = CSS.wrapper;
  wrapper.setAttribute('data-blok-testid', 'notifier-container');

  return wrapper;
};
