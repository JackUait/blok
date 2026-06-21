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

  const cover = document.createElement('div');
  cover.className = 'blok-audio-cover';
  cover.setAttribute('data-role', 'audio-cover');
  if (data.coverUrl) {
    const img = document.createElement('img');
    img.src = data.coverUrl;
    img.alt = '';
    cover.appendChild(img);
  } else {
    // No artwork: stand a vinyl turntable in the panel instead of a flat
    // "missing image" glyph. Disc (grooves/label/spindle) + a tonearm are pure
    // CSS; while the track plays the disc spins and the arm swings onto it (it
    // parks off to the side when stopped — see the [data-playing] rules).
    const placeholder = document.createElement('span');
    placeholder.className = 'blok-audio-cover__placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    const disc = document.createElement('span');
    disc.className = 'blok-audio-cover__disc';
    const arm = document.createElement('span');
    arm.className = 'blok-audio-cover__arm';
    placeholder.append(disc, arm);
    cover.appendChild(placeholder);
  }

  // Decorative "now playing" equalizer — a dark badge of dancing bars pinned to
  // the cover. CSS reveals + animates it only while the figure is playing
  // (driven by the [data-playing] attribute the controls toggle).
  const eq = document.createElement('span');
  eq.className = 'blok-audio-eq';
  eq.setAttribute('data-role', 'audio-eq');
  eq.setAttribute('aria-hidden', 'true');
  ['a', 'b', 'c'].forEach(() => {
    const bar = document.createElement('span');
    bar.className = 'blok-audio-eq__bar';
    eq.appendChild(bar);
  });
  cover.appendChild(eq);

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
