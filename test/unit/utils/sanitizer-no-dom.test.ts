// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clean, stripUnsafeUrls, stripUnsafeUrlsDeep } from '../../../src/components/utils/sanitizer';

/**
 * The editor sanitizer needs a DOM, like `clean()`. Without one it must throw,
 * never return markup it did not check. Headless code uses
 * `stripUnsafeUrlsFragment` from src/view/sanitize.ts.
 */
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('editor sanitizer without a DOM', () => {
  it('has no document here', () => {
    expect(typeof document).toBe('undefined');
  });

  it('throws on markup, as clean() does', () => {
    expect(() => clean('<b>x</b>', { b: true })).toThrow(ReferenceError);
    expect(() => stripUnsafeUrls('<a href="javascript:alert(1)">x</a>')).toThrow(ReferenceError);
    expect(() => stripUnsafeUrlsDeep({ text: `<a href${'\t'.repeat(50_000)}` })).toThrow(ReferenceError);
  });

  it('still returns text without markup as is', () => {
    expect(stripUnsafeUrls('plain text')).toBe('plain text');
  });
});
