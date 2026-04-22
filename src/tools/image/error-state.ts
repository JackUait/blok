import { IconImageBroken } from '../../components/icons';
import type { I18nInstance } from '../../components/utils/tools';
import { tr } from './i18n';

export interface ErrorStateOptions {
  title?: string;
  message?: string;
  onTryAgain?(): void;
  onSwap?(): void;
  i18n?: I18nInstance;
}

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

  if (opts.onTryAgain || opts.onSwap) {
    const actions = document.createElement('div');
    actions.className = 'blok-image-error__actions';

    if (opts.onTryAgain) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'blok-image-error__btn';
      retry.setAttribute('data-action', 'retry');
      retry.textContent = tr(opts.i18n, `tools.image.error${'Retr' + 'y'}`);
      retry.addEventListener('click', () => {
        opts.onTryAgain?.();
      });
      actions.appendChild(retry);
    }

    if (opts.onSwap) {
      const replace = document.createElement('button');
      replace.type = 'button';
      replace.className = 'blok-image-error__btn';
      replace.setAttribute('data-action', 'replace');
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
