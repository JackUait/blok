import { safeHttpHref } from './url';
import type { FilePreviewOptions } from './preview-modal';

/** Replace a preview body with an error message and a download fallback link. */
export function buildErrorInto(body: HTMLElement, opts: FilePreviewOptions): void {
  body.replaceChildren();
  const error = document.createElement('div');
  error.className = 'blok-file-preview-error';
  error.setAttribute('data-role', 'file-preview-error');
  error.textContent = opts.labels.error ?? "Couldn't load preview";

  const href = safeHttpHref(opts.url);
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
