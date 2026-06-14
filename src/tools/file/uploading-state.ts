export interface UploadingStateLabels {
  uploading: string;
  cancel: string;
  progress: string;
}

export interface UploadingStateOptions {
  fileName: string | null;
  labels: UploadingStateLabels;
  onCancel(): void;
}

export interface UploadingStateElement extends HTMLElement {
  setProgress(percent: number): void;
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function renderUploadingState(opts: UploadingStateOptions): UploadingStateElement {
  const root = document.createElement('div') as UploadingStateElement;
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

  root.setProgress = (percent: number): void => {
    const value = clamp(percent);
    fill.style.width = `${value}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(value)));
  };

  root.append(label, bar, cancel);
  return root;
}
