import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DatabaseTableView, createTableState } from '../../../../src/tools/database/database-table-view';
import type { TableHandlers, DatabaseTableViewOptions } from '../../../../src/tools/database/database-table-view';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { DatabaseRow, PropertyDefinition } from '../../../../src/tools/database/types';

// research/12 §2: a filled AI Autofill cell's hover buttons are Autofill, Comment, Copy to Clipboard.
const schema: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-summary', name: 'Summary', type: 'text', position: 'a1', autofill: { mode: 'summary' } },
  { id: 'p-tags', name: 'Tags', type: 'multiSelect', position: 'a2', autofill: { mode: 'summary' }, config: { options: [
    { id: 'o-a', label: 'Red', color: 'red', position: 'a0' },
    { id: 'o-b', label: 'Blue', color: 'blue', position: 'a1' },
  ] } },
];

const rows = (): DatabaseRow[] => [
  { id: 'r1', position: 'a0', properties: { 'p-title': 'Alpha', 'p-summary': 'The page describes Alpha.', 'p-tags': ['o-a', 'o-b'] } },
  { id: 'r2', position: 'a1', properties: { 'p-title': 'Beta' } },
];

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
});

type Autofill = NonNullable<DatabaseTableViewOptions['autofill']>;

const mount = (overrides: Partial<DatabaseTableViewOptions> = {}): { root: HTMLElement; run: Autofill['run'] } => {
  const run = vi.fn();
  const view = new DatabaseTableView({
    readOnly: false,
    i18n: { t: (key: string) => key } as DatabaseTableViewOptions['i18n'],
    view: { id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] },
    schema,
    rows: rows(),
    titlePropertyId: 'p-title',
    state: createTableState(),
    handlers: makeHandlers(),
    autofill: { filling: () => false, run, open: vi.fn() },
    ...overrides,
  });
  const root = view.createView();

  document.body.appendChild(root);

  return { root, run };
};

const cell = (root: HTMLElement, rowId: string, propertyId: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(`[data-row-id="${rowId}"] [role="gridcell"][data-property-id="${propertyId}"]`);

  if (el === null) throw new Error(`no cell ${rowId}/${propertyId}`);

  return el;
};

const actions = (el: HTMLElement): HTMLElement | null => el.querySelector<HTMLElement>('[data-blok-database-table-cell-actions]');

const labels = (el: HTMLElement): Array<string | null> =>
  [...(actions(el)?.querySelectorAll('button') ?? [])].map((button) => button.getAttribute('aria-label'));

const action = (el: HTMLElement, label: string): HTMLButtonElement => {
  const button = actions(el)?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

  if (button === null || button === undefined) throw new Error(`no ${label}`);

  return button;
};

const editor = (): Element | null => document.querySelector('[data-blok-database-cell-editor]');

const clickOn = (target: Element): void => {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
};

describe('table AI Autofill cell hover actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('a filled autofill cell shows Autofill, Comment, Copy to Clipboard, in that order', () => {
    const { root } = mount({ comment: vi.fn() });

    expect(labels(cell(root, 'r1', 'p-summary'))).toEqual([
      'tools.database.aiAutofillCell',
      'tools.database.tableComment',
      'tools.database.cellCopy',
    ]);
  });

  it('without host comments it shows Autofill, then Copy', () => {
    const { root } = mount();

    expect(labels(cell(root, 'r1', 'p-summary'))).toEqual(['tools.database.aiAutofillCell', 'tools.database.cellCopy']);
  });

  it('keeps one Autofill button per cell, with the id the grid describes the cell by', () => {
    const { root } = mount({ comment: vi.fn() });
    const target = cell(root, 'r1', 'p-summary');
    const runs = target.querySelectorAll('[data-blok-database-table-autofill]');

    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe(`${target.id}-autofill`);
  });

  it('an empty autofill cell keeps the lone Autofill button and no pill', () => {
    const { root } = mount({ comment: vi.fn() });
    const target = cell(root, 'r2', 'p-summary');

    expect(actions(target)).toBeNull();
    expect(target.querySelectorAll('[data-blok-database-table-autofill]')).toHaveLength(1);
  });

  it('a cell that is still Thinking… shows no buttons', () => {
    const { root } = mount({ comment: vi.fn(), autofill: { filling: () => true, run: vi.fn(), open: vi.fn() } });
    const target = cell(root, 'r1', 'p-summary');

    expect(actions(target)).toBeNull();
    expect(target.querySelector('[data-blok-database-table-autofill]')).toBeNull();
  });

  it('the buttons stay out of the tab order and carry no title tooltip', () => {
    const { root } = mount({ comment: vi.fn() });
    const buttons = [...(actions(cell(root, 'r1', 'p-summary'))?.querySelectorAll('button') ?? [])];

    expect(buttons).toHaveLength(3);
    buttons.forEach((button) => {
      expect(button.tabIndex).toBe(-1);
      expect(button.hasAttribute('title')).toBe(false);
    });
  });

  it('Autofill re-runs autofill for that cell', () => {
    const { root, run } = mount({ comment: vi.fn() });

    clickOn(action(cell(root, 'r1', 'p-summary'), 'tools.database.aiAutofillCell'));

    expect(run).toHaveBeenCalledWith('r1', 'p-summary');
    expect(editor()).toBeNull();
  });

  it('Comment opens the host comments for that cell and no editor', () => {
    const comment = vi.fn();
    const { root } = mount({ comment });
    const target = cell(root, 'r1', 'p-summary');

    clickOn(action(target, 'tools.database.tableComment'));

    expect(comment).toHaveBeenCalledWith('r1', 'p-summary', target);
    expect(editor()).toBeNull();
    expect(root.querySelector('[data-blok-database-table-cell-anchor]')).toBeNull();
  });

  it('Copy writes the cell text and toasts, with no editor', async () => {
    const writeText = vi.fn(() => Promise.resolve());

    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const notify = vi.fn();
    const { root } = mount({ notify });

    clickOn(action(cell(root, 'r1', 'p-summary'), 'tools.database.cellCopy'));
    await Promise.resolve();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('The page describes Alpha.');
    expect(notify).toHaveBeenCalledWith('tools.database.cellCopied');
    expect(editor()).toBeNull();
  });

  it('Copy on a multi-select cell writes its labels, the way the grid copies them', () => {
    const writeText = vi.fn(() => Promise.resolve());

    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { root } = mount();

    clickOn(action(cell(root, 'r1', 'p-tags'), 'tools.database.cellCopy'));

    // The grid's Cmd+C text: the quoted first label lets a paste back split the list.
    expect(writeText).toHaveBeenCalledWith('"Red", Blue');
  });
});
