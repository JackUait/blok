import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canFrameGeneric, type GenericEmbedPolicy } from '../../../../src/tools/link/generic-embed-policy';

const policy = (over: Partial<GenericEmbedPolicy>): GenericEmbedPolicy => ({
  allowGeneric: true,
  allowedOrigins: [],
  blockedOrigins: [],
  ownHosts: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Pins TODAY's behaviour of cases that are by design or residual, so the
// report's verdicts are backed by a run. Not a wish list.
describe('current behaviour: residual and by-design cases', () => {
  it.each(['*', 'evil .com', '*.evil.com'])('deny entry %j does not block https://evil.com/', (entry) => {
    expect(canFrameGeneric('https://evil.com/', policy({ blockedOrigins: [entry] }))).toBe(true);
  });

  it.each([
    ['localhost', 'https://127.0.0.1/'],
    ['localhost', 'https://[::1]/'],
    ['localhost', 'https://0.0.0.0/'],
    ['127.0.0.1', 'https://localhost/'],
    ['127.0.0.1', 'https://127.0.0.2/'],
    ['app.example.com', 'https://cdn.example.com/'],
  ])('own host %j does not refuse another name for the same machine or site, %s', (own, url) => {
    expect(canFrameGeneric(url, policy({ ownHosts: [own] }))).toBe(true);
  });

  it('a double trailing dot slips the own-site check, but no browser resolves it', () => {
    expect(canFrameGeneric('https://example.com../', policy({ ownHosts: ['example.com'] }))).toBe(true);
  });

  it('hostname matching cannot see DNS: a name that resolves to a blocked IP passes', () => {
    expect(canFrameGeneric('https://127.0.0.1.nip.io/', policy({ blockedOrigins: ['127.0.0.1'] }))).toBe(true);
  });

  it('an allow entry without a port allows every port of that host (documented)', () => {
    expect(canFrameGeneric('https://a.com:8443/', policy({ allowGeneric: false, allowedOrigins: ['a.com'] }))).toBe(true);
  });
});
