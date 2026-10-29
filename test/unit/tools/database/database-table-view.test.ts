import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DatabaseTableView, createTableState } from '../../../../src/tools/database/database-table-view';
import type { TableHandlers, TableState, DatabaseTableViewOptions, TableGroup } from '../../../../src/tools/database/database-table-view';
import { calculationItems } from '../../../../src/tools/database/database-table-menus';
import { PROPERTY_TYPE_META } from '../../../../src/tools/database/database-property-types';
import { IconInfo, IconSplitView } from '../../../../src/components/icons';
import { HINT_DELAY, destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { TOOLTIP_MUTED_INK } from '../../../../src/components/modules/toolbar/tooltip';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition, PropertyType, PropertyValue } from '../../../../src/tools/database/types';

const schema: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-notes', name: 'Notes', type: 'text', position: 'a1' },
  { id: 'p-amount', name: 'Amount', type: 'number', position: 'a2' },
  { id: 'p-stage', name: 'Stage', type: 'select', position: 'a3', config: { options: [
    { id: 'o-idea', label: 'Idea', color: 'yellow', position: 'a0' },
    { id: 'o-build', label: 'Build', color: 'blue', position: 'a1' },
  ] } },
  { id: 'p-done', name: 'Done', type: 'checkbox', position: 'a4' },
];

const row = (id: string, title: string, extra: DatabaseRow['properties'] = {}): DatabaseRow =>
  ({ id, position: id, properties: { 'p-title': title, ...extra } });

const rows = (): DatabaseRow[] => [
  row('r1', 'Alpha', { 'p-notes': 'short', 'p-amount': 1200, 'p-stage': 'o-idea' }),
  row('r2', 'Bravo', { 'p-amount': 35.5, 'p-done': true }),
  row('r3', 'Charlie'),
];

const tableView = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...overrides,
});

const makeHandlers = (): TableHandlers => ({
  commitCell: vi.fn(),
  editEnded: vi.fn(),
  addRow: vi.fn(() => null),
  deleteRows: vi.fn(),
  duplicateRow: vi.fn(),
  openRow: vi.fn(),
  copyRowLink: vi.fn(),
  editRowIcon: vi.fn(),
  updateView: vi.fn(),
  openPropertyMenu: vi.fn(),
  addProperty: vi.fn(),
  viewAction: vi.fn(),
  moveRow: vi.fn(),
  sortedRowDrop: vi.fn(),
  bulkEdit: vi.fn(),
  commitCells: vi.fn(),
  editFilters: vi.fn(),
  rerender: vi.fn(),
  optionsChange: vi.fn(),
});

interface Mounted {
  root: HTMLElement;
  handlers: TableHandlers;
  state: TableState;
  view: DatabaseTableView;
}

const mount = (overrides: Partial<DatabaseTableViewOptions> = {}): Mounted => {
  const handlers = overrides.handlers ?? makeHandlers();
  const state = overrides.state ?? createTableState();
  const view = new DatabaseTableView({
    readOnly: false,
    i18n: { t: (key: string, vars?: Record<string, string | number>) => (vars?.count !== undefined ? `${key}:${vars.count}` : key) } as DatabaseTableViewOptions['i18n'],
    view: tableView(),
    schema,
    rows: rows(),
    titlePropertyId: 'p-title',
    state,
    handlers,
    ...overrides,
  });
  const root = view.createView();

  document.body.appendChild(root);

  return { root, handlers, state, view };
};

const grid = (root: HTMLElement): HTMLElement => {
  const el = root.matches('[role="grid"]') ? root : root.querySelector<HTMLElement>('[role="grid"]');

  if (el === null) {
    throw new Error('no grid');
  }

  return el;
};

const cell = (root: HTMLElement, rowId: string, propertyId: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(`[data-row-id="${rowId}"] [role="gridcell"][data-property-id="${propertyId}"]`);

  if (el === null) {
    throw new Error(`no cell ${rowId}/${propertyId}`);
  }

  return el;
};

const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(event);

  return event;
};

const editor = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-cell-editor]');

const editorField = (): HTMLInputElement | HTMLTextAreaElement => {
  const el = editor()?.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-blok-database-cell-input]');

  if (el === null || el === undefined) {
    throw new Error('no editor field');
  }

  return el;
};

const selectedCells = (root: HTMLElement): string[] =>
  [...root.querySelectorAll<HTMLElement>('[role="gridcell"][aria-selected="true"]')]
    .map((el) => `${el.closest('[data-row-id]')?.getAttribute('data-row-id') ?? ''}/${el.getAttribute('data-property-id') ?? ''}`);

const anchorCell = (root: HTMLElement): string | null => {
  const el = root.querySelector<HTMLElement>('[data-blok-database-table-cell-anchor]');

  return el === null ? null : `${el.closest('[data-row-id]')?.getAttribute('data-row-id') ?? ''}/${el.getAttribute('data-property-id') ?? ''}`;
};

/** Select a cell without opening its editor: click opens, Escape closes back to the cell. */
const selectCell = (root: HTMLElement, rowId: string, propertyId: string): void => {
  cell(root, rowId, propertyId).click();
  if (editor() !== null) {
    press(editorField(), 'Escape');
  }
};

describe('DatabaseTableView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    // A drop leaves a one-tick click swallow on the document; let it lapse.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('keeps the selected title cell fill handle when its title is repainted', () => {
    const { root, view } = mount();

    selectCell(root, 'r1', 'p-title');
    const handle = cell(root, 'r1', 'p-title').querySelector('[data-blok-database-table-fill-handle]');

    if (handle === null) throw new Error('selected title cell has no fill handle');
    view.updateRowTitle(root, 'r1', 'Renamed');

    expect(cell(root, 'r1', 'p-title').querySelector('[data-blok-database-table-fill-handle]')).toBe(handle);
    expect(cell(root, 'r1', 'p-title').textContent).toContain('Renamed');
    view.destroy();
  });

  describe('layout', () => {
    it('draws each header with the icon the property type menu uses', () => {
      const types = ['status', 'email', 'phone', 'person', 'files', 'createdTime', 'lastEditedTime', 'createdBy', 'lastEditedBy', 'uniqueId'] as const;
      const { root } = mount({
        schema: [schema[0], ...types.map((type, i): PropertyDefinition => ({ id: `p-${type}`, name: type, type, position: `b${i}` }))],
      });
      const iconOf = (propertyId: string): string | undefined =>
        root.querySelector(`[role="columnheader"][data-property-id="${propertyId}"] [data-blok-database-table-column-icon]`)?.innerHTML;
      const expected = document.createElement('span');

      for (const type of types) {
        expected.innerHTML = PROPERTY_TYPE_META[type].icon;
        expect(iconOf(`p-${type}`)).toBe(expected.innerHTML);
      }
    });

    it('draws a property\'s own icon in its header instead of the type icon (research/04, R-2022-11-17)', () => {
      const { root } = mount({ schema: [schema[0], { id: 'p-mood', name: 'Mood', type: 'text', position: 'b0', icon: '🙂' }] });
      const icon = root.querySelector('[role="columnheader"][data-property-id="p-mood"] [data-blok-database-table-column-icon]');

      expect(icon?.textContent).toBe('🙂');
      expect(icon?.querySelector('svg')).toBeNull();
    });

    describe('property description (research/30 X2)', () => {
      const described: PropertyDefinition[] = [schema[0], { ...schema[1], description: 'What we noted' }, schema[2]];
      const header = (root: HTMLElement, id: string): HTMLElement => {
        const el = root.querySelector<HTMLElement>(`[role="columnheader"][data-property-id="${id}"]`);

        if (el === null) throw new Error(`no header ${id}`);

        return el;
      };
      const shownHint = (): { text: string; placement: string | null } | null => {
        const wrapper = document.querySelector('[data-blok-testid="tooltip"]');

        return wrapper?.getAttribute('data-blok-shown') === 'true'
          ? { text: document.querySelector('[data-blok-testid="tooltip-content"]')?.textContent ?? '', placement: wrapper.getAttribute('data-blok-placement') }
          : null;
      };

      beforeEach(() => {
        destroyTooltip();
        vi.useFakeTimers();
      });

      afterEach(() => {
        destroyTooltip();
        vi.useRealTimers();
      });

      it('draws the info icon after the name only when the property has a description', () => {
        const { root } = mount({ schema: described });
        const button = header(root, 'p-notes').querySelector('[data-blok-database-table-column-button]');
        const icon = header(root, 'p-notes').querySelector<HTMLElement>('[data-blok-database-table-column-description]');
        const expected = document.createElement('span');

        expected.innerHTML = IconInfo;
        expect(icon?.innerHTML).toBe(expected.innerHTML);
        expect(icon?.previousElementSibling?.hasAttribute('data-blok-database-table-column-name')).toBe(true);
        expect(icon?.parentElement).toBe(button);
        // Size and ink come from the type icon's rule.
        expect(icon?.hasAttribute('data-blok-database-table-column-icon')).toBe(true);
        // The description must not join the header's name.
        expect(icon?.getAttribute('aria-hidden')).toBe('true');
        expect(header(root, 'p-notes').getAttribute('aria-description')).toBe('What we noted');
        expect(header(root, 'p-amount').querySelector('[data-blok-database-table-column-description]')).toBeNull();
        expect(header(root, 'p-amount').hasAttribute('aria-description')).toBe(false);
      });

      // research/31 §1: the whole header cell carries one hint: the name, then the description in grey.
      it('hovering anywhere on the header shows the name and the description above it, after the hint delay', () => {
        const { root } = mount({ schema: described });
        const cellEl = header(root, 'p-notes');

        // jsdom lays out nothing; room above the header keeps the hint on top.
        vi.spyOn(cellEl, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 100, y: 300, width: 200, height: 33 }));
        cellEl.dispatchEvent(new FocusEvent('focus'));
        vi.advanceTimersByTime(HINT_DELAY);
        expect(shownHint()).toBeNull();

        cellEl.dispatchEvent(new MouseEvent('mouseenter'));
        vi.advanceTimersByTime(HINT_DELAY - 1);
        expect(shownHint()).toBeNull();
        vi.advanceTimersByTime(1);
        expect(shownHint()).toEqual({ text: 'NotesWhat we noted', placement: 'top' });

        const hint = document.querySelector<HTMLElement>('[data-blok-database-header-hint]');
        const lines = hint?.querySelector<HTMLElement>('[data-blok-database-header-hint-text]');
        const [nameLine, descriptionLine] = [...(lines?.children ?? [])].map((el) => el instanceof HTMLElement ? el : null);

        expect(nameLine?.textContent).toBe('Notes');
        expect(nameLine?.style.color).toBe('');
        expect(descriptionLine?.textContent).toBe('What we noted');
        expect(descriptionLine?.style.color).toBe(TOOLTIP_MUTED_INK);
        expect(descriptionLine?.style.whiteSpace).toBe('pre-line');
        expect(hint?.style.padding).toBe('5px 8px');
        expect([hint?.style.fontWeight, hint?.style.lineHeight, hint?.style.textAlign]).toEqual(['400', '16.8px', 'start']);
        expect(lines?.style.maxWidth).toBe('280px');
        expect(lines?.style.width).toBe('max-content');
        expect(lines?.style.overflowWrap).toBe('break-word');
        // Left edges aligned, 6px above the header.
        const wrapper = document.querySelector<HTMLElement>('[data-blok-testid="tooltip"]');

        expect(wrapper?.style.left).toBe('100px');
      });

      it('the (i) has no hint of its own', () => {
        const { root } = mount({ schema: described });
        const icon = header(root, 'p-notes').querySelector<HTMLElement>('[data-blok-database-table-column-description]');

        if (icon === null) throw new Error('no description icon');
        vi.spyOn(icon, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 100, y: 300, width: 16, height: 16 }));
        icon.dispatchEvent(new MouseEvent('mouseenter'));
        vi.advanceTimersByTime(HINT_DELAY);
        expect(shownHint()).toBeNull();
      });

      // research/33 §1: 4 headers, 2 points each, 3s: no hint.
      it('a header without a description shows no hint, but keeps its name', () => {
        const { root } = mount({ schema: described });
        const cellEl = header(root, 'p-amount');

        vi.spyOn(cellEl, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 100, y: 300, width: 200, height: 33 }));
        cellEl.dispatchEvent(new MouseEvent('mouseenter'));
        vi.advanceTimersByTime(3000);
        expect(shownHint()).toBeNull();
        expect(cellEl.getAttribute('role')).toBe('columnheader');
        expect(cellEl.textContent?.trim()).toBe('Amount');
      });
    });

    it('renders a grid whose keyboard belongs to the table', () => {
      const { root } = mount();

      expect(root.hasAttribute('data-blok-database-table')).toBe(true);
      expect(grid(root).hasAttribute('data-blok-keyboard-owner')).toBe(true);
      expect(grid(root).getAttribute('aria-rowcount')).toBe('4');
    });

    it('draws one column header per visible property, title first, in view order', () => {
      const view = tableView({ properties: [
        { id: 'p-title', visible: true }, { id: 'p-stage', visible: true }, { id: 'p-notes', visible: false },
        { id: 'p-amount', visible: true }, { id: 'p-done', visible: true },
      ] });
      const { root } = mount({ view });
      const headers = [...root.querySelectorAll('[role="columnheader"]')].map((el) => el.getAttribute('data-property-id'));

      expect(headers).toEqual(['p-title', 'p-stage', 'p-amount', 'p-done']);
    });

    it('draws one row per row with a gridcell per column and keeps data-row-id', () => {
      const { root } = mount();
      const rowEls = [...root.querySelectorAll('[data-blok-database-table-row]')];

      expect(rowEls.map((el) => el.getAttribute('data-row-id'))).toEqual(['r1', 'r2', 'r3']);
      expect(rowEls.every((el) => el.getAttribute('role') === 'row')).toBe(true);
      expect(rowEls[0].querySelectorAll('[role="gridcell"]')).toHaveLength(5);
      expect(cell(root, 'r1', 'p-stage').textContent).toBe('Idea');
    });

    it('sizes columns from the view, 280 for the title and 200 for the rest by default', () => {
      const view = tableView({ properties: [{ id: 'p-title', visible: true }, { id: 'p-notes', visible: true, width: 123 }] });
      const { root } = mount({ view });
      const header = (id: string): HTMLElement | null => root.querySelector<HTMLElement>(`[role="columnheader"][data-property-id="${id}"]`);

      expect(header('p-title')?.style.width).toBe('280px');
      expect(header('p-notes')?.style.width).toBe('123px');
      expect(header('p-amount')?.style.width).toBe('200px');
      expect(cell(root, 'r1', 'p-notes').style.width).toBe('123px');
    });

    it('marks wrapped columns and hides vertical lines when the view says so', () => {
      const view = tableView({ showVerticalLines: false, properties: [{ id: 'p-title', visible: true }, { id: 'p-notes', visible: true, wrap: true }, { id: 'p-amount', visible: true, wrap: false }] });
      const { root } = mount({ view });

      expect(cell(root, 'r1', 'p-notes').hasAttribute('data-wrap')).toBe(true);
      expect(cell(root, 'r1', 'p-amount').hasAttribute('data-wrap')).toBe(false);
      expect(grid(root).getAttribute('data-vertical-lines')).toBe('false');
    });

    it('draws a page glyph before a title that has no icon (Notion pageEmpty)', () => {
      const { root } = mount({ rows: [{ ...row('r1', 'Alpha'), icon: '🥌' }, row('r2', 'Bravo')] });
      const plain = cell(root, 'r2', 'p-title');
      const glyph = plain.querySelector<HTMLElement>('[data-blok-database-page-icon-placeholder]');

      expect(glyph?.querySelector('svg')).not.toBeNull();
      expect(glyph?.getAttribute('aria-hidden')).toBe('true');
      expect(glyph?.nextElementSibling?.hasAttribute('data-blok-database-cell')).toBe(true);
      expect(plain.querySelector('[data-blok-database-page-icon]')).toBeNull();
      expect(cell(root, 'r1', 'p-title').querySelector('[data-blok-database-page-icon]')?.textContent).toBe('🥌');
      expect(cell(root, 'r1', 'p-title').querySelector('[data-blok-database-page-icon-placeholder]')).toBeNull();
    });

    it('hides the page glyph when "Show page icon" is off', () => {
      const { root } = mount({ view: tableView({ showPageIcon: false }) });

      expect(cell(root, 'r1', 'p-title').querySelector('[data-blok-database-page-icon-placeholder]')).toBeNull();
    });

    it('keeps the page glyph when the title is edited in place', () => {
      const { root, view } = mount();

      view.updateRowTitle(root, 'r1', 'Renamed');
      expect(cell(root, 'r1', 'p-title').querySelector('[data-blok-database-page-icon-placeholder]')).not.toBeNull();
      expect(cell(root, 'r1', 'p-title').textContent).toContain('Renamed');
    });

    it('labels the header "+" as "Add property" while the title is the only property (Notion empty database)', () => {
      const lone = mount({ schema: [schema[0]] }).root.querySelector<HTMLElement>('[data-blok-database-table-add-property]');
      const full = mount().root.querySelector<HTMLElement>('[data-blok-database-table-add-property]');

      expect(lone?.textContent?.trim()).toBe('tools.database.tableAddProperty');
      expect(lone?.hasAttribute('data-labelled')).toBe(true);
      expect(lone?.querySelector('svg')).not.toBeNull();
      expect(full?.textContent?.trim()).toBe('');
      expect(full?.hasAttribute('data-labelled')).toBe(false);
      expect(full?.getAttribute('aria-label')).toBe('tools.database.tableAddProperty');
    });

    it('puts a page glyph before each file name in a files cell (Notion pageEmpty, research/08:278)', () => {
      const files: PropertyDefinition = { id: 'p-files', name: 'Files', type: 'files', position: 'a1' };
      const { root } = mount({
        schema: [schema[0], files],
        rows: [row('r1', 'Alpha', { 'p-files': [{ id: 'f1', name: 'report.pdf', url: 'https://example.com/report.pdf' }, { id: 'f2', name: 'b.png', url: 'https://example.com/b.png' }] })],
      });
      const chips = [...cell(root, 'r1', 'p-files').querySelectorAll<HTMLElement>('[data-blok-database-file-chip]')];

      expect(chips).toHaveLength(2);
      chips.forEach((chip) => {
        const icon = chip.firstElementChild;

        expect(icon?.hasAttribute('data-blok-database-file-chip-icon')).toBe(true);
        expect(icon?.getAttribute('aria-hidden')).toBe('true');
        expect(icon?.querySelector('svg')).not.toBeNull();
      });
      expect(chips[0].textContent?.trim()).toBe('report.pdf');
    });

    // notion-spec-2 §20.11, files-hover.png: the chip shows a dark hint with the full link, not Blok's link card.
    it('hovering a file chip shows its full link in a hint after the hint delay, and keeps the link card away', () => {
      destroyTooltip();
      vi.useFakeTimers();
      try {
        const files: PropertyDefinition = { id: 'p-files', name: 'Files', type: 'files', position: 'a1' };
        const { root } = mount({
          schema: [schema[0], files],
          rows: [row('r1', 'Alpha', { 'p-files': [{ id: 'f1', name: 'report.pdf', url: 'https://example.com/report.pdf' }] })],
        });
        const chip = cell(root, 'r1', 'p-files').querySelector<HTMLElement>('[data-blok-database-file-chip]');
        const link = chip?.querySelector<HTMLElement>('[data-blok-database-cell-link]');

        if (chip === null || chip === undefined || link === null || link === undefined) throw new Error('no file chip');
        // Core's link hover card and link click skip a link inside a link owner.
        expect(link.closest('[data-blok-link-owner]')).not.toBeNull();

        vi.spyOn(chip, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 100, y: 300, width: 184, height: 24 }));
        chip.dispatchEvent(new MouseEvent('mouseenter'));
        vi.advanceTimersByTime(HINT_DELAY - 1);
        const wrapper = (): Element | null => document.querySelector('[data-blok-testid="tooltip"]');

        expect(wrapper()?.getAttribute('data-blok-shown')).not.toBe('true');
        vi.advanceTimersByTime(1);
        expect(wrapper()?.getAttribute('data-blok-shown')).toBe('true');
        expect(document.querySelector('[data-blok-testid="tooltip-content"]')?.textContent).toBe('https://example.com/report.pdf');
      } finally {
        destroyTooltip();
        vi.useRealTimers();
      }
    });

    it('wraps no column of a view saved with no wrap fields (notion-spec-2 §21.1)', () => {
      const { root } = mount({ view: tableView({ visibleProperties: ['p-title', 'p-notes', 'p-amount'] }) });

      expect(cell(root, 'r1', 'p-title').hasAttribute('data-wrap')).toBe(false);
      expect(cell(root, 'r1', 'p-notes').hasAttribute('data-wrap')).toBe(false);
      expect(cell(root, 'r1', 'p-amount').hasAttribute('data-wrap')).toBe(false);
    });

    it('offers "Wrap content" on a default column, and it writes wrap true', () => {
      const { view, handlers, root } = mount();
      const items = view.headerItems('p-notes', root.querySelector<HTMLElement>('[role="columnheader"][data-property-id="p-notes"]') ?? root) as Array<{ title?: string; onActivate?: () => void }>;

      expect(items.some((item) => item.title === 'tools.database.tableUnwrap')).toBe(false);
      items.find((item) => item.title === 'tools.database.tableWrap')?.onActivate?.();
      expect(vi.mocked(handlers.updateView).mock.lastCall?.[0].properties?.find((p) => p.id === 'p-notes')?.wrap).toBe(true);
    });

    it('freezes the first columns at their running offset', () => {
      const view = tableView({ frozenColumnCount: 2, properties: [{ id: 'p-title', visible: true, width: 250 }, { id: 'p-notes', visible: true, width: 100 }] });
      const { root } = mount({ view });

      expect(cell(root, 'r1', 'p-title').hasAttribute('data-frozen')).toBe(true);
      expect(cell(root, 'r1', 'p-title').style.insetInlineStart).toBe('0px');
      expect(cell(root, 'r1', 'p-notes').style.insetInlineStart).toBe('250px');
      expect(cell(root, 'r1', 'p-amount').hasAttribute('data-frozen')).toBe(false);
    });

    it('right-aligns number cells', () => {
      const { root } = mount();

      expect(cell(root, 'r1', 'p-amount').getAttribute('data-type')).toBe('number');
    });

    it('shows the load limit and a Load more button that raises it', () => {
      const many = Array.from({ length: 12 }, (_, i) => row(`r${String(i).padStart(2, '0')}`, `Row ${i}`));
      const { root, state, handlers } = mount({ rows: many, view: tableView({ loadLimit: 10 }) });

      expect(root.querySelectorAll('[data-blok-database-table-row]')).toHaveLength(10);
      root.querySelector<HTMLElement>('[data-blok-database-table-load-more]')?.click();

      expect(state.loaded.get('')).toBe(20);
      expect(handlers.rerender).toHaveBeenCalled();
    });

    it('shows Edit filters and New page when filters hide every row', () => {
      const { root, handlers } = mount({ rows: [], view: tableView({ filters: [{ propertyId: 'p-amount', operator: 'is_not_empty', value: null }] }) });
      const empty = root.querySelector<HTMLElement>('[data-blok-database-table-empty]');

      expect(empty).not.toBeNull();
      empty?.querySelector<HTMLElement>('[data-blok-database-table-edit-filters]')?.click();
      expect(handlers.editFilters).toHaveBeenCalled();
    });

    it('shows Clear search and New page when a search matches no row (Notion, findings V29)', () => {
      const clearSearch = vi.fn();
      const { root } = mount({ rows: [], handlers: { ...makeHandlers(), searching: () => true, clearSearch } });
      const empty = root.querySelector<HTMLElement>('[data-blok-database-table-empty]');
      const clear = empty?.querySelector<HTMLElement>('[data-blok-database-table-clear-search]');

      expect(clear?.textContent).toBe('tools.database.searchClear');
      expect(empty?.querySelector('[data-blok-database-table-edit-filters]')).toBeNull();
      expect(empty?.querySelector('[data-blok-database-table-add-row]')).not.toBeNull();
      clear?.click();
      expect(clearSearch).toHaveBeenCalled();
    });

    it('draws "+ New page" and two blank grid lines on a database with no rows (Notion empty table)', () => {
      const { root } = mount({ rows: [] });
      const lines = [...root.querySelectorAll<HTMLElement>('[data-blok-database-table-blank-row]')];

      expect(lines).toHaveLength(3);
      expect(lines[0].querySelector('[data-blok-database-table-add-row]')).not.toBeNull();
      expect(root.querySelectorAll('[data-blok-database-table-add-row]')).toHaveLength(1);
      lines.forEach((line) => {
        const cells = [...line.querySelectorAll<HTMLElement>('[data-blok-database-table-blank-cell]')];

        expect(cells.map((c) => c.style.width)).toEqual(['280px', '200px', '200px', '200px', '200px']);
        expect(line.querySelectorAll('[role]')).toHaveLength(0);
      });
      expect(lines[1].getAttribute('aria-hidden')).toBe('true');
      expect(lines[0].hasAttribute('aria-hidden')).toBe(false);
      expect(grid(root).querySelectorAll('[data-blok-database-table-row]')).toHaveLength(0);
    });

    it('draws no blank lines once a row exists, or when filters hide every row', () => {
      expect(mount().root.querySelector('[data-blok-database-table-blank-row]')).toBeNull();
      expect(mount({ rows: [], view: tableView({ filters: [{ propertyId: 'p-amount', operator: 'is_not_empty', value: null }] }) })
        .root.querySelector('[data-blok-database-table-blank-row]')).toBeNull();
    });

    it('draws the blank lines without "+ New page" when read-only', () => {
      const { root } = mount({ rows: [], readOnly: true });

      expect(root.querySelectorAll('[data-blok-database-table-blank-row]')).toHaveLength(2);
      expect(root.querySelector('[data-blok-database-table-add-row]')).toBeNull();
    });

    it('shows a count over 99 as 99+ when the column caps counts', () => {
      const many = Array.from({ length: 120 }, (_, i) => row(`r${String(i).padStart(3, '1')}`, `Row ${i}`));
      const { root } = mount({ rows: many, view: tableView({ calculations: [{ id: 'p-notes', fn: 'count', capCounts: true }, { id: 'p-title', fn: 'count' }] }) });
      const value = (id: string): string | null | undefined =>
        root.querySelector(`[data-blok-database-table-calc][data-property-id="${id}"] [data-blok-database-table-calc-value]`)?.textContent;

      expect(value('p-notes')).toBe('99+');
      expect(value('p-title')).toBe('120');
    });

    // Unverified: Notion's footer format was not recorded. Blok shows the column's own number format.
    it('formats a number calculation with the column number format', () => {
      const dollars = schema.map((p) => (p.id === 'p-amount' ? { ...p, number: { format: 'dollar' as const } } : p));
      const { root } = mount({ schema: dollars, view: tableView({ calculations: [{ id: 'p-amount', fn: 'sum' }, { id: 'p-notes', fn: 'count' }] }), locale: 'en-US' });
      const value = (id: string): string | null | undefined =>
        root.querySelector(`[data-blok-database-table-calc][data-property-id="${id}"] [data-blok-database-table-calc-value]`)?.textContent;

      expect(value('p-amount')).toBe('$1,235.50');
      expect(value('p-notes')).toBe('3');
    });

    it('renders a calculation footer and leaves empty footer cells marked', () => {
      const view = tableView({ calculations: [{ id: 'p-amount', fn: 'sum' }] });
      const { root } = mount({ view });
      const footerCell = (id: string): HTMLElement | null => root.querySelector<HTMLElement>(`[data-blok-database-table-calc][data-property-id="${id}"]`);

      expect(footerCell('p-amount')?.querySelector('[data-blok-database-table-calc-value]')?.textContent).toBe('1235.5');
      expect(footerCell('p-amount')?.querySelector('[data-blok-database-table-calc-label]')?.textContent).toBe('tools.database.calcSum');
      expect(footerCell('p-notes')?.hasAttribute('data-empty')).toBe(true);
    });

    it('read-only: no gutter, no new page row, no editor on click', () => {
      const { root } = mount({ readOnly: true });

      expect(root.querySelector('[data-blok-database-table-gutter]')).toBeNull();
      expect(root.querySelector('[data-blok-database-table-add-row]')).toBeNull();
      cell(root, 'r1', 'p-notes').click();
      expect(editor()).toBeNull();
    });
  });

  describe('cell keyboard model', () => {
    it('a click opens the cell editor at once and selects the cell', () => {
      const { root, state } = mount();

      cell(root, 'r1', 'p-notes').click();

      expect(editorField().value).toBe('short');
      expect(state.editing).toBe(true);
      expect(anchorCell(root)).toBe('r1/p-notes');
    });

    it('a click on a checkbox cell toggles it', () => {
      const { root, handlers } = mount();

      cell(root, 'r2', 'p-done').click();

      expect(handlers.commitCell).toHaveBeenCalledWith('r2', 'p-done', false);
    });

    it('Escape closes the editor and selects the cell; a second Escape selects the row; a third clears', () => {
      const { root, handlers } = mount();

      cell(root, 'r1', 'p-notes').click();
      press(editorField(), 'Escape');

      expect(editor()).toBeNull();
      expect(handlers.editEnded).toHaveBeenCalled();
      expect(selectedCells(root)).toEqual(['r1/p-notes']);

      press(grid(root), 'Escape');
      expect(selectedCells(root)).toEqual([]);
      expect(root.querySelector('[data-row-id="r1"]')?.getAttribute('aria-selected')).toBe('true');
      expect(root.querySelector('[data-blok-database-table-selection-count]')?.textContent).toBe('tools.database.tableSelectedCount:1');

      press(grid(root), 'Escape');
      expect(root.querySelector('[data-row-id="r1"]')?.getAttribute('aria-selected')).toBe('false');
      expect(root.querySelector('[data-blok-database-table-selection-bar]')).toBeNull();
    });

    // notion-spec-2 §19.4: Tab saves, closes and selects the cell to the right, no editor open.
    it('Tab in a cell editor saves, closes and selects the cell to the right', () => {
      const { root, handlers } = mount();

      cell(root, 'r1', 'p-notes').click();
      editorField().value = 'typed';
      editorField().dispatchEvent(new Event('input', { bubbles: true }));
      const event = press(editorField(), 'Tab');

      expect(selectedCells(root)).toEqual(['r1/p-amount']);
      expect(event.defaultPrevented).toBe(true);
      expect(editor()).toBeNull();
      expect(handlers.commitCell).toHaveBeenCalledWith('r1', 'p-notes', 'typed');
      expect(grid(root)).toHaveFocus();
    });

    it('Tab in a Number cell editor saves and selects the cell to the right', () => {
      const { root, handlers } = mount();

      cell(root, 'r2', 'p-amount').click();
      editorField().value = '42';
      press(editorField(), 'Tab');

      expect(selectedCells(root)).toEqual(['r2/p-stage']);
      expect(editor()).toBeNull();
      expect(handlers.commitCell).toHaveBeenCalledWith('r2', 'p-amount', 42);
    });

    // Shift+Tab is not measured in Notion: it mirrors Tab.
    it('Shift+Tab in a cell editor saves and selects the cell to the left', () => {
      const { root } = mount();

      cell(root, 'r1', 'p-notes').click();
      press(editorField(), 'Tab', { shiftKey: true });

      expect(selectedCells(root)).toEqual(['r1/p-title']);
      expect(editor()).toBeNull();
    });

    // feel/findings-table T13: Notion's bar shows the first 4 properties; the rest wait under "…".
    it('shows glyph segments for the first 4 properties and keeps the rest under "…"', () => {
      const extra = ['Owner', 'Due', 'Link'].map((name, i): PropertyDefinition => ({ id: `p-x${i}`, name, type: 'text', position: `b${i}` }));
      const { root } = mount({ schema: [...schema, ...extra] });

      root.querySelector<HTMLElement>('[data-blok-database-table-select-all]')?.click();
      const segments = [...root.querySelectorAll<HTMLElement>('[data-blok-database-table-selection-property]')];

      expect(segments.map((b) => b.getAttribute('data-property-id'))).toEqual(['p-notes', 'p-amount', 'p-stage', 'p-done']);
      expect(segments.every((b) => b.querySelector('svg') !== null)).toBe(true);

      root.querySelector<HTMLElement>('[data-blok-database-table-selection-more]')?.click();
      const more = document.querySelector<HTMLElement>('[data-blok-item-name="database-table-selection-edit-p-x2"]');

      expect(more).not.toBeNull();
      more?.click();
      expect(document.querySelector('[data-blok-database-cell-input]')).not.toBeNull();
    });

    it('puts the selection bar in the toolbar row slot and marks the slot while rows are selected', () => {
      const slot = document.createElement('div');

      document.body.appendChild(slot);
      const { root, view } = mount({ selectionBarSlot: () => slot });

      cell(root, 'r1', 'p-notes').click();
      press(editorField(), 'Escape');
      press(grid(root), 'Escape');

      expect(slot.querySelector('[data-blok-database-table-selection-bar]')).not.toBeNull();
      expect(root.querySelector('[data-blok-database-table-selection-bar]')).toBeNull();
      expect(slot.hasAttribute('data-blok-database-selecting')).toBe(true);
      // Only the table's capped bar leaves the toolbar showing (database.css).
      expect(slot.getAttribute('data-blok-database-selecting')).toBe('table');

      press(grid(root), 'Escape');
      expect(slot.querySelector('[data-blok-database-table-selection-bar]')).toBeNull();
      expect(slot.hasAttribute('data-blok-database-selecting')).toBe(false);

      cell(root, 'r1', 'p-notes').click();
      press(editorField(), 'Escape');
      press(grid(root), 'Escape');
      view.destroy();

      expect(slot.querySelector('[data-blok-database-table-selection-bar]')).toBeNull();
      expect(slot.hasAttribute('data-blok-database-selecting')).toBe(false);
    });

    it('arrows move the selected cell and stop at the edges', () => {
      const { root } = mount();

      selectCell(root, 'r2', 'p-amount');
      press(grid(root), 'ArrowDown');
      expect(anchorCell(root)).toBe('r3/p-amount');
      press(grid(root), 'ArrowDown');
      expect(anchorCell(root)).toBe('r3/p-amount');
      press(grid(root), 'ArrowRight');
      expect(anchorCell(root)).toBe('r3/p-stage');
      press(grid(root), 'ArrowUp');
      expect(anchorCell(root)).toBe('r2/p-stage');
      press(grid(root), 'ArrowLeft');
      expect(anchorCell(root)).toBe('r2/p-amount');
    });

    it('keeps Home, End and Space on a checkbox from scrolling the page, and Space leaves the box alone (findings K07)', () => {
      const { root, handlers } = mount();

      selectCell(root, 'r1', 'p-amount');
      press(grid(root), 'ArrowRight');
      press(grid(root), 'ArrowRight');
      expect(anchorCell(root)).toBe('r1/p-done');

      expect(press(grid(root), 'Home').defaultPrevented).toBe(true);
      expect(press(grid(root), 'End').defaultPrevented).toBe(true);
      expect(press(grid(root), ' ').defaultPrevented).toBe(true);
      expect(anchorCell(root)).toBe('r1/p-done');
      expect(handlers.commitCell).not.toHaveBeenCalled();
      expect(editor()).toBeNull();
    });

    it('Tab moves right; Shift+Tab extends the range left and keeps the anchor', () => {
      const { root } = mount();

      selectCell(root, 'r1', 'p-amount');
      press(grid(root), 'Tab');
      expect(anchorCell(root)).toBe('r1/p-stage');
      press(grid(root), 'Tab', { shiftKey: true });
      expect(anchorCell(root)).toBe('r1/p-stage');
      expect(selectedCells(root)).toEqual(['r1/p-amount', 'r1/p-stage']);
    });

    it('Enter opens the editor; Enter in the editor commits and moves down', () => {
      const { root, handlers } = mount();

      selectCell(root, 'r1', 'p-notes');
      press(grid(root), 'Enter');
      editorField().value = 'longer';
      press(editorField(), 'Enter');

      expect(handlers.commitCell).toHaveBeenCalledWith('r1', 'p-notes', 'longer');
      expect(editor()).toBeNull();
      expect(anchorCell(root)).toBe('r2/p-notes');
    });

    it('Tab in the last row still moves right along the row', () => {
      const { root } = mount();

      selectCell(root, 'r3', 'p-amount');
      press(grid(root), 'Tab');
      expect(anchorCell(root)).toBe('r3/p-stage');
    });

    it('Enter in an editor in the last row commits and keeps the same cell selected, with no new row', () => {
      const { root, handlers } = mount();

      selectCell(root, 'r3', 'p-notes');
      press(grid(root), 'Enter');
      editorField().value = 'end';
      press(editorField(), 'Enter');

      expect(handlers.commitCell).toHaveBeenCalledWith('r3', 'p-notes', 'end');
      expect(anchorCell(root)).toBe('r3/p-notes');
      expect(handlers.addRow).not.toHaveBeenCalled();
    });

    it('a press on another cell while editing keeps the table until the click opens that cell', async () => {
      const handlers = makeHandlers();
      const state = createTableState();
      let current = mount({ handlers, state });

      // The tool's rule: redraw on editEnded unless the table says it is busy.
      vi.mocked(handlers.editEnded).mockImplementation(() => {
        if (!current.view.interacting) {
          current.view.destroy();
          current.root.remove();
          current = mount({ handlers, state });
        }
      });

      cell(current.root, 'r1', 'p-notes').click();
      editorField().value = 'first';

      const pressed = cell(current.root, 'r2', 'p-notes');

      pressed.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));

      expect(pressed.isConnected).toBe(true);
      expect(handlers.commitCell).toHaveBeenCalledWith('r1', 'p-notes', 'first');

      pressed.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
      pressed.click();
      // The closed editor's popover is destroyed in a microtask.
      await Promise.resolve();

      expect(document.querySelectorAll('[data-blok-database-cell-editor]')).toHaveLength(1);
      expect(editorField().value).toBe('');
      expect(anchorCell(current.root)).toBe('r2/p-notes');
    });

    it('Enter in an editor on the last row commits and stays', () => {
      const { root } = mount();

      cell(root, 'r3', 'p-notes').click();
      editorField().value = 'x';
      press(editorField(), 'Enter');

      expect(anchorCell(root)).toBe('r3/p-notes');
    });

    it.each(['Z', ' '])('typing %j opens the editor with that character replacing the value', (key) => {
      const { root, view } = mount();

      try {
        selectCell(root, 'r1', 'p-notes');
        press(grid(root), key, { isComposing: false });

        expect(editorField().value).toBe(key);
      } finally {
        view.destroy();
      }
    });

    it('Backspace clears the selected cell and keeps the selection', () => {
      const { root, handlers } = mount();

      selectCell(root, 'r1', 'p-amount');
      press(grid(root), 'Backspace');

      expect(handlers.commitCell).toHaveBeenCalledWith('r1', 'p-amount', null);
      expect(anchorCell(root)).toBe('r1/p-amount');
    });

    it.each<[PropertyType, PropertyValue, PropertyValue]>([
      ['status', 'o-1', null],
      ['email', 'a@b.co', ''],
      ['phone', '+1 555', ''],
      ['person', [{ id: 'u-1' }], []],
      ['files', [{ id: 'f-1', name: 'a.png', url: 'https://x.test/a.png' }], []],
    ])('Backspace clears a %s cell to its empty value', (type, value, empty) => {
      const { root, handlers } = mount({
        schema: [schema[0], { id: 'p-x', name: 'X', type, position: 'b0' }],
        rows: [row('r1', 'Alpha', { 'p-x': structuredClone(value) })],
      });

      cell(root, 'r1', 'p-x').click();
      // Not every editor has a text field; Escape closes any of them back to the cell.
      press(document.activeElement ?? document.body, 'Escape');
      expect(editor()).toBeNull();
      press(grid(root), 'Backspace');

      expect(handlers.commitCell).toHaveBeenCalledWith('r1', 'p-x', empty);
    });

    it.each(['uniqueId', 'createdTime', 'lastEditedTime', 'createdBy', 'lastEditedBy'] as const)('Backspace never writes a read-only %s cell', (type) => {
      const { root, handlers } = mount({
        schema: [schema[0], { id: 'p-x', name: 'X', type, position: 'b0' }],
        rows: [row('r1', 'Alpha', { 'p-x': 7 })],
      });

      selectCell(root, 'r1', 'p-x');
      press(grid(root), 'Backspace');

      expect(handlers.commitCell).not.toHaveBeenCalled();
    });

    // notion-spec-2 §18.3: a click on a formula cell opens "Edit formula".
    describe('a click on a formula cell', () => {
      const formulaSchema: PropertyDefinition[] = [schema[0], { id: 'p-fx', name: 'Fx', type: 'formula', position: 'b0', formula: { expression: '1 + 1' } }];
      const withEditFormula = (): TableHandlers => ({ ...makeHandlers(), editFormula: vi.fn() });

      it('opens the formula editor at the cell', () => {
        const { root, handlers } = mount({ schema: formulaSchema, rows: [row('r1', 'Alpha')], handlers: withEditFormula() });

        cell(root, 'r1', 'p-fx').click();

        expect(handlers.editFormula).toHaveBeenCalledTimes(1);
        expect(handlers.editFormula).toHaveBeenCalledWith('p-fx', cell(root, 'r1', 'p-fx'));
      });

      it('opens nothing for a reader', () => {
        const { root, handlers } = mount({ readOnly: true, schema: formulaSchema, rows: [row('r1', 'Alpha')], handlers: withEditFormula() });

        cell(root, 'r1', 'p-fx').click();

        expect(handlers.editFormula).not.toHaveBeenCalled();
      });

      it('leaves an ID cell opening nothing', () => {
        const { root, handlers } = mount({
          schema: [...formulaSchema, { id: 'p-id', name: 'ID', type: 'uniqueId', position: 'b1' }],
          rows: [row('r1', 'Alpha', { 'p-id': 7 })],
          handlers: withEditFormula(),
        });

        cell(root, 'r1', 'p-id').click();

        expect(handlers.editFormula).not.toHaveBeenCalled();
        expect(editor()).toBeNull();
      });

      it('copies, not edits, from the hover Copy button', () => {
        const { root, handlers } = mount({ schema: formulaSchema, rows: [{ ...row('r1', 'Alpha'), computed: { 'p-fx': 2 } }], handlers: withEditFormula() });

        cell(root, 'r1', 'p-fx').querySelector<HTMLElement>('[data-blok-database-table-cell-action="copy"]')?.click();

        expect(cell(root, 'r1', 'p-fx').querySelector('[data-blok-database-table-cell-action="copy"]')).not.toBeNull();
        expect(handlers.editFormula).not.toHaveBeenCalled();
      });
    });

    // notion-spec-2 §19.6: arrows select an ID cell; Enter and typing there do nothing.
    it.each(['Enter', 'a', '5'])('%s on an ID cell reached by the arrows opens nothing and leaves the table free to redraw', (key) => {
      const { root, handlers, view } = mount({
        schema: [schema[0], { id: 'p-id', name: 'ID', type: 'uniqueId', position: 'b0' }],
        rows: [row('r1', 'Alpha', { 'p-id': 7 })],
      });

      selectCell(root, 'r1', 'p-title');
      press(grid(root), 'ArrowRight');
      press(grid(root), key);

      expect(view.interacting).toBe(false);
      expect(selectedCells(root)).toEqual(['r1/p-id']);
      expect(editor()).toBeNull();
      expect(handlers.openRow).not.toHaveBeenCalled();
      expect(handlers.commitCell).not.toHaveBeenCalled();
    });

    it('Shift+arrows select a rectangle; Escape turns it into a selection of its rows', () => {
      const { root } = mount();

      selectCell(root, 'r1', 'p-notes');
      press(grid(root), 'ArrowDown', { shiftKey: true });
      press(grid(root), 'ArrowRight', { shiftKey: true });

      expect(selectedCells(root).sort()).toEqual(['r1/p-amount', 'r1/p-notes', 'r2/p-amount', 'r2/p-notes']);
      expect(anchorCell(root)).toBe('r1/p-notes');

      press(grid(root), 'Escape');
      expect([...root.querySelectorAll('[data-blok-database-table-row][aria-selected="true"]')].map((el) => el.getAttribute('data-row-id'))).toEqual(['r1', 'r2']);
    });

    it('points aria-activedescendant at the selected cell, so a screen reader follows it', () => {
      const { root } = mount();

      selectCell(root, 'r1', 'p-notes');
      press(grid(root), 'ArrowDown');

      const id = grid(root).getAttribute('aria-activedescendant');

      expect(id).toBeTruthy();
      expect(document.getElementById(id ?? '')).toBe(cell(root, 'r2', 'p-notes'));
    });

    it('keeps the selection across a re-render through the shared state', () => {
      const state = createTableState();
      const first = mount({ state });

      selectCell(first.root, 'r2', 'p-amount');
      first.root.remove();

      const second = mount({ state });

      expect(anchorCell(second.root)).toBe('r2/p-amount');
    });
  });

  describe('cell buttons from the keyboard', () => {
    it.each([
      ['Meta', { metaKey: true }],
      ['Control', { ctrlKey: true }],
    ])('%s+Enter on the selected title cell opens the row page, not the editor', (_name, init) => {
      const { root, handlers } = mount();

      selectCell(root, 'r1', 'p-title');
      const event = press(grid(root), 'Enter', init);

      expect(handlers.openRow).toHaveBeenCalledWith('r1');
      expect(editor()).toBeNull();
      expect(event.defaultPrevented).toBe(true);
    });

    it('Mod+Enter on the selected autofill cell runs autofill for that cell', () => {
      const autofillSchema = schema.map((p) => (p.id === 'p-notes' ? { ...p, autofill: { mode: 'summary' as const } } : p));
      const run = vi.fn();
      const { root } = mount({ schema: autofillSchema, autofill: { filling: () => false, run, open: vi.fn() } });

      selectCell(root, 'r2', 'p-notes');
      press(grid(root), 'Enter', { metaKey: true });

      expect(run).toHaveBeenCalledWith('r2', 'p-notes');
      expect(editor()).toBeNull();
    });

    it('Mod+Enter on a cell with no button still opens its editor', () => {
      const { root } = mount();

      selectCell(root, 'r1', 'p-notes');
      press(grid(root), 'Enter', { ctrlKey: true });

      expect(editorField().value).toBe('short');
    });

    it('Mod+Enter opens the row page in a read-only table', () => {
      const openRow = vi.fn();
      const view = new DatabaseTableView({
        readOnly: true,
        i18n: { t: (key: string) => key } as DatabaseTableViewOptions['i18n'],
        view: tableView(),
        schema,
        rows: rows(),
        titlePropertyId: 'p-title',
        state: createTableState(),
        openRow,
      });
      const root = view.createView();

      document.body.appendChild(root);
      cell(root, 'r2', 'p-title').click();
      press(grid(root), 'Enter', { metaKey: true });

      expect(openRow).toHaveBeenCalledWith('r2');
    });

    it('Mod+Enter on a range does nothing to the buttons', () => {
      const { root, handlers } = mount();

      selectCell(root, 'r1', 'p-title');
      press(grid(root), 'ArrowDown', { shiftKey: true });
      press(grid(root), 'Enter', { metaKey: true });

      expect(handlers.openRow).not.toHaveBeenCalled();
    });

    it('the selected cell names its button and shortcut for a screen reader', () => {
      const { root } = mount();

      selectCell(root, 'r1', 'p-title');
      const title = cell(root, 'r1', 'p-title');
      const describedBy = title.getAttribute('aria-describedby');

      expect(title.getAttribute('aria-keyshortcuts')).toBe('Meta+Enter Control+Enter');
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy ?? '')).toBe(title.querySelector('[data-blok-database-table-open]'));

      press(grid(root), 'ArrowRight');

      expect(title.hasAttribute('aria-keyshortcuts')).toBe(false);
      expect(title.hasAttribute('aria-describedby')).toBe(false);
      expect(cell(root, 'r1', 'p-notes').hasAttribute('aria-keyshortcuts')).toBe(false);
      expect(cell(root, 'r1', 'p-notes').hasAttribute('aria-describedby')).toBe(false);
    });

    it('the description still points at the button after the title repaints', () => {
      const { root, view } = mount();

      selectCell(root, 'r1', 'p-title');
      view.updateRowTitle(root, 'r1', 'Renamed');
      const title = cell(root, 'r1', 'p-title');

      expect(document.getElementById(title.getAttribute('aria-describedby') ?? '')).toBe(title.querySelector('[data-blok-database-table-open]'));
    });
  });

  describe('rows', () => {
    it('the header checkbox selects every row and shows the mixed state when some are selected', () => {
      const { root } = mount();
      const all = root.querySelector<HTMLElement>('[data-blok-database-table-select-all]');

      root.querySelector<HTMLElement>('[data-row-id="r1"] [data-blok-database-table-row-checkbox]')?.click();
      expect(all?.getAttribute('aria-checked')).toBe('mixed');

      all?.click();
      expect(root.querySelectorAll('[data-blok-database-table-row][aria-selected="true"]')).toHaveLength(3);
      expect(all?.getAttribute('aria-checked')).toBe('true');
    });

    it('Cmd/Ctrl+D duplicates the selected rows', () => {
      const { root, handlers } = mount();

      root.querySelector<HTMLElement>('[data-row-id="r2"] [data-blok-database-table-row-checkbox]')?.click();
      press(grid(root), 'd', { metaKey: true });
      press(grid(root), 'd', { ctrlKey: true });

      expect(handlers.duplicateRow).toHaveBeenCalledTimes(2);
      expect(handlers.duplicateRow).toHaveBeenCalledWith('r2');
    });

    it('bulk person editing uses the configured directory for every selected row', () => {
      const { root, handlers } = mount({
        schema: [schema[0], { id: 'p-owner', name: 'Owner', type: 'person', position: 'a1' }],
        cellContext: { people: [{ id: 'sam', name: 'Sam' }] },
      });

      root.querySelector<HTMLElement>('[data-blok-database-table-select-all]')?.click();
      root.querySelector<HTMLElement>('[data-blok-database-table-selection-property][data-property-id="p-owner"]')?.click();
      const option = document.querySelector<HTMLElement>('[data-blok-database-person-option="sam"]');

      expect(option).not.toBeNull();
      option?.click();
      expect(handlers.commitCells).toHaveBeenCalledWith([
        { rowId: 'r1', propertyId: 'p-owner', value: [{ id: 'sam' }] },
        { rowId: 'r2', propertyId: 'p-owner', value: [{ id: 'sam' }] },
        { rowId: 'r3', propertyId: 'p-owner', value: [{ id: 'sam' }] },
      ], [], true);
    });

    it('bulk relation editing uses the configured related rows', () => {
      const { root, handlers } = mount({
        schema: [schema[0], { id: 'p-related', name: 'Related', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'other' } }],
        cellContext: { relationCandidates: () => [{ id: 'linked', title: 'Linked page' }] },
      });

      root.querySelector<HTMLElement>('[data-blok-database-table-select-all]')?.click();
      root.querySelector<HTMLElement>('[data-blok-database-table-selection-property][data-property-id="p-related"]')?.click();
      const option = document.querySelector<HTMLElement>('[data-blok-database-relation-option="linked"]');

      expect(option).not.toBeNull();
      option?.click();
      expect(handlers.commitCells).toHaveBeenCalledWith([
        { rowId: 'r1', propertyId: 'p-related', value: [{ id: 'linked' }] },
        { rowId: 'r2', propertyId: 'p-related', value: [{ id: 'linked' }] },
        { rowId: 'r3', propertyId: 'p-related', value: [{ id: 'linked' }] },
      ], [], true);
    });

    it('bulk status editing can open its property settings', () => {
      const handlers = { ...makeHandlers(), editProperty: vi.fn() };
      const { root, view } = mount({
        handlers,
        schema: [schema[0], { ...schema[3], type: 'status' }],
      });

      root.querySelector<HTMLElement>('[data-blok-database-table-select-all]')?.click();
      root.querySelector<HTMLElement>('[data-blok-database-table-selection-property][data-property-id="p-stage"]')?.click();
      const edit = document.querySelector<HTMLElement>('[data-blok-database-select-edit-property]');

      expect(edit).not.toBeNull();
      edit?.click();
      expect(handlers.editProperty).toHaveBeenCalledWith('p-stage');
      view.destroy();
    });

    it('bulk select editing saves a newly created option', () => {
      const { root, handlers, view } = mount();

      root.querySelector<HTMLElement>('[data-blok-database-table-select-all]')?.click();
      root.querySelector<HTMLElement>('[data-blok-database-table-selection-property][data-property-id="p-stage"]')?.click();
      const search = document.querySelector<HTMLInputElement>('[data-blok-database-select-search]');

      if (search === null) throw new Error('no select search');
      search.value = 'Review';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      press(search, 'Enter');

      expect(handlers.optionsChange).toHaveBeenCalledWith('p-stage', expect.arrayContaining([
        expect.objectContaining({ label: 'Review' }),
      ]));
      view.destroy();
    });

    it('destroy closes an open bulk editor', () => {
      const { root, view } = mount({
        schema: [schema[0], { id: 'p-owner', name: 'Owner', type: 'person', position: 'a1' }],
        cellContext: { people: [{ id: 'sam', name: 'Sam' }] },
      });

      root.querySelector<HTMLElement>('[data-blok-database-table-select-all]')?.click();
      root.querySelector<HTMLElement>('[data-blok-database-table-selection-property][data-property-id="p-owner"]')?.click();
      if (document.querySelector('[data-blok-database-cell-editor]') === null) throw new Error('no bulk editor');
      view.destroy();

      expect(document.querySelector('[data-blok-database-cell-editor]')).toBeNull();
    });

    it('the selection bar deletes the selected rows', () => {
      const { root, handlers } = mount();

      root.querySelector<HTMLElement>('[data-row-id="r2"] [data-blok-database-table-row-checkbox]')?.click();
      root.querySelector<HTMLElement>('[data-blok-database-table-selection-delete]')?.click();

      expect(handlers.deleteRows).toHaveBeenCalledWith(['r2']);
    });

    it('the OPEN button shows the side-peek icon before its label', () => {
      const { root } = mount();
      const open = root.querySelector('[data-row-id="r1"] [data-blok-database-table-open]');

      const expected = document.createElement('span');

      expected.innerHTML = IconSplitView;
      expect(open?.firstElementChild?.innerHTML).toBe(expected.innerHTML);
      expect(open?.lastElementChild?.textContent).toBe('tools.database.tableOpen');
    });

    it('the OPEN button opens the row', () => {
      const { root, handlers } = mount();

      root.querySelector<HTMLElement>('[data-row-id="r1"] [data-blok-database-table-open]')?.click();

      expect(handlers.openRow).toHaveBeenCalledWith('r1');
    });

    it.each(['Enter', 'Space'])('leaves %s on New page to the button after selecting a cell', (key) => {
      const { root, view } = mount();

      try {
        selectCell(root, 'r1', 'p-notes');
        const add = root.querySelector<HTMLButtonElement>('[data-blok-database-table-add-row]');

        if (add === null) throw new Error('no add-row button');
        add.focus();
        const event = press(add, key === 'Space' ? ' ' : key, { isComposing: false });

        expect(event.defaultPrevented).toBe(false);
        expect(editor()).toBeNull();
      } finally {
        view.destroy();
      }
    });

    it('+ New page adds a row and opens its title editor after the redraw', () => {
      const state = createTableState();
      const handlers = makeHandlers();

      vi.mocked(handlers.addRow).mockReturnValue('r-new');
      const { root } = mount({ state, handlers });

      root.querySelector<HTMLElement>('[data-blok-database-table-add-row]')?.click();
      expect(handlers.addRow).toHaveBeenCalledWith(null);
      expect(state.pendingEdit).toEqual({ rowId: 'r-new', propertyId: 'p-title' });
    });

    it('Escape in the title editor of a new empty row deletes the row', async () => {
      const state = createTableState();

      state.freshRowId = 'r-new';
      state.pendingEdit = { rowId: 'r-new', propertyId: 'p-title' };
      const { handlers } = mount({ state, rows: [...rows(), row('r-new', '')] });

      // The pending editor opens once the table is in the page.
      await Promise.resolve();
      press(editorField(), 'Escape');

      expect(handlers.deleteRows).toHaveBeenCalledWith(['r-new']);
    });

    // research/30 B20: Escape saves the title, so a typed title keeps the new row.
    it('Escape in the title editor of a new row saves the title and keeps the row', async () => {
      const state = createTableState();

      state.freshRowId = 'r-new';
      state.pendingEdit = { rowId: 'r-new', propertyId: 'p-title' };
      const { root, handlers } = mount({ state, rows: [...rows(), row('r-new', '')] });

      await Promise.resolve();
      editorField().value = 'Named';
      press(editorField(), 'Escape');

      expect(handlers.commitCell).toHaveBeenCalledWith('r-new', 'p-title', 'Named');
      expect(handlers.deleteRows).not.toHaveBeenCalled();
      expect(editor()).toBeNull();
      expect(anchorCell(root)).toBe('r-new/p-title');
    });

    // research/22 §3: Escape saves a text, so the typed note keeps the new row.
    it('Escape in a note of a new row saves the note and keeps the row', async () => {
      const state = createTableState();

      state.freshRowId = 'r-new';
      state.pendingEdit = { rowId: 'r-new', propertyId: 'p-notes' };
      const { root, handlers } = mount({ state, rows: [...rows(), row('r-new', '')] });

      await Promise.resolve();
      editorField().value = 'kept';
      press(editorField(), 'Escape');

      expect(handlers.commitCell).toHaveBeenCalledWith('r-new', 'p-notes', 'kept');
      expect(handlers.deleteRows).not.toHaveBeenCalled();
      expect(editor()).toBeNull();
      expect(anchorCell(root)).toBe('r-new/p-notes');
    });

    it('Escape in an untouched note of a new empty row still deletes the row', async () => {
      const state = createTableState();

      state.freshRowId = 'r-new';
      state.pendingEdit = { rowId: 'r-new', propertyId: 'p-notes' };
      const { handlers } = mount({ state, rows: [...rows(), row('r-new', '')] });

      await Promise.resolve();
      press(editorField(), 'Escape');

      expect(handlers.commitCell).not.toHaveBeenCalled();
      expect(handlers.deleteRows).toHaveBeenCalledWith(['r-new']);
    });

    it('Escape in a number cell saves the typed number and keeps the cell selected', () => {
      const { root, handlers } = mount();

      cell(root, 'r1', 'p-amount').click();
      editorField().value = '401';
      press(editorField(), 'Escape');

      expect(handlers.commitCell).toHaveBeenCalledWith('r1', 'p-amount', 401);
      expect(editor()).toBeNull();
      expect(anchorCell(root)).toBe('r1/p-amount');
    });

    it('Enter in the select editor picks the option and moves the selection down', () => {
      const { root, handlers } = mount();

      cell(root, 'r1', 'p-stage').click();
      const search = document.querySelector<HTMLInputElement>('[data-blok-database-select-search]');

      if (search === null) throw new Error('no select search');
      search.value = 'Build';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      press(search, 'Enter');

      expect(anchorCell(root)).toBe('r2/p-stage');
      expect(handlers.commitCell).toHaveBeenCalledWith('r1', 'p-stage', 'o-build');
    });

    it('Enter on a new row title commits it and keeps that title cell selected', async () => {
      const state = createTableState();
      const [first, ...rest] = rows();

      state.freshRowId = 'r-new';
      state.pendingEdit = { rowId: 'r-new', propertyId: 'p-title' };
      const { root, handlers } = mount({ state, rows: [first, row('r-new', ''), ...rest] });

      await Promise.resolve();
      editorField().value = 'Fresh';
      press(editorField(), 'Enter');

      expect(anchorCell(root)).toBe('r-new/p-title');
      expect(handlers.commitCell).toHaveBeenCalledWith('r-new', 'p-title', 'Fresh');
      expect(editor()).toBeNull();
    });
  });
  describe('columns', () => {
    const pointer = (target: EventTarget, type: string, clientX: number, clientY = 0): void => {
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 }));
    };
    const header = (root: HTMLElement, id: string): HTMLElement => {
      const el = root.querySelector<HTMLElement>(`[role="columnheader"][data-property-id="${id}"]`);

      if (el === null) {
        throw new Error(`no header ${id}`);
      }

      return el;
    };

    it('resizes a column live from its handle and writes one width on release', () => {
      const { root, handlers, state } = mount();
      const handle = header(root, 'p-notes').querySelector<HTMLElement>('[data-blok-database-table-resize]');

      if (handle === null) {
        throw new Error('no handle');
      }
      pointer(handle, 'pointerdown', 100);
      expect(state.busy).toBe(true);
      pointer(document, 'pointermove', 180);

      expect(header(root, 'p-notes').style.width).toBe('280px');
      expect(cell(root, 'r1', 'p-notes').style.width).toBe('280px');
      expect(handlers.updateView).not.toHaveBeenCalled();

      pointer(document, 'pointerup', 180);
      expect(state.busy).toBe(false);
      expect(handlers.updateView).toHaveBeenCalledTimes(1);
      const changes = vi.mocked(handlers.updateView).mock.calls[0][0];

      expect(changes.properties?.find((p) => p.id === 'p-notes')?.width).toBe(280);
    });

    it('a double-click fit leaves room for the AI Autofill sparkle beside the header button', () => {
      const autofillSchema = schema.map((p) => (p.id === 'p-notes' ? { ...p, autofill: { mode: 'summary' as const } } : p));
      const { root, handlers } = mount({ schema: autofillSchema, autofill: { filling: () => false, run: vi.fn(), open: vi.fn() } });
      const notes = header(root, 'p-notes');
      const button = notes.querySelector<HTMLElement>('[data-blok-database-table-column-button]');
      const sparkle = notes.querySelector<HTMLElement>('[data-blok-database-table-autofill-open]');
      const handle = notes.querySelector<HTMLElement>('[data-blok-database-table-resize]');

      if (button === null || sparkle === null || handle === null) {
        throw new Error('no header parts');
      }
      vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 36));
      vi.spyOn(sparkle, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 20, 20));
      handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));

      const changes = vi.mocked(handlers.updateView).mock.calls[0][0];

      // Button 200 + sparkle 20 + cell padding 16.
      expect(changes.properties?.find((p) => p.id === 'p-notes')?.width).toBe(236);
    });

    it('the header click opens the property menu, but not after a resize press', () => {
      const { root, handlers } = mount();

      header(root, 'p-notes').querySelector<HTMLElement>('[data-blok-database-table-column-button]')?.click();
      expect(handlers.openPropertyMenu).toHaveBeenCalledWith('p-notes', header(root, 'p-notes'));

      vi.mocked(handlers.openPropertyMenu).mockClear();
      header(root, 'p-notes').querySelector<HTMLElement>('[data-blok-database-table-resize]')?.click();
      expect(handlers.openPropertyMenu).not.toHaveBeenCalled();
    });

    it('the + header button asks for a new property', () => {
      const { root, handlers } = mount();
      const add = root.querySelector<HTMLElement>('[data-blok-database-table-add-property]');

      add?.click();
      expect(handlers.addProperty).toHaveBeenCalledWith(add);
    });

    it('header view items freeze, hide, wrap and insert through the view helpers', () => {
      const { view, handlers, root } = mount();
      const anchor = header(root, 'p-notes');
      const items = view.headerItems('p-notes', anchor) as Array<{ title?: string; onActivate?: () => void }>;
      const pick = (key: string): void => items.find((item) => item.title === key)?.onActivate?.();

      pick('tools.database.tableFreeze');
      expect(handlers.updateView).toHaveBeenLastCalledWith({ frozenColumnCount: 2 });
      pick('tools.database.tableHide');
      expect(vi.mocked(handlers.updateView).mock.lastCall?.[0].properties?.find((p) => p.id === 'p-notes')?.visible).toBe(false);
      pick('tools.database.tableWrap');
      expect(vi.mocked(handlers.updateView).mock.lastCall?.[0].properties?.find((p) => p.id === 'p-notes')?.wrap).toBe(true);
      pick('tools.database.tableInsertLeft');
      expect(handlers.addProperty).toHaveBeenCalledWith(anchor, { propertyId: 'p-notes', side: 'left' });
      pick('tools.database.tableInsertRight');
      expect(handlers.addProperty).toHaveBeenLastCalledWith(anchor, { propertyId: 'p-notes', side: 'right' });
      pick('tools.database.tableSort');
      expect(handlers.viewAction).toHaveBeenCalledWith('sort', 'p-notes', anchor);
    });

    it('the title column offers no Hide, and a frozen end column offers Unfreeze', () => {
      const { view, root } = mount({ view: tableView({ frozenColumnCount: 1 }) });
      const titles = (view.headerItems('p-title', header(root, 'p-title')) as Array<{ title?: string }>).map((item) => item.title);

      expect(titles).not.toContain('tools.database.tableHide');
      expect(titles).toContain('tools.database.tableUnfreeze');
    });
  });

  describe('grouped table', () => {
    const groups = (): TableGroup[] => [
      { key: 'o-idea', label: 'Idea', option: { id: 'o-idea', label: 'Idea', color: 'yellow', position: 'a0' }, rows: [rows()[0]] },
      { key: '__none__', label: 'No Stage', rows: [rows()[1], rows()[2]] },
    ];

    it('draws one section per group with its count and rows', () => {
      const { root } = mount({ groups: groups() });
      const sections = [...root.querySelectorAll('[data-blok-database-table-group]')];

      expect(sections.map((el) => el.getAttribute('data-group-key'))).toEqual(['o-idea', '__none__']);
      expect(sections[1].querySelector('[data-blok-database-table-group-count]')?.textContent).toBe('2');
      expect(sections[1].querySelectorAll('[data-blok-database-table-row]')).toHaveLength(2);
    });

    it('collapsing a group removes its rows at once and remembers it', () => {
      const { root, state } = mount({ groups: groups() });
      const toggle = root.querySelector<HTMLElement>('[data-group-key="__none__"] [data-blok-database-table-group-toggle]');

      toggle?.click();

      expect(toggle?.getAttribute('aria-expanded')).toBe('false');
      expect(root.querySelectorAll('[data-group-key="__none__"] [data-blok-database-table-row]')).toHaveLength(0);
      expect(state.collapsed.has('__none__')).toBe(true);
    });

    it('+ New page in a group adds the row to that group', () => {
      const { root, handlers } = mount({ groups: groups() });

      root.querySelector<HTMLElement>('[data-blok-database-table-group][data-group-key="o-idea"] [data-blok-database-table-add-row]')?.click();
      expect(handlers.addRow).toHaveBeenCalledWith('o-idea');
    });
  });

  describe('row drag', () => {
    it('swallows the release click even when the drop redraws the table', () => {
      const handlers = makeHandlers();
      const state = createTableState();
      const first = mount({ handlers, state });
      const second: { root: HTMLElement | null } = { root: null };

      vi.mocked(handlers.moveRow).mockImplementation(() => {
        first.view.destroy();
        first.root.remove();
        second.root = mount({ handlers, state }).root;
      });
      const rowEls = [...first.root.querySelectorAll<HTMLElement>('[data-blok-database-table-row]')];

      rowEls.forEach((el, i) => vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: i * 37, bottom: i * 37 + 37, left: 0, right: 600, width: 600, height: 37, x: 0, y: i * 37, toJSON: () => ({}) }));
      rowEls[0].querySelector<HTMLElement>('[data-blok-database-table-row-handle]')
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 10, button: 0 }));
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 5, clientY: 100 }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 5, clientY: 100 }));
      second.root?.querySelector<HTMLElement>('[data-row-id="r1"] [data-blok-database-table-row-handle]')?.click();

      expect(handlers.moveRow).toHaveBeenCalledTimes(1);
      expect(document.querySelector('[data-blok-popover-opened]')).toBeNull();
    });

    const rect = (top: number): DOMRect => ({ top, bottom: top + 37, left: 0, right: 600, width: 600, height: 37, x: 0, y: top, toJSON: () => ({}) });

    // feel/findings-table T15: Notion's row menu has its own row size and opens beside ⋮⋮.
    it('opens the row menu from ⋮⋮ as the row menu', () => {
      const { root } = mount();

      root.querySelector<HTMLElement>('[data-row-id="r1"] [data-blok-database-table-row-handle]')?.click();

      const menu = document.querySelector('[data-blok-popover-custom-class~="blok-database-row-menu"]');

      expect(menu).not.toBeNull();
      expect(menu?.querySelector('[data-blok-database-row-menu-footer]')).not.toBeNull();
    });

    it('drops a row between two others and ignores the click on release', () => {
      const { root, handlers } = mount();
      const rowEls = [...root.querySelectorAll<HTMLElement>('[data-blok-database-table-row]')];

      rowEls.forEach((el, i) => vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(i * 37)));
      const handle = rowEls[0].querySelector<HTMLElement>('[data-blok-database-table-row-handle]');

      if (handle === null) {
        throw new Error('no handle');
      }
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 10, button: 0 }));
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 5, clientY: 100 }));

      expect(document.querySelector('[data-blok-database-table-row-ghost]')).not.toBeNull();
      expect(root.querySelector('[data-blok-database-table-drop-line]')).not.toBeNull();

      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 5, clientY: 100 }));

      expect(handlers.moveRow).toHaveBeenCalledWith({ rowId: 'r1', beforeRowId: null, afterRowId: 'r3', groupKey: '', fromGroupKey: '' });
      expect(document.querySelector('[data-blok-database-table-row-ghost]')).toBeNull();
    });

    it('in a sorted view a drop goes to the sorted-drop hook instead', () => {
      const { root, handlers } = mount({ view: tableView({ sorts: [{ propertyId: 'p-amount', direction: 'asc' }] }) });
      const rowEls = [...root.querySelectorAll<HTMLElement>('[data-blok-database-table-row]')];

      rowEls.forEach((el, i) => vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(i * 37)));
      rowEls[2].querySelector<HTMLElement>('[data-blok-database-table-row-handle]')
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 80, button: 0 }));
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 5, clientY: 5 }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 5, clientY: 5 }));

      expect(handlers.moveRow).not.toHaveBeenCalled();
      expect(handlers.sortedRowDrop).toHaveBeenCalledWith(expect.objectContaining({ rowId: 'r3', beforeRowId: 'r1' }));
    });
  });

  describe('calculation menu', () => {
    it('closes its open menu when the table is torn down, so a redraw leaves no stray popover', async () => {
      const { root, view } = mount();

      root.querySelector<HTMLElement>('[data-blok-database-table-calc][data-property-id="p-amount"]')?.click();
      expect(document.querySelector('[data-blok-popover-opened], [data-blok-popover]')).not.toBeNull();

      view.destroy();
      await Promise.resolve();

      expect(document.querySelector('[data-blok-popover-opened]')).toBeNull();
    });

    it('offers None, Count and Percent, plus More options on a number column', () => {
      const titles = (type: PropertyDefinition['type']): Array<string | undefined> =>
        (calculationItems({ type }, undefined, { t: (key: string) => key }, vi.fn()) as Array<{ title?: string }>).map((item) => item.title);

      expect(titles('text')).toEqual(['tools.database.calcNone', 'tools.database.calcCount', 'tools.database.calcPercent']);
      expect(titles('number')).toContain('tools.database.calcMoreOptions');
      expect(titles('date')).toContain('tools.database.calcDate');
    });

    it('gives created and edited time the Date › group, like a date column (research/08)', () => {
      const titles = (type: PropertyDefinition['type']): Array<string | undefined> =>
        (calculationItems({ type }, undefined, { t: (key: string) => key }, vi.fn()) as Array<{ title?: string }>).map((item) => item.title);

      expect(titles('createdTime')).toContain('tools.database.calcDate');
      expect(titles('lastEditedTime')).toContain('tools.database.calcDate');
      expect(titles('createdTime')).not.toContain('tools.database.calcMoreOptions');
    });

    it('starts the Count list with "Show large counts as 99+", which toggles the cap', () => {
      const onCap = vi.fn();
      const items = calculationItems({ type: 'text' }, 'count', { t: (key: string) => key }, vi.fn(), { capCounts: false, onCapCounts: onCap }) as Array<{
        title?: string;
        children?: { items?: Array<{ title?: string; isActive?: boolean; onActivate?: () => void }> };
      }>;
      const count = items.find((item) => item.title === 'tools.database.calcCount')?.children?.items ?? [];

      expect(count.map((item) => item.title)).toEqual([
        'tools.database.calcShowLargeCounts',
        'tools.database.calcCountAll',
        'tools.database.calcCountValues',
        'tools.database.calcCountUnique',
        'tools.database.calcCountEmpty',
        'tools.database.calcCountNotEmpty',
      ]);
      expect(count[0].isActive).toBe(false);
      count[0].onActivate?.();
      expect(onCap).toHaveBeenCalledWith(true);
    });

    it('has no 99+ toggle on a checkbox column (research/08)', () => {
      const items = calculationItems({ type: 'checkbox' }, undefined, { t: (key: string) => key }, vi.fn(), { capCounts: false, onCapCounts: vi.fn() }) as Array<{ title?: string; children?: { items?: Array<{ title?: string }> } }>;
      const count = items.find((item) => item.title === 'tools.database.calcCount');

      expect(count?.children?.items?.map((item) => item.title)).not.toContain('tools.database.calcShowLargeCounts');
    });

    it('a button column has no footer menu: Notion offers no Calculate there', () => {
      const withButton: PropertyDefinition[] = [...schema, { id: 'p-act', name: 'Act', type: 'button', position: 'a5' }];
      const { root } = mount({ schema: withButton });
      const cell = root.querySelector<HTMLElement>('[data-blok-database-table-calc][data-property-id="p-act"]');

      expect(cell).not.toBeNull();
      expect(cell?.tagName).not.toBe('BUTTON');
      expect(cell?.textContent).toBe('');
      cell?.click();
      expect(document.querySelector('[data-blok-popover-opened]')).toBeNull();
    });

    it('gives a checkbox column Checked and Unchecked under Count', () => {
      const items = calculationItems({ type: 'checkbox' }, undefined, { t: (key: string) => key }, vi.fn()) as Array<{ title?: string; children?: { items?: Array<{ title?: string }> } }>;
      const count = items.find((item) => item.title === 'tools.database.calcCount');

      expect(count?.children?.items?.map((item) => item.title)).toEqual(['tools.database.calcCountAll', 'tools.database.calcChecked', 'tools.database.calcUnchecked']);
    });
  });
});
