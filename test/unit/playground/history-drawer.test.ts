import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconBookmark, IconCheck } from '../../../src/components/icons';
import { Paragraph } from '../../../src/tools/paragraph';

import { blocksToHtml, diffOutputData } from '../../../src/view';
import {
  actorName,
  bookmarkRows,
  changePreview,
  formatVersionTime,
  historyErrorMessage,
  historyRows,
  isBookmarked,
  lineageLabel,
  mountHistoryDrawer,
  playgroundTicketUrl,
  subPagesOf,
  toggleBookmark,
} from '../../../src/playground/history-drawer';
import type { HistoryBookmark, HistoryList } from '../../../src/playground/history-drawer';
import type { LooseOutputBlockData } from '../../../types';

const SELF = { id: 'playground-anna', name: 'Anna' };
const NOW = new Date(2026, 9, 7, 15, 0);
const at = (day: number, hour: number, minute: number): number => new Date(2026, 9, day, hour, minute).getTime();

const p = (id: string, text: unknown, extra: Partial<LooseOutputBlockData> = {}): LooseOutputBlockData =>
  ({ id, type: 'paragraph', data: { text }, ...extra });

describe('actorName', () => {
  it('uses the real name of the person in this tab', () => {
    expect(actorName('playground-anna', SELF)).toBe('Anna');
  });

  it('turns another playground user id back into a name', () => {
    expect(actorName('playground-ben', SELF)).toBe('Ben');
  });

  it('names the anonymous playground user like userConfig does', () => {
    expect(actorName('playground-user', SELF)).toBe('Playground user');
  });

  it('shows any other id as it is', () => {
    expect(actorName('u_123', SELF)).toBe('u_123');
  });
});

describe('formatVersionTime', () => {
  it('says Today for a time earlier today', () => {
    expect(formatVersionTime(at(7, 14, 32), NOW)).toBe('Today, 14:32');
  });

  it('says Yesterday for a time the day before', () => {
    expect(formatVersionTime(at(6, 18, 20), NOW)).toBe('Yesterday, 18:20');
  });

  it('gives an older time a date', () => {
    const label = formatVersionTime(at(2, 9, 5), NOW);

    expect(label).toContain('09:05');
    expect(label).not.toMatch(/Today|Yesterday/);
  });

  it('says so when the server recorded no time', () => {
    expect(formatVersionTime(null, NOW)).toBe('Time unknown');
  });
});

describe('lineageLabel', () => {
  it('calls the current lineage the current history', () => {
    expect(lineageLabel({ lineage: 'a', epoch: 2, format: 2, createdAt: at(7, 9, 0), current: true })).toBe('Current history');
  });

  it('dates an older lineage by when it started', () => {
    const label = lineageLabel({ lineage: 'b', epoch: 1, format: 2, createdAt: at(6, 9, 0), current: false });

    expect(label.startsWith('Before the reset · ')).toBe(true);
    expect(label).not.toContain('date unknown');
  });

  it('says the date is unknown when the server has none', () => {
    expect(lineageLabel({ lineage: 'b', epoch: 1, format: 2, createdAt: null, current: false })).toBe('Before the reset · date unknown');
    expect(lineageLabel(undefined)).toBe('Before the reset · date unknown');
  });
});

describe('historyRows', () => {
  const list: HistoryList = {
    lineages: [
      { lineage: 'l2', epoch: 2, format: 2, createdAt: at(7, 10, 31), current: true },
      { lineage: 'l1', epoch: 1, format: 2, createdAt: null, current: false },
    ],
    versions: [
      { lineage: 'l2', sequence: 41, startedAt: at(7, 14, 20), savedAt: at(7, 14, 32), actors: ['playground-anna', 'playground-ben'] },
      { lineage: 'l2', sequence: 0, startedAt: null, savedAt: at(7, 10, 31), actors: [] },
      { lineage: 'l1', sequence: 12, startedAt: null, savedAt: null, actors: ['playground-ben'] },
    ],
  };
  const rows = historyRows(list, { now: NOW, self: SELF });

  it('groups versions under their lineage, newest first', () => {
    expect(rows.map((row) => (row.kind === 'lineage' ? row.label : row.key))).toEqual([
      'Current history',
      'l2:41',
      'l2:0',
      'Before the reset · date unknown',
      'l1:12',
    ]);
  });

  it('labels the top row as the current version', () => {
    expect(rows[1]).toMatchObject({ kind: 'version', current: true, who: 'Current version', time: 'Today, 14:32' });
  });

  it('names the authors of an older version, or says none was recorded', () => {
    const versionRows = rows.filter((row) => row.kind === 'version');

    expect(versionRows[1]).toMatchObject({ who: 'No author recorded', current: false });
    expect(versionRows[2]).toMatchObject({ who: 'Ben', time: 'Time unknown' });
  });

  it('links each version to the one below it, across lineages', () => {
    const versionRows = rows.filter((row) => row.kind === 'version');

    expect(versionRows.map((row) => row.below)).toEqual([
      { lineage: 'l2', sequence: 0 },
      { lineage: 'l1', sequence: 12 },
      null,
    ]);
  });

  it('has no rows for an empty history', () => {
    expect(historyRows({ lineages: [], versions: [] }, { now: NOW, self: SELF })).toEqual([]);
  });
});

describe('changePreview', () => {
  it('marks added and changed blocks', () => {
    const preview = changePreview(
      { blocks: [p('a', 'one'), p('b', 'two')] },
      { blocks: [p('a', 'one'), p('b', 'two, edited'), p('c', 'three')] },
      diffOutputData
    );

    expect(preview.marks).toEqual({ b: 'changed', c: 'added' });
  });

  it('puts a removed top-level block back after the block that came before it', () => {
    const preview = changePreview(
      { blocks: [p('a', 'one'), p('gone', 'old'), p('b', 'two')] },
      { blocks: [p('a', 'one'), p('b', 'two')] },
      diffOutputData
    );

    expect(preview.marks).toEqual({ gone: 'removed' });
    expect(preview.blocks.map((block) => block.id)).toEqual(['a', 'gone', 'b']);
  });

  it('puts a removed first block back at the very top', () => {
    const preview = changePreview(
      { blocks: [p('gone', 'old'), p('a', 'one')] },
      { blocks: [p('a', 'one')] },
      diffOutputData
    );

    expect(preview.blocks.map((block) => block.id)).toEqual(['gone', 'a']);
  });

  it('puts a removed child back inside its parent, in order', () => {
    const before = { blocks: [
      { id: 't', type: 'toggle', data: { text: 'T' }, content: ['c1', 'gone', 'c2'] },
      p('c1', 'first', { parent: 't' }),
      p('gone', 'old', { parent: 't' }),
      p('c2', 'second', { parent: 't' }),
    ] };
    const after = { blocks: [
      { id: 't', type: 'toggle', data: { text: 'T' }, content: ['c1', 'c2'] },
      p('c1', 'first', { parent: 't' }),
      p('c2', 'second', { parent: 't' }),
    ] };
    const html = blocksToHtml(changePreview(before, after, diffOutputData), { blockIds: true });

    expect(html.indexOf('data-blok-id="c1"')).toBeLessThan(html.indexOf('data-blok-id="gone"'));
    expect(html.indexOf('data-blok-id="gone"')).toBeLessThan(html.indexOf('data-blok-id="c2"'));
  });

  it('brings a removed child back with its removed parent', () => {
    const before = { blocks: [
      p('a', 'one'),
      { id: 't', type: 'toggle', data: { text: 'T' }, content: ['c1'] },
      p('c1', 'inner', { parent: 't' }),
    ] };
    const preview = changePreview(before, { blocks: [p('a', 'one')] }, diffOutputData);

    expect(preview.marks).toEqual({ t: 'removed', c1: 'removed' });

    const html = blocksToHtml(preview, { blockIds: true });

    expect(html).toContain('data-blok-id="c1"');
    expect(html.indexOf('data-blok-id="t"')).toBeLessThan(html.indexOf('data-blok-id="c1"'));
  });

  // Point reads answer rich text as segments (format 2).
  it('renders segment rich text', () => {
    const preview = changePreview(
      { blocks: [] },
      { blocks: [p('a', [{ text: 'a ' }, { text: 'bold', marks: { bold: true } }])] },
      diffOutputData
    );

    expect(blocksToHtml(preview, { blockIds: true })).toMatch(/a <(b|strong)>bold<\/(b|strong)>/);
  });

  it('does not count segments and HTML that say the same thing as a change', () => {
    const preview = changePreview(
      { blocks: [p('a', 'a <b>bold</b>')] },
      { blocks: [p('a', [{ text: 'a ' }, { text: 'bold', marks: { bold: true } }])] },
      diffOutputData
    );

    expect(preview.marks).toEqual({});
  });
});

describe('changePreview moves', () => {
  it('marks a block that moved', () => {
    const preview = changePreview(
      { blocks: [p('a', 'one'), p('b', 'two'), p('c', 'three')] },
      { blocks: [p('b', 'two'), p('c', 'three'), p('a', 'one')] },
      diffOutputData
    );

    expect(preview.marks).toEqual({ a: 'moved' });
  });

  it('calls a block that moved and changed changed', () => {
    const preview = changePreview(
      { blocks: [p('a', 'one'), p('b', 'two'), p('c', 'three')] },
      { blocks: [p('b', 'two'), p('c', 'three'), p('a', 'one, edited')] },
      diffOutputData
    );

    expect(preview.marks).toEqual({ a: 'changed' });
  });
});

describe('bookmarks', () => {
  const marks: HistoryBookmark[] = [
    { lineage: 'l2', sequence: 5, savedAt: at(7, 14, 32) },
    { lineage: 'l2', sequence: 0, savedAt: at(7, 10, 0) },
    { lineage: 'l2', sequence: 9, savedAt: at(7, 14, 40) },
  ];

  it('lists bookmarked points newest first, with the time and no author', () => {
    const rows = bookmarkRows(marks, { now: NOW });

    expect(rows.map((row) => (row.kind === 'version' ? [row.key, row.time, row.who, row.current] : row.label))).toEqual([
      ['l2:9', 'Today, 14:40', '', false],
      ['l2:5', 'Today, 14:32', '', false],
      ['l2:0', 'Today, 10:00', '', false],
    ]);
  });

  it('compares a bookmark with the point just before it, and the first point with nothing', () => {
    const rows = bookmarkRows(marks, { now: NOW });

    expect(rows.map((row) => (row.kind === 'version' ? row.below : null))).toEqual([
      { lineage: 'l2', sequence: 8 },
      { lineage: 'l2', sequence: 4 },
      null,
    ]);
  });

  it('adds a bookmark, and removes it on the second toggle', () => {
    const point = { lineage: 'l1', sequence: 3, savedAt: 1 };
    const added = toggleBookmark(marks, point);

    expect(added).toContainEqual(point);
    expect(isBookmarked(added, point)).toBe(true);
    expect(toggleBookmark(added, { ...point, savedAt: 2 })).toEqual(marks);
    expect(isBookmarked(marks, point)).toBe(false);
  });
});

describe('subPagesOf', () => {
  it('lists the page blocks of a version once each, in order', () => {
    expect(subPagesOf([
      p('a', 'one'),
      { id: 'x', type: 'page', data: { pageId: 'pg-2' } },
      { id: 'y', type: 'page', data: { pageId: 'pg-1' } },
      { id: 'z', type: 'page', data: { pageId: 'pg-2' } },
      { id: 'w', type: 'page', data: {} },
    ])).toEqual(['pg-2', 'pg-1']);
  });
});

describe('historyErrorMessage', () => {
  it('shows the server message with its status', () => {
    expect(historyErrorMessage(501, 'history needs a journal that keeps it\n')).toBe('history needs a journal that keeps it (501)');
  });

  it('explains a stale restore when the server sent no text', () => {
    expect(historyErrorMessage(412, '')).toBe('The document changed. Try again. (412)');
  });

  it('explains a version too large to restore', () => {
    expect(historyErrorMessage(413, '')).toBe('This version is too large to restore. (413)');
  });

  it('says the server did not answer for a network failure', () => {
    expect(historyErrorMessage(0, '')).toBe('The sync server did not answer.');
  });
});

describe('playgroundTicketUrl', () => {
  it('names the tab user when there is one', () => {
    expect(playgroundTicketUrl('http://127.0.0.1:4700/ticket', 'Anna B')).toBe('http://127.0.0.1:4700/ticket?name=Anna%20B');
  });

  it('leaves the name out for the anonymous user', () => {
    expect(playgroundTicketUrl('http://127.0.0.1:4700/ticket', null)).toBe('http://127.0.0.1:4700/ticket');
    expect(playgroundTicketUrl('http://127.0.0.1:4700/ticket', '  ')).toBe('http://127.0.0.1:4700/ticket');
  });
});

describe('mountHistoryDrawer', () => {
  const SERVER = 'http://127.0.0.1:4000';
  const HOST = 'http://127.0.0.1:4800';
  const LIST_URL = `${SERVER}/sync/playground/history?group=15`;
  const bookmarkStore: HistoryBookmark[] = [];
  const scrolled: Array<{ id: string | undefined; options: unknown }> = [];
  const setupScroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  const MINT = 'http://127.0.0.1:4700/ticket?name=Anna';
  const pass = (doc: string): string => `h.${btoa(JSON.stringify({ doc, write: true, exp: 4_000_000_000 }))}.s`;
  const LIST: HistoryList = {
    lineages: [{ lineage: 'l2', epoch: 2, format: 2, createdAt: at(7, 10, 0), current: true }],
    versions: [
      { lineage: 'l2', sequence: 9, startedAt: null, savedAt: at(7, 14, 40), actors: ['playground-anna'] },
      { lineage: 'l2', sequence: 5, startedAt: null, savedAt: at(7, 14, 32), actors: ['playground-ben'] },
      { lineage: 'l2', sequence: 0, startedAt: null, savedAt: at(7, 10, 0), actors: [] },
    ],
  };
  const points = (): Record<string, { blocks: LooseOutputBlockData[] }> => ({
    '9': { blocks: [p('a', 'one'), p('c', 'three')] },
    '5': { blocks: [p('a', 'one'), p('b', 'two'), p('c', 'three')] },
    '0': { blocks: [p('a', 'one'), p('c', 'three, first draft')] },
  });
  const POINTS = points();

  interface Call { url: string; init?: RequestInit }

  const calls: Call[] = [];
  const answers: { restore: () => Response; list: () => Response } = {
    restore: () => new Response(null, { status: 204 }),
    list: () => Response.json(LIST),
  };

  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();

    calls.push({ url, init });

    if (url.startsWith('http://127.0.0.1:4700/')) {
      return Response.json({ ticket: pass(new URL(url).searchParams.get('doc') ?? '') });
    }

    const point = /\/history\/l2\/(\d+)$/.exec(url);

    if (point !== null) {
      return Response.json(POINTS[point[1]]);
    }

    if (url.endsWith('/restore')) {
      return answers.restore();
    }

    if (url.startsWith(`${HOST}/bookmarks/`)) {
      if (init?.method === 'PUT') {
        bookmarkStore.splice(0, bookmarkStore.length, ...(JSON.parse(typeof init.body === 'string' ? init.body : '[]') as HistoryBookmark[]));
      }

      return Response.json(bookmarkStore);
    }

    return answers.list();
  };

  const setup = (doc: () => string | null = () => 'playground'): { drawer: ReturnType<typeof mountHistoryDrawer>; button: HTMLButtonElement; editor: HTMLElement; notify: ReturnType<typeof vi.fn> } => {
    const button = document.createElement('button');
    const editor = document.createElement('div');
    const notify = vi.fn();

    editor.id = 'editor-col';
    document.body.append(button, editor);

    const drawer = mountHistoryDrawer({
      button,
      editorArea: editor,
      server: SERVER,
      ticketUrl: MINT,
      view: { blocksToHtml, diffOutputData },
      doc,
      self: () => SELF,
      notify,
      now: () => NOW,
      idempotencyKey: () => 'key-1',
      pageHost: HOST,
      titleOf: (pageId) => (pageId === null ? 'Demo Page' : `Title of ${pageId}`),
    });

    return { drawer, button, editor, notify };
  };

  const settle = async (): Promise<void> => {
    for (let round = 0; round < 10; round++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  const panel = (): HTMLElement => {
    const element = document.querySelector<HTMLElement>('[data-pg-history]');

    if (element === null) {
      throw new Error('no history drawer');
    }

    return element;
  };

  const preview = (): HTMLElement => {
    const element = document.querySelector<HTMLElement>('[data-pg-history-preview]');

    if (element === null) {
      throw new Error('no history preview');
    }

    return element;
  };

  const rowButtons = (): HTMLButtonElement[] => Array.from(panel().querySelectorAll<HTMLButtonElement>('button[data-key]'));

  const buttonNamed = (root: HTMLElement, name: string): HTMLButtonElement => {
    const found = Array.from(root.querySelectorAll('button')).find((element) => element.textContent?.trim() === name);

    if (found === undefined) {
      throw new Error(`no button "${name}"`);
    }

    return found;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    answers.restore = () => new Response(null, { status: 204 });
    answers.list = () => Response.json(LIST);
    Object.assign(POINTS, points());
    bookmarkStore.length = 0;
    scrolled.length = 0;
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value(this: HTMLElement, options: unknown) {
        scrolled.push({ id: this.dataset.blokId, options });
      },
    });
  });

  afterEach(() => {
    // vitest.setup.ts polyfills it for every file: put that one back.
    if (setupScroll !== undefined) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', setupScroll);
    }
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists the versions with their authors, using a pass for this document', async () => {
    const { button } = setup();

    button.click();
    await settle();

    expect(rowButtons().map((row) => row.textContent)).toEqual([
      expect.stringContaining('Current version'),
      expect.stringContaining('Ben'),
      expect.stringContaining('No author recorded'),
    ]);

    const list = calls.find((call) => call.url === LIST_URL);

    expect(calls.some((call) => call.url === `${MINT}&doc=playground`)).toBe(true);
    expect(new Headers(list?.init?.headers).get('Authorization')).toBe(`Bearer ${pass('playground')}`);
  });

  it('opens on the version before the current one, read only, with the editor hidden', async () => {
    const { button, editor } = setup();

    button.click();
    await settle();

    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(rowButtons()[1].getAttribute('aria-current')).toBe('true');
    expect(preview().hidden).toBe(false);
    expect(preview().textContent).toContain('Viewing Today, 14:32. Read only.');
    expect(editor.hidden).toBe(true);
    expect(editor.inert).toBe(true);
  });

  it('marks what that version added and changed, and shows what it removed', async () => {
    const { button } = setup();

    button.click();
    await settle();

    const marked = (mark: string): string[] =>
      Array.from(preview().querySelectorAll<HTMLElement>(`[data-pg-change="${mark}"]`)).map((element) => element.dataset.blokId ?? '');

    expect(marked('added')).toEqual(['b']);
    expect(marked('changed')).toEqual(['c']);

    rowButtons()[0].click();
    await settle();
    rowButtons()[1].click();
    await settle();

    const toggle = preview().querySelector<HTMLInputElement>('input[type="checkbox"]');

    toggle?.click();
    await settle();

    expect(preview().querySelectorAll('[data-pg-change]')).toHaveLength(0);
  });

  // Without the root wrapper and the editor classes, view.css cannot paint links, tables and tokens.
  it('renders the preview like a read-only editor', async () => {
    const { button } = setup();

    button.click();
    await settle();

    expect(preview().querySelector('#pg-history-render > [data-blok-interface="view"]')).not.toBeNull();
    expect(preview().querySelector('[data-blok-id="c"][data-pg-change="changed"]')).not.toBeNull();
  });

  it('shows a removed block where it used to be', async () => {
    POINTS['5'] = { blocks: [p('a', 'one'), p('c', 'three')] };
    POINTS['0'] = { blocks: [p('a', 'one'), p('gone', 'old'), p('c', 'three')] };

    const { button } = setup();

    button.click();
    await settle();

    const removed = preview().querySelector<HTMLElement>('[data-pg-change="removed"]');

    expect(removed?.textContent).toContain('old');
    expect(removed?.dataset.blokId).toBe('gone');
  });

  it('shows the live editor again when the current version is picked', async () => {
    const { button, editor } = setup();

    button.click();
    await settle();
    rowButtons()[0].click();
    await settle();

    expect(preview().hidden).toBe(true);
    expect(editor.hidden).toBe(false);
    expect(editor.inert).toBe(false);
  });

  const dialog = (): HTMLElement => {
    const element = document.querySelector<HTMLElement>('[role="dialog"][data-pg-history-restore]');

    if (element === null || element.hidden) {
      throw new Error('no restore dialog');
    }

    return element;
  };

  const restoreDialogOpen = (): boolean =>
    document.querySelector<HTMLElement>('[data-pg-history-restore]')?.hidden === false;

  it('asks in a dialog what a restore brings back, then restores and returns to the live editor', async () => {
    const { button, editor, notify } = setup();

    button.click();
    await settle();
    buttonNamed(preview(), 'Restore').click();
    await settle();

    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(dialog().textContent).toContain('Restore Demo Page to Today, 14:32');
    expect(dialog().textContent).toContain('Page content — text, blocks, and everything nested in them, including database rows');
    expect(dialog().textContent).toContain('Page title and icon');
    expect(dialog().textContent).toContain('This will not delete any other versions and you can always restore again.');

    buttonNamed(dialog(), 'Restore this version').click();
    await settle();

    const restore = calls.find((call) => call.url === `${SERVER}/sync/playground/history/l2/5/restore`);
    const headers = new Headers(restore?.init?.headers);

    expect(restore?.init?.method).toBe('POST');
    expect(headers.get('Blok-Idempotency-Key')).toBe('key-1');
    expect(headers.get('Authorization')).toBe(`Bearer ${pass('playground')}`);
    expect(notify).toHaveBeenCalledWith('Restored Today, 14:32. It is now the newest version.');
    expect(restoreDialogOpen()).toBe(false);
    expect(preview().hidden).toBe(true);
    expect(editor.hidden).toBe(false);
    expect(calls.filter((call) => call.url === LIST_URL)).toHaveLength(2);
  });

  it('lists the sub-pages a restore leaves alone, by their titles', async () => {
    POINTS['5'] = { blocks: [p('a', 'one'), { id: 'pb', type: 'page', data: { pageId: 'pg-notes' } }] };

    const { button } = setup();

    button.click();
    await settle();
    buttonNamed(preview(), 'Restore').click();
    await settle();

    expect(dialog().textContent).toContain('Will remain unchanged');
    expect(dialog().textContent).toContain('Title of pg-notes');
    expect(dialog().textContent).toContain('Sub-pages keep their own history.');
  });

  it('leaves out the unchanged section when the version has no sub-pages', async () => {
    const { button } = setup();

    button.click();
    await settle();
    buttonNamed(preview(), 'Restore').click();
    await settle();

    expect(dialog().textContent).not.toContain('Will remain unchanged');
  });

  it('cancels a restore without calling the server', async () => {
    const { button } = setup();

    button.click();
    await settle();
    buttonNamed(preview(), 'Restore').click();
    await settle();

    expect(panel().hasAttribute('inert')).toBe(true);

    buttonNamed(dialog(), 'Cancel').click();
    await settle();

    expect(calls.some((call) => call.url.endsWith('/restore'))).toBe(false);
    expect(restoreDialogOpen()).toBe(false);
    expect(panel().hasAttribute('inert')).toBe(false);
    expect(preview().hidden).toBe(false);
  });

  const beginRestore = (): HTMLButtonElement => {
    const found = preview().querySelector<HTMLButtonElement>('[data-pg-history-begin-restore]');

    if (found === null) {
      throw new Error('no Restore button');
    }

    return found;
  };

  it('gives focus back to Restore when the dialog is cancelled', async () => {
    const { button } = setup();

    button.click();
    await settle();
    beginRestore().click();
    await settle();
    buttonNamed(dialog(), 'Cancel').click();

    expect(beginRestore()).toHaveFocus();
  });

  it('leaves focus alone when the drawer closes under the dialog', async () => {
    const { button, drawer } = setup();

    button.click();
    await settle();
    beginRestore().click();
    await settle();
    drawer.close();

    expect(restoreDialogOpen()).toBe(false);
    expect(beginRestore()).not.toHaveFocus();
  });

  it('opens one dialog per click and holds Restore while it gets ready', async () => {
    const { button } = setup();

    button.click();
    await settle();
    beginRestore().click();

    expect(beginRestore().disabled).toBe(true);

    beginRestore().dispatchEvent(new MouseEvent('click'));
    await settle();

    expect(document.querySelectorAll('[data-pg-history-restore] h2')).toHaveLength(1);

    buttonNamed(dialog(), 'Cancel').click();

    expect(beginRestore().disabled).toBe(false);
  });

  it('closes only the dialog on Escape, and keeps the drawer and preview open', async () => {
    const { button } = setup();

    button.click();
    await settle();
    buttonNamed(preview(), 'Restore').click();
    await settle();

    const target = buttonNamed(dialog(), 'Cancel');

    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(restoreDialogOpen()).toBe(false);
    expect(panel().hidden).toBe(false);
    expect(preview().hidden).toBe(false);
  });

  it('shows the server message when a restore fails and stays usable', async () => {
    answers.restore = () => new Response('the document changed\n', { status: 412 });

    const { button, editor } = setup();

    button.click();
    await settle();
    buttonNamed(preview(), 'Restore').click();
    await settle();
    buttonNamed(dialog(), 'Restore this version').click();
    await settle();

    expect(restoreDialogOpen()).toBe(false);
    expect(preview().textContent).toContain('the document changed (412)');
    expect(buttonNamed(preview(), 'Restore').disabled).toBe(false);

    buttonNamed(panel(), 'Close').click();

    expect(editor.hidden).toBe(false);
    expect(preview().hidden).toBe(true);
  });

  it('scrolls the preview to the first marked block and outlines it for a moment', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    try {
      const { button } = setup();

      button.click();
      for (let round = 0; round < 10; round++) {
        await vi.advanceTimersByTimeAsync(0);
      }

      expect(scrolled.at(-1)).toEqual({ id: 'b', options: { block: 'center', behavior: 'smooth' } });
      expect(preview().querySelector('[data-blok-id="b"]')?.hasAttribute('data-pg-flash')).toBe(true);

      vi.advanceTimersByTime(1199);
      expect(preview().querySelector('[data-pg-flash]')).not.toBeNull();
      vi.advanceTimersByTime(1);
      expect(preview().querySelector('[data-pg-flash]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('jumps without smooth scrolling when the reader asks for less motion', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }));

    const { button } = setup();

    button.click();
    await settle();

    expect(scrolled.at(-1)).toEqual({ id: 'b', options: { block: 'center', behavior: 'auto' } });
  });

  it('marks a moved block', async () => {
    POINTS['5'] = { blocks: [p('c', 'three'), p('a', 'one')] };
    POINTS['0'] = { blocks: [p('a', 'one'), p('c', 'three')] };

    const { button } = setup();

    button.click();
    await settle();

    expect(preview().querySelectorAll('[data-pg-change="moved"]')).toHaveLength(1);
    expect(preview().textContent).toContain('Moved');
  });

  const groupButton = (): HTMLButtonElement => {
    const found = panel().querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');

    if (found === null) {
      throw new Error('no group by control');
    }

    return found;
  };

  const groupOptions = (): HTMLButtonElement[] => Array.from(panel().querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));

  const pickGroup = async (name: string): Promise<void> => {
    groupButton().click();

    const option = groupOptions().find((item) => item.textContent?.trim() === name);

    if (option === undefined) {
      throw new Error(`no group option "${name}"`);
    }
    option.click();
    await settle();
  };

  it('groups by 15 minutes by default, checked in the menu', async () => {
    const { button } = setup();

    button.click();
    await settle();

    expect(groupButton().textContent).toContain('15 minutes');
    groupButton().click();
    expect(groupOptions().map((item) => [item.textContent?.trim(), item.getAttribute('aria-checked')])).toEqual([
      ['1 minute', 'false'],
      ['15 minutes', 'true'],
      ['1 hour', 'false'],
      ['Bookmarks', 'false'],
    ]);
  });

  it('asks the server for the chosen grouping and remembers it in this browser', async () => {
    const { button } = setup();

    button.click();
    await settle();
    await pickGroup('1 hour');

    expect(calls.some((call) => call.url === `${SERVER}/sync/playground/history?group=60`)).toBe(true);
    expect(groupButton().textContent).toContain('1 hour');

    document.body.replaceChildren();
    calls.length = 0;

    const next = setup();

    next.button.click();
    await settle();

    expect(calls.some((call) => call.url === `${SERVER}/sync/playground/history?group=60`)).toBe(true);
  });

  it('still works when the browser refuses storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    const { button } = setup();

    button.click();
    await settle();
    await pickGroup('1 minute');

    expect(calls.some((call) => call.url === `${SERVER}/sync/playground/history?group=1`)).toBe(true);
  });

  it('closes only the Group by menu on Escape', async () => {
    const { button } = setup();

    button.click();
    await settle();
    groupButton().click();
    groupOptions()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(groupOptions()[0].closest<HTMLElement>('[role="menu"]')?.hidden).toBe(true);
    expect(groupButton().getAttribute('aria-expanded')).toBe('false');
    expect(panel().hidden).toBe(false);
  });

  it('stays on the live editor when closed while another grouping loads', async () => {
    const pending: { release: () => void } = { release: () => undefined };

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();

      if (url === `${SERVER}/sync/playground/history?group=60`) {
        await new Promise<void>((resolve) => {
          pending.release = resolve;
        });
      }

      return fakeFetch(input, init);
    }));

    const { button, editor } = setup();

    button.click();
    await settle();
    await pickGroup('1 hour');
    buttonNamed(panel(), 'Close').click();
    pending.release();
    await settle();

    expect(panel().hidden).toBe(true);
    expect(preview().hidden).toBe(true);
    expect(editor.hidden).toBe(false);
    expect(editor.inert).toBe(false);
  });

  it('moves through the Group by menu with Home and End', async () => {
    const { button } = setup();

    button.click();
    await settle();
    groupButton().click();
    groupOptions()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));

    expect(groupOptions().at(-1)).toHaveFocus();

    groupOptions()[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));

    expect(groupOptions()[0]).toHaveFocus();
  });

  it('closes the Group by menu when focus leaves it, so a later Escape closes one layer', async () => {
    const { button } = setup();

    button.click();
    await settle();
    groupButton().click();
    buttonNamed(panel(), 'Close').focus();

    expect(groupOptions()[0].closest<HTMLElement>('[role="menu"]')?.hidden).toBe(true);
    expect(groupButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on a given version that is a row in the current grouping', async () => {
    const { drawer, button } = setup();

    await drawer.openOn('l2', 0);
    await settle();

    expect(panel().hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(rowButtons().find((row) => row.getAttribute('aria-current') === 'true')?.dataset.key).toBe('l2:0');
    expect(preview().textContent).toContain('Viewing Today, 10:00. Read only.');
  });

  it('falls back to 1-minute groups when the version is not a row', async () => {
    const minute: HistoryList = {
      ...LIST,
      versions: [LIST.versions[0], { lineage: 'l2', sequence: 7, startedAt: null, savedAt: at(7, 14, 36), actors: ['playground-ben'] }, ...LIST.versions.slice(1)],
    };

    answers.list = () => Response.json(LIST);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();

      if (url === `${SERVER}/sync/playground/history?group=1`) {
        calls.push({ url, init });

        return Response.json(minute);
      }
      if (url.endsWith('/history/l2/7')) {
        calls.push({ url, init });

        return Response.json({ blocks: [p('a', 'one')] });
      }

      return fakeFetch(input, init);
    }));

    const { drawer } = setup();

    await drawer.openOn('l2', 7);
    await settle();

    expect(groupButton().textContent).toContain('1 minute');
    expect(rowButtons().find((row) => row.getAttribute('aria-current') === 'true')?.dataset.key).toBe('l2:7');
    expect(preview().textContent).toContain('Viewing Today, 14:36. Read only.');
    // A fallback for one jump, not the person's choice.
    expect(localStorage.getItem('pg-history-group')).toBeNull();
  });

  it('brings the saved grouping back on the next open after a 1-minute fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();

      return url.endsWith('/history/l2/7') ? Response.json({ blocks: [p('a', 'one')] }) : fakeFetch(input, init);
    }));

    const { drawer, button } = setup();

    await drawer.openOn('l2', 7);
    await settle();

    expect(groupButton().textContent).toContain('1 minute');

    drawer.close();
    calls.length = 0;
    button.click();
    await settle();

    expect(groupButton().textContent).toContain('15 minutes');
    expect(calls.some((call) => call.url === LIST_URL)).toBe(true);
  });

  it('closes an open Group by menu when it jumps to a version', async () => {
    const { drawer, button } = setup();

    button.click();
    await settle();
    groupButton().click();
    await drawer.openOn('l2', 5);
    await settle();

    expect(groupOptions()[0].closest<HTMLElement>('[role="menu"]')?.hidden).toBe(true);
    expect(groupButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the drawer when asked to jump while no document is open', async () => {
    const current: { doc: string | null } = { doc: 'playground' };
    const { drawer, button, editor } = setup(() => current.doc);

    button.click();
    await settle();
    current.doc = null;
    await drawer.openOn('l2', 5);

    expect(panel().hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(editor.hidden).toBe(false);
  });

  it('opens on a version from the Bookmarks grouping by leaving it for the list', async () => {
    localStorage.setItem('pg-history-group', 'bookmarks');

    const { drawer } = setup();

    await drawer.openOn('l2', 5);
    await settle();

    expect(rowButtons().find((row) => row.getAttribute('aria-current') === 'true')?.dataset.key).toBe('l2:5');
  });

  const bookmarkButton = (key: string): HTMLButtonElement => {
    const found = panel().querySelector<HTMLButtonElement>(`button[data-bookmark="${key}"]`);

    if (found === null) {
      throw new Error(`no bookmark toggle for ${key}`);
    }

    return found;
  };

  it('bookmarks a version on the page host and shows it filled', async () => {
    const { button } = setup();

    button.click();
    await settle();

    expect(bookmarkButton('l2:5').getAttribute('aria-pressed')).toBe('false');

    bookmarkButton('l2:5').click();
    await settle();

    const put = calls.find((call) => call.url === `${HOST}/bookmarks/playground` && call.init?.method === 'PUT');

    expect(typeof put?.init?.body === 'string' ? JSON.parse(put.init.body) : null).toEqual([{ lineage: 'l2', sequence: 5, savedAt: at(7, 14, 32) }]);
    expect(bookmarkButton('l2:5').getAttribute('aria-pressed')).toBe('true');
    expect(bookmarkButton('l2:5').getAttribute('aria-label')).toBe('Remove bookmark');

    bookmarkButton('l2:5').click();
    await settle();

    expect(bookmarkStore).toEqual([]);
    expect(bookmarkButton('l2:5').getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps focus on a bookmark toggle after it redraws', async () => {
    const { button } = setup();

    button.click();
    await settle();
    bookmarkButton('l2:5').focus();
    bookmarkButton('l2:5').click();
    await settle();

    expect(bookmarkButton('l2:5')).toHaveFocus();
  });

  it('shows bookmarks made in any tab as filled', async () => {
    bookmarkStore.push({ lineage: 'l2', sequence: 0, savedAt: at(7, 10, 0) });

    const { button } = setup();

    button.click();
    await settle();

    expect(bookmarkButton('l2:0').getAttribute('aria-pressed')).toBe('true');
  });

  it('lists only bookmarked points under Bookmarks, compared with the point before', async () => {
    bookmarkStore.push({ lineage: 'l2', sequence: 5, savedAt: at(7, 14, 32) });
    POINTS['4'] = { blocks: [p('a', 'one'), p('c', 'three')] };

    const { button } = setup();

    button.click();
    await settle();
    await pickGroup('Bookmarks');

    expect(rowButtons().map((row) => row.dataset.key)).toEqual(['l2:5']);
    expect(rowButtons()[0].textContent).not.toContain('Ben');

    rowButtons()[0].click();
    await settle();

    expect(calls.some((call) => call.url === `${SERVER}/sync/playground/history/l2/4`)).toBe(true);
    expect(Array.from(preview().querySelectorAll<HTMLElement>('[data-pg-change="added"]')).map((node) => node.dataset.blokId)).toEqual(['b']);
  });

  it('says so when nothing is bookmarked yet', async () => {
    const { button } = setup();

    button.click();
    await settle();
    await pickGroup('Bookmarks');

    expect(rowButtons()).toHaveLength(0);
    expect(panel().textContent).toContain('No bookmarked versions yet');
  });

  it('says so when the server keeps no history', async () => {
    answers.list = () => new Response('history needs a journal that keeps it\n', { status: 501 });

    const { button } = setup();

    button.click();
    await settle();

    expect(panel().textContent).toContain('history needs a journal that keeps it (501)');
  });

  it('says so when the ticket mint gives no pass', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();

      return url.startsWith('http://127.0.0.1:4700/') ? new Response('', { status: 500 }) : fakeFetch(input, init);
    }));

    const { button } = setup();

    button.click();
    await settle();

    expect(panel().textContent).toContain('Could not get a pass from the ticket mint.');
  });

  it('closes on Escape and gives the editor back', async () => {
    const { button, editor } = setup();

    button.click();
    await settle();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(panel().hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(editor.hidden).toBe(false);
  });

  it('stays on the live editor when closed while the list is still loading', async () => {
    const pending: { release: () => void } = { release: () => undefined };

    answers.list = () => Response.json(LIST);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();

      if (url === LIST_URL) {
        await new Promise<void>((resolve) => {
          pending.release = resolve;
        });
      }

      return fakeFetch(input, init);
    }));

    const { button, editor } = setup();

    button.click();
    await settle();
    buttonNamed(panel(), 'Close').click();
    pending.release();
    await settle();

    expect(editor.hidden).toBe(false);
    expect(editor.inert).toBe(false);
    expect(preview().hidden).toBe(true);
    expect(panel().hidden).toBe(true);
  });

  it('closes on Escape from the live editor when no Blok menu is open', async () => {
    const { button, editor } = setup();
    const field = document.createElement('div');

    editor.append(field);
    button.click();
    await settle();
    rowButtons()[0].click();
    await settle();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(panel().hidden).toBe(true);
  });

  // Blok's keyboard controller stops Escape in the document capture phase.
  it('closes on the first Escape from a real Blok paragraph, and Blok does not also act on it', async () => {
    const { button, editor } = setup();
    const holder = document.createElement('div');

    editor.append(holder);

    const { Blok } = await import('../../../src/blok');
    const blok = new Blok({ holder, tools: { paragraph: Paragraph }, data: { blocks: [{ type: 'paragraph', data: { text: 'live text' } }] } });

    try {
      await blok.isReady;
      button.click();
      await settle();
      rowButtons()[0].click();
      await settle();

      // jsdom does not reflect contentEditable to the attribute, so find the tool root.
      const editable = holder.querySelector<HTMLElement>('[data-blok-tool="paragraph"]');

      if (editable === null) {
        throw new Error('no editable paragraph');
      }

      const reachedBlok = vi.fn();

      editable.focus();
      window.getSelection()?.collapse(editable.firstChild ?? editable, 1);
      // Blok's own listeners sit in the document capture phase; this one runs right after them.
      document.addEventListener('keydown', reachedBlok, { capture: true });
      editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      document.removeEventListener('keydown', reachedBlok, { capture: true });

      expect(panel().hidden).toBe(true);
      // One Escape, one layer: the drawer took it, so Blok must not select the block too.
      expect(reachedBlok).not.toHaveBeenCalled();
    } finally {
      blok.destroy();
    }
  }, 120_000);

  // The settings drawer and the page tree close themselves on Escape from their own controls.
  it('leaves an Escape from other playground chrome to that chrome', async () => {
    const { button } = setup();
    const settings = document.createElement('aside');
    const control = document.createElement('button');
    const settingsSaw = vi.fn();

    settings.append(control);
    document.body.append(settings);
    document.addEventListener('keydown', settingsSaw);
    button.click();
    await settle();
    control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.removeEventListener('keydown', settingsSaw);

    expect(settingsSaw).toHaveBeenCalled();
    expect(panel().hidden).toBe(false);
  });

  it('leaves the first Escape in the editor to an open Blok menu', async () => {
    const { button, editor } = setup();
    const field = document.createElement('div');
    const menu = document.createElement('div');

    editor.append(field);
    menu.setAttribute('data-blok-popover', '');
    menu.setAttribute('data-blok-popover-opened', 'true');
    // Like Blok's own handlers: the menu closes during the same Escape.
    document.addEventListener('keydown', () => menu.removeAttribute('data-blok-popover-opened'), { capture: true, once: true });
    document.body.append(menu);
    button.click();
    await settle();
    rowButtons()[0].click();
    await settle();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(panel().hidden).toBe(false);
  });

  // Blok mounts popovers outside the editor column, and its Escape backstop does not preventDefault.
  it('leaves an Escape inside a Blok popover to the popover', async () => {
    const { button } = setup();
    const popover = document.createElement('div');
    const field = document.createElement('input');

    popover.setAttribute('data-blok-popover', '');
    popover.append(field);
    document.body.append(popover);
    button.click();
    await settle();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(panel().hidden).toBe(false);
  });

  it('leaves an Escape that something else already handled alone', async () => {
    const { button } = setup();

    button.click();
    await settle();

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

    event.preventDefault();
    document.body.dispatchEvent(event);

    expect(panel().hidden).toBe(false);
  });
});

describe('history drawer selected row', () => {
  const css = readFileSync(resolve(__dirname, '../../../src/playground/history-drawer.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
  const values = (token: string): string[] => [...css.matchAll(new RegExp(`${token}:\\s*([^;]+);`, 'g'))].map((match) => match[1].trim());
  const isGray = (hex: string): boolean => {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

    return Math.max(r, g, b) - Math.min(r, g, b) <= 10;
  };

  // CLAUDE.md "No blue selected states": gray fill, check mark, same ink as any row.
  it('paints the selected row with the gray hover fill and no ink of its own', () => {
    const selected = rules.filter(({ selector }) => selector.includes('[aria-current="true"]'));

    expect(selected.length).toBeGreaterThan(0);
    selected.forEach(({ selector, body }) => {
      expect(body, selector).not.toMatch(/(^|[\s;])(color|fill|stroke)\s*:/);
      [...body.matchAll(/background(?:-color)?\s*:\s*([^;]+)/g)].forEach(([, value]) => expect(value.trim()).toBe('var(--pgh-hover)'));
    });
  });

  it('keeps the fill and the ink gray in both themes', () => {
    const tokens = [...values('--pgh-hover'), ...values('--pgh-ink')];

    expect(tokens).toHaveLength(4);
    tokens.forEach((value) => expect(isGray(value), value).toBe(true));
  });

  it('draws the check mark in the row ink', () => {
    expect(IconCheck).toContain('stroke="currentColor"');
    expect(rules.find(({ selector }) => selector.includes('.pg-history__check') && selector.includes('aria-current'))?.body.trim()).toBe('opacity: 1;');
  });

  it('marks the checked grouping with a check and the gray fill, no ink of its own', () => {
    const checked = rules.filter(({ selector }) => selector.includes('[aria-checked="true"]'));

    expect(checked.length).toBeGreaterThan(0);
    checked.forEach(({ selector, body }) => {
      expect(body, selector).not.toMatch(/(^|[\s;])(color|stroke)\s*:/);
      [...body.matchAll(/background(?:-color)?\s*:\s*([^;]+)/g)].forEach(([, value]) => expect(value.trim()).toBe('var(--pgh-hover)'));
    });
  });

  it('shows the bookmark toggle on touch screens, which have no hover', () => {
    const raw = readFileSync(resolve(__dirname, '../../../src/playground/history-drawer.css'), 'utf-8');

    expect(raw).toMatch(/@media \(hover: none\)\s*\{[^{}]*\.pg-history__mark[^{}]*\{\s*opacity:\s*1;?\s*\}/);
  });

  it('fills a set bookmark with the row ink', () => {
    const pressed = rules.filter(({ selector }) => selector.includes('[aria-pressed="true"]'));

    expect(pressed.length).toBeGreaterThan(0);
    expect(IconBookmark).toContain('stroke="currentColor"');
    pressed.forEach(({ selector, body }) => {
      expect(body, selector).not.toMatch(/(^|[\s;])(color|stroke|background(?:-color)?)\s*:/);
      [...body.matchAll(/fill\s*:\s*([^;]+)/g)].forEach(([, value]) => expect(value.trim()).toBe('currentColor'));
    });
  });

  it('draws a moved block with a dashed gray bar and a changed one with a solid bar', () => {
    const moved = rules.find(({ selector }) => selector.includes('[data-pg-change="moved"]') && selector.includes('#pg-history-render'));
    const changed = rules.find(({ selector }) => selector.includes('[data-pg-change="changed"]') && selector.includes('#pg-history-render'));

    expect(moved?.body).toMatch(/border-inline-start:\s*3px dashed var\(--pgh-muted\)/);
    expect(changed?.body).toMatch(/inset 3px 0 0 var\(--pgh-muted\)/);
  });

  it('outlines the jumped-to block in gray ink, never blue', () => {
    const flash = rules.filter(({ selector }) => selector.includes('[data-pg-flash]'));

    expect(flash.length).toBeGreaterThan(0);
    flash.forEach(({ body }) => {
      [...body.matchAll(/outline(?:-color)?\s*:\s*([^;]+)/g)].forEach(([, value]) => expect(value).toMatch(/var\(--pgh-(ink|muted)\)/));
    });
  });

  it('gives the Show changes checkbox the ink, not the browser blue', () => {
    expect(rules.find(({ selector }) => selector === '.pg-history-note__toggle')?.body).toMatch(/accent-color:\s*var\(--pgh-ink\)/);
  });
});
