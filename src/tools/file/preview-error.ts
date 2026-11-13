import { safeHttpHref } from './url';
import type { FilePreviewOptions } from './preview-modal';

/** Replace a preview body with an error title, a line of advice and a download fallback link. */
export function buildErrorInto(body: HTMLElement, opts: FilePreviewOptions): void {
  body.replaceChildren();
  const error = document.createElement('div');
  error.className = 'blok-file-preview-error';
  error.setAttribute('data-role', 'file-preview-error');
  const title = document.createElement('p');
  title.className = 'blok-file-preview-error__title';
  title.setAttribute('data-role', 'file-preview-error-title');
  title.textContent = opts.labels.error ?? "Couldn't load preview";
  const detail = document.createElement('p');
  detail.className = 'blok-file-preview-error__detail';
  detail.setAttribute('data-role', 'file-preview-error-detail');
  const href = safeHttpHref(opts.url);

  // Download advice only where the link below can deliver on it.
  detail.textContent = href !== null
    ? opts.labels.errorDetail ?? 'Download the file to open it.'
    : opts.labels.errorNoLinkDetail ?? 'Check the link and try again.';
  error.append(title, detail);

  if (href !== null) {
    const download = document.createElement('a');
    download.className = 'blok-file-preview-download';
    download.setAttribute('data-action', 'preview-download');
    download.href = href;
    download.download = opts.fileName ?? '';
    download.target = '_blank';
    download.rel = 'noopener noreferrer';
    download.textContent = opts.labels.download ?? 'Download';
    error.appendChild(download);
  }
  body.appendChild(error);
}
