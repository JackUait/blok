import { describe, expect, it } from 'vitest';

import { parseCdnBlokUrl, summarizeDetection } from '../../../override-extension/lib/detect.mjs';

describe('CDN blok URL parsing', () => {
  it('parses a jsdelivr dist URL into package, version and routable prefix', () => {
    expect(parseCdnBlokUrl('https://cdn.jsdelivr.net/npm/@bloklabs/core@1.8.0/dist/blok.umd.js')).toEqual({
      pkg: '@bloklabs/core',
      version: '1.8.0',
      prefix: 'https://cdn.jsdelivr.net/npm/@bloklabs/core@1.8.0/dist/',
    });
  });

  it('parses unpkg and prerelease versions for the legacy scope', () => {
    expect(parseCdnBlokUrl('https://unpkg.com/@jackuait/blok@0.2.1-beta.10/dist/blok.mjs')).toEqual({
      pkg: '@jackuait/blok',
      version: '0.2.1-beta.10',
      prefix: 'https://unpkg.com/@jackuait/blok@0.2.1-beta.10/dist/',
    });
  });

  it('keeps nested dist paths inside the prefix up to /dist/ only', () => {
    expect(parseCdnBlokUrl('https://cdn.jsdelivr.net/npm/@bloklabs/core@1.9.0/dist/chunks/en-abc.mjs')).toEqual({
      pkg: '@bloklabs/core',
      version: '1.9.0',
      prefix: 'https://cdn.jsdelivr.net/npm/@bloklabs/core@1.9.0/dist/',
    });
  });

  it('rejects other packages and non-dist blok URLs', () => {
    expect(parseCdnBlokUrl('https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js')).toBeNull();
    expect(parseCdnBlokUrl('https://esm.sh/@jackuait/blok@1.1.0')).toBeNull();
    expect(parseCdnBlokUrl('not a url')).toBeNull();
  });
});

describe('page detection summary', () => {
  it('reports no-tab when the tab could not be inspected', () => {
    expect(summarizeDetection(null)).toEqual({ state: 'no-tab' });
  });

  it('reports no-blok when neither editor markers nor CDN scripts exist', () => {
    expect(summarizeDetection({ origin: 'https://a.example', hasEditor: false, version: null, urls: ['https://a.example/app.js'] }))
      .toEqual({ state: 'no-blok', origin: 'https://a.example' });
  });

  it('reports a bundled editor with its stamped version', () => {
    expect(summarizeDetection({ origin: 'https://kb.example', hasEditor: true, version: '1.10.1', urls: [] })).toEqual({
      state: 'detected',
      origin: 'https://kb.example',
      bundled: { present: true, version: '1.10.1' },
      cdn: [],
    });
  });

  it('collects CDN references deduped by prefix even without an editor in the DOM', () => {
    const summary = summarizeDetection({
      origin: 'https://cdn-page.example',
      hasEditor: false,
      version: null,
      urls: [
        'https://cdn.jsdelivr.net/npm/@bloklabs/core@1.8.0/dist/blok.umd.js',
        'https://cdn.jsdelivr.net/npm/@bloklabs/core@1.8.0/dist/chunks/en-abc.mjs',
        'https://cdn-page.example/app.js',
      ],
    });
    expect(summary).toEqual({
      state: 'detected',
      origin: 'https://cdn-page.example',
      bundled: { present: false, version: null },
      cdn: [{ pkg: '@bloklabs/core', version: '1.8.0', prefix: 'https://cdn.jsdelivr.net/npm/@bloklabs/core@1.8.0/dist/' }],
    });
  });
});
