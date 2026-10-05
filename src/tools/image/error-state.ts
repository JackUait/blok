import { DATA_ATTR } from '../../components/constants/data-attributes';
import { IconCross, IconImage, IconImageBroken, IconUploadFailed } from '../../components/icons';
import { formatBytes } from '../../components/utils/format-bytes';
import type { I18nInstance } from '../../components/utils/tools';
import { tr } from './i18n';

export type ErrorVariant = 'broken' | 'upload';

export interface ErrorStateOptions {
  title?: string;
  message?: string;
  variant?: ErrorVariant;
  /** The same card while a retry runs: busy, buttons off, so nothing moves. */
  mending?: boolean;
  /** Broken: the picture's saved width (%) and size, so the card keeps its shape. */
  frame?: { width?: number; naturalWidth?: number; naturalHeight?: number };
  /** Upload: the file (or link) that did not upload. */
  file?: { name: string; size?: number; preview?: string | null };
  /** Upload: how many times it was tried; shown from the second try. */
  attempt?: number;
  /** Upload: this failure ended a send, so the card plays its fall back. */
  resent?: boolean;
  onTryAgain?(): void;
  onSwap?(): void;
  i18n?: I18nInstance;
}

export function renderErrorState(opts: ErrorStateOptions): HTMLElement {
  const root = document.createElement('div');
  root.className = 'blok-image-error';
  root.setAttribute('data-role', opts.mending ? 'mend-state' : 'error-state');
  if (opts.mending) {
    root.setAttribute('aria-busy', 'true');
  } else {
    root.setAttribute(DATA_ATTR.spotlightTarget, '');
  }
  const variant: ErrorVariant = opts.variant ?? 'broken';
  root.setAttribute('data-variant', variant);
  if (opts.resent === true) {
    root.setAttribute('data-resent', 'true');
  }
  if (variant === 'broken') {
    applyFrame(root, opts.frame);
  }

  const icon = document.createElement('div');
  icon.className = 'blok-image-error__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = variant === 'upload' ? IconUploadFailed : IconImageBroken;
  if (variant === 'broken') {
    // The whole picture the broken one was cut from; CSS shows it once a
    // retry closes the crack, and a failed retry breaks it again.
    icon.firstElementChild?.setAttribute('data-icon', 'broken');
    icon.insertAdjacentHTML('beforeend', IconImage);
    icon.lastElementChild?.setAttribute('data-icon', 'whole');
  }

  const body = document.createElement('div');
  body.className = 'blok-image-error__body';

  const title = document.createElement('div');
  title.className = 'blok-image-error__title';
  // A failed upload is named by its file; everything else by its title.
  title.textContent = variant === 'upload' && opts.file !== undefined
    ? displayName(opts.file.name)
    : opts.title ?? tr(opts.i18n, 'tools.image.errorDefaultTitle');

  const msg = document.createElement('div');
  msg.className = 'blok-image-error__msg';
  msg.textContent = opts.message ?? tr(opts.i18n, 'tools.image.errorDefaultMessage');

  body.append(title);
  // Before the reason line, which takes a row of its own; the size lands after the title.
  if (opts.attempt !== undefined && opts.attempt > 1) {
    const attempt = document.createElement('span');

    attempt.className = 'blok-image-error__attempt';
    attempt.setAttribute('aria-hidden', 'true');
    attempt.textContent = `×${opts.attempt}`;
    body.append(attempt);
  }
  body.append(msg);
  root.append(icon, body);
  if (variant === 'upload' && opts.file !== undefined) {
    showFile(icon, title, opts.file);
  }

  if (opts.onTryAgain || opts.onSwap) {
    const actions = document.createElement('div');
    actions.className = 'blok-image-error__actions';

    if (opts.onTryAgain) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'blok-image-error__btn';
      retry.setAttribute('data-action', 'retry');
      retry.disabled = opts.mending === true;
      retry.toggleAttribute(DATA_ATTR.spotlightFocus, !opts.mending);
      retry.textContent = tr(opts.i18n, `tools.image.error${'Retr' + 'y'}`);
      retry.addEventListener('click', () => {
        opts.onTryAgain?.();
      });
      actions.appendChild(retry);
    }

    if (opts.onSwap && variant === 'upload' && opts.file !== undefined) {
      actions.appendChild(crossButton(opts));
    } else if (opts.onSwap) {
      const replace = document.createElement('button');
      replace.type = 'button';
      replace.className = 'blok-image-error__btn';
      replace.setAttribute('data-action', 'replace');
      replace.disabled = opts.mending === true;
      replace.textContent = tr(opts.i18n, `tools.image.error${'Rep' + 'lace'}`);
      replace.addEventListener('click', () => {
        opts.onSwap?.();
      });
      actions.appendChild(replace);
    }

    root.appendChild(actions);
  }

  return root;
}

/**
 * Puts a failed upload card into its sending look, in place, so the change
 * animates on the card the user clicked.
 * @param card - a card from {@link renderErrorState}
 * @param i18n - for the status line and the progress label
 * @returns a setter for the upload's progress, 0 to 100
 */
export function startSending(card: HTMLElement, i18n?: I18nInstance): (percent: number) => void {
  card.setAttribute('data-sending', 'true');
  card.setAttribute('aria-busy', 'true');
  card.removeAttribute('data-resent');
  card.querySelectorAll('button').forEach((button) => {
    button.toggleAttribute('disabled', true);
  });

  const msg = card.querySelector('.blok-image-error__msg');

  if (msg !== null) {
    msg.textContent = tr(i18n, 'tools.image.uploading');
  }

  const bar = document.createElement('div');

  bar.className = 'blok-image-error__progress';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', tr(i18n, 'tools.image.uploadProgress'));
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  // Sweeps until the uploader reports, since many never do.
  bar.setAttribute('data-indeterminate', '');
  card.append(bar);

  return (percent) => {
    const value = Math.round(Math.min(100, Math.max(0, percent)));

    bar.removeAttribute('data-indeterminate');
    bar.setAttribute('aria-valuenow', String(value));
    bar.style.setProperty('--blok-image-send-progress', `${value}%`);
  };
}

/**
 * Sizes a broken card like the picture it stands in for. Without saved
 * dimensions it keeps the CSS default height rather than guess a ratio.
 * @param root - the card
 * @param frame - the picture's saved width and size
 */
function applyFrame(root: HTMLElement, frame: ErrorStateOptions['frame']): void {
  if (frame?.width !== undefined) {
    root.style.setProperty('width', `${frame.width}%`);
  }
  if (frame?.naturalWidth && frame.naturalHeight) {
    root.style.setProperty('aspect-ratio', `${frame.naturalWidth} / ${frame.naturalHeight}`);
  }
}

/**
 * Puts the file on the card: its picture in the tile, its size beside the title.
 * @param icon - the tile
 * @param title - the title line, already naming the file
 * @param file - the file or link that did not upload
 */
function showFile(icon: HTMLElement, title: HTMLElement, file: NonNullable<ErrorStateOptions['file']>): void {
  const size = file.size === undefined ? '' : formatBytes(file.size);

  if (size !== '') {
    const sizeEl = document.createElement('span');

    sizeEl.className = 'blok-image-error__size';
    sizeEl.textContent = size;
    title.after(sizeEl);
  }
  if (file.preview) {
    const img = document.createElement('img');

    img.src = file.preview;
    img.alt = '';
    icon.replaceChildren(img);
    icon.setAttribute('data-thumb', 'true');
  }
}

/**
 * A link's last path segment, or its host; a plain file name as is.
 * @param name - a file name or a URL
 * @returns the name to show
 */
function displayName(name: string): string {
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(name)) {
    return name;
  }
  try {
    const url = new URL(name);
    const last = url.pathname.split('/').filter(Boolean).pop();

    return last === undefined ? url.host : decodeURIComponent(last);
  } catch {
    return name;
  }
}

/**
 * The upload card's dismiss: drops the failed upload and reopens the picker.
 * @param opts - the card options (onSwap, i18n, mending)
 * @returns the button
 */
function crossButton(opts: ErrorStateOptions): HTMLButtonElement {
  const cross = document.createElement('button');

  cross.type = 'button';
  cross.className = 'blok-image-error__dismiss';
  cross.setAttribute('data-action', 'replace');
  cross.setAttribute('aria-label', tr(opts.i18n, 'tools.image.cancelUpload'));
  cross.disabled = opts.mending === true;
  cross.innerHTML = IconCross;
  cross.addEventListener('click', () => {
    opts.onSwap?.();
  });

  return cross;
}
