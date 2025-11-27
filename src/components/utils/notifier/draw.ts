import type { NotifierOptions, ConfirmNotifierOptions, PromptNotifierOptions } from './types';

export const CSS = {
  wrapper: 'blok-notifies',
  notification: 'blok-notify',
  crossBtn: 'blok-notify__cross',
  okBtn: 'blok-notify__button--confirm',
  cancelBtn: 'blok-notify__button--cancel',
  input: 'blok-notify__input',
  btn: 'blok-notify__button',
  btnsWrapper: 'blok-notify__btns-wrapper',
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

  notify.classList.add(CSS.notification);

  if (style) {
    notify.classList.add(CSS.notification + '--' + style);
    notify.setAttribute('data-blok-testid', `notification-${style}`);
  } else {
    notify.setAttribute('data-blok-testid', 'notification');
  }

  notify.innerHTML = message;

  cross.classList.add(CSS.crossBtn);
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
  const crossBtn = notify.querySelector(`.${CSS.crossBtn}`);
  const cancelHandler = options.cancelHandler;
  const okHandler = options.okHandler;

  btnsWrapper.classList.add(CSS.btnsWrapper);
  btnsWrapper.setAttribute('data-blok-testid', 'notification-buttons-wrapper');

  okBtn.innerHTML = options.okText || 'Confirm';
  cancelBtn.innerHTML = options.cancelText || 'Cancel';

  okBtn.classList.add(CSS.btn);
  cancelBtn.classList.add(CSS.btn);
  okBtn.classList.add(CSS.okBtn);
  cancelBtn.classList.add(CSS.cancelBtn);

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
  const crossBtn = notify.querySelector(`.${CSS.crossBtn}`);
  const cancelHandler = options.cancelHandler;
  const okHandler = options.okHandler;

  btnsWrapper.classList.add(CSS.btnsWrapper);

  okBtn.innerHTML = options.okText || 'Ok';
  okBtn.classList.add(CSS.btn);
  okBtn.classList.add(CSS.okBtn);

  input.classList.add(CSS.input);
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

  wrapper.classList.add(CSS.wrapper);
  wrapper.setAttribute('data-blok-testid', 'notifier-container');

  return wrapper;
};
