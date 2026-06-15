import { IconDownload } from '../../components/icons';
import type { FileData } from '../../../types/tools/file';
import { resolveFileIcon } from './file-icon';
import { humanFileSize } from './format';
import { safeHttpHref } from './url';

export interface CaptionRowOptions {
  value: string;
  placeholder: string;
  readOnly: boolean;
  onChange(next: string): void;
}

/** Builds the card body as a preview-triggering button. */
function createPreviewBody(onPreview: () => void): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-action', 'preview');
  button.addEventListener('click', () => {
    onPreview();
  });
  return button;
}

/** Builds the card body as a download anchor. */
function createDownloadBody(href: string | null, downloadName: string): HTMLElement {
  const anchor = document.createElement('a');
  anchor.setAttribute('data-action', 'download');
  if (href !== null) {
    anchor.setAttribute('href', href);
  }
  anchor.setAttribute('target', '_blank');
  anchor.setAttribute('rel', 'noopener noreferrer');
  anchor.setAttribute('download', downloadName);
  return anchor;
}

/** Renders the static download card: type icon, filename, size, download affordance. */
export function renderFileCard(
  data: Partial<FileData> & { url: string },
  onPreview?: () => void,
  downloadLabel?: string,
  onRename?: (next: string) => void,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'blok-file-card-wrapper';
  wrapper.setAttribute('data-role', 'file-card-wrapper');

  const href = safeHttpHref(data.url);
  const downloadName = data.fileName ?? '';

  // Card body: a preview button when previewing is possible, otherwise a download anchor.
  const body = onPreview ? createPreviewBody(onPreview) : createDownloadBody(href, downloadName);
  body.className = 'blok-file-card';
  body.setAttribute('data-role', 'file-card');

  const { category, icon: typeIcon } = resolveFileIcon(data);
  const icon = document.createElement('span');
  icon.className = 'blok-file-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('data-file-category', category);
  icon.innerHTML = typeIcon;

  const meta = document.createElement('span');
  meta.className = 'blok-file-meta';

  const name = document.createElement('span');
  name.className = 'blok-file-name';
  name.setAttribute('data-role', 'file-name');
  const displayName = data.fileName ?? data.url;
  name.textContent = displayName;
  if (onRename) {
    name.setAttribute('contenteditable', 'true');
    name.setAttribute('role', 'textbox');
    // The name lives inside the card body (a button or download anchor). Block
    // the click from bubbling to the preview button and cancel the anchor's
    // default navigation, so clicking the name only places the edit caret.
    name.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();
    });
    name.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        name.blur();
      }
    });
    name.addEventListener('blur', () => {
      const next = (name.textContent ?? '').trim();
      if (next === '' || next === displayName) {
        name.textContent = displayName;
        return;
      }
      onRename(next);
    });
  }
  meta.appendChild(name);

  const sizeText = humanFileSize(data.size);
  if (sizeText) {
    const size = document.createElement('span');
    size.className = 'blok-file-size';
    size.setAttribute('data-role', 'file-size');
    size.textContent = sizeText;
    meta.appendChild(size);
  }

  body.append(icon, meta);

  // Download affordance: always a separate link so the card body can be a preview trigger.
  const download = document.createElement('a');
  download.className = 'blok-file-download';
  download.setAttribute('data-action', 'download');
  if (href !== null) {
    download.setAttribute('href', href);
  }
  download.setAttribute('target', '_blank');
  download.setAttribute('rel', 'noopener noreferrer');
  download.setAttribute('download', downloadName);
  if (downloadLabel !== undefined) {
    download.setAttribute('aria-label', downloadLabel);
  }
  download.innerHTML = IconDownload;

  wrapper.append(body, download);
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
