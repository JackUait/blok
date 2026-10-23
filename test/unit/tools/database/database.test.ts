import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { fireEvent, queryAllByAttribute } from '@testing-library/dom';
import type { API, BlockAPI, BlockToolConstructorOptions, OutputData } from '../../../../types';
import type { DatabaseAdapter, DatabaseData, DatabaseConfig, DatabaseRow, DatabaseRowData, DatabaseViewConfig, PropertyDefinition, PropertyValue } from '../../../../src/tools/database/types';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import { DatabaseChartView } from '../../../../src/tools/database/database-chart-view';
import { DataPersistenceManager } from '../../../../src/components/block/data-persistence-manager';
import { NO_VALUE_GROUP_KEY, type DatabaseModel } from '../../../../src/tools/database/database-model';
import type { CardDragResult, DatabaseCardDrag } from '../../../../src/tools/database/database-card-drag';
import type { GroupDragResult, DatabaseColumnDrag } from '../../../../src/tools/database/database-column-drag';
import type { TableRowDropResult } from '../../../../src/tools/database/database-table-row-drag';

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
    getBlockByIndex: vi.fn(),
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
    // research/28 §1a: Notion's Database section, in order (Dashboard, the charts and Full page are not built).
    it('toolbox lists the measured Database entries in Notion\'s order, with their labels', () => {
      const entries = DatabaseTool.toolbox as Array<{ name: string; titleKey: string; section: string; data?: Record<string, unknown> }>;

      expect(entries.map((entry) => [entry.name, entry.titleKey])).toEqual([
        ['tableView', 'tableView'],
        ['board', 'board'],
        ['galleryView', 'galleryView'],
        ['listView', 'listView'],
        ['feedView', 'feedView'],
        ['calendarView', 'calendarView'],
        ['timelineView', 'timelineView'],
        ['mapView', 'mapView'],
        ['databaseForm', 'tools.database.viewTypeForm'],
        ['database', 'databaseInline'],
        ['linkedDatabase', 'linkedDatabase'],
      ]);
      expect(entries.every((entry) => entry.section === 'database')).toBe(true);
      expect(entries.map((entry) => entry.data?.initialView)).toEqual([
        'table', 'board', 'gallery', 'list', 'feed', 'calendar', 'timeline', 'map', 'form', 'table', 'table',
      ]);
    });

    // research/28 §1c: Notion's hover hint text is each entry's preview caption.
    it('each entry has a preview whose caption is Notion\'s hint', () => {
      const entries = DatabaseTool.toolbox as Array<{ name: string; preview?: { render: () => HTMLElement; descriptionKey?: string } }>;

      expect(entries.map((entry) => [entry.name, entry.preview?.descriptionKey])).toEqual([
        ['tableView', 'toolbox.preview.tableView'],
        ['board', 'toolbox.preview.board'],
        ['galleryView', 'toolbox.preview.galleryView'],
        ['listView', 'toolbox.preview.listView'],
        ['feedView', 'toolbox.preview.feedView'],
        ['calendarView', 'toolbox.preview.calendarView'],
        ['timelineView', 'toolbox.preview.timelineView'],
        ['mapView', 'toolbox.preview.mapView'],
        ['databaseForm', 'toolbox.preview.form'],
        ['database', 'toolbox.preview.database'],
        ['linkedDatabase', 'toolbox.preview.linkedDatabase'],
      ]);
      expect(entries.every((entry) => typeof entry.preview?.render === 'function')).toBe(true);
    });

    it('the Inline entry no longer answers to board words: it makes a table', () => {
      const entries = DatabaseTool.toolbox as Array<{ name: string; searchTerms: string[] }>;
      const inline = entries.find((entry) => entry.name === 'database');

      expect(inline?.searchTerms).toEqual(expect.arrayContaining(['database', 'inline']));
      expect(inline?.searchTerms).not.toContain('kanban');
      expect(inline?.searchTerms).not.toContain('board');
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
      expect(Object.keys(saved).sort()).toEqual(['activeViewId', 'automations', 'futureKey', 'schema', 'title', 'views']);
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
    it('clicking card-menu button and selecting Move to Trash calls api.blocks.delete', () => {
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
      const deleteAction = queryByData(document.body, 'data-mock-popover-action', /movetotrash/)!;

      expect(deleteAction).not.toBeNull();

      deleteAction.click();

      expect(options.api.blocks.getBlockIndex).toHaveBeenCalledWith('row-1');
      expect(options.api.blocks.delete).toHaveBeenCalledWith(1);

      // Cleanup mock popover
      queryByData(document.body, 'data-mock-popover')?.remove();
    });
  });

  describe('Add to Favorites (config.favorites)', () => {
    const openCardMenu = (config: DatabaseConfig, readOnly = false): HTMLElement => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' }, position: 'a0' }),
      ];
      const tool = new DatabaseTool(createDatabaseOptions({}, config, { childBlocks, readOnly }));
      const element = tool.render();

      tool.rendered();
      // Read-only cards have no ••• button; a right-click opens the same menu.
      if (readOnly) queryByData(element, 'data-blok-database-card')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      else queryByData(element, 'data-blok-database-card-menu')?.click();

      return document.body;
    };

    afterEach(() => {
      queryByData(document.body, 'data-mock-popover')?.remove();
    });

    it('is not in the card menu without the lever', () => {
      expect(queryByData(openCardMenu({}), 'data-mock-popover-action', /favorites/)).toBeNull();
    });

    it('asks the host and hands it the next state, read-only too', () => {
      const favorites = { isFavorite: vi.fn(() => false), onToggle: vi.fn() };
      const body = openCardMenu({ favorites }, true);
      const item = queryByData(body, 'data-mock-popover-action', /addtofavorites/);

      expect(favorites.isFavorite).toHaveBeenCalledWith({ databaseId: 'test-block-id', rowId: 'row-1' });
      if (item === null) throw new Error('no Add to Favorites');
      item.click();
      expect(favorites.onToggle).toHaveBeenCalledWith({ databaseId: 'test-block-id', rowId: 'row-1', favorite: true });
    });

    it('a throwing isFavorite still opens the menu, as not a favorite', () => {
      const body = openCardMenu({ favorites: { isFavorite: () => { throw new Error('host'); }, onToggle: vi.fn() } });

      expect(queryByData(body, 'data-mock-popover-action', /addtofavorites/)).not.toBeNull();
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
          getBlockByIndex: vi.fn(),
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

      expect(opened).toHaveBeenCalledWith(expect.objectContaining({ pageId: 'row-page' }), 'side');
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
      const deleteAction = queryByData(document.body, 'data-mock-popover-action', /movetotrash/);

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
      const deleteAction = queryByData(document.body, 'data-mock-popover-action', /movetotrash/);

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

    it('entering read-only leaves cards undraggable; a click opens the page to read', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks: makeBoardRows() }));
      const element = tool.render();

      tool.rendered();
      tool.setReadOnly(true);

      const notPrevented = fireEvent.pointerDown(getCard(element), { clientX: 0, clientY: 0 });

      getCard(element).click();

      expect(queryByData(element, 'data-blok-database-drawer-title')?.hasAttribute('readonly')).toBe(true);
      expect(queryByData(element, 'data-blok-database-drawer-add-prop')).toBeNull();
      expect(notPrevented).toBe(true);

      tool.destroy();
    });

    it('rows that arrive after a read-only boot stay undraggable; a click opens the page to read', () => {
      const options = createDatabaseOptions({}, {}, { readOnly: true });

      (options.api.blocks.getChildren as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce([])
        .mockReturnValue(makeBoardRows());

      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();

      const notPrevented = fireEvent.pointerDown(getCard(element), { clientX: 0, clientY: 0 });

      getCard(element).click();

      expect(queryByData(element, 'data-blok-database-drawer-title')?.hasAttribute('readonly')).toBe(true);
      expect(queryByData(element, 'data-blok-database-drawer-add-prop')).toBeNull();
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

    describe('grouped by a status', () => {
      // Labels sort Done < In progress < Not started, the reverse of the workflow.
      const statusBoard = (view: Partial<DatabaseViewConfig> = {}): { tool: DatabaseTool; element: HTMLElement } => {
        const options = createDatabaseOptions({
          schema: [
            { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
            { id: 'prop-stage', name: 'Stage', type: 'status', position: 'a1',
              status: { groups: [
                { id: 'todo', kind: 'todo', name: 'To-do', position: 'a0' },
                { id: 'doing', kind: 'inProgress', name: 'In progress', position: 'a1' },
                { id: 'complete', kind: 'complete', name: 'Complete', position: 'a2' },
              ] },
              config: { options: [
                { id: 's-done', label: 'Done', color: 'green', position: 'a0', groupId: 'complete' },
                { id: 's-doing', label: 'In progress', color: 'blue', position: 'a0', groupId: 'doing' },
                { id: 's-todo', label: 'Not started', color: 'gray', position: 'a0', groupId: 'todo' },
              ] } },
          ],
          views: [{
            id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-stage',
            sorts: [], filters: [], visibleProperties: [], ...view,
          }],
        // A row with no status, so the no-value column shows (findings-board B03).
        }, {}, { childBlocks: [createMockRowBlock({ id: 'row-none', properties: { 'prop-title': 'Loose' }, position: 'a0' })] });
        const tool = new DatabaseTool(options);
        const element = tool.render();

        tool.rendered();

        return { tool, element };
      };

      it.each([
        ['no stored sort', {}, ['s-todo', 's-doing', 's-done', NO_VALUE_GROUP_KEY]],
        ['ascending', { groupSettings: { sort: 'ascending' } }, ['s-todo', 's-doing', 's-done', NO_VALUE_GROUP_KEY]],
        ['descending', { groupSettings: { sort: 'descending' } }, ['s-done', 's-doing', 's-todo', NO_VALUE_GROUP_KEY]],
        ['manual', { groupSettings: { sort: 'manual' } }, ['s-todo', 's-doing', 's-done', NO_VALUE_GROUP_KEY]],
      ] as const)('orders columns by workflow, not label, with %s', (_name, view, expected) => {
        const { tool, element } = statusBoard(view);

        expect(columnIds(element)).toEqual(expected);

        tool.destroy();
      });

      it('keeps the stored no-value place under the default sort', () => {
        const { tool, element } = statusBoard({ noValueGroupPosition: '0' });

        expect(columnIds(element)).toEqual([NO_VALUE_GROUP_KEY, 's-todo', 's-doing', 's-done']);

        tool.destroy();
      });
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

    const board = (readOnly = false, data: Partial<DatabaseData> = {}): {
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
      const options = createDatabaseOptions(data, {}, { childBlocks });
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

      // The row menu adds its own class on top (feel findings B15).
      expect(queryByData(document.body, 'data-mock-popover-class', 'blok-database-menu blok-database-row-menu blok-database-card-menu')).not.toBeNull();

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

    const boardView = (overrides: Partial<DatabaseViewConfig>): Partial<DatabaseData> => ({
      views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [], ...overrides }],
    });

    const countOf = (element: HTMLElement, optionId: string): HTMLElement | undefined =>
      queryAllByData(element, 'data-blok-database-column')
        .find((col) => col.getAttribute('data-option-id') === optionId)
        ?.querySelector<HTMLElement>('[data-blok-database-column-count]') ?? undefined;

    it('opens the calculation menu from the count', () => {
      const { tool, element } = board();

      countOf(element, 'opt-todo')?.click();

      expect([...document.body.querySelectorAll('[data-mock-popover-action]')].map((el) => el.getAttribute('data-mock-popover-action')))
        .toEqual(['tools.database.calccount', 'tools.database.calcpercent']);

      tool.destroy();
    });

    it('shows the saved board calculation in every column', () => {
      const { tool, element } = board(false, boardView({ groupCalculation: { id: 'prop-title', fn: 'empty', capCounts: false } }));

      expect(countOf(element, 'opt-todo')?.textContent).toBe('0');
      expect(countOf(element, 'opt-done')?.textContent).toBe('0');

      tool.destroy();
    });

    it('brings the counts back as Count all with "Show aggregation"', () => {
      const { tool, element } = board(false, boardView({
        hideGroupAggregation: true, groupCalculation: { id: 'prop-title', fn: 'count_values', capCounts: false },
      }));

      openMenu(element, 'opt-todo');
      pick('tools.database.groupShowAggregation');

      const saved = tool.save(element).views[0];

      expect(saved.groupCalculation).toBeUndefined();
      expect(saved.hideGroupAggregation).toBe(false);
      expect(countOf(element, 'opt-todo')?.hidden).toBe(false);

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
    // research/36 §4: Escape saves the title, nothing keeps focus and no card is selected.
    it('Escape in a card rename saves, drops focus to the page and selects no card', async () => {
      const childBlocks = [createMockRowBlock({ id: 'row-a', properties: { 'prop-title': 'F1', 'prop-status': 'opt-todo' }, position: 'a0' })];
      const tool = new DatabaseTool(createDatabaseOptions({
        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', filters: [], visibleProperties: [], sorts: [] }],
      }, {}, { childBlocks }));
      const element = tool.render();

      document.body.appendChild(element);
      tool.rendered();
      queryAllByData(element, 'data-row-id', 'row-a').find((el) => el.hasAttribute('data-blok-database-edit-card'))?.click();
      const input = queryByData(element, 'data-blok-database-card-title-input');

      if (!(input instanceof HTMLInputElement)) throw new Error('no title input');
      input.value = 'F1X';
      fireEvent.keyDown(input, { key: 'Escape' });
      fireEvent.keyUp(document.body, { key: 'Escape' });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(document.body).toHaveFocus();
      expect(queryAllByData(element, 'data-blok-database-card-title').map((el) => el.textContent)).toEqual(['F1X']);
      expect(element.querySelector('[data-blok-database-row-selected]')).toBeNull();

      tool.destroy();
      document.body.innerHTML = '';
    });
  });

  describe('board load limit (research/08: 10/25/50/100, board default 25)', () => {
    const boardWith = (count: number, view: Partial<DatabaseViewConfig> = {}): { tool: DatabaseTool; element: HTMLElement } => {
      const rows = Array.from({ length: count }, (_, i) =>
        createMockRowBlock({ id: `row-${i}`, properties: { 'prop-title': `Row ${i}`, 'prop-status': 'opt-todo' }, position: `a${String(i).padStart(2, '0')}` }));
      const options = createDatabaseOptions({
        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [], ...view }],
      }, {}, { childBlocks: rows });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      document.body.appendChild(element);
      tool.rendered();

      return { tool, element };
    };
    const todo = (element: HTMLElement): HTMLElement | null => element.querySelector('[data-blok-database-column][data-option-id="opt-todo"]');

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('shows 25 cards per column by default, the full count, and more on "Load more"', () => {
      const { tool, element } = boardWith(30);

      expect(todo(element)?.querySelectorAll('[data-blok-database-card]')).toHaveLength(25);
      expect(todo(element)?.querySelector('[data-blok-database-column-count]')?.textContent).toBe('30');
      todo(element)?.querySelector<HTMLElement>('[data-blok-database-column-load-more]')?.click();
      expect(todo(element)?.querySelectorAll('[data-blok-database-card]')).toHaveLength(30);
      expect(todo(element)?.querySelector('[data-blok-database-column-load-more]')).toBeNull();

      tool.destroy();
    });

    it('shows ten groups, then "Load more groups" adds ten more', () => {
      const optionsList = Array.from({ length: 12 }, (_, i) => ({ id: `o${i}`, label: `O${i}`, color: 'gray' as const, position: `a${String(i).padStart(2, '0')}` }));
      const options = createDatabaseOptions({
        schema: [
          { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
          { id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: { options: optionsList } },
        ],
      });
      const tool = new DatabaseTool(options);
      const element = tool.render();
      const columns = (): number => element.querySelectorAll('[data-blok-database-column]').length;

      document.body.appendChild(element);
      tool.rendered();

      expect(columns()).toBe(10);
      queryByData(element, 'data-blok-database-load-more-groups')?.click();
      expect(columns()).toBe(13);
      expect(queryByData(element, 'data-blok-database-load-more-groups')).toBeNull();

      tool.destroy();
    });

    it('takes the view\'s load limit', () => {
      const { tool, element } = boardWith(12, { loadLimit: 10 });

      expect(todo(element)?.querySelectorAll('[data-blok-database-card]')).toHaveLength(10);

      tool.destroy();
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

    const sortedTool = (
      type: 'board' | 'list' | 'table',
      otherViews: DatabaseViewConfig[] = [],
      setup: { sorts?: DatabaseViewConfig['sorts']; personal?: Record<string, unknown>; groupBy?: string; config?: DatabaseConfig } = {},
    ): {
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
          id: 'view-1', name: 'View', type, position: 'a0', groupBy: setup.groupBy ?? (type === 'board' ? 'prop-status' : undefined),
          filters: [], visibleProperties: [], sorts: setup.sorts ?? [{ propertyId: 'prop-title', direction: 'asc' }],
        }, ...otherViews],
      });
      const options = createDatabaseOptions(data, setup.config ?? {}, { childBlocks });
      const transact = vi.fn((fn: () => void) => fn());
      // The per-browser fallback for personal edits (D4), seeded with this person's sort.
      const personal = new Map<string, unknown>(setup.personal === undefined ? [] : [['view:view-1', setup.personal]]);

      Object.assign(options.api.blocks, { transact });
      Object.assign(options.api, {
        viewState: {
          get: (_blockId: string, key: string) => personal.get(key),
          set: (_blockId: string, key: string, value: unknown) => personal.set(key, value),
        },
      });

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

    const modelOf = (tool: DatabaseTool): DatabaseModel => (tool as unknown as { model: DatabaseModel }).model;

    /** The rows a view shows, in its order. */
    const viewRows = (tool: DatabaseTool, viewId: string): string[] => {
      const view = modelOf(tool).getView(viewId);

      return view === undefined ? [] : modelOf(tool).queryRows({ view }).rows.map((row) => row.id);
    };

    const dropUnsortedTableRow = (tool: DatabaseTool, result: TableRowDropResult): void => {
      (tool as unknown as { handleTableRowDrop: (r: TableRowDropResult) => void }).handleTableRowDrop(result);
    };

    const gallery: DatabaseViewConfig = {
      id: 'view-2', name: 'Gallery', type: 'gallery', position: 'a1', filters: [], visibleProperties: [], sorts: [],
    };

    /** Manual order is per view (research/22 OU17): the gallery kept its own through the table's Remove. */
    it('"Remove" in one view keeps the other views\' order and sorts', async () => {
      const other: DatabaseViewConfig = {
        id: 'view-2', name: 'Other', type: 'list', position: 'a1', filters: [], visibleProperties: [], sorts: [{ propertyId: 'prop-status', direction: 'desc' }],
      };
      const { tool, element, childBlocks } = sortedTool('board', [other, { ...gallery, id: 'view-3', position: 'a2' }]);

      dropCard(tool, { rowId: 'row-x', toOptionId: 'opt-todo', beforeRowId: 'row-b', afterRowId: 'row-a' });
      answer('confirm');
      await Promise.resolve();

      expect(viewRows(tool, 'view-3')).toEqual(['row-b', 'row-a', 'row-e', 'row-x']);
      expect(tool.save(element).views.find((view) => view.id === 'view-3')?.rowOrder).toEqual({ 'row-b': 'a0', 'row-a': 'a1', 'row-e': 'a2', 'row-x': 'a3' });
      expect(manualOrder(childBlocks)).toEqual(['row-a', 'row-x', 'row-b', 'row-e']);
      expect(tool.save(element).views.find((view) => view.id === 'view-2')?.sorts).toEqual([{ propertyId: 'prop-status', direction: 'desc' }]);

      tool.destroy();
    });

    it('a table drag leaves the gallery\'s order alone', () => {
      const { tool, element } = sortedTool('table', [gallery], { sorts: [] });

      dropUnsortedTableRow(tool, { rowId: 'row-x', beforeRowId: 'row-a', afterRowId: 'row-b', groupKey: '', fromGroupKey: '' });

      expect(viewRows(tool, 'view-2')).toEqual(['row-b', 'row-a', 'row-e', 'row-x']);
      expect(viewRows(tool, 'view-1')).toEqual(['row-b', 'row-x', 'row-a', 'row-e']);
      expect(tool.save(element).views[0].rowOrder).toBeUndefined();

      tool.destroy();
    });

    it('a table drag leaves a gallery row alone that the gallery holds no key for', () => {
      const { tool } = sortedTool('table', [{ ...gallery, rowOrder: { 'row-x': 'Zz' } }], { sorts: [] });

      dropUnsortedTableRow(tool, { rowId: 'row-b', beforeRowId: null, afterRowId: 'row-x', groupKey: '', fromGroupKey: '' });

      expect(viewRows(tool, 'view-2')).toEqual(['row-x', 'row-b', 'row-a', 'row-e']);
      expect(viewRows(tool, 'view-1')).toEqual(['row-a', 'row-e', 'row-x', 'row-b']);

      tool.destroy();
    });

    const adapterFor = (viewRowOrder?: true): DatabaseAdapter => ({
      // Never settles: the test's own views stay, no backend snapshot replaces them.
      loadDatabase: vi.fn(() => new Promise<never>(() => undefined)),
      createRow: vi.fn(), updateRow: vi.fn(), moveRow: vi.fn().mockResolvedValue(undefined), deleteRow: vi.fn(),
      createProperty: vi.fn(), updateProperty: vi.fn(), deleteProperty: vi.fn(),
      createView: vi.fn(), updateView: vi.fn().mockResolvedValue(undefined), deleteView: vi.fn(),
      ...(viewRowOrder === undefined ? {} : { viewRowOrder }),
    });

    it('an adapter that does not store a view\'s own order keeps the shared order and moveRow', () => {
      const adapter = adapterFor();
      const { tool, element, childBlocks } = sortedTool('table', [gallery], { sorts: [], config: { adapter } });

      dropUnsortedTableRow(tool, { rowId: 'row-x', beforeRowId: 'row-a', afterRowId: 'row-b', groupKey: '', fromGroupKey: '' });

      expect(adapter.moveRow).toHaveBeenCalledWith(expect.objectContaining({ rowId: 'row-x' }));
      expect(adapter.updateView).not.toHaveBeenCalled();
      expect(manualOrder(childBlocks)).toEqual(['row-b', 'row-x', 'row-a', 'row-e']);
      expect(tool.save(element).views.map((view) => view.rowOrder)).toEqual([undefined, undefined]);
      expect(viewRows(tool, 'view-2')).toEqual(['row-b', 'row-x', 'row-a', 'row-e']);

      tool.destroy();
    });

    it('an adapter that stores a view\'s own order gets it through updateView', () => {
      const adapter = adapterFor(true);
      const { tool } = sortedTool('table', [{ ...gallery, rowOrder: { 'row-x': 'Zz' } }], { sorts: [], config: { adapter } });

      (tool as unknown as { activeViewId: string }).activeViewId = 'view-2';
      dropUnsortedTableRow(tool, { rowId: 'row-e', beforeRowId: 'row-b', afterRowId: 'row-x', groupKey: '', fromGroupKey: '' });

      expect(adapter.updateView).toHaveBeenCalledWith({ viewId: 'view-2', changes: { rowOrder: expect.objectContaining({ 'row-x': 'Zz', 'row-e': expect.any(String) }) } });
      expect(adapter.moveRow).not.toHaveBeenCalled();
      expect(viewRows(tool, 'view-2')).toEqual(['row-x', 'row-e', 'row-b', 'row-a']);

      tool.destroy();
    });

    it('a drag in a single-view database writes the shared order only', () => {
      const { tool, element, childBlocks } = sortedTool('table', [], { sorts: [] });

      dropUnsortedTableRow(tool, { rowId: 'row-x', beforeRowId: 'row-a', afterRowId: 'row-b', groupKey: '', fromGroupKey: '' });

      expect(manualOrder(childBlocks)).toEqual(['row-b', 'row-x', 'row-a', 'row-e']);
      expect(tool.save(element).views[0].rowOrder).toBeUndefined();

      tool.destroy();
    });

    it('a drag in a view with its own order moves it there only', () => {
      const { tool, element, childBlocks } = sortedTool('table', [{ ...gallery, rowOrder: { 'row-x': 'Zz' } }], { sorts: [] });

      (tool as unknown as { activeViewId: string }).activeViewId = 'view-2';
      dropUnsortedTableRow(tool, { rowId: 'row-e', beforeRowId: 'row-b', afterRowId: 'row-x', groupKey: '', fromGroupKey: '' });

      expect(viewRows(tool, 'view-2')).toEqual(['row-x', 'row-e', 'row-b', 'row-a']);
      expect(viewRows(tool, 'view-1')).toEqual(['row-b', 'row-a', 'row-e', 'row-x']);
      expect(childBlocks.flatMap((block) => callsNamed(block, 'updatePosition'))).toHaveLength(0);
      expect(tool.save(element).views[0].rowOrder).toBeUndefined();

      tool.destroy();
    });

    it('"Remove" in a view with its own order bakes the sorted order into that view only', async () => {
      const { tool, element, childBlocks } = sortedTool('list', [gallery]);

      modelOf(tool).updateView('view-1', { rowOrder: { 'row-x': 'Zz' } });
      dropListRow(tool, { rowId: 'row-a', beforeRowId: null, afterRowId: 'row-x' });
      answer('confirm');
      await Promise.resolve();

      expect(viewRows(tool, 'view-1')).toEqual(['row-b', 'row-x', 'row-a', 'row-e']);
      expect(viewRows(tool, 'view-2')).toEqual(['row-b', 'row-a', 'row-e', 'row-x']);
      expect(childBlocks.flatMap((block) => callsNamed(block, 'updatePosition'))).toHaveLength(0);
      expect(tool.save(element).views[1].rowOrder).toBeUndefined();

      tool.destroy();
    });

    it('deleting the sort brings back this view\'s own manual order', () => {
      const { tool } = sortedTool('table', [gallery]);

      modelOf(tool).updateView('view-1', { rowOrder: { 'row-x': 'Zz' } });
      expect(viewRows(tool, 'view-1')).toEqual(['row-a', 'row-b', 'row-x', 'row-e']);

      modelOf(tool).updateView('view-1', { sorts: [] });

      expect(viewRows(tool, 'view-1')).toEqual(['row-x', 'row-b', 'row-a', 'row-e']);

      tool.destroy();
    });

    it('gives the other views their own order inside the same undo step as the drag', () => {
      const { tool, options, transact } = sortedTool('table', [gallery], { sorts: [] });
      const steps: string[] = [];

      transact.mockImplementation((fn: () => void) => {
        steps.push('begin');
        fn();
        steps.push('end');
      });
      vi.mocked(options.block.dispatchChange).mockImplementation(() => {
        steps.push(modelOf(tool).getView('view-2')?.rowOrder === undefined ? 'database' : 'database:frozen');
      });

      dropUnsortedTableRow(tool, { rowId: 'row-x', beforeRowId: 'row-a', afterRowId: 'row-b', groupKey: '', fromGroupKey: '' });

      expect(steps.slice(0, 3)).toEqual(['begin', 'database:frozen', 'end']);

      tool.destroy();
    });

    it('without editStructure, a drag moves the shared order and gives no view its own', () => {
      const { tool, element, childBlocks } = sortedTool('table', [gallery], {
        sorts: [],
        config: { permissions: { can: (action: string) => action !== 'editStructure' } },
      });

      dropUnsortedTableRow(tool, { rowId: 'row-x', beforeRowId: 'row-a', afterRowId: 'row-b', groupKey: '', fromGroupKey: '' });

      expect(manualOrder(childBlocks)).toEqual(['row-b', 'row-x', 'row-a', 'row-e']);
      expect(tool.save(element).views.map((view) => view.rowOrder)).toEqual([undefined, undefined]);

      tool.destroy();
    });

    /** Makes inserted rows real children, so the model sees them. */
    const liveInserts = (options: BlockToolConstructorOptions<DatabaseData, DatabaseConfig>, childBlocks: BlockAPI[]): void => {
      vi.mocked(options.api.blocks.insertAt).mockImplementation((_name, data, at) => {
        const row = data as DatabaseRowData;
        const block = positionRow(String(at?.id), row.properties, row.position);

        childBlocks.push(block);

        return block;
      });
    };

    const addRow = (tool: DatabaseTool, options: BlockToolConstructorOptions<DatabaseData, DatabaseConfig>, childBlocks: BlockAPI[], after?: string): string | null => {
      liveInserts(options, childBlocks);

      return (tool as unknown as { addTableRow: (group: string | null, after?: string) => string | null }).addTableRow(null, after);
    };

    it('a duplicate lands right below its original in a view with its own order', () => {
      const { tool, options, childBlocks } = sortedTool('table', [], { sorts: [] });

      modelOf(tool).updateView('view-1', { rowOrder: { 'row-x': 'Zz' } });
      liveInserts(options, childBlocks);
      // Rows have no body here; the mock's default would list the rows as every block's children.
      vi.mocked(options.api.blocks.getChildren).mockImplementation((parentId) => (parentId === 'test-block-id' ? childBlocks : []));
      (tool as unknown as { duplicateTableRow: (rowId: string) => void }).duplicateTableRow('row-x');

      const shown = viewRows(tool, 'view-1');

      expect(shown).toHaveLength(5);
      expect(shown.slice(0, 1)).toEqual(['row-x']);
      expect(shown.slice(2)).toEqual(['row-b', 'row-a', 'row-e']);

      tool.destroy();
    });

    it('a row added below another lands right below it in a view with its own order', () => {
      const { tool, options, childBlocks } = sortedTool('table', [], { sorts: [] });

      modelOf(tool).updateView('view-1', { rowOrder: { 'row-x': 'Zz' } });
      const added = addRow(tool, options, childBlocks, 'row-x');

      expect(viewRows(tool, 'view-1').slice(0, 2)).toEqual(['row-x', added]);

      tool.destroy();
    });

    it('a new row goes last in every view', () => {
      const { tool, options, childBlocks } = sortedTool('table', [{ ...gallery, rowOrder: { 'row-b': 'zz' } }], { sorts: [] });
      const added = addRow(tool, options, childBlocks);

      expect(viewRows(tool, 'view-2').at(-1)).toBe(added);
      expect(viewRows(tool, 'view-1').at(-1)).toBe(added);

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

    const dropTableRow = (tool: DatabaseTool, result: TableRowDropResult): void => {
      (tool as unknown as { onSortedRowDrop: (r: TableRowDropResult) => void }).onSortedRowDrop(result);
    };

    const effectiveSorts = (tool: DatabaseTool): unknown => {
      const controls = (tool as unknown as { controls: { effective: (v: DatabaseViewConfig) => DatabaseViewConfig } }).controls;
      const model = (tool as unknown as { model: DatabaseModel }).model;
      const view = model.getView('view-1');

      return view === undefined ? undefined : controls.effective(view).sorts;
    };

    it('asks the same question when a row is dropped in a sorted table, and "Remove" lands it', async () => {
      const { tool, element, childBlocks } = sortedTool('table');

      dropTableRow(tool, { rowId: 'row-x', beforeRowId: 'row-b', afterRowId: 'row-a', groupKey: '', fromGroupKey: '' });

      expect(confirmTitle()).toBe('tools.database.removeSortingTitle');
      expect(childBlocks.flatMap((block) => callsNamed(block, 'updatePosition'))).toHaveLength(0);

      answer('confirm');
      await Promise.resolve();

      expect(tool.save(element).views[0].sorts).toEqual([]);
      expect(manualOrder(childBlocks)).toEqual(['row-a', 'row-x', 'row-b', 'row-e']);

      tool.destroy();
    });

    it('moves a row to another group of a sorted table by its group value only, without asking', () => {
      const { tool, childBlocks } = sortedTool('table', [], { groupBy: 'prop-status' });
      const rowX = childBlocks[3];

      dropTableRow(tool, { rowId: 'row-x', beforeRowId: null, afterRowId: null, groupKey: 'opt-doing', fromGroupKey: 'opt-todo' });

      expect(confirmTitle()).toBeUndefined();
      expect(callsNamed(rowX, 'updateProperties')).toEqual([['updateProperties', { 'prop-status': 'opt-doing' }]]);
      expect(callsNamed(rowX, 'updatePosition')).toHaveLength(0);

      tool.destroy();
    });

    it('asks in a list sorted only by this person, and "Remove" drops the personal sort, not the saved view', async () => {
      const { tool, element, childBlocks } = sortedTool('list', [], {
        sorts: [],
        personal: { sorts: [{ id: 's-me', propertyId: 'prop-title', direction: 'asc' }] },
      });

      dropListRow(tool, { rowId: 'row-a', beforeRowId: null, afterRowId: 'row-x' });

      expect(confirmTitle()).toBe('tools.database.removeSortingTitle');

      answer('confirm');
      await Promise.resolve();

      expect(effectiveSorts(tool)).toEqual([]);
      expect(tool.save(element).views[0].sorts).toEqual([]);
      expect(manualOrder(childBlocks)).toEqual(['row-b', 'row-x', 'row-a', 'row-e']);

      tool.destroy();
    });

    it('"Remove" in a locked database drops the sort for this person only and keeps the saved sort', async () => {
      const { tool, element, childBlocks } = sortedTool('board');
      const model = (tool as unknown as { model: DatabaseModel }).model;

      model.setDatabaseLocked(true);
      dropCard(tool, { rowId: 'row-x', toOptionId: 'opt-todo', beforeRowId: 'row-b', afterRowId: 'row-a' });
      answer('confirm');
      await Promise.resolve();

      expect(tool.save(element).views[0].sorts).toEqual([{ propertyId: 'prop-title', direction: 'asc' }]);
      expect(effectiveSorts(tool)).toEqual([]);
      expect(manualOrder(childBlocks)).toEqual(['row-a', 'row-x', 'row-b', 'row-e']);

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

    it('seeds a table from the Database - Inline entry and a board from the Board entry', () => {
      const entries = DatabaseTool.toolbox as Array<{ name: string; data?: Record<string, unknown> }>;

      expect(entries.find((entry) => entry.name === 'database')?.data).toEqual({ initialView: 'table' });
      expect(entries.find((entry) => entry.name === 'board')?.data).toEqual({ initialView: 'board' });
    });

    // research/28 §3: Board view = Name, Assign (Person), Status (Status), grouped by Status.
    it('a database from the Board seed saves the measured board, with no seed key', () => {
      const tool = new DatabaseTool({ ...createDatabaseOptions(), data: { initialView: 'board' } as unknown as DatabaseData });
      const saved = tool.save(tool.render());
      const status = saved.schema.find((p) => p.type === 'status');

      expect(saved.schema.map((p) => [p.name, p.type])).toEqual([['Name', 'title'], ['Assign', 'person'], ['Status', 'status']]);
      expect(saved.views.map((v) => [v.type, v.name, v.groupBy])).toEqual([['board', 'Board view', status?.id]]);
      expect(saved).not.toHaveProperty('initialView');
    });

    it('an empty database with no seed keeps the old default board', () => {
      const tool = new DatabaseTool({ ...createDatabaseOptions(), data: {} as DatabaseData });
      const saved = tool.save(tool.render());

      expect(saved.schema.map((p) => p.type)).toEqual(['title', 'select']);
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
        views: [{ id: 'view-x', name: 'Whiteboard', type: 'whiteboard' as never, position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [] }],
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
      const body = { id: 'b1', name: 'paragraph', holder: document.createElement('div'), preservedData: { text: 'Row one body' } } as unknown as BlockAPI;

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

    it('changes the card size from the layout items and redraws', () => {
      const { tool, element } = galleryTool();
      const size = tool.layoutItems().find((item) => 'title' in item && item.title === 'tools.database.galleryCardSize');
      const large = size !== undefined && 'children' in size ? size.children?.items?.[2] : undefined;

      if (large !== undefined && 'onActivate' in large) {
        large.onActivate?.(large);
      }

      expect(tool.save(element).views[0].cardSize).toBe('large');
      expect(queryByData(element, 'data-blok-database-gallery')?.getAttribute('data-card-size')).toBe('large');
      expect(new DatabaseTool(createDatabaseOptions({
        views: [{ id: 'view-list', name: 'List', type: 'list', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'view-list',
      })).layoutItems()).toEqual([]);

      tool.destroy();
    });

    describe('Delete on selected cards (research/22 §2)', () => {
      type Toast = { message: string; actions?: Array<{ label: string; onClick: () => void }> };
      type Step = API['history'] extends { latestStep: () => infer S } ? NonNullable<S> : never;

      const trashTool = (): { tool: DatabaseTool; element: HTMLElement; options: BlockToolConstructorOptions<DatabaseData, DatabaseConfig>; show: Mock<(options: unknown) => void>; history: { undo: Mock<() => void>; latestStep: Mock<() => Step | undefined>; undoStep: Mock<(step: Step) => boolean> }; deleteStep: Step } => {
        const rows = rowsWithDates();
        const { tool, element, options } = galleryTool({}, rows);
        const before = Object.freeze({}) as Step;
        const deleteStep = Object.freeze({}) as Step;
        const state = { top: before };
        const history = {
          undo: vi.fn<() => void>(),
          redo: vi.fn(),
          latestStep: vi.fn<() => Step | undefined>(() => state.top),
          undoStep: vi.fn<(step: Step) => boolean>(() => true),
        };

        vi.mocked(options.api.blocks.delete).mockImplementation(async () => {
          state.top = deleteStep;
        });
        Object.assign(options.api, { history });

        return { tool, element, options, show: vi.mocked(options.api.notifier.show) as Mock<(options: unknown) => void>, history, deleteStep };
      };
      const select = (element: HTMLElement, rowIds: string[]): void => {
        rowIds.forEach((rowId) => {
          queryAllByData(element, 'data-blok-database-gallery-card')
            .find((card) => card.getAttribute('data-row-id') === rowId)
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
        });
      };
      const pressDelete = (key: string): void => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      };
      const trashToast = (show: Mock<(options: unknown) => void>): Toast | undefined =>
        show.mock.calls.map(([options]) => options as Toast).find((options) => options.message === 'tools.database.movedToTrash');

      it('one card: trashes it at once and shows "Moved to Trash" with Restore, which undoes exactly that delete', () => {
        const { tool, element, show, history, deleteStep } = trashTool();

        select(element, ['row-1']);
        pressDelete('Backspace');

        const toast = trashToast(show);

        expect(toast?.actions?.map((action) => action.label)).toEqual(['tools.database.restore']);
        toast?.actions?.[0].onClick();
        expect(history.undoStep).toHaveBeenCalledExactlyOnceWith(deleteStep);
        expect(history.undo).not.toHaveBeenCalled();

        tool.destroy();
      });

      it('Restore never falls back to a plain undo when the delete left no step of its own', () => {
        const { tool, element, show, history } = trashTool();

        vi.mocked(history.latestStep).mockReturnValue(undefined);
        select(element, ['row-1']);
        pressDelete('Delete');
        trashToast(show)?.actions?.[0].onClick();

        expect(trashToast(show)).toBeDefined();
        expect(history.undoStep).not.toHaveBeenCalled();
        expect(history.undo).not.toHaveBeenCalled();

        tool.destroy();
      });

      it('Restore never undoes an older step when the delete did not add one', () => {
        const { tool, element, show, history, options } = trashTool();

        vi.mocked(options.api.blocks.delete).mockImplementation(async () => {});
        select(element, ['row-1']);
        pressDelete('Delete');
        trashToast(show)?.actions?.[0].onClick();

        expect(history.undoStep).not.toHaveBeenCalled();
        expect(trashToast(show)).toBeDefined();

        tool.destroy();
      });

      it('tells screen readers how many blocks were deleted, apart from the visible "Moved to Trash" (research/23 §2b)', () => {
        const announced = (rowIds: string[]): Array<string | undefined> => {
          const { tool, element, options, show } = trashTool();

          Object.assign(options.api, {
            i18n: { t: (key: string, vars?: { count?: number }) => vars?.count === undefined ? key : `${key}:${vars.count}` },
          });
          select(element, rowIds);
          pressDelete('Delete');
          tool.destroy();

          return show.mock.calls.map(([o]) => o as Toast & { announce?: string }).filter((o) => o.message === 'tools.database.movedToTrash').map((o) => o.announce);
        };

        expect(announced(['row-1', 'row-2'])).toEqual(['tools.database.blocksDeleted:2']);
        expect(announced(['row-2'])).toEqual(['tools.database.blocksDeleted:1']);
      });

      it('several cards: trashes them all in one step, with one toast whose Restore undoes that step (research/23 §2b)', () => {
        const { tool, element, options, show, history, deleteStep } = trashTool();
        const scope = { open: false, deletedInside: [] as boolean[] };
        const recordStep = vi.mocked(options.api.blocks.delete).getMockImplementation();

        Object.assign(options.api.blocks, {
          transact: (fn: () => void): void => {
            const outer = scope.open;

            scope.open = true;
            fn();
            scope.open = outer;
          },
        });
        vi.mocked(options.api.blocks.delete).mockImplementation(async (...args) => {
          scope.deletedInside.push(scope.open);
          await recordStep?.(...args);
        });
        select(element, ['row-1', 'row-2']);
        pressDelete('Delete');

        expect(scope.deletedInside).toEqual([true, true]);
        expect(show.mock.calls.filter(([o]) => (o as Toast).message === 'tools.database.movedToTrash')).toHaveLength(1);
        trashToast(show)?.actions?.[0].onClick();
        expect(history.undoStep).toHaveBeenCalledExactlyOnceWith(deleteStep);

        tool.destroy();
      });
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

    describe('timeline', () => {
      const timelineView: DatabaseViewConfig = { id: 'view-tl', name: 'Timeline', type: 'timeline', position: 'a0', sorts: [], filters: [], visibleProperties: [] };
      const twoDates: PropertyDefinition[] = [...dateSchema, { id: 'prop-end', name: 'End', type: 'date', position: 'a2' }];
      const timelineTool = (view: Partial<DatabaseViewConfig> = {}, childBlocks: BlockAPI[] = rowsWithDates(), schema: PropertyDefinition[] = dateSchema): ReturnType<typeof galleryTool> => {
        const options = createDatabaseOptions({ schema, views: [{ ...timelineView, ...view }], activeViewId: 'view-tl' }, {}, { childBlocks });
        const tool = new DatabaseTool(options);
        const element = tool.render();

        document.body.appendChild(element);
        tool.rendered();

        return { tool, element, options };
      };
      type TimelineInternals = { view: { options: { handlers: Record<string, (...args: never[]) => void> } } };
      const handlersOf = (tool: DatabaseTool): TimelineInternals['view']['options']['handlers'] =>
        (tool as unknown as TimelineInternals).view.options.handlers;
      const centerKey = 'blok:database-timeline:test-block-id:view-tl';

      beforeEach(() => {
        window.localStorage.removeItem(centerKey);
      });

      it('renders bars for dated rows, with no board subsystems', () => {
        const { tool, element } = timelineTool();
        const internals = tool as unknown as { cardDrag: unknown; columnDrag: unknown };

        expect(queryByData(element, 'data-blok-database-timeline')).not.toBeNull();
        expect(queryByData(element, 'data-blok-database-board')).toBeNull();
        expect(queryAllByData(element, 'data-blok-database-timeline-bar').map((bar) => bar.getAttribute('data-row-id'))).toEqual(['row-1', 'row-2']);
        expect(internals.cardDrag).toBeNull();
        expect(internals.columnDrag).toBeNull();

        tool.destroy();
      });

      it('names a new timeline view and gives it an empty table panel list', () => {
        const { tool, element } = galleryTool();

        tool.addView('timeline');

        const added = tool.save(element).views[1];

        expect([added.name, added.type, added.tableProperties]).toEqual(['Timeline', 'timeline', []]);
        expect(queryByData(element, 'data-blok-database-timeline')).not.toBeNull();

        tool.destroy();
      });

      it('writes a dragged two-property bar as one change to the row block', () => {
        const children = rowsWithDates();
        const { tool } = timelineTool({ timelineBy: 'prop-due', timelineEndBy: 'prop-end' }, children, twoDates);

        handlersOf(tool).writeDates('row-1' as never, { start: '2026-10-10', end: '2026-10-12' } as never);

        expect(vi.mocked(children[0].call).mock.calls.filter(([method]) => method === 'updateProperties'))
          .toEqual([['updateProperties', { 'prop-due': '2026-10-10', 'prop-end': '2026-10-12' }]]);

        tool.destroy();
      });

      it('stores a picked zoom and the table toggle on the view', () => {
        const { tool, element } = timelineTool();

        handlersOf(tool).setZoom('year' as never);
        expect(tool.save(element).views[0].timelineZoom).toBe('year');
        expect(queryByData(element, 'data-blok-database-timeline')?.getAttribute('data-zoom')).toBe('year');

        queryByData(element, 'data-blok-database-timeline-table-toggle')?.click();
        expect(tool.save(element).views[0].showTimelineTable).toBe(true);
        expect(queryByData(element, 'data-blok-database-timeline-table')).not.toBeNull();

        tool.destroy();
      });

      it('picks a table panel calculation from its footer cell and stores it on the view', () => {
        const { tool, element } = timelineTool({ showTimelineTable: true, calculations: [{ id: 'prop-title', fn: 'count' }] });

        queryByData(element, 'data-blok-database-timeline-table-footer')?.querySelector<HTMLElement>('[data-property-id="prop-title"]')?.click();

        const none = queryByData(document.body, 'data-mock-popover-action', 'tools.database.calcnone');

        expect(none).not.toBeNull();
        none?.click();
        expect(tool.save(element).views[0].calculations).toEqual([]);

        tool.destroy();
        queryByData(document.body, 'data-mock-popover')?.remove();
      });

      it('lists every zoom level in the zoom menu and stores a pick', () => {
        const { tool, element } = timelineTool();

        queryByData(element, 'data-blok-database-timeline-zoom')?.click();

        const items = [...document.querySelectorAll('[data-mock-popover-action]')];
        const zooms = ['Hours', 'Day', 'Week', 'BiWeek', 'Month', 'Quarter', 'Year', 'FiveYears'].map((z) => `tools.database.timelinezoom${z.toLowerCase()}`);

        expect(items.map((item) => item.getAttribute('data-mock-popover-action'))).toEqual(zooms);
        (items[6] as HTMLElement).click();
        expect(tool.save(element).views[0].timelineZoom).toBe('year');

        tool.destroy();
      });

      it('remembers the centre per person, in local storage', () => {
        const first = timelineTool();

        handlersOf(first.tool).navigate('2027-02-01' as never);
        expect(window.localStorage.getItem(centerKey)).toBe('2027-02-01');
        first.tool.destroy();

        const again = timelineTool();

        expect(queryAllByData(again.element, 'data-blok-database-timeline-units').length).toBe(1);
        expect(queryByData(again.element, 'data-blok-database-timeline-units')?.querySelector('[data-day="2027-02-01"]')).not.toBeNull();
        again.tool.destroy();
      });

      it('stores the centre on the view too (Notion\'s center_timestamp) as a derived change', () => {
        const { tool, element, options } = timelineTool();

        handlersOf(tool).navigate('2027-02-01' as never);

        expect(tool.save(element).views[0].timelineCenter).toBe('2027-02-01');
        expect(vi.mocked(options.block.dispatchChange)).toHaveBeenLastCalledWith({ derived: true });
        tool.destroy();
      });

      it('opens on the view\'s shared centre when this person has none of their own', () => {
        const { tool, element } = timelineTool({ timelineCenter: '2027-03-01' });

        expect(queryByData(element, 'data-blok-database-timeline-units')?.querySelector('[data-day="2027-03-01"]')).not.toBeNull();
        tool.destroy();
      });

      it('adds a row dated today from "+ New"', () => {
        const { tool, element, options } = timelineTool();

        queryByData(element, 'data-blok-database-timeline-new')?.click();

        expect(options.api.blocks.insertAt).toHaveBeenCalledWith(
          'database-row',
          expect.objectContaining({ properties: expect.objectContaining({ 'prop-due': '2026-10-09' }) }),
          expect.objectContaining({ parentId: 'test-block-id' }),
        );

        tool.destroy();
      });

      it('shows the load limit, then more on "Load more"', () => {
        const many = Array.from({ length: 12 }, (_, i) =>
          createMockRowBlock({ id: `row-${i}`, properties: { 'prop-title': `Row ${i}`, 'prop-due': '2026-10-09' }, position: `a${String(i).padStart(2, '0')}` }));
        const { tool, element } = timelineTool({ loadLimit: 10 }, many);

        expect(queryAllByData(element, 'data-blok-database-timeline-row')).toHaveLength(10);
        queryByData(element, 'data-blok-database-timeline-load-more')?.click();
        expect(queryAllByData(element, 'data-blok-database-timeline-row')).toHaveLength(12);

        tool.destroy();
      });

      it('gives a view switched to a timeline an empty table panel list, so two first columns merge', () => {
        const options = createDatabaseOptions({ schema: dateSchema, views: [{ ...timelineView, type: 'table' }], activeViewId: 'view-tl' }, {}, { childBlocks: rowsWithDates() });
        const tool = new DatabaseTool(options);
        const element = tool.render();
        const internals = tool as unknown as { setActiveLayout: (type: string) => void };

        internals.setActiveLayout('timeline');

        expect(tool.save(element).views[0]).toMatchObject({ type: 'timeline', tableProperties: [] });

        tool.destroy();
      });

      it('validates a timeline view without groupBy', () => {
        const tool = new DatabaseTool(createDatabaseOptions());

        expect(tool.validate(makeDefaultData({ schema: dateSchema, views: [timelineView], activeViewId: 'view-tl' }))).toBe(true);
      });
    });
  });
});

describe('DatabaseTool — board card parity', () => {
  const schema: PropertyDefinition[] = [
    { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
    { id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: { options: [
      { id: 'opt-todo', label: 'Todo', position: 'a0' },
      { id: 'opt-done', label: 'Done', position: 'a1' },
    ] } },
    { id: 'prop-done', name: 'Done', type: 'checkbox', position: 'a2' },
    { id: 'prop-team', name: 'Team', type: 'select', position: 'a3', config: { options: [
      { id: 'team-a', label: 'A', position: 'a0' },
      { id: 'team-b', label: 'B', position: 'a1' },
    ] } },
    { id: 'prop-link', name: 'Link', type: 'url', position: 'a4' },
  ];
  const board: DatabaseViewConfig = {
    id: 'view-board', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [],
    properties: [{ id: 'prop-done', visible: true }],
  };
  const rows = (): BlockAPI[] => [
    createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'One', 'prop-status': 'opt-todo', 'prop-done': false, 'prop-team': 'team-a' }, position: 'a0' }),
    createMockRowBlock({ id: 'row-2', properties: { 'prop-title': 'Two', 'prop-status': 'opt-todo', 'prop-done': true, 'prop-team': 'team-b' }, position: 'a1' }),
  ];
  const mount = (view: Partial<DatabaseViewConfig> = {}, children: BlockAPI[] = rows()): { tool: DatabaseTool; element: HTMLElement } => {
    const tool = new DatabaseTool(createDatabaseOptions({ schema, views: [{ ...board, ...view }], activeViewId: 'view-board' }, {}, { childBlocks: children }));
    const element = tool.render();

    document.body.appendChild(element);
    tool.rendered();

    return { tool, element };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('shows the view\'s visible properties on board cards', () => {
    const { tool, element } = mount();
    const card = queryAllByData(element, 'data-blok-database-card').find((c) => c.getAttribute('data-row-id') === 'row-2');

    expect(card?.querySelector('[data-blok-database-card-property][data-property-id="prop-done"]')).not.toBeNull();

    tool.destroy();
  });

  it('edits a card property in place without opening the row', () => {
    const children = rows();
    const { tool, element } = mount({}, children);
    const card = queryAllByData(element, 'data-blok-database-card').find((c) => c.getAttribute('data-row-id') === 'row-2');
    const internals = tool as unknown as { cardDrawer: { openRowId: string | null } | null };

    card?.querySelector<HTMLElement>('[data-blok-database-card-property]')?.click();

    expect(vi.mocked(children[1].call).mock.calls.filter(([method]) => method === 'updateProperties'))
      .toEqual([['updateProperties', { 'prop-done': false }]]);
    expect(internals.cardDrawer?.openRowId ?? null).toBeNull();

    tool.destroy();
  });

  // research/22 §3: a link on a card is followed; the card neither edits nor opens.
  it('a click on a card\'s url link follows it and opens no row page', () => {
    const children = [
      createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'One', 'prop-status': 'opt-todo', 'prop-link': 'https://example.com' }, position: 'a0' }),
    ];
    const { tool, element } = mount({ properties: [{ id: 'prop-link', visible: true }] }, children);
    const internals = tool as unknown as { cardDrawer: { openRowId: string | null } | null };
    const link = element.querySelector<HTMLAnchorElement>('[data-blok-database-card] a[data-blok-database-cell-link]');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });

    link?.dispatchEvent(event);

    expect(link).not.toBeNull();
    expect(event.defaultPrevented).toBe(false);
    expect(internals.cardDrawer?.openRowId ?? null).toBeNull();
    expect(document.querySelector('[data-blok-database-cell-editor]')).toBeNull();

    tool.destroy();
  });

  it('offers the card layout rows for a board', () => {
    const { tool } = mount();
    const titles = tool.layoutItems().map((item) => (item as { title?: string }).title);

    expect(titles).toEqual(['tools.database.galleryCardSize', 'tools.database.galleryCardPreview', 'tools.database.galleryFitImage']);

    tool.destroy();
  });

  it('draws sub-groups as lanes, each with every column and only its own cards', () => {
    const { tool, element } = mount({ subGroupBy: 'prop-team' });
    const lanes = queryAllByData(element, 'data-blok-database-board-lane');

    expect(lanes.map((lane) => lane.getAttribute('data-sub-group'))).toEqual(['team-a', 'team-b', expect.any(String)]);
    expect(lanes[0].querySelectorAll('[data-blok-database-column]')).toHaveLength(lanes[1].querySelectorAll('[data-blok-database-column]').length);
    expect([...lanes[0].querySelectorAll('[data-blok-database-card]')].map((c) => c.getAttribute('data-row-id'))).toEqual(['row-1']);
    expect([...lanes[1].querySelectorAll('[data-blok-database-card]')].map((c) => c.getAttribute('data-row-id'))).toEqual(['row-2']);

    tool.destroy();
  });

  it('keeps every lane\'s columns in the new order after a column drag', () => {
    const { tool, element } = mount({ subGroupBy: 'prop-team' });
    const internals = tool as unknown as { handleGroupDrop: (result: { optionId: string; beforeOptionId: string | null; afterOptionId: string | null }) => void };

    internals.handleGroupDrop({ optionId: 'opt-done', beforeOptionId: 'opt-todo', afterOptionId: null });

    for (const lane of queryAllByData(element, 'data-blok-database-board-lane')) {
      expect([...lane.querySelectorAll('[data-blok-database-column]')].slice(0, 2).map((c) => c.getAttribute('data-option-id'))).toEqual(['opt-done', 'opt-todo']);
    }

    tool.destroy();
  });

  it('moves a card to another lane by writing its sub-group value too', () => {
    const children = rows();
    const { tool } = mount({ subGroupBy: 'prop-team' }, children);
    const internals = tool as unknown as { handleRowDrop: (result: { rowId: string; toOptionId: string; toSubGroup?: string; beforeRowId: null; afterRowId: null }) => void };

    internals.handleRowDrop({ rowId: 'row-1', toOptionId: 'opt-done', toSubGroup: 'team-b', beforeRowId: null, afterRowId: null });

    expect(vi.mocked(children[0].call).mock.calls.filter(([method]) => method === 'updateProperties'))
      .toEqual([['updateProperties', { 'prop-status': 'opt-done', 'prop-team': 'team-b' }]]);

    tool.destroy();
  });
});

describe('DatabaseTool — board sub-group lanes', () => {
  const schema: PropertyDefinition[] = [
    { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
    { id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: { options: [
      { id: 'opt-todo', label: 'Todo', position: 'a0' },
      { id: 'opt-done', label: 'Done', position: 'a1' },
    ] } },
    { id: 'prop-team', name: 'Team', type: 'select', position: 'a2', config: { options: [
      { id: 'team-a', label: 'A', position: 'a0' },
      { id: 'team-b', label: 'B', position: 'a1' },
    ] } },
  ];
  const board: DatabaseViewConfig = {
    id: 'view-board', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', subGroupBy: 'prop-team',
    sorts: [], filters: [], visibleProperties: [],
  };
  const sorted: Partial<DatabaseViewConfig> = { sorts: [{ propertyId: 'prop-title', direction: 'asc' }] };
  const rows = (): BlockAPI[] => [
    createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'One', 'prop-status': 'opt-todo', 'prop-team': 'team-a' }, position: 'a0' }),
    createMockRowBlock({ id: 'row-2', properties: { 'prop-title': 'Two', 'prop-status': 'opt-todo', 'prop-team': 'team-b' }, position: 'a1' }),
  ];
  const mount = (view: Partial<DatabaseViewConfig> = {}, children: BlockAPI[] = rows()): {
    tool: DatabaseTool; element: HTMLElement; options: BlockToolConstructorOptions<DatabaseData, DatabaseConfig>;
  } => {
    const options = createDatabaseOptions({ schema, views: [{ ...board, ...view }], activeViewId: 'view-board' }, {}, { childBlocks: children });
    const tool = new DatabaseTool(options);
    const element = tool.render();

    document.body.appendChild(element);
    tool.rendered();

    return { tool, element, options };
  };
  const lane = (element: HTMLElement, key: string): HTMLElement | undefined =>
    queryAllByData(element, 'data-blok-database-board-lane').find((el) => el.getAttribute('data-sub-group') === key);
  const drop = (tool: DatabaseTool, result: { rowId: string; toOptionId: string; toSubGroup?: string; beforeRowId: string | null; afterRowId: string | null }): void => {
    (tool as unknown as { handleRowDrop: (r: typeof result) => void }).handleRowDrop(result);
  };
  const updates = (block: BlockAPI): unknown[] =>
    vi.mocked(block.call).mock.calls.filter(([method]) => method === 'updateProperties').map(([, params]) => params);
  const answer = (name: 'confirm' | 'cancel'): void => {
    document.querySelector<HTMLButtonElement>(`[data-blok-database-confirm-action="${name}"]`)?.click();
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('collapsing a band (research/31 §3)', () => {
    const toggle = (element: HTMLElement, key: string): HTMLButtonElement | null =>
      lane(element, key)?.querySelector<HTMLButtonElement>('[data-blok-database-board-lane-toggle]') ?? null;

    it('keeps the collapse on the view under the sub: key, so a reload shows the band collapsed', () => {
      const { tool, element } = mount();

      toggle(element, 'team-a')?.click();

      const saved = tool.save(element);

      expect(saved.views[0].collapsedGroups).toEqual([{ id: 'sub:team-a' }]);

      const reloaded = new DatabaseTool(createDatabaseOptions(saved, {}, { childBlocks: rows() }));
      const reloadedElement = reloaded.render();

      reloaded.rendered();

      expect(lane(reloadedElement, 'team-a')?.hasAttribute('data-collapsed')).toBe(true);
      expect(lane(reloadedElement, 'team-b')?.hasAttribute('data-collapsed')).toBe(false);

      tool.destroy();
      reloaded.destroy();
    });

    it('opening the band again removes it from the saved list', () => {
      const { tool, element } = mount({ collapsedGroups: [{ id: 'sub:team-a' }, { id: 'opt-todo' }] });

      toggle(element, 'team-a')?.click();

      expect(tool.save(element).views[0].collapsedGroups).toEqual([{ id: 'opt-todo' }]);

      tool.destroy();
    });

    it('leaves the column counts as they are', () => {
      const { tool, element } = mount();

      toggle(element, 'team-a')?.click();

      expect(element.querySelector('[data-blok-database-board-heads] [data-option-id="opt-todo"] [data-blok-database-column-count]')?.textContent).toBe('2');

      tool.destroy();
    });

    it('collapses on screen but saves nothing in read-only mode', () => {
      const options = createDatabaseOptions({ schema, views: [board], activeViewId: 'view-board' }, {}, { childBlocks: rows() });

      options.readOnly = true;
      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();
      toggle(element, 'team-a')?.click();

      expect(lane(element, 'team-a')?.hasAttribute('data-collapsed')).toBe(true);
      expect(tool.save(element).views[0].collapsedGroups ?? []).toEqual([]);

      tool.destroy();
    });
  });

  it('leaves out a sub-group the view hid, and its cards from the column count', () => {
    const { tool, element } = mount({ hiddenGroups: [{ id: 'sub:team-b' }] });

    expect(lane(element, 'team-a')).toBeDefined();
    expect(lane(element, 'team-b')).toBeUndefined();
    expect(element.querySelector('[data-row-id="row-2"]')).toBeNull();
    expect(element.querySelector('[data-blok-database-board-heads] [data-option-id="opt-todo"] [data-blok-database-column-count]')?.textContent).toBe('1');

    tool.destroy();
  });

  it('draws no lanes and no cards when every sub-group is hidden, not an ungrouped board', () => {
    const { tool, element } = mount({ hiddenGroups: [{ id: 'sub:team-a' }, { id: 'sub:team-b' }, { id: 'sub:__blok-no-value-group__' }] });

    expect(queryAllByData(element, 'data-blok-database-board-lane')).toHaveLength(0);
    expect(element.querySelectorAll('[data-blok-database-card]')).toHaveLength(0);
    expect(queryByData(element, 'data-blok-database-board-heads')).not.toBeNull();

    tool.destroy();
  });

  it('shows the column headers once, above the lanes', () => {
    const { tool, element } = mount();
    const heads = queryByData(element, 'data-blok-database-board-heads');
    const lanes = queryAllByData(element, 'data-blok-database-board-lane');

    expect(lanes.every((el) => el.querySelector('[data-blok-database-column-header]') === null)).toBe(true);
    expect(heads?.querySelectorAll('[data-blok-database-column-header]')).toHaveLength(lanes[0].querySelectorAll('[data-blok-database-column]').length);
    expect(heads !== null && (heads.compareDocumentPosition(lanes[0]) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);

    tool.destroy();
  });

  it('counts every lane\'s cards in the one column header', () => {
    const { tool, element } = mount();
    const todo = element.querySelector('[data-blok-database-board-heads] [data-option-id="opt-todo"] [data-blok-database-column-count]');

    expect(todo?.textContent).toBe('2');

    tool.destroy();
  });

  it('puts the add-group button after the columns, not below the lanes', () => {
    const { tool, element } = mount();
    const heads = queryByData(element, 'data-blok-database-board-heads');

    expect(heads?.lastElementChild?.hasAttribute('data-blok-database-add-column')).toBe(true);
    expect(queryAllByData(element, 'data-blok-database-add-column')).toHaveLength(1);

    tool.destroy();
  });

  it('starts a column drag from its one header', () => {
    const { tool, element } = mount();
    const header = element.querySelector<HTMLElement>('[data-blok-database-board-heads] [data-option-id="opt-done"] [data-blok-database-column-header]');
    const beginTracking = vi.spyOn((tool as unknown as { columnDrag: { beginTracking: (id: string, x: number, y: number) => void } }).columnDrag, 'beginTracking');

    header?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 1, clientY: 1 }));

    expect(beginTracking).toHaveBeenCalledWith('opt-done', 1, 1);

    tool.destroy();
  });

  it('"+ New page" in a lane sets the group and the sub-group, and the card lands in that lane', () => {
    const children = rows();
    const { tool, element, options } = mount({}, children);

    vi.mocked(options.api.blocks.insertAt).mockImplementation((_type, data, placement) => {
      const row = data as DatabaseRowData;
      const id = (placement as { id: string }).id;

      children.push(createMockRowBlock({ id, properties: row.properties, position: row.position }));

      return { id } as unknown as BlockAPI;
    });
    lane(element, 'team-b')?.querySelector<HTMLElement>('[data-option-id="opt-done"] [data-blok-database-add-card]')?.click();

    const inserted = vi.mocked(options.api.blocks.insertAt).mock.calls[0]?.[1] as DatabaseRowData | undefined;
    const newId = children.at(-1)?.id ?? '';

    expect(inserted?.properties).toMatchObject({ 'prop-status': 'opt-done', 'prop-team': 'team-b' });
    expect(lane(element, 'team-b')?.querySelector(`[data-option-id="opt-done"] [data-row-id="${newId}"]`)).not.toBeNull();
    expect(lane(element, 'team-a')?.querySelector(`[data-row-id="${newId}"]`)).toBeNull();

    tool.destroy();
  });

  it('"+ New page" opens the new card with its title being edited, and a redraw keeps what was typed (feel findings B09)', () => {
    const children = rows();
    const { tool, element, options } = mount({}, children);

    vi.mocked(options.api.blocks.insertAt).mockImplementation((_type, data, placement) => {
      const row = data as DatabaseRowData;
      const id = (placement as { id: string }).id;

      children.push(createMockRowBlock({ id, properties: row.properties, position: row.position }));

      return { id } as unknown as BlockAPI;
    });
    lane(element, 'team-b')?.querySelector<HTMLElement>('[data-option-id="opt-done"] [data-blok-database-add-card]')?.click();

    const newId = children.at(-1)?.id ?? '';
    const field = (): HTMLInputElement | null =>
      element.querySelector<HTMLInputElement>(`[data-row-id="${newId}"] [data-blok-database-card-title-input]`);

    expect(field()).not.toBeNull();
    if (field() !== null) (field() as HTMLInputElement).value = 'Half typ';
    (tool as unknown as { rerenderView: (o?: { keepDrawer?: boolean }) => void }).rerenderView({ keepDrawer: true });

    expect(field()?.value).toBe('Half typ');

    tool.destroy();
  });

  it('a sorted drop into another lane of the same column asks, and "Remove" keeps the sub-group change', async () => {
    const children = rows();
    const { tool, element } = mount(sorted, children);

    drop(tool, { rowId: 'row-1', toOptionId: 'opt-todo', toSubGroup: 'team-b', beforeRowId: null, afterRowId: 'row-2' });
    expect(document.querySelector('[data-blok-database-confirm-title]')?.textContent).toBe('tools.database.removeSortingTitle');
    expect(updates(children[0])).toEqual([]);

    answer('confirm');
    await Promise.resolve();

    expect(updates(children[0])).toContainEqual({ 'prop-team': 'team-b' });
    expect(tool.save(element).views[0].sorts).toEqual([]);

    tool.destroy();
  });

  it('a sorted drop into another lane keeps the sub-group change on "Don\'t remove", and the sort stays', async () => {
    const children = rows();
    const { tool, element } = mount(sorted, children);

    drop(tool, { rowId: 'row-1', toOptionId: 'opt-todo', toSubGroup: 'team-b', beforeRowId: null, afterRowId: 'row-2' });
    answer('cancel');
    await Promise.resolve();

    expect(updates(children[0])).toEqual([{ 'prop-team': 'team-b' }]);
    expect(children.flatMap((block) => vi.mocked(block.call).mock.calls.filter(([method]) => method === 'updatePosition'))).toEqual([]);
    expect(tool.save(element).views[0].sorts).toEqual(sorted.sorts);

    tool.destroy();
  });

  it('a sorted drop into another column and lane writes both values without asking', () => {
    const children = rows();
    const { tool } = mount(sorted, children);

    drop(tool, { rowId: 'row-1', toOptionId: 'opt-done', toSubGroup: 'team-b', beforeRowId: null, afterRowId: null });

    expect(document.querySelector('[data-blok-database-confirm-title]')).toBeNull();
    expect(updates(children[0])).toEqual([{ 'prop-status': 'opt-done', 'prop-team': 'team-b' }]);

    tool.destroy();
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

  it('writes an empty list into every row when a files property is added', () => {
    const one = realRow('r1', { 'prop-title': 'A' });
    const { tool } = build([one]);
    const added = tool.addProperty({ name: 'Docs', type: 'files' });

    expect(one.tool.getProperties()[added?.id ?? '']).toEqual([]);
    expect(one.block.dispatchChange).toHaveBeenCalled();
  });

  it('writes an empty list into every row when a property becomes a relation', () => {
    const one = realRow('r1', { 'prop-title': 'A', 'prop-note': 'x' });
    const two = realRow('r2', { 'prop-title': 'B' });
    const { tool } = build([one, two]);

    tool.changePropertyType('prop-note', 'relation');

    expect(one.tool.getProperties()['prop-note']).toEqual([]);
    expect(two.tool.getProperties()['prop-note']).toEqual([]);
  });

  it('copies a files property onto rows that have no value for it as an empty list', () => {
    const one = realRow('r1', { 'prop-title': 'A' });
    const files: PropertyDefinition = { id: 'prop-files', name: 'Docs', type: 'files', position: 'a9' };
    const tool = new DatabaseTool(createDatabaseOptions(
      { schema: [...schema, files], views: [{ id: 'view-1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }] },
      {},
      { childBlocks: [one.block] },
    ));

    tool.render();
    const copy = tool.duplicateProperty('prop-files');

    expect(one.tool.getProperties()[copy?.id ?? '']).toEqual([]);
  });

  it('gives a duplicated row an empty list for a files property the original has no value for', () => {
    const one = realRow('r1', { 'prop-title': 'A' });
    const files: PropertyDefinition = { id: 'prop-files', name: 'Docs', type: 'files', position: 'a9' };
    const options = createDatabaseOptions(
      { schema: [...schema, files], views: [{ id: 'view-1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }] },
      {},
      { childBlocks: [one.block] },
    );

    // A duplicate copies the row's own children too; only the database has rows.
    vi.mocked(options.api.blocks.getChildren).mockImplementation((parentId: string) => (parentId === 'test-block-id' ? [one.block] : []));
    const tool = new DatabaseTool(options);
    const root = tool.render();

    document.body.appendChild(root);
    root.querySelector<HTMLElement>('[data-row-id="r1"] [data-blok-database-table-row-checkbox]')?.click();
    root.querySelector<HTMLElement>('[role="grid"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true, bubbles: true, cancelable: true }));
    root.remove();

    const inserted = (options.api.blocks.insertAt as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'database-row').at(-1)?.[1] as { properties?: Record<string, PropertyValue> } | undefined;

    expect(inserted?.properties?.['prop-files']).toEqual([]);
  });

  it('writes an empty list into its own rows when another database adds the synced relation', () => {
    const one = realRow('r1', { 'prop-title': 'A' });
    const { tool, options } = build([one]);
    const created: string[] = [];

    tool.addSyncedRelation({ name: 'Back', relation: { targetDatabaseId: options.block.id }, receive: (id) => created.push(id) });

    expect(one.tool.getProperties()[created[0] ?? '']).toEqual([]);
  });

  it('stores a cleared files value as an empty list, never null', () => {
    const one = realRow('r1', { 'prop-title': 'A', 'prop-files': [{ id: 'f1', name: 'a.pdf', url: 'https://x.io/a.pdf' }] });
    const files: PropertyDefinition = { id: 'prop-files', name: 'Docs', type: 'files', position: 'a9' };
    const tool = new DatabaseTool(createDatabaseOptions(
      { schema: [...schema, files], views: [{ id: 'view-1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }] },
      {},
      { childBlocks: [one.block] },
    ));

    tool.render();
    tool.writeRelatedRow({ rowId: 'r1', changes: { 'prop-files': null, 'prop-n': null } });

    expect(one.tool.getProperties()['prop-files']).toEqual([]);
    expect(one.tool.getProperties()['prop-n']).toBeNull();
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

  // research/14 §3: a rename to another property's exact name is refused; case differs is fine.
  it('refuses a rename to a name another property has', () => {
    const { tool } = build([]);

    tool.renameProperty('prop-n', 'Note');
    expect(schemaOf(tool).find((p) => p.id === 'prop-n')?.name).toBe('Amount');
    tool.renameProperty('prop-n', 'note');
    expect(schemaOf(tool).find((p) => p.id === 'prop-n')?.name).toBe('note');
  });

  // research/14 §1: Add property with a taken name gets the lowest free " N".
  it('names a second "Notes" "Notes 1" and tells the backend that name', async () => {
    const adapter = {
      loadDatabase: vi.fn().mockResolvedValue({ schema: [], views: [] }),
      createProperty: vi.fn().mockResolvedValue({}),
    } as unknown as DatabaseAdapter;
    const { tool } = build([], { adapter });

    tool.addProperty({ name: 'Notes', type: 'text' });
    const second = tool.addProperty({ name: 'Notes', type: 'text' });
    await Promise.resolve();

    expect(second?.name).toBe('Notes 1');
    expect(adapter.createProperty).toHaveBeenLastCalledWith(expect.objectContaining({ id: second?.id, name: 'Notes 1' }));
  });

  it('the header menu shows the taken-name error for another property\'s name', () => {
    const { tool } = build([]);

    tool.openPropertyMenu('prop-n', document.createElement('button'));
    const input = document.querySelector<HTMLInputElement>('[data-blok-database-property-menu-name-input]');

    if (input === null) throw new Error('no name input');
    input.value = 'Note';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // The stub i18n echoes keys; the menu test checks the {name} argument.
    expect(document.querySelector<HTMLElement>('[data-blok-database-property-menu-name-error]')?.textContent).toBe('tools.database.propertyNameTaken');
    expect(input.getAttribute('aria-invalid')).toBe('true');
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

  it('tells the backend the AI autofill is gone when the new type has none', async () => {
    const updateProperty = vi.fn().mockResolvedValue({});
    const adapter = {
      loadDatabase: vi.fn().mockResolvedValue({ schema: [], views: [] }),
      updateProperty,
      updateRow: vi.fn().mockResolvedValue({}),
    } as unknown as DatabaseAdapter;
    const { tool } = build([], { adapter });

    tool.updatePropertySettings('prop-note', { autofill: { mode: 'summary', onEdit: true } });
    tool.changePropertyType('prop-note', 'files');
    await Promise.resolve();
    // The adapter contract: a settings key given as undefined was removed.
    const changes = (updateProperty.mock.calls.at(-1)?.[0] as Parameters<DatabaseAdapter['updateProperty']>[0] | undefined)?.changes;

    expect(changes !== undefined && Object.hasOwn(changes, 'autofill')).toBe(true);
    expect(changes?.autofill).toBeUndefined();
    expect(changes?.type).toBe('files');
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

  describe('chart, feed and CSV', () => {
    const csvSchema: PropertyDefinition[] = [
      { id: 'prop-title', name: 'Task', type: 'title', position: 'a0' },
      { id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: { options: [
        { id: 'opt-todo', label: 'Todo', position: 'a0' },
        { id: 'opt-done', label: 'Done', position: 'a1' },
      ] } },
      { id: 'prop-points', name: 'Points', type: 'number', position: 'a2' },
    ];
    const rows = (): BlockAPI[] => [
      createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Write, edit', 'prop-status': 'opt-todo', 'prop-points': 3 }, position: 'a0' }),
      createMockRowBlock({ id: 'row-2', properties: { 'prop-title': 'Ship', 'prop-status': 'opt-done', 'prop-points': 5 }, position: 'a1' }),
      createMockRowBlock({ id: 'row-3', properties: { 'prop-title': 'Rest', 'prop-status': 'opt-done', 'prop-points': 1 }, position: 'a2' }),
    ];
    const view = (fields: Partial<DatabaseViewConfig>): DatabaseViewConfig =>
      ({ id: 'view-x', name: 'X', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...fields });
    const mount = (fields: Partial<DatabaseViewConfig>, readOnly = false): { tool: DatabaseTool; element: HTMLElement; options: BlockToolConstructorOptions<DatabaseData, DatabaseConfig> } => {
      const options = createDatabaseOptions({ schema: csvSchema, views: [view(fields)], activeViewId: 'view-x', title: 'Tasks' }, {}, { childBlocks: rows(), readOnly });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      document.body.appendChild(element);
      tool.rendered();

      return { tool, element, options };
    };
    const internals = (tool: DatabaseTool): { csvActions: () => Array<{ testId: string; disabled?: boolean; onClick: () => void }> } =>
      tool as unknown as { csvActions: () => Array<{ testId: string; disabled?: boolean; onClick: () => void }> };

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('draws a chart view with one column per status group and no board subsystems', () => {
      const { tool, element } = mount({ type: 'chart', groupBy: 'prop-status', groupSettings: { hideEmptyGroups: true } });
      const board = tool as unknown as { cardDrag: unknown; columnDrag: unknown };

      expect(queryByData(element, 'data-blok-database-chart')).not.toBeNull();
      expect(queryByData(element, 'data-blok-database-board')).toBeNull();
      expect(queryAllByData(element, 'data-blok-database-chart-mark').map((m) => m.getAttribute('data-key'))).toEqual(['opt-todo', 'opt-done']);
      expect(board.cardDrag).toBeNull();
      expect(board.columnDrag).toBeNull();

      tool.destroy();
    });

    it('sorts number-range groups on the X axis by value, out of range last', () => {
      const ranged = [
        createMockRowBlock({ id: 'row-a', properties: { 'prop-title': 'A', 'prop-points': 150 }, position: 'a0' }),
        createMockRowBlock({ id: 'row-b', properties: { 'prop-title': 'B', 'prop-points': -10 }, position: 'a1' }),
        createMockRowBlock({ id: 'row-c', properties: { 'prop-title': 'C', 'prop-points': 20 }, position: 'a2' }),
      ];
      const options = createDatabaseOptions({
        schema: csvSchema,
        views: [view({ type: 'chart', groupBy: 'prop-points', chartSort: 'xAscending', chartCumulative: true, groupSettings: { numberBy: 'range', rangeStart: 0, rangeEnd: 1000, rangeSize: 100, sort: 'descending' } })],
        activeViewId: 'view-x',
      }, {}, { childBlocks: ranged });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      expect(queryAllByData(element, 'data-blok-database-chart-mark').map((m) => m.getAttribute('data-key'))).toEqual(['range:0', 'range:100', 'range:out']);

      tool.destroy();
    });

    describe('computed properties on the axes', () => {
      const computed: PropertyDefinition[] = [
        ...csvSchema,
        { id: 'fx-double', name: 'Double', type: 'formula', position: 'a3', formula: { expression: '{{property:prop-points}} * 2' } },
        { id: 'fx-list', name: 'Pair', type: 'formula', position: 'a4', formula: { expression: '[1, 2]' } },
        { id: 'roll', name: 'Total', type: 'rollup', position: 'a5', rollup: { relationPropertyId: 'rel', targetPropertyId: 'prop-points', function: 'sum' } },
      ];
      const mountComputed = (fields: Partial<DatabaseViewConfig>): { tool: DatabaseTool; element: HTMLElement } => {
        const options = createDatabaseOptions({ schema: computed, views: [view(fields)], activeViewId: 'view-x' }, {}, { childBlocks: rows() });
        const tool = new DatabaseTool(options);
        const element = tool.render();

        document.body.appendChild(element);

        return { tool, element };
      };
      const childNames = (tool: DatabaseTool, name: string): string[] => {
        const item = tool.layoutItems().find((entry) => (entry as { name?: string }).name === name) as { children?: { items: Array<{ name?: string }> } } | undefined;

        return (item?.children?.items ?? []).map((entry) => entry.name ?? '');
      };

      it('offers a formula by its result type on both axes, and never a rollup or a list formula (H-charts)', () => {
        const { tool } = mountComputed({ type: 'chart', groupBy: 'prop-status' });
        const x = childNames(tool, 'chart-x');
        const y = childNames(tool, 'chart-y');

        expect(x).toContain('chart-x-fx-double');
        expect(y).toContain('chart-y-sum:fx-double');
        expect([...x, ...y].filter((name) => name.includes('roll') || name.includes('fx-list'))).toEqual([]);

        tool.destroy();
      });

      it('sums a number formula on the Y axis', () => {
        const { tool, element } = mountComputed({ type: 'chart', chartType: 'number', groupBy: 'prop-status', chartMeasure: 'sum:fx-double' });

        expect(queryByData(element, 'data-blok-database-chart-number')?.textContent).toBe('18');

        tool.destroy();
      });

      it('falls back to Count for a rollup measure and to another axis for a rollup grouping', () => {
        const { tool, element } = mountComputed({ type: 'chart', chartType: 'number', groupBy: 'roll', chartMeasure: 'count_values:roll' });

        expect(queryByData(element, 'data-blok-database-chart-number')?.textContent).toBe('3');

        tool.destroy();
      });
    });

    it('measures the Y axis with the view\'s calculation', () => {
      const { tool, element } = mount({ type: 'chart', chartType: 'number', groupBy: 'prop-status', chartMeasure: 'sum:prop-points' });

      expect(queryByData(element, 'data-blok-database-chart-number')?.textContent).toBe('9');

      tool.destroy();
    });

    it('hides a donut slice from its legend for this session only, with no write', () => {
      const { tool, element, options } = mount({ type: 'chart', chartType: 'donut', groupBy: 'prop-status', groupSettings: { hideEmptyGroups: true } });
      const before = JSON.stringify(tool.save(element));

      queryAllByData(element, 'data-blok-database-chart-legend-entry')[0].click();

      expect(queryAllByData(element, 'data-blok-database-chart-legend-entry')[0].getAttribute('aria-pressed')).toBe('false');
      expect(queryAllByData(element, 'data-blok-database-chart-mark').map((m) => m.getAttribute('data-key'))).toEqual(['opt-done']);
      expect(JSON.stringify(tool.save(element))).toBe(before);
      expect(vi.mocked(options.block.dispatchChange)).not.toHaveBeenCalled();

      tool.destroy();
    });

    it('drills down into a group as a table of its rows', () => {
      const { tool, element } = mount({ type: 'chart', groupBy: 'prop-status', groupSettings: { hideEmptyGroups: true } });

      element.querySelector<SVGElement>('[data-blok-database-chart-hit][data-key="opt-done"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const dialog = document.querySelector<HTMLElement>('[data-blok-database-drilldown]');

      expect(dialog).not.toBeNull();
      expect([...(dialog?.querySelectorAll('[data-blok-database-drilldown-open]') ?? [])].map((b) => b.textContent)).toEqual(['Ship', 'Rest']);

      tool.destroy();
    });

    it('still draws a chart and drills down in read-only mode', () => {
      const { tool, element } = mount({ type: 'chart', groupBy: 'prop-status' }, true);

      expect(queryAllByData(element, 'data-blok-database-chart-mark').length).toBeGreaterThan(0);

      tool.destroy();
    });

    it('names new chart and feed views and starts a chart on a select property', () => {
      const { tool, element } = mount({});

      tool.addView('chart');
      tool.addView('feed');

      expect(tool.save(element).views.slice(1).map((v) => [v.name, v.type, v.groupBy])).toEqual([
        ['Chart', 'chart', 'prop-status'],
        ['Feed', 'feed', undefined],
      ]);
      expect(queryByData(element, 'data-blok-database-feed')).not.toBeNull();

      tool.destroy();
    });

    it('opens a feed card\'s row in a center peek by default, and as the view says otherwise', () => {
      const center = mount({ type: 'feed' });
      const drawerOf = (tool: DatabaseTool): { openRowId: string | null; openMode: string } | null =>
        (tool as unknown as { cardDrawer: { openRowId: string | null; openMode: string } | null }).cardDrawer;

      queryAllByData(center.element, 'data-blok-database-feed-title')[1].click();
      expect(drawerOf(center.tool)).toMatchObject({ openRowId: 'row-2', openMode: 'center' });
      center.tool.destroy();

      const side = mount({ type: 'feed', openPagesIn: 'side' });

      queryAllByData(side.element, 'data-blok-database-feed-title')[0].click();
      expect(drawerOf(side.tool)).toMatchObject({ openRowId: 'row-1', openMode: 'side' });
      side.tool.destroy();
    });

    it('stacks the rows as feed cards', () => {
      const { tool, element } = mount({ type: 'feed' });

      expect(queryAllByData(element, 'data-blok-database-feed-card').map((c) => c.getAttribute('data-row-id'))).toEqual(['row-1', 'row-2', 'row-3']);

      tool.destroy();
    });

    it('exports the current view as CSV: its filters, sorts and visible properties', () => {
      const { tool } = mount({
        filters: [{ id: 'f1', propertyId: 'prop-points', operator: 'greater_than', value: 2 }],
        sorts: [{ id: 's1', propertyId: 'prop-points', direction: 'desc' }],
        properties: [{ id: 'prop-title', visible: true }, { id: 'prop-status', visible: false }, { id: 'prop-points', visible: true }],
      });

      expect(tool.exportCsv()).toBe('\uFEFFTask,Points\r\nShip,5\r\n"Write, edit",3');

      tool.destroy();
    });

    it('imports a CSV as a new database block after this one, in one step', () => {
      const { tool, options } = mount({});
      const transact = vi.fn((fn: () => void) => fn());

      Object.assign(options.api.blocks, { transact });
      tool.importCsv('Task,Points\nWrite,3\nShip,5', 'tasks.csv');

      const calls = vi.mocked(options.api.blocks.insertAt).mock.calls;
      const [type, data, placement] = calls[0];
      const database = data as DatabaseData;

      expect(transact).toHaveBeenCalledTimes(1);
      expect(type).toBe('database');
      expect(placement).toMatchObject({ position: { after: 'test-block-id' } });
      // research/27 §2: the title stays the placeholder, not the file name.
      expect(database.title).toBe('');
      expect(database.schema.map((p) => [p.name, p.type])).toEqual([['Task', 'title'], ['Points', 'number']]);
      expect(database.views[0].type).toBe('table');
      expect(calls.slice(1).map(([rowType, rowData, rowPlacement]) => [rowType, (rowData as DatabaseRowData).title, (rowPlacement as { parentId?: string }).parentId]))
        .toEqual([['database-row', 'Write', placement?.id], ['database-row', 'Ship', placement?.id]]);

      tool.destroy();
    });

    // Research 21 §4: Notion names repeated headers "Tag", "Tag 1", "Tag 2" and keeps each column.
    it('imports repeated headers as numbered properties, each keeping its own column, rows in file order', () => {
      const { tool, options } = mount({});

      Object.assign(options.api.blocks, { transact: vi.fn((fn: () => void) => fn()) });
      tool.importCsv('Name,Tag,Tag,Tag\nRowA,a1,a2,a3\nRowB,b1,b2,b3', 'dup.csv');

      const calls = vi.mocked(options.api.blocks.insertAt).mock.calls;
      const database = calls[0][1] as DatabaseData;

      expect(database.schema.map((p) => p.name)).toEqual(['Name', 'Tag', 'Tag 1', 'Tag 2']);
      expect(calls.slice(1).map(([, rowData]) => database.schema.map((p) => (rowData as DatabaseRowData).properties[p.id])))
        .toEqual([['RowA', 'a1', 'a2', 'a3'], ['RowB', 'b1', 'b2', 'b3']]);

      tool.destroy();
    });

    it('imports each column as the type picked for it, dropping a column set to Don\'t import', () => {
      const { tool, options } = mount({});

      Object.assign(options.api.blocks, { transact: vi.fn((fn: () => void) => fn()) });
      tool.importCsv('Task,Stage,Notes\nWrite,Todo,x\nShip,Doing,y\nPlan,Todo,z', 'tasks.csv', ['title', 'select', 'skip']);

      const calls = vi.mocked(options.api.blocks.insertAt).mock.calls;
      const database = calls[0][1] as DatabaseData;
      const stage = database.schema[1];

      expect(database.schema.map((p) => [p.name, p.type])).toEqual([['Task', 'title'], ['Stage', 'select']]);
      expect(stage.config?.options.map((o) => o.label)).toEqual(['Todo', 'Doing']);
      expect(calls.slice(1).map(([, rowData]) => (rowData as DatabaseRowData).title)).toEqual(['Write', 'Ship', 'Plan']);

      tool.destroy();
    });

    it('names each row after the column picked as the title, even when it is not the first', () => {
      const { tool, options } = mount({});

      Object.assign(options.api.blocks, { transact: vi.fn((fn: () => void) => fn()) });
      tool.importCsv('Code,Task\nA1,Write\nB2,Ship', 'tasks.csv', ['text', 'title']);

      const calls = vi.mocked(options.api.blocks.insertAt).mock.calls;

      expect(calls.slice(1).map(([, rowData]) => (rowData as DatabaseRowData).title)).toEqual(['Write', 'Ship']);

      tool.destroy();
    });

    // research/30 §9b-c: the dialog's switches reach the import.
    it('imports without a header line and reads dates in the picked format', () => {
      const { tool, options } = mount({});

      Object.assign(options.api.blocks, { transact: vi.fn((fn: () => void) => fn()) });
      tool.importCsv('Task,When\nWrite,03/04/2026', 'tasks.csv', ['title', 'date'], { headers: false, dateFormats: [undefined, 'day_month_year'] });

      const calls = vi.mocked(options.api.blocks.insertAt).mock.calls;
      const database = calls[0][1] as DatabaseData;

      // research/30 §9c: Notion named the title "Name".
      expect(database.schema.map((p) => p.name)).toEqual(['Name', 'tools.database.csvUntitledColumn 2']);
      expect(calls.slice(1).map(([, rowData]) => (rowData as DatabaseRowData).title)).toEqual(['Task', 'Write']);
      expect((calls[2][1] as DatabaseRowData).properties[database.schema[1].id]).toBe('2026-04-03');

      tool.destroy();
    });

    // research/30 §9f: rows are added, never matched; "Extra" became a new Text property at the end.
    it('merges a CSV by adding rows only, matching headers to property names and adding the rest as properties', () => {
      const { tool, options } = mount({});

      tool.mergeCsv('Task,Status,Points,Extra\nShip,Done,8,x\nNew,Blocked,1,y');

      const added = vi.mocked(options.api.blocks.insertAt).mock.calls
        .filter(([type]) => type === 'database-row')
        .map(([, data]) => (data as DatabaseRowData).properties);
      const schema = tool.save(document.createElement('div')).schema;
      const status = schema.find((p) => p.id === 'prop-status');
      const blocked = status?.config?.options.find((o) => o.label === 'Blocked');
      const extra = schema.find((p) => p.name === 'Extra');

      expect([extra?.type, [...schema].sort((a, b) => (a.position < b.position ? -1 : 1)).at(-1)?.name]).toEqual(['text', 'Extra']);
      expect(added).toEqual([
        { 'prop-title': 'Ship', 'prop-status': 'opt-done', 'prop-points': 8, [extra?.id ?? '']: 'x' },
        { 'prop-title': 'New', 'prop-status': blocked?.id, 'prop-points': 1, [extra?.id ?? '']: 'y' },
      ]);
      expect(options.api.notifier.show).toHaveBeenCalled();

      tool.destroy();
    });

    it('merges with the dialog\'s mapping: a column onto an existing property, one not imported, one as a new type', () => {
      const { tool, options } = mount({});

      tool.mergeCsv('Task,Stage,Notes,Level\nShip,Done,x,High\nNew,Done,y,Low', [{ property: 'prop-title' }, { property: 'prop-status' }, 'skip', 'select']);

      const added = vi.mocked(options.api.blocks.insertAt).mock.calls
        .filter(([type]) => type === 'database-row')
        .map(([, data]) => (data as DatabaseRowData).properties);
      const level = tool.save(document.createElement('div')).schema.find((p) => p.name === 'Level');

      expect(level?.type).toBe('select');
      expect(level?.config?.options.map((o) => o.label)).toEqual(['High', 'Low']);
      expect(added.map((row) => [row['prop-title'], row['prop-status'], row[level?.id ?? '']])).toEqual([
        ['Ship', 'opt-done', level?.config?.options[0].id],
        ['New', 'opt-done', level?.config?.options[1].id],
      ]);
      expect(added.every((row) => !Object.values(row).includes('x'))).toBe(true);
      // A column the person chose not to import is not "unmatched".
      expect(options.api.notifier.show).toHaveBeenLastCalledWith({ message: 'tools.database.csvMerged' });

      tool.destroy();
    });

    // research/30 §9f: Merge with CSV opens the import dialog with "Import Location", not a bare file picker.
    it('opens the import dialog on Merge with CSV, its Import Location naming this database', () => {
      const { tool } = mount({});
      const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);

      internals(tool).csvActions().find((a) => a.testId === 'database-settings-csv-merge')?.onClick();

      expect(click).not.toHaveBeenCalled();
      expect(document.querySelector('[data-blok-testid="database-csv-location"]')?.textContent?.trim()).toBe('Tasks');
      document.querySelector<HTMLElement>('[data-blok-testid="database-csv-close"]')?.click();
      tool.destroy();
    });

    it('lists the CSV actions in the settings panel, and the chart export on a chart', () => {
      const { tool } = mount({ type: 'chart', groupBy: 'prop-status' });

      expect(internals(tool).csvActions().map((a) => a.testId)).toEqual([
        'database-settings-chart-save',
        'database-settings-csv-export', 'database-settings-csv-import', 'database-settings-csv-merge',
      ]);

      tool.destroy();
    });

    describe('Save chart as', () => {
      const press = (id: string): void => {
        const control = document.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`);

        if (control === null) throw new Error(`missing ${id}`);
        control.click();
      };
      const openSaveAs = (element: HTMLElement): void => {
        const settings = element.querySelector<HTMLElement>('[data-blok-testid="database-toolbar-settings"]');

        if (settings === null) throw new Error('missing settings button');
        settings.click();
        press('database-settings-chart-save');
      };

      afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
      });

      it('opens a page with a background switch, then copy and download rows', () => {
        const { tool, element } = mount({ type: 'chart', groupBy: 'prop-status' });

        openSaveAs(element);

        expect(document.querySelector('[data-blok-testid="database-settings-chart-background"]')?.getAttribute('aria-checked')).toBe('true');
        expect(['database-settings-chart-copy', 'database-settings-chart-png', 'database-settings-chart-svg']
          .map((id) => document.querySelector(`[data-blok-testid="${id}"]`) !== null)).toEqual([true, true, true]);

        tool.destroy();
      });

      it('tells the user when this browser cannot copy an image', () => {
        vi.stubGlobal('ClipboardItem', undefined);
        const { tool, element, options } = mount({ type: 'chart', groupBy: 'prop-status' });

        openSaveAs(element);
        press('database-settings-chart-copy');

        expect(options.api.notifier.show).toHaveBeenCalledWith({ message: 'tools.database.chartCopyFailed', style: 'error' });

        tool.destroy();
      });

      it('copies a PNG without its background when the switch is off', async () => {
        const items: Array<Record<string, Promise<Blob>>> = [];
        const write = vi.fn((_: unknown[]) => Promise.resolve());

        vi.stubGlobal('ClipboardItem', class {
          constructor(record: Record<string, Promise<Blob>>) {
            items.push(record);
          }
        });
        vi.stubGlobal('navigator', { ...navigator, clipboard: { write } });
        const png = vi.spyOn(DatabaseChartView.prototype, 'toPngBlob').mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
        const { tool, element, options } = mount({ type: 'chart', groupBy: 'prop-status' });

        openSaveAs(element);
        press('database-settings-chart-background');
        press('database-settings-chart-copy');

        expect(png).toHaveBeenCalledWith({ background: false });
        expect(write).toHaveBeenCalledTimes(1);
        expect(Object.keys(items[0] ?? {})).toEqual(['image/png']);
        await vi.waitFor(() => expect(options.api.notifier.show).toHaveBeenCalledWith({ message: 'tools.database.chartCopied' }));

        tool.destroy();
      });

      it('reports a failed copy when the chart cannot be painted', async () => {
        const write = vi.fn(async (list: Array<{ record: Record<string, Promise<Blob>> }>) => {
          await list[0]?.record['image/png'];
        });

        vi.stubGlobal('ClipboardItem', class {
          readonly record: Record<string, Promise<Blob>>;

          constructor(record: Record<string, Promise<Blob>>) {
            this.record = record;
          }
        });
        vi.stubGlobal('navigator', { ...navigator, clipboard: { write } });
        vi.spyOn(DatabaseChartView.prototype, 'toPngBlob').mockResolvedValue(null);
        const { tool, element, options } = mount({ type: 'chart', groupBy: 'prop-status' });

        openSaveAs(element);
        press('database-settings-chart-copy');

        await vi.waitFor(() => expect(options.api.notifier.show).toHaveBeenCalledWith({ message: 'tools.database.chartCopyFailed', style: 'error' }));
        expect(options.api.notifier.show).not.toHaveBeenCalledWith({ message: 'tools.database.chartCopied' });

        tool.destroy();
      });

      it('downloads the PNG and the SVG with the background choice', async () => {
        const saved: string[] = [];

        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:https://example.com/chart');
        vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(function (this: HTMLElement) {
          if (this instanceof HTMLAnchorElement) {
            saved.push(this.download);
          } else {
            this.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }
        });
        const png = vi.spyOn(DatabaseChartView.prototype, 'toPngBlob').mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
        const svg = vi.spyOn(DatabaseChartView.prototype, 'toSvgString');
        const { tool, element } = mount({ type: 'chart', groupBy: 'prop-status' });

        openSaveAs(element);
        press('database-settings-chart-background');
        press('database-settings-chart-png');
        expect(png).toHaveBeenCalledWith({ background: false });
        await vi.waitFor(() => expect(saved).toEqual(['Tasks.png']));

        openSaveAs(element);
        press('database-settings-chart-svg');
        expect(svg).toHaveBeenLastCalledWith({ background: true });
        await vi.waitFor(() => expect(saved).toEqual(['Tasks.png', 'Tasks.svg']));

        tool.destroy();
      });
    });

    it('keeps export but drops import and merge in read-only mode', () => {
      const { tool } = mount({}, true);

      expect(internals(tool).csvActions().map((a) => a.testId)).toEqual(['database-settings-csv-export']);

      tool.destroy();
    });
  });
});

describe('DatabaseTool — board grouped by a non-option property', () => {
  const schema: PropertyDefinition[] = [
    { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
    { id: 'prop-done', name: 'Done', type: 'checkbox', position: 'a1' },
    { id: 'prop-owner', name: 'Owner', type: 'person', position: 'a2' },
    { id: 'prop-est', name: 'Estimate', type: 'number', position: 'a3' },
  ];
  const children = (): BlockAPI[] => [
    createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'One', 'prop-done': true, 'prop-owner': [{ id: 'u1' }], 'prop-est': 3 }, position: 'a0' }),
    createMockRowBlock({ id: 'row-2', properties: { 'prop-title': 'Two', 'prop-done': false, 'prop-owner': [], 'prop-est': 15 }, position: 'a1' }),
  ];
  const mount = (groupBy: string): { tool: DatabaseTool; element: HTMLElement } => {
    const tool = new DatabaseTool(createDatabaseOptions({
      schema,
      views: [{ id: 'v', name: 'Board', type: 'board', position: 'a0', groupBy, sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v',
    }, {}, { childBlocks: children() }));
    const element = tool.render();

    document.body.appendChild(element);
    tool.rendered();

    return { tool, element };
  };
  const cardsByColumn = (element: HTMLElement): string[][] =>
    queryAllByData(element, 'data-blok-database-column')
      .map((column) => [...column.querySelectorAll('[data-blok-database-card]')].map((card) => card.getAttribute('data-row-id') ?? ''));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('draws a checkbox board as two columns, each card in its own', () => {
    const { tool, element } = mount('prop-done');

    expect(cardsByColumn(element)).toEqual(expect.arrayContaining([['row-1'], ['row-2']]));
    expect(queryAllByData(element, 'data-blok-database-column')).toHaveLength(2);

    tool.destroy();
  });

  it('draws a person board with a column per person and a no-value column', () => {
    const { tool, element } = mount('prop-owner');

    expect(cardsByColumn(element)).toEqual(expect.arrayContaining([['row-1'], ['row-2']]));
    expect(element.querySelector('[data-blok-database-column][data-option-id="u1"]')).not.toBeNull();

    tool.destroy();
  });

  it('draws a number board in ranges, each card in its own', () => {
    const { tool, element } = mount('prop-est');

    expect(cardsByColumn(element).filter((ids) => ids.length > 0)).toEqual([['row-1'], ['row-2']]);

    tool.destroy();
  });
});
