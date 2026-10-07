/**
 * The edits inside one version of the playground's history (the sync server's
 * `…/changes` route): a list of records the drawer shows in place of its
 * version list, and the block marks to paint for one record.
 *
 * It imports nothing from history-drawer.ts: the drawer imports this module.
 */
import './history-panels.css';
import { IconChevronLeft } from '../components/icons';
import type { LooseOutputBlockData } from '../../types';

export type ChangeKind = 'added' | 'removed' | 'changed' | 'moved';

export interface ChangeBlock {
  id: string;
  type: string;
  kind: ChangeKind;
  before?: LooseOutputBlockData;
  after?: LooseOutputBlockData;
}

/** One journal record. */
export interface ChangeRecord {
  sequence: number;
  committedAt: number | null;
  actor: string | null;
  blocks: ChangeBlock[];
  /** `title`, `icon`, or `values.<key>`. */
  page?: string[];
}

export interface VersionChanges {
  /** Oldest first, as the server sends them. */
  changes: ChangeRecord[];
  truncated: boolean;
}

/** The block marks for one record. Ids may be missing from the preview: a block added and removed in one version is never rendered. */
export interface RecordPaint {
  marks: Record<string, ChangeKind>;
  /** The block to scroll to. */
  first: string;
}

export interface ChangeEntry {
  sequence: number;
  who: string;
  what: string;
  time: string;
  visualizable: boolean;
  record: ChangeRecord;
}

/** Answers the URL, or throws an Error whose message the person sees. */
export type HistoryRequest = (url: string) => Promise<Response>;

const KINDS: ChangeKind[] = ['added', 'removed', 'changed', 'moved'];

/**
 * The changes route for one version.
 * @param server - the sync server's base URL
 * @param doc - the document
 * @param lineage - the version's lineage
 * @param sequence - the version's sequence
 * @param since - the sequence of the version below it in the grouping shown (0 for none)
 */
export const changesUrl = (server: string, doc: string, lineage: string, sequence: number, since: number): string =>
  `${server}/sync/${encodeURIComponent(doc)}/history/${encodeURIComponent(lineage)}/${sequence}/changes?since=${since}`;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const parseBlock = (value: unknown): ChangeBlock | null => {
  if (!isObject(value) || typeof value.id !== 'string' || !KINDS.includes(value.kind as ChangeKind)) {
    return null;
  }

  return {
    id: value.id,
    type: typeof value.type === 'string' ? value.type : '',
    kind: value.kind as ChangeKind,
    ...(isObject(value.before) ? { before: value.before as unknown as LooseOutputBlockData } : {}),
    ...(isObject(value.after) ? { after: value.after as unknown as LooseOutputBlockData } : {}),
  };
};

const parseRecord = (value: unknown): ChangeRecord | null => {
  if (!isObject(value) || typeof value.sequence !== 'number') {
    return null;
  }

  const page = Array.isArray(value.page) ? value.page.filter((key): key is string => typeof key === 'string') : [];

  return {
    sequence: value.sequence,
    committedAt: typeof value.committedAt === 'number' ? value.committedAt : null,
    actor: typeof value.actor === 'string' ? value.actor : null,
    blocks: Array.isArray(value.blocks)
      ? value.blocks.map(parseBlock).filter((block): block is ChangeBlock => block !== null)
      : [],
    ...(page.length > 0 ? { page } : {}),
  };
};

/**
 * Reads one version's records.
 * @param request - sends the drawer's authorised request
 * @param url - from {@link changesUrl}
 */
export const fetchVersionChanges = async (request: HistoryRequest, url: string): Promise<VersionChanges> => {
  const body: unknown = await (await request(url)).json();
  const changes = isObject(body) && Array.isArray(body.changes) ? body.changes : [];

  return {
    changes: changes.map(parseRecord).filter((record): record is ChangeRecord => record !== null),
    truncated: isObject(body) && body.truncated === true,
  };
};

const BLOCK_NAMES: Record<string, string> = {
  paragraph: 'paragraph',
  header: 'heading',
  list: 'list item',
  code: 'code block',
  quote: 'quote',
  image: 'image',
  table: 'table',
  toggle: 'toggle',
  callout: 'callout',
  divider: 'divider',
  embed: 'embed',
};

/**
 * "a paragraph", "an image".
 * @param type - the tool name
 */
export const blockName = (type: string): string => {
  const name = BLOCK_NAMES[type] ?? (type.replace(/[-_]+/g, ' ').trim() || 'block');

  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
};

const pageFields = (keys: string[]): string | null => {
  const title = keys.includes('title');
  const icon = keys.includes('icon');

  if (title && icon) {
    return 'the page title and icon';
  }

  if (title || icon) {
    return title ? 'the page title' : 'the page icon';
  }

  return keys.length > 0 ? 'the page data' : null;
};

/**
 * What a record edited: "a paragraph", "3 blocks", "the page title".
 * @param record - one journal record
 */
export const describeRecord = (record: ChangeRecord): string => {
  const blocks = record.blocks.length === 1 ? blockName(record.blocks[0].type) : null;
  const parts = [
    record.blocks.length > 1 ? `${record.blocks.length} blocks` : blocks,
    pageFields(record.page ?? []),
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(' and ') : 'the page';
};

const startOfDay = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * "Today, 14:32:07": the drawer's version time, to the second.
 * @param ms - Unix milliseconds, or null when the server has none
 * @param now - the current time
 * @param locale - defaults to the browser's
 */
export const formatRecordTime = (ms: number | null, now: Date, locale?: string): string => {
  if (ms === null) {
    return 'Time unknown';
  }

  const date = new Date(ms);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (days === 0 || days === 1) {
    return `${days === 0 ? 'Today' : 'Yesterday'}, ${time}`;
  }

  const day = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date);

  return `${day}, ${time}`;
};

/**
 * The list entries, newest first.
 * @param changes - one version's records
 * @param options - names actors, the clock, and locale
 */
export const changeEntries = (
  changes: VersionChanges,
  options: { nameOf(actor: string | null): string; now: Date; locale?: string }
): ChangeEntry[] => [...changes.changes].reverse().map((record) => ({
  sequence: record.sequence,
  who: options.nameOf(record.actor),
  what: describeRecord(record),
  time: formatRecordTime(record.committedAt, options.now, options.locale),
  visualizable: record.blocks.length > 0,
  record,
}));

/**
 * The marks for one record, or null when it changed no block.
 * @param record - one journal record
 */
export const recordPaint = (record: ChangeRecord): RecordPaint | null => {
  if (record.blocks.length === 0) {
    return null;
  }

  const marks = Object.fromEntries(record.blocks.map((block) => [block.id, block.kind]));
  const shown = record.blocks.find((block) => block.kind !== 'removed') ?? record.blocks[0];

  return { marks, first: shown.id };
};

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);

  node.className = className;

  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
};

/** The person's initial in a gray circle. */
export const avatar = (name: string): HTMLElement => {
  const face = element('span', 'pg-hp-avatar', (name.trim()[0] ?? '?').toUpperCase());

  face.setAttribute('aria-hidden', 'true');

  return face;
};

/** The note the drawer lays over the preview for a record without blocks. */
export const notVisualizableNote = (): HTMLElement => {
  const note = element('div', 'pg-hp-note');

  note.setAttribute('role', 'status');
  note.append(
    element('strong', 'pg-hp-note__title', 'Not visualizable'),
    element('span', 'pg-hp-note__text', 'This type of change isn’t viewable in the page preview')
  );

  return note;
};

export interface VersionChangesOptions {
  /** The version's card: its row's time and authors. */
  version: { time: string; who: string };
  /** Usually `fetchVersionChanges(request, changesUrl(…))`. */
  load(): Promise<VersionChanges>;
  nameOf(actor: string | null): string;
  now?: () => Date;
  /** "← All versions". */
  onBack(): void;
  /** `paint` is null when the record changed no block: show {@link notVisualizableNote}. */
  onSelectRecord(record: ChangeRecord, paint: RecordPaint | null): void;
}

export interface VersionChangesPanel {
  element: HTMLElement;
  /** Settles once the records are drawn, or the error is shown. */
  ready: Promise<void>;
  destroy(): void;
}

/**
 * Mounts the per-version edits list into `host`.
 * @param host - where the drawer shows its list
 * @param options - the version, its records and the callbacks
 */
export const mountVersionChanges = (host: HTMLElement, options: VersionChangesOptions): VersionChangesPanel => {
  const now = options.now ?? ((): Date => new Date());
  const root = element('div', 'pg-hp-changes');
  const back = element('button', 'pg-hp-back');
  const card = element('div', 'pg-hp-card');
  const status = element('p', 'pg-hp-status', 'Loading edits…');
  const list = element('ul', 'pg-hp-list');
  const icon = element('span', 'pg-hp-back__icon');

  back.type = 'button';
  back.setAttribute('data-pg-changes-back', '');
  icon.innerHTML = IconChevronLeft;
  icon.setAttribute('aria-hidden', 'true');
  back.append(icon, 'All versions');
  back.addEventListener('click', () => options.onBack());
  card.setAttribute('data-pg-changes-card', '');
  card.append(element('span', 'pg-hp-card__time', options.version.time), element('span', 'pg-hp-card__who', options.version.who));
  status.setAttribute('role', 'status');
  status.setAttribute('data-pg-changes-status', '');
  root.append(back, card, status, list);
  host.append(root);

  const draw = (entries: ChangeEntry[], current: number | null): void => {
    list.replaceChildren(...entries.map((entry) => {
      const item = element('li', 'pg-hp-list__item');
      const button = element('button', 'pg-hp-entry');
      const line = element('span', 'pg-hp-entry__line');

      button.type = 'button';
      button.setAttribute('data-pg-change-entry', '');
      button.setAttribute('aria-current', String(entry.sequence === current));
      line.append(element('strong', 'pg-hp-entry__who', entry.who), element('span', 'pg-hp-entry__what', ` edited ${entry.what}`));
      button.append(avatar(entry.who), line, element('span', 'pg-hp-entry__time', entry.time));
      button.addEventListener('click', () => {
        draw(entries, entry.sequence);
        options.onSelectRecord(entry.record, recordPaint(entry.record));
      });
      item.append(button);

      return item;
    }));
  };

  const ready = options.load().then((changes) => {
    const entries = changeEntries(changes, { nameOf: options.nameOf, now: now() });

    if (entries.length === 0) {
      status.textContent = 'No edits recorded in this version.';
    } else {
      status.textContent = changes.truncated ? 'Showing the newest 200 edits.' : '';
    }
    draw(entries, null);
  }, (error: unknown) => {
    status.textContent = error instanceof Error ? error.message : 'Something went wrong.';
  });

  return {
    element: root,
    ready,
    destroy: () => root.remove(),
  };
};
