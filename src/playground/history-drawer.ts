/**
 * Version history for the dev playground: a drawer that lists the sync
 * server's versions of the open document, previews one read-only with its
 * changes marked, and restores it.
 *
 * The pure helpers come first; `mountHistoryDrawer` wires them to the page.
 */
import './history-drawer.css';
import { IconCheck } from '../components/icons';
import { createTicketSource } from '../components/utils/access-pass';
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
    /** The version under this one in the list; its changes are measured from there. */
    below: HistoryPoint | null;
  };

export type ChangeMark = 'added' | 'changed' | 'removed';

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
  };
  blocksToHtml(data: LooseOutputData, options: { toolAttributes: boolean; blockIds: boolean }): string;
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
      below: below === undefined ? null : { lineage: below.lineage, sequence: below.sequence },
    };
    const startsLineage = index === 0 || list.versions[index - 1].lineage !== version.lineage;

    return startsLineage
      ? [{ kind: 'lineage', label: lineageLabel(lineages.get(version.lineage), options.locale) }, row]
      : [row];
  });
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
  now?: () => Date;
  idempotencyKey?: () => string;
}

export interface HistoryDrawer {
  open(): Promise<void>;
  close(): void;
}

type VersionRow = Extract<HistoryRow, { kind: 'version' }>;

/** Every element Blok mounts its own UI in, popovers in the top layer included. */
const BLOK_ROOTS = '[data-blok-interface], [data-blok-popover], [data-blok-top-layer]';

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

/**
 * Mounts the drawer and its preview pane. The drawer resolves the document
 * each time it opens, so it never holds an editor or a doc id.
 * @param options - where to mount and how to reach the server
 */
export const mountHistoryDrawer = (options: HistoryDrawerOptions): HistoryDrawer => {
  const now = options.now ?? ((): Date => new Date());
  const idempotencyKey = options.idempotencyKey ?? ((): string => crypto.randomUUID());
  const sources = new Map<string, TicketSource>();
  const points = new Map<string, LooseOutputData>();
  const state = {
    doc: null as string | null,
    rows: [] as HistoryRow[],
    selected: null as VersionRow | null,
    showChanges: true,
    confirming: false,
    busy: false,
    error: '',
    // Bumped on every selection: a slow answer for an older pick must not paint.
    request: 0,
  };

  const panel = element('aside', 'pg-history');
  const head = element('div', 'pg-history__head');
  const status = element('p', 'pg-history__status');
  const list = element('ul', 'pg-history__list');
  const previewPane = element('section', 'pg-history-preview');
  const banner = element('div', 'pg-history-banner');
  const note = element('div', 'pg-history-note');
  const render = element('div', 'pg-history-render');

  panel.setAttribute('data-pg-history', '');
  panel.id = 'pg-history';
  panel.setAttribute('aria-label', 'Version history');
  panel.hidden = true;
  status.setAttribute('role', 'status');
  head.append(element('h2', 'pg-history__title', 'History'), textButton('Close', 'pg-history__button', () => close()));
  panel.append(head, status, list);

  previewPane.setAttribute('data-pg-history-preview', '');
  previewPane.setAttribute('aria-label', 'Version preview');
  previewPane.hidden = true;
  // index.html scopes view.css to this id.
  render.id = 'pg-history-render';
  previewPane.append(banner, element('div', 'pg-history-doc'));
  previewPane.lastElementChild?.append(note, render);

  document.body.append(panel);
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

  const drawRows = (): void => {
    list.replaceChildren(...state.rows.map((row) => {
      if (row.kind === 'lineage') {
        return element('li', 'pg-history__lineage', row.label);
      }

      const item = element('li', 'pg-history__item');
      const button = textButton('', 'pg-history__row', () => {
        void select(row);
      });
      const check = element('span', 'pg-history__check');

      check.innerHTML = IconCheck;
      check.setAttribute('aria-hidden', 'true');
      button.setAttribute('data-key', row.key);
      button.setAttribute('aria-current', String(state.selected?.key === row.key));
      button.append(element('span', 'pg-history__time', row.time), element('span', 'pg-history__who', row.who), check);
      item.append(button);

      return item;
    }));
  };

  const drawBanner = (): void => {
    const row = state.selected;

    if (row === null) {
      banner.replaceChildren();

      return;
    }

    const controls = element('span', 'pg-history-banner__controls');

    if (state.confirming) {
      controls.append(
        element('span', 'pg-history-banner__ask', `Restore ${row.time}? Your current text stays in history.`),
        textButton('Cancel', 'pg-history__button', () => {
          state.confirming = false;
          drawBanner();
        }),
        textButton('Restore', 'pg-history__button pg-history__button--primary', () => {
          void restore(row);
        })
      );
    } else {
      controls.append(textButton('Restore', 'pg-history__button pg-history__button--primary', () => {
        state.confirming = true;
        state.error = '';
        drawBanner();
      }));
    }

    controls.querySelectorAll('button').forEach((button) => button.toggleAttribute('disabled', state.busy));

    const error = element('p', 'pg-history-banner__error', state.error);

    error.setAttribute('role', 'alert');
    error.hidden = state.error === '';
    banner.replaceChildren(element('span', 'pg-history-banner__text', `Viewing ${row.time}. Read only.`), controls, error);
  };

  const drawNote = (row: VersionRow): void => {
    const author = row.who === 'No author recorded' ? row.who : `Edited by ${row.who}`;
    const parts: HTMLElement[] = [element('span', 'pg-history-note__when', `${row.time} · ${author}`)];

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
        (['added', 'removed', 'changed'] as const).forEach((mark) => {
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

      render.innerHTML = options.view.blocksToHtml({ blocks: preview.blocks }, { toolAttributes: true, blockIds: true });
      Object.entries(preview.marks).forEach(([id, mark]) => {
        render.querySelectorAll(`[data-blok-id="${CSS.escape(id)}"]`).forEach((node) => node.setAttribute('data-pg-change', mark));
      });
      drawNote(row);
    } catch (error) {
      if (request === state.request) {
        state.error = messageOf(error);
        drawBanner();
      }
    }
  };

  const select = async (row: VersionRow): Promise<void> => {
    state.selected = row;
    state.confirming = false;
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

  const load = async (): Promise<void> => {
    const doc = state.doc;

    if (doc === null) {
      return;
    }

    status.textContent = 'Loading history…';

    try {
      const response = await send(doc, base(doc));
      const body = await response.json() as HistoryList;

      state.rows = historyRows(body, { now: now(), self: options.self() });
      status.textContent = state.rows.length === 0 ? 'No versions yet.' : '';
    } catch (error) {
      state.rows = [];
      status.textContent = messageOf(error);
    }

    drawRows();
  };

  const restore = async (row: VersionRow): Promise<void> => {
    const doc = state.doc;

    if (doc === null) {
      return;
    }

    state.busy = true;
    drawBanner();

    try {
      await send(doc, `${base(doc)}/${encodeURIComponent(row.lineage)}/${row.sequence}/restore`, {
        method: 'POST',
        headers: { 'Blok-Idempotency-Key': idempotencyKey() },
      });
      state.busy = false;
      state.confirming = false;
      state.selected = null;
      showEditor();
      await load();
      state.selected = state.rows.find((candidate): candidate is VersionRow => candidate.kind === 'version') ?? null;
      drawRows();
      options.notify(`Restored ${row.time}. It is now the newest version.`);
    } catch (error) {
      state.busy = false;
      state.confirming = false;
      state.error = messageOf(error);
      drawBanner();
    }
  };

  const open = async (): Promise<void> => {
    state.doc = options.doc();

    if (state.doc === null) {
      return;
    }

    panel.hidden = false;
    document.body.classList.add('pg-history-open');
    options.button.setAttribute('aria-expanded', 'true');
    await load();

    const versions = state.rows.filter((row): row is VersionRow => row.kind === 'version');
    // Open on the version before the current one: that is what people look for.
    const first = versions[1] ?? versions[0];

    if (first !== undefined) {
      await select(first);
    }
  };

  const close = (): void => {
    state.request++;
    state.selected = null;
    state.confirming = false;
    state.error = '';
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

  // An Escape inside the editor or one of its popovers closes that first. Blok's
  // popover backstop does not preventDefault, so the target is all there is to go on.
  const isEditorEscape = (target: EventTarget | null): boolean =>
    target instanceof Element
      ? editorArea.contains(target) || target.closest(BLOK_ROOTS) !== null
      : target instanceof Node && editorArea.contains(target);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || panel.hidden || isEditorEscape(event.target)) {
      return;
    }

    close();
  });

  return { open, close };
};
