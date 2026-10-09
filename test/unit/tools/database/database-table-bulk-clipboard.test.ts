import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseTableView, createTableState } from '../../../../src/tools/database/database-table-view';
import type { TableHandlers, TableState, DatabaseTableViewOptions } from '../../../../src/tools/database/database-table-view';
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


interface FakeClipboard {
  data: Map<string, string>;
  event: Event;
}

const clipboardEvent = (type: 'copy' | 'paste', data: Record<string, string> = {}): FakeClipboard => {
  const store = new Map(Object.entries(data));
  const event = new Event(type, { bubbles: true, cancelable: true });

  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData: (format: string, value: string): void => {
        store.set(format, value);
      },
      getData: (format: string): string => store.get(format) ?? '',
      types: [...store.keys()],
    },
  });

  return { data: store, event };
};

const commitsOf = (handlers: TableHandlers): unknown[] => vi.mocked(handlers.commitCells).mock.calls;

describe('table bulk actions and clipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    PopoverRegistry.resetForTests?.();
    vi.restoreAllMocks();
  });

  describe('copy', () => {
    it('copies a cell range as TSV and an HTML table of display text', () => {
      const { root } = mount();

      selectCell(root, 'r1', 'p-title');
      press(grid(root), 'ArrowDown', { shiftKey: true });
      press(grid(root), 'ArrowRight', { shiftKey: true });
      const copy = clipboardEvent('copy');

      grid(root).dispatchEvent(copy.event);

      expect(copy.event.defaultPrevented).toBe(true);
      expect(copy.data.get('text/plain')).toBe('Alpha\tshort\nBravo\t');
      expect(copy.data.get('text/html')).toContain('<td>Alpha</td><td>short</td>');
    });

    it('copies whole selected rows, every column', () => {
      const { root } = mount();

      cell(root, 'r1', 'p-title').closest('[data-row-id]')?.querySelector<HTMLElement>('[data-blok-database-table-row-checkbox]')?.click();
      const copy = clipboardEvent('copy');

      grid(root).dispatchEvent(copy.event);

      expect(copy.data.get('text/plain')).toBe('Alpha\tshort\t1200\tIdea\tNo');
    });
  });

  describe('paste', () => {
    it('pastes a block of cells from the anchor, turning text into each type', () => {
      const { root, handlers } = mount();

      selectCell(root, 'r1', 'p-amount');
      const paste = clipboardEvent('paste', { 'text/plain': '7\tBuild\n8\tIdea' });

      grid(root).dispatchEvent(paste.event);

      expect(paste.event.defaultPrevented).toBe(true);
      expect(commitsOf(handlers)).toEqual([[[
        { rowId: 'r1', propertyId: 'p-amount', value: 7 },
        { rowId: 'r1', propertyId: 'p-stage', value: 'o-build' },
        { rowId: 'r2', propertyId: 'p-amount', value: 8 },
        { rowId: 'r2', propertyId: 'p-stage', value: 'o-idea' },
      ], []]]);
    });

    it('pastes one value into every selected cell', () => {
      const { root, handlers } = mount();

      selectCell(root, 'r1', 'p-notes');
      press(grid(root), 'ArrowDown', { shiftKey: true });
      press(grid(root), 'ArrowDown', { shiftKey: true });
      grid(root).dispatchEvent(clipboardEvent('paste', { 'text/plain': 'same' }).event);

      expect(commitsOf(handlers)[0]).toEqual([[
        { rowId: 'r1', propertyId: 'p-notes', value: 'same' },
        { rowId: 'r2', propertyId: 'p-notes', value: 'same' },
        { rowId: 'r3', propertyId: 'p-notes', value: 'same' },
      ], []]);
    });

    it('adds rows for pasted lines past the last row', () => {
      const { root, handlers } = mount();

      selectCell(root, 'r3', 'p-title');
      grid(root).dispatchEvent(clipboardEvent('paste', { 'text/plain': 'Charlie 2\nDelta\nEcho' }).event);

      expect(commitsOf(handlers)[0]).toEqual([
        [{ rowId: 'r3', propertyId: 'p-title', value: 'Charlie 2' }],
        [{ 'p-title': 'Delta' }, { 'p-title': 'Echo' }],
      ]);
    });

    it('turns a pasted table with matching headers into new rows, column by name', () => {
      const { root, handlers } = mount();
      const html = '<table><tr><th>Stage</th><th>Name</th><th>Unknown</th></tr><tr><td>Build</td><td>Foxtrot</td><td>x</td></tr></table>';

      grid(root).focus();
      grid(root).dispatchEvent(clipboardEvent('paste', { 'text/html': html, 'text/plain': 'ignored' }).event);

      expect(commitsOf(handlers)[0]).toEqual([[], [{ 'p-stage': 'o-build', 'p-title': 'Foxtrot' }]]);
    });

    it('never writes from a read-only table', () => {
      const { root, handlers } = mount({ readOnly: true });

      selectCell(root, 'r1', 'p-notes');
      grid(root).dispatchEvent(clipboardEvent('paste', { 'text/plain': 'x' }).event);

      expect(handlers.commitCells).not.toHaveBeenCalled();
    });
  });

  describe('fill', () => {
    it('Cmd/Ctrl+D fills a range down from its top row', () => {
      const { root, handlers } = mount();

      selectCell(root, 'r1', 'p-amount');
      press(grid(root), 'ArrowDown', { shiftKey: true });
      press(grid(root), 'ArrowDown', { shiftKey: true });
      const event = press(grid(root), 'd', { ctrlKey: true });

      expect(event.defaultPrevented).toBe(true);
      expect(commitsOf(handlers)[0]).toEqual([[
        { rowId: 'r2', propertyId: 'p-amount', value: 1200 },
        { rowId: 'r3', propertyId: 'p-amount', value: 1200 },
      ], []]);
    });

    it('Cmd/Ctrl+R fills a range right from its first column, and leaves a single cell alone', () => {
      const { root, handlers } = mount();

      selectCell(root, 'r1', 'p-title');
      const lone = press(grid(root), 'r', { ctrlKey: true });

      expect(lone.defaultPrevented).toBe(false);
      press(grid(root), 'ArrowRight', { shiftKey: true });
      const fill = press(grid(root), 'r', { ctrlKey: true });

      expect(fill.defaultPrevented).toBe(true);
      expect(commitsOf(handlers)[0]).toEqual([[{ rowId: 'r1', propertyId: 'p-notes', value: 'Alpha' }], []]);
    });

    it('draws a fill handle on the selected cell', () => {
      const { root } = mount();

      selectCell(root, 'r1', 'p-notes');

      expect(cell(root, 'r1', 'p-notes').querySelector('[data-blok-database-table-fill-handle]')).not.toBeNull();
    });
  });

  describe('undo', () => {
    it('forwards Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z from the grid, which owns its keys', () => {
      const history = vi.fn();
      const { root } = mount({ handlers: { ...makeHandlers(), history } });

      selectCell(root, 'r1', 'p-notes');
      const undo = press(grid(root), 'z', { metaKey: true, code: 'KeyZ' });
      press(grid(root), 'z', { metaKey: true, shiftKey: true, code: 'KeyZ' });

      expect(undo.defaultPrevented).toBe(true);
      expect(history.mock.calls).toEqual([[false], [true]]);
    });
  });

  describe('selection bar', () => {
    const selectRows = (root: HTMLElement, ...rowIds: string[]): void => {
      rowIds.forEach((rowId) => root.querySelector<HTMLElement>(`[data-row-id="${rowId}"] [data-blok-database-table-row-checkbox]`)?.click());
    };

    it('shift-click on a row checkbox selects the rows between', () => {
      const { root, state } = mount();
      const box = (rowId: string): HTMLElement | null => root.querySelector<HTMLElement>(`[data-row-id="${rowId}"] [data-blok-database-table-row-checkbox]`);

      box('r1')?.click();
      box('r3')?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));

      expect(state.selection).toEqual({ kind: 'rows', rowIds: ['r1', 'r2', 'r3'] });
    });

    it('offers one button per visible editable property, and its edit lands on every selected row', () => {
      const { root, handlers } = mount();

      selectRows(root, 'r1', 'r3');
      const buttons = [...root.querySelectorAll<HTMLElement>('[data-blok-database-table-selection-property]')];

      expect(buttons.map((button) => button.getAttribute('data-property-id'))).toEqual(['p-notes', 'p-amount', 'p-stage', 'p-done']);

      buttons[3].click();

      expect(commitsOf(handlers)[0]).toEqual([[
        { rowId: 'r1', propertyId: 'p-done', value: true },
        { rowId: 'r3', propertyId: 'p-done', value: true },
      ], []]);
    });

    it('the … menu duplicates and moves the selection to the trash', () => {
      const { root, handlers } = mount();

      selectRows(root, 'r1', 'r2');
      root.querySelector<HTMLElement>('[data-blok-database-table-selection-more]')?.click();
      const items = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-blok-popover-item]')];

      expect(items().map((item) => item.textContent?.trim())).toEqual(['tools.database.tableDuplicate', 'tools.database.tableMoveToTrash']);
      items()[0].click();

      expect(handlers.duplicateRow).toHaveBeenCalledTimes(2);
    });

    it('Cmd/Ctrl+/ opens the property list to edit every selected row', () => {
      const { root } = mount();

      selectRows(root, 'r1', 'r2');
      const event = press(grid(root), '/', { ctrlKey: true });

      expect(event.defaultPrevented).toBe(true);
      expect([...document.querySelectorAll('[data-blok-popover-item]')].map((item) => item.textContent?.trim()))
        .toEqual(['Notes', 'Amount', 'Stage', 'Done']);
    });
  });
});
