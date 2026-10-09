import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, queryAllByAttribute } from '@testing-library/dom';
import type { API, BlockAPI, BlockToolConstructorOptions, OutputData } from '../../../../types';
import type { DatabaseAdapter, DatabaseData, DatabaseConfig, DatabaseRow, DatabaseRowData, DatabaseViewConfig, PropertyDefinition, PropertyValue } from '../../../../src/tools/database/types';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { DatabaseModel } from '../../../../src/tools/database/database-model';
import type { CardDragResult, DatabaseCardDrag } from '../../../../src/tools/database/database-card-drag';
import type { GroupDragResult, DatabaseColumnDrag } from '../../../../src/tools/database/database-column-drag';

interface NestedEditorConfig {
  holder: HTMLElement;
  data?: OutputData;
  onChange: () => Promise<void>;
}

const nestedEditor = vi.hoisted((): { configs: NestedEditorConfig[]; savePayload: OutputData } => ({
  configs: [],
  savePayload: { blocks: [] },
}));

// The drawer imports Blok when it opens, so the test captures that editor's callbacks.
vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    constructor(config: NestedEditorConfig) {
      nestedEditor.configs.push(config);
    }

    save(): Promise<OutputData> {
      return Promise.resolve(nestedEditor.savePayload);
    }

    destroy(): void {}
  },
}));

// ---------------------------------------------------------------------------
// Testing Library helpers — replace querySelector / querySelectorAll with
// queryByAttribute / queryAllByAttribute to satisfy no-node-access rule.
// ---------------------------------------------------------------------------

/** Query all elements by the presence of a data attribute (value defaults to '' for boolean attrs). */
const queryAllByData = (container: HTMLElement, attr: string, value: string | RegExp = ''): HTMLElement[] =>
  queryAllByAttribute(attr, container, value);

/** Query the first element by the presence of a data attribute (value defaults to '' for boolean attrs). */
const queryByData = (container: HTMLElement, attr: string, value: string | RegExp = ''): HTMLElement | null => {
  const all = queryAllByData(container, attr, value);

  return all.length > 0 ? all[0] : null;
};

// ---------------------------------------------------------------------------
// Mock PopoverDesktop so JSDOM does not blow up. When show() is called the
// mock appends a container with clickable action items so tests can trigger
// onActivate callbacks.
// ---------------------------------------------------------------------------
vi.mock('../../../../src/components/utils/popover', () => {
  const PopoverItemType = { Default: 'default', Separator: 'separator', Html: 'html' };

  class MockPopoverDesktop {
    private container: HTMLElement | null = null;
    private readonly items: Array<{ title?: string; onActivate?: () => void; type?: string; element?: HTMLElement }>;
    private readonly eventHandlers: Map<string, Array<() => void>> = new Map();

    constructor(params: { items?: Array<{ title?: string; onActivate?: () => void; type?: string; element?: HTMLElement }>; [key: string]: unknown }) {
      this.items = params.items ?? [];
    }

    show(): void {
      this.container = document.createElement('div');
      this.container.setAttribute('data-mock-popover', '');

      for (const item of this.items) {
        if (item.type === PopoverItemType.Html && item.element !== undefined) {
          this.container.appendChild(item.element);
        }
        if (item.type === PopoverItemType.Separator || !item.title) continue;
        const el = document.createElement('div');
        el.setAttribute('data-mock-popover-action', item.title.toLowerCase());
        const onActivate = item.onActivate;
        if (onActivate) {
          el.addEventListener('click', () => onActivate());
        }
        this.container.appendChild(el);
      }

      document.body.appendChild(this.container);
    }

    hide(): void {
      this.destroy();
    }

    destroy(): void {
      this.container?.remove();
      this.container = null;
      const handlers = this.eventHandlers.get('closed') ?? [];
      for (const h of handlers) h();
    }

    on(event: string, handler: () => void): void {
      const existing = this.eventHandlers.get(event) ?? [];
      this.eventHandlers.set(event, [...existing, handler]);
    }

    off(): void { /* no-op */ }
  }

  return { PopoverDesktop: MockPopoverDesktop, PopoverMobile: MockPopoverDesktop, PopoverItemType };
});

vi.mock('@/types/utils/popover/popover-event', () => ({
  PopoverEvent: { Closed: 'closed' },
}));

/**
 * Creates a mock child block (database-row) as returned by api.blocks.getChildren.
 */
const createMockRowBlock = (options: {
  id: string;
  properties: Record<string, unknown>;
  position: string;
  pageId?: string;
}): BlockAPI => ({
  id: options.id,
  name: 'database-row',
  holder: document.createElement('div'),
  preservedData: {
    properties: options.properties,
    position: options.position,
    ...(options.pageId !== undefined ? { pageId: options.pageId } : {}),
  } as DatabaseRowData,
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
  i18n: {
    t: (key: string) =>
      key === 'tools.database.titlePlaceholder' ? 'New database' : key,
  },
  events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  blocks: {
    getCurrentBlockIndex: vi.fn().mockReturnValue(0),
    getBlocksCount: vi.fn().mockReturnValue(1),
    getChildren: vi.fn().mockReturnValue(childBlocks),
    insert: vi.fn().mockReturnValue({ id: 'new-row-id' }),
    insertAt: vi.fn().mockReturnValue({ id: 'new-row-id' }),
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
  block: { id: 'test-block-id', dispatchChange: vi.fn() } as never,
});

describe('DatabaseTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nestedEditor.configs.length = 0;
    nestedEditor.savePayload = { blocks: [] };
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

    it('toolbox entries include titleKey field for i18n', () => {
      const toolbox = DatabaseTool.toolbox;

      const entries = toolbox as Array<{ titleKey?: string }>;

      expect(entries[0].titleKey).toBe('database');
      expect(entries[1].titleKey).toBe('board');
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

    it('renders the no-value column plus 3 columns for default data with 3 select options', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();
      const columns = queryAllByData(element, 'data-blok-database-column');

      expect(columns).toHaveLength(4);
    });

    it('renders a title element with data-blok-database-title attribute', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();
      const titleEl = queryByData(element, 'data-blok-database-title');

      expect(titleEl).not.toBeNull();
    });

    it('renders title text from data.title when provided', () => {
      const tool = new DatabaseTool(createDatabaseOptions({ title: 'My Project' }));
      const element = tool.render();
      const titleEl = queryByData(element, 'data-blok-database-title');

      expect(titleEl?.textContent).toBe('My Project');
    });

    it('renders empty title element when data.title is not provided', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();
      const titleEl = queryByData(element, 'data-blok-database-title');

      expect(titleEl?.textContent).toBe('');
    });

    it.each([
      ['مشروعي', 'rtl'],
      ['My Project', 'ltr'],
    ])('gives the title %s its own direction %s', (title, direction) => {
      const tool = new DatabaseTool(createDatabaseOptions({ title }));
      const titleEl = queryByData(tool.render(), 'data-blok-database-title');

      expect(titleEl?.getAttribute('dir')).toBe(direction);
    });

    it('leaves an empty title without dir, so its placeholder follows the editor', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const titleEl = queryByData(tool.render(), 'data-blok-database-title');

      expect(titleEl?.hasAttribute('dir')).toBe(false);
    });

    it('updates the title direction as it is typed, and drops it when cleared', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const titleEl = queryByData(tool.render(), 'data-blok-database-title') as HTMLElement;

      titleEl.textContent = 'مشروعي';
      titleEl.dispatchEvent(new InputEvent('input', { bubbles: true }));
      expect(titleEl.getAttribute('dir')).toBe('rtl');

      titleEl.textContent = '';
      titleEl.dispatchEvent(new InputEvent('input', { bubbles: true }));
      expect(titleEl.hasAttribute('dir')).toBe(false);
    });

    it('renders title element with data-placeholder="New database" when no title provided', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();
      const titleEl = queryByData(element, 'data-blok-database-title');

      expect(titleEl?.getAttribute('data-placeholder')).toBe('New database');
    });

    it('renders title element with data-placeholder even when title is provided', () => {
      const tool = new DatabaseTool(createDatabaseOptions({ title: 'My Project' }));
      const element = tool.render();
      const titleEl = queryByData(element, 'data-blok-database-title');

      expect(titleEl?.getAttribute('data-placeholder')).toBe('New database');
    });

    it('localizes canonical defaults for display without changing saved data', () => {
      const childBlocks = [
        createMockRowBlock({
          id: 'row-1',
          properties: {
            'prop-title': 'Task 1',
            'prop-status': 'opt-progress',
          },
          position: 'a0',
        }),
      ];
      const options = createDatabaseOptions({
        schema: [
          { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
          {
            id: 'prop-status',
            name: 'Status',
            type: 'select',
            position: 'a1',
            config: {
              options: [
                { id: 'opt-not-started', label: 'Not started', color: 'gray', position: 'a0' },
                { id: 'opt-progress', label: 'In progress', color: 'blue', position: 'a1' },
                { id: 'opt-done', label: 'Done', color: 'green', position: 'a2' },
              ],
            },
          },
        ],
      }, {}, { childBlocks });
      const translations: Record<string, string> = {
        'tools.database.titlePlaceholder': 'Neue Datenbank',
        'tools.database.defaultTitleProperty': 'Titel',
        'tools.database.defaultStatusProperty': 'Status DE',
        'tools.database.defaultStatusNotStarted': 'Nicht begonnen',
        'tools.database.defaultStatusInProgress': 'In Arbeit',
        'tools.database.defaultStatusDone': 'Erledigt',
        'tools.database.defaultViewBoard': 'Tafel',
      };
      const translate = vi.fn((key: string) => translations[key] ?? key);

      options.api.i18n.t = translate;

      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();

      const titleEl = queryByData(element, 'data-blok-database-title');
      const viewName = queryByData(element, 'data-blok-database-tab-name');
      const columnTitles = queryAllByData(element, 'data-blok-database-column-title');
      const card = queryByData(element, 'data-blok-database-card');

      card?.click();

      const propertyLabel = queryByData(element, 'data-blok-database-drawer-prop-label');
      const selectedStatus = queryByData(element, 'data-blok-database-drawer-prop-pill');

      expect(titleEl?.getAttribute('data-placeholder')).toBe('Neue Datenbank');
      expect(viewName?.textContent).toBe('Tafel');
      expect(queryByData(element, 'data-blok-database-no-value-label')?.textContent).toBe('tools.database.noValueGroup');
      expect(columnTitles.map((column) => column.textContent)).toEqual([
        'Nicht begonnen',
        'In Arbeit',
        'Erledigt',
      ]);
      expect(propertyLabel?.textContent).toBe('Status DE');
      expect(selectedStatus?.textContent).toContain('In Arbeit');
      expect(translate).toHaveBeenCalledWith('tools.database.defaultTitleProperty');

      const saved = tool.save(document.createElement('div'));
      const statusProperty = saved.schema.find((property) => property.id === 'prop-status');

      expect(saved.schema.find((property) => property.id === 'prop-title')?.name).toBe('Title');
      expect(statusProperty?.name).toBe('Status');
      expect(statusProperty?.config?.options.map((option) => option.label)).toEqual([
        'Not started',
        'In progress',
        'Done',
      ]);
      expect(saved.views[0].name).toBe('Board');

      tool.destroy();
    });

    it('a value edited in the drawer goes through the row block and its change', () => {
      const row = createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task', 'prop-done': false }, position: 'a0' });
      const options = createDatabaseOptions({
        schema: [
          { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
          { id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: { options: [{ id: 'opt-a', label: 'A', position: 'a0' }] } },
          { id: 'prop-done', name: 'Done', type: 'checkbox', position: 'a2' },
        ],
      }, {}, { childBlocks: [row] });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      document.body.appendChild(element);
      tool.rendered();
      queryByData(element, 'data-blok-database-card')?.click();
      element.querySelector<HTMLElement>('[data-blok-database-drawer-prop-value][data-property-id="prop-done"]')?.click();

      expect(row.call).toHaveBeenCalledWith('updateProperties', { 'prop-done': true });
      expect(row.dispatchChange).toHaveBeenCalled();

      tool.destroy();
      element.remove();
    });

    it('an option created in the drawer saves the canonical labels, never the translated ones shown', () => {
      const row = createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task', 'prop-status': 'opt-progress' }, position: 'a0' });
      const options = createDatabaseOptions({
        schema: [
          { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
          {
            id: 'prop-status',
            name: 'Status',
            type: 'select',
            position: 'a1',
            config: {
              options: [
                { id: 'opt-not-started', label: 'Not started', color: 'gray', position: 'a0' },
                { id: 'opt-progress', label: 'In progress', color: 'blue', position: 'a1' },
              ],
            },
          },
        ],
      }, {}, { childBlocks: [row] });
      const translations: Record<string, string> = {
        'tools.database.defaultStatusNotStarted': 'Nicht begonnen',
        'tools.database.defaultStatusInProgress': 'In Arbeit',
      };

      options.api.i18n.t = (key: string): string => translations[key] ?? key;
      const tool = new DatabaseTool(options);
      const element = tool.render();

      document.body.appendChild(element);
      tool.rendered();
      queryByData(element, 'data-blok-database-card')?.click();
      element.querySelector<HTMLElement>('[data-blok-database-drawer-prop-value][data-property-id="prop-status"]')?.click();
      const search = document.querySelector<HTMLInputElement>('[data-blok-database-select-search]');

      if (search === null) {
        throw new Error('select editor did not open');
      }
      search.value = 'Blocked';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

      const labels = tool.save(document.createElement('div')).schema
        .find((property) => property.id === 'prop-status')?.config?.options.map((option) => option.label);

      expect(labels).toEqual(['Not started', 'In progress', 'Blocked']);
      expect(options.block.dispatchChange).toHaveBeenCalled();

      tool.destroy();
      element.remove();
    });

    it('renders title before the tab bar', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();
      const titleRow = queryByData(element, 'data-blok-database-title-row');
      const tabBar = queryByData(element, 'data-blok-database-tab-bar');

      expect(titleRow).not.toBeNull();
      expect(tabBar).not.toBeNull();
      // DOCUMENT_POSITION_FOLLOWING (4) means tabBar comes after titleRow in document order
      expect(titleRow!.compareDocumentPosition(tabBar!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('renders title as contenteditable in edit mode', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();
      const titleEl = queryByData(element, 'data-blok-database-title');

      expect(titleEl?.getAttribute('contenteditable')).toBe('true');
    });

    it('renders title as non-editable in read-only mode', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: true }));
      const element = tool.render();
      const titleEl = queryByData(element, 'data-blok-database-title');

      expect(titleEl?.getAttribute('contenteditable')).not.toBe('true');
    });

    it('blurs title on Enter key', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();
      const titleEl = queryByData(element, 'data-blok-database-title')!;

      document.body.appendChild(element);
      titleEl.focus();

      fireEvent.keyDown(titleEl, { key: 'Enter' });

      expect(titleEl).not.toHaveFocus();

      element.remove();
    });

    it('blurs title on Tab key', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();
      const titleEl = queryByData(element, 'data-blok-database-title')!;

      document.body.appendChild(element);
      titleEl.focus();

      fireEvent.keyDown(titleEl, { key: 'Tab' });

      expect(titleEl).not.toHaveFocus();

      element.remove();
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

    it('saves title from data.title when provided', () => {
      const tool = new DatabaseTool(createDatabaseOptions({ title: 'Sprint 1' }));

      tool.render();

      const saved = tool.save(document.createElement('div'));

      expect(saved.title).toBe('Sprint 1');
    });

    it('saves empty string when no title provided (placeholder is not persisted)', () => {
      const tool = new DatabaseTool(createDatabaseOptions());

      tool.render();

      const saved = tool.save(document.createElement('div'));

      expect(saved.title).toBe('');
    });

    it('saves updated title after editing the title element', () => {
      const tool = new DatabaseTool(createDatabaseOptions({ title: 'Original' }));
      const element = tool.render();
      const titleEl = queryByData(element, 'data-blok-database-title')!;

      titleEl.textContent = 'Updated title';

      const saved = tool.save(document.createElement('div'));

      expect(saved.title).toBe('Updated title');
    });

    it('keeps a top-level key written by a newer client', () => {
      const futureKey = { layout: 'timeline', nested: { since: 'v2' } };
      const tool = new DatabaseTool(createDatabaseOptions({ futureKey }));

      tool.render();

      const saved = tool.save(document.createElement('div'));

      expect(saved.futureKey).toEqual(futureKey);
    });

    it('lets its own known keys win over a stale value of the same name', () => {
      const tool = new DatabaseTool(createDatabaseOptions({ title: 'Stored', futureKey: 1 }));
      const element = tool.render();
      const titleEl = queryByData(element, 'data-blok-database-title');

      if (titleEl === null) {
        throw new Error('title element missing');
      }
      titleEl.textContent = 'Typed';

      const saved = tool.save(document.createElement('div'));

      expect(saved.title).toBe('Typed');
      expect(saved.futureKey).toBe(1);
      expect(Object.keys(saved).sort()).toEqual(['activeViewId', 'futureKey', 'schema', 'title', 'views']);
    });

    it('keeps a newer client key after the backend snapshot hydrates the model', async () => {
      const mockAdapter = {
        loadDatabase: vi.fn().mockResolvedValue({
          schema: [{ id: 'p-backend', name: 'Backend Title', type: 'title', position: 'a0' }],
          views: [{ id: 'v-backend', name: 'Backend Board', type: 'list', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        }),
        createRow: vi.fn(), updateRow: vi.fn(), moveRow: vi.fn(), deleteRow: vi.fn(),
        createProperty: vi.fn(), updateProperty: vi.fn(), deleteProperty: vi.fn(),
        createView: vi.fn(), updateView: vi.fn(), deleteView: vi.fn(),
      };
      const tool = new DatabaseTool(createDatabaseOptions({ futureKey: 'kept' }, { adapter: mockAdapter }));
      const container = document.createElement('div');

      container.appendChild(tool.render());
      document.body.appendChild(container);
      tool.rendered();

      await vi.waitFor(() => {
        expect(tool.save(document.createElement('div')).schema[0].id).toBe('p-backend');
      });

      expect(tool.save(document.createElement('div')).futureKey).toBe('kept');

      tool.destroy();
      container.remove();
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
    it('clicking add-card button calls api.blocks.insertAt with database-row type', () => {
      const options = createDatabaseOptions();
      const tool = new DatabaseTool(options);
      const element = tool.render();

      const addCardBtn = queryByData(element, 'data-blok-database-add-card')!;

      expect(addCardBtn).not.toBeNull();

      addCardBtn.click();

      expect(options.api.blocks.insertAt).toHaveBeenCalledTimes(1);
      const insertCall = (options.api.blocks.insertAt as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(insertCall[0]).toBe('database-row');
    });

    it('clicking add-card adds the row as the database block\'s last child', () => {
      const options = createDatabaseOptions();
      const tool = new DatabaseTool(options);
      const element = tool.render();

      const addCardBtn = queryByData(element, 'data-blok-database-add-card')!;

      addCardBtn.click();

      const insertCall = (options.api.blocks.insertAt as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(insertCall[2]).toMatchObject({ parentId: 'test-block-id', position: 'end' });
      expect(options.api.blocks.setBlockParent).not.toHaveBeenCalled();
    });

    it('new row data has empty title property', () => {
      const options = createDatabaseOptions();
      const tool = new DatabaseTool(options);
      const element = tool.render();

      const addCardBtn = queryByData(element, 'data-blok-database-add-card')!;

      addCardBtn.click();

      const insertCall = (options.api.blocks.insertAt as ReturnType<typeof vi.fn>).mock.calls[0];
      const insertedData = insertCall[1] as DatabaseRowData;

      expect(insertedData.properties['prop-title']).toBe('');
    });
  });

  describe('add column via click', () => {
    it('clicking add-column button adds column to model and DOM', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();

      const initialColumns = queryAllByData(element, 'data-blok-database-column');

      expect(initialColumns).toHaveLength(4);

      const addColBtn = queryByData(element, 'data-blok-database-add-column')!;

      expect(addColBtn).not.toBeNull();

      addColBtn.click();

      const columns = queryAllByData(element, 'data-blok-database-column');

      expect(columns).toHaveLength(5);

      const saved = tool.save(document.createElement('div'));
      const statusProp = saved.schema.find((p) => p.type === 'select');

      expect(statusProp?.config?.options).toHaveLength(4);
    });
  });

  describe('delete row via click', () => {
    it('clicking card-menu button and selecting delete calls api.blocks.delete', () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' }, position: 'a0' }),
      ];

      const options = createDatabaseOptions({}, {}, { childBlocks });

      (options.api.blocks.getBlockIndex as ReturnType<typeof vi.fn>).mockReturnValue(1);

      const tool = new DatabaseTool(options);
      const element = tool.render();
      tool.rendered();

      const cardMenuBtn = queryByData(element, 'data-blok-database-card-menu')!;

      expect(cardMenuBtn).not.toBeNull();

      cardMenuBtn.click();

      // The mock popover appends action items to document.body
      const deleteAction = queryByData(document.body, 'data-mock-popover-action', /.*/)!;

      expect(deleteAction).not.toBeNull();

      deleteAction.click();

      expect(options.api.blocks.getBlockIndex).toHaveBeenCalledWith('row-1');
      expect(options.api.blocks.delete).toHaveBeenCalledWith(1);

      // Cleanup mock popover
      queryByData(document.body, 'data-mock-popover')?.remove();
    });
  });

  describe('card menu teardown', () => {
    it('closes an open card menu when the tool is destroyed', () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' }, position: 'a0' }),
      ];
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks }));
      const element = tool.render();

      tool.rendered();

      const cardMenuBtn = queryByData(element, 'data-blok-database-card-menu');

      if (cardMenuBtn === null) throw new Error('card menu was not rendered');

      cardMenuBtn.click();

      expect(queryByData(document.body, 'data-mock-popover')).not.toBeNull();

      tool.destroy();

      // An open menu holds the page scroll lock until it is destroyed.
      expect(queryByData(document.body, 'data-mock-popover')).toBeNull();
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
          insertAt: vi.fn(),
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

      const addColBtn = queryByData(element, 'data-blok-database-add-column')!;

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
      const cardEl = queryByData(element, 'data-row-id', 'row-1')!;
      cardEl.click();
      expect(queryByData(element, 'data-blok-database-drawer')).not.toBeNull();

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
      expect(queryByData(element, 'data-blok-database-drawer')).toBeNull();

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
      expect(queryAllByData(element, 'data-blok-database-card')).toHaveLength(0);

      // Now child blocks become available (simulates Renderer creating them after database block)
      (options.api.blocks.getChildren as ReturnType<typeof vi.fn>).mockReturnValue(childBlocks);
      tool.rendered();

      // Board should now show the card
      expect(queryAllByData(element, 'data-blok-database-card')).toHaveLength(1);
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

  it('saves a changed drawer body with the default schema', async () => {
    const body: OutputData = {
      blocks: [{ id: 'body-p', type: 'paragraph', data: { text: 'Kept' } }],
    };
    const rowBlock = createMockRowBlock({
      id: 'row-1',
      position: 'a0',
      properties: { 'prop-title': 'Row', 'prop-status': 'opt-todo' },
    });
    const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks: [rowBlock] }));

    try {
      const element = tool.render();
      tool.rendered();
      const card = queryByData(element, 'data-row-id', 'row-1');

      if (card === null) throw new Error('row card was not rendered');
      card.click();

      const editorHolder = queryByData(element, 'data-blok-database-drawer-editor');

      if (editorHolder === null) throw new Error('drawer body was not rendered');
      await vi.waitFor(() => {
        expect(nestedEditor.configs.some(({ holder }) => holder === editorHolder)).toBe(true);
      });
      const editor = nestedEditor.configs.find(({ holder }) => holder === editorHolder);

      if (editor === undefined) throw new Error('nested editor was not constructed');
      nestedEditor.savePayload = body;
      await editor.onChange();

      const bodyProperty = tool.save(element).schema.find((property) => property.type === 'richText');

      expect(bodyProperty).toBeDefined();
      if (bodyProperty === undefined) throw new Error('body property was not saved');
      expect(rowBlock.call).toHaveBeenCalledWith('updateProperties', { [bodyProperty.id]: body });
    } finally {
      tool.destroy();
    }
  });

  it('passes a migrated row page pointer to the drawer', () => {
    const rowBlock = createMockRowBlock({
      id: 'row-1',
      position: 'a0',
      properties: { 'prop-title': 'Row', 'prop-status': 'opt-todo' },
      pageId: 'row-page',
    });
    const opened = vi.spyOn(DatabaseCardDrawer.prototype, 'open');
    const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks: [rowBlock] }));

    try {
      const element = tool.render();
      tool.rendered();
      const card = queryByData(element, 'data-row-id', 'row-1');

      if (card === null) throw new Error('row card was not rendered');
      card.click();

      expect(opened).toHaveBeenCalledWith(expect.objectContaining({ pageId: 'row-page' }));
    } finally {
      tool.destroy();
    }
  });

  const openDrawerEditor = async (element: HTMLElement): Promise<NestedEditorConfig> => {
    const card = queryByData(element, 'data-row-id', 'row-1');

    if (card === null) throw new Error('row card was not rendered');
    card.click();
    const holder = queryByData(element, 'data-blok-database-drawer-editor');

    if (holder === null) throw new Error('drawer body was not rendered');
    await vi.waitFor(() => {
      expect(nestedEditor.configs.some(({ holder: configuredHolder }) => configuredHolder === holder)).toBe(true);
    });
    const editor = nestedEditor.configs.find(({ holder: configuredHolder }) => configuredHolder === holder);

    if (editor === undefined) throw new Error('nested editor was not constructed');

    return editor;
  };

  it('does not restore a deleted row when a closing drawer saves later', async () => {
    const body: OutputData = { blocks: [{ id: 'body-p', type: 'paragraph', data: { text: 'Late body' } }] };
    const properties = { 'prop-title': 'Row', 'prop-status': 'opt-todo', 'prop-body': { blocks: [] } };
    const storedRows = new Map<string, DatabaseRow>([['row-1', { id: 'row-1', position: 'a0', properties }]]);
    const adapter: DatabaseAdapter = {
      loadDatabase: vi.fn(),
      createRow: vi.fn(),
      updateRow: vi.fn(async ({ rowId, properties: updated }: Parameters<DatabaseAdapter['updateRow']>[0]) => {
        const row = { id: rowId, position: 'a0', properties: updated };

        storedRows.set(rowId, row);
        return row;
      }),
      moveRow: vi.fn(),
      deleteRow: vi.fn(async ({ rowId }: Parameters<DatabaseAdapter['deleteRow']>[0]) => {
        storedRows.delete(rowId);
      }),
      createProperty: vi.fn(),
      updateProperty: vi.fn(),
      deleteProperty: vi.fn(),
      createView: vi.fn(),
      updateView: vi.fn(),
      deleteView: vi.fn(),
    };
    const rowBlock = createMockRowBlock({ id: 'row-1', position: 'a0', properties });
    const options = createDatabaseOptions({
      schema: [...makeDefaultData().schema, { id: 'prop-body', name: 'Details', type: 'richText', position: 'a2' }],
    }, { adapter }, { childBlocks: [rowBlock] });

    (options.api.blocks.delete as ReturnType<typeof vi.fn>).mockImplementation(() => {
      (options.api.blocks.getChildren as ReturnType<typeof vi.fn>).mockReturnValue([]);
    });
    const tool = new DatabaseTool(options);

    try {
      const element = tool.render();
      tool.rendered();
      await openDrawerEditor(element);
      nestedEditor.savePayload = body;
      vi.useFakeTimers();

      const closeButton = queryByData(element, 'data-blok-database-drawer-close');
      const cardMenu = queryByData(element, 'data-blok-database-card-menu');

      if (closeButton === null || cardMenu === null) throw new Error('drawer or card menu was not rendered');
      closeButton.click();
      cardMenu.click();
      const deleteAction = queryByData(document.body, 'data-mock-popover-action', /delete/);

      if (deleteAction === null) throw new Error('delete action was not rendered');
      deleteAction.click();
      await vi.runOnlyPendingTimersAsync();

      expect(storedRows.has('row-1')).toBe(false);
    } finally {
      tool.destroy();
      queryByData(document.body, 'data-mock-popover')?.remove();
      vi.useRealTimers();
    }
  });

  it('publishes a newly created drawer body property in the database block', async () => {
    const rowBlock = createMockRowBlock({
      id: 'row-1',
      position: 'a0',
      properties: { 'prop-title': 'Row', 'prop-status': 'opt-todo' },
    });
    const options = createDatabaseOptions({}, {}, { childBlocks: [rowBlock] });
    const tool = new DatabaseTool(options);
    const element = tool.render();
    const published: DatabaseData[] = [];

    options.block.dispatchChange = () => {
      published.push(tool.save(element));
    };

    try {
      tool.rendered();
      const editor = await openDrawerEditor(element);

      nestedEditor.savePayload = { blocks: [{ id: 'body-p', type: 'paragraph', data: { text: 'Kept' } }] };
      await editor.onChange();

      expect(published[0]?.schema.some((property) => property.type === 'richText')).toBe(true);
      expect(published).toHaveLength(1);
    } finally {
      tool.destroy();
    }
  });

  it('waits for body property creation before syncing the latest row value to the adapter', async () => {
    const firstBody: OutputData = { blocks: [{ id: 'body-p', type: 'paragraph', data: { text: 'First' } }] };
    const body: OutputData = { blocks: [{ id: 'body-p', type: 'paragraph', data: { text: 'Kept' } }] };
    let finishCreate: (() => void) | undefined;
    let persistedProperties: Record<string, PropertyValue> | undefined;
    let propertyCreated = false;
    const adapter: DatabaseAdapter = {
      loadDatabase: vi.fn(),
      createRow: vi.fn(),
      updateRow: vi.fn(async (params: Parameters<DatabaseAdapter['updateRow']>[0]) => {
        if (!propertyCreated) throw new Error('property does not exist');
        persistedProperties = params.properties;

        return { id: params.rowId, position: 'a0', properties: params.properties };
      }),
      moveRow: vi.fn(),
      deleteRow: vi.fn(),
      createProperty: vi.fn((property: Parameters<DatabaseAdapter['createProperty']>[0]) => new Promise<PropertyDefinition>((resolve) => {
        finishCreate = () => {
          propertyCreated = true;
          resolve(property);
        };
      })),
      updateProperty: vi.fn(),
      deleteProperty: vi.fn(),
      createView: vi.fn(),
      updateView: vi.fn(),
      deleteView: vi.fn(),
    };
    const rowBlock = createMockRowBlock({
      id: 'row-1',
      position: 'a0',
      properties: { 'prop-title': 'Row', 'prop-status': 'opt-todo' },
    });
    const tool = new DatabaseTool(createDatabaseOptions({}, { adapter }, { childBlocks: [rowBlock] }));

    try {
      const element = tool.render();
      const editor = await openDrawerEditor(element);

      vi.useFakeTimers();
      nestedEditor.savePayload = firstBody;
      await editor.onChange();
      nestedEditor.savePayload = body;
      await editor.onChange();
      await vi.advanceTimersByTimeAsync(500);
      if (finishCreate === undefined) throw new Error('property creation was not started');
      finishCreate();
      await vi.runOnlyPendingTimersAsync();

      const bodyProperty = tool.save(element).schema.find((property) => property.type === 'richText');

      if (bodyProperty === undefined) throw new Error('body property was not saved');
      expect(persistedProperties?.[bodyProperty.id]).toEqual(body);
    } finally {
      tool.destroy();
      vi.useRealTimers();
    }
  });

  it('retries body property creation after an adapter failure before syncing the latest body', async () => {
    const firstBody: OutputData = { blocks: [{ id: 'body-p', type: 'paragraph', data: { text: 'First' } }] };
    const latestBody: OutputData = { blocks: [{ id: 'body-p', type: 'paragraph', data: { text: 'Latest' } }] };
    let createCalls = 0;
    let created = false;
    let persistedProperties: Record<string, PropertyValue> | undefined;
    const adapter: DatabaseAdapter = {
      loadDatabase: vi.fn(),
      createRow: vi.fn(),
      updateRow: vi.fn(async (params: Parameters<DatabaseAdapter['updateRow']>[0]) => {
        if (!created) throw new Error('property does not exist');
        persistedProperties = params.properties;

        return { id: params.rowId, position: 'a0', properties: params.properties };
      }),
      moveRow: vi.fn(),
      deleteRow: vi.fn(),
      createProperty: vi.fn(async (property: Parameters<DatabaseAdapter['createProperty']>[0]) => {
        createCalls += 1;
        if (createCalls === 1) throw new Error('create failed');
        created = true;

        return property;
      }),
      updateProperty: vi.fn(),
      deleteProperty: vi.fn(),
      createView: vi.fn(),
      updateView: vi.fn(),
      deleteView: vi.fn(),
    };
    const rowBlock = createMockRowBlock({
      id: 'row-1', position: 'a0', properties: { 'prop-title': 'Row', 'prop-status': 'opt-todo' },
    });
    const tool = new DatabaseTool(createDatabaseOptions({}, { adapter }, { childBlocks: [rowBlock] }));

    try {
      const element = tool.render();
      const editor = await openDrawerEditor(element);

      vi.useFakeTimers();
      nestedEditor.savePayload = firstBody;
      await editor.onChange();
      await vi.advanceTimersByTimeAsync(500);

      expect(adapter.updateRow).not.toHaveBeenCalled();

      nestedEditor.savePayload = latestBody;
      await editor.onChange();
      await vi.runOnlyPendingTimersAsync();
      const bodyProperty = tool.save(element).schema.find((property) => property.type === 'richText');

      if (bodyProperty === undefined) throw new Error('body property was not saved');
      expect(createCalls).toBe(2);
      expect(persistedProperties?.[bodyProperty.id]).toEqual(latestBody);
    } finally {
      tool.destroy();
      vi.useRealTimers();
    }
  });

  it('does not sync a deleted row after its body property creation completes', async () => {
    let finishCreate: (() => void) | undefined;
    const adapter: DatabaseAdapter = {
      loadDatabase: vi.fn(),
      createRow: vi.fn(),
      updateRow: vi.fn(async (params: Parameters<DatabaseAdapter['updateRow']>[0]) => ({
        id: params.rowId, position: 'a0', properties: params.properties,
      })),
      moveRow: vi.fn(),
      deleteRow: vi.fn(),
      createProperty: vi.fn((property: Parameters<DatabaseAdapter['createProperty']>[0]) => new Promise<PropertyDefinition>((resolve) => {
        finishCreate = () => resolve(property);
      })),
      updateProperty: vi.fn(),
      deleteProperty: vi.fn(),
      createView: vi.fn(),
      updateView: vi.fn(),
      deleteView: vi.fn(),
    };
    const rowBlock = createMockRowBlock({
      id: 'row-1', position: 'a0', properties: { 'prop-title': 'Row', 'prop-status': 'opt-todo' },
    });
    const tool = new DatabaseTool(createDatabaseOptions({}, { adapter }, { childBlocks: [rowBlock] }));

    try {
      const element = tool.render();
      const editor = await openDrawerEditor(element);

      vi.useFakeTimers();
      nestedEditor.savePayload = { blocks: [{ id: 'body-p', type: 'paragraph', data: { text: 'Kept' } }] };
      await editor.onChange();
      const cardMenu = queryByData(element, 'data-blok-database-card-menu');

      if (cardMenu === null) throw new Error('card menu was not rendered');
      cardMenu.click();
      const deleteAction = queryByData(document.body, 'data-mock-popover-action', /delete/);

      if (deleteAction === null) throw new Error('delete action was not rendered');
      deleteAction.click();
      if (finishCreate === undefined) throw new Error('property creation was not started');
      finishCreate();
      await vi.runOnlyPendingTimersAsync();

      expect(adapter.updateRow).not.toHaveBeenCalled();
    } finally {
      tool.destroy();
      queryByData(document.body, 'data-mock-popover')?.remove();
      vi.useRealTimers();
    }
  });

  describe('drawer title edits update row block via call()', () => {
    it('editing the title in the drawer calls block.call("updateTitle") on the row block', () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Original title', 'prop-status': 'opt-todo' }, position: 'a0' }),
      ];

      const options = createDatabaseOptions({}, {}, { childBlocks });
      const tool = new DatabaseTool(options);
      const element = tool.render();
      tool.rendered();

      // Click the card to open the drawer
      const cardEl = queryByData(element, 'data-row-id', 'row-1')!;

      cardEl.click();

      // The drawer should be open with a title input
      const drawerTitle = queryByData(element, 'data-blok-database-drawer-title')! as HTMLTextAreaElement;

      expect(drawerTitle).not.toBeNull();

      // Edit the title in the drawer
      drawerTitle.value = 'Updated title';
      fireEvent.input(drawerTitle);

      // Goes through updateTitle so the row writes BOTH its top-level `title`
      // (the key the CRDT merges per character) and the properties mirror.
      expect(childBlocks[0].call).toHaveBeenCalledWith('updateTitle', {
        title: 'Updated title',
        titlePropertyId: 'prop-title',
      });
      expect(childBlocks[0].dispatchChange).toHaveBeenCalled();

      tool.destroy();
    });
  });

  describe('row title lives in a top-level `title` key', () => {
    /** A row block whose stored data carries whatever the document holds. */
    const rowBlockWithData = (id: string, data: Record<string, unknown>): BlockAPI => ({
      id,
      name: 'database-row',
      holder: document.createElement('div'),
      preservedData: data as unknown as DatabaseRowData,
      call: vi.fn(),
      dispatchChange: vi.fn(),
    } as unknown as BlockAPI);

    it('gives a new row a top-level title at birth so the CRDT mints its Y.Text', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();

      tool.rendered();

      const addButton = queryByData(element, 'data-blok-database-add-card')!;

      addButton.click();

      const api = (tool as unknown as { api: API }).api;
      const insertCall = (api.blocks.insertAt as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(insertCall[1]).toHaveProperty('title', '');

      tool.destroy();
    });

    it('rewrites a stale properties mirror from the merged title', () => {
      // What a concurrent burst leaves behind: `title` merged both ways, the
      // properties copy still holding one peer's whole write.
      const child = rowBlockWithData('row-1', {
        position: 'a0',
        title: 'Ship the BBB release today',
        properties: { 'prop-title': 'Ship the BBB release', 'prop-status': 'opt-todo' },
      });
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks: [child] }));

      tool.render();
      tool.rendered();

      expect(child.call).toHaveBeenCalledWith('updateProperties', { 'prop-title': 'Ship the BBB release today' });
      expect(child.dispatchChange).toHaveBeenCalled();

      tool.destroy();
    });

    it('reads the merged title, not the stale mirror, when rendering a card', () => {
      const child = rowBlockWithData('row-1', {
        position: 'a0',
        title: 'Ship the BBB release today',
        properties: { 'prop-title': 'Ship the BBB release', 'prop-status': 'opt-todo' },
      });
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks: [child] }));
      const element = tool.render();

      tool.rendered();

      expect(element.textContent).toContain('Ship the BBB release today');

      tool.destroy();
    });

    it('never writes to a row saved before the top-level title key existed', () => {
      const child = rowBlockWithData('row-1', {
        position: 'a0',
        properties: { 'prop-title': 'Old row', 'prop-status': 'opt-todo' },
      });
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks: [child] }));
      const element = tool.render();

      tool.rendered();

      expect(child.call).not.toHaveBeenCalledWith('updateProperties', expect.anything());
      expect(child.dispatchChange).not.toHaveBeenCalled();
      expect(element.textContent).toContain('Old row');

      tool.destroy();
    });

    it('leaves a row alone once its mirror already matches the merged title', () => {
      const child = rowBlockWithData('row-1', {
        position: 'a0',
        title: 'Ship it',
        properties: { 'prop-title': 'Ship it', 'prop-status': 'opt-todo' },
      });
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks: [child] }));

      tool.render();
      tool.rendered();

      expect(child.call).not.toHaveBeenCalledWith('updateProperties', expect.anything());

      tool.destroy();
    });
  });

  describe('rows are read from the live row tool', () => {
    /**
     * A child backed by a real DatabaseRowTool. `preservedData` is what the
     * editor last SAVED, and it only moves when `settle()` runs a save —
     * the same lag a real row block has behind its tool.
     */
    const liveRowBlock = (id: string, data: DatabaseRowData): { block: BlockAPI; row: DatabaseRowTool; settle: () => void } => {
      const row = new DatabaseRowTool({ data, config: {}, api: createMockAPI(), readOnly: false, block: { id } as never });
      const saved = { data: row.save(document.createElement('div')) };
      const block = {
        id,
        name: 'database-row',
        holder: document.createElement('div'),
        get preservedData() {
          return saved.data;
        },
        call: vi.fn((method: string, params?: Record<string, unknown>) => {
          const fn = (row as unknown as Record<string, unknown>)[method];

          if (typeof fn === 'function') {
            fn.call(row, params);
          }
        }),
        dispatchChange: vi.fn(),
      } as unknown as BlockAPI;

      return {
        block,
        row,
        settle: () => {
          saved.data = row.save(document.createElement('div'));
        },
      };
    };

    const typeDrawerTitle = (element: HTMLElement, value: string): void => {
      const input = queryByData(element, 'data-blok-database-drawer-title') as HTMLTextAreaElement;

      input.value = value;
      fireEvent.input(input);
    };

    it('keeps the second of two quick renames in the published title mirror', () => {
      const { block, row, settle } = liveRowBlock('row-1', {
        position: 'a0',
        title: 'Card',
        properties: { 'prop-title': 'Card', 'prop-status': 'opt-todo' },
      });
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks: [block] }));
      const element = tool.render();

      tool.rendered();
      queryByData(element, 'data-row-id', 'row-1')!.click();

      typeDrawerTitle(element, 'First');
      settle();
      typeDrawerTitle(element, 'Second');

      expect(row.getProperties()['prop-title']).toBe('Second');
      expect(row.getTitle()).toBe('Second');

      tool.destroy();
    });

    it('keeps an unset Details body separate from populated Notes', async () => {
      const notes: OutputData = { blocks: [{ id: 'notes-1', type: 'paragraph', data: { text: 'Notes' } }] };
      const details: OutputData = { blocks: [{ id: 'details-1', type: 'paragraph', data: { text: 'Details' } }] };
      const schema: PropertyDefinition[] = [
        ...makeDefaultData().schema,
        { id: 'prop-details', name: 'Details', type: 'richText', position: 'a2' },
        { id: 'prop-notes', name: 'Notes', type: 'richText', position: 'a3' },
      ];
      const { block, row } = liveRowBlock('row-1', {
        position: 'a0',
        properties: { 'prop-title': 'Row', 'prop-status': 'opt-todo', 'prop-notes': notes },
      });
      const tool = new DatabaseTool(createDatabaseOptions({ schema }, {}, { childBlocks: [block] }));

      try {
        const element = tool.render();

        tool.rendered();
        const editor = await openDrawerEditor(element);

        expect(editor.data).toBeUndefined();

        nestedEditor.savePayload = details;
        await editor.onChange();

        expect(row.getProperties()['prop-details']).toEqual(details);
        expect(row.getProperties()['prop-notes']).toEqual(notes);
      } finally {
        tool.destroy();
      }
    });

    it('reopens a saved default-schema body and reuses its property on a second edit', async () => {
      const firstBody: OutputData = { blocks: [{ id: 'body-1', type: 'paragraph', data: { text: 'First' } }] };
      const secondBody: OutputData = { blocks: [{ id: 'body-1', type: 'paragraph', data: { text: 'Second' } }] };
      const { block, row } = liveRowBlock('row-1', {
        position: 'a0',
        properties: { 'prop-title': 'Row', 'prop-status': 'opt-todo' },
      });
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks: [block] }));

      try {
        const element = tool.render();
        tool.rendered();
        const card = queryByData(element, 'data-row-id', 'row-1');

        if (card === null) throw new Error('row card was not rendered');
        card.click();
        const firstHolder = queryByData(element, 'data-blok-database-drawer-editor');

        if (firstHolder === null) throw new Error('drawer body was not rendered');
        await vi.waitFor(() => {
          expect(nestedEditor.configs.some(({ holder }) => holder === firstHolder)).toBe(true);
        });
        const firstEditor = nestedEditor.configs.find(({ holder }) => holder === firstHolder);

        if (firstEditor === undefined) throw new Error('nested editor was not constructed');
        nestedEditor.savePayload = firstBody;
        await firstEditor.onChange();

        const firstSchema = tool.save(element).schema;
        const bodyProperty = firstSchema.find((property) => property.type === 'richText');

        expect(bodyProperty).toBeDefined();
        if (bodyProperty === undefined) throw new Error('body property was not saved');
        expect(row.save(document.createElement('div')).properties[bodyProperty.id]).toEqual(firstBody);

        const closeButton = queryByData(element, 'data-blok-database-drawer-close');

        if (closeButton === null) throw new Error('drawer close button was not rendered');
        closeButton.click();
        card.click();
        const reopenedHolder = queryByData(element, 'data-blok-database-drawer-editor');

        if (reopenedHolder === null) throw new Error('drawer body was not reopened');
        await vi.waitFor(() => {
          expect(nestedEditor.configs.some(({ holder }) => holder === reopenedHolder)).toBe(true);
        });
        const reopenedEditor = nestedEditor.configs.find(({ holder }) => holder === reopenedHolder);

        if (reopenedEditor === undefined) throw new Error('nested editor was not reconstructed');
        expect(reopenedEditor.data).toEqual(firstBody);

        nestedEditor.savePayload = secondBody;
        await reopenedEditor.onChange();

        expect(tool.save(element).schema.filter((property) => property.type === 'richText')).toEqual([bodyProperty]);
        expect(row.save(document.createElement('div')).properties[bodyProperty.id]).toEqual(secondBody);
      } finally {
        tool.destroy();
      }
    });

    it('recovers a saved drawer body without republishing a backend-omitted property', async () => {
      const body: OutputData = {
        blocks: [{ id: 'body-1', type: 'paragraph', data: { text: 'Saved details' } }],
      };
      const backendData = makeDefaultData();
      let backendSchema = backendData.schema;
      let createAttempts = 0;
      const adapter: DatabaseAdapter = {
        loadDatabase: vi.fn(async () => ({ schema: structuredClone(backendSchema), views: backendData.views })),
        createRow: vi.fn(),
        updateRow: vi.fn(),
        moveRow: vi.fn(),
        deleteRow: vi.fn(),
        createProperty: vi.fn(async (property: Parameters<DatabaseAdapter['createProperty']>[0]) => {
          createAttempts += 1;
          if (createAttempts === 1) throw new Error('schema write failed');
          backendSchema = [...backendSchema, property];

          return property;
        }),
        updateProperty: vi.fn(),
        deleteProperty: vi.fn(),
        createView: vi.fn(),
        updateView: vi.fn(),
        deleteView: vi.fn(),
      };
      const { block, row } = liveRowBlock('row-1', {
        position: 'a0',
        properties: { 'prop-title': 'Row', 'prop-status': 'opt-todo' },
      });
      const saved = await (async (): Promise<{ database: DatabaseData; row: DatabaseRowData }> => {
        const tool = new DatabaseTool(createDatabaseOptions({}, { adapter }, { childBlocks: [block] }));

        try {
          const element = tool.render();
          const editor = await openDrawerEditor(element);

          nestedEditor.savePayload = body;
          await editor.onChange();

          return { database: tool.save(element), row: row.save(document.createElement('div')) };
        } finally {
          tool.destroy();
        }
      })();
      const { block: reloadedBlock } = liveRowBlock('row-1', saved.row);
      const reloadedTool = new DatabaseTool(createDatabaseOptions(saved.database, { adapter }, { childBlocks: [reloadedBlock] }));

      try {
        const element = reloadedTool.render();
        const firstCard = queryByData(element, 'data-row-id', 'row-1');

        if (firstCard === null) throw new Error('row card was not rendered');
        reloadedTool.rendered();
        await vi.waitFor(() => {
          expect(queryByData(element, 'data-row-id', 'row-1')).not.toBe(firstCard);
        });
        expect(reloadedTool.save(element).schema.some((property) => property.type === 'richText')).toBe(false);
        const editor = await openDrawerEditor(element);

        expect(editor.data).toEqual(body);
      } finally {
        reloadedTool.destroy();
      }
    });

    it('keeps an explicitly empty Notes body instead of reviving an orphan', async () => {
      const original = makeDefaultData();
      const details = { id: 'prop-details', name: 'Details', type: 'richText', position: 'a2' } as const;
      const notes = { id: 'prop-notes', name: 'Notes', type: 'richText', position: 'a3' } as const;
      const savedSchema = [...original.schema, details, notes];
      const backendSchema = [...original.schema, notes];
      const body: OutputData = {
        blocks: [{ id: 'body-1', type: 'paragraph', data: { text: 'Saved details' } }],
      };
      const emptyBody: OutputData = { blocks: [] };
      const adapter: DatabaseAdapter = {
        loadDatabase: vi.fn(async () => ({ schema: backendSchema, views: original.views })),
        createRow: vi.fn(),
        updateRow: vi.fn(),
        moveRow: vi.fn(),
        deleteRow: vi.fn(),
        createProperty: vi.fn(),
        updateProperty: vi.fn(),
        deleteProperty: vi.fn(),
        createView: vi.fn(),
        updateView: vi.fn(),
        deleteView: vi.fn(),
      };
      const { block } = liveRowBlock('row-1', {
        position: 'a0',
        properties: {
          'prop-title': 'Row',
          'prop-status': 'opt-todo',
          'prop-details': body,
          'prop-notes': emptyBody,
        },
      });
      const tool = new DatabaseTool(createDatabaseOptions({ schema: savedSchema }, { adapter }, { childBlocks: [block] }));

      try {
        const element = tool.render();
        const firstCard = queryByData(element, 'data-row-id', 'row-1');

        tool.rendered();
        await vi.waitFor(() => {
          expect(queryByData(element, 'data-row-id', 'row-1')).not.toBe(firstCard);
        });
        const editor = await openDrawerEditor(element);

        expect(editor.data).toEqual(emptyBody);
        expect(tool.save(element).schema).toEqual(backendSchema);
      } finally {
        tool.destroy();
      }
    });

    it('reopens the latest orphan body after backend property creation fails', async () => {
      const original = makeDefaultData();
      const details = { id: 'prop-details', name: 'Details', type: 'richText', position: 'a2' } as const;
      const oldBody: OutputData = {
        blocks: [{ id: 'body-1', type: 'paragraph', data: { text: 'Old details' } }],
      };
      const editedBody: OutputData = {
        blocks: [{ id: 'body-1', type: 'paragraph', data: { text: 'Edited details' } }],
      };
      let createAttempts = 0;
      const adapter: DatabaseAdapter = {
        loadDatabase: vi.fn(async () => ({ schema: original.schema, views: original.views })),
        createRow: vi.fn(),
        updateRow: vi.fn(),
        moveRow: vi.fn(),
        deleteRow: vi.fn(),
        createProperty: vi.fn(async () => {
          createAttempts += 1;
          throw new Error('schema write failed');
        }),
        updateProperty: vi.fn(),
        deleteProperty: vi.fn(),
        createView: vi.fn(),
        updateView: vi.fn(),
        deleteView: vi.fn(),
      };
      const { block, row } = liveRowBlock('row-1', {
        position: 'a0',
        properties: { 'prop-title': 'Row', 'prop-status': 'opt-todo', 'prop-details': oldBody },
      });
      const saved = await (async (): Promise<{ database: DatabaseData; row: DatabaseRowData }> => {
        const tool = new DatabaseTool(createDatabaseOptions({
          schema: [...original.schema, details],
        }, { adapter }, { childBlocks: [block] }));

        try {
          const element = tool.render();
          const firstCard = queryByData(element, 'data-row-id', 'row-1');

          tool.rendered();
          await vi.waitFor(() => {
            expect(queryByData(element, 'data-row-id', 'row-1')).not.toBe(firstCard);
          });
          const editor = await openDrawerEditor(element);

          nestedEditor.savePayload = editedBody;
          await editor.onChange();

          return { database: tool.save(element), row: row.save(document.createElement('div')) };
        } finally {
          tool.destroy();
        }
      })();
      const { block: reloadedBlock } = liveRowBlock('row-1', saved.row);
      const reloadedTool = new DatabaseTool(createDatabaseOptions(saved.database, { adapter }, { childBlocks: [reloadedBlock] }));

      try {
        const element = reloadedTool.render();
        const firstCard = queryByData(element, 'data-row-id', 'row-1');

        reloadedTool.rendered();
        await vi.waitFor(() => {
          expect(queryByData(element, 'data-row-id', 'row-1')).not.toBe(firstCard);
        });
        const editor = await openDrawerEditor(element);

        expect(editor.data).toEqual(editedBody);

        const bodyKeys = Object.keys(saved.row.properties).filter((id) =>
          id !== 'prop-title' && id !== 'prop-status' && id !== 'prop-details');

        expect(createAttempts).toBe(1);
        expect(saved.row.properties['prop-details']).toEqual(oldBody);
        expect(bodyKeys).toHaveLength(1);
        expect(Object.keys(saved.row.properties)).toEqual([
          'prop-title', 'prop-status', 'prop-details', bodyKeys[0],
        ]);
        expect(saved.row.properties[bodyKeys[0]]).toEqual(editedBody);
        expect(reloadedTool.save(element).schema).toEqual(original.schema);
      } finally {
        reloadedTool.destroy();
      }
    });

    /** The 'block changed' listener the tool registered. */
    const blockChangedListener = (tool: DatabaseTool): ((payload: unknown) => void) => {
      const api = (tool as unknown as { api: API }).api;
      const call = (api.events.on as ReturnType<typeof vi.fn>).mock.calls.find(([name]) => name === 'block changed');

      if (call === undefined) {
        throw new Error('no block changed listener');
      }

      return call[1] as (payload: unknown) => void;
    };

    const rowChanged = (block: BlockAPI): unknown => ({ event: { type: 'block-changed', detail: { target: block } } });

    const cardTitles = (element: HTMLElement): string[] =>
      queryAllByData(element, 'data-blok-database-card-title').map((el) => el.textContent ?? '');

    it('redraws the board when a row is changed under it by undo, redo or a peer', async () => {
      const { block, row } = liveRowBlock('row-1', { position: 'a0', properties: { 'prop-title': 'Renamed', 'prop-status': 'opt-todo' } });
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks: [block] }));
      const element = tool.render();

      tool.rendered();
      row.setData({ position: 'a0', properties: { 'prop-title': 'Card one', 'prop-status': 'opt-todo' } });
      blockChangedListener(tool)(rowChanged(block));
      await Promise.resolve();

      expect(cardTitles(element)).toEqual(['Card one']);

      tool.destroy();
    });

    it('keeps an open card page open when the board redraws for a replayed change', async () => {
      const { block, row } = liveRowBlock('row-1', { position: 'a0', properties: { 'prop-title': 'One', 'prop-status': 'opt-todo' } });
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks: [block] }));
      const element = tool.render();

      tool.rendered();
      queryByData(element, 'data-row-id', 'row-1')!.click();
      row.setData({ position: 'a0', properties: { 'prop-title': 'One', 'prop-status': 'opt-done' } });
      blockChangedListener(tool)(rowChanged(block));
      await Promise.resolve();

      expect(queryByData(element, 'data-blok-database-drawer')).not.toBeNull();
      expect((tool as unknown as { cardDrawer: DatabaseCardDrawer | null }).cardDrawer?.isOpen).toBe(true);

      tool.destroy();
    });

    describe('an open card page when its row changes under it', () => {
      const drawerTitle = (element: HTMLElement): HTMLTextAreaElement | null =>
        queryByData(element, 'data-blok-database-drawer-title') as HTMLTextAreaElement | null;

      it('shows the row title that undo or a peer wrote', async () => {
        const { block, row } = liveRowBlock('row-1', { position: 'a0', properties: { 'prop-title': 'One', 'prop-status': 'opt-todo' } });
        const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks: [block] }));
        const element = tool.render();

        tool.rendered();
        queryByData(element, 'data-row-id', 'row-1')?.click();
        row.setData({ position: 'a0', properties: { 'prop-title': 'One (undone)', 'prop-status': 'opt-todo' } });
        blockChangedListener(tool)(rowChanged(block));
        await Promise.resolve();

        expect(drawerTitle(element)?.value).toBe('One (undone)');

        tool.destroy();
      });

      it('shows the row status that undo or a peer wrote', async () => {
        const { block, row } = liveRowBlock('row-1', { position: 'a0', properties: { 'prop-title': 'One', 'prop-status': 'opt-todo' } });
        const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks: [block] }));
        const element = tool.render();

        tool.rendered();
        queryByData(element, 'data-row-id', 'row-1')?.click();
        row.setData({ position: 'a0', properties: { 'prop-title': 'One', 'prop-status': 'opt-done' } });
        blockChangedListener(tool)(rowChanged(block));
        await Promise.resolve();

        const props = queryByData(element, 'data-blok-database-drawer-props');

        expect(props?.textContent).toContain('Done');

        tool.destroy();
      });

      it('closes when its row is removed', async () => {
        const one = liveRowBlock('row-1', { position: 'a0', properties: { 'prop-title': 'One', 'prop-status': 'opt-todo' } });
        const two = liveRowBlock('row-2', { position: 'a1', properties: { 'prop-title': 'Two', 'prop-status': 'opt-todo' } });
        const options = createDatabaseOptions({}, {}, { childBlocks: [one.block, two.block] });
        const tool = new DatabaseTool(options);
        const element = tool.render();

        tool.rendered();
        queryByData(element, 'data-row-id', 'row-1')?.click();
        vi.mocked(options.api.blocks.getChildren).mockReturnValue([two.block]);
        blockChangedListener(tool)(rowChanged(one.block));
        await Promise.resolve();

        expect((tool as unknown as { cardDrawer: DatabaseCardDrawer | null }).cardDrawer?.isOpen).not.toBe(true);

        tool.destroy();
      });
    });

    it('does not redraw the board for its own row writes', async () => {
      const { block } = liveRowBlock('row-1', { position: 'a0', properties: { 'prop-title': 'One', 'prop-status': 'opt-todo' } });
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks: [block] }));
      const element = tool.render();

      tool.rendered();
      const board = queryByData(element, 'data-blok-database-board');

      (tool as unknown as { moveRowBlock: (rowId: string, position: string) => void }).moveRowBlock('row-1', 'a3');
      blockChangedListener(tool)(rowChanged(block));
      await Promise.resolve();

      expect(queryByData(element, 'data-blok-database-board')).toBe(board);

      tool.destroy();
    });

    describe('a row change under an open inline edit or drag', () => {
      const twoRows = (): { one: ReturnType<typeof liveRowBlock>; two: ReturnType<typeof liveRowBlock>; tool: DatabaseTool; element: HTMLElement } => {
        const one = liveRowBlock('row-1', { position: 'a0', properties: { 'prop-title': 'One', 'prop-status': 'opt-todo' } });
        const two = liveRowBlock('row-2', { position: 'a1', properties: { 'prop-title': 'Two', 'prop-status': 'opt-todo' } });
        const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks: [one.block, two.block] }));
        const element = tool.render();

        document.body.appendChild(element);
        tool.rendered();

        return { one, two, tool, element };
      };

      const openCardTitleEdit = (element: HTMLElement, rowId: string): HTMLInputElement => {
        queryAllByData(element, 'data-row-id', rowId).find((el) => el.hasAttribute('data-blok-database-edit-card'))?.click();

        return queryByData(element, 'data-blok-database-card-title-input') as HTMLInputElement;
      };

      afterEach(() => {
        document.body.innerHTML = '';
      });

      it('keeps a half-typed card title when a peer renames another card', async () => {
        const { two, tool, element } = twoRows();
        const input = openCardTitleEdit(element, 'row-1');

        input.value = 'One half typed';
        two.row.setData({ position: 'a1', properties: { 'prop-title': 'Two (peer)', 'prop-status': 'opt-todo' } });
        blockChangedListener(tool)(rowChanged(two.block));
        await Promise.resolve();

        expect(element.contains(input)).toBe(true);
        expect(input.value).toBe('One half typed');
        expect(cardTitles(element)).toEqual(['Two (peer)']);

        tool.destroy();
      });

      it('updates a renamed card in place without rebuilding the board', async () => {
        const { two, tool, element } = twoRows();
        const board = queryByData(element, 'data-blok-database-board');

        two.row.setData({ position: 'a1', properties: { 'prop-title': 'Two (peer)', 'prop-status': 'opt-todo' } });
        blockChangedListener(tool)(rowChanged(two.block));
        await Promise.resolve();

        expect(queryByData(element, 'data-blok-database-board')).toBe(board);
        expect(cardTitles(element)).toEqual(['One', 'Two (peer)']);

        tool.destroy();
      });

      it('moves a card to its new column only after the open card title edit ends', async () => {
        const { two, tool, element } = twoRows();
        const input = openCardTitleEdit(element, 'row-1');

        input.value = 'One edited';
        two.row.setData({ position: 'a1', properties: { 'prop-title': 'Two', 'prop-status': 'opt-done' } });
        blockChangedListener(tool)(rowChanged(two.block));
        await Promise.resolve();

        expect(element.contains(input)).toBe(true);

        fireEvent.keyDown(input, { key: 'Enter' });
        fireEvent.keyUp(queryByData(element, 'data-blok-database-card-title', /.*/) ?? document.body, { key: 'Enter' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        const doneColumn = queryAllByData(element, 'data-option-id', 'opt-done').find((el) => el.hasAttribute('data-blok-database-column')) as HTMLElement;

        expect(queryAllByData(doneColumn, 'data-blok-database-card-title').map((el) => el.textContent)).toEqual(['Two']);

        tool.destroy();
      });

      it('keeps a card drag going when a peer changes another card', async () => {
        const { two, tool, element } = twoRows();
        const cardDrag = (tool as unknown as { cardDrag: DatabaseCardDrag }).cardDrag;
        const dragging = (): HTMLElement | null => queryByData(element, 'data-blok-database-dragging');

        cardDrag.beginTracking('row-1', 0, 0);
        document.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 50 }));

        const draggedBoard = dragging();

        expect(draggedBoard).not.toBeNull();

        two.row.setData({ position: 'a1', properties: { 'prop-title': 'Two', 'prop-status': 'opt-done' } });
        blockChangedListener(tool)(rowChanged(two.block));
        await Promise.resolve();

        expect(dragging()).toBe(draggedBoard);

        tool.destroy();
      });

      it('ignores a row change in another database', async () => {
        const { tool } = twoRows();
        const api = (tool as unknown as { api: API }).api;
        const foreign = liveRowBlock('row-x', { position: 'a0', properties: { 'prop-title': 'X', 'prop-status': 'opt-todo' } });

        Object.defineProperty(foreign.block, 'parentId', { value: 'other-database' });
        vi.mocked(api.blocks.getChildren).mockClear();
        blockChangedListener(tool)(rowChanged(foreign.block));
        await Promise.resolve();

        expect(api.blocks.getChildren).not.toHaveBeenCalled();

        tool.destroy();
      });
    });

    it('stops listening for row changes when destroyed', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const listener = blockChangedListener(tool);
      const api = (tool as unknown as { api: API }).api;

      tool.render();
      tool.destroy();

      expect(api.events.off).toHaveBeenCalledWith('block changed', listener);
    });

    it('places a moved card by its new position before the row has saved', () => {
      const first = liveRowBlock('row-1', { position: 'a0', properties: { 'prop-title': 'One', 'prop-status': 'opt-todo' } });
      const second = liveRowBlock('row-2', { position: 'a1', properties: { 'prop-title': 'Two', 'prop-status': 'opt-todo' } });
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks: [first.block, second.block] }));

      tool.render();
      tool.rendered();
      (tool as unknown as { moveRowBlock: (rowId: string, position: string) => void }).moveRowBlock('row-1', 'a2');

      const model = (tool as unknown as { model: DatabaseModel }).model;

      expect(model.getOrderedRows().map((r) => r.id)).toEqual(['row-2', 'row-1']);

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
      const boardArea = queryByData(element, 'data-blok-database-board')!;

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
      const newBoardArea = queryByData(element, 'data-blok-database-board')!;

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

      const boardArea = queryByData(element, 'data-blok-database-board')!;

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

      const newBoardArea = queryByData(element, 'data-blok-database-board')!;

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
      expect(queryByData(element, 'data-blok-database-list')).not.toBeNull();
      expect(queryByData(element, 'data-blok-database-board')).toBeNull();
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

    it('clicking add-row button calls api.blocks.insertAt with database-row', () => {
      const options = createDatabaseOptions(makeListData(), {}, { childBlocks: makeListChildBlocks() });
      const tool = new DatabaseTool(options);
      const element = tool.render();
      tool.rendered();
      const addBtn = queryByData(element, 'data-blok-database-add-row')!;
      addBtn.click();
      expect(options.api.blocks.insertAt).toHaveBeenCalledTimes(1);
      const insertCall = (options.api.blocks.insertAt as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(insertCall[0]).toBe('database-row');
      expect(insertCall[2]).toMatchObject({ parentId: 'test-block-id', position: 'end' });
    });

    it('clicking delete-row button calls api.blocks.delete', () => {
      const childBlocks = makeListChildBlocks();
      const options = createDatabaseOptions(makeListData(), {}, { childBlocks });

      (options.api.blocks.getBlockIndex as ReturnType<typeof vi.fn>).mockReturnValue(1);

      const tool = new DatabaseTool(options);
      const element = tool.render();
      tool.rendered();
      const deleteBtn = queryByData(element, 'data-blok-database-delete-row')!;
      deleteBtn.click();
      expect(options.api.blocks.delete).toHaveBeenCalledTimes(1);
      // Observable behavior: the row should be removed from the model
      expect(queryAllByData(element, 'data-blok-database-list-row')).toHaveLength(1);
    });

    it('clicking a list row opens the card drawer', () => {
      const options = createDatabaseOptions(makeListData(), {}, { childBlocks: makeListChildBlocks() });
      const tool = new DatabaseTool(options);
      const element = tool.render();
      tool.rendered();
      const row = queryByData(element, 'data-blok-database-list-row')!;
      row.click();
      expect(queryByData(element, 'data-blok-database-drawer')).not.toBeNull();
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
      expect(queryByData(element, 'data-blok-database-board')).not.toBeNull();
      const tab2 = queryByData(element, 'data-view-id', 'view-2')!;
      tab2.click();
      expect(queryByData(element, 'data-blok-database-list')).not.toBeNull();
      expect(queryByData(element, 'data-blok-database-board')).toBeNull();
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
      expect(queryAllByData(element, 'data-blok-database-list-group')).toHaveLength(3);
    });

    it('adds a row to the end of the clicked group in a grouped list and syncs it', async () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' }, position: 'a0' }),
      ];
      const adapter: DatabaseAdapter = {
        loadDatabase: vi.fn(),
        createRow: vi.fn(),
        updateRow: vi.fn(),
        moveRow: vi.fn(),
        deleteRow: vi.fn(),
        createProperty: vi.fn(),
        updateProperty: vi.fn(),
        deleteProperty: vi.fn(),
        createView: vi.fn(),
        updateView: vi.fn(),
        deleteView: vi.fn(),
      };
      const data = makeListData({
        views: [{ id: 'view-list', name: 'List', type: 'list', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [] }],
      });
      const options = createDatabaseOptions(data, { adapter }, { childBlocks });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      document.body.appendChild(element);
      tool.rendered();

      const todoGroup = queryByData(element, 'data-option-id', 'opt-todo');

      expect(todoGroup).not.toBeNull();
      if (todoGroup === null) return;

      const addBtn = queryByData(todoGroup, 'data-blok-database-add-row');

      expect(addBtn).not.toBeNull();
      addBtn?.click();

      const rows = queryAllByData(todoGroup, 'data-blok-database-list-row');

      expect(rows).toHaveLength(2);
      expect(rows[1].getAttribute('data-row-id')).not.toBe('row-1');
      expect(rows[1].parentElement?.hasAttribute('data-blok-database-list-rows')).toBe(true);
      await vi.waitFor(() => {
        expect(adapter.createRow).toHaveBeenCalledTimes(1);
      });
      expect(adapter.createRow).toHaveBeenCalledWith(expect.objectContaining({
        properties: expect.objectContaining({ 'prop-status': 'opt-todo' }),
      }));

      element.remove();
    });
  });

  describe('multi-view orchestration', () => {
    it('renders a tab bar above the board', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();

      expect(queryByData(element, 'data-blok-database-tab-bar')).not.toBeNull();
    });

    it('localizes newly added view names without persisting translated names', () => {
      const options = createDatabaseOptions();
      const translations: Record<string, string> = {
        'tools.database.defaultViewBoard': 'Tafel',
        'tools.database.viewTypeList': 'Liste',
      };

      options.api.i18n.t = vi.fn((key: string) => translations[key] ?? key);

      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.addView('list');
      tool.addView('board');

      const viewNames = queryAllByData(element, 'data-blok-database-tab-name');

      expect(viewNames.map((name) => name.textContent)).toEqual(['Tafel', 'Liste', 'Tafel']);
      expect(tool.save(element).views.map((view) => view.name)).toEqual([
        'Board',
        'List',
        'Board',
      ]);

      tool.destroy();
    });

    it('renders one tab for the default view', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();

      expect(queryAllByData(element, 'data-blok-database-tab')).toHaveLength(1);
    });

    it('renders the board area below the tab bar', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();

      expect(queryByData(element, 'data-blok-database-board')).not.toBeNull();
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
      expect(queryAllByData(element, 'data-blok-database-tab')).toHaveLength(2);

      // Click the second tab
      const tab2 = queryByData(element, 'data-view-id', 'view-2')!;

      tab2.click();

      // After click, the board should still be rendered (same data, different view)
      expect(queryByData(element, 'data-blok-database-board')).not.toBeNull();
    });

    it('renders a tab bar in read-only mode (navigation is not an edit action)', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: true }));
      const element = tool.render();

      expect(queryByData(element, 'data-blok-database-tab-bar')).not.toBeNull();
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
    it('passes client-generated row ID to api.blocks.insertAt', () => {
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
      const addCardBtn = queryByData(element, 'data-blok-database-add-card')!;

      addCardBtn.click();

      expect(options.api.blocks.insertAt).toHaveBeenCalledTimes(1);
      const insertCall = (options.api.blocks.insertAt as ReturnType<typeof vi.fn>).mock.calls[0];
      const rowId = (insertCall[2] as { id: string }).id;

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

  describe('setReadOnly()', () => {
    it('setReadOnly method exists on prototype (enables fast-path in-place toggle)', () => {
      expect(typeof DatabaseTool.prototype.setReadOnly).toBe('function');
    });

    it('entering read-only hides add-card buttons from DOM', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: false }));
      const element = tool.render();

      document.body.appendChild(element);

      expect(queryAllByData(element, 'data-blok-database-add-card').length).toBeGreaterThan(0);

      tool.setReadOnly(true);

      expect(queryAllByData(element, 'data-blok-database-add-card')).toHaveLength(0);

      element.remove();
      tool.destroy();
    });

    it('entering read-only hides add-column button from DOM', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: false }));
      const element = tool.render();

      document.body.appendChild(element);

      expect(queryByData(element, 'data-blok-database-add-column')).not.toBeNull();

      tool.setReadOnly(true);

      expect(queryByData(element, 'data-blok-database-add-column')).toBeNull();

      element.remove();
      tool.destroy();
    });

    it('entering read-only sets title contenteditable to false', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: false }));
      const element = tool.render();

      document.body.appendChild(element);

      const titleEl = queryByData(element, 'data-blok-database-title');

      expect(titleEl?.getAttribute('contenteditable')).toBe('true');

      tool.setReadOnly(true);

      expect(titleEl?.getAttribute('contenteditable')).toBe('false');

      element.remove();
      tool.destroy();
    });

    it('tab bar is always present when entering read-only', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: false }));
      const element = tool.render();

      document.body.appendChild(element);

      expect(queryByData(element, 'data-blok-database-tab-bar')).not.toBeNull();

      tool.setReadOnly(true);

      expect(queryByData(element, 'data-blok-database-tab-bar')).not.toBeNull();

      element.remove();
      tool.destroy();
    });

    it('entering read-only hides the add-view button', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: false }));
      const element = tool.render();

      document.body.appendChild(element);

      expect(queryByData(element, 'data-blok-database-add-view')).not.toBeNull();

      tool.setReadOnly(true);

      expect(queryByData(element, 'data-blok-database-add-view')).toBeNull();

      element.remove();
      tool.destroy();
    });

    it('tab bar is present when initially rendered in read-only mode', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: true }));
      const element = tool.render();

      document.body.appendChild(element);

      expect(queryByData(element, 'data-blok-database-tab-bar')).not.toBeNull();

      element.remove();
      tool.destroy();
    });

    it('add-view button is hidden when initially rendered in read-only mode', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: true }));
      const element = tool.render();

      document.body.appendChild(element);

      expect(queryByData(element, 'data-blok-database-add-view')).toBeNull();

      element.remove();
      tool.destroy();
    });

    it('exiting read-only restores add-card buttons in DOM', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: true }));
      const element = tool.render();

      document.body.appendChild(element);

      expect(queryAllByData(element, 'data-blok-database-add-card')).toHaveLength(0);

      tool.setReadOnly(false);

      expect(queryAllByData(element, 'data-blok-database-add-card').length).toBeGreaterThan(0);

      element.remove();
      tool.destroy();
    });

    it('exiting read-only restores add-column button in DOM', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: true }));
      const element = tool.render();

      document.body.appendChild(element);

      expect(queryByData(element, 'data-blok-database-add-column')).toBeNull();

      tool.setReadOnly(false);

      expect(queryByData(element, 'data-blok-database-add-column')).not.toBeNull();

      element.remove();
      tool.destroy();
    });

    it('exiting read-only restores title contenteditable to true', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: true }));
      const element = tool.render();

      document.body.appendChild(element);

      const titleEl = queryByData(element, 'data-blok-database-title');

      expect(titleEl?.getAttribute('contenteditable')).toBeNull();

      tool.setReadOnly(false);

      expect(titleEl?.getAttribute('contenteditable')).toBe('true');

      element.remove();
      tool.destroy();
    });

    it('exiting read-only shows the add-view button', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: true }));
      const element = tool.render();

      document.body.appendChild(element);

      expect(queryByData(element, 'data-blok-database-add-view')).toBeNull();

      tool.setReadOnly(false);

      expect(queryByData(element, 'data-blok-database-add-view')).not.toBeNull();

      element.remove();
      tool.destroy();
    });

    it('setReadOnly is idempotent when called with the same state (true->true)', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: false }));
      const element = tool.render();

      document.body.appendChild(element);

      tool.setReadOnly(true);
      expect(() => tool.setReadOnly(true)).not.toThrow();

      expect(queryByData(element, 'data-blok-database-add-column')).toBeNull();

      element.remove();
      tool.destroy();
    });

    it('setReadOnly is idempotent when called with the same state (false->false)', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: false }));
      const element = tool.render();

      document.body.appendChild(element);

      expect(() => tool.setReadOnly(false)).not.toThrow();

      expect(queryByData(element, 'data-blok-database-add-column')).not.toBeNull();

      element.remove();
      tool.destroy();
    });

    // Collab boots every block read-only, then flips it in place.
    it.each(['Enter', 'Tab'])('exiting read-only makes %s in the title commit like an editable boot', (key) => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: true }));
      const element = tool.render();

      document.body.appendChild(element);
      tool.setReadOnly(false);

      const titleEl = queryByData(element, 'data-blok-database-title');

      if (titleEl === null) {
        throw new Error('title element missing');
      }

      const blurSpy = vi.spyOn(titleEl, 'blur');
      const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true });

      titleEl.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(blurSpy).toHaveBeenCalledTimes(1);

      element.remove();
      tool.destroy();
    });

    it('title Enter does nothing again after re-entering read-only', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: false }));
      const element = tool.render();

      document.body.appendChild(element);
      tool.setReadOnly(true);

      const titleEl = queryByData(element, 'data-blok-database-title');

      if (titleEl === null) {
        throw new Error('title element missing');
      }

      const blurSpy = vi.spyOn(titleEl, 'blur');
      const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });

      titleEl.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(blurSpy).not.toHaveBeenCalled();

      element.remove();
      tool.destroy();
    });

    it('toggling read-only repeatedly does not stack title Enter handlers', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: true }));
      const element = tool.render();

      document.body.appendChild(element);
      tool.setReadOnly(false);
      tool.setReadOnly(true);
      tool.setReadOnly(false);

      const titleEl = queryByData(element, 'data-blok-database-title');

      if (titleEl === null) {
        throw new Error('title element missing');
      }

      const blurSpy = vi.spyOn(titleEl, 'blur');

      titleEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true }));

      expect(blurSpy).toHaveBeenCalledTimes(1);

      element.remove();
      tool.destroy();
    });
  });

  describe('read-only after a rerender', () => {
    const makeBoardRows = (): BlockAPI[] => [
      createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' }, position: 'a0' }),
    ];

    const getCard = (element: HTMLElement): HTMLElement => {
      const card = queryByData(element, 'data-row-id', 'row-1');

      if (card === null) {
        throw new Error('card missing');
      }

      return card;
    };

    it('entering read-only leaves cards inert: no drag start, no drawer', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks: makeBoardRows() }));
      const element = tool.render();

      tool.rendered();
      tool.setReadOnly(true);

      const notPrevented = fireEvent.pointerDown(getCard(element), { clientX: 0, clientY: 0 });

      getCard(element).click();

      expect(queryByData(element, 'data-blok-database-drawer')).toBeNull();
      expect(notPrevented).toBe(true);

      tool.destroy();
    });

    it('rows that arrive after a read-only boot stay inert: no drag start, no drawer', () => {
      const options = createDatabaseOptions({}, {}, { readOnly: true });

      (options.api.blocks.getChildren as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce([])
        .mockReturnValue(makeBoardRows());

      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();

      const notPrevented = fireEvent.pointerDown(getCard(element), { clientX: 0, clientY: 0 });

      getCard(element).click();

      expect(queryByData(element, 'data-blok-database-drawer')).toBeNull();
      expect(notPrevented).toBe(true);

      tool.destroy();
    });

    it('leaving read-only wires cards again', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: true, childBlocks: makeBoardRows() }));
      const element = tool.render();

      tool.rendered();
      tool.setReadOnly(false);

      const notPrevented = fireEvent.pointerDown(getCard(element), { clientX: 0, clientY: 0 });

      getCard(element).click();

      expect(queryByData(element, 'data-blok-database-drawer')).not.toBeNull();
      expect(notPrevented).toBe(false);

      tool.destroy();
    });
  });

  describe('getToolbarAnchorElement', () => {
    it('returns the database title element so the toolbar vertically centers on the title line', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const rendered = tool.render();

      document.body.appendChild(rendered);

      const anchor = tool.getToolbarAnchorElement();
      const titleEl = queryByData(rendered, 'data-blok-database-title');

      expect(titleEl).not.toBeNull();
      expect(anchor).toBe(titleEl);

      rendered.remove();
      tool.destroy();
    });

    it('returns undefined before render() is called', () => {
      const tool = new DatabaseTool(createDatabaseOptions());

      expect(tool.getToolbarAnchorElement()).toBeUndefined();
    });
  });

  describe('backend error notification is HTML-escaped (XSS)', () => {
    it('escapes backend error message before passing it to notifier.show', async () => {
      const error = new Error('<img src=x onerror=alert(document.domain)>');
      const mockAdapter = {
        loadDatabase: vi.fn().mockResolvedValue({ schema: [], views: [] }),
        createRow: vi.fn().mockRejectedValue(error),
        updateRow: vi.fn(), moveRow: vi.fn(), deleteRow: vi.fn(),
        createProperty: vi.fn(), updateProperty: vi.fn(), deleteProperty: vi.fn(),
        createView: vi.fn(), updateView: vi.fn(), deleteView: vi.fn(),
      };

      const options = createDatabaseOptions({}, { adapter: mockAdapter });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      // Adding a card triggers sync.syncCreateRow, which rejects and fires onError.
      const addCardBtn = queryByData(element, 'data-blok-database-add-card')!;

      addCardBtn.click();

      const showMock = options.api.notifier.show as ReturnType<typeof vi.fn>;

      await vi.waitFor(() => {
        expect(showMock).toHaveBeenCalled();
      });

      const message = (showMock.mock.calls[0][0] as { message: string }).message;

      // Raw HTML must NOT reach the notifier (it would be injected via innerHTML).
      expect(message).not.toContain('<img');
      // Special chars must be entity-escaped instead.
      expect(message).toContain('&lt;img');

      tool.destroy();
    });
  });

  describe('column position ordering (regression)', () => {
    /** Reads the current select options of the group-by property off the tool's model. */
    const readOptions = (tool: DatabaseTool): Array<{ id: string; position: string }> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = (tool as any).model as DatabaseModel;
      const prop = model.getProperty('prop-status');

      return (prop?.config?.options ?? []).map((o) => ({ id: o.id, position: o.position }));
    };

    /** Fires the private column-drag onDrop callback. */
    const dropColumn = (tool: DatabaseTool, result: GroupDragResult): void => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const columnDrag = (tool as any).columnDrag as DatabaseColumnDrag;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onDrop = (columnDrag as any).onDrop as (r: GroupDragResult) => void;

      onDrop(result);
    };

    it('keeps stored option array sorted by position after a column drop', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();
      const container = document.createElement('div');

      container.appendChild(element);
      document.body.appendChild(container);

      // Move the last column (opt-done, position a2) to the very front.
      dropColumn(tool, { optionId: 'opt-done', beforeOptionId: 'opt-todo', afterOptionId: null });

      const positions = readOptions(tool).map((o) => o.position);
      const sorted = [...positions].sort((a, b) => (a < b ? -1 : 1));

      expect(positions).toEqual(sorted);

      tool.destroy();
      container.remove();
    });

    it('gives a newly added column a position after every existing column', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();
      const container = document.createElement('div');

      container.appendChild(element);
      document.body.appendChild(container);

      // Reorder first: this leaves the stored array order stale relative to positions.
      dropColumn(tool, { optionId: 'opt-done', beforeOptionId: 'opt-todo', afterOptionId: null });

      const before = readOptions(tool);

      queryByData(element, 'data-blok-database-add-column')!.click();

      const after = readOptions(tool);
      const added = after.filter((o) => !before.some((b) => b.id === o.id));

      expect(added).toHaveLength(1);

      const maxExisting = before.map((o) => o.position).sort((a, b) => (a < b ? -1 : 1)).pop()!;

      expect(added[0].position > maxExisting).toBe(true);

      // No duplicate positions may exist.
      expect(new Set(after.map((o) => o.position)).size).toBe(after.length);

      tool.destroy();
      container.remove();
    });

    it('never asks positionBetween for an out-of-order key pair after reorder + add column', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();
      const container = document.createElement('div');

      container.appendChild(element);
      document.body.appendChild(container);

      dropColumn(tool, { optionId: 'opt-done', beforeOptionId: 'opt-todo', afterOptionId: null });
      queryByData(element, 'data-blok-database-add-column')!.click();

      // DOM order is now: done, todo, doing, <new>. Dragging `done` between the
      // last two DOM neighbours must not produce after > before.
      const newId = readOptions(tool).map((o) => o.id).find((id) => !['opt-todo', 'opt-doing', 'opt-done'].includes(id))!;

      expect(() => {
        dropColumn(tool, { optionId: 'opt-done', beforeOptionId: newId, afterOptionId: 'opt-doing' });
      }).not.toThrow();

      const positions = readOptions(tool).map((o) => o.position);

      expect(new Set(positions).size).toBe(positions.length);
      expect(positions).toEqual([...positions].sort((a, b) => (a < b ? -1 : 1)));

      tool.destroy();
      container.remove();
    });
  });

  describe('no-value group', () => {
    const interpolatingT = (key: string, vars?: Record<string, string | number>): string => {
      if (key === 'tools.database.noValueGroup') return `No ${String(vars?.property)}`;

      return key === 'tools.database.defaultStatusProperty' ? 'Status' : key;
    };

    const renderBoard = (rows: Array<{ id: string; properties: Record<string, unknown> }>): {
      tool: DatabaseTool;
      element: HTMLElement;
      options: BlockToolConstructorOptions<DatabaseData, DatabaseConfig>;
    } => {
      const childBlocks = rows.map((r, i) => createMockRowBlock({ id: r.id, properties: r.properties, position: `a${i}` }));
      const options = createDatabaseOptions({}, {}, { childBlocks });

      options.api.i18n.t = interpolatingT;

      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();

      return { tool, element, options };
    };

    const noValueColumn = (element: HTMLElement): HTMLElement | null =>
      queryByData(element, 'data-blok-database-no-value-group');

    it('shows a row with no group value on the board, in a first "No <property>" column', () => {
      const { tool, element } = renderBoard([
        { id: 'row-empty', properties: { 'prop-title': 'Loose', 'prop-status': null } },
        { id: 'row-todo', properties: { 'prop-title': 'Todo', 'prop-status': 'opt-todo' } },
      ]);

      const card = queryAllByData(element, 'data-row-id', 'row-empty').find((el) => el.hasAttribute('data-blok-database-card'));

      expect(card).toBeDefined();

      const column = noValueColumn(element);

      expect(column).not.toBeNull();
      expect(column?.contains(card ?? null)).toBe(true);
      expect(queryAllByData(element, 'data-blok-database-column')[0]).toBe(column);
      expect(queryByData(column ?? element, 'data-blok-database-no-value-label')?.textContent).toBe('No Status');
      // Only real options are rename targets; the first column-title on a board must be a renameable option.
      expect(queryByData(column ?? element, 'data-blok-database-column-title')).toBeNull();

      tool.destroy();
    });

    it('keeps the no-value column on an empty board so a card can be dropped into it', () => {
      const { tool, element } = renderBoard([]);

      expect(noValueColumn(element)).not.toBeNull();

      tool.destroy();
    });

    it('gives the no-value column no delete button and no rename', () => {
      const { tool, element } = renderBoard([]);
      const column = noValueColumn(element);

      expect(column).not.toBeNull();
      expect(queryByData(column ?? element, 'data-blok-database-delete-column')).toBeNull();

      const title = queryByData(column ?? element, 'data-blok-database-column-title');

      title?.click();

      expect(queryByData(column ?? element, 'data-blok-database-column-title-input')).toBeNull();

      tool.destroy();
    });

    it('creates a row with no group value from "+ New" in the no-value column', () => {
      const { tool, element, options } = renderBoard([]);
      const column = noValueColumn(element);
      const addCard = queryByData(column ?? element, 'data-blok-database-add-card');

      expect(addCard).not.toBeNull();
      addCard?.click();

      const insertAt = vi.mocked(options.api.blocks.insertAt);

      expect(insertAt).toHaveBeenCalledTimes(1);

      const data = insertAt.mock.calls[0][1] as DatabaseRowData;

      expect(data.properties).not.toHaveProperty('prop-status');

      tool.destroy();
    });

    it('clears the group value when a card is dropped into the no-value column', () => {
      const { tool, element, options } = renderBoard([
        { id: 'row-todo', properties: { 'prop-title': 'Todo', 'prop-status': 'opt-todo' } },
      ]);
      const column = noValueColumn(element);
      const toOptionId = column?.getAttribute('data-option-id') ?? 'missing';
      const cardDrag = (tool as unknown as { cardDrag: { onDrop: (r: CardDragResult) => void } }).cardDrag;
      const rowBlock = vi.mocked(options.api.blocks.getChildren).mock.results[0]?.value as BlockAPI[];

      cardDrag.onDrop({ rowId: 'row-todo', toOptionId, beforeRowId: null, afterRowId: null });

      expect(rowBlock[0].call).toHaveBeenCalledWith('updateProperties', { 'prop-status': null });

      tool.destroy();
    });

    it('never starts a column drag from the no-value column header', () => {
      const { tool, element } = renderBoard([]);
      const header = queryByData(noValueColumn(element) ?? element, 'data-blok-database-column-header');
      const columnDrag = (tool as unknown as { columnDrag: DatabaseColumnDrag }).columnDrag;
      const begin = vi.spyOn(columnDrag, 'beginTracking');

      expect(header).not.toBeNull();
      fireEvent.pointerDown(header ?? element, { clientX: 0, clientY: 0 });

      expect(begin).not.toHaveBeenCalled();

      tool.destroy();
    });

    it('shows a row with no group value in a grouped list', () => {
      const childBlocks = [createMockRowBlock({ id: 'row-empty', properties: { 'prop-title': 'Loose' }, position: 'a0' })];
      const options = createDatabaseOptions({
        views: [{ id: 'view-1', name: 'List', type: 'list', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [] }],
      }, {}, { childBlocks });

      options.api.i18n.t = interpolatingT;

      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();

      const row = queryAllByData(element, 'data-row-id', 'row-empty').find((el) => el.hasAttribute('data-blok-database-list-row'));

      expect(row).toBeDefined();

      tool.destroy();
    });
  });

  describe('grouping by a multiSelect property', () => {
    const tagsData = (): Partial<DatabaseData> => ({
      schema: [
        { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
        { id: 'prop-tags', name: 'Tags', type: 'multiSelect', position: 'a1', config: {
          options: [
            { id: 'opt-a', label: 'A', position: 'a0' },
            { id: 'opt-b', label: 'B', position: 'a1' },
            { id: 'opt-c', label: 'C', position: 'a2' },
          ],
        }},
      ],
      views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-tags', sorts: [], filters: [], visibleProperties: [] }],
    });

    const renderTagsBoard = (tags: string[]): {
      tool: DatabaseTool;
      element: HTMLElement;
      options: BlockToolConstructorOptions<DatabaseData, DatabaseConfig>;
      rowBlock: BlockAPI;
    } => {
      const rowBlock = createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task', 'prop-tags': tags }, position: 'a0' });
      const options = createDatabaseOptions(tagsData(), {}, { childBlocks: [rowBlock] });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();

      return { tool, element, options, rowBlock };
    };

    const cardsIn = (element: HTMLElement, optionId: string): HTMLElement[] => {
      const column = queryAllByData(element, 'data-option-id', optionId).find((el) => el.hasAttribute('data-blok-database-column'));

      return column === undefined ? [] : queryAllByData(column, 'data-blok-database-card');
    };

    const dropCard = (tool: DatabaseTool, result: CardDragResult): void => {
      (tool as unknown as { cardDrag: { onDrop: (r: CardDragResult) => void } }).cardDrag.onDrop(result);
    };

    it('shows a row in every option group it carries', () => {
      const { tool, element } = renderTagsBoard(['opt-a', 'opt-b']);

      expect(cardsIn(element, 'opt-a').map((c) => c.getAttribute('data-row-id'))).toEqual(['row-1']);
      expect(cardsIn(element, 'opt-b').map((c) => c.getAttribute('data-row-id'))).toEqual(['row-1']);
      expect(cardsIn(element, 'opt-c')).toHaveLength(0);

      tool.destroy();
    });

    it('replaces only the dragged-from option when a card moves to another group', () => {
      const { tool, element, rowBlock } = renderTagsBoard(['opt-a', 'opt-b']);
      const cardInA = cardsIn(element, 'opt-a')[0];

      fireEvent.pointerDown(cardInA, { clientX: 0, clientY: 0 });
      dropCard(tool, { rowId: 'row-1', toOptionId: 'opt-c', beforeRowId: null, afterRowId: null });

      expect(rowBlock.call).toHaveBeenCalledWith('updateProperties', { 'prop-tags': ['opt-c', 'opt-b'] });

      tool.destroy();
    });

    it('drops the dragged-from option when a card moves to a group the row already has', () => {
      const { tool, element, rowBlock } = renderTagsBoard(['opt-a', 'opt-b']);

      fireEvent.pointerDown(cardsIn(element, 'opt-a')[0], { clientX: 0, clientY: 0 });
      dropCard(tool, { rowId: 'row-1', toOptionId: 'opt-b', beforeRowId: null, afterRowId: null });

      expect(rowBlock.call).toHaveBeenCalledWith('updateProperties', { 'prop-tags': ['opt-b'] });

      tool.destroy();
    });

    it('removes the dragged-from option when a card moves to the no-value group', () => {
      const { tool, element, rowBlock } = renderTagsBoard(['opt-a', 'opt-b']);
      const noValueId = queryByData(element, 'data-blok-database-no-value-group')?.getAttribute('data-option-id') ?? 'missing';

      fireEvent.pointerDown(cardsIn(element, 'opt-b')[0], { clientX: 0, clientY: 0 });
      dropCard(tool, { rowId: 'row-1', toOptionId: noValueId, beforeRowId: null, afterRowId: null });

      expect(rowBlock.call).toHaveBeenCalledWith('updateProperties', { 'prop-tags': ['opt-a'] });

      tool.destroy();
    });

    it('fades the pressed copy of a multi-group card, not the first copy', () => {
      const { tool, element } = renderTagsBoard(['opt-a', 'opt-b']);
      const cardInB = cardsIn(element, 'opt-b')[0];
      const cardInA = cardsIn(element, 'opt-a')[0];

      fireEvent.pointerDown(cardInB, { clientX: 0, clientY: 0 });
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 40 }));

      expect(cardInB.style.opacity).toBe('0.4');
      expect(cardInA.style.opacity).toBe('');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      tool.destroy();
    });

    it('creates a row carrying the option as a list from "+ New" in a multiSelect group', () => {
      const { tool, element, options } = renderTagsBoard([]);
      const column = queryAllByData(element, 'data-option-id', 'opt-a').find((el) => el.hasAttribute('data-blok-database-column'));
      const addCard = queryByData(column ?? element, 'data-blok-database-add-card');

      addCard?.click();

      const data = vi.mocked(options.api.blocks.insertAt).mock.calls[0][1] as DatabaseRowData;

      expect(data.properties['prop-tags']).toEqual(['opt-a']);

      tool.destroy();
    });
  });

  // GATED ON USER DECISION D9: rows keep existing when their column is deleted.
  describe('deleting a board column', () => {
    const liveRowBlock = (id: string, properties: Record<string, PropertyValue>, position: string): BlockAPI => {
      const block = createMockRowBlock({ id, properties, position });
      const data = block.preservedData as DatabaseRowData;

      vi.mocked(block.call).mockImplementation((method: string, params?: unknown) => {
        if (method === 'updateProperties') Object.assign(data.properties, params);
      });

      return block;
    };

    const clickDelete = (element: HTMLElement, optionId: string): void => {
      queryAllByData(element, 'data-blok-database-delete-column')
        .find((el) => el.getAttribute('data-option-id') === optionId)
        ?.click();
    };

    it('keeps the rows and moves them to the no-value group', () => {
      const childBlocks = [
        liveRowBlock('row-1', { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' }, 'a0'),
        liveRowBlock('row-2', { 'prop-title': 'Task 2', 'prop-status': 'opt-todo' }, 'a1'),
      ];
      const options = createDatabaseOptions({}, {}, { childBlocks });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();
      clickDelete(element, 'opt-todo');

      expect(options.api.blocks.delete).not.toHaveBeenCalled();
      expect(childBlocks[0].call).toHaveBeenCalledWith('updateProperties', { 'prop-status': null });
      expect(childBlocks[1].call).toHaveBeenCalledWith('updateProperties', { 'prop-status': null });

      const noValue = queryByData(element, 'data-blok-database-no-value-group');
      const cardIds = queryAllByData(noValue ?? element, 'data-blok-database-card').map((c) => c.getAttribute('data-row-id'));

      expect(cardIds).toEqual(['row-1', 'row-2']);
      expect(queryAllByData(element, 'data-option-id', 'opt-todo')).toHaveLength(0);

      tool.destroy();
    });

    it('removes only the deleted option from a multiSelect row', () => {
      const row = liveRowBlock('row-1', { 'prop-title': 'Task', 'prop-tags': ['opt-a', 'opt-b'] }, 'a0');
      const options = createDatabaseOptions({
        schema: [
          { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
          { id: 'prop-tags', name: 'Tags', type: 'multiSelect', position: 'a1', config: {
            options: [
              { id: 'opt-a', label: 'A', position: 'a0' },
              { id: 'opt-b', label: 'B', position: 'a1' },
            ],
          }},
        ],
        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-tags', sorts: [], filters: [], visibleProperties: [] }],
      }, {}, { childBlocks: [row] });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();
      clickDelete(element, 'opt-a');

      expect(options.api.blocks.delete).not.toHaveBeenCalled();
      expect(row.call).toHaveBeenCalledWith('updateProperties', { 'prop-tags': ['opt-b'] });

      tool.destroy();
    });
  });

  describe('saved filters and sorts apply to the rendered view', () => {
    const titlesIn = (element: HTMLElement, attr: string): string[] =>
      queryAllByData(element, attr).map((el) => el.textContent ?? '');

    it('hides a card that a saved filter excludes, and keeps every column', () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-keep', properties: { 'prop-title': 'Keep me', 'prop-status': 'opt-todo' }, position: 'a0' }),
        createMockRowBlock({ id: 'row-drop', properties: { 'prop-title': 'Drop me', 'prop-status': 'opt-todo' }, position: 'a1' }),
      ];
      const data = makeDefaultData({
        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], visibleProperties: [],
          filters: [{ propertyId: 'prop-title', operator: 'contains', value: 'keep' }] }],
      });
      const tool = new DatabaseTool(createDatabaseOptions(data, {}, { childBlocks }));
      const element = tool.render();

      tool.rendered();

      expect(queryByData(element, 'data-row-id', 'row-drop')).toBeNull();
      expect(queryByData(element, 'data-row-id', 'row-keep')).not.toBeNull();
      // 3 options plus the no-value column.
      expect(queryAllByData(element, 'data-blok-database-column')).toHaveLength(4);
    });

    it('orders list rows by a saved sort instead of by position', () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-c', properties: { 'prop-title': 'Cherry' }, position: 'a0' }),
        createMockRowBlock({ id: 'row-a', properties: { 'prop-title': 'Apple' }, position: 'a1' }),
        createMockRowBlock({ id: 'row-b', properties: { 'prop-title': 'Banana' }, position: 'a2' }),
      ];
      const data = makeDefaultData({
        views: [{ id: 'view-list', name: 'List', type: 'list', position: 'a0', filters: [], visibleProperties: [],
          sorts: [{ propertyId: 'prop-title', direction: 'asc' }] }],
        activeViewId: 'view-list',
      });
      const tool = new DatabaseTool(createDatabaseOptions(data, {}, { childBlocks }));
      const element = tool.render();

      tool.rendered();

      expect(titlesIn(element, 'data-blok-database-list-row-title')).toEqual(['Apple', 'Banana', 'Cherry']);
    });

    it('still clears the group of a row a filter hides when its column is deleted', () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-shown', properties: { 'prop-title': 'Shown', 'prop-status': 'opt-todo' }, position: 'a0' }),
        createMockRowBlock({ id: 'row-hidden', properties: { 'prop-title': 'Hidden', 'prop-status': 'opt-todo' }, position: 'a1' }),
      ];
      const data = makeDefaultData({
        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], visibleProperties: [],
          filters: [{ propertyId: 'prop-title', operator: 'equals', value: 'shown' }] }],
      });
      const options = createDatabaseOptions(data, {}, { childBlocks });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();
      queryAllByData(element, 'data-blok-database-delete-column')
        .find((el) => el.getAttribute('data-option-id') === 'opt-todo')!
        .click();

      expect(childBlocks[1].call).toHaveBeenCalledWith('updateProperties', { 'prop-status': null });
      expect(options.api.blocks.delete).not.toHaveBeenCalled();
    });
  });

  describe('a peer retitle in a view that sorts or filters by title', () => {
    /** Sets a row's title the way a peer or undo does, then lets the redraw run. */
    const peerRetitle = async (tool: DatabaseTool, block: BlockAPI, title: string): Promise<void> => {
      const api = (tool as unknown as { api: API }).api;
      const listener = vi.mocked(api.events.on).mock.calls.find(([name]) => name === 'block changed')?.[1] as (payload: unknown) => void;

      const row = block.preservedData as DatabaseRowData;

      row.properties['prop-title'] = title;
      listener({ event: { type: 'block-changed', detail: { target: block } } });
      await Promise.resolve();
    };

    const cardIds = (element: HTMLElement): string[] =>
      queryAllByData(element, 'data-blok-database-card').map((el) => el.getAttribute('data-row-id') ?? '');

    it('re-sorts the board when a peer changes a title the view sorts by', async () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-a', properties: { 'prop-title': 'A', 'prop-status': 'opt-todo' }, position: 'a0' }),
        createMockRowBlock({ id: 'row-b', properties: { 'prop-title': 'B', 'prop-status': 'opt-todo' }, position: 'a1' }),
      ];
      const tool = new DatabaseTool(createDatabaseOptions({
        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', filters: [], visibleProperties: [],
          sorts: [{ propertyId: 'prop-title', direction: 'asc' }] }],
      }, {}, { childBlocks }));
      const element = tool.render();

      tool.rendered();
      await peerRetitle(tool, childBlocks[0], 'Z');

      expect(cardIds(element)).toEqual(['row-b', 'row-a']);

      tool.destroy();
    });

    it('hides a list row when a peer retitles it out of a title filter', async () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Keep one' }, position: 'a0' }),
        createMockRowBlock({ id: 'row-2', properties: { 'prop-title': 'Keep two' }, position: 'a1' }),
      ];
      const tool = new DatabaseTool(createDatabaseOptions({
        views: [{ id: 'view-list', name: 'List', type: 'list', position: 'a0', sorts: [], visibleProperties: [],
          filters: [{ propertyId: 'prop-title', operator: 'contains', value: 'keep' }] }],
        activeViewId: 'view-list',
      }, {}, { childBlocks }));
      const element = tool.render();

      tool.rendered();
      await peerRetitle(tool, childBlocks[0], 'Gone');

      expect(queryAllByData(element, 'data-blok-database-list-row-title').map((el) => el.textContent)).toEqual(['Keep two']);

      tool.destroy();
    });

    it('waits for an open card title edit to end before re-sorting', async () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-a', properties: { 'prop-title': 'A', 'prop-status': 'opt-todo' }, position: 'a0' }),
        createMockRowBlock({ id: 'row-b', properties: { 'prop-title': 'B', 'prop-status': 'opt-todo' }, position: 'a1' }),
      ];
      const tool = new DatabaseTool(createDatabaseOptions({
        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', filters: [], visibleProperties: [],
          sorts: [{ propertyId: 'prop-title', direction: 'asc' }] }],
      }, {}, { childBlocks }));
      const element = tool.render();

      document.body.appendChild(element);
      tool.rendered();
      queryAllByData(element, 'data-row-id', 'row-b').find((el) => el.hasAttribute('data-blok-database-edit-card'))?.click();
      const input = queryByData(element, 'data-blok-database-card-title-input') as HTMLInputElement;

      await peerRetitle(tool, childBlocks[0], 'Z');

      expect(element.contains(input)).toBe(true);
      expect(cardIds(element)).toEqual(['row-a', 'row-b']);

      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.keyUp(document.body, { key: 'Enter' });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(cardIds(element)).toEqual(['row-b', 'row-a']);

      tool.destroy();
      document.body.innerHTML = '';
    });
  });

  describe('drag in a sorted view (GATED ON D7)', () => {
    const sortedBoard = (): { tool: DatabaseTool; childBlocks: BlockAPI[] } => {
      // Sort order (A, B) is the reverse of position order (B at a0, A at a1).
      const childBlocks = [
        createMockRowBlock({ id: 'row-b', properties: { 'prop-title': 'B', 'prop-status': 'opt-todo' }, position: 'a0' }),
        createMockRowBlock({ id: 'row-a', properties: { 'prop-title': 'A', 'prop-status': 'opt-todo' }, position: 'a1' }),
        createMockRowBlock({ id: 'row-x', properties: { 'prop-title': 'X', 'prop-status': 'opt-todo' }, position: 'a2' }),
      ];
      const data = makeDefaultData({
        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', filters: [], visibleProperties: [],
          sorts: [{ propertyId: 'prop-title', direction: 'asc' }] }],
      });
      const tool = new DatabaseTool(createDatabaseOptions(data, {}, { childBlocks }));

      tool.render();
      tool.rendered();

      return { tool, childBlocks };
    };

    const dropCard = (tool: DatabaseTool, result: CardDragResult): void => {
      const cardDrag = (tool as unknown as { cardDrag: DatabaseCardDrag }).cardDrag;

      (cardDrag as unknown as { onDrop: (r: CardDragResult) => void }).onDrop(result);
    };

    const callsNamed = (block: BlockAPI, name: string): unknown[][] =>
      (block.call as ReturnType<typeof vi.fn>).mock.calls.filter((args) => args[0] === name);

    it('ignores a reorder inside the same column', () => {
      const { tool, childBlocks } = sortedBoard();
      const rowX = childBlocks[2];

      // Neighbours arrive in sort order (A then B), so their keys are out of order.
      expect(() => dropCard(tool, { rowId: 'row-x', toOptionId: 'opt-todo', beforeRowId: 'row-b', afterRowId: 'row-a' })).not.toThrow();
      expect(callsNamed(rowX, 'updatePosition')).toHaveLength(0);
    });

    it('moves a card to another column by its group value only', () => {
      const { tool, childBlocks } = sortedBoard();
      const rowX = childBlocks[2];

      dropCard(tool, { rowId: 'row-x', toOptionId: 'opt-doing', beforeRowId: null, afterRowId: null });

      expect(callsNamed(rowX, 'updateProperties')).toEqual([['updateProperties', { 'prop-status': 'opt-doing' }]]);
      expect(callsNamed(rowX, 'updatePosition')).toHaveLength(0);
    });

    it('turns list row drag off while the list is sorted', () => {
      const childBlocks = [createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'One' }, position: 'a0' })];
      const listView = (sorts: DatabaseViewConfig['sorts']): Partial<DatabaseData> => ({
        views: [{ id: 'view-list', name: 'List', type: 'list', position: 'a0', filters: [], visibleProperties: [], sorts }],
        activeViewId: 'view-list',
      });
      const sorted = new DatabaseTool(createDatabaseOptions(listView([{ propertyId: 'prop-title', direction: 'asc' }]), {}, { childBlocks }));
      const unsorted = new DatabaseTool(createDatabaseOptions(listView([]), {}, { childBlocks }));

      sorted.render();
      sorted.rendered();
      unsorted.render();
      unsorted.rendered();

      expect((sorted as unknown as { listRowDrag: unknown }).listRowDrag).toBeNull();
      expect((unsorted as unknown as { listRowDrag: unknown }).listRowDrag).not.toBeNull();
    });
  });

  describe('a row added in a filtered view', () => {
    /** Makes insertAt add the child the way the editor does, so later reads see it. */
    const insertingChildren = (options: BlockToolConstructorOptions<DatabaseData, DatabaseConfig>, childBlocks: BlockAPI[]): void => {
      vi.mocked(options.api.blocks.insertAt).mockImplementation((_type, data, placement) => {
        const row = data as DatabaseRowData;
        const id = (placement as { id: string }).id;

        childBlocks.push(createMockRowBlock({ id, properties: row.properties, position: row.position }));

        return { id } as BlockAPI;
      });
    };

    /** Redraws the view the way a peer edit to another row does. */
    const redrawForPeerMove = async (tool: DatabaseTool, block: BlockAPI): Promise<void> => {
      const api = (tool as unknown as { api: API }).api;
      const call = vi.mocked(api.events.on).mock.calls.find(([name]) => name === 'block changed');

      Object.assign(block.preservedData as DatabaseRowData, { position: 'a9' });
      (call?.[1] as (payload: unknown) => void)({ event: { type: 'block-changed', detail: { target: block } } });
      await Promise.resolve();
    };

    it('keeps the new list row visible after a redraw by taking the filter value', async () => {
      const childBlocks = [createMockRowBlock({ id: 'row-done', properties: { 'prop-title': 'Done one', 'prop-status': 'opt-done' }, position: 'a0' })];
      const options = createDatabaseOptions({
        views: [{ id: 'view-list', name: 'List', type: 'list', position: 'a0', sorts: [], visibleProperties: [],
          filters: [{ propertyId: 'prop-status', operator: 'equals', value: 'opt-done' }] }],
        activeViewId: 'view-list',
      }, {}, { childBlocks });

      insertingChildren(options, childBlocks);
      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();
      queryByData(element, 'data-blok-database-add-row')?.click();
      const newId = (vi.mocked(options.api.blocks.insertAt).mock.calls[0][2] as { id: string }).id;

      await redrawForPeerMove(tool, childBlocks[0]);

      expect(queryAllByData(element, 'data-row-id', newId)).not.toHaveLength(0);
      expect(vi.mocked(options.api.blocks.insertAt).mock.calls[0][1]).toMatchObject({ properties: { 'prop-status': 'opt-done' } });

      tool.destroy();
    });

    it('lets the column a card is added to win over a filter on another value', () => {
      const childBlocks: BlockAPI[] = [];
      const options = createDatabaseOptions({
        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], visibleProperties: [],
          filters: [{ propertyId: 'prop-status', operator: 'equals', value: 'opt-done' }] }],
      }, {}, { childBlocks });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();
      queryAllByData(element, 'data-blok-database-add-card')
        .find((el) => el.getAttribute('data-option-id') === 'opt-todo')
        ?.click();

      expect(vi.mocked(options.api.blocks.insertAt).mock.calls[0][1]).toMatchObject({ properties: { 'prop-status': 'opt-todo' } });

      tool.destroy();
    });
  });

  describe('a peer change during a drag on a sorted board', () => {
    /** A row whose saved data follows its updateProperties/updatePosition calls. */
    const writableRow = (id: string, properties: Record<string, PropertyValue>, position: string): BlockAPI => {
      const block = createMockRowBlock({ id, properties, position });
      const data = block.preservedData as DatabaseRowData;

      vi.mocked(block.call).mockImplementation((method: string, params?: unknown) => {
        if (method === 'updateProperties') Object.assign(data.properties, params);
      });

      return block;
    };

    /** jsdom has no layout: give column i the x range [i*100, i*100+99]. */
    const layOutColumns = (element: HTMLElement): void => {
      queryAllByData(element, 'data-blok-database-column').forEach((column, i) => {
        vi.spyOn(column, 'getBoundingClientRect').mockReturnValue(new DOMRect(i * 100, 0, 99, 500));
      });
    };

    const columnCards = (element: HTMLElement, optionId: string): string[] => {
      const column = queryAllByData(element, 'data-option-id', optionId).find((el) => el.hasAttribute('data-blok-database-column'));

      return column === undefined ? [] : queryAllByData(column, 'data-blok-database-card').map((el) => el.getAttribute('data-row-id') ?? '');
    };

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('keeps the dragged card in place until the drop, then writes the drop column', async () => {
      const childBlocks = [
        writableRow('row-a', { 'prop-title': 'A', 'prop-status': 'opt-todo' }, 'a0'),
        writableRow('row-b', { 'prop-title': 'B', 'prop-status': 'opt-todo' }, 'a1'),
        writableRow('row-x', { 'prop-title': 'X', 'prop-status': 'opt-todo' }, 'a2'),
      ];
      const options = createDatabaseOptions({
        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', filters: [], visibleProperties: [],
          sorts: [{ propertyId: 'prop-title', direction: 'asc' }] }],
      }, {}, { childBlocks });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      document.body.appendChild(element);
      tool.rendered();
      layOutColumns(element);

      const cardDrag = (tool as unknown as { cardDrag: DatabaseCardDrag }).cardDrag;
      const sourceCard = queryAllByData(element, 'data-row-id', 'row-x').find((el) => el.hasAttribute('data-blok-database-card'));

      cardDrag.beginTracking('row-x', 0, 0);
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, clientY: 50 }));

      // A peer renames A to Z and moves it: the sort now puts it after X.
      const rowA = childBlocks[0].preservedData as DatabaseRowData;

      rowA.properties['prop-title'] = 'Z';
      rowA.position = 'a3';
      const api = (tool as unknown as { api: API }).api;
      const listener = vi.mocked(api.events.on).mock.calls.find(([name]) => name === 'block changed')?.[1] as (payload: unknown) => void;

      listener({ event: { type: 'block-changed', detail: { target: childBlocks[0] } } });
      await Promise.resolve();

      expect(sourceCard?.isConnected).toBe(true);
      expect(columnCards(element, 'opt-todo')).toEqual(['row-a', 'row-b', 'row-x']);

      // Doing is the third column: no-value, Todo, Doing.
      document.dispatchEvent(new MouseEvent('pointerup', { clientX: 250, clientY: 50 }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(vi.mocked(childBlocks[2].call).mock.calls.filter(([method]) => method === 'updateProperties'))
        .toEqual([['updateProperties', { 'prop-status': 'opt-doing' }]]);
      expect(columnCards(element, 'opt-doing')).toEqual(['row-x']);
      expect(columnCards(element, 'opt-todo')).toEqual(['row-b', 'row-a']);

      tool.destroy();
    });
  });
});
