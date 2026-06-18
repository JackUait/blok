import type { VideoAlignment, VideoData } from '../../../types/tools/video';

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
  video.setAttribute('data-blok-testid', 'video-player');
  video.setAttribute('playsinline', '');
  video.setAttribute('preload', 'metadata');
  // Focusable so the player can field keyboard control (seek, volume, speed,
  // play/pause, mute, fullscreen) à la a native player.
  video.setAttribute('tabindex', '0');
  video.setAttribute(
    'aria-keyshortcuts',
    'Space k j l ArrowLeft ArrowRight ArrowUp ArrowDown m f Home End',
  );
  video.setAttribute('src', data.url);
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
  caption.setAttribute('role', 'textbox');
  caption.setAttribute('contenteditable', opts.readOnly ? 'false' : 'true');
  caption.setAttribute('data-placeholder', opts.placeholder);
  caption.textContent = opts.value;
  caption.style.outline = 'none';
  caption.style.textAlign = 'left';

  if (!opts.readOnly) {
    caption.addEventListener('blur', () => opts.onChange(caption.textContent ?? ''));
  }

  row.appendChild(caption);
  return row;
}
