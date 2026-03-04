import { twMerge, twJoin } from '../tw';

import type { NotifierOptions, ConfirmNotifierOptions, PromptNotifierOptions } from './types';

/**
 * SVG icons for notification styles.
 * Each icon is 16x16, stroke-based for consistency.
 */
const ICONS = {
  success: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.25"/><path d="M5.5 8.25l1.75 1.75 3.25-3.5"/></svg>`,
  error: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.25"/><path d="M8 5.25v3"/><circle cx="8" cy="10.75" r="0.5" fill="currentColor" stroke="none"/></svg>`,
  default: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.25"/><path d="M8 7.25v3.25"/><circle cx="8" cy="5.25" r="0.5" fill="currentColor" stroke="none"/></svg>`,
};

const CLOSE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 2l6 6M8 2l-6 6"/></svg>`;

export const CSS = {
  wrapper: twJoin(
    'fixed z-2 bottom-5 left-5',
    'font-[-apple-system,BlinkMacSystemFont,"Segoe_UI","Roboto","Oxygen","Ubuntu","Cantarell","Fira_Sans","Droid_Sans","Helvetica_Neue",sans-serif]'
  ),
  notification: twJoin(
    'relative flex items-start gap-2.5 w-[230px] mt-[15px] py-[13px] px-4',
    'bg-white shadow-notify rounded-[6px]',
    'text-sm leading-[1.4em] wrap-break-word overflow-hidden',
    'before:content-[""] before:absolute before:block before:top-0 before:left-0',
    'before:w-[3px] before:h-[calc(100%-6px)] before:m-[3px] before:rounded-[5px] before:bg-transparent'
  ),
  icon: 'shrink-0 mt-px',
  iconSuccess: 'text-[#34c992]',
  iconError: 'text-[#fb5d5d]',
  iconDefault: 'text-[#9ca3af]',
  messageWrapper: 'flex-1 min-w-0',
  crossBtn: twJoin(
    'absolute top-[7px] right-[7px] flex items-center justify-center',
    'w-6 h-6 rounded opacity-40 cursor-pointer',
    'transition-opacity duration-150',
    'hover:opacity-100'
  ),
  btnsWrapper: 'flex flex-row flex-nowrap mt-[5px]',
  btn: 'border-none rounded-[3px] text-[13px] py-[5px] px-2.5 cursor-pointer outline-hidden last:ml-2.5',
  okBtn: 'bg-[#34c992] shadow-[0_1px_1px_0_rgba(18,49,35,0.05)] text-white hover:bg-[#2db583]',
  cancelBtn: 'bg-[#f2f5f7] shadow-[0_2px_1px_0_rgba(16,19,29,0)] text-[#656b7c] hover:bg-[#e9ecee]',
  input: twJoin(
    'max-w-[130px] py-[5px] px-2.5 bg-[#f7f7f7] border-0 rounded-[3px]',
    'text-[13px] text-[#656b7c] outline-hidden',
    'placeholder:text-[#656b7c] focus:placeholder:text-[rgba(101,107,124,0.3)]'
  ),
  successNotification: twJoin(
    'bg-[#fafffe]!',
    'before:bg-[#41ffb1]!'
  ),
  errorNotification: twJoin(
    'bg-[#fffbfb]!',
    'before:bg-[#fb5d5d]!'
  ),
  progressBar: twJoin(
    'absolute bottom-0 left-0 h-[2px] rounded-b-[6px]',
    'animate-notify-progress'
  ),
  progressDefault: 'bg-[#d1d5db]',
  progressSuccess: 'bg-[#41ffb1]',
  progressError: 'bg-[#fb5d5d]',
};

/**
 * Creates an icon element for the notification.
 */
const createIcon = (style?: string): HTMLElement => {
  const iconWrapper = document.createElement('span');
  const resolvedStyle = style === 'success' || style === 'error' ? style : 'default';

  iconWrapper.innerHTML = ICONS[resolvedStyle];
  iconWrapper.setAttribute('data-blok-testid', 'notification-icon');
  iconWrapper.setAttribute('data-blok-style', resolvedStyle);

  const iconColorMap: Record<string, string> = {
    success: CSS.iconSuccess,
    error: CSS.iconError,
    default: CSS.iconDefault,
  };

  const colorClass = iconColorMap[resolvedStyle] ?? CSS.iconDefault;

  iconWrapper.className = twJoin(CSS.icon, colorClass);

  return iconWrapper;
};

/**
 * Creates a close (cross) button with an SVG icon.
 */
const createCloseButton = (): HTMLElement => {
  const cross = document.createElement('div');

  cross.className = CSS.crossBtn;
  cross.setAttribute('data-blok-testid', 'notification-cross');
  cross.innerHTML = CLOSE_ICON;

  return cross;
};

/**
 * Creates a progress bar element for auto-dismissing alerts.
 */
export const createProgressBar = (style?: string, time?: number): HTMLElement => {
  const bar = document.createElement('div');

  const progressColorMap: Record<string, string> = {
    success: CSS.progressSuccess,
    error: CSS.progressError,
  };

  const colorClass = progressColorMap[style ?? ''] ?? CSS.progressDefault;

  bar.className = twJoin(CSS.progressBar, colorClass);
  bar.setAttribute('data-blok-testid', 'notification-progress');
  bar.style.animationDuration = `${time ?? 8000}ms`;

  return bar;
};

/**
 * @param {NotifierOptions} options - options for the notification
 * @returns {HTMLElement} - the notification element
 */
export const alert = (options: NotifierOptions): HTMLElement => {
  const notify = document.createElement('DIV');
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

  // Icon
  const icon = createIcon(style);

  notify.appendChild(icon);

  // Message wrapper (flex child that holds message + buttons)
  const messageWrapper = document.createElement('div');

  messageWrapper.className = CSS.messageWrapper;
  messageWrapper.setAttribute('data-blok-testid', 'notification-message');
  messageWrapper.innerHTML = options.message;
  notify.appendChild(messageWrapper);

  // Close button
  const cross = createCloseButton();

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
  const messageWrapper = notify.querySelector('[data-blok-testid="notification-message"]') as HTMLElement;
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

  // Append buttons to the message wrapper so they flow under the message text
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

  // Append to message wrapper for proper flex layout
  if (messageWrapper) {
    messageWrapper.appendChild(btnsWrapper);
  } else {
    notify.appendChild(btnsWrapper);
  }

  return notify;
};

export const getWrapper = (): HTMLElement => {
  const wrapper = document.createElement('DIV');

  wrapper.className = CSS.wrapper;
  wrapper.setAttribute('data-blok-testid', 'notifier-container');

  return wrapper;
};
