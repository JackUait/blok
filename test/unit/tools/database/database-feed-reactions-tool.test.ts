import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseConfig, DatabaseData, PropertyDefinition } from '../../../../src/tools/database/types';
import { buildDatabase, makeDoc, rowSeed } from './structure-harness';
import type { Doc } from './structure-harness';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

interface PickerCall {
  options: Record<string, unknown>;
  anchor: HTMLElement;
  handlers: { onSelect: (native: string) => void; onRemove: () => void };
}

const pickers = vi.hoisted(() => ({ opened: [] as unknown[], built: [] as unknown[] }));

vi.mock('../../../../src/tools/callout/emoji-picker', () => ({
  prefetchEmojiPickerData: vi.fn(),
  EmojiPicker: class {
    private readonly element = document.createElement('div');

    constructor(private readonly options: Record<string, unknown>) {
      pickers.built.push(options);
    }

    getElement(): HTMLElement {
      return this.element;
    }

    open(anchor: HTMLElement, _rect: undefined, handlers: PickerCall['handlers']): Promise<void> {
      pickers.opened.push({ options: this.options, anchor, handlers });

      return Promise.resolve();
    }

    close(): void {}
  },
}));

const schema: PropertyDefinition[] = [{ id: 'title', name: 'Name', type: 'title', position: 'a0' }];

const data = (): DatabaseData => ({
  schema,
  views: [{ id: 'v', name: 'Feed', type: 'feed', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
  activeViewId: 'v',
});

const me = (): DatabaseConfig => ({ people: { list: () => Promise.resolve([]), me: () => 'me' } });

const build = (reactions: Record<string, Record<string, number>> | undefined, config: DatabaseConfig = me()): { doc: Doc; el: HTMLElement } => {
  const doc = makeDoc([
    { id: 'db', name: 'database', parentId: null, data: {} },
    rowSeed('r1', 'db', { properties: { title: 'Post' }, ...(reactions !== undefined ? { reactions } : {}) }),
  ]);
  const { el } = buildDatabase(doc, 'db', data(), config);

  return { doc, el };
};

/** jsdom's selector engine does not match an emoji attribute value, so compare it directly. */
const pill = (el: HTMLElement, emoji: string): HTMLElement | null =>
  Array.from(el.querySelectorAll<HTMLElement>('[data-blok-database-feed-reaction]')).find((candidate) => candidate.getAttribute('data-emoji') === emoji) ?? null;

const lastPicker = (): PickerCall => pickers.opened.at(-1) as PickerCall;

describe('feed reactions in the database', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pickers.opened.length = 0;
    pickers.built.length = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    PopoverRegistry.resetForTests();
    document.body.innerHTML = '';
  });

  it('adds your reaction from someone else\'s pill, as a write undo skips', () => {
    const { doc, el } = build({ ada: { '👍': 1 } });

    pill(el, '👍')?.click();

    expect(doc.row('r1').reactions).toEqual({ ada: { '👍': 1 }, me: { '👍': Date.parse('2026-10-16T10:00:00.000Z') } });
    expect(doc.blocks.get('r1')?.block.dispatchChange).toHaveBeenCalledWith({ derived: true });
    expect(pill(el, '👍')?.textContent).toBe('👍2');
    expect(pill(el, '👍')?.hasAttribute('data-mine')).toBe(true);
  });

  it('removes your reaction from your own pill', () => {
    const { doc, el } = build({ me: { '👍': 1 } });

    pill(el, '👍')?.click();

    expect(doc.row('r1').reactions).toEqual({});
    expect(pill(el, '👍')).toBeNull();
  });

  it('opens the full picker from Add reaction and adds the pick', () => {
    const { doc, el } = build(undefined);
    const add = el.querySelector<HTMLElement>('[data-blok-database-feed-add-reaction]');

    add?.click();
    expect(lastPicker().anchor).toBe(add);
    expect(lastPicker().options).toMatchObject({ pickOnly: true, curated: false, label: 'tools.database.feedAddReaction' });
    lastPicker().handlers.onSelect('🎉');

    expect(doc.row('r1').reactions).toEqual({ me: { '🎉': Date.parse('2026-10-16T10:00:00.000Z') } });
    expect(pill(el, '🎉')?.hasAttribute('data-mine')).toBe(true);
  });

  it('keeps the first reaction time when you pick an emoji you already reacted with', () => {
    const { doc, el } = build({ me: { '🎉': 5 } });

    el.querySelector<HTMLElement>('[data-blok-database-feed-react]')?.click();
    lastPicker().handlers.onSelect('🎉');

    expect(doc.row('r1').reactions).toEqual({ me: { '🎉': 5 } });
  });

  it.each([
    ['there is no current user', { people: { list: () => Promise.resolve([]) } }],
    ['the host does not allow comments', { ...me(), permissions: { can: (action: string) => action !== 'comment' } }],
  ])('shows reactions but offers no way to react when %s', (_case, config) => {
    const { el } = build({ ada: { '👍': 1 } }, config);

    expect(pill(el, '👍')?.tagName).toBe('SPAN');
    expect(el.querySelector('[data-blok-database-feed-add-reaction]')).toBeNull();
    expect(el.querySelector('[data-blok-database-feed-react]')).toBeNull();
  });

  it('leaves the card footer to a host that draws its own', () => {
    const { el } = build({ ada: { '👍': 1 } }, { ...me(), feedFooter: () => undefined });

    expect(pill(el, '👍')).toBeNull();
    expect(el.querySelector('[data-blok-database-feed-add-reaction]')).toBeNull();
  });

  it('shows a reaction a peer adds without a reload', async () => {
    const { doc, el } = build({ ada: { '👍': 1 } });
    const entry = doc.blocks.get('r1');

    if (entry === undefined) throw new Error('no row');
    entry.data = { ...entry.data, reactions: { ada: { '👍': 1 }, bo: { '🎉': 2 } } };
    doc.api.events.emit('block changed', { event: { detail: { target: entry.block } } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pill(el, '🎉')?.textContent).toBe('🎉1');
  });

  it('More actions offers the row actions, searchable', () => {
    const { el } = build(undefined);

    el.querySelector<HTMLElement>('[data-blok-database-feed-more-actions]')?.click();

    const names = Array.from(document.querySelectorAll('[data-blok-popover-opened] [data-blok-item-name]')).map((item) => item.getAttribute('data-blok-item-name'));

    expect(names).toEqual(expect.arrayContaining(['database-row-copy-link', 'database-row-duplicate', 'database-row-delete']));
    expect(document.querySelector('[data-blok-popover-opened] input[placeholder="tools.database.searchActions"]')).not.toBeNull();
  });

  it('a duplicate starts with no reactions', () => {
    const { doc, el } = build({ ada: { '👍': 1 } });

    el.querySelector<HTMLElement>('[data-blok-database-feed-more-actions]')?.click();
    document.querySelector<HTMLElement>('[data-blok-popover-opened] [data-blok-item-name="database-row-duplicate"]')?.click();

    const copy = doc.childrenOf('db').find((id) => id !== 'r1');

    expect(copy).toBeDefined();
    expect(doc.row(copy ?? '').reactions).toBeUndefined();
  });
});
