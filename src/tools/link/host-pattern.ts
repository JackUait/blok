/**
 * Whether `hostname` matches one of `patterns`: an exact hostname
 * (`dashboards.example.com`) or a wildcard (`*.example.dev`). A wildcard
 * matches any subdomain depth but never the bare suffix. Pass the hostname
 * parsed by `new URL`, never the raw string, so a listed name in a path or
 * query can't match.
 */
export function matchesHostPattern(hostname: string, patterns: readonly string[]): boolean {
  const host = hostname.toLowerCase();

  return patterns.some((pattern) => {
    const normalized = pattern.toLowerCase();

    if (normalized.startsWith('*.')) {
      return host.endsWith(normalized.slice(1));
    }

    return host === normalized;
  });
}

const bareHost = (name: string): string => name.toLowerCase().replace(/\.$/, '').replace(/^\*\./, '');

/**
 * Whether `hostname` is one of `ownHosts`, a subdomain of one, or a parent
 * domain of one. Matching is on dot boundaries only. Sibling subdomains
 * (`cdn.example.com` for `app.example.com`) are NOT caught: that needs the
 * public suffix list.
 */
export function isSameSiteHost(hostname: string, ownHosts: readonly string[]): boolean {
  const host = bareHost(hostname);

  if (host === '') {
    return false;
  }

  return ownHosts.some((entry) => {
    const own = bareHost(entry);

    return own !== '' && (host === own || host.endsWith(`.${own}`) || own.endsWith(`.${host}`));
  });
}

/** The page's hostname plus the host's `linkPaste.hostAliases`. */
export function pageHosts(aliases: readonly string[] = []): string[] {
  // Empty under file:// and about:blank; it must not count as a host.
  const current = typeof window === 'undefined' ? '' : window.location.hostname;

  return current === '' ? [...aliases] : [current, ...aliases];
}
