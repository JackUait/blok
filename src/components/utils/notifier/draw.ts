import { englishDictionary } from '../../i18n/lightweight-i18n';
import { openModalDialog, type ModalDialogHandle } from '../modal-dialog';
import { twJoin } from '../tw';

import type { NotifierOptions, ConfirmNotifierOptions, PromptNotifierOptions, NotifierPosition } from './types';
import { DEFAULT_NOTIFIER_POSITION } from './types';

export const CSS = {
  /**
   * The wrapper class is built dynamically per-position.
   * See getPositionClasses().
   */
  // `bg-transparent` is load-bearing: promoted to the Top Layer, the UA
  // `[popover] { background: Canvas }` default would otherwise paint an opaque
  // box around the pill. The visible background lives on the inner notification.
  wrapper: 'fixed z-[9999] bg-transparent',
  notification: twJoin(
    'relative flex items-center justify-center mt-2 py-2 px-6',
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
  dismissBtn: twJoin(
    'shrink-0 ml-3 -mr-2 grid place-items-center w-6 h-6 rounded-full',
    'border-none bg-transparent text-[#a1a1aa] text-[16px] leading-none cursor-pointer',
    'outline-hidden hover:bg-white/10 hover:text-[#f5f5f5]',
    'focus-visible:ring-2 focus-visible:ring-white/40'
  ),
};

/**
 * Namespaced i18n key for the toast's dismiss-button accessible label. The
 * built-in notifier util has no access to a live I18n module instance, so it
 * resolves the label from the shared English dictionary and falls back to a
 * literal when the key is absent (see {@link createDismissButton}).
 */
export const NOTIFIER_DISMISS_KEY = 'notifier.dismiss';

/**
 * Close handlers for open confirm/prompt modal dialogs, keyed by the
 * notification element. The notifier's replacement path (index.ts) must close
 * a superseded modal's dialog handle before swapping in the new notification —
 * otherwise the handle's `finalize` never runs, the page-wide `inert` it
 * applied is never removed, and its dismissal layer leaks.
 */
export const modalCleanups = new WeakMap<HTMLElement, () => void>();

/**
 * English fallback used when the {@link NOTIFIER_DISMISS_KEY} translation is not
 * present in the bundled dictionary.
 */
const NOTIFIER_DISMISS_FALLBACK = 'Dismiss';

/**
 * Resolves the dismiss-button label from the bundled English dictionary,
 * falling back to {@link NOTIFIER_DISMISS_FALLBACK} when the key is absent.
 */
const resolveDismissLabel = (): string => {
  return (englishDictionary as Record<string, string>)[NOTIFIER_DISMISS_KEY] ?? NOTIFIER_DISMISS_FALLBACK;
};

/**
 * Builds the transient toast's dismiss button. Radix Toast / Sonner give every
 * toast an explicit, keyboard-reachable close affordance; the built-in toast
 * previously had none. The glyph is decorative (`aria-hidden`); the button is
 * named via `aria-label` so assistive tech announces its purpose.
 * @param {() => void} onDismiss - invoked when the button is activated
 * @returns {HTMLButtonElement} the dismiss button
 */
export const createDismissButton = (onDismiss: () => void): HTMLButtonElement => {
  const button = document.createElement('button');

  button.type = 'button';
  button.className = CSS.dismissBtn;
  button.setAttribute('data-blok-testid', 'notification-dismiss');
  button.setAttribute('aria-label', resolveDismissLabel());

  const glyph = document.createElement('span');

  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = '×';
  button.appendChild(glyph);

  button.addEventListener('click', () => onDismiss());

  return button;
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
 * Maps NotifierPosition to the same corner placement as {@link getPositionClasses},
 * but as inline-style declarations. The wrapper is promoted to the CSS Top Layer,
 * where the `[data-blok-top-layer][popover] { inset: auto }` reset (specificity
 * 0,2,0) outranks the `bottom-5 / left-1/2` utilities (0,1,0) and drops the toast
 * into the top-left corner. Inline styles (specificity 1,0,0,0) beat the reset, so
 * these must be applied directly to `wrapper.style`.
 */
export const getPositionStyles = (position: NotifierPosition = DEFAULT_NOTIFIER_POSITION): Record<string, string> => {
  const EDGE = '1.25rem';
  // Only the inset properties (top/right/bottom/left) are re-asserted inline: the
  // reset zeroes `inset`, but leaves the `-translate-x-1/2` class's `translate`
  // property intact, so centering still comes from the utility class. Setting an
  // inline `transform`/`translate` here would STACK with it and double-shift the
  // centered toasts off to the side.
  const map: Record<NotifierPosition, Record<string, string>> = {
    'bottom-left': { bottom: EDGE, left: EDGE },
    'bottom-right': { bottom: EDGE, right: EDGE },
    'bottom-center': { bottom: EDGE, left: '50%' },
    'top-left': { top: EDGE, left: EDGE },
    'top-right': { top: EDGE, right: EDGE },
    'top-center': { top: EDGE, left: '50%' },
  };

  return map[position] ?? map['bottom-left'];
};

/**
 * Incrementing counter used to mint unique ids for the message element so that
 * modal dialogs can reference it via aria-labelledby.
 */
const messageIdState = { count: 0 };

const MESSAGE_TEXT_TESTID = 'notification-message-text';

/**
 * Turns a notification into an accessible modal alertdialog via the shared
 * {@link openModalDialog} primitive: sets the dialog roles, links the message
 * as its label, installs the focus trap + background `inert`, moves focus
 * inside on mount, and wires Escape dismissal through the shared dismissal
 * layer. Returns the dialog handle so callers can close it.
 *
 * The notification is kept out of the CSS Top Layer (`topLayer: false`) so the
 * toast wrapper's corner positioning is preserved; the background is still made
 * non-interactive by the primitive's `inert` pass. Outside-pointer dismissal is
 * disabled — confirm/prompt resolve only via their buttons or Escape.
 * @param {HTMLElement} notify - notification element (appended by index.ts)
 * @param {HTMLElement} messageText - element holding the message text
 * @param {() => HTMLElement | null} getFocusTarget - resolves the element that should receive initial focus
 * @param {() => void} onDismiss - invoked when the dialog is dismissed via Escape
 * @returns {ModalDialogHandle} the dialog handle
 */
const makeModal = (
  notify: HTMLElement,
  messageText: HTMLElement,
  getFocusTarget: () => HTMLElement | null,
  onDismiss: () => void
): ModalDialogHandle => {
  // The message is now a dialog label, not a standalone announcement.
  messageText.removeAttribute('aria-live');
  messageText.removeAttribute('aria-atomic');

  return openModalDialog({
    content: notify,
    role: 'alertdialog',
    labelledBy: messageText.id,
    initialFocus: getFocusTarget,
    onDismiss,
    // index.ts appends the notification into the positioned toast wrapper.
    container: null,
    // Keep the toast's corner positioning; `inert` still blocks the background.
    topLayer: false,
    // confirm/prompt dismiss only via their buttons or Escape.
    outside: false,
  });
};

/**
 * Builds the cancel handler shared by {@link confirm} and {@link prompt}: it
 * invokes the caller's optional cancel callback (when provided) and then closes
 * the modal dialog. The handle is resolved lazily via {@link getHandle} because
 * it is constructed after the handler at both call sites.
 * @param {((event: Event) => void) | undefined} cancelHandler - caller's cancel callback
 * @param {() => ModalDialogHandle} getHandle - resolves the modal dialog handle
 * @returns {(event: Event) => void} the cancel handler
 */
const makeCancelHandler = (
  cancelHandler: ((event: Event) => void) | undefined,
  getHandle: () => ModalDialogHandle
) => (event: Event): void => {
  if (typeof cancelHandler === 'function') {
    cancelHandler(event);
  }
  getHandle().close();
};

/**
 * @param {NotifierOptions} options - options for the notification
 * @returns {HTMLElement} - the notification element
 */
export const alert = (options: NotifierOptions): HTMLElement => {
  const notify = document.createElement('DIV');
  const style = options.style;

  notify.className = CSS.notification;
  // `status` is the correct role for a transient, non-critical live message;
  // `region` implies a persistent landmark. confirm()/prompt() upgrade this to
  // `alertdialog` via openModalDialog().
  notify.setAttribute('role', 'status');

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

  messageIdState.count += 1;
  messageText.id = `blok-notification-message-${messageIdState.count}`;
  messageText.setAttribute('data-blok-testid', MESSAGE_TEXT_TESTID);
  messageText.setAttribute('aria-live', style === 'error' ? 'assertive' : 'polite');
  messageText.setAttribute('aria-atomic', 'true');

  // Screen readers reliably announce a live region only when its content is
  // mutated *after* the region is already connected to the DOM. Insert the node
  // empty and write the text on the next microtask, by which point index.ts's
  // appendNotify has connected it. confirm()/prompt() overwrite this text
  // synchronously (they need it for aria-labelledby), so this deferral only
  // affects the standalone alert toast.
  queueMicrotask(() => {
    if (messageText.isConnected) {
      messageText.innerHTML = options.message;
    }
  });

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

  // alert() defers its live-region text; a modal dialog uses this node as its
  // aria-labelledby target, so it must carry the text synchronously.
  messageText.innerHTML = options.message;

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

  const cancel = makeCancelHandler(cancelHandler, () => handle);

  const confirmOk = (event: Event): void => {
    if (typeof okHandler === 'function') {
      okHandler(event);
    }
    handle.close();
  };

  const handle = makeModal(notify, messageText, () => okBtn, () => cancel(new Event('dismiss')));

  modalCleanups.set(notify, () => handle.close());

  okBtn.addEventListener('click', confirmOk);
  cancelBtn.addEventListener('click', cancel);

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

  // alert() defers its live-region text; a modal dialog uses this node as its
  // aria-labelledby target, so it must carry the text synchronously.
  messageText.innerHTML = options.message;

  btnsWrapper.className = CSS.btnsWrapper;

  okBtn.innerHTML = options.okText || 'OK';
  okBtn.className = twJoin(CSS.btn, CSS.okBtn);
  okBtn.setAttribute('data-blok-testid', 'notification-confirm-button');

  cancelBtn.innerHTML = options.cancelText || 'Cancel';
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

  const submit = (): void => {
    if (typeof okHandler === 'function') {
      okHandler(input.value);
    }
    handle.close();
  };

  const cancel = makeCancelHandler(cancelHandler, () => handle);

  const handle = makeModal(notify, messageText, () => input, () => cancel(new Event('dismiss')));

  modalCleanups.set(notify, () => handle.close());

  okBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', cancel);

  input.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
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
  // The wrapper is body-mounted, outside the editor root. Compiled Tailwind
  // utilities and the preflight reset are scoped to
  // `[data-blok-interface]`/`[data-blok-popover]` roots, so without this bare
  // attribute every toast utility (bg, padding, rounded, flex, …) silently
  // dies in consumer apps. `data-blok-interface` (not `data-blok-popover`) so
  // the keyboard controller's Escape-inside-popover handling does not grab
  // Escape from the prompt input. Enforced by body-mount-scope-law.test.ts.
  wrapper.setAttribute('data-blok-interface', 'notifier');

  // Re-assert corner placement inline so the Top-Layer `inset: auto` reset can't
  // clobber the utility classes above (see getPositionStyles).
  Object.entries(getPositionStyles(position)).forEach(([prop, value]) => {
    wrapper.style.setProperty(prop, value);
  });

  return wrapper;
};
