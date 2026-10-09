import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DatabaseTableView, createTableState } from '../../../../src/tools/database/database-table-view';
import type { TableHandlers, TableState, DatabaseTableViewOptions, TableGroup } from '../../../../src/tools/database/database-table-view';
import { calculationItems } from '../../../../src/tools/database/database-table-menus';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

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

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('layout', () => {
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
      const view = tableView({ showVerticalLines: false, properties: [{ id: 'p-title', visible: true }, { id: 'p-notes', visible: true, wrap: true }] });
      const { root } = mount({ view });

      expect(cell(root, 'r1', 'p-notes').hasAttribute('data-wrap')).toBe(true);
      expect(cell(root, 'r1', 'p-amount').hasAttribute('data-wrap')).toBe(false);
      expect(grid(root).getAttribute('data-vertical-lines')).toBe('false');
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

    it('Enter in an editor on the last row commits and stays', () => {
      const { root } = mount();

      cell(root, 'r3', 'p-notes').click();
      editorField().value = 'x';
      press(editorField(), 'Enter');

      expect(anchorCell(root)).toBe('r3/p-notes');
    });

    it('typing a character opens the editor with that character replacing the value', () => {
      const { root } = mount();

      selectCell(root, 'r1', 'p-notes');
      press(grid(root), 'Z');

      expect(editorField().value).toBe('Z');
    });

    it('Backspace clears the selected cell and keeps the selection', () => {
      const { root, handlers } = mount();

      selectCell(root, 'r1', 'p-amount');
      press(grid(root), 'Backspace');

      expect(handlers.commitCell).toHaveBeenCalledWith('r1', 'p-amount', null);
      expect(anchorCell(root)).toBe('r1/p-amount');
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

    it('keeps the selection across a re-render through the shared state', () => {
      const state = createTableState();
      const first = mount({ state });

      selectCell(first.root, 'r2', 'p-amount');
      first.root.remove();

      const second = mount({ state });

      expect(anchorCell(second.root)).toBe('r2/p-amount');
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

    it('the selection bar deletes the selected rows', () => {
      const { root, handlers } = mount();

      root.querySelector<HTMLElement>('[data-row-id="r2"] [data-blok-database-table-row-checkbox]')?.click();
      root.querySelector<HTMLElement>('[data-blok-database-table-selection-delete]')?.click();

      expect(handlers.deleteRows).toHaveBeenCalledWith(['r2']);
    });

    it('the OPEN button opens the row', () => {
      const { root, handlers } = mount();

      root.querySelector<HTMLElement>('[data-row-id="r1"] [data-blok-database-table-open]')?.click();

      expect(handlers.openRow).toHaveBeenCalledWith('r1');
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
    const rect = (top: number): DOMRect => ({ top, bottom: top + 37, left: 0, right: 600, width: 600, height: 37, x: 0, y: top, toJSON: () => ({}) });

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
    it('offers None, Count and Percent, plus More options on a number column', () => {
      const titles = (type: PropertyDefinition['type']): Array<string | undefined> =>
        (calculationItems({ type }, undefined, { t: (key: string) => key }, vi.fn()) as Array<{ title?: string }>).map((item) => item.title);

      expect(titles('text')).toEqual(['tools.database.calcNone', 'tools.database.calcCount', 'tools.database.calcPercent']);
      expect(titles('number')).toContain('tools.database.calcMoreOptions');
      expect(titles('date')).toContain('tools.database.calcDate');
    });

    it('gives a checkbox column Checked and Unchecked under Count', () => {
      const items = calculationItems({ type: 'checkbox' }, undefined, { t: (key: string) => key }, vi.fn()) as Array<{ title?: string; children?: { items?: Array<{ title?: string }> } }>;
      const count = items.find((item) => item.title === 'tools.database.calcCount');

      expect(count?.children?.items?.map((item) => item.title)).toEqual(['tools.database.calcCountAll', 'tools.database.calcChecked', 'tools.database.calcUnchecked']);
    });
  });
});
