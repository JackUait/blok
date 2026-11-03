import { matchesHostPattern } from '../host-pattern';

/**
 * Host-declared trust list for generic embeds (`linkPaste.allowedEmbedOrigins`).
 *
 * Entries are hostnames (`dashboards.dodois.com`) or wildcard subdomain
 * patterns (`*.internal.dodo.dev`). A wildcard matches any subdomain depth but
 * never the bare suffix itself, and matching is done on the hostname parsed by
 * `new URL` — never on the raw string — so `evilfoo.com` can't satisfy
 * `*.foo.com` and a listed hostname buried in a path or query can't match.
 * An entry may be an https origin (`https://a.com:8443`); see
 * {@link matchesHostPattern} for what such an entry allows.
 */
export function isAllowedEmbedOrigin(url: string, patterns: readonly string[] | undefined): boolean {
  if (patterns === undefined || patterns.length === 0) {
    return false;
  }

  const parsed = ((): URL | null => {
    try {
      const candidate = new URL(url);

      return candidate.protocol === 'https:' ? candidate : null;
    } catch {
      return null;
    }
  })();

  if (parsed === null) {
    return false;
  }

  return matchesHostPattern(parsed.hostname, patterns, parsed.port);
}
