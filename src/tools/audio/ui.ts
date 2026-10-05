import type { AudioData } from '../../../types/tools/audio';
import { IconImage, IconUpload } from '../../components/icons';

export interface NowPlayingOptions {
  editable: boolean;
  titlePlaceholder?: string;
  artistPlaceholder?: string;
  coverChangeLabel?: string;
}

export interface NowPlayingElements {
  figure: HTMLElement;
  audio: HTMLAudioElement;
  cover: HTMLElement;
  body: HTMLElement;
  waveformMount: HTMLElement;
  title: HTMLElement;
  artist: HTMLElement;
  coverButton?: HTMLButtonElement;
}

function editableLine(role: string, value: string | undefined, editable: boolean, placeholder?: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-role', role);
  el.setAttribute('contenteditable', editable ? 'true' : 'false');
  if (placeholder) el.setAttribute('data-placeholder', placeholder);
  el.textContent = value ?? '';
  return el;
}

export function renderNowPlaying(data: AudioData, opts: NowPlayingOptions): NowPlayingElements {
  const figure = document.createElement('figure');
  figure.className = 'blok-audio-inner';
  figure.setAttribute('data-role', 'audio-figure');
  figure.style.margin = '0';

  // Zero-size marker pinned to the top of the card. The editor's toolbar centers
  // the +/tunes buttons on the *first line* of the anchor it's handed; anchoring
  // to this top marker (instead of the whole figure) lands those buttons flush
  // with the top of the cover art rather than a line-height below it.
  const toolbarAnchor = document.createElement('span');
  toolbarAnchor.className = 'blok-audio-toolbar-anchor';
  toolbarAnchor.setAttribute('data-role', 'audio-toolbar-anchor');
  toolbarAnchor.setAttribute('aria-hidden', 'true');

  const cover = document.createElement('div');
  cover.className = 'blok-audio-cover';
  cover.setAttribute('data-role', 'audio-cover');
  if (data.coverUrl) {
    const img = document.createElement('img');
    img.src = data.coverUrl;
    img.alt = '';
    cover.appendChild(img);
  } else {
    // No artwork: stand a glossy black vinyl record in the panel instead of a
    // flat "missing image" glyph. The disc (grooves + cream label + spindle, with
    // a fixed specular it shimmers under) is pure CSS; its rotation is driven by
    // disc.ts, which spins the platter up when the track plays and lets it coast
    // down on pause — like a real turntable with mass.
    const placeholder = document.createElement('span');
    placeholder.className = 'blok-audio-cover__placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    const disc = document.createElement('span');
    disc.className = 'blok-audio-cover__disc';
    disc.setAttribute('data-role', 'audio-cover-disc');
    placeholder.append(disc);
    cover.appendChild(placeholder);
  }

  const coverButton = ((): HTMLButtonElement | undefined => {
    if (!opts.editable) {
      return undefined;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'blok-audio-cover__change';
    button.setAttribute('data-role', 'audio-cover-change');
    button.setAttribute('aria-label', opts.coverChangeLabel ?? 'Change cover');
    // The button opens the cover-picker dialog; the picker toggles
    // aria-expanded while it is open.
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = IconImage;
    cover.appendChild(button);

    return button;
  })();

  const title = editableLine('audio-title', data.title, opts.editable, opts.titlePlaceholder);
  title.className = 'blok-audio-title';
  const artist = editableLine('audio-artist', data.artist, opts.editable, opts.artistPlaceholder);
  artist.className = 'blok-audio-artist';

  const waveformMount = document.createElement('div');
  waveformMount.className = 'blok-audio-waveform';
  waveformMount.setAttribute('data-role', 'audio-waveform');

  const body = document.createElement('div');
  body.className = 'blok-audio-body';
  body.setAttribute('data-role', 'audio-body');
  body.append(title, artist, waveformMount);

  const audio = document.createElement('audio');
  audio.setAttribute('data-role', 'audio-media');
  audio.setAttribute('preload', 'metadata');
  audio.src = data.url;
  audio.tabIndex = 0;
  if (data.loop) audio.loop = true;

  figure.append(toolbarAnchor, cover, body, audio);
  return { figure, audio, cover, body, waveformMount, title, artist, coverButton };
}

export interface CaptionRowOptions {
  value: string;
  placeholder: string;
  editable: boolean;
}

export function renderCaptionRow(opts: CaptionRowOptions): HTMLElement {
  const row = document.createElement('div');
  row.className = 'blok-audio-caption-row';
  row.setAttribute('data-role', 'audio-caption-row');
  // Inner wrapper carries the visible layout (padding/border) so the row itself
  // can collapse cleanly via grid-template-rows when toggled.
  const inner = document.createElement('div');
  inner.className = 'blok-audio-caption-row__inner';
  const cap = editableLine('audio-caption', opts.value, opts.editable, opts.placeholder);
  cap.className = 'blok-audio-caption';
  inner.appendChild(cap);
  row.appendChild(inner);
  return row;
}

export type ErrorService = 'google-drive' | 'onedrive';

/** Bars in the dead waveform; the glitch sits a little before the middle. */
const FLATLINE_BARS = 48;
const GLITCH_BARS = [19, 20, 21];

export interface ErrorStateOptions {
  message: string;
  /** The share service the link came from, when that is why it failed. */
  service?: ErrorService;
  /** Short decorative label above the message. */
  badge?: string;
  replaceLabel: string;
  onReplace(): void;
  /** Offer a file picker right on the card. Omit when uploading is not allowed. */
  upload?: { label: string; accept: string; onFile(file: File): void };
}

/**
 * The failed player: the same card as a working track, but the record is
 * cracked and the waveform is flat. Only the message and buttons are read out.
 */
export function renderErrorState(opts: ErrorStateOptions): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'blok-audio-error-state';
  wrap.setAttribute('data-role', 'audio-error');
  if (opts.service) wrap.setAttribute('data-reason', opts.service);

  const art = document.createElement('div');
  art.className = 'blok-audio-cover blok-audio-error-state__art';
  art.setAttribute('data-role', 'audio-error-art');
  art.setAttribute('aria-hidden', 'true');
  const placeholder = document.createElement('span');
  placeholder.className = 'blok-audio-cover__placeholder';
  const disc = document.createElement('span');
  disc.className = 'blok-audio-cover__disc';
  placeholder.append(disc);
  // Inside the disc so the crack turns with it; audio.css draws the line.
  const crack = document.createElement('span');
  crack.className = 'blok-audio-error-state__crack';
  disc.append(crack);
  art.append(placeholder);

  const body = document.createElement('div');
  body.className = 'blok-audio-error-state__body';

  if (opts.badge) {
    const source = document.createElement('span');
    source.className = 'blok-audio-error-state__source';
    source.setAttribute('data-role', 'audio-error-source');
    source.setAttribute('aria-hidden', 'true');
    source.textContent = opts.badge;
    body.append(source);
  }

  const message = document.createElement('p');
  message.className = 'blok-audio-error-state__message';
  message.setAttribute('data-role', 'audio-error-message');
  message.textContent = opts.message;

  const wave = document.createElement('div');
  wave.className = 'blok-audio-error-state__wave';
  wave.setAttribute('data-role', 'audio-error-wave');
  wave.setAttribute('aria-hidden', 'true');
  wave.append(...Array.from({ length: FLATLINE_BARS }, (_, i) => {
    const bar = document.createElement('span');
    if (GLITCH_BARS.includes(i)) bar.setAttribute('data-glitch', '');

    return bar;
  }));

  const actions = document.createElement('div');
  actions.className = 'blok-audio-error-state__actions';

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
    upload.className = 'blok-audio-error-state__upload';
    upload.setAttribute('data-action', 'upload');
    upload.innerHTML = IconUpload;
    upload.append(label);
    upload.addEventListener('click', () => input.click());
    actions.append(upload, input);
  }

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'blok-audio-retry';
  retry.setAttribute('data-action', 'replace');
  retry.textContent = opts.replaceLabel;
  retry.addEventListener('click', () => opts.onReplace());
  actions.append(retry);

  body.append(message, wave, actions);
  wrap.append(art, body);

  return wrap;
}
