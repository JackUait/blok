import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DatabaseTableView, createTableState } from '../../../../src/tools/database/database-table-view';
import type { TableHandlers, DatabaseTableViewOptions } from '../../../../src/tools/database/database-table-view';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { DatabaseRow, PropertyDefinition } from '../../../../src/tools/database/types';

// research/16 §4: URL, Email and Phone cells in a table.
const schema: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-link', name: 'Link', type: 'url', position: 'a1' },
  { id: 'p-mail', name: 'Mail', type: 'email', position: 'a2' },
  { id: 'p-tel', name: 'Tel', type: 'phone', position: 'a3' },
  { id: 'p-amount', name: 'Amount', type: 'number', position: 'a4' },
];

const rows = (): DatabaseRow[] => [
  { id: 'r1', position: 'a0', properties: { 'p-title': 'Alpha', 'p-link': 'https://example.com', 'p-mail': 'test@example.com', 'p-tel': '+1 555 0100', 'p-amount': 3 } },
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

const mount = (overrides: Partial<DatabaseTableViewOptions> = {}): { root: HTMLElement; view: DatabaseTableView } => {
  const readOnly = overrides.readOnly ?? false;
  const view = new DatabaseTableView({
    readOnly,
    i18n: { t: (key: string) => key } as DatabaseTableViewOptions['i18n'],
    view: { id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] },
    schema,
    rows: rows(),
    titlePropertyId: 'p-title',
    state: createTableState(),
    ...(readOnly ? { openRow: vi.fn() } : { handlers: makeHandlers() }),
    ...overrides,
  });
  const root = view.createView();

  document.body.appendChild(root);

  return { root, view };
};

const cell = (root: HTMLElement, rowId: string, propertyId: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(`[data-row-id="${rowId}"] [role="gridcell"][data-property-id="${propertyId}"]`);

  if (el === null) throw new Error(`no cell ${rowId}/${propertyId}`);

  return el;
};

const link = (root: HTMLElement, propertyId: string): HTMLAnchorElement => {
  const el = cell(root, 'r1', propertyId).querySelector<HTMLAnchorElement>('a[data-blok-database-cell-link]');

  if (el === null) throw new Error(`no link in ${propertyId}`);

  return el;
};

const actions = (el: HTMLElement): HTMLElement | null => el.querySelector<HTMLElement>('[data-blok-database-table-cell-actions]');

const action = (el: HTMLElement, label: string): HTMLButtonElement | null =>
  actions(el)?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? null;

const editorField = (): HTMLInputElement | null =>
  document.querySelector<HTMLInputElement>('[data-blok-database-cell-editor] [data-blok-database-cell-input]');

const clickOn = (target: Element): MouseEvent => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });

  target.dispatchEvent(event);

  return event;
};

describe('table URL, email and phone cells', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('a url shows without its scheme and links the full address in a new tab', () => {
    const { root } = mount();
    const a = link(root, 'p-link');

    expect(a.textContent).toBe('example.com');
    expect(a.getAttribute('href')).toBe('https://example.com');
    expect(a.target).toBe('_blank');
    expect(a.rel).toBe('noopener noreferrer');
  });

  it.each(['p-link', 'p-mail', 'p-tel'])('a click on the %s text follows the link and opens no editor', (propertyId) => {
    const { root } = mount();
    const event = clickOn(link(root, propertyId));

    expect(event.defaultPrevented).toBe(false);
    expect(editorField()).toBeNull();
    expect(root.querySelector('[data-blok-database-table-cell-anchor]')).toBeNull();
  });

  it('a click on the empty part of a url cell opens the editor holding the full value', () => {
    const { root } = mount();

    clickOn(cell(root, 'r1', 'p-link'));

    expect(editorField()?.value).toBe('https://example.com');
    expect(editorField()?.type).toBe('url');
  });

  it('Enter on a selected url cell opens the editor holding the full value', () => {
    const { root } = mount();
    const grid = root.querySelector<HTMLElement>('[role="grid"]') ?? root;

    clickOn(cell(root, 'r1', 'p-link'));
    editorField()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(editorField()).toBeNull();

    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(editorField()?.value).toBe('https://example.com');
  });

  it('read-only: a click on the link follows it and selects nothing', () => {
    const { root } = mount({ readOnly: true });
    const event = clickOn(link(root, 'p-link'));

    expect(event.defaultPrevented).toBe(false);
    expect(root.querySelector('[data-blok-database-table-cell-anchor]')).toBeNull();
  });

  describe('hover actions', () => {
    it.each(['p-link', 'p-mail', 'p-tel'])('a filled %s cell carries Comment and Copy to Clipboard', (propertyId) => {
      const { root } = mount({ comment: vi.fn() });

      expect(action(cell(root, 'r1', propertyId), 'tools.database.tableComment')).not.toBeNull();
      expect(action(cell(root, 'r1', propertyId), 'tools.database.cellCopy')).not.toBeNull();
    });

    it('an empty url cell and an empty number cell carry none', () => {
      const { root } = mount({ comment: vi.fn() });

      expect(actions(cell(root, 'r2', 'p-link'))).toBeNull();
      expect(actions(cell(root, 'r2', 'p-amount'))).toBeNull();
    });

    // notion-spec-2 §18.2, §19.6, §19.20: filled Text, Number and Formula cells show Comment + Copy too.
    describe('text, number and formula cells', () => {
      const more: PropertyDefinition[] = [
        ...schema,
        { id: 'p-notes', name: 'Notes', type: 'text', position: 'a5' },
        { id: 'p-calc', name: 'Calc', type: 'formula', position: 'a6', formula: { expression: '1 + 1' } },
        { id: 'p-word', name: 'Word', type: 'formula', position: 'a7', formula: { expression: '"hi"' } },
      ];
      const moreRows = (): DatabaseRow[] => [
        { ...rows()[0], properties: { ...rows()[0].properties, 'p-notes': 'hello' }, computed: { 'p-calc': 2, 'p-word': 'hi' } },
        { ...rows()[1], computed: { 'p-calc': null, 'p-word': null } },
      ];
      const valueProperty = (property: PropertyDefinition): PropertyDefinition => {
        if (property.id === 'p-calc') return { ...property, type: 'number' };
        if (property.id === 'p-word') return { ...property, type: 'text' };

        return property;
      };
      const mountMore = (): HTMLElement => mount({ comment: vi.fn(), schema: more, rows: moreRows(), cellContext: { valueProperty } }).root;

      it.each(['p-notes', 'p-amount', 'p-calc', 'p-word'])('a filled %s cell carries Comment and Copy to Clipboard', (propertyId) => {
        const root = mountMore();

        expect(action(cell(root, 'r1', propertyId), 'tools.database.tableComment')).not.toBeNull();
        expect(action(cell(root, 'r1', propertyId), 'tools.database.cellCopy')).not.toBeNull();
      });

      it.each(['p-notes', 'p-calc'])('an empty %s cell carries none', (propertyId) => {
        const root = mountMore();

        expect(actions(cell(root, 'r2', propertyId))).toBeNull();
      });

      it.each([['p-notes', 'hello'], ['p-calc', '2']])('Copy on a %s cell copies what the cell shows and opens no editor', async (propertyId, text) => {
        const writeText = vi.fn(() => Promise.resolve());

        vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
        const root = mountMore();

        clickOn(action(cell(root, 'r1', propertyId), 'tools.database.cellCopy') as HTMLButtonElement);
        await Promise.resolve();

        expect(writeText).toHaveBeenCalledWith(text);
        expect(editorField()).toBeNull();
        vi.unstubAllGlobals();
      });
    });

    // notion-spec-2 §18.2: what the box holds on the other filled types.
    describe('pill, people, files, relation, rollup and read-only cells', () => {
      const more: PropertyDefinition[] = [
        ...schema,
        { id: 'p-sel', name: 'Sel', type: 'select', position: 'b1', config: { options: [{ id: 'o1', label: 'Alpha', position: 'a0' }] } },
        { id: 'p-multi', name: 'Multi', type: 'multiSelect', position: 'b2', config: { options: [{ id: 'o1', label: 'Alpha', position: 'a0' }] } },
        { id: 'p-stat', name: 'Stat', type: 'status', position: 'b3', config: { options: [{ id: 'o1', label: 'Done', position: 'a0' }] } },
        { id: 'p-who', name: 'Who', type: 'person', position: 'b4' },
        { id: 'p-file', name: 'File', type: 'files', position: 'b5' },
        { id: 'p-rel', name: 'Rel', type: 'relation', position: 'b6', relation: { databaseId: 'db' } },
        { id: 'p-roll', name: 'Roll', type: 'rollup', position: 'b7', rollup: { relationPropertyId: 'p-rel', targetPropertyId: 'x', function: 'sum' } },
        { id: 'p-id', name: 'ID', type: 'uniqueId', position: 'b8' },
        { id: 'p-made', name: 'Made', type: 'createdTime', position: 'b9' },
        { id: 'p-by', name: 'By', type: 'createdBy', position: 'c1' },
        { id: 'p-done', name: 'Done', type: 'checkbox', position: 'c2' },
      ];
      const moreRows = (): DatabaseRow[] => [
        {
          ...rows()[0],
          properties: {
            ...rows()[0].properties,
            'p-sel': 'o1',
            'p-multi': ['o1'],
            'p-stat': 'o1',
            'p-who': [{ id: 'u1' }],
            'p-file': [{ id: 'f1', url: 'https://example.com/a.pdf', name: 'a.pdf' }],
            'p-id': 1,
            'p-done': true,
          },
          computed: { 'p-rel': [{ id: 'r2' }], 'p-roll': 42 },
          meta: { createdAt: Date.UTC(2026, 9, 28), createdBy: 'u1' },
        },
        rows()[1],
      ];
      const valueProperty = (property: PropertyDefinition): PropertyDefinition =>
        property.id === 'p-roll' ? { ...property, type: 'number' } : property;
      const mountMore = (overrides: Partial<DatabaseTableViewOptions> = {}): HTMLElement =>
        mount({ comment: vi.fn(), schema: more, rows: moreRows(), cellContext: { valueProperty, relationTitle: () => 'Beta' }, ...overrides }).root;
      const labels = (el: HTMLElement): string[] =>
        [...(actions(el)?.querySelectorAll('button') ?? [])].map((button) => button.getAttribute('aria-label') ?? '');

      it.each(['p-sel', 'p-multi', 'p-stat', 'p-who', 'p-file', 'p-rel'])('a filled %s cell carries Comment only', (propertyId) => {
        expect(labels(cell(mountMore(), 'r1', propertyId))).toEqual(['tools.database.tableComment']);
      });

      it.each(['p-sel', 'p-who', 'p-rel'])('without host comments a filled %s cell carries no box', (propertyId) => {
        expect(actions(cell(mountMore({ comment: undefined }), 'r1', propertyId))).toBeNull();
      });

      it.each(['p-id', 'p-made'])('a %s cell carries Copy only', (propertyId) => {
        expect(labels(cell(mountMore(), 'r1', propertyId))).toEqual(['tools.database.cellCopy']);
      });

      it.each(['p-by', 'p-done'])('a %s cell carries no box', (propertyId) => {
        expect(actions(cell(mountMore(), 'r1', propertyId))).toBeNull();
      });

      it('a filled rollup cell carries Configure rollup and Copy, and Configure opens its property settings', () => {
        const handlers = { ...makeHandlers(), editProperty: vi.fn() };
        const root = mountMore({ handlers });
        const target = cell(root, 'r1', 'p-roll');

        expect(labels(target)).toEqual(['tools.database.rollupConfigure', 'tools.database.cellCopy']);
        expect(actions(target)?.getAttribute('data-blok-database-table-cell-actions')).toBe('');

        clickOn(action(target, 'tools.database.rollupConfigure') as HTMLButtonElement);

        expect(handlers.editProperty).toHaveBeenCalledWith('p-roll');
        expect(editorField()).toBeNull();
      });

      it('read-only: a rollup cell carries Copy only', () => {
        expect(labels(cell(mountMore({ readOnly: true }), 'r1', 'p-roll'))).toEqual(['tools.database.cellCopy']);
      });

      it('empty pill and relation cells carry none', () => {
        const root = mountMore();

        expect(actions(cell(root, 'r2', 'p-sel'))).toBeNull();
        expect(actions(cell(root, 'r2', 'p-rel'))).toBeNull();
      });
    });

    it('without host comments there is no Comment button, Copy stays', () => {
      const { root } = mount();

      expect(action(cell(root, 'r1', 'p-link'), 'tools.database.tableComment')).toBeNull();
      expect(action(cell(root, 'r1', 'p-link'), 'tools.database.cellCopy')).not.toBeNull();
    });

    it('the buttons stay out of the tab order and carry no title tooltip', () => {
      const { root } = mount({ comment: vi.fn() });
      const buttons = [...(actions(cell(root, 'r1', 'p-link'))?.querySelectorAll('button') ?? [])];

      expect(buttons).toHaveLength(2);
      buttons.forEach((button) => {
        expect(button.tabIndex).toBe(-1);
        expect(button.hasAttribute('title')).toBe(false);
      });
    });

    it('Comment opens the host comments for that cell and no editor', () => {
      const comment = vi.fn();
      const { root } = mount({ comment });
      const target = cell(root, 'r1', 'p-mail');

      clickOn(action(target, 'tools.database.tableComment') as HTMLButtonElement);

      expect(comment).toHaveBeenCalledWith('r1', 'p-mail', target);
      expect(editorField()).toBeNull();
    });

    it.each([false, true])('Copy writes the full value and toasts (read-only %s), with no editor', async (readOnly) => {
      const writeText = vi.fn(() => Promise.resolve());

      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      const notify = vi.fn();
      const { root } = mount({ readOnly, notify });

      clickOn(action(cell(root, 'r1', 'p-link'), 'tools.database.cellCopy') as HTMLButtonElement);
      await Promise.resolve();
      await Promise.resolve();

      expect(writeText).toHaveBeenCalledWith('https://example.com');
      expect(notify).toHaveBeenCalledWith('tools.database.cellCopied');
      expect(editorField()).toBeNull();
      vi.unstubAllGlobals();
    });

    it('no toast when the clipboard refuses', async () => {
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) } });
      const notify = vi.fn();
      const { root } = mount({ notify });

      clickOn(action(cell(root, 'r1', 'p-tel'), 'tools.database.cellCopy') as HTMLButtonElement);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(notify).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });
});
