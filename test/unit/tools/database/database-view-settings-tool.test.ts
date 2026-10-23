import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockAPI, BlockToolConstructorOptions } from '../../../../types';
import type { DatabaseConfig, DatabaseData, DatabaseRowData, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';
import { DatabaseTool } from '../../../../src/tools/database';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';

const schema: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-num', name: 'Amount', type: 'number', position: 'a1' },
  {
    id: 'p-stage', name: 'Stage', type: 'select', position: 'a2', config: {
      options: [
        { id: 'o-idea', label: 'Idea', color: 'yellow', position: 'a0' },
        { id: 'o-build', label: 'Build', color: 'blue', position: 'a1' },
      ],
    },
  },
];

const rowBlock = (id: string, position: string, properties: Record<string, unknown>): BlockAPI => ({
  id,
  name: 'database-row',
  holder: document.createElement('div'),
  preservedData: { properties, position } as DatabaseRowData,
  call: vi.fn(),
  dispatchChange: vi.fn(),
} as unknown as BlockAPI);

const rows = (): BlockAPI[] => [
  rowBlock('r1', 'a0', { 'p-title': 'Alpha', 'p-num': 1200, 'p-stage': 'o-idea' }),
  rowBlock('r2', 'a1', { 'p-title': 'Bravo', 'p-num': 35, 'p-stage': 'o-build' }),
  rowBlock('r3', 'a2', { 'p-title': 'Charlie' }),
];

const createApi = (children: BlockAPI[]): API => ({
  i18n: { t: (key: string) => key },
  events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  blocks: {
    getChildren: vi.fn().mockReturnValue(children),
    insertAt: vi.fn(),
    delete: vi.fn(),
    getById: vi.fn(),
    getBlockIndex: vi.fn().mockReturnValue(0),
  },
  notifier: { show: vi.fn() },
  tools: { getBlockTools: vi.fn(() => []), getToolsConfig: vi.fn(() => ({ tools: undefined })) },
} as unknown as API);

const tableView = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...overrides,
});

const mount = (view: Partial<DatabaseViewConfig> = {}, config: DatabaseConfig = {}, extra: Partial<DatabaseData> = {}): {
  tool: DatabaseTool;
  root: HTMLElement;
  dispatchChange: ReturnType<typeof vi.fn>;
} => {
  const dispatchChange = vi.fn();
  const options: BlockToolConstructorOptions<DatabaseData, DatabaseConfig> = {
    data: { schema, views: [tableView(view)], activeViewId: 'v1', ...extra },
    config,
    api: createApi(rows()),
    readOnly: false,
    block: { id: 'db1', dispatchChange } as never,
  };
  const tool = new DatabaseTool(options);
  const root = tool.render();

  document.body.appendChild(root);

  return { tool, root, dispatchChange };
};

const q = (id: string): HTMLElement | null => document.querySelector(`[data-blok-testid="${id}"]`);

const click = (id: string): void => {
  const el = q(id);

  if (el === null) throw new Error(`no ${id}`);
  el.click();
};

const rowIds = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('[data-blok-database-table-row]')].map((el) => el.getAttribute('data-row-id') ?? '');

/** Opens a column header's menu and picks an item by its label key. */
const headerAction = (root: HTMLElement, propertyId: string, labelKey: string): void => {
  root.querySelector<HTMLElement>(`[data-blok-database-table-column-header][data-property-id="${propertyId}"] [data-blok-database-table-column-button]`)?.click();
  const item = [...document.querySelectorAll<HTMLElement>('[data-blok-popover-item]')].find((el) => el.textContent?.includes(labelKey));

  if (item === undefined) throw new Error(`no header item ${labelKey}`);
  item.click();
};

describe('DatabaseTool — view settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    PopoverRegistry.resetForTests();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  // findings V10: the panel's "View name" field renames the tab too, not only the saved view.
  it('renames the tab from the view settings name field', () => {
    const { root } = mount({}, {}, { views: [tableView(), tableView({ id: 'v2', name: 'Two', position: 'a1' })] });

    click('database-toolbar-settings');
    const field = q('database-settings-view-name') as HTMLInputElement;

    field.value = 'Roadmap';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(root.querySelector('[data-blok-database-tab][data-view-id="v1"] [data-blok-database-tab-name]')?.textContent).toBe('Roadmap');
  });

  // findings V08: the tab menu's Rename opens View settings with the name field focused.
  it('the tab menu\'s Rename opens view settings with the name field focused', () => {
    const { root } = mount({}, {}, { views: [tableView(), tableView({ id: 'v2', name: 'Two', position: 'a1' })] });
    const tab = root.querySelector('[data-blok-database-tab][data-view-id="v2"]');

    tab?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    document.querySelector<HTMLElement>('[data-blok-item-name="database-view-rename"]')?.click();

    expect(root.querySelector('[data-blok-database-tab-rename-input]')).toBeNull();
    expect(q('database-settings-view-name')).toHaveFocus();
    expect((q('database-settings-view-name') as HTMLInputElement).value).toBe('Two');
  });

  it('draws the toolbar beside the tabs', () => {
    const { root } = mount();

    expect(root.querySelector('[data-blok-database-view-bar] [data-blok-database-view-toolbar]')).not.toBeNull();
    expect(q('database-toolbar-settings')).not.toBeNull();
  });

  it('applies a filter from a column header for this person only', () => {
    const { tool, root, dispatchChange } = mount();

    headerAction(root, 'p-num', 'tools.database.tableFilter');
    const input = q('database-filter-value') as HTMLInputElement;

    input.value = '100';
    input.dispatchEvent(new Event('input'));
    click('database-filter-operator');
    click('database-filter-op-greater_than');

    expect(rowIds(root)).toEqual(['r1']);
    expect(tool.save(root).views[0].filters).toEqual([]);
    expect(dispatchChange).not.toHaveBeenCalled();
  });

  it('saves personal filter and sort changes to the selected ordinary table view', () => {
    const first = tableView({
      name: 'First table',
      filters: [{ id: 'first-filter', propertyId: 'p-stage', operator: 'equals', value: 'o-idea' }],
      sorts: [{ id: 'first-sort', propertyId: 'p-title', direction: 'desc' }],
    });
    const second = tableView({ id: 'v2', name: 'Second table', position: 'a1' });
    const { tool, root, dispatchChange } = mount({}, {}, { views: [first, second] });

    try {
      const baseline = structuredClone(tool.save(root));
      const selectTab = (viewId: string): void => {
        const tab = root.querySelector<HTMLElement>(`[data-blok-database-tab][data-view-id="${viewId}"]`);

        if (tab === null) throw new Error(`missing ordinary view tab ${viewId}`);
        tab.click();
      };

      const controlsState = (): [HTMLElement['hidden'], HTMLElement['hidden'], boolean, HTMLElement['hidden'], boolean] => {
        const toolbar = root.querySelector<HTMLElement>('[data-blok-database-view-toolbar]');
        const filter = q('database-toolbar-filter');
        const sort = q('database-toolbar-sort');

        if (toolbar === null || !(filter instanceof HTMLButtonElement) || !(sort instanceof HTMLButtonElement)) {
          throw new Error('missing ordinary filter or sort control');
        }

        return [toolbar.hidden, filter.hidden, filter.disabled, sort.hidden, sort.disabled];
      };

      selectTab('v2');
      const selectedControls = controlsState();
      const sharedWritesBeforePersonal = dispatchChange.mock.calls.length;

      headerAction(root, 'p-num', 'tools.database.tableFilter');
      const input = q('database-filter-value');

      if (!(input instanceof HTMLInputElement)) throw new Error('missing numeric filter input');
      input.value = '0';
      input.dispatchEvent(new Event('input'));
      click('database-filter-operator');
      click('database-filter-op-greater_than');
      const filteredRows = rowIds(root);

      headerAction(root, 'p-num', 'tools.database.tableSort');
      click('database-header-sort-asc');
      const personalRows = rowIds(root);
      const beforeSave = structuredClone(tool.save(root));
      const sharedWritesAfterPersonal = dispatchChange.mock.calls.length;
      const personalControls = controlsState();

      click('database-view-save');
      const afterSave = structuredClone(tool.save(root));
      const savedControls = controlsState();

      expect(afterSave.views.find((view) => view.id === 'v2')).toMatchObject({
        filters: [expect.objectContaining({ propertyId: 'p-num', operator: 'greater_than' })],
        sorts: [expect.objectContaining({ propertyId: 'p-num', direction: 'asc' })],
      });
      expect(afterSave.views.find((view) => view.id === 'v2')?.filters[0]?.value).toBe(0);
      expect(afterSave.views.find((view) => view.id === 'v1')).toEqual(baseline.views.find((view) => view.id === 'v1'));
      expect(beforeSave.views).toEqual(baseline.views);
      expect(beforeSave.activeViewId).toBe('v2');
      expect(afterSave.activeViewId).toBe('v2');
      expect(filteredRows).toEqual(['r1', 'r2']);
      expect(personalRows).toEqual(['r2', 'r1']);
      expect(sharedWritesAfterPersonal).toBe(sharedWritesBeforePersonal);
      expect(dispatchChange.mock.calls.length).toBeGreaterThan(sharedWritesAfterPersonal);
      expect(selectedControls).toEqual([false, false, false, false, false]);
      expect(personalControls).toEqual([false, false, false, false, false]);
      expect(savedControls).toEqual([false, false, false, false, false]);
      expect(q('database-view-save')).toBeNull();

      selectTab('v1');
      expect(rowIds(root)).toEqual(['r1']);
      selectTab('v2');
      expect(rowIds(root)).toEqual(['r2', 'r1']);
      expect(tool.save(root).views.find((view) => view.id === 'v1')).toEqual(baseline.views.find((view) => view.id === 'v1'));
    } finally {
      tool.destroy();
    }
  });

  it('writes a personal sort to the document on Save for everyone', () => {
    const { tool, root, dispatchChange } = mount();

    headerAction(root, 'p-num', 'tools.database.tableSort');
    click('database-header-sort-desc');

    expect(rowIds(root)).toEqual(['r1', 'r2', 'r3']);
    expect(tool.save(root).views[0].sorts).toEqual([]);

    click('database-view-save');

    expect(tool.save(root).views[0].sorts).toEqual([expect.objectContaining({ propertyId: 'p-num', direction: 'desc' })]);
    expect(dispatchChange).toHaveBeenCalled();
  });

  it('searches titles and property text', () => {
    const { root } = mount();

    click('database-toolbar-search');
    const input = q('database-search-input') as HTMLInputElement;

    input.value = 'idea';
    input.dispatchEvent(new Event('input'));

    expect(rowIds(root)).toEqual(['r1']);
  });

  it.each(['list', 'gallery'] as const)('searches a paged %s view too', (type) => {
    const { root } = mount({ type });

    click('database-toolbar-search');
    const input = q('database-search-input') as HTMLInputElement;

    input.value = 'idea';
    input.dispatchEvent(new Event('input'));

    expect([...root.querySelectorAll('[data-blok-database-list-row], [data-blok-database-gallery-card]')].map((el) => el.getAttribute('data-row-id')))
      .toEqual(['r1']);
  });

  // research/23 §2e, through the real view write: the old settings must not survive the switch.
  it('saves fresh group settings with Hide empty groups on when the grouping switches to a number', () => {
    const { tool, root } = mount({ type: 'board', groupBy: 'p-stage', groupSettings: { sort: 'manual', colorColumns: true } });

    click('database-toolbar-settings');
    click('database-settings-group');
    click('database-group-by');
    click('database-pick-property-p-num');

    expect(tool.save(root).views[0].groupBy).toBe('p-num');
    expect(tool.save(root).views[0].groupSettings).toEqual({ hideEmptyGroups: true });
  });

  // research/23 §2e: a select starts with Hide empty groups off.
  it('resets the group settings when the grouping switches from a number to a select', () => {
    const { tool, root } = mount({ type: 'board', groupBy: 'p-num', groupSettings: { hideEmptyGroups: true, numberBy: 'range' } });

    click('database-toolbar-settings');
    click('database-settings-group');
    click('database-group-by');
    click('database-pick-property-p-stage');

    expect(tool.save(root).views[0].groupBy).toBe('p-stage');
    expect(tool.save(root).views[0].groupSettings).toEqual({});
  });

  it('does the same from a column header\'s Group', () => {
    const { tool, root } = mount({ groupSettings: { sort: 'manual' } });

    headerAction(root, 'p-num', 'tools.database.tableGroup');

    expect(tool.save(root).views[0].groupBy).toBe('p-num');
    expect(tool.save(root).views[0].groupSettings).toEqual({ hideEmptyGroups: true });
  });

  describe('Manage in Calendar (research/26 §3d, research/27 §3)', () => {
    const timelineSchema: PropertyDefinition[] = [...schema, { id: 'p-due', name: 'Due', type: 'date', position: 'a3' }];

    it('has no row and no timeline button without config.calendar', () => {
      const { root } = mount({ type: 'timeline' }, {}, { schema: timelineSchema });

      click('database-toolbar-settings');
      expect(q('database-settings-manage-calendar')).toBeNull();
      expect(root.querySelector('[data-blok-database-timeline-manage-calendar]')).toBeNull();
    });

    it('shows the row right after the lock, with an arrow that leaves the app, and hands the host the database and view', () => {
      const manage = vi.fn();

      mount({}, { calendar: { manage } });
      click('database-toolbar-settings');
      const row = q('database-settings-manage-calendar');

      expect(row?.textContent).toContain('tools.database.manageInCalendar');
      expect(row?.previousElementSibling?.getAttribute('data-blok-testid')).toBe('database-settings-lock');
      expect(row?.querySelector('[data-blok-database-panel-icon] svg')).not.toBeNull();
      expect(row?.querySelector('[data-blok-database-panel-external] svg')).not.toBeNull();
      click('database-settings-manage-calendar');
      expect(manage).toHaveBeenCalledWith({ databaseId: 'db1', viewId: 'v1' });
      expect(q('database-settings-manage-calendar')).toBeNull();
    });

    it('uses the host label, and puts the button on the timeline toolbar', () => {
      const manage = vi.fn();
      const { root } = mount({ type: 'timeline' }, { calendar: { manage, label: 'Open in Agenda' } }, { schema: timelineSchema });
      const button = root.querySelector<HTMLElement>('[data-blok-database-timeline-manage-calendar]');

      expect(button?.textContent?.trim()).toBe('Open in Agenda');
      button?.click();
      expect(manage).toHaveBeenCalledWith({ databaseId: 'db1', viewId: 'v1' });
      click('database-toolbar-settings');
      expect(q('database-settings-manage-calendar')?.textContent).toContain('Open in Agenda');
    });

    it('puts no button on a table view', () => {
      const { root } = mount({}, { calendar: { manage: vi.fn() } });

      expect(root.querySelector('[data-blok-database-timeline-manage-calendar]')).toBeNull();
    });
  });

  it('switches the layout from the settings panel', () => {
    const { tool, root } = mount();

    click('database-toolbar-settings');
    click('database-settings-layout');
    click('database-layout-list');

    expect(tool.save(root).views[0].type).toBe('list');
    expect(root.querySelector('[data-blok-database-list]')).not.toBeNull();
  });

  it('offers Gallery and Calendar as layouts, and their layout rows once picked', () => {
    const { tool, root } = mount({}, {}, { schema: [...schema, { id: 'p-due', name: 'Due', type: 'date', position: 'a3' }] });

    click('database-toolbar-settings');
    click('database-settings-layout');
    click('database-layout-gallery');
    expect(root.querySelector('[data-blok-database-gallery]')).not.toBeNull();

    click('database-gallery-card-size');
    click('database-gallery-card-size-large');
    expect(tool.save(root).views[0].cardSize).toBe('large');
    expect(root.querySelector('[data-blok-database-gallery]')?.getAttribute('data-card-size')).toBe('large');

    click('database-panel-back');
    click('database-gallery-fit-image');
    expect(tool.save(root).views[0].fitImage).toBe(true);

    click('database-layout-calendar');
    expect(root.querySelector('[data-blok-database-calendar]')).not.toBeNull();
    click('database-calendar-show-weekends');
    expect(tool.save(root).views[0].showWeekends).toBe(false);
    expect(q('database-gallery-card-size')).toBeNull();
    tool.destroy();
  });

  it('locks the database: views and properties stop changing, data entry goes on', () => {
    const { tool, root } = mount();

    click('database-toolbar-settings');
    click('database-settings-lock');

    const saved = tool.save(root);

    expect(saved.schema.find((p) => p.type === 'title')?.databaseLocked).toBe(true);

    tool.renameView('v1', 'Renamed');
    tool.addView('board');

    expect(tool.save(root).views.map((v) => v.name)).toEqual(['Table']);
    expect(q('database-toolbar-locked')?.hidden).toBe(false);
  });

  it('offers no new option in a locked table, so no cell can point at an option that was never saved', () => {
    const { root } = mount({}, {}, { schema: schema.map((p) => (p.type === 'title' ? { ...p, databaseLocked: true } : p)) });

    root.querySelector<HTMLElement>('[data-row-id="r3"] [data-property-id="p-stage"]')?.click();
    const search = document.querySelector<HTMLInputElement>('[data-blok-database-select-search]');

    expect(search).not.toBeNull();
    if (search === null) return;
    search.value = 'Brand new';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    expect(document.querySelector('[data-blok-database-select-create]')).toBeNull();
  });

  it('paints rows that match a color rule', () => {
    const { root } = mount({ colorRules: [{ id: 'c1', propertyId: 'p-num', operator: 'greater_than', value: 100, color: 'green' }] });

    expect(root.querySelector('[data-row-id="r1"]')?.getAttribute('data-blok-database-color')).toBe('green');
    expect(root.querySelector('[data-row-id="r2"]')?.hasAttribute('data-blok-database-color')).toBe(false);
  });

  it('paints feed cards that match a color rule (research/05 §6.2)', () => {
    const { root } = mount({ type: 'feed', colorRules: [{ id: 'c1', propertyId: 'p-num', operator: 'greater_than', value: 100, color: 'green' }] });

    expect(root.querySelector('[data-blok-database-feed-card][data-row-id="r1"]')?.getAttribute('data-blok-database-color')).toBe('green');
    expect(root.querySelector('[data-blok-database-feed-card][data-row-id="r2"]')?.hasAttribute('data-blok-database-color')).toBe(false);
  });

  it('paints one cell when the rule applies to its property', () => {
    const { root } = mount({ colorRules: [{ id: 'c1', propertyId: 'p-num', operator: 'is_not_empty', value: null, color: 'red', applyTo: 'property' }] });

    expect(root.querySelector('[data-row-id="r1"] [data-property-id="p-num"]')?.getAttribute('data-blok-database-color')).toBe('red');
    expect(root.querySelector('[data-row-id="r1"]')?.hasAttribute('data-blok-database-color')).toBe(false);
  });

  it.each(['locked', 'editStructure'] as const)(
    'does not save a group fold when %s denies view changes',
    (denial) => {
      const config: DatabaseConfig = denial === 'editStructure'
        ? { permissions: { can: (action) => action !== 'editStructure' } }
        : {};
      const extra: Partial<DatabaseData> = denial === 'locked'
        ? { schema: schema.map((property) => property.type === 'title'
          ? { ...property, databaseLocked: true } : property) }
        : {};
      const { tool, root, dispatchChange } = mount({ groupBy: 'p-stage' }, config, extra);
      const before = tool.save(root).views;
      const toggle = root.querySelector<HTMLElement>('[data-group-key="o-idea"] [data-blok-database-table-group-toggle]');

      if (toggle === null) throw new Error('missing group toggle');
      dispatchChange.mockClear();
      try {
        toggle.click();

        expect(tool.save(root).views).toEqual(before);
        expect(rowIds(root).sort()).toEqual(['r2', 'r3']);
        expect(dispatchChange).not.toHaveBeenCalled();
      } finally {
        tool.destroy();
      }
    }
  );

  it.each(['locked', 'editStructure'] as const)(
    'does not save the toggle-all shortcut when %s denies view changes',
    (denial) => {
      const config: DatabaseConfig = denial === 'editStructure'
        ? { permissions: { can: (action) => action !== 'editStructure' } }
        : {};
      const extra: Partial<DatabaseData> = denial === 'locked'
        ? { schema: schema.map((property) => property.type === 'title'
          ? { ...property, databaseLocked: true } : property) }
        : {};
      const { tool, root, dispatchChange } = mount({ groupBy: 'p-stage' }, config, extra);
      const before = tool.save(root).views;

      dispatchChange.mockClear();
      try {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          code: 'KeyT', key: '†', altKey: true, metaKey: true, ctrlKey: true, bubbles: true,
        }));

        expect(tool.save(root).views).toEqual(before);
        expect(dispatchChange).not.toHaveBeenCalled();
      } finally {
        tool.destroy();
      }
    }
  );

  it('expands an open database on the second Cmd/Ctrl+Alt+T while a locked one sits beside it', () => {
    const locked = mount({ groupBy: 'p-stage' }, {}, {
      schema: schema.map((property) => property.type === 'title' ? { ...property, databaseLocked: true } : property),
    });
    const open = mount({ groupBy: 'p-stage' });
    const press = (): void => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'KeyT', key: '†', altKey: true, metaKey: true, ctrlKey: true, bubbles: true,
      }));
    };

    try {
      press();
      press();

      expect(open.tool.save(open.root).views[0].collapsedGroups).toEqual([]);
    } finally {
      locked.tool.destroy();
      open.tool.destroy();
    }
  });

  it('keeps a collapsed group collapsed in the saved view', () => {
    const { tool, root } = mount({ groupBy: 'p-stage' });

    root.querySelector<HTMLElement>('[data-group-key="o-idea"] [data-blok-database-table-group-toggle]')?.click();

    expect(tool.save(root).views[0].collapsedGroups).toEqual([{ id: 'o-idea' }]);
  });

  it('leaves hidden groups out of a grouped table', () => {
    const { root } = mount({ groupBy: 'p-stage', hiddenGroups: [{ id: 'o-build' }] });

    expect(root.querySelector('[data-group-key="o-build"]')).toBeNull();
    expect(root.querySelector('[data-group-key="o-idea"]')).not.toBeNull();
  });

  it('groups a table by a number property', () => {
    const { root } = mount({ groupBy: 'p-num' });
    const keys = [...root.querySelectorAll('[data-blok-database-table-group]')].map((el) => el.getAttribute('data-group-key'));

    expect(keys).toEqual(['__blok-no-value-group__', '35', '1200']);
  });

  it('toggles every group on the page with Cmd/Ctrl+Alt+T', () => {
    const { tool, root } = mount({ groupBy: 'p-stage' });

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', key: '†', altKey: true, metaKey: true, ctrlKey: true, bubbles: true }));

    expect(tool.save(root).views[0].collapsedGroups?.map((group) => group.id).sort()).toEqual(['__blok-no-value-group__', 'o-build', 'o-idea']);

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', key: '†', altKey: true, metaKey: true, ctrlKey: true, bubbles: true }));

    expect(tool.save(root).views[0].collapsedGroups).toEqual([]);
    tool.destroy();
  });
});
