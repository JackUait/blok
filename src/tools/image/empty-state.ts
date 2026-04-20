import { DEFAULT_MIME_TYPES } from './constants';

export interface EmptyStateOptions {
  onFile(file: File): void;
  onUrl(url: string): void;
  acceptTypes?: string[];
  uploadLabel?: string;
  embedLabel?: string;
  stockLabel?: string;
  embedPlaceholder?: string;
  submitLabel?: string;
}

export interface EmptyStateElement extends HTMLElement {
  setError(message: string | null): void;
}

type SourceKind = 'upload' | 'embed' | 'stock';

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
  const accept = (opts.acceptTypes ?? [...DEFAULT_MIME_TYPES]).join(',');
  const uploadLabel = opts.uploadLabel ?? 'Upload';
  const embedLabel = opts.embedLabel ?? 'Embed';
  const stockLabel = opts.stockLabel ?? 'Stock';
  const embedPlaceholder = opts.embedPlaceholder ?? 'Paste an image URL…';
  const submitLabel = opts.submitLabel ?? 'Embed';

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
  dropOverlay.textContent = 'Drop an image here';

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
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'blok-image-empty__choose';
    choose.setAttribute('data-action', 'choose-file');
    choose.textContent = 'Choose file';
    choose.addEventListener('click', () => input.click());

    const hint = document.createElement('span');
    hint.className = 'blok-image-empty__hint';
    hint.textContent = 'or drag & drop';

    panel.append(choose, hint, input);
  };

  const renderEmbed = (): void => {
    panel.replaceChildren();
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
    panel.append(urlInput, submit);
    queueMicrotask(() => urlInput.focus());
  };

  const renderStock = (): void => {
    panel.replaceChildren();
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'blok-image-empty__input';
    search.placeholder = 'Search stock images…';
    search.setAttribute('aria-label', 'Stock images');
    const note = document.createElement('span');
    note.className = 'blok-image-empty__hint';
    note.textContent = 'coming soon';
    panel.append(search, note);
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
