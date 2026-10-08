/**
 * Version history for the dev playground: a drawer that lists the sync
 * server's versions of the open document, previews one read-only with its
 * changes marked, and restores it.
 *
 * The pure helpers come first; `mountHistoryDrawer` wires them to the page.
 */
import './history-drawer.css';
import { IconBookmark, IconCheck, IconChevronDown, IconChevronRight } from '../components/icons';
import { createTicketSource } from '../components/utils/access-pass';
import { prefersReducedMotion } from '../components/utils/reduced-motion';
import type { TicketSource } from '../components/utils/access-pass';
import { changesUrl, fetchVersionChanges, mountVersionChanges, notVisualizableNote } from './history-changes';
import type { RecordPaint, VersionChangesPanel } from './history-changes';
import { loadUpdates, mountEditedLink, mountUpdatesFeed } from './updates-feed';
import type { UpdatesFeed } from './updates-feed';
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

/** What the drawer shows: the version list, one version's edits, or the Updates feed. */
export type HistoryDrawerMode = 'list' | 'changes' | 'updates';

/**
 * The `@bloklabs/core/view` functions the drawer uses. Handed in by the
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
  blocksToPlainText(data: LooseOutputData): string;
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

/**
 * Where a version's edits start: the row below it in the same lineage, else
 * the lineage's start. A bookmark's `below` is already the point before it.
 * @param row - the version
 */
export const changesSince = (row: Extract<HistoryRow, { kind: 'version' }>): number =>
  row.below !== null && row.below.lineage === row.lineage ? row.below.sequence : 0;

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
  /** After a restore: the restored point's page and values maps, for a host that keeps its own page record. */
  onRestored?: (fields: PointFields) => void;
  now?: () => Date;
  idempotencyKey?: () => string;
}

/** A point's `page` and `values` maps, as the version read sends them. */
export interface PointFields {
  page?: Record<string, unknown>;
  values?: Record<string, unknown>;
}

export interface HistoryDrawer {
  open(): Promise<void>;
  /**
   * Opens the version list on one point. When the current grouping has no
   * row for it, switches to 1-minute groups for this visit only.
   */
  openOn(lineage: string, sequence: number): Promise<void>;
  /** `refresh: false` skips the Edited link update: a page switch refreshes for the new page itself. */
  close(options?: { refresh?: boolean }): void;
  /** Re-reads the open document's newest version for the "Edited …" link. */
  refresh(): Promise<void>;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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
  const points = new Map<string, LooseOutputData & PointFields>();
  const savedGrouping = readGrouping(host !== null);
  const state = {
    mode: 'list' as HistoryDrawerMode,
    doc: null as string | null,
    group: savedGrouping,
    // The person's pick. `group` differs from it only during an openOn fallback.
    chosen: savedGrouping,
    rows: [] as HistoryRow[],
    bookmarks: [] as HistoryBookmark[],
    selected: null as VersionRow | null,
    showChanges: true,
    restoring: false,
    // The dialog is reading the version to list its sub-pages.
    opening: false,
    busy: false,
    error: '',
    // Bumped on every selection: a slow answer for an older pick must not paint.
    request: 0,
    // Bumped on every list load: a slow list for an older grouping must not paint.
    load: 0,
    // Bumped on every Edited link refresh.
    edited: 0,
    // The edit picked in 'changes' mode; undefined paints the whole version.
    picked: undefined as RecordPaint | null | undefined,
    // The version whose edits are listed.
    changesRow: null as VersionRow | null,
    // A preview is on its way: a picked edit waits for it rather than painting the old one.
    previewLoading: false,
  };
  const mounted = {
    changes: null as VersionChangesPanel | null,
    feed: null as UpdatesFeed | null,
    note: null as HTMLElement | null,
  };

  const panel = element('aside', 'pg-history');
  const head = element('div', 'pg-history__head');
  const tablist = element('div', 'pg-history__tabs');
  const tabPair = (name: string, label: string): { tab: HTMLButtonElement; tabPanel: HTMLDivElement } => {
    const tab = element('button', 'pg-history__tab', label);
    const tabPanel = element('div', `pg-history__tabpanel pg-history__tabpanel--${name}`);

    tab.type = 'button';
    tab.id = `pg-history-tab-${name}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `pg-history-panel-${name}`);
    tabPanel.id = `pg-history-panel-${name}`;
    tabPanel.setAttribute('role', 'tabpanel');
    tabPanel.setAttribute('aria-labelledby', tab.id);

    return { tab, tabPanel };
  };
  const { tab: historyTab, tabPanel: historyPanel } = tabPair('history', 'History');
  const { tab: updatesTab, tabPanel: updatesPanel } = tabPair('updates', 'Updates');
  const changesHost = element('div', 'pg-history__changes');
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
  const docBox = element('div', 'pg-history-doc');
  const dialog = element('div', 'pg-history-dialog');
  const card = element('div', 'pg-history-dialog__card');

  panel.setAttribute('data-pg-history', '');
  panel.id = 'pg-history';
  panel.setAttribute('aria-label', 'Version history');
  panel.hidden = true;
  status.setAttribute('role', 'status');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Version history');
  historyTab.addEventListener('click', () => {
    void showHistory();
  });
  updatesTab.addEventListener('click', () => enterUpdates());
  tablist.append(historyTab, updatesTab);
  head.append(tablist, textButton('Close', 'pg-history__button', () => close()));

  groupButton.setAttribute('aria-haspopup', 'menu');
  groupButton.setAttribute('aria-expanded', 'false');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Group changes by');
  menu.hidden = true;
  groupBar.append(groupButton, menu);
  historyPanel.append(groupBar, status, list, changesHost);
  panel.append(head, historyPanel, updatesPanel);

  previewPane.setAttribute('data-pg-history-preview', '');
  previewPane.setAttribute('aria-label', 'Version preview');
  previewPane.hidden = true;
  // index.html scopes view.css to this id.
  render.id = 'pg-history-render';
  docBox.append(note, render);
  previewPane.append(banner, docBox);

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

  const readPoint = async (doc: string, point: HistoryPoint): Promise<LooseOutputData & PointFields> => {
    const key = `${doc}\n${point.lineage}:${point.sequence}`;
    const cached = points.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const response = await send(doc, `${base(doc)}/${encodeURIComponent(point.lineage)}/${point.sequence}`);
    const body: unknown = await response.json();
    const field = (key: string): Record<string, unknown> | undefined => {
      const value = isRecord(body) ? body[key] : undefined;

      return isRecord(value) ? value : undefined;
    };
    const blocks = isRecord(body) && Array.isArray(body.blocks) ? body.blocks as LooseOutputBlockData[] : [];
    const page = field('page');
    const values = field('values');
    const data = { blocks, ...(page === undefined ? {} : { page }), ...(values === undefined ? {} : { values }) };

    points.set(key, data);

    return data;
  };

  const bookmarksUrl = (doc: string): string | null => host === null ? null : `${host}/bookmarks/${encodeURIComponent(doc)}`;

  /** The host's bookmarks, or what went wrong: no host, no answer, or the host's refusal. */
  const askBookmarks = async (doc: string, init?: RequestInit): Promise<HistoryBookmark[] | string> => {
    const url = bookmarksUrl(doc);

    if (url === null) {
      return 'There is no page host.';
    }

    try {
      const response = await fetch(url, init);

      if (!response.ok) {
        const text = (await response.text()).trim();

        return text === '' ? `The page host refused the bookmark (${response.status}).` : `${text} (${response.status})`;
      }

      const body: unknown = await response.json();

      return isBookmarkList(body) ? body : 'The page host sent a list it could not read.';
    } catch {
      return 'The page host did not answer.';
    }
  };

  /** The host's bookmarks, or null when there is no host or it did not answer. */
  const readBookmarks = async (doc: string): Promise<HistoryBookmark[] | null> => {
    const answer = await askBookmarks(doc);

    return typeof answer === 'string' ? null : answer;
  };

  const { editorArea } = options;

  const dropNote = (): void => {
    mounted.note?.remove();
    mounted.note = null;
  };

  const showEditor = (): void => {
    dropNote();
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

    const more = textButton('', 'pg-history__more', () => {
      void showChanges(row);
    });

    more.setAttribute('data-changes', row.key);
    more.setAttribute('aria-label', 'See all changes in version');
    more.append(icon(IconChevronRight, 'pg-history__more-icon'));
    item.append(more);

    return item;
  };

  const drawList = (): void => {
    list.replaceChildren(...state.rows.map((row) =>
      row.kind === 'lineage' ? element('li', 'pg-history__lineage', row.label) : versionItem(row)
    ));
  };

  // The changes panel and the feed draw themselves.
  const views: Record<HistoryDrawerMode, () => void> = { list: drawList, changes: () => undefined, updates: () => undefined };

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
    const index = event.target instanceof HTMLButtonElement ? items.indexOf(event.target) : -1;
    const moves: Record<string, number | undefined> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1 + items.length,
      Home: 0,
      End: items.length - 1,
    };
    const next = moves[event.key];

    if (next === undefined || index < 0) {
      return;
    }

    event.preventDefault();
    items[next % items.length].focus();
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
    restoreButton.disabled = state.busy || state.opening;

    // The current version is shown only while its edits are listed: nothing to restore.
    if (!row.current) {
      controls.append(restoreButton);
    }

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

    state.previewLoading = true;

    try {
      const data = await readPoint(doc, row);
      const before = state.showChanges && row.below !== null ? await readPoint(doc, row.below) : null;

      if (request !== state.request) {
        return;
      }

      state.previewLoading = false;

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
      drawNote(row);

      if (state.picked === undefined) {
        paintMarks(render, preview.marks);
        jumpToChange(render);
      } else {
        paintPicked();
      }
    } catch (error) {
      if (request === state.request) {
        state.previewLoading = false;
        state.error = messageOf(error);
        drawBanner();
      }
    }
  };

  /** Marks only the picked edit's blocks, or says it cannot be shown. */
  const paintPicked = (): void => {
    const paint = state.picked;

    dropNote();
    render.querySelectorAll('[data-pg-change]').forEach((node) => node.removeAttribute('data-pg-change'));

    if (paint === undefined) {
      return;
    }

    if (paint !== null) {
      paintMarks(render, paint.marks);
    }

    // Its blocks may be missing from the preview: one added and removed inside the version never renders.
    if (paint === null || jumpToChange(render) === null) {
      mounted.note = notVisualizableNote();
      docBox.append(mounted.note);
    }
  };

  /** `preview` shows even the current version read only, for its edits list. */
  const select = async (row: VersionRow, preview = false): Promise<void> => {
    state.selected = row;
    state.error = '';
    state.picked = undefined;
    dropNote();
    drawRows();

    if (row.current && !preview) {
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
    state.chosen = value;
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
    const saved = await askBookmarks(doc, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toggleBookmark(fresh, { lineage: row.lineage, sequence: row.sequence, savedAt: row.at })),
    });

    if (state.doc !== doc) {
      return;
    }

    if (typeof saved === 'string') {
      status.textContent = saved;

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

  /** `refocus` only when the preview stays up: Cancel, Escape, a failed restore. */
  const closeDialog = (refocus = false): void => {
    if (dialog.hidden) {
      return;
    }

    dialog.hidden = true;
    state.restoring = false;
    inerted.splice(0).forEach((node) => node.removeAttribute('inert'));

    if (refocus) {
      banner.querySelector<HTMLButtonElement>('[data-pg-history-begin-restore]')?.focus();
    }
  };

  const drawDialog = (row: VersionRow, subPages: string[]): void => {
    const title = element('h2', 'pg-history-dialog__title');
    const primary = textButton('Restore this version', 'pg-history__button pg-history__button--primary pg-history-dialog__primary', () => {
      void restore(row);
    });
    const cancel = textButton('Cancel', 'pg-history__button', () => closeDialog(true));
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

    if (doc === null || state.opening || state.restoring) {
      return;
    }

    state.error = '';
    state.opening = true;
    drawBanner();

    // The sub-page list is a courtesy; the restore itself does not need it.
    const subPages = await readPoint(doc, row).then((data) => subPagesOf(data.blocks), () => []);

    state.opening = false;
    drawBanner();

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

  /**
   * The live doc now holds the point's page fields; a host that keeps its own
   * page record follows. Skipped once another page is open: the host writes to the open page.
   */
  const handOver = async (doc: string, row: VersionRow): Promise<void> => {
    const restored = options.onRestored === undefined ? null : await readPoint(doc, row).catch(() => null);

    if (restored === null || options.doc() !== doc) {
      return;
    }

    options.onRestored?.({
      ...(restored.page === undefined ? {} : { page: restored.page }),
      ...(restored.values === undefined ? {} : { values: restored.values }),
    });
  };

  /** The list after a restore, with focus on the new current row. */
  const showRestored = async (): Promise<void> => {
    await load();
    state.selected = state.rows.find((candidate): candidate is VersionRow => candidate.kind === 'version' && candidate.current) ?? null;
    drawRows();
    // The dialog's button had focus and is gone.
    const current = state.selected === null ? null : list.querySelector<HTMLButtonElement>(`[data-key="${CSS.escape(state.selected.key)}"]`);

    (current ?? options.button).focus();
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
    } catch (error) {
      state.busy = false;
      state.error = messageOf(error);
      drawBanner();
      closeDialog(true);

      return;
    }

    state.busy = false;
    closeDialog();
    state.selected = null;
    showEditor();
    await handOver(doc, row);
    // The restore is done; a list that fails to reload must not read as a failed restore.
    await showRestored().catch(() => undefined);
    void refresh();
    options.notify(`Restored ${row.time}. It is now the newest version.`);
  };

  const showPanel = (): void => {
    panel.hidden = false;
    document.body.classList.add('pg-history-open');
    options.button.setAttribute('aria-expanded', 'true');
    drawGroup();
  };

  const open = async (): Promise<void> => {
    const doc = options.doc();
    const request = ++state.request;

    state.doc = doc;

    if (doc === null) {
      return;
    }

    state.group = state.chosen;
    setMode('list');
    showPanel();
    await load();

    // Closed, or opened again on another document, while the list loaded.
    if (panel.hidden || state.doc !== doc || state.request !== request) {
      return;
    }

    await selectFirst();
  };

  /**
   * `focus` moves focus to the version's row: the Updates card that asked is gone.
   * `first` is the grouping to try before the 1-minute fallback; the person's by default.
   */
  const showVersion = async (lineage: string, sequence: number, focus: boolean, first: HistoryGrouping = state.chosen): Promise<void> => {
    const doc = options.doc();
    const request = ++state.request;
    const key = `${lineage}:${sequence}`;
    const find = (): VersionRow | undefined =>
      state.rows.find((row): row is VersionRow => row.kind === 'version' && row.key === key);
    const stale = (): boolean => panel.hidden !== false || state.doc !== doc || state.request !== request;

    state.doc = doc;
    // An earlier jump's 1-minute fallback must not stick.
    state.group = first;
    setMode('list');

    if (doc === null) {
      close();

      return;
    }

    closeDialog();
    closeMenu();
    showPanel();

    if (focus) {
      historyTab.focus();
    }
    await load();

    if (stale()) {
      return;
    }

    if (find() === undefined && state.group !== '1') {
      // Not saved, and `chosen` stays: open() puts the person's grouping back.
      state.group = '1';
      drawGroup();
      await load();

      if (stale()) {
        return;
      }
    }

    await select(find() ?? {
      kind: 'version',
      key,
      lineage,
      sequence,
      time: formatVersionTime(null, now()),
      who: '',
      current: false,
      at: null,
      below: sequence > 0 ? { lineage, sequence: sequence - 1 } : null,
    });

    // select() bumps the request, so stale() no longer fits here.
    if (focus && !panel.hidden && state.doc === doc) {
      list.querySelector<HTMLButtonElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
    }
  };

  const openOn = (lineage: string, sequence: number): Promise<void> => showVersion(lineage, sequence, false);

  const close = ({ refresh: update = true }: { refresh?: boolean } = {}): void => {
    const wasOpen = !panel.hidden;

    state.request++;
    state.selected = null;
    state.error = '';
    closeDialog();
    closeMenu();
    setMode('list');
    panel.hidden = true;
    document.body.classList.remove('pg-history-open');
    options.button.setAttribute('aria-expanded', 'false');
    showEditor();

    if (wasOpen && update) {
      void refresh();
    }
  };

  /* Modes: the History tab's list and edits, and the Updates tab */

  const setMode = (mode: HistoryDrawerMode): void => {
    if (mode !== 'changes') {
      mounted.changes?.destroy();
      mounted.changes = null;
      state.changesRow = null;
      state.picked = undefined;
      dropNote();
    }

    if (mode !== 'updates') {
      mounted.feed?.destroy();
      mounted.feed = null;
    }

    state.mode = mode;
    [historyTab, updatesTab].forEach((tab) => {
      const picked = (tab === updatesTab) === (mode === 'updates');

      tab.setAttribute('aria-selected', String(picked));
      tab.setAttribute('tabindex', picked ? '0' : '-1');
    });
    historyPanel.hidden = mode === 'updates';
    updatesPanel.hidden = mode !== 'updates';
    [groupBar, status, list].forEach((part) => part.toggleAttribute('hidden', mode !== 'list'));
    changesHost.hidden = mode !== 'changes';
    drawRows();
  };

  const nameOf = (actor: string | null): string => actor === null ? 'Someone' : actorName(actor, options.self());

  const showChanges = async (row: VersionRow): Promise<void> => {
    const doc = state.doc;

    if (doc === null) {
      return;
    }

    closeMenu();
    setMode('changes');
    state.changesRow = row;
    mounted.changes = mountVersionChanges(changesHost, {
      version: { time: row.time, who: row.who },
      // The server answers an empty list for sequence 0; skip the trip.
      load: () => row.sequence === 0
        ? Promise.resolve({ changes: [], truncated: false })
        : fetchVersionChanges((url) => send(doc, url), changesUrl(options.server, doc, row.lineage, row.sequence, changesSince(row))),
      nameOf,
      now,
      onBack: () => leaveChanges(),
      onSelectRecord: (_record, paint) => {
        state.picked = paint;

        // drawPreview paints the pick when the preview lands.
        if (!state.previewLoading) {
          paintPicked();
        }
      },
    });
    changesHost.querySelector<HTMLButtonElement>('[data-pg-changes-back]')?.focus();
    await select(row, true);
  };

  const leaveChanges = (): void => {
    const row = state.changesRow;

    setMode('list');

    if (row === null) {
      return;
    }

    // select() redraws the rows before its first await, so the focus below lands on the new button.
    void select(row);
    list.querySelector<HTMLButtonElement>(`[data-changes="${CSS.escape(row.key)}"]`)?.focus();
  };

  const showHistory = async (): Promise<void> => {
    if (state.mode === 'changes') {
      leaveChanges();

      return;
    }

    if (state.mode !== 'updates') {
      return;
    }

    const request = ++state.request;

    setMode('list');
    await load();

    if (panel.hidden || state.request !== request) {
      return;
    }

    await selectFirst();
  };

  /** A list from a time grouping. The feed needs one: in Bookmarks the row below is unrelated. */
  const readList = async (doc: string, group: HistoryGrouping | null): Promise<HistoryList> => {
    const response = await send(doc, group === null ? base(doc) : `${base(doc)}?group=${group}`);

    return await response.json() as HistoryList;
  };

  const scrollToBlock = (id: string): void => {
    state.request++;
    state.selected = null;
    showEditor();
    // The live editor only: the preview stamps the same ids.
    editorArea.querySelector<HTMLElement>(`[data-blok-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  const enterUpdates = (): void => {
    const doc = state.doc;

    if (doc === null || state.mode === 'updates') {
      return;
    }

    state.request++;
    state.selected = null;
    state.error = '';
    closeDialog();
    closeMenu();
    showEditor();
    setMode('updates');
    const feedGroup = state.group === 'bookmarks' ? DEFAULT_GROUPING : state.group;

    mounted.feed = mountUpdatesFeed(updatesPanel, {
      load: async () => loadUpdates(
        (url) => send(doc, url),
        options.server,
        doc,
        await readList(doc, feedGroup),
        now()
      ),
      nameOf,
      pageTitle: () => titleOf(null),
      plainText: options.view.blocksToPlainText,
      now,
      onOpenVersion: (lineage, sequence) => {
        void showVersion(lineage, sequence, true, feedGroup);
      },
      onScrollToBlock: scrollToBlock,
    });
  };

  tablist.addEventListener('keydown', (event) => {
    const tabs = [historyTab, updatesTab];
    const index = event.target instanceof HTMLButtonElement ? tabs.indexOf(event.target) : -1;
    const moves: Record<string, number | undefined> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1 + tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const next = moves[event.key];

    if (next === undefined || index < 0) {
      return;
    }

    event.preventDefault();

    const tab = tabs[next % tabs.length];

    tab.focus();
    tab.click();
  });

  /* The "Edited …" link beside the History button */

  const openUpdates = (): void => {
    state.doc = options.doc();

    if (state.doc === null) {
      return;
    }

    state.group = state.chosen;
    // From 'list', so enterUpdates mounts a fresh feed for this document.
    setMode('list');
    showPanel();
    enterUpdates();
    updatesTab.focus();
  };

  const edited = mountEditedLink({ onOpen: openUpdates, now });

  options.button.before(edited.element);

  const refresh = async (): Promise<void> => {
    const doc = options.doc();
    const ticket = ++state.edited;

    // No `group`: the newest version ends at the newest record in every grouping.
    const answer = doc === null ? null : await readList(doc, null).catch(() => null);

    if (ticket === state.edited) {
      edited.update(answer);
    }
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
      take(event, () => closeDialog(true));

      return;
    }

    if (!menu.hidden && (isBody || (target instanceof Node && groupBar.contains(target)))) {
      take(event, () => closeMenu(true));

      return;
    }

    const inMenu = target instanceof Element && target.closest(BLOK_MENUS) !== null;

    if (inMenu || !isOurs(target) || document.querySelector(OPEN_MENU) !== null) {
      return;
    }

    // The edits list sits over the version list: Escape goes back to it first.
    take(event, state.mode === 'changes' ? leaveChanges : close);
  }, { capture: true });

  setMode('list');

  return { open, openOn, close, refresh };
};
