import { isAllowedEmbedOrigin } from '../embed/allowed-origins';
import { matchesHostPattern } from '../host-pattern';
import { isHttpUrl, matchEmbedService } from '../registry';

/** The four outputs Notion offers for a pasted URL. */
export type PasteMenuActionType = 'embed' | 'bookmark' | 'mention' | 'plain';

export interface PasteMenuOption {
  type: PasteMenuActionType;
}

export interface PasteMenuContext {
  /** Whether the paste lands on a non-collapsed text selection. */
  hasSelection: boolean;
  /** When true, an unmatched http(s) URL also offers a generic iframe embed. */
  allowGenericEmbed?: boolean;
  /** Hosts (`linkPaste.allowedEmbedOrigins`) whose https URLs may get a generic embed. */
  allowedEmbedOrigins?: readonly string[];
  /**
   * Hostnames (or `*.` wildcards) that count as the editor's own site. A
   * bookmark of the site the reader is already on adds nothing.
   */
  ownHosts?: readonly string[];
  /** The page the URL links to, when the page tool recognizes it. */
  pageId?: string;
}

/** Whether `url` points at one of `ownHosts`. The port is ignored. */
export function isOwnHostLink(url: string, ownHosts: readonly string[] | undefined): boolean {
  if (ownHosts === undefined || ownHosts.length === 0) {
    return false;
  }

  try {
    return matchesHostPattern(new URL(url).hostname, ownHosts);
  } catch {
    return false;
  }
}

/**
 * Whether `hostname` is one of `ownHosts`, or a subdomain or parent domain of
 * one, on dot boundaries. A `*.` wildcard counts as its bare suffix.
 */
function isOwnSiteRelated(hostname: string, ownHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase();

  return ownHosts.some((pattern) => {
    const own = pattern.toLowerCase().replace(/^\*\./, '');

    return own !== '' && (host === own || host.endsWith(`.${own}`) || own.endsWith(`.${host}`));
  });
}

/**
 * A generic (non-registry) embed frames an arbitrary page, so it is offered
 * only for https, never for the own site, and only when the host opted in.
 */
function canEmbedGeneric(url: string, context: PasteMenuContext): boolean {
  const parsed = ((): URL | null => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  })();

  if (parsed === null || parsed.protocol !== 'https:') {
    return false;
  }

  if (isOwnSiteRelated(parsed.hostname, context.ownHosts ?? [])) {
    return false;
  }

  return context.allowGenericEmbed === true || isAllowedEmbedOrigin(url, context.allowedEmbedOrigins);
}

/**
 * Decides which paste-menu options apply to a pasted URL.
 *
 * - With a text selection, Notion simply hyperlinks it — only `plain`.
 * - `embed` for a registered provider, or a URL that passes `canEmbedGeneric`
 *   (most specific, listed first).
 * - `bookmark` for any safe http(s) URL outside `ownHosts`.
 * - `mention` for any safe http(s) URL.
 * - `plain` is always available (dismiss / keep as link).
 * - A page link offers only `mention` and `plain`: a bookmark or embed of a
 *   page in this app adds nothing.
 */
export function buildPasteMenuOptions(
  url: string,
  context: PasteMenuContext
): PasteMenuOption[] {
  if (context.hasSelection || !isHttpUrl(url)) {
    return [{ type: 'plain' }];
  }

  if (context.pageId !== undefined) {
    return [{ type: 'mention' }, { type: 'plain' }];
  }

  const options: PasteMenuOption[] = [];

  if (matchEmbedService(url) || canEmbedGeneric(url, context)) {
    options.push({ type: 'embed' });
  }

  if (!isOwnHostLink(url, context.ownHosts)) {
    options.push({ type: 'bookmark' });
  }

  options.push({ type: 'mention' }, { type: 'plain' });

  return options;
}
