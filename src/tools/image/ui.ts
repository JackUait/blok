import type { ImageData } from '../../../types/tools/image';

const ALIGNMENT_TO_JUSTIFY: Record<NonNullable<ImageData['alignment']>, string> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
};

export function renderImage(data: Partial<ImageData> & { url: string }): HTMLElement {
  const figure = document.createElement('figure');
  figure.style.display = 'flex';
  figure.style.flexDirection = 'column';
  figure.style.margin = '0';
  figure.style.justifyContent = ALIGNMENT_TO_JUSTIFY[data.alignment ?? 'center'];

  const img = document.createElement('img');
  img.setAttribute('src', data.url);
  img.setAttribute('alt', data.alt ?? '');
  img.style.width = `${data.width ?? 100}%`;
  img.style.height = 'auto';
  img.style.maxWidth = '100%';
  img.draggable = false;

  figure.appendChild(img);
  return figure;
}

export interface CaptionOptions {
  value: string;
  placeholder: string;
  readOnly: boolean;
}

export function renderCaption(opts: CaptionOptions): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'textbox');
  el.setAttribute('contenteditable', opts.readOnly ? 'false' : 'true');
  el.setAttribute('data-placeholder', opts.placeholder);
  el.textContent = opts.value;
  el.style.marginTop = '8px';
  el.style.fontSize = '0.875rem';
  el.style.color = 'var(--blok-text-secondary, #6b7280)';
  el.style.outline = 'none';
  return el;
}
