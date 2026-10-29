import type { PageConfig, PageSearchResult } from './types';

/**
 * The host's search hits the user may see. With `resolve`, a hit stays only
 * when resolve finds it and grants access, and resolve's title, path and
 * status win. "@" and "/" Link to page both list pages through this.
 */
export const searchVisiblePages = async (page: PageConfig, query: string): Promise<PageSearchResult[]> => {
  if (page.search === undefined) {
    return [];
  }

  const results = await page.search(query);
  const candidates = results.filter((hit) => typeof hit.pageId === 'string' &&
    hit.pageId.trim() !== '' && hit.access !== 'none');

  if (page.resolve === undefined) {
    return candidates;
  }

  const resolved = await Promise.all(candidates.map(async (hit) => {
    try {
      const info = await page.resolve?.(hit.pageId);

      return info !== null && info !== undefined && info.access !== 'none'
        ? { ...hit, title: info.title, path: info.path ?? hit.path, status: info.status ?? hit.status }
        : null;
    } catch {
      return null;
    }
  }));

  return resolved.filter((hit): hit is NonNullable<typeof hit> => hit !== null);
};
