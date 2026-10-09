import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openFilterPill, openViewSettings } from '../../../../src/tools/database/database-view-settings-panel';
import type { ViewSettingsContext } from '../../../../src/tools/database/database-view-settings-panel';
import type { DatabasePanel } from '../../../../src/tools/database/database-panel';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'due', name: 'Due', type: 'date', position: 'a1' },
  { id: 'num', name: 'Amount', type: 'number', position: 'a2' },
  { id: 'stage', name: 'Stage', type: 'select', position: 'a3', config: { options: [{ id: 'o1', label: 'Idea', position: 'a0' }] } },
  { id: 'prog', name: 'Progress', type: 'status', position: 'a4', config: { options: [{ id: 's1', label: 'Not started', position: 'a0', groupId: 'todo' }] } },
  { id: 'owner', name: 'Owner', type: 'person', position: 'a5' },
];

const click = (id: string): void => {
  const el = document.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`);

  if (el === null) throw new Error(`no ${id}`);
  el.click();
};

const exists = (id: string): boolean => document.querySelector(`[data-blok-testid="${id}"]`) !== null;

interface Harness {
  ctx: ViewSettingsContext;
  state: { view: DatabaseViewConfig; locked: boolean };
  open: (start?: 'root' | 'filter' | 'sort' | 'group') => DatabasePanel;
  openPill: (filterId: string) => DatabasePanel;
}

const harness = (view: Partial<DatabaseViewConfig> = {}): Harness => {
  const state = {
    view: { id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view } satisfies DatabaseViewConfig,
    locked: false,
  };
  const holder: { panel: DatabasePanel | null } = { panel: null };
  const apply = (changes: Partial<DatabaseViewConfig>): void => {
    state.view = { ...state.view, ...changes };
    holder.panel?.refresh();
  };
  const ctx: ViewSettingsContext = {
    i18n: { t: (key: string) => key },
    view: () => state.view,
    schema: () => schema,
    locked: () => state.locked,
    layouts: ['table', 'board', 'list'],
    canDeleteView: () => true,
    updateView: vi.fn((changes: Partial<DatabaseViewConfig>) => apply(changes)),
    updatePersonal: vi.fn((patch: Partial<DatabaseViewConfig>) => apply(patch)),
    setLayout: vi.fn((type: DatabaseViewConfig['type']) => apply({ type })),
    setLocked: vi.fn((locked: boolean) => {
      state.locked = locked;
    }),
    duplicateView: vi.fn(),
    deleteView: vi.fn(),
    copyViewLink: vi.fn(),
    groups: () => [{ key: 'o1', label: 'Idea', count: 2 }, { key: 'none', label: 'No Stage', count: 0 }],
  };
  const anchor = document.createElement('button');

  document.body.appendChild(anchor);

  return {
    ctx,
    state,
    open: (start = 'root') => {
      holder.panel = openViewSettings(anchor, ctx, start);

      return holder.panel;
    },
    openPill: (filterId) => {
      holder.panel = openFilterPill(anchor, ctx, filterId);

      return holder.panel;
    },
  };
};

describe('view settings panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('lists Notion\'s settings rows (research/08)', () => {
    harness().open();

    for (const id of ['layout', 'properties', 'filter', 'sort', 'group', 'color', 'copy-link', 'lock', 'duplicate', 'delete']) {
      expect(exists(`database-settings-${id}`)).toBe(true);
    }
    expect(exists('database-settings-subgroup')).toBe(false);
  });

  it('offers a sub-group on a board only', () => {
    harness({ type: 'board' }).open();

    expect(exists('database-settings-subgroup')).toBe(true);
  });

  it('switches the layout and marks the current one with a check', () => {
    const h = harness();

    h.open();
    click('database-settings-layout');

    expect(document.querySelector('[data-blok-testid="database-layout-table"]')?.getAttribute('aria-checked')).toBe('true');

    click('database-layout-board');

    expect(h.ctx.setLayout).toHaveBeenCalledWith('board');
    expect(document.querySelector('[data-blok-testid="database-layout-board"]')?.getAttribute('aria-checked')).toBe('true');
  });

  it('sets the load limit, where pages open, and the layout switches', () => {
    const h = harness();

    h.open();
    click('database-settings-layout');
    click('database-settings-load-limit');
    click('database-load-limit-100');

    expect(h.ctx.updateView).toHaveBeenCalledWith({ loadLimit: 100 });

    click('database-panel-back');
    click('database-settings-open-pages');

    expect(document.body.textContent).toContain('tools.database.openPagesSideDescription');

    click('database-open-pages-center');

    expect(h.ctx.updateView).toHaveBeenCalledWith({ openPagesIn: 'center' });

    click('database-panel-back');
    click('database-settings-wrap');
    click('database-settings-vertical-lines');
    click('database-settings-page-icon');

    expect(h.ctx.updateView).toHaveBeenCalledWith({ wrapCells: true });
    expect(h.ctx.updateView).toHaveBeenCalledWith({ showVerticalLines: false });
    expect(h.ctx.updateView).toHaveBeenCalledWith({ showPageIcon: false });
  });

  it('hides a property and keeps the title always shown', () => {
    const h = harness();

    h.open();
    click('database-settings-properties');

    expect(exists('database-property-visible-title')).toBe(false);

    click('database-property-visible-due');

    expect(h.state.view.properties?.find((p) => p.id === 'due')?.visible).toBe(false);
  });

  it('adds a sort as a personal edit and flips its direction', () => {
    const h = harness();

    h.open('sort');
    click('database-sort-add');
    click('database-pick-property-num');

    expect(h.ctx.updatePersonal).toHaveBeenCalled();
    expect(h.ctx.updateView).not.toHaveBeenCalled();
    const [sort] = h.state.view.sorts;

    expect(sort).toMatchObject({ propertyId: 'num', direction: 'asc' });
    expect(document.querySelector(`[data-blok-testid="database-sort-direction-${sort.id ?? ''}"]`)?.textContent).toContain('tools.database.sortLowHigh');

    click(`database-sort-direction-${sort.id ?? ''}`);

    expect(h.state.view.sorts[0].direction).toBe('desc');
  });

  it('adds a simple filter and edits its value in its own page', () => {
    const h = harness();

    h.open('filter');
    click('database-filter-add');
    click('database-pick-property-stage');
    click('database-filter-option-o1');

    expect(h.state.view.filters).toEqual([expect.objectContaining({ propertyId: 'stage', operator: 'equals', value: ['o1'] })]);
  });

  it('builds an advanced filter with nested groups, three layers at most', () => {
    const h = harness({ filterTree: { id: 'root', conjunction: 'and', filterRules: [] } });

    h.open('filter');
    click('database-filter-advanced');
    const root = (): string => h.state.view.filterTree?.id ?? '';

    click(`database-filter-add-rule-${root()}`);
    click('database-pick-property-num');
    click(`database-filter-add-group-${root()}`);

    const tree = h.state.view.filterTree;
    const layer2 = tree?.filterRules.find((node) => 'filterRules' in node);

    expect(tree?.filterRules).toHaveLength(2);
    expect(exists(`database-filter-conjunction-${root()}`)).toBe(true);

    click(`database-filter-add-group-${layer2?.id ?? ''}`);
    const layer3 = h.state.view.filterTree?.filterRules
      .flatMap((node) => ('filterRules' in node ? node.filterRules : []))
      .find((node) => 'filterRules' in node);

    expect(layer3).toBeDefined();
    expect(exists(`database-filter-add-rule-${layer3?.id ?? ''}`)).toBe(true);
    expect(exists(`database-filter-add-group-${layer3?.id ?? ''}`)).toBe(false);
    expect(h.ctx.updateView).not.toHaveBeenCalled();
  });

  it('sets And or Or on a group', () => {
    const h = harness({
      filterTree: {
        id: 'root',
        conjunction: 'and',
        filterRules: [
          { id: 'a', propertyId: 'num', operator: 'is_empty', value: null },
          { id: 'b', propertyId: 'due', operator: 'is_empty', value: null },
        ],
      },
    });

    h.open('filter');
    click('database-filter-advanced');
    click('database-filter-conjunction-root');
    click('database-filter-conjunction-or');

    expect(h.state.view.filterTree?.conjunction).toBe('or');
  });

  it('groups a date by week and hides every group at once', () => {
    const h = harness({ groupBy: 'due' });

    h.open('group');
    click('database-group-date-by');
    click('database-group-date-by-week');

    expect(h.state.view.groupSettings).toEqual({ dateBy: 'week' });

    click('database-group-hide-all');

    expect(h.state.view.hiddenGroups).toEqual([{ id: 'o1' }, { id: 'none' }]);
  });

  it('groups a status by group or by option (research/08 "Status by")', () => {
    const h = harness({ type: 'board', groupBy: 'prog' });

    h.open('group');

    expect(document.querySelector('[data-blok-testid="database-group-status-by"]')?.textContent).toContain('tools.database.groupStatusOption');

    click('database-group-status-by');
    click('database-group-status-by-group');

    expect(h.ctx.updateView).toHaveBeenCalledWith({ groupByStatus: 'group' });
    expect(exists('database-group-color-columns')).toBe(true);
  });

  it.each([
    ['prog', 'status'],
    ['owner', 'person'],
  ])('shows no group sort for a %s (%s) grouping, as research/08 measured', (groupBy) => {
    harness({ groupBy }).open('group');

    expect(exists('database-group-sort')).toBe(false);
    expect(exists('database-group-text-by')).toBe(false);
    expect(exists('database-group-date-by')).toBe(false);
    expect(exists('database-group-hide-empty')).toBe(true);
  });

  it('offers "Me" first in a person filter', () => {
    const h = harness();

    h.ctx.people = () => [{ id: 'u1', name: 'Ada' }];
    h.open('filter');
    click('database-filter-add');
    click('database-pick-property-owner');
    click('database-filter-person-me');
    click('database-filter-person-u1');

    expect(h.state.view.filters[0]).toMatchObject({ propertyId: 'owner', operator: 'contains', value: ['me', 'u1'] });
  });

  it('adds a conditional color rule and picks its background', () => {
    const h = harness();

    h.open();
    click('database-settings-color');
    click('database-color-add');
    click('database-pick-property-num');
    const [rule] = h.state.view.colorRules ?? [];

    expect(rule).toMatchObject({ propertyId: 'num', operator: 'is_not_empty', color: 'gray' });

    click(`database-color-background-${rule.id}`);
    click('database-color-pick-green');
    click(`database-color-apply-${rule.id}`);
    click('database-color-apply-property');

    expect(h.state.view.colorRules?.[0]).toMatchObject({ color: 'green', applyTo: 'property' });
  });

  it('blocks shared edits while locked, but not personal filters', () => {
    const h = harness();

    h.state.locked = true;
    h.open();

    expect((document.querySelector('[data-blok-testid="database-settings-delete"]') as HTMLButtonElement).disabled).toBe(true);

    click('database-settings-filter');
    click('database-filter-add');
    click('database-pick-property-num');

    expect(h.state.view.filters).toHaveLength(1);
  });

  it('opens a filter pill popover at its editor, 220 wide', () => {
    const h = harness({ filters: [{ id: 'f1', propertyId: 'due', operator: 'this_week', value: null }] });

    h.openPill('f1');

    expect((document.querySelector('[data-blok-testid="database-filter-popover"]') as HTMLElement).style.width).toBe('220px');

    click('database-filter-within-past_month');

    expect(h.state.view.filters[0]).toMatchObject({ operator: 'past_month', value: null });

    click('database-filter-delete');

    expect(h.state.view.filters).toEqual([]);
  });
});
