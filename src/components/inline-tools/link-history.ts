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

/**
 * Characters page titles use to join a site name ("Docs | Blok"). Left over
 * at either end when an unfurler drops one side, as in "- YouTube".
 */
const TITLE_SEPARATORS = new Set([' ', '-', '|', '·', '—', '–', ':', '•']);

/**
 * Trim separator debris from both ends. A loop, not a regex: a trailing
 * `[…]+$` run is quadratic on long inputs.
 * @param title - raw page title
 */
const cleanTitle = (title: string): string => {
  const chars = Array.from(title.trim());
  const start = chars.findIndex((char) => !TITLE_SEPARATORS.has(char));

  if (start === -1) {
    return '';
  }

  const end = chars.length - [...chars].reverse().findIndex((char) => !TITLE_SEPARATORS.has(char));

  return chars.slice(start, end).join('');
};

/**
 * Identity of a web link: `www.`, the scheme and a trailing slash do not
 * make it a different page.
 * @param url - stored href
 */
const linkKey = (url: string): string => {
  try {
    const parsed = new URL(url);

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/$/, '')}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // Not a URL: compare it as written.
  }

  return url;
};

const toRecentLink = (value: unknown): RecentLink | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const { url, title, favicon } = value as Record<string, unknown>;

  if (typeof url !== 'string') {
    return null;
  }

  const cleaned = typeof title === 'string' ? cleanTitle(title) : '';

  return {
    url,
    ...(cleaned !== '' ? { title: cleaned } : {}),
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

    const entries = parsed.map(toRecentLink).filter((entry): entry is RecentLink => entry !== null);

    return entries.filter((entry, index) => entries.findIndex((other) => linkKey(other.url) === linkKey(entry.url)) === index);
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
 * Move `url` to the top, keeping any title already known for the same link.
 * The newest spelling of the href wins.
 * @param url - the href that was just applied
 */
export function recordRecentLink(url: string): void {
  const key = linkKey(url);
  const entries = getRecentLinks();
  const existing = entries.find((entry) => linkKey(entry.url) === key);

  write([{ ...existing, url }, ...entries.filter((entry) => linkKey(entry.url) !== key)]);
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

  const title = meta.title === undefined ? '' : cleanTitle(meta.title);

  write(entries.map((entry) => entry.url !== url ? entry : {
    ...entry,
    ...(title ? { title } : {}),
    ...(meta.favicon ? { favicon: meta.favicon } : {}),
  }));
}
