import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, queryAllByAttribute } from '@testing-library/dom';
import type { API, BlockAPI, BlockToolConstructorOptions, OutputData } from '../../../../types';
import type { DatabaseAdapter, DatabaseData, DatabaseConfig, DatabaseRow, DatabaseRowData, DatabaseViewConfig, PropertyDefinition, PropertyValue } from '../../../../src/tools/database/types';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import { DataPersistenceManager } from '../../../../src/components/block/data-persistence-manager';
import { NO_VALUE_GROUP_KEY, type DatabaseModel } from '../../../../src/tools/database/database-model';
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

    private readonly className: unknown;

    constructor(params: { items?: Array<{ title?: string; onActivate?: () => void; type?: string; element?: HTMLElement }>; [key: string]: unknown }) {
      this.items = params.items ?? [];
      this.className = params.class;
    }

    show(): void {
      this.container = document.createElement('div');
      this.container.setAttribute('data-mock-popover', '');
      if (typeof this.className === 'string') this.container.setAttribute('data-mock-popover-class', this.className);

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

    describe('drawer cell editors and the block lifecycle', () => {
      const SCHEMA = [
        { id: 'prop-title', name: 'Title', type: 'title' as const, position: 'a0' },
        {
          id: 'prop-status',
          name: 'Status',
          type: 'select' as const,
          position: 'a1',
          config: { options: [{ id: 'opt-a', label: 'A', position: 'a0' }, { id: 'opt-b', label: 'B', position: 'a1' }] },
        },
        {
          id: 'prop-tags',
          name: 'Tags',
          type: 'multiSelect' as const,
          position: 'a2',
          config: { options: [{ id: 'tag-x', label: 'X', position: 'a0' }, { id: 'tag-y', label: 'Y', position: 'a1' }] },
        },
        { id: 'prop-score', name: 'Score', type: 'number' as const, position: 'a3' },
      ];

      const mount = (rows: BlockAPI[]): { tool: DatabaseTool; element: HTMLElement; api: API } => {
        const options = createDatabaseOptions({ schema: SCHEMA }, {}, { childBlocks: rows });
        const tool = new DatabaseTool(options);
        const element = tool.render();

        document.body.appendChild(element);
        tool.rendered();
        queryByData(element, 'data-blok-database-card')?.click();

        return { tool, element, api: options.api };
      };

      const openValue = (element: HTMLElement, propertyId: string): void => {
        element.querySelector<HTMLElement>(`[data-blok-database-drawer-prop-value][data-property-id="${propertyId}"]`)?.click();
      };

      const draftScore = (text: string): void => {
        const input = document.querySelector<HTMLInputElement>('[data-blok-database-cell-input="number"]');

        if (input === null) {
          throw new Error('number editor did not open');
        }
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };

      const propertyWrites = (row: BlockAPI): unknown[] =>
        vi.mocked(row.call).mock.calls.filter(([method]) => method === 'updateProperties').map(([, changes]) => changes);

      afterEach(() => {
        document.body.innerHTML = '';
      });

      it('a draft still open when the block turns read-only is dropped, not written', () => {
        const row = createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'T', 'prop-score': 1 }, position: 'a0' });
        const { tool } = mount([row]);

        openValue(document.body, 'prop-score');
        draftScore('9');
        tool.setReadOnly(true);

        expect(propertyWrites(row)).toEqual([]);
        tool.destroy();
      });

      it('a draft still open when the block is destroyed is dropped, not written', () => {
        const row = createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'T', 'prop-score': 1 }, position: 'a0' });
        const { tool } = mount([row]);

        openValue(document.body, 'prop-score');
        draftScore('9');
        tool.destroy();

        expect(propertyWrites(row)).toEqual([]);
      });

      it('deleting an option empties it on every row, and the rows stay', () => {
        const first = createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'One', 'prop-status': 'opt-b', 'prop-tags': ['tag-x'] }, position: 'a0' });
        const second = createMockRowBlock({ id: 'row-2', properties: { 'prop-title': 'Two', 'prop-status': 'opt-a', 'prop-tags': ['tag-x', 'tag-y'] }, position: 'a1' });
        const third = createMockRowBlock({ id: 'row-3', properties: { 'prop-title': 'Three', 'prop-status': 'opt-a' }, position: 'a2' });
        const { tool, element, api } = mount([first, second, third]);

        openValue(element, 'prop-status');
        document.querySelector<HTMLElement>('[data-blok-database-select-option="opt-a"] [data-blok-database-select-option-menu]')?.click();
        document.querySelector<HTMLElement>('[data-blok-database-option-delete]')?.click();
        document.querySelector<HTMLElement>('[data-blok-database-option-delete-confirm]')?.click();

        expect(propertyWrites(second)).toContainEqual({ 'prop-status': null });
        expect(propertyWrites(third)).toContainEqual({ 'prop-status': null });
        expect(propertyWrites(first)).not.toContainEqual({ 'prop-status': null });
        expect(api.blocks.delete).not.toHaveBeenCalled();
        tool.destroy();
      });

      it('deleting a multi-select option drops just that id from every row', () => {
        const first = createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'One', 'prop-tags': ['tag-y'] }, position: 'a0' });
        const second = createMockRowBlock({ id: 'row-2', properties: { 'prop-title': 'Two', 'prop-tags': ['tag-x', 'tag-y'] }, position: 'a1' });
        const { tool, element } = mount([first, second]);

        openValue(element, 'prop-tags');
        document.querySelector<HTMLElement>('[data-blok-database-select-option="tag-x"] [data-blok-database-select-option-menu]')?.click();
        document.querySelector<HTMLElement>('[data-blok-database-option-delete]')?.click();
        document.querySelector<HTMLElement>('[data-blok-database-option-delete-confirm]')?.click();

        expect(propertyWrites(second)).toContainEqual({ 'prop-tags': ['tag-y'] });
        expect(propertyWrites(first)).toEqual([]);
        tool.destroy();
      });
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
        block: { id: 'test-block-id', dispatchChange: vi.fn() } as never,
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
        call: vi.fn((method: string, params?: Parameters<BlockAPI["call"]>[1]) => {
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

  describe('collapsing a group in a grouped list', () => {
    const groupedList = (readOnly = false): { tool: DatabaseTool; element: HTMLElement; options: BlockToolConstructorOptions<DatabaseData, DatabaseConfig> } => {
      const childBlocks = [createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'One', 'prop-status': 'opt-todo' }, position: 'a0' })];
      const options = createDatabaseOptions({
        views: [{ id: 'view-1', name: 'List', type: 'list', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [], collapsedGroups: [] }],
      }, {}, { childBlocks });

      options.readOnly = readOnly;

      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();

      return { tool, element, options };
    };

    const header = (element: HTMLElement, optionId: string): HTMLElement | undefined =>
      queryAllByData(element, 'data-blok-database-list-group')
        .find((group) => group.getAttribute('data-option-id') === optionId)
        ?.querySelector<HTMLElement>('[data-blok-database-list-group-header]') ?? undefined;

    it('keeps the collapse on the view, so a reload shows the group collapsed', () => {
      const { tool, element } = groupedList();

      header(element, 'opt-todo')?.click();

      const saved = tool.save(element);

      expect(saved.views[0].collapsedGroups).toEqual([{ id: 'opt-todo' }]);

      const reloaded = new DatabaseTool(createDatabaseOptions(saved));
      const reloadedElement = reloaded.render();

      reloaded.rendered();

      const group = queryAllByData(reloadedElement, 'data-blok-database-list-group').find((g) => g.getAttribute('data-option-id') === 'opt-todo');

      expect(group?.hasAttribute('data-collapsed')).toBe(true);

      tool.destroy();
      reloaded.destroy();
    });

    it('expanding removes the group from the saved list', () => {
      const { tool, element } = groupedList();

      header(element, 'opt-todo')?.click();
      header(element, 'opt-todo')?.click();

      expect(tool.save(element).views[0].collapsedGroups).toEqual([]);

      tool.destroy();
    });

    it('collapses on screen but saves nothing in read-only mode', () => {
      const { tool, element } = groupedList(true);

      header(element, 'opt-todo')?.click();

      expect(tool.save(element).views[0].collapsedGroups).toEqual([]);

      tool.destroy();
    });
  });

  describe('side peek', () => {
    it('narrows the editor the database sits in while a card page is open, and restores it on close', () => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        cb(0);

        return 0;
      });

      const editor = document.createElement('div');

      editor.setAttribute('data-blok-editor', '');
      document.body.appendChild(editor);

      const childBlocks = [createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'One', 'prop-status': 'opt-todo' }, position: 'a0' })];
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks }));
      const element = tool.render();

      editor.appendChild(element);
      tool.rendered();

      queryAllByData(element, 'data-row-id', 'row-1').find((el) => el.hasAttribute('data-blok-database-card'))?.click();

      expect(editor.hasAttribute('data-blok-database-peek')).toBe(true);

      tool.destroy();

      expect(editor.hasAttribute('data-blok-database-peek')).toBe(false);
      editor.remove();
    });
  });

  describe('switching the view tab', () => {
    it('hands the active background from the old tab to the new one, so it can fade over 100ms', async () => {
      const options = createDatabaseOptions({
        views: [
          { id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [] },
          { id: 'view-2', name: 'List', type: 'list', position: 'a1', sorts: [], filters: [], visibleProperties: [] },
        ],
      });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      document.body.appendChild(element);
      tool.rendered();

      const seen: string[] = [];
      const observer = new MutationObserver((records) => {
        records.forEach((record) => {
          const target = record.target as HTMLElement;

          seen.push(`${target.getAttribute('data-view-id') ?? '?'}:${record.attributeName ?? ''}:${record.oldValue === null ? 'added' : 'removed'}`);
        });
      });

      observer.observe(element, { subtree: true, attributeOldValue: true, attributeFilter: ['data-blok-database-tab-was-active', 'data-blok-database-tab-activating'] });
      queryAllByData(element, 'data-view-id', 'view-2').find((el) => el.hasAttribute('data-blok-database-tab'))?.click();
      await Promise.resolve();
      observer.disconnect();

      expect(seen).toEqual([
        'view-1:data-blok-database-tab-was-active:added',
        'view-2:data-blok-database-tab-activating:added',
        'view-1:data-blok-database-tab-was-active:removed',
        'view-2:data-blok-database-tab-activating:removed',
      ]);
      expect(queryAllByData(element, 'data-blok-database-tab-was-active')).toHaveLength(0);

      tool.destroy();
      element.remove();
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
    it('model.addProperty is called with the type name when onAddProperty fires with an empty name', () => {
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
      const onAddProperty = (cardDrawer as any).onAddProperty as ((type: string, name: string) => void) | undefined;

      // If this is undefined, the callback was NOT wired — test fails (TDD red phase)
      expect(onAddProperty).toBeDefined();

      // Invoke the callback
      onAddProperty!('text', '');

      expect(addPropertySpy).toHaveBeenCalledWith('tools.database.propertyTypeText', 'text', undefined, { afterId: undefined, beforeId: undefined }, {});

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
      const onAddProperty = (cardDrawer as any).onAddProperty as ((type: string, name: string) => void) | undefined;

      expect(onAddProperty).toBeDefined();

      onAddProperty!('text', 'Notes');

      expect(mockAdapter.createProperty).toHaveBeenCalledTimes(1);
      const callArg = mockAdapter.createProperty.mock.calls[0][0] as {
        id: string;
        name: string;
        type: string;
        position: string;
      };

      expect(callArg.name).toBe('Notes');
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
      const onAddProperty = (cardDrawer as any).onAddProperty as ((type: string, name: string) => void) | undefined;

      expect(onAddProperty).toBeDefined();

      onAddProperty!('text', '');

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

    it('shows a row with no group value on the board, in a last "No <property>" column', () => {
      const { tool, element } = renderBoard([
        { id: 'row-empty', properties: { 'prop-title': 'Loose', 'prop-status': null } },
        { id: 'row-todo', properties: { 'prop-title': 'Todo', 'prop-status': 'opt-todo' } },
      ]);

      const card = queryAllByData(element, 'data-row-id', 'row-empty').find((el) => el.hasAttribute('data-blok-database-card'));

      expect(card).toBeDefined();

      const column = noValueColumn(element);

      expect(column).not.toBeNull();
      expect(column?.contains(card ?? null)).toBe(true);
      expect(queryAllByData(element, 'data-blok-database-column').at(-1)).toBe(column);
      expect(queryByData(column ?? element, 'data-blok-database-no-value-label')?.textContent).toBe('No Status');
      // Only real options are rename targets; the no-value column has no column-title.
      expect(queryByData(column ?? element, 'data-blok-database-column-title')).toBeNull();

      tool.destroy();
    });

    const columnIds = (element: HTMLElement): Array<string | null> =>
      queryAllByData(element, 'data-blok-database-column').map((col) => col.getAttribute('data-option-id'));

    it('puts the no-value column where the view stores it', () => {
      const options = createDatabaseOptions({
        views: [{
          id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status',
          sorts: [], filters: [], visibleProperties: [], noValueGroupPosition: 'a0V',
        }],
      });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();

      expect(columnIds(element)).toEqual(['opt-todo', NO_VALUE_GROUP_KEY, 'opt-doing', 'opt-done']);

      tool.destroy();
    });

    it('places a group added from "New group" after the no-value column, and keeps it there', () => {
      const { tool, element } = renderBoard([]);
      const addColumn = queryByData(element, 'data-blok-database-add-column');

      addColumn?.click();

      const ids = columnIds(element);

      expect(ids.slice(0, 4)).toEqual(['opt-todo', 'opt-doing', 'opt-done', NO_VALUE_GROUP_KEY]);
      expect(ids).toHaveLength(5);

      const saved = tool.save(element);
      const reloaded = new DatabaseTool(createDatabaseOptions(saved));
      const reloadedElement = reloaded.render();

      reloaded.rendered();

      expect(columnIds(reloadedElement)).toEqual(ids);

      tool.destroy();
      reloaded.destroy();
    });

    it('moves a column past the no-value column and keeps the no-value column in place', () => {
      const { tool, element } = renderBoard([]);
      const columnDrag = (tool as unknown as { columnDrag: { onDrop: (r: GroupDragResult) => void } }).columnDrag;

      columnDrag.onDrop({ optionId: 'opt-todo', beforeOptionId: null, afterOptionId: NO_VALUE_GROUP_KEY });

      expect(columnIds(element)).toEqual(['opt-doing', 'opt-done', NO_VALUE_GROUP_KEY, 'opt-todo']);

      const saved = tool.save(element);
      const reloaded = new DatabaseTool(createDatabaseOptions(saved));
      const reloadedElement = reloaded.render();

      reloaded.rendered();

      expect(columnIds(reloadedElement)).toEqual(['opt-doing', 'opt-done', NO_VALUE_GROUP_KEY, 'opt-todo']);

      tool.destroy();
      reloaded.destroy();
    });

    it('moves the last column to just before the no-value column', () => {
      const { tool, element } = renderBoard([]);
      const columnDrag = (tool as unknown as { columnDrag: { onDrop: (r: GroupDragResult) => void } }).columnDrag;

      columnDrag.onDrop({ optionId: 'opt-todo', beforeOptionId: NO_VALUE_GROUP_KEY, afterOptionId: 'opt-done' });

      expect(columnIds(element)).toEqual(['opt-doing', 'opt-done', 'opt-todo', NO_VALUE_GROUP_KEY]);
      expect(tool.save(element).views[0].noValueGroupPosition).toBeUndefined();

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

    it('marks the pressed copy of a multi-group card as the drag source, not the first copy', () => {
      const { tool, element } = renderTagsBoard(['opt-a', 'opt-b']);
      const cardInB = cardsIn(element, 'opt-b')[0];
      const cardInA = cardsIn(element, 'opt-a')[0];

      fireEvent.pointerDown(cardInB, { clientX: 0, clientY: 0 });
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 40 }));

      expect(cardInB.hasAttribute('data-blok-database-drag-source')).toBe(true);
      expect(cardInA.hasAttribute('data-blok-database-drag-source')).toBe(false);

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

    const clickDelete = async (element: HTMLElement, optionId: string): Promise<void> => {
      queryAllByData(element, 'data-blok-database-delete-column')
        .find((el) => el.getAttribute('data-option-id') === optionId)
        ?.click();
      document.querySelector<HTMLButtonElement>('[data-blok-database-confirm-action="confirm"]')?.click();
      await Promise.resolve();
    };

    it('asks "Are you sure you want to delete this option?" and deletes nothing on Cancel', async () => {
      const childBlocks = [liveRowBlock('row-1', { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' }, 'a0')];
      const options = createDatabaseOptions({}, {}, { childBlocks });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();
      queryAllByData(element, 'data-blok-database-delete-column')
        .find((el) => el.getAttribute('data-option-id') === 'opt-todo')
        ?.click();

      expect(document.querySelector('[data-blok-database-confirm-title]')?.textContent).toBe('tools.database.optionDeleteConfirm');
      expect(childBlocks[0].call).not.toHaveBeenCalledWith('updateProperties', { 'prop-status': null });

      document.querySelector<HTMLButtonElement>('[data-blok-database-confirm-action="cancel"]')?.click();
      await Promise.resolve();

      expect(childBlocks[0].call).not.toHaveBeenCalledWith('updateProperties', { 'prop-status': null });
      expect(queryAllByData(element, 'data-blok-database-column').some((el) => el.getAttribute('data-option-id') === 'opt-todo')).toBe(true);

      tool.destroy();
    });

    it('keeps the rows and moves them to the no-value group', async () => {
      const childBlocks = [
        liveRowBlock('row-1', { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' }, 'a0'),
        liveRowBlock('row-2', { 'prop-title': 'Task 2', 'prop-status': 'opt-todo' }, 'a1'),
      ];
      const options = createDatabaseOptions({}, {}, { childBlocks });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();
      await clickDelete(element, 'opt-todo');

      expect(options.api.blocks.delete).not.toHaveBeenCalled();
      expect(childBlocks[0].call).toHaveBeenCalledWith('updateProperties', { 'prop-status': null });
      expect(childBlocks[1].call).toHaveBeenCalledWith('updateProperties', { 'prop-status': null });

      const noValue = queryByData(element, 'data-blok-database-no-value-group');
      const cardIds = queryAllByData(noValue ?? element, 'data-blok-database-card').map((c) => c.getAttribute('data-row-id'));

      expect(cardIds).toEqual(['row-1', 'row-2']);
      expect(queryAllByData(element, 'data-option-id', 'opt-todo')).toHaveLength(0);

      tool.destroy();
    });

    it('removes only the deleted option from a multiSelect row', async () => {
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
      await clickDelete(element, 'opt-a');

      expect(options.api.blocks.delete).not.toHaveBeenCalled();
      expect(row.call).toHaveBeenCalledWith('updateProperties', { 'prop-tags': ['opt-b'] });

      tool.destroy();
    });
  });

  describe('the board column "More group options" menu', () => {
    const groupRow = (id: string, properties: Record<string, PropertyValue>, position: string): BlockAPI => {
      const block = createMockRowBlock({ id, properties, position });
      const data = block.preservedData as DatabaseRowData;

      vi.mocked(block.call).mockImplementation((method: string, params?: unknown) => {
        if (method === 'updateProperties') Object.assign(data.properties, params);
      });

      return block;
    };

    const board = (readOnly = false): {
      tool: DatabaseTool;
      element: HTMLElement;
      options: BlockToolConstructorOptions<DatabaseData, DatabaseConfig>;
      transact: ReturnType<typeof vi.fn>;
    } => {
      const childBlocks = [
        groupRow('row-1', { 'prop-title': 'One', 'prop-status': 'opt-todo' }, 'a0'),
        groupRow('row-2', { 'prop-title': 'Two', 'prop-status': 'opt-todo' }, 'a1'),
        groupRow('row-3', { 'prop-title': 'Three', 'prop-status': 'opt-done' }, 'a2'),
      ];
      const options = createDatabaseOptions({}, {}, { childBlocks });
      const transact = vi.fn((fn: () => void) => fn());

      options.readOnly = readOnly;
      Object.assign(options.api.blocks, { transact });
      vi.mocked(options.api.blocks.getBlockIndex).mockImplementation((id: string) => ['row-1', 'row-2', 'row-3'].indexOf(id) + 1);

      const tool = new DatabaseTool(options);
      const element = tool.render();

      document.body.appendChild(element);
      tool.rendered();

      return { tool, element, options, transact };
    };

    const openMenu = (element: HTMLElement, optionId: string): void => {
      queryAllByData(element, 'data-blok-database-column-menu').find((el) => el.getAttribute('data-option-id') === optionId)?.click();
    };

    const pick = (title: string): void => {
      queryByData(document.body, 'data-mock-popover-action', title.toLowerCase())?.click();
    };

    const columnIds = (element: HTMLElement): Array<string | null> =>
      queryAllByData(element, 'data-blok-database-column').map((col) => col.getAttribute('data-option-id'));

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('opens the group menu and the card menu with the database menu motion', () => {
      const { tool, element } = board();

      openMenu(element, 'opt-todo');

      expect(queryByData(document.body, 'data-mock-popover-class', 'blok-database-menu')).not.toBeNull();

      queryAllByData(document.body, 'data-mock-popover').forEach((el) => el.remove());
      queryByData(element, 'data-blok-database-card-menu')?.click();

      expect(queryByData(document.body, 'data-mock-popover-class', 'blok-database-menu')).not.toBeNull();

      tool.destroy();
    });

    it('keeps the header buttons shown while the group menu is open', () => {
      const { tool, element } = board();
      const header = queryAllByData(element, 'data-blok-database-column')
        .find((col) => col.getAttribute('data-option-id') === 'opt-todo')
        ?.querySelector('[data-blok-database-column-header]');

      openMenu(element, 'opt-todo');

      expect(header?.hasAttribute('data-popover-open')).toBe(true);

      tool.destroy();

      expect(header?.hasAttribute('data-popover-open')).toBe(false);
    });

    it('hides a group and keeps it hidden after a reload', () => {
      const { tool, element } = board();

      openMenu(element, 'opt-todo');
      pick('tools.database.groupHide');

      expect(columnIds(element)).not.toContain('opt-todo');
      expect(tool.save(element).views[0].hiddenGroups).toEqual([{ id: 'opt-todo' }]);

      tool.destroy();
    });

    it('shows a hidden group again from the hidden-groups button', () => {
      const { tool, element } = board();

      openMenu(element, 'opt-todo');
      pick('tools.database.groupHide');
      queryByData(element, 'data-blok-database-hidden-groups')?.click();
      pick('Todo');

      expect(columnIds(element)).toContain('opt-todo');
      expect(tool.save(element).views[0].hiddenGroups).toEqual([]);

      tool.destroy();
    });

    it('hides every count with "Hide aggregation" and saves it on the view', () => {
      const { tool, element } = board();

      openMenu(element, 'opt-todo');
      pick('tools.database.groupHideAggregation');

      expect(queryAllByData(element, 'data-blok-database-column-count').every((el) => el.hidden)).toBe(true);
      expect(tool.save(element).views[0].hideGroupAggregation).toBe(true);

      tool.destroy();
    });

    it('recolors the group\'s option', () => {
      const { tool, element } = board();

      openMenu(element, 'opt-todo');
      pick('tools.colorPicker.color.pink');

      const status = tool.save(element).schema.find((p) => p.id === 'prop-status');

      expect(status?.config?.options.find((o) => o.id === 'opt-todo')?.color).toBe('pink');

      tool.destroy();
    });

    it('asks before moving the group\'s pages to Trash, then deletes them in one step', async () => {
      const { tool, element, options, transact } = board();

      openMenu(element, 'opt-todo');
      pick('tools.database.groupMoveToTrash');

      expect(document.querySelector('[data-blok-database-confirm-title]')?.textContent).toBe('tools.database.groupTrashConfirm');
      expect(options.api.blocks.delete).not.toHaveBeenCalled();

      document.querySelector<HTMLButtonElement>('[data-blok-database-confirm-action="confirm"]')?.click();
      await Promise.resolve();

      expect(transact).toHaveBeenCalledTimes(1);
      expect(vi.mocked(options.api.blocks.getBlockIndex).mock.calls.map(([id]) => id).sort()).toEqual(['row-1', 'row-2']);
      expect(options.api.blocks.delete).toHaveBeenCalledTimes(2);

      tool.destroy();
    });

    it('keeps the pages when Move to Trash is cancelled', async () => {
      const { tool, element, options } = board();

      openMenu(element, 'opt-todo');
      pick('tools.database.groupMoveToTrash');
      document.querySelector<HTMLButtonElement>('[data-blok-database-confirm-action="cancel"]')?.click();
      await Promise.resolve();

      expect(options.api.blocks.delete).not.toHaveBeenCalled();

      tool.destroy();
    });

    it('adds a page to the group from the header "+"', () => {
      const { tool, element, options } = board();

      queryAllByData(element, 'data-blok-database-column-new-page').find((el) => el.getAttribute('data-option-id') === 'opt-done')?.click();

      const data = vi.mocked(options.api.blocks.insertAt).mock.calls[0]?.[1] as DatabaseRowData | undefined;

      expect(data?.properties['prop-status']).toBe('opt-done');

      tool.destroy();
    });

    it('never starts a column drag from a header button', () => {
      const { tool, element } = board();
      const columnDrag = (tool as unknown as { columnDrag: DatabaseColumnDrag }).columnDrag;
      const begin = vi.spyOn(columnDrag, 'beginTracking');
      const menu = queryAllByData(element, 'data-blok-database-column-menu')[0];

      fireEvent.pointerDown(menu, { clientX: 0, clientY: 0 });

      expect(begin).not.toHaveBeenCalled();

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

    it('still clears the group of a row a filter hides when its column is deleted', async () => {
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
      document.querySelector<HTMLButtonElement>('[data-blok-database-confirm-action="confirm"]')?.click();
      await Promise.resolve();

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

  describe('drag in a sorted view asks to remove sorting (D7)', () => {
    const positionRow = (id: string, properties: Record<string, PropertyValue>, position: string): BlockAPI => {
      const block = createMockRowBlock({ id, properties, position });
      const data = block.preservedData as DatabaseRowData;

      vi.mocked(block.call).mockImplementation((method: string, params?: unknown) => {
        if (method === 'updateProperties') Object.assign(data.properties, params);
        if (method === 'updatePosition' && typeof params === 'object' && params !== null && 'position' in params) {
          data.position = String(params.position);
        }
      });

      return block;
    };

    const sortedTool = (type: 'board' | 'list'): {
      tool: DatabaseTool;
      element: HTMLElement;
      childBlocks: BlockAPI[];
      options: BlockToolConstructorOptions<DatabaseData, DatabaseConfig>;
      transact: ReturnType<typeof vi.fn>;
    } => {
      // Sort order (A, B, X, empty) differs from position order (B, A, empty, X).
      const childBlocks = [
        positionRow('row-b', { 'prop-title': 'B', 'prop-status': 'opt-todo' }, 'a0'),
        positionRow('row-a', { 'prop-title': 'A', 'prop-status': 'opt-todo' }, 'a1'),
        positionRow('row-e', { 'prop-title': '', 'prop-status': 'opt-todo' }, 'a2'),
        positionRow('row-x', { 'prop-title': 'X', 'prop-status': 'opt-todo' }, 'a3'),
      ];
      const data = makeDefaultData({
        views: [{
          id: 'view-1', name: 'View', type, position: 'a0', groupBy: type === 'board' ? 'prop-status' : undefined,
          filters: [], visibleProperties: [], sorts: [{ propertyId: 'prop-title', direction: 'asc' }],
        }],
      });
      const options = createDatabaseOptions(data, {}, { childBlocks });
      const transact = vi.fn((fn: () => void) => fn());

      Object.assign(options.api.blocks, { transact });

      const tool = new DatabaseTool(options);
      const element = tool.render();

      document.body.appendChild(element);
      tool.rendered();

      return { tool, element, childBlocks, options, transact };
    };

    const dropCard = (tool: DatabaseTool, result: CardDragResult): void => {
      const cardDrag = (tool as unknown as { cardDrag: DatabaseCardDrag }).cardDrag;

      (cardDrag as unknown as { onDrop: (r: CardDragResult) => void }).onDrop(result);
    };

    const dropListRow = (tool: DatabaseTool, result: { rowId: string; beforeRowId: string | null; afterRowId: string | null }): void => {
      const listRowDrag = (tool as unknown as { listRowDrag: { onDrop: (r: typeof result) => void } | null }).listRowDrag;

      if (listRowDrag === null) throw new Error('a sorted list must still let rows be dragged');
      listRowDrag.onDrop(result);
    };

    const callsNamed = (block: BlockAPI, name: string): unknown[][] =>
      (block.call as ReturnType<typeof vi.fn>).mock.calls.filter((args) => args[0] === name);

    const confirmTitle = (): string | null | undefined =>
      document.querySelector('[data-blok-database-confirm-title]')?.textContent;

    const answer = (name: 'confirm' | 'cancel'): void => {
      document.querySelector<HTMLButtonElement>(`[data-blok-database-confirm-action="${name}"]`)?.click();
    };

    /** Rows in manual (position) order, read back from the row blocks. */
    const manualOrder = (childBlocks: BlockAPI[]): string[] => [...childBlocks]
      .sort((a, b) => ((a.preservedData as DatabaseRowData).position < (b.preservedData as DatabaseRowData).position ? -1 : 1))
      .map((block) => block.id);

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('asks "Would you like to remove sorting?" on a reorder inside a column, and writes nothing yet', () => {
      const { tool, childBlocks } = sortedTool('board');

      // Neighbours arrive in sort order: X dropped between A and B.
      dropCard(tool, { rowId: 'row-x', toOptionId: 'opt-todo', beforeRowId: 'row-b', afterRowId: 'row-a' });

      expect(confirmTitle()).toBe('tools.database.removeSortingTitle');
      expect(childBlocks.flatMap((block) => callsNamed(block, 'updatePosition'))).toHaveLength(0);

      tool.destroy();
    });

    it('"Don\'t remove" discards the drop: order and sort stay', () => {
      const { tool, element, childBlocks } = sortedTool('board');

      dropCard(tool, { rowId: 'row-x', toOptionId: 'opt-todo', beforeRowId: 'row-b', afterRowId: 'row-a' });
      answer('cancel');

      expect(childBlocks.flatMap((block) => callsNamed(block, 'updatePosition'))).toHaveLength(0);
      expect(tool.save(element).views[0].sorts).toEqual([{ propertyId: 'prop-title', direction: 'asc' }]);
      expect(confirmTitle()).toBeUndefined();

      tool.destroy();
    });

    it('"Remove" deletes the sort, keeps the sorted order as the manual order, and lands the row where it was dropped', async () => {
      const { tool, element, childBlocks, transact } = sortedTool('board');

      dropCard(tool, { rowId: 'row-x', toOptionId: 'opt-todo', beforeRowId: 'row-b', afterRowId: 'row-a' });
      answer('confirm');
      await Promise.resolve();

      expect(tool.save(element).views[0].sorts).toEqual([]);
      // Sorted order was A, B, X, empty (D8: empties last); X lands between A and B.
      expect(manualOrder(childBlocks)).toEqual(['row-a', 'row-x', 'row-b', 'row-e']);
      expect(transact).toHaveBeenCalledTimes(1);

      tool.destroy();
    });

    it('writes every position inside one transaction, so one undo restores the sort and the order', async () => {
      const { tool, childBlocks, transact } = sortedTool('board');
      const inside: string[] = [];

      transact.mockImplementation((fn: () => void) => {
        inside.push('begin');
        fn();
        inside.push('end');
      });
      childBlocks.forEach((block) => {
        const original = vi.mocked(block.call).getMockImplementation();

        vi.mocked(block.call).mockImplementation((method: string, params?: Parameters<BlockAPI["call"]>[1]) => {
          if (method === 'updatePosition') inside.push(block.id);
          original?.(method, params);
        });
      });

      dropCard(tool, { rowId: 'row-x', toOptionId: 'opt-todo', beforeRowId: 'row-b', afterRowId: 'row-a' });
      answer('confirm');
      await Promise.resolve();

      expect(inside[0]).toBe('begin');
      expect(inside.at(-1)).toBe('end');
      expect(inside.filter((entry) => entry.startsWith('row-')).sort()).toEqual(['row-a', 'row-b', 'row-e', 'row-x']);

      tool.destroy();
    });

    it('asks the same question when a row is dragged in a sorted list', async () => {
      const { tool, element, childBlocks } = sortedTool('list');

      dropListRow(tool, { rowId: 'row-a', beforeRowId: null, afterRowId: 'row-x' });

      expect(confirmTitle()).toBe('tools.database.removeSortingTitle');

      answer('confirm');
      await Promise.resolve();

      expect(tool.save(element).views[0].sorts).toEqual([]);
      expect(manualOrder(childBlocks)).toEqual(['row-b', 'row-x', 'row-a', 'row-e']);

      tool.destroy();
    });

    it('moves a card to another column by its group value only, without asking', () => {
      const { tool, childBlocks } = sortedTool('board');
      const rowX = childBlocks[3];

      dropCard(tool, { rowId: 'row-x', toOptionId: 'opt-doing', beforeRowId: null, afterRowId: null });

      expect(confirmTitle()).toBeUndefined();
      expect(callsNamed(rowX, 'updateProperties')).toEqual([['updateProperties', { 'prop-status': 'opt-doing' }]]);
      expect(callsNamed(rowX, 'updatePosition')).toHaveLength(0);

      tool.destroy();
    });

    it('closes only the dialog on Escape, leaving an open card page open', async () => {
      const { tool, element } = sortedTool('board');
      const drawer = (tool as unknown as { cardDrawer: DatabaseCardDrawer }).cardDrawer;
      const model = (tool as unknown as { model: DatabaseModel }).model;
      const row = model.getRow('row-a');

      if (row === undefined) throw new Error('row-a is missing');
      drawer.open(row);
      dropCard(tool, { rowId: 'row-x', toOptionId: 'opt-todo', beforeRowId: 'row-b', afterRowId: 'row-a' });

      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await Promise.resolve();

      expect(confirmTitle()).toBeUndefined();
      expect(drawer.isOpen).toBe(true);
      expect(tool.save(element).views[0].sorts).toHaveLength(1);

      tool.destroy();
    });

    it('drops the answer when the sort is already gone by the time the user confirms', async () => {
      const { tool, element, childBlocks } = sortedTool('board');
      const model = (tool as unknown as { model: DatabaseModel }).model;

      dropCard(tool, { rowId: 'row-x', toOptionId: 'opt-todo', beforeRowId: 'row-b', afterRowId: 'row-a' });
      model.updateView('view-1', { sorts: [] });
      answer('confirm');
      await Promise.resolve();

      expect(childBlocks.flatMap((block) => callsNamed(block, 'updatePosition'))).toHaveLength(0);
      expect(tool.save(element).views[0].sorts).toEqual([]);

      tool.destroy();
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

      // Doing is the second column: Todo, Doing, Done, no-value.
      document.dispatchEvent(new MouseEvent('pointerup', { clientX: 150, clientY: 50 }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(vi.mocked(childBlocks[2].call).mock.calls.filter(([method]) => method === 'updateProperties'))
        .toEqual([['updateProperties', { 'prop-status': 'opt-doing' }]]);
      expect(columnCards(element, 'opt-doing')).toEqual(['row-x']);
      expect(columnCards(element, 'opt-todo')).toEqual(['row-b', 'row-a']);

      tool.destroy();
    });
  });

  describe('table view foundations', () => {
    const tableView: DatabaseViewConfig = { id: 'view-table', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] };
    const twoRows = (): BlockAPI[] => [
      createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'First' }, position: 'a0' }),
      createMockRowBlock({ id: 'row-2', properties: { 'prop-title': 'Second' }, position: 'a1' }),
    ];

    it('seeds a table from the Database toolbox entry and leaves the Board entry a board', () => {
      const [database, board] = DatabaseTool.toolbox as Array<{ data?: Record<string, unknown> }>;

      expect(database.data).toEqual({ initialView: 'table' });
      expect(board.data).toBeUndefined();
    });

    it('starts a database inserted from the Database entry with a table view, and saves no seed key', () => {
      const options = createDatabaseOptions();

      options.data = { initialView: 'table' } as unknown as DatabaseData;
      const tool = new DatabaseTool(options);
      const element = tool.render();
      const saved = tool.save(element);

      expect(saved.views).toHaveLength(1);
      expect(saved.views[0].type).toBe('table');
      expect(saved.views[0].groupBy).toBeUndefined();
      expect(saved).not.toHaveProperty('initialView');
      expect(tool.validate(saved)).toBe(true);
    });

    it('accepts a table view without groupBy', () => {
      const tool = new DatabaseTool(createDatabaseOptions());

      expect(tool.validate(makeDefaultData({ views: [tableView], activeViewId: 'view-table' }))).toBe(true);
    });

    it('renders a table view as a grid of rows, not as a board', () => {
      const tool = new DatabaseTool(createDatabaseOptions({ views: [tableView], activeViewId: 'view-table' }, {}, { childBlocks: twoRows() }));
      const element = tool.render();

      tool.rendered();

      const table = queryByData(element, 'data-blok-database-table');
      const titleOf = (row: HTMLElement): string | null | undefined =>
        queryAllByData(row, 'data-blok-database-cell', 'title')[0]?.textContent;

      expect(table).not.toBeNull();
      expect(queryByData(element, 'data-blok-database-board')).toBeNull();
      expect(queryAllByData(element, 'data-blok-database-table-row').map(titleOf)).toEqual(['First', 'Second']);

      tool.destroy();
    });

    it('wires no board drag onto a table view', () => {
      const tool = new DatabaseTool(createDatabaseOptions({ views: [tableView], activeViewId: 'view-table' }, {}, { childBlocks: twoRows() }));

      tool.render();
      tool.rendered();

      const internals = tool as unknown as { cardDrag: unknown; columnDrag: unknown; listRowDrag: unknown };

      expect(internals.cardDrag).toBeNull();
      expect(internals.columnDrag).toBeNull();
      expect(internals.listRowDrag).toBeNull();

      tool.destroy();
    });

    it('names a new table view Table and gives it no group', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();

      tool.addView('table');

      const added = tool.save(element).views[1];

      expect(added).toMatchObject({ name: 'Table', type: 'table' });
      expect(added.groupBy).toBeUndefined();

      tool.destroy();
    });

    it('carries every view setting into a duplicate and to the backend', () => {
      const adapter = {
        loadDatabase: vi.fn().mockResolvedValue(undefined),
        createRow: vi.fn(), updateRow: vi.fn(), moveRow: vi.fn(), deleteRow: vi.fn(),
        createProperty: vi.fn(), updateProperty: vi.fn(), deleteProperty: vi.fn(),
        createView: vi.fn().mockResolvedValue(undefined), updateView: vi.fn(), deleteView: vi.fn(),
      } satisfies DatabaseAdapter;
      const source: DatabaseViewConfig = {
        ...tableView,
        sorts: [{ propertyId: 'prop-title', direction: 'asc' }],
        filters: [{ propertyId: 'prop-status', operator: 'is', value: 'opt-todo' }],
        properties: [{ id: 'prop-status', visible: true, width: 180, wrap: true }, { id: 'prop-title', visible: true }],
        visibleProperties: ['prop-status'],
        wrapCells: true,
        frozenColumnCount: 1,
        showVerticalLines: false,
        loadLimit: 25,
        calculations: [{ id: 'prop-status', fn: 'count_values' }],
        openPagesIn: 'center',
      };
      const tool = new DatabaseTool(createDatabaseOptions({ views: [source], activeViewId: 'view-table' }, { adapter }));
      const element = tool.render();

      tool.duplicateView('view-table');

      const { id: _sourceId, position: _sourcePosition, ...settings } = source;
      const copy = tool.save(element).views[1];

      expect(copy).toMatchObject(settings);
      expect(adapter.createView).toHaveBeenCalledWith(expect.objectContaining({ ...settings, id: copy.id, position: copy.position }));

      tool.destroy();
    });

    it('shows on a list row the properties chosen in properties, over the legacy list', () => {
      const listView: DatabaseViewConfig = {
        id: 'view-list', name: 'List', type: 'list', position: 'a0', sorts: [], filters: [],
        visibleProperties: [],
        properties: [{ id: 'prop-title', visible: true }, { id: 'prop-status', visible: true }],
      };
      const rows = [createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'First', 'prop-status': 'opt-todo' }, position: 'a0' })];
      const tool = new DatabaseTool(createDatabaseOptions({ views: [listView], activeViewId: 'view-list' }, {}, { childBlocks: rows }));
      const element = tool.render();

      tool.rendered();

      expect(queryAllByData(element, 'data-blok-database-list-row-property')).toHaveLength(1);

      tool.destroy();
    });
  });

  describe('table view wiring', () => {
    const tableView: DatabaseViewConfig = { id: 'view-table', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] };
    const textSchema: PropertyDefinition[] = [
      { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
      { id: 'prop-notes', name: 'Notes', type: 'text', position: 'a1' },
      { id: 'prop-tags', name: 'Tags', type: 'multiSelect', position: 'a2', config: { options: [
        { id: 'opt-a', label: 'A', position: 'a0' }, { id: 'opt-b', label: 'B', position: 'a1' },
      ] } },
    ];
    const writable = (id: string, properties: Record<string, PropertyValue>, position: string): BlockAPI => {
      const block = createMockRowBlock({ id, properties, position });
      const data = block.preservedData as DatabaseRowData;

      vi.mocked(block.call).mockImplementation((method: string, params?: unknown) => {
        if (method === 'updateProperties') Object.assign(data.properties, params);
        if (method === 'updateTitle') {
          const { title, titlePropertyId } = params as { title: string; titlePropertyId: string };

          data.title = title;
          data.properties[titlePropertyId] = title;
        }
      });

      return block;
    };
    const setup = (adapter?: DatabaseAdapter): { tool: DatabaseTool; element: HTMLElement; rows: BlockAPI[]; options: BlockToolConstructorOptions<DatabaseData, DatabaseConfig> } => {
      const rows = [
        writable('row-1', { 'prop-title': 'First', 'prop-notes': 'n1' }, 'a0'),
        writable('row-2', { 'prop-title': 'Second' }, 'a1'),
      ];
      const options = createDatabaseOptions({ schema: textSchema, views: [tableView], activeViewId: 'view-table' }, adapter !== undefined ? { adapter } : {}, { childBlocks: rows });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      document.body.appendChild(element);
      tool.rendered();

      return { tool, element, rows, options };
    };
    const gridCell = (element: HTMLElement, rowId: string, propertyId: string): HTMLElement => {
      const row = queryAllByData(element, 'data-blok-database-table-row').find((el) => el.getAttribute('data-row-id') === rowId);
      const cellEl = row === undefined ? undefined : queryAllByData(row, 'data-property-id', propertyId).find((el) => el.getAttribute('role') === 'gridcell');

      if (cellEl === undefined) {
        throw new Error(`no cell ${rowId}/${propertyId}`);
      }

      return cellEl;
    };
    const field = (): HTMLInputElement | HTMLTextAreaElement => {
      const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-blok-database-cell-input]');

      if (el === null) {
        throw new Error('no editor field');
      }

      return el;
    };
    const enter = (target: EventTarget): void => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    };
    const adapterMock = (): DatabaseAdapter => ({
      loadDatabase: vi.fn().mockResolvedValue(undefined),
      createRow: vi.fn().mockResolvedValue(undefined), updateRow: vi.fn().mockResolvedValue(undefined),
      moveRow: vi.fn().mockResolvedValue(undefined), deleteRow: vi.fn().mockResolvedValue(undefined),
      createProperty: vi.fn().mockResolvedValue(undefined), updateProperty: vi.fn().mockResolvedValue(undefined),
      deleteProperty: vi.fn().mockResolvedValue(undefined), createView: vi.fn().mockResolvedValue(undefined),
      updateView: vi.fn().mockResolvedValue(undefined), deleteView: vi.fn().mockResolvedValue(undefined),
    });

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('writes a title cell through the row title, not only the properties mirror', () => {
      const { tool, element, rows } = setup();

      gridCell(element, 'row-1', 'prop-title').click();
      field().value = 'Renamed';
      enter(field());

      expect(rows[0].call).toHaveBeenCalledWith('updateTitle', { title: 'Renamed', titlePropertyId: 'prop-title' });
      expect(rows[0].dispatchChange).toHaveBeenCalled();

      tool.destroy();
    });

    it('writes a text cell through the row block and the backend', () => {
      const adapter = adapterMock();
      const { tool, element, rows } = setup(adapter);

      gridCell(element, 'row-1', 'prop-notes').click();
      field().value = 'changed';
      enter(field());
      (tool as unknown as { sync: { flushPendingUpdates: () => void } }).sync.flushPendingUpdates();

      expect(rows[0].call).toHaveBeenCalledWith('updateProperties', { 'prop-notes': 'changed' });
      expect(adapter.updateRow).toHaveBeenCalledWith({ rowId: 'row-1', properties: { 'prop-notes': 'changed' } });
      expect(gridCell(element, 'row-1', 'prop-notes').textContent).toContain('changed');

      tool.destroy();
    });

    it('keeps an open cell editor when a peer changes a row, and redraws once it closes', async () => {
      const { tool, element, rows } = setup();

      gridCell(element, 'row-1', 'prop-notes').click();
      const openField = field();

      (rows[1].preservedData as DatabaseRowData).properties['prop-notes'] = 'peer';
      const api = (tool as unknown as { api: API }).api;
      const listener = vi.mocked(api.events.on).mock.calls.find(([name]) => name === 'block changed')?.[1] as (payload: unknown) => void;

      listener({ event: { type: 'block-changed', detail: { target: rows[1] } } });
      await Promise.resolve();
      tool.setData(tool.save(element));
      await Promise.resolve();

      expect(openField.isConnected).toBe(true);
      expect(gridCell(element, 'row-1', 'prop-notes').isConnected).toBe(true);
      expect(gridCell(element, 'row-2', 'prop-notes').textContent).not.toContain('peer');

      openField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape' }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(gridCell(element, 'row-2', 'prop-notes').textContent).toContain('peer');

      tool.destroy();
    });

    it('keeps a live multi-select editor open across its commits', () => {
      const { tool, element, rows } = setup();

      gridCell(element, 'row-1', 'prop-tags').click();
      const editorRoot = document.querySelector<HTMLElement>('[data-blok-database-select-editor]');

      document.querySelector<HTMLElement>('[data-blok-database-select-option="opt-a"]')?.click();

      expect(rows[0].call).toHaveBeenCalledWith('updateProperties', { 'prop-tags': ['opt-a'] });
      expect(editorRoot?.isConnected).toBe(true);
      expect(gridCell(element, 'row-1', 'prop-tags').textContent).toContain('A');

      tool.destroy();
    });

    it('writes a resized width into the view and records an undo step', () => {
      const { tool, element, options } = setup();
      const header = queryAllByData(element, 'data-property-id', 'prop-notes').find((el) => el.getAttribute('role') === 'columnheader');
      const handle = header === undefined ? null : queryByData(header, 'data-blok-database-table-resize');

      handle?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, button: 0 }));
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 150 }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 150 }));

      const saved = tool.save(element).views[0];

      expect(saved.properties?.find((p) => p.id === 'prop-notes')?.width).toBe(250);
      expect(options.block.dispatchChange).toHaveBeenCalled();

      tool.destroy();
    });

    it('keeps the horizontal scroll when an edit redraws the table', () => {
      const { tool, element } = setup();
      const scroller = (): HTMLElement | null => queryByData(element, 'data-blok-database-table-scroller');

      (scroller() as HTMLElement).scrollLeft = 120;
      expect(scroller()?.scrollLeft).toBe(120);

      gridCell(element, 'row-1', 'prop-notes').click();
      field().value = 'changed';
      enter(field());

      expect(gridCell(element, 'row-1', 'prop-notes').textContent).toContain('changed');
      expect(scroller()?.scrollLeft).toBe(120);

      tool.destroy();
    });

    it('+ New page inserts a row block under the database and opens its title', async () => {
      const { tool, element, options } = setup();

      queryByData(element, 'data-blok-database-table-add-row')?.click();

      expect(options.api.blocks.insertAt).toHaveBeenCalledWith(
        'database-row',
        expect.objectContaining({ title: '' }),
        expect.objectContaining({ parentId: 'test-block-id' })
      );

      tool.destroy();
    });
  });

  describe('setData()', () => {
    const renamed = (data: DatabaseData, name: string): DatabaseData => ({
      ...data,
      views: data.views.map((view) => ({ ...view, name })),
    });

    it('applies a peer view rename in place, keeping the block element', () => {
      const options = createDatabaseOptions({}, {}, { childBlocks: [createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'One' }, position: 'a0' })] });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();

      const applied = tool.setData(renamed(tool.save(element), 'Renamed'));

      expect(applied).not.toBe(false);
      expect(queryByData(element, 'data-blok-database-tab-name')?.textContent).toBe('Renamed');
      expect(tool.save(element).views[0].name).toBe('Renamed');
      expect(queryByData(element, 'data-row-id', 'row-1')).not.toBeNull();

      tool.destroy();
    });

    it('keeps an open card page open', () => {
      const options = createDatabaseOptions({}, {}, { childBlocks: [createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'One' }, position: 'a0' })] });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();
      queryByData(element, 'data-row-id', 'row-1')?.click();

      const drawer = (): DatabaseCardDrawer | null => (tool as unknown as { cardDrawer: DatabaseCardDrawer | null }).cardDrawer;

      expect(drawer()?.isOpen).toBe(true);

      tool.setData(renamed(tool.save(element), 'Renamed'));

      expect(drawer()?.isOpen).toBe(true);
      expect(drawer()?.openRowId).toBe('row-1');

      tool.destroy();
    });

    it('follows the active view the data names', () => {
      const views: DatabaseViewConfig[] = [
        { id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [] },
        { id: 'view-2', name: 'Table', type: 'table', position: 'a1', sorts: [], filters: [], visibleProperties: [] },
      ];
      const tool = new DatabaseTool(createDatabaseOptions({ views, activeViewId: 'view-1' }));
      const element = tool.render();

      tool.setData({ ...tool.save(element), activeViewId: 'view-2' });

      expect(tool.save(element).activeViewId).toBe('view-2');
      expect(queryByData(element, 'data-blok-database-table')).not.toBeNull();
      expect(queryByData(element, 'data-blok-database-board')).toBeNull();

      tool.destroy();
    });

    it('keeps a top-level key a newer peer wrote', () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();

      tool.setData({ ...tool.save(element), fromTheFuture: { a: 1 } });

      expect(tool.save(element)).toMatchObject({ fromTheFuture: { a: 1 } });

      tool.destroy();
    });

    it('takes the peer title and leaves an unchanged title node alone', () => {
      const tool = new DatabaseTool(createDatabaseOptions({ title: 'Tasks' }));
      const element = tool.render();
      const titleEl = queryByData(element, 'data-blok-database-title');
      const observer = new MutationObserver(() => undefined);

      if (titleEl !== null) {
        observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
      }

      tool.setData({ ...tool.save(element), title: 'Tasks' });

      expect(observer.takeRecords()).toHaveLength(0);
      observer.disconnect();

      tool.setData({ ...tool.save(element), title: 'Projects' });

      expect(titleEl?.textContent).toBe('Projects');
      expect(tool.save(element).title).toBe('Projects');

      tool.destroy();
    });

    it('asks for a full render when the data has no schema or views', () => {
      const tool = new DatabaseTool(createDatabaseOptions());

      tool.render();

      expect(tool.setData({ ...makeDefaultData(), views: [] })).toBe(false);
      expect(tool.setData({ ...makeDefaultData(), schema: [] })).toBe(false);

      tool.destroy();
    });

    it('updates in place through the block data lifecycle', async () => {
      const tool = new DatabaseTool(createDatabaseOptions());
      const element = tool.render();
      const manager = new DataPersistenceManager(
        tool, () => element, {} as never, 'database', () => false, { dropCache: vi.fn() } as never, vi.fn(), vi.fn(),
        tool.save(element), {}
      );

      await expect(manager.setData(renamed(tool.save(element), 'Peer name'))).resolves.toBe(true);
      expect(tool.save(element).views[0].name).toBe('Peer name');

      tool.destroy();
    });
  });

  describe('gallery and calendar views', () => {
    const dateSchema: PropertyDefinition[] = [
      { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
      { id: 'prop-due', name: 'Due', type: 'date', position: 'a1' },
    ];
    const galleryView: DatabaseViewConfig = { id: 'view-gallery', name: 'Gallery', type: 'gallery', position: 'a0', sorts: [], filters: [], visibleProperties: [] };
    const calendarView: DatabaseViewConfig = { id: 'view-cal', name: 'Calendar', type: 'calendar', position: 'a0', sorts: [], filters: [], visibleProperties: [] };
    const rowsWithDates = (): BlockAPI[] => [
      createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'First', 'prop-due': '2026-10-09' }, position: 'a0' }),
      createMockRowBlock({ id: 'row-2', properties: { 'prop-title': 'Second', 'prop-due': '2026-10-12/2026-10-13' }, position: 'a1' }),
    ];
    const galleryTool = (view: Partial<DatabaseViewConfig> = {}, childBlocks: BlockAPI[] = rowsWithDates(), config: DatabaseConfig = {}): { tool: DatabaseTool; element: HTMLElement; options: BlockToolConstructorOptions<DatabaseData, DatabaseConfig> } => {
      const options = createDatabaseOptions({ schema: dateSchema, views: [{ ...galleryView, ...view }], activeViewId: view.id ?? 'view-gallery' }, config, { childBlocks });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      document.body.appendChild(element);
      tool.rendered();

      return { tool, element, options };
    };
    const storageKey = 'blok:database-calendar:test-block-id:view-cal';

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 9, 9, 12));
      window.localStorage.removeItem(storageKey);
    });

    afterEach(() => {
      vi.useRealTimers();
      document.body.innerHTML = '';
    });

    it('renders a gallery view as cards, with no board subsystems', () => {
      const { tool, element } = galleryTool();
      const internals = tool as unknown as { cardDrag: unknown; columnDrag: unknown; columnControls: unknown };

      expect(queryByData(element, 'data-blok-database-gallery')).not.toBeNull();
      expect(queryByData(element, 'data-blok-database-board')).toBeNull();
      expect(queryAllByData(element, 'data-blok-database-gallery-card').map((card) => card.getAttribute('data-row-id'))).toEqual(['row-1', 'row-2']);
      expect(internals.cardDrag).toBeNull();
      expect(internals.columnDrag).toBeNull();
      expect(internals.columnControls).toBeNull();

      tool.destroy();
    });

    it('still renders a view type it does not know as a board', () => {
      const options = createDatabaseOptions({
        views: [{ id: 'view-x', name: 'Timeline', type: 'timeline' as never, position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'view-x',
      });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      expect(queryByData(element, 'data-blok-database-board')).not.toBeNull();

      tool.destroy();
    });

    it('names new gallery and calendar views', () => {
      const { tool, element } = galleryTool();

      tool.addView('gallery');
      tool.addView('calendar');

      expect(tool.save(element).views.slice(1).map((v) => [v.name, v.type])).toEqual([['Gallery', 'gallery'], ['Calendar', 'calendar']]);
      expect(queryByData(element, 'data-blok-database-calendar')).not.toBeNull();

      tool.destroy();
    });

    it('adds a row from the trailing "+ New" card', () => {
      const { tool, element, options } = galleryTool();

      queryByData(element, 'data-blok-database-gallery-new')?.click();

      expect(options.api.blocks.insertAt).toHaveBeenCalledWith('database-row', expect.objectContaining({ title: '' }), expect.objectContaining({ parentId: 'test-block-id' }));

      tool.destroy();
    });

    it('shows the load limit, then more on "Load more"', () => {
      const many = Array.from({ length: 12 }, (_, i) =>
        createMockRowBlock({ id: `row-${i}`, properties: { 'prop-title': `Row ${i}` }, position: `a${String(i).padStart(2, '0')}` }));
      const { tool, element } = galleryTool({ loadLimit: 10 }, many);

      expect(queryAllByData(element, 'data-blok-database-gallery-card')).toHaveLength(10);
      queryByData(element, 'data-blok-database-gallery-load-more')?.click();
      expect(queryAllByData(element, 'data-blok-database-gallery-card')).toHaveLength(12);
      expect(queryByData(element, 'data-blok-database-gallery-load-more')).toBeNull();

      tool.destroy();
    });

    it('previews a row page from its child blocks', () => {
      const rows = rowsWithDates();
      const options = createDatabaseOptions({ schema: dateSchema, views: [galleryView], activeViewId: 'view-gallery' }, {}, { childBlocks: rows });
      const body = { id: 'b1', name: 'paragraph', preservedData: { text: 'Row one body' } } as unknown as BlockAPI;

      vi.mocked(options.api.blocks.getChildren).mockImplementation((parentId: string) => {
        if (parentId === 'row-1') return [body];
        if (parentId === 'test-block-id') return rows;

        return [];
      });
      const tool = new DatabaseTool(options);
      const element = tool.render();
      const [first] = queryAllByData(element, 'data-blok-database-gallery-card');

      expect(queryByData(first, 'data-blok-database-gallery-preview')?.textContent).toBe('Row one body');

      tool.destroy();
    });

    it('moves a dropped gallery card between its neighbours', () => {
      const children = rowsWithDates();
      const { tool } = galleryTool({}, children);
      const internals = tool as unknown as { view: { options: { handlers: { moveRow: (r: unknown) => void } } } };

      internals.view.options.handlers.moveRow({ rowId: 'row-1', afterRowId: 'row-2', beforeRowId: null, groupKey: '', fromGroupKey: '' });

      const moved = vi.mocked(children[0].call).mock.calls.find(([method]) => method === 'updatePosition')?.[1] as { position: string } | undefined;

      expect(moved !== undefined && moved.position > 'a1').toBe(true);

      tool.destroy();
    });

    describe('calendar', () => {
      const calendarTool = (view: Partial<DatabaseViewConfig> = {}, config: DatabaseConfig = {}, childBlocks: BlockAPI[] = rowsWithDates()): ReturnType<typeof galleryTool> =>
        galleryTool({ ...calendarView, ...view }, childBlocks, config);

      it('renders the current month with each row on its date', () => {
        const { tool, element } = calendarTool();
        const event = queryAllByData(element, 'data-blok-database-calendar-event').find((el) => el.getAttribute('data-row-id') === 'row-1');

        expect(event?.closest('[data-blok-database-calendar-day]')?.getAttribute('data-day')).toBe('2026-10-09');
        expect(queryAllByData(element, 'data-blok-database-calendar-day')[0].getAttribute('data-day')).toBe('2026-09-27');

        tool.destroy();
      });

      it('starts the week on config.weekStart', () => {
        const { tool, element } = calendarTool({}, { weekStart: 1 });

        expect(queryAllByData(element, 'data-blok-database-calendar-day')[0].getAttribute('data-day')).toBe('2026-09-28');

        tool.destroy();
      });

      it('remembers the shown month per person, in local storage', () => {
        const first = calendarTool();

        queryByData(first.element, 'data-blok-database-calendar-next')?.click();
        expect(queryAllByData(first.element, 'data-blok-database-calendar-day').some((el) => el.getAttribute('data-day') === '2026-11-15')).toBe(true);
        expect(first.tool.save(first.element).views[0]).not.toHaveProperty('anchor');
        first.tool.destroy();

        const again = calendarTool();

        expect(queryAllByData(again.element, 'data-blok-database-calendar-day').some((el) => el.getAttribute('data-day') === '2026-11-15')).toBe(true);
        again.tool.destroy();
      });

      it('shows today when local storage throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
          throw new Error('blocked');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
          throw new Error('blocked');
        });
        const { tool, element } = calendarTool();

        expect(queryAllByData(element, 'data-blok-database-calendar-day').some((el) => el.hasAttribute('data-today'))).toBe(true);
        queryByData(element, 'data-blok-database-calendar-next')?.click();
        expect(queryAllByData(element, 'data-blok-database-calendar-day').some((el) => el.getAttribute('data-day') === '2026-11-15')).toBe(true);

        tool.destroy();
      });

      it('adds a row on the day whose "+" is clicked', () => {
        const { tool, element, options } = calendarTool();
        const cell = queryAllByData(element, 'data-blok-database-calendar-day').find((el) => el.getAttribute('data-day') === '2026-10-20');

        cell?.querySelector<HTMLElement>('[data-blok-database-calendar-add]')?.click();

        expect(options.api.blocks.insertAt).toHaveBeenCalledWith(
          'database-row',
          expect.objectContaining({ properties: expect.objectContaining({ 'prop-due': '2026-10-20' }) }),
          expect.objectContaining({ parentId: 'test-block-id' }),
        );

        tool.destroy();
      });

      it('writes a dragged date to the row block', () => {
        const children = rowsWithDates();
        const { tool } = calendarTool({}, {}, children);
        const internals = tool as unknown as { view: { options: { handlers: { setDate: (rowId: string, value: string) => void } } } };

        internals.view.options.handlers.setDate('row-1', '2026-10-14');

        expect(children[0].call).toHaveBeenCalledWith('updateProperties', { 'prop-due': '2026-10-14' });

        tool.destroy();
      });

      it('shows a message when no date property exists', () => {
        const options = createDatabaseOptions({ views: [calendarView], activeViewId: 'view-cal' });
        const tool = new DatabaseTool(options);
        const element = tool.render();

        expect(queryByData(element, 'data-blok-database-calendar-empty')).not.toBeNull();

        tool.destroy();
      });

      it('validates a calendar view without groupBy', () => {
        const tool = new DatabaseTool(createDatabaseOptions());

        expect(tool.validate(makeDefaultData({ schema: dateSchema, views: [calendarView], activeViewId: 'view-cal' }))).toBe(true);
      });
    });
  });
});

describe('DatabaseTool — row metadata and unique IDs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const idSchema: PropertyDefinition[] = [
    { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
    { id: 'prop-id', name: 'Code', type: 'uniqueId', position: 'a1', uniqueId: { prefix: 'T' } },
  ];

  const stampedRow = (id: string, position: string, createdAt: number, properties: Record<string, unknown> = {}): BlockAPI => {
    const block = createMockRowBlock({ id, position, properties: { 'prop-title': id, ...properties } });

    return Object.assign(block, { createdAt, createdBy: 'u1', lastEditedAt: createdAt + 1, lastEditedBy: 'u2' });
  };

  it('reads each row block\'s creation and edit metadata', () => {
    const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks: [stampedRow('r1', 'a0', 100)] }));

    tool.render();
    const model = (tool as unknown as { model: DatabaseModel }).model;

    expect(model.getRow('r1')?.meta).toEqual({ createdAt: 100, createdBy: 'u1', lastEditedAt: 101, lastEditedBy: 'u2' });
  });

  it('numbers rows in creation order and stores each number as a derived write', () => {
    const first = stampedRow('r1', 'a1', 100);
    const second = stampedRow('r2', 'a0', 200);
    const tool = new DatabaseTool(createDatabaseOptions({ schema: idSchema }, {}, { childBlocks: [second, first] }));

    tool.render();

    expect(first.call).toHaveBeenCalledWith('updateProperties', { 'prop-id': 1 });
    expect(second.call).toHaveBeenCalledWith('updateProperties', { 'prop-id': 2 });
    expect(first.dispatchChange).toHaveBeenCalledWith({ derived: true });
  });

  it('writes nothing for a row that already holds its number', () => {
    const row = stampedRow('r1', 'a0', 100, { 'prop-id': 1 });
    const tool = new DatabaseTool(createDatabaseOptions({ schema: idSchema }, {}, { childBlocks: [row] }));

    tool.render();

    expect(row.call).not.toHaveBeenCalledWith('updateProperties', expect.anything());
    expect(row.dispatchChange).not.toHaveBeenCalled();
  });

  it('shows the computed number read-only, without writing', () => {
    const row = stampedRow('r1', 'a0', 100);
    const tool = new DatabaseTool(createDatabaseOptions({ schema: idSchema }, {}, { childBlocks: [row], readOnly: true }));

    tool.render();
    const model = (tool as unknown as { model: DatabaseModel }).model;

    expect(model.getRow('r1')?.properties['prop-id']).toBe(1);
    expect(row.call).not.toHaveBeenCalledWith('updateProperties', expect.anything());
  });
});

describe('DatabaseTool — property operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const schema: PropertyDefinition[] = [
    { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
    { id: 'prop-note', name: 'Note', type: 'text', position: 'a1' },
    { id: 'prop-n', name: 'Amount', type: 'number', position: 'a2' },
  ];

  /** A row block backed by the real row tool, so writes land in its data. */
  const realRow = (id: string, properties: Record<string, PropertyValue>): { block: BlockAPI; tool: DatabaseRowTool } => {
    const tool = new DatabaseRowTool({ data: { position: 'a0', properties } } as never);
    const block = {
      id,
      name: 'database-row',
      holder: document.createElement('div'),
      get preservedData() {
        return tool.save(document.createElement('div'));
      },
      call: vi.fn((method: string, param?: unknown) => (tool as unknown as Record<string, (p?: unknown) => unknown>)[method]?.(param)),
      dispatchChange: vi.fn(),
    } as unknown as BlockAPI;

    return { block, tool };
  };

  const build = (rows: Array<{ block: BlockAPI }>, config: DatabaseConfig = {}): { tool: DatabaseTool; options: BlockToolConstructorOptions<DatabaseData, DatabaseConfig> } => {
    const options = createDatabaseOptions({ schema, views: [{ id: 'view-1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }] }, config, { childBlocks: rows.map((r) => r.block) });
    const tool = new DatabaseTool(options);

    tool.render();

    return { tool, options };
  };

  const schemaOf = (tool: DatabaseTool): PropertyDefinition[] => (tool as unknown as { model: DatabaseModel }).model.getSchema();

  it('adds a named property of a type, after a given property, as one change', () => {
    const { tool, options } = build([]);
    const added = tool.addProperty({ name: 'Stage', type: 'status', afterId: 'prop-title' });

    expect(schemaOf(tool).map((p) => p.id)).toEqual(['prop-title', added?.id, 'prop-note', 'prop-n']);
    expect(added).toMatchObject({ name: 'Stage', type: 'status' });
    expect(added?.status?.groups.map((g) => g.id)).toEqual(['todo', 'inProgress', 'complete']);
    expect(added?.config?.options.map((o) => o.groupId)).toEqual(['todo', 'inProgress', 'complete']);
    expect(options.block.dispatchChange).toHaveBeenCalled();
  });

  it('names a property after its type when the name field was left empty', () => {
    const { tool } = build([]);

    expect(tool.addProperty({ name: '', type: 'email' })?.name).toBe('tools.database.propertyTypeEmail');
  });

  it('refuses a person property without a people directory', () => {
    const { tool } = build([]);

    expect(tool.addProperty({ name: 'Owner', type: 'person' })).toBeNull();
  });

  it('changes a type and converts every row, keeping what the new type cannot hold', () => {
    const one = realRow('r1', { 'prop-title': 'A', 'prop-note': '42' });
    const two = realRow('r2', { 'prop-title': 'B', 'prop-note': 'lots' });
    const { tool } = build([one, two]);

    tool.changePropertyType('prop-note', 'number');

    expect(schemaOf(tool).find((p) => p.id === 'prop-note')?.type).toBe('number');
    expect(one.tool.getProperties()['prop-note']).toBe(42);
    expect(two.tool.getProperties()['prop-note']).toBeNull();
    expect(two.tool.save(document.createElement('div')).convertedValues).toEqual({ 'prop-note': { type: 'text', value: 'lots' } });
    expect(one.tool.save(document.createElement('div')).convertedValues).toBeUndefined();
  });

  it('never changes the title\'s type', () => {
    const { tool } = build([]);

    tool.changePropertyType('prop-title', 'text');

    expect(schemaOf(tool)[0].type).toBe('title');
  });

  it('duplicates a property with its values, right after it', () => {
    const one = realRow('r1', { 'prop-title': 'A', 'prop-n': 5 });
    const { tool } = build([one]);
    const copy = tool.duplicateProperty('prop-n');

    expect(schemaOf(tool).map((p) => p.id)).toEqual(['prop-title', 'prop-note', 'prop-n', copy?.id]);
    expect(copy?.type).toBe('number');
    expect(one.tool.getProperties()[copy?.id ?? '']).toBe(5);
  });

  it('deletes a property but keeps its row values (D9)', () => {
    const one = realRow('r1', { 'prop-title': 'A', 'prop-n': 5 });
    const { tool } = build([one]);

    tool.deleteProperty('prop-n');

    expect(schemaOf(tool).map((p) => p.id)).toEqual(['prop-title', 'prop-note']);
    expect(one.tool.getProperties()['prop-n']).toBe(5);
  });

  it('never deletes the title', () => {
    const { tool } = build([]);

    tool.deleteProperty('prop-title');

    expect(schemaOf(tool).map((p) => p.id)).toContain('prop-title');
  });

  it('saves property settings and renames', () => {
    const { tool, options } = build([]);

    tool.updatePropertySettings('prop-n', { number: { format: 'dollar', decimals: 2 } });
    tool.renameProperty('prop-n', 'Budget');

    expect(schemaOf(tool).find((p) => p.id === 'prop-n')).toMatchObject({ name: 'Budget', number: { format: 'dollar', decimals: 2 } });
    expect(tool.save(document.createElement('div')).schema.find((p) => p.id === 'prop-n')).toMatchObject({ name: 'Budget', number: { format: 'dollar', decimals: 2 } });
    expect(options.block.dispatchChange).toHaveBeenCalled();
  });

  it('tells the backend about a type change with the converted property', async () => {
    const adapter = {
      loadDatabase: vi.fn().mockResolvedValue({ schema: [], views: [] }),
      updateProperty: vi.fn().mockResolvedValue({}),
      updateRow: vi.fn().mockResolvedValue({}),
    } as unknown as DatabaseAdapter;
    const { tool } = build([], { adapter });

    tool.changePropertyType('prop-note', 'email');
    await Promise.resolve();

    expect(adapter.updateProperty).toHaveBeenCalledWith(expect.objectContaining({ propertyId: 'prop-note', changes: expect.objectContaining({ type: 'email' }) }));
  });
});

describe('DatabaseTool — property menu and insert placement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives the property menu the saved status groups, so a settings change never saves a translated name', async () => {
    const { DatabasePropertyMenu } = await import('../../../../src/tools/database/database-property-menu');
    const open = vi.spyOn(DatabasePropertyMenu.prototype, 'open').mockImplementation(() => undefined);
    const tool = new DatabaseTool(createDatabaseOptions({}, {}, {}));

    tool.render();
    const stage = tool.addProperty({ name: 'Stage', type: 'status' });

    tool.openPropertyMenu(stage?.id ?? '', document.createElement('button'));
    const passed = open.mock.calls[0]?.[0];

    expect(passed?.status?.groups.map((g) => g.name)).toEqual(['To-do', 'In progress', 'Complete']);
  });

  it('inserts to the right of a column in the view\'s column order, not the schema order', () => {
    const schema: PropertyDefinition[] = [
      { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
      { id: 'prop-note', name: 'Note', type: 'text', position: 'a1' },
      { id: 'prop-n', name: 'Amount', type: 'number', position: 'a2' },
    ];
    const view: DatabaseViewConfig = {
      id: 'view-1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['prop-n', 'prop-note'],
      properties: [{ id: 'prop-title', visible: true }, { id: 'prop-n', visible: true }, { id: 'prop-note', visible: true }],
    };
    const tool = new DatabaseTool(createDatabaseOptions({ schema, views: [view], activeViewId: 'view-1' }));

    tool.render();
    const added = tool.addProperty({ name: 'Paid', type: 'checkbox', afterId: 'prop-n' });
    const model = (tool as unknown as { model: DatabaseModel }).model;

    expect(model.getView('view-1')?.properties?.map((p) => p.id)).toEqual(['prop-title', 'prop-n', added?.id, 'prop-note']);
  });
});
