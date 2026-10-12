import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseModel } from '../../../../src/tools/database/database-model';
import { openFilterPill, openViewSettings } from '../../../../src/tools/database/database-view-settings-panel';
import type { ViewSettingsContext } from '../../../../src/tools/database/database-view-settings-panel';
import type { DatabasePanel } from '../../../../src/tools/database/database-panel';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';
import { PopoverItemType } from '../../../../src/components/utils/popover/components/popover-item';

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

  it('mounts the layout rows a gallery or calendar gives: a page per choice list, a switch per toggle', () => {
    const h = harness({ type: 'gallery' });
    const pickLarge = vi.fn();
    const flip = vi.fn();

    h.ctx.layoutItems = () => [
      {
        type: PopoverItemType.Default,
        name: 'gallery-card-size',
        title: 'Card size',
        children: { items: [
          { type: PopoverItemType.Default, name: 'gallery-card-size-small', title: 'Small', isActive: true, onActivate: vi.fn() },
          { type: PopoverItemType.Default, name: 'gallery-card-size-large', title: 'Large', isActive: false, onActivate: pickLarge },
        ] },
      },
      { type: PopoverItemType.Default, name: 'gallery-fit-image', title: 'Fit image', isActive: true, onActivate: flip },
    ];
    h.open();
    click('database-settings-layout');

    expect(document.querySelector('[data-blok-testid="database-gallery-card-size"]')?.textContent).toContain('Small');
    expect(document.querySelector('[data-blok-testid="database-gallery-fit-image"]')?.getAttribute('role')).toBe('switch');
    expect(document.querySelector('[data-blok-testid="database-gallery-fit-image"]')?.getAttribute('aria-checked')).toBe('true');

    click('database-gallery-fit-image');
    expect(flip).toHaveBeenCalledTimes(1);

    click('database-gallery-card-size');
    expect(document.querySelector('[data-blok-testid="database-gallery-card-size-small"]')?.getAttribute('aria-checked')).toBe('true');
    click('database-gallery-card-size-large');
    expect(pickLarge).toHaveBeenCalledTimes(1);
  });

  it('lists the tool actions on the root page; a click closes the panel and runs it', () => {
    const h = harness();
    const exportCsv = vi.fn();

    h.ctx.actions = () => [
      { testId: 'database-settings-csv-export', label: 'Export as CSV', icon: '', onClick: exportCsv },
      { testId: 'database-settings-csv-merge', label: 'Merge with CSV', icon: '', onClick: vi.fn(), disabled: true },
    ];
    const panel = h.open();
    const close = vi.spyOn(panel, 'close');

    expect(document.querySelector<HTMLButtonElement>('[data-blok-testid="database-settings-csv-merge"]')?.disabled).toBe(true);
    click('database-settings-csv-export');
    expect(exportCsv).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalled();
  });

  it('disables the mounted layout rows while the database is locked', () => {
    const h = harness({ type: 'gallery' });

    h.ctx.layoutItems = () => [{ type: PopoverItemType.Default, name: 'gallery-fit-image', title: 'Fit image', isActive: false, onActivate: vi.fn() }];
    h.state.locked = true;
    h.open();
    click('database-settings-layout');

    expect(document.querySelector<HTMLButtonElement>('[data-blok-testid="database-gallery-fit-image"]')?.disabled).toBe(true);
  });

  it('marks the layout\'s default open mode with "Default for <layout>", under that mode only', () => {
    const h = harness();

    h.open();
    click('database-settings-layout');
    click('database-settings-open-pages');
    const text = document.body.textContent ?? '';

    expect(text.match(/tools\.database\.openPagesDefaultFor/g)).toHaveLength(1);
    expect(text).toContain('tools.database.openPagesSideDescriptiontools.database.openPagesDefaultFor');
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

  it('offers every filterable property in "+ Filter", Files and ID too, but never a button', () => {
    const h = harness();
    const extra: PropertyDefinition[] = [
      { id: 'att', name: 'Attachment', type: 'files', position: 'a6' },
      { id: 'uid', name: 'ID', type: 'uniqueId', position: 'a7' },
      { id: 'act', name: 'Act', type: 'button', position: 'a8' },
    ];

    h.ctx.schema = () => [...schema, ...extra];
    h.open('filter');
    click('database-filter-add');

    expect(exists('database-pick-property-att')).toBe(true);
    expect(exists('database-pick-property-uid')).toBe(true);
    expect(exists('database-pick-property-act')).toBe(false);
  });

  it('reorders simple filters from the Filters page, keyboard Alt+Arrow included', () => {
    const h = harness({ filters: [
      { id: 'f1', propertyId: 'num', operator: 'is_not_empty', value: null },
      { id: 'f2', propertyId: 'due', operator: 'is_empty', value: null },
    ] });

    h.open('filter');
    document.querySelector('[data-blok-testid="database-filters-list-handle-f2"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }));

    expect(h.state.view.filters.map((f) => f.id)).toEqual(['f2', 'f1']);
  });

  it('reorders sorts from the Sort page, keyboard Alt+Arrow included', () => {
    const h = harness({ sorts: [
      { id: 's1', propertyId: 'num', direction: 'asc' },
      { id: 's2', propertyId: 'due', direction: 'desc' },
    ] });

    h.open('sort');
    document.querySelector('[data-blok-testid="database-sorts-list-handle-s1"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));

    expect(h.state.view.sorts.map((s) => s.id)).toEqual(['s2', 's1']);
  });

  it('moves flat filters into the advanced tree on its first edit', () => {
    const h = harness({ filters: [
      { id: 'legacy-title', propertyId: 'title', operator: 'equals', value: 'Alpha' },
      { id: 'legacy-num', propertyId: 'num', operator: 'greater_than', value: 10 },
    ] });

    h.open('filter');
    click('database-filter-advanced');
    const add = document.querySelector<HTMLElement>('[data-blok-testid^="database-filter-add-rule-"]');

    if (add === null) throw new Error('no advanced filter add button');
    add.click();
    click('database-pick-property-due');

    expect(h.state.view.filters).toEqual([]);
    expect(h.state.view.filterTree?.filterRules).toHaveLength(3);
    expect(h.state.view.filterTree?.filterRules.slice(0, 2)).toEqual([
      { id: 'legacy-title', propertyId: 'title', operator: 'equals', value: 'Alpha' },
      { id: 'legacy-num', propertyId: 'num', operator: 'greater_than', value: 10 },
    ]);
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

  it('shows no group sort for a person grouping', () => {
    harness({ groupBy: 'owner' }).open('group');

    expect(exists('database-group-sort')).toBe(false);
    expect(exists('database-group-text-by')).toBe(false);
    expect(exists('database-group-date-by')).toBe(false);
    expect(exists('database-group-hide-empty')).toBe(true);
  });

  it.each(['option', 'group'] as const)('offers and saves every status %s group sort choice', (groupByStatus) => {
    const h = harness({ groupBy: 'prog', groupByStatus, groupSettings: { sort: 'ascending', hideEmptyGroups: true } });
    const panel = h.open('group');
    const choices = [
      ['manual', 'tools.database.groupSortManual'],
      ['ascending', 'tools.database.groupSortAscending'],
      ['descending', 'tools.database.groupSortDescending'],
    ] as const;

    try {
      expect(exists('database-group-sort')).toBe(true);

      for (const [sort, label] of choices) {
        click('database-group-sort');
        expect([...panel.root.querySelectorAll('[data-blok-testid^="database-group-sort-"]')].map((row) => row.textContent?.trim()))
          .toEqual(choices.map(([, choiceLabel]) => choiceLabel));
        click(`database-group-sort-${sort}`);

        expect(h.ctx.updateView).toHaveBeenLastCalledWith({ groupSettings: { sort, hideEmptyGroups: true } });
        expect(h.state.view.groupSettings).toEqual({ sort, hideEmptyGroups: true });
        expect(h.state.view.groupByStatus).toBe(groupByStatus);
        expect(panel.root.querySelector('[data-blok-testid="database-group-sort"] [data-blok-database-panel-value]')?.textContent).toBe(label);
      }
    } finally {
      panel.close();
    }
  });

  it.each([
    ['ascending', ['To-do (1)', 'In progress (1)', 'Complete (1)']],
    ['descending', ['Complete (1)', 'In progress (1)', 'To-do (1)']],
  ] as const)('renders status Group %s in the configured progress order', (sort, labels) => {
    const status: PropertyDefinition = {
      id: 'prog', name: 'Progress', type: 'status', position: 'a0',
      status: { groups: [
        { id: 'todo', kind: 'todo', name: 'To-do', position: 'a0' },
        { id: 'inProgress', kind: 'inProgress', name: 'In progress', position: 'a1' },
        { id: 'complete', kind: 'complete', name: 'Complete', position: 'a2' },
      ] },
      config: { options: [
        { id: 's1', label: 'Not started', position: 'a0', groupId: 'todo' },
        { id: 's2', label: 'In progress', position: 'a0', groupId: 'inProgress' },
        { id: 's3', label: 'Done', position: 'a0', groupId: 'complete' },
      ] },
    };
    const h = harness({ groupBy: 'prog', groupByStatus: 'group', groupSettings: { sort, hideEmptyGroups: true } });
    const model = new DatabaseModel({ schema: [status], views: [h.state.view], activeViewId: 'v' });

    model.setRows([
      { id: 'r1', position: 'a0', properties: { prog: 's1' } },
      { id: 'r2', position: 'a1', properties: { prog: 's2' } },
      { id: 'r3', position: 'a2', properties: { prog: 's3' } },
    ]);
    h.ctx.schema = () => model.getSchema();
    h.ctx.groups = () => {
      const options = model.getSelectOptions('prog', { statusBy: 'group' });

      return model.listGroups(h.state.view).map(({ key, count }) => ({
        key,
        label: options.find((option) => option.id === key)?.label ?? key,
        count,
      }));
    };
    const panel = h.open('group');

    try {
      expect([...panel.root.querySelectorAll('[data-blok-testid^="database-group-visible-"]')].map((row) => row.textContent?.trim()))
        .toEqual(labels);
    } finally {
      panel.close();
    }
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

describe('view settings panel — sub-items and dependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const structure = (on: { subItems: boolean; dependencies: boolean }): {
    settings: NonNullable<ViewSettingsContext['structure']>;
    setSubItems: ReturnType<typeof vi.fn>;
    updateDependency: ReturnType<typeof vi.fn>;
  } => {
    const setSubItems = vi.fn();
    const updateDependency = vi.fn();

    return {
      setSubItems,
      updateDependency,
      settings: {
        subItems: () => on.subItems,
        setSubItems,
        dependencies: () => (on.dependencies ? { shift: 'none' } : undefined),
        setDependencies: vi.fn(),
        updateDependency,
      },
    };
  };

  it('turns sub-items on from Database settings', () => {
    const h = harness();
    const calls = structure({ subItems: false, dependencies: false });

    h.ctx.structure = calls.settings;
    h.open();
    click('database-settings-more');
    click('database-settings-subitems');
    click('database-settings-subitems-switch');

    expect(calls.setSubItems).toHaveBeenCalledWith(true);
    expect(exists('database-settings-subitems-display-nested')).toBe(false);
  });

  it('sets a table\'s sub-item display and filter on the view', () => {
    const h = harness();

    h.ctx.structure = structure({ subItems: true, dependencies: false }).settings;
    h.open();
    click('database-settings-more');
    click('database-settings-subitems');
    click('database-settings-subitems-display-flattened');
    click('database-settings-subitems-filter-parentsAndSubItems');

    expect(h.ctx.updateView).toHaveBeenCalledWith({ subItemsDisplay: 'flattened' });
    expect(h.ctx.updateView).toHaveBeenCalledWith({ subItemsFilter: 'parentsAndSubItems' });
  });

  it('offers a board "Card property" or "Flattened list", and parents only as a card property', () => {
    const h = harness({ type: 'board', groupBy: 'stage' });

    h.ctx.structure = structure({ subItems: true, dependencies: false }).settings;
    h.open();
    click('database-settings-more');
    click('database-settings-subitems');

    expect(exists('database-settings-subitems-display-card')).toBe(true);
    expect(exists('database-settings-subitems-display-nested')).toBe(false);
    expect(exists('database-settings-subitems-filter-subItems')).toBe(false);
  });

  const rowIds = (): string[] => [...document.querySelectorAll<HTMLElement>('[data-blok-testid^="database-settings-"]')]
    .map((el) => el.getAttribute('data-blok-testid') ?? '');

  // research/09 §1: More settings holds Sub-items, Dependencies, Connections, Customize page layout (last).
  it('puts Sub-items, Dependencies and Customize page layout in More settings, after Automations', () => {
    const h = harness();
    const customize = vi.fn();

    h.ctx.structure = structure({ subItems: false, dependencies: false }).settings;
    h.ctx.customizeLayout = () => ({ testId: 'database-settings-customize-layout', label: 'Customize page layout', icon: '', onClick: customize });
    h.ctx.automations = {
      read: () => undefined,
      schema: () => [],
      views: () => [],
      writable: () => true,
      write: () => true,
    };
    const panel = h.open();
    const close = vi.spyOn(panel, 'close');
    const root = rowIds();

    expect(root).not.toContain('database-settings-subitems');
    expect(root).not.toContain('database-settings-dependencies');
    expect(root).not.toContain('database-settings-customize-layout');
    expect(root[root.indexOf('database-settings-more') - 1]).toBe('database-settings-automations');
    expect(document.querySelector('[data-blok-testid="database-settings-more"]')?.textContent).toContain('tools.database.settingsMoreSettings');
    click('database-settings-more');

    expect(rowIds().filter((id) => /^database-settings-(?:subitems|dependencies|customize-layout)$/.test(id)))
      .toEqual(['database-settings-subitems', 'database-settings-dependencies', 'database-settings-customize-layout']);
    expect(rowIds().at(-1)).toBe('database-settings-customize-layout');
    click('database-settings-customize-layout');

    expect(close).toHaveBeenCalled();
    expect(customize).toHaveBeenCalledTimes(1);
  });

  it('shows More settings for Customize page layout alone, and hides it when nothing goes in it', () => {
    const h = harness();

    h.ctx.customizeLayout = () => ({ testId: 'database-settings-customize-layout', label: 'Customize page layout', icon: '', disabled: true, onClick: vi.fn() });
    h.open();
    click('database-settings-more');

    expect(document.querySelector<HTMLButtonElement>('[data-blok-testid="database-settings-customize-layout"]')?.disabled).toBe(true);
    expect(exists('database-settings-subitems')).toBe(false);
    document.body.innerHTML = '';
    harness().open();

    expect(exists('database-settings-more')).toBe(false);
  });

  it('turns dependencies on and picks a date shifting rule', () => {
    const h = harness();
    const calls = structure({ subItems: false, dependencies: true });

    h.ctx.structure = calls.settings;
    h.open();
    click('database-settings-more');
    click('database-settings-dependencies');
    click('database-settings-dependencies-shift-maintain');
    click('database-settings-dependencies-weekends');

    expect(calls.updateDependency).toHaveBeenCalledWith({ shift: 'maintain' });
    expect(calls.updateDependency).toHaveBeenCalledWith({ avoidWeekends: true });
  });
});
