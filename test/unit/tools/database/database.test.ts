import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { KanbanData, DatabaseConfig } from '../../../../src/tools/database/types';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDragResult, DatabaseCardDrag } from '../../../../src/tools/database/database-card-drag';
import type { ColumnDragResult, DatabaseColumnDrag } from '../../../../src/tools/database/database-column-drag';

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

const createDatabaseOptions = (
  data: Partial<KanbanData> = {},
  config: DatabaseConfig = {},
  overrides: { readOnly?: boolean } = {},
): BlockToolConstructorOptions<KanbanData, DatabaseConfig> => ({
  data: { columns: [], cardMap: {}, ...data } as KanbanData,
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

    it('renders default 3 columns for empty data', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();
      const columns = element.querySelectorAll('[data-blok-database-column]');

      expect(columns).toHaveLength(3);
    });
  });

  describe('save()', () => {
    it('returns KanbanData with columns and cardMap properties', () => {
      const tool = new DatabaseTool(createDatabaseOptions());

      tool.render();

      const saved = tool.save(document.createElement('div'));

      expect(saved).toHaveProperty('columns');
      expect(saved).toHaveProperty('cardMap');
      expect(Array.isArray(saved.columns)).toBe(true);
      expect(typeof saved.cardMap).toBe('object');
    });
  });

  describe('validate()', () => {
    it('returns true when columns is non-empty', () => {
      const tool = new DatabaseTool(createDatabaseOptions());

      expect(tool.validate({ columns: [{ id: '1', title: 'A', position: 'a0' }], cardMap: {} })).toBe(true);
    });

    it('returns false when columns is empty', () => {
      const tool = new DatabaseTool(createDatabaseOptions());

      expect(tool.validate({ columns: [], cardMap: {} })).toBe(false);
    });
  });

  describe('render -> save roundtrip', () => {
    it('preserves data through cycle', () => {
      const initialData: KanbanData = {
        columns: [
          { id: 'col-1', title: 'Todo', position: 'a0' },
          { id: 'col-2', title: 'Done', position: 'a1' },
        ],
        cardMap: {
          'card-1': { id: 'card-1', columnId: 'col-1', position: 'a0', title: 'Task 1' },
        },
      };

      const tool = new DatabaseTool(createDatabaseOptions(initialData));

      tool.render();

      const saved = tool.save(document.createElement('div'));

      expect(saved.columns).toHaveLength(2);
      expect(saved.columns[0].title).toBe('Todo');
      expect(saved.columns[1].title).toBe('Done');
      expect(Object.keys(saved.cardMap)).toHaveLength(1);
      expect(saved.cardMap['card-1'].title).toBe('Task 1');
    });
  });

  describe('add card via click', () => {
    it('clicking add-card button adds card to model and DOM', () => {
      const initialData: KanbanData = {
        columns: [
          { id: 'col-1', title: 'Todo', position: 'a0' },
        ],
        cardMap: {},
      };

      const tool = new DatabaseTool(createDatabaseOptions(initialData));
      const element = tool.render();

      const addCardBtn = element.querySelector('[data-blok-database-add-card]') as HTMLButtonElement;

      expect(addCardBtn).not.toBeNull();

      addCardBtn.click();

      // Card should appear in DOM
      const cards = element.querySelectorAll('[data-blok-database-card]');

      expect(cards).toHaveLength(1);

      // Card should appear in model via save()
      const saved = tool.save(document.createElement('div'));

      expect(Object.keys(saved.cardMap)).toHaveLength(1);
    });
  });

  describe('add column via click', () => {
    it('clicking add-column button adds column to model and DOM', () => {
      const initialData: KanbanData = {
        columns: [
          { id: 'col-1', title: 'Todo', position: 'a0' },
        ],
        cardMap: {},
      };

      const tool = new DatabaseTool(createDatabaseOptions(initialData));
      const element = tool.render();

      const addColBtn = element.querySelector('[data-blok-database-add-column]') as HTMLButtonElement;

      expect(addColBtn).not.toBeNull();

      addColBtn.click();

      const columns = element.querySelectorAll('[data-blok-database-column]');

      expect(columns).toHaveLength(2);

      const saved = tool.save(document.createElement('div'));

      expect(saved.columns).toHaveLength(2);
    });
  });

  describe('delete card via click', () => {
    it('clicking delete-card button removes card from DOM and model', () => {
      const initialData: KanbanData = {
        columns: [
          { id: 'col-1', title: 'Todo', position: 'a0' },
        ],
        cardMap: {
          'card-1': { id: 'card-1', columnId: 'col-1', position: 'a0', title: 'Task 1' },
        },
      };

      const tool = new DatabaseTool(createDatabaseOptions(initialData));
      const element = tool.render();

      const deleteBtn = element.querySelector('[data-blok-database-delete-card]') as HTMLButtonElement;

      expect(deleteBtn).not.toBeNull();

      deleteBtn.click();

      const cards = element.querySelectorAll('[data-blok-database-card]');

      expect(cards).toHaveLength(0);

      const saved = tool.save(document.createElement('div'));

      expect(Object.keys(saved.cardMap)).toHaveLength(0);
    });
  });

  describe('column delete cascades adapter calls for cards', () => {
    it('calls adapter.deleteCard for each card then adapter.deleteColumn when column is deleted', async () => {
      const deleteCardCalls: string[] = [];
      const deleteColumnCalls: string[] = [];

      const mockAdapter = {
        loadBoard: vi.fn(),
        moveCard: vi.fn(),
        createCard: vi.fn(),
        updateCard: vi.fn(),
        deleteCard: vi.fn(async (params: { cardId: string }) => {
          deleteCardCalls.push(params.cardId);
        }),
        createColumn: vi.fn(),
        updateColumn: vi.fn(),
        moveColumn: vi.fn(),
        deleteColumn: vi.fn(async (params: { columnId: string }) => {
          deleteColumnCalls.push(params.columnId);
        }),
      };

      const initialData: KanbanData = {
        columns: [
          { id: 'col-1', title: 'Todo', position: 'a0' },
          { id: 'col-2', title: 'Done', position: 'a1' },
        ],
        cardMap: {
          'card-1': { id: 'card-1', columnId: 'col-1', position: 'a0', title: 'Task 1' },
          'card-2': { id: 'card-2', columnId: 'col-1', position: 'a1', title: 'Task 2' },
        },
      };

      const options = createDatabaseOptions(initialData, { adapter: mockAdapter });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      // Find the delete-column button for col-1 (injected by DatabaseColumnControls.makeEditable)
      const deleteBtn = element.querySelector('[data-blok-database-delete-column][data-column-id="col-1"]') as HTMLButtonElement;

      expect(deleteBtn).not.toBeNull();

      deleteBtn.click();

      // Adapter calls are async — wait for them to flush
      await vi.waitFor(() => {
        expect(deleteCardCalls).toHaveLength(2);
      });

      expect(deleteCardCalls).toContain('card-1');
      expect(deleteCardCalls).toContain('card-2');
      expect(deleteColumnCalls).toEqual(['col-1']);

      // Column should be removed from DOM
      const remainingColumns = element.querySelectorAll('[data-blok-database-column]');

      expect(remainingColumns).toHaveLength(1);

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

      const initialData: KanbanData = {
        columns: [
          { id: 'col-1', title: 'Todo', position: 'a0' },
        ],
        cardMap: {},
      };

      const options: BlockToolConstructorOptions<KanbanData, DatabaseConfig> = {
        data: initialData,
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
      const initialData: KanbanData = {
        columns: [
          { id: 'col-1', title: 'Todo', position: 'a0' },
          { id: 'col-2', title: 'Done', position: 'a1' },
        ],
        cardMap: {
          'card-1': { id: 'card-1', columnId: 'col-1', position: 'a0', title: 'Task 1' },
        },
      };

      // Spy on DatabaseCardDrawer.prototype.destroy to detect if it's called during rerender
      const drawerDestroySpy = vi.spyOn(DatabaseCardDrawer.prototype, 'destroy');

      const tool = new DatabaseTool(createDatabaseOptions(initialData));

      tool.render();

      // The tool is rendered and subsystems are initialised.
      // We need to get at the cardDrag's onDrop to trigger a rerender.
      // Access the private cardDrag field to capture onDrop.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cardDrag = (tool as any).cardDrag as DatabaseCardDrag;

      expect(cardDrag).not.toBeNull();

      // Access the private onDrop callback
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onDrop = (cardDrag as any).onDrop as (result: CardDragResult) => void;

      // Reset spy call count — destroy may have been called during setup
      drawerDestroySpy.mockClear();

      // Trigger a card drop which calls handleCardDrop -> rerenderBoard
      onDrop({
        cardId: 'card-1',
        toColumnId: 'col-2',
        beforeCardId: null,
        afterCardId: null,
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
      const initialData: KanbanData = {
        columns: [
          { id: 'col-1', title: 'Todo', position: 'a0', color: 'blue' },
        ],
        cardMap: {
          'card-1': { id: 'card-1', columnId: 'col-1', position: 'a0', title: 'Original title' },
        },
      };

      const tool = new DatabaseTool(createDatabaseOptions(initialData));
      const element = tool.render();

      // Click the card to open the drawer
      const cardEl = element.querySelector('[data-card-id="card-1"]') as HTMLElement;

      cardEl.click();

      // The drawer should be open with a title input
      const drawerTitle = element.querySelector('[data-blok-database-drawer-title]') as HTMLInputElement;

      expect(drawerTitle).not.toBeNull();

      // Edit the title in the drawer
      drawerTitle.value = 'Updated title';
      drawerTitle.dispatchEvent(new Event('input', { bubbles: true }));

      // The card on the board should reflect the new title
      const boardCardTitle = element.querySelector('[data-card-id="card-1"] [data-blok-database-card-title]');

      expect(boardCardTitle?.textContent).toBe('Updated title');

      tool.destroy();
    });
  });

  describe('rerenderBoard preserves scroll position', () => {
    /**
     * jsdom has no layout engine, so scrollLeft is always 0 and sets are no-ops.
     * We patch Element.prototype.scrollLeft for these tests to make it behave
     * like a real browser (readable/writable per-element).
     */
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
      const initialData: KanbanData = {
        columns: [
          { id: 'col-1', title: 'Todo', position: 'a0' },
          { id: 'col-2', title: 'Done', position: 'a1' },
        ],
        cardMap: {
          'card-1': { id: 'card-1', columnId: 'col-1', position: 'a0', title: 'Task 1' },
        },
      };

      const tool = new DatabaseTool(createDatabaseOptions(initialData));
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
        cardId: 'card-1',
        toColumnId: 'col-2',
        beforeCardId: null,
        afterCardId: null,
      });

      // After rerender, the new board area should have the scroll position restored
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newElement = (tool as any).element as HTMLElement;
      const newBoardArea = newElement.querySelector('[data-blok-database-board]') as HTMLElement;

      expect(newBoardArea.scrollLeft).toBe(200);

      tool.destroy();
      document.body.removeChild(container);
    });

    it('preserves board horizontal scroll position after column drop', () => {
      const initialData: KanbanData = {
        columns: [
          { id: 'col-1', title: 'Todo', position: 'a0' },
          { id: 'col-2', title: 'Done', position: 'a1' },
        ],
        cardMap: {},
      };

      const tool = new DatabaseTool(createDatabaseOptions(initialData));
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
      const onDrop = (columnDrag as any).onDrop as (result: ColumnDragResult) => void;

      onDrop({
        columnId: 'col-1',
        beforeColumnId: null,
        afterColumnId: 'col-2',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newElement = (tool as any).element as HTMLElement;
      const newBoardArea = newElement.querySelector('[data-blok-database-board]') as HTMLElement;

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
});
