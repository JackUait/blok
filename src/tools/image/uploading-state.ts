export interface UploadingStateOptions {
  fileName: string;
  sizeLabel?: string;
  onCancel?(): void;
}

export interface UploadingStateElement extends HTMLElement {
  setProgress(percent: number, sizeLabel?: string): void;
}

const IMAGE_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 15l-4.5-4.5L7 21"/></svg>';

const CLOSE_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M18 6L6 18M6 6l12 12"/></svg>';

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

  const preview = document.createElement('div');
  preview.className = 'blok-image-uploading__preview';
  preview.setAttribute('aria-hidden', 'true');
  preview.innerHTML = IMAGE_ICON_SVG;

  const info = document.createElement('div');
  info.className = 'blok-image-uploading__info';

  const name = document.createElement('div');
  name.className = 'blok-image-uploading__name';
  name.setAttribute('data-role', 'filename');
  name.textContent = opts.fileName;

  const sub = document.createElement('div');
  sub.className = 'blok-image-uploading__sub';

  const pct = document.createElement('span');
  pct.setAttribute('data-role', 'pct');
  pct.textContent = '0%';

  const sep = document.createElement('span');
  sep.setAttribute('aria-hidden', 'true');
  sep.textContent = '·';

  const size = document.createElement('span');
  size.setAttribute('data-role', 'size');
  size.textContent = opts.sizeLabel ?? '';

  sub.append(pct, sep, size);

  const bar = document.createElement('div');
  bar.className = 'blok-image-uploading__bar';
  const fill = document.createElement('div');
  fill.className = 'blok-image-uploading__bar-fill';
  fill.setAttribute('data-role', 'fill');
  fill.style.width = '0%';
  bar.appendChild(fill);

  info.append(name, sub, bar);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'blok-image-uploading__cancel';
  cancel.setAttribute('data-action', 'cancel');
  cancel.setAttribute('aria-label', 'Cancel upload');
  cancel.innerHTML = CLOSE_ICON_SVG;
  cancel.addEventListener('click', () => {
    opts.onCancel?.();
  });

  root.append(preview, info, cancel);

  root.setProgress = (percent: number, sizeLabel?: string): void => {
    const value = clamp(percent);
    fill.style.width = `${value}%`;
    pct.textContent = `${Math.round(value)}%`;
    if (sizeLabel !== undefined) {
      size.textContent = sizeLabel;
    }
  };

  return root;
}
