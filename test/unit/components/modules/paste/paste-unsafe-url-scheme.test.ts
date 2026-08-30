import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { readFileSync } from 'fs';
import { resolve } from 'path';

import { clean, stripUnsafeUrls } from '../../../../../src/components/utils/sanitizer';

/**
 * The paste path runs `clean()` directly, and html-janitor only allowlists the
 * `href` ATTRIBUTE — it never inspects the scheme. Without a scheme pass a
 * pasted `javascript:` link becomes a live, clickable anchor in the document.
 */
describe('pasted anchors must not keep an unsafe URL scheme', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clean() alone keeps a javascript: href', () => {
    const cleaned = clean('<a href="javascript:alert(1)">x</a>', { a: { href: true } });

    expect(cleaned).toContain('javascript:');
  });

  it('stripUnsafeUrls removes a javascript: href while keeping the link text', () => {
    const safe = stripUnsafeUrls(clean('<a href="javascript:alert(1)">x</a>', { a: { href: true } }));

    expect(safe).not.toContain('javascript:');
    expect(safe).toContain('x');
  });

  it('keeps an ordinary http(s) href untouched', () => {
    const safe = stripUnsafeUrls(clean('<a href="https://example.com">x</a>', { a: { href: true } }));

    expect(safe).toContain('https://example.com');
  });

  it('the paste module runs the scheme pass over its clean() output', () => {
    const source = readFileSync(
      resolve(__dirname, '../../../../../src/components/modules/paste/index.ts'),
      'utf-8'
    );

    // clean() in the paste path must never be used bare — html-janitor keeps
    // whatever scheme the href carried.
    expect(source).toContain('stripUnsafeUrls(clean(');
  });
});
