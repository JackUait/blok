import type { FilePreviewOptions } from '../preview-modal';
import type { PreviewChrome } from '../preview-chrome';
import { buildErrorInto } from '../preview-error';
import { loadPdfJs, type PdfJs } from './pdf-loader';
import { askPdfPassword } from './pdf-password';
import type { PdfDocumentLike, PdfPageLike, PdfViewport } from './pdf-types';
import { mountPdfView, type PdfViewLib } from './pdf-view';

/** Where the PDF's bytes come from. Only `data` has a producer yet. */
export type PdfSource =
  | { kind: 'data'; data: Uint8Array }
  | { kind: 'url'; url: string }
  | { kind: 'transport'; transport: unknown; length: number };

/**
 * pdf.js shrinks decoded images to fit this, in bytes (4 per pixel).
 * Same 16,777,216 px as the page canvas cap in pdf-view.ts.
 */
const CANVAS_MAX_AREA_IN_BYTES = 16_777_216 * 4;

function sourceParams(source: PdfSource): Record<string, unknown> {
  if (source.kind === 'data') {
    return { data: source.data };
  }
  if (source.kind === 'url') {
    return { url: source.url, withCredentials: false };
  }

  return { range: source.transport, length: source.length };
}

const loadingText = (chrome: PreviewChrome, percent: number | null): string =>
  (percent === null ? chrome.labels.loading : `${chrome.labels.loading} ${percent}%`);

/** Puts the loading line back, e.g. after the password form. */
function showLoading(chrome: PreviewChrome): void {
  const loading = document.createElement('div');
  loading.className = 'blok-file-preview-loading';
  loading.setAttribute('data-role', 'file-preview-loading');
  loading.textContent = loadingText(chrome, null);
  chrome.body.replaceChildren(loading);
}

type TextLayerParams = ConstructorParameters<PdfJs['TextLayer']>[0];

/** The text layer through pdf.js's own TextLayer. The page and viewport are pdf.js's own objects here. */
function textLayerOf(lib: PdfJs): PdfViewLib['renderTextLayer'] {
  return async (page: PdfPageLike, viewport: PdfViewport, host: HTMLElement) => {
    const layer = new lib.TextLayer({
      textContentSource: await page.getTextContent() as TextLayerParams['textContentSource'],
      container: host,
      viewport: viewport as unknown as TextLayerParams['viewport'],
    });
    // A cancel rejects render(); the view already knows it cancelled.
    layer.render().catch(() => undefined);

    return { cancel: () => layer.cancel() };
  };
}

/**
 * Opens a PDF with pdf.js into the preview body. Rejects when pdf.js cannot
 * load or read it; the modal then shows the error card. `pdfHref` is the
 * error card's link to the bytes (see createTypedPdfUrl).
 */
export async function fillPdfBody(
  opts: FilePreviewOptions,
  chrome: PreviewChrome,
  source: PdfSource,
  pdfHref?: string,
): Promise<void> {
  const lib = await loadPdfJs();
  if (chrome.isClosed()) {
    return;
  }
  const task = lib.getDocument({
    ...sourceParams(source),
    useSystemFonts: true,
    useWasm: false,
    canvasMaxAreaInBytes: CANVAS_MAX_AREA_IN_BYTES,
  });
  const held: { view: { destroy(): void } | null } = { view: null };
  chrome.onRelease(() => {
    held.view?.destroy();
    // destroy() rejects when the worker is already gone; nothing is left to free then.
    task.destroy().catch(() => undefined);
  });

  // Progress only updates a loading line on screen: it keeps arriving under
  // the password form and, for streamed sources, after the pages show.
  task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
    const loading = chrome.body.querySelector('[data-role="file-preview-loading"]');
    if (loading !== null && total > 0) {
      loading.textContent = loadingText(chrome, Math.min(100, Math.round((loaded / total) * 100)));
    }
  };
  task.onPassword = (answer: (password: string | Error) => void, reason: number) => {
    if (chrome.isClosed()) {
      return;
    }
    askPdfPassword(chrome.body, chrome.labels, reason, (password) => {
      if (password instanceof Error) {
        buildErrorInto(chrome.body, opts, pdfHref);
      } else {
        showLoading(chrome);
      }
      answer(password);
    });
  };

  const doc = await task.promise;
  if (chrome.isClosed()) {
    return;
  }
  const failed = { done: false };
  // pdf.js types `canvas` as required in render(); at runtime it defaults to canvasContext.canvas.
  const view = await mountPdfView(chrome.body, doc as unknown as PdfDocumentLike, { renderTextLayer: textLayerOf(lib) }, chrome, {
    onError: () => {
      if (failed.done || chrome.isClosed()) {
        return;
      }
      failed.done = true;
      held.view?.destroy();
      buildErrorInto(chrome.body, opts, pdfHref);
    },
  });
  held.view = view;
  if (chrome.isClosed() || failed.done) {
    view.destroy();

    return;
  }
  // The loading line stays until the first page is read, so the body is never blank.
  chrome.body.querySelector('[data-role="file-preview-loading"]')?.remove();
}
