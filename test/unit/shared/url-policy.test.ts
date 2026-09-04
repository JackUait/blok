import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasUnsafeUrlProtocol } from '../../../src/shared/url-policy';

/**
 * Unit tests for the shared URL scheme policy extracted from
 * src/components/utils/sanitizer.ts. Pure decision logic:
 * "is this attribute value unsafe for this attribute name".
 */
describe('url-policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('hasUnsafeUrlProtocol', () => {
    it('returns false for null and empty values', () => {
      expect(hasUnsafeUrlProtocol(null, 'href')).toBe(false);
      expect(hasUnsafeUrlProtocol('', 'href')).toBe(false);
      expect(hasUnsafeUrlProtocol(null, 'src')).toBe(false);
    });

    it('flags javascript: on both href and src', () => {
      expect(hasUnsafeUrlProtocol('javascript:alert(1)', 'href')).toBe(true);
      expect(hasUnsafeUrlProtocol('javascript:alert(1)', 'src')).toBe(true);
    });

    it('flags vbscript: on both href and src', () => {
      expect(hasUnsafeUrlProtocol('vbscript:msgbox(1)', 'href')).toBe(true);
      expect(hasUnsafeUrlProtocol('vbscript:msgbox(1)', 'src')).toBe(true);
    });

    it('closes the whitespace-smuggling class ("java\\nscript:")', () => {
      expect(hasUnsafeUrlProtocol('java\nscript:alert(1)', 'href')).toBe(true);
      expect(hasUnsafeUrlProtocol('v\tbscript:msgbox(1)', 'href')).toBe(true);
      expect(hasUnsafeUrlProtocol('\u0000javascript:alert(1)', 'src')).toBe(true);
      expect(hasUnsafeUrlProtocol('JAVASCRIPT:alert(1)', 'href')).toBe(true);
    });

    it('flags every data: URL in href', () => {
      expect(hasUnsafeUrlProtocol('data:text/html,<script>x</script>', 'href')).toBe(true);
      expect(hasUnsafeUrlProtocol('data:image/png;base64,AAAA', 'href')).toBe(true);
    });

    it('allows safe raster image data: URLs in src only', () => {
      expect(hasUnsafeUrlProtocol('data:image/png;base64,AAAA', 'src')).toBe(false);
      expect(hasUnsafeUrlProtocol('data:image/jpeg;base64,AAAA', 'src')).toBe(false);
      expect(hasUnsafeUrlProtocol('data:image/webp;base64,AAAA', 'src')).toBe(false);
    });

    it('flags scriptable data: payloads in src', () => {
      expect(hasUnsafeUrlProtocol('data:text/html,<script>x</script>', 'src')).toBe(true);
      expect(hasUnsafeUrlProtocol('data:image/svg+xml,<svg onload=alert(1)/>', 'src')).toBe(true);
    });

    it('flags blob: in href but not in src', () => {
      expect(hasUnsafeUrlProtocol('blob:https://example.com/uuid', 'href')).toBe(true);
      expect(hasUnsafeUrlProtocol('blob:https://example.com/uuid', 'src')).toBe(false);
    });

    // Every pattern here is anchored, and nothing else re-checks that. Unanchored,
    // the scheme name matches anywhere in the URL, so an ordinary link whose path
    // or query merely mentions one is declared unsafe and stripped — the sanitizer
    // destroying valid content rather than letting anything through.
    it('reads the scheme at the start only, not anywhere in the URL', () => {
      expect(hasUnsafeUrlProtocol('https://example.com/docs/javascript:guide', 'href')).toBe(false);
      expect(hasUnsafeUrlProtocol('https://example.com/?q=vbscript:x', 'href')).toBe(false);
      expect(hasUnsafeUrlProtocol('https://example.com/api/data:export', 'href')).toBe(false);
      expect(hasUnsafeUrlProtocol('https://example.com/img/data:cache.png', 'src')).toBe(false);
      expect(hasUnsafeUrlProtocol('https://example.com/files/blob:id', 'href')).toBe(false);
    });

    it('allows regular and unknown-custom schemes', () => {
      expect(hasUnsafeUrlProtocol('https://example.com', 'href')).toBe(false);
      expect(hasUnsafeUrlProtocol('http://example.com/a.png', 'src')).toBe(false);
      expect(hasUnsafeUrlProtocol('/relative/path', 'href')).toBe(false);
      expect(hasUnsafeUrlProtocol('#anchor', 'href')).toBe(false);
      expect(hasUnsafeUrlProtocol('mailto:x@y.z', 'href')).toBe(false);
      expect(hasUnsafeUrlProtocol('slack://open', 'href')).toBe(false);
      expect(hasUnsafeUrlProtocol('ftp://host/file', 'href')).toBe(false);
    });
  });
});
