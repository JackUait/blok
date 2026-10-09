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

  it('switches the layout from the settings panel', () => {
    const { tool, root } = mount();

    click('database-toolbar-settings');
    click('database-settings-layout');
    click('database-layout-list');

    expect(tool.save(root).views[0].type).toBe('list');
    expect(root.querySelector('[data-blok-database-list]')).not.toBeNull();
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

  it('paints rows that match a color rule', () => {
    const { root } = mount({ colorRules: [{ id: 'c1', propertyId: 'p-num', operator: 'greater_than', value: 100, color: 'green' }] });

    expect(root.querySelector('[data-row-id="r1"]')?.getAttribute('data-blok-database-color')).toBe('green');
    expect(root.querySelector('[data-row-id="r2"]')?.hasAttribute('data-blok-database-color')).toBe(false);
  });

  it('paints one cell when the rule applies to its property', () => {
    const { root } = mount({ colorRules: [{ id: 'c1', propertyId: 'p-num', operator: 'is_not_empty', value: null, color: 'red', applyTo: 'property' }] });

    expect(root.querySelector('[data-row-id="r1"] [data-property-id="p-num"]')?.getAttribute('data-blok-database-color')).toBe('red');
    expect(root.querySelector('[data-row-id="r1"]')?.hasAttribute('data-blok-database-color')).toBe(false);
  });

  it('keeps a collapsed group collapsed in the saved view', () => {
    const { tool, root } = mount({ groupBy: 'p-stage' });

    root.querySelector<HTMLElement>('[data-group-key="o-idea"] [data-blok-database-table-group-toggle]')?.click();

    expect(tool.save(root).views[0].groupStates).toEqual([{ id: 'o-idea', collapsed: true }]);
  });

  it('leaves hidden groups out of a grouped table', () => {
    const { root } = mount({ groupBy: 'p-stage', groupStates: [{ id: 'o-build', hidden: true }] });

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

    expect(tool.save(root).views[0].groupStates?.every((state) => state.collapsed === true)).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', key: '†', altKey: true, metaKey: true, ctrlKey: true, bubbles: true }));

    expect(tool.save(root).views[0].groupStates?.every((state) => state.collapsed === false)).toBe(true);
    tool.destroy();
  });
});
