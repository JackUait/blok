import type { BlokConfig } from '../../../types/configs/blok-config';

import { isAllowedEmbedOrigin } from './embed/allowed-origins';
import { isSameSiteHost, matchesDenyHostPattern, pageHosts } from './host-pattern';
import { toCanonicalHttpsUrl } from './registry';

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

/**
 * Whether a non-registry URL may be framed. The paste menu, the embed URL
 * input and render all ask this, so the menu never offers what render refuses.
 * The own site is never framed, even when allowlisted: its pages would load
 * with the reader's cookies, and HTML served there could lift the sandbox.
 */
export function canFrameGeneric(url: string, policy: GenericEmbedPolicy): boolean {
  const href = toCanonicalHttpsUrl(url);

  return href !== ''
    && !isSameSiteHost(hostnameOf(href), policy.ownHosts)
    && !matchesDenyHostPattern(hostnameOf(href), policy.blockedOrigins)
    && (policy.allowGeneric || isAllowedEmbedOrigin(href, policy.allowedOrigins));
}
