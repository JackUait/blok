import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseListView } from '../../../../src/tools/database/database-list-view';
import type { DatabaseRow, PropertyDefinition, SelectOption } from '../../../../src/tools/database/types';
import type { I18n } from '../../../../types';

const makeRow = (overrides: Partial<DatabaseRow> = {}): DatabaseRow => ({
  id: 'row-1', position: 'a0', properties: { title: 'Fix bug' }, ...overrides,
});

const makeSchema = (overrides: Partial<PropertyDefinition>[] = []): PropertyDefinition[] => [
  { id: 'title', name: 'Title', type: 'title', position: 'a0' },
  ...overrides.map((o, i) => ({
    id: `prop-${i}`, name: `Prop ${i}`, type: 'text' as const, position: `a${i + 1}`, ...o,
  })),
];

const createMockI18n = (): I18n => ({
  t: vi.fn((key: string) => key),
  has: vi.fn(() => true),
  getEnglishTranslation: vi.fn(() => ''),
  getLocale: vi.fn(() => 'en'),
});

describe('DatabaseListView', () => {
  let i18n: I18n;

  beforeEach(() => {
    vi.clearAllMocks();
    i18n = createMockI18n();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createView — flat list rendering', () => {
    it('renders wrapper with data-blok-database-list attribute', () => {
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      expect(list.hasAttribute('data-blok-database-list')).toBe(true);
    });

    it('renders wrapper with role="list"', () => {
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      expect(list.getAttribute('role')).toBe('list');
    });

    it('renders aria-label="List view" on wrapper', () => {
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      expect(list.getAttribute('aria-label')).toBe('List view');
    });

    it('renders one row element per row', () => {
      const rows = [
        makeRow({ id: 'row-1', position: 'a0' }),
        makeRow({ id: 'row-2', position: 'a1' }),
        makeRow({ id: 'row-3', position: 'a2' }),
      ];
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      const rowEls = list.querySelectorAll('[data-blok-database-list-row]');

      expect(rowEls).toHaveLength(3);
    });

    it('sets data-row-id on each row element', () => {
      const rows = [
        makeRow({ id: 'row-x', position: 'a0' }),
        makeRow({ id: 'row-y', position: 'a1' }),
      ];
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      const rowEls = list.querySelectorAll('[data-blok-database-list-row]');

      expect(rowEls[0].getAttribute('data-row-id')).toBe('row-x');
      expect(rowEls[1].getAttribute('data-row-id')).toBe('row-y');
    });

    it('renders title text inside [data-blok-database-list-row-title]', () => {
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Hello World' } })];
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      const titleEl = list.querySelector('[data-blok-database-list-row-title]');

      expect(titleEl?.textContent).toBe('Hello World');
    });

    it('renders placeholder with data-placeholder attribute when title is empty', () => {
      const rows = [makeRow({ id: 'row-1', properties: { title: '' } })];
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      const titleEl = list.querySelector('[data-blok-database-list-row-title]');

      expect(titleEl?.hasAttribute('data-placeholder')).toBe(true);
    });

    it('renders [data-blok-database-add-row] button when NOT read-only', () => {
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      const addRowBtn = list.querySelector('[data-blok-database-add-row]');

      expect(addRowBtn).not.toBeNull();
    });

    it('hides add-row button in read-only mode', () => {
      const view = new DatabaseListView({
        readOnly: true, i18n, rows: [], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      const addRowBtn = list.querySelector('[data-blok-database-add-row]');

      expect(addRowBtn).toBeNull();
    });

    it('add-row button text prefixed with +', () => {
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      const addRowBtn = list.querySelector('[data-blok-database-add-row]');

      expect(addRowBtn?.textContent).toMatch(/^\+ /);
    });

    it('renders [data-blok-database-delete-row] button on each row when NOT read-only', () => {
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      const deleteBtns = list.querySelectorAll('[data-blok-database-delete-row]');

      expect(deleteBtns).toHaveLength(1);
      expect(deleteBtns[0].getAttribute('data-row-id')).toBe('row-1');
      expect(deleteBtns[0].textContent).toBe('\u00d7');
    });

    it('does not render delete-row button in read-only mode', () => {
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseListView({
        readOnly: true, i18n, rows, titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      const deleteBtns = list.querySelectorAll('[data-blok-database-delete-row]');

      expect(deleteBtns).toHaveLength(0);
    });

    it('each row element has role="listitem"', () => {
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      const rowEl = list.querySelector('[data-blok-database-list-row]');

      expect(rowEl?.getAttribute('role')).toBe('listitem');
    });

    it('row element has flexbox display', () => {
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      const rowEl = list.querySelector('[data-blok-database-list-row]') as HTMLElement;

      expect(rowEl.style.display).toBe('flex');
    });

    it('renders open button inside properties area', () => {
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      const propertiesEl = list.querySelector('[data-blok-database-list-row-properties]');
      const openBtn = propertiesEl?.querySelector('[data-blok-database-list-row-open]');

      expect(openBtn).not.toBeNull();
    });
  });

  describe('property badges', () => {
    it('renders visible property badges in properties container', () => {
      const schema = makeSchema([
        { id: 'prop-a', name: 'Notes', type: 'text' },
        { id: 'prop-b', name: 'Count', type: 'number' },
      ]);
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Row', 'prop-a': 'hello', 'prop-b': 42 } })];
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema,
        visiblePropertyIds: ['prop-a', 'prop-b'],
      });
      const list = view.createView();

      const badges = list.querySelectorAll('[data-blok-database-list-row-property]');

      expect(badges).toHaveLength(2);
    });

    it('renders select property as a colored pill with label', () => {
      const schema: PropertyDefinition[] = [
        { id: 'title', name: 'Title', type: 'title', position: 'a0' },
        {
          id: 'status', name: 'Status', type: 'select', position: 'a1',
          config: {
            options: [
              { id: 'opt-todo', label: 'To Do', color: 'red', position: 'a0' },
            ],
          },
        },
      ];
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Row', status: 'opt-todo' } })];
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema,
        visiblePropertyIds: ['status'],
      });
      const list = view.createView();

      const badge = list.querySelector('[data-blok-database-list-row-property][data-property-id="status"]') as HTMLElement;

      expect(badge).not.toBeNull();
      expect(badge.textContent).toBe('To Do');
      expect(badge.style.backgroundColor).toBe('var(--blok-color-red-bg)');
      expect(badge.style.color).toBe('var(--blok-color-red-text)');
    });

    it('renders checkbox property as an input[type=checkbox]', () => {
      const schema: PropertyDefinition[] = [
        { id: 'title', name: 'Title', type: 'title', position: 'a0' },
        { id: 'done', name: 'Done', type: 'checkbox', position: 'a1' },
      ];
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Row', done: true } })];
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema,
        visiblePropertyIds: ['done'],
      });
      const list = view.createView();

      const badge = list.querySelector('[data-blok-database-list-row-property][data-property-id="done"]') as HTMLElement;
      const checkbox = badge.querySelector('input[type="checkbox"]') as HTMLInputElement;

      expect(checkbox).not.toBeNull();
      expect(checkbox.checked).toBe(true);
    });

    it('renders number property as plain text', () => {
      const schema: PropertyDefinition[] = [
        { id: 'title', name: 'Title', type: 'title', position: 'a0' },
        { id: 'count', name: 'Count', type: 'number', position: 'a1' },
      ];
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Row', count: 99 } })];
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema,
        visiblePropertyIds: ['count'],
      });
      const list = view.createView();

      const badge = list.querySelector('[data-blok-database-list-row-property][data-property-id="count"]') as HTMLElement;

      expect(badge.textContent).toBe('99');
    });

    it('does not render badges for property ids NOT in visiblePropertyIds', () => {
      const schema: PropertyDefinition[] = [
        { id: 'title', name: 'Title', type: 'title', position: 'a0' },
        { id: 'notes', name: 'Notes', type: 'text', position: 'a1' },
        { id: 'hidden', name: 'Hidden', type: 'text', position: 'a2' },
      ];
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Row', notes: 'hi', hidden: 'secret' } })];
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema,
        visiblePropertyIds: ['notes'],
      });
      const list = view.createView();

      const badges = list.querySelectorAll('[data-blok-database-list-row-property]');

      expect(badges).toHaveLength(1);
      expect(badges[0].getAttribute('data-property-id')).toBe('notes');
    });
  });

  describe('DOM update helpers', () => {
    it('appendRow adds a row element to the wrapper', () => {
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();
      const newRow = makeRow({ id: 'row-new', properties: { title: 'New row' } });

      view.appendRow(list, newRow);

      const rowEls = list.querySelectorAll('[data-blok-database-list-row]');

      expect(rowEls).toHaveLength(1);
      expect(rowEls[0].getAttribute('data-row-id')).toBe('row-new');
    });

    it('appendRow inserts before [data-blok-database-add-row] button when present', () => {
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();
      const newRow = makeRow({ id: 'row-new', properties: { title: 'New row' } });

      view.appendRow(list, newRow);

      const children = Array.from(list.children);
      const addRowIdx = children.findIndex(el => el.hasAttribute('data-blok-database-add-row'));
      const newRowIdx = children.findIndex(el => el.getAttribute('data-row-id') === 'row-new');

      expect(newRowIdx).toBeLessThan(addRowIdx);
    });

    it('removeRow removes the row element by id', () => {
      const rows = [
        makeRow({ id: 'row-1', position: 'a0' }),
        makeRow({ id: 'row-2', position: 'a1' }),
      ];
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      view.removeRow(list, 'row-1');

      const rowEls = list.querySelectorAll('[data-blok-database-list-row]');

      expect(rowEls).toHaveLength(1);
      expect(rowEls[0].getAttribute('data-row-id')).toBe('row-2');
    });

    it('updateRowTitle updates the title text', () => {
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Old Title' } })];
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      view.updateRowTitle(list, 'row-1', 'New Title');

      const titleEl = list.querySelector('[data-row-id="row-1"] [data-blok-database-list-row-title]');

      expect(titleEl?.textContent).toBe('New Title');
      expect(titleEl?.hasAttribute('data-placeholder')).toBe(false);
    });

    it('updateRowTitle shows placeholder when title is cleared', () => {
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Some Title' } })];
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      view.updateRowTitle(list, 'row-1', '');

      const titleEl = list.querySelector('[data-row-id="row-1"] [data-blok-database-list-row-title]');

      expect(titleEl?.hasAttribute('data-placeholder')).toBe(true);
    });

    it('updateRowTitle does nothing when row id is not found', () => {
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      // Should not throw
      expect(() => view.updateRowTitle(list, 'nonexistent', 'Title')).not.toThrow();
    });
  });

  describe('grouped list rendering', () => {
    const makeGroupedOptions = (): { options: SelectOption[]; getRows: (optionId: string) => DatabaseRow[] } => {
      const todoRows = [
        makeRow({ id: 'row-1', position: 'a0', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' } }),
      ];
      const doneRows = [
        makeRow({ id: 'row-2', position: 'a1', properties: { 'prop-title': 'Task 2', 'prop-status': 'opt-done' } }),
        makeRow({ id: 'row-3', position: 'a2', properties: { 'prop-title': 'Task 3', 'prop-status': 'opt-done' } }),
      ];
      const options: SelectOption[] = [
        { id: 'opt-todo', label: 'Todo', color: 'gray', position: 'a0' },
        { id: 'opt-done', label: 'Done', color: 'green', position: 'a1' },
      ];
      const rowMap = new Map([['opt-todo', todoRows], ['opt-done', doneRows]]);

      return { options, getRows: (optionId) => rowMap.get(optionId) ?? [] };
    };

    it('renders one [data-blok-database-list-group] per option', () => {
      const { options, getRows } = makeGroupedOptions();
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'prop-title', schema: makeSchema(), visiblePropertyIds: [],
        options, getRows,
      });
      const list = view.createView();

      const groups = list.querySelectorAll('[data-blok-database-list-group]');

      expect(groups).toHaveLength(2);
    });

    it('sets data-option-id on each group', () => {
      const { options, getRows } = makeGroupedOptions();
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'prop-title', schema: makeSchema(), visiblePropertyIds: [],
        options, getRows,
      });
      const list = view.createView();

      const groups = list.querySelectorAll('[data-blok-database-list-group]');

      expect(groups[0].getAttribute('data-option-id')).toBe('opt-todo');
      expect(groups[1].getAttribute('data-option-id')).toBe('opt-done');
    });

    it('renders group header with toggle, dot, title, and count', () => {
      const { options, getRows } = makeGroupedOptions();
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'prop-title', schema: makeSchema(), visiblePropertyIds: [],
        options, getRows,
      });
      const list = view.createView();

      const firstGroup = list.querySelector('[data-blok-database-list-group]');
      const header = firstGroup?.querySelector('[data-blok-database-list-group-header]');

      expect(header).not.toBeNull();
      expect(header?.querySelector('[data-blok-database-list-group-toggle]')).not.toBeNull();
      expect(header?.querySelector('[data-blok-database-list-group-dot]')).not.toBeNull();
      expect(header?.querySelector('[data-blok-database-list-group-title]')).not.toBeNull();
      expect(header?.querySelector('[data-blok-database-list-group-count]')).not.toBeNull();
    });

    it('renders correct row count per group', () => {
      const { options, getRows } = makeGroupedOptions();
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'prop-title', schema: makeSchema(), visiblePropertyIds: [],
        options, getRows,
      });
      const list = view.createView();

      const groups = list.querySelectorAll('[data-blok-database-list-group]');
      const todoCount = groups[0].querySelector('[data-blok-database-list-group-count]');
      const doneCount = groups[1].querySelector('[data-blok-database-list-group-count]');

      expect(todoCount?.textContent).toBe('1');
      expect(doneCount?.textContent).toBe('2');
    });

    it('renders rows inside [data-blok-database-list-rows] within each group', () => {
      const { options, getRows } = makeGroupedOptions();
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'prop-title', schema: makeSchema(), visiblePropertyIds: [],
        options, getRows,
      });
      const list = view.createView();

      const groups = list.querySelectorAll('[data-blok-database-list-group]');
      const todoRows = groups[0].querySelectorAll('[data-blok-database-list-rows] [data-blok-database-list-row]');
      const doneRows = groups[1].querySelectorAll('[data-blok-database-list-rows] [data-blok-database-list-row]');

      expect(todoRows).toHaveLength(1);
      expect(doneRows).toHaveLength(2);
    });

    it('renders add-row button per group with data-option-id', () => {
      const { options, getRows } = makeGroupedOptions();
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'prop-title', schema: makeSchema(), visiblePropertyIds: [],
        options, getRows,
      });
      const list = view.createView();

      const groups = list.querySelectorAll('[data-blok-database-list-group]');
      const todoAddBtn = groups[0].querySelector('[data-blok-database-add-row]');
      const doneAddBtn = groups[1].querySelector('[data-blok-database-add-row]');

      expect(todoAddBtn).not.toBeNull();
      expect(todoAddBtn?.getAttribute('data-option-id')).toBe('opt-todo');
      expect(doneAddBtn).not.toBeNull();
      expect(doneAddBtn?.getAttribute('data-option-id')).toBe('opt-done');
    });

    it('applies color dot with correct background color', () => {
      const { options, getRows } = makeGroupedOptions();
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'prop-title', schema: makeSchema(), visiblePropertyIds: [],
        options, getRows,
      });
      const list = view.createView();

      const groups = list.querySelectorAll('[data-blok-database-list-group]');
      const todoDot = groups[0].querySelector('[data-blok-database-list-group-dot]') as HTMLElement;
      const doneDot = groups[1].querySelector('[data-blok-database-list-group-dot]') as HTMLElement;

      expect(todoDot.style.backgroundColor).toBe('var(--blok-color-gray-text)');
      expect(doneDot.style.backgroundColor).toBe('var(--blok-color-green-text)');
    });

    it('grouped wrapper does NOT have role="list"', () => {
      const { options, getRows } = makeGroupedOptions();
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'prop-title', schema: makeSchema(), visiblePropertyIds: [],
        options, getRows,
      });
      const list = view.createView();

      expect(list.getAttribute('role')).toBeNull();
    });

    it('rows container within each group has role="list"', () => {
      const { options, getRows } = makeGroupedOptions();
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'prop-title', schema: makeSchema(), visiblePropertyIds: [],
        options, getRows,
      });
      const list = view.createView();

      const rowsContainers = Array.from(list.querySelectorAll('[data-blok-database-list-rows]'));

      for (const container of rowsContainers) {
        expect(container.getAttribute('role')).toBe('list');
      }
    });

    it('clicking toggle hides rows container (sets display: none)', () => {
      const { options, getRows } = makeGroupedOptions();
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'prop-title', schema: makeSchema(), visiblePropertyIds: [],
        options, getRows,
      });
      const list = view.createView();

      const firstGroup = list.querySelector('[data-blok-database-list-group]');
      const header = firstGroup?.querySelector('[data-blok-database-list-group-header]') as HTMLElement;
      const rowsContainer = firstGroup?.querySelector('[data-blok-database-list-rows]') as HTMLElement;

      header.click();

      expect(rowsContainer.style.display).toBe('none');
    });

    it('clicking toggle again shows rows container (restores display: "")', () => {
      const { options, getRows } = makeGroupedOptions();
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'prop-title', schema: makeSchema(), visiblePropertyIds: [],
        options, getRows,
      });
      const list = view.createView();

      const firstGroup = list.querySelector('[data-blok-database-list-group]');
      const header = firstGroup?.querySelector('[data-blok-database-list-group-header]') as HTMLElement;
      const rowsContainer = firstGroup?.querySelector('[data-blok-database-list-rows]') as HTMLElement;

      header.click();
      header.click();

      expect(rowsContainer.style.display).toBe('');
    });

    it('toggle text switches between ▼ (expanded) and ▶ (collapsed)', () => {
      const { options, getRows } = makeGroupedOptions();
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'prop-title', schema: makeSchema(), visiblePropertyIds: [],
        options, getRows,
      });
      const list = view.createView();

      const firstGroup = list.querySelector('[data-blok-database-list-group]');
      const header = firstGroup?.querySelector('[data-blok-database-list-group-header]') as HTMLElement;
      const toggle = firstGroup?.querySelector('[data-blok-database-list-group-toggle]') as HTMLElement;

      expect(toggle.textContent).toBe('▼');

      header.click();
      expect(toggle.textContent).toBe('▶');

      header.click();
      expect(toggle.textContent).toBe('▼');
    });

    it('clicking toggle hides add-row button within the group', () => {
      const { options, getRows } = makeGroupedOptions();
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'prop-title', schema: makeSchema(), visiblePropertyIds: [],
        options, getRows,
      });
      const list = view.createView();

      const firstGroup = list.querySelector('[data-blok-database-list-group]');
      const header = firstGroup?.querySelector('[data-blok-database-list-group-header]') as HTMLElement;
      const addRowBtn = firstGroup?.querySelector('[data-blok-database-add-row]') as HTMLElement;

      header.click();

      expect(addRowBtn.style.display).toBe('none');
    });

    it('clicking toggle again shows add-row button within the group', () => {
      const { options, getRows } = makeGroupedOptions();
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'prop-title', schema: makeSchema(), visiblePropertyIds: [],
        options, getRows,
      });
      const list = view.createView();

      const firstGroup = list.querySelector('[data-blok-database-list-group]');
      const header = firstGroup?.querySelector('[data-blok-database-list-group-header]') as HTMLElement;
      const addRowBtn = firstGroup?.querySelector('[data-blok-database-add-row]') as HTMLElement;

      header.click();
      header.click();

      expect(addRowBtn.style.display).toBe('');
    });
  });
});
