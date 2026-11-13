import type { FileConfig } from '../../../types/tools/file';
import { openModalDialog } from '../../components/utils/modal-dialog';
import { safeHttpHref, safePreviewSrc } from './url';
import { extOf, getPreviewKind, type PreviewKind } from './preview';
import { loadTextPreview } from './text-preview';
import { extToPrismLang } from './code-languages';
import { tokenizePrism } from '../code/prism-loader';
import { applyPrismHighlight, ensurePrismStyles } from '../code/prism-applier';
import { IconCross, IconDownload, IconLinkExternal } from '../../components/icons';
import { buildErrorInto, buildExternalNoticeInto, createTypedPdfUrl } from './preview-error';
import { renderCode, splitLines } from './code-view';
import { renderCsv } from './csv-view';
import { renderLog, renderPlainText } from './log-view';
import { mountOutline } from './md-outline';
import { fillOfficeBody, isOfficeKind } from './office-preview';
import { ScrollHaze } from './preview-scroll-haze';
import { counted, resolvePreviewLabels, type PreviewLabels } from './preview-labels';
import { supportsPdfJs } from './pdf/pdf-loader';
import { fillPdfBody, fillRemotePdfBody } from './pdf/pdf-preview';
import { describePreviewType, isCsv, isLog, metaText, mountViewToggle, OVERLAY_ATTR, type PreviewChrome } from './preview-chrome';

export interface FilePreviewOptions {
  url: string;
  fileName?: string;
  mimeType?: string;
  /** Bytes, when known. Shown in the header. */
  size?: number;
  labels: Partial<PreviewLabels> & { close: string };
  /** Element whose direction the preview takes (it mounts outside the editor). */
  directionSource?: Element | null;
  /** See FileConfig.fetchPreview. */
  fetchPreview?: FileConfig['fetchPreview'];
  /** See FileConfig.pdfAssetsUrl. */
  pdfAssetsUrl?: string;
  /** See FileConfig.previewEndpoint. */
  previewEndpoint?: FileConfig['previewEndpoint'];
}

interface PreviewElements {
  backdrop: HTMLElement;
  dialog: HTMLElement;
  header: HTMLElement;
  actions: HTMLElement;
  closeButton: HTMLButtonElement;
  body: HTMLElement;
  meta: HTMLElement;
  typeName: string;
  kind: PreviewKind | null;
}

function buildBody(opts: FilePreviewOptions, kind: PreviewKind): HTMLElement {
  const body = document.createElement('div');
  body.className = 'blok-file-preview-body';

  if (kind === 'pdf') {
    const src = safePreviewSrc(opts.url);
    if (src === null) {
      buildErrorInto(body, opts);

      return body;
    }
    // Chrome blocks its PDF viewer in any sandboxed frame, and an unsandboxed
    // http(s) frame runs whatever HTML the server sends. So no http(s) frame:
    // pdf.js reads the bytes, or the user gets a link.
    if (!src.startsWith('blob:') && !supportsPdfJs()) {
      buildExternalNoticeInto(body, opts, src);

      return body;
    }
  }

  const loading = document.createElement('div');
  loading.className = 'blok-file-preview-loading';
  loading.setAttribute('data-role', 'file-preview-loading');
  loading.textContent = opts.labels.loading ?? 'Loading…';
  body.appendChild(loading);

  return body;
}

function buildOpenTabLink(opts: FilePreviewOptions): HTMLAnchorElement {
  const open = document.createElement('a');
  open.className = 'blok-file-preview-open';
  open.setAttribute('data-action', 'preview-open-tab');
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  if (opts.labels.openInNewTab) {
    open.setAttribute('aria-label', opts.labels.openInNewTab);
    open.title = opts.labels.openInNewTab;
  }
  open.innerHTML = IconLinkExternal;

  return open;
}

/** The header's download link. A blob downloads in place, so it opens no tab. */
function buildSaveLink(opts: FilePreviewOptions, href: string): HTMLAnchorElement {
  const save = document.createElement('a');
  save.className = 'blok-file-preview-save';
  save.setAttribute('data-action', 'preview-save');
  // Callers pass a gated url; the gate here keeps this sink safe on its own.
  save.href = safePreviewSrc(href) ?? '';
  save.setAttribute('download', opts.fileName ?? '');
  save.rel = 'noopener noreferrer';
  if (!href.startsWith('blob:')) {
    save.target = '_blank';
  }
  const label = opts.labels.download ?? 'Download';
  save.setAttribute('aria-label', label);
  save.title = label;
  save.innerHTML = IconDownload;

  return save;
}

/**
 * Shows a blob: pdf. A blob url has the editor's origin, so a text/html blob
 * would run as the editor, framed or opened in a tab. The header links and
 * the fallback frame use the bytes re-typed as application/pdf, which the
 * browser parses only as a PDF. pdf.js gets the bytes themselves.
 * No sandbox on the frame: Chrome blocks its PDF viewer in every sandboxed frame.
 */
async function fillPdfBlobBody(
  chrome: PreviewChrome,
  actions: HTMLElement,
  opts: FilePreviewOptions,
): Promise<void> {
  const response = await fetch(opts.url);
  if (!response.ok) {
    throw new Error(`blob read failed: ${response.status}`);
  }
  const bytes = await response.blob();
  if (chrome.isClosed()) {
    return;
  }
  const { url: src, release } = createTypedPdfUrl(bytes);
  chrome.onRelease(release);
  const open = buildOpenTabLink(opts);
  open.href = src;
  actions.prepend(buildSaveLink(opts, src), open);

  if (supportsPdfJs()) {
    const data = new Uint8Array(await bytes.arrayBuffer());
    // Caught here, not by the caller, so the error card can link the re-typed bytes.
    await fillPdfBody(opts, chrome, { kind: 'data', data }, src).catch(() => {
      if (!chrome.isClosed()) {
        buildErrorInto(chrome.body, opts, src);
      }
    });

    return;
  }
  const frame = document.createElement('iframe');
  frame.className = 'blok-file-preview-frame';
  frame.setAttribute('data-role', 'file-preview-frame');
  frame.setAttribute('title', opts.fileName ?? opts.labels.close);
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.src = src;
  chrome.body.replaceChildren(frame);
}

async function renderMarkdown(chrome: PreviewChrome, text: string, opts: FilePreviewOptions): Promise<void> {
  const { body, labels } = chrome;
  body.replaceChildren();

  const renderView = document.createElement('div');
  renderView.className = 'blok-file-preview-md';
  renderView.setAttribute('data-role', 'file-preview-md-render');

  const rawView = document.createElement('pre');
  rawView.className = 'blok-file-preview-pre';
  rawView.setAttribute('data-role', 'file-preview-md-raw');
  const rawCode = document.createElement('code');
  rawCode.textContent = text;
  rawView.appendChild(rawCode);
  rawView.hidden = true;
  body.append(renderView, rawView);

  // The Preview/Source switch lives in the header (centre slot), not in a
  // band of its own — see buildElements for the header grid.
  const views: { rail: HTMLElement | null } = { rail: null };
  mountViewToggle(chrome.header, labels.render, labels.raw, (raw) => {
    rawView.hidden = !raw;
    renderView.hidden = raw;
    if (views.rail !== null) {
      views.rail.hidden = raw;
    }
  });
  chrome.setFacts([counted(splitLines(text).length, labels.linesOne, labels.lines)]);

  ensurePrismStyles();
  const { markdownToHtml } = await import('../../markdown/markdownToHtml');
  renderView.innerHTML = await markdownToHtml(text, {
    baseUrl: opts.url,
    backToContentLabel: opts.labels.backToContent,
  });
  if (!chrome.isClosed()) {
    views.rail = mountOutline(renderView, chrome);
    if (views.rail !== null) {
      views.rail.hidden = renderView.hidden;
    }
  }

  const mdRaw = await tokenizePrism(text, 'markdown');
  if (mdRaw !== null) {
    applyPrismHighlight(rawCode, mdRaw, 'markdown');
  }
}

/** Fetch and render a text/code/markdown body, unless the modal was torn down. */
async function fillTextBody(
  opts: FilePreviewOptions,
  kind: Exclude<PreviewKind, 'pdf'>,
  chrome: PreviewChrome,
): Promise<void> {
  const result = await loadTextPreview(opts.url);
  if (chrome.isClosed()) {
    return;
  }
  if (!result.ok) {
    buildErrorInto(chrome.body, opts);

    return;
  }

  if (kind === 'markdown') {
    await renderMarkdown(chrome, result.text, opts);
  } else if (kind === 'code') {
    const ext = extOf(opts.fileName ?? opts.url);
    await renderCode(chrome, result.text, extToPrismLang(ext) ?? 'plain');
  } else if (isCsv(opts)) {
    renderCsv(chrome, result.text);
  } else if (isLog(opts)) {
    renderLog(chrome, result.text);
  } else {
    renderPlainText(chrome, result.text);
  }
}

function buildElements(opts: FilePreviewOptions): PreviewElements {
  const label = opts.fileName ?? opts.labels.close;

  const backdrop = document.createElement('div');
  backdrop.className = 'blok-file-preview-backdrop';
  backdrop.setAttribute('data-role', 'file-preview-backdrop');

  const dialog = document.createElement('div');
  dialog.className = 'blok-file-preview';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', label);

  const header = document.createElement('div');
  header.className = 'blok-file-preview-header';

  const title = document.createElement('span');
  title.className = 'blok-file-preview-title';

  const kind = getPreviewKind({ url: opts.url, fileName: opts.fileName, mimeType: opts.mimeType });
  const type = describePreviewType(opts, kind ?? 'text', resolvePreviewLabels(opts.labels));

  dialog.setAttribute('data-preview-kind', kind ?? 'text');

  const badge = document.createElement('span');
  badge.className = 'blok-file-preview-badge';
  badge.setAttribute('data-role', 'file-preview-badge');
  badge.setAttribute('data-file-category', type.category);
  badge.setAttribute('aria-hidden', 'true');
  badge.textContent = type.badge;

  const titleText = document.createElement('span');
  titleText.className = 'blok-file-preview-title-text';
  if (opts.fileName) {
    titleText.textContent = opts.fileName;
  }

  const meta = document.createElement('span');
  meta.className = 'blok-file-preview-meta';
  meta.setAttribute('data-role', 'file-preview-meta');
  meta.textContent = metaText(type.name, [], opts.size);

  title.append(badge, titleText, meta);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'blok-file-preview-close';
  closeButton.setAttribute('data-action', 'close-preview');
  closeButton.setAttribute('aria-label', opts.labels.close);
  closeButton.innerHTML = IconCross;

  const actions = document.createElement('div');
  actions.className = 'blok-file-preview-actions';

  // A blob opened in a tab has the editor's origin, so only http(s) gets the
  // link here. A blob pdf gets both links once its bytes are re-typed.
  const httpHref = safeHttpHref(opts.url);
  const blobHref = kind === 'pdf' || httpHref !== null ? null : safePreviewSrc(opts.url);
  const saveHref = httpHref ?? blobHref;
  if (saveHref !== null) {
    actions.appendChild(buildSaveLink(opts, saveHref));
  }
  if (httpHref !== null) {
    const open = buildOpenTabLink(opts);
    open.href = httpHref;
    actions.appendChild(open);
  }
  actions.appendChild(closeButton);
  header.append(title, actions);

  const body = buildBody(opts, kind ?? 'text');

  dialog.append(header, body);
  backdrop.appendChild(dialog);

  return { backdrop, dialog, header, actions, closeButton, body, meta, typeName: type.name, kind };
}

export function openFilePreview(opts: FilePreviewOptions): () => void {
  const { backdrop, dialog, header, actions, closeButton, body, meta, typeName, kind } = buildElements(opts);
  const officeKind = isOfficeKind(kind) ? kind : null;
  const textualKind = kind === null || kind === 'pdf' || officeKind !== null ? null : kind;

  // Remember the caller's inline overflow so scroll lock restores it exactly.
  const previousBodyOverflow = document.body.style.overflow;
  const state = { closed: false };
  const releases: Array<() => void> = [];

  // Edge haze that marks the previewable content as scrollable. A PDF in the
  // browser's frame has its own scrollbar, so only the pdf.js view gets it.
  const haze = new ScrollHaze();

  const label = opts.fileName ?? opts.labels.close;

  const overlays: HTMLElement[] = [];
  const keyHandlers: Array<(event: KeyboardEvent) => void> = [];
  const slots: { bar: HTMLElement | null } = { bar: null };
  const chrome: PreviewChrome = {
    labels: resolvePreviewLabels(opts.labels),
    header,
    body,
    typeName,
    size: opts.size,
    setFacts: (facts) => {
      meta.textContent = metaText(typeName, facts, opts.size);
    },
    setBar: (bar) => {
      slots.bar?.remove();
      slots.bar = bar;
      if (bar !== null) {
        dialog.appendChild(bar);
      }
    },
    addOverlay: (overlay) => {
      overlay.setAttribute(OVERLAY_ATTR, '');
      overlays.push(overlay);
      body.appendChild(overlay);
    },
    isClosed: () => state.closed,
    onRelease: (release) => {
      releases.push(release);
    },
    onKey: (handler) => {
      keyHandlers.push(handler);
    },
  };
  dialog.addEventListener('keydown', (event) => keyHandlers.forEach((handler) => handler(event)));

  // The shared modal primitive owns mounting, Top Layer promotion, background
  // `inert`, the focus trap, focus restore, Escape/outside dismissal and the
  // exit-animation settle. `content` is the full-screen backdrop; `surface` is
  // the centred dialog (so a press on the dim area counts as "outside").
  const dialogHandle = openModalDialog({
    content: backdrop,
    surface: dialog,
    directionSource: opts.directionSource,
    role: 'dialog',
    label,
    initialFocus: () => closeButton,
    onDismiss: () => dialogHandle.closeAnimated(),
    onClose: () => {
      state.closed = true;
      haze.destroy();
      releases.splice(0).forEach((release) => release());
      document.body.style.overflow = previousBodyOverflow;
    },
  });

  closeButton.addEventListener('click', () => dialogHandle.closeAnimated());

  // Lock page scroll so the content behind the modal stays put.
  document.body.style.overflow = 'hidden';

  const startFill = (): Promise<void> => {
    if (kind === 'pdf' && safePreviewSrc(opts.url)?.startsWith('blob:') === true) {
      return fillPdfBlobBody(chrome, actions, opts);
    }
    if (kind === 'pdf' && safeHttpHref(opts.url) !== null && supportsPdfJs()) {
      return fillRemotePdfBody(opts, chrome);
    }
    if (officeKind !== null) {
      return fillOfficeBody(body, opts, officeKind, () => state.closed, (release) => releases.push(release), chrome);
    }
    if (textualKind !== null) {
      return fillTextBody(opts, textualKind, chrome);
    }

    return Promise.resolve();
  };

  // Mount the scroll haze only once the body holds its rendered view — the fill
  // helpers call body.replaceChildren(), which would otherwise wipe the strips.
  // The haze's own MutationObserver then tracks later changes (e.g. the markdown
  // Preview ⇄ Source toggle). Other PDF bodies (frame, link, error) opt out.
  // A fill can fail late, e.g. when a lazy renderer chunk does not load.
  void startFill().then(() => {
    if (!state.closed && (kind !== 'pdf' || body.querySelector('[data-role="file-preview-pdf"]') !== null)) {
      haze.init(body);
    }
  }, () => {
    if (!state.closed) {
      buildErrorInto(body, opts);
    }
  });

  // Host teardown (block removed/re-rendered) is immediate — no exit animation.
  return dialogHandle.close;
}
