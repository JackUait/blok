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
 * Incrementing counter used to mint unique ids for the message element so that
 * modal dialogs can reference it via aria-labelledby.
 */
let messageIdCounter = 0;

const MESSAGE_TEXT_TESTID = 'notification-message-text';

/**
 * Collects the focusable descendants of a container in DOM order.
 * @param {HTMLElement} container - dialog element
 * @returns {HTMLElement[]} focusable elements
 */
const getFocusables = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('button, input, [tabindex]'));

/**
 * Turns a notification into an accessible modal dialog: sets the dialog roles,
 * links the message as its label, installs a focus trap, moves focus inside on
 * mount and returns a callback that restores focus to the previously-focused
 * element when the dialog closes.
 * @param {HTMLElement} notify - notification element
 * @param {HTMLElement} messageText - element holding the message text
 * @param {() => HTMLElement | null} getFocusTarget - resolves the element that should receive initial focus
 * @returns {() => void} restoreFocus callback
 */
const makeModal = (
  notify: HTMLElement,
  messageText: HTMLElement,
  getFocusTarget: () => HTMLElement | null
): (() => void) => {
  notify.setAttribute('role', 'alertdialog');
  notify.setAttribute('aria-modal', 'true');
  notify.setAttribute('aria-labelledby', messageText.id);

  // The message is now a dialog label, not a standalone announcement.
  messageText.removeAttribute('aria-live');
  messageText.removeAttribute('aria-atomic');

  const previouslyFocused = document.activeElement as HTMLElement | null;

  notify.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Tab') {
      return;
    }

    const focusables = getFocusables(notify);

    if (focusables.length === 0) {
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  // Move focus inside once the caller has connected the element to the DOM.
  queueMicrotask(() => {
    const target = getFocusTarget();

    if (target !== null && target.isConnected) {
      target.focus();
    }
  });

  return () => {
    if (previouslyFocused !== null && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
  };
};

/**
 * @param {NotifierOptions} options - options for the notification
 * @returns {HTMLElement} - the notification element
 */
export const alert = (options: NotifierOptions): HTMLElement => {
  const notify = document.createElement('DIV');
  const style = options.style;

  notify.className = CSS.notification;
  notify.setAttribute('role', 'region');

  if (style) {
    notify.setAttribute('data-blok-testid', `notification-${style}`);
  } else {
    notify.setAttribute('data-blok-testid', 'notification');
  }

  // Message wrapper
  const messageWrapper = document.createElement('div');

  messageWrapper.className = CSS.messageWrapper;
  messageWrapper.setAttribute('data-blok-testid', 'notification-message');

  // Live region so assistive tech announces the message text.
  const messageText = document.createElement('div');

  messageIdCounter += 1;
  messageText.id = `blok-notification-message-${messageIdCounter}`;
  messageText.setAttribute('data-blok-testid', MESSAGE_TEXT_TESTID);
  messageText.setAttribute('aria-live', style === 'error' ? 'assertive' : 'polite');
  messageText.setAttribute('aria-atomic', 'true');
  messageText.innerHTML = options.message;

  messageWrapper.appendChild(messageText);
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
  const messageText = notify.querySelector(`[data-blok-testid="${MESSAGE_TEXT_TESTID}"]`) as HTMLElement;
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

  btnsWrapper.appendChild(okBtn);
  btnsWrapper.appendChild(cancelBtn);

  if (messageWrapper) {
    messageWrapper.appendChild(btnsWrapper);
  } else {
    notify.appendChild(btnsWrapper);
  }

  const restoreFocus = makeModal(notify, messageText, () => okBtn);

  const cancel = (event: Event): void => {
    if (typeof cancelHandler === 'function') {
      cancelHandler(event);
    }
    notify.remove();
    restoreFocus();
  };

  const confirmOk = (event: Event): void => {
    if (typeof okHandler === 'function') {
      okHandler(event);
    }
    notify.remove();
    restoreFocus();
  };

  okBtn.addEventListener('click', confirmOk);
  cancelBtn.addEventListener('click', cancel);

  notify.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel(event);
    }
  });

  return notify;
};

/**
 * @param {PromptNotifierOptions} options - options for the prompt notification
 * @returns {HTMLElement} - the notification element
 */
export const prompt = (options: PromptNotifierOptions): HTMLElement => {
  const notify = alert(options);
  const messageWrapper = notify.querySelector('[data-blok-testid="notification-message"]') as HTMLElement;
  const messageText = notify.querySelector(`[data-blok-testid="${MESSAGE_TEXT_TESTID}"]`) as HTMLElement;
  const btnsWrapper = document.createElement('div');
  const okBtn = document.createElement('button');
  const cancelBtn = document.createElement('button');
  const input = document.createElement('input');
  const cancelHandler = options.cancelHandler;
  const okHandler = options.okHandler;

  btnsWrapper.className = CSS.btnsWrapper;

  okBtn.innerHTML = options.okText || 'Ok';
  okBtn.className = twJoin(CSS.btn, CSS.okBtn);
  okBtn.setAttribute('data-blok-testid', 'notification-confirm-button');

  cancelBtn.innerHTML = 'Cancel';
  cancelBtn.className = twJoin(CSS.btn, CSS.cancelBtn);
  cancelBtn.setAttribute('data-blok-testid', 'notification-cancel-button');

  input.className = CSS.input;
  input.setAttribute('data-blok-testid', 'notification-input');
  input.setAttribute('aria-labelledby', messageText.id);

  if (options.placeholder) {
    input.setAttribute('placeholder', options.placeholder);
  }

  if (options.default) {
    input.value = options.default;
  }

  if (options.inputType) {
    input.type = options.inputType;
  }

  btnsWrapper.appendChild(input);
  btnsWrapper.appendChild(okBtn);
  btnsWrapper.appendChild(cancelBtn);

  if (messageWrapper) {
    messageWrapper.appendChild(btnsWrapper);
  } else {
    notify.appendChild(btnsWrapper);
  }

  const restoreFocus = makeModal(notify, messageText, () => input);

  const submit = (): void => {
    if (typeof okHandler === 'function') {
      okHandler(input.value);
    }
    notify.remove();
    restoreFocus();
  };

  const cancel = (event: Event): void => {
    if (typeof cancelHandler === 'function') {
      cancelHandler(event);
    }
    notify.remove();
    restoreFocus();
  };

  okBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', cancel);

  input.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });

  notify.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel(event);
    }
  });

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
