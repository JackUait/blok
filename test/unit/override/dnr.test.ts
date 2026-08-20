import { describe, expect, it } from 'vitest';

import { buildRedirectRules } from '../../../override-extension/lib/dnr.mjs';

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
