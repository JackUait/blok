import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconRotateLeft } from '../../../src/components/icons';
import { blocksToPlainText } from '../../../src/view';
import {
  blockSnippet,
  editedLabel,
  loadUpdates,
  mountEditedLink,
  mountUpdatesFeed,
  relativeTime,
  updateCards,
  updateSources,
  wordDiff,
} from '../../../src/playground/updates-feed';
import type { UpdateItem } from '../../../src/playground/updates-feed';
import type { ChangeBlock, ChangeRecord } from '../../../src/playground/history-changes';

const NOW = new Date(2026, 9, 7, 15, 0);
const MIN = 60_000;
const ago = (ms: number): number => NOW.getTime() - ms;

const p = (id: string, text: string) => ({ id, type: 'paragraph', data: { text } });
const version = (lineage: string, sequence: number, savedAt: number | null = null) =>
  ({ lineage, sequence, startedAt: savedAt, savedAt, actors: [] });

const nameOf = (actor: string | null): string => actor === null ? 'Someone' : actor.replace('playground-', '');

describe('relativeTime', () => {
  it('reads like Notion', () => {
    expect(relativeTime(ago(10_000), NOW)).toBe('just now');
    expect(relativeTime(ago(MIN), NOW)).toBe('1 minute ago');
    expect(relativeTime(ago(59 * MIN), NOW)).toBe('59 minutes ago');
    expect(relativeTime(ago(60 * MIN), NOW)).toBe('1 hour ago');
    expect(relativeTime(ago(21 * 60 * MIN), NOW)).toBe('21 hours ago');
    expect(relativeTime(ago(24 * 60 * MIN), NOW)).toBe('1 day ago');
    expect(relativeTime(ago(6 * 24 * 60 * MIN), NOW)).toBe('6 days ago');
  });

  it('dates anything older than a week', () => {
    expect(relativeTime(new Date(2026, 8, 1).getTime(), NOW, 'en-US')).toBe('Sep 1');
    expect(relativeTime(new Date(2025, 8, 1).getTime(), NOW, 'en-US')).toBe('Sep 1, 2025');
  });

  it('treats a clock ahead of ours as now', () => {
    expect(relativeTime(NOW.getTime() + 5 * MIN, NOW)).toBe('just now');
  });
});

describe('editedLabel', () => {
  it('uses the newest version', () => {
    expect(editedLabel({ versions: [version('L', 9, ago(5 * MIN)), version('L', 4, ago(90 * MIN))] }, NOW))
      .toBe('Edited 5 minutes ago');
  });

  it('falls back to when the version started', () => {
    expect(editedLabel({ versions: [{ ...version('L', 9), startedAt: ago(2 * 60 * MIN) }] }, NOW)).toBe('Edited 2 hours ago');
  });

  it('is null without a dated version', () => {
    expect(editedLabel({ versions: [] }, NOW)).toBeNull();
    expect(editedLabel({ versions: [version('L', 1)] }, NOW)).toBeNull();
    expect(editedLabel(null, NOW)).toBeNull();
  });
});

describe('updateSources', () => {
  it('takes the newest three versions, each since the version below it', () => {
    const list = { versions: [version('L', 30), version('L', 20), version('L', 10), version('L', 5)] };

    expect(updateSources(list)).toEqual([
      { lineage: 'L', sequence: 30, since: 20 },
      { lineage: 'L', sequence: 20, since: 10 },
      { lineage: 'L', sequence: 10, since: 5 },
    ]);
  });

  it('starts from 0 when the version below is in another lineage', () => {
    expect(updateSources({ versions: [version('N', 4), version('O', 9)] })).toEqual([
      { lineage: 'N', sequence: 4, since: 0 },
      { lineage: 'O', sequence: 9, since: 0 },
    ]);
  });

  it('skips a version at sequence 0', () => {
    expect(updateSources({ versions: [version('L', 2), version('L', 0)] })).toEqual([{ lineage: 'L', sequence: 2, since: 0 }]);
  });
});

describe('loadUpdates', () => {
  it('reads each version and lists every record newest first', async () => {
    const answers: Record<string, ChangeRecord[]> = {
      '/30/changes?since=20': [
        { sequence: 21, committedAt: 1, actor: 'a', blocks: [] },
        { sequence: 30, committedAt: 2, actor: 'b', blocks: [] },
      ],
      '/20/changes?since=0': [{ sequence: 20, committedAt: 3, actor: 'c', blocks: [] }],
    };
    const request = vi.fn(async (url: string) => {
      const key = Object.keys(answers).find((suffix) => url.endsWith(suffix)) ?? '';

      return new Response(JSON.stringify({ changes: answers[key] ?? [] }));
    });

    const items = await loadUpdates(request, 'http://s', 'doc', { versions: [version('L', 30), version('L', 20)] });

    expect(request).toHaveBeenCalledWith('http://s/sync/doc/history/L/30/changes?since=20');
    expect(items.map((item) => [item.lineage, item.sequence, item.record.sequence])).toEqual([
      ['L', 30, 30],
      ['L', 30, 21],
      ['L', 20, 20],
    ]);
  });
});

describe('wordDiff', () => {
  it('marks added and removed words', () => {
    expect(wordDiff('the quick fox', 'the slow fox jumps')).toEqual([
      { text: 'the ', kind: 'same' },
      { text: 'quick', kind: 'removed' },
      { text: 'slow', kind: 'added' },
      { text: ' fox', kind: 'same' },
      { text: ' jumps', kind: 'added' },
    ]);
  });

  it('keeps equal text whole', () => {
    expect(wordDiff('same text', 'same text')).toEqual([{ text: 'same text', kind: 'same' }]);
  });

  it('handles an empty side', () => {
    expect(wordDiff('', 'new')).toEqual([{ text: 'new', kind: 'added' }]);
    expect(wordDiff('old', '')).toEqual([{ text: 'old', kind: 'removed' }]);
    expect(wordDiff('', '')).toEqual([]);
  });

  it('gives up on word matching for huge texts', () => {
    const before = Array.from({ length: 800 }, (_, i) => `a${i}`).join(' ');
    const after = Array.from({ length: 800 }, (_, i) => `b${i}`).join(' ');

    expect(wordDiff(before, after)).toEqual([{ text: before, kind: 'removed' }, { text: after, kind: 'added' }]);
  });
});

describe('blockSnippet', () => {
  const change = (kind: ChangeBlock['kind'], extra: Partial<ChangeBlock>): ChangeBlock => ({ id: 'b', type: 'paragraph', kind, ...extra });

  it('diffs a changed block word by word', () => {
    expect(blockSnippet(change('changed', { before: p('b', 'hello world'), after: p('b', 'hello there') }), blocksToPlainText)).toEqual({
      id: 'b',
      kind: 'changed',
      parts: [
        { text: 'hello ', kind: 'same' },
        { text: 'world', kind: 'removed' },
        { text: 'there', kind: 'added' },
      ],
    });
  });

  it('shows an added block as added and a removed one struck', () => {
    expect(blockSnippet(change('added', { after: p('b', 'new') }), blocksToPlainText).parts).toEqual([{ text: 'new', kind: 'added' }]);
    expect(blockSnippet(change('removed', { before: p('b', 'gone') }), blocksToPlainText).parts).toEqual([{ text: 'gone', kind: 'removed' }]);
  });

  it('reads a block whose children are not in the record', () => {
    const toggle = { id: 'b', type: 'toggle', data: { text: 'Heads up' }, content: ['missing'] };

    expect(blockSnippet(change('moved', { type: 'toggle', before: toggle, after: toggle }), blocksToPlainText).parts)
      .toEqual([{ text: 'Heads up', kind: 'same' }]);
  });

  it('names a block that has no text', () => {
    const image = { id: 'b', type: 'image', data: { url: 'x.png' } };

    expect(blockSnippet(change('added', { type: 'image', after: image }), blocksToPlainText)).toEqual({
      id: 'b', kind: 'added', parts: [], label: 'An image',
    });
  });
});

const item = (sequence: number, blocks: ChangeBlock[], actor: string | null = 'playground-anna'): UpdateItem => ({
  lineage: 'L',
  sequence: 30,
  record: { sequence, committedAt: ago(3 * 60 * MIN), actor, blocks },
});

const changed = (id: string, before: string, after: string): ChangeBlock =>
  ({ id, type: 'paragraph', kind: 'changed', before: p(id, before), after: p(id, after) });

describe('updateCards', () => {
  it('makes one card per record with up to four snippets', () => {
    const blocks = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => changed(id, 'x', 'y'));
    const [card] = updateCards([item(7, blocks)], { nameOf, now: NOW, pageTitle: 'Demo Page', plainText: blocksToPlainText });

    expect(card.key).toBe('L:7');
    expect(card.who).toBe('anna');
    expect(card.title).toBe('Demo Page');
    expect(card.when).toBe('3 hours ago');
    expect(card.version).toEqual({ lineage: 'L', sequence: 30 });
    expect(card.snippets.map((snippet) => snippet.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(card.shown).toBe(4);
  });

  it('calls an untitled page Untitled', () => {
    const [card] = updateCards([item(7, [], null)], { nameOf, now: NOW, pageTitle: '  ', plainText: blocksToPlainText });

    expect(card.title).toBe('Untitled');
    expect(card.who).toBe('Someone');
  });
});

describe('mountUpdatesFeed', () => {
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

  const items = [
    item(8, [changed('a', 'one two', 'one three')], 'playground-ben'),
    item(7, ['b', 'c', 'd', 'e', 'f', 'g'].map((id) => changed(id, id, `${id}!`))),
    item(6, [{ id: 'gone', type: 'paragraph', kind: 'removed', before: p('gone', 'bye') }]),
  ];

  const mount = (load: () => Promise<UpdateItem[]>) => {
    const onOpenVersion = vi.fn();
    const onScrollToBlock = vi.fn();
    const feed = mountUpdatesFeed(host, {
      load,
      nameOf,
      pageTitle: () => 'Demo Page',
      plainText: blocksToPlainText,
      now: () => NOW,
      onOpenVersion,
      onScrollToBlock,
    });

    return { feed, onOpenVersion, onScrollToBlock };
  };

  const cards = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[data-pg-update]')];

  it('draws a card per record with avatar, line and time', async () => {
    const { feed } = mount(async () => items);

    await feed.ready;

    expect(cards()).toHaveLength(3);
    expect(cards()[0].querySelector('.pg-hp-avatar')?.textContent).toBe('B');
    expect(cards()[0].querySelector('[data-pg-update-line]')?.textContent).toBe('ben edited Demo Page');
    expect(cards()[0].querySelector('[data-pg-update-time]')?.textContent).toBe('3 hours ago');
  });

  it('opens the record’s version from the History icon button', async () => {
    const { feed, onOpenVersion } = mount(async () => items);

    await feed.ready;

    const open = cards()[0].querySelector<HTMLButtonElement>('[data-pg-update-open]');

    expect(open?.getAttribute('aria-label')).toBe('View version for this update');
    const icon = document.createElement('span');

    icon.innerHTML = IconRotateLeft;
    expect(open?.innerHTML).toBe(icon.innerHTML);
    expect(open?.hasAttribute('title')).toBe(false);
    open?.click();
    expect(onOpenVersion).toHaveBeenCalledWith('L', 30);
  });

  it('shows the word diff and scrolls the editor to the block', async () => {
    const { feed, onScrollToBlock } = mount(async () => items);

    await feed.ready;

    const snippet = cards()[0].querySelector<HTMLButtonElement>('button[data-pg-update-snippet]');

    expect(snippet?.querySelector('del')?.textContent).toBe('two');
    expect(snippet?.querySelector('ins')?.textContent).toBe('three');
    snippet?.click();
    expect(onScrollToBlock).toHaveBeenCalledWith('a');
  });

  it('does not offer to scroll to a removed block', async () => {
    const { feed } = mount(async () => items);

    await feed.ready;

    const snippet = cards()[2].querySelector('[data-pg-update-snippet]');

    expect(snippet?.tagName).toBe('SPAN');
    expect(snippet?.textContent).toBe('bye');
  });

  it('shows four snippets and reveals the rest with View N more', async () => {
    const { feed } = mount(async () => items);

    await feed.ready;

    const card = cards()[1];
    const more = card.querySelector<HTMLButtonElement>('[data-pg-update-more]');

    expect(card.querySelectorAll('[data-pg-update-snippet]')).toHaveLength(4);
    expect(more?.textContent).toBe('View 2 more');
    more?.click();
    expect(card.querySelectorAll('[data-pg-update-snippet]')).toHaveLength(6);
    expect(card.querySelector('[data-pg-update-more]')).toBeNull();
  });

  it('says when there are no updates, and shows load errors', async () => {
    const empty = mount(async () => []);

    await empty.feed.ready;
    expect(host.querySelector('[data-pg-updates-status]')?.textContent).toBe('No updates yet.');
    empty.feed.destroy();

    const failing = mount(async () => {
      throw new Error('Nope (500)');
    });

    await failing.feed.ready;
    expect(host.querySelector('[data-pg-updates-status]')?.textContent).toBe('Nope (500)');
  });

  it('loads again on reload', async () => {
    const load = vi.fn(async () => items.slice(0, 1));
    const { feed } = mount(load);

    await feed.ready;
    await feed.reload();

    expect(load).toHaveBeenCalledTimes(2);
    expect(cards()).toHaveLength(1);
  });

  it('keeps the newer load when an older one answers late', async () => {
    const slow: { resolve(value: UpdateItem[]): void } = { resolve: () => undefined };
    const late = new Promise<UpdateItem[]>((resolve) => {
      slow.resolve = resolve;
    });
    const load = vi.fn()
      .mockImplementationOnce(() => late)
      .mockImplementationOnce(async () => items.slice(0, 1));
    const { feed } = mount(load);

    await feed.reload();
    slow.resolve(items);
    await feed.ready;

    expect(cards()).toHaveLength(1);
  });
});

describe('mountEditedLink', () => {
  it('shows the label, hides without one, and opens Updates', () => {
    const onOpen = vi.fn();
    const link = mountEditedLink({ onOpen, now: () => NOW });

    expect(link.element.tagName).toBe('BUTTON');
    expect(link.element.hidden).toBe(true);

    link.update({ versions: [version('L', 3, ago(2 * MIN))] });
    expect(link.element.hidden).toBe(false);
    expect(link.element.textContent).toBe('Edited 2 minutes ago');

    link.element.click();
    expect(onOpen).toHaveBeenCalledTimes(1);

    link.update(null);
    expect(link.element.hidden).toBe(true);
  });
});
