/**
 * Match a file's MIME type against a list of patterns. Patterns may be exact
 * MIME types (`image/png`), family wildcards (`image/*`), or the universal
 * wildcard (a bare `*`, or `*` followed by `/*`). Matching is case-insensitive.
 *
 * Used by the media tools to gate uploads/paste/drop: a permissive default like
 * `['image/*']` accepts any image, while an explicit list restricts to it.
 */
export function matchesMime(fileType: string, patterns: readonly string[]): boolean {
  const type = fileType.toLowerCase();

  return patterns.some((raw) => {
    const pattern = raw.toLowerCase();

    if (pattern === '*' || pattern === '*/*') return true;
    if (pattern.endsWith('/*')) {
      return type.startsWith(pattern.slice(0, -1));
    }

    return type === pattern;
  });
}
