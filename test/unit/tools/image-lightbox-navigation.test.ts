import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
  show: vi.fn(),
}));

import { openLightbox } from '../../../src/tools/image/ui';

afterEach(() => {
  document.querySelectorAll('[role="dialog"][aria-modal="true"]').forEach((el) => el.remove());
});

describe('openLightbox navigation', () => {
  it('does not render nav element when navigation is omitted', () => {
    const close = openLightbox({ url: 'https://x/a.png' });
    expect(document.querySelector('[data-role="lightbox-nav"]')).toBeNull();
    close();
  });

  it('does not render nav element when only one item supplied', () => {
    const close = openLightbox({
      url: 'https://x/a.png',
      navigation: {
        items: [{ url: 'https://x/a.png' }],
        startIndex: 0,
      },
    });
    expect(document.querySelector('[data-role="lightbox-nav"]')).toBeNull();
    close();
  });

  it('renders a nav container separate from the toolbar with prev and next buttons', () => {
    const close = openLightbox({
      url: 'https://x/a.png',
      navigation: {
        items: [
          { url: 'https://x/a.png' },
          { url: 'https://x/b.png' },
        ],
        startIndex: 0,
      },
    });
    const nav = document.querySelector('[data-role="lightbox-nav"]');
    expect(nav).not.toBeNull();
    if (!nav) throw new Error('nav missing');
    const toolbar = document.querySelector('[data-role="lightbox-toolbar"]');
    expect(toolbar).not.toBeNull();
    expect(toolbar?.contains(nav)).toBe(false);
    expect(nav.querySelector('[data-action="lightbox-prev"]')).not.toBeNull();
    expect(nav.querySelector('[data-action="lightbox-next"]')).not.toBeNull();
    close();
  });

  it('nav container carries a class that positions it on the left', () => {
    const close = openLightbox({
      url: 'https://x/a.png',
      navigation: {
        items: [
          { url: 'https://x/a.png' },
          { url: 'https://x/b.png' },
        ],
        startIndex: 0,
      },
    });
    const nav = document.querySelector<HTMLElement>('[data-role="lightbox-nav"]');
    if (!nav) throw new Error('nav missing');
    expect(nav.className).toContain('blok-image-lightbox__nav');
    close();
  });

  it('clicking next swaps the displayed image to the next item', () => {
    const close = openLightbox({
      url: 'https://x/a.png',
      navigation: {
        items: [
          { url: 'https://x/a.png', alt: 'a' },
          { url: 'https://x/b.png', alt: 'b' },
          { url: 'https://x/c.png', alt: 'c' },
        ],
        startIndex: 0,
      },
    });
    const next = document.querySelector<HTMLButtonElement>('[data-action="lightbox-next"]');
    if (!next) throw new Error('next missing');
    next.click();
    const img = document.querySelector<HTMLImageElement>('[role="dialog"] img');
    if (!img) throw new Error('img missing');
    expect(img.getAttribute('src')).toBe('https://x/b.png');
    expect(img.getAttribute('alt')).toBe('b');
    close();
  });

  it('clicking prev swaps the displayed image to the previous item', () => {
    const close = openLightbox({
      url: 'https://x/b.png',
      navigation: {
        items: [
          { url: 'https://x/a.png', alt: 'a' },
          { url: 'https://x/b.png', alt: 'b' },
        ],
        startIndex: 1,
      },
    });
    const prev = document.querySelector<HTMLButtonElement>('[data-action="lightbox-prev"]');
    if (!prev) throw new Error('prev missing');
    prev.click();
    const img = document.querySelector<HTMLImageElement>('[role="dialog"] img');
    if (!img) throw new Error('img missing');
    expect(img.getAttribute('src')).toBe('https://x/a.png');
    expect(img.getAttribute('alt')).toBe('a');
    close();
  });

  it('prev is disabled on first item, next is disabled on last item', () => {
    const close = openLightbox({
      url: 'https://x/a.png',
      navigation: {
        items: [
          { url: 'https://x/a.png' },
          { url: 'https://x/b.png' },
        ],
        startIndex: 0,
      },
    });
    const prev = document.querySelector<HTMLButtonElement>('[data-action="lightbox-prev"]');
    const next = document.querySelector<HTMLButtonElement>('[data-action="lightbox-next"]');
    if (!prev || !next) throw new Error('nav buttons missing');
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    next.click();
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(true);
    close();
  });

  it('ArrowRight key advances to next item, ArrowLeft goes back', () => {
    const close = openLightbox({
      url: 'https://x/a.png',
      navigation: {
        items: [
          { url: 'https://x/a.png' },
          { url: 'https://x/b.png' },
          { url: 'https://x/c.png' },
        ],
        startIndex: 0,
      },
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    let img = document.querySelector<HTMLImageElement>('[role="dialog"] img');
    expect(img?.getAttribute('src')).toBe('https://x/b.png');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    img = document.querySelector<HTMLImageElement>('[role="dialog"] img');
    expect(img?.getAttribute('src')).toBe('https://x/a.png');
    close();
  });

  it('clicking nav buttons does not close the lightbox', () => {
    openLightbox({
      url: 'https://x/a.png',
      navigation: {
        items: [
          { url: 'https://x/a.png' },
          { url: 'https://x/b.png' },
        ],
        startIndex: 0,
      },
    });
    const next = document.querySelector<HTMLButtonElement>('[data-action="lightbox-next"]');
    if (!next) throw new Error('next missing');
    next.click();
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
  });
});
