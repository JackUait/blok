import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseData, DatabaseViewConfig } from '../../../../src/tools/database/types';
import { buildDatabase, makeDoc, rowSeed } from './structure-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

// Goals Tracker's Team (research/31 §8): option order AM, BD, PD, HR.
const data = (type: 'table' | 'board', extra: Partial<DatabaseViewConfig> = {}): DatabaseData => ({
  schema: [
    { id: 'title', name: 'Name', type: 'title', position: 'a0' },
    { id: 'team', name: 'Team', type: 'multiSelect', position: 'a1', config: { options: [
      { id: 'am', label: 'Account Management', color: 'default', position: 'a0' },
      { id: 'bd', label: 'Business Development', color: 'blue', position: 'a1' },
      { id: 'pd', label: 'Product Design', color: 'green', position: 'a2' },
      { id: 'hr', label: 'Human Resources', color: 'purple', position: 'a3' },
    ] } },
  ],
  views: [{ id: 'v', name: 'By Team', type, position: 'a0', sorts: [], filters: [], visibleProperties: ['team'], groupBy: 'team', groupSettings: { sort: 'manual' }, ...extra }],
  activeViewId: 'v',
});

const seed = (): ReturnType<typeof makeDoc> => makeDoc([
  { id: 'db', name: 'database', parentId: null, data: {} },
  rowSeed('r1', 'db', { properties: { title: 'One', team: ['bd'] }, position: 'a0' }),
]);

const tableGroups = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('[data-blok-database-table-group]')].map((g) => g.getAttribute('data-group-key') ?? '');
const boardColumns = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('[data-blok-database-column][data-option-id]')].map((c) => c.getAttribute('data-option-id') ?? '');
const NO_VALUE = '__blok-no-value-group__';

describe('a view\'s own manual group order (research/31 §8: By Team)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a view with a group order draws its groups in that order; options without a key keep their place', () => {
    const { el } = buildDatabase(seed(), 'db', data('table', { groupOrder: { hr: 'a1V' } }));

    expect(tableGroups(el)).toEqual(['am', 'bd', 'hr', 'pd', NO_VALUE]);
  });

  it('without one the groups follow the option order, as before', () => {
    const { el } = buildDatabase(seed(), 'db', data('table'));

    expect(tableGroups(el)).toEqual(['am', 'bd', 'pd', 'hr', NO_VALUE]);
  });

  it('the no-value group\'s saved place is read against the view\'s keys', () => {
    const { el } = buildDatabase(seed(), 'db', data('table', { groupOrder: { hr: 'a1V' }, noValueGroupPosition: 'a1Z' }));

    expect(tableGroups(el)).toEqual(['am', 'bd', 'hr', NO_VALUE, 'pd']);
  });

  it('a sorted view ignores the group order', () => {
    const { el } = buildDatabase(seed(), 'db', data('table', { groupOrder: { am: 'b0' }, groupSettings: { sort: 'ascending' } }));

    expect(tableGroups(el)).toEqual(['am', 'bd', 'hr', 'pd', NO_VALUE]);
  });

  it('a board column dropped in a view with a group order moves only in that view; the options keep their positions', () => {
    const doc = seed();
    const { tool, el } = buildDatabase(doc, 'db', data('board', { groupOrder: { hr: 'a1V' } }));

    expect(boardColumns(el)).toEqual(['am', 'bd', 'hr', 'pd', NO_VALUE]);
    (tool as unknown as { handleGroupDrop: (r: { optionId: string; beforeOptionId: string | null; afterOptionId: string | null }) => void })
      .handleGroupDrop({ optionId: 'am', beforeOptionId: NO_VALUE, afterOptionId: 'pd' });
    const saved = tool.save(document.createElement('div'));

    expect(saved.schema[1].config?.options.map((o) => [o.id, o.position])).toEqual([['am', 'a0'], ['bd', 'a1'], ['pd', 'a2'], ['hr', 'a3']]);
    const order = saved.views[0].groupOrder ?? {};
    const keyOf = (id: string): string => order[id] ?? saved.schema[1].config?.options.find((o) => o.id === id)?.position ?? '';
    const ids = ['am', 'bd', 'pd', 'hr'].sort((x, y) => (keyOf(x) < keyOf(y) ? -1 : 1));

    expect(ids).toEqual(['bd', 'hr', 'pd', 'am']);
  });
});
