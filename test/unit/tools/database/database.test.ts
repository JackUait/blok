import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { KanbanData, DatabaseConfig } from '../../../../src/tools/database/types';
import { DatabaseTool } from '../../../../src/tools/database';

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

      const entries = toolbox as Array<{ name: string; titleKey: string; searchTerms: string[] }>;

      expect(entries).toHaveLength(2);
      expect(entries[0].name).toBe('database');
      expect(entries[1].name).toBe('board');
      expect(entries[0].titleKey).toBeDefined();
      expect(entries[1].titleKey).toBeDefined();
      expect(entries[0].searchTerms).toBeDefined();
      expect(entries[1].searchTerms).toBeDefined();
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

  describe('destroy()', () => {
    it('does not throw', () => {
      const tool = new DatabaseTool(createDatabaseOptions());

      tool.render();

      expect(() => tool.destroy()).not.toThrow();
    });
  });
});
