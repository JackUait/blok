import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { onHover } from '../../../../src/components/utils/tooltip';
import { DatabaseFeedView } from '../../../../src/tools/database/database-feed-view';
import type { FeedViewOptions } from '../../../../src/tools/database/database-feed-view';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

vi.mock('../../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
}));

const schema: PropertyDefinition[] = [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }];

const view: DatabaseViewConfig = { id: 'v1', name: 'Feed', type: 'feed', position: 'a0', sorts: [], filters: [], visibleProperties: [] };

const names: Record<string, string> = { me: 'Jack', ada: 'Ada', bo: 'Bo' };

const toggle = vi.fn();
const pick = vi.fn();
const actions = vi.fn();
const openRow = vi.fn();

const render = (rows: DatabaseRow[], overrides: Partial<FeedViewOptions> = {}): HTMLElement => {
  const el = new DatabaseFeedView({
    view,
    schema,
    rows,
    total: rows.length,
    titlePropertyId: 'p-title',
    i18n: { t: (key: string, vars?: Record<string, string | number>) => (vars === undefined ? key : `${key} ${JSON.stringify(vars)}`) },
    locale: 'en-US',
    bodyOf: () => [],
    personName: (id) => names[id],
    handlers: { openRow, loadMore: vi.fn() },
    reactions: { me: 'me', toggle, pick },
    actions,
    ...overrides,
  }).createView();

  document.body.appendChild(el);

  return el;
};

const row = (reactions?: DatabaseRow['reactions']): DatabaseRow => ({ id: 'r1', position: 'a0', properties: { 'p-title': 'Post' }, ...(reactions !== undefined ? { reactions } : {}) });

const pills = (el: HTMLElement): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>('[data-blok-database-feed-reaction]'));

const tooltipOf = (el: HTMLElement): unknown => vi.mocked(onHover).mock.calls.find(([target]) => target === el)?.[1];

describe('DatabaseFeedView reactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('shows one pill per emoji with its count, oldest reaction first', () => {
    const el = render([row({ ada: { '🎉': 20, '👍': 30 }, bo: { '👍': 10 } })]);

    expect(pills(el).map((pill) => pill.textContent)).toEqual(['👍2', '🎉1']);
    expect(pills(el).map((pill) => pill.querySelector('[data-blok-database-feed-reaction-count]')?.textContent)).toEqual(['2', '1']);
  });

  it('marks only the pill the viewer reacted with as theirs', () => {
    const el = render([row({ me: { '👍': 10 }, ada: { '🎉': 20 } })]);

    expect(pills(el).map((pill) => pill.hasAttribute('data-mine'))).toEqual([true, false]);
    expect(pills(el).map((pill) => pill.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
  });

  it('names who reacted in the hover hint, in the order they reacted', () => {
    const el = render([row({ ada: { '👍': 30 }, me: { '👍': 10 }, bo: { '👍': 20 } })]);

    expect(tooltipOf(pills(el)[0])).toBe('tools.database.feedReactedWith {"names":"Jack, Bo, and Ada","emoji":"👍"}');
  });

  it('toggles a reaction from its pill, without opening the row', () => {
    const el = render([row({ ada: { '👍': 30 } })]);

    pills(el)[0].click();
    expect(toggle).toHaveBeenCalledWith('r1', '👍');
    expect(openRow).not.toHaveBeenCalled();
  });

  it('opens the picker from Add reaction and from the hover React button', () => {
    const el = render([row()]);
    const add = el.querySelector<HTMLButtonElement>('[data-blok-database-feed-add-reaction]');
    const react = el.querySelector<HTMLButtonElement>('[data-blok-database-feed-react]');

    expect(add?.getAttribute('aria-label')).toBe('tools.database.feedAddReaction');
    expect(tooltipOf(add as HTMLElement)).toBe('tools.database.feedAddReaction');
    expect(react?.getAttribute('aria-label')).toBe('tools.database.feedReact');
    expect(tooltipOf(react as HTMLElement)).toBe('tools.database.feedReact');
    add?.click();
    expect(pick).toHaveBeenLastCalledWith('r1', add);
    react?.click();
    expect(pick).toHaveBeenLastCalledWith('r1', react);
  });

  it('opens the row actions from the hover More actions button', () => {
    const el = render([row()]);
    const more = el.querySelector<HTMLButtonElement>('[data-blok-database-feed-more-actions]');
    const card = el.querySelector('[data-blok-database-feed-card]');

    expect(more?.getAttribute('aria-label')).toBe('tools.database.tableMoreActions');
    expect(tooltipOf(more as HTMLElement)).toBe('tools.database.tableMoreActions');
    more?.click();
    expect(actions).toHaveBeenCalledWith('r1', more, card);
  });

  it('shows reactions but no way to react when the viewer cannot react', () => {
    const el = render([row({ ada: { '👍': 30 } })], { reactions: { me: 'me' } });

    expect(pills(el)).toHaveLength(1);
    expect(pills(el)[0].tagName).toBe('SPAN');
    expect(tooltipOf(pills(el)[0])).toBe('tools.database.feedReactedWith {"names":"Ada","emoji":"👍"}');
    expect(el.querySelector('[data-blok-database-feed-add-reaction]')).toBeNull();
    expect(el.querySelector('[data-blok-database-feed-react]')).toBeNull();
  });

  it('draws nothing of its own in a card footer the host owns', () => {
    const el = render([row({ ada: { '👍': 30 } })], { footer: vi.fn() });

    expect(pills(el)).toHaveLength(0);
    expect(el.querySelector('[data-blok-database-feed-add-reaction]')).toBeNull();
    expect(el.querySelector('[data-blok-database-feed-react]')).toBeNull();
    expect(el.querySelector('[data-blok-database-feed-more-actions]')).not.toBeNull();
  });

  it('shows no pill for a person who took every reaction back', () => {
    const el = render([row({ ada: {} })]);

    expect(pills(el)).toHaveLength(0);
    expect(el.querySelector('[data-blok-database-feed-add-reaction]')).not.toBeNull();
  });
});
