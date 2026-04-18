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

const ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 15l-4.5-4.5L7 21"/></svg>';

function makeChip(src: SourceKind, label: string, current: boolean): HTMLButtonElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'blok-image-empty__chip';
  chip.setAttribute('data-src', src);
  chip.setAttribute('data-tab', src);
  if (current) chip.setAttribute('aria-current', 'true');
  chip.textContent = label;
  return chip;
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

  const intro = document.createElement('div');
  intro.className = 'blok-image-empty__intro';
  intro.tabIndex = 0;

  const icon = document.createElement('span');
  icon.className = 'blok-image-empty__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = ICON_SVG;

  const text = document.createElement('span');
  text.className = 'blok-image-empty__text';
  const title = document.createElement('span');
  title.className = 'blok-image-empty__title';
  title.textContent = 'Add an image';
  const hint = document.createElement('span');
  hint.className = 'blok-image-empty__hint';
  hint.textContent = 'Drag, paste, or click to upload — or embed from a URL';
  text.append(title, hint);

  const chips = document.createElement('span');
  chips.className = 'blok-image-empty__chips';
  chips.setAttribute('role', 'tablist');
  const uploadChip = makeChip('upload', uploadLabel, true);
  const embedChip = makeChip('embed', embedLabel, false);
  const stockChip = makeChip('stock', stockLabel, false);
  chips.append(uploadChip, embedChip, stockChip);

  intro.append(icon, text, chips);

  const panel = document.createElement('div');
  panel.className = 'blok-image-empty__panel';
  panel.setAttribute('data-panel-host', '');
  panel.hidden = true;

  const error = document.createElement('div');
  error.className = 'blok-image-empty__error';
  error.setAttribute('data-role', 'error');
  error.hidden = true;

  const renderUpload = (): void => {
    panel.replaceChildren();
    const drop = document.createElement('div');
    drop.className = 'blok-image-empty__drop';
    const big = document.createElement('div');
    big.className = 'blok-image-empty__drop-big';
    big.textContent = 'Drop an image here';
    const small = document.createElement('div');
    small.className = 'blok-image-empty__drop-small';
    small.textContent = 'PNG, JPG, GIF, WebP, SVG · or click to browse';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) opts.onFile(file);
    });
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      drop.classList.add('is-drag-over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-drag-over'));
    drop.addEventListener('drop', (ev) => {
      ev.preventDefault();
      drop.classList.remove('is-drag-over');
      const file = ev.dataTransfer?.files?.[0];
      if (file) opts.onFile(file);
    });
    drop.append(big, small, input);
    panel.appendChild(drop);
  };

  const renderEmbed = (): void => {
    panel.replaceChildren();
    const row = document.createElement('div');
    row.className = 'blok-image-empty__row';
    const input = document.createElement('input');
    input.type = 'url';
    input.className = 'blok-image-empty__input';
    input.placeholder = embedPlaceholder;
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'blok-image-empty__submit';
    submit.setAttribute('data-action', 'submit-url');
    submit.textContent = submitLabel;
    const commit = (): void => {
      const value = input.value.trim();
      if (value) opts.onUrl(value);
    };
    submit.addEventListener('click', commit);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        commit();
      }
    });
    row.append(input, submit);
    panel.appendChild(row);
  };

  const renderStock = (): void => {
    panel.replaceChildren();
    const row = document.createElement('div');
    row.className = 'blok-image-empty__row';
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'blok-image-empty__input';
    search.placeholder = 'Search stock images…';
    row.appendChild(search);
    const placeholder = document.createElement('div');
    placeholder.className = 'blok-image-empty__stock-placeholder';
    placeholder.textContent = 'Stock images — coming soon';
    panel.append(row, placeholder);
  };

  const activate = (kind: SourceKind): void => {
    panel.hidden = false;
    for (const chip of [uploadChip, embedChip, stockChip]) {
      if (chip.getAttribute('data-src') === kind) {
        chip.setAttribute('aria-current', 'true');
      } else {
        chip.removeAttribute('aria-current');
      }
    }
    if (kind === 'upload') renderUpload();
    else if (kind === 'embed') renderEmbed();
    else renderStock();
  };

  uploadChip.addEventListener('click', () => activate('upload'));
  embedChip.addEventListener('click', () => activate('embed'));
  stockChip.addEventListener('click', () => activate('stock'));

  root.append(intro, panel, error);
  // Render default upload panel so a file input is present on first paint
  // (matches legacy behavior & passes existing tests).
  renderUpload();
  panel.hidden = false;

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
