import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DatabaseTableView, createTableState } from '../../../../src/tools/database/database-table-view';
import type { TableHandlers, TableState, DatabaseTableViewOptions, TableGroup } from '../../../../src/tools/database/database-table-view';
import { calculationItems } from '../../../../src/tools/database/database-table-menus';
import { PROPERTY_TYPE_META } from '../../../../src/tools/database/database-property-types';
import { IconInfo, IconPeekSide, IconPlayerPlay, IconRowGrip } from '../../../../src/components/icons';
import { HINT_DELAY, destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { TOOLTIP_MUTED_INK } from '../../../../src/components/modules/toolbar/tooltip';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import { hover, shownHint } from './hint-harness';
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

    // Notion's title "Aa" is wider than its other header glyphs (m38-table.png), so the stylesheet sizes it by type.
    it('marks the title header icon with its property type', () => {
      const { root } = mount({});
      const icon = root.querySelector(`[role="columnheader"][data-property-id="${schema[0].id}"] [data-blok-database-table-column-icon]`);

      expect(schema[0].type).toBe('title');
      expect(icon?.getAttribute('data-type')).toBe('title');
    });

    // Notion's row grip is 8x16 (rowhover.png); the editor's block handle keeps IconMenu.
    it('draws the row handle with the tall row grip', () => {
      const { root } = mount({});
      const expected = document.createElement('span');

      expected.innerHTML = IconRowGrip;
      expect(root.querySelector('[data-blok-database-table-row-handle]')?.innerHTML).toBe(expected.innerHTML);
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

    // notion-spec-2 §21.3: a cut name shows the full NAME 6px below the chip; one that fits shows nothing. No link card.
    it('hovering a file chip whose name is cut shows the full name below it after the hint delay', () => {
      destroyTooltip();
      vi.useFakeTimers();
      try {
        const files: PropertyDefinition = { id: 'p-files', name: 'Files', type: 'files', position: 'a1' };
        const { root } = mount({
          schema: [schema[0], files],
          rows: [row('r1', 'Alpha', { 'p-files': [{ id: 'f1', name: 'Quarterly report for the whole team.pdf', url: 'https://example.com/a.pdf' }, { id: 'f2', name: 'b.png', url: 'https://example.com/b.png' }] })],
        });
        const [cut, fits] = [...cell(root, 'r1', 'p-files').querySelectorAll<HTMLElement>('[data-blok-database-file-chip]')];
        const link = cut.querySelector<HTMLElement>('[data-blok-database-cell-link]');

        if (link === null) throw new Error('no file link');
        // Core's link hover card and link click skip a link inside a link owner.
        expect(link.closest('[data-blok-link-owner]')).not.toBeNull();
        Object.defineProperty(link, 'scrollWidth', { configurable: true, value: 260 });
        Object.defineProperty(link, 'clientWidth', { configurable: true, value: 148 });

        const wrapper = (): Element | null => document.querySelector('[data-blok-testid="tooltip"]');

        hover(fits);
        vi.advanceTimersByTime(HINT_DELAY);
        expect(wrapper()?.getAttribute('data-blok-shown')).not.toBe('true');
        fits.dispatchEvent(new MouseEvent('mouseleave'));

        hover(cut);
        vi.advanceTimersByTime(HINT_DELAY - 1);
        expect(wrapper()?.getAttribute('data-blok-shown')).not.toBe('true');
        vi.advanceTimersByTime(1);
        expect(shownHint()).toEqual({ text: 'Quarterly report for the whole team.pdf', placement: 'bottom' });
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

    // notion-motion.md Round 28 §5: a darker line after the last frozen column, header included.
    it('marks the last frozen column, header included, as the frozen edge', () => {
      const view = tableView({ frozenColumnCount: 2, properties: [{ id: 'p-title', visible: true, width: 250 }, { id: 'p-notes', visible: true, width: 100 }] });
      const { root } = mount({ view });
      const header = root.querySelector('[role="columnheader"][data-property-id="p-notes"]');

      expect(cell(root, 'r1', 'p-notes').hasAttribute('data-frozen-edge')).toBe(true);
      expect(header?.hasAttribute('data-frozen-edge')).toBe(true);
      expect(cell(root, 'r1', 'p-title').hasAttribute('data-frozen-edge')).toBe(false);
      expect(cell(root, 'r1', 'p-amount').hasAttribute('data-frozen-edge')).toBe(false);
    });

    // notion-motion.md Round 28 §5: the frozen edge casts a shadow only while the table is scrolled sideways.
    it('marks the scroller while it is scrolled sideways, and clears it back at the start', () => {
      const view = tableView({ frozenColumnCount: 1 });
      const { root } = mount({ view });
      const scroller = root.querySelector<HTMLElement>('[data-blok-database-table-scroller]');

      if (scroller === null) throw new Error('no scroller');
      expect(scroller.hasAttribute('data-scrolled')).toBe(false);
      scroller.scrollLeft = 400;
      scroller.dispatchEvent(new Event('scroll'));
      expect(scroller.hasAttribute('data-scrolled')).toBe(true);
      scroller.scrollLeft = 0;
      scroller.dispatchEvent(new Event('scroll'));
      expect(scroller.hasAttribute('data-scrolled')).toBe(false);
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

    // notion-motion.md Round 29 §1: one full-width row, the ↓ icon and "Load more", then a ⋯ for the load limit.
    it('draws Load more as a row with the down arrow, the label and a ⋯ that sets the load limit', () => {
      const many = Array.from({ length: 12 }, (_, i) => row(`r${String(i).padStart(2, '0')}`, `Row ${i}`));
      const setLoadLimit = vi.fn();
      const { root, state } = mount({ rows: many, view: tableView({ loadLimit: 10 }), handlers: { ...makeHandlers(), setLoadLimit } });
      const line = root.querySelector<HTMLElement>('[data-blok-database-table-load-more-row]');
      const more = line?.querySelector<HTMLElement>('[data-blok-database-table-load-more]');
      const dots = line?.querySelector<HTMLElement>('[data-blok-database-table-load-limit-menu]');

      expect(more?.textContent?.trim()).toBe('tools.database.tableLoadMore');
      expect(more?.querySelector('svg')).not.toBeNull();
      expect(dots?.getAttribute('aria-label')).toBe('tools.database.settingsLoadLimit');
      expect(more?.contains(dots ?? null)).toBe(false);

      dots?.click();
      expect(state.loaded.has('')).toBe(false);
      const heading = document.querySelector('[data-blok-database-load-limit-heading]');
      const options = [10, 25, 50, 100].map((n) => document.querySelector<HTMLElement>(`[data-blok-item-name="database-load-limit-${n}"]`));

      expect(heading?.textContent).toBe('tools.database.tableShowOnFirstLoad');
      expect(options.map((item) => item?.textContent?.trim())).toEqual([10, 25, 50, 100].map((n) => `tools.database.settingsLoadLimitPages:${n}`));
      expect(options[0]?.hasAttribute('data-blok-popover-item-active')).toBe(true);
      expect(options[0]?.querySelector('[data-blok-testid="popover-item-trailing-icon"] svg')).not.toBeNull();
      expect(options[1]?.hasAttribute('data-blok-popover-item-active')).toBe(false);

      options[1]?.click();
      expect(setLoadLimit).toHaveBeenCalledWith(25);
    });

    // notion-motion.md Round 30 §3: the menu opens 8px below the ⋯, its right edge on the ⋯'s right edge.
    it('opens the load limit menu 8px below the ⋯ with their right edges aligned', () => {
      const many = Array.from({ length: 12 }, (_, i) => row(`r${String(i).padStart(2, '0')}`, `Row ${i}`));
      const { root } = mount({ rows: many, view: tableView({ loadLimit: 10 }), handlers: { ...makeHandlers(), setLoadLimit: vi.fn() } });
      const dots = root.querySelector<HTMLElement>('[data-blok-database-table-load-limit-menu]');

      if (dots === null) throw new Error('no ⋯');
      Object.defineProperty(dots, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left: 651, right: 675, top: 300, bottom: 324, width: 24, height: 24, x: 651, y: 300, toJSON: () => ({}) }),
      });
      dots.click();
      const menu = document.querySelector<HTMLElement>('[data-blok-popover]');
      const width = menu?.offsetWidth ?? 0;

      expect(menu?.style.top).toBe('332px');
      expect(menu?.style.left).toBe(`${675 - width}px`);
      document.querySelector<HTMLElement>('[data-blok-item-name="database-load-limit-10"]')?.click();
    });

    it('keeps Load more but leaves out the ⋯ when the view cannot change its load limit', () => {
      const many = Array.from({ length: 12 }, (_, i) => row(`r${String(i).padStart(2, '0')}`, `Row ${i}`));
      const { root } = mount({ rows: many, view: tableView({ loadLimit: 10 }) });

      expect(root.querySelector('[data-blok-database-table-load-more]')).not.toBeNull();
      expect(root.querySelector('[data-blok-database-table-load-limit-menu]')).toBeNull();
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

    // notion-motion.md Round 10 (r10-calc-none-*.raw): with no calculation set there is no footer row at all;
    // the column header menu sets the first one.
    it('draws no footer row while no shown column is calculated, with rows or without', () => {
      expect(mount().root.querySelector('[data-blok-database-table-footer]')).toBeNull();
      expect(mount({ rows: [] }).root.querySelector('[data-blok-database-table-footer]')).toBeNull();
      expect(mount({ view: tableView({ properties: [{ id: 'p-amount', visible: false }], calculations: [{ id: 'p-amount', fn: 'sum' }] }) })
        .root.querySelector('[data-blok-database-table-footer]')).toBeNull();
      expect(mount({ rows: [], view: tableView({ calculations: [{ id: 'p-amount', fn: 'sum' }] }) })
        .root.querySelector('[data-blok-database-table-footer]')).not.toBeNull();
    });

    it('renders a calculation footer and leaves empty footer cells marked', () => {
      const view = tableView({ calculations: [{ id: 'p-amount', fn: 'sum' }] });
      const { root } = mount({ view });
      const footerCell = (id: string): HTMLElement | null => root.querySelector<HTMLElement>(`[data-blok-database-table-calc][data-property-id="${id}"]`);

      expect(footerCell('p-amount')?.querySelector('[data-blok-database-table-calc-value]')?.textContent).toBe('1235.5');
      expect(footerCell('p-amount')?.querySelector('[data-blok-database-table-calc-label]')?.textContent).toBe('tools.database.calcSum');
      expect(footerCell('p-notes')?.hasAttribute('data-empty')).toBe(true);
    });

    // notion-motion.md Round 11 "Footer labels, every function": the footer names a function shorter than its menu item,
    // and a percent takes its count's label.
    it.each([
      ['p-amount', 'count', 'tools.database.calcCount'],
      ['p-amount', 'count_values', 'tools.database.calcFooterCountValues'],
      ['p-amount', 'unique', 'tools.database.calcFooterUnique'],
      ['p-amount', 'empty', 'tools.database.calcFooterEmpty'],
      ['p-amount', 'not_empty', 'tools.database.calcFooterNotEmpty'],
      ['p-amount', 'percent_empty', 'tools.database.calcFooterEmpty'],
      ['p-amount', 'percent_not_empty', 'tools.database.calcFooterNotEmpty'],
      ['p-amount', 'sum', 'tools.database.calcSum'],
      ['p-amount', 'average', 'tools.database.calcAverage'],
      ['p-amount', 'median', 'tools.database.calcMedian'],
      ['p-amount', 'min', 'tools.database.calcMin'],
      ['p-amount', 'max', 'tools.database.calcMax'],
      ['p-amount', 'range', 'tools.database.calcRange'],
      ['p-done', 'checked', 'tools.database.calcChecked'],
      ['p-done', 'unchecked', 'tools.database.calcUnchecked'],
      ['p-done', 'percent_checked', 'tools.database.calcChecked'],
      ['p-done', 'percent_unchecked', 'tools.database.calcUnchecked'],
      ['p-when', 'earliest_date', 'tools.database.calcFooterEarliest'],
      ['p-when', 'latest_date', 'tools.database.calcFooterLatest'],
      ['p-when', 'date_range', 'tools.database.calcRange'],
    ] as const)('labels a %s %s footer %s', (id, fn, key) => {
      const withDate = [...schema, { id: 'p-when', name: 'When', type: 'date' as const, position: 'a5' }];
      const { root } = mount({ schema: withDate, view: tableView({ calculations: [{ id, fn }] }) });
      const label = root.querySelector(`[data-blok-database-table-calc][data-property-id="${id}"] [data-blok-database-table-calc-label]`);

      expect(label?.textContent).toBe(key);
    });

    // notion-motion.md Round 11: "Percents show 3 decimals (33.333%)".
    it('shows a percent with up to 3 decimals', () => {
      const { root } = mount({ view: tableView({ calculations: [{ id: 'p-done', fn: 'percent_checked' }] }) });
      const value = root.querySelector('[data-blok-database-table-calc][data-property-id="p-done"] [data-blok-database-table-calc-value]');

      expect(value?.textContent).toBe('33.333%');
    });

    // research/21 §1d: the hover fills a 70x21 box around the label and value, not the cell.
    it('puts a footer cell\'s label and value, or its Calculate prompt, in one box', () => {
      const { root } = mount({ view: tableView({ calculations: [{ id: 'p-amount', fn: 'sum' }] }) });
      const box = (id: string): Element | null | undefined =>
        root.querySelector(`[data-blok-database-table-calc][data-property-id="${id}"]`)?.firstElementChild;

      expect(box('p-amount')?.hasAttribute('data-blok-database-table-calc-box')).toBe(true);
      expect([...(box('p-amount')?.children ?? [])].map((el) => el.getAttributeNames().find((name) => name.startsWith('data-blok')))).toEqual([
        'data-blok-database-table-calc-label',
        'data-blok-database-table-calc-value',
      ]);
      expect(box('p-notes')?.hasAttribute('data-blok-database-table-calc-box')).toBe(true);
      expect(box('p-notes')?.firstElementChild?.hasAttribute('data-blok-database-table-calc-placeholder')).toBe(true);
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

    // notion-motion.md Round 29 §3: in an editor, Shift+Tab commits and selects the cell to the left.
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

    describe('selection bar fade-out (notion-motion.md Round 16 §2)', () => {
      const LEAVING = '[data-blok-database-table-selection-bar-leaving]';
      const selectRow = (root: HTMLElement): void => {
        cell(root, 'r1', 'p-notes').click();
        press(editorField(), 'Escape');
        press(grid(root), 'Escape');
      };

      afterEach(() => {
        vi.useRealTimers();
      });

      it('drops the property buttons, fades the rest out for 200ms, then removes it', () => {
        vi.useFakeTimers();
        const slot = document.createElement('div');

        document.body.appendChild(slot);
        const { root } = mount({ selectionBarSlot: () => slot });

        selectRow(root);
        press(grid(root), 'Escape');
        const leaving = slot.querySelector<HTMLElement>(LEAVING);

        expect(leaving).not.toBeNull();
        expect(leaving?.querySelector('[data-blok-database-table-selection-property]')).toBeNull();
        expect(leaving?.querySelector('[data-blok-database-table-selection-count]')).not.toBeNull();
        expect(leaving?.querySelector('[data-blok-database-table-selection-delete]')).not.toBeNull();
        expect(leaving?.querySelector('[data-blok-database-table-selection-more]')).not.toBeNull();
        expect(leaving?.getAttribute('aria-hidden')).toBe('true');
        expect(slot.querySelector('[data-blok-database-table-selection-bar]')).toBeNull();
        expect(slot.hasAttribute('data-blok-database-selecting')).toBe(false);

        vi.advanceTimersByTime(199);
        expect(slot.querySelector(LEAVING)).not.toBeNull();
        vi.advanceTimersByTime(1);
        expect(slot.querySelector(LEAVING)).toBeNull();
      });

      it('goes at once under reduced motion', () => {
        vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
        const slot = document.createElement('div');

        document.body.appendChild(slot);
        const { root } = mount({ selectionBarSlot: () => slot });

        selectRow(root);
        press(grid(root), 'Escape');

        expect(slot.querySelector(LEAVING)).toBeNull();
        expect(slot.querySelector('[data-blok-database-table-selection-bar]')).toBeNull();
        vi.unstubAllGlobals();
      });

      it('a new selection while the old bar fades shows only one bar', () => {
        vi.useFakeTimers();
        const slot = document.createElement('div');

        document.body.appendChild(slot);
        const { root } = mount({ selectionBarSlot: () => slot });

        selectRow(root);
        press(grid(root), 'Escape');
        selectRow(root);

        expect(slot.querySelector(LEAVING)).toBeNull();
        expect(slot.querySelectorAll('[data-blok-database-table-selection-bar]')).toHaveLength(1);
      });

      it('destroy removes a fading bar at once', () => {
        vi.useFakeTimers();
        const slot = document.createElement('div');

        document.body.appendChild(slot);
        const { root, view } = mount({ selectionBarSlot: () => slot });

        selectRow(root);
        press(grid(root), 'Escape');
        view.destroy();

        expect(slot.querySelector(LEAVING)).toBeNull();
      });
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

    // notion-motion.md Round 29 §3: Shift+Tab on a selected cell is swallowed and the selection stays.
    it('Tab moves right; Shift+Tab on a selected cell keeps the selection where it is', () => {
      const { root } = mount();

      selectCell(root, 'r1', 'p-amount');
      press(grid(root), 'Tab');
      expect(anchorCell(root)).toBe('r1/p-stage');
      const event = press(grid(root), 'Tab', { shiftKey: true });

      expect(selectedCells(root)).toEqual(['r1/p-stage']);
      expect(anchorCell(root)).toBe('r1/p-stage');
      expect(event.defaultPrevented).toBe(true);
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

    // Nothing calls onClose when no editor opens, so the table must free itself.
    it.each([
      ['a Person cell with no people source', 'person'],
      ['a cell of a type this client does not know', 'hologram'],
    ])('clicking %s opens nothing and leaves the table free to redraw', (_label, type: string) => {
      const { root, view } = mount({
        schema: [schema[0], { id: 'p-x', name: 'X', type: type as PropertyType, position: 'b0' }],
        rows: [row('r1', 'Alpha')],
      });

      cell(root, 'r1', 'p-x').click();

      expect(view.interacting).toBe(false);
      expect(editor()).toBeNull();
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

    // notion-motion.md Round 30 §4: Shift+click on another cell selects that row; it does not extend a range.
    it('Shift+click on a cell selects its row, not a range', () => {
      const { root } = mount();
      const rowsSelected = (): Array<string | null> =>
        [...root.querySelectorAll('[data-blok-database-table-row][aria-selected="true"]')].map((el) => el.getAttribute('data-row-id'));

      selectCell(root, 'r1', 'p-notes');
      cell(root, 'r2', 'p-amount').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));

      expect(rowsSelected()).toEqual(['r2']);
      expect(selectedCells(root)).toEqual([]);
      expect(editor()).toBeNull();
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

    // notion-live-7/33-open-hover.png, notion-live-8/62-close-hover.png: a box with its right half filled.
    it('the OPEN button shows the side-peek icon before its label', () => {
      const { root } = mount();
      const open = root.querySelector('[data-row-id="r1"] [data-blok-database-table-open]');

      const expected = document.createElement('span');

      expected.innerHTML = IconPeekSide;
      expect(open?.firstElementChild?.innerHTML).toBe(expected.innerHTML);
      expect(open?.lastElementChild?.textContent).toBe('tools.database.tableOpen');
    });

    // notion-motion.md Round 28 §1 (r28-narrowpill-threshold.raw): the title column shows the icon pill at 100 and OPEN
    // from 102, whatever the label's width (Notion's 102 OPEN overlaps the title). 101 is unread; Blok counts it as narrow.
    describe('narrow title column', () => {
      const sized = (root: HTMLElement, cellWidth: number): HTMLElement => {
        const titleCell = cell(root, 'r1', 'p-title');
        const open = titleCell.querySelector<HTMLElement>('[data-blok-database-table-open]');

        if (open === null) {
          throw new Error('no OPEN');
        }
        vi.spyOn(titleCell, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, cellWidth, 37));

        return open;
      };
      const over = (target: Element): void => {
        target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      };

      it.each([100, 101])('turns OPEN into the icon pill in a %ipx title column', (width) => {
        const { root } = mount();
        const open = sized(root, width);

        over(cell(root, 'r1', 'p-notes'));
        expect(open.hasAttribute('data-compact')).toBe(true);
        expect(open.lastElementChild?.textContent).toBe('tools.database.tableOpen');
      });

      // A labelled button that fits with the 6px end inset keeps its label from 102.
      it('keeps the label from 102 when the labelled button fits', () => {
        const { root } = mount();
        const open = sized(root, 102);

        vi.spyOn(open, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, open.hasAttribute('data-compact') ? 30 : 96, 24));
        over(cell(root, 'r1', 'p-title'));
        expect(open.hasAttribute('data-compact')).toBe(false);
      });

      // Hungarian's labelled OPEN is 108 wide: at 102 it would spill past the cell's start edge.
      it('turns into the icon pill at 102 when the labelled button would spill past the cell', () => {
        const { root } = mount();
        const open = sized(root, 102);

        vi.spyOn(open, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, open.hasAttribute('data-compact') ? 30 : 108, 24));
        over(cell(root, 'r1', 'p-title'));
        expect(open.hasAttribute('data-compact')).toBe(true);
      });

      it('fits again when the pointer leaves the table and comes back to the same row', () => {
        const { root } = mount();
        const open = sized(root, 102);

        over(cell(root, 'r1', 'p-title'));
        expect(open.hasAttribute('data-compact')).toBe(false);
        sized(root, 100);
        grid(root).dispatchEvent(new PointerEvent('pointerleave'));
        over(cell(root, 'r1', 'p-title'));
        expect(open.hasAttribute('data-compact')).toBe(true);
      });

      it('fits the selected title cell too, where OPEN shows without a hover', () => {
        const { root } = mount();
        const open = sized(root, 100);

        selectCell(root, 'r1', 'p-title');
        expect(open.hasAttribute('data-compact')).toBe(true);
      });

      it('measures the selected title cell once, not on every repaint of the same selection', () => {
        const { root } = mount();
        const open = sized(root, 100);
        const titleCell = cell(root, 'r1', 'p-title');

        selectCell(root, 'r1', 'p-title');
        const reads = vi.mocked(titleCell.getBoundingClientRect).mock.calls.length;

        expect(reads).toBeGreaterThan(0);
        // A range grows and shrinks; the anchor stays on the title cell, and each step repaints.
        press(grid(root), 'ArrowRight', { shiftKey: true });
        press(grid(root), 'ArrowLeft', { shiftKey: true });
        expect(titleCell.hasAttribute('data-blok-database-table-cell-anchor')).toBe(true);
        expect(vi.mocked(titleCell.getBoundingClientRect).mock.calls.length).toBe(reads);
        expect(open.hasAttribute('data-compact')).toBe(true);
      });
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

    // notion-motion.md Round 27 §3 "Column resize": min width 100, for the title column and the others.
    it('a resize stops at 100 however far the pointer goes', () => {
      const { root, handlers } = mount();
      const handle = header(root, 'p-notes').querySelector<HTMLElement>('[data-blok-database-table-resize]');

      if (handle === null) {
        throw new Error('no handle');
      }
      pointer(handle, 'pointerdown', 300);
      pointer(document, 'pointermove', 0);

      expect(header(root, 'p-notes').style.width).toBe('100px');
      pointer(document, 'pointerup', 0);
      expect(vi.mocked(handlers.updateView).mock.calls[0][0].properties?.find((p) => p.id === 'p-notes')?.width).toBe(100);
    });

    it('a saved width under 100 draws at 100 and is not rewritten', () => {
      const { root, handlers } = mount({ view: tableView({ properties: [{ id: 'p-title', visible: true, width: 40 }, { id: 'p-notes', visible: true, width: 50 }] }) });

      expect(header(root, 'p-title').style.width).toBe('100px');
      expect(header(root, 'p-notes').style.width).toBe('100px');
      expect(cell(root, 'r1', 'p-notes').style.width).toBe('100px');
      expect(handlers.updateView).not.toHaveBeenCalled();
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

    // notion-motion.md "Column header drag": only the header row moves, and the other headers slide aside.
    describe('drag', () => {
      const lay = (root: HTMLElement): HTMLElement[] => {
        const headers = [...root.querySelectorAll<HTMLElement>('[role="columnheader"][data-property-id]')];

        headers.forEach((el, i) => vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(i * 200, 0, 200, 36)));

        return headers;
      };

      it('slides the headers between the start and the pointer aside by the dragged width, and leaves the body alone', () => {
        const { root } = mount();
        const headers = lay(root);

        pointer(header(root, 'p-notes'), 'pointerdown', 250, 10);
        pointer(document, 'pointermove', 560, 10);

        expect(header(root, 'p-amount').style.transform).toBe('translateX(-200px)');
        expect(header(root, 'p-title').style.transform).toBe('');
        expect(headers.slice(3).every((el) => el.style.transform === '')).toBe(true);
        expect(header(root, 'p-notes').hasAttribute('data-dragging')).toBe(true);
        expect(cell(root, 'r1', 'p-amount').style.transform).toBe('');
        expect(root.querySelector('[data-blok-database-table-column-drop-line]')).toBeNull();
        expect(document.querySelector('[data-blok-database-table-column-ghost]')).not.toBeNull();
        pointer(document, 'pointerup', 560, 10);
      });

      it('slides headers the other way when the drag goes left, and puts them back on release', () => {
        const { root, handlers } = mount();

        lay(root);
        pointer(header(root, 'p-amount'), 'pointerdown', 450, 10);
        pointer(document, 'pointermove', 250, 10);

        expect(header(root, 'p-notes').style.transform).toBe('translateX(200px)');

        pointer(document, 'pointerup', 250, 10);

        expect(header(root, 'p-notes').style.transform).toBe('');
        expect(header(root, 'p-amount').hasAttribute('data-dragging')).toBe(false);
        expect(vi.mocked(handlers.updateView).mock.lastCall?.[0].properties?.map((p) => p.id).slice(0, 3)).toEqual(['p-title', 'p-amount', 'p-notes']);
      });

      // notion-motion.md Round 27 §3 "Column drag": after Escape and mouseup the order stayed.
      it('Escape cancels the drag: the headers go back, the release writes nothing and opens no menu', () => {
        const { root, handlers } = mount();
        const outside = vi.fn();

        lay(root);
        document.addEventListener('keydown', outside);
        pointer(header(root, 'p-amount'), 'pointerdown', 450, 10);
        pointer(document, 'pointermove', 250, 10);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

        expect(header(root, 'p-notes').style.transform).toBe('');
        expect(header(root, 'p-amount').hasAttribute('data-dragging')).toBe(false);
        expect(document.querySelector('[data-blok-database-table-column-ghost]')).toBeNull();
        expect(outside).not.toHaveBeenCalled();

        pointer(document, 'pointermove', 100, 10);
        pointer(header(root, 'p-amount'), 'pointerup', 100, 10);
        header(root, 'p-amount').querySelector<HTMLElement>('[data-blok-database-table-column-button]')?.click();

        expect(handlers.updateView).not.toHaveBeenCalled();
        expect(handlers.openPropertyMenu).not.toHaveBeenCalled();
        document.removeEventListener('keydown', outside);
      });

      it('a cancelled pointer after Escape leaves the next click alone', async () => {
        const { root, handlers } = mount();

        lay(root);
        pointer(header(root, 'p-amount'), 'pointerdown', 450, 10);
        pointer(document, 'pointermove', 250, 10);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        pointer(document, 'pointercancel', 250, 10);
        await new Promise((resolve) => setTimeout(resolve, 0));
        pointer(header(root, 'p-notes'), 'pointerup', 250, 10);
        header(root, 'p-notes').querySelector<HTMLElement>('[data-blok-database-table-column-button]')?.click();

        expect(handlers.openPropertyMenu).toHaveBeenCalledWith('p-notes', header(root, 'p-notes'));
      });
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

    // notion-motion.md Round 9 (r9-group-header-open.raw): Notion's table group header shows no count.
    it('draws one section per group with its rows and no count', () => {
      const { root } = mount({ groups: groups() });
      const sections = [...root.querySelectorAll('[data-blok-database-table-group]')];

      expect(sections.map((el) => el.getAttribute('data-group-key'))).toEqual(['o-idea', '__none__']);
      expect(sections[1].querySelector('[data-blok-database-table-group-header]')?.textContent?.trim()).toBe('No Stage');
      expect(sections[1].querySelectorAll('[data-blok-database-table-row]')).toHaveLength(2);
    });

    it('draws the group caret as a filled triangle, like Notion (research/07:85)', () => {
      const { root } = mount({ groups: groups() });
      const caret = root.querySelector<HTMLElement>('[data-blok-database-table-group-toggle]');

      const expected = document.createElement('span');

      expected.innerHTML = IconPlayerPlay;
      expect(caret?.innerHTML).toBe(expected.innerHTML);
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

    // notion-motion.md Round 10 "Group header ⋯ menu": each group header holds its own ⋯ and +.
    it('the group header ⋯ opens that group\'s menu from its own header', () => {
      const handlers = { ...makeHandlers(), groupMenu: vi.fn(), addGroupPage: vi.fn() };
      const { root } = mount({ groups: groups(), handlers });
      const header = root.querySelector<HTMLElement>('[data-group-key="__none__"] [data-blok-database-table-group-header]');
      const more = header?.querySelector<HTMLElement>('[data-blok-database-table-group-menu]');

      more?.click();

      expect(handlers.groupMenu).toHaveBeenCalledWith('__none__', more, header);
      expect(more?.getAttribute('aria-haspopup')).toBe('menu');
    });

    // Round 10 "Group header +": a page at the end of that group, opened in the peek.
    it('the group header + adds a page to that group', () => {
      const handlers = { ...makeHandlers(), groupMenu: vi.fn(), addGroupPage: vi.fn() };
      const { root } = mount({ groups: groups(), handlers });

      root.querySelector<HTMLElement>('[data-group-key="o-idea"] [data-blok-database-table-group-header] [data-blok-database-table-group-add]')?.click();

      expect(handlers.addGroupPage).toHaveBeenCalledWith('o-idea');
      expect(handlers.addRow).not.toHaveBeenCalled();
    });

    it('draws no ⋯ or + where the host offers no group actions, or read-only', () => {
      expect(mount({ groups: groups() }).root.querySelector('[data-blok-database-table-group-actions]')).toBeNull();
      expect(mount({ groups: groups(), readOnly: true, handlers: { ...makeHandlers(), groupMenu: vi.fn(), addGroupPage: vi.fn() } })
        .root.querySelector('[data-blok-database-table-group-actions]')).toBeNull();
    });

    it('repeats the column header row at the top of each group, like Notion', () => {
      const { root } = mount({ groups: groups() });
      const sections = [...root.querySelectorAll('[data-blok-database-table-group]')];

      expect(grid(root).querySelectorAll(':scope > [data-blok-database-table-header]')).toHaveLength(0);
      for (const section of sections) {
        const content = section.querySelector('[data-blok-database-table-group-content]');
        const header = content?.firstElementChild;

        expect(header?.hasAttribute('data-blok-database-table-header')).toBe(true);
        expect([...(header?.querySelectorAll('[role="columnheader"]') ?? [])].map((el) => el.getAttribute('data-property-id')))
          .toEqual(['p-title', 'p-notes', 'p-amount', 'p-stage', 'p-done']);
        expect(header?.hasAttribute('aria-rowindex')).toBe(false);
      }
    });

    it('a collapsed group hides its header row and opening it brings the row back', () => {
      const { root } = mount({ groups: groups() });
      const section = root.querySelector<HTMLElement>('[data-blok-database-table-group][data-group-key="__none__"]');
      const toggle = section?.querySelector<HTMLElement>('[data-blok-database-table-group-toggle]');

      toggle?.click();
      expect(section?.querySelectorAll('[data-blok-database-table-header]')).toHaveLength(0);
      toggle?.click();
      expect(section?.querySelectorAll('[data-blok-database-table-header]')).toHaveLength(1);
    });

    it('keeps one header row when no group is drawn', () => {
      const { root } = mount({ groups: [] });

      expect(root.querySelectorAll('[data-blok-database-table-header]')).toHaveLength(1);
    });

    it('a header in any group opens the property menu for its column', () => {
      const { root, handlers } = mount({ groups: groups() });
      const header = root.querySelector<HTMLElement>('[data-group-key="__none__"] [data-blok-database-table-column-header][data-property-id="p-notes"]');

      header?.click();
      expect(handlers.openPropertyMenu).toHaveBeenCalledWith('p-notes', header);
    });

    it('every group header checkbox follows the row selection', () => {
      const { root } = mount({ groups: groups() });

      root.querySelector<HTMLElement>('[data-row-id="r2"] [data-blok-database-table-row-checkbox]')?.click();
      const boxes = [...root.querySelectorAll('[data-blok-database-table-select-all]')];

      expect(boxes).toHaveLength(2);
      expect(boxes.map((box) => box.getAttribute('aria-checked'))).toEqual(['mixed', 'mixed']);
    });

    it('resizing a column from a later group resizes it in every group', () => {
      const { root, handlers } = mount({ groups: groups() });
      const handle = root.querySelector<HTMLElement>('[data-group-key="__none__"] [data-blok-database-table-column-header][data-property-id="p-notes"] [data-blok-database-table-resize]');

      handle?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 100 }));
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 140 }));
      const widths = [...root.querySelectorAll<HTMLElement>('[data-blok-database-table-column-header][data-property-id="p-notes"]')].map((el) => el.style.width);

      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 140 }));
      expect(widths).toHaveLength(2);
      expect(new Set(widths).size).toBe(1);
      expect(handlers.updateView).toHaveBeenCalled();
    });

    it('draws no calculation footer in a group while nothing is calculated', () => {
      const { root } = mount({ groups: groups() });

      expect(root.querySelectorAll('[data-blok-database-table-group] [data-blok-database-table-footer]')).toHaveLength(0);
    });

    it('draws no group footer for a calculation on a hidden column', () => {
      const view = tableView({ properties: [{ id: 'p-amount', visible: false }], calculations: [{ id: 'p-amount', fn: 'sum' }] });
      const { root } = mount({ groups: groups(), view });

      expect(root.querySelectorAll('[data-blok-database-table-group] [data-blok-database-table-footer]')).toHaveLength(0);
    });

    it('gives each group its footer once a shown column is calculated', () => {
      const { root } = mount({ groups: groups(), view: tableView({ calculations: [{ id: 'p-amount', fn: 'sum' }] }) });
      const footers = [...root.querySelectorAll('[data-blok-database-table-group] [data-blok-database-table-footer]')];

      expect(footers).toHaveLength(2);
      expect(footers[0].querySelector('[data-property-id="p-amount"] [data-blok-database-table-calc-value]')?.textContent).toBe('1200');
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

    // research/36 §6: Notion's row handle › Move to Trash shows the "Moved to Trash" toast.
    it('the row menu\'s Move to Trash asks for the toast', () => {
      const { root, handlers } = mount();

      root.querySelector<HTMLElement>('[data-row-id="r1"] [data-blok-database-table-row-handle]')?.click();
      document.querySelector<HTMLElement>('[data-blok-popover-custom-class~="blok-database-row-menu"] [data-blok-item-name="database-row-delete"]')?.click();

      expect(handlers.deleteRows).toHaveBeenCalledWith(['r1'], true);
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

    // notion-motion.md Round 9 "Row drag" (r9-rowdrag-mid.raw): the 4px line's top sits on the row boundary, not centred on it.
    it('puts the drop line\'s top on the row boundary', () => {
      const { root } = mount();
      const rowEls = [...root.querySelectorAll<HTMLElement>('[data-blok-database-table-row]')];

      rowEls.forEach((el, i) => vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(i * 37)));
      rowEls[0].querySelector<HTMLElement>('[data-blok-database-table-row-handle]')
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 10, button: 0 }));
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 5, clientY: 60 }));

      expect(root.querySelector<HTMLElement>('[data-blok-database-table-drop-line]')?.style.top).toBe('74px');
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 5, clientY: 60 }));
    });

    // Notion's row ghost moves sideways with the pointer (notion-live/rowdrag-mid.png: +74px).
    it('moves the row ghost sideways with the pointer, keeping the press offset', () => {
      const { root } = mount();
      const rowEls = [...root.querySelectorAll<HTMLElement>('[data-blok-database-table-row]')];

      rowEls.forEach((el, i) => vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ ...rect(i * 37), left: 40, x: 40 }));
      rowEls[0].querySelector<HTMLElement>('[data-blok-database-table-row-handle]')
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 10, button: 0 }));
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 200, clientY: 60 }));

      const ghost = document.querySelector<HTMLElement>('[data-blok-database-table-row-ghost]');

      expect(ghost?.style.left).toBe('190px');
      expect(ghost?.style.top).toBe('50px');
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 200, clientY: 60 }));
    });

    // notion-motion.md "Table row drag": pressing ⋮⋮ selects the row, so the selection bar shows during the drag.
    it('selects the row on a press of ⋮⋮, before it moves', () => {
      const { root } = mount();

      root.querySelector<HTMLElement>('[data-row-id="r2"] [data-blok-database-table-row-handle]')
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 50, button: 0 }));

      expect(root.querySelector('[data-row-id="r2"]')?.getAttribute('aria-selected')).toBe('true');
      expect(root.querySelector('[data-blok-database-table-selection-count]')?.textContent).toBe('tools.database.tableSelectedCount:1');
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 5, clientY: 50 }));
    });

    it('keeps a selection of several rows when one of them is pressed', () => {
      const { root } = mount();
      const checkbox = (id: string): HTMLElement | null => root.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-blok-database-table-row-checkbox]`);

      checkbox('r1')?.click();
      checkbox('r2')?.click();
      root.querySelector<HTMLElement>('[data-row-id="r2"] [data-blok-database-table-row-handle]')
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 50, button: 0 }));

      expect(root.querySelector('[data-blok-database-table-selection-count]')?.textContent).toBe('tools.database.tableSelectedCount:2');
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 5, clientY: 50 }));
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
      const { root, view } = mount({ view: tableView({ calculations: [{ id: 'p-amount', fn: 'sum' }] }) });

      root.querySelector<HTMLElement>('[data-blok-database-table-calc][data-property-id="p-amount"]')?.click();
      expect(document.querySelector('[data-blok-popover-opened], [data-blok-popover]')).not.toBeNull();

      view.destroy();
      await Promise.resolve();

      expect(document.querySelector('[data-blok-popover-opened]')).toBeNull();
    });

    // notion-motion.md Round 11: a set value's menu is 200 wide. Its place on the box is checked in
    // database-calc-footer-offsets.spec.ts; the footer button is the trigger, so Escape can focus it.
    it('opens a set value\'s menu 200 wide, with the footer button as its trigger', () => {
      const { root } = mount({ view: tableView({ calculations: [{ id: 'p-amount', fn: 'sum' }] }) });
      const calc = root.querySelector<HTMLElement>('[data-blok-database-table-calc][data-property-id="p-amount"]');
      const box = calc?.querySelector<HTMLElement>('[data-blok-database-table-calc-box]');

      box?.click();

      expect(calc?.hasAttribute('data-popover-open')).toBe(true);
      expect(document.querySelector<HTMLElement>('[data-blok-popover-custom-class~="blok-database-header-menu"]')?.style.getPropertyValue('--width')).toBe('200px');
    });

    // notion-motion.md Round 12 "Escape in calculation menus": Escape 1 closes the submenu, Escape 2 the menu,
    // and focus goes back to the footer button.
    it('Escape closes the open submenu first, then the menu, and hands focus back to the footer button', () => {
      const { root } = mount({ view: tableView({ calculations: [{ id: 'p-amount', fn: 'sum' }] }) });
      const calc = root.querySelector<HTMLElement>('[data-blok-database-table-calc][data-property-id="p-amount"]');
      const opened = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-blok-popover-opened="true"]')];

      calc?.querySelector<HTMLElement>('[data-blok-database-table-calc-box]')?.click();
      [...document.querySelectorAll<HTMLElement>('[data-blok-popover-item]')].find((el) => el.textContent?.includes('tools.database.calcMoreOptions'))?.click();
      expect(document.querySelector('[data-blok-nested] [data-blok-popover-item]')?.textContent).toContain('tools.database.calcSum');
      document.querySelector<HTMLElement>('[data-blok-nested] [data-blok-popover-item]')?.focus();

      PopoverRegistry.instance.closeTopmost();
      expect(document.querySelector('[data-blok-nested] [data-blok-popover-item]')).toBeNull();
      expect(opened()).toHaveLength(1);

      PopoverRegistry.instance.closeTopmost();
      expect(opened()).toHaveLength(0);
      expect(calc).toHaveFocus();
    });

    // notion-motion.md Round 11: 200x123. The calc class drops the last row's 1px gap (database.css).
    it('marks the footer menu as a calculation menu', () => {
      const { root } = mount({ view: tableView({ calculations: [{ id: 'p-amount', fn: 'sum' }] }) });

      root.querySelector<HTMLElement>('[data-blok-database-table-calc][data-property-id="p-amount"] [data-blok-database-table-calc-box]')?.click();

      expect(document.querySelector('[data-blok-popover-custom-class~="blok-database-calc-menu"]')).not.toBeNull();
    });

    // r11-calc-count-sub.png and r11-group-agg-menu.raw: the Count list is 250 wide.
    it('opens the Count list 250 wide', () => {
      const items = calculationItems({ type: 'number' }, undefined, { t: (key: string) => key }, vi.fn()) as Array<{ title?: string; children?: { width?: string } }>;

      expect(items.find((item) => item.title === 'tools.database.calcCount')?.children?.width).toBe('250px');
    });

    // notion-motion.md Round 11 "Read-only database": no "Calculate" node exists in a locked table's footer.
    it('read-only: an empty footer cell holds no Calculate, a set one keeps its value', () => {
      const { root } = mount({ readOnly: true, view: tableView({ calculations: [{ id: 'p-amount', fn: 'sum' }] }) });

      expect(root.querySelector('[data-blok-database-table-calc-placeholder]')).toBeNull();
      expect(root.querySelector('[data-blok-database-table-calc][data-property-id="p-amount"] [data-blok-database-table-calc-value]')?.textContent).toBe('1235.5');
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
        undefined,
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

    // The 99+ switch flips in the open menu, so a second press turns the cap back off.
    it('flips the 99+ switch in place: each press sends the other state', () => {
      const onCap = vi.fn();
      const items = calculationItems({ type: 'text' }, 'count', { t: (key: string) => key }, vi.fn(), { capCounts: false, onCapCounts: onCap }) as Array<{
        title?: string;
        children?: { items?: Array<{ title?: string; toggle?: boolean; onActivate?: () => void }> };
      }>;
      const cap = items.find((item) => item.title === 'tools.database.calcCount')?.children?.items?.[0];

      cap?.onActivate?.();
      cap?.onActivate?.();

      expect(cap?.toggle).toBe(true);
      expect(onCap.mock.calls).toEqual([[true], [false]]);
    });

    // notion-motion.md Round 12 (r12-sub-count-checkbox.raw): a checkbox's Count list starts with the 99+ row too.
    it('starts a checkbox column\'s Count list with the 99+ toggle', () => {
      const items = calculationItems({ type: 'checkbox' }, undefined, { t: (key: string) => key }, vi.fn(), { capCounts: false, onCapCounts: vi.fn() }) as Array<{ title?: string; children?: { items?: Array<{ title?: string }> } }>;
      const count = items.find((item) => item.title === 'tools.database.calcCount');

      expect(count?.children?.items?.map((item) => item.title)).toEqual([
        'tools.database.calcShowLargeCounts',
        undefined,
        'tools.database.calcCountAll',
        'tools.database.calcChecked',
        'tools.database.calcUnchecked',
      ]);
    });

    // notion-motion.md Round 12 "Calculation submenu sizes": every list is 250 wide.
    it('opens every calculation list 250 wide', () => {
      const widths = (type: PropertyDefinition['type']): Array<string | undefined> =>
        (calculationItems({ type }, undefined, { t: (key: string) => key }, vi.fn()) as Array<{ children?: { width?: string } }>)
          .filter((item) => item.children !== undefined)
          .map((item) => item.children?.width);

      expect(widths('number')).toEqual(['250px', '250px', '250px']);
      expect(widths('date')).toEqual(['250px', '250px', '250px']);
      expect(widths('checkbox')).toEqual(['250px', '250px']);
    });

    // r11-calc-count-sub.png, notion-motion.md Round 12: the 99+ row carries its hint line, and a divider sits under it.
    it('gives the 99+ row its hint line and a divider under it', () => {
      const items = calculationItems({ type: 'number' }, undefined, { t: (key: string) => key }, vi.fn(), { capCounts: false, onCapCounts: vi.fn() }) as Array<{ title?: string; children?: { items?: Array<{ type?: string; titleEl?: HTMLElement }> } }>;
      const count = items.find((item) => item.title === 'tools.database.calcCount')?.children?.items ?? [];

      expect(count[0].titleEl?.querySelector('[data-blok-database-calc-hint]')?.textContent).toBe('tools.database.calcShowLargeCountsHint');
      expect(count[1].type).toBe('separator');
    });

    it('a button column has no footer menu: Notion offers no Calculate there', () => {
      const withButton: PropertyDefinition[] = [...schema, { id: 'p-act', name: 'Act', type: 'button', position: 'a5' }];
      const { root } = mount({ schema: withButton, view: tableView({ calculations: [{ id: 'p-amount', fn: 'sum' }] }) });
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
