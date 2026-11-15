import { afterEach, describe, expect, it } from 'vitest';
import { APP_NAME, BLOK_MARK_HREF, applyFavicon, brandedTitle, faviconHref } from './tab-identity';

/** The emoji an SVG data URI carries, read back the way a browser would. */
function emojiOf(href: string): string {
  const svg = decodeURIComponent(href.replace(/^data:image\/svg\+xml,/, ''));
  return new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement.textContent ?? '';
}

afterEach(() => {
  document.head.replaceChildren();
});

describe('faviconHref', () => {
  it('draws the page emoji', () => {
    const href = faviconHref('🌱');
    expect(href.startsWith('data:image/svg+xml,')).toBe(true);
    expect(emojiOf(href)).toBe('🌱');
  });

  it('keeps a multi-codepoint emoji whole', () => {
    expect(emojiOf(faviconHref('👩‍💻'))).toBe('👩‍💻');
  });

  it('points straight at an image icon, as the sidebar does', () => {
    expect(faviconHref('/files/abc.png')).toBe('/files/abc.png');
    expect(faviconHref('https://example.test/i.png')).toBe('https://example.test/i.png');
    const inline = 'data:image/png;base64,iVBORw0KGgo=';
    expect(faviconHref(inline)).toBe(inline);
  });

  it('falls back to the Blok mark when the page has no icon', () => {
    expect(faviconHref(undefined)).toBe(BLOK_MARK_HREF);
    expect(faviconHref('')).toBe(BLOK_MARK_HREF);
    expect(faviconHref('   ')).toBe(BLOK_MARK_HREF);
  });

  it('escapes the icon, so a document cannot smuggle markup into the SVG', () => {
    const href = faviconHref('<&');
    const svg = decodeURIComponent(href.replace(/^data:image\/svg\+xml,/, ''));
    expect(svg).toContain('&lt;&amp;');
    // The four tags of the fixed shell, and not one more from the icon.
    expect(svg.match(/</g)).toHaveLength(4);
  });

  it('keeps a keycap, whose ASCII digit is part of the emoji', () => {
    expect(emojiOf(faviconHref('1️⃣'))).toBe('1️⃣');
  });

  it('shows the mark rather than drawing prose into the tab', () => {
    expect(faviconHref('javascript:alert(1)')).toBe(BLOK_MARK_HREF);
    expect(faviconHref('Sans titre')).toBe(BLOK_MARK_HREF);
  });
});

describe('applyFavicon', () => {
  it('owns exactly one icon link, whatever the page declared', () => {
    document.head.innerHTML = '<link rel="icon" href="/favicon.ico" />'
      + '<link rel="icon" sizes="32x32" href="/favicon-32x32.png" />'
      + '<link rel="apple-touch-icon" href="/favicon-128x128.png" />';
    applyFavicon('🌱');
    const icons = document.head.querySelectorAll('link[rel~="icon"]');
    expect(icons).toHaveLength(1);
    expect(emojiOf(icons[0]?.getAttribute('href') ?? '')).toBe('🌱');
    // The touch icon is a different rel and belongs to the home screen.
    expect(document.head.querySelector('link[rel="apple-touch-icon"]')).not.toBeNull();
  });

  it('reuses its own link instead of stacking one per change', () => {
    applyFavicon('🌱');
    const first = document.head.querySelector('link[rel~="icon"]');
    applyFavicon('📘');
    const icons = document.head.querySelectorAll('link[rel~="icon"]');
    expect(icons).toHaveLength(1);
    expect(icons[0]).toBe(first);
    expect(emojiOf(icons[0]?.getAttribute('href') ?? '')).toBe('📘');
  });

  it('returns to the mark when the icon is removed', () => {
    applyFavicon('🌱');
    applyFavicon('');
    expect(document.head.querySelector('link[rel~="icon"]')?.getAttribute('href')).toBe(BLOK_MARK_HREF);
  });
});

describe('brandedTitle', () => {
  it('names the app before the screen, for anything that is not a page', () => {
    expect(brandedTitle('Connexion')).toBe(`${APP_NAME} — Connexion`);
  });

  it('uses the instance name when the server gives one', () => {
    expect(brandedTitle('Connexion', 'Acme')).toBe('Acme — Connexion');
  });

  it('stays the plain app name when there is nothing to qualify', () => {
    expect(brandedTitle('')).toBe(APP_NAME);
    expect(brandedTitle('  ', 'Acme')).toBe('Acme');
  });
});
