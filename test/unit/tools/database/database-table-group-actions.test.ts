import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseData } from '../../../../src/tools/database/types';
import { NO_VALUE_GROUP_KEY } from '../../../../src/tools/database/group-keys';
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

  it('⋯ opens the group menu with "Show aggregation", and the header shows no count yet', () => {
    const { el } = buildDatabase(seed(), 'db', data());

    openMenu(el, 'red');

    expect(document.querySelector('[data-blok-item-name="hide-group"]')).not.toBeNull();
    expect(document.querySelector('[data-blok-item-name="color-yellow"]')).not.toBeNull();
    expect(document.querySelector('[data-blok-item-name="toggle-aggregation"]')?.textContent).toContain('tools.database.groupShowAggregation');
    expect(el.querySelector('[data-blok-database-table-group-count]')).toBeNull();
  });
});

const openMenu = (el: HTMLElement, key: string): void => {
  el.querySelector<HTMLElement>(`[data-group-key="${key}"] [data-blok-database-table-group-header] [data-blok-database-table-group-menu]`)?.click();
};

const countOf = (el: HTMLElement, key: string): HTMLElement | null =>
  el.querySelector<HTMLElement>(`[data-group-key="${key}"] [data-blok-database-table-group-header] [data-blok-database-table-group-count]`);

// notion-motion.md Round 11 "Group header with Show aggregation".
describe('table group header aggregation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('"Show aggregation" from one group shows a count on every group header, after the name', () => {
    const { el } = buildDatabase(seed(), 'db', data());

    openMenu(el, 'red');
    document.querySelector<HTMLElement>('[data-blok-item-name="toggle-aggregation"]')?.click();

    const red = countOf(el, 'red');

    expect(red?.textContent).toBe('1');
    expect(countOf(el, NO_VALUE_GROUP_KEY)?.textContent).toBe('1');
    expect(el.querySelectorAll('[data-blok-database-table-group-count]')).toHaveLength(2);
    expect(red?.previousElementSibling?.hasAttribute('data-blok-database-table-group-label')).toBe(true);
    expect(red?.nextElementSibling?.hasAttribute('data-blok-database-table-group-actions')).toBe(true);
  });

  it('keeps the counts after a reload, and the ⋯ row then reads "Hide aggregation"', () => {
    const doc = seed();
    const first = buildDatabase(doc, 'db', data());

    openMenu(first.el, 'red');
    document.querySelector<HTMLElement>('[data-blok-item-name="toggle-aggregation"]')?.click();
    const saved = first.tool.save(first.el);

    expect(saved.views[0].hideGroupAggregation).toBe(false);
    first.tool.destroy();
    document.body.innerHTML = '';

    const { el } = buildDatabase(doc, 'db', { ...data(), views: saved.views });

    expect(countOf(el, 'red')?.textContent).toBe('1');
    openMenu(el, 'red');
    expect(document.querySelector('[data-blok-item-name="toggle-aggregation"]')?.textContent).toContain('tools.database.groupHideAggregation');
  });

  it('"Hide aggregation" takes every count away', () => {
    const { el } = buildDatabase(seed(), 'db', { ...data(), views: [{ ...data().views[0], hideGroupAggregation: false }] });

    expect(countOf(el, 'red')).not.toBeNull();
    openMenu(el, 'red');
    document.querySelector<HTMLElement>('[data-blok-item-name="toggle-aggregation"]')?.click();

    expect(el.querySelector('[data-blok-database-table-group-count]')).toBeNull();
  });

  it('clicking a count opens the group calculation menu, with no None row, 200 wide', () => {
    const { el } = buildDatabase(seed(), 'db', { ...data(), views: [{ ...data().views[0], hideGroupAggregation: false }] });
    const count = countOf(el, 'red');

    expect(count?.tagName).toBe('BUTTON');
    count?.click();

    const popover = document.querySelector<HTMLElement>('[data-blok-popover-container]');

    expect(popover?.textContent).toContain('tools.database.calcCount');
    expect(popover?.textContent).toContain('tools.database.calcPercent');
    expect(popover?.closest<HTMLElement>('[style*="--width"]')?.style.getPropertyValue('--width')).toBe('200px');
    expect(popover?.textContent).not.toContain('tools.database.calcNone');
    expect(el.querySelector('[data-group-key="red"] [data-blok-database-table-group-header]')?.hasAttribute('data-popover-open')).toBe(true);
  });
});
