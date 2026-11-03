import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadImage } from '../../../../src/tools/image/download';

/**
 * Capture every anchor appended to the body and record its attributes at the
 * moment click() is invoked (before it is detached again).
 */
const captureAnchors = (): { attrs: Array<Record<string, string | null>>; restore: () => void } => {
  const attrs: Array<Record<string, string | null>> = [];
  const spy = vi.spyOn(document.body, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    if (node instanceof HTMLAnchorElement) {
      const anchor: HTMLAnchorElement = node;
      vi.spyOn(anchor, 'click').mockImplementation(() => {
        attrs.push({
          href: anchor.getAttribute('href'),
          download: anchor.getAttribute('download'),
          target: anchor.getAttribute('target'),
          rel: anchor.getAttribute('rel'),
        });
      });
    }

    return node;
  });

  return { attrs, restore: () => spy.mockRestore() };
};

describe('downloadImage', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('fetches the image as a blob and triggers a same-origin object-url download (no new tab)', async () => {
    const blob = new Blob(['data'], { type: 'image/png' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => blob })));
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const { attrs, restore } = captureAnchors();

    await downloadImage('https://x/y.png', 'pic.png');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(attrs).toHaveLength(1);
    // Downloads from the blob object url, which is same-origin so `download` is honored.
    expect(attrs[0].href).toBe('blob:fake');
    expect(attrs[0].download).toBe('pic.png');
    // Crucially, it must NOT open a new tab — that is what was showing the image page.
    expect(attrs[0].target).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');

    restore();
  });

  it('downloads a no-uploader SVG data: image from a blob made of its bytes', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const url = `data:image/svg+xml;base64,${btoa(svg)}`;
    const made: Blob[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('no fetch for data:'); }));
    vi.spyOn(URL, 'createObjectURL').mockImplementation((obj) => {
      if (obj instanceof Blob) made.push(obj);

      return 'blob:fake';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const { attrs, restore } = captureAnchors();

    await downloadImage(url, 'logo.svg');

    expect(attrs).toEqual([{ href: 'blob:fake', download: 'logo.svg', target: null, rel: 'noopener' }]);
    expect(made.map((blob) => blob.type)).toEqual(['image/svg+xml']);
    expect(await made[0].text()).toBe(svg);
    expect(fetch).not.toHaveBeenCalled();

    restore();
  });

  it('keeps the UTF-8 bytes of a percent-encoded SVG data: image', async () => {
    const made: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((obj) => {
      if (obj instanceof Blob) made.push(obj);

      return 'blob:fake';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const { restore } = captureAnchors();

    await downloadImage('data:image/svg+xml,%3Csvg%3E%C3%A9%3C%2Fsvg%3E', 'e.svg');

    expect(await made[0].text()).toBe('<svg>é</svg>');

    restore();
  });

  it('never puts an SVG data: URL on an anchor, even when it cannot be decoded', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    const { attrs, restore } = captureAnchors();

    await downloadImage('data:image/svg+xml;base64,%%%', 'logo.svg');

    expect(attrs).toEqual([]);

    restore();
  });

  it('falls back to a direct anchor (no new tab) when the fetch is blocked by CORS', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { attrs, restore } = captureAnchors();

    await downloadImage('https://x/y.png', 'pic.png');

    expect(attrs).toHaveLength(1);
    expect(attrs[0].href).toBe('https://x/y.png');
    expect(attrs[0].download).toBe('pic.png');
    expect(attrs[0].target).toBeNull();

    restore();
  });

  it('never puts a stored javascript: URL on the anchor (stored XSS)', async () => {
    // The CORS fallback path is the dangerous one: it points the anchor at the
    // raw stored URL.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { attrs, restore } = captureAnchors();

    await downloadImage('javascript:fetch("/admin/api", { credentials: "include" })', 'pic.png');

    expect(attrs).toEqual([]);

    restore();
  });

  it('falls back to a direct anchor when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, blob: async () => new Blob() })));
    const { attrs, restore } = captureAnchors();

    await downloadImage('https://x/y.png', 'pic.png');

    expect(attrs).toHaveLength(1);
    expect(attrs[0].href).toBe('https://x/y.png');

    restore();
  });
});
