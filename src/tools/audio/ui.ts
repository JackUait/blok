import type { AudioData } from '../../../types/tools/audio';
import { IconImage } from '../../components/icons';

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
