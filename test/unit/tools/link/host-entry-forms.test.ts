import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canFrameGeneric, type GenericEmbedPolicy } from '../../../../src/tools/link/generic-embed-policy';
import { isOwnHostLink } from '../../../../src/tools/link/paste-menu/options';

const policy = (overrides: Partial<GenericEmbedPolicy>): GenericEmbedPolicy => ({
  allowGeneric: false,
  allowedOrigins: [],
  blockedOrigins: [],
  ownHosts: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('blockedEmbedOrigins — an origin or host in any common form blocks', () => {
  it.each([
    ['evil.com', 'https://evil.com/'],
    ['https://evil.com', 'https://evil.com/'],
    ['https://evil.com/', 'https://evil.com/'],
    ['https://*.evil.com', 'https://a.evil.com/'],
    ['https://evil.com:8443', 'https://evil.com/'],
    ['http://evil.com', 'https://evil.com/'],
    ['https://evil.com/some/path', 'https://evil.com/'],
    ['user@evil.com', 'https://evil.com/'],
    ['  EVIL.com.  ', 'https://evil.com/'],
    ['::1', 'https://[::1]/'],
    ['[::1]:443', 'https://[::1]/'],
    ['bücher.de', 'https://xn--bcher-kva.de/'],
  ])('%s blocks %s', (entry, url) => {
    expect(canFrameGeneric(url, policy({ allowGeneric: true, blockedOrigins: [entry] }))).toBe(false);
  });

  it('still frames hosts the entry does not name', () => {
    expect(canFrameGeneric('https://good.com/', policy({ allowGeneric: true, blockedOrigins: ['https://evil.com'] }))).toBe(true);
    expect(canFrameGeneric('https://evil.com/', policy({ allowGeneric: true, blockedOrigins: ['https://*.evil.com'] }))).toBe(true);
  });
});

describe('hostAliases — an alias in any common form counts as the own site', () => {
  it.each([
    ['bücher.de', 'https://xn--bcher-kva.de/'],
    ['app.example.com:8443', 'https://app.example.com/'],
    ['https://app.example.com', 'https://app.example.com/'],
    ['https://app.example.com:8443/', 'https://app.example.com/'],
    [' app.example.com ', 'https://app.example.com/'],
    ['APP.example.com.', 'https://app.example.com/'],
    ['::1', 'https://[::1]/'],
  ])('%s keeps %s from being framed', (alias, url) => {
    expect(canFrameGeneric(url, policy({ allowGeneric: true, ownHosts: [alias] }))).toBe(false);
  });

  it('treats a link to an alias written as an origin as an own-site link', () => {
    expect(isOwnHostLink('https://app.example.com/x', ['https://app.example.com:8443'])).toBe(true);
    expect(isOwnHostLink('https://xn--bcher-kva.de/', ['bücher.de'])).toBe(true);
  });
});

describe('allowedEmbedOrigins — an origin form allows only what it names', () => {
  it.each([
    ['https://good.com', 'https://good.com/x'],
    ['https://good.com/', 'https://good.com/x'],
    ['https://*.good.com', 'https://a.good.com/'],
    ['GOOD.com.', 'https://good.com/'],
    ['bücher.de', 'https://xn--bcher-kva.de/'],
    ['https://good.com:8443', 'https://good.com:8443/'],
    ['::1', 'https://[::1]/'],
  ])('%s allows %s', (entry, url) => {
    expect(canFrameGeneric(url, policy({ allowedOrigins: [entry] }))).toBe(true);
  });

  it.each([
    ['https://*.good.com', 'https://good.com/'],
    ['https://good.com:8443', 'https://good.com/'],
    ['http://good.com', 'https://good.com/'],
    ['https://good.com/embed', 'https://good.com/embed'],
    ['user@good.com', 'https://good.com/'],
    ['evil.com@good.com', 'https://good.com/'],
    ['good .com', 'https://good.com/'],
    ['*', 'https://good.com/'],
    ['*.', 'https://good.com/'],
    ['https://', 'https://good.com/'],
  ])('%s does not allow %s', (entry, url) => {
    expect(canFrameGeneric(url, policy({ allowedOrigins: [entry] }))).toBe(false);
  });
});
