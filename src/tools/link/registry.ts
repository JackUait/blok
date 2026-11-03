/**
 * Link-safety helpers for the link tools. The embed provider registry lives in
 * src/shared/embed-registry.ts and is re-exported here for existing importers.
 */
import type { EmbedServiceType as SharedEmbedServiceType } from '../../shared/embed-registry';

export * from '../../shared/embed-registry';

// public-export-reachability-law reads this alias from this file to pin types/tools/embed.d.ts.
export type EmbedServiceType = SharedEmbedServiceType;

/**
 * The canonical `new URL(value).href` of an absolute http(s) URL, or ''.
 *
 * The raw value must start with `http://` or `https://`. Without the `//`,
 * `new URL` with no base and the browser (which resolves an `src`/`href`
 * against the page) read different hosts: `https:/admin` parses as host
 * `admin` but loads `/admin` on the page's own site. Sinks must use the
 * returned href, never the raw value.
 * @param value - the URL to check
 * @param protocols - the schemes that are allowed
 */
function canonicalUrl(value: string, protocols: readonly string[]): string {
  if (!/^https?:\/\//i.test(value.trimStart())) {
    return '';
  }

  try {
    const url = new URL(value);

    return protocols.includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

/** The canonical href of an absolute http:// or https:// URL, or ''. */
export function toCanonicalHttpUrl(value: string): string {
  return canonicalUrl(value, ['http:', 'https:']);
}

/** The canonical href of an absolute https:// URL, or ''. */
export function toCanonicalHttpsUrl(value: string): string {
  return canonicalUrl(value, ['https:']);
}

/**
 * True only for absolute http:// or https:// URLs. Rejects javascript:,
 * data:, ftp:, `https:host` / `https:/path` and non-URLs.
 */
export function isHttpUrl(value: string): boolean {
  return toCanonicalHttpUrl(value) !== '';
}

/**
 * True only for absolute https:// URLs. The strict variant of {@link isHttpUrl}
 * used for anything that becomes an iframe `src` or embed-widget href: it
 * rejects javascript:, data:, http:, protocol-relative (`//…`), `https:/path`
 * and non-URLs, so stored block data can never smuggle a script-executing
 * scheme or a page-relative URL into a rendered frame.
 */
export function isHttpsUrl(value: string): boolean {
  return toCanonicalHttpsUrl(value) !== '';
}

/**
 * Sets an anchor's href to the canonical form of a safe navigable link
 * (absolute http/https). Unsafe values (javascript:, data:, protocol-relative,
 * `https:/path`, …) leave the anchor without an href entirely — an anchor
 * with href="" would still navigate (to the current page), so omitting the
 * attribute is the inert option. Every href assignment in the link toolset
 * must go through this helper or toSafeEmbedSrc (enforced by the
 * link-url-sink-law architecture test), because link/embed block data is
 * attacker-controllable in host apps.
 */
export function setSafeLinkHref(anchor: HTMLAnchorElement, url: string | undefined): void {
  const href = url === undefined ? '' : toCanonicalHttpUrl(url);

  if (href !== '') {
    anchor.setAttribute('href', href);
  }
}

/**
 * Whether a link points at the current page: a bare anchor ("#results") or any
 * URL that resolves to the document's own origin + pathname. Such destinations
 * always open in the same window, so in-article navigation never spawns a tab.
 * @param value - raw href to test
 */
export function isSamePageLink(value: string): boolean {
  const trimmed = value.trim();

  if (trimmed.charAt(0) === '#') {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const current = new URL(window.location.href);
    const resolved = new URL(trimmed, current.href);

    return resolved.origin === current.origin && resolved.pathname === current.pathname;
  } catch {
    return false;
  }
}
