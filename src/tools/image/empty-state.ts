import { DEFAULT_MIME_TYPES } from './constants';

export interface EmptyStateOptions {
  onFile(file: File): void;
  onUrl(url: string): void;
  /** MIME types to accept on file picker + show in the formats hint. */
  acceptTypes?: string[];
  /** Max file size in bytes — surfaced in the formats hint when set. */
  maxSize?: number;
  uploadLabel?: string;
  embedLabel?: string;
  stockLabel?: string;
  embedPlaceholder?: string;
  submitLabel?: string;
}

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
    const label = mimeToLabel(t);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out.join(' · ');
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
  const gb = mb / 1024;
  return gb < 10 ? `${gb.toFixed(1)} GB` : `${Math.round(gb)} GB`;
}

export interface EmptyStateElement extends HTMLElement {
  setError(message: string | null): void;
}

type SourceKind = 'upload' | 'embed' | 'stock';

const ICONS = {
  upload: '<rect x="3" y="4" width="18" height="15" rx="2.5" fill="currentColor" fill-opacity="0.08"/><circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" stroke="none"/><path d="M3.5 15.75 7.5 11.5l2.75 2.75L13.75 10l6.75 6.25"/>',
  link: '<path d="M10 14a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 5.5"/><path d="M14 10a5 5 0 0 0-7.07 0l-2.83 2.83a5 5 0 0 0 7.07 7.07l1.33-1.33"/>',
  stock: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  drop: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M12 8v7"/><path d="m9 12 3 3 3-3"/>',
};

function wrapSvg(inner: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
}

function makeTile(icon: string): HTMLElement {
  const tile = document.createElement('span');
  tile.className = 'blok-image-empty__tile';
  tile.setAttribute('aria-hidden', 'true');
  tile.innerHTML = wrapSvg(icon);
  return tile;
}

function makeTab(kind: SourceKind, label: string, current: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'blok-image-empty__tab';
  btn.setAttribute('data-src', kind);
  btn.setAttribute('data-tab', kind);
  btn.setAttribute('role', 'tab');
  if (current) btn.setAttribute('aria-current', 'true');
  btn.textContent = label;
  return btn;
}

export function renderEmptyState(opts: EmptyStateOptions): EmptyStateElement {
  const types = opts.acceptTypes ?? [...DEFAULT_MIME_TYPES];
  const accept = types.join(',');
  const formats = formatsLabel(types);
  const sizeHint = opts.maxSize !== undefined ? formatBytes(opts.maxSize) : '';
  const metaLabel = [formats, sizeHint ? `≤ ${sizeHint}` : '']
    .filter(Boolean)
    .join(' · ');
  const uploadLabel = opts.uploadLabel ?? 'Upload';
  const embedLabel = opts.embedLabel ?? 'Link';
  const stockLabel = opts.stockLabel ?? 'Stock';
  const embedPlaceholder = opts.embedPlaceholder ?? 'Paste an image URL…';
  const submitLabel = opts.submitLabel ?? 'Insert';

  const root = document.createElement('div') as unknown as EmptyStateElement;
  root.className = 'blok-image-empty';
  root.setAttribute('data-blok-image-empty-state', '');

  const card = document.createElement('div');
  card.className = 'blok-image-empty__card';
  card.tabIndex = 0;
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', 'Add an image');

  const label = document.createElement('span');
  label.className = 'blok-image-empty__label';
  label.textContent = 'Add an image';

  const tabs = document.createElement('div');
  tabs.className = 'blok-image-empty__tabs';
  tabs.setAttribute('role', 'tablist');
  const uploadTab = makeTab('upload', uploadLabel, true);
  const embedTab = makeTab('embed', embedLabel, false);
  const stockTab = makeTab('stock', stockLabel, false);
  tabs.append(uploadTab, embedTab, stockTab);

  const panel = document.createElement('div');
  panel.className = 'blok-image-empty__panel';
  panel.setAttribute('data-panel-host', '');
  panel.setAttribute('role', 'tabpanel');

  const dropOverlay = document.createElement('div');
  dropOverlay.className = 'blok-image-empty__drop-overlay';
  dropOverlay.setAttribute('aria-hidden', 'true');
  const dropInner = document.createElement('div');
  dropInner.className = 'blok-image-empty__drop-inner';
  dropInner.innerHTML = `${wrapSvg(ICONS.drop)}<span>Drop image to upload</span>`;
  dropOverlay.appendChild(dropInner);

  const error = document.createElement('div');
  error.className = 'blok-image-empty__error';
  error.setAttribute('data-role', 'error');
  error.hidden = true;

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.hidden = true;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) opts.onFile(file);
  });

  const renderUpload = (): void => {
    panel.replaceChildren();
    panel.appendChild(makeTile(ICONS.upload));

    const content = document.createElement('div');
    content.className = 'blok-image-empty__content blok-image-empty__content--row';

    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'blok-image-empty__choose';
    choose.setAttribute('data-action', 'choose-file');
    choose.textContent = 'Choose file';
    choose.addEventListener('click', () => input.click());

    const hint = document.createElement('span');
    hint.className = 'blok-image-empty__hint';
    hint.textContent = 'or drag & drop';

    content.append(choose, hint);

    if (metaLabel) {
      const meta = document.createElement('span');
      meta.className = 'blok-image-empty__meta';
      meta.textContent = metaLabel;
      content.appendChild(meta);
    }

    panel.append(content, input);
  };

  const renderEmbed = (): void => {
    panel.replaceChildren();
    panel.appendChild(makeTile(ICONS.link));

    const content = document.createElement('div');
    content.className = 'blok-image-empty__content blok-image-empty__content--row';

    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.className = 'blok-image-empty__input';
    urlInput.placeholder = embedPlaceholder;
    urlInput.setAttribute('aria-label', 'Image URL');

    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'blok-image-empty__submit';
    submit.setAttribute('data-action', 'submit-url');
    submit.textContent = submitLabel;

    const commit = (): void => {
      const value = urlInput.value.trim();
      if (value) opts.onUrl(value);
    };
    submit.addEventListener('click', commit);
    urlInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        commit();
      }
    });

    content.append(urlInput, submit);
    panel.appendChild(content);
    queueMicrotask(() => urlInput.focus());
  };

  const renderStock = (): void => {
    panel.replaceChildren();
    panel.appendChild(makeTile(ICONS.stock));

    const content = document.createElement('div');
    content.className = 'blok-image-empty__content blok-image-empty__content--row';

    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'blok-image-empty__input';
    search.placeholder = 'Search stock images…';
    search.setAttribute('aria-label', 'Stock images');
    search.disabled = true;

    const badge = document.createElement('span');
    badge.className = 'blok-image-empty__badge';
    badge.textContent = 'Coming soon';

    content.append(search, badge);
    panel.appendChild(content);
  };

  const activate = (kind: SourceKind): void => {
    for (const tab of [uploadTab, embedTab, stockTab]) {
      if (tab.getAttribute('data-src') === kind) tab.setAttribute('aria-current', 'true');
      else tab.removeAttribute('aria-current');
    }
    card.setAttribute('data-active-tab', kind);
    if (kind === 'upload') renderUpload();
    else if (kind === 'embed') renderEmbed();
    else renderStock();
  };

  uploadTab.addEventListener('click', () => activate('upload'));
  embedTab.addEventListener('click', () => activate('embed'));
  stockTab.addEventListener('click', () => activate('stock'));

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

  const header = document.createElement('div');
  header.className = 'blok-image-empty__header';
  header.append(label, tabs);

  card.append(header, panel, dropOverlay);
  root.append(card, error);
  activate('upload');

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
