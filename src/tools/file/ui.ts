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

/** Builds the card's activating control as a preview-triggering button. */
function createPreviewBody(onPreview: () => void): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-action', 'preview');
  button.addEventListener('click', () => {
    onPreview();
  });
  return button;
}

/** Builds the card's activating control as a download anchor. */
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

/**
 * Stretches the activating control across the card it no longer wraps.
 *
 * The editable filename must be a SIBLING of the control — a focusable
 * contenteditable inside a `<button>`/`<a>` is invalid ARIA and unreachable in
 * most assistive tech — so the card chrome moved onto a plain `<div>` and the
 * control became a transparent layer over it, keeping the same click surface.
 * Every UA control style is reset here because `.blok-file-card` (which used to
 * do it, as the control carried that class) now sits on the div instead.
 */
const ACTIVATOR_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  inset: '0',
  padding: '0',
  border: '0',
  background: 'transparent',
  borderRadius: 'inherit',
  appearance: 'none',
  // UA stylesheets give buttons `cursor: default`; the card declares pointer.
  cursor: 'inherit',
};

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
  const displayName = data.fileName ?? data.url;

  // Inert chrome, and the containing block the activating control stretches to.
  // The icon and size stay unpositioned so they sit UNDER that control and keep
  // activating the card when clicked.
  const card = document.createElement('div');
  card.className = 'blok-file-card';
  card.style.position = 'relative';

  // Activating control: a preview button when previewing is possible, otherwise
  // a download anchor. Named by the file it opens — it holds no text of its own.
  const activator = onPreview ? createPreviewBody(onPreview) : createDownloadBody(href, downloadName);
  activator.setAttribute('data-role', 'file-card');
  activator.setAttribute('aria-label', displayName);
  Object.assign(activator.style, ACTIVATOR_STYLE);

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
  name.textContent = displayName;
  if (onRename) {
    name.setAttribute('contenteditable', 'true');
    name.setAttribute('role', 'textbox');
    // A textbox takes its name from the author, never from its own contents,
    // so the file it renames labels it.
    name.setAttribute('aria-label', displayName);
    // Positioned so it hit-tests above the activating control covering the
    // card; otherwise a click there would activate instead of placing a caret.
    name.style.position = 'relative';
    // The filename overlaps the activating control, so a click on it must
    // never fall through to preview or to the anchor's navigation.
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

  card.append(activator, icon, meta);

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

  wrapper.append(card, download);
  return wrapper;
}

/** Renders the editable caption row below the card. */
export function renderCaptionRow(opts: CaptionRowOptions): HTMLElement {
  const row = document.createElement('div');
  row.className = 'blok-file-caption-row';

  const caption = document.createElement('div');
  caption.className = 'blok-file-caption';
  caption.setAttribute('data-role', 'file-caption');
  caption.setAttribute('contenteditable', opts.readOnly ? 'false' : 'true');
  caption.setAttribute('data-placeholder', opts.placeholder);
  // The textbox contract is only declared while the field is editable: in
  // read-only the caption is static text, and `aria-multiline` is invalid
  // without the role. `data-placeholder` is not an accessible name, so the
  // (already localized) placeholder copy doubles as the aria-label.
  if (!opts.readOnly) {
    caption.setAttribute('role', 'textbox');
    caption.setAttribute('aria-multiline', 'true');
    caption.setAttribute('aria-label', opts.placeholder);
  }
  caption.textContent = opts.value;

  caption.addEventListener('blur', () => {
    opts.onChange(caption.textContent ?? '');
  });

  row.appendChild(caption);
  return row;
}
