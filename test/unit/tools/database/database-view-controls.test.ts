import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseViewControls } from '../../../../src/tools/database/database-view-controls';
import type { ViewControlsHost } from '../../../../src/tools/database/database-view-controls';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'num', name: 'Amount', type: 'number', position: 'a1' },
  { id: 'act', name: 'Act', type: 'button', position: 'a2' },
];

const q = (id: string): HTMLElement | null => document.querySelector(`[data-blok-testid="${id}"]`);

/** Text as a reader sees it: icon markup leaves whitespace nodes. */
const text = (el: Element | null | undefined): string | undefined => el?.textContent?.replace(/\s+/g, ' ').trim();

const click = (id: string): void => {
  const el = q(id);

  if (el === null) throw new Error(`no ${id}`);
  el.click();
};

const setup = (options: {
  rows?: number;
  readOnly?: boolean;
  locked?: boolean;
  schema?: () => PropertyDefinition[];
  levers?: Partial<ViewControlsHost>;
} = {}): {
  controls: DatabaseViewControls;
  host: ViewControlsHost;
  saved: { view: DatabaseViewConfig };
} => {
  const saved = { view: { id: 'v1', name: 'T', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] } as DatabaseViewConfig };
  const storage = new Map<string, unknown>();
  const host: ViewControlsHost = {
    i18n: { t: (key: string) => key },
    fallback: { get: (key) => storage.get(key), set: (key, value) => { storage.set(key, value); } },
    savedView: () => saved.view,
    schema: options.schema ?? (() => schema),
    rowCount: () => options.rows ?? 5,
    locked: () => options.locked === true,
    readOnly: () => options.readOnly === true,
    viewCount: () => 1,
    layouts: ['table', 'board', 'list'],
    updateView: vi.fn((changes: Partial<DatabaseViewConfig>) => {
      saved.view = { ...saved.view, ...changes };
    }),
    setLayout: vi.fn(),
    setLocked: vi.fn(),
    duplicateView: vi.fn(),
    deleteView: vi.fn(),
    copyViewLink: vi.fn(),
    groups: () => [],
    rerender: vi.fn(),
    ...options.levers,
  };
  const controls = new DatabaseViewControls(host);

  document.body.append(controls.toolbar, controls.filterBar);

  return { controls, host, saved };
};

describe('DatabaseViewControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('draws Filter, Sort, search and settings as named icon buttons, as Notion does (research/07:53)', () => {
    setup();

    for (const id of ['database-toolbar-filter', 'database-toolbar-sort', 'database-toolbar-search', 'database-toolbar-settings']) {
      const el = q(id);

      expect(el?.hasAttribute('data-blok-database-toolbar-icon')).toBe(true);
      expect(el?.textContent?.trim()).toBe('');
      expect(el?.querySelector('svg')).not.toBeNull();
    }
    expect(q('database-toolbar-filter')?.getAttribute('aria-label')).toBe('tools.database.settingsFilter');
    expect(q('database-toolbar-sort')?.getAttribute('aria-label')).toBe('tools.database.settingsSort');
  });

  describe('⚡ Automations and ✦ AI Autofill (research/21:49 order)', () => {
    const levers = (writable = true): Partial<ViewControlsHost> => ({
      automations: { read: () => undefined, schema: () => schema, views: () => [], writable: () => writable, write: () => true },
      autofill: { properties: () => schema, writable: () => writable, open: vi.fn() },
    });
    const order = (): string[] => [...document.querySelectorAll<HTMLElement>('[data-blok-database-view-toolbar] > button:not([hidden])')]
      .map((el) => el.getAttribute('data-blok-testid') ?? '');

    it('sit between Sort and search, in Notion\'s order', () => {
      setup({ levers: levers() });

      expect(order()).toEqual([
        'database-toolbar-filter', 'database-toolbar-sort', 'database-toolbar-automations', 'database-toolbar-autofill',
        'database-toolbar-search', 'database-toolbar-settings',
      ]);
      expect(q('database-toolbar-automations')?.getAttribute('aria-label')).toBe('tools.database.automationTitle');
      expect(q('database-toolbar-autofill')?.getAttribute('aria-label')).toBe('tools.database.aiAutofill');
    });

    it('⚡ opens the automations list and ✦ the AI Autofill list', () => {
      setup({ levers: levers() });
      click('database-toolbar-automations');
      expect(q('database-automation-new')).not.toBeNull();

      click('database-toolbar-autofill');
      expect(q('database-autofill-new')).not.toBeNull();
    });

    it('are absent without the host lever', () => {
      setup();

      expect(q('database-toolbar-automations')?.hidden ?? true).toBe(true);
      expect(q('database-toolbar-autofill')?.hidden ?? true).toBe(true);
    });

    it('are disabled while the database cannot be written', () => {
      setup({ levers: levers(false) });

      expect(q('database-toolbar-automations')).toHaveProperty('disabled', true);
      expect(q('database-toolbar-autofill')).toHaveProperty('disabled', true);
    });
  });

  // feel/findings-table T06 (01-notion-empty-db.png): a title-only database shows only Settings and New.
  it('shows only settings until the database has a second property', () => {
    const props: PropertyDefinition[] = [schema[0]];
    const { controls } = setup({
      schema: () => props,
      levers: { automations: { read: () => undefined, schema: () => props, views: () => [], writable: () => true, write: () => true } },
    });
    const shown = (): string[] => [...document.querySelectorAll<HTMLElement>('[data-blok-database-view-toolbar] > button:not([hidden])')]
      .map((el) => el.getAttribute('data-blok-testid') ?? '');

    expect(shown()).toEqual(['database-toolbar-settings']);

    props.push(schema[1]);
    controls.refresh();

    expect(shown()).toEqual([
      'database-toolbar-filter', 'database-toolbar-sort', 'database-toolbar-automations', 'database-toolbar-search', 'database-toolbar-settings',
    ]);
  });

  // research/23 §2e: the column header's Group follows the same rule as the settings picker.
  it('turns Hide empty groups on when a column header groups by a number', () => {
    const { controls, host } = setup();

    controls.groupBy('num', document.body.appendChild(document.createElement('button')));

    expect(host.updateView).toHaveBeenCalledWith({ groupBy: 'num', groupSettings: { hideEmptyGroups: true } });
  });

  it('never offers a button property in "+ Filter"', () => {
    setup();
    click('database-toolbar-filter');

    expect(q('database-pick-property-num')).not.toBeNull();
    expect(q('database-pick-property-act')).toBeNull();
  });

  // research/21 §1c (feel/findings-table T27): 290 wide, search on top, first option highlighted on open.
  it('opens "+ Filter" as Notion\'s property list: 290 wide, a focused search, the first option highlighted', () => {
    setup();
    click('database-toolbar-filter');
    const picker = q('database-filter-picker');
    const search = q('database-filter-picker-search');

    expect(picker?.style.width).toBe('290px');
    expect(search).not.toBeNull();
    expect(picker?.querySelector('[data-blok-database-panel-input]')).toBe(search);
    expect(search).toHaveFocus();
    expect(q('database-pick-property-title')?.hasAttribute('data-active')).toBe(true);
    expect(q('database-pick-property-num')?.hasAttribute('data-active')).toBe(false);
  });

  it('filters "+ Filter" as you type, moves the highlight with the arrows and picks it with Enter', () => {
    setup();
    click('database-toolbar-filter');
    const search = q('database-filter-picker-search') as HTMLInputElement;
    const key = (k: string): void => {
      search.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    };

    key('ArrowDown');
    expect(q('database-pick-property-num')?.hasAttribute('data-active')).toBe(true);
    search.value = 'amo';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(q('database-pick-property-title')).toBeNull();
    expect(q('database-pick-property-num')?.hasAttribute('data-active')).toBe(true);
    key('Enter');

    expect(q('database-filter-picker')).toBeNull();
    expect(q('database-filter-popover')).not.toBeNull();
  });

  it('keeps a filter personal until Save for everyone', () => {
    const { controls, host, saved } = setup();
    const anchor = document.createElement('button');

    document.body.appendChild(anchor);
    controls.filterBy('num', anchor);

    expect(saved.view.filters).toEqual([]);
    expect(controls.effective(saved.view).filters).toHaveLength(1);
    expect(host.rerender).toHaveBeenCalled();
    expect(q('database-view-save')).not.toBeNull();
    expect(q('database-view-reset')).not.toBeNull();

    click('database-view-save');

    expect(host.updateView).toHaveBeenCalledWith({ filters: [expect.objectContaining({ propertyId: 'num' })] });
    expect(controls.hasPersonalEdits('v1')).toBe(false);
    expect(q('database-view-save')).toBeNull();
  });

  it('standalone Save for everyone keeps authorized combined personal filters and sorts', () => {
    const { controls, host, saved } = setup();
    const anchor = document.createElement('button');

    document.body.appendChild(anchor);
    controls.filterBy('num', anchor);
    controls.sortBy('num', anchor);
    click('database-header-sort-desc');
    const personal = structuredClone(controls.effective(saved.view));

    if (personal.filters.length !== 1 || personal.sorts.length !== 1) {
      throw new Error('standalone save fixture did not create both personal edits');
    }
    click('database-view-save');

    expect(saved.view.filters).toEqual(personal.filters);
    expect(saved.view.sorts).toEqual(personal.sorts);
    expect(host.updateView).toHaveBeenCalledWith({ filters: personal.filters, sorts: personal.sorts });
    expect(controls.hasPersonalEdits('v1')).toBe(false);
    expect(q('database-view-save')).toBeNull();
  });

  it('discards personal edits on Reset', () => {
    const { controls, saved } = setup();

    controls.sortBy('num', document.body);
    click('database-header-sort-desc');

    expect(controls.effective(saved.view).sorts).toEqual([expect.objectContaining({ propertyId: 'num', direction: 'desc' })]);
    expect(text(q('database-sort-pill'))).toBe('Amount');

    click('database-view-reset');

    expect(controls.effective(saved.view).sorts).toEqual([]);
    expect(q('database-sort-pill')).toBeNull();
  });

  it('replaces the sorts with the one picked from a column header', () => {
    const { controls, saved } = setup();

    saved.view = { ...saved.view, sorts: [{ id: 'a', propertyId: 'title', direction: 'asc' }] };
    controls.sortBy('num', document.body);
    click('database-header-sort-asc');

    expect(controls.effective(saved.view).sorts).toEqual([expect.objectContaining({ propertyId: 'num', direction: 'asc' })]);
  });

  it('shows search from three rows and redraws as the person types', () => {
    const few = setup({ rows: 2 });

    expect(q('database-toolbar-search')?.hidden).toBe(true);
    few.controls.destroy();
    document.body.innerHTML = '';

    const { controls, host } = setup({ rows: 3 });

    expect(q('database-toolbar-search')?.hidden).toBe(false);
    click('database-toolbar-search');
    const input = q('database-search-input') as HTMLInputElement;

    expect(input).toHaveFocus();
    input.value = 'abc';
    input.dispatchEvent(new Event('input'));

    expect(controls.search).toBe('abc');
    expect(host.rerender).toHaveBeenCalled();
  });

  it('hides every control in read-only mode', () => {
    const { controls } = setup({ readOnly: true });

    expect(controls.toolbar.hidden).toBe(true);
    expect(controls.filterBar.hidden).toBe(true);
  });

  it('offers no Save for everyone while locked, and shows the lock', () => {
    const { controls } = setup({ locked: true });

    controls.sortBy('num', document.body);
    click('database-header-sort-asc');

    expect(q('database-view-save')).toBeNull();
    expect(q('database-view-reset')).not.toBeNull();
    expect(q('database-toolbar-locked')?.hidden).toBe(false);
  });

  it('opens the filter of an old id-less pill, not a "deleted property" one', () => {
    const { controls, saved } = setup();

    saved.view = { ...saved.view, filters: [{ propertyId: 'num', operator: 'greater_than', value: 5 }] };
    controls.refresh();
    document.querySelector<HTMLElement>('[data-blok-database-filter-pill][data-filter-id]')?.click();

    expect((q('database-filter-value') as HTMLInputElement | null)?.value).toBe('5');
  });

  it('marks an active filter pill only once it has a value', () => {
    const { controls } = setup();

    controls.filterBy('num', document.body);
    const pill = document.querySelector('[data-blok-database-filter-pill][data-filter-id]');

    expect(pill?.hasAttribute('data-active')).toBe(false);
    const input = q('database-filter-value') as HTMLInputElement;

    input.value = '5';
    input.dispatchEvent(new Event('input'));

    expect(document.querySelector('[data-blok-database-filter-pill][data-filter-id]')?.hasAttribute('data-active')).toBe(true);
  });
  describe('chip bar (Notion: glyph, name 500, value 400, chevron, divider after the sort chip)', () => {
    const select: PropertyDefinition = {
      id: 'sel',
      name: 'Select',
      type: 'select',
      position: 'a3',
      config: { options: [{ id: 'red', label: 'Red', color: 'red', position: 'a0' }] },
    };

    it('splits a filter chip into a type glyph, the name, the value and a down chevron', () => {
      const { controls, saved } = setup({ schema: () => [...schema, select] });

      saved.view = { ...saved.view, filters: [{ id: 'f1', propertyId: 'sel', operator: 'equals', value: ['red'] }] };
      controls.refresh();
      const chip = q('database-filter-pill-f1');

      expect(chip?.querySelector('[data-blok-database-chip-glyph] svg')).not.toBeNull();
      expect(chip?.querySelector('[data-blok-database-chip-name]')?.textContent).toBe('Select:');
      expect(chip?.querySelector('[data-blok-database-chip-value]')?.textContent).toBe('Red');
      expect(chip?.querySelector('[data-blok-database-chip-chevron] svg')).not.toBeNull();
      expect(text(chip)).toBe('Select: Red');
      expect(chip?.getAttribute('aria-label')).toBe('Select: Red');
    });

    it('shows only the name, without a colon, while the filter has no value', () => {
      const { controls, saved } = setup({ schema: () => [...schema, select] });

      saved.view = { ...saved.view, filters: [{ id: 'f1', propertyId: 'sel', operator: 'equals', value: [] }] };
      controls.refresh();
      const chip = q('database-filter-pill-f1');

      expect(chip?.querySelector('[data-blok-database-chip-name]')?.textContent).toBe('Select');
      expect(chip?.querySelector('[data-blok-database-chip-value]')).toBeNull();
    });

    it('puts the sort chip first, with an arrow glyph that points its way, then a divider', () => {
      const { controls, saved } = setup({ schema: () => [...schema, select] });

      saved.view = {
        ...saved.view,
        sorts: [{ id: 's1', propertyId: 'num', direction: 'desc' }],
        filters: [{ id: 'f1', propertyId: 'sel', operator: 'equals', value: ['red'] }],
      };
      controls.refresh();
      const row = document.querySelector('[data-blok-database-filter-pills]');
      const kids = [...(row?.children ?? [])];
      const sort = q('database-sort-pill');

      expect(kids[0]).toBe(sort);
      expect(kids[1]?.hasAttribute('data-blok-database-chip-divider')).toBe(true);
      expect(kids[2]).toBe(q('database-filter-pill-f1'));
      expect(sort?.getAttribute('data-direction')).toBe('desc');
      expect(sort?.querySelector('[data-blok-database-chip-glyph] svg')).not.toBeNull();
      expect(sort?.querySelector('[data-blok-database-chip-chevron] svg')).not.toBeNull();
      expect(text(sort)).toBe('Amount');
    });
  });
  describe('chip popover (Notion: header with "…", token field, pill options)', () => {
    const select: PropertyDefinition = {
      id: 'sel',
      name: 'Select',
      type: 'select',
      position: 'a3',
      config: { options: [{ id: 'red', label: 'Red', color: 'red', position: 'a0' }, { id: 'blue', label: 'Blue', color: 'blue', position: 'a1' }] },
    };

    const open = (): ReturnType<typeof setup> => {
      const env = setup({ schema: () => [...schema, select] });

      env.saved.view = { ...env.saved.view, filters: [{ id: 'f1', propertyId: 'sel', operator: 'equals', value: ['red'] }] };
      env.controls.refresh();
      click('database-filter-pill-f1');

      return env;
    };

    it('heads the popover with "Name operator" and a "…" button, 260 wide', () => {
      open();
      const popover = q('database-filter-popover');

      expect(popover?.style.width).toBe('260px');
      expect(text(q('database-filter-operator'))).toBe('Select tools.database.filteroperator.is');
      expect(q('database-filter-more')?.getAttribute('aria-label')).toBe('tools.database.tableMoreActions');
    });

    it('shows the chosen option as a coloured token with a remove ×, and lists options as coloured pills', () => {
      const { controls, saved } = open();
      const token = document.querySelector('[data-blok-database-chip-tokens] [data-blok-database-select-chip="red"]');

      expect(token?.getAttribute('data-color')).toBe('red');
      expect(document.querySelector('[data-blok-testid="database-filter-option-blue"] [data-blok-database-option-pill][data-color="blue"]')).not.toBeNull();
      expect(q('database-filter-option-red')?.getAttribute('aria-checked')).toBe('true');

      click('database-filter-token-remove-red');

      expect(controls.effective(saved.view).filters[0]?.value).toEqual([]);
    });

    it('narrows the options as the person types in the token field', () => {
      open();
      const search = q('database-filter-option-search') as HTMLInputElement;

      search.value = 'blu';
      search.dispatchEvent(new Event('input'));

      expect(q('database-filter-option-red')).toBeNull();
      expect(q('database-filter-option-blue')).not.toBeNull();
    });

    it('deletes the filter from the "…" menu', () => {
      const { controls, saved } = open();

      click('database-filter-more');
      click('database-filter-delete');

      expect(controls.effective(saved.view).filters).toEqual([]);
    });
  });
  describe('date chip (Notion: operator list and relative-date editor)', () => {
    const date: PropertyDefinition = { id: 'due', name: 'Due', type: 'date', position: 'a3' };

    const open = (filter: { operator: string; value: unknown }): ReturnType<typeof setup> => {
      const env = setup({ schema: () => [...schema, date] });

      env.saved.view = { ...env.saved.view, filters: [{ id: 'f1', propertyId: 'due', ...filter } as DatabaseViewConfig['filters'][number]] };
      env.controls.refresh();
      click('database-filter-pill-f1');

      return env;
    };

    const pick = (id: string, value: string): void => {
      const select = q(id) as HTMLSelectElement;

      select.value = value;
      select.dispatchEvent(new Event('change'));
    };

    it('edits "This week" with This / unit selects, a calendar and the moving-date note', () => {
      const { controls, saved, host } = open({ operator: 'this_week', value: null });

      expect((q('database-filter-direction') as HTMLSelectElement).value).toBe('this');
      expect((q('database-filter-unit') as HTMLSelectElement).value).toBe('week');
      expect(q('database-filter-count')).toBeNull();
      expect(document.querySelectorAll('[data-blok-database-chip-day][data-in-window]')).toHaveLength(7);
      expect(text(document.querySelector('[data-blok-database-chip-note]'))).toBe('tools.database.filterUpdatesWithDate');
      expect(host.updateView).not.toHaveBeenCalled();

      pick('database-filter-unit', 'month');

      expect(controls.effective(saved.view).filters[0]).toMatchObject({ operator: 'relative_to_today', value: 'this:1:month' });
    });

    it('opens an old "past month" filter as Past 1 month and writes nothing until a change', () => {
      const { controls, saved } = open({ operator: 'past_month', value: null });

      expect((q('database-filter-direction') as HTMLSelectElement).value).toBe('past');
      expect((q('database-filter-count') as HTMLInputElement).value).toBe('1');
      expect((q('database-filter-unit') as HTMLSelectElement).value).toBe('month');
      expect(controls.hasPersonalEdits('v1')).toBe(false);
      expect(controls.effective(saved.view).filters[0]).toMatchObject({ operator: 'past_month' });
    });

    it('opens an old "is not" filter with its name and value, and lists Notion\'s operators', () => {
      const { controls } = open({ operator: 'does_not_equal', value: 'today' });

      expect(text(q('database-filter-operator'))).toBe('Due tools.database.filteroperator.isnot');
      expect(q('database-filter-date-today')?.getAttribute('aria-checked')).toBe('true');
      expect(controls.hasPersonalEdits('v1')).toBe(false);

      click('database-filter-operator');
      const ops = [...document.querySelectorAll('[data-blok-testid^="database-filter-op-"]')].map((el) => el.getAttribute('data-blok-testid'));

      expect(ops).toEqual([
        'database-filter-op-equals', 'database-filter-op-before', 'database-filter-op-after', 'database-filter-op-on_or_before',
        'database-filter-op-on_or_after', 'database-filter-op-is_between', 'database-filter-op-relative_to_today',
        'database-filter-op-is_empty', 'database-filter-op-is_not_empty',
      ]);
    });

    it('saves "Is between" as a date range once both days are whole', () => {
      const { controls, saved } = open({ operator: 'is_between', value: null });
      const start = q('database-filter-between-start') as HTMLInputElement;

      start.value = '2026-10-01';
      start.dispatchEvent(new Event('input'));
      expect(controls.effective(saved.view).filters[0]?.value).toBeNull();

      const end = q('database-filter-between-end') as HTMLInputElement;

      end.value = '2026-10-07';
      end.dispatchEvent(new Event('input'));
      expect(controls.effective(saved.view).filters[0]?.value).toBe('2026-10-01/2026-10-07');
    });
  });
  describe('sort panel (Notion: under the chip, sized to content, chevrons down, no title)', () => {
    const withSort = (): ReturnType<typeof setup> => {
      const env = setup();

      env.saved.view = { ...env.saved.view, sorts: [{ id: 's1', propertyId: 'num', direction: 'asc' }] };
      env.controls.refresh();

      return env;
    };

    it('opens under the sort chip with no title, sized to its content', () => {
      withSort();
      click('database-sort-pill');
      const panel = q('database-sort-panel');

      expect(panel).not.toBeNull();
      expect(panel?.querySelector('[data-blok-database-panel-header]')).toBeNull();
      expect(panel?.style.width).toBe('max-content');
      expect(q('database-sort-property-s1')?.querySelector('[data-blok-database-chip-chevron] svg')).not.toBeNull();
      expect(q('database-sort-property-s1')?.querySelector('[data-blok-database-panel-chevron]')).toBeNull();
      expect(q('database-sort-direction-s1')?.querySelector('[data-blok-database-chip-chevron] svg')).not.toBeNull();
      expect(q('database-sort-pill')?.hasAttribute('data-popover-open')).toBe(true);
    });

    it('picks the direction from a list, as Notion\'s dropdown does', () => {
      const { controls, saved } = withSort();

      click('database-sort-pill');
      click('database-sort-direction-s1');
      click('database-sort-direction-desc');

      expect(controls.effective(saved.view).sorts[0]).toMatchObject({ propertyId: 'num', direction: 'desc' });
    });

    it('opens the sort panel from the Sort button while a sort exists', () => {
      withSort();
      click('database-toolbar-sort');

      expect(q('database-sort-panel')).not.toBeNull();
    });

    it('deletes every sort and closes', () => {
      const { controls, saved } = withSort();

      click('database-sort-pill');
      click('database-sort-delete-all');

      expect(controls.effective(saved.view).sorts).toEqual([]);
      expect(q('database-sort-panel')).toBeNull();
    });
  });

  describe('Sort with no rule (Notion: the property picker opens at once)', () => {
    const many: PropertyDefinition[] = [
      { id: 'zeta', name: 'Zeta', type: 'text', position: 'a0' },
      { id: 'title', name: 'Name', type: 'title', position: 'a1' },
      { id: 'alpha', name: 'Alpha', type: 'number', position: 'a2' },
      { id: 'act', name: 'Act', type: 'button', position: 'a3' },
    ];

    it('lists Name first, then A→Z, with type glyphs, and a pick creates the sort', () => {
      const { controls, saved } = setup({ schema: () => many });

      click('database-toolbar-sort');
      const rows = [...document.querySelectorAll('[data-blok-testid="database-sort-picker"] [data-blok-database-panel-row]')];

      expect(rows.map((row) => row.getAttribute('data-blok-testid'))).toEqual([
        'database-pick-property-title', 'database-pick-property-alpha', 'database-pick-property-zeta',
      ]);
      expect(rows[0]?.querySelector('[data-blok-database-panel-icon] svg')).not.toBeNull();

      click('database-pick-property-alpha');

      expect(controls.effective(saved.view).sorts).toEqual([expect.objectContaining({ propertyId: 'alpha', direction: 'asc' })]);
      expect(q('database-sort-picker')).toBeNull();
    });
  });
  describe('search box (Notion: the magnifier stays, a clear ×)', () => {
    it('keeps the magnifier in front of the input', () => {
      setup({ rows: 3 });
      click('database-toolbar-search');
      const magnifier = q('database-toolbar-search');

      expect(magnifier?.hidden).toBe(false);
      expect(magnifier?.nextElementSibling).toBe(q('database-search-input'));
    });

    it('shows a clear × once there is a query, and the × empties the search and keeps the focus', () => {
      const { controls, host } = setup({ rows: 3 });

      click('database-toolbar-search');
      const input = q('database-search-input') as HTMLInputElement;

      expect(q('database-search-clear')?.hidden).toBe(true);
      input.value = 'al';
      input.dispatchEvent(new Event('input'));
      expect(q('database-search-clear')?.hidden).toBe(false);
      expect(q('database-search-clear')?.getAttribute('aria-label')).toBe('tools.database.searchClear');

      vi.mocked(host.rerender).mockClear();
      click('database-search-clear');

      expect(controls.search).toBe('');
      expect(input.value).toBe('');
      expect(input).toHaveFocus();
      expect(host.rerender).toHaveBeenCalled();
      expect(q('database-search-clear')?.hidden).toBe(true);
    });

    it('takes the magnifier and the × away on Escape', () => {
      setup({ rows: 3 });
      click('database-toolbar-search');
      (q('database-search-input') as HTMLInputElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(q('database-search-input')).toBeNull();
      expect(q('database-search-clear')).toBeNull();
      expect(q('database-toolbar-search')?.hidden).toBe(false);
    });
  });
  describe('search match highlight (Notion: matched text tinted, the DOM untouched)', () => {
    class FakeHighlight {
      readonly ranges: Range[];

      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    }
    const registry = new Map<string, FakeHighlight>();

    beforeEach(() => {
      registry.clear();
      vi.stubGlobal('Highlight', FakeHighlight);
      vi.stubGlobal('CSS', { ...globalThis.CSS, escape: (v: string) => v, highlights: registry });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('paints every match in the view with the Highlight API and leaves the DOM as it was', () => {
      const { controls } = setup({ rows: 3 });
      const root = document.createElement('div');
      const body = document.createElement('div');

      body.innerHTML = '<div data-blok-database-cell>Alpha</div><div data-blok-database-cell>Delta alpha</div><div>Beta</div>';
      root.append(controls.toolbar, controls.filterBar, body);
      document.body.append(root);
      const before = body.innerHTML;

      click('database-toolbar-search');
      const input = q('database-search-input') as HTMLInputElement;

      input.value = 'AL';
      input.dispatchEvent(new Event('input'));
      const painted = registry.get('blok-database-search-match');

      expect(painted?.ranges.map((range) => range.toString())).toEqual(['Al', 'al']);
      expect(body.innerHTML).toBe(before);

      click('database-search-clear');

      expect(registry.has('blok-database-search-match')).toBe(false);
    });
  });
  describe('Filter toggles the chip bar; » minimizes it (Notion)', () => {
    const withFilter = (): ReturnType<typeof setup> => {
      const env = setup();

      env.saved.view = { ...env.saved.view, filters: [{ id: 'f1', propertyId: 'num', operator: 'greater_than', value: 5 }] };
      env.controls.refresh();

      return env;
    };

    it('shows » left of Filter while the bar shows, and » hides the bar', () => {
      const { controls } = withFilter();
      const minimize = q('database-toolbar-minimize');

      expect(controls.filterBar.hidden).toBe(false);
      expect(minimize?.hidden).toBe(false);
      expect(minimize?.nextElementSibling).toBe(q('database-toolbar-filter'));
      expect(minimize?.getAttribute('aria-label')).toBe('tools.database.filterBarMinimize');
      expect(minimize?.querySelector('svg')).not.toBeNull();

      click('database-toolbar-minimize');

      expect(controls.filterBar.hidden).toBe(true);
      expect(q('database-toolbar-minimize')?.hidden).toBe(true);
    });

    it('hides and shows the bar from the Filter button while a rule exists', () => {
      const { controls } = withFilter();

      click('database-toolbar-filter');
      expect(controls.filterBar.hidden).toBe(true);
      expect(q('database-filter-picker')).toBeNull();

      click('database-toolbar-filter');
      expect(controls.filterBar.hidden).toBe(false);
      expect(q('database-filter-picker')).toBeNull();
    });

    it('keeps the bar, with only "+ Filter", after the last rule is deleted', () => {
      const { controls } = withFilter();

      click('database-filter-pill-f1');
      click('database-filter-more');
      click('database-filter-delete');

      expect(controls.filterBar.hidden).toBe(false);
      expect(q('database-filter-bar-add')).not.toBeNull();
      expect(document.querySelector('[data-filter-id]')).toBeNull();
    });
  });
});
