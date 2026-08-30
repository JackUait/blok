import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { clean, sanitizeBlocks, stripUnsafeUrls } from '../../../../../src/components/utils/sanitizer';

/**
 * html-janitor allowlists the `href` ATTRIBUTE and never inspects its value, so
 * an allowlisted `<a href>` used to survive `clean()` carrying any scheme. The
 * scheme pass lives inside `clean()` itself: every caller — paste, table cells,
 * the public `api.sanitizer.clean` — gets it without having to remember.
 */
describe('clean() refuses executable URL schemes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops a javascript: href while keeping the link text', () => {
    const cleaned = clean('<a href="javascript:alert(1)">x</a>', { a: { href: true } });

    expect(cleaned).not.toContain('javascript:');
    expect(cleaned).toContain('x');
  });

  it('drops a scheme smuggled past a prefix check with a tab entity', () => {
    const cleaned = clean('<a href="java&#9;script:alert(1)">x</a>', { a: { href: true } });

    expect(cleaned).not.toContain('script:');
  });

  it('drops a data:text/html src', () => {
    const cleaned = clean('<img src="data:text/html,<script>alert(1)</script>">', { img: { src: true } });

    expect(cleaned).not.toContain('data:text/html');
  });

  it('keeps an ordinary http(s) href untouched', () => {
    const cleaned = clean('<a href="https://example.com">x</a>', { a: { href: true } });

    expect(cleaned).toContain('https://example.com');
  });

  it('returns input byte-identical when nothing needs stripping', () => {
    const input = '<p>plain &amp; ordinary</p>';

    expect(clean(input, { p: true })).toBe(input);
  });
});

/**
 * `sanitizeBlocks` short-circuits when a tool declares no sanitize config. That
 * skipped the scheme pass too, so forged `application/x-blok` clipboard JSON
 * reached a tool's render sink with a live `javascript:` anchor.
 */
describe('sanitizeBlocks hardens URLs even with no tool rules', () => {
  it('strips an unsafe href when the tool declares no sanitize config', () => {
    const [block] = sanitizeBlocks(
      [{ tool: 'custom', data: { text: '<a href="javascript:alert(1)">x</a>' } }],
      {}
    );

    expect(block.data.text).not.toContain('javascript:');
  });

  it('leaves a safe href alone', () => {
    const [block] = sanitizeBlocks(
      [{ tool: 'custom', data: { text: '<a href="https://example.com">x</a>' } }],
      {}
    );

    expect(block.data.text).toContain('https://example.com');
  });
});

describe('stripUnsafeUrls stays usable on its own', () => {
  it('removes a javascript: href from already-cleaned markup', () => {
    expect(stripUnsafeUrls('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
  });
});
