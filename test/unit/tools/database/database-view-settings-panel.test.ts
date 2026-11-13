import { describe, it, expect, beforeEach, afterEach, onTestFinished, vi } from 'vitest';
import { DatabaseModel } from '../../../../src/tools/database/database-model';
import { openFilterPill, openViewSettings } from '../../../../src/tools/database/database-view-settings-panel';
import type { ViewSettingsContext, ViewSettingsStart } from '../../../../src/tools/database/database-view-settings-panel';
import type { DatabasePanel } from '../../../../src/tools/database/database-panel';
import type { ColorRule, DatabaseViewConfig, FilterGroup, FilterRule, PropertyDefinition } from '../../../../src/tools/database/types';
import { COLOR_RULE_TYPES } from '../../../../src/tools/database/view-data';
import { IconPin, IconPinFilled, IconTable, IconViewBoard } from '../../../../src/components/icons';
import { PopoverItemType } from '../../../../src/components/utils/popover/components/popover-item';
import type { PopoverItemParams } from '../../../../types/utils/popover/popover-item';
import { PAGE_LIST_ROLLUP } from '../../../../src/shared/database/value-helpers';

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
const q = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`);

interface Harness {
  ctx: ViewSettingsContext;
  state: { view: DatabaseViewConfig; locked: boolean };
  open: (start?: ViewSettingsStart) => DatabasePanel;
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

  // research/26 §1a: 290 wide at the window's end edge, radius 10, whatever opened it.
  it('docks at the window\'s end edge from every start page', () => {
    const docked = (): boolean => document.querySelector('[data-blok-testid="database-view-settings"]')
      ?.closest('[data-blok-popover-custom-class]')
      ?.getAttribute('data-blok-popover-custom-class')
      ?.split(' ')
      .includes('blok-database-docked-panel') === true;
    const h = harness();

    for (const start of ['root', 'filter', 'sort'] as const) {
      const panel = h.open(start);

      expect(docked()).toBe(true);
      panel.close();
    }
  });

  // findings V11: every root row carries a glyph; Layout's follows the view's layout.
  it('gives every root row a glyph, and Layout the current layout\'s', () => {
    const h = harness({ type: 'board' });

    h.ctx.manageInCalendar = { label: 'Manage in Calendar', onClick: vi.fn() };
    h.open();
    const rows = [...document.querySelectorAll<HTMLElement>('[data-blok-testid="database-view-settings"] [data-blok-database-panel-row]')];

    expect(rows.length).toBeGreaterThan(8);
    for (const row of rows) {
      expect(row.querySelector('[data-blok-database-panel-icon] svg'), row.getAttribute('data-blok-testid') ?? '').not.toBeNull();
    }
    const layoutIcon = (): string | undefined => document.querySelector('[data-blok-testid="database-settings-layout"] [data-blok-database-panel-icon]')?.innerHTML;
    const html = (svg: string): string => Object.assign(document.createElement('span'), { innerHTML: svg }).innerHTML;

    expect(layoutIcon()).toBe(html(IconViewBoard));
    click('database-settings-layout');
    click('database-layout-table');
    click('database-panel-back');
    expect(layoutIcon()).toBe(html(IconTable));
  });

  // findings V12, research/26 §1a: Notion's order; Duplicate and Delete live in the tab menu only.
  it('orders the root rows as Notion does, with dividers around the data source settings', () => {
    const h = harness();

    h.ctx.automations = { writable: () => true } as unknown as NonNullable<ViewSettingsContext['automations']>;
    h.ctx.structure = { subItems: () => false, setSubItems: vi.fn(), dependencies: () => undefined, setDependencies: vi.fn(), updateDependency: vi.fn() };
    h.open();
    const parts = [...document.querySelectorAll<HTMLElement>('[data-blok-testid="database-view-settings"] > :not([data-blok-database-panel-header], [data-blok-database-view-name-row])')].map((el) =>
      el.getAttribute('data-blok-testid')?.replace('database-settings-', '')
        ?? (el.hasAttribute('data-blok-database-panel-separator') ? '—' : `[${el.textContent ?? ''}]`));

    expect(parts).toEqual([
      'layout', 'properties', 'filter', 'sort', 'group', 'color', 'copy-link',
      '—', '[tools.database.settingsDataSourceSettings]', 'automations', 'more',
      '—', 'lock',
    ]);
  });

  it('shows no value on an empty Filter, Sort, Group or Conditional color, and a value once set', () => {
    const value = (id: string): string | null => document.querySelector(`[data-blok-testid="database-settings-${id}"] [data-blok-database-panel-value]`)?.textContent ?? null;
    const first = harness({ type: 'board' }).open();

    for (const id of ['filter', 'sort', 'group', 'subgroup', 'color']) expect(value(id), id).toBeNull();
    first.close();
    harness({ type: 'board', sorts: [{ id: 's', propertyId: 'num', direction: 'asc' }], groupBy: 'stage' }).open();
    expect(value('sort')).toBe('Amount');
    expect(value('group')).toBe('Stage');
  });

  it('puts the CSV actions under More settings; other actions stay on the root', () => {
    const h = harness();
    const exportCsv = vi.fn();

    h.ctx.actions = () => [
      { testId: 'database-settings-chart-save', label: 'Save chart as…', icon: '', page: () => ({ build: () => [] }) },
      { testId: 'database-settings-csv-export', label: 'Export as CSV', icon: '', moreSettings: true, onClick: exportCsv },
    ];
    const panel = h.open();
    const close = vi.spyOn(panel, 'close');

    expect(exists('database-settings-chart-save')).toBe(true);
    expect(exists('database-settings-csv-export')).toBe(false);
    click('database-settings-more');
    click('database-settings-csv-export');
    expect(exportCsv).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalled();
  });

  // findings V10: under the title, the layout glyph and a "View name" field (09-notion-rename-full.png).
  describe('view name field', () => {
    const field = (): HTMLInputElement => {
      const input = document.querySelector<HTMLInputElement>('[data-blok-testid="database-settings-view-name"]');

      if (input === null) throw new Error('no view name field');

      return input;
    };
    const type = (value: string, key: 'Enter' | 'blur'): void => {
      field().value = value;
      field().dispatchEvent(new Event('input', { bubbles: true }));
      if (key === 'Enter') field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      else field().dispatchEvent(new FocusEvent('blur'));
    };

    it('sits first, after the layout glyph, holding the view\'s name', () => {
      harness({ name: 'Roadmap', type: 'board' }).open();
      const row = field().closest('[data-blok-database-view-name-row]');

      expect(row).toBe(document.querySelector('[data-blok-testid="database-view-settings"] > :nth-child(2)'));
      expect(row?.querySelector('[data-blok-database-view-name-icon] svg')).not.toBeNull();
      expect(field().value).toBe('Roadmap');
      expect(field().placeholder).toBe('tools.database.layoutViewName');
    });

    it('renames the view on Enter or blur, trimmed', () => {
      const h = harness();

      h.open();
      type('  Plan  ', 'Enter');
      expect(h.ctx.updateView).toHaveBeenLastCalledWith({ name: 'Plan' });
      type('Later', 'blur');
      expect(h.ctx.updateView).toHaveBeenLastCalledWith({ name: 'Later' });
    });

    it('writes nothing for an unchanged or blank name', () => {
      const h = harness({ name: 'Table' });

      h.open();
      type('Table', 'Enter');
      type('   ', 'blur');
      expect(h.ctx.updateView).not.toHaveBeenCalled();
      expect(field().value).toBe('Table');
    });

    // findings V08: Rename opens View settings with the name field focused.
    it('a "rename" start opens the root with the name selected in the focused field', () => {
      harness({ name: 'Roadmap' }).open('rename');

      expect(field()).toHaveFocus();
      expect([field().selectionStart, field().selectionEnd]).toEqual([0, 'Roadmap'.length]);
      expect(document.querySelector('[data-blok-database-panel-header]')?.getAttribute('data-blok-database-panel-header')).toBe('label');
    });

    // A rename on blur redraws the panel; mid-press, that would swallow the click on the row pressed.
    it('a name left by pressing a row is written once the press ends, so the row still gets its click', () => {
      vi.useFakeTimers();
      onTestFinished(() => {
        vi.useRealTimers();
      });
      const h = harness();

      h.open();
      field().focus();
      field().value = 'Plan';
      const layout = document.querySelector('[data-blok-testid="database-settings-layout"]');

      layout?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      field().blur();
      expect(h.ctx.updateView).not.toHaveBeenCalled();
      layout?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      vi.runAllTimers();
      expect(h.ctx.updateView).toHaveBeenLastCalledWith({ name: 'Plan' });
    });

    it('is read-only while the database is locked', () => {
      const h = harness();

      h.state.locked = true;
      h.open();
      expect(field().disabled).toBe(true);
    });
  });

  // With one view the tab is hidden, so its menu cannot be reached: Duplicate stays here.
  it('offers Duplicate view only while the database has one view', () => {
    const h = harness();

    h.ctx.canDeleteView = () => false;
    h.open();
    click('database-settings-duplicate');
    expect(h.ctx.duplicateView).toHaveBeenCalledTimes(1);
    h.ctx.canDeleteView = () => true;
    h.open();
    expect(exists('database-settings-duplicate')).toBe(false);
  });

  // findings V15 (13-notion-filterpage.png, 26-notion-group.png): an empty Filter, Sort or Group is the property picker.
  describe('empty Filter, Sort and Group pages', () => {
    const picks = (): string[] => [...document.querySelectorAll<HTMLElement>('[data-blok-testid^="database-pick-property-"]')]
      .map((row) => row.getAttribute('data-blok-testid')?.replace('database-pick-property-', '') ?? '');

    it('Filter lists the properties, Name first then A→Z, with the advanced filter at the foot', () => {
      harness().open();
      click('database-settings-filter');

      expect(picks()).toEqual(['title', 'num', 'due', 'owner', 'prog', 'stage']);
      expect(exists('database-filter-add')).toBe(false);
      expect(exists('database-filter-advanced')).toBe(true);
    });

    it('a Filter pick makes the filter and opens its editor; Back shows the filter list', () => {
      const h = harness();

      h.open();
      click('database-settings-filter');
      click('database-pick-property-num');

      expect(h.state.view.filters).toHaveLength(1);
      expect(document.querySelector('[data-blok-database-panel-header]')?.textContent).not.toContain('tools.database.settingsFilter');
      click('database-panel-back');
      expect(exists('database-filter-add')).toBe(true);
    });

    it('a Filter page opened straight from the toolbar keeps the panel open after a pick', () => {
      const h = harness();
      const panel = h.open('filter');

      click('database-pick-property-num');
      expect(h.state.view.filters).toHaveLength(1);
      expect(panel.depth).toBe(2);
    });

    it('Sort lists the properties in the same order, and a pick makes the sort', () => {
      const h = harness();

      h.open();
      click('database-settings-sort');
      expect(picks()).toEqual(['title', 'num', 'due', 'owner', 'prog', 'stage']);
      click('database-pick-property-due');

      expect(h.state.view.sorts.map((sort) => sort.propertyId)).toEqual(['due']);
      expect(exists('database-sort-add')).toBe(true);
    });

    // notion-motion.md Round 9 (r9-vs-filter.raw, r9-vs-sort.raw): "Add filter" over "Filter by…", "New sort" over "Sort by…".
    const title = (): string => document.querySelector('[data-blok-database-panel-header]')?.textContent ?? '';
    const search = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>('[data-blok-testid="database-property-picker-search"]');
    const page = (): string | null | undefined => document.querySelector('[data-blok-testid="database-view-settings"]')?.getAttribute('data-blok-database-panel-page');

    it('an empty Filter page reads "Add filter" over a "Filter by…" search, and reads "Filter" once a filter exists', () => {
      harness().open();
      click('database-settings-filter');

      expect(title()).toContain('tools.database.filterAdd');
      expect(search()?.placeholder).toBe('tools.database.filterByPlaceholder');
      expect(search()?.getAttribute('aria-label')).toBe('tools.database.filterByPlaceholder');
      expect(page()).toBe('pick');
      click('database-pick-property-num');
      click('database-panel-back');
      expect(title()).toContain('tools.database.settingsFilter');
      expect(title()).not.toContain('tools.database.filterAdd');
      expect(page()).not.toBe('pick');
    });

    it('an empty Sort page reads "New sort" over a "Sort by…" search, and reads "Sort" once a sort exists', () => {
      harness().open();
      click('database-settings-sort');

      expect(title()).toContain('tools.database.sortNew');
      expect(search()?.placeholder).toBe('tools.database.sortByPlaceholder');
      expect(search()?.getAttribute('aria-label')).toBe('tools.database.sortByPlaceholder');
      expect(page()).toBe('pick');
      click('database-pick-property-due');
      expect(title()).toContain('tools.database.settingsSort');
      expect(title()).not.toContain('tools.database.sortNew');
      expect(page()).not.toBe('pick');
    });

    // notion-motion.md Round 10 "Group by list": ungrouped, the Group page is the property list titled "Group by".
    it('the ungrouped Group page is the "Group by" picker; grouped, it carries the Group page name', () => {
      harness().open();
      click('database-settings-group');
      expect(page()).toBe('pick');
      expect(title()).toContain('tools.database.groupBy');
      click('database-pick-property-stage');
      expect(page()).toBe('group');
    });

    // Round 10 '"Group by ›" list with a grouping set': the same picker layout, and no "None" row.
    it('opens "Group by ›" as the picker page, with no None row', () => {
      harness().open();
      click('database-settings-group');
      click('database-pick-property-stage');
      click('database-group-by');
      expect(page()).toBe('pick');
      expect(exists('database-group-none')).toBe(false);
      expect(exists('database-pick-property-num')).toBe(true);
    });

    // Round 10 "Add sort picker": the already-sorted property is left out, in the picker layout.
    it('"Add sort" leaves out the sorted property', () => {
      harness().open();
      click('database-settings-sort');
      click('database-pick-property-due');
      click('database-sort-add');
      expect(page()).toBe('pick');
      expect(exists('database-pick-property-due')).toBe(false);
      expect(exists('database-pick-property-num')).toBe(true);
    });

    it('Group lists None (checked), then Name, then A→Z; a pick groups', () => {
      const h = harness();

      h.open();
      click('database-settings-group');
      expect(document.querySelector('[data-blok-testid="database-group-none"]')?.getAttribute('aria-checked')).toBe('true');
      expect(picks()).toEqual(['title', 'num', 'due', 'owner', 'prog', 'stage']);
      click('database-pick-property-stage');

      expect(h.state.view.groupBy).toBe('stage');
      expect(exists('database-group-by')).toBe(true);
    });
  });

  // notion-motion.md Round 13: the rule editor picks a date's Start date / End date and a Name rollup's Any / None / Every too.
  describe('rule editor lead parts', () => {
    const ops = (): Array<string | undefined> => [...document.querySelectorAll('[data-blok-testid^="database-filter-op-"]')]
      .map((el) => el.getAttribute('data-blok-testid')?.replace('database-filter-op-', ''));

    it('keeps End date through the date editor and an operator pick, and goes back to Start date', () => {
      const h = harness({ filters: [{ id: 'f1', propertyId: 'due', operator: 'end:this_week', value: null }] });

      h.openPill('f1');
      expect(document.querySelector('[data-blok-testid="database-filter-side"]')?.textContent).toContain('tools.database.dateEnd');

      const unit = document.querySelector<HTMLSelectElement>('[data-blok-testid="database-filter-unit"]');

      if (unit === null) throw new Error('no unit');
      unit.value = 'month';
      unit.dispatchEvent(new Event('change'));
      expect(h.state.view.filters[0]).toMatchObject({ operator: 'end:relative_to_today', value: 'this:1:month' });

      click('database-filter-operator');
      click('database-filter-op-before');
      expect(h.state.view.filters[0]).toMatchObject({ operator: 'end:before' });

      click('database-filter-side');
      expect(document.querySelector('[data-blok-testid="database-filter-side-end"]')?.getAttribute('aria-checked')).toBe('true');
      click('database-filter-side-start');
      expect(h.state.view.filters[0]).toMatchObject({ operator: 'before' });
    });

    it('edits a Name rollup rule with Any / None / Every, the text operators and a text field', () => {
      const names = Object.assign(
        { id: 'names', name: 'Names', type: 'relation', position: 'a6', rollup: { relationPropertyId: 'rel', targetPropertyId: 'title', function: 'show_original' } } as PropertyDefinition,
        { [PAGE_LIST_ROLLUP]: true }
      );
      const h = harness({ filters: [{ id: 'f1', propertyId: 'names', operator: 'any:contains', value: '' }] });

      h.ctx.schema = () => [...schema, names];
      h.openPill('f1');

      click('database-filter-quantifier');
      expect([...document.querySelectorAll('[data-blok-testid^="database-filter-quantifier-"]')].map((el) => el.getAttribute('data-blok-testid')))
        .toEqual(['database-filter-quantifier-any', 'database-filter-quantifier-none', 'database-filter-quantifier-every']);
      click('database-filter-quantifier-none');
      expect(h.state.view.filters[0]).toMatchObject({ operator: 'none:contains' });

      click('database-filter-operator');
      expect(ops()).toEqual(['equals', 'does_not_equal', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty']);
      click('database-filter-op-starts_with');
      expect(h.state.view.filters[0]).toMatchObject({ operator: 'none:starts_with' });

      const input = document.querySelector<HTMLInputElement>('[data-blok-testid="database-filter-value"]');

      if (input === null) throw new Error('no value field');
      input.value = 'x';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(h.state.view.filters[0]).toMatchObject({ operator: 'none:starts_with', value: 'x' });
    });
  });

  // filter-sort's date filter (findings V18): the settings rule editor reuses the chip's date editor.
  describe('date rule editor', () => {
    const openRule = (filter: { operator: string; value: unknown }): ReturnType<typeof harness> => {
      const h = harness({ filters: [{ id: 'f1', propertyId: 'due', operator: filter.operator, value: filter.value as never }] });

      h.openPill('f1');

      return h;
    };
    const saved = (h: ReturnType<typeof harness>): unknown => h.state.view.filters[0];

    it('edits a saved window filter with the This/Past/Next editor, not the old preset list', () => {
      const h = openRule({ operator: 'this_week', value: null });

      expect(exists('database-filter-within-this_week')).toBe(false);
      expect(exists('database-filter-direction')).toBe(true);
      const unit = document.querySelector<HTMLSelectElement>('[data-blok-testid="database-filter-unit"]');

      if (unit === null) throw new Error('no unit');
      unit.value = 'month';
      unit.dispatchEvent(new Event('change'));
      expect(saved(h)).toMatchObject({ operator: 'relative_to_today', value: 'this:1:month' });
    });

    it('picking "Is relative to today" starts a span, not a day', () => {
      const h = openRule({ operator: 'equals', value: 'today' });

      click('database-filter-operator');
      click('database-filter-op-relative_to_today');
      expect(saved(h)).toMatchObject({ operator: 'this_week', value: null });
      expect(exists('database-filter-direction')).toBe(true);
    });

    it('"Is between" starts empty and saves a start/end range once both days are whole', () => {
      const h = openRule({ operator: 'equals', value: 'today' });

      click('database-filter-operator');
      click('database-filter-op-is_between');
      expect(saved(h)).toMatchObject({ operator: 'is_between', value: null });
      const type = (which: string, text: string): void => {
        const input = document.querySelector<HTMLInputElement>(`[data-blok-testid="database-filter-between-${which}"]`);

        if (input === null) throw new Error(`no ${which}`);
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };

      type('start', '2026-10-01');
      expect(saved(h)).toMatchObject({ value: null });
      type('end', '2026-10-09');
      expect(saved(h)).toMatchObject({ operator: 'is_between', value: '2026-10-01/2026-10-09' });
    });
  });

  it('lists Notion\'s settings rows (research/08)', () => {
    harness().open();

    for (const id of ['layout', 'properties', 'filter', 'sort', 'group', 'color', 'copy-link', 'lock']) {
      expect(exists(`database-settings-${id}`)).toBe(true);
    }
    expect(exists('database-settings-subgroup')).toBe(false);
  });

  // research/26 §1a: the root title is a small label; a sub-page title keeps the 14/600 header.
  it('marks only the root page title as a label', () => {
    const header = (): Element | null => document.querySelector('[data-blok-database-panel-header]');
    const h = harness();

    h.open();
    expect(header()?.getAttribute('data-blok-database-panel-header')).toBe('label');

    click('database-settings-layout');
    expect(header()?.getAttribute('data-blok-database-panel-header')).toBe('');
  });

  it('a panel opened straight at a sub-page keeps the 14/600 header', () => {
    harness().open('filter');

    expect(document.querySelector('[data-blok-database-panel-header]')?.getAttribute('data-blok-database-panel-header')).toBe('');
  });

  it('offers a sub-group on a board only', () => {
    harness({ type: 'board' }).open();

    expect(exists('database-settings-subgroup')).toBe(true);
  });

  // findings V13 (11-notion-layout.png): a 3-column tile grid in Notion's order, then the switches, then Open pages in and Load limit.
  describe('Layout page tiles', () => {
    const tiles = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-blok-database-layout-tiles] > [data-blok-database-layout-tile]')];

    it('draws a tile per layout, glyph above label, in Notion\'s order', () => {
      const h = harness();

      h.ctx.layouts = ['table', 'board', 'list', 'gallery', 'calendar', 'timeline', 'chart', 'feed', 'map', 'form'];
      h.open('layout');

      // notion-motion.md Round 23 §6: a Table view's Layout list has no Form; Form stays in Add view.
      expect(tiles().map((tile) => tile.getAttribute('data-blok-database-layout-tile'))).toEqual([
        'table', 'board', 'timeline', 'calendar', 'list', 'gallery', 'chart', 'feed', 'map',
      ]);
      for (const tile of tiles()) expect(tile.querySelector('svg')).not.toBeNull();
      expect(tiles()[1].textContent?.trim()).toBe('tools.database.viewTypeBoard');
    });

    // A Form view's own Layout list is unread in Notion (Round 23 §6), so it keeps its own tile.
    it('keeps the Form tile in a Form view\'s own list', () => {
      const h = harness({ type: 'form' });

      h.ctx.layouts = ['table', 'board', 'form'];
      h.open('layout');

      expect(tiles().map((tile) => tile.getAttribute('data-blok-database-layout-tile'))).toEqual(['table', 'board', 'form']);
    });

    // Notion rings the pick blue; Blok marks it gray with a ✓ (no-blue law, findings "Deliberate deviations").
    it('marks only the chosen tile, with aria-checked and a ✓', () => {
      harness({ type: 'board' }).open('layout');
      const chosen = tiles().filter((tile) => tile.getAttribute('aria-checked') === 'true');

      expect(chosen.map((tile) => tile.getAttribute('data-blok-database-layout-tile'))).toEqual(['board']);
      expect(chosen[0].getAttribute('role')).toBe('menuitemradio');
      expect(tiles().filter((tile) => tile.querySelector('[data-blok-database-panel-check] svg') !== null)).toEqual(chosen);
    });

    it('puts the switches before Open pages in and Load limit, in Notion\'s order', () => {
      const h = harness();

      h.ctx.linked = () => true;
      h.open('layout');
      const ids = [...document.querySelectorAll<HTMLElement>('[data-blok-testid="database-view-settings"] [data-blok-testid^="database-settings-"]')]
        .map((el) => el.getAttribute('data-blok-testid'));

      expect(ids).toEqual([
        'database-settings-data-source-title', 'database-settings-vertical-lines', 'database-settings-page-icon', 'database-settings-wrap',
        'database-settings-open-pages', 'database-settings-load-limit',
      ]);
    });
  });

  // notion-motion.md Round 24 §4: each layout lists its own rows; Calendar and Timeline put theirs before Open pages in.
  describe('Layout page rows per view (Round 24)', () => {
    const ids = (): Array<string | null> =>
      [...document.querySelectorAll<HTMLElement>(['settings', 'calendar', 'timeline']
        .map((prefix) => `[data-blok-testid="database-view-settings"] [data-blok-testid^="database-${prefix}-"]`).join(', '))]
        .map((el) => el.getAttribute('data-blok-testid'));
    const own = (name: string): PopoverItemParams => ({ type: PopoverItemType.Default, name, title: name, isActive: false, onActivate: vi.fn() });

    it('gives a List no Wrap row', () => {
      harness({ type: 'list' }).open('layout');

      expect(ids()).toEqual(['database-settings-page-icon', 'database-settings-open-pages', 'database-settings-load-limit']);
    });

    it('gives a Calendar no Wrap and no Load limit, and puts its own rows before Open pages in', () => {
      const h = harness({ type: 'calendar' });

      h.ctx.layoutItems = () => [own('calendar-weekends')];
      h.open('layout');

      expect(ids()).toEqual(['database-settings-page-icon', 'database-calendar-weekends', 'database-settings-open-pages']);
    });

    it('gives a Timeline no Wrap, and puts its own rows before Open pages in and Load limit', () => {
      const h = harness({ type: 'timeline' });

      h.ctx.layoutItems = () => [own('timeline-show-table')];
      h.open('layout');

      expect(ids()).toEqual(['database-settings-page-icon', 'database-timeline-show-table', 'database-settings-open-pages', 'database-settings-load-limit']);
    });
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

  // notion-motion.md Round 9 (r9-vs-layout.raw): database.css holds the Layout page's measured row box by this name.
  it('names the Layout page "layout"', () => {
    harness().open();
    click('database-settings-layout');

    expect(document.querySelector('[data-blok-testid="database-view-settings"]')?.getAttribute('data-blok-database-panel-page')).toBe('layout');
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

  describe('"Show data source title" on a linked view (research/20 §1f, §2b; R-2022-03-15)', () => {
    /** Test ids of the Layout page rows after the layout tiles, top to bottom. */
    const rowsAfterTiles = (): string[] => {
      const ids = [...document.querySelectorAll<HTMLElement>('[data-blok-testid="database-view-settings"] [data-blok-testid^="database-"]')]
        .map((el) => el.getAttribute('data-blok-testid') ?? '')
        .filter((id) => id.startsWith('database-settings-') || id.startsWith('database-layout-'));

      const lastTile = ids.map((id) => id.startsWith('database-layout-')).lastIndexOf(true);

      return ids.slice(lastTile + 1);
    };

    it.each(['table', 'map'] as const)('is the first row after the tiles on a linked %s, on by default, and turns off', (type) => {
      const h = harness({ type });

      h.ctx.linked = () => true;
      h.open();
      click('database-settings-layout');

      expect(rowsAfterTiles()[0]).toBe('database-settings-data-source-title');
      expect(document.querySelector('[data-blok-testid="database-settings-data-source-title"]')?.getAttribute('aria-checked')).toBe('true');
      click('database-settings-data-source-title');
      expect(h.ctx.updateView).toHaveBeenCalledWith({ showDataSourceTitle: false });
    });

    it('is not offered on a database that holds its own rows', () => {
      const h = harness();

      h.open();
      click('database-settings-layout');

      expect(exists('database-settings-data-source-title')).toBe(false);
    });
  });

  describe('a board\'s "Card layout" (research/30 §10d, §10f; shots 22, 24)', () => {
    const tiles = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-blok-database-card-layout-tile]')];

    it('ends the board\'s layout page with a "Card layout" box of two tiles, Compact then List; List is the default', () => {
      harness({ type: 'board', groupBy: 'stage' }).open();
      click('database-settings-layout');
      const box = document.querySelector<HTMLElement>('[data-blok-testid="database-settings-card-layout"]');

      expect(box?.parentElement?.lastElementChild).toBe(box);
      expect(box?.querySelector('[data-blok-database-card-layout-label]')?.textContent).toBe('tools.database.settingsCardLayout');
      expect(tiles().map((tile) => tile.textContent?.trim())).toEqual(['tools.database.settingsCardLayoutCompact', 'tools.database.viewTypeList']);
      expect(tiles().map((tile) => tile.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    });

    it('a tile click saves the layout and moves the pick', () => {
      const h = harness({ type: 'board', groupBy: 'stage' });

      h.open();
      click('database-settings-layout');
      click('database-card-layout-compact');

      expect(h.ctx.updateView).toHaveBeenCalledWith({ cardLayout: 'compact' });
      expect(tiles().map((tile) => tile.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    });

    // findings-listgallery L22: Notion's gallery Layout page has the same Card layout box.
    it('ends a gallery\'s layout page with the same "Card layout" box', () => {
      harness({ type: 'gallery' }).open();
      click('database-settings-layout');
      const box = document.querySelector<HTMLElement>('[data-blok-testid="database-settings-card-layout"]');

      expect(box?.parentElement?.lastElementChild).toBe(box);
      expect(tiles().map((tile) => tile.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    });

    it('is not on a table, and its tiles are disabled while the view is locked', () => {
      harness().open();
      click('database-settings-layout');
      expect(exists('database-settings-card-layout')).toBe(false);
      document.body.innerHTML = '';

      const h = harness({ type: 'board', groupBy: 'stage' });

      h.state.locked = true;
      h.open();
      click('database-settings-layout');
      expect(tiles().every((tile) => (tile as HTMLButtonElement).disabled)).toBe(true);
    });
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

    // A new table does not wrap, so the switch turns it on.
    expect(h.ctx.updateView).toHaveBeenCalledWith({ wrapCells: true });
    expect(h.ctx.updateView).toHaveBeenCalledWith({ showVerticalLines: false });
    expect(h.ctx.updateView).toHaveBeenCalledWith({ showPageIcon: false });
  });

  // findings V14 (12-notion-propvis.png): search, "Shown in <layout>" + Hide all, type glyphs, eye toggles.
  describe('Property visibility page', () => {
    const eye = (id: string): HTMLElement | null => document.querySelector(`[data-blok-testid="database-property-visible-${id}"]`);
    const listed = (): string[] => [...document.querySelectorAll<HTMLElement>('[data-blok-testid="database-properties-list"] [data-item-id]')]
      .map((row) => row.getAttribute('data-item-id') ?? '');

    it('opens with its search focused, and the search narrows the list without losing the field', () => {
      const h = harness();

      h.open();
      click('database-settings-properties');
      const search = document.querySelector<HTMLInputElement>('[data-blok-testid="database-property-search"]');

      expect(search).toHaveFocus();
      expect(search?.placeholder).toBe('tools.database.settingsSearchProperty');
      if (search === null) throw new Error('no search');
      search.value = 'du';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      expect(listed()).toEqual(['due']);
      expect(search.isConnected).toBe(true);
    });

    it('keeps the query when an eye redraws the page', () => {
      const h = harness();

      h.open('properties');
      const search = document.querySelector<HTMLInputElement>('[data-blok-testid="database-property-search"]');

      if (search === null) throw new Error('no search');
      search.value = 'du';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      eye('due')?.click();
      expect(document.querySelector<HTMLInputElement>('[data-blok-testid="database-property-search"]')?.value).toBe('du');
      expect(listed()).toEqual(['due']);
    });

    it('draws each row as a type glyph, the name and an eye switch', () => {
      harness({ properties: [{ id: 'due', visible: false }] }).open('properties');
      const row = document.querySelector('[data-blok-testid="database-properties-list"] [data-item-id="due"]');

      expect(row?.querySelector('[data-blok-database-panel-icon] svg')).not.toBeNull();
      expect(row?.textContent).toContain('Due');
      expect(eye('due')?.getAttribute('role')).toBe('switch');
      expect(eye('due')?.getAttribute('aria-checked')).toBe('false');
      expect(eye('due')?.getAttribute('aria-label')).toBe('Due');
      eye('due')?.click();
      expect(eye('due')?.getAttribute('aria-checked')).toBe('true');
    });

    it.each([['board', 'settingsShownInBoard'], ['gallery', 'settingsShownInGallery'], ['chart', 'propertiesSection']] as const)(
      'heads a %s with %s and Hide all, which leaves the title shown',
      (type, key) => {
        const h = harness({ type, properties: [{ id: 'due', visible: true }] });

        h.open('properties');
        expect(document.querySelector('[data-blok-database-panel-section]')?.textContent).toBe(`tools.database.${key}`);
        expect(document.querySelector('[data-blok-testid="database-property-hide-all"]')?.textContent).toBe('tools.database.groupHideAll');
        click('database-property-hide-all');
        expect(h.state.view.properties?.filter((p) => p.id !== 'title' && p.visible)).toEqual([]);
        expect(h.state.view.properties?.some((p) => p.id === 'title' && !p.visible)).toBe(false);
      }
    );
  });

  it('hides a property and keeps the title always shown', () => {
    const h = harness();

    h.open();
    click('database-settings-properties');

    // Notion grays the title's eye: it cannot be hidden (12-notion-propvis.png).
    expect((document.querySelector('[data-blok-testid="database-property-visible-title"]') as HTMLButtonElement).disabled).toBe(true);

    click('database-property-visible-due');

    expect(h.state.view.properties?.find((p) => p.id === 'due')?.visible).toBe(false);
  });

  // research/35 §2.2: Feed's Property visibility leaves out the title property.
  describe('a feed view', () => {
    const titleOnly: PropertyDefinition[] = [{ id: 'title', name: 'Name', type: 'title', position: 'a0' }];
    const countOf = (): string | null | undefined =>
      document.querySelector('[data-blok-testid="database-settings-properties"] [data-blok-database-panel-value]')?.textContent;

    it('counts and lists no title, and reads "No results" with nothing else', () => {
      const h = harness({ type: 'feed' });

      h.ctx.schema = () => titleOnly;
      h.open();
      expect(countOf()).toBe('0');

      click('database-settings-properties');
      expect(document.querySelector('[data-blok-database-panel-note]')?.textContent).toBe('find.noResults');
      expect(document.body.textContent).not.toContain('Name');
    });

    it('lists the other properties without the title', () => {
      const h = harness({ type: 'feed' });

      h.open();
      // The harness view shows nothing but the title, which Feed does not count.
      expect(countOf()).toBe('0');

      click('database-settings-properties');
      expect(exists('database-property-visible-due')).toBe(true);
      expect(document.querySelector('[data-blok-testid="database-properties-list"]')?.textContent).not.toContain('Name');
    });

    // research/35:197: the page reads "Shown in feed | Hide all | Note".
    it('heads the list with "Shown in feed" and a Hide all that hides every listed property at once', () => {
      const h = harness({ type: 'feed', properties: [{ id: 'due', visible: true }, { id: 'num', visible: true }] });

      h.open();
      click('database-settings-properties');
      expect(document.querySelector('[data-blok-database-panel-section]')?.textContent).toBe('tools.database.settingsShownInFeed');
      expect(document.querySelector('[data-blok-testid="database-property-hide-all"]')?.textContent).toContain('tools.database.groupHideAll');

      vi.mocked(h.ctx.updateView).mockClear();
      click('database-property-hide-all');

      expect(h.ctx.updateView).toHaveBeenCalledTimes(1);
      expect(h.state.view.properties?.filter((p) => p.visible).map((p) => p.id)).toEqual([]);
      expect(h.state.view.properties?.some((p) => p.id === 'title' && !p.visible)).toBe(false);
      expect(document.querySelector('[data-blok-testid="database-property-hide-all"]')?.textContent).toContain('tools.database.groupShowAll');
    });

    it('has no header when only the title exists', () => {
      const h = harness({ type: 'feed' });

      h.ctx.schema = () => titleOnly;
      h.open();
      click('database-settings-properties');
      expect(exists('database-property-hide-all')).toBe(false);
    });

    it('a table reads "Shown in table", not "Shown in feed"', () => {
      const h = harness();

      h.open();
      click('database-settings-properties');
      expect(document.querySelector('[data-blok-database-panel-section]')?.textContent).toBe('tools.database.settingsShownInTable');
      expect(document.body.textContent).not.toContain('tools.database.settingsShownInFeed');
    });

    // research/35 §2.3: a fresh Table reads "Property visibility 1": the title counts there.
    it('a table still counts and lists its title', () => {
      const h = harness();

      h.ctx.schema = () => titleOnly;
      h.open();
      expect(countOf()).toBe('1');

      click('database-settings-properties');
      expect(document.querySelector('[data-blok-testid="database-properties-list"]')?.textContent).toContain('Name');
    });
  });

  it('adds a sort as a personal edit and flips its direction', () => {
    const h = harness();

    h.open('sort');
    click('database-pick-property-num');

    expect(h.ctx.updatePersonal).toHaveBeenCalled();
    expect(h.ctx.updateView).not.toHaveBeenCalled();
    const [sort] = h.state.view.sorts;

    expect(sort).toMatchObject({ propertyId: 'num', direction: 'asc' });
    expect(document.querySelector(`[data-blok-testid="database-sort-direction-${sort.id ?? ''}"]`)?.textContent).toContain('tools.database.sortLowHigh');

    click(`database-sort-direction-${sort.id ?? ''}`);
    click('database-sort-direction-desc');

    expect(h.state.view.sorts[0].direction).toBe('desc');
  });

  // notion-motion.md Round 17 §5: on the Sort page the rule's pickers are flyouts under their button, the page stays.
  describe('sort rule pickers', () => {
    const q = (id: string): HTMLElement | null => document.querySelector(`[data-blok-testid="${id}"]`);

    it('opens the direction list as a 180-wide flyout instead of flipping, the current one checked', () => {
      const h = harness({ sorts: [{ id: 's1', propertyId: 'num', direction: 'asc' }] });
      const panel = h.open('sort');

      click('database-sort-direction-s1');
      const flyout = q('database-sort-direction-picker');

      expect(h.state.view.sorts[0].direction).toBe('asc');
      expect(flyout?.style.width).toBe('180px');
      expect(panel.root.contains(flyout)).toBe(false);
      expect(q('database-sort-direction-asc')?.getAttribute('aria-checked')).toBe('true');

      click('database-sort-direction-desc');

      expect(h.state.view.sorts[0].direction).toBe('desc');
      expect(q('database-sort-direction-picker')).toBeNull();
      expect(panel.root.isConnected).toBe(true);
    });

    it('opens the property list as a 280-wide flyout and keeps the Sort page', () => {
      const h = harness({ sorts: [{ id: 's1', propertyId: 'num', direction: 'asc' }] });
      const panel = h.open('sort');

      click('database-sort-property-s1');
      const flyout = q('database-sort-property-picker');

      expect(flyout?.style.width).toBe('280px');
      expect(panel.root.contains(flyout)).toBe(false);
      expect(panel.depth).toBe(1);

      click('database-pick-property-due');

      expect(h.state.view.sorts[0].propertyId).toBe('due');
      expect(q('database-sort-property-picker')).toBeNull();
    });

    it('puts focus back on the direction button after a pick', () => {
      harness({ sorts: [{ id: 's1', propertyId: 'num', direction: 'asc' }] }).open('sort');
      click('database-sort-direction-s1');
      click('database-sort-direction-desc');

      expect(q('database-sort-direction-s1')).toHaveFocus();
    });

    it('closes a rule flyout when the panel closes', () => {
      const panel = harness({ sorts: [{ id: 's1', propertyId: 'num', direction: 'asc' }] }).open('sort');

      click('database-sort-direction-s1');
      panel.close();

      expect(q('database-sort-direction-picker')).toBeNull();
    });
  });

  // notion-motion.md Round 17 §5: the Sort row shows the sorted property's name.
  describe('Sort row value', () => {
    const valueOf = (): string | null | undefined =>
      document.querySelector('[data-blok-testid="database-settings-sort"] [data-blok-database-panel-value]')?.textContent;

    it('names the sorted property when there is one sort', () => {
      harness({ sorts: [{ id: 's1', propertyId: 'num', direction: 'asc' }] }).open();

      expect(valueOf()).toBe('Amount');
    });

    it('keeps the count with two sorts', () => {
      harness({ sorts: [{ id: 's1', propertyId: 'num', direction: 'asc' }, { id: 's2', propertyId: 'due', direction: 'asc' }] }).open();

      expect(valueOf()).toBe('2');
    });
  });

  // notion-motion.md Round 18 §2 (r18-settings-filterrow-*.raw): one filter reads as its property's name.
  describe('Filter row value', () => {
    const valueOf = (): string | null | undefined =>
      document.querySelector('[data-blok-testid="database-settings-filter"] [data-blok-database-panel-value]')?.textContent;

    it('names the filtered property when there is one filter', () => {
      harness({ filters: [{ id: 'f1', propertyId: 'num', operator: 'equals', value: 5 }] }).open();

      expect(valueOf()).toBe('Amount');
    });

    it('keeps the count with two filters', () => {
      harness({ filters: [{ id: 'f1', propertyId: 'num', operator: 'equals', value: 5 }, { id: 'f2', propertyId: 'due', operator: 'is_empty', value: null }] }).open();

      expect(valueOf()).toBe('2');
    });

    // notion-motion.md Round 19 §1 (r19-settings.raw): an advanced filter of 3 items and 4 rules reads "1".
    it('counts an advanced filter as one filter', () => {
      const rule = (id: string): FilterRule => ({ id, propertyId: 'num', operator: 'is_empty', value: null });
      const filterTree: FilterGroup = { id: 'root', conjunction: 'and', filterRules: [rule('a'), rule('b'), { id: 'g', conjunction: 'or', filterRules: [rule('c'), rule('d')] }] };

      harness({ filterTree }).open();
      expect(valueOf()).toBe('1');

      document.body.innerHTML = '';
      harness({ filterTree, filters: [{ id: 'f1', propertyId: 'num', operator: 'equals', value: 5 }] }).open();
      expect(valueOf()).toBe('2');
    });
  });

  // notion-motion.md Round 18 §2 (r18-settings-addfilter.raw): an empty "Add filter" list says "No results".
  it('says "No results" on the Add filter page once every property is filtered', () => {
    harness({ filters: schema.map((p, i) => ({ id: `f${i}`, propertyId: p.id, operator: 'is_not_empty', value: null })) }).open();
    click('database-settings-filter');
    click('database-filter-add');

    expect(document.querySelector('[data-blok-database-property-picker-list] [data-blok-database-panel-note]')?.textContent).toBe('find.noResults');
  });

  // notion-motion.md Round 18 §2 (r18-settings-filterpage.raw, r18-settings-chipclick.raw): the Filters page lists chips.
  describe('Filters page chips', () => {
    const withFilter = (view: Partial<DatabaseViewConfig> = {}): Harness => {
      const h = harness({ filters: [{ id: 'f1', propertyId: 'title', operator: 'contains', value: 'a' }], ...view });

      h.open('filter');

      return h;
    };
    const settings = (): HTMLElement | null => document.querySelector('[data-blok-testid="database-view-settings"]');

    it('shows each filter as its chip, with a drag handle', () => {
      withFilter();
      const chip = q('database-filter-row-f1');

      expect(chip?.hasAttribute('data-blok-database-filter-pill')).toBe(true);
      expect(chip?.hasAttribute('data-active')).toBe(true);
      expect(chip?.querySelector('[data-blok-database-chip-name]')?.textContent).toBe('Name');
      expect(exists('database-filters-list-handle-f1')).toBe(true);
    });

    it('a chip click opens the rule popover beside the page, which stays', () => {
      withFilter();
      click('database-filter-row-f1');
      const popover = q('database-filter-popover');

      expect(popover).not.toBeNull();
      expect(settings()?.contains(popover)).toBe(false);
      expect(settings()?.querySelector('[data-blok-testid="database-filter-row-f1"]')).not.toBeNull();
    });

    it('Escape in the rule popover closes only it', () => {
      withFilter();
      click('database-filter-row-f1');
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(q('database-filter-popover')).toBeNull();
      expect(settings()).not.toBeNull();
    });

    it('has no Advanced filter row while there is no advanced filter', () => {
      withFilter();

      expect(exists('database-filter-advanced')).toBe(false);
    });

    // notion-motion.md Round 19 §1 (r19-settings-filterpage.raw, r19-settings-advchip.raw): the advanced filter is its chip.
    // notion-motion.md Round 19 §1 (r19-adv-group2-bar.raw): rule, rule, group(rule, rule) reads "3 rules", as on the bar chip.
    it('counts the advanced chip on the Filters page by its top-level items', () => {
      const rule = (id: string): FilterRule => ({ id, propertyId: 'num', operator: 'is_empty', value: null });

      const h = harness({ filterTree: { id: 'root', conjunction: 'and', filterRules: [rule('a'), rule('b'), { id: 'g', conjunction: 'or', filterRules: [rule('c'), rule('d')] }] } });

      h.ctx.i18n = { t: (key: string, params?: Record<string, string | number>) => `${key} ${String(params?.count ?? '')}` };
      h.open('filter');

      expect(q('database-filter-advanced-chip')?.textContent).toContain('tools.database.filterRuleCount 3');
    });

    it('lists the advanced filter as its chip, which opens the advanced popover beside the page', () => {
      withFilter({ filterTree: { id: 'root', conjunction: 'and', filterRules: [{ id: 'a', propertyId: 'num', operator: 'is_empty', value: null }] } });
      const chip = q('database-filter-advanced-chip');

      expect(exists('database-filter-advanced')).toBe(false);
      expect(chip?.hasAttribute('data-blok-database-filter-pill')).toBe(true);
      expect(settings()?.contains(chip)).toBe(true);
      expect(exists('database-filters-advanced-handle-advanced')).toBe(true);

      click('database-filter-advanced-chip');
      const popover = q('database-advanced-filter');

      expect(popover).not.toBeNull();
      expect(settings()?.contains(popover)).toBe(false);
      expect(settings()?.querySelector('[data-blok-testid="database-filter-advanced-chip"]')).not.toBeNull();
    });

    // notion-motion.md Round 19 §1 (r19-adv-sel-red.raw): the operator has its own button, so the value button reads "Red" alone.
    it('names only the value on an advanced rule\'s value button', () => {
      withFilter({ filterTree: { id: 'root', conjunction: 'and', filterRules: [
        { id: 'a', propertyId: 'stage', operator: 'does_not_equal', value: ['o1'] },
        { id: 'b', propertyId: 'owner', operator: 'contains', value: ['me'] },
      ] } });
      click('database-filter-advanced-chip');

      expect(q('database-filter-rule-value-a')?.textContent?.trim()).toBe('Idea');
      expect(q('database-filter-rule-value-b')?.textContent?.trim()).toBe('tools.database.filterMe');
    });
  });

  // notion-motion.md Round 17 §5: "Add sort" goes away once every property is sorted.
  it('hides "Add sort" when every property is sorted', () => {
    const h = harness({ sorts: [{ id: 's1', propertyId: 'title', direction: 'asc' }] });

    h.ctx.schema = () => [{ id: 'title', name: 'Name', type: 'title', position: 'a0' }];
    h.open('sort');

    expect(exists('database-sort-row-s1')).toBe(true);
    expect(exists('database-sort-add')).toBe(false);
  });

  it('draws a sort as Notion\'s property button with its type icon and an icon-only remove × (research/26 §3a)', () => {
    const h = harness({ sorts: [{ id: 's1', propertyId: 'due', direction: 'asc' }] });

    h.open('sort');
    const property = document.querySelector('[data-blok-testid="database-sort-property-s1"]');
    const remove = document.querySelector('[data-blok-testid="database-sort-remove-s1"]');

    expect(property?.querySelector('[data-blok-database-panel-icon] svg')).not.toBeNull();
    expect(remove?.getAttribute('aria-label')).toBe('tools.database.sortRemove');
    expect(remove?.querySelector('[data-blok-database-panel-label]')).toBeNull();
    expect(remove?.textContent?.trim()).toBe('');

    click('database-sort-remove-s1');

    expect(h.state.view.sorts).toEqual([]);
  });

  it('puts a Close × at the end of the root header that closes the panel, and keeps first focus on the rows (research/26 §1b)', () => {
    const h = harness();
    const panel = h.open();
    const close = panel.root.querySelector('[data-blok-database-panel-header] [data-blok-testid="database-panel-close"]');

    expect(close?.getAttribute('aria-label')).toBe('tools.database.close');
    expect(close?.parentElement?.lastElementChild).toBe(close);
    expect(document.activeElement?.getAttribute('data-blok-testid')).not.toBe('database-panel-close');
    expect(panel.root.isConnected).toBe(true);

    click('database-panel-close');

    expect(panel.root.isConnected).toBe(false);
  });

  // findings V25 (11-notion-layout.png): a sub-page has Back, its title and ×.
  it('has Back and a Close × on a sub-page; × closes the panel', () => {
    const panel = harness().open();

    click('database-settings-layout');
    expect(exists('database-panel-back')).toBe(true);
    click('database-panel-close');
    expect(panel.root.isConnected).toBe(false);
  });

  it('marks "Add sort" and "Delete sort" as muted rows, and the sort itself not (research/21 §1c)', () => {
    const h = harness({ sorts: [{ id: 's1', propertyId: 'num', direction: 'asc' }] });

    h.open('sort');
    const muted = (id: string): boolean => document.querySelector(`[data-blok-testid="${id}"]`)?.hasAttribute('data-muted') === true;

    expect(muted('database-sort-add')).toBe(true);
    expect(muted('database-sort-delete-all')).toBe(true);
    expect(muted('database-sort-property-s1')).toBe(false);
    expect(muted('database-sort-direction-s1')).toBe(false);
  });

  it('adds a simple filter and edits its value in its own page', () => {
    const h = harness();

    h.open('filter');
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

  // Ledger D31 (79b5db3a · database-panel.ts:340): a sort row also moves by dragging its ⋮⋮ handle.
  describe('dragging a sort row by its handle', () => {
    const sorts = (): DatabaseViewConfig['sorts'] => [
      { id: 's1', propertyId: 'num', direction: 'asc' },
      { id: 's2', propertyId: 'due', direction: 'desc' },
      { id: 's3', propertyId: 'title', direction: 'asc' },
    ];

    /** jsdom has no layout: rows stack 30px tall from y=100, so the middles are 115, 145, 175. */
    const layOut = (): void => {
      document.querySelectorAll<HTMLElement>('[data-blok-testid="database-sorts-list"] [data-blok-database-panel-list-item]').forEach((row, i) => {
        vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
          left: 0, top: 100 + i * 30, width: 200, height: 30, right: 200, bottom: 130 + i * 30, x: 0, y: 100 + i * 30, toJSON: () => ({}),
        });
      });
    };

    const drag = (id: string, toY: number): void => {
      const handle = document.querySelector(`[data-blok-testid="database-sorts-list-handle-${id}"]`);

      if (handle === null) throw new Error(`no handle ${id}`);
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientY: 115 }));
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: toY }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: toY }));
    };

    it('drops the row past each row whose middle its leading edge crossed', () => {
      const h = harness({ sorts: sorts() });

      h.open('sort');
      layOut();
      drag('s1', 150);

      expect(h.state.view.sorts.map((sort) => sort.id)).toEqual(['s2', 's1', 's3']);
    });

    it('drops the row at the end once it crosses the last middle', () => {
      const h = harness({ sorts: sorts() });

      h.open('sort');
      layOut();
      drag('s1', 180);

      expect(h.state.view.sorts.map((sort) => sort.id)).toEqual(['s2', 's3', 's1']);
    });

    it('ignores a right-button press', () => {
      const h = harness({ sorts: sorts() });

      h.open('sort');
      layOut();
      document.querySelector('[data-blok-testid="database-sorts-list-handle-s1"]')
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 2, clientY: 115 }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: 180 }));

      expect(h.state.view.sorts.map((sort) => sort.id)).toEqual(['s1', 's2', 's3']);
    });
  });

  // Ledger D30 (7f240977 · database-view-settings-panel.ts:1108): a date filter takes Today, One week ago… from its page.
  it('picks a relative date value for a date filter from the filter page, and an exact date replaces it', () => {
    const h = harness();

    h.open('filter');
    click('database-pick-property-due');
    // A new date filter starts as "is within this week"; "Is" brings the value rows.
    click('database-filter-operator');
    click('database-filter-op-equals');
    click('database-filter-date-one_week_ago');

    expect(h.state.view.filters).toEqual([expect.objectContaining({ propertyId: 'due', operator: 'equals', value: 'one_week_ago' })]);
    expect(document.querySelector('[data-blok-testid="database-filter-date-one_week_ago"]')?.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('[data-blok-testid="database-filter-date-today"]')?.getAttribute('aria-checked')).toBe('false');

    click('database-filter-date-today');
    expect(h.state.view.filters[0]?.value).toBe('today');

    const exact = document.querySelector<HTMLInputElement>('[data-blok-testid="database-filter-value"]');

    if (exact === null) throw new Error('no exact date field');
    exact.value = '2026-10-20';
    exact.dispatchEvent(new Event('input', { bubbles: true }));

    expect(h.state.view.filters[0]?.value).toBe('2026-10-20');
    expect(document.querySelector('[data-blok-testid="database-filter-date-today"]')?.getAttribute('aria-checked')).toBe('false');
  });

  it('moves flat filters into the advanced tree on its first edit', () => {
    const h = harness({ filters: [
      { id: 'legacy-title', propertyId: 'title', operator: 'equals', value: 'Alpha' },
      { id: 'legacy-num', propertyId: 'num', operator: 'greater_than', value: 10 },
    ] });

    h.open('filter');
    click('database-filter-add');
    click('database-filter-advanced');
    const add = document.querySelector<HTMLElement>('[data-blok-testid^="database-filter-add-rule-"]');

    if (add === null) throw new Error('no advanced filter add button');
    add.click();
    click('database-filter-add-rule');

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
    click('database-filter-add-rule');
    click(`database-filter-add-rule-${root()}`);
    click('database-filter-add-group');

    const tree = h.state.view.filterTree;
    const layer2 = tree?.filterRules.find((node) => 'filterRules' in node);

    expect(tree?.filterRules).toHaveLength(2);
    expect(exists(`database-filter-conjunction-${root()}`)).toBe(true);
    // notion-motion.md Round 25 §3: And/Or ends where "Where" ends, so it sits in the 60px column's cell.
    expect(document.querySelector(`[data-blok-testid="database-filter-conjunction-${root()}"]`)?.parentElement?.hasAttribute('data-blok-database-filter-conjunction-cell')).toBe(true);
    expect(document.querySelector('[data-blok-database-filter-where]')?.textContent).toBe('tools.database.filterWhere');

    click(`database-filter-add-rule-${layer2?.id ?? ''}`);
    click('database-filter-add-group');
    const layer3 = h.state.view.filterTree?.filterRules
      .flatMap((node) => ('filterRules' in node ? node.filterRules : []))
      .find((node) => 'filterRules' in node);

    expect(layer3).toBeDefined();
    expect(exists(`database-filter-add-rule-${layer3?.id ?? ''}`)).toBe(true);
    click(`database-filter-add-rule-${layer3?.id ?? ''}`);
    expect(exists('database-filter-add-menu')).toBe(false);
    expect(exists('database-filter-add-group')).toBe(false);
    expect(h.ctx.updateView).not.toHaveBeenCalled();
  });

  // notion-motion.md Round 19 §1 (r19-adv-sel*.raw, r19-adv-cb*.raw): a value that is not text is a flyout under its button.
  describe('advanced rule value flyouts', () => {
    const openRule = (rule: Record<string, unknown>): Harness => {
      const h = harness({ filterTree: { id: 'root', conjunction: 'and', filterRules: [{ id: 'r', ...rule } as never] } });

      h.open('filter');
      click('database-filter-advanced-chip');
      click('database-filter-rule-value-r');

      return h;
    };
    const value = (h: Harness): unknown => (h.state.view.filterTree?.filterRules[0] as { value?: unknown } | undefined)?.value;
    const pushed = (): boolean => document.querySelector('[data-blok-testid="database-advanced-filter"] [data-blok-testid="database-panel-back"]') !== null;

    it('picks a Select option in a 260-wide flyout, the rule list staying', () => {
      const h = openRule({ propertyId: 'stage', operator: 'equals', value: null });
      const flyout = q('database-filter-value-picker');

      expect(pushed()).toBe(false);
      expect(flyout?.style.width).toBe('260px');
      expect(q('database-advanced-filter')?.contains(flyout)).toBe(false);
      click('database-filter-option-o1');

      expect(value(h)).toEqual(['o1']);
      expect(q('database-filter-value-picker')).not.toBeNull();
    });

    // r19-adv-date*.raw: Date rows carry "Start date ⌄" after the property; its list is Notion's 190-wide side menu.
    it('gives a Date rule a Start date / End date button with a flyout', () => {
      const h = openRule({ propertyId: 'due', operator: 'this_week', value: null });
      const operator = (): string | undefined => (h.state.view.filterTree?.filterRules[0] as { operator?: string } | undefined)?.operator;

      // Round 23 §2 (r23-adv-btns.raw): 4 after the property button, not 8 (database.css).
      expect(q('database-filter-rule-side-r')?.hasAttribute('data-blok-database-filter-rule-side')).toBe(true);
      click('database-filter-rule-side-r');
      expect(q('database-filter-side-picker')?.style.width).toBe('190px');
      click('database-filter-side-end');

      expect(operator()).toBe('end:this_week');
      expect(q('database-filter-rule-side-r')?.textContent?.trim()).toBe('tools.database.dateEnd');
    });

    // notion-motion.md Round 22 §2 (r22-adv-seldate*.raw, r22-adv-fclick*.raw, r22-adv-t1-tab.raw): the simple popover's
    // field and calendar; no ⌄ or ⊗ while empty; a click on the empty field opens the presets.
    describe('a Date "Is" value', () => {
      const field = (): HTMLInputElement | null => q('database-filter-value-picker')?.querySelector<HTMLInputElement>('[data-blok-database-chip-date-input]') ?? null;

      it('shows the focused field and the month calendar, with no ⌄ or ⊗ while empty', () => {
        openRule({ propertyId: 'due', operator: 'equals', value: null });

        expect(field()).not.toBeNull();
        expect(field()).toHaveFocus();
        expect(q('database-filter-value-picker')?.querySelector('[data-blok-database-chip-month] [data-blok-database-date-day]')).not.toBeNull();
        expect(exists('database-filter-date-presets')).toBe(false);
        expect(exists('database-filter-date-clear')).toBe(false);
        expect(exists('database-filter-date-today')).toBe(false);
      });

      it('opens the presets from a click on the empty field, and a pick closes the flyout', () => {
        const h = openRule({ propertyId: 'due', operator: 'equals', value: null });

        field()?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

        expect(q('database-filter-date-menu')?.style.width).toBe('240px');
        expect(q('database-filter-date-custom')?.getAttribute('aria-checked')).toBe('true');

        click('database-filter-date-one_week_ago');

        expect(value(h)).toBe('one_week_ago');
        expect(exists('database-filter-value-picker')).toBe(false);
        expect(q('database-filter-rule-preset-r')?.textContent?.trim()).toBe('tools.database.filterDateOneWeekAgo');
        expect(exists('database-filter-rule-value-r')).toBe(false);
      });

      // notion-motion.md Round 23 §2 (r23-adv-btns.raw): "Custom date ⌄" then "Select a date ⌄", the second a fixed 165.
      it('shows a Custom date button before the Select a date button', () => {
        openRule({ propertyId: 'due', operator: 'equals', value: null });
        const rule = q('database-filter-rule-r');
        const preset = q('database-filter-rule-preset-r');
        const day = q('database-filter-rule-value-r');

        expect(preset?.textContent?.trim()).toBe('tools.database.filterDateCustom');
        expect(day?.textContent?.trim()).toBe('tools.database.filterSelectDate');
        expect(day?.hasAttribute('data-blok-database-filter-rule-day')).toBe(true);
        expect(preset?.nextElementSibling).toBe(day);
        expect(rule?.contains(preset)).toBe(true);
      });

      // Round 22 §2 / Round 23 §2 (r22-adv-preset-rows.raw, r23-adv-preset.raw): the presets flyout is 180 wide, under the button.
      it('opens the presets in a 180-wide flyout from Custom date, and a preset leaves one button', () => {
        const h = openRule({ propertyId: 'due', operator: 'equals', value: null });

        click('database-filter-rule-preset-r');
        expect(q('database-filter-date-menu')?.style.width).toBe('180px');
        expect(q('database-filter-date-custom')?.getAttribute('aria-checked')).toBe('true');
        click('database-filter-date-tomorrow');

        expect(value(h)).toBe('tomorrow');
        expect(exists('database-filter-date-menu')).toBe(false);
        expect(q('database-filter-rule-preset-r')?.textContent?.trim()).toBe('tools.database.filterDateTomorrow');
        expect(exists('database-filter-rule-value-r')).toBe(false);
      });

      it('clears a preset from Custom date, bringing the Select a date button back', () => {
        const h = harness({ filterTree: { id: 'root', conjunction: 'and', filterRules: [{ id: 'r', propertyId: 'due', operator: 'equals', value: 'tomorrow' }] } });

        h.open('filter');
        click('database-filter-advanced-chip');
        click('database-filter-rule-preset-r');
        click('database-filter-date-custom');

        expect(value(h)).toBeNull();
        expect(exists('database-filter-rule-value-r')).toBe(true);
      });

      // notion-motion.md Round 23 §2 (r23-adv-tab-btns.raw): after Tab the button reads the day at once, the flyout still open.
      it('writes the typed day on the button at once on Tab', async () => {
        openRule({ propertyId: 'due', operator: 'equals', value: null });
        const input = field();

        if (input === null) throw new Error('no field');
        input.value = '3/5/25';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.blur();
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });

        expect(exists('database-filter-value-picker')).toBe(true);
        expect(q('database-filter-rule-value-r')?.textContent?.trim()).toBe('March 5, 2025');
        expect(q('database-filter-rule-value-r')?.hasAttribute('data-blok-database-filter-placeholder')).toBe(false);
      });

      it('commits typed text on Enter, then shows the day and a ⊗', () => {
        const h = openRule({ propertyId: 'due', operator: 'equals', value: null });
        const input = field();

        if (input === null) throw new Error('no field');
        input.value = '3/5/25';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

        expect(value(h)).toBe('2025-03-05');
        expect(field()?.value).toBe('March 5, 2025');
        expect(exists('database-filter-date-clear')).toBe(true);
      });

      it('picks a calendar day', () => {
        const h = openRule({ propertyId: 'due', operator: 'equals', value: '2026-11-13' });

        q('database-filter-value-picker')?.querySelector<HTMLElement>('[data-blok-database-date-day="2026-11-20"]')?.click();

        expect(value(h)).toBe('2026-11-20');
      });
    });

    it('starts an advanced Date "Is" rule on Today', () => {
      const h = openRule({ propertyId: 'due', operator: 'this_week', value: null });

      click('database-filter-rule-operator-r');
      click('database-filter-op-equals');

      expect(h.state.view.filterTree?.filterRules[0]).toEqual(expect.objectContaining({ operator: 'equals', value: 'today' }));
    });

    it('keeps a text value as a field in the row', () => {
      const h = harness({ filterTree: { id: 'root', conjunction: 'and', filterRules: [{ id: 'r', propertyId: 'title', operator: 'contains', value: '' }] } });

      h.open('filter');
      click('database-filter-advanced-chip');

      expect(q('database-filter-rule-value-r')).toBeInstanceOf(HTMLInputElement);
    });
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
    click('database-filter-advanced-chip');
    click('database-filter-conjunction-root');
    click('database-filter-conjunction-or');

    expect(h.state.view.filterTree?.conjunction).toBe('or');
  });

  // notion-motion.md, Round 8c "Hidden groups": a group is its name and an eye; a hidden one is faded.
  it('lists each group with an eye that hides or shows it', () => {
    const h = harness({ type: 'board', groupBy: 'stage', hiddenGroups: [{ id: 'none' }] });

    h.open('group');
    const rows = (): Array<[string | undefined, boolean]> => [...document.querySelectorAll('[data-blok-database-group-visibility-row]')]
      .map((row) => [row.textContent?.trim(), row.hasAttribute('data-hidden')]);
    const eye = (key: string): Element | null => document.querySelector(`[data-blok-testid="database-group-visible-${key}"]`);

    expect(rows()).toEqual([['Idea', false], ['No Stage', true]]);
    // notion-motion.md, Round 8c: the eye is a plain button labelled by what a click does.
    expect([eye('o1')?.getAttribute('role'), eye('o1')?.getAttribute('aria-label'), eye('o1')?.hasAttribute('aria-checked')])
      .toEqual([null, 'tools.database.groupHide', false]);
    expect(eye('none')?.getAttribute('aria-label')).toBe('tools.database.groupShow');

    click('database-group-visible-none');

    expect(h.state.view.hiddenGroups ?? []).toEqual([]);
    expect(rows()).toEqual([['Idea', false], ['No Stage', false]]);
    expect(eye('none')?.getAttribute('aria-label')).toBe('tools.database.groupHide');
  });

  // notion-motion.md Round 24 §1 (r24-grp.raw, r24-pinpz.raw): a board group row has a 24px "Pin group" button before
  // its eye. A click pins it and the button reads "Unpin group".
  it('pins a board group from its row and unpins it again', () => {
    const h = harness({ type: 'board', groupBy: 'stage' });

    h.open('group');
    const pin = (): Element | null => document.querySelector('[data-blok-testid="database-group-pin-o1"]');
    const parsed = (svg: string): string => Object.assign(document.createElement('span'), { innerHTML: svg }).innerHTML;

    expect(pin()?.nextElementSibling?.getAttribute('data-blok-testid')).toBe('database-group-visible-o1');
    expect(pin()?.getAttribute('aria-label')).toBe('tools.database.groupPin');
    // notion-motion.md Round 25 §2 (r25-grp-pinbtn-hover.raw): the outline pin swaps to the filled one on hover.
    expect(pin()?.querySelector('[data-blok-database-group-pin-glyph="rest"]')?.innerHTML).toBe(parsed(IconPin));
    expect(pin()?.querySelector('[data-blok-database-group-pin-glyph="hover"]')?.innerHTML).toBe(parsed(IconPinFilled));

    click('database-group-pin-o1');

    expect(h.state.view.pinnedGroups).toEqual([{ id: 'o1' }]);
    expect(pin()?.getAttribute('aria-label')).toBe('tools.database.groupUnpin');
    // Pinned: the filled pin at rest and on hover.
    expect(pin()?.querySelector('[data-blok-database-group-pin-glyph="rest"]')?.innerHTML).toBe(parsed(IconPinFilled));

    click('database-group-pin-o1');

    expect(h.state.view.pinnedGroups).toEqual([]);
  });

  it('offers no pin on a table\'s groups', () => {
    harness({ type: 'table', groupBy: 'stage' }).open('group');

    expect(document.querySelector('[data-blok-testid="database-group-pin-o1"]')).toBeNull();
  });

  it('puts Hide all on the Groups label row', () => {
    harness({ type: 'board', groupBy: 'stage' }).open('group');

    const hideAll = document.querySelector('[data-blok-testid="database-group-hide-all"]');

    expect(hideAll?.parentElement?.textContent).toBe('tools.database.groupGroupstools.database.groupHideAll');
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

  // research/22 §7: "Number by: Unique" by default; Range shows 0 – 1000, every 100.
  it('groups a number by Unique, and Range starts at 0 to 1000 every 100', () => {
    const h = harness({ groupBy: 'num' });

    h.open('group');

    expect(document.querySelector('[data-blok-testid="database-group-number-by"] [data-blok-database-panel-value]')?.textContent)
      .toBe('tools.database.groupNumberUnique');

    click('database-group-number-by');
    click('database-group-number-by-range');

    const value = (id: string): string | undefined => document.querySelector<HTMLInputElement>(`[data-blok-testid="${id}"]`)?.value;

    expect([value('database-group-rangeStart'), value('database-group-rangeEnd'), value('database-group-rangeSize')]).toEqual(['0', '1000', '100']);
  });

  // research/22 §7, shots 37/38: the Range fields live on the "Number by" sub-page, not the Group page.
  it('keeps the Range fields off the Group page and shows them on the Number by page', () => {
    const h = harness({ groupBy: 'num', groupSettings: { numberBy: 'range' } });
    const title = (): string | null | undefined => document.querySelector('[data-blok-database-panel-header] span')?.textContent;
    const checked = (id: string): string | null | undefined => document.querySelector(`[data-blok-testid="${id}"]`)?.getAttribute('aria-checked');

    h.open('group');

    expect(exists('database-group-rangeStart')).toBe(false);
    expect(exists('database-group-range-example')).toBe(false);
    expect(document.querySelector('[data-blok-testid="database-group-number-by"] [data-blok-database-panel-value]')?.textContent)
      .toBe('tools.database.groupNumberRange');

    click('database-group-number-by');

    expect(title()).toBe('tools.database.groupNumberBy');
    expect(checked('database-group-number-by-range')).toBe('true');
    expect(checked('database-group-number-by-unique')).toBe('false');
    expect(exists('database-group-rangeStart')).toBe(true);
    expect(exists('database-group-rangeEnd')).toBe(true);
    expect(exists('database-group-rangeSize')).toBe(true);
    expect(exists('database-group-range-example')).toBe(true);

    click('database-group-number-by-unique');

    expect(h.state.view.groupSettings?.numberBy).toBe('unique');
    expect(title()).toBe('tools.database.groupNumberBy');
    expect(checked('database-group-number-by-unique')).toBe('true');
    expect(exists('database-group-rangeStart')).toBe(false);

    click('database-group-number-by-range');

    expect(exists('database-group-rangeStart')).toBe(true);

    click('database-panel-back');

    expect(exists('database-group-rangeStart')).toBe(false);
    expect(document.activeElement?.getAttribute('data-blok-testid')).toBe('database-group-number-by');
  });

  it('puts the sub-group Range fields on its own Number by page', () => {
    const h = harness({ type: 'board', groupBy: 'stage', subGroupBy: 'num' });

    h.open('root');
    click('database-settings-subgroup');
    click('database-group-number-by');
    click('database-group-number-by-range');

    expect(h.state.view.subGroupSettings?.numberBy).toBe('range');
    expect(h.state.view.groupSettings?.numberBy).toBeUndefined();
    expect(exists('database-group-rangeSize')).toBe(true);
  });

  // research/22 §7: "Group range" [0] – [1000], "Group every" [100], then "0 to 100, 100 to 200, ...".
  it('labels the number range like Notion, with a helper line built from the values', () => {
    const h = harness({ groupBy: 'num', groupSettings: { numberBy: 'range' } });

    h.ctx.i18n = {
      t: (key: string, params?: Record<string, string | number>) => {
        if (key === 'tools.database.groupRangeExample') return `${String(params?.start)} to ${String(params?.middle)}, ${String(params?.middle)} to ${String(params?.end)}, ...`;

        return key;
      },
    };
    h.open('group');
    click('database-group-number-by');

    const helper = (): string | null | undefined => document.querySelector('[data-blok-testid="database-group-range-example"]')?.textContent;

    expect(helper()).toBe('0 to 100, 100 to 200, ...');

    const sections = [...document.querySelectorAll('[data-blok-database-panel-section]')].map((el) => el.textContent);

    expect(sections).toEqual(expect.arrayContaining(['tools.database.groupRange', 'tools.database.groupRangeEvery']));
    expect(sections).not.toContain('tools.database.groupRangeStart');

    const pair = document.querySelector('[data-blok-database-range-pair]');

    expect([...(pair?.querySelectorAll('input') ?? [])].map((input) => input.getAttribute('data-blok-testid'))).toEqual(['database-group-rangeStart', 'database-group-rangeEnd']);
    expect(pair?.querySelector('[aria-hidden="true"]')?.textContent).toBe('–');
    expect(document.querySelector('[data-blok-testid="database-group-rangeStart"]')?.getAttribute('aria-label')).toBe('tools.database.groupRangeStart');

    const size = document.querySelector<HTMLInputElement>('[data-blok-testid="database-group-rangeSize"]');

    if (size === null) throw new Error('no size input');
    size.value = '50';
    size.dispatchEvent(new Event('input'));

    expect(helper()).toBe('0 to 50, 50 to 100, ...');
  });

  // research/23 §2e: grouping by a number turns Hide empty groups on, sorts ascending, and drops Color columns.
  describe('switching the grouping to a number', () => {
    const hideEmpty = (): string | null | undefined =>
      document.querySelector('[data-blok-testid="database-group-hide-empty"]')?.getAttribute('aria-checked');

    it('leaves Hide empty groups off and Color columns on for a select', () => {
      harness({ type: 'board', groupBy: 'stage' }).open('group');

      expect(hideEmpty()).toBe('false');
      expect(exists('database-group-color-columns')).toBe(true);
    });

    it('turns Hide empty groups on and sorts ascending in the same write', () => {
      const h = harness({ type: 'board', groupBy: 'stage', groupSettings: { sort: 'manual', colorColumns: true } });

      h.open('group');
      click('database-group-by');
      click('database-pick-property-num');

      expect(h.ctx.updateView).toHaveBeenLastCalledWith({ groupBy: 'num', groupSettings: { hideEmptyGroups: true } });
      expect(hideEmpty()).toBe('true');
      expect(document.querySelector('[data-blok-testid="database-group-sort"] [data-blok-database-panel-value]')?.textContent)
        .toBe('tools.database.groupSortAscending');
      expect(document.querySelector('[data-blok-testid="database-group-number-by"] [data-blok-database-panel-value]')?.textContent)
        .toBe('tools.database.groupNumberUnique');
      expect(exists('database-group-color-columns')).toBe(false);
    });

    it('resets the settings when a number grouping switches to a select', () => {
      const h = harness({ type: 'board', groupBy: 'num', groupSettings: { hideEmptyGroups: true } });

      h.open('group');
      click('database-group-by');
      click('database-pick-property-stage');

      expect(h.ctx.updateView).toHaveBeenLastCalledWith({ groupBy: 'stage', groupSettings: {} });
      expect(hideEmpty()).toBe('false');
    });

    it('keeps the settings when the same number property is picked again', () => {
      const h = harness({ type: 'board', groupBy: 'num', groupSettings: { numberBy: 'range' } });

      h.open('group');
      click('database-group-by');
      click('database-pick-property-num');

      expect(h.ctx.updateView).toHaveBeenLastCalledWith({ groupBy: 'num' });
    });

    it('does not touch a view already grouped by a number when it opens', () => {
      const h = harness({ type: 'board', groupBy: 'num' });

      h.open('group');

      expect(hideEmpty()).toBe('false');
      expect(h.ctx.updateView).not.toHaveBeenCalled();
    });

    // research/30 B26: after picking a sub-group, bands with no cards did not show.
    it('turns Hide empty groups on when a sub-group is picked', () => {
      const h = harness({ type: 'board', groupBy: 'stage', subGroupSettings: { sort: 'descending' } });

      h.open('root');
      click('database-settings-subgroup');
      click('database-subgroup-by');
      click('database-pick-property-prog');

      expect(h.ctx.updateView).toHaveBeenLastCalledWith({ subGroupBy: 'prog', subGroupSettings: { hideEmptyGroups: true } });
    });

    it('keeps the sub-group settings when the same sub-group is picked again', () => {
      const h = harness({ type: 'board', groupBy: 'stage', subGroupBy: 'prog', subGroupSettings: { hideEmptyGroups: false } });

      h.open('root');
      click('database-settings-subgroup');
      click('database-subgroup-by');
      click('database-pick-property-prog');

      expect(h.ctx.updateView).toHaveBeenLastCalledWith({ subGroupBy: 'prog' });
    });
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

  it('shows Ascending as the status group sort when the view stores none (research/08)', () => {
    const h = harness({ type: 'board', groupBy: 'prog' });
    const panel = h.open('group');

    try {
      expect(panel.root.querySelector('[data-blok-testid="database-group-sort"] [data-blok-database-panel-value]')?.textContent)
        .toBe('tools.database.groupSortAscending');
    } finally {
      panel.close();
    }
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
    ['ascending', ['To-do', 'In progress', 'Complete']],
    ['descending', ['Complete', 'In progress', 'To-do']],
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
      expect([...panel.root.querySelectorAll('[data-blok-database-group-visibility-row]')].map((row) => row.textContent?.trim()))
        .toEqual(labels);
    } finally {
      panel.close();
    }
  });

  it('offers "Me" first in a person filter', () => {
    const h = harness();

    h.ctx.people = () => [{ id: 'u1', name: 'Ada' }];
    h.open('filter');
    click('database-pick-property-owner');
    click('database-filter-person-me');
    click('database-filter-person-u1');

    expect(h.state.view.filters[0]).toMatchObject({ propertyId: 'owner', operator: 'contains', value: ['me', 'u1'] });
  });

  it('offers "This page" first in a relation filter on a row page (research/13 §1c)', () => {
    const h = harness();
    const related: PropertyDefinition = { id: 'back', name: 'Measure A', type: 'relation', position: 'z0', relation: { targetDatabaseId: 'a' } };

    h.ctx.schema = () => [...schema, related];
    h.ctx.relatedRows = () => [{ id: 'r1', title: 'One' }];
    h.ctx.thisPageDatabase = () => 'a';
    h.open('filter');
    click('database-pick-property-back');
    const rows = [...document.querySelectorAll('[data-blok-testid^="database-filter-related-"]')].map((el) => el.getAttribute('data-blok-testid'));

    expect(rows).toEqual(['database-filter-related-this-page', 'database-filter-related-r1']);
    click('database-filter-related-this-page');

    expect(h.state.view.filters[0]).toMatchObject({ propertyId: 'back', operator: 'contains', value: ['this_page'] });
  });

  it('offers no "This page" on a relation to another database than the row page\'s', () => {
    const h = harness();
    const other: PropertyDefinition = { id: 'toc', name: 'Measure C', type: 'relation', position: 'z0', relation: { targetDatabaseId: 'c' } };

    h.ctx.schema = () => [...schema, other];
    h.ctx.relatedRows = () => [{ id: 'c1', title: 'Uno' }];
    h.ctx.thisPageDatabase = () => 'a';
    h.open('filter');
    click('database-pick-property-toc');

    expect(document.querySelector('[data-blok-testid="database-filter-related-c1"]')).not.toBeNull();
    expect(document.querySelector('[data-blok-testid="database-filter-related-this-page"]')).toBeNull();
  });

  it('offers no "This page" in a conditional color rule, which has no row page to read', () => {
    const h = harness({ colorRules: [{ id: 'c1', propertyId: 'back', operator: 'contains', value: [], color: 'gray' }] });
    const related: PropertyDefinition = { id: 'back', name: 'Measure A', type: 'relation', position: 'z0', relation: { targetDatabaseId: 'a' } };

    h.ctx.schema = () => [...schema, related];
    h.ctx.relatedRows = () => [{ id: 'r1', title: 'One' }];
    h.ctx.thisPageDatabase = () => 'a';
    h.open();
    click('database-settings-color');
    click('database-color-value-c1');

    expect(document.querySelector('[data-blok-testid="database-filter-related-r1"]')).not.toBeNull();
    expect(document.querySelector('[data-blok-testid="database-filter-related-this-page"]')).toBeNull();
  });

  it('offers no "This page" in a relation filter away from a row page, unless it is chosen', () => {
    const h = harness({ filters: [] });
    const related: PropertyDefinition = { id: 'back', name: 'Measure A', type: 'relation', position: 'z0', relation: { targetDatabaseId: 'a' } };

    h.ctx.schema = () => [...schema, related];
    h.ctx.relatedRows = () => [{ id: 'r1', title: 'One' }];
    h.open('filter');
    click('database-pick-property-back');

    expect(document.querySelector('[data-blok-testid="database-filter-related-this-page"]')).toBeNull();
  });

  it('adds a conditional color rule and picks its background', () => {
    const h = harness();

    h.open();
    click('database-settings-color');
    click('database-color-add');
    click('database-pick-property-num');
    const [rule] = h.state.view.colorRules ?? [];

    expect(rule).toMatchObject({ propertyId: 'num', operator: 'is_not_empty', color: 'green' });

    click(`database-color-background-${rule.id}`);
    click('database-color-pick-gray');
    click(`database-color-background-${rule.id}`);
    click('database-color-pick-green');
    click(`database-color-apply-${rule.id}`);
    click('database-color-apply-property');

    expect(h.state.view.colorRules?.[0]).toMatchObject({ color: 'green', applyTo: 'property' });
  });

  // notion-motion.md Round 20 §4 (r20-cc-apply.raw): "Apply to" opens a flyout under its value: Entire row, This property.
  it('opens "Apply to" as a flyout under its value and keeps the color page', () => {
    const h = harness({ colorRules: [{ id: 'c1', propertyId: 'num', operator: 'is_not_empty', value: null, color: 'gray' }] });
    const panel = h.open();

    click('database-settings-color');
    click('database-color-apply-c1');
    const flyout = q('database-color-apply-picker');

    expect(flyout).not.toBeNull();
    expect(panel.root.contains(flyout)).toBe(false);
    expect(q('database-color-apply-row')?.getAttribute('aria-checked')).toBe('true');
    expect(q('database-color-apply-property')?.textContent).toBe('tools.database.colorApplyProperty');

    click('database-color-apply-property');

    expect(h.state.view.colorRules?.[0].applyTo).toBe('property');
    expect(q('database-color-apply-picker')).toBeNull();
    expect(q('database-color-apply-c1')?.textContent?.trim()).toBe('tools.database.colorApplyProperty');
  });

  // notion-motion.md Round 20 §4 (r20-cc-is.raw): the card's trash is "Delete conditional color rule".
  it('names the rule trash "Delete conditional color rule", as Notion does', async () => {
    const { default: en } = await import('../../../../src/components/i18n/locales/en.json');

    expect(en['tools.database.colorDelete']).toBe('Delete conditional color rule');
  });

  it('names the cell choice "This property", as Notion does', async () => {
    const { default: en } = await import('../../../../src/components/i18n/locales/en.json');

    expect(en['tools.database.colorApplyProperty']).toBe('This property');
  });

  // notion-motion.md Round 20 §4: a new Select rule starts on "Match option".
  it('starts a new Select rule on "Match option"', () => {
    const h = harness();

    h.open();
    click('database-settings-color');
    click('database-color-add');
    click('database-pick-property-stage');
    const [rule] = h.state.view.colorRules ?? [];

    expect(rule).toMatchObject({ propertyId: 'stage', color: 'match' });
    expect(q(`database-color-background-${rule.id}`)?.textContent?.trim()).toBe('tools.database.colorMatchOption');
  });

  // notion-motion.md Round 21 §1: what a new rule starts on, per type, also as a second rule.
  describe('a new conditional color rule (Round 21)', () => {
    const typed: PropertyDefinition[] = [
      ...schema,
      { id: 'txt', name: 'Notes', type: 'text', position: 'b0' },
      { id: 'cb', name: 'Done', type: 'checkbox', position: 'b1' },
      { id: 'tags', name: 'Tags', type: 'multiSelect', position: 'b2', config: { options: [{ id: 'm1', label: 'One', position: 'a0' }] } },
      { id: 'f', name: 'Formula', type: 'formula', position: 'b3' },
      { id: 'rel', name: 'Rel', type: 'relation', position: 'b4', relation: { targetDatabaseId: 'x' } },
      { id: 'roll', name: 'Roll', type: 'rollup', position: 'b5' },
      { id: 'cby', name: 'Created by', type: 'createdBy', position: 'b6' },
      { id: 'ct', name: 'Created', type: 'createdTime', position: 'b7' },
      { id: 'lby', name: 'Edited by', type: 'lastEditedBy', position: 'b8' },
      { id: 'lt', name: 'Edited', type: 'lastEditedTime', position: 'b9' },
    ];
    const add = (h: Harness, id: string): ColorRule => {
      click('database-color-add');
      click(`database-pick-property-${id}`);
      const rules = h.state.view.colorRules ?? [];

      return rules[rules.length - 1];
    };
    const open = (view: Partial<DatabaseViewConfig> = {}): Harness => {
      const h = harness(view);

      h.ctx.schema = () => typed;
      h.open();
      click('database-settings-color');

      return h;
    };

    it.each([
      ['txt', 'green'], ['num', 'green'], ['due', 'green'], ['cb', 'green'], ['owner', 'green'],
      ['stage', 'match'], ['prog', 'match'], ['tags', 'match'],
      // notion-motion.md Round 22 §3: Green on these too.
      ['title', 'green'], ['f', 'green'], ['rel', 'green'], ['roll', 'green'],
      ['cby', 'green'], ['ct', 'green'], ['lby', 'green'], ['lt', 'green'],
    ])('starts %s on %s, first or second', (id, color) => {
      const h = open();

      expect(add(h, id).color).toBe(color);
      expect(add(h, id).color).toBe(color);
    });

    it('starts Checkbox on "is" with no value and every other type on "is not empty"', () => {
      const h = open();

      expect(add(h, 'cb')).toMatchObject({ operator: 'equals', value: null });
      expect(add(h, 'prog')).toMatchObject({ operator: 'is_not_empty', value: null });
      expect(add(h, 'txt')).toMatchObject({ operator: 'is_not_empty', value: null });
    });

    // notion-motion.md Round 22 §3: a Number formula starts on "=" with its input. The panel gets it as its result type.
    it('starts a Number formula on "=", and a plain Number on "is not empty"', () => {
      const h = open();

      h.ctx.schema = () => [...typed, { id: 'fn', name: 'Double', type: 'number', position: 'c0' }];
      h.ctx.storedType = (id) => (id === 'fn' ? 'formula' : typed.find((p) => p.id === id)?.type);

      expect(add(h, 'fn')).toMatchObject({ operator: 'equals', value: null, color: 'green' });
      expect(q(`database-color-value-${h.state.view.colorRules?.[0]?.id ?? ''}`)).toBeInstanceOf(HTMLInputElement);
      expect(add(h, 'num')).toMatchObject({ operator: 'is_not_empty' });
    });

    it('never starts a rule on an operator its own flyout cannot offer', () => {
      const h = open();

      for (const property of typed.filter((p) => COLOR_RULE_TYPES.includes(p.type))) {
        const rule = add(h, property.id);

        click(`database-color-operator-${rule.id}`);
        const picked = document.querySelector('[data-blok-testid="database-filter-operator-picker"] [aria-checked="true"]');

        expect(picked?.getAttribute('data-blok-testid'), property.type).toBe(`database-filter-op-${rule.operator}`);
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        q('database-filter-operator-picker')?.closest('[data-blok-popover]')?.remove();
      }
    });

    // The Status filter keeps Is, Is not (database-filter-labels.test.ts).
    it('offers Is, Is not, Is empty, Is not empty on a Status rule', () => {
      open({ colorRules: [{ id: 'c1', propertyId: 'prog', operator: 'is_not_empty', value: null, color: 'match' }] });
      const ops = (): (string | null)[] => [...document.querySelectorAll('[data-blok-testid="database-filter-operator-picker"] [data-blok-testid^="database-filter-op-"]')]
        .map((el) => el.getAttribute('data-blok-testid'));

      click('database-color-operator-c1');
      expect(ops()).toEqual(['database-filter-op-equals', 'database-filter-op-does_not_equal', 'database-filter-op-is_empty', 'database-filter-op-is_not_empty']);
    });

    it('labels the Multi-select switch and value "Match first option", Status "Match option"', () => {
      open({ colorRules: [
        { id: 'c1', propertyId: 'tags', operator: 'is_not_empty', value: null, color: 'match' },
        { id: 'c2', propertyId: 'prog', operator: 'is_not_empty', value: null, color: 'match' },
      ] });

      expect(q('database-color-background-c1')?.textContent?.trim()).toBe('tools.database.colorMatchFirstOption');
      expect(q('database-color-background-c2')?.textContent?.trim()).toBe('tools.database.colorMatchOption');
      click('database-color-background-c1');
      expect(q('database-color-match-option')?.textContent).toContain('tools.database.colorMatchFirstOption');
      expect(q('database-color-match-option')?.getAttribute('aria-checked')).toBe('true');
      click('database-color-pick-red');
      click('database-color-background-c2');
      expect(q('database-color-match-option')?.textContent).toContain('tools.database.colorMatchOption');
    });
  });

  // notion-motion.md Round 20 §4: a ⠿ handle on each card reorders the rules; the order is their priority.
  it('reorders conditional color rules by their handle', () => {
    const h = harness({
      colorRules: [
        { id: 'c1', propertyId: 'num', operator: 'is_not_empty', value: null, color: 'gray' },
        { id: 'c2', propertyId: 'stage', operator: 'is_not_empty', value: null, color: 'green' },
      ],
    });

    h.open();
    click('database-settings-color');
    const handle = q('database-color-rules-handle-c1');

    expect(handle?.getAttribute('aria-label')).toBe('tools.database.settingsDragToReorder');
    handle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));

    expect(h.state.view.colorRules?.map((rule) => rule.id)).toEqual(['c2', 'c1']);
  });

  // notion-motion.md Round 20 §4 (r20-cc-bg.raw, r20-cc-swatches.raw): a 190-wide flyout, Match option, 10 swatches.
  describe('conditional color picker', () => {
    const COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

    it('opens under the value with a focused Match option switch and ten unnamed swatches', () => {
      const h = harness({ colorRules: [{ id: 'c1', propertyId: 'stage', operator: 'is_not_empty', value: null, color: 'match' }] });
      const panel = h.open();

      click('database-settings-color');
      click('database-color-background-c1');
      const flyout = q('database-color-background-picker');
      const toggle = q('database-color-match-option');

      expect(flyout?.style.width).toBe('190px');
      expect(panel.root.contains(flyout)).toBe(false);
      expect(toggle?.getAttribute('aria-checked')).toBe('true');
      expect(toggle).toHaveFocus();
      expect([...(flyout?.querySelectorAll('[data-blok-database-color-swatch]') ?? [])].map((el) => el.getAttribute('data-color'))).toEqual(COLORS);
      expect(q('database-color-pick-blue')?.textContent).toBe('');
      expect(q('database-color-pick-blue')?.getAttribute('aria-label')).toBe('tools.database.colorBackgroundHint');
    });

    it('closes on a swatch pick, turns Match option off and shows the swatch before the name', () => {
      const h = harness({ colorRules: [{ id: 'c1', propertyId: 'stage', operator: 'is_not_empty', value: null, color: 'match' }] });

      h.open();
      click('database-settings-color');
      click('database-color-background-c1');
      click('database-color-pick-blue');

      expect(h.state.view.colorRules?.[0].color).toBe('blue');
      expect(q('database-color-background-picker')).toBeNull();
      expect(q('database-color-background-c1')?.querySelector('[data-blok-database-color-chip]')?.getAttribute('data-color')).toBe('blue');

      click('database-color-background-c1');

      expect(q('database-color-match-option')?.getAttribute('aria-checked')).toBe('false');
      expect(q('database-color-pick-blue')?.getAttribute('aria-pressed')).toBe('true');
      expect(q('database-color-pick-red')?.getAttribute('aria-pressed')).toBe('false');

      click('database-color-match-option');

      expect(h.state.view.colorRules?.[0].color).toBe('match');
    });

    it('has no Match option for a rule on a property without options', () => {
      const h = harness({ colorRules: [{ id: 'c1', propertyId: 'num', operator: 'is_not_empty', value: null, color: 'gray' }] });

      h.open();
      click('database-settings-color');
      click('database-color-background-c1');

      expect(q('database-color-background-picker')).not.toBeNull();
      expect(q('database-color-match-option')).toBeNull();
    });
  });

  // notion-motion.md Round 20 §4 (r20-cc-intro.raw, r20-cc-sel.raw, r20-cc-list-style.raw, r20-cc-ops.raw, r20-cc-del*.raw).
  describe('conditional color page', () => {
    const note = (): Element | null => document.querySelector('[data-blok-testid="database-view-settings"] [data-blok-database-panel-note]');

    it('shows the intro text and a "New color setting" button while there is no rule', () => {
      harness().open();
      click('database-settings-color');

      expect(note()?.textContent).toBe('tools.database.colorBlurb');
      expect(q('database-color-add')?.hasAttribute('data-blok-database-color-new')).toBe(true);
    });

    it('drops the intro once a rule exists and heads each card "Property operator ⌄" with a trash', () => {
      const h = harness({ colorRules: [{ id: 'c1', propertyId: 'stage', operator: 'is_not_empty', value: null, color: 'match' }] });

      h.open();
      click('database-settings-color');
      const operator = q('database-color-operator-c1');

      expect(note()).toBeNull();
      expect(q('database-color-add')?.hasAttribute('data-blok-database-color-add-another')).toBe(true);
      expect(q('database-color-rule-c1')?.querySelector('[data-blok-database-chip-header]')?.contains(operator)).toBe(true);
      // notion-motion.md Round 21 §1: the property name is plain text outside the operator button.
      expect(operator?.textContent?.trim()).toBe('tools.database.filteroperator.isnotempty');
      expect(operator?.previousElementSibling?.textContent).toBe('Stage');
      expect(operator?.previousElementSibling?.hasAttribute('data-blok-database-color-rule-name')).toBe(true);
      expect(q('database-color-delete-c1')?.getAttribute('aria-label')).toBe('tools.database.colorDelete');
      expect(q('database-color-condition-c1')).toBeNull();
    });

    it('picks the operator from a 190-wide flyout under the header button', () => {
      const h = harness({ colorRules: [{ id: 'c1', propertyId: 'stage', operator: 'is_not_empty', value: null, color: 'match' }] });
      const panel = h.open();

      click('database-settings-color');
      click('database-color-operator-c1');
      const flyout = q('database-filter-operator-picker');

      expect(flyout?.style.width).toBe('190px');
      expect(panel.root.contains(flyout)).toBe(false);
      click('database-filter-op-equals');

      expect(h.state.view.colorRules?.[0].operator).toBe('equals');
      expect(q('database-filter-operator-picker')).toBeNull();
    });

    it('shows a value field under the header when the operator takes one, opening the value flyout', () => {
      const h = harness({ colorRules: [{ id: 'c1', propertyId: 'stage', operator: 'equals', value: null, color: 'match' }] });

      h.open();
      click('database-settings-color');
      const card = q('database-color-rule-c1');
      const header = card?.querySelector('[data-blok-database-chip-header]');

      expect(header?.nextElementSibling).toBe(q('database-color-value-c1'));
      click('database-color-value-c1');
      expect(q('database-filter-value-picker')).not.toBeNull();
    });

    // notion-motion.md Round 20 §4 (r20-cc-is.raw, r20-cc-red.png): an empty Select value reads "Select...", a pick shows its token.
    it('shows a Select rule\'s value as its option token, and "Select..." while empty', () => {
      const h = harness({ colorRules: [{ id: 'c1', propertyId: 'stage', operator: 'equals', value: null, color: 'match' }] });

      h.open();
      click('database-settings-color');

      expect(q('database-color-value-c1')?.textContent).toBe('tools.database.colorValuePlaceholder');

      h.ctx.updateView({ colorRules: [{ id: 'c1', propertyId: 'stage', operator: 'equals', value: ['o1'], color: 'match' }] });
      const token = q('database-color-value-c1')?.querySelector('[data-blok-database-option-pill]');

      expect(token?.textContent).toBe('Idea');
      expect(q('database-color-value-c1')?.hasAttribute('data-empty')).toBe(false);
    });

    // notion-motion.md Round 21 §1 (r21-cc-date-cc.raw, r21-cc-date-is-cc.raw): "Date is not empty" until the operator
    // takes a value, then "Start date ⌄ is ⌄".
    it('heads a Date rule with its name until the operator takes a value', () => {
      const h = harness({ colorRules: [{ id: 'c1', propertyId: 'due', operator: 'is_not_empty', value: null, color: 'green' }] });
      const header = (): Element | null | undefined => q('database-color-rule-c1')?.querySelector('[data-blok-database-color-rule-header]');

      h.open();
      click('database-settings-color');

      expect(q('database-color-side-c1')).toBeNull();
      expect(header()?.querySelector('[data-blok-database-color-rule-name]')?.textContent).toBe('Due');
      expect(header()?.hasAttribute('data-blok-database-color-rule-plain-date')).toBe(true);

      h.ctx.updateView({ colorRules: [{ id: 'c1', propertyId: 'due', operator: 'equals', value: null, color: 'green' }] });

      expect(q('database-color-side-c1')?.textContent?.trim()).toBe('tools.database.dateStart');
      expect(header()?.querySelector('[data-blok-database-color-rule-name]')).toBeNull();
      expect(header()?.hasAttribute('data-blok-database-color-rule-plain-date')).toBe(false);

      // An End date side stays visible, or the rule would look like it reads the start.
      h.ctx.updateView({ colorRules: [{ id: 'c1', propertyId: 'due', operator: 'end:is_empty', value: null, color: 'green' }] });

      expect(q('database-color-side-c1')?.textContent?.trim()).toBe('tools.database.dateEnd');
    });

    // notion-motion.md Round 22 §4 (r22-cc-num-*-cc.raw): each comparison puts its own symbol before the value.
    it('puts the operator\'s own symbol before a Number rule\'s value', () => {
      const h = harness({ colorRules: [{ id: 'c1', propertyId: 'num', operator: 'equals', value: null, color: 'green' }] });
      const prefix = (): Element | null | undefined => q('database-color-rule-c1')?.querySelector('[data-blok-database-color-rule-prefix]');

      h.open();
      click('database-settings-color');

      expect(prefix()?.textContent).toBe('=');
      expect(prefix()?.parentElement?.contains(q('database-color-value-c1'))).toBe(true);

      for (const [operator, symbol] of [
        ['does_not_equal', '≠'], ['greater_than', '>'], ['less_than', '<'],
        ['greater_than_or_equal_to', '≥'], ['less_than_or_equal_to', '≤'],
      ]) {
        h.ctx.updateView({ colorRules: [{ id: 'c1', propertyId: 'num', operator, value: null, color: 'green' }] });

        expect(prefix()?.textContent, operator).toBe(symbol);
      }
    });

    // notion-motion.md Round 22 §4: a Number formula does the same. A Text rule has no prefix.
    it('puts the symbol before a Number formula\'s value, and none before a Text one', () => {
      const h = harness({ colorRules: [
        { id: 'c1', propertyId: 'fn', operator: 'does_not_equal', value: null, color: 'green' },
        { id: 'c2', propertyId: 'title', operator: 'equals', value: null, color: 'green' },
      ] });

      h.ctx.schema = () => [...schema, { id: 'fn', name: 'Double', type: 'number', position: 'c0' }];
      h.open();
      click('database-settings-color');

      expect(q('database-color-rule-c1')?.querySelector('[data-blok-database-color-rule-prefix]')?.textContent).toBe('≠');
      expect(q('database-color-rule-c2')?.querySelector('[data-blok-database-color-rule-prefix]')).toBeNull();
    });

    // notion-motion.md Round 21 §2 (r21-board-cc-cc.raw, r21-list-cc-cc.raw): a board says "Card background", a list
    // "Page background"; neither has "Apply to".
    it.each([
      ['board', 'tools.database.colorCardBackground'],
      ['list', 'tools.database.colorPageBackground'],
      ['table', 'tools.database.colorPageBackground'],
    ] as const)('labels a %s rule\'s background %s', (type, label) => {
      harness({ type, colorRules: [{ id: 'c1', propertyId: 'num', operator: 'is_not_empty', value: null, color: 'green' }] }).open();
      click('database-settings-color');

      expect(q('database-color-rule-c1')?.querySelector('[data-blok-database-color-setting-label]')?.textContent).toBe(label);
      expect(exists('database-color-apply-c1')).toBe(type === 'table');
    });

    // notion-motion.md Round 21 §1: "Select..." on Status, Multi-select, Date, Checkbox and Person too.
    it('reads "Select..." on every measured picker type while empty', () => {
      const h = harness({ colorRules: [
        { id: 'c1', propertyId: 'prog', operator: 'equals', value: null, color: 'match' },
        { id: 'c2', propertyId: 'tags', operator: 'contains', value: null, color: 'match' },
        { id: 'c3', propertyId: 'due', operator: 'equals', value: null, color: 'green' },
        { id: 'c4', propertyId: 'cb', operator: 'equals', value: null, color: 'green' },
        { id: 'c5', propertyId: 'owner', operator: 'contains', value: null, color: 'green' },
      ] });

      h.ctx.schema = () => [...schema,
        { id: 'tags', name: 'Tags', type: 'multiSelect', position: 'b0', config: { options: [{ id: 'm1', label: 'One', position: 'a0' }] } },
        { id: 'cb', name: 'Done', type: 'checkbox', position: 'b1' }];
      h.open();
      click('database-settings-color');

      for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) {
        const value = q(`database-color-value-${id}`);

        expect(value?.textContent, id).toBe('tools.database.colorValuePlaceholder');
        expect(value?.hasAttribute('data-empty'), id).toBe(true);
      }
    });

    // notion-motion.md Round 22 §3: "Select..." on Relation, Created by/time and Last edited by/time too.
    it('reads "Select..." on Relation, Created and Last edited rules while empty', () => {
      const h = harness({ colorRules: [
        { id: 'c1', propertyId: 'rel', operator: 'contains', value: null, color: 'green' },
        { id: 'c2', propertyId: 'cby', operator: 'contains', value: null, color: 'green' },
        { id: 'c3', propertyId: 'lby', operator: 'contains', value: null, color: 'green' },
        { id: 'c4', propertyId: 'ct', operator: 'equals', value: null, color: 'green' },
        { id: 'c5', propertyId: 'lt', operator: 'equals', value: null, color: 'green' },
      ] });

      h.ctx.schema = () => [...schema,
        { id: 'rel', name: 'Rel', type: 'relation', position: 'b0', relation: { targetDatabaseId: 'x' } },
        { id: 'cby', name: 'Created by', type: 'createdBy', position: 'b1' },
        { id: 'lby', name: 'Edited by', type: 'lastEditedBy', position: 'b2' },
        { id: 'ct', name: 'Created', type: 'createdTime', position: 'b3' },
        { id: 'lt', name: 'Edited', type: 'lastEditedTime', position: 'b4' }];
      h.ctx.relatedRows = () => [{ id: 'r1', title: 'Alpha' }];
      h.open();
      click('database-settings-color');

      for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) {
        expect(q(`database-color-value-${id}`)?.textContent, id).toBe('tools.database.colorValuePlaceholder');
      }
    });

    // notion-motion.md Round 21 §1 (r21-cc-st-picked.png): a Status pick shows as its option token.
    it('shows a Status pick as its option token', () => {
      const h = harness({ colorRules: [{ id: 'c1', propertyId: 'prog', operator: 'equals', value: ['s1'], color: 'match' }] });

      h.open();
      click('database-settings-color');

      expect(q('database-color-value-c1')?.querySelector('[data-blok-database-option-pill]')?.textContent).toBe('Not started');
      expect(q('database-color-value-c1')?.hasAttribute('data-empty')).toBe(false);
    });

    // notion-motion.md Round 20 §4 (r20-cc-new.raw): the property list is a 258-wide flyout with a focused search.
    it('picks a new rule\'s property from a flyout and stays on the color page', () => {
      const h = harness();
      const panel = h.open();

      click('database-settings-color');
      click('database-color-add');
      const flyout = q('database-color-property-picker');

      expect(flyout).not.toBeNull();
      expect(panel.root.contains(flyout)).toBe(false);
      expect(flyout?.style.width).toBe('258px');
      expect(flyout?.querySelector('[data-blok-testid="database-property-picker-search"]')).toHaveFocus();

      click('database-pick-property-num');
      const [rule] = h.state.view.colorRules ?? [];

      expect(q('database-color-property-picker')).toBeNull();
      expect(q(`database-color-rule-${rule.id}`)).not.toBeNull();
      expect(panel.root.contains(q('database-color-add'))).toBe(true);
    });

    // notion-motion.md Round 20 §4 (r20-cc-selval.raw): the value flyout is 240 wide, not the advanced filter's 260.
    it('opens a 240-wide value flyout', () => {
      harness({ colorRules: [{ id: 'c1', propertyId: 'stage', operator: 'equals', value: null, color: 'match' }] }).open();
      click('database-settings-color');
      click('database-color-value-c1');

      expect(q('database-filter-value-picker')?.style.width).toBe('240px');
    });

    it('deletes a rule at once with its trash, and the last delete brings back the intro', () => {
      const h = harness({ colorRules: [{ id: 'c1', propertyId: 'num', operator: 'is_not_empty', value: null, color: 'gray' }] });

      h.open();
      click('database-settings-color');
      click('database-color-delete-c1');

      expect(h.state.view.colorRules).toEqual([]);
      expect(note()?.textContent).toBe('tools.database.colorBlurb');
    });
  });

  it('keeps conditional color rules in order while the view is locked', () => {
    const h = harness({
      colorRules: [
        { id: 'c1', propertyId: 'num', operator: 'is_not_empty', value: null, color: 'gray' },
        { id: 'c2', propertyId: 'stage', operator: 'is_not_empty', value: null, color: 'green' },
      ],
    });

    h.state.locked = true;
    h.open();
    click('database-settings-color');
    q('database-color-rules-handle-c1')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));

    expect(h.state.view.colorRules?.map((rule) => rule.id)).toEqual(['c1', 'c2']);
    expect(q('database-color-rules-handle-c1')).toBeNull();
    expect(document.querySelector('[data-blok-database-color-rules]')).not.toBeNull();
  });

  it('blocks shared edits while locked, but not personal filters', () => {
    const h = harness();

    h.state.locked = true;
    h.open();

    click('database-settings-layout');
    expect((document.querySelector('[data-blok-testid="database-layout-board"]') as HTMLButtonElement).disabled).toBe(true);
    click('database-panel-back');

    click('database-settings-filter');
    click('database-pick-property-num');

    expect(h.state.view.filters).toHaveLength(1);
  });

  it('opens a filter pill popover at its editor, 220 wide', () => {
    const h = harness({ filters: [{ id: 'f1', propertyId: 'due', operator: 'this_week', value: null }] });

    h.openPill('f1');

    expect((document.querySelector('[data-blok-testid="database-filter-popover"]') as HTMLElement).style.width).toBe('220px');

    // The window editor is filter-sort's This/Past/Next editor (findings V18).
    const direction = document.querySelector<HTMLSelectElement>('[data-blok-testid="database-filter-direction"]');

    if (direction === null) throw new Error('no direction');
    direction.value = 'past';
    direction.dispatchEvent(new Event('change'));

    expect(h.state.view.filters[0]).toMatchObject({ operator: 'relative_to_today', value: 'past:1:week' });

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

// research/12 §2 + shot 32: Data source settings reads Automations, "AI Autofill" (count), then More settings.
describe('view settings panel — AI Autofill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const autofillSchema: PropertyDefinition[] = [
    { id: 'title', name: 'Name', type: 'title', position: 'a0' },
    { id: 'sum', name: 'Summary', type: 'text', position: 'a1', autofill: { mode: 'summary', instruction: 'x' } },
    { id: 'notes', name: 'Notes', type: 'text', position: 'a2' },
    { id: 'calc', name: 'Calc', type: 'formula', position: 'a3' },
  ];

  const rowIds = (): string[] => [...document.querySelectorAll<HTMLElement>('[data-blok-testid^="database-settings-"]')]
    .map((el) => el.getAttribute('data-blok-testid') ?? '');

  const withAutofill = (writable = true): { h: Harness; open: ReturnType<typeof vi.fn> } => {
    const h = harness();
    const open = vi.fn();

    h.ctx.customizeLayout = () => ({ testId: 'database-settings-customize-layout', label: 'Customize page layout', icon: '', onClick: vi.fn() });
    h.ctx.automations = { read: () => undefined, schema: () => [], views: () => [], writable: () => true, write: () => true };
    h.ctx.autofill = { properties: () => autofillSchema, writable: () => writable, open };

    return { h, open };
  };

  it('puts AI Autofill between Automations and More settings, with the count of autofill properties', () => {
    withAutofill().h.open();
    const root = rowIds();
    const at = root.indexOf('database-settings-autofill');

    expect(at).toBeGreaterThan(-1);
    expect(root[at - 1]).toBe('database-settings-automations');
    expect(root[at + 1]).toBe('database-settings-more');
    const row = document.querySelector('[data-blok-testid="database-settings-autofill"]');

    expect(row?.textContent).toContain('tools.database.aiAutofill');
    expect(row?.textContent).toContain('1');
  });

  it('has no AI Autofill row when the host gives no autofill', () => {
    harness().open();

    expect(exists('database-settings-autofill')).toBe(false);
  });

  it('disables the row when the database cannot be written', () => {
    withAutofill(false).h.open();

    expect(document.querySelector<HTMLButtonElement>('[data-blok-testid="database-settings-autofill"]')?.disabled).toBe(true);
  });

  it('lists each autofill property and opens its setup, closing the panel first', () => {
    const { h, open } = withAutofill();
    const panel = h.open();
    const close = vi.spyOn(panel, 'close');

    click('database-settings-autofill');

    expect(exists('database-autofill-open-sum')).toBe(true);
    expect(exists('database-autofill-open-notes')).toBe(false);
    expect(document.querySelector('[data-blok-testid="database-autofill-open-sum"]')?.textContent).toContain('tools.database.aiAutofillProperty');
    click('database-autofill-open-sum');

    expect(close).toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith('sum');
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[0]);
  });

  it('"New AI Autofill" picks a property that can autofill and has none yet, then opens its setup', () => {
    const { h, open } = withAutofill();

    h.open();
    click('database-settings-autofill');

    expect(document.querySelector('[data-blok-testid="database-autofill-new"]')?.textContent).toContain('tools.database.aiAutofillNew');
    click('database-autofill-new');

    expect(exists('database-autofill-pick-notes')).toBe(true);
    expect(exists('database-autofill-pick-sum')).toBe(false);
    expect(exists('database-autofill-pick-calc')).toBe(false);
    click('database-autofill-pick-notes');

    expect(open).toHaveBeenCalledWith('notes');
  });
});

// research/26 §1a L32 (row order), research/35 §2.2 L196-197 and 33-edit-properties.png (the page),
// research/10 L16 (a property opens its Edit property panel), research/28 L131 (a map has no row).
describe('view settings: Edit properties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const rowIds = (): string[] => [...document.querySelectorAll<HTMLElement>('[data-blok-testid^="database-settings-"]')]
    .map((el) => el.getAttribute('data-blok-testid') ?? '');

  const editRowNames = (): Array<string | null> => [...document.querySelectorAll('[data-blok-testid^="database-edit-property-"]')]
    .map((row) => row.querySelector('[data-blok-database-panel-label]')?.textContent ?? null);

  const withEditProperties = (view: Partial<DatabaseViewConfig> = {}, writable = true): { h: Harness; edit: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn> } => {
    const h = harness(view);
    const edit = vi.fn();
    const add = vi.fn();

    h.ctx.dataSources = { list: () => [{ id: 'db', title: 'Tasks', fits: true }], current: () => 'db', pick: vi.fn() };
    h.ctx.automations = { read: () => undefined, schema: () => [], views: () => [], writable: () => true, write: () => true };
    h.ctx.editProperties = { properties: () => schema, writable: () => writable, edit, add };

    return { h, edit, add };
  };

  it('sits between Source and Automations under Data source settings', () => {
    withEditProperties().h.open();
    const root = rowIds();
    const at = root.indexOf('database-settings-edit-properties');

    expect(at).toBeGreaterThan(-1);
    expect(root[at - 1]).toBe('database-settings-source');
    expect(root[at + 1]).toBe('database-settings-automations');
    expect(document.querySelector('[data-blok-testid="database-settings-edit-properties"]')?.textContent).toContain('tools.database.settingsEditProperties');
  });

  it('has no row without the lever, on a map, or a usable one when the database cannot be written', () => {
    harness().open();
    expect(exists('database-settings-edit-properties')).toBe(false);
    document.body.innerHTML = '';

    withEditProperties({ type: 'map' }).h.open();
    expect(exists('database-settings-edit-properties')).toBe(false);
    document.body.innerHTML = '';

    withEditProperties({}, false).h.open();
    expect(document.querySelector<HTMLButtonElement>('[data-blok-testid="database-settings-edit-properties"]')?.disabled).toBe(true);
  });

  it('opens "Properties": a focused search, every property in schema order, then New property', () => {
    withEditProperties().h.open();
    click('database-settings-edit-properties');
    const panel = document.querySelector<HTMLElement>('[data-blok-testid="database-view-settings"]');
    const search = document.querySelector<HTMLInputElement>('[data-blok-testid="database-edit-properties-search"]');
    const listed = editRowNames();

    expect(panel?.querySelector('[data-blok-database-panel-header]')?.textContent).toContain('tools.database.propertiesSection');
    expect(search?.placeholder).toBe('tools.database.settingsSearchProperty');
    expect(search).toHaveFocus();
    expect(listed).toEqual(['Name', 'Due', 'Amount', 'Stage', 'Progress', 'Owner']);
    expect(document.querySelector('[data-blok-testid="database-edit-property-due"] [data-blok-database-panel-chevron]')).not.toBeNull();
    expect(document.querySelector('[data-blok-testid="database-edit-properties-new"]')?.textContent).toContain('tools.database.settingsNewProperty');
  });

  it('filters by the search, and reads "No results" when nothing matches', () => {
    withEditProperties().h.open();
    click('database-settings-edit-properties');
    const search = document.querySelector<HTMLInputElement>('[data-blok-testid="database-edit-properties-search"]');

    if (search === null) throw new Error('no search');
    search.value = 'am';
    search.dispatchEvent(new Event('input'));
    expect(editRowNames()).toEqual(['Name', 'Amount']);

    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('[data-blok-testid^="database-edit-property-"]')).toHaveLength(0);
    expect(document.querySelector('[data-blok-testid="database-view-settings"]')?.textContent).toContain('find.noResults');
    expect(search).toHaveFocus();
  });

  it('leaves the title out of a feed\'s list', () => {
    withEditProperties({ type: 'feed' }).h.open();
    click('database-settings-edit-properties');

    expect(exists('database-edit-property-title')).toBe(false);
    expect(exists('database-edit-property-due')).toBe(true);
  });

  it('opens a property\'s Edit property panel and New property, closing the panel first', () => {
    const { h, edit, add } = withEditProperties();
    const panel = h.open();
    const close = vi.spyOn(panel, 'close');

    click('database-settings-edit-properties');
    click('database-edit-property-due');

    expect(edit).toHaveBeenCalledWith('due');
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(edit.mock.invocationCallOrder[0]);

    const again = h.open();

    click('database-settings-edit-properties');
    click('database-edit-properties-new');
    expect(add).toHaveBeenCalledTimes(1);
    expect(again).toBeDefined();
  });
});
