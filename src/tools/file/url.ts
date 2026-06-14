/**
 * Returns the url only when it carries an http(s) scheme, else null. Persisted
 * block data is untrusted: a stored `javascript:`/`data:` url would execute when
 * placed on an anchor's href, so it must be allowlisted before any such use.
 */
export function safeHttpHref(raw: string): string | null {
  try {
    const url = new URL(raw, window.location.href);

    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
