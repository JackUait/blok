import { describe, it, expect } from 'vitest';

import { safeHttpHref, safePreviewSrc } from '../../../../src/tools/file/url';

describe('file url mutants', () => {
  describe('an anchor href', () => {
    it('keeps an http scheme and resolves a relative path against the page', () => {
      expect(safeHttpHref('https://example.com/a.pdf')).toBe('https://example.com/a.pdf');
      expect(safeHttpHref('/a.pdf')).toBe(new URL('/a.pdf', window.location.href).href);
    });

    it('refuses a script or data scheme', () => {
      expect(safeHttpHref('javascript:alert(1)')).toBeNull();
      expect(safeHttpHref('data:text/html,<script></script>')).toBeNull();
    });

    // The parser throws rather than answering, and the answer must still be
    // null rather than undefined.
    it('answers null, not undefined, for a URL the parser rejects', () => {
      expect(safeHttpHref('http://[')).toBeNull();
    });
  });

  describe('a preview src', () => {
    it('allows blob alongside http, and refuses the rest', () => {
      expect(safePreviewSrc('blob:http://example.com/abc')).toBe('blob:http://example.com/abc');
      expect(safePreviewSrc('https://example.com/a.pdf')).toBe('https://example.com/a.pdf');
      expect(safePreviewSrc('data:text/html,x')).toBeNull();
      expect(safePreviewSrc('/relative.pdf')).toBeNull();
    });
  });
});
