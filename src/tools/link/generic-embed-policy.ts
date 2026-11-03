import type { BlokConfig } from '../../../types/configs/blok-config';

import { isAllowedEmbedOrigin } from './embed/allowed-origins';
import { isSameSiteHost, pageHosts } from './host-pattern';
import { isHttpsUrl } from './registry';

/** What decides whether a non-registry URL may be framed. Read from live config, never from block data. */
export interface GenericEmbedPolicy {
  allowGeneric: boolean;
  allowedOrigins: readonly string[];
  /** `linkPaste.blockedEmbedOrigins`; beats both allow settings. */
  blockedOrigins: readonly string[];
  /** The page host and `linkPaste.hostAliases`. */
  ownHosts: readonly string[];
}

/** The policy for the current page and `linkPaste` config. */
export function genericEmbedPolicy(linkPaste: BlokConfig['linkPaste']): GenericEmbedPolicy {
  return {
    allowGeneric: linkPaste?.allowGenericEmbed === true,
    allowedOrigins: linkPaste?.allowedEmbedOrigins ?? [],
    blockedOrigins: linkPaste?.blockedEmbedOrigins ?? [],
    ownHosts: pageHosts(linkPaste?.hostAliases),
  };
}

const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

/** A hostname in the form `new URL` gives: lower case, punycode, no trailing dot. */
const canonicalHost = (name: string): string => {
  const bare = name.trim().replace(/\.$/, '');

  try {
    return new URL(`https://${bare}`).hostname.replace(/\.$/, '');
  } catch {
    return bare.toLowerCase();
  }
};

/**
 * Whether `url`'s host matches a deny-list entry. Unlike the allow list, a
 * miss here lets a frame through, so both sides are made canonical first:
 * a trailing dot or a Unicode entry must not slip past.
 */
function isBlockedHost(url: string, patterns: readonly string[]): boolean {
  const host = canonicalHost(hostnameOf(url));

  return host !== '' && patterns.some((pattern) => {
    const wildcard = pattern.trim().startsWith('*.');
    const entry = canonicalHost(wildcard ? pattern.trim().slice(2) : pattern);

    if (entry === '') {
      return false;
    }

    return wildcard ? host.endsWith(`.${entry}`) : host === entry;
  });
}

/**
 * Whether a non-registry URL may be framed. The paste menu, the embed URL
 * input and render all ask this, so the menu never offers what render refuses.
 * The own site is never framed, even when allowlisted: its pages would load
 * with the reader's cookies, and HTML served there could lift the sandbox.
 */
export function canFrameGeneric(url: string, policy: GenericEmbedPolicy): boolean {
  return isHttpsUrl(url)
    && !isSameSiteHost(hostnameOf(url), policy.ownHosts)
    && !isBlockedHost(url, policy.blockedOrigins)
    && (policy.allowGeneric || isAllowedEmbedOrigin(url, policy.allowedOrigins));
}
