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

// Browsers connect https://[::ffff:a.b.c.d]/ to the IPv4 server a.b.c.d,
// and new URL spells it [::ffff:XXXX:YYYY].
describe('an IPv4 address written as an IPv4-mapped IPv6 URL', () => {
  const mappedForms = [
    'https://[::ffff:10.0.0.1]/admin',
    'https://[::ffff:a00:1]/admin',
    'https://[0:0:0:0:0:ffff:10.0.0.1]/admin',
  ];

  it.each(mappedForms)('is not framed when blockedEmbedOrigins lists the IPv4 address: %s', (url) => {
    expect(canFrameGeneric(url, policy({ blockedOrigins: ['10.0.0.1'] }))).toBe(false);
  });

  it.each(mappedForms)('is not framed when hostAliases lists the IPv4 address: %s', (url) => {
    expect(canFrameGeneric(url, policy({ ownHosts: ['10.0.0.1'] }))).toBe(false);
  });

  it.each([
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:7f00:1]/',
  ])('is not framed on a page served from that IPv4 address: %s', (url) => {
    expect(canFrameGeneric(url, policy({ ownHosts: ['127.0.0.1'] }))).toBe(false);
  });

  it.each(mappedForms)('is framed when allowedEmbedOrigins lists the IPv4 address: %s', (url) => {
    expect(canFrameGeneric(url, policy({ allowGeneric: false, allowedOrigins: ['10.0.0.1'] }))).toBe(true);
  });

  it('matches an entry written in the mapped form against the plain IPv4 URL', () => {
    expect(canFrameGeneric('https://10.0.0.1/', policy({ blockedOrigins: ['::ffff:10.0.0.1'] }))).toBe(false);
    expect(canFrameGeneric('https://10.0.0.1/', policy({ ownHosts: ['[::ffff:a00:1]'] }))).toBe(false);
  });

  it('leaves other IPv4 addresses and plain IPv6 addresses alone', () => {
    expect(canFrameGeneric('https://[::ffff:10.0.0.2]/', policy({ blockedOrigins: ['10.0.0.1'] }))).toBe(true);
    expect(canFrameGeneric('https://[::a00:1]/', policy({ blockedOrigins: ['10.0.0.1'] }))).toBe(true);
    expect(canFrameGeneric('https://[2001:db8::1]/', policy({ blockedOrigins: ['10.0.0.1'] }))).toBe(true);
  });
});
