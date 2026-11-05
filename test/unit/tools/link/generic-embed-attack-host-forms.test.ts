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

describe('own-site refusal survives host spellings', () => {
  it.each([
    'https://EXAMPLE.COM/',
    'https://example.com./',
    'https://ex%61mple.com/',
    'https://example。com/',
    'https://example．com/',
    'https://example｡com/',
    'https://ｅｘａｍｐｌｅ.com/',
    'https://ex\tample.com/',
    'https://evil.com@example.com/',
    'https://example.com\\@evil.com/',
    'https://example.com:8443/',
    'https://sub.example.com/',
    'https://com/',
  ])('page example.com refuses %s', (url) => {
    expect(canFrameGeneric(url, policy({ ownHosts: ['example.com'] }))).toBe(false);
  });

  it.each([
    ['bücher.de', 'https://xn--bcher-kva.de/'],
    ['bücher.de', 'https://BÜCHER.de/'],
    ['xn--bcher-kva.de', 'https://bücher.de/'],
    ['app.example.com', 'https://example.com/'],
    ['app.example.com', 'https://app.example.com./'],
    ['localhost', 'https://LOCALHOST./'],
    ['localhost', 'https://a.localhost/'],
    ['[::1]', 'https://[0:0:0:0:0:0:0:1]/'],
    ['127.0.0.1', 'https://2130706433/'],
    ['127.0.0.1', 'https://0x7f000001/'],
    ['127.0.0.1', 'https://0177.0.0.1/'],
    ['127.0.0.1', 'https://127.1/'],
    ['127.0.0.1', 'https://127.0.0.1./'],
    [' anything.com ', 'https://anything.com/'],
    ['https://anything.com:1/x', 'https://anything.com/'],
    ['user@anything.com', 'https://anything.com/'],
    ['ANYTHING.COM.', 'https://anything.com/'],
  ])('own host %j refuses %s', (own, url) => {
    expect(canFrameGeneric(url, policy({ ownHosts: [own] }))).toBe(false);
  });

  it('frames userinfo that names the own host but points elsewhere, at the real host', () => {
    expect(canFrameGeneric('https://example.com@evil.com/', policy({ ownHosts: ['example.com'] }))).toBe(true);
    expect(new URL('https://example.com@evil.com/').hostname).toBe('evil.com');
  });
});

describe('blockedEmbedOrigins survives host spellings', () => {
  it.each([
    'https://EVIL.COM./',
    'https://evil.com:8443/',
    'https://u:p@evil.com/',
    'https://evil。com/',
    'https://ev%69l.com/',
  ])('["evil.com"] refuses %s', (url) => {
    expect(canFrameGeneric(url, policy({ blockedOrigins: ['evil.com'] }))).toBe(false);
  });

  it.each([
    '*.com', ' evil.com ', 'https://evil.com/path', 'user@evil.com', 'evil.com:443', 'EVIL.COM.',
    'evil.com\n', 'http://evil.com', '//evil.com', 'evil.com/', 'https://evil.com\\x', 'evil。com',
  ])('entry %j refuses https://evil.com/', (entry) => {
    expect(canFrameGeneric('https://evil.com/', policy({ blockedOrigins: [entry] }))).toBe(false);
  });

  it.each(['https://2130706433/', 'https://127.1/'])('["127.0.0.1"] refuses %s', (url) => {
    expect(canFrameGeneric(url, policy({ blockedOrigins: ['127.0.0.1'] }))).toBe(false);
  });

  it.each([['::1'], ['[::1]']])('entry %j refuses https://[0::1]/', (entry) => {
    expect(canFrameGeneric('https://[0::1]/', policy({ blockedOrigins: [entry] }))).toBe(false);
  });
});

describe('allowedEmbedOrigins never widens past what it names', () => {
  it.each([
    [['a.com'], 'https://x.a.com/'],
    [['a.com'], 'https://evila.com/'],
    [['a.com'], 'https://a.com./'],
    [['*.a.com'], 'https://a.com/'],
    [['*'], 'https://any.com/'],
    [[''], 'https://any.com/'],
    [['*.'], 'https://any.com/'],
    [['https://any.com/path'], 'https://any.com/'],
    [['user@any.com'], 'https://any.com/'],
    [['http://any.com'], 'https://any.com/'],
  ])('%j does not allow %s', (allowed, url) => {
    expect(canFrameGeneric(url, policy({ allowGeneric: false, allowedOrigins: allowed }))).toBe(false);
  });
});

describe('only absolute https:// reaches the gate', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'blob:https://evil.com/uuid',
    'about:blank',
    'about:srcdoc',
    'filesystem:https://evil.com/temporary/x',
    'http://evil.com/',
    'https:/\\evil.com/',
    'https:\\\\evil.com/',
    'https:evil.com',
    '//evil.com/',
    '\u0001https://evil.com/',
    ' https://evil.com/',
    'ht\ttps://evil.com/',
    'https://evil.com:65536/',
    'https://[fe80::1%25eth0]/',
  ])('refuses %j', (url) => {
    expect(canFrameGeneric(url, policy({}))).toBe(false);
  });
});
