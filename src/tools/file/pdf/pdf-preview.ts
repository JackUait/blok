import type { FilePreviewOptions } from '../preview-modal';
import type { PreviewChrome } from '../preview-chrome';
import { buildErrorInto, buildExternalNoticeInto } from '../preview-error';
import { loadPdfJs, type PdfJs } from './pdf-loader';
import { askPdfPassword } from './pdf-password';
import type { PdfDocumentLike, PdfPageLike, PdfViewport } from './pdf-types';
import { mountPdfView, type PdfViewLib } from './pdf-view';
import { resolvePdfSources } from './pdf-source';
import { PdfUnreadableError } from './pdf-errors';
import { createRangeTransport, SERVER_CHUNK_BYTES, type RangeReader } from './pdf-server-transport';

/** Where the PDF's bytes come from. */
export type PdfSource =
  | { kind: 'data'; data: Uint8Array }
  | { kind: 'url'; url: string }
  | { kind: 'transport'; reader: RangeReader };

/**
 * pdf.js shrinks decoded images to fit this, in bytes (4 per pixel).
 * Same 16,777,216 px as the page canvas cap in pdf-view.ts.
 */
const CANVAS_MAX_AREA_IN_BYTES = 16_777_216 * 4;

function sourceParams(source: PdfSource, lib: PdfJs, onFailure: () => void): Record<string, unknown> {
  if (source.kind === 'data') {
    return { data: source.data };
  }
  if (source.kind === 'url') {
    return { url: source.url, withCredentials: false };
  }

  // The server's rate limit counts requests, so pdf.js fetches only the
  // ranges it draws: no read-ahead, no streaming of the rest.
  return {
    range: createRangeTransport(lib, source.reader, onFailure),
    length: source.reader.length,
    rangeChunkSize: SERVER_CHUNK_BYTES,
    disableAutoFetch: true,
    disableStream: true,
  };
}

const isUnreadable = (error: unknown): boolean =>
  error instanceof PdfUnreadableError ||
  (error instanceof Error && error.name === 'InvalidPDFException');

/** pdf.js needs a trailing slash on each folder url. */
function assetParams(base: string | undefined): Record<string, unknown> {
  if (base === undefined || base === '') {
    return { useWasm: false };
  }
  const root = base.endsWith('/') ? base : `${base}/`;

  // wasm decoders need 'wasm-unsafe-eval', so they run only when the host serves them.
  return { cMapUrl: `${root}cmaps/`, cMapPacked: true, wasmUrl: `${root}wasm/`, iccUrl: `${root}iccs/`, useWasm: true };
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
  const held: { view: { destroy(): void } | null; carded: boolean; task: { destroy(): Promise<void> } | null } = {
    view: null,
    carded: false,
    task: null,
  };
  // A page that fails to draw, or a range the server will not send: the error card, once.
  const fail = (): void => {
    if (held.carded || chrome.isClosed()) {
      return;
    }
    held.carded = true;
    held.view?.destroy();
    buildErrorInto(chrome.body, opts, pdfHref);
  };
  const task = lib.getDocument({
    ...sourceParams(source, lib, () => {
      fail();
      // Ends a load still waiting on the range; pdf.js has no other way to hear of it.
      held.task?.destroy().catch(() => undefined);
    }),
    ...assetParams(opts.pdfAssetsUrl),
    useSystemFonts: true,
    canvasMaxAreaInBytes: CANVAS_MAX_AREA_IN_BYTES,
  });
  held.task = task;
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
        held.carded = true;
        buildErrorInto(chrome.body, opts, pdfHref);
      } else {
        showLoading(chrome);
      }
      answer(password);
    });
  };

  const doc = await task.promise.catch((error: unknown) => {
    // Free this attempt's worker now: the next source opens its own. A close already did.
    if (!chrome.isClosed()) {
      task.destroy().catch(() => undefined);
    }
    throw held.carded || isUnreadable(error) ? new PdfUnreadableError('unreadable PDF', { cause: error }) : error;
  });
  if (chrome.isClosed()) {
    return;
  }
  // pdf.js types `canvas` as required in render(); at runtime it defaults to canvasContext.canvas.
  const view = await mountPdfView(chrome.body, doc as unknown as PdfDocumentLike, { renderTextLayer: textLayerOf(lib) }, chrome, {
    onError: fail,
  });
  held.view = view;
  if (chrome.isClosed() || held.carded) {
    view.destroy();

    return;
  }
  // The loading line stays until the first page is read, so the body is never blank.
  chrome.body.querySelector('[data-role="file-preview-loading"]')?.remove();
}

/** True once a source opened (or the preview closed); throws on bytes that are no readable PDF. */
async function openFirstSource(opts: FilePreviewOptions, chrome: PreviewChrome, signal: AbortSignal): Promise<boolean> {
  for await (const source of resolvePdfSources(opts.url, opts.fetchPreview, signal, opts.previewEndpoint)) {
    if (chrome.isClosed()) {
      return true;
    }
    const opened = await fillPdfBody(opts, chrome, source).then(() => true, (error: unknown) => {
      if (isUnreadable(error)) {
        throw error;
      }

      return false;
    });
    if (opened) {
      return true;
    }
  }

  return false;
}

/**
 * Opens an http(s) PDF from the first source that gives readable bytes.
 * Bytes that are no PDF end on the error card; no bytes at all end on the
 * open-in-new-tab link.
 */
export async function fillRemotePdfBody(opts: FilePreviewOptions, chrome: PreviewChrome): Promise<void> {
  const controller = new AbortController();
  chrome.onRelease(() => controller.abort());
  const opened = await openFirstSource(opts, chrome, controller.signal).catch(() => null);
  if (chrome.isClosed() || opened === true) {
    return;
  }
  if (opened === null) {
    buildErrorInto(chrome.body, opts);
  } else {
    buildExternalNoticeInto(chrome.body, opts, opts.url);
  }
}
