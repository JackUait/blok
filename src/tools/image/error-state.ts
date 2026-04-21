import { IconImageBroken } from '../../components/icons';
import type { I18nInstance } from '../../components/utils/tools';

export interface ErrorStateOptions {
  title?: string;
  message?: string;
  onRetry?(): void;
  onReplace?(): void;
  i18n?: I18nInstance;
}

const tr = (i18n: I18nInstance | undefined, key: string): string =>
  i18n?.has(key) ? i18n.t(key) : key;

const DEFAULT_TITLE = 'Couldn\u2019t load image';
const DEFAULT_MESSAGE = 'The URL returned an error. Try a different source or re-upload the file.';

export function renderErrorState(opts: ErrorStateOptions): HTMLElement {
  const root = document.createElement('div');
  root.className = 'blok-image-error';
  root.setAttribute('data-role', 'error-state');

  const icon = document.createElement('div');
  icon.className = 'blok-image-error__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = IconImageBroken;

  const body = document.createElement('div');
  body.className = 'blok-image-error__body';

  const title = document.createElement('div');
  title.className = 'blok-image-error__title';
  title.textContent = opts.title ?? tr(opts.i18n, 'tools.image.errorDefaultTitle');

  const msg = document.createElement('div');
  msg.className = 'blok-image-error__msg';
  msg.textContent = opts.message ?? tr(opts.i18n, 'tools.image.errorDefaultMessage');

  body.append(title, msg);
  root.append(icon, body);

  if (opts.onRetry || opts.onReplace) {
    const actions = document.createElement('div');
    actions.className = 'blok-image-error__actions';

    if (opts.onRetry) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'blok-image-error__btn';
      retry.setAttribute('data-action', 'retry');
      retry.textContent = tr(opts.i18n, 'tools.image.errorRetry');
      retry.addEventListener('click', () => {
        opts.onRetry?.();
      });
      actions.appendChild(retry);
    }

    if (opts.onReplace) {
      const replace = document.createElement('button');
      replace.type = 'button';
      replace.className = 'blok-image-error__btn';
      replace.setAttribute('data-action', 'replace');
      replace.textContent = tr(opts.i18n, 'tools.image.errorReplace');
      replace.addEventListener('click', () => {
        opts.onReplace?.();
      });
      actions.appendChild(replace);
    }

    root.appendChild(actions);
  }

  return root;
}
