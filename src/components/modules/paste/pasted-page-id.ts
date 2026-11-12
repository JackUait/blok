import { isHttpUrl } from '../../../tools/link/registry';
import type { PageConfig } from '../../../tools/page/types';
import type { BlokModules } from '../../../types-internal/blok-modules';

/**
 * The page a pasted URL links to, asked of the page tool's `pageIdFromHref`.
 * Only the host names the page: a pasted link can never pick the id itself.
 * @param tools - the editor's tools
 * @param url - the pasted URL
 */
export const pastedPageId = (tools: BlokModules['Tools'] | undefined, url: string): string | undefined => {
  const page = tools?.blockTools.get('page')?.settings as PageConfig | undefined;

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
