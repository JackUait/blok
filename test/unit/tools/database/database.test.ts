import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent } from '@testing-library/dom';
import type { API, BlockAPI, BlockToolConstructorOptions } from '../../../../types';
import type { DatabaseData, DatabaseConfig, DatabaseRowData, DatabaseViewConfig } from '../../../../src/tools/database/types';
import { DatabaseTool } from '../../../../src/tools/database';
import type { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { DatabaseModel } from '../../../../src/tools/database/database-model';
import type { CardDragResult, DatabaseCardDrag } from '../../../../src/tools/database/database-card-drag';
import type { GroupDragResult, DatabaseColumnDrag } from '../../../../src/tools/database/database-column-drag';

/**
 * Creates a mock child block (database-row) as returned by api.blocks.getChildren.
 */
const createMockRowBlock = (options: {
  id: string;
  properties: Record<string, unknown>;
  position: string;
}): BlockAPI => ({
  id: options.id,
  name: 'database-row',
  holder: document.createElement('div'),
  preservedData: { properties: options.properties, position: options.position } as DatabaseRowData,
  call: vi.fn(),
  dispatchChange: vi.fn(),
} as unknown as BlockAPI);

const createMockAPI = (childBlocks: BlockAPI[] = []): API => ({
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
    getChildren: vi.fn().mockReturnValue(childBlocks),
    insert: vi.fn().mockReturnValue({ id: 'new-row-id' }),
    delete: vi.fn(),
    setBlockParent: vi.fn(),
    getBlockIndex: vi.fn().mockReturnValue(0),
    getById: vi.fn(),
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
  views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [] }],
  activeViewId: 'view-1',
  ...overrides,
});

const createDatabaseOptions = (
  dataOverrides: Partial<DatabaseData> = {},
  config: DatabaseConfig = {},
  overrides: { readOnly?: boolean; childBlocks?: BlockAPI[] } = {},
): BlockToolConstructorOptions<DatabaseData, DatabaseConfig> => ({
  data: makeDefaultData(dataOverrides),
  config,
  api: createMockAPI(overrides.childBlocks ?? []),
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
    it('returns DatabaseData with schema, views, and activeViewId but no rows', () => {
      const tool = new DatabaseTool(createDatabaseOptions());

      tool.render();

      const saved = tool.save(document.createElement('div'));

      expect(saved).toHaveProperty('schema');
      expect(saved).toHaveProperty('views');
      expect(saved).toHaveProperty('activeViewId');
      expect(saved).not.toHaveProperty('rows');
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

    it('returns false when schema has more than one title property', () => {
      const tool = new DatabaseTool(createDatabaseOptions());

      expect(tool.validate(makeDefaultData({
        schema: [
          { id: 'p1', name: 'Title', type: 'title', position: 'a0' },
          { id: 'p2', name: 'Another Title', type: 'title', position: 'a1' },
          { id: 'p3', name: 'Status', type: 'select', position: 'a2' },
        ],
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
    it('preserves schema and views through cycle (rows are in child blocks)', () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' }, position: 'a0' }),
      ];

      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks }));

      tool.render();
      tool.rendered();

      const saved = tool.save(document.createElement('div'));

      expect(saved.views).toHaveLength(1);
      expect(saved.schema).toHaveLength(2);
      expect(saved.schema[0].type).toBe('title');
      // Rows are NOT in saved data — they live in child blocks
      expect(saved).not.toHaveProperty('rows');
    });
  });

  describe('add row via click', () => {
    it('clicking add-card button calls api.blocks.insert with database-row type', () => {
      const options = createDatabaseOptions();
      const tool = new DatabaseTool(options);
      const element = tool.render();

      const addCardBtn = element.querySelector('[data-blok-database-add-card]') as HTMLButtonElement;

      expect(addCardBtn).not.toBeNull();

      addCardBtn.click();

      expect(options.api.blocks.insert).toHaveBeenCalledTimes(1);
      const insertCall = (options.api.blocks.insert as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(insertCall[0]).toBe('database-row');
    });

    it('clicking add-card calls setBlockParent to parent row to database block', () => {
      const options = createDatabaseOptions();
      const tool = new DatabaseTool(options);
      const element = tool.render();

      const addCardBtn = element.querySelector('[data-blok-database-add-card]') as HTMLButtonElement;

      addCardBtn.click();

      expect(options.api.blocks.setBlockParent).toHaveBeenCalledTimes(1);
      const parentCall = (options.api.blocks.setBlockParent as ReturnType<typeof vi.fn>).mock.calls[0];

      // Second arg should be the database block id
      expect(parentCall[1]).toBe('test-block-id');
    });

    it('new row data has empty title property', () => {
      const options = createDatabaseOptions();
      const tool = new DatabaseTool(options);
      const element = tool.render();

      const addCardBtn = element.querySelector('[data-blok-database-add-card]') as HTMLButtonElement;

      addCardBtn.click();

      const insertCall = (options.api.blocks.insert as ReturnType<typeof vi.fn>).mock.calls[0];
      const insertedData = insertCall[1] as DatabaseRowData;

      expect(insertedData.properties['prop-title']).toBe('');
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
    it('clicking delete-card button calls api.blocks.delete', () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' }, position: 'a0' }),
      ];

      const options = createDatabaseOptions({}, {}, { childBlocks });

      (options.api.blocks.getBlockIndex as ReturnType<typeof vi.fn>).mockReturnValue(1);

      const tool = new DatabaseTool(options);
      const element = tool.render();
      tool.rendered();

      const deleteBtn = element.querySelector('[data-blok-database-delete-card]') as HTMLButtonElement;

      expect(deleteBtn).not.toBeNull();

      deleteBtn.click();

      expect(options.api.blocks.getBlockIndex).toHaveBeenCalledWith('row-1');
      expect(options.api.blocks.delete).toHaveBeenCalledWith(1);
    });
  });

  describe('column delete cascades block deletions for rows', () => {
    it('calls api.blocks.delete for each row then adapter.updateProperty when option is deleted', async () => {
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

      const childBlocks = [
        createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' }, position: 'a0' }),
        createMockRowBlock({ id: 'row-2', properties: { 'prop-title': 'Task 2', 'prop-status': 'opt-todo' }, position: 'a1' }),
      ];

      const options = createDatabaseOptions({}, { adapter: mockAdapter }, { childBlocks });

      // Make getBlockIndex return distinct indices for different row IDs
      let deleteCallCount = 0;

      (options.api.blocks.getBlockIndex as ReturnType<typeof vi.fn>).mockImplementation((blockId: string) => {
        if (blockId === 'row-1') return 1;
        if (blockId === 'row-2') return 2;
        return 0;
      });

      // After each delete, remove the block from the children array so syncRowsFromBlocks sees the update
      (options.api.blocks.delete as ReturnType<typeof vi.fn>).mockImplementation(() => {
        deleteCallCount++;
        // After deletion, the subsequent getChildren calls should return fewer blocks
        if (deleteCallCount >= 2) {
          (options.api.blocks.getChildren as ReturnType<typeof vi.fn>).mockReturnValue([]);
        } else {
          (options.api.blocks.getChildren as ReturnType<typeof vi.fn>).mockReturnValue([childBlocks[1]]);
        }
      });

      const tool = new DatabaseTool(options);
      const element = tool.render();
      tool.rendered();

      // Find the delete-column button for opt-todo (injected by DatabaseColumnControls.makeEditable)
      const deleteBtn = element.querySelector('[data-blok-database-delete-column][data-option-id="opt-todo"]') as HTMLButtonElement;

      expect(deleteBtn).not.toBeNull();

      deleteBtn.click();

      // api.blocks.delete should be called for each row in the column
      expect(options.api.blocks.delete).toHaveBeenCalledTimes(2);

      // Adapter deleteRow calls are async — wait for them to flush
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
          getChildren: vi.fn().mockReturnValue([]),
          insert: vi.fn(),
          delete: vi.fn(),
          setBlockParent: vi.fn(),
          getBlockIndex: vi.fn().mockReturnValue(0),
          getById: vi.fn(),
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
      const childBlocks = [
        createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' }, position: 'a0' }),
      ];

      const options = createDatabaseOptions({}, {}, { childBlocks });
      const tool = new DatabaseTool(options);
      const element = tool.render();
      tool.rendered();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cardDrag = (tool as any).cardDrag as DatabaseCardDrag;

      expect(cardDrag).not.toBeNull();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onDrop = (cardDrag as any).onDrop as (result: CardDragResult) => void;

      // Open the drawer on the card so we can observe its destruction
      const cardEl = element.querySelector('[data-row-id="row-1"]') as HTMLElement;
      cardEl.click();
      expect(element.querySelector('[data-blok-database-drawer]')).not.toBeNull();

      // Spy on the instance after creation (not on the prototype)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cardDrawer = (tool as any).cardDrawer as DatabaseCardDrawer;
      const drawerDestroySpy = vi.spyOn(cardDrawer, 'destroy');

      // After drop, update the child block so rerender picks up the new group
      (options.api.blocks.getChildren as ReturnType<typeof vi.fn>).mockReturnValue([
        createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-doing' }, position: 'a0' }),
      ]);

      // Trigger a card drop which calls handleRowDrop -> rerenderBoard
      onDrop({
        rowId: 'row-1',
        toOptionId: 'opt-doing',
        beforeRowId: null,
        afterRowId: null,
      });

      // cardDrawer.destroy() should have been called during rerenderBoard
      expect(drawerDestroySpy).toHaveBeenCalled();
      // After rerender, the old drawer element should be gone from the DOM
      expect(element.querySelector('[data-blok-database-drawer]')).toBeNull();

      tool.destroy();
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

    it('calls getChildren to sync rows from child blocks', () => {
      const options = createDatabaseOptions();
      const tool = new DatabaseTool(options);

      tool.render();
      tool.rendered();

      expect(options.api.blocks.getChildren).toHaveBeenCalledWith('test-block-id');
    });

    it('re-renders view in rendered() when child blocks appear after render()', () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' }, position: 'a0' }),
      ];

      // Start with no children (simulates render() running before child blocks exist)
      const options = createDatabaseOptions();
      const tool = new DatabaseTool(options);
      const element = tool.render();

      // Board should have no cards after render()
      expect(element.querySelectorAll('[data-blok-database-card]')).toHaveLength(0);

      // Now child blocks become available (simulates Renderer creating them after database block)
      (options.api.blocks.getChildren as ReturnType<typeof vi.fn>).mockReturnValue(childBlocks);
      tool.rendered();

      // Board should now show the card
      expect(element.querySelectorAll('[data-blok-database-card]')).toHaveLength(1);
    });

    it('projects child block data into model rows', () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' }, position: 'a0' }),
        createMockRowBlock({ id: 'row-2', properties: { 'prop-title': 'Task 2', 'prop-status': 'opt-doing' }, position: 'a1' }),
      ];

      const options = createDatabaseOptions({}, {}, { childBlocks });
      const tool = new DatabaseTool(options);

      tool.render();
      tool.rendered();

      // Access model to verify rows were projected
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = (tool as any).model as DatabaseModel;

      expect(model.getOrderedRows()).toHaveLength(2);
      expect(model.getRow('row-1')).toBeDefined();
      expect(model.getRow('row-2')).toBeDefined();
    });
  });

  describe('drawer title edits update row block via call()', () => {
    it('editing the title in the drawer calls block.call("updateProperties") on the row block', () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Original title', 'prop-status': 'opt-todo' }, position: 'a0' }),
      ];

      const options = createDatabaseOptions({}, {}, { childBlocks });
      const tool = new DatabaseTool(options);
      const element = tool.render();
      tool.rendered();

      // Click the card to open the drawer
      const cardEl = element.querySelector('[data-row-id="row-1"]') as HTMLElement;

      cardEl.click();

      // The drawer should be open with a title input
      const drawerTitle = element.querySelector('[data-blok-database-drawer-title]') as HTMLTextAreaElement;

      expect(drawerTitle).not.toBeNull();

      // Edit the title in the drawer
      drawerTitle.value = 'Updated title';
      fireEvent.input(drawerTitle);

      // The row block's call() should have been invoked with updateProperties
      expect(childBlocks[0].call).toHaveBeenCalledWith('updateProperties', { 'prop-title': 'Updated title' });
      expect(childBlocks[0].dispatchChange).toHaveBeenCalled();

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
      const childBlocks = [
        createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' }, position: 'a0' }),
      ];

      const options = createDatabaseOptions({}, {}, { childBlocks });
      const tool = new DatabaseTool(options);
      const element = tool.render();
      tool.rendered();

      // Mount to DOM so replaceChild works
      const container = document.createElement('div');

      container.appendChild(element);
      document.body.appendChild(container);

      // Set horizontal scroll on the board area
      const boardArea = element.querySelector('[data-blok-database-board]') as HTMLElement;

      boardArea.scrollLeft = 200;
      expect(boardArea.scrollLeft).toBe(200);

      // After drop, update child block so rerender picks up the new group
      (options.api.blocks.getChildren as ReturnType<typeof vi.fn>).mockReturnValue([
        createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-doing' }, position: 'a0' }),
      ]);

      // Trigger card drop (which calls handleRowDrop -> rerenderBoard)
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
      views: [{ id: 'view-list', name: 'List', type: 'list', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'view-list',
      ...overrides,
    });

    const makeListChildBlocks = (): BlockAPI[] => [
      createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task 1' }, position: 'a0' }),
      createMockRowBlock({ id: 'row-2', properties: { 'prop-title': 'Task 2' }, position: 'a1' }),
    ];

    it('renders a list view with [data-blok-database-list] when view type is list', () => {
      const tool = new DatabaseTool(createDatabaseOptions(makeListData(), {}, { childBlocks: makeListChildBlocks() }));
      const element = tool.render();
      tool.rendered();
      expect(element.querySelector('[data-blok-database-list]')).not.toBeNull();
      expect(element.querySelector('[data-blok-database-board]')).toBeNull();
    });

    it('renders list rows for each child block after rendered()', () => {
      const options = createDatabaseOptions(makeListData(), {}, { childBlocks: makeListChildBlocks() });
      const tool = new DatabaseTool(options);

      tool.render();
      tool.rendered();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = (tool as any).model as DatabaseModel;

      expect(model.getOrderedRows()).toHaveLength(2);
    });

    it('clicking add-row button calls api.blocks.insert with database-row', () => {
      const options = createDatabaseOptions(makeListData(), {}, { childBlocks: makeListChildBlocks() });
      const tool = new DatabaseTool(options);
      const element = tool.render();
      tool.rendered();
      const addBtn = element.querySelector('[data-blok-database-add-row]') as HTMLButtonElement;
      addBtn.click();
      expect(options.api.blocks.insert).toHaveBeenCalledTimes(1);
      const insertCall = (options.api.blocks.insert as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(insertCall[0]).toBe('database-row');
    });

    it('clicking delete-row button calls api.blocks.delete', () => {
      const childBlocks = makeListChildBlocks();
      const options = createDatabaseOptions(makeListData(), {}, { childBlocks });

      (options.api.blocks.getBlockIndex as ReturnType<typeof vi.fn>).mockReturnValue(1);

      const tool = new DatabaseTool(options);
      const element = tool.render();
      tool.rendered();
      const deleteBtn = element.querySelector('[data-blok-database-delete-row]') as HTMLButtonElement;
      deleteBtn.click();
      expect(options.api.blocks.delete).toHaveBeenCalledTimes(1);
    });

    it('clicking a list row opens the card drawer', () => {
      const options = createDatabaseOptions(makeListData(), {}, { childBlocks: makeListChildBlocks() });
      const tool = new DatabaseTool(options);
      const element = tool.render();
      tool.rendered();
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
      const childBlocks = [
        createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' }, position: 'a0' }),
      ];
      const data = makeListData({
        views: [{ id: 'view-list', name: 'List', type: 'list', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [] }],
      });
      const options = createDatabaseOptions(data, {}, { childBlocks });
      const tool = new DatabaseTool(options);
      const element = tool.render();
      tool.rendered();
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

    it('saves data in DatabaseData format with schema and views but no rows', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();
      const saved = tool.save(element);

      expect(saved.schema).toBeDefined();
      expect(saved).not.toHaveProperty('rows');
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
      // Rows are no longer in saved data — they would come from child blocks
      expect(saved).not.toHaveProperty('rows');

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

  describe('onAddProperty wiring in DatabaseTool', () => {
    it('model.addProperty is called with ("Property", type) when onAddProperty fires', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      tool.render();

      // Spy on the model instance (not the prototype)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = (tool as any).model as DatabaseModel;
      const addPropertySpy = vi.spyOn(model, 'addProperty').mockReturnValue({
        id: 'new-prop-id',
        name: 'Property',
        type: 'text',
        position: 'b0',
      });

      // Access private cardDrawer to get the constructed options
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cardDrawer = (tool as any).cardDrawer as DatabaseCardDrawer;

      expect(cardDrawer).not.toBeNull();

      // Access the onAddProperty callback stored in the drawer
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onAddProperty = (cardDrawer as any).onAddProperty as ((type: string) => void) | undefined;

      // If this is undefined, the callback was NOT wired — test fails (TDD red phase)
      expect(onAddProperty).toBeDefined();

      // Invoke the callback
      onAddProperty!('text');

      expect(addPropertySpy).toHaveBeenCalledWith('Property', 'text');

      tool.destroy();
    });

    it('sync.syncCreateProperty is called with correct params when onAddProperty fires', () => {
      const mockAdapter = {
        loadDatabase: vi.fn(),
        createRow: vi.fn(),
        updateRow: vi.fn(),
        moveRow: vi.fn(),
        deleteRow: vi.fn(),
        createProperty: vi.fn().mockResolvedValue(undefined),
        updateProperty: vi.fn(),
        deleteProperty: vi.fn(),
        createView: vi.fn(),
        updateView: vi.fn(),
        deleteView: vi.fn(),
      };

      const tool = new DatabaseTool(createDatabaseOptions({}, { adapter: mockAdapter }));
      tool.render();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cardDrawer = (tool as any).cardDrawer as DatabaseCardDrawer;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onAddProperty = (cardDrawer as any).onAddProperty as ((type: string) => void) | undefined;

      expect(onAddProperty).toBeDefined();

      onAddProperty!('text');

      expect(mockAdapter.createProperty).toHaveBeenCalledTimes(1);
      const callArg = mockAdapter.createProperty.mock.calls[0][0] as {
        id: string;
        name: string;
        type: string;
        position: string;
      };

      expect(callArg.name).toBe('Property');
      expect(callArg.type).toBe('text');
      expect(callArg.id).toBeDefined();
      expect(callArg.position).toBeDefined();

      tool.destroy();
    });

    it('cardDrawer.refreshSchema is called with updated schema after onAddProperty fires', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      tool.render();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cardDrawer = (tool as any).cardDrawer as DatabaseCardDrawer;
      // Spy on the instance (not the prototype)
      const refreshSchemaSpy = vi.spyOn(cardDrawer, 'refreshSchema');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onAddProperty = (cardDrawer as any).onAddProperty as ((type: string) => void) | undefined;

      expect(onAddProperty).toBeDefined();

      onAddProperty!('text');

      expect(refreshSchemaSpy).toHaveBeenCalledTimes(1);

      const calledWithSchema = refreshSchemaSpy.mock.calls[0][0] as Array<{ type: string }>;

      expect(calledWithSchema.some((p) => p.type === 'text')).toBe(true);

      tool.destroy();
    });
  });

  describe('ID persistence to backend', () => {
    it('passes client-generated row ID to api.blocks.insert', () => {
      const mockAdapter = {
        loadDatabase: vi.fn().mockResolvedValue({ schema: [], views: [] }),
        createRow: vi.fn().mockResolvedValue({ id: 'r1', position: 'a0', properties: {} }),
        updateRow: vi.fn(), moveRow: vi.fn(), deleteRow: vi.fn(),
        createProperty: vi.fn(), updateProperty: vi.fn(), deleteProperty: vi.fn(),
        createView: vi.fn().mockResolvedValue({ id: 'v1', name: 'V', type: 'board', position: 'a0', sorts: [], filters: [], visibleProperties: [] }),
        updateView: vi.fn(), deleteView: vi.fn(),
      };

      const options = createDatabaseOptions({}, { adapter: mockAdapter });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      // Add a row
      const addCardBtn = element.querySelector('[data-blok-database-add-card]') as HTMLButtonElement;

      addCardBtn.click();

      // Verify api.blocks.insert was called with a generated ID (7th arg)
      expect(options.api.blocks.insert).toHaveBeenCalledTimes(1);
      const insertCall = (options.api.blocks.insert as ReturnType<typeof vi.fn>).mock.calls[0];
      const rowId = insertCall[6] as string;

      expect(rowId).toBeDefined();
      expect(typeof rowId).toBe('string');
      expect(rowId.length).toBeGreaterThan(0);

      // Verify the same ID was passed to the adapter
      expect(mockAdapter.createRow).toHaveBeenCalledTimes(1);
      const createCall = mockAdapter.createRow.mock.calls[0][0];

      expect(createCall.id).toBe(rowId);

      tool.destroy();
    });

    it('preserves loaded data IDs through save/load cycle', () => {
      const customData: DatabaseData = {
        schema: [
          { id: 'stable-title', name: 'Title', type: 'title', position: 'a0' },
          { id: 'stable-status', name: 'Status', type: 'select', position: 'a1', config: {
            options: [
              { id: 'stable-opt-1', label: 'Todo', color: 'gray', position: 'a0' },
            ],
          }},
        ],
        views: [{ id: 'stable-view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'stable-status', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'stable-view-1',
      };

      const tool = new DatabaseTool(createDatabaseOptions(customData));

      tool.render();
      const saved = tool.save(document.createElement('div'));

      // Schema and view IDs must be exactly what was loaded
      expect(saved.schema[0].id).toBe('stable-title');
      expect(saved.schema[1].id).toBe('stable-status');
      expect(saved.schema[1].config?.options[0].id).toBe('stable-opt-1');
      // Rows are not in saved data — they live in child blocks
      expect(saved).not.toHaveProperty('rows');
      expect(saved.views[0].id).toBe('stable-view-1');
      expect(saved.activeViewId).toBe('stable-view-1');
    });
  });
});
