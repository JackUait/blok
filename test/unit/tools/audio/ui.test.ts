import { describe, it, expect } from 'vitest';
import { renderNowPlaying, renderCaptionRow } from '../../../../src/tools/audio/ui';

describe('renderNowPlaying', () => {
  it('builds an audio element without native controls', () => {
    const { figure, audio } = renderNowPlaying(
      { url: 'https://x/y.mp3' },
      { editable: true },
    );
    expect(figure.getAttribute('data-role')).toBe('audio-figure');
    expect(audio.getAttribute('src')).toBe('https://x/y.mp3');
    expect(audio.hasAttribute('controls')).toBe(false);
    expect(audio.getAttribute('preload')).toBe('metadata');
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

  it('shows the cover image when coverUrl is set', () => {
    const { cover } = renderNowPlaying({ url: 'u', coverUrl: 'https://x/c.jpg' }, { editable: true });
    const img = cover.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://x/c.jpg');
  });
});

describe('renderCaptionRow', () => {
  it('renders an editable caption with a placeholder', () => {
    const row = renderCaptionRow({ value: '', placeholder: 'Write a caption…', editable: true });
    const cap = row.querySelector('[data-role="audio-caption"]');
    expect(cap?.getAttribute('contenteditable')).toBe('true');
    expect(cap?.getAttribute('data-placeholder')).toBe('Write a caption…');
  });
});
