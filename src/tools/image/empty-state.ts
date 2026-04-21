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
  upload: '<path d="M12 4v10"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M5 14v3.5A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5V14"/>',
  link: '<path d="M10 14a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 5.5"/><path d="M14 10a5 5 0 0 0-7.07 0l-2.83 2.83a5 5 0 0 0 7.07 7.07l1.33-1.33"/>',
  stock: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  drop: '<path d="M12 4v12"/><path d="m6.5 10.5 5.5 5.5 5.5-5.5"/><path d="M4 18h16"/>',
  arrow: '<path d="M12 5v11"/><path d="m7 10 5-5 5 5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.5-3.5"/>',
};

function wrapSvg(inner: string, size = 24): string {
  return `<svg viewBox="0 0 ${size} ${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
}

function makeTile(icon: string): HTMLElement {
  const tile = document.createElement('span');
  tile.className = 'blok-image-empty__tile';
  tile.setAttribute('aria-hidden', 'true');
  tile.innerHTML = wrapSvg(icon);
  return tile;
}

let tabIdCounter = 0;

function makeTab(kind: SourceKind, label: string, panelId: string, current: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'blok-image-empty__tab';
  btn.id = `blok-image-empty-tab-${++tabIdCounter}`;
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

export function renderEmptyState(opts: EmptyStateOptions): EmptyStateElement {
  const types = opts.acceptTypes ?? [...DEFAULT_MIME_TYPES];
  const accept = types.join(',');
  const formats = formatsLabel(types);
  const sizeHint = opts.maxSize !== undefined ? formatBytes(opts.maxSize) : '';
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

  const panel = document.createElement('div');
  panel.className = 'blok-image-empty__panel';
  panel.id = `blok-image-empty-panel-${++tabIdCounter}`;
  panel.setAttribute('data-panel-host', '');
  panel.setAttribute('role', 'tabpanel');

  const tabs = document.createElement('div');
  tabs.className = 'blok-image-empty__tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Image source');
  const uploadTab = makeTab('upload', uploadLabel, panel.id, true);
  const embedTab = makeTab('embed', embedLabel, panel.id, false);
  const stockTab = makeTab('stock', stockLabel, panel.id, false);
  tabs.append(uploadTab, embedTab, stockTab);
  panel.setAttribute('aria-labelledby', uploadTab.id);

  const tabList = [uploadTab, embedTab, stockTab];
  const tabKinds: SourceKind[] = ['upload', 'embed', 'stock'];

  const dropOverlay = document.createElement('div');
  dropOverlay.className = 'blok-image-empty__drop-overlay';
  dropOverlay.setAttribute('aria-hidden', 'true');
  const dropInner = document.createElement('div');
  dropInner.className = 'blok-image-empty__drop-inner';
  dropInner.innerHTML = `<span class="blok-image-empty__drop-icon">${wrapSvg(ICONS.drop)}</span><span>Drop to upload</span>`;
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
    content.className = 'blok-image-empty__content';

    const primary = document.createElement('div');
    primary.className = 'blok-image-empty__primary';

    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'blok-image-empty__choose';
    choose.setAttribute('data-action', 'choose-file');
    choose.innerHTML = `<span class="blok-image-empty__choose-icon">${wrapSvg(ICONS.arrow)}</span><span>Choose file</span>`;
    choose.addEventListener('click', (ev) => {
      ev.stopPropagation();
      input.click();
    });

    const hint = document.createElement('span');
    hint.className = 'blok-image-empty__hint';
    hint.textContent = 'or drop an image here';

    primary.append(choose, hint);

    const meta = document.createElement('div');
    meta.className = 'blok-image-empty__meta';
    const metaParts: string[] = [];
    if (formats) metaParts.push(formats);
    if (sizeHint) metaParts.push(`max ${sizeHint}`);
    meta.textContent = metaParts.join('  ·  ');

    content.append(primary);
    if (metaParts.length) content.append(meta);

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
    submit.addEventListener('click', (ev) => {
      ev.stopPropagation();
      commit();
    });
    urlInput.addEventListener('click', (ev) => ev.stopPropagation());
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

    const search = document.createElement('div');
    search.className = 'blok-image-empty__search';

    const searchIcon = document.createElement('span');
    searchIcon.className = 'blok-image-empty__search-icon';
    searchIcon.setAttribute('aria-hidden', 'true');
    searchIcon.innerHTML = wrapSvg(ICONS.search);

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'blok-image-empty__input blok-image-empty__input--bare';
    searchInput.placeholder = 'Search stock images…';
    searchInput.setAttribute('aria-label', 'Stock images');
    searchInput.disabled = true;
    searchInput.addEventListener('click', (ev) => ev.stopPropagation());

    search.append(searchIcon, searchInput);

    const badge = document.createElement('span');
    badge.className = 'blok-image-empty__badge';
    badge.textContent = 'Coming soon';

    content.append(search, badge);
    panel.appendChild(content);
  };

  const activate = (kind: SourceKind): void => {
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
    else if (kind === 'embed') renderEmbed();
    else renderStock();
  };

  tabList.forEach((tab, idx) => {
    tab.addEventListener('click', (ev) => {
      ev.stopPropagation();
      activate(tabKinds[idx]);
      tab.focus();
    });
    tab.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
        ev.preventDefault();
        const dir = ev.key === 'ArrowRight' ? 1 : -1;
        const next = (idx + dir + tabList.length) % tabList.length;
        activate(tabKinds[next]);
        tabList[next].focus();
      } else if (ev.key === 'Home') {
        ev.preventDefault();
        activate(tabKinds[0]);
        tabList[0].focus();
      } else if (ev.key === 'End') {
        ev.preventDefault();
        const last = tabList.length - 1;
        activate(tabKinds[last]);
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

  card.addEventListener('paste', (ev) => {
    if (card.getAttribute('data-active-tab') !== 'upload') return;
    const clip = ev.clipboardData;
    if (!clip) return;
    for (const item of Array.from(clip.items)) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file && types.some((t) => file.type === t || t === file.type)) {
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
