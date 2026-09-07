import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');

const section = (start: string, end: string): string => {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);

  if (from < 0 || to < 0) {
    throw new Error(`Missing playground section: ${start}`);
  }

  return html.slice(from, to);
};

const configFor = (search = '', backend = true): unknown => {
  return structuredClone(runInNewContext(`${section('const DEV_SERVER_URL =', 'function buildConfig(')} collaborationConfig();`, {
    window: { location: { search } },
    URLSearchParams,
    sessionStorage: window.sessionStorage,
    __BLOK_DEV_BACKEND__: backend,
  }));
};

describe('playground anonymous presence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('omits user identity when no name is supplied', () => {
    expect(configFor()).toStrictEqual({ doc: 'playground' });
  });

  it('does not use a stale generated name from session storage', () => {
    window.sessionStorage.setItem('blok-playground-presence-name', 'Ann');

    expect(configFor()).toStrictEqual({ doc: 'playground' });
  });

  it.each(['?name=', '?name=%20%09%20'])('keeps blank names anonymous for %s', (search) => {
    expect(configFor(search)).toStrictEqual({ doc: 'playground' });
  });

  it.each([
    ['?name=Alice', 'Alice'],
    ['?name=%20Alice%20', ' Alice '],
  ])('preserves the explicit name for %s', (search, name) => {
    expect(configFor(search)).toStrictEqual({ doc: 'playground', user: { name } });
  });

  it('preserves a custom document without supplying an identity', () => {
    expect(configFor('?collab=custom-doc')).toStrictEqual({ doc: 'custom-doc' });
  });

  it('preserves a custom document with an explicit name', () => {
    expect(configFor('?collab=custom-doc&name=Alice')).toStrictEqual({
      doc: 'custom-doc',
      user: { name: 'Alice' },
    });
  });

  it.each(['?collab=off', '?collab=off&name=Alice'])('stays local when collaboration is off for %s', (search) => {
    expect(configFor(search)).toBeNull();
  });

  it.each(['', '?collab=custom-doc&name=Alice'])('stays local without the backend for %s', (search) => {
    expect(configFor(search, false)).toBeNull();
  });
});
