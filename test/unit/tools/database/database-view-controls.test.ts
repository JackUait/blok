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
    expect(q('database-sort-pill')?.textContent).toBe('↓ Amount');

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
});
