import { describe, expect, it } from 'vitest';

import {
  KNOWN_PACKAGES,
  compareSemverDesc,
  mergeVersionCatalog,
  cdnPrefixFor,
  formatAgo,
  shouldRefreshCatalog,
} from '../../../override-extension/lib/versions.mjs';

describe('version catalog', () => {
  it('knows both published package names, current scope first', () => {
    expect(KNOWN_PACKAGES).toEqual(['@bloklabs/core', '@jackuait/blok']);
  });

  it('sorts newest-first across major/minor/patch', () => {
    const sorted = ['1.2.0', '1.10.0', '0.25.0', '1.2.6'].sort(compareSemverDesc);
    expect(sorted).toEqual(['1.10.0', '1.2.6', '1.2.0', '0.25.0']);
  });

  it('ranks a release above its own prereleases and orders prerelease numbers numerically', () => {
    const sorted = ['0.2.1-beta.0', '0.2.1', '0.2.1-beta.10', '0.2.1-beta.2'].sort(compareSemverDesc);
    expect(sorted).toEqual(['0.2.1', '0.2.1-beta.10', '0.2.1-beta.2', '0.2.1-beta.0']);
  });

  it('merges both packages newest-first, keeping the owning package per version', () => {
    const merged = mergeVersionCatalog({
      '@bloklabs/core': ['1.1.1', '1.10.1'],
      '@jackuait/blok': ['0.25.0', '1.1.0'],
    });
    expect(merged).toEqual([
      { pkg: '@bloklabs/core', version: '1.10.1' },
      { pkg: '@bloklabs/core', version: '1.1.1' },
      { pkg: '@jackuait/blok', version: '1.1.0' },
      { pkg: '@jackuait/blok', version: '0.25.0' },
    ]);
  });

  it('builds a jsdelivr dist prefix for a package version', () => {
    expect(cdnPrefixFor('@bloklabs/core', '1.8.0')).toBe('https://cdn.jsdelivr.net/npm/@bloklabs/core@1.8.0/dist/');
  });

  it('formats relative build age', () => {
    const now = Date.parse('2026-08-20T12:00:00Z');
    expect(formatAgo('2026-08-20T11:59:40Z', now)).toBe('just now');
    expect(formatAgo('2026-08-20T11:15:00Z', now)).toBe('45m ago');
    expect(formatAgo('2026-08-20T04:00:00Z', now)).toBe('8h ago');
    expect(formatAgo('2026-08-14T12:00:00Z', now)).toBe('6d ago');
    expect(formatAgo('not-a-date', now)).toBe('');
  });

  it('refreshes the catalog only after the TTL or when there is no cache', () => {
    const now = Date.parse('2026-08-20T12:00:00Z');
    const ttl = 6 * 3600 * 1000;
    expect(shouldRefreshCatalog(null, now, ttl)).toBe(true);
    expect(shouldRefreshCatalog({ fetchedAt: now - ttl - 1, byPackage: {} }, now, ttl)).toBe(true);
    expect(shouldRefreshCatalog({ fetchedAt: now - 1000, byPackage: {} }, now, ttl)).toBe(false);
  });
});
