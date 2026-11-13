import { createSafeObjectUrl } from '../../shared/safe-object-url';
import { safeHttpHref } from './url';
import type { FilePreviewOptions } from './preview-modal';

/**
 * Blob urls Blok made from a file's bytes re-typed as application/pdf. Only
 * these may be linked from the error card: any other blob url has the
 * editor's origin and could run as the editor when opened.
 */
const typedPdfUrls = new Set<string>();

/** A blob url for these bytes that the browser opens only as a PDF. Call release on close. */
export function createTypedPdfUrl(bytes: Blob): { url: string; release: () => void } {
  const url = createSafeObjectUrl(new Blob([bytes], { type: 'application/pdf' }));
  typedPdfUrls.add(url);

  return {
    url,
    release: () => {
      typedPdfUrls.delete(url);
      URL.revokeObjectURL(url);
    },
  };
}

/** The pdf bytes' blob url downloads in place and opens as a PDF in a tab. */
function pdfLinks(opts: FilePreviewOptions, href: string): HTMLAnchorElement[] {
  const download = document.createElement('a');
  download.className = 'blok-file-preview-download';
  download.setAttribute('data-action', 'preview-download');
  download.href = href;
  download.download = opts.fileName ?? '';
  download.rel = 'noopener noreferrer';
  download.textContent = opts.labels.download ?? 'Download';
  const open = document.createElement('a');
  open.className = 'blok-file-preview-download';
  open.setAttribute('data-action', 'preview-error-open-tab');
  open.href = href;
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.textContent = opts.labels.openInNewTab ?? 'Open in new tab';

  return [download, open];
}

/**
 * Replace a preview body with an error title, a line of advice and a download
 * fallback link. `pdfHref` links a PDF's bytes when it came from createTypedPdfUrl.
 */
export function buildErrorInto(body: HTMLElement, opts: FilePreviewOptions, pdfHref?: string): void {
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
  const typedPdf = pdfHref !== undefined && typedPdfUrls.has(pdfHref) ? pdfHref : null;

  // Download advice only where the link below can deliver on it.
  detail.textContent = href !== null || typedPdf !== null
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
  } else if (typedPdf !== null) {
    error.append(...pdfLinks(opts, typedPdf));
  }
  body.appendChild(error);
}

/** Replace a preview body with a link that opens an http(s) file in a new tab. */
export function buildExternalNoticeInto(body: HTMLElement, opts: FilePreviewOptions, href: string): void {
  const notice = document.createElement('div');
  notice.className = 'blok-file-preview-error';
  notice.setAttribute('data-role', 'file-preview-external');
  const link = document.createElement('a');
  link.className = 'blok-file-preview-download';
  link.setAttribute('data-action', 'preview-open-external');
  const safe = safeHttpHref(href);
  if (safe !== null) {
    link.href = safe;
  }
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = opts.labels.openInNewTab ?? 'Open in new tab';
  notice.appendChild(link);
  body.replaceChildren(notice);
}
