import { IconImageBroken } from '../../components/icons';
import type { I18nInstance } from '../../components/utils/tools';
import { tr } from './i18n';

export type ErrorVariant = 'broken' | 'upload';

const IconUploadFailed = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 16.5A4.5 4.5 0 0 0 17 8.25a6 6 0 0 0-11.7 1.5A4 4 0 0 0 6 17.5"/><path d="M12 12v5"/><path d="m9.5 14.5 2.5-2.5 2.5 2.5"/><path d="m4 4 16 16" stroke-width="2"/></svg>';

export interface ErrorStateOptions {
  title?: string;
  message?: string;
  variant?: ErrorVariant;
  onTryAgain?(): void;
  onSwap?(): void;
  i18n?: I18nInstance;
}

export function renderErrorState(opts: ErrorStateOptions): HTMLElement {
  const root = document.createElement('div');
  root.className = 'blok-image-error';
  root.setAttribute('data-role', 'error-state');
  const variant: ErrorVariant = opts.variant ?? 'broken';
  root.setAttribute('data-variant', variant);

  const icon = document.createElement('div');
  icon.className = 'blok-image-error__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = variant === 'upload' ? IconUploadFailed : IconImageBroken;

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
