/**
 * URL sanitization for values placed into href/src attributes.
 *
 * Browsers strip ASCII whitespace and a range of control characters from a URL
 * before resolving its scheme, so "java\nscript:" and "data:\ttext/html" still
 * execute. Markdown paste decodes entities like "&NewLine;" into those literal
 * characters before the URL reaches us. We therefore strip the ignored
 * characters first, then allowlist known-safe schemes - denylists repeatedly
 * lose to scheme smuggling, allowlists do not.
 */

/**
 * Characters a browser ignores when resolving a URL scheme: C0 controls and
 * space (- ), NBSP, line/paragraph separators, and BOM/ZWNBSP.
 */
const IGNORED_URL_CHARS = /[\u0000-\u0020\u00a0\u2028\u2029\ufeff]/g;

/** Schemes safe to navigate to from an anchor href. */
const SAFE_HREF_SCHEME = /^(?:https?|mailto|tel|sms):/i;

/**
 * data: image subtypes that cannot carry script. Excludes svg+xml and any
 * "+xml" subtype, which execute embedded script when loaded as a document.
 */
const SAFE_IMAGE_DATA = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)[;,]/i;

/**
 * Return the explicit scheme of a URL (e.g. "javascript:"), or null when the
 * URL is relative, an anchor, or protocol-relative ("//host").
 */
function explicitScheme(url: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:/i.exec(url);

  return match ? match[0] : null;
}

/**
 * Sanitize a URL for use as an anchor href.
 * Returns the original URL when safe, or null when it must be dropped.
 * Relative, anchor, and protocol-relative URLs have no scheme to abuse and pass.
 */
export function safeHref(url: string): string | null {
  const stripped = url.replace(IGNORED_URL_CHARS, '');

  if (explicitScheme(stripped) === null) {
    return url;
  }

  return SAFE_HREF_SCHEME.test(stripped) ? url : null;
}

/**
 * Sanitize a URL for use as an <img> src.
 * Allows http(s), relative URLs, and raster data: images. Rejects svg/xml and
 * html data: URLs (which can execute script) and all script-capable schemes.
 */
export function safeImageSrc(url: string): string | null {
  const stripped = url.replace(IGNORED_URL_CHARS, '');

  if (explicitScheme(stripped) === null) {
    return url;
  }

  if (/^https?:/i.test(stripped) || SAFE_IMAGE_DATA.test(stripped)) {
    return url;
  }

  return null;
}

/**
 * True when the URL carries an explicit scheme that is not in the href
 * allowlist. Used to reject user-entered link targets before insertion.
 */
export function hasUnsafeScheme(url: string): boolean {
  const stripped = url.replace(IGNORED_URL_CHARS, '');

  return explicitScheme(stripped) !== null && !SAFE_HREF_SCHEME.test(stripped);
}
