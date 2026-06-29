import type { MediaSource } from '../../../types/tools/media-source';
import {
  IconArrowDownLine,
  IconArrowUp,
  IconLinkCopy,
  IconUpload,
} from '../icons';
import { formatBytes } from './format-bytes';
import { matchesMime } from './mime-match';

/**
 * Shared "empty" uploader surface for media-style block tools (image, file):
 * a card with a header (label + Upload/Link tabs), a dashed dropzone that
 * picks a file, and a Link tab with an inline URL bar. Tools supply their own
 * resolved labels + accepted types; this module owns the markup, styling
 * hooks (`blok-media-empty*`), drag/paste handling, and tab keyboard a11y.
 */

export interface MediaEmptyStateLabels {
  /** Header caption, e.g. "Add an image" / "Add a file". */
  add: string;
  /** Upload tab. */
  upload: string;
  /** Link/embed tab. */
  embed: string;
  /** Primary "Choose file" button. */
  chooseFile: string;
  /** Hint under the button, e.g. "or drop it here". */
  orDropHere: string;
  /** Drop overlay caption shown while dragging a file over the card. */
  dropToUpload: string;
  /** URL field placeholder. */
  urlPlaceholder: string;
  /** URL field aria-label. */
  urlAria: string;
  /** Submit button on the Link tab. */
  submit: string;
  /** Tablist aria-label, e.g. "Image source". */
  sourceAria: string;
  /** Optional formatter for the max-size meta line. */
  maxSize?: (size: string) => string;
}

export interface MediaEmptyStateOptions {
  /** Accepted MIME types — drives the file picker and the formats hint. */
  acceptTypes: string[];
  /** Max file size in bytes — surfaced in the formats hint when set. */
  maxSize?: number;
  labels: MediaEmptyStateLabels;
  onFile(file: File): void;
  onUrl(url: string): void;
  /**
   * Which insert sources to expose:
   * - `'both'` (default): show the Upload and Link tabs.
   * - `'upload'`: file upload only — the Link tab and URL bar are hidden.
   * - `'url'`: link/embed only — the Upload dropzone, file picker, and
   *   drag/paste-to-upload affordances are hidden.
   * With a single source the tablist is omitted entirely.
   */
  sources?: MediaSource;
  /**
   * How the panel transitions when switching Upload/Link tabs:
   * - `'reflow'` (default): ease the panel height between the two layouts and
   *   fade the incoming content in. Smooths the inline reflow of image/file
   *   blocks, where content below the card shifts with the height.
   * - `'slide'`: keep the height instant and slide + fade the incoming panel in
   *   from the travel direction. A floating popover (audio cover-picker) has
   *   nothing reflowing beneath it, so a height tween only reads as lag — the
   *   directional slide gives the swap personality without the bottom-edge crawl.
   * - `'none'`: swap instantly with no animation.
   */
  swap?: MediaEmptyStateSwap;
}

export type MediaEmptyStateSwap = 'reflow' | 'slide' | 'none';

/** Re-exported from the public type so the renderer and tools share one source. */
export type { MediaSource };

const MIME_LABELS: Record<string, string> = {
  'image/jpeg': 'JPG',
  'image/jpg': 'JPG',
  'image/png': 'PNG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
  'image/svg+xml': 'SVG',
  'image/avif': 'AVIF',
  'image/heic': 'HEIC',
  'image/heif': 'HEIF',
  'image/bmp': 'BMP',
  'image/tiff': 'TIFF',
  'image/x-icon': 'ICO',
  'application/pdf': 'PDF',
  'application/zip': 'ZIP',
};

function mimeToLabel(mime: string): string {
  const key = mime.toLowerCase().trim();
  if (MIME_LABELS[key]) return MIME_LABELS[key];
  const slash = key.indexOf('/');
  const tail = slash >= 0 ? key.slice(slash + 1) : key;
  return tail.replace(/^x-/, '').split('+')[0].toUpperCase();
}

function formatsLabel(types: readonly string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of types) {
    if (t === '*' || t === '*/*' || t.endsWith('/*') || !t.includes('/')) continue;
    const label = mimeToLabel(t);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out.join(' · ');
}

export interface MediaEmptyStateElement extends HTMLElement {
  setError(message: string | null): void;
}

type SourceKind = 'upload' | 'embed';

function makeTile(icon: string): HTMLElement {
  const tile = document.createElement('span');
  tile.className = 'blok-media-empty__tile';
  tile.setAttribute('aria-hidden', 'true');
  tile.innerHTML = icon;
  return tile;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

function makeTab(kind: SourceKind, label: string, panelId: string, current: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'blok-media-empty__tab';
  btn.id = `blok-media-empty-tab-${uid()}`;
  btn.setAttribute('data-src', kind);
  btn.setAttribute('data-tab', kind);
  btn.setAttribute('role', 'tab');
  btn.setAttribute('aria-controls', panelId);
  btn.setAttribute('aria-selected', current ? 'true' : 'false');
  btn.tabIndex = current ? 0 : -1;
  if (current) btn.setAttribute('aria-current', 'true');
  btn.textContent = label;
  return btn;
}

function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('button, a, input, textarea, select, [role="button"], [role="tab"]') !== null;
}

const SWAP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

function canAnimate(el: Element): el is Element & { animate: HTMLElement['animate'] } {
  return typeof (el as HTMLElement).animate === 'function';
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Cross-fades the new panel content in while easing the panel's height between
 * the two tab layouts (the Upload dropzone is much taller than the Link bar).
 * `startHeight` is captured before the content swaps; degrades to an instant
 * swap when WAAPI is unavailable or reduced motion is requested.
 */
function animatePanelSwap(panel: HTMLElement, startHeight: number): void {
  const endHeight = panel.getBoundingClientRect().height;

  panel.classList.add('is-swapping');
  const sizing = panel.animate(
    [{ height: `${startHeight}px` }, { height: `${endHeight}px` }],
    { duration: 260, easing: SWAP_EASING }
  );
  const restore = (): void => {
    panel.classList.remove('is-swapping');
  };

  sizing.finished.then(restore).catch(restore);

  // Fade the incoming content in promptly (no delay/offset) so it reveals as
  // the panel grows rather than popping in once the height tween settles.
  for (const child of Array.from(panel.children)) {
    if (!canAnimate(child)) continue;
    child.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 150, easing: 'ease-out', fill: 'backwards' }
    );
  }
}

/**
 * Slides the freshly-rendered panel content in from the travel direction while
 * fading it up — `dir` is +1 when moving to a tab on the right, -1 to the left.
 * The panel keeps its new height instantly; only the content moves, so there is
 * no bottom-edge crawl (the part that read as lag in a floating popover).
 */
function animatePanelContent(panel: HTMLElement, dir: number): void {
  const dx = dir * 12;
  for (const child of Array.from(panel.children)) {
    if (!canAnimate(child)) continue;
    child.animate(
      [
        { opacity: 0, transform: `translateX(${dx}px)` },
        { opacity: 1, transform: 'translateX(0)' },
      ],
      { duration: 200, easing: SWAP_EASING, fill: 'backwards' }
    );
  }
}

export function renderMediaEmptyState(opts: MediaEmptyStateOptions): MediaEmptyStateElement {
  const { labels } = opts;
  const types = opts.acceptTypes;
  const accept = types.length ? types.join(',') : '*';
  const formats = formatsLabel(types);
  const sizeHint = opts.maxSize !== undefined ? formatBytes(opts.maxSize) : '';

  const swapMode: MediaEmptyStateSwap = opts.swap ?? 'reflow';

  const source: MediaSource = opts.sources ?? 'both';
  const showUpload = source !== 'url';
  const showEmbed = source !== 'upload';

  const root = document.createElement('div') as unknown as MediaEmptyStateElement;
  root.className = 'blok-media-empty';
  root.setAttribute('data-blok-media-empty-state', '');

  const card = document.createElement('div');
  card.className = 'blok-media-empty__card';
  card.tabIndex = 0;
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', labels.add);

  const label = document.createElement('span');
  label.className = 'blok-media-empty__label';
  label.textContent = labels.add;

  const panel = document.createElement('div');
  panel.className = 'blok-media-empty__panel';
  panel.id = `blok-media-empty-panel-${uid()}`;
  panel.setAttribute('data-panel-host', '');
  panel.setAttribute('role', 'tabpanel');

  const initialKind: SourceKind = showUpload ? 'upload' : 'embed';

  const tabs = document.createElement('div');
  tabs.className = 'blok-media-empty__tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', labels.sourceAria);
  const tabList: HTMLButtonElement[] = [];
  const tabKinds: SourceKind[] = [];
  if (showUpload) {
    const uploadTab = makeTab('upload', labels.upload, panel.id, true);
    tabs.append(uploadTab);
    tabList.push(uploadTab);
    tabKinds.push('upload');
  }
  if (showEmbed) {
    const embedTab = makeTab('embed', labels.embed, panel.id, !showUpload);
    tabs.append(embedTab);
    tabList.push(embedTab);
    tabKinds.push('embed');
  }
  panel.setAttribute('aria-labelledby', tabList[0].id);

  const dropOverlay = document.createElement('div');
  dropOverlay.className = 'blok-media-empty__drop-overlay';
  dropOverlay.setAttribute('aria-hidden', 'true');
  const dropInner = document.createElement('div');
  dropInner.className = 'blok-media-empty__drop-inner';
  dropInner.innerHTML = `<span class="blok-media-empty__drop-icon">${IconArrowDownLine}</span><span>${labels.dropToUpload}</span>`;
  dropOverlay.appendChild(dropInner);

  const error = document.createElement('div');
  error.className = 'blok-media-empty__error';
  error.setAttribute('data-role', 'error');
  error.hidden = true;

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.hidden = true;
  input.setAttribute('data-blok-testid', 'file-input');
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) opts.onFile(file);
  });

  const renderUpload = (): void => {
    panel.replaceChildren();
    panel.appendChild(makeTile(IconUpload));

    const content = document.createElement('div');
    content.className = 'blok-media-empty__content';

    const primary = document.createElement('div');
    primary.className = 'blok-media-empty__primary';

    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'blok-media-empty__choose';
    choose.setAttribute('data-action', 'choose-file');
    choose.innerHTML = `<span class="blok-media-empty__choose-icon">${IconArrowUp}</span><span>${labels.chooseFile}</span>`;
    choose.addEventListener('click', (ev) => {
      ev.stopPropagation();
      input.click();
    });

    const hint = document.createElement('span');
    hint.className = 'blok-media-empty__hint';
    hint.textContent = labels.orDropHere;

    primary.append(choose, hint);

    const meta = document.createElement('div');
    meta.className = 'blok-media-empty__meta';
    const metaParts: string[] = [];
    if (formats) metaParts.push(formats);
    if (sizeHint && labels.maxSize) metaParts.push(labels.maxSize(sizeHint));
    meta.textContent = metaParts.join('  ·  ');

    content.append(primary);
    if (metaParts.length) content.append(meta);

    panel.append(content, input);
  };

  const renderEmbed = (): void => {
    panel.replaceChildren();

    const bar = document.createElement('div');
    bar.className = 'blok-media-empty__embed-bar';
    bar.setAttribute('data-valid', 'false');

    const fieldIcon = document.createElement('span');
    fieldIcon.className = 'blok-media-empty__embed-icon';
    fieldIcon.setAttribute('aria-hidden', 'true');
    fieldIcon.innerHTML = IconLinkCopy;

    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.className = 'blok-media-empty__embed-input';
    urlInput.placeholder = labels.urlPlaceholder;
    urlInput.setAttribute('aria-label', labels.urlAria);
    urlInput.autocomplete = 'off';
    urlInput.spellcheck = false;

    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'blok-media-empty__embed-submit';
    submit.setAttribute('data-action', 'submit-url');

    const submitLabelEl = document.createElement('span');
    submitLabelEl.className = 'blok-media-empty__embed-submit-label';
    submitLabelEl.textContent = labels.submit;

    const kbd = document.createElement('kbd');
    kbd.className = 'blok-media-empty__embed-kbd';
    kbd.setAttribute('aria-hidden', 'true');
    kbd.textContent = '↵';

    submit.append(submitLabelEl, kbd);

    const isValid = (raw: string): boolean => {
      const value = raw.trim();
      if (!value) return false;
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return /^[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(value);
      }
    };

    const sync = (): void => {
      const valid = isValid(urlInput.value);
      bar.setAttribute('data-valid', valid ? 'true' : 'false');
      submit.setAttribute('aria-disabled', valid ? 'false' : 'true');
    };

    const commit = (): void => {
      const value = urlInput.value.trim();
      if (!value) return;
      opts.onUrl(value);
    };

    submit.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (isValid(urlInput.value)) commit();
    });
    urlInput.addEventListener('click', (ev) => ev.stopPropagation());
    urlInput.addEventListener('input', sync);
    urlInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (isValid(urlInput.value)) commit();
      }
    });

    bar.append(fieldIcon, urlInput, submit);
    panel.appendChild(bar);
    sync();
    queueMicrotask(() => urlInput.focus());
  };

  const activate = (kind: SourceKind, transition = false): void => {
    const prevKind = card.getAttribute('data-active-tab') as SourceKind | null;
    const motion = transition
      && swapMode !== 'none'
      && canAnimate(panel)
      && !prefersReducedMotion();
    // Capture the reflow start-height before the content swaps (height tween only).
    const startHeight = motion && swapMode === 'reflow'
      ? panel.getBoundingClientRect().height
      : null;
    const dir = prevKind ? Math.sign(tabKinds.indexOf(kind) - tabKinds.indexOf(prevKind)) : 0;

    const activeTab = tabList[tabKinds.indexOf(kind)];
    for (const tab of tabList) {
      const isActive = tab === activeTab;
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.tabIndex = isActive ? 0 : -1;
      if (isActive) tab.setAttribute('aria-current', 'true');
      else tab.removeAttribute('aria-current');
    }
    panel.setAttribute('aria-labelledby', activeTab.id);
    card.setAttribute('data-active-tab', kind);
    if (kind === 'upload') renderUpload();
    else renderEmbed();

    if (!motion) return;
    if (swapMode === 'reflow' && startHeight !== null) animatePanelSwap(panel, startHeight);
    else if (swapMode === 'slide') animatePanelContent(panel, dir);
  };

  tabList.forEach((tab, idx) => {
    tab.addEventListener('click', (ev) => {
      ev.stopPropagation();
      activate(tabKinds[idx], true);
      tab.focus();
    });
    tab.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
        ev.preventDefault();
        const dir = ev.key === 'ArrowRight' ? 1 : -1;
        const next = (idx + dir + tabList.length) % tabList.length;
        activate(tabKinds[next], true);
        tabList[next].focus();
      } else if (ev.key === 'Home') {
        ev.preventDefault();
        activate(tabKinds[0], true);
        tabList[0].focus();
      } else if (ev.key === 'End') {
        ev.preventDefault();
        const last = tabList.length - 1;
        activate(tabKinds[last], true);
        tabList[last].focus();
      }
    });
  });

  panel.addEventListener('click', (ev) => {
    if (card.getAttribute('data-active-tab') !== 'upload') return;
    if (isInteractive(ev.target)) return;
    input.click();
  });

  card.addEventListener('keydown', (ev) => {
    if (ev.target !== card) return;
    if (card.getAttribute('data-active-tab') !== 'upload') return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      input.click();
    }
  });

  // File-based affordances (paste/drag/drop) only apply when upload is enabled.
  if (showUpload) {
    card.addEventListener('paste', (ev) => {
      if (card.getAttribute('data-active-tab') !== 'upload') return;
      const clip = ev.clipboardData;
      if (!clip) return;
      for (const item of Array.from(clip.items)) {
        if (item.kind !== 'file') continue;
        const file = item.getAsFile();
        if (file && (!types.length || matchesMime(file.type, types))) {
          ev.preventDefault();
          opts.onFile(file);
          return;
        }
      }
    });

    const drag = { depth: 0 };
    card.addEventListener('dragenter', (ev) => {
      if (!ev.dataTransfer?.types.includes('Files')) return;
      ev.preventDefault();
      drag.depth += 1;
      card.classList.add('is-dragover');
    });
    card.addEventListener('dragover', (ev) => {
      const dt = ev.dataTransfer;
      if (!dt?.types.includes('Files')) return;
      ev.preventDefault();
      dt.dropEffect = 'copy';
    });
    card.addEventListener('dragleave', () => {
      drag.depth = Math.max(0, drag.depth - 1);
      if (drag.depth === 0) card.classList.remove('is-dragover');
    });
    card.addEventListener('drop', (ev) => {
      ev.preventDefault();
      drag.depth = 0;
      card.classList.remove('is-dragover');
      const file = ev.dataTransfer?.files?.[0];
      if (file) opts.onFile(file);
    });
  }

  const header = document.createElement('div');
  header.className = 'blok-media-empty__header';
  // A single source needs no tablist — show just the caption.
  if (tabList.length > 1) header.append(label, tabs);
  else header.append(label);

  card.append(header, panel);
  if (showUpload) card.append(dropOverlay);
  root.append(card, error);
  activate(initialKind);

  root.setError = (message: string | null): void => {
    if (!message) {
      error.hidden = true;
      error.textContent = '';
      return;
    }
    error.hidden = false;
    error.textContent = message;
  };

  return root;
}
