import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  isSafeRasterImageDataUrl,
  safeDownloadHref,
  safeHref,
  safeImageSrc,
} from '../../../../src/components/utils/sanitize-url';

/**
 * The `typeof document` guard is only reachable with no document at all, and
 * the stub has to be gone again before any assertion runs — an expect while
 * `document` is undefined takes the whole file down with it.
 */
const withoutDocument = (run: () => string | null): string | null => {
  vi.stubGlobal('document', undefined);

  try {
    return run();
  } finally {
    vi.unstubAllGlobals();
  }
};

describe('sanitize-url mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('isSafeRasterImageDataUrl', () => {
    it('accepts a raster subtype and refuses an xml one', () => {
      expect(isSafeRasterImageDataUrl('data:image/png;base64,AAA')).toBe(true);
      expect(isSafeRasterImageDataUrl('data:image/svg+xml;base64,AAA')).toBe(false);
    });
  });

  describe('reading the scheme', () => {
    // A colon later in the path is not a scheme, and treating it as one would
    // drop every relative URL that contains one.
    it('only reads a scheme anchored at the start', () => {
      expect(safeHref('/path/to:file')).toBe('/path/to:file');
    });
  });

  describe('safeImageSrc', () => {
    it('accepts plain http as well as https', () => {
      expect(safeImageSrc('http://example.com/a.png')).toBe('http://example.com/a.png');
    });

    it('refuses a foreign scheme that merely mentions https later', () => {
      expect(safeImageSrc('ftp://example.com/https:a.png')).toBeNull();
    });
  });

  describe('safeDownloadHref', () => {
    it('refuses an empty URL', () => {
      expect(safeDownloadHref('')).toBeNull();
    });

    // Whitespace alone resolves to the document base rather than throwing, so
    // it has to be trimmed away before the parse, not after.
    it('refuses a URL that is only whitespace', () => {
      expect(safeDownloadHref('   ')).toBeNull();
    });

    it('returns an http URL unchanged', () => {
      expect(safeDownloadHref('https://example.com/a.mp3')).toBe('https://example.com/a.mp3');
    });

    it('returns a blob URL unchanged', () => {
      expect(safeDownloadHref('blob:http://example.com/abc')).toBe('blob:http://example.com/abc');
    });

    it('returns a raster data URL and refuses an xml one', () => {
      expect(safeDownloadHref('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
      expect(safeDownloadHref('data:image/svg+xml;base64,AAA')).toBeNull();
    });

    it('refuses a script scheme', () => {
      expect(safeDownloadHref('javascript:alert(1)')).toBeNull();
    });

    it('resolves a relative URL against the document base', () => {
      expect(safeDownloadHref('/media/a.mp3')).toBe(new URL('/media/a.mp3', document.baseURI).href);
    });

    it('refuses a URL the parser rejects', () => {
      expect(safeDownloadHref('http://[')).toBeNull();
    });

    it('still resolves an absolute URL with no document to base it on', () => {
      expect(withoutDocument(() => safeDownloadHref('https://example.com/a.mp3')))
        .toBe('https://example.com/a.mp3');
    });
  });
});
