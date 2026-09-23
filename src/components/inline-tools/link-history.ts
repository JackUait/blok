/**
 * Recently added links, shown under the empty link field. Shared by every
 * editor on the origin, like the color picker's recent colors.
 */
const STORAGE_KEY = 'blok-recent-links';
const LIMIT = 3;

export interface RecentLink {
  url: string;
  title?: string;
  favicon?: string;
}

const toRecentLink = (value: unknown): RecentLink | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const { url, title, favicon } = value as Record<string, unknown>;

  if (typeof url !== 'string') {
    return null;
  }

  return {
    url,
    ...(typeof title === 'string' ? { title } : {}),
    ...(typeof favicon === 'string' ? { favicon } : {}),
  };
};

/**
 * Newest first. Corrupt or unavailable storage reads as empty.
 */
export function getRecentLinks(): RecentLink[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map(toRecentLink).filter((entry): entry is RecentLink => entry !== null);
  } catch {
    return [];
  }
}

const write = (entries: RecentLink[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, LIMIT)));
  } catch {
    // Private mode or full quota: history just won't persist.
  }
};

/**
 * Move `url` to the top, keeping any title already known for it.
 * @param url - the href that was just applied
 */
export function recordRecentLink(url: string): void {
  const entries = getRecentLinks();
  const existing = entries.find((entry) => entry.url === url);

  write([existing ?? { url }, ...entries.filter((entry) => entry.url !== url)]);
}

/**
 * Attach the page title/favicon once the lookup answers. A link that has
 * already been pushed out of the history is not brought back.
 * @param url - the recorded href
 * @param meta - what the unfurl endpoint returned
 */
export function updateRecentLinkMeta(url: string, meta: { title?: string; favicon?: string }): void {
  const entries = getRecentLinks();

  if (!entries.some((entry) => entry.url === url)) {
    return;
  }

  const title = meta.title?.trim();

  write(entries.map((entry) => entry.url !== url ? entry : {
    ...entry,
    ...(title ? { title } : {}),
    ...(meta.favicon ? { favicon: meta.favicon } : {}),
  }));
}
