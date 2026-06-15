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

/**
 * Returns the url only when it is safe to load as an <iframe> preview src, else
 * null. The default uploader yields `blob:` urls, so those are allowed alongside
 * http(s); `data:`/`javascript:` are rejected because a `data:text/html` iframe
 * can execute script.
 */
export function safePreviewSrc(raw: string): string | null {
  try {
    const url = new URL(raw);

    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'blob:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}
