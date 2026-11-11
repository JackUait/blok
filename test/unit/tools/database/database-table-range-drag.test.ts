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


const pointer = (target: EventTarget, type: string, init: PointerEventInit = {}): PointerEvent => {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...init });

  target.dispatchEvent(event);

  return event;
};

const selectedCells = (root: HTMLElement): string[] =>
  [...root.querySelectorAll<HTMLElement>('[role="gridcell"][aria-selected="true"]')]
    .map((el) => `${el.closest('[data-row-id]')?.getAttribute('data-row-id') ?? ''}/${el.getAttribute('data-property-id') ?? ''}`)
    .sort();

const anchorCell = (root: HTMLElement): string | null => {
  const el = root.querySelector<HTMLElement>('[data-blok-database-table-cell-anchor]');

  return el === null ? null : `${el.closest('[data-row-id]')?.getAttribute('data-row-id') ?? ''}/${el.getAttribute('data-property-id') ?? ''}`;
};

describe('table range drag', () => {
  /** What sits under the pointer; jsdom has no layout, so the test says it. */
  const under: { el: Element | null } = { el: null };

  /** Moves the pointer over an element: jsdom's elementFromPoint is stubbed to answer with it. */
  const moveOver = (el: Element | null, init: PointerEventInit = {}): void => {
    under.el = el;
    pointer(document, 'pointermove', init);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    under.el = null;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => under.el });
  });

  afterEach(async () => {
    document.body.innerHTML = '';
    PopoverRegistry.resetForTests?.();
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'elementFromPoint');
    // A drag leaves a one-tick click swallow on the document; let it lapse.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('a press on one cell dragged into another selects the rectangle, anchored where it started', () => {
    const { root } = mount();

    pointer(cell(root, 'r1', 'p-notes'), 'pointerdown');
    moveOver(cell(root, 'r1', 'p-amount'));

    expect(selectedCells(root)).toEqual(['r1/p-amount', 'r1/p-notes']);

    moveOver(cell(root, 'r2', 'p-amount'));
    pointer(document, 'pointerup');
    cell(root, 'r1', 'p-notes').click();

    expect(selectedCells(root)).toEqual(['r1/p-amount', 'r1/p-notes', 'r2/p-amount', 'r2/p-notes']);
    expect(anchorCell(root)).toBe('r1/p-notes');
    expect(editor()).toBeNull();
    expect(grid(root)).toHaveFocus();
  });

  it('copies the dragged range as tab-separated text', () => {
    const { root } = mount();

    pointer(cell(root, 'r1', 'p-title'), 'pointerdown');
    moveOver(cell(root, 'r2', 'p-notes'));
    pointer(document, 'pointerup');
    const copy = clipboardEvent('copy');

    grid(root).dispatchEvent(copy.event);

    expect(copy.data.get('text/plain')).toBe('Alpha\tshort\nBravo\t');
  });

  it('a press that stays in its cell is still a click that opens the editor', () => {
    const { root } = mount();
    const target = cell(root, 'r1', 'p-notes');

    pointer(target, 'pointerdown');
    moveOver(target.firstElementChild ?? target);
    pointer(document, 'pointerup');
    target.click();

    expect(editor()).not.toBeNull();
    expect(selectedCells(root)).toEqual(['r1/p-notes']);
  });

  it('keeps native text selection from starting while the range is dragged', () => {
    const { root } = mount();

    pointer(cell(root, 'r1', 'p-notes'), 'pointerdown');
    moveOver(cell(root, 'r2', 'p-notes'));
    const select = new Event('selectstart', { bubbles: true, cancelable: true });

    document.dispatchEvent(select);

    expect(select.defaultPrevented).toBe(true);

    pointer(document, 'pointerup');
    const later = new Event('selectstart', { bubbles: true, cancelable: true });

    document.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });

  it('a drag from the row handle or the OPEN button is not a range drag', () => {
    const { root } = mount();
    const rowHandle = root.querySelector<HTMLElement>('[data-row-id="r1"] [data-blok-database-table-row-handle]');
    const open = root.querySelector<HTMLElement>('[data-row-id="r1"] [data-blok-database-table-open]');

    if (rowHandle === null || open === null) {
      throw new Error('no row handle or open button');
    }
    for (const start of [rowHandle, open]) {
      pointer(start, 'pointerdown');
      moveOver(cell(root, 'r2', 'p-notes'));
      pointer(document, 'pointerup');
    }

    expect(selectedCells(root)).toEqual([]);
  });

  it('a drag from the fill handle stays a fill drag: it grows the range along rows only', () => {
    const { root } = mount();

    cell(root, 'r1', 'p-notes').click();
    const fill = root.querySelector<HTMLElement>('[data-blok-database-table-fill-handle]');

    if (fill === null) {
      throw new Error('no fill handle');
    }
    pointer(fill, 'pointerdown');
    moveOver(cell(root, 'r2', 'p-amount'));

    expect(selectedCells(root)).toEqual(['r1/p-notes', 'r2/p-notes']);
    pointer(document, 'pointercancel');
  });

  it('a Shift or right-button press does not start a range drag', () => {
    const { root } = mount();

    pointer(cell(root, 'r1', 'p-notes'), 'pointerdown', { button: 2, buttons: 2 });
    moveOver(cell(root, 'r2', 'p-notes'), { buttons: 2 });
    pointer(document, 'pointerup', { button: 2 });
    pointer(cell(root, 'r1', 'p-notes'), 'pointerdown', { shiftKey: true });
    moveOver(cell(root, 'r2', 'p-notes'));
    pointer(document, 'pointerup');

    expect(selectedCells(root)).toEqual([]);
  });

  it('a drag that starts while another cell is being edited commits that edit and selects the range', () => {
    const { root, handlers } = mount();

    cell(root, 'r3', 'p-notes').click();
    editorField().value = 'typed';
    pointer(cell(root, 'r1', 'p-notes'), 'pointerdown');
    moveOver(cell(root, 'r2', 'p-amount'));
    pointer(document, 'pointerup');

    expect(handlers.commitCell).toHaveBeenCalledWith('r3', 'p-notes', 'typed');
    expect(selectedCells(root)).toEqual(['r1/p-amount', 'r1/p-notes', 'r2/p-amount', 'r2/p-notes']);
    expect(anchorCell(root)).toBe('r1/p-notes');
  });

  it('a drag inside the open editor stays the editor\'s own text selection', () => {
    const { root } = mount();

    cell(root, 'r1', 'p-notes').click();
    pointer(editorField(), 'pointerdown');
    moveOver(cell(root, 'r2', 'p-amount'));
    pointer(document, 'pointerup');

    expect(selectedCells(root)).toEqual(['r1/p-notes']);
    expect(editor()).not.toBeNull();
    // An open editor keeps a window key listener that would eat the next test's Escape.
    press(editorField(), 'Escape');
  });

  it('ends the drag when the pointer is cancelled or the view is destroyed', () => {
    const { root, view } = mount();

    pointer(cell(root, 'r1', 'p-notes'), 'pointerdown');
    moveOver(cell(root, 'r1', 'p-amount'));
    pointer(document, 'pointercancel');
    moveOver(cell(root, 'r2', 'p-amount'));
    expect(selectedCells(root)).toEqual(['r1/p-amount', 'r1/p-notes']);

    pointer(cell(root, 'r1', 'p-notes'), 'pointerdown');
    view.destroy();
    moveOver(cell(root, 'r2', 'p-amount'));
    const select = new Event('selectstart', { bubbles: true, cancelable: true });

    document.dispatchEvent(select);
    expect(select.defaultPrevented).toBe(false);
  });

  it('Escape mid-drag ends the drag and keeps the range it made', () => {
    const { root } = mount();

    pointer(cell(root, 'r1', 'p-notes'), 'pointerdown');
    moveOver(cell(root, 'r2', 'p-notes'));
    press(grid(root), 'Escape');
    moveOver(cell(root, 'r3', 'p-amount'));
    pointer(document, 'pointerup');

    expect(selectedCells(root)).toEqual(['r1/p-notes', 'r2/p-notes']);
    expect(root.querySelectorAll('[data-blok-database-table-row][aria-selected="true"]')).toHaveLength(0);
  });

  it('a read-only table drags a range too, for copying', () => {
    const { root } = mount({ readOnly: true });

    pointer(cell(root, 'r1', 'p-title'), 'pointerdown');
    moveOver(cell(root, 'r2', 'p-notes'));
    pointer(document, 'pointerup');

    expect(selectedCells(root)).toEqual(['r1/p-notes', 'r1/p-title', 'r2/p-notes', 'r2/p-title']);
  });
});
