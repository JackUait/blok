import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isSameSiteHost } from '../../../../src/tools/link/host-pattern';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isSameSiteHost', () => {
  it('matches the host itself, its subdomains and its parent domains', () => {
    expect(isSameSiteHost('app.example.com', ['app.example.com'])).toBe(true);
    expect(isSameSiteHost('api.app.example.com', ['app.example.com'])).toBe(true);
    expect(isSameSiteHost('example.com', ['app.example.com'])).toBe(true);
  });

  it('only matches on a dot boundary', () => {
    expect(isSameSiteHost('evilexample.com', ['example.com'])).toBe(false);
    expect(isSameSiteHost('example.com.evil.net', ['example.com'])).toBe(false);
    expect(isSameSiteHost('pp.example.com', ['app.example.com'])).toBe(false);
  });

  it('ignores case, a trailing dot and a wildcard prefix', () => {
    expect(isSameSiteHost('APP.Example.COM.', ['app.example.com'])).toBe(true);
    expect(isSameSiteHost('docs.example.dev', ['*.example.dev'])).toBe(true);
    expect(isSameSiteHost('example.dev', ['*.example.dev'])).toBe(true);
  });

  it('matches nothing for an empty host or list', () => {
    expect(isSameSiteHost('', ['example.com'])).toBe(false);
    expect(isSameSiteHost('example.com', [])).toBe(false);
    expect(isSameSiteHost('example.com', [''])).toBe(false);
  });
});
