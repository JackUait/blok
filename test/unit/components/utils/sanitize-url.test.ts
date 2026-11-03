import { describe, it, expect } from 'vitest';
import { safeHref, safeImageSrc, hasUnsafeScheme, safeDownloadHref } from '../../../../src/components/utils/sanitize-url';

describe('safeHref', () => {
  it('keeps http(s) URLs', () => {
    expect(safeHref('https://example.com/x?a=1')).toBe('https://example.com/x?a=1');
    expect(safeHref('http://example.com')).toBe('http://example.com');
  });

  it('keeps mailto/tel/sms', () => {
    expect(safeHref('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(safeHref('tel:+123')).toBe('tel:+123');
    expect(safeHref('sms:+123')).toBe('sms:+123');
  });

  it('keeps relative, anchor and protocol-relative URLs (no scheme to abuse)', () => {
    expect(safeHref('/path')).toBe('/path');
    expect(safeHref('#section')).toBe('#section');
    expect(safeHref('//cdn.example.com/x')).toBe('//cdn.example.com/x');
    expect(safeHref('example.com/page')).toBe('example.com/page');
  });

  it('rejects javascript:', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('JaVaScRiPt:alert(1)')).toBeNull();
  });

  it('rejects vbscript: and file:', () => {
    expect(safeHref('vbscript:msgbox(1)')).toBeNull();
    expect(safeHref('file:///etc/passwd')).toBeNull();
  });

  it('rejects ALL data: schemes (you do not navigate to data: legitimately; svg executes)', () => {
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHref('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBeNull();
    expect(safeHref('data:image/png;base64,iVBORw0KGgo=')).toBeNull();
  });

  it('rejects schemes smuggled with embedded control/whitespace chars', () => {
    // mdast decodes &NewLine; to a literal newline before this runs; the browser
    // strips it from the href, reconstituting javascript: and executing it.
    expect(safeHref('java\nscript:alert(1)')).toBeNull();
    expect(safeHref('java\tscript:alert(1)')).toBeNull();
    expect(safeHref('  javascript:alert(1)')).toBeNull();
    expect(safeHref('java\u0000script:alert(1)')).toBeNull();
    expect(safeHref('\u0001javascript:alert(1)')).toBeNull();
  });
});

describe('safeImageSrc', () => {
  it('keeps http(s) image URLs', () => {
    expect(safeImageSrc('https://img.com/a.png')).toBe('https://img.com/a.png');
  });

  it('keeps relative image URLs', () => {
    expect(safeImageSrc('/img/a.png')).toBe('/img/a.png');
    expect(safeImageSrc('a.png')).toBe('a.png');
  });

  it('keeps raster data: images', () => {
    expect(safeImageSrc('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(safeImageSrc('data:image/jpeg;base64,/9j/4AAQ=')).toBe('data:image/jpeg;base64,/9j/4AAQ=');
    expect(safeImageSrc('data:image/gif;base64,R0lGOD=')).toBe('data:image/gif;base64,R0lGOD=');
    expect(safeImageSrc('data:image/webp;base64,UklGR=')).toBe('data:image/webp;base64,UklGR=');
  });

  // An <img> runs no SVG script. Every navigable sink still refuses it (see the URL sink law).
  it('keeps a data:image/svg+xml image, which <img> draws without running its script', () => {
    expect(safeImageSrc('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=');
    expect(safeImageSrc('DATA:IMAGE/SVG+XML,%3Csvg%2F%3E')).toBe('DATA:IMAGE/SVG+XML,%3Csvg%2F%3E');
    expect(safeImageSrc('data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E')).toBe('data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E');
  });

  it('rejects other script-capable data: types and look-alikes of svg+xml', () => {
    expect(safeImageSrc('data:image/svg+xmlfoo,<x/>')).toBeNull();
    expect(safeImageSrc('data:image/svg,<svg/>')).toBeNull();
    expect(safeImageSrc('data:image/foo+xml,<x/>')).toBeNull();
    expect(safeImageSrc('data:text/xml,<x/>')).toBeNull();
    expect(safeImageSrc('data:application/xhtml+xml,<x/>')).toBeNull();
    expect(safeImageSrc('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects javascript: and smuggled schemes', () => {
    expect(safeImageSrc('javascript:alert(1)')).toBeNull();
    expect(safeImageSrc('java\nscript:alert(1)')).toBeNull();
  });
});

describe('hasUnsafeScheme', () => {
  it('is false for safe schemes and scheme-less input', () => {
    expect(hasUnsafeScheme('https://x.com')).toBe(false);
    expect(hasUnsafeScheme('mailto:a@b.com')).toBe(false);
    expect(hasUnsafeScheme('google.com')).toBe(false);
    expect(hasUnsafeScheme('/path')).toBe(false);
    expect(hasUnsafeScheme('#a')).toBe(false);
    expect(hasUnsafeScheme('//host')).toBe(false);
  });

  it('is true for script/data/file schemes including smuggled variants', () => {
    expect(hasUnsafeScheme('javascript:alert(1)')).toBe(true);
    expect(hasUnsafeScheme('JAVASCRIPT:alert(1)')).toBe(true);
    expect(hasUnsafeScheme('data:image/svg+xml;base64,PHN2Zz4=')).toBe(true);
    expect(hasUnsafeScheme('vbscript:x')).toBe(true);
    expect(hasUnsafeScheme('java\nscript:alert(1)')).toBe(true);
    expect(hasUnsafeScheme('\u0001javascript:alert(1)')).toBe(true);
  });
});

// The scheme regex is anchored. Unanchored, a colon anywhere in a relative path
// reads as a scheme, and the allowlist then refuses an ordinary internal link.
describe('safeHref anchoring', () => {
  it('keeps a relative URL whose path contains a colon', () => {
    expect(safeHref('/docs/ratio/16:9')).toBe('/docs/ratio/16:9');
    expect(safeHref('notes/meeting:2026')).toBe('notes/meeting:2026');
  });
});

describe('safeImageSrc scheme matching', () => {
  // The `?` in /^https?:/ is what admits plain http.
  it('keeps a plain http image', () => {
    expect(safeImageSrc('http://example.com/a.png')).toBe('http://example.com/a.png');
  });

  // Unanchored, the same test passes for any URL that merely CONTAINS "https:",
  // which hands an attacker a one-string bypass of the whole allowlist.
  it('rejects a script URL that carries https: further along', () => {
    expect(safeImageSrc('javascript:alert(1)/*https://example.com*/')).toBeNull();
    expect(safeImageSrc('javascript:location="http://evil.example"')).toBeNull();
  });
});

// Stored block data is untrusted: a persisted javascript: URL on a download
// anchor runs in the host origin with the victim's session, which is how this
// shipped as stored XSS. The module's own test never called this function.
describe('safeDownloadHref', () => {
  it('refuses an empty or whitespace-only URL', () => {
    expect(safeDownloadHref('')).toBeNull();
    expect(safeDownloadHref('   ')).toBeNull();
  });

  it('keeps http, https and blob URLs', () => {
    expect(safeDownloadHref('https://example.com/a.mp3')).toBe('https://example.com/a.mp3');
    expect(safeDownloadHref('http://example.com/a.mp3')).toBe('http://example.com/a.mp3');
    expect(safeDownloadHref('blob:http://localhost/abc-123')).toBe('blob:http://localhost/abc-123');
  });

  // Resolution against the document base is what makes a stored relative URL
  // usable at all; without it every one of them lands in the catch as invalid.
  it('resolves a relative URL against the document base', () => {
    expect(safeDownloadHref('/media/a.mp3')).toBe(new URL('/media/a.mp3', document.baseURI).href);
  });

  it('keeps an inert raster data: image', () => {
    const gif = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

    expect(safeDownloadHref(gif)).toBe(gif);
  });

  it('refuses data: payloads that can execute script', () => {
    expect(safeDownloadHref('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeDownloadHref('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
  });

  it('refuses script-capable and local-file schemes', () => {
    expect(safeDownloadHref('javascript:alert(1)')).toBeNull();
    expect(safeDownloadHref('vbscript:x')).toBeNull();
    expect(safeDownloadHref('file:///etc/passwd')).toBeNull();
  });

  it('refuses a URL the parser cannot read', () => {
    expect(safeDownloadHref('http://[')).toBeNull();
  });
});
