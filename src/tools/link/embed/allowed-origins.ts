/**
 * Host-declared trust list for generic embeds (`linkPaste.allowedEmbedOrigins`).
 *
 * Entries are hostnames (`dashboards.dodois.com`) or wildcard subdomain
 * patterns (`*.internal.dodo.dev`). A wildcard matches any subdomain depth but
 * never the bare suffix itself, and matching is done on the hostname parsed by
 * `new URL` — never on the raw string — so `evilfoo.com` can't satisfy
 * `*.foo.com` and a listed hostname buried in a path or query can't match.
 */
export function isAllowedEmbedOrigin(url: string, patterns: readonly string[] | undefined): boolean {
  if (patterns === undefined || patterns.length === 0) {
    return false;
  }

  const hostname = ((): string | null => {
    try {
      const parsed = new URL(url);

      return parsed.protocol === 'https:' ? parsed.hostname.toLowerCase() : null;
    } catch {
      return null;
    }
  })();

  if (hostname === null) {
    return false;
  }

  return patterns.some((pattern) => {
    const normalized = pattern.toLowerCase();

    if (normalized.startsWith('*.')) {
      return hostname.endsWith(normalized.slice(1));
    }

    return hostname === normalized;
  });
}
