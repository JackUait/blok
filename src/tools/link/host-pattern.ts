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
