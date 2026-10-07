import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  avatar,
  changeEntries,
  changesUrl,
  describeRecord,
  fetchVersionChanges,
  formatRecordTime,
  mountVersionChanges,
  notVisualizableNote,
  pageFieldsLabel,
  recordPaint,
} from '../../../src/playground/history-changes';
import type { ChangeRecord, VersionChanges } from '../../../src/playground/history-changes';

const NOW = new Date(2026, 9, 7, 15, 0);
const at = (day: number, hour: number, minute: number, second = 0): number =>
  new Date(2026, 9, day, hour, minute, second).getTime();

const block = (id: string, type = 'paragraph', text = 'hi') => ({ id, type, data: { text } });

const record = (sequence: number, extra: Partial<ChangeRecord> = {}): ChangeRecord => ({
  sequence,
  committedAt: at(7, 14, sequence, 5),
  actor: 'playground-anna',
  blocks: [],
  ...extra,
});

const nameOf = (actor: string | null): string => actor === null ? 'Someone' : actor.replace('playground-', 'P:');

describe('changesUrl', () => {
  it('names the version and passes since', () => {
    expect(changesUrl('http://s', 'my doc', 'L/1', 12, 7))
      .toBe('http://s/sync/my%20doc/history/L%2F1/12/changes?since=7');
  });
});

describe('fetchVersionChanges', () => {
  it('reads the records and drops malformed ones', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      changes: [
        { sequence: 3, committedAt: 1, actor: null, blocks: [{ id: 'a', type: 'paragraph', kind: 'added', after: block('a') }] },
        { sequence: 'x' },
        { sequence: 4, committedAt: null, actor: 'playground-ben', blocks: [{ id: 'b', kind: 'weird' }], page: ['title', 5] },
      ],
      truncated: true,
    })));

    const result = await fetchVersionChanges(request, 'http://s/x');

    expect(request).toHaveBeenCalledWith('http://s/x');
    expect(result.truncated).toBe(true);
    expect(result.changes.map((change) => change.sequence)).toEqual([3, 4]);
    expect(result.changes[0].blocks[0].after).toEqual(block('a'));
    expect(result.changes[1].blocks).toEqual([]);
    expect(result.changes[1].page).toEqual(['title']);
    expect(result.changes[1].committedAt).toBeNull();
  });

  it('answers an empty list for a body without changes', async () => {
    const result = await fetchVersionChanges(async () => new Response('{}'), 'u');

    expect(result).toEqual({ changes: [], truncated: false });
  });
});

describe('describeRecord', () => {
  const one = (type: string, kind: 'added' | 'removed' | 'changed' | 'moved' = 'changed') =>
    record(1, { blocks: [{ id: 'x', type, kind }] });

  it('names one block by its kind', () => {
    expect(describeRecord(one('paragraph'))).toBe('a paragraph');
    expect(describeRecord(one('header'))).toBe('a heading');
    expect(describeRecord(one('code'))).toBe('a code block');
    expect(describeRecord(one('image'))).toBe('an image');
  });

  it('turns an unknown tool name into words', () => {
    expect(describeRecord(one('database-row'))).toBe('a database row');
  });

  it('counts several blocks', () => {
    expect(describeRecord(record(1, { blocks: [
      { id: 'a', type: 'paragraph', kind: 'added' },
      { id: 'b', type: 'header', kind: 'removed' },
      { id: 'c', type: 'paragraph', kind: 'moved' },
    ] }))).toBe('3 blocks');
  });

  it('names the page fields', () => {
    expect(describeRecord(record(1, { page: ['title'] }))).toBe('the page title');
    expect(describeRecord(record(1, { page: ['icon'] }))).toBe('the page icon');
    expect(describeRecord(record(1, { page: ['title', 'icon'] }))).toBe('the page title and icon');
    expect(describeRecord(record(1, { page: ['values.status'] }))).toBe('the page data');
    expect(describeRecord(record(1, { page: ['title', 'values.k'] }))).toBe('the page title and data');
  });

  it('reads the playground title, kept as values.title, as the page title', () => {
    expect(describeRecord(record(1, { page: ['values.title'] }))).toBe('the page title');
    expect(describeRecord(record(1, { page: ['title', 'values.title'] }))).toBe('the page title');
    expect(describeRecord(record(1, { page: ['values.title', 'values.status'] }))).toBe('the page title and data');
    expect(pageFieldsLabel(['values.title', 'icon'])).toBe('the page title and icon');
    expect(pageFieldsLabel([])).toBeNull();
  });

  it('joins blocks and page fields', () => {
    expect(describeRecord(record(1, { blocks: [{ id: 'a', type: 'header', kind: 'changed' }], page: ['title'] })))
      .toBe('a heading and the page title');
  });

  it('falls back to the page when nothing visible changed', () => {
    expect(describeRecord(record(1))).toBe('the page');
  });
});

describe('formatRecordTime', () => {
  it('gives the time to the second', () => {
    expect(formatRecordTime(at(7, 14, 3, 9), NOW)).toBe('Today, 14:03:09');
    expect(formatRecordTime(at(6, 8, 0, 0), NOW)).toBe('Yesterday, 08:00:00');
  });

  it('dates an older record', () => {
    const label = formatRecordTime(at(1, 9, 5, 7), NOW);

    expect(label).toContain('09:05:07');
    expect(label).not.toMatch(/Today|Yesterday/);
  });

  it('says so when there is no time', () => {
    expect(formatRecordTime(null, NOW)).toBe('Time unknown');
  });
});

describe('changeEntries', () => {
  it('lists records newest first with who, what and when', () => {
    const changes: VersionChanges = {
      changes: [
        record(2, { blocks: [{ id: 'a', type: 'paragraph', kind: 'added' }] }),
        record(3, { actor: null }),
      ],
      truncated: false,
    };

    expect(changeEntries(changes, { nameOf, now: NOW })).toEqual([
      { sequence: 3, who: 'Someone', what: 'the page', time: 'Today, 14:03:05', visualizable: false, record: changes.changes[1] },
      { sequence: 2, who: 'P:anna', what: 'a paragraph', time: 'Today, 14:02:05', visualizable: true, record: changes.changes[0] },
    ]);
  });

  it('calls a title-only record not visualizable', () => {
    const [entry] = changeEntries({ changes: [record(1, { page: ['title'] })], truncated: false }, { nameOf, now: NOW });

    expect(entry.visualizable).toBe(false);
    expect(entry.what).toBe('the page title');
  });
});

describe('recordPaint', () => {
  it('marks every block of the record with its kind', () => {
    const paint = recordPaint(record(1, { blocks: [
      { id: 'a', type: 'paragraph', kind: 'removed' },
      { id: 'b', type: 'paragraph', kind: 'moved' },
      { id: 'c', type: 'paragraph', kind: 'changed' },
    ] }));

    expect(paint).toEqual({ marks: { a: 'removed', b: 'moved', c: 'changed' } });
  });

  it('has nothing to paint for a record without blocks', () => {
    expect(recordPaint(record(1, { page: ['title'] }))).toBeNull();
  });
});

describe('avatar', () => {
  it('keeps a name that starts with an emoji whole', () => {
    expect(avatar(' 😀 Anna').textContent).toBe('😀');
  });
});

describe('notVisualizableNote', () => {
  it('explains that the change cannot be shown', () => {
    const note = notVisualizableNote();

    expect(note.getAttribute('role')).toBe('status');
    expect(note.textContent).toContain('Not visualizable');
    expect(note.textContent).toContain('This type of change isn’t viewable in the page preview');
    expect(note.querySelector('svg')).toBeNull();
  });
});

describe('mountVersionChanges', () => {
  let host: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.append(host);
  });

  afterEach(() => {
    host.remove();
    vi.restoreAllMocks();
  });

  const changes: VersionChanges = {
    changes: [
      record(2, { blocks: [{ id: 'a', type: 'header', kind: 'changed' }] }),
      record(3, { page: ['title'] }),
    ],
    truncated: false,
  };

  const mount = (load: () => Promise<VersionChanges>) => {
    const onBack = vi.fn();
    const onSelectRecord = vi.fn();
    const panel = mountVersionChanges(host, {
      version: { time: 'Today, 14:03', who: 'Anna' },
      load,
      nameOf,
      now: () => NOW,
      onBack,
      onSelectRecord,
    });

    return { panel, onBack, onSelectRecord };
  };

  const entries = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>('[data-pg-change-entry]')];

  it('shows the back button and the version card', async () => {
    const { panel, onBack } = mount(async () => changes);

    await panel.ready;

    const back = host.querySelector<HTMLButtonElement>('[data-pg-changes-back]');

    expect(back?.textContent?.trim()).toBe('All versions');
    expect(back?.querySelector('svg')).not.toBeNull();
    back?.click();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-pg-changes-card]')?.textContent).toBe('Today, 14:03Anna');
  });

  it('lists one entry per record, newest first', async () => {
    const { panel } = mount(async () => changes);

    await panel.ready;

    expect(entries().map((entry) => entry.textContent)).toEqual([
      'PP:anna edited the page titleToday, 14:03:05',
      'PP:anna edited a headingToday, 14:02:05',
    ]);
  });

  it('hands the picked record and its paint to the drawer, and marks it current', async () => {
    const { panel, onSelectRecord } = mount(async () => changes);

    await panel.ready;
    entries()[1].click();

    expect(onSelectRecord).toHaveBeenCalledWith(changes.changes[0], { marks: { a: 'changed' } });
    expect(entries().map((entry) => entry.getAttribute('aria-current'))).toEqual(['false', 'true']);

    entries()[0].click();
    expect(onSelectRecord).toHaveBeenLastCalledWith(changes.changes[1], null);
  });

  it('shows the error the load failed with', async () => {
    const { panel } = mount(async () => {
      throw new Error('Server down (500)');
    });

    await panel.ready;

    expect(host.querySelector('[data-pg-changes-status]')?.textContent).toBe('Server down (500)');
    expect(entries()).toEqual([]);
  });

  it('says when the server kept only the newest records', async () => {
    const { panel } = mount(async () => ({ ...changes, truncated: true }));

    await panel.ready;

    expect(host.querySelector('[data-pg-changes-status]')?.textContent).toBe('Showing the newest 200 edits.');
  });

  it('says when the version has no edits', async () => {
    const { panel } = mount(async () => ({ changes: [], truncated: false }));

    await panel.ready;

    expect(host.querySelector('[data-pg-changes-status]')?.textContent).toBe('No edits recorded in this version.');
  });

  it('keeps focus on the picked entry', async () => {
    const { panel } = mount(async () => changes);

    await panel.ready;

    const [first, second] = entries();

    second.focus();
    second.click();

    expect(second).toHaveFocus();
    expect(entries()[1]).toBe(second);
    expect(first.getAttribute('aria-current')).toBe('false');
    expect(second.getAttribute('aria-current')).toBe('true');
  });

  it('draws nothing when destroyed before the load answers', async () => {
    const late: { resolve(value: VersionChanges): void } = { resolve: () => undefined };
    const { panel } = mount(() => new Promise<VersionChanges>((resolve) => {
      late.resolve = resolve;
    }));
    const element = panel.element;

    panel.destroy();
    late.resolve(changes);
    await panel.ready;

    expect(element.querySelectorAll('[data-pg-change-entry]')).toHaveLength(0);
    expect(element.querySelector('[data-pg-changes-status]')?.textContent).toBe('Loading edits…');
  });

  it('reads the server record for a page-only edit', async () => {
    const body = '{"changes":[{"sequence":7,"committedAt":1760000000000,"actor":null,"blocks":[],"page":["title","values.k"]}],"truncated":true}';
    const { panel, onSelectRecord } = mount(() => fetchVersionChanges(async () => new Response(body), 'u'));

    await panel.ready;

    expect(entries()).toHaveLength(1);
    expect(entries()[0].querySelector('.pg-hp-entry__line')?.textContent).toBe('Someone edited the page title and data');
    expect(host.querySelector('[data-pg-changes-status]')?.textContent).toBe('Showing the newest 200 edits.');
    entries()[0].click();
    expect(onSelectRecord).toHaveBeenCalledWith(expect.objectContaining({ sequence: 7, page: ['title', 'values.k'] }), null);
  });

  it('renders an actor name as text, never as markup', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    const panel = mountVersionChanges(host, {
      version: { time: evil, who: evil },
      load: async () => ({ changes: [record(1, { actor: evil })], truncated: false }),
      nameOf: (actor) => actor ?? '',
      now: () => NOW,
      onBack: vi.fn(),
      onSelectRecord: vi.fn(),
    });

    await panel.ready;

    expect(host.querySelector('img')).toBeNull();
    expect(entries()[0].textContent).toContain(evil);
    expect(host.querySelector('[data-pg-changes-card]')?.textContent).toBe(evil + evil);
  });

  it('removes itself on destroy', async () => {
    const { panel } = mount(async () => changes);

    await panel.ready;
    panel.destroy();

    expect(host.children).toHaveLength(0);
  });
});
