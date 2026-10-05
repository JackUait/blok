import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentVersionId, parseVersionsManifest, versionHref } from './versions';

const v114 = { id: '1.14', label: '1.14', path: '/v/1.14/' };
const root = { id: '1.15', label: '1.15', path: '/' };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('versionHref', () => {
  it('falls back to the target home in the same locale when the page does not exist there', () => {
    expect(versionHref(v114, '/ru/docs/audio', ['/', '/ru', '/docs/table', '/ru/docs/table'])).toBe('/v/1.14/ru/');
    expect(versionHref(v114, '/docs/audio', ['/', '/ru', '/docs/table'])).toBe('/v/1.14/');
  });

  it('keeps the page and the locale when the target has it', () => {
    expect(versionHref(v114, '/ru/docs/table', ['/', '/ru', '/ru/docs/table'])).toBe('/v/1.14/ru/docs/table/');
    expect(versionHref(root, '/docs/table', ['/', '/docs/table'])).toBe('/docs/table/');
  });

  it('assumes the page exists when the target page list is unknown', () => {
    expect(versionHref(v114, '/docs/table', null)).toBe('/v/1.14/docs/table/');
  });

  it('maps the home page to the target base', () => {
    expect(versionHref(v114, '/', ['/'])).toBe('/v/1.14/');
  });
});

describe('parseVersionsManifest', () => {
  it('accepts a well-formed manifest', () => {
    const json = { latest: '1.15', versions: [root, v114] };
    expect(parseVersionsManifest(json)).toEqual(json);
  });

  it('rejects anything malformed instead of throwing', () => {
    expect(parseVersionsManifest(null)).toBeNull();
    expect(parseVersionsManifest({ latest: '1.15' })).toBeNull();
    expect(parseVersionsManifest({ latest: '1.15', versions: [{ id: 1 }] })).toBeNull();
  });

  it.each(['//evil.com/', 'https://evil.com/', '/v/1.14'])('rejects an entry whose path is %s', (path) => {
    const json = { latest: '1.15', versions: [{ id: '1.15', label: '1.15', path }] };
    expect(parseVersionsManifest(json)).toBeNull();
  });
});

describe('currentVersionId', () => {
  it('reads the build-time version', () => {
    vi.stubEnv('VITE_DOCS_VERSION', '1.14');
    expect(currentVersionId()).toBe('1.14');
  });

  it('is next when the build does not say', () => {
    vi.stubEnv('VITE_DOCS_VERSION', '');
    expect(currentVersionId()).toBe('next');
  });
});
