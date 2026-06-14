import { describe, it, expect } from 'vitest';
import { safeHttpHref } from '../../../../src/tools/file/url';

describe('safeHttpHref', () => {
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ])('returns null for the non-http(s) scheme %s', (url) => {
    expect(safeHttpHref(url)).toBeNull();
  });

  it('returns the normalized href for http and https', () => {
    expect(safeHttpHref('http://cdn/doc.pdf')).toBe('http://cdn/doc.pdf');
    expect(safeHttpHref('https://cdn/doc.pdf')).toBe('https://cdn/doc.pdf');
  });
});
