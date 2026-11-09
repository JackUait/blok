import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockAPI, BlockToolConstructorOptions } from '../../../../types';
import type { DatabaseConfig, DatabaseData, DatabaseRowData, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';
import { DatabaseTool } from '../../../../src/tools/database';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import { MutationHandler } from '../../../../src/components/block/mutation-handler';

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

/**
 * The view bar is chrome: its fold rewrites tabs and marks on every resize, so
 * it is mutation-free, and every view edit made from it reports its own change.
 */
describe('DatabaseTool — the view bar is chrome', () => {
  const twoViews = { views: [tableView(), tableView({ id: 'v2', name: 'Two', position: 'a1' })] };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    PopoverRegistry.resetForTests();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('writes in the view bar are not block changes', () => {
    const { root } = mount({}, {}, twoViews);
    const bar = root.querySelector<HTMLElement>('[data-blok-database-view-bar]');
    const tab = bar?.querySelector<HTMLElement>('[data-blok-database-tab]');

    if (bar === null || tab === null || tab === undefined) throw new Error('no view bar');
    const observer = new MutationObserver(() => undefined);

    observer.observe(root, { subtree: true, attributes: true, childList: true });
    tab.style.display = 'none';
    bar.setAttribute('data-blok-database-fold-icons', '');
    const records = observer.takeRecords();

    observer.disconnect();

    expect(new MutationHandler(() => root, null, () => undefined).handleMutation(records).shouldFireUpdate).toBe(false);
  });

  it('renaming a view reports a change', () => {
    const { tool, dispatchChange } = mount({}, {}, twoViews);

    dispatchChange.mockClear();
    tool.renameView('v2', 'Renamed');

    expect(dispatchChange).toHaveBeenCalled();
  });

  it('reordering a view reports a change', () => {
    const { tool, dispatchChange } = mount({}, {}, twoViews);

    dispatchChange.mockClear();
    tool.reorderView('v2', 'Z0');

    expect(dispatchChange).toHaveBeenCalled();
  });

  it('deleting a view that is not shown reports a change', () => {
    const { tool, dispatchChange } = mount({}, {}, twoViews);

    dispatchChange.mockClear();
    tool.deleteView('v2');

    expect(dispatchChange).toHaveBeenCalled();
  });
});
