/**
 * Link-safety helpers for the link tools. The embed provider registry lives in
 * src/shared/embed-registry.ts and is re-exported here for existing importers.
 */
import type { EmbedServiceType as SharedEmbedServiceType } from '../../shared/embed-registry';

export * from '../../shared/embed-registry';

// public-export-reachability-law reads this alias from this file to pin types/tools/embed.d.ts.
export type EmbedServiceType = SharedEmbedServiceType;

/**
 * True only for safe http(s) URLs. Rejects javascript:, data:, ftp:, and non-URLs.
 */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);

    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * True only for absolute https URLs. The strict variant of {@link isHttpUrl}
 * used for anything that becomes an iframe `src` or embed-widget href: it
 * rejects javascript:, data:, http:, protocol-relative (`//…`) and non-URLs,
 * so stored block data can never smuggle a script-executing scheme into a
 * rendered frame (stored-XSS guard).
 */
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Sets an anchor's href only when the URL is a safe navigable link (absolute
 * http/https). Unsafe values (javascript:, data:, protocol-relative, …) leave
 * the anchor without an href entirely — an anchor with href="" would still
 * navigate (to the current page), so omitting the attribute is the inert
 * option. Every href assignment in the link toolset must go through this
 * helper or toSafeEmbedSrc (enforced by the link-url-sink-law architecture
 * test), because link/embed block data is attacker-controllable in host apps.
 */
export function setSafeLinkHref(anchor: HTMLAnchorElement, url: string | undefined): void {
  if (url !== undefined && isHttpUrl(url)) {
    anchor.setAttribute('href', url);
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
