import { IconDownload, IconFile } from '../../components/icons';
import type { FileData } from '../../../types/tools/file';
import { humanFileSize } from './format';

export interface CaptionRowOptions {
  value: string;
  placeholder: string;
  readOnly: boolean;
  onChange(next: string): void;
}

/** Renders the static download card: type icon, filename, size, download affordance. */
export function renderFileCard(data: Partial<FileData> & { url: string }): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'blok-file-card-wrapper';
  wrapper.setAttribute('data-role', 'file-card-wrapper');

  const link = document.createElement('a');
  link.className = 'blok-file-card';
  link.setAttribute('data-role', 'file-card');
  link.setAttribute('data-action', 'download');
  link.setAttribute('href', data.url);
  link.setAttribute('target', '_blank');
  link.setAttribute('rel', 'noopener noreferrer');
  if (data.fileName) {
    link.setAttribute('download', data.fileName);
  } else {
    link.setAttribute('download', '');
  }

  const icon = document.createElement('span');
  icon.className = 'blok-file-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = IconFile;

  const meta = document.createElement('span');
  meta.className = 'blok-file-meta';

  const name = document.createElement('span');
  name.className = 'blok-file-name';
  name.setAttribute('data-role', 'file-name');
  name.textContent = data.fileName ?? data.url;
  meta.appendChild(name);

  const sizeText = humanFileSize(data.size);
  if (sizeText) {
    const size = document.createElement('span');
    size.className = 'blok-file-size';
    size.setAttribute('data-role', 'file-size');
    size.textContent = sizeText;
    meta.appendChild(size);
  }

  const download = document.createElement('span');
  download.className = 'blok-file-download';
  download.setAttribute('aria-hidden', 'true');
  download.innerHTML = IconDownload;

  link.append(icon, meta, download);
  wrapper.appendChild(link);
  return wrapper;
}

/** Renders the editable caption row below the card. */
export function renderCaptionRow(opts: CaptionRowOptions): HTMLElement {
  const row = document.createElement('div');
  row.className = 'blok-file-caption-row';

  const caption = document.createElement('div');
  caption.className = 'blok-file-caption';
  caption.setAttribute('data-role', 'file-caption');
  caption.setAttribute('role', 'textbox');
  caption.setAttribute('contenteditable', opts.readOnly ? 'false' : 'true');
  caption.setAttribute('data-placeholder', opts.placeholder);
  caption.textContent = opts.value;

  caption.addEventListener('blur', () => {
    opts.onChange(caption.textContent ?? '');
  });

  row.appendChild(caption);
  return row;
}
