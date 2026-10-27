// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import '../helpers/domShims';
import { isAllowedExternalUrl } from '../../../../../../src/tools/file/pptx/utils/urlSafety';

describe('isAllowedExternalUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows https URLs', () => {
    expect(isAllowedExternalUrl('https://example.com')).toBe(true);
  });

  it('allows http URLs', () => {
    expect(isAllowedExternalUrl('http://example.com')).toBe(true);
  });

  it('allows mailto URLs', () => {
    expect(isAllowedExternalUrl('mailto:user@example.com')).toBe(true);
  });

  it('rejects javascript: URLs', () => {
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects data: URLs', () => {
    expect(isAllowedExternalUrl('data:text/html,<h1>hi</h1>')).toBe(false);
  });

  it('rejects ftp: URLs', () => {
    expect(isAllowedExternalUrl('ftp://example.com')).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(isAllowedExternalUrl('not a url')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isAllowedExternalUrl('')).toBe(false);
  });

  it('rejects file: URLs', () => {
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false);
  });
});
