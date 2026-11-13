import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPdfLinks } from '../../../../../src/tools/file/pdf/pdf-links';
import type { PdfAnnotationLike, PdfViewport } from '../../../../../src/tools/file/pdf/pdf-types';

/** A US Letter page at scale 1: 612×792. */
const VIEWPORT: PdfViewport = { width: 612, height: 792, scale: 1 };

const link = (extra: Partial<PdfAnnotationLike>): PdfAnnotationLike => ({ subtype: 'Link', rect: [72, 692, 272, 712], ...extra });

describe('renderPdfLinks', () => {
  let host: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    vi.restoreAllMocks();
  });

  it('opens an http(s) link in a new tab with no opener and no referrer', () => {
    renderPdfLinks(host, [link({ url: 'https://a.test/x' })], VIEWPORT, vi.fn());

    const anchor = host.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://a.test/x');
    expect(anchor?.target).toBe('_blank');
    expect(anchor?.rel).toBe('noopener noreferrer');
  });

  it('places the link over its rect, with y flipped from the page bottom', () => {
    renderPdfLinks(host, [link({ url: 'https://a.test/x' })], VIEWPORT, vi.fn());

    const anchor = host.querySelector<HTMLElement>('a');
    // left 72/612, top (792-712)/792, width 200/612, height 20/792.
    expect(anchor?.style.left).toBe(`${(72 / 612) * 100}%`);
    expect(anchor?.style.top).toBe(`${(80 / 792) * 100}%`);
    expect(anchor?.style.width).toBe(`${(200 / 612) * 100}%`);
    expect(anchor?.style.height).toBe(`${(20 / 792) * 100}%`);
  });

  it('uses the viewport transform when pdf.js gives one (rotated or offset pages)', () => {
    const viewport: PdfViewport = {
      ...VIEWPORT,
      convertToViewportRectangle: () => [100, 300, 300, 200],
    };
    renderPdfLinks(host, [link({ url: 'https://a.test/x' })], viewport, vi.fn());

    const anchor = host.querySelector<HTMLElement>('a');
    expect(anchor?.style.left).toBe(`${(100 / 612) * 100}%`);
    expect(anchor?.style.top).toBe(`${(200 / 792) * 100}%`);
    expect(anchor?.style.width).toBe(`${(200 / 612) * 100}%`);
    expect(anchor?.style.height).toBe(`${(100 / 792) * 100}%`);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '/relative',
    '//evil.test/x',
    'mailto:x@a.test',
    'not a url',
  ])('creates no anchor for %s', (url) => {
    renderPdfLinks(host, [link({ url })], VIEWPORT, vi.fn());

    expect(host.children).toHaveLength(0);
  });

  it('skips annotations that are not links', () => {
    renderPdfLinks(host, [{ subtype: 'Widget', rect: [0, 0, 10, 10], url: 'https://a.test/x' }], VIEWPORT, vi.fn());

    expect(host.children).toHaveLength(0);
  });

  it('jumps to an internal destination on click without a hash href', () => {
    const goTo = vi.fn();
    const dest = [{ num: 7, gen: 0 }, { name: 'XYZ' }, 0, 792, null];
    renderPdfLinks(host, [link({ dest })], VIEWPORT, goTo);

    const anchor = host.querySelector<HTMLAnchorElement>('a');
    expect(anchor).not.toBeNull();
    expect(anchor?.hasAttribute('href')).toBe(false);
    anchor?.click();

    expect(goTo).toHaveBeenCalledWith(dest);
  });

  it('lets the keyboard reach and follow an internal link', () => {
    const goTo = vi.fn();
    renderPdfLinks(host, [link({ dest: 'chapter-2' })], VIEWPORT, goTo);

    const anchor = host.querySelector<HTMLAnchorElement>('a');
    expect(anchor?.tabIndex).toBe(0);
    expect(anchor?.getAttribute('role')).toBe('link');
    anchor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(goTo).toHaveBeenCalledWith('chapter-2');
  });

  it('names a link after the page text under it', () => {
    renderPdfLinks(host, [link({ dest: 'chapter-2', overlaidText: ' See chapter 2 ' })], VIEWPORT, vi.fn());

    expect(host.querySelector('a')?.getAttribute('aria-label')).toBe('See chapter 2');
  });

  it('prefers the external url when a link has both', () => {
    const goTo = vi.fn();
    renderPdfLinks(host, [link({ url: 'https://a.test/x', dest: 'chapter-2' })], VIEWPORT, goTo);

    expect(host.querySelectorAll('a')).toHaveLength(1);
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://a.test/x');
  });
});
