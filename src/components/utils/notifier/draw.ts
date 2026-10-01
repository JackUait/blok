import { IconCheck, IconCross, IconImageBroken } from '../../icons';
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
    // `leading-[1.4]` MUST stay arbitrary: in Tailwind 4 a bare `leading-1.4`
    // means calc(var(--spacing) * 1.4), and 1.4 is off the 0.25 grid, so the
    // utility matches nothing and emits ZERO CSS. `no-unnecessary-arbitrary-value`
    // autofixed exactly that in f6321517 and silently removed the toast's
    // line-height; the rule is now off (see eslint.config.mjs).
    // Guarded by test/unit/styles/tailwind-class-emits-law.test.ts.
    'text-[15px] font-normal leading-[1.4] tracking-[-0.015em] wrap-break-word overflow-hidden',
    'shadow-[0_8px_32px_rgba(0,0,0,0.4),0_1px_4px_rgba(0,0,0,0.25)]',
    'border border-white/[0.08]'
  ),
  // A toast is a surface; confirm, prompt and the leave banner are modal, so dialogs.
  surface: 'rounded-(--blok-radius-surface)',
  dialog: 'rounded-(--blok-radius-dialog)',
  messageWrapper: 'flex-1 min-w-0',
  btnsWrapper: 'flex flex-row flex-nowrap mt-[8px] gap-2',
  btn: 'border-none rounded-(--blok-radius-control) text-[13px] py-[5px] px-3 cursor-pointer outline-hidden font-medium',
  okBtn: 'bg-white/15 text-[#f5f5f5] hover:bg-white/25',
  cancelBtn: 'bg-white/8 text-[#a1a1aa] hover:bg-white/12',
  input: twJoin(
    // px, not the rem-based `max-w-35`: the toast must not resize with the host's root font-size.
    'max-w-[140px] py-[5px] px-3 bg-white/10 border border-white/10 rounded-(--blok-radius-field)',
    'text-[13px] text-[#e4e4e7] outline-hidden',
    'placeholder:text-white/30 focus:border-white/20'
  ),
  dismissBtn: twJoin(
    'shrink-0 ms-3 -me-2 grid place-items-center w-6 h-6 rounded-full',
    'border-none bg-transparent text-[#a1a1aa] text-[16px] leading-none cursor-pointer',
    'outline-hidden hover:bg-white/10 hover:text-[#f5f5f5]',
    'focus-visible:ring-2 focus-visible:ring-focus-ring'
  ),
};

/**
 * Namespaced i18n key for the toast's dismiss-button accessible label. The
 * drawing utility has no live I18n module, so callers must resolve this key and
 * pass the localized value to {@link createDismissButton}.
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

const toastDismissers = new WeakMap<HTMLElement, () => void>();

/**
 * Lets a toast's close button reach the lifecycle index.ts starts after mount.
 * @param notify - the toast element
 * @param dismiss - closes it; pass null to unregister
 */
export const setToastDismisser = (notify: HTMLElement, dismiss: (() => void) | null): void => {
  if (dismiss === null) {
    toastDismissers.delete(notify);
  } else {
    toastDismissers.set(notify, dismiss);
  }
};

/**
 * Builds the transient toast's dismiss button. Radix Toast / Sonner give every
 * toast an explicit, keyboard-reachable close affordance; the built-in toast
 * previously had none. The glyph is decorative (`aria-hidden`); the button is
 * named via `aria-label` so assistive tech announces its purpose.
 * @param {() => void} onDismiss - invoked when the button is activated
 * @param {string} label - localized accessible label resolved by the caller
 * @returns {HTMLButtonElement} the dismiss button
 */
export const createDismissButton = (
  onDismiss: () => void,
  label: string
): HTMLButtonElement => {
  const button = document.createElement('button');

  button.type = 'button';
  button.className = CSS.dismissBtn;
  button.setAttribute('data-blok-testid', 'notification-dismiss');
  button.setAttribute('aria-label', label);

  const glyph = document.createElement('span');

  glyph.setAttribute('aria-hidden', 'true');
  glyph.className = 'grid';
  glyph.innerHTML = IconCross;
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
  notify.classList.replace(CSS.surface, CSS.dialog);

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

// The only sources a tile loads: a local object URL or an inert raster data image.
// No http(s) (the toast must not fetch a host string) and no svg data.
const SAFE_THUMBNAIL = /^(?:blob:|data:image\/(?:png|jpe?g|gif|webp|avif|bmp)[;,])/i;
const MAX_TILES = 3;

const drawThumb = (source: string | null): HTMLElement => {
  const thumb = document.createElement('div');

  thumb.setAttribute('data-blok-testid', 'notification-thumb');
  thumb.setAttribute('data-blok-toast-part', 'thumb');

  if (source !== null && SAFE_THUMBNAIL.test(source)) {
    const img = document.createElement('img');

    img.setAttribute('alt', '');
    img.setAttribute('src', source);
    thumb.appendChild(img);
  } else {
    thumb.setAttribute('data-broken', '');
    thumb.innerHTML = IconImageBroken;
  }

  return thumb;
};

const drawTile = (thumbnails: (string | null)[]): HTMLElement => {
  const tile = document.createElement('div');

  tile.setAttribute('data-blok-testid', 'notification-tile');
  tile.setAttribute('data-blok-toast-part', 'tile');
  tile.setAttribute('aria-hidden', 'true');
  tile.setAttribute('data-stack', String(Math.min(thumbnails.length, MAX_TILES)));
  // Reversed so the first thumbnail paints on top of the fan.
  thumbnails.slice(0, MAX_TILES).reverse().forEach((source) => tile.appendChild(drawThumb(source)));

  if (thumbnails.length > 1) {
    const count = document.createElement('span');

    count.setAttribute('data-blok-testid', 'notification-count');
    count.setAttribute('data-blok-toast-part', 'count');
    count.textContent = String(thumbnails.length);
    tile.appendChild(count);
  }

  return tile;
};

const drawSpinner = (): HTMLElement => {
  const spinner = document.createElement('span');

  spinner.setAttribute('data-blok-testid', 'notification-spinner');
  spinner.setAttribute('data-blok-toast-part', 'spinner');
  spinner.setAttribute('aria-hidden', 'true');

  return spinner;
};

/**
 * Lays an alert with actions out as a card: tile, text, actions, close.
 * @param notify - the toast root
 * @param messageWrapper - holds the live-region message text
 * @param options - the toast options
 */
const drawCard = (notify: HTMLElement, messageWrapper: HTMLElement, options: NotifierOptions): void => {
  notify.setAttribute('data-blok-toast', 'card');
  messageWrapper.setAttribute('data-blok-toast-part', 'body');

  if (options.thumbnails !== undefined && options.thumbnails.length > 0) {
    notify.insertBefore(drawTile(options.thumbnails), messageWrapper);
  }

  if (options.detail !== undefined && options.detail !== '') {
    const detail = document.createElement('div');

    detail.setAttribute('data-blok-testid', 'notification-detail');
    detail.setAttribute('data-blok-toast-part', 'detail');
    detail.textContent = options.detail;
    messageWrapper.appendChild(detail);
  }

  const actions = document.createElement('div');

  actions.setAttribute('data-blok-toast-part', 'actions');
  (options.actions ?? []).forEach((action) => {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute('data-blok-testid', 'notification-action');
    button.setAttribute('data-blok-toast-part', 'action');
    if (action.primary === true) {
      button.setAttribute('data-primary', 'true');
    }
    button.textContent = action.label;
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-busy') === 'true') {
        return;
      }
      if (action.busyOnClick === true) {
        // The label stays the accessible name while the spinner replaces it on screen.
        button.setAttribute('aria-label', action.label);
        button.setAttribute('aria-busy', 'true');
        button.appendChild(drawSpinner());
      }
      action.onClick();
    });
    actions.appendChild(button);
  });
  notify.appendChild(actions);
  notify.appendChild(createDismissButton(() => toastDismissers.get(notify)?.(), options.dismissText ?? 'Close'));
};

/**
 * Turns a card into its success state: check tile, new message, no actions.
 * @param notify - a card drawn by `alert`
 * @param message - plain text
 */
export const drawResolved = (notify: HTMLElement, message: string): void => {
  const hadFocus = notify.contains(document.activeElement);
  const box = notify.getBoundingClientRect();
  const check = document.createElement('div');
  const text = notify.querySelector<HTMLElement>(`[data-blok-testid="${MESSAGE_TEXT_TESTID}"]`);
  const leaving = [
    notify.querySelector<HTMLElement>('[data-blok-toast-part="tile"]'),
    text,
    notify.querySelector<HTMLElement>('[data-blok-toast-part="detail"]'),
    notify.querySelector<HTMLElement>('[data-blok-toast-part="actions"]'),
  ].filter((part): part is HTMLElement => part !== null);
  const ghosts = leaving.map((part) => ghostOf(part, box));

  // Hold the width: the shorter success content would otherwise snap the card narrower.
  if (box.width > 0) {
    notify.style.setProperty('width', `${box.width}px`);
  }

  notify.setAttribute('data-resolved', 'true');
  check.setAttribute('data-blok-testid', 'notification-check');
  check.setAttribute('data-blok-toast-part', 'check');
  check.setAttribute('aria-hidden', 'true');
  check.innerHTML = IconCheck;
  // A unit length lets CSS draw the stroke with a 0→1 dash offset.
  check.querySelector('path')?.setAttribute('pathLength', '1');
  notify.querySelector('[data-blok-toast-part="tile"]')?.remove();
  notify.querySelector('[data-blok-toast-part="detail"]')?.remove();
  notify.querySelector('[data-blok-toast-part="actions"]')?.remove();
  notify.insertBefore(check, notify.firstChild);
  if (text !== null) {
    text.textContent = message;
  }
  notify.append(...ghosts);
  glideHeight(notify, box.height);
  if (hadFocus) {
    notify.querySelector<HTMLElement>('[data-blok-testid="notification-dismiss"]')?.focus();
  }
};

/**
 * A copy of a leaving part, pinned where it was, that fades out on its own.
 * @param part - the element about to be removed or rewritten
 * @param box - the card's box before the change
 * @returns the ghost, not yet attached
 */
const ghostOf = (part: HTMLElement, box: DOMRect): HTMLElement => {
  const rect = part.getBoundingClientRect();
  const ghost = part.cloneNode(true);

  if (!(ghost instanceof HTMLElement)) {
    return document.createElement('div');
  }
  const look = window.getComputedStyle(part);

  // The title is styled by its test id, which must go: carry its type inline.
  ['font-size', 'font-weight', 'line-height', 'letter-spacing', 'color'].forEach((name) => {
    ghost.style.setProperty(name, look.getPropertyValue(name));
  });
  // Test ids would make the ghost pass for the live part it copies.
  [ghost, ...Array.from(ghost.querySelectorAll('[data-blok-testid]'))].forEach((el) => el.removeAttribute('data-blok-testid'));
  ghost.setAttribute('data-blok-toast-ghost', 'true');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.style.setProperty('left', `${rect.left - box.left}px`);
  ghost.style.setProperty('top', `${rect.top - box.top}px`);
  ghost.style.setProperty('width', `${rect.width}px`);
  ghost.style.setProperty('height', `${rect.height}px`);
  ghost.addEventListener('animationend', () => ghost.remove());
  // Reduced motion runs no animation, so animationend never comes.
  window.setTimeout(() => ghost.remove(), GHOST_MAX_MS);

  return ghost;
};

/** Longer than the ghost's fade in notifier-card.css. */
const GHOST_MAX_MS = 600;

/**
 * Lets the card ease from its old height to its new one, then releases it.
 * @param notify - the card, already holding its new content
 * @param from - its height before the change
 */
const glideHeight = (notify: HTMLElement, from: number): void => {
  const to = notify.getBoundingClientRect().height;

  if (from <= 0 || Math.abs(to - from) < 1) {
    return;
  }
  notify.style.setProperty('height', `${from}px`);
  const release = (): void => {
    notify.style.removeProperty('height');
    notify.removeEventListener('transitionend', onEnd);
  };
  const onEnd = (event: Event): void => {
    if ('propertyName' in event && event.propertyName === 'height') {
      release();
    }
  };

  notify.addEventListener('transitionend', onEnd);
  // Reduced motion has no transition, so transitionend never comes.
  window.setTimeout(release, GHOST_MAX_MS);
  requestAnimationFrame(() => notify.style.setProperty('height', `${to}px`));
};

/**
 * @param {NotifierOptions} options - options for the notification
 * @returns {HTMLElement} - the notification element
 */
export const alert = (options: NotifierOptions): HTMLElement => {
  const notify = document.createElement('DIV');
  const style = options.style;

  notify.className = twJoin(CSS.notification, CSS.surface);
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
    // A card resolved before this ran already holds its final text.
    if (messageText.isConnected && !notify.hasAttribute('data-resolved')) {
      messageText.innerHTML = options.message;
    }
  });

  messageWrapper.appendChild(messageText);
  notify.appendChild(messageWrapper);

  if (options.actions !== undefined && options.actions.length > 0) {
    drawCard(notify, messageWrapper, options);
  }

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
