export interface ErrorStateOptions {
  title?: string;
  message?: string;
  onRetry?(): void;
  onReplace?(): void;
}

const ALERT_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14.5 4.5H6A2.5 2.5 0 0 0 3.5 7v10A2.5 2.5 0 0 0 6 19.5h12a2.5 2.5 0 0 0 2.5-2.5v-6.25"/><path d="m14.5 4.5 1.75 2.25 2.25-1.25 2 2.75"/><circle cx="8" cy="9" r="1.2" fill="currentColor" stroke="none"/><path d="m3.8 16.25 3.45-3.45 2.5 2.5 3.5-3.5 4 4"/></svg>';

const DEFAULT_TITLE = 'Couldn\u2019t load image';
const DEFAULT_MESSAGE = 'The URL returned an error. Try a different source or re-upload the file.';

export function renderErrorState(opts: ErrorStateOptions): HTMLElement {
  const root = document.createElement('div');
  root.className = 'blok-image-error';
  root.setAttribute('data-role', 'error-state');

  const icon = document.createElement('div');
  icon.className = 'blok-image-error__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = ALERT_ICON_SVG;

  const body = document.createElement('div');
  body.className = 'blok-image-error__body';

  const title = document.createElement('div');
  title.className = 'blok-image-error__title';
  title.textContent = opts.title ?? DEFAULT_TITLE;

  const msg = document.createElement('div');
  msg.className = 'blok-image-error__msg';
  msg.textContent = opts.message ?? DEFAULT_MESSAGE;

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
      retry.textContent = 'Retry';
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
      replace.textContent = 'Replace';
      replace.addEventListener('click', () => {
        opts.onReplace?.();
      });
      actions.appendChild(replace);
    }

    root.appendChild(actions);
  }

  return root;
}
