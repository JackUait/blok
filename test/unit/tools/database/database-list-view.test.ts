import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseListView } from '../../../../src/tools/database/database-list-view';
import type { DatabaseRow, PropertyDefinition, SelectOption } from '../../../../src/tools/database/types';
import type { I18n } from '../../../../types';
import { createDefaultStatusSettings } from '../../../../src/tools/database/property-values';
import { HINT_DELAY, destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { hover, shownHint } from './hint-harness';

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

    it('puts the rows in a labelled role="list" that holds list items only, with "+ New page" outside it', () => {
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [makeRow()], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
        total: 2, onLoadMore: vi.fn(),
      });
      const list = view.createView();
      const rows = list.querySelector('[role="list"]');

      expect(list.hasAttribute('role')).toBe(false);
      expect(rows?.getAttribute('aria-label')).toBe('tools.database.listView');
      expect([...(rows?.children ?? [])].every((child) => child.getAttribute('role') === 'listitem')).toBe(true);
      expect(list.querySelector(':scope > [data-blok-database-add-row]')).not.toBeNull();
      expect(list.querySelector(':scope > [data-blok-database-list-load-more]')).not.toBeNull();
    });

    it('keeps a group\'s "Load more" outside its role="list" rows', () => {
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
        options: [{ id: 'g1', label: 'G', position: 'a0' }], getRows: () => [makeRow()], getTotal: () => 2, onLoadMore: vi.fn(),
      });
      const rows = view.createView().querySelector('[data-blok-database-list-group] [role="list"]');

      expect([...(rows?.children ?? [])].every((child) => child.getAttribute('role') === 'listitem')).toBe(true);
    });

    it('gives each editable row a drag handle in its left gutter, as the table\'s ⋮⋮ (research/12 §3, 64-list-row-hover.png)', () => {
      const editable = new DatabaseListView({
        readOnly: false, i18n, rows: [makeRow()], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      }).createView();
      const handle = editable.querySelector<HTMLButtonElement>('[data-blok-database-list-row] > [data-blok-database-list-row-gutter] > [data-blok-database-list-row-handle]');

      expect(handle?.getAttribute('aria-label')).toBe('tools.database.tableDragHandle');
      expect(handle?.getAttribute('data-row-id')).toBe('row-1');
      expect(handle?.tabIndex).toBe(-1);
      expect(handle?.type).toBe('button');

      const readOnly = new DatabaseListView({
        readOnly: true, i18n, rows: [makeRow()], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      }).createView();

      expect(readOnly.querySelector('[data-blok-database-list-row-handle]')).toBeNull();
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

    // findings-listgallery L18: Notion's plusSmall glyph, then "New page".
    it('draws "+ New page" as the plus glyph and the label', () => {
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      const addRowBtn = list.querySelector('[data-blok-database-add-row]');

      expect(addRowBtn?.querySelector(':scope > span[aria-hidden="true"] > svg')).not.toBeNull();
      expect(addRowBtn?.textContent?.trim()).toBe('tools.database.newPage');
    });

    // findings-listgallery L03/L04: Notion's row has no buttons at its end.
    it('draws no open or delete button at the row end', () => {
      const list = new DatabaseListView({
        readOnly: false, i18n, rows: [makeRow()], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      }).createView();

      expect(list.querySelector('[data-blok-database-delete-row]')).toBeNull();
      expect(list.querySelector('[data-blok-database-list-row-open]')).toBeNull();
    });

    it('puts a "+" before the ⋮⋮ in the gutter that adds an item below the row, without opening it', () => {
      const onNewBelow = vi.fn();
      const opened = vi.fn();
      const list = new DatabaseListView({
        readOnly: false, i18n, rows: [makeRow()], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [], onNewBelow,
      }).createView();
      const gutter = list.querySelector('[data-blok-database-list-row-gutter]');
      const add = gutter?.querySelector<HTMLButtonElement>(':scope > [data-blok-database-list-row-add]');

      expect(gutter?.firstElementChild).toBe(add);
      expect(add?.getAttribute('aria-label')).toBe('tools.database.tableAddBelow');
      expect(add?.type).toBe('button');
      expect(add?.tabIndex).toBe(-1);
      document.body.appendChild(list);
      document.body.addEventListener('click', opened);
      add?.click();
      document.body.removeEventListener('click', opened);
      list.remove();

      expect(onNewBelow).toHaveBeenCalledWith('row-1', null);
      expect(opened).not.toHaveBeenCalled();
    });

    it('puts an Edit pencil after the title that renames the row in place, without opening it', () => {
      const onTitleEdit = vi.fn();
      const opened = vi.fn();
      const list = new DatabaseListView({
        readOnly: false, i18n, rows: [makeRow()], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [], onTitleEdit,
      }).createView();
      const edit = list.querySelector<HTMLButtonElement>('[data-blok-database-list-row-title] + [data-blok-database-list-row-edit]');

      expect(edit?.getAttribute('aria-label')).toBe('tools.database.editCardTitle');
      expect(edit?.type).toBe('button');
      document.body.appendChild(list);
      document.body.addEventListener('click', opened);
      edit?.click();
      document.body.removeEventListener('click', opened);
      const input = list.querySelector<HTMLInputElement>('[data-row-id="row-1"] input');

      expect(opened).not.toHaveBeenCalled();
      expect(input?.value).toBe('Fix bug');
      if (input === null) return;
      input.value = 'Renamed';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      list.remove();

      expect(onTitleEdit).toHaveBeenCalledWith('row-1', 'Renamed');
    });

    it('draws no "+" or Edit pencil in a read-only list', () => {
      const list = new DatabaseListView({
        readOnly: true, i18n, rows: [makeRow()], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      }).createView();

      expect(list.querySelector('[data-blok-database-list-row-add]')).toBeNull();
      expect(list.querySelector('[data-blok-database-list-row-edit]')).toBeNull();
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

    it('row element has data-blok-database-list-row attribute for CSS flex layout', () => {
      const rows = [makeRow({ id: 'row-1' })];
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      const rowEl = list.querySelector('[data-blok-database-list-row]') as HTMLElement;

      expect(rowEl).not.toBeNull();
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

    // research/35 §4: a list value hints its name, plus the description when there is one, below it.
    it('a badge hints its name and description, or its name alone, below it', () => {
      destroyTooltip();
      vi.useFakeTimers();
      try {
        const schema = makeSchema([
          { id: 'prop-a', name: 'Notes', type: 'text', description: 'What we noted' },
          { id: 'prop-b', name: 'Count', type: 'number' },
        ]);
        const rows = [makeRow({ id: 'row-1', properties: { title: 'Row', 'prop-a': 'hello', 'prop-b': 42 } })];
        const list = new DatabaseListView({ readOnly: false, i18n, rows, titlePropertyId: 'title', schema, visiblePropertyIds: ['prop-a', 'prop-b'] }).createView();
        const badge = (id: string): HTMLElement | null => list.querySelector<HTMLElement>(`[data-blok-database-list-row-property][data-property-id="${id}"]`);

        document.body.appendChild(list);
        hover(badge('prop-a'));
        vi.advanceTimersByTime(HINT_DELAY - 1);
        expect(shownHint()).toBeNull();
        vi.advanceTimersByTime(1);
        expect(shownHint()).toEqual({ text: 'NotesWhat we noted', placement: 'bottom' });

        badge('prop-a')?.dispatchEvent(new MouseEvent('mouseleave'));
        vi.advanceTimersByTime(1000);
        hover(badge('prop-b'));
        vi.advanceTimersByTime(HINT_DELAY);
        expect(shownHint()).toEqual({ text: 'Count', placement: 'bottom' });
      } finally {
        vi.useRealTimers();
        document.body.innerHTML = '';
      }
    });

    it('renders select property as the shared colored option pill', () => {
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

      const pill = list.querySelector('[data-blok-database-list-row-property][data-property-id="status"] [data-blok-database-option-pill]');

      expect(pill?.textContent).toBe('To Do');
      expect(pill?.getAttribute('data-color')).toBe('red');
    });

    it('renders a checkbox property as the shared display checkbox with accessible state text', () => {
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
      const box = badge.querySelector('[data-blok-database-checkbox]') as HTMLElement;

      expect(badge.querySelector('input[type="checkbox"]')).toBeNull();
      expect(box.getAttribute('aria-hidden')).toBe('true');
      expect(box.getAttribute('data-state')).toBe('checked');
      expect(badge.textContent).toContain('tools.database.checkboxChecked');
    });

    it('conveys an unchecked checkbox with the unchecked state text', () => {
      const schema: PropertyDefinition[] = [
        { id: 'title', name: 'Title', type: 'title', position: 'a0' },
        { id: 'done', name: 'Done', type: 'checkbox', position: 'a1' },
      ];
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Row', done: false } })];
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema,
        visiblePropertyIds: ['done'],
      });
      const list = view.createView();

      const badge = list.querySelector('[data-blok-database-list-row-property][data-property-id="done"]') as HTMLElement;

      expect(badge.querySelector('[data-blok-database-checkbox]')?.getAttribute('data-state')).toBe('unchecked');
      expect(badge.textContent).toContain('tools.database.checkboxUnchecked');
    });

    it('formats a number with its property number format, not the raw value', () => {
      const schema: PropertyDefinition[] = [
        { id: 'title', name: 'Title', type: 'title', position: 'a0' },
        { id: 'count', name: 'Count', type: 'number', position: 'a1', number: { format: 'dollar' } },
      ];
      const rows = [makeRow({ id: 'row-1', properties: { title: 'Row', count: 1200 } })];
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema,
        visiblePropertyIds: ['count'], locale: 'en-US',
      });
      const list = view.createView();

      const badge = list.querySelector('[data-blok-database-list-row-property][data-property-id="count"]') as HTMLElement;

      expect(badge.textContent).toBe('$1,200.00');
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

  describe('property values through the shared cells layer', () => {
    const schema: PropertyDefinition[] = [
      { id: 'title', name: 'Title', type: 'title', position: 'a0' },
      {
        id: 'st', name: 'Stage', type: 'status', position: 'a1', status: createDefaultStatusSettings(),
        config: { options: [{ id: 's-todo', label: 'Not started', color: 'gray', position: 'a0', groupId: 'todo' }] },
      },
      { id: 'due', name: 'Due', type: 'date', position: 'a2' },
      {
        id: 'tags', name: 'Tags', type: 'multiSelect', position: 'a3',
        config: { options: [{ id: 't1', label: 'Alpha', color: 'blue', position: 'a0' }, { id: 't2', label: 'Beta', color: 'pink', position: 'a1' }] },
      },
      { id: 'own', name: 'Owner', type: 'person', position: 'a4' },
      { id: 'fx', name: 'Formula', type: 'formula', position: 'a5' },
      { id: 'notes', name: 'Notes', type: 'text', position: 'a6' },
    ];
    const ids = ['st', 'due', 'tags', 'own', 'fx', 'notes'];
    const row = makeRow({
      id: 'r1',
      properties: { title: 'Row', st: 's-todo', due: '2026-10-12', tags: ['t1', 't2'], own: [{ id: 'u1' }], fx: 7, notes: '' },
    });
    const slot = (list: HTMLElement, id: string): HTMLElement | null =>
      list.querySelector<HTMLElement>(`[data-blok-database-list-row-property][data-property-id="${id}"]`);
    const make = (overrides: Partial<ConstructorParameters<typeof DatabaseListView>[0]> = {}): HTMLElement => new DatabaseListView({
      readOnly: false, i18n, rows: [row], titlePropertyId: 'title', schema, visiblePropertyIds: ids, locale: 'en-US',
      cellContext: { people: [{ id: 'u1', name: 'Ada' }] },
      ...overrides,
    }).createView();

    it('shows a status as its label pill, never the option id', () => {
      const list = make();

      expect(slot(list, 'st')?.textContent).not.toContain('s-todo');
      expect(slot(list, 'st')?.querySelector('[data-blok-database-option-pill]')?.textContent).toBe('Not started');
    });

    it('shows a date formatted, never the raw ISO string', () => {
      const text = slot(make(), 'due')?.textContent ?? '';

      expect(text).not.toBe('2026-10-12');
      expect(text).toContain('2026');
    });

    it('shows every multi-select option as a pill', () => {
      const pills = [...(slot(make(), 'tags')?.querySelectorAll('[data-blok-database-option-pill]') ?? [])].map((p) => p.textContent);

      expect(pills).toEqual(['Alpha', 'Beta']);
    });

    it('shows a person as an avatar chip whose name stays for screen readers only', () => {
      const chip = slot(make(), 'own')?.querySelector('[data-blok-database-person-chip]');

      expect(chip).not.toBeNull();
      expect(chip?.querySelector('[data-blok-database-sr-only]')?.textContent).toBe('Ada');
    });

    it('shows a formula as its result type through valueProperty', () => {
      const list = make({ cellContext: { valueProperty: (p) => ({ ...p, type: 'number', number: { format: 'dollar' } }) } });

      expect(slot(list, 'fx')?.textContent).toBe('$7.00');
    });

    it('marks each slot with its property type, so the list can cap its width', () => {
      const list = make();

      expect(slot(list, 'st')?.getAttribute('data-type')).toBe('status');
      expect(slot(list, 'due')?.getAttribute('data-type')).toBe('date');
    });

    // findings-listgallery L02: Notion's list shows an image file as a 30x20 thumbnail.
    it('shows an image file as a thumbnail and keeps any other file as its chip', () => {
      const filesSchema: PropertyDefinition[] = [
        { id: 'title', name: 'Title', type: 'title', position: 'a0' },
        { id: 'fl', name: 'Files', type: 'files', position: 'a1' },
      ];
      const list = new DatabaseListView({
        readOnly: false, i18n, titlePropertyId: 'title', schema: filesSchema, visiblePropertyIds: ['fl'],
        rows: [makeRow({ properties: { title: 'Row', fl: [
          { id: 'f1', name: 'photo.png', url: 'https://example.com/photo.png' },
          { id: 'f2', name: 'notes.pdf', url: 'https://example.com/notes.pdf' },
        ] } })],
      }).createView();
      const thumb = list.querySelector<HTMLImageElement>('[data-property-id="fl"] img[data-blok-database-list-file-thumb]');

      expect(thumb?.getAttribute('src')).toBe('https://example.com/photo.png');
      expect(thumb?.alt).toBe('photo.png');
      expect(list.querySelector('[data-property-id="fl"] [data-blok-database-file-chip][data-file-id="f1"]')).toBeNull();
      expect(list.querySelector('[data-property-id="fl"] [data-blok-database-file-chip][data-file-id="f2"]')?.textContent?.trim()).toBe('notes.pdf');
    });

    // notion-spec-2 §21.8 (list-row.png): a file chip in a list row starts with the page glyph.
    it('starts a file chip with the page glyph', () => {
      const filesSchema: PropertyDefinition[] = [
        { id: 'title', name: 'Title', type: 'title', position: 'a0' },
        { id: 'fl', name: 'Files', type: 'files', position: 'a1' },
      ];
      const list = new DatabaseListView({
        readOnly: false, i18n, titlePropertyId: 'title', schema: filesSchema, visiblePropertyIds: ['fl'],
        rows: [makeRow({ properties: { title: 'Row', fl: [{ id: 'f2', name: 'notes.pdf', url: 'https://example.com/notes.pdf' }] } })],
      }).createView();
      const chip = list.querySelector('[data-property-id="fl"] [data-blok-database-file-chip][data-file-id="f2"]');

      expect(chip?.firstElementChild?.hasAttribute('data-blok-database-file-chip-icon')).toBe(true);
      expect(chip?.textContent?.trim()).toBe('notes.pdf');
    });

    it('leaves out a property with no value', () => {
      expect(slot(make(), 'notes')).toBeNull();
    });

    it('names an editable slot by its property and its shown value', () => {
      const button = slot(make(), 'st');

      expect(button?.getAttribute('role')).toBe('button');
      expect(button?.getAttribute('aria-label')).toBe('Stage: Not started');
    });

    // notion-spec-2 §10: Show number off leaves only the gauge, whose name is the value.
    it('names a slot whose gauge hides its number by the gauge\'s value', () => {
      const gauged: PropertyDefinition[] = [
        { id: 'title', name: 'Title', type: 'title', position: 'a0' },
        { id: 'done', name: 'Done', type: 'number', position: 'a1', number: { showAs: 'bar', showNumber: false } },
      ];
      const list = new DatabaseListView({
        readOnly: false, i18n, titlePropertyId: 'title', schema: gauged, visiblePropertyIds: ['done'],
        rows: [makeRow({ properties: { title: 'Row', done: 40 } })],
      }).createView();

      expect(list.querySelector('[data-blok-database-list-row-property][data-property-id="done"]')?.getAttribute('aria-label')).toBe('Done: 40');
    });

    it('never makes a slot a button when its value holds its own link (no nested controls)', () => {
      const linked: PropertyDefinition[] = [...schema, { id: 'site', name: 'Site', type: 'url', position: 'a7' }];
      const list = new DatabaseListView({
        readOnly: false, i18n, rows: [makeRow({ id: 'r1', properties: { title: 'Row', site: 'https://example.com' } })],
        titlePropertyId: 'title', schema: linked, visiblePropertyIds: ['site'],
      }).createView();
      const site = slot(list, 'site');

      expect(site?.querySelector('a[href]')).not.toBeNull();
      expect(site?.hasAttribute('role')).toBe(false);
      expect(site?.hasAttribute('aria-label')).toBe(false);
      expect(site?.hasAttribute('data-editable')).toBe(true);
    });

    // notion-spec-2 §24.1 (104-list-url.png): the table's cut, scheme hidden, path in grey.
    it('cuts a URL as the table does: host, then the path\'s first 4, "…", last 6', () => {
      const linked: PropertyDefinition[] = [...schema, { id: 'site', name: 'Site', type: 'url', position: 'a7' }];
      const list = new DatabaseListView({
        readOnly: false, i18n, rows: [makeRow({ id: 'r1', properties: { title: 'Row', site: 'https://example.com/abc/defg/hijk/lmno' } })],
        titlePropertyId: 'title', schema: linked, visiblePropertyIds: ['site'],
      }).createView();
      const link = slot(list, 'site')?.querySelector('a[href]');

      expect(link?.textContent).toBe('example.com/abc…k/lmno');
      expect(link?.querySelector('[data-blok-database-url-path]')?.textContent).toBe('/abc…k/lmno');
    });

    it('marks a slot editable only when its type has an editor and the list is editable', () => {
      const list = make();

      expect(slot(list, 'st')?.hasAttribute('data-editable')).toBe(true);
      expect(slot(list, 'fx')?.hasAttribute('data-editable')).toBe(false);
      expect(slot(make({ readOnly: true }), 'st')?.hasAttribute('data-editable')).toBe(false);
    });
  });

  describe('inline edit and keyboard (research/03 §5)', () => {
    const schema = makeSchema([{ name: 'A' }, { name: 'B' }]);
    const rows = [
      makeRow({ id: 'r1', position: 'a0', properties: { title: 'One', 'prop-0': 'x', 'prop-1': 'y' } }),
      makeRow({ id: 'r2', position: 'a1', properties: { title: 'Two', 'prop-0': 'z' } }),
    ];
    const mount = (overrides: Partial<ConstructorParameters<typeof DatabaseListView>[0]> = {}): HTMLElement => {
      const list = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema, visiblePropertyIds: ['prop-0', 'prop-1'], ...overrides,
      }).createView();

      document.body.appendChild(list);

      return list;
    };
    const rowEl = (list: HTMLElement, id: string): HTMLElement =>
      list.querySelector<HTMLElement>(`[data-blok-database-list-row][data-row-id="${id}"]`) as HTMLElement;
    const slotOf = (list: HTMLElement, rowId: string, propId: string): HTMLElement =>
      rowEl(list, rowId).querySelector<HTMLElement>(`[data-blok-database-list-row-property][data-property-id="${propId}"]`) as HTMLElement;
    const press = (el: HTMLElement, init: KeyboardEventInit): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

      el.dispatchEvent(event);

      return event;
    };

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('owns its keyboard, so Blok does not take Tab or Shift+Enter', () => {
      expect(mount().hasAttribute('data-blok-keyboard-owner')).toBe(true);
    });

    it('makes the first row the one tab stop', () => {
      const list = mount();

      expect(rowEl(list, 'r1').getAttribute('tabindex')).toBe('0');
      expect(rowEl(list, 'r2').getAttribute('tabindex')).toBe('-1');
    });

    it('edits a property in place on click, without opening the page', () => {
      const onPropertyEdit = vi.fn();
      const outer = vi.fn();
      const list = mount({ onPropertyEdit });

      document.body.addEventListener('click', outer);
      slotOf(list, 'r1', 'prop-0').click();
      document.body.removeEventListener('click', outer);

      expect(onPropertyEdit).toHaveBeenCalledWith('r1', 'prop-0', slotOf(list, 'r1', 'prop-0'));
      expect(outer).not.toHaveBeenCalled();
    });

    it('does not edit in a read-only list', () => {
      const onPropertyEdit = vi.fn();
      const list = mount({ readOnly: true, onPropertyEdit });

      slotOf(list, 'r1', 'prop-0').click();

      expect(onPropertyEdit).not.toHaveBeenCalled();
    });

    it('Tab on a row goes to its first property, then to the next one; Shift+Tab goes back', () => {
      const list = mount({ onPropertyEdit: vi.fn() });

      rowEl(list, 'r1').focus();
      expect(press(rowEl(list, 'r1'), { key: 'Tab' }).defaultPrevented).toBe(true);
      expect(slotOf(list, 'r1', 'prop-0')).toHaveFocus();

      press(slotOf(list, 'r1', 'prop-0'), { key: 'Tab' });
      expect(slotOf(list, 'r1', 'prop-1')).toHaveFocus();

      press(slotOf(list, 'r1', 'prop-1'), { key: 'Tab', shiftKey: true });
      expect(slotOf(list, 'r1', 'prop-0')).toHaveFocus();

      press(slotOf(list, 'r1', 'prop-0'), { key: 'Tab', shiftKey: true });
      expect(rowEl(list, 'r1')).toHaveFocus();
    });

    it('lets Tab leave the list after the last property', () => {
      const list = mount({ onPropertyEdit: vi.fn() });

      expect(press(slotOf(list, 'r1', 'prop-1'), { key: 'Tab' }).defaultPrevented).toBe(false);
    });

    it('Enter on a property opens its editor; Escape goes back to the row', () => {
      const onPropertyEdit = vi.fn();
      const list = mount({ onPropertyEdit });

      press(slotOf(list, 'r1', 'prop-1'), { key: 'Enter' });
      expect(onPropertyEdit).toHaveBeenCalledWith('r1', 'prop-1', slotOf(list, 'r1', 'prop-1'));

      slotOf(list, 'r1', 'prop-1').focus();
      press(slotOf(list, 'r1', 'prop-1'), { key: 'Escape' });
      expect(rowEl(list, 'r1')).toHaveFocus();
    });

    // Focus on a slot past the row edge scrolls the uncut run (notion-spec-2 §21.8); leaving the values puts it back.
    it('scrolls the values back to their start once focus leaves them', () => {
      const list = mount({ onPropertyEdit: vi.fn() });
      const values = rowEl(list, 'r1').querySelector<HTMLElement>('[data-blok-database-list-row-properties]');

      slotOf(list, 'r1', 'prop-1').focus();
      if (values !== null) values.scrollLeft = 120;
      press(slotOf(list, 'r1', 'prop-1'), { key: 'Escape' });

      expect(rowEl(list, 'r1')).toHaveFocus();
      expect(values?.scrollLeft).toBe(0);
    });

    it('Shift+Enter on a row asks for a new item below it', () => {
      const onNewBelow = vi.fn();
      const list = mount({ onNewBelow });

      expect(press(rowEl(list, 'r1'), { key: 'Enter', shiftKey: true }).defaultPrevented).toBe(true);
      expect(onNewBelow).toHaveBeenCalledWith('r1', null);
    });

    it('Shift+Enter in a group passes the group, so the new item lands in it', () => {
      const onNewBelow = vi.fn();
      const options: SelectOption[] = [{ id: 'g1', label: 'G', position: 'a0' }];
      const list = mount({ onNewBelow, options, getRows: () => rows });

      press(rowEl(list, 'r2'), { key: 'Enter', shiftKey: true });

      expect(onNewBelow).toHaveBeenCalledWith('r2', 'g1');
    });

    it('Enter on a row opens it; arrows move between rows', () => {
      const list = mount();
      const open = vi.fn();

      rowEl(list, 'r1').addEventListener('click', open);
      press(rowEl(list, 'r1'), { key: 'Enter' });
      expect(open).toHaveBeenCalled();

      rowEl(list, 'r1').focus();
      press(rowEl(list, 'r1'), { key: 'ArrowDown' });
      expect(rowEl(list, 'r2')).toHaveFocus();
      press(rowEl(list, 'r2'), { key: 'ArrowUp' });
      expect(rowEl(list, 'r1')).toHaveFocus();
    });

    // findings-listgallery L20: arrows move a gray row selection; Shift+Arrow extends it.
    it('selects the row an arrow moves to, and Shift+Arrow extends or shrinks the selection', () => {
      const lassoRows = vi.fn();
      const three = [...rows, makeRow({ id: 'r3', position: 'a2', properties: { title: 'Three' } })];
      const list = mount({ rows: three, lassoRows });

      rowEl(list, 'r1').focus();
      press(rowEl(list, 'r1'), { key: 'ArrowDown' });
      expect(lassoRows).toHaveBeenLastCalledWith(['r2']);

      press(rowEl(list, 'r2'), { key: 'ArrowDown', shiftKey: true });
      expect(lassoRows).toHaveBeenLastCalledWith(['r2', 'r3']);
      expect(rowEl(list, 'r3')).toHaveFocus();

      press(rowEl(list, 'r3'), { key: 'ArrowUp', shiftKey: true });
      expect(lassoRows).toHaveBeenLastCalledWith(['r2']);

      press(rowEl(list, 'r2'), { key: 'ArrowUp', shiftKey: true });
      expect(lassoRows).toHaveBeenLastCalledWith(['r1', 'r2']);
    });

    it('Escape while editing a title selects that row', () => {
      const lassoRows = vi.fn();
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema, visiblePropertyIds: [], lassoRows,
      });
      const list = view.createView();

      document.body.appendChild(list);
      view.editTitle('r2');
      list.querySelector<HTMLInputElement>('[data-blok-database-list-title-input]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

      expect(lassoRows).toHaveBeenLastCalledWith(['r2']);
      expect(rowEl(list, 'r2')).toHaveFocus();
    });

    it('never handles keys in a read-only list beyond opening and moving', () => {
      const onNewBelow = vi.fn();
      const list = mount({ readOnly: true, onNewBelow });

      press(rowEl(list, 'r1'), { key: 'Enter', shiftKey: true });

      expect(onNewBelow).not.toHaveBeenCalled();
    });

    it('starts an inline title edit on a row and reports the new title', () => {
      const onTitleEdit = vi.fn();
      const view = new DatabaseListView({
        readOnly: false, i18n, rows, titlePropertyId: 'title', schema, visiblePropertyIds: [], onTitleEdit,
      });
      const list = view.createView();

      document.body.appendChild(list);
      view.editTitle('r2');
      const input = list.querySelector<HTMLInputElement>('[data-row-id="r2"] input');

      expect(input).not.toBeNull();
      if (input === null) return;
      input.value = 'Renamed';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(onTitleEdit).toHaveBeenCalledWith('r2', 'Renamed');
    });
  });

  describe('title edit look (findings-listgallery L05)', () => {
    const make = (): { view: DatabaseListView; list: HTMLElement } => {
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [makeRow({ properties: { title: '' } })], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      });
      const list = view.createView();

      document.body.appendChild(list);

      return { view, list };
    };

    it('shows "Type a name…", the page glyph and Open in side peek while the title is edited', () => {
      const { view, list } = make();

      view.editTitle('row-1');
      const row = list.querySelector<HTMLElement>('[data-blok-database-list-row]');
      const input = list.querySelector<HTMLInputElement>('[data-blok-database-list-title-input]');
      const edit = list.querySelector<HTMLElement>('[data-blok-database-list-row-edit]');

      expect(input?.placeholder).toBe('tools.database.cardNamePlaceholder');
      expect(input?.value).toBe('');
      expect(row?.hasAttribute('data-editing')).toBe(true);
      expect(row?.querySelector('[data-blok-database-page-icon-placeholder]')).not.toBeNull();
      expect(edit?.getAttribute('aria-label')).toBe('tools.page.openInSidePeek');
      list.remove();
    });

    it('Open in side peek saves the title, then opens the row; the pencil comes back', () => {
      const onTitleEdit = vi.fn();
      const onOpenRow = vi.fn();
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [makeRow({ properties: { title: '' } })], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [], onTitleEdit, onOpenRow,
      });
      const list = view.createView();
      const opened = vi.fn();

      document.body.appendChild(list);
      view.editTitle('row-1');
      const input = list.querySelector<HTMLInputElement>('[data-blok-database-list-title-input]');

      if (input !== null) input.value = 'Named';
      document.body.addEventListener('click', opened);
      list.querySelector<HTMLElement>('[data-blok-database-list-row-edit]')?.click();
      document.body.removeEventListener('click', opened);

      expect(onTitleEdit).toHaveBeenCalledWith('row-1', 'Named');
      expect(onOpenRow).toHaveBeenCalledWith('row-1');
      expect(onTitleEdit.mock.invocationCallOrder[0]).toBeLessThan(onOpenRow.mock.invocationCallOrder[0]);
      expect(opened).not.toHaveBeenCalled();
      expect(list.querySelector('[data-blok-database-list-row]')?.hasAttribute('data-editing')).toBe(false);
      expect(list.querySelectorAll('[data-blok-database-page-icon-placeholder]')).toHaveLength(1);
      expect(list.querySelector('[data-blok-database-list-row-edit]')?.getAttribute('aria-label')).toBe('tools.database.editCardTitle');
      list.remove();
    });
  });

  // notion-spec-2 §21.8 (notion-live-4/list-row.png): with Show page icon on, a row with no emoji shows the empty-page glyph.
  describe('page icon', () => {
    const make = (showPageIcon?: boolean): { view: DatabaseListView; list: HTMLElement } => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [makeRow(), makeRow({ id: 'row-2', position: 'a1', icon: '🏏', properties: { title: 'B' } })],
        titlePropertyId: 'title',
        schema: makeSchema(),
        visiblePropertyIds: [],
        showPageIcon,
      });
      const list = view.createView();

      document.body.appendChild(list);

      return { view, list };
    };
    const rowEl = (list: HTMLElement, id: string): HTMLElement | null => list.querySelector<HTMLElement>(`[data-blok-database-list-row][data-row-id="${id}"]`);

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('shows the page glyph before a title with no emoji, and the emoji otherwise', () => {
      const { list } = make();

      expect(rowEl(list, 'row-1')?.querySelectorAll('[data-blok-database-page-icon-placeholder]')).toHaveLength(1);
      expect(rowEl(list, 'row-2')?.querySelector('[data-blok-database-page-icon-placeholder]')).toBeNull();
      expect(rowEl(list, 'row-2')?.querySelector('[data-blok-database-page-icon]')?.textContent).toBe('🏏');
    });

    it('keeps one glyph while the title is edited', () => {
      const { view, list } = make();

      view.editTitle('row-1');

      expect(rowEl(list, 'row-1')?.querySelectorAll('[data-blok-database-page-icon-placeholder]')).toHaveLength(1);
    });

    it('shows no glyph at rest with Show page icon off', () => {
      const { view, list } = make(false);

      expect(list.querySelector('[data-blok-database-page-icon-placeholder]')).toBeNull();
      expect(list.querySelector('[data-blok-database-page-icon]')).toBeNull();
      view.editTitle('row-1');
      expect(rowEl(list, 'row-1')?.querySelectorAll('[data-blok-database-page-icon-placeholder]')).toHaveLength(1);
    });
  });

  describe('load limit', () => {
    const many = Array.from({ length: 3 }, (_, i) => makeRow({ id: `r${i}`, position: `a${i}` }));

    it('shows "Load more" when the view holds more rows than it shows, and asks for more', () => {
      const onLoadMore = vi.fn();
      const list = new DatabaseListView({
        readOnly: false, i18n, rows: many.slice(0, 2), total: 3, onLoadMore, titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      }).createView();
      const more = list.querySelector<HTMLButtonElement>('[data-blok-database-list-load-more]');

      expect(more?.textContent).toBe('tools.database.tableLoadMore');
      more?.click();
      expect(onLoadMore).toHaveBeenCalledWith('');
    });

    it('shows no "Load more" when every row is shown', () => {
      const list = new DatabaseListView({
        readOnly: false, i18n, rows: many, total: 3, onLoadMore: vi.fn(), titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
      }).createView();

      expect(list.querySelector('[data-blok-database-list-load-more]')).toBeNull();
    });

    it('loads more for a group that holds more rows than it shows', () => {
      const onLoadMore = vi.fn();
      const list = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'title', schema: makeSchema(), visiblePropertyIds: [],
        options: [{ id: 'g1', label: 'G', position: 'a0' }], getRows: () => many.slice(0, 1), getTotal: () => 3, onLoadMore,
      }).createView();

      list.querySelector<HTMLButtonElement>('[data-blok-database-list-load-more][data-group-key="g1"]')?.click();
      expect(onLoadMore).toHaveBeenCalledWith('g1');
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

    // findings-listgallery L08: the board header's parts, no count.
    it('draws the header as a 24px caret button, the value as its pill, then "…" and "+", with no count', () => {
      const { options, getRows } = makeGroupedOptions();
      const schema = makeSchema([{ id: 'prop-status', name: 'Stage', type: 'select', config: { options } }]);
      const list = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'prop-title', schema, visiblePropertyIds: [],
        options, getRows,
      }).createView();
      const header = list.querySelector('[data-blok-database-list-group-header]');
      const toggle = header?.querySelector<HTMLButtonElement>('button[data-blok-database-list-group-toggle]');
      const pill = header?.querySelector('[data-blok-database-list-group-label] [data-blok-database-option-pill]');
      const menu = header?.querySelector<HTMLButtonElement>('button[data-blok-database-column-menu]');
      const add = header?.querySelector<HTMLButtonElement>('button[data-blok-database-list-group-add]');

      expect(toggle?.getAttribute('aria-expanded')).toBe('true');
      expect(toggle?.getAttribute('aria-label')).toBe('tools.database.tableCollapseGroup');
      expect(pill?.textContent).toBe('Todo');
      expect(pill?.getAttribute('data-color')).toBe('gray');
      expect(menu?.getAttribute('data-option-id')).toBe('opt-todo');
      expect(menu?.getAttribute('aria-label')).toBe('tools.database.groupMenuLabel');
      expect(add?.getAttribute('aria-label')).toBe('tools.database.newPage');
      expect(header?.querySelector('[data-blok-database-list-group-count]')).toBeNull();
      expect(header?.querySelector('[data-blok-database-list-group-dot]')).toBeNull();
    });

    it('draws a status group\'s value as the status pill a cell draws', () => {
      const schema: PropertyDefinition[] = [
        { id: 'prop-title', name: 'Name', type: 'title', position: 'a0' },
        {
          id: 'st', name: 'Status', type: 'status', position: 'a1', status: createDefaultStatusSettings(),
          config: { options: [{ id: 'ns', label: 'Not started', position: 'a0', groupId: 'todo' }, { id: 'dn', label: 'Done', color: 'green', position: 'a1', groupId: 'complete' }] },
        },
      ];
      const list = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'prop-title', schema, visiblePropertyIds: [],
        options: [{ id: 'ns', label: 'Not started', position: 'a0', groupId: 'todo' }, { id: 'dn', label: 'Done', color: 'green', position: 'a1', groupId: 'complete' }],
        getRows: () => [],
      }).createView();
      const pills = [...list.querySelectorAll('[data-blok-database-list-group-label] [data-blok-database-option-pill]')];

      expect(pills.map((pill) => pill.getAttribute('data-status-group'))).toEqual(['todo', 'complete']);
      expect(pills[0]?.getAttribute('data-color')).toBe('gray');
    });

    it('the header "+" adds a row to its group and "…" is left to the host; neither collapses the group', () => {
      const { options, getRows } = makeGroupedOptions();
      const list = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'prop-title', schema: makeSchema(), visiblePropertyIds: [],
        options, getRows,
      }).createView();
      const group = list.querySelector<HTMLElement>('[data-blok-database-list-group]');
      const bottomAdd = group?.querySelector<HTMLElement>(':scope > [data-blok-database-add-row]');
      const added = vi.fn();

      bottomAdd?.addEventListener('click', added);
      group?.querySelector<HTMLElement>('[data-blok-database-list-group-add]')?.click();
      group?.querySelector<HTMLElement>('[data-blok-database-column-menu]')?.click();

      expect(added).toHaveBeenCalledTimes(1);
      expect(group?.hasAttribute('data-collapsed')).toBe(false);
    });

    it('a read-only header has no "…" or "+"', () => {
      const { options, getRows } = makeGroupedOptions();
      const list = new DatabaseListView({
        readOnly: true, i18n, rows: [], titlePropertyId: 'prop-title', schema: makeSchema(), visiblePropertyIds: [],
        options, getRows,
      }).createView();

      expect(list.querySelector('[data-blok-database-column-menu]')).toBeNull();
      expect(list.querySelector('[data-blok-database-list-group-add]')).toBeNull();
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

    it('draws the toggle as a chevron and marks the group collapsed, so only the caret turns', () => {
      const { options, getRows } = makeGroupedOptions();
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'prop-title', schema: makeSchema(), visiblePropertyIds: [],
        options, getRows,
      });
      const list = view.createView();

      const firstGroup = list.querySelector('[data-blok-database-list-group]') as HTMLElement;
      const header = firstGroup.querySelector('[data-blok-database-list-group-header]') as HTMLElement;
      const toggle = firstGroup.querySelector('[data-blok-database-list-group-toggle]') as HTMLElement;

      expect(toggle.querySelector('svg')).not.toBeNull();
      expect(toggle.textContent?.trim()).toBe('');
      expect(firstGroup.hasAttribute('data-collapsed')).toBe(false);

      header.click();
      expect(firstGroup.hasAttribute('data-collapsed')).toBe(true);

      header.click();
      expect(firstGroup.hasAttribute('data-collapsed')).toBe(false);
    });

    it('starts a group collapsed when the view saved it collapsed', () => {
      const { options, getRows } = makeGroupedOptions();
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'prop-title', schema: makeSchema(), visiblePropertyIds: [],
        options, getRows, collapsedGroupIds: new Set([options[0].id]),
      });
      const firstGroup = view.createView().querySelector('[data-blok-database-list-group]') as HTMLElement;

      expect(firstGroup.hasAttribute('data-collapsed')).toBe(true);
      expect((firstGroup.querySelector('[data-blok-database-list-rows]') as HTMLElement).style.display).toBe('none');
      expect((firstGroup.querySelector('[data-blok-database-add-row]') as HTMLElement).style.display).toBe('none');
    });

    it('reports each collapse and expand, so the view can keep it', () => {
      const { options, getRows } = makeGroupedOptions();
      const onToggleCollapse = vi.fn();
      const view = new DatabaseListView({
        readOnly: false, i18n, rows: [], titlePropertyId: 'prop-title', schema: makeSchema(), visiblePropertyIds: [],
        options, getRows, onToggleCollapse,
      });
      const header = view.createView().querySelector('[data-blok-database-list-group-header]') as HTMLElement;

      header.click();
      header.click();

      expect(onToggleCollapse.mock.calls).toEqual([[options[0].id, true], [options[0].id, false]]);
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
