/**
 * Version history for the dev playground: a drawer that lists the sync
 * server's versions of the open document, previews one read-only with its
 * changes marked, and restores it.
 *
 * The pure helpers come first; `mountHistoryDrawer` wires them to the page.
 */
import './history-drawer.css';
import { IconBookmark, IconCheck, IconChevronDown } from '../components/icons';
import { createTicketSource } from '../components/utils/access-pass';
import { prefersReducedMotion } from '../components/utils/reduced-motion';
import type { TicketSource } from '../components/utils/access-pass';
import type { LooseOutputBlockData, LooseOutputData } from '../../types';

export interface HistoryLineage {
  lineage: string;
  epoch: number;
  format: number;
  createdAt: number | null;
  current: boolean;
}

export interface HistoryVersion {
  lineage: string;
  sequence: number;
  startedAt: number | null;
  savedAt: number | null;
  actors: string[];
}

/** `GET /sync/{doc}/history`. */
export interface HistoryList {
  lineages: HistoryLineage[];
  versions: HistoryVersion[];
}

export interface HistoryPerson {
  id: string;
  name: string;
}

export interface HistoryPoint {
  lineage: string;
  sequence: number;
}

export type HistoryRow =
  | { kind: 'lineage'; label: string }
  | {
    kind: 'version';
    key: string;
    lineage: string;
    sequence: number;
    time: string;
    who: string;
    current: boolean;
    /** Unix ms the version was saved, or null. Kept with a bookmark. */
    at: number | null;
    /** The version under this one in the list; its changes are measured from there. */
    below: HistoryPoint | null;
  };

export type ChangeMark = 'added' | 'changed' | 'removed' | 'moved';

/** A bookmarked point, as the page host stores it. */
export interface HistoryBookmark extends HistoryPoint {
  savedAt: number | null;
}

/** Minutes per version for the server, or the host's bookmarks. */
export type HistoryGrouping = '1' | '15' | '60' | 'bookmarks';

export const GROUPINGS: ReadonlyArray<{ value: HistoryGrouping; label: string }> = [
  { value: '1', label: '1 minute' },
  { value: '15', label: '15 minutes' },
  { value: '60', label: '1 hour' },
  { value: 'bookmarks', label: 'Bookmarks' },
];

/**
 * What the drawer shows. Only the version list today; per-version edits and
 * the Updates feed add their own modes and a draw function for each.
 */
export type HistoryDrawerMode = 'list';

/**
 * The two `@bloklabs/core/view` functions the drawer uses. Handed in by the
 * page: the view-entry law keeps every module outside src/view from importing
 * it, so the editor bundles never pull in parse5.
 */
export interface HistoryView {
  diffOutputData(before: LooseOutputData, after: LooseOutputData): {
    added: Array<{ id?: string }>;
    removed: Array<{ id?: string }>;
    changed: Array<{ id: string }>;
    moved: Array<{ id: string }>;
  };
  blocksToHtml(
    data: LooseOutputData,
    options: { toolAttributes: boolean; blockIds: boolean; root: boolean; classes: boolean }
  ): string;
}

export interface ChangePreview {
  blocks: LooseOutputBlockData[];
  marks: Record<string, ChangeMark>;
}

/** Must match the id prefix `userConfig()` in index.html and scripts/dev-ticket.mjs build. */
const USER_PREFIX = 'playground-';
const ANONYMOUS_ID = 'playground-user';

/**
 * Display name for a journal actor id.
 * @param actor - the ticket user that wrote
 * @param self - the person in this tab
 */
export const actorName = (actor: string, self: HistoryPerson): string => {
  if (actor === self.id) {
    return self.name;
  }

  if (actor === ANONYMOUS_ID) {
    return 'Playground user';
  }

  if (!actor.startsWith(USER_PREFIX) || actor.length === USER_PREFIX.length) {
    return actor;
  }

  const name = actor.slice(USER_PREFIX.length);

  return name[0].toUpperCase() + name.slice(1);
};

const startOfDay = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * "Today, 14:32", "Yesterday, 18:20", or a short date and the time.
 * @param ms - Unix milliseconds, or null when the server has none
 * @param now - the current time
 * @param locale - defaults to the browser's
 */
export const formatVersionTime = (ms: number | null, now: Date, locale?: string): string => {
  if (ms === null) {
    return 'Time unknown';
  }

  const date = new Date(ms);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (days === 0) {
    return `Today, ${time}`;
  }

  if (days === 1) {
    return `Yesterday, ${time}`;
  }

  const day = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date);

  return `${day}, ${time}`;
};

/**
 * The heading over one lineage's versions.
 * @param lineage - the lineage, or undefined when the list does not name it
 * @param locale - defaults to the browser's
 */
export const lineageLabel = (lineage: HistoryLineage | undefined, locale?: string): string => {
  if (lineage?.current === true) {
    return 'Current history';
  }

  const date = lineage?.createdAt == null
    ? 'date unknown'
    : new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(lineage.createdAt));

  return `Before the reset · ${date}`;
};

const authorsOf = (names: string[]): string => names.length > 0 ? names.join(', ') : 'No author recorded';

/**
 * The drawer's rows: a heading per lineage, then its versions, newest first.
 * @param list - the server's history list
 * @param options - clock, the person in this tab, and locale
 */
export const historyRows = (
  list: HistoryList,
  options: { now: Date; self: HistoryPerson; locale?: string }
): HistoryRow[] => {
  const lineages = new Map(list.lineages.map((lineage) => [lineage.lineage, lineage]));

  return list.versions.flatMap((version, index): HistoryRow[] => {
    const below = list.versions[index + 1];
    const names = version.actors.map((actor) => actorName(actor, options.self));
    const row: HistoryRow = {
      kind: 'version',
      key: `${version.lineage}:${version.sequence}`,
      lineage: version.lineage,
      sequence: version.sequence,
      time: formatVersionTime(version.savedAt ?? version.startedAt, options.now, options.locale),
      who: index === 0 ? 'Current version' : authorsOf(names),
      current: index === 0,
      at: version.savedAt ?? version.startedAt,
      below: below === undefined ? null : { lineage: below.lineage, sequence: below.sequence },
    };
    const startsLineage = index === 0 || list.versions[index - 1].lineage !== version.lineage;

    return startsLineage
      ? [{ kind: 'lineage', label: lineageLabel(lineages.get(version.lineage), options.locale) }, row]
      : [row];
  });
};

const samePoint = (a: HistoryPoint, b: HistoryPoint): boolean => a.lineage === b.lineage && a.sequence === b.sequence;

/**
 * Whether a point is bookmarked.
 * @param bookmarks - the host's list
 * @param point - the version
 */
export const isBookmarked = (bookmarks: HistoryBookmark[], point: HistoryPoint): boolean =>
  bookmarks.some((mark) => samePoint(mark, point));

/**
 * The list with the point added, or removed when it was there.
 * @param bookmarks - the host's list
 * @param mark - the point and its time
 */
export const toggleBookmark = (bookmarks: HistoryBookmark[], mark: HistoryBookmark): HistoryBookmark[] =>
  isBookmarked(bookmarks, mark)
    ? bookmarks.filter((other) => !samePoint(other, mark))
    : [...bookmarks, mark];

/**
 * Rows for the Bookmarks grouping: newest first, the time only. Each compares
 * with the point just before it in its lineage.
 * @param bookmarks - the host's list
 * @param options - clock and locale
 */
export const bookmarkRows = (bookmarks: HistoryBookmark[], options: { now: Date; locale?: string }): HistoryRow[] =>
  [...bookmarks]
    .sort((a, b) => (b.savedAt ?? -Infinity) - (a.savedAt ?? -Infinity) || b.sequence - a.sequence)
    .map((mark) => ({
      kind: 'version',
      key: `${mark.lineage}:${mark.sequence}`,
      lineage: mark.lineage,
      sequence: mark.sequence,
      time: formatVersionTime(mark.savedAt, options.now, options.locale),
      who: '',
      current: false,
      at: mark.savedAt,
      below: mark.sequence > 0 ? { lineage: mark.lineage, sequence: mark.sequence - 1 } : null,
    }));

/**
 * The pages a version's page blocks point to, once each, in order.
 * @param blocks - the version's blocks
 */
export const subPagesOf = (blocks: LooseOutputBlockData[]): string[] => {
  const ids = blocks
    .filter((block) => block.type === 'page')
    .map((block) => block.data?.pageId)
    .filter((id): id is string => typeof id === 'string' && id !== '');

  return [...new Set(ids)];
};

const idOf = (block: LooseOutputBlockData): string | null =>
  typeof block.id === 'string' && block.id !== '' ? block.id : null;

const parentOf = (block: LooseOutputBlockData): string | null =>
  typeof block.parent === 'string' && block.parent !== '' ? block.parent : null;

/**
 * Siblings of a block in `document`, in order: the parent's `content` when it
 * lists them, else the order of the blocks array.
 */
const siblingsIn = (blocks: LooseOutputBlockData[], parent: string | null): string[] => {
  const listed = parent === null ? null : blocks.find((block) => idOf(block) === parent)?.content;
  const byArray = blocks
    .filter((block) => parentOf(block) === parent)
    .map(idOf)
    .filter((id): id is string => id !== null);

  if (listed == null) {
    return byArray;
  }

  return [...listed, ...byArray.filter((id) => !listed.includes(id))];
};

/**
 * The newer document with the changes made since `before` marked, and the
 * removed blocks put back where they used to be so they can be shown.
 * @param before - the older version
 * @param after - the version being previewed
 * @param diffOutputData - from `@bloklabs/core/view`
 */
export const changePreview = (
  before: LooseOutputData,
  after: LooseOutputData,
  diffOutputData: HistoryView['diffOutputData']
): ChangePreview => {
  const diff = diffOutputData(before, after);
  const marks: Record<string, ChangeMark> = {};
  const blocks: LooseOutputBlockData[] = after.blocks.map((block) => ({ ...block }));

  diff.added.forEach(({ id }) => {
    if (id !== undefined) {
      marks[id] = 'added';
    }
  });
  diff.changed.forEach(({ id }) => {
    marks[id] = 'changed';
  });
  // A block that moved and changed shows as changed.
  diff.moved.forEach(({ id }) => {
    marks[id] ??= 'moved';
  });

  diff.removed.forEach(({ id: removedId }) => {
    const original = before.blocks.find((block) => removedId !== undefined && idOf(block) === removedId);

    // The diff never matches a block without an id, so it cannot report one removed.
    if (original === undefined || removedId === undefined) {
      return;
    }

    marks[removedId] = 'removed';

    const parent = parentOf(original);

    // A child of a removed parent comes back inside that parent's own entry.
    if (parent !== null && marks[parent] === 'removed') {
      blocks.push({ ...original });

      return;
    }

    const oldSiblings = siblingsIn(before.blocks, parent);
    const newSiblings = siblingsIn(blocks, parent);
    const anchor = oldSiblings
      .slice(0, oldSiblings.indexOf(removedId))
      .reverse()
      .find((id) => newSiblings.includes(id));
    const anchorIndex = blocks.findIndex((block) => anchor !== undefined && idOf(block) === anchor);
    const firstSibling = blocks.findIndex((block) => idOf(block) === newSiblings[0]);
    const at = anchorIndex >= 0 ? anchorIndex + 1 : Math.max(firstSibling, 0);

    blocks.splice(at, 0, { ...original });

    const holder = parent === null ? undefined : blocks.find((block) => idOf(block) === parent);

    if (holder?.content != null) {
      const content = [...holder.content];

      content.splice(anchor === undefined ? 0 : content.indexOf(anchor) + 1, 0, removedId);
      holder.content = content;
    }
  });

  return { blocks, marks };
};

/**
 * What to tell the person when a history request fails.
 * @param status - HTTP status, 0 when the request never got an answer
 * @param body - the server's text body
 */
export const historyErrorMessage = (status: number, body: string): string => {
  if (status === 0) {
    return 'The sync server did not answer.';
  }

  const text = body.trim();

  if (text !== '') {
    return `${text} (${status})`;
  }

  const fallback: Record<number, string> = {
    412: 'The document changed. Try again.',
    413: 'This version is too large to restore.',
    501: 'This server keeps no history.',
  };

  return `${fallback[status] ?? 'Something went wrong.'} (${status})`;
};

/**
 * The ticket mint address for this tab's user.
 * @param base - the mint endpoint `yarn serve` started
 * @param name - the `?name=` of this tab, if any
 */
export const playgroundTicketUrl = (base: string, name: string | null): string => {
  const trimmed = name?.trim();

  return trimmed ? `${base}?name=${encodeURIComponent(trimmed)}` : base;
};


/** How long a jumped-to block keeps its outline. */
const FLASH_MS = 1200;

/**
 * Scrolls to the first marked block in `container` and outlines it for a
 * moment. Returns that block, or null when nothing is marked.
 * @param container - the rendered preview
 */
export const jumpToChange = (container: HTMLElement): HTMLElement | null => {
  const target = container.querySelector<HTMLElement>('[data-pg-change]');

  if (target === null) {
    return null;
  }

  target.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  target.setAttribute('data-pg-flash', '');
  window.setTimeout(() => target.removeAttribute('data-pg-flash'), FLASH_MS);

  return target;
};

/**
 * Sets `data-pg-change` on every rendered node of each marked block.
 * @param container - the rendered preview
 * @param marks - change marks by block id
 */
export const paintMarks = (container: HTMLElement, marks: Record<string, ChangeMark>): void => {
  Object.entries(marks).forEach(([id, mark]) => {
    container.querySelectorAll(`[data-blok-id="${CSS.escape(id)}"]`).forEach((node) => node.setAttribute('data-pg-change', mark));
  });
};

export interface HistoryDrawerOptions {
  /** The header button that opens and closes the drawer. */
  button: HTMLButtonElement;
  /** Hidden (not destroyed) while a version is previewed. */
  editorArea: HTMLElement;
  /** The sync server's base URL. */
  server: string;
  /** The ticket mint for this tab's user. */
  ticketUrl: string;
  view: HistoryView;
  /** The open document, read at every open: navigation changes it. */
  doc(): string | null;
  self(): HistoryPerson;
  notify(message: string): void;
  /** The dev page host that keeps bookmarks. Without it there are no bookmarks. */
  pageHost?: string | null;
  /** A page's title from the playground's records; null asks for the open page. */
  titleOf?: (pageId: string | null) => string;
  now?: () => Date;
  idempotencyKey?: () => string;
}

export interface HistoryDrawer {
  open(): Promise<void>;
  close(): void;
}

type VersionRow = Extract<HistoryRow, { kind: 'version' }>;

/** Blok's menus and dialogs, which mount outside the editor column. */
const BLOK_MENUS = '[data-blok-popover], [data-blok-top-layer]';
const OPEN_MENU = '[data-blok-popover-opened]';
const GROUPING_KEY = 'pg-history-group';
const DEFAULT_GROUPING: HistoryGrouping = '15';
const NO_BOOKMARKS = 'No bookmarked versions yet';

/** Thrown for any non-OK answer; the message is what the person sees. */
class HistoryRequestError extends Error {}

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);

  node.className = className;

  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
};

const textButton = (label: string, className: string, onClick: () => void): HTMLButtonElement => {
  const button = element('button', className, label);

  button.type = 'button';
  button.addEventListener('click', onClick);

  return button;
};

const icon = (svg: string, className: string): HTMLSpanElement => {
  const node = element('span', className);

  node.innerHTML = svg;
  node.setAttribute('aria-hidden', 'true');

  return node;
};

const isGrouping = (value: unknown): value is HistoryGrouping => GROUPINGS.some((grouping) => grouping.value === value);

const readGrouping = (bookmarks: boolean): HistoryGrouping => {
  try {
    const saved = localStorage.getItem(GROUPING_KEY);

    return isGrouping(saved) && (bookmarks || saved !== 'bookmarks') ? saved : DEFAULT_GROUPING;
  } catch {
    return DEFAULT_GROUPING;
  }
};

const saveGrouping = (value: HistoryGrouping): void => {
  try {
    localStorage.setItem(GROUPING_KEY, value);
  } catch {
    // Private windows may refuse storage; the choice then lasts for this page only.
  }
};

const isBookmarkList = (value: unknown): value is HistoryBookmark[] => Array.isArray(value);

/**
 * Mounts the drawer and its preview pane. The drawer resolves the document
 * each time it opens, so it never holds an editor or a doc id.
 * @param options - where to mount and how to reach the server
 */
export const mountHistoryDrawer = (options: HistoryDrawerOptions): HistoryDrawer => {
  const now = options.now ?? ((): Date => new Date());
  const idempotencyKey = options.idempotencyKey ?? ((): string => crypto.randomUUID());
  const titleOf = options.titleOf ?? ((pageId: string | null): string => pageId ?? 'this page');
  const host = options.pageHost ?? null;
  const sources = new Map<string, TicketSource>();
  const points = new Map<string, LooseOutputData>();
  const state = {
    mode: 'list' as HistoryDrawerMode,
    doc: null as string | null,
    group: readGrouping(host !== null),
    rows: [] as HistoryRow[],
    bookmarks: [] as HistoryBookmark[],
    selected: null as VersionRow | null,
    showChanges: true,
    restoring: false,
    busy: false,
    error: '',
    // Bumped on every selection: a slow answer for an older pick must not paint.
    request: 0,
    // Bumped on every list load: a slow list for an older grouping must not paint.
    load: 0,
  };

  const panel = element('aside', 'pg-history');
  const head = element('div', 'pg-history__head');
  const groupBar = element('div', 'pg-history__group');
  const groupButton = textButton('', 'pg-history__group-button', () => {
    if (menu.hidden) {
      openMenu();
    } else {
      closeMenu();
    }
  });
  const menu = element('div', 'pg-history__menu');
  const status = element('p', 'pg-history__status');
  const list = element('ul', 'pg-history__list');
  const previewPane = element('section', 'pg-history-preview');
  const banner = element('div', 'pg-history-banner');
  const note = element('div', 'pg-history-note');
  const render = element('div', 'pg-history-render');
  const dialog = element('div', 'pg-history-dialog');
  const card = element('div', 'pg-history-dialog__card');

  panel.setAttribute('data-pg-history', '');
  panel.id = 'pg-history';
  panel.setAttribute('aria-label', 'Version history');
  panel.hidden = true;
  status.setAttribute('role', 'status');
  head.append(element('h2', 'pg-history__title', 'History'), textButton('Close', 'pg-history__button', () => close()));

  groupButton.setAttribute('aria-haspopup', 'menu');
  groupButton.setAttribute('aria-expanded', 'false');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Group changes by');
  menu.hidden = true;
  groupBar.append(groupButton, menu);
  panel.append(head, groupBar, status, list);

  previewPane.setAttribute('data-pg-history-preview', '');
  previewPane.setAttribute('aria-label', 'Version preview');
  previewPane.hidden = true;
  // index.html scopes view.css to this id.
  render.id = 'pg-history-render';
  previewPane.append(banner, element('div', 'pg-history-doc'));
  previewPane.lastElementChild?.append(note, render);

  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'pg-history-dialog-title');
  dialog.setAttribute('data-pg-history-restore', '');
  dialog.hidden = true;
  dialog.append(card);

  document.body.append(panel, dialog);
  options.editorArea.after(previewPane);

  options.button.setAttribute('aria-expanded', 'false');
  options.button.setAttribute('aria-controls', panel.id);

  const ticketFor = (doc: string): TicketSource => {
    const known = sources.get(doc);

    if (known !== undefined) {
      return known;
    }

    const source = createTicketSource(options.ticketUrl, { doc });

    sources.set(doc, source);

    return source;
  };

  const base = (doc: string): string => `${options.server}/sync/${encodeURIComponent(doc)}/history`;

  const send = async (doc: string, url: string, init: RequestInit = {}, fresh = false): Promise<Response> => {
    const token = await ticketFor(doc)(fresh ? { forceRefresh: true } : undefined).catch(() => {
      throw new HistoryRequestError('Could not get a pass from the ticket mint.');
    });
    const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } })
      .catch(() => null);

    if (response === null) {
      throw new HistoryRequestError(historyErrorMessage(0, ''));
    }

    // A pass from an earlier `yarn serve` run is signed with an old secret.
    if (response.status === 401 && !fresh) {
      return send(doc, url, init, true);
    }

    if (!response.ok) {
      throw new HistoryRequestError(historyErrorMessage(response.status, await response.text()));
    }

    return response;
  };

  const messageOf = (error: unknown): string =>
    error instanceof HistoryRequestError ? error.message : historyErrorMessage(0, '');

  const readPoint = async (doc: string, point: HistoryPoint): Promise<LooseOutputData> => {
    const key = `${doc}\n${point.lineage}:${point.sequence}`;
    const cached = points.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const response = await send(doc, `${base(doc)}/${encodeURIComponent(point.lineage)}/${point.sequence}`);
    const body = await response.json() as { blocks?: LooseOutputBlockData[] };
    const data = { blocks: Array.isArray(body.blocks) ? body.blocks : [] };

    points.set(key, data);

    return data;
  };

  const bookmarksUrl = (doc: string): string | null => host === null ? null : `${host}/bookmarks/${encodeURIComponent(doc)}`;

  /** The host's bookmarks, or null when there is no host or it did not answer. */
  const readBookmarks = async (doc: string, init?: RequestInit): Promise<HistoryBookmark[] | null> => {
    const url = bookmarksUrl(doc);

    if (url === null) {
      return null;
    }

    try {
      const response = await fetch(url, init);
      const body: unknown = response.ok ? await response.json() : null;

      return isBookmarkList(body) ? body : null;
    } catch {
      return null;
    }
  };

  const { editorArea } = options;

  const showEditor = (): void => {
    editorArea.hidden = false;
    editorArea.inert = false;
    previewPane.hidden = true;
    render.replaceChildren();
  };

  const showPreview = (): void => {
    editorArea.hidden = true;
    editorArea.inert = true;
    previewPane.hidden = false;
  };

  const bookmarkToggle = (row: VersionRow): HTMLButtonElement => {
    const marked = isBookmarked(state.bookmarks, row);
    const toggle = textButton('', 'pg-history__mark', () => {
      void flipBookmark(row);
    });

    toggle.setAttribute('data-bookmark', row.key);
    toggle.setAttribute('aria-pressed', String(marked));
    toggle.setAttribute('aria-label', marked ? 'Remove bookmark' : 'Bookmark this version');
    toggle.append(icon(IconBookmark, 'pg-history__mark-icon'));

    return toggle;
  };

  const versionItem = (row: VersionRow): HTMLLIElement => {
    const item = element('li', 'pg-history__item');
    const button = textButton('', 'pg-history__row', () => {
      void select(row);
    });

    button.setAttribute('data-key', row.key);
    button.setAttribute('aria-current', String(state.selected?.key === row.key));
    button.append(element('span', 'pg-history__time', row.time));

    if (row.who !== '') {
      button.append(element('span', 'pg-history__who', row.who));
    }
    button.append(icon(IconCheck, 'pg-history__check'));
    item.append(button);

    if (host !== null) {
      item.append(bookmarkToggle(row));
    }

    return item;
  };

  const drawList = (): void => {
    list.replaceChildren(...state.rows.map((row) =>
      row.kind === 'lineage' ? element('li', 'pg-history__lineage', row.label) : versionItem(row)
    ));
  };

  const views: Record<HistoryDrawerMode, () => void> = { list: drawList };

  const drawRows = (): void => {
    views[state.mode]();
  };

  const groupLabel = (value: HistoryGrouping): string =>
    GROUPINGS.find((grouping) => grouping.value === value)?.label ?? value;

  const drawGroup = (): void => {
    groupButton.replaceChildren(
      element('span', 'pg-history__group-name', 'Group by'),
      element('span', 'pg-history__group-value', groupLabel(state.group)),
      icon(IconChevronDown, 'pg-history__group-chevron')
    );
    menu.replaceChildren(
      element('div', 'pg-history__menu-title', 'Group changes by'),
      ...GROUPINGS.filter((grouping) => host !== null || grouping.value !== 'bookmarks').map((grouping) => {
        const option = textButton('', 'pg-history__option', () => {
          void pickGroup(grouping.value);
        });

        option.setAttribute('role', 'menuitemradio');
        option.setAttribute('aria-checked', String(grouping.value === state.group));
        option.append(element('span', 'pg-history__option-label', grouping.label), icon(IconCheck, 'pg-history__check'));

        return option;
      })
    );
    menu.firstElementChild?.setAttribute('aria-hidden', 'true');
  };

  const menuItems = (): HTMLButtonElement[] => Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));

  const openMenu = (): void => {
    drawGroup();
    menu.hidden = false;
    groupButton.setAttribute('aria-expanded', 'true');
    (menuItems().find((option) => option.getAttribute('aria-checked') === 'true') ?? menuItems()[0]).focus();
  };

  const closeMenu = (refocus = false): void => {
    menu.hidden = true;
    groupButton.setAttribute('aria-expanded', 'false');

    if (refocus) {
      groupButton.focus();
    }
  };

  menu.addEventListener('keydown', (event) => {
    const items = menuItems();
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];

    if (step === undefined || !(event.target instanceof HTMLButtonElement)) {
      return;
    }

    event.preventDefault();
    items[(items.indexOf(event.target) + step + items.length) % items.length].focus();
  });

  // Only a focus move to another element closes it: Safari blurs to nothing on a button click.
  groupBar.addEventListener('focusout', (event) => {
    if (!menu.hidden && event.relatedTarget instanceof Node && !groupBar.contains(event.relatedTarget)) {
      closeMenu();
    }
  });

  document.addEventListener('pointerdown', (event) => {
    if (!menu.hidden && event.target instanceof Node && !groupBar.contains(event.target)) {
      closeMenu();
    }
  }, { capture: true });

  const drawBanner = (): void => {
    const row = state.selected;

    if (row === null) {
      banner.replaceChildren();

      return;
    }

    const controls = element('span', 'pg-history-banner__controls');
    const restoreButton = textButton('Restore', 'pg-history__button pg-history__button--primary', () => {
      void openDialog(row);
    });

    restoreButton.setAttribute('data-pg-history-begin-restore', '');
    restoreButton.disabled = state.busy;
    controls.append(restoreButton);

    const error = element('p', 'pg-history-banner__error', state.error);

    error.setAttribute('role', 'alert');
    error.hidden = state.error === '';
    banner.replaceChildren(element('span', 'pg-history-banner__text', `Viewing ${row.time}. Read only.`), controls, error);
  };

  const drawNote = (row: VersionRow): void => {
    const author = row.who === '' || row.who === 'No author recorded' ? row.who : `Edited by ${row.who}`;
    const parts: HTMLElement[] = [element('span', 'pg-history-note__when', author === '' ? row.time : `${row.time} · ${author}`)];

    if (row.below !== null) {
      const label = element('label', 'pg-history-note__key');
      const toggle = element('input', 'pg-history-note__toggle');

      toggle.type = 'checkbox';
      toggle.checked = state.showChanges;
      toggle.addEventListener('change', () => {
        state.showChanges = toggle.checked;
        void drawPreview(row);
      });
      label.append(toggle, ' Show changes');
      parts.push(label);

      if (state.showChanges) {
        (['added', 'removed', 'changed', 'moved'] as const).forEach((mark) => {
          const key = element('span', 'pg-history-note__key');
          const swatch = element('i', `pg-history-note__swatch pg-history-note__swatch--${mark}`);

          key.append(swatch, mark[0].toUpperCase() + mark.slice(1));
          parts.push(key);
        });
      }
    }

    note.replaceChildren(...parts);
  };

  const drawPreview = async (row: VersionRow): Promise<void> => {
    const doc = state.doc;
    const request = ++state.request;

    if (doc === null) {
      return;
    }

    try {
      const data = await readPoint(doc, row);
      const before = state.showChanges && row.below !== null ? await readPoint(doc, row.below) : null;

      if (request !== state.request) {
        return;
      }

      const preview = before === null
        ? { blocks: data.blocks, marks: {} }
        : changePreview(before, data, options.view.diffOutputData);

      render.innerHTML = options.view.blocksToHtml({ blocks: preview.blocks }, {
        toolAttributes: true,
        blockIds: true,
        // view.css paints only under [data-blok-interface] and on the editor's classes.
        root: true,
        classes: true,
      });
      paintMarks(render, preview.marks);
      drawNote(row);
      jumpToChange(render);
    } catch (error) {
      if (request === state.request) {
        state.error = messageOf(error);
        drawBanner();
      }
    }
  };

  const select = async (row: VersionRow): Promise<void> => {
    state.selected = row;
    state.error = '';
    drawRows();

    if (row.current) {
      state.request++;
      showEditor();

      return;
    }

    drawBanner();
    note.replaceChildren();
    render.replaceChildren();
    showPreview();
    await drawPreview(row);
  };

  const bookmarkAnswer = (marks: HistoryBookmark[] | null): { rows: HistoryRow[]; message: string } => {
    const rows = bookmarkRows(marks ?? [], { now: now() });

    if (marks === null) {
      return { rows, message: 'The page host did not answer.' };
    }

    return { rows, message: rows.length === 0 ? NO_BOOKMARKS : '' };
  };

  const versionsAnswer = async (doc: string): Promise<{ rows: HistoryRow[]; message: string }> => {
    try {
      const response = await send(doc, `${base(doc)}?group=${state.group}`);
      const rows = historyRows(await response.json() as HistoryList, { now: now(), self: options.self() });

      return { rows, message: rows.length === 0 ? 'No versions yet.' : '' };
    } catch (error) {
      return { rows: [], message: messageOf(error) };
    }
  };

  /** Loads the rows for the current grouping. False when a newer load took over. */
  const load = async (): Promise<boolean> => {
    const doc = state.doc;
    const ticket = ++state.load;

    if (doc === null) {
      return false;
    }

    status.textContent = 'Loading history…';

    const bookmarks = readBookmarks(doc);
    const { rows, message } = state.group === 'bookmarks'
      ? bookmarkAnswer(await bookmarks)
      : await versionsAnswer(doc);
    const marks = await bookmarks;

    if (ticket !== state.load) {
      return false;
    }

    state.rows = rows;
    state.bookmarks = marks ?? [];
    status.textContent = message;
    drawRows();

    return true;
  };

  /** Selects what a fresh list opens on: the version before the current one. */
  const selectFirst = async (): Promise<void> => {
    if (state.group === 'bookmarks') {
      return;
    }

    const versions = state.rows.filter((row): row is VersionRow => row.kind === 'version');
    const first = versions[1] ?? versions[0];

    if (first !== undefined) {
      await select(first);
    }
  };

  const pickGroup = async (value: HistoryGrouping): Promise<void> => {
    closeMenu(true);
    state.group = value;
    saveGrouping(value);
    drawGroup();

    const request = ++state.request;

    state.selected = null;
    state.error = '';
    showEditor();

    // Closed, or another pick, while the list loaded.
    if (await load() && !panel.hidden && state.request === request) {
      await selectFirst();
    }
  };

  const flipBookmark = async (row: VersionRow): Promise<void> => {
    const doc = state.doc;
    const url = doc === null ? null : bookmarksUrl(doc);

    if (doc === null || url === null) {
      return;
    }

    // Another tab may have changed the list since this one loaded it.
    const fresh = await readBookmarks(doc) ?? state.bookmarks;
    const saved = await readBookmarks(doc, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toggleBookmark(fresh, { lineage: row.lineage, sequence: row.sequence, savedAt: row.at })),
    });

    if (saved === null || state.doc !== doc) {
      status.textContent = saved === null ? 'The page host did not answer.' : status.textContent;

      return;
    }

    state.bookmarks = saved;

    if (state.group === 'bookmarks') {
      state.rows = bookmarkRows(saved, { now: now() });
      status.textContent = state.rows.length === 0 ? NO_BOOKMARKS : '';
    }

    const selector = `[data-bookmark="${CSS.escape(row.key)}"]`;
    const hadFocus = document.activeElement?.matches(selector) === true;

    drawRows();

    if (hadFocus) {
      list.querySelector<HTMLButtonElement>(selector)?.focus();
    }
  };

  /* Restore dialog */

  const inerted: HTMLElement[] = [];

  const closeDialog = (): void => {
    if (dialog.hidden) {
      return;
    }

    dialog.hidden = true;
    state.restoring = false;
    inerted.splice(0).forEach((node) => node.removeAttribute('inert'));
    banner.querySelector<HTMLButtonElement>('[data-pg-history-begin-restore]')?.focus();
  };

  const drawDialog = (row: VersionRow, subPages: string[]): void => {
    const title = element('h2', 'pg-history-dialog__title');
    const primary = textButton('Restore this version', 'pg-history__button pg-history__button--primary pg-history-dialog__primary', () => {
      void restore(row);
    });
    const cancel = textButton('Cancel', 'pg-history__button', () => closeDialog());
    const section = (heading: string, items: string[]): HTMLElement => {
      const part = element('section', 'pg-history-dialog__section');
      const lines = element('ul', 'pg-history-dialog__items');

      lines.append(...items.map((text) => element('li', 'pg-history-dialog__item', text)));
      part.append(element('h3', 'pg-history-dialog__heading', heading), lines);

      return part;
    };

    title.id = 'pg-history-dialog-title';
    title.append('Restore ', element('strong', '', titleOf(null)), ' to ', element('strong', '', row.time));

    const parts: HTMLElement[] = [
      title,
      section('What will be restored', [
        'Page content — text, blocks, and everything nested in them, including database rows',
        'Page title and icon',
      ]),
    ];

    if (subPages.length > 0) {
      const unchanged = section('Will remain unchanged', subPages.map((pageId) => titleOf(pageId)));

      unchanged.append(element('p', 'pg-history-dialog__note', 'Sub-pages keep their own history.'));
      parts.push(unchanged);
    }

    const actions = element('div', 'pg-history-dialog__actions');

    actions.append(primary, cancel);
    [primary, cancel].forEach((button) => button.toggleAttribute('disabled', state.busy));
    parts.push(actions, element('p', 'pg-history-dialog__footnote', 'This will not delete any other versions and you can always restore again.'));
    card.replaceChildren(...parts);
  };

  const openDialog = async (row: VersionRow): Promise<void> => {
    const doc = state.doc;

    if (doc === null) {
      return;
    }

    state.error = '';
    drawBanner();

    // The sub-page list is a courtesy; the restore itself does not need it.
    const subPages = await readPoint(doc, row).then((data) => subPagesOf(data.blocks), () => []);

    if (state.selected?.key !== row.key || panel.hidden) {
      return;
    }

    drawDialog(row, subPages);
    state.restoring = true;
    Array.from(document.body.children).forEach((node) => {
      if (node !== dialog && node instanceof HTMLElement && !node.inert) {
        node.setAttribute('inert', '');
        inerted.push(node);
      }
    });
    dialog.hidden = false;
    card.querySelector<HTMLButtonElement>('.pg-history-dialog__primary')?.focus();
  };

  const restore = async (row: VersionRow): Promise<void> => {
    const doc = state.doc;

    if (doc === null) {
      return;
    }

    state.busy = true;
    card.querySelectorAll('button').forEach((button) => button.setAttribute('disabled', ''));

    try {
      await send(doc, `${base(doc)}/${encodeURIComponent(row.lineage)}/${row.sequence}/restore`, {
        method: 'POST',
        headers: { 'Blok-Idempotency-Key': idempotencyKey() },
      });
      state.busy = false;
      closeDialog();
      state.selected = null;
      showEditor();
      await load();
      state.selected = state.rows.find((candidate): candidate is VersionRow => candidate.kind === 'version' && candidate.current) ?? null;
      drawRows();
      options.notify(`Restored ${row.time}. It is now the newest version.`);
    } catch (error) {
      state.busy = false;
      closeDialog();
      state.error = messageOf(error);
      drawBanner();
    }
  };

  const open = async (): Promise<void> => {
    const doc = options.doc();
    const request = ++state.request;

    state.doc = doc;

    if (doc === null) {
      return;
    }

    panel.hidden = false;
    document.body.classList.add('pg-history-open');
    options.button.setAttribute('aria-expanded', 'true');
    drawGroup();
    await load();

    // Closed, or opened again on another document, while the list loaded.
    if (panel.hidden || state.doc !== doc || state.request !== request) {
      return;
    }

    await selectFirst();
  };

  const close = (): void => {
    state.request++;
    state.selected = null;
    state.error = '';
    closeDialog();
    closeMenu();
    panel.hidden = true;
    document.body.classList.remove('pg-history-open');
    options.button.setAttribute('aria-expanded', 'false');
    showEditor();
  };

  options.button.addEventListener('click', () => {
    if (panel.hidden) {
      void open();
    } else {
      close();
    }
  });

  // The drawer is the topmost layer, so it takes Escape first, unless a Blok
  // menu or dialog is open. Window capture runs before Blok's document-capture
  // keyboard controller, which would otherwise stop the event and select the
  // block; stopping it here keeps one Escape to one layer.
  // Other chrome (settings, page tree) handles an Escape aimed at its own controls.
  const isOurs = (target: EventTarget | null): boolean =>
    target === document.body || target === document.documentElement
    || (target instanceof Node && [panel, previewPane, editorArea].some((area) => area.contains(target)));

  const take = (event: KeyboardEvent, action: () => void): void => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !panel.isConnected || panel.hidden) {
      return;
    }

    const target = event.target;
    const isBody = target === document.body || target === document.documentElement;

    // The dialog and the Group by menu sit above the drawer: each Escape closes one.
    if (!dialog.hidden && (isBody || (target instanceof Node && dialog.contains(target)))) {
      take(event, closeDialog);

      return;
    }

    if (!menu.hidden && target instanceof Node && groupBar.contains(target)) {
      take(event, () => closeMenu(true));

      return;
    }

    const inMenu = target instanceof Element && target.closest(BLOK_MENUS) !== null;

    if (inMenu || !isOurs(target) || document.querySelector(OPEN_MENU) !== null) {
      return;
    }

    take(event, close);
  }, { capture: true });

  return { open, close };
};
