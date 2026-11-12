import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderNowPlaying, renderCaptionRow, renderErrorState } from '../../../../src/tools/audio/ui';

describe('renderNowPlaying', () => {
  it('builds an audio element without native controls', () => {
    const { figure, audio } = renderNowPlaying(
      { url: 'https://x/y.mp3' },
      { editable: true },
    );
    expect(figure.getAttribute('data-role')).toBe('audio-figure');
    expect(audio.getAttribute('src')).toBe('https://x/y.mp3');
    expect(audio.hasAttribute('controls')).toBe(false);
    expect(audio.getAttribute('preload')).toBe('none');
  });

  it('renders title and artist text from data', () => {
    const { title, artist } = renderNowPlaying(
      { url: 'u', title: 'Midnight City', artist: 'M83' },
      { editable: true },
    );
    expect(title.textContent).toBe('Midnight City');
    expect(artist.textContent).toBe('M83');
  });

  it('makes title/artist editable only when editable', () => {
    const ro = renderNowPlaying({ url: 'u', title: 't' }, { editable: false });
    expect(ro.title.getAttribute('contenteditable')).toBe('false');
    const rw = renderNowPlaying({ url: 'u', title: 't' }, { editable: true });
    expect(rw.title.getAttribute('contenteditable')).toBe('true');
  });

  // Title and author save as plain text, so formatting would be dropped.
  it('marks title and author as plain-text fields', () => {
    const { title, artist } = renderNowPlaying({ url: 'u', title: 't' }, { editable: true });

    expect(title.hasAttribute('data-blok-plain-text')).toBe(true);
    expect(artist.hasAttribute('data-blok-plain-text')).toBe(true);
  });

  it('shows the cover image when coverUrl is set', () => {
    const { cover } = renderNowPlaying({ url: 'u', coverUrl: 'https://x/c.jpg' }, { editable: true });
    const img = cover.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://x/c.jpg');
    expect(img?.getAttribute('loading')).toBe('lazy');
  });

  it('renders no decorative equalizer badge on the cover', () => {
    const { cover } = renderNowPlaying({ url: 'u' }, { editable: true });
    expect(cover.querySelector('[data-role="audio-eq"]')).toBeNull();
    expect(cover.querySelector('.blok-audio-eq__bar')).toBeNull();
  });

  it('returns a body element with class blok-audio-body and data-role audio-body', () => {
    const { body } = renderNowPlaying({ url: 'u' }, { editable: true });
    expect(body).not.toBeNull();
    expect(body.classList.contains('blok-audio-body')).toBe(true);
    expect(body.getAttribute('data-role')).toBe('audio-body');
  });

  it('body contains title, artist, and waveformMount', () => {
    const { body, title, artist, waveformMount } = renderNowPlaying(
      { url: 'u', title: 'T', artist: 'A' },
      { editable: true },
    );
    expect(body.contains(title)).toBe(true);
    expect(body.contains(artist)).toBe(true);
    expect(body.contains(waveformMount)).toBe(true);
  });

  it('cover is NOT inside body — it is a direct sibling under the figure', () => {
    const { figure, cover, body } = renderNowPlaying({ url: 'u' }, { editable: true });
    expect(body.contains(cover)).toBe(false);
    expect(cover.parentElement).toBe(figure);
    expect(body.parentElement).toBe(figure);
  });

  it('figure children order is [toolbar-anchor, cover, body, audio]', () => {
    const { figure, cover, body, audio } = renderNowPlaying({ url: 'u' }, { editable: true });
    const children = Array.from(figure.children);
    // A zero-size toolbar anchor leads so the +/tunes buttons center on the card top.
    expect(children[0].getAttribute('data-role')).toBe('audio-toolbar-anchor');
    expect(children[1]).toBe(cover);
    expect(children[2]).toBe(body);
    expect(children[3]).toBe(audio);
    expect(children.length).toBe(4);
  });

  it('all data-role attributes are still reachable via figure.querySelector', () => {
    const { figure } = renderNowPlaying(
      { url: 'u', title: 'T', artist: 'A' },
      { editable: true },
    );
    expect(figure.querySelector('[data-role="audio-cover"]')).not.toBeNull();
    expect(figure.querySelector('[data-role="audio-title"]')).not.toBeNull();
    expect(figure.querySelector('[data-role="audio-artist"]')).not.toBeNull();
    expect(figure.querySelector('[data-role="audio-waveform"]')).not.toBeNull();
    expect(figure.querySelector('[data-role="audio-media"]')).not.toBeNull();
  });
});

describe('renderNowPlaying cover button', () => {
  it('adds a change-cover button when editable', () => {
    const els = renderNowPlaying({ url: 'https://cdn/a.mp3' }, { editable: true });
    expect(els.coverButton).toBeInstanceOf(HTMLButtonElement);
    expect(els.cover.contains(els.coverButton!)).toBe(true);
    expect(els.coverButton!.getAttribute('aria-label')).toBe('Change cover');
  });

  it('advertises the cover picker on the button via aria-haspopup/aria-expanded', () => {
    const els = renderNowPlaying({ url: 'https://cdn/a.mp3' }, { editable: true });
    expect(els.coverButton?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(els.coverButton?.getAttribute('aria-expanded')).toBe('false');
  });

  it('omits the change-cover button in read-only mode', () => {
    const els = renderNowPlaying({ url: 'https://cdn/a.mp3' }, { editable: false });
    expect(els.coverButton).toBeUndefined();
    expect(els.cover.querySelector('[data-role="audio-cover-change"]')).toBeNull();
  });
});

describe('renderCaptionRow', () => {
  it('renders an editable caption with a placeholder', () => {
    const row = renderCaptionRow({ value: '', placeholder: 'Write a caption…', editable: true });
    const cap = row.querySelector('[data-role="audio-caption"]');
    expect(cap?.getAttribute('contenteditable')).toBe('true');
    expect(cap?.getAttribute('data-placeholder')).toBe('Write a caption…');
  });

  it('renders a non-editable caption when not editable', () => {
    const row = renderCaptionRow({ value: 'hi', placeholder: 'Write a caption…', editable: false });
    const cap = row.querySelector('[data-role="audio-caption"]');
    expect(cap?.getAttribute('contenteditable')).toBe('false');
  });
});

describe('renderErrorState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const base = {
    message: 'Audio from Google Drive can’t be played directly.',
    replaceLabel: 'Replace',
    onReplace: (): void => {},
  };

  const SCENES = ['shattered', 'ink-burst', 'sand', 'pulled-plug'];

  it('keeps the hooks hosts and tests target', () => {
    const el = renderErrorState(base).element;
    expect(el.getAttribute('data-role')).toBe('audio-error');
    expect(el.classList.contains('blok-audio-error-state')).toBe(true);
    const replace = el.querySelector('button[data-action="replace"]');
    expect(replace?.classList.contains('blok-audio-retry')).toBe(true);
    expect(replace?.textContent).toBe('Replace');
  });

  it('leaves the message as the only text a screen reader hears besides the buttons', () => {
    const el = renderErrorState({ ...base, service: 'google-drive' }).element;
    const scene = el.querySelector('[data-role="audio-error-scene"]');

    expect(scene?.getAttribute('aria-hidden')).toBe('true');
    expect(scene?.tagName).toBe('CANVAS');
    expect(el.querySelector('[data-role="audio-error-message"]')?.textContent).toBe(base.message);
    expect(el.textContent).toBe(`${base.message}Replace`);
  });

  it('marks the service a failed link came from', () => {
    const drive = renderErrorState({ ...base, service: 'google-drive' }).element;
    expect(drive.getAttribute('data-reason')).toBe('google-drive');
  });

  it('marks no service for an ordinary failure', () => {
    const el = renderErrorState(base).element;
    expect(el.hasAttribute('data-reason')).toBe(false);
  });

  it('shows one of the four broken objects for an ordinary failure', () => {
    const el = renderErrorState(base).element;
    expect(SCENES).toContain(el.getAttribute('data-scene'));
  });

  it('never shows the same object on two errors in a row', () => {
    const shown = Array.from({ length: 40 }, () => renderErrorState(base).element.getAttribute('data-scene'));
    const repeats = shown.filter((name, i) => i > 0 && name === shown[i - 1]);

    expect(repeats).toEqual([]);
    expect(shown).not.toContain('wont-fit');
  });

  it('shows the record that will not fit when the file is too large, every time', () => {
    const shown = Array.from({ length: 12 }, () =>
      renderErrorState({ ...base, tooLarge: { size: '84 MB', limit: 'max 50 MB' } }).element.getAttribute('data-scene'));

    expect(new Set(shown)).toEqual(new Set(['wont-fit']));
  });

  it('hands back a way to stop the object', () => {
    const state = renderErrorState(base);

    expect(() => state.destroy()).not.toThrow();
  });

  it('runs onReplace when Replace is clicked', () => {
    const onReplace = vi.fn();
    const el = renderErrorState({ ...base, onReplace }).element;
    el.querySelector<HTMLButtonElement>('[data-action="replace"]')?.click();
    expect(onReplace).toHaveBeenCalledTimes(1);
  });

  it('has no upload button unless uploading is offered', () => {
    const el = renderErrorState(base).element;
    expect(el.querySelector('[data-action="upload"]')).toBeNull();
    expect(el.querySelector('input[type="file"]')).toBeNull();
  });

  it('opens a file picker limited to the accepted types and hands the picked file over', () => {
    const onFile = vi.fn();
    const el = renderErrorState({ ...base, upload: { label: 'Choose audio', accept: 'audio/mpeg,audio/wav', onFile } }).element;
    const button = el.querySelector<HTMLButtonElement>('button[data-action="upload"]');
    const input = el.querySelector<HTMLInputElement>('input[type="file"]');
    if (!button || !input) throw new Error('upload controls not rendered');
    expect(button.textContent?.trim()).toBe('Choose audio');
    expect(input.accept).toBe('audio/mpeg,audio/wav');

    const click = vi.spyOn(input, 'click');
    button.click();
    expect(click).toHaveBeenCalledTimes(1);

    const file = new File(['x'], 'song.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    expect(onFile).toHaveBeenCalledWith(file);
  });
});
