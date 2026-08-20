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

// Stored redirect targets must never bake in the extension origin — unpacked
// ids change when the repo moves. The SW resolves this sentinel with
// chrome.runtime.getURL at rule-sync time.
export const LOCAL_DIST_SENTINEL = '<local-dist>';

export function resolveRedirectTargets(redirects, distBaseUrl) {
  return redirects.map((r) => (r.to === LOCAL_DIST_SENTINEL ? { ...r, to: distBaseUrl } : r));
}
