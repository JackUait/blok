import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DatabaseTableView, createTableState } from '../../../../src/tools/database/database-table-view';
import type { TableHandlers, DatabaseTableViewOptions } from '../../../../src/tools/database/database-table-view';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { DatabaseRow, PropertyDefinition } from '../../../../src/tools/database/types';

// research/17 §1: a table date cell with a reminder.
const schema: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-due', name: 'Due', type: 'date', position: 'a1' },
];

const rows = (): DatabaseRow[] => [
  { id: 'r1', position: 'a0', properties: { 'p-title': 'Alpha', 'p-due': '2027-06-15' }, reminders: { 'p-due': { remind: '1_day_before' } } },
  { id: 'r2', position: 'a1', properties: { 'p-title': 'Beta', 'p-due': '2027-06-16' } },
];

const makeHandlers = (): TableHandlers => ({
  commitCell: vi.fn(),
  commitReminder: vi.fn(),
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
});

const mount = (handlers: TableHandlers = makeHandlers(), overrides: Partial<DatabaseTableViewOptions> = {}): { root: HTMLElement; handlers: TableHandlers } => {
  const view = new DatabaseTableView({
    readOnly: false,
    i18n: { t: (key: string) => key } as DatabaseTableViewOptions['i18n'],
    view: { id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] },
    schema,
    rows: rows(),
    titlePropertyId: 'p-title',
    state: createTableState(),
    handlers,
    ...overrides,
  });
  const root = view.createView();

  document.body.appendChild(root);

  return { root, handlers };
};

const cell = (root: HTMLElement, rowId: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(`[data-row-id="${rowId}"] [role="gridcell"][data-property-id="p-due"]`);

  if (el === null) throw new Error(`no cell ${rowId}`);

  return el;
};

const click = (target: Element): void => {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
};

describe('table date cell reminders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('shows the alarm on a date with a reminder only', () => {
    const { root } = mount();

    expect(cell(root, 'r1').querySelector('[data-blok-database-date-reminder]')).not.toBeNull();
    expect(cell(root, 'r2').querySelector('[data-blok-database-date-reminder]')).toBeNull();
  });

  it('the picker reads the stored reminder, and a pick goes to the host and onto the cell', () => {
    const { root, handlers } = mount();

    click(cell(root, 'r2'));
    const row = document.querySelector<HTMLElement>('[data-blok-database-date-remind]');

    expect(row?.querySelector('[data-blok-database-date-remind-value]')?.textContent).toBe('tools.database.dateRemind.none');
    row?.click();
    document.querySelector<HTMLElement>('[data-blok-database-date-remind-option="2_days_before"]')?.click();

    expect(handlers.commitReminder).toHaveBeenCalledWith('r2', 'p-due', '2_days_before');
    expect(cell(root, 'r2').querySelector('[data-blok-database-date-reminder]')).not.toBeNull();
  });

  it('opens on the stored reminder', () => {
    const { root } = mount();

    click(cell(root, 'r1'));

    expect(document.querySelector('[data-blok-database-date-remind-value]')?.textContent).toBe('tools.database.dateRemind.1_day_before');
  });
});
