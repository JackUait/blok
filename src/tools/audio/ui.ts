import type { AudioData } from '../../../types/tools/audio';

export interface NowPlayingOptions {
  editable: boolean;
  titlePlaceholder?: string;
  artistPlaceholder?: string;
}

export interface NowPlayingElements {
  figure: HTMLElement;
  audio: HTMLAudioElement;
  cover: HTMLElement;
  body: HTMLElement;
  waveformMount: HTMLElement;
  title: HTMLElement;
  artist: HTMLElement;
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
  if (data.width !== undefined) figure.style.width = `${data.width}%`;

  const cover = document.createElement('div');
  cover.className = 'blok-audio-cover';
  cover.setAttribute('data-role', 'audio-cover');
  if (data.coverUrl) {
    const img = document.createElement('img');
    img.src = data.coverUrl;
    img.alt = '';
    cover.appendChild(img);
  }

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

  figure.append(cover, body, audio);
  return { figure, audio, cover, body, waveformMount, title, artist };
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
  const cap = editableLine('audio-caption', opts.value, opts.editable, opts.placeholder);
  cap.className = 'blok-audio-caption';
  row.appendChild(cap);
  return row;
}
