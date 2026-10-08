import type { PageIcon } from '../../types/tools/page';
import type { PageRegistry } from './page-host';

/** The registry keeps an emoji string; the built-in title keeps a PageIcon. */
export const toPageIcon = (icon: string | undefined): PageIcon | undefined =>
  icon === undefined || icon === '' ? undefined : { type: 'emoji', value: icon };

/** Never '': a stored '' would come back out of `info()` as an empty emoji icon. */
export const fromPageIcon = (icon: PageIcon | null): string | undefined =>
  icon?.type === 'emoji' && icon.value !== '' ? icon.value : undefined;

/**
 * The title and icon a page's editor starts with.
 * Reads `get`, not `info`: remote mode overrides only `get` with the host's answer.
 */
export const titleData = (pages: Pick<PageRegistry, 'get' | 'root'>, pageId: string | null): { title: string; icon?: PageIcon } => {
  const page = pageId === null ? pages.root() : pages.get(pageId);
  const icon = toPageIcon(page?.icon);

  return { title: page?.title ?? '', ...(icon !== undefined && { icon }) };
};
