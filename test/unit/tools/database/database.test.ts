import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { DatabaseData, DatabaseConfig, DatabaseViewConfig } from '../../../../src/tools/database/types';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDragResult, DatabaseCardDrag } from '../../../../src/tools/database/database-card-drag';
import type { GroupDragResult, DatabaseColumnDrag } from '../../../../src/tools/database/database-column-drag';

const createMockAPI = (): API => ({
  styles: {
    block: 'blok-block',
    inlineToolbar: 'blok-inline-toolbar',
    inlineToolButton: 'blok-inline-tool-button',
    inlineToolButtonActive: 'blok-inline-tool-button--active',
    input: 'blok-input',
    loader: 'blok-loader',
    button: 'blok-button',
    settingsButton: 'blok-settings-button',
    settingsButtonActive: 'blok-settings-button--active',
  },
  i18n: { t: (key: string) => key },
  events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  blocks: {
    getCurrentBlockIndex: vi.fn().mockReturnValue(0),
    getBlocksCount: vi.fn().mockReturnValue(1),
  },
  notifier: { show: vi.fn() },
  tools: { getBlockTools: vi.fn(() => []), getToolsConfig: vi.fn(() => ({ tools: undefined })) },
} as unknown as API);

const makeDefaultData = (overrides: Partial<DatabaseData> = {}): DatabaseData => ({
  schema: [
    { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
    { id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: {
      options: [
        { id: 'opt-todo', label: 'Todo', color: 'gray', position: 'a0' },
        { id: 'opt-doing', label: 'Doing', color: 'blue', position: 'a1' },
        { id: 'opt-done', label: 'Done', color: 'green', position: 'a2' },
      ],
    }},
  ],
  rows: {},
  views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [] }],
  activeViewId: 'view-1',
  ...overrides,
});

const createDatabaseOptions = (
  dataOverrides: Partial<DatabaseData> = {},
  config: DatabaseConfig = {},
  overrides: { readOnly?: boolean } = {},
): BlockToolConstructorOptions<DatabaseData, DatabaseConfig> => ({
  data: makeDefaultData(dataOverrides),
  config,
  api: createMockAPI(),
  readOnly: overrides.readOnly ?? false,
  block: { id: 'test-block-id' } as never,
});

describe('DatabaseTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('static getters', () => {
    it('toolbox returns array of 2 entries with database and board names', () => {
      const toolbox = DatabaseTool.toolbox;

      expect(Array.isArray(toolbox)).toBe(true);

      const entries = toolbox as Array<{ name: string; title: string; titleKey: string; searchTerms: string[] }>;

      expect(entries).toHaveLength(2);
      expect(entries[0].name).toBe('database');
      expect(entries[1].name).toBe('board');
      expect(entries[0].titleKey).toBeDefined();
      expect(entries[1].titleKey).toBeDefined();
      expect(entries[0].searchTerms).toBeDefined();
      expect(entries[1].searchTerms).toBeDefined();
    });

    it('toolbox entries include title field', () => {
      const toolbox = DatabaseTool.toolbox;

      const entries = toolbox as Array<{ title: string }>;

      expect(entries[0].title).toBe('Database');
      expect(entries[1].title).toBe('Board');
    });

    it('database toolbox entry includes cards and columns in searchTerms', () => {
      const toolbox = DatabaseTool.toolbox;

      const entries = toolbox as Array<{ searchTerms: string[] }>;

      expect(entries[0].searchTerms).toContain('cards');
      expect(entries[0].searchTerms).toContain('columns');
      expect(entries[1].searchTerms).toContain('cards');
      expect(entries[1].searchTerms).toContain('columns');
    });

    it('isReadOnlySupported returns true', () => {
      expect(DatabaseTool.isReadOnlySupported).toBe(true);
    });
  });

  describe('render()', () => {
    it('returns HTMLDivElement with data-blok-tool="database"', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();

      expect(element).toBeInstanceOf(HTMLDivElement);
      expect(element.getAttribute('data-blok-tool')).toBe('database');
    });

    it('renders 3 columns for default data with 3 select options', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();
      const columns = element.querySelectorAll('[data-blok-database-column]');

      expect(columns).toHaveLength(3);
    });
  });

  describe('save()', () => {
    it('returns DatabaseData with schema, rows, views, and activeViewId', () => {
      const tool = new DatabaseTool(createDatabaseOptions());

      tool.render();

      const saved = tool.save(document.createElement('div'));

      expect(saved).toHaveProperty('schema');
      expect(saved).toHaveProperty('rows');
      expect(saved).toHaveProperty('views');
      expect(saved).toHaveProperty('activeViewId');
      expect(Array.isArray(saved.schema)).toBe(true);
      expect(saved.schema.length).toBeGreaterThan(0);
      expect(Array.isArray(saved.views)).toBe(true);
      expect(saved.views.length).toBeGreaterThan(0);
    });
  });

  describe('validate()', () => {
    it('returns true for valid data with title prop and board view with groupBy', () => {
      const tool = new DatabaseTool(createDatabaseOptions());

      expect(tool.validate(makeDefaultData())).toBe(true);
    });

    it('returns false when views array is empty', () => {
      const tool = new DatabaseTool(createDatabaseOptions());

      expect(tool.validate(makeDefaultData({ views: [] }))).toBe(false);
    });

    it('returns false when schema has no title property', () => {
      const tool = new DatabaseTool(createDatabaseOptions());

      expect(tool.validate(makeDefaultData({
        schema: [{ id: 'p1', name: 'Status', type: 'select', position: 'a0' }],
      }))).toBe(false);
    });

    it('returns false when a board view has no groupBy', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const viewWithoutGroupBy: DatabaseViewConfig = {
        id: 'v1', name: 'Board', type: 'board', position: 'a0',
        sorts: [], filters: [], visibleProperties: [],
      };

      expect(tool.validate(makeDefaultData({ views: [viewWithoutGroupBy] }))).toBe(false);
    });
  });

  describe('render -> save roundtrip', () => {
    it('preserves data through cycle', () => {
      const rows = {
        'row-1': { id: 'row-1', position: 'a0', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' } },
      };

      const tool = new DatabaseTool(createDatabaseOptions({ rows }));

      tool.render();

      const saved = tool.save(document.createElement('div'));

      expect(saved.views).toHaveLength(1);
      expect(saved.schema).toHaveLength(2);
      expect(saved.schema[0].type).toBe('title');
      expect(saved.rows['row-1']).toBeDefined();
      expect(saved.rows['row-1'].properties['prop-title']).toBe('Task 1');
    });
  });

  describe('add row via click', () => {
    it('clicking add-card button adds row to model and DOM', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();

      const addCardBtn = element.querySelector('[data-blok-database-add-card]') as HTMLButtonElement;

      expect(addCardBtn).not.toBeNull();

      addCardBtn.click();

      // Card should appear in DOM
      const cards = element.querySelectorAll('[data-blok-database-card]');

      expect(cards).toHaveLength(1);

      // Row should appear in model via save()
      const saved = tool.save(document.createElement('div'));

      expect(Object.keys(saved.rows).length).toBe(1);
    });

    it('new row has empty title so placeholder shows', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();

      const addCardBtn = element.querySelector('[data-blok-database-add-card]') as HTMLButtonElement;

      addCardBtn.click();

      const saved = tool.save(element);
      const row = Object.values(saved.rows)[0];

      expect(row.properties['prop-title']).toBe('');
    });
  });

  describe('add column via click', () => {
    it('clicking add-column button adds column to model and DOM', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();

      const initialColumns = element.querySelectorAll('[data-blok-database-column]');

      expect(initialColumns).toHaveLength(3);

      const addColBtn = element.querySelector('[data-blok-database-add-column]') as HTMLButtonElement;

      expect(addColBtn).not.toBeNull();

      addColBtn.click();

      const columns = element.querySelectorAll('[data-blok-database-column]');

      expect(columns).toHaveLength(4);

      const saved = tool.save(document.createElement('div'));
      const statusProp = saved.schema.find((p) => p.type === 'select');

      expect(statusProp?.config?.options).toHaveLength(4);
    });
  });

  describe('delete row via click', () => {
    it('clicking delete-card button removes card from DOM and model', () => {
      const rows = {
        'row-1': { id: 'row-1', position: 'a0', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' } },
      };

      const tool = new DatabaseTool(createDatabaseOptions({ rows }));
      const element = tool.render();

      const deleteBtn = element.querySelector('[data-blok-database-delete-card]') as HTMLButtonElement;

      expect(deleteBtn).not.toBeNull();

      deleteBtn.click();

      const cards = element.querySelectorAll('[data-blok-database-card]');

      expect(cards).toHaveLength(0);

      const saved = tool.save(document.createElement('div'));

      expect(Object.keys(saved.rows)).toHaveLength(0);
    });
  });

  describe('column delete cascades adapter calls for rows', () => {
    it('calls adapter.deleteRow for each row then adapter.updateProperty when option is deleted', async () => {
      const deleteRowCalls: string[] = [];
      const updatePropertyCalls: Array<{ propertyId: string }> = [];

      const mockAdapter = {
        loadDatabase: vi.fn(),
        createRow: vi.fn(),
        updateRow: vi.fn(),
        moveRow: vi.fn(),
        deleteRow: vi.fn(async (params: { rowId: string }) => {
          deleteRowCalls.push(params.rowId);
        }),
        createProperty: vi.fn(),
        updateProperty: vi.fn(async (params: { propertyId: string }) => {
          updatePropertyCalls.push(params);
          return {} as never;
        }),
        deleteProperty: vi.fn(),
        createView: vi.fn(),
        updateView: vi.fn(),
        deleteView: vi.fn(),
      };

      const rows = {
        'row-1': { id: 'row-1', position: 'a0', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' } },
        'row-2': { id: 'row-2', position: 'a1', properties: { 'prop-title': 'Task 2', 'prop-status': 'opt-todo' } },
      };

      const options = createDatabaseOptions({ rows }, { adapter: mockAdapter });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      // Find the delete-column button for opt-todo (injected by DatabaseColumnControls.makeEditable)
      const deleteBtn = element.querySelector('[data-blok-database-delete-column][data-option-id="opt-todo"]') as HTMLButtonElement;

      expect(deleteBtn).not.toBeNull();

      deleteBtn.click();

      // Adapter calls are async — wait for them to flush
      await vi.waitFor(() => {
        expect(deleteRowCalls).toHaveLength(2);
      });

      expect(deleteRowCalls).toContain('row-1');
      expect(deleteRowCalls).toContain('row-2');
      expect(updatePropertyCalls.length).toBeGreaterThan(0);
      expect(updatePropertyCalls[0].propertyId).toBe('prop-status');

      // Column should be removed from DOM
      const remainingColumns = element.querySelectorAll('[data-blok-database-column]');

      expect(remainingColumns).toHaveLength(2);

      tool.destroy();
    });
  });

  describe('add column uses correct i18n key', () => {
    it('clicking add-column button uses columnTitlePlaceholder i18n key', () => {
      const mockI18n = vi.fn((key: string) => key);
      const mockApi = {
        styles: {
          block: 'blok-block',
          inlineToolbar: 'blok-inline-toolbar',
          inlineToolButton: 'blok-inline-tool-button',
          inlineToolButtonActive: 'blok-inline-tool-button--active',
          input: 'blok-input',
          loader: 'blok-loader',
          button: 'blok-button',
          settingsButton: 'blok-settings-button',
          settingsButtonActive: 'blok-settings-button--active',
        },
        i18n: { t: mockI18n },
        events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
        blocks: {
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          getBlocksCount: vi.fn().mockReturnValue(1),
        },
        notifier: { show: vi.fn() },
        tools: { getBlockTools: vi.fn(() => []), getToolsConfig: vi.fn(() => ({ tools: undefined })) },
      } as unknown as API;

      const options: BlockToolConstructorOptions<DatabaseData, DatabaseConfig> = {
        data: makeDefaultData(),
        config: {},
        api: mockApi,
        readOnly: false,
        block: { id: 'test-block-id' } as never,
      };

      const tool = new DatabaseTool(options);
      const element = tool.render();

      mockI18n.mockClear();

      const addColBtn = element.querySelector('[data-blok-database-add-column]') as HTMLButtonElement;

      addColBtn.click();

      expect(mockI18n).toHaveBeenCalledWith('tools.database.columnTitlePlaceholder');
    });
  });

  describe('destroy()', () => {
    it('does not throw', () => {
      const tool = new DatabaseTool(createDatabaseOptions());

      tool.render();

      expect(() => tool.destroy()).not.toThrow();
    });
  });

  describe('rerenderBoard destroys cardDrawer subsystem', () => {
    it('destroys cardDrawer when rerender is triggered by card drop', () => {
      const rows = {
        'row-1': { id: 'row-1', position: 'a0', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' } },
      };

      // Spy on DatabaseCardDrawer.prototype.destroy to detect if it's called during rerender
      const drawerDestroySpy = vi.spyOn(DatabaseCardDrawer.prototype, 'destroy');

      const tool = new DatabaseTool(createDatabaseOptions({ rows }));

      tool.render();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cardDrag = (tool as any).cardDrag as DatabaseCardDrag;

      expect(cardDrag).not.toBeNull();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onDrop = (cardDrag as any).onDrop as (result: CardDragResult) => void;

      // Reset spy call count — destroy may have been called during setup
      drawerDestroySpy.mockClear();

      // Trigger a card drop which calls handleRowDrop -> rerenderBoard
      onDrop({
        rowId: 'row-1',
        toOptionId: 'opt-doing',
        beforeRowId: null,
        afterRowId: null,
      });

      // cardDrawer.destroy() should have been called during rerenderBoard
      expect(drawerDestroySpy).toHaveBeenCalled();

      tool.destroy();
      drawerDestroySpy.mockRestore();
    });
  });

  describe('rendered()', () => {
    it('sets block stretched to true', () => {
      const mockBlock = { id: 'test-block-id', stretched: false };
      const options = createDatabaseOptions();

      options.block = mockBlock as never;

      const tool = new DatabaseTool(options);

      tool.render();
      tool.rendered();

      expect(mockBlock.stretched).toBe(true);
    });
  });

  describe('drawer title edits update board card', () => {
    it('editing the title in the drawer updates the card title on the board', () => {
      const rows = {
        'row-1': { id: 'row-1', position: 'a0', properties: { 'prop-title': 'Original title', 'prop-status': 'opt-todo' } },
      };

      const tool = new DatabaseTool(createDatabaseOptions({ rows }));
      const element = tool.render();

      // Click the card to open the drawer
      const cardEl = element.querySelector('[data-row-id="row-1"]') as HTMLElement;

      cardEl.click();

      // The drawer should be open with a title input
      const drawerTitle = element.querySelector('[data-blok-database-drawer-title]') as HTMLTextAreaElement;

      expect(drawerTitle).not.toBeNull();

      // Edit the title in the drawer
      drawerTitle.value = 'Updated title';
      drawerTitle.dispatchEvent(new Event('input', { bubbles: true }));

      // The card on the board should reflect the new title
      const boardCardTitle = element.querySelector('[data-row-id="row-1"] [data-blok-database-card-title]');

      expect(boardCardTitle?.textContent).toBe('Updated title');

      tool.destroy();
    });
  });

  describe('rerenderBoard preserves scroll position', () => {
    let scrollLeftStore: WeakMap<Element, number>;
    let origScrollLeftDesc: PropertyDescriptor;

    beforeEach(() => {
      scrollLeftStore = new WeakMap();
      origScrollLeftDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft')!;

      Object.defineProperty(Element.prototype, 'scrollLeft', {
        get(this: Element) { return scrollLeftStore.get(this) ?? 0; },
        set(this: Element, v: number) { scrollLeftStore.set(this, v); },
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(Element.prototype, 'scrollLeft', origScrollLeftDesc);
    });

    it('preserves board horizontal scroll position after card drop', () => {
      const rows = {
        'row-1': { id: 'row-1', position: 'a0', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' } },
      };

      const tool = new DatabaseTool(createDatabaseOptions({ rows }));
      const element = tool.render();

      // Mount to DOM so replaceChild works
      const container = document.createElement('div');

      container.appendChild(element);
      document.body.appendChild(container);

      // Set horizontal scroll on the board area
      const boardArea = element.querySelector('[data-blok-database-board]') as HTMLElement;

      boardArea.scrollLeft = 200;
      expect(boardArea.scrollLeft).toBe(200);

      // Trigger card drop (which calls rerenderBoard)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cardDrag = (tool as any).cardDrag as DatabaseCardDrag;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onDrop = (cardDrag as any).onDrop as (result: CardDragResult) => void;

      onDrop({
        rowId: 'row-1',
        toOptionId: 'opt-doing',
        beforeRowId: null,
        afterRowId: null,
      });

      // After rerender, the new board area should have the scroll position restored
      const newBoardArea = element.querySelector('[data-blok-database-board]') as HTMLElement;

      expect(newBoardArea.scrollLeft).toBe(200);

      tool.destroy();
      document.body.removeChild(container);
    });

    it('preserves board horizontal scroll position after column drop', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();

      const container = document.createElement('div');

      container.appendChild(element);
      document.body.appendChild(container);

      const boardArea = element.querySelector('[data-blok-database-board]') as HTMLElement;

      boardArea.scrollLeft = 150;

      // Trigger column drop via private columnDrag.onDrop
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const columnDrag = (tool as any).columnDrag as DatabaseColumnDrag;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onDrop = (columnDrag as any).onDrop as (result: GroupDragResult) => void;

      onDrop({
        optionId: 'opt-todo',
        beforeOptionId: null,
        afterOptionId: 'opt-done',
      });

      const newBoardArea = element.querySelector('[data-blok-database-board]') as HTMLElement;

      expect(newBoardArea.scrollLeft).toBe(150);

      tool.destroy();
      document.body.removeChild(container);
    });
  });

  describe('handleColumnRecolor is not defined as a method', () => {
    it('does not have handleColumnRecolor method', () => {
      const tool = new DatabaseTool(createDatabaseOptions());

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((tool as any).handleColumnRecolor).toBeUndefined();
    });
  });

  describe('list view', () => {
    const makeListData = (overrides: Partial<DatabaseData> = {}): DatabaseData => ({
      schema: [
        { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
        { id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: {
          options: [
            { id: 'opt-todo', label: 'Todo', color: 'gray', position: 'a0' },
            { id: 'opt-done', label: 'Done', color: 'green', position: 'a1' },
          ],
        }},
      ],
      rows: {
        'row-1': { id: 'row-1', position: 'a0', properties: { 'prop-title': 'Task 1' } },
        'row-2': { id: 'row-2', position: 'a1', properties: { 'prop-title': 'Task 2' } },
      },
      views: [{ id: 'view-list', name: 'List', type: 'list', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'view-list',
      ...overrides,
    });

    it('renders a list view with [data-blok-database-list] when view type is list', () => {
      const tool = new DatabaseTool(createDatabaseOptions(makeListData()));
      const element = tool.render();
      expect(element.querySelector('[data-blok-database-list]')).not.toBeNull();
      expect(element.querySelector('[data-blok-database-board]')).toBeNull();
    });

    it('renders list rows for each data row', () => {
      const tool = new DatabaseTool(createDatabaseOptions(makeListData()));
      const element = tool.render();
      expect(element.querySelectorAll('[data-blok-database-list-row]')).toHaveLength(2);
    });

    it('clicking add-row button adds a row to the list', () => {
      const tool = new DatabaseTool(createDatabaseOptions(makeListData()));
      const element = tool.render();
      const addBtn = element.querySelector('[data-blok-database-add-row]') as HTMLButtonElement;
      addBtn.click();
      const saved = tool.save(document.createElement('div'));
      expect(Object.keys(saved.rows)).toHaveLength(3);
    });

    it('clicking delete-row button removes a row', () => {
      const tool = new DatabaseTool(createDatabaseOptions(makeListData()));
      const element = tool.render();
      const deleteBtn = element.querySelector('[data-blok-database-delete-row]') as HTMLButtonElement;
      deleteBtn.click();
      expect(element.querySelectorAll('[data-blok-database-list-row]')).toHaveLength(1);
    });

    it('clicking a list row opens the card drawer', () => {
      const tool = new DatabaseTool(createDatabaseOptions(makeListData()));
      const element = tool.render();
      const row = element.querySelector('[data-blok-database-list-row]') as HTMLElement;
      row.click();
      expect(element.querySelector('[data-blok-database-drawer]')).not.toBeNull();
    });

    it('validates list view without groupBy', () => {
      const tool = new DatabaseTool(createDatabaseOptions(makeListData()));
      expect(tool.validate(makeListData())).toBe(true);
    });

    it('switches from board to list view', () => {
      const data: DatabaseData = {
        ...makeDefaultData(),
        views: [
          { id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [] },
          { id: 'view-2', name: 'List', type: 'list', position: 'a1', sorts: [], filters: [], visibleProperties: [] },
        ],
        activeViewId: 'view-1',
      };
      const tool = new DatabaseTool(createDatabaseOptions(data));
      const element = tool.render();
      expect(element.querySelector('[data-blok-database-board]')).not.toBeNull();
      const tab2 = element.querySelector('[data-view-id="view-2"]') as HTMLElement;
      tab2.click();
      expect(element.querySelector('[data-blok-database-list]')).not.toBeNull();
      expect(element.querySelector('[data-blok-database-board]')).toBeNull();
    });

    it('renders grouped list when view has groupBy', () => {
      const data = makeListData({
        views: [{ id: 'view-list', name: 'List', type: 'list', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [] }],
        rows: {
          'row-1': { id: 'row-1', position: 'a0', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' } },
        },
      });
      const tool = new DatabaseTool(createDatabaseOptions(data));
      const element = tool.render();
      expect(element.querySelectorAll('[data-blok-database-list-group]')).toHaveLength(2);
    });
  });

  describe('multi-view orchestration', () => {
    it('renders a tab bar above the board', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();

      expect(element.querySelector('[data-blok-database-tab-bar]')).not.toBeNull();
    });

    it('renders one tab for the default view', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();

      expect(element.querySelectorAll('[data-blok-database-tab]')).toHaveLength(1);
    });

    it('renders the board area below the tab bar', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();

      expect(element.querySelector('[data-blok-database-board]')).not.toBeNull();
    });

    it('saves data in DatabaseData format with schema, rows, views', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();
      const saved = tool.save(element);

      expect(saved.schema).toBeDefined();
      expect(saved.rows).toBeDefined();
      expect(saved.views).toBeDefined();
      expect(Array.isArray(saved.views)).toBe(true);
      expect(saved.views.length).toBeGreaterThan(0);
      expect(saved.activeViewId).toBeDefined();
    });

    it('validates correctly', () => {
      const tool = new DatabaseTool(createDatabaseOptions());

      expect(tool.validate(makeDefaultData({ views: [] }))).toBe(false);
      expect(tool.validate(makeDefaultData())).toBe(true);
    });

    it('switches board content when a different tab is clicked', () => {
      const view2: DatabaseViewConfig = {
        id: 'view-2',
        name: 'Board 2',
        type: 'board',
        position: 'a1',
        groupBy: 'prop-status',
        sorts: [],
        filters: [],
        visibleProperties: [],
      };

      const tool = new DatabaseTool(createDatabaseOptions({
        views: [
          { id: 'view-1', name: 'Board 1', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [] },
          view2,
        ],
        activeViewId: 'view-1',
      }));
      const element = tool.render();

      // Verify tab bar has 2 tabs
      expect(element.querySelectorAll('[data-blok-database-tab]')).toHaveLength(2);

      // Click the second tab
      const tab2 = element.querySelector('[data-view-id="view-2"]') as HTMLElement;

      tab2.click();

      // After click, the board should still be rendered (same data, different view)
      expect(element.querySelector('[data-blok-database-board]')).not.toBeNull();
    });

    it('does not render a tab bar in read-only mode', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: true }));
      const element = tool.render();

      expect(element.querySelector('[data-blok-database-tab-bar]')).toBeNull();
    });
  });

  describe('loadDatabase integration', () => {
    it('calls adapter.loadDatabase on rendered() and hydrates model', async () => {
      const mockAdapter = {
        loadDatabase: vi.fn().mockResolvedValue({
          schema: [
            { id: 'p-backend', name: 'Backend Title', type: 'title', position: 'a0' },
          ],
          rows: {
            'r-backend': { id: 'r-backend', position: 'a0', properties: { 'p-backend': 'From Backend' } },
          },
          views: [{
            id: 'v-backend', name: 'Backend Board', type: 'board', position: 'a0',
            groupBy: undefined, sorts: [], filters: [], visibleProperties: [],
          }],
        }),
        createRow: vi.fn(), updateRow: vi.fn(), moveRow: vi.fn(), deleteRow: vi.fn(),
        createProperty: vi.fn(), updateProperty: vi.fn(), deleteProperty: vi.fn(),
        createView: vi.fn(), updateView: vi.fn(), deleteView: vi.fn(),
      };

      const tool = new DatabaseTool(createDatabaseOptions({}, { adapter: mockAdapter }));
      const element = tool.render();
      const container = document.createElement('div');

      container.appendChild(element);
      document.body.appendChild(container);

      tool.rendered();

      await vi.waitFor(() => {
        const saved = tool.save(document.createElement('div'));

        expect(saved.schema[0].id).toBe('p-backend');
      });

      const saved = tool.save(document.createElement('div'));

      expect(saved.schema[0].id).toBe('p-backend');
      expect(saved.rows['r-backend']).toBeDefined();

      tool.destroy();
      document.body.removeChild(container);
    });

    it('does not call loadDatabase when no adapter is configured', () => {
      const tool = new DatabaseTool(createDatabaseOptions());

      tool.render();
      tool.rendered();

      const saved = tool.save(document.createElement('div'));

      expect(saved.schema.length).toBeGreaterThan(0);
    });
  });

  describe('reorderView syncs to backend', () => {
    it('calls adapter.updateView with viewId and position change', () => {
      const updateViewCalls: Array<{ viewId: string; changes: Record<string, unknown> }> = [];

      const mockAdapter = {
        loadDatabase: vi.fn(),
        createRow: vi.fn(),
        updateRow: vi.fn(),
        moveRow: vi.fn(),
        deleteRow: vi.fn(),
        createProperty: vi.fn(),
        updateProperty: vi.fn(),
        deleteProperty: vi.fn(),
        createView: vi.fn(),
        updateView: vi.fn(async (params: { viewId: string; changes: Record<string, unknown> }) => {
          updateViewCalls.push(params);

          return {} as never;
        }),
        deleteView: vi.fn(),
      };

      const options = createDatabaseOptions(
        {
          views: [
            { id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [] },
            { id: 'view-2', name: 'Board 2', type: 'board', position: 'a1', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [] },
          ],
          activeViewId: 'view-1',
        },
        { adapter: mockAdapter },
      );
      const tool = new DatabaseTool(options);

      tool.render();

      (tool as unknown as { reorderView(viewId: string, newPosition: string): void }).reorderView('view-2', 'Zz');

      expect(updateViewCalls).toHaveLength(1);
      expect(updateViewCalls[0].viewId).toBe('view-2');
      expect(updateViewCalls[0].changes).toEqual({ position: 'Zz' });

      tool.destroy();
    });
  });
});
