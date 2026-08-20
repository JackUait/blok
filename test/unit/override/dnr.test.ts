import { describe, expect, it } from 'vitest';

import { buildRedirectRules, resolveRedirectTargets, LOCAL_DIST_SENTINEL } from '../../../override-extension/lib/dnr.mjs';

describe('tier-2 redirect rules', () => {
  it('maps a prefix pair to a regex redirect preserving the path remainder', () => {
    const [rule] = buildRedirectRules([
      { from: 'https://cdn.jsdelivr.net/npm/@bloklabs/core@1.8.0/dist/', to: 'http://localhost:3000/dist/' },
    ]);
    expect(rule).toEqual({
      id: 1,
      priority: 1,
      action: { type: 'redirect', redirect: { regexSubstitution: 'http://localhost:3000/dist/\\1' } },
      condition: {
        regexFilter: '^https://cdn\\.jsdelivr\\.net/npm/@bloklabs/core@1\\.8\\.0/dist/(.*)',
        resourceTypes: ['script'],
      },
    });
  });

  it('assigns sequential stable ids', () => {
    const rules = buildRedirectRules([
      { from: 'https://a.example/x/', to: 'http://localhost:1/' },
      { from: 'https://b.example/y/', to: 'http://localhost:2/' },
    ]);
    expect(rules.map((r) => r.id)).toEqual([1, 2]);
  });

  it('normalizes trailing slashes so from/to always pair path-for-path', () => {
    const [rule] = buildRedirectRules([{ from: 'https://a.example/dist', to: 'http://localhost:1/dist' }]);
    expect(rule.condition.regexFilter).toBe('^https://a\\.example/dist/(.*)');
    expect(rule.action.redirect.regexSubstitution).toBe('http://localhost:1/dist/\\1');
  });
});

describe('local-dist sentinel resolution', () => {
  it('resolves the sentinel to the extension dist base and leaves absolute URLs alone', () => {
    const resolved = resolveRedirectTargets(
      [
        { from: 'https://cdn.jsdelivr.net/npm/@bloklabs/core@1.8.0/dist/', to: LOCAL_DIST_SENTINEL },
        { from: 'https://a.example/x/', to: 'http://localhost:3000/dist/' },
      ],
      'chrome-extension://abcdef/payload/dist/'
    );
    expect(resolved).toEqual([
      { from: 'https://cdn.jsdelivr.net/npm/@bloklabs/core@1.8.0/dist/', to: 'chrome-extension://abcdef/payload/dist/' },
      { from: 'https://a.example/x/', to: 'http://localhost:3000/dist/' },
    ]);
  });

  it('feeds buildRedirectRules a chrome-extension substitution end to end', () => {
    const resolved: { from: string, to: string }[] = resolveRedirectTargets(
      [{ from: 'http://localhost:4444/fake-cdn-ext/', to: LOCAL_DIST_SENTINEL }],
      'chrome-extension://abcdef/payload/dist/'
    );
    const [rule] = buildRedirectRules(resolved);
    expect(rule.action.redirect.regexSubstitution).toBe('chrome-extension://abcdef/payload/dist/\\1');
  });
});
