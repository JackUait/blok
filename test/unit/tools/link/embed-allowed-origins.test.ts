import { describe, expect, it } from 'vitest';

import { isAllowedEmbedOrigin } from '../../../../src/tools/link/embed/allowed-origins';

describe('isAllowedEmbedOrigin', () => {
  it('matches an exact hostname entry', () => {
    expect(isAllowedEmbedOrigin('https://dashboards.dodois.com/widget/1', ['dashboards.dodois.com'])).toBe(true);
  });

  it('is case-insensitive on both the URL hostname and the pattern', () => {
    expect(isAllowedEmbedOrigin('https://Dashboards.DODOIS.com/x', ['dashboards.dodois.com'])).toBe(true);
    expect(isAllowedEmbedOrigin('https://dashboards.dodois.com/x', ['Dashboards.Dodois.COM'])).toBe(true);
  });

  it('matches wildcard entries at any subdomain depth', () => {
    expect(isAllowedEmbedOrigin('https://a.internal.dodo.dev/x', ['*.internal.dodo.dev'])).toBe(true);
    expect(isAllowedEmbedOrigin('https://a.b.internal.dodo.dev/x', ['*.internal.dodo.dev'])).toBe(true);
  });

  it('does NOT let a wildcard match the bare suffix domain itself', () => {
    expect(isAllowedEmbedOrigin('https://internal.dodo.dev/x', ['*.internal.dodo.dev'])).toBe(false);
  });

  it('does NOT let a wildcard match a lookalike suffix (evilfoo.com attack)', () => {
    expect(isAllowedEmbedOrigin('https://evilfoo.com/x', ['*.foo.com'])).toBe(false);
    expect(isAllowedEmbedOrigin('https://foo.com.evil.com/x', ['*.foo.com'])).toBe(false);
  });

  it('does NOT let an exact entry match sub- or superdomains', () => {
    expect(isAllowedEmbedOrigin('https://a.foo.com/x', ['foo.com'])).toBe(false);
    expect(isAllowedEmbedOrigin('https://foo.com/x', ['a.foo.com'])).toBe(false);
  });

  it('rejects non-https URLs even when the hostname is listed', () => {
    expect(isAllowedEmbedOrigin('http://foo.com/x', ['foo.com'])).toBe(false);
    // eslint-disable-next-line no-script-url -- asserting the guard against this exact scheme
    expect(isAllowedEmbedOrigin('javascript:alert(1)', ['foo.com'])).toBe(false);
  });

  it('rejects unparsable URLs', () => {
    expect(isAllowedEmbedOrigin('not a url', ['foo.com'])).toBe(false);
    expect(isAllowedEmbedOrigin('', ['foo.com'])).toBe(false);
  });

  it('returns false for undefined or empty pattern lists', () => {
    expect(isAllowedEmbedOrigin('https://foo.com/x', undefined)).toBe(false);
    expect(isAllowedEmbedOrigin('https://foo.com/x', [])).toBe(false);
  });

  it('matches on hostname only — port, path and query are ignored', () => {
    expect(isAllowedEmbedOrigin('https://foo.com:8443/deep/path?q=1#frag', ['foo.com'])).toBe(true);
  });
});
