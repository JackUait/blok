export interface ErrorStateOptions {
  title?: string;
  message?: string;
  onRetry?(): void;
  onReplace?(): void;
}

const ALERT_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><circle cx="12" cy="16.5" r="0.8" fill="currentColor"/></svg>';

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
