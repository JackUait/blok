import { isHttpUrl } from '../../../tools/link/registry';
import type { PageConfig } from '../../../tools/page/types';
import type { BlokModules } from '../../../types-internal/blok-modules';

const pageConfig = (tools: BlokModules['Tools'] | undefined) =>
  tools?.blockTools.get('page')?.settings as PageConfig | undefined;

/**
 * The page a pasted URL links to, asked of the page tool's `pageIdFromHref`.
 * Only the host names the page: a pasted link can never pick the id itself.
 * @param tools - the editor's tools
 * @param url - the pasted URL
 */
export const pastedPageId = (tools: BlokModules['Tools'] | undefined, url: string): string | undefined => {
  const page = pageConfig(tools);

  if (page?.pageIdFromHref === undefined || !isHttpUrl(url)) {
    return undefined;
  }

  try {
    const pageId = page.pageIdFromHref(new URL(url.trim(), document.baseURI).href);

    return typeof pageId === 'string' && pageId !== '' ? pageId : undefined;
  } catch {
    return undefined;
  }
};

/** A page link pasted with its visible text. */
export interface PastedPageLink {
  href: string;
  text: string;
}

const withoutTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

const isUrlText = (text: string, href: string): boolean => {
  const shown = withoutTrailingSlash(text);

  if (shown === withoutTrailingSlash(href.trim())) {
    return true;
  }

  try {
    return shown === withoutTrailingSlash(new URL(href.trim(), document.baseURI).href);
  } catch {
    return false;
  }
};

/**
 * Decides which pasted links become page mentions: only a link whose text is
 * the page's title (as the host resolves it now) or the URL itself. Any other
 * text is the user's own words, so that link stays a link.
 * @param tools - the editor's tools
 * @param links - the pasted links
 * @returns the page id for each link that becomes a mention, else undefined
 */
export const pastedPageMentions = async (
  tools: BlokModules['Tools'] | undefined,
  links: readonly PastedPageLink[]
): Promise<Array<string | undefined>> => {
  const page = pageConfig(tools);
  // One host call per page: a forged clipboard may hold many links to one page.
  const titles = new Map<string, Promise<string | undefined>>();
  const titleOf = (pageId: string): Promise<string | undefined> => {
    const known = titles.get(pageId);

    if (known !== undefined) {
      return known;
    }

    const title = Promise.resolve()
      .then(() => page?.resolve?.(pageId))
      .then((info) => (info === null || info === undefined || info.access === 'none' ? undefined : info.title))
      .catch((): undefined => undefined);

    titles.set(pageId, title);

    return title;
  };

  return Promise.all(links.map(async ({ href, text }) => {
    const pageId = pastedPageId(tools, href);
    const shown = text.trim();

    if (pageId === undefined || shown === '') {
      return undefined;
    }

    if (isUrlText(shown, href)) {
      return pageId;
    }

    const title = await titleOf(pageId);

    return typeof title === 'string' && title.trim() === shown ? pageId : undefined;
  }));
};
