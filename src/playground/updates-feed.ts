/**
 * The Updates feed of the playground's history drawer: one card per journal
 * record across the newest versions, with inline word diffs, plus the
 * "Edited <time>" header link that opens it.
 *
 * It imports nothing from history-drawer.ts: the drawer imports this module.
 */
import './history-panels.css';
import { IconRotateLeft } from '../components/icons';
import { avatar, blockName, changesUrl, fetchVersionChanges } from './history-changes';
import type { ChangeBlock, ChangeKind, ChangeRecord, HistoryRequest } from './history-changes';
import type { LooseOutputBlockData } from '../../types';

/** The part of the drawer's `HistoryList` this module reads. */
export interface VersionListLike {
  versions: Array<{ lineage: string; sequence: number; startedAt: number | null; savedAt: number | null }>;
}

export interface UpdateSource {
  lineage: string;
  sequence: number;
  since: number;
}

/** One record and the version it belongs to. */
export interface UpdateItem {
  lineage: string;
  sequence: number;
  /** Set on the oldest record of a version the server cut to its newest 200. */
  truncated: boolean;
  record: ChangeRecord;
}

/** What {@link loadUpdates} answers: the records that loaded, and one line per version that did not. */
export interface UpdatesLoad {
  items: UpdateItem[];
  failed: string[];
}

export interface DiffPart {
  text: string;
  kind: 'same' | 'added' | 'removed';
}

export interface BlockSnippet {
  id: string;
  kind: ChangeKind;
  parts: DiffPart[];
  /** Set when the block has no text: "An image". */
  label?: string;
}

export interface UpdateCard {
  key: string;
  who: string;
  title: string;
  when: string;
  version: { lineage: string; sequence: number };
  snippets: BlockSnippet[];
  /** How many snippets show before "View N more". */
  shown: number;
  truncated: boolean;
}

/** `blocksToPlainText` from `@bloklabs/core/view`, handed in: the view-entry law keeps src/view out of this module. */
export type PlainText = (data: { blocks: LooseOutputBlockData[] }) => string;

const FEED_VERSIONS = 3;
const SNIPPETS_SHOWN = 4;
/** Word-diff table cells; past this the texts show as one removal and one addition. */
const DIFF_CELL_LIMIT = 250_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const plural = (count: number, unit: string): string => `${count} ${unit}${count === 1 ? '' : 's'} ago`;

/**
 * "just now", "5 minutes ago", "21 hours ago", "3 days ago", then a date.
 * @param ms - Unix milliseconds
 * @param now - the current time
 * @param locale - for the date; defaults to the browser's
 */
export const relativeTime = (ms: number, now: Date, locale?: string): string => {
  const elapsed = Math.max(0, now.getTime() - ms);

  if (elapsed < MINUTE) {
    return 'just now';
  }

  if (elapsed < HOUR) {
    return plural(Math.floor(elapsed / MINUTE), 'minute');
  }

  if (elapsed < DAY) {
    return plural(Math.floor(elapsed / HOUR), 'hour');
  }

  if (elapsed < 7 * DAY) {
    return plural(Math.floor(elapsed / DAY), 'day');
  }

  const date = new Date(ms);

  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date);
};

/**
 * "Edited 5 minutes ago" from the newest version, or null when there is none to date.
 * @param list - the drawer's history list, or null when history is unavailable
 * @param now - the current time
 */
export const editedLabel = (list: VersionListLike | null, now: Date): string | null => {
  const newest = list?.versions[0];
  const at = newest?.savedAt ?? newest?.startedAt ?? null;

  return at === null ? null : `Edited ${relativeTime(at, now)}`;
};

/**
 * The newest versions to read, each measured from the version below it.
 * @param list - the drawer's history list, newest first
 */
export const updateSources = (list: VersionListLike): UpdateSource[] =>
  list.versions
    .map((version, index): UpdateSource => {
      const below = list.versions[index + 1];

      return {
        lineage: version.lineage,
        sequence: version.sequence,
        since: below !== undefined && below.lineage === version.lineage ? below.sequence : 0,
      };
    })
    .slice(0, FEED_VERSIONS)
    .filter((source) => source.sequence > 0);

/**
 * Every record of the newest versions, newest first. A version that fails to
 * load leaves the others in place.
 * @param request - sends the drawer's authorised request
 * @param server - the sync server's base URL
 * @param doc - the document
 * @param list - the drawer's history list from a time grouping (not Bookmarks: `since` is the row below)
 * @param now - the clock, for naming a failed version
 */
export const loadUpdates = async (
  request: HistoryRequest,
  server: string,
  doc: string,
  list: VersionListLike,
  now: Date = new Date()
): Promise<UpdatesLoad> => {
  const sources = updateSources(list);
  const answers = await Promise.allSettled(sources.map((source) =>
    fetchVersionChanges(request, changesUrl(server, doc, source.lineage, source.sequence, source.since))));

  // Server order, not committedAt: clocks across lineages need not agree.
  const items = sources.flatMap((source, index) => {
    const answer = answers[index];

    if (answer.status === 'rejected') {
      return [];
    }

    const records = [...answer.value.changes].reverse();

    return records.map((record, at) => ({
      lineage: source.lineage,
      sequence: source.sequence,
      truncated: answer.value.truncated && at === records.length - 1,
      record,
    }));
  });
  const failed = sources.flatMap((source, index) => {
    const answer = answers[index];

    if (answer.status === 'fulfilled') {
      return [];
    }

    const version = list.versions.find((candidate) => candidate.lineage === source.lineage && candidate.sequence === source.sequence);
    const at = version?.savedAt ?? version?.startedAt ?? null;
    const which = at === null ? 'one version' : `the version from ${relativeTime(at, now)}`;
    const reason = answer.reason instanceof Error ? answer.reason.message : 'Something went wrong.';

    return [`Could not load ${which}: ${reason}`];
  });

  return { items, failed };
};

const pushPart = (parts: DiffPart[], text: string, kind: DiffPart['kind']): void => {
  const last = parts[parts.length - 1];

  if (last?.kind === kind) {
    last.text += text;
  } else if (text !== '') {
    parts.push({ text, kind });
  }
};

/**
 * Word-level diff of two texts.
 * @param before - the older text
 * @param after - the newer text
 */
export const wordDiff = (before: string, after: string): DiffPart[] => {
  const parts: DiffPart[] = [];

  if (before === after) {
    pushPart(parts, before, 'same');

    return parts;
  }

  const a = before.split(/(\s+)/).filter((token) => token !== '');
  const b = after.split(/(\s+)/).filter((token) => token !== '');

  if (a.length * b.length > DIFF_CELL_LIMIT) {
    pushPart(parts, before, 'removed');
    pushPart(parts, after, 'added');

    return parts;
  }

  // lcs[i][j]: longest common run of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));

  [...a.keys()].reverse().forEach((i) => [...b.keys()].reverse().forEach((j) => {
    lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }));

  const at = { i: 0, j: 0 };

  while (at.i < a.length || at.j < b.length) {
    const { i, j } = at;

    if (i < a.length && j < b.length && a[i] === b[j]) {
      pushPart(parts, a[i], 'same');
      at.i++;
      at.j++;
    } else if (j >= b.length || (i < a.length && lcs[i + 1][j] >= lcs[i][j + 1])) {
      pushPart(parts, a[i], 'removed');
      at.i++;
    } else {
      pushPart(parts, b[j], 'added');
      at.j++;
    }
  }

  return parts;
};

const textOf = (block: LooseOutputBlockData | undefined, plainText: PlainText): string =>
  block === undefined ? '' : plainText({ blocks: [block] }).trim();

/**
 * One block's inline diff.
 * @param block - one block of a record
 * @param plainText - `blocksToPlainText`
 */
export const blockSnippet = (block: ChangeBlock, plainText: PlainText): BlockSnippet => {
  const parts = wordDiff(textOf(block.before, plainText), textOf(block.after, plainText));

  if (parts.length > 0) {
    return { id: block.id, kind: block.kind, parts };
  }

  const name = blockName(block.type);

  return { id: block.id, kind: block.kind, parts, label: name[0].toUpperCase() + name.slice(1) };
};

/**
 * The feed's cards.
 * @param items - from {@link loadUpdates}
 * @param options - names actors, the clock, the page title and `blocksToPlainText`
 */
export const updateCards = (
  items: UpdateItem[],
  options: { nameOf(actor: string | null): string; now: Date; pageTitle: string; plainText: PlainText }
): UpdateCard[] => items.map(({ lineage, sequence, truncated, record }) => {
  const snippets = record.blocks.map((block) => blockSnippet(block, options.plainText));

  return {
    key: `${lineage}:${record.sequence}`,
    who: options.nameOf(record.actor),
    title: options.pageTitle.trim() || 'Untitled',
    when: record.committedAt === null ? 'Time unknown' : relativeTime(record.committedAt, options.now),
    version: { lineage, sequence },
    snippets,
    shown: Math.min(SNIPPETS_SHOWN, snippets.length),
    truncated,
  };
});

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);

  node.className = className;

  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
};

const snippetNode = (snippet: BlockSnippet, onScrollToBlock: (id: string) => void): HTMLElement => {
  // A removed block is not in the live editor, so there is nothing to scroll to.
  const node = snippet.kind === 'removed' ? element('span', 'pg-hp-snippet') : element('button', 'pg-hp-snippet');

  node.setAttribute('data-pg-update-snippet', '');

  if (node instanceof HTMLButtonElement) {
    node.type = 'button';
    node.addEventListener('click', () => onScrollToBlock(snippet.id));
  } else {
    // "View N more" may hand focus to it.
    node.tabIndex = -1;
  }

  if (snippet.label !== undefined) {
    node.append(element('span', 'pg-hp-snippet__label', snippet.label));
  }

  snippet.parts.forEach((part) => {
    if (part.kind === 'same') {
      node.append(part.text);

      return;
    }

    node.append(element(part.kind === 'added' ? 'ins' : 'del', `pg-hp-diff--${part.kind}`, part.text));
  });

  return node;
};

export interface UpdatesFeedOptions {
  /** Usually `loadUpdates(request, server, doc, list)`. */
  load(): Promise<UpdatesLoad>;
  nameOf(actor: string | null): string;
  pageTitle(): string;
  plainText: PlainText;
  now?: () => Date;
  /** "View version for this update": open History on that version. */
  onOpenVersion(lineage: string, sequence: number): void;
  /** A snippet was clicked: scroll the live editor to the block. */
  onScrollToBlock(id: string): void;
}

export interface UpdatesFeed {
  element: HTMLElement;
  /** Settles once the first load is drawn, or its error is shown. */
  ready: Promise<void>;
  reload(): Promise<void>;
  destroy(): void;
}

/**
 * Mounts the Updates panel into `host`.
 * @param host - where the drawer shows its Updates tab
 * @param options - the records and the callbacks
 */
export const mountUpdatesFeed = (host: HTMLElement, options: UpdatesFeedOptions): UpdatesFeed => {
  const now = options.now ?? ((): Date => new Date());
  const root = element('div', 'pg-hp-feed');
  const status = element('p', 'pg-hp-status');
  const list = element('div', 'pg-hp-list');
  // Bumped on every load: a slower, older load must not paint over a newer one.
  const state = { request: 0 };

  status.setAttribute('role', 'status');
  status.setAttribute('data-pg-updates-status', '');
  root.append(status, list);
  host.append(root);

  const drawCard = (card: UpdateCard): HTMLElement => {
    const node = element('article', 'pg-hp-update');
    const line = element('span', 'pg-hp-update__line');
    const open = element('button', 'pg-hp-update__open');
    const snippets = element('div', 'pg-hp-update__snippets');
    const time = element('span', 'pg-hp-update__time', card.when);

    node.setAttribute('data-pg-update', card.key);
    line.setAttribute('data-pg-update-line', '');
    line.append(element('strong', '', card.who), element('span', 'pg-hp-update__what', ' edited '), element('strong', '', card.title));
    time.setAttribute('data-pg-update-time', '');
    open.type = 'button';
    open.setAttribute('data-pg-update-open', '');
    open.setAttribute('aria-label', 'View version for this update');
    open.innerHTML = IconRotateLeft;
    open.addEventListener('click', () => options.onOpenVersion(card.version.lineage, card.version.sequence));

    snippets.append(...card.snippets.slice(0, card.shown).map((snippet) => snippetNode(snippet, options.onScrollToBlock)));

    if (card.shown < card.snippets.length) {
      const more = element('button', 'pg-hp-more', `View ${card.snippets.length - card.shown} more`);

      more.type = 'button';
      more.setAttribute('data-pg-update-more', '');
      more.addEventListener('click', () => {
        const rest = card.snippets.slice(card.shown).map((snippet) => snippetNode(snippet, options.onScrollToBlock));

        // The button goes away, so focus moves to what it revealed.
        more.replaceWith(...rest);
        rest[0].focus();
      });
      snippets.append(more);
    }

    if (card.truncated) {
      const note = element('p', 'pg-hp-update__note', 'Showing the newest 200 edits.');

      note.setAttribute('data-pg-update-note', '');
      snippets.append(note);
    }
    node.append(avatar(card.who), line, open, time);

    if (snippets.childElementCount > 0) {
      node.append(snippets);
    }

    return node;
  };

  const reload = async (): Promise<void> => {
    const current = ++state.request;

    status.textContent = 'Loading updates…';

    try {
      const { items, failed } = await options.load();

      if (current !== state.request) {
        return;
      }

      const cards = updateCards(items, { nameOf: options.nameOf, now: now(), pageTitle: options.pageTitle(), plainText: options.plainText });

      const empty = cards.length === 0 ? 'No updates yet.' : '';

      status.textContent = failed.length > 0 ? failed.join(' ') : empty;
      list.replaceChildren(...cards.map(drawCard));
    } catch (error) {
      if (current === state.request) {
        status.textContent = error instanceof Error ? error.message : 'Something went wrong.';
        list.replaceChildren();
      }
    }
  };

  return {
    element: root,
    ready: reload(),
    reload,
    destroy: () => {
      state.request++;
      root.remove();
    },
  };
};

export interface EditedLink {
  element: HTMLButtonElement;
  /** Pass the drawer's latest list, or null when history is unavailable. */
  update(list: VersionListLike | null): void;
}

/**
 * The "Edited <time>" header link. The caller places `element` next to the History button.
 * @param options - opens the Updates tab; clock for tests
 */
export const mountEditedLink = (options: { onOpen(): void; now?: () => Date }): EditedLink => {
  const now = options.now ?? ((): Date => new Date());
  const link = element('button', 'pg-hp-edited');

  link.type = 'button';
  link.hidden = true;
  link.setAttribute('data-pg-edited-link', '');
  link.addEventListener('click', () => options.onOpen());

  return {
    element: link,
    update: (list) => {
      const label = editedLabel(list, now());

      link.hidden = label === null;
      link.textContent = label ?? '';
    },
  };
};
