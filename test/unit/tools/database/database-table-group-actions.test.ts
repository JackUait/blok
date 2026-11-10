import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseData } from '../../../../src/tools/database/types';
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

const data = (): DatabaseData => ({
  schema: [
    { id: 'title', name: 'Name', type: 'title', position: 'a0' },
    { id: 'sel', name: 'Select', type: 'select', position: 'a1', config: { options: [
      { id: 'red', label: 'Red', color: 'yellow', position: 'a0' },
    ] } },
  ],
  views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['title', 'sel'], groupBy: 'sel' }],
  activeViewId: 'v',
});

const seed = (): ReturnType<typeof makeDoc> => makeDoc([
  { id: 'db', name: 'database', parentId: null, data: {} },
  rowSeed('r1', 'db', { properties: { title: 'Alpha', sel: 'red' }, position: 'a0' }),
  rowSeed('r2', 'db', { properties: { title: 'Beta', sel: null }, position: 'a1' }),
]);

const groupRows = (el: HTMLElement, key: string): string[] =>
  [...el.querySelectorAll(`[data-blok-database-table-group][data-group-key="${key}"] [data-blok-database-table-row]`)]
    .map((row) => row.getAttribute('data-row-id') ?? '');

// notion-motion.md Round 10 "Group header ⋯ menu" and "Group header +", table grouped by Select.
describe('table group header ⋯ and +', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('+ adds a page with the group\'s value at the end of that group and opens it', () => {
    const doc = seed();
    const { el } = buildDatabase(doc, 'db', data());

    el.querySelector<HTMLElement>('[data-group-key="red"] [data-blok-database-table-group-header] [data-blok-database-table-group-add]')?.click();

    const rows = groupRows(el, 'red');
    const added = rows.at(-1) ?? '';

    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe('r1');
    expect(doc.row(added).properties.sel).toBe('red');
    expect(document.querySelector('[data-blok-database-drawer]')).not.toBeNull();
  });

  it('⋯ opens the group menu without a count toggle, the table header shows no count', () => {
    const { el } = buildDatabase(seed(), 'db', data());

    el.querySelector<HTMLElement>('[data-group-key="red"] [data-blok-database-table-group-header] [data-blok-database-table-group-menu]')?.click();

    expect(document.querySelector('[data-blok-item-name="hide-group"]')).not.toBeNull();
    expect(document.querySelector('[data-blok-item-name="color-yellow"]')).not.toBeNull();
    expect(document.querySelector('[data-blok-item-name="toggle-aggregation"]')).toBeNull();
  });
});
