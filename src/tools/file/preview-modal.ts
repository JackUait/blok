import { openModalDialog } from '../../components/utils/modal-dialog';
import { safePreviewSrc } from './url';
import { extOf, getPreviewKind, type PreviewKind } from './preview';
import { loadTextPreview } from './text-preview';
import { extToPrismLang } from './code-languages';
import { tokenizePrism, isHighlightable } from '../code/prism-loader';
import { applyPrismHighlight, ensurePrismStyles } from '../code/prism-applier';
import { markdownToHtml } from '../../markdown/markdownToHtml';
import { IconFile, IconCross, IconLinkExternal } from '../../components/icons';
import { buildErrorInto } from './preview-error';
import { fillOfficeBody, isOfficeKind } from './office-preview';
import { ScrollHaze } from './preview-scroll-haze';

export interface FilePreviewOptions {
  url: string;
  fileName?: string;
  mimeType?: string;
  labels: {
    close: string;
    raw?: string;
    render?: string;
    loading?: string;
    error?: string;
    download?: string;
    openInNewTab?: string;
  };
}

interface PreviewElements {
  backdrop: HTMLElement;
  dialog: HTMLElement;
  header: HTMLElement;
  closeButton: HTMLButtonElement;
  body: HTMLElement;
  kind: PreviewKind | null;
}

function buildBody(opts: FilePreviewOptions, kind: PreviewKind): HTMLElement {
  const body = document.createElement('div');
  body.className = 'blok-file-preview-body';

  if (kind === 'pdf') {
    const src = safePreviewSrc(opts.url);
    if (src === null) {
      const error = document.createElement('div');
      error.className = 'blok-file-preview-error';
      error.setAttribute('data-role', 'file-preview-error');
      body.appendChild(error);

      return body;
    }
    const frame = document.createElement('iframe');
    frame.className = 'blok-file-preview-frame';
    frame.setAttribute('data-role', 'file-preview-frame');
    frame.setAttribute('title', opts.fileName ?? opts.labels.close);
    frame.src = src;
    body.appendChild(frame);

    return body;
  }

  const loading = document.createElement('div');
  loading.className = 'blok-file-preview-loading';
  loading.setAttribute('data-role', 'file-preview-loading');
  loading.textContent = opts.labels.loading ?? 'Loading…';
  body.appendChild(loading);

  return body;
}

function renderPlainText(body: HTMLElement, text: string): void {
  body.replaceChildren();
  const pre = document.createElement('pre');
  pre.className = 'blok-file-preview-pre';
  pre.setAttribute('data-role', 'file-preview-text');
  pre.textContent = text;
  body.appendChild(pre);
}

async function renderCode(body: HTMLElement, text: string, lang: string): Promise<void> {
  body.replaceChildren();
  const pre = document.createElement('pre');
  pre.className = 'blok-file-preview-pre';
  pre.setAttribute('data-role', 'file-preview-code');
  const code = document.createElement('code');
  code.textContent = text;
  pre.appendChild(code);
  body.appendChild(pre);

  if (isHighlightable(lang)) {
    const html = await tokenizePrism(text, lang);
    if (html !== null) {
      applyPrismHighlight(code, html, lang);
    }
  }
}

async function renderMarkdown(
  body: HTMLElement,
  header: HTMLElement,
  text: string,
  opts: FilePreviewOptions,
): Promise<void> {
  body.replaceChildren();

  // The Rendered/Raw switch lives in the header (centre slot), not in a
  // band of its own — see buildElements for the header grid.
  const toolbar = document.createElement('div');
  toolbar.className = 'blok-file-preview-toggle';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', `${opts.labels.render ?? 'Rendered'} / ${opts.labels.raw ?? 'Raw'}`);
  const renderBtn = document.createElement('button');
  renderBtn.type = 'button';
  renderBtn.setAttribute('data-action', 'preview-render');
  renderBtn.textContent = opts.labels.render ?? 'Rendered';
  const rawBtn = document.createElement('button');
  rawBtn.type = 'button';
  rawBtn.setAttribute('data-action', 'preview-raw');
  rawBtn.textContent = opts.labels.raw ?? 'Raw';
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
  void indicator.offsetWidth;
  indicator.style.transition = '';

  ensurePrismStyles();
  renderView.innerHTML = await markdownToHtml(text, { baseUrl: opts.url });

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
    await renderCode(body, result.text, extToPrismLang(ext) ?? 'plain');
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

  const titleIcon = document.createElement('span');
  titleIcon.className = 'blok-file-preview-title-icon';
  titleIcon.setAttribute('aria-hidden', 'true');
  titleIcon.innerHTML = IconFile;

  const titleText = document.createElement('span');
  titleText.className = 'blok-file-preview-title-text';
  if (opts.fileName) {
    titleText.textContent = opts.fileName;
  }

  title.append(titleIcon, titleText);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'blok-file-preview-close';
  closeButton.setAttribute('data-action', 'close-preview');
  closeButton.setAttribute('aria-label', opts.labels.close);
  closeButton.innerHTML = IconCross;

  const actions = document.createElement('div');
  actions.className = 'blok-file-preview-actions';

  const kind = getPreviewKind({ url: opts.url, fileName: opts.fileName, mimeType: opts.mimeType });

  // PDFs render in a sandboxed iframe with no browser chrome of their own — give
  // readers a one-click escape into a full browser tab with native zoom/print.
  const openHref = kind === 'pdf' ? safePreviewSrc(opts.url) : null;
  if (openHref !== null) {
    const open = document.createElement('a');
    open.className = 'blok-file-preview-open';
    open.setAttribute('data-action', 'preview-open-tab');
    open.href = openHref;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    if (opts.labels.openInNewTab) {
      open.setAttribute('aria-label', opts.labels.openInNewTab);
      open.title = opts.labels.openInNewTab;
    }
    open.innerHTML = IconLinkExternal;
    actions.appendChild(open);
  }
  actions.appendChild(closeButton);
  header.append(title, actions);

  const body = buildBody(opts, kind ?? 'text');

  dialog.append(header, body);
  backdrop.appendChild(dialog);

  return { backdrop, dialog, header, closeButton, body, kind };
}

export function openFilePreview(opts: FilePreviewOptions): () => void {
  const { backdrop, dialog, header, closeButton, body, kind } = buildElements(opts);
  const officeKind = isOfficeKind(kind) ? kind : null;
  const textualKind = kind === null || kind === 'pdf' || officeKind !== null ? null : kind;

  // Remember the caller's inline overflow so scroll lock restores it exactly.
  const previousBodyOverflow = document.body.style.overflow;
  const state = { closed: false };

  // Edge haze that marks the previewable content as scrollable. PDFs render in
  // an iframe with its own scrollbar, so they opt out.
  const haze = new ScrollHaze();

  const label = opts.fileName ?? opts.labels.close;

  // The shared modal primitive owns mounting, Top Layer promotion, background
  // `inert`, the focus trap, focus restore, Escape/outside dismissal and the
  // exit-animation settle. `content` is the full-screen backdrop; `surface` is
  // the centred dialog (so a press on the dim area counts as "outside").
  const dialogHandle = openModalDialog({
    content: backdrop,
    surface: dialog,
    role: 'dialog',
    label,
    initialFocus: () => closeButton,
    onDismiss: () => dialogHandle.closeAnimated(),
    onClose: () => {
      state.closed = true;
      haze.destroy();
      document.body.style.overflow = previousBodyOverflow;
    },
  });

  closeButton.addEventListener('click', () => dialogHandle.closeAnimated());

  // Lock page scroll so the content behind the modal stays put.
  document.body.style.overflow = 'hidden';

  const startFill = (): Promise<void> => {
    if (officeKind !== null) {
      return fillOfficeBody(body, opts, officeKind, () => state.closed);
    }
    if (textualKind !== null) {
      return fillTextBody(body, header, opts, textualKind, () => state.closed);
    }

    return Promise.resolve();
  };

  // Mount the scroll haze only once the body holds its rendered view — the fill
  // helpers call body.replaceChildren(), which would otherwise wipe the strips.
  // The haze's own MutationObserver then tracks later changes (e.g. the markdown
  // Rendered ⇄ Raw toggle). PDFs scroll inside their iframe, so they opt out.
  void startFill().then(() => {
    if (!state.closed && kind !== 'pdf') {
      haze.init(body);
    }
  });

  // Host teardown (block removed/re-rendered) is immediate — no exit animation.
  return dialogHandle.close;
}
