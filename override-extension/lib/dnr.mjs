const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const withSlash = (s) => (s.endsWith('/') ? s : `${s}/`);

/**
 * @param {{from: string, to: string}[]} redirects
 */
export function buildRedirectRules(redirects) {
  return redirects.map((r, index) => ({
    id: index + 1,
    priority: 1,
    action: { type: 'redirect', redirect: { regexSubstitution: `${withSlash(r.to)}\\1` } },
    condition: { regexFilter: `^${escapeRegex(withSlash(r.from))}(.*)`, resourceTypes: ['script'] },
  }));
}
