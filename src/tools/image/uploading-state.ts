import { IconImage } from '../../components/icons';

export interface UploadingStateOptions {
  fileName: string;
  sizeLabel?: string;
  onCancel?(): void;
}

export interface UploadingStateElement extends HTMLElement {
  setProgress(percent: number, sizeLabel?: string): void;
}

const CLOSE_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true" focusable="false"><path d="M18 6L6 18M6 6l12 12"/></svg>';

function clamp(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  if (percent < 0) return 0;
  if (percent > 100) return 100;
  return percent;
}

export function renderUploadingState(opts: UploadingStateOptions): UploadingStateElement {
  const root = document.createElement('div') as unknown as UploadingStateElement;
  root.className = 'blok-image-uploading';
  root.setAttribute('data-role', 'uploading');

  const card = document.createElement('div');
  card.className = 'blok-image-uploading__card';

  const header = document.createElement('div');
  header.className = 'blok-image-uploading__header';

  const label = document.createElement('span');
  label.className = 'blok-image-uploading__label';
  label.textContent = 'Uploading';

  const name = document.createElement('span');
  name.className = 'blok-image-uploading__filename';
  name.setAttribute('data-role', 'filename');
  name.textContent = opts.fileName;
  name.title = opts.fileName;

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'blok-image-uploading__cancel';
  cancel.setAttribute('data-action', 'cancel');
  cancel.setAttribute('aria-label', 'Cancel upload');
  cancel.innerHTML = CLOSE_ICON_SVG;
  cancel.addEventListener('click', () => {
    opts.onCancel?.();
  });

  header.append(label, name, cancel);

  const panel = document.createElement('div');
  panel.className = 'blok-image-uploading__panel';

  const tile = document.createElement('span');
  tile.className = 'blok-image-uploading__tile';
  tile.setAttribute('aria-hidden', 'true');
  tile.innerHTML = IconImage;

  const content = document.createElement('div');
  content.className = 'blok-image-uploading__content';

  const sub = document.createElement('div');
  sub.className = 'blok-image-uploading__sub';

  const pct = document.createElement('span');
  pct.className = 'blok-image-uploading__pct';
  pct.setAttribute('data-role', 'pct');
  pct.textContent = '0%';

  const sep = document.createElement('span');
  sep.className = 'blok-image-uploading__sep';
  sep.setAttribute('aria-hidden', 'true');
  sep.textContent = '·';

  const size = document.createElement('span');
  size.className = 'blok-image-uploading__size';
  size.setAttribute('data-role', 'size');
  size.textContent = opts.sizeLabel ?? '';

  sub.append(pct, sep, size);

  const bar = document.createElement('div');
  bar.className = 'blok-image-uploading__bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', '0');
  bar.setAttribute('aria-label', 'Upload progress');

  const fill = document.createElement('div');
  fill.className = 'blok-image-uploading__bar-fill';
  fill.setAttribute('data-role', 'fill');
  fill.style.width = '0%';
  bar.appendChild(fill);

  content.append(sub, bar);
  panel.append(tile, content);
  card.append(header, panel);
  root.append(card);

  root.setProgress = (percent: number, sizeLabel?: string): void => {
    const value = clamp(percent);
    fill.style.width = `${value}%`;
    pct.textContent = `${Math.round(value)}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(value)));
    if (sizeLabel !== undefined) {
      size.textContent = sizeLabel;
    }
  };

  return root;
}
