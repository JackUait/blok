import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstArchivePath, versionedSitemapUrls } from '../../../scripts/live-docs-versions.mjs';

const sitemap = (paths: string[]): string =>
  '<?xml version="1.0" encoding="UTF-8"?><urlset>'
  + paths.map((path) => `<url><loc>https://blokeditor.com${path}</loc><lastmod>2026-10-01</lastmod></url>`).join('')
  + '</urlset>';

describe('live docs version probes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('flags sitemap URLs under /next/ and /v/', () => {
    expect(versionedSitemapUrls(sitemap(['/', '/next/', '/next/docs/table/', '/v/1.12/docs/table/']))).toEqual([
      'https://blokeditor.com/next/',
      'https://blokeditor.com/next/docs/table/',
      'https://blokeditor.com/v/1.12/docs/table/',
    ]);
  });

  it('does not flag pages whose names only look versioned', () => {
    expect(versionedSitemapUrls(sitemap(['/', '/docs/video/', '/docs/next-steps/', '/ru/docs/v/', '/v1/']))).toEqual([]);
  });

  it('finds the first archived version in versions.json', () => {
    expect(firstArchivePath({
      latest: '1.15',
      versions: [
        { id: 'next', label: 'Next', path: '/next/' },
        { id: '1.15', label: '1.15', path: '/' },
        { id: '1.14', label: '1.14', path: '/v/1.14/' },
        { id: '1.13', label: '1.13', path: '/v/1.13/' },
      ],
    })).toBe('/v/1.14/');
  });

  it('returns null when no version is archived', () => {
    expect(firstArchivePath({ latest: '1.15', versions: [{ id: '1.15', label: '1.15', path: '/' }] })).toBeNull();
  });
});
