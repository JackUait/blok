import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { renderNowPlaying, renderCaptionRow } from '../../../../src/tools/audio/ui';

/**
 * Mutation-hardening for `src/tools/audio/ui.ts`.
 *
 * Every recorded live mutant in this module is killed; there are no surviving
 * equivalents left to argue about.
 *
 * Two observations the assertions lean on, both measured in this jsdom:
 * - `setAttribute(name, undefined)` stores the literal string "undefined", so a
 *   truthiness guard flipped to `true` is visible as a present attribute.
 * - `button.type = ''` reflects back as "submit", so the explicit `'button'`
 *   type is observable through the `type` property.
 */

const requireElement = (node: Element | null, what: string): HTMLElement => {
  if (!(node instanceof HTMLElement)) {
    throw new Error(`expected an HTMLElement for ${what}`);
  }

  return node;
};

describe('audio ui — mutation hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('renderNowPlaying figure shell', () => {
    it('stamps the figure class, role and zero margin', () => {
      const { figure } = renderNowPlaying({ url: 'u' }, { editable: true });

      expect(figure.className).toBe('blok-audio-inner');
      expect(figure.getAttribute('data-role')).toBe('audio-figure');
      expect(figure.style.margin).toBe('0px');
    });

    it('prepends a hidden toolbar anchor as the first child of the figure', () => {
      const { figure } = renderNowPlaying({ url: 'u' }, { editable: true });
      const anchor = requireElement(figure.firstElementChild, 'toolbar anchor');

      expect(anchor.getAttribute('data-role')).toBe('audio-toolbar-anchor');
      expect(anchor.className).toBe('blok-audio-toolbar-anchor');
      expect(anchor.getAttribute('aria-hidden')).toBe('true');
    });

    it('names the cover, body and waveform mount', () => {
      const { cover, body, waveformMount } = renderNowPlaying({ url: 'u' }, { editable: true });

      expect(cover.className).toBe('blok-audio-cover');
      expect(body.className).toBe('blok-audio-body');
      expect(waveformMount.className).toBe('blok-audio-waveform');
      expect(waveformMount.getAttribute('data-role')).toBe('audio-waveform');
    });

    it('names the title and artist lines', () => {
      const { title, artist } = renderNowPlaying({ url: 'u' }, { editable: true });

      expect(title.className).toBe('blok-audio-title');
      expect(artist.className).toBe('blok-audio-artist');
    });
  });

  describe('renderNowPlaying cover artwork', () => {
    it('gives the cover image an empty alt so it reads as decorative', () => {
      const { cover } = renderNowPlaying({ url: 'u', coverUrl: 'https://x/c.jpg' }, { editable: true });
      const img = cover.querySelector('img');

      expect(img).not.toBeNull();
      expect(img?.getAttribute('alt')).toBe('');
    });

    it('falls back to a hidden vinyl disc placeholder without artwork', () => {
      const { cover } = renderNowPlaying({ url: 'u' }, { editable: true });
      const disc = requireElement(cover.querySelector('[data-role="audio-cover-disc"]'), 'cover disc');
      const placeholder = requireElement(disc.parentElement, 'cover placeholder');

      expect(disc.className).toBe('blok-audio-cover__disc');
      expect(placeholder.className).toBe('blok-audio-cover__placeholder');
      expect(placeholder.getAttribute('aria-hidden')).toBe('true');
      expect(cover.contains(placeholder)).toBe(true);
    });

    it('types the cover change control as a plain button', () => {
      const { coverButton } = renderNowPlaying({ url: 'u' }, { editable: true });

      if (coverButton === undefined) {
        throw new Error('expected a cover change button in editable mode');
      }

      expect(coverButton.type).toBe('button');
      expect(coverButton.className).toBe('blok-audio-cover__change');
    });
  });

  describe('renderNowPlaying media element', () => {
    it('leaves loop off unless the data asks for it', () => {
      const off = renderNowPlaying({ url: 'u' }, { editable: true });

      expect(off.audio.loop).toBe(false);

      const on = renderNowPlaying({ url: 'u', loop: true }, { editable: true });

      expect(on.audio.loop).toBe(true);
    });
  });

  describe('editable lines', () => {
    it('omits the placeholder attribute when no placeholder is supplied', () => {
      const { title, artist } = renderNowPlaying({ url: 'u' }, { editable: true });

      expect(title.hasAttribute('data-placeholder')).toBe(false);
      expect(artist.hasAttribute('data-placeholder')).toBe(false);
    });

    it('sets the placeholder attribute when one is supplied', () => {
      const { title, artist } = renderNowPlaying(
        { url: 'u' },
        { editable: true, titlePlaceholder: 'Track name', artistPlaceholder: 'Artist' },
      );

      expect(title.getAttribute('data-placeholder')).toBe('Track name');
      expect(artist.getAttribute('data-placeholder')).toBe('Artist');
    });

    it('renders empty text when the value is missing', () => {
      const { title, artist } = renderNowPlaying({ url: 'u' }, { editable: true });

      expect(title.textContent).toBe('');
      expect(artist.textContent).toBe('');
    });
  });

  describe('renderCaptionRow', () => {
    it('names the row, its inner wrapper and the caption line', () => {
      const row = renderCaptionRow({ value: 'cap', placeholder: 'Write a caption', editable: true });
      const inner = requireElement(row.firstElementChild, 'caption inner wrapper');
      const cap = requireElement(inner.firstElementChild, 'caption line');

      expect(row.className).toBe('blok-audio-caption-row');
      expect(row.getAttribute('data-role')).toBe('audio-caption-row');
      expect(inner.className).toBe('blok-audio-caption-row__inner');
      expect(cap.className).toBe('blok-audio-caption');
      expect(cap.getAttribute('data-role')).toBe('audio-caption');
      expect(cap.textContent).toBe('cap');
    });

    it('renders an empty caption line with no text', () => {
      const row = renderCaptionRow({ value: '', placeholder: 'Write a caption', editable: false });
      const cap = requireElement(row.querySelector('[data-role="audio-caption"]'), 'caption line');

      expect(cap.textContent).toBe('');
      expect(cap.getAttribute('contenteditable')).toBe('false');
      expect(cap.getAttribute('data-placeholder')).toBe('Write a caption');
    });
  });
});
