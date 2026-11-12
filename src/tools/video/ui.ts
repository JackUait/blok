import type { VideoAlignment, VideoData } from '../../../types/tools/video';
import { readVariants } from '../../shared/read-variants';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { IconUpload } from '../../components/icons';
import { mountErrorScreen } from './error-screen';

const ALIGN_TO_TEXT_ALIGN: Record<VideoAlignment, string> = {
  left: 'left',
  center: 'center',
  right: 'right',
};

export function renderVideo(data: Partial<VideoData> & { url: string }): HTMLElement {
  const alignment = data.alignment ?? 'center';
  const figure = document.createElement('figure');
  figure.className = 'blok-video-inner';
  figure.setAttribute('data-role', 'video-figure');
  figure.style.margin = '0';
  figure.style.textAlign = ALIGN_TO_TEXT_ALIGN[alignment];
  figure.style.position = 'relative';
  if (data.width !== undefined) {
    figure.style.width = `${data.width}%`;
  }

  // The media wrapper hugs the player pixels and anchors the overlaid chrome
  // (custom controls, edit toolbar, resize handles) so they sit over the video
  // only — never over the caption row below.
  const media = document.createElement('div');
  media.className = 'blok-video-media';
  media.setAttribute('data-role', 'video-media');
  media.style.position = 'relative';
  // Reserve space before loadedmetadata fires — without this the <video>
  // collapses to zero height then "pops" when the browser learns the
  // intrinsic ratio (the "squeeze" visual glitch on load).
  media.style.aspectRatio = data.aspectRatio ?? '16 / 9';

  // No native `controls` — a custom Airbnb-style control surface is attached
  // separately (see controls.ts) and fully replaces the browser chrome.
  const video = document.createElement('video');
  video.setAttribute(DATA_ATTR.blockContextMenu, '');
  video.setAttribute('data-blok-testid', 'video-player');
  video.setAttribute('playsinline', '');
  // The block raises it to `metadata` once the player nears the viewport.
  video.setAttribute('preload', 'none');
  // Focusable so the player can field keyboard control (seek, volume, speed,
  // play/pause, mute, fullscreen) à la a native player.
  video.setAttribute('tabindex', '0');
  video.setAttribute(
    'aria-keyshortcuts',
    'Space k j l ArrowLeft ArrowRight ArrowUp ArrowDown m f Home End',
  );
  const variants = readVariants(data.variants, data.url) ?? [];

  if (variants.length === 0) {
    video.setAttribute('src', data.url);
  }
  for (const variant of variants) {
    const source = document.createElement('source');

    source.setAttribute('src', variant.url);
    source.setAttribute('type', variant.mimeType);
    video.appendChild(source);
  }
  video.style.width = '100%';
  video.style.display = 'block';
  media.appendChild(video);
  figure.appendChild(media);

  return figure;
}

export interface CaptionRowOptions {
  value: string;
  placeholder: string;
  readOnly: boolean;
  onChange(next: string): void;
}

export function renderCaptionRow(opts: CaptionRowOptions): HTMLElement {
  const row = document.createElement('div');
  row.className = 'blok-video-caption-row';
  row.setAttribute('data-role', 'video-caption-row');

  const caption = document.createElement('div');
  caption.className = 'blok-video-caption';
  caption.setAttribute('data-role', 'video-caption');
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
  caption.style.outline = 'none';
  caption.style.textAlign = 'start';

  if (!opts.readOnly) {
    caption.addEventListener('blur', () => opts.onChange(caption.textContent ?? ''));
  }

  row.appendChild(caption);
  return row;
}

export interface ErrorStateOptions {
  title: string;
  /** A softer second line: what went wrong in detail, or what to do next. */
  detail?: string;
  /** The player's saved width in percent, so the screen stands where the video did. */
  width?: number;
  /** Send the block back to its empty state. Omit for a reader, who cannot change the source. */
  replace?: { label: string; onReplace(): void };
  /** Offer a file picker right on the screen. Omit when uploading is not allowed. */
  upload?: { label: string; accept: string; onFile(file: File): void };
}

/**
 * The failed player: colour bars that melt, and a glass card on top.
 * Only the card's message and buttons are read out.
 */
export function renderErrorState(opts: ErrorStateOptions): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'blok-video-error-state';
  wrap.setAttribute('data-role', 'video-error');
  if (opts.width !== undefined) wrap.style.width = `${opts.width}%`;

  const screen = document.createElement('div');
  screen.className = 'blok-video-error-state__screen';
  screen.setAttribute('data-role', 'video-error-screen');
  screen.setAttribute('aria-hidden', 'true');
  const picture = document.createElement('canvas');
  picture.className = 'blok-video-error-state__picture';
  screen.append(picture);
  mountErrorScreen(picture, wrap);

  const card = document.createElement('div');
  card.className = 'blok-video-error-state__card';

  const signal = document.createElement('span');
  signal.className = 'blok-video-error-state__signal';
  signal.setAttribute('aria-hidden', 'true');

  const text = document.createElement('div');
  text.className = 'blok-video-error-state__text';
  text.setAttribute('role', 'status');

  const message = document.createElement('p');
  message.className = 'blok-video-error-state__message';
  message.setAttribute('data-role', 'video-error-message');
  message.textContent = opts.title;
  text.append(message);

  if (opts.detail) {
    const detail = document.createElement('p');
    detail.className = 'blok-video-error-state__detail';
    detail.setAttribute('data-role', 'video-error-detail');
    detail.textContent = opts.detail;
    text.append(detail);
  }

  const actions = document.createElement('div');
  actions.className = 'blok-video-error-state__actions';

  if (opts.upload) {
    const { label, accept, onFile } = opts.upload;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) onFile(file);
    });
    const upload = document.createElement('button');
    upload.type = 'button';
    upload.className = 'blok-video-error-state__upload';
    upload.setAttribute('data-action', 'upload');
    upload.innerHTML = IconUpload;
    upload.append(label);
    upload.addEventListener('click', () => input.click());
    actions.append(upload, input);
  }

  if (opts.replace) {
    const { label, onReplace } = opts.replace;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'blok-video-retry';
    retry.setAttribute('data-action', 'replace');
    retry.textContent = label;
    retry.addEventListener('click', () => onReplace());
    actions.append(retry);
  }

  card.append(signal, text, actions);
  wrap.append(screen, card);

  return wrap;
}
