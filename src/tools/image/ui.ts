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

export interface LightboxOptions {
  url: string;
  alt?: string;
}

export function openLightbox(opts: LightboxOptions): () => void {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Image preview');
  Object.assign(dialog.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0,0,0,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '9999',
    cursor: 'zoom-out',
  } satisfies Partial<CSSStyleDeclaration>);

  const img = document.createElement('img');
  img.setAttribute('src', opts.url);
  img.setAttribute('alt', opts.alt ?? '');
  Object.assign(img.style, {
    maxWidth: '95vw',
    maxHeight: '95vh',
    objectFit: 'contain',
  } satisfies Partial<CSSStyleDeclaration>);

  dialog.appendChild(img);
  document.body.appendChild(dialog);

  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    dialog.remove();
    previousFocus?.focus?.();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' || event.key === ' ') {
      event.preventDefault();
      close();
    }
  };

  dialog.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  dialog.focus();

  return close;
}
