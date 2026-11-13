import { openModalDialog } from '../../components/utils/modal-dialog';
import { safeHttpHref, safePreviewSrc } from './url';
import { extOf, getPreviewKind, type PreviewKind } from './preview';
import { loadTextPreview } from './text-preview';
import { extToPrismLang } from './code-languages';
import { tokenizePrism, isHighlightable } from '../code/prism-loader';
import { applyPrismHighlight, ensurePrismStyles } from '../code/prism-applier';
import { measureLineRows, rowHeight } from '../code/line-geometry';
import { IconCross, IconDownload, IconLinkExternal } from '../../components/icons';
import { buildErrorInto } from './preview-error';
import { fillOfficeBody, isOfficeKind } from './office-preview';
import { ScrollHaze } from './preview-scroll-haze';
import { createSafeObjectUrl } from '../../shared/safe-object-url';
import { resolvePreviewLabels, type PreviewLabels } from './preview-labels';
import { describePreviewType, metaText, OVERLAY_ATTR, type PreviewChrome } from './preview-chrome';

export interface FilePreviewOptions {
  url: string;
  fileName?: string;
  mimeType?: string;
  /** Bytes, when known. Shown in the header. */
  size?: number;
  labels: Partial<PreviewLabels> & { close: string };
  /** Element whose direction the preview takes (it mounts outside the editor). */
  directionSource?: Element | null;
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
    // http(s) frame runs whatever HTML the server sends. So no http(s) frame.
    if (!src.startsWith('blob:')) {
      const notice = document.createElement('div');
      notice.className = 'blok-file-preview-error';
      notice.setAttribute('data-role', 'file-preview-external');
      const link = document.createElement('a');
      link.className = 'blok-file-preview-download';
      link.setAttribute('data-action', 'preview-open-external');
      link.href = src;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = opts.labels.openInNewTab ?? 'Open in new tab';
      notice.appendChild(link);
      body.appendChild(notice);

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
 * Frames a blob: pdf. A blob url has the editor's origin, so a text/html blob
 * would run as the editor, framed or opened in a tab. Re-typing the bytes as
 * application/pdf makes the browser parse them only as a PDF. No sandbox:
 * Chrome blocks its PDF viewer in every sandboxed frame.
 */
async function fillPdfBlobBody(
  body: HTMLElement,
  actions: HTMLElement,
  opts: FilePreviewOptions,
  isClosed: () => boolean,
  onRelease: (release: () => void) => void,
): Promise<void> {
  const response = await fetch(opts.url);
  if (!response.ok) {
    throw new Error(`blob read failed: ${response.status}`);
  }
  const bytes = await response.blob();
  if (isClosed()) {
    return;
  }
  const src = createSafeObjectUrl(new Blob([bytes], { type: 'application/pdf' }));
  onRelease(() => URL.revokeObjectURL(src));

  const frame = document.createElement('iframe');
  frame.className = 'blok-file-preview-frame';
  frame.setAttribute('data-role', 'file-preview-frame');
  frame.setAttribute('title', opts.fileName ?? opts.labels.close);
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.src = src;
  body.replaceChildren(frame);
  const open = buildOpenTabLink(opts);
  open.href = src;
  actions.prepend(buildSaveLink(opts, src), open);
}

function renderPlainText(body: HTMLElement, text: string): void {
  body.replaceChildren();
  const pre = document.createElement('pre');
  pre.className = 'blok-file-preview-pre';
  pre.setAttribute('data-role', 'file-preview-text');
  pre.textContent = text;
  body.appendChild(pre);
}

async function renderCode(
  body: HTMLElement,
  text: string,
  lang: string,
  onRelease: (release: () => void) => void,
): Promise<void> {
  body.replaceChildren();
  const pre = document.createElement('pre');
  pre.className = 'blok-file-preview-pre';
  pre.setAttribute('data-role', 'file-preview-code');
  // Source reads LTR in any editor direction, so the gutter stays on the left.
  pre.dir = 'ltr';

  // A trailing newline ends the last line; it does not start a new one.
  const lines = text.split('\n');
  const lineCount = lines.length > 1 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  // A sibling of <code>, so the highlighter's innerHTML swap leaves it alone.
  const gutter = document.createElement('div');
  gutter.className = 'blok-file-preview-gutter';
  gutter.setAttribute('data-role', 'file-preview-gutter');
  gutter.setAttribute('aria-hidden', 'true');
  Array.from({ length: lineCount }, (_, i) => {
    const line = document.createElement('div');
    line.textContent = String(i + 1);
    gutter.appendChild(line);
  });

  const code = document.createElement('code');
  code.textContent = text;
  pre.append(gutter, code);
  body.appendChild(pre);

  // Long lines wrap, so a number must grow to cover every row of its line.
  const syncRows = (): void => {
    const rows = measureLineRows(code);
    const row = rowHeight(code);
    Array.from(gutter.children).forEach((line, index) => {
      if (!(line instanceof HTMLElement)) {
        return;
      }
      if ((rows[index] ?? 1) > 1) {
        line.style.setProperty('height', `${rows[index] * row}px`);
      } else {
        line.style.removeProperty('height');
      }
    });
  };

  if (isHighlightable(lang)) {
    const html = await tokenizePrism(text, lang);
    if (html !== null) {
      applyPrismHighlight(code, html, lang);
    }
  }

  syncRows();
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(syncRows);
    observer.observe(code);
    onRelease(() => observer.disconnect());
  }
}

async function renderMarkdown(
  body: HTMLElement,
  header: HTMLElement,
  text: string,
  opts: FilePreviewOptions,
): Promise<void> {
  body.replaceChildren();

  // The Preview/Source switch lives in the header (centre slot), not in a
  // band of its own — see buildElements for the header grid.
  const toolbar = document.createElement('div');
  toolbar.className = 'blok-file-preview-toggle';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', `${opts.labels.render ?? 'Preview'} / ${opts.labels.raw ?? 'Source'}`);
  const renderBtn = document.createElement('button');
  renderBtn.type = 'button';
  renderBtn.setAttribute('data-action', 'preview-render');
  renderBtn.textContent = opts.labels.render ?? 'Preview';
  const rawBtn = document.createElement('button');
  rawBtn.type = 'button';
  rawBtn.setAttribute('data-action', 'preview-raw');
  rawBtn.textContent = opts.labels.raw ?? 'Source';
  // Sliding pill that glides under the active segment. Sits behind the labels
  // (the buttons paint above it) and is measured/moved in JS because the two
  // labels have different widths across locales — a fixed 50/50 split would
  // misalign.
  const indicator = document.createElement('span');
  indicator.className = 'blok-file-preview-toggle-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  toolbar.append(indicator, renderBtn, rawBtn);

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

  header.appendChild(toolbar);
  body.append(renderView, rawView);

  // Glide the pill to the active segment.
  const moveIndicator = (raw: boolean): void => {
    const target = raw ? rawBtn : renderBtn;
    indicator.style.width = `${target.offsetWidth}px`;
    indicator.style.transform = `translateX(${target.offsetLeft}px)`;
  };

  const show = (raw: boolean): void => {
    rawView.hidden = !raw;
    renderView.hidden = raw;
    renderBtn.setAttribute('aria-pressed', String(!raw));
    rawBtn.setAttribute('aria-pressed', String(raw));
    moveIndicator(raw);
  };
  renderBtn.addEventListener('click', () => show(false));
  rawBtn.addEventListener('click', () => show(true));

  // Position the pill without a transition so it doesn't slide in from the
  // track's left edge on open, then restore the transition for later moves.
  indicator.style.transition = 'none';
  show(false);
  indicator.offsetWidth;
  indicator.style.transition = '';

  ensurePrismStyles();
  const { markdownToHtml } = await import('../../markdown/markdownToHtml');
  renderView.innerHTML = await markdownToHtml(text, {
    baseUrl: opts.url,
    backToContentLabel: opts.labels.backToContent,
  });

  const mdRaw = await tokenizePrism(text, 'markdown');
  if (mdRaw !== null) {
    applyPrismHighlight(rawCode, mdRaw, 'markdown');
  }
}

/** Fetch and render a text/code/markdown body, unless the modal was torn down. */
async function fillTextBody(
  body: HTMLElement,
  header: HTMLElement,
  opts: FilePreviewOptions,
  kind: Exclude<PreviewKind, 'pdf'>,
  isClosed: () => boolean,
  onRelease: (release: () => void) => void,
): Promise<void> {
  const result = await loadTextPreview(opts.url);
  if (isClosed()) {
    return;
  }
  if (!result.ok) {
    buildErrorInto(body, opts);

    return;
  }

  if (kind === 'markdown') {
    await renderMarkdown(body, header, result.text, opts);
  } else if (kind === 'code') {
    const ext = extOf(opts.fileName ?? opts.url);
    await renderCode(body, result.text, extToPrismLang(ext) ?? 'plain', onRelease);
  } else {
    renderPlainText(body, result.text);
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

  // Edge haze that marks the previewable content as scrollable. PDFs render in
  // an iframe with its own scrollbar, so they opt out.
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
      return fillPdfBlobBody(body, actions, opts, () => state.closed, (release) => releases.push(release));
    }
    if (officeKind !== null) {
      return fillOfficeBody(body, opts, officeKind, () => state.closed, (release) => releases.push(release), chrome);
    }
    if (textualKind !== null) {
      return fillTextBody(body, header, opts, textualKind, () => state.closed, (release) => releases.push(release));
    }

    return Promise.resolve();
  };

  // Mount the scroll haze only once the body holds its rendered view — the fill
  // helpers call body.replaceChildren(), which would otherwise wipe the strips.
  // The haze's own MutationObserver then tracks later changes (e.g. the markdown
  // Preview ⇄ Source toggle). PDFs scroll inside their iframe, so they opt out.
  // A fill can fail late, e.g. when a lazy renderer chunk does not load.
  void startFill().then(() => {
    if (!state.closed && kind !== 'pdf') {
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
