import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blocksToHtml, diffOutputData } from '../../../src/view';
import {
  actorName,
  changePreview,
  formatVersionTime,
  historyErrorMessage,
  historyRows,
  lineageLabel,
  mountHistoryDrawer,
  playgroundTicketUrl,
} from '../../../src/playground/history-drawer';
import type { HistoryList } from '../../../src/playground/history-drawer';
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

    return answers.list();
  };

  const setup = (): { drawer: ReturnType<typeof mountHistoryDrawer>; button: HTMLButtonElement; editor: HTMLElement; notify: ReturnType<typeof vi.fn> } => {
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
      doc: () => 'playground',
      self: () => SELF,
      notify,
      now: () => NOW,
      idempotencyKey: () => 'key-1',
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
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });

  afterEach(() => {
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

    const list = calls.find((call) => call.url === `${SERVER}/sync/playground/history`);

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

  it('restores after a confirm, then returns to the live editor', async () => {
    const { button, editor, notify } = setup();

    button.click();
    await settle();
    buttonNamed(preview(), 'Restore').click();

    expect(preview().textContent).toContain('Restore Today, 14:32? Your current text stays in history.');

    buttonNamed(preview(), 'Restore').click();
    await settle();

    const restore = calls.find((call) => call.url === `${SERVER}/sync/playground/history/l2/5/restore`);
    const headers = new Headers(restore?.init?.headers);

    expect(restore?.init?.method).toBe('POST');
    expect(headers.get('Blok-Idempotency-Key')).toBe('key-1');
    expect(headers.get('Authorization')).toBe(`Bearer ${pass('playground')}`);
    expect(notify).toHaveBeenCalledWith('Restored Today, 14:32. It is now the newest version.');
    expect(preview().hidden).toBe(true);
    expect(editor.hidden).toBe(false);
    expect(calls.filter((call) => call.url === `${SERVER}/sync/playground/history`)).toHaveLength(2);
  });

  it('cancels a restore without calling the server', async () => {
    const { button } = setup();

    button.click();
    await settle();
    buttonNamed(preview(), 'Restore').click();
    buttonNamed(preview(), 'Cancel').click();
    await settle();

    expect(calls.some((call) => call.url.endsWith('/restore'))).toBe(false);
    expect(preview().textContent).not.toContain('Your current text stays in history.');
  });

  it('shows the server message when a restore fails and stays usable', async () => {
    answers.restore = () => new Response('the document changed\n', { status: 412 });

    const { button, editor } = setup();

    button.click();
    await settle();
    buttonNamed(preview(), 'Restore').click();
    buttonNamed(preview(), 'Restore').click();
    await settle();

    expect(preview().textContent).toContain('the document changed (412)');
    expect(buttonNamed(preview(), 'Restore').disabled).toBe(false);

    buttonNamed(panel(), 'Close').click();

    expect(editor.hidden).toBe(false);
    expect(preview().hidden).toBe(true);
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
