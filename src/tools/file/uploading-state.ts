import { makePreview, setPreviewProgress, type MediaPreviewKind } from '../../components/utils/media-empty-preview';

export interface UploadingStateLabels {
  uploading: string;
  cancel: string;
  progress: string;
}

export interface UploadingStateOptions {
  fileName: string | null;
  labels: UploadingStateLabels;
  onCancel(): void;
  /** Draws the file preview, filled by the upload, above the label. */
  preview?: MediaPreviewKind;
}

export interface UploadingStateElement extends HTMLElement {
  setProgress(percent: number): void;
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function renderUploadingState(opts: UploadingStateOptions): UploadingStateElement {
  const root = document.createElement('div') as unknown as UploadingStateElement;
  root.className = 'blok-file-uploading';

  const label = document.createElement('span');
  label.className = 'blok-file-uploading-label';
  label.textContent = opts.fileName ? `${opts.labels.uploading} ${opts.fileName}` : opts.labels.uploading;

  const bar = document.createElement('div');
  bar.className = 'blok-file-bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', opts.labels.progress);
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', '0');

  const fill = document.createElement('div');
  fill.className = 'blok-file-bar-fill';
  fill.setAttribute('data-role', 'fill');
  fill.style.width = '0%';
  bar.appendChild(fill);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'blok-file-cancel';
  cancel.setAttribute('data-action', 'cancel');
  cancel.setAttribute('aria-label', opts.labels.cancel);
  cancel.textContent = opts.labels.cancel;
  cancel.addEventListener('click', () => opts.onCancel());

  const preview = opts.preview ? makePreview(opts.preview) : null;

  root.setProgress = (percent: number): void => {
    const value = clamp(percent);
    fill.style.width = `${value}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(value)));
    if (preview) setPreviewProgress(preview, value);
  };

  if (preview) {
    root.setAttribute('data-preview', opts.preview ?? '');
    setPreviewProgress(preview, 0);
    root.append(preview);
  }
  root.append(label, bar, cancel);
  return root;
}
