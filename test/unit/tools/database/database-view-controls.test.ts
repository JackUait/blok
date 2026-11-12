import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseViewControls } from '../../../../src/tools/database/database-view-controls';
import type { ViewControlsHost } from '../../../../src/tools/database/database-view-controls';
import type { DatabaseViewConfig, FilterRule, PropertyDefinition } from '../../../../src/tools/database/types';
import { HINT_DELAY, destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { hover, shownHint } from './hint-harness';
import { PAGE_LIST_ROLLUP } from '../../../../src/shared/database/value-helpers';

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

  // The fold probes write on it on every resize; they are not edits.
  it('draws the toolbar as mutation-free, so its own writes are not block changes', () => {
    const { controls } = setup();

    expect(controls.toolbar.getAttribute('data-blok-mutation-free')).toBe('true');
  });

  it('marks Filter, Sort, Automations, AI Autofill and search as the group a narrow bar hides together (notion-spec-2 §26.1)', () => {
    setup({ levers: {
      automations: { read: () => undefined, schema: () => schema, views: () => [], writable: () => true, write: () => true },
      autofill: { properties: () => schema, writable: () => true, open: vi.fn() },
    } });
    const foldable = [...document.querySelectorAll<HTMLElement>('[data-blok-database-toolbar-foldable]')]
      .map((el) => el.getAttribute('data-blok-testid'));

    expect(foldable).toEqual([
      'database-toolbar-filter', 'database-toolbar-sort', 'database-toolbar-automations', 'database-toolbar-autofill', 'database-toolbar-search',
    ]);
    expect(q('database-toolbar-settings')?.hasAttribute('data-blok-database-toolbar-foldable')).toBe(false);
  });

  // notion-live/rowdrag-mid.png: with rows picked, Notion's bar drops Filter, Sort and Automations; ✨, search, settings and New stay.
  it('marks Filter, Sort and Automations as the icons the table selection bar hides', () => {
    setup({ levers: {
      automations: { read: () => undefined, schema: () => schema, views: () => [], writable: () => true, write: () => true },
      autofill: { properties: () => schema, writable: () => true, open: vi.fn() },
    } });
    const hidden = [...document.querySelectorAll<HTMLElement>('[data-blok-database-toolbar-selection-hides]')]
      .map((el) => el.getAttribute('data-blok-testid'));

    expect(hidden).toEqual(['database-toolbar-filter', 'database-toolbar-sort', 'database-toolbar-automations']);
  });

  describe('"No date (N)" for a calendar or timeline (findings C03/C04)', () => {
    it('shows the view\'s count left of Filter and opens the view\'s popover from itself', () => {
      const open = vi.fn();
      const control = { count: 2, label: 'No date (2)', open };

      setup({ levers: { noDate: () => control } });
      const button = q('database-toolbar-no-date');

      expect(button?.hidden).toBe(false);
      expect(text(button)).toBe('No date (2)');
      expect(button?.nextElementSibling).toBe(q('database-toolbar-filter'));
      button?.click();
      expect(open).toHaveBeenCalledWith(button);
    });

    it('is hidden when the view gives no control', () => {
      setup({ levers: { noDate: () => undefined } });

      expect(q('database-toolbar-no-date')?.hidden).toBe(true);
    });
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

  // notion-motion.md Round 5 (filter-field.png), side-by-side-v1 (sort-open.png).
  it('names the Filter picker search "Filter by…"', () => {
    setup();
    click('database-toolbar-filter');

    expect((q('database-filter-picker-search') as HTMLInputElement).placeholder).toBe('tools.database.filterByPlaceholder');
    expect(q('database-filter-picker-search')?.getAttribute('aria-label')).toBe('tools.database.filterByPlaceholder');
  });

  // notion-motion.md Round 10: the Sort and Filter pickers share one measured layout (database.css "picker" page).
  it('marks the Sort and Filter pickers as the picker page', () => {
    setup();
    click('database-toolbar-filter');
    expect(q('database-filter-picker')?.getAttribute('data-blok-database-panel-page')).toBe('picker');
    document.body.innerHTML = '';
    setup();
    click('database-toolbar-sort');
    expect(q('database-sort-picker')?.getAttribute('data-blok-database-panel-page')).toBe('picker');
  });

  it('names the Sort picker search "Sort by…"', () => {
    setup();
    click('database-toolbar-sort');

    expect((q('database-sort-picker-search') as HTMLInputElement).placeholder).toBe('tools.database.sortByPlaceholder');
  });

  // notion-motion.md Round 5: the Filter list's last row is "Add advanced filter", pinned under the scrolling list.
  it('ends "+ Filter" with "Add advanced filter" under the property list, and it opens the advanced filter', () => {
    const { controls, saved } = setup();

    click('database-toolbar-filter');
    const picker = q('database-filter-picker');
    const list = picker?.querySelector('[data-blok-database-picker-list]');
    const footer = q('database-filter-picker-advanced');

    expect(footer).not.toBeNull();
    expect(text(footer)).toBe('tools.database.filterAddAdvanced');
    expect(list?.contains(footer)).toBe(false);
    expect(picker?.lastElementChild).toBe(footer);
    expect(list?.contains(q('database-pick-property-num'))).toBe(true);

    click('database-filter-picker-advanced');

    expect(q('database-filter-picker')).toBeNull();
    expect(q('database-advanced-filter')).not.toBeNull();
    expect(document.querySelector('[data-blok-testid="database-advanced-filter"] [data-blok-testid^="database-filter-add-rule-"]')).not.toBeNull();
    // notion-motion.md Round 18 §2 (r18-adv-open.raw): it starts with one rule, "Where Name Contains".
    expect(controls.effective(saved.view).filterTree?.filterRules).toEqual([expect.objectContaining({ propertyId: 'title', operator: 'contains', value: '' })]);
  });

  // notion-motion.md Round 18 §2 (r18-adv-open.raw, r18-adv-bar.raw): the "1 rule" chip shows at once, and the popover opens under it.
  it('shows the advanced chip at once and opens the advanced filter under it', () => {
    const { controls } = setup();

    click('database-toolbar-filter');
    click('database-filter-picker-advanced');

    expect(controls.filterBar.hidden).toBe(false);
    expect(q('database-advanced-pill')?.hasAttribute('data-popover-open')).toBe(true);
    expect(q('database-filter-bar-add')?.hasAttribute('data-popover-open')).toBe(false);
  });

  // notion-motion.md Round 18 §2 (r18-adv-open.raw, -prop.raw, -op.raw): each rule is edited inline, its pickers are flyouts.
  describe('advanced filter rules edited inline', () => {
    const openAdvanced = (): { controls: DatabaseViewControls; saved: { view: DatabaseViewConfig }; ruleId: () => string; rule: () => Record<string, unknown> | undefined } => {
      const { controls, saved } = setup();

      click('database-toolbar-filter');
      click('database-filter-picker-advanced');
      const rule = (): Record<string, unknown> | undefined => controls.effective(saved.view).filterTree?.filterRules[0] as Record<string, unknown> | undefined;

      return { controls, saved, rule, ruleId: () => String(rule()?.id) };
    };
    const panelDepthIsOne = (): boolean => document.querySelector('[data-blok-testid="database-advanced-filter"] [data-blok-testid="database-panel-back"]') === null;

    it('draws the rule as property, operator, value and ⋯ controls, in a popover sized to them', () => {
      const { ruleId } = openAdvanced();
      const id = ruleId();

      expect(text(q(`database-filter-rule-property-${id}`))).toBe('Name');
      expect(text(q(`database-filter-rule-operator-${id}`))).toBe('tools.database.filterOperator.contains');
      expect(q(`database-filter-rule-value-${id}`)).toBeInstanceOf(HTMLInputElement);
      expect(q(`database-filter-rule-more-${id}`)).not.toBeNull();
      expect(q('database-advanced-filter')?.style.width).not.toBe('290px');
    });

    it('opens the property list as a 280-wide flyout, and a pick resets the operator', () => {
      const { ruleId, rule } = openAdvanced();
      const id = ruleId();

      click(`database-filter-rule-property-${id}`);

      expect(panelDepthIsOne()).toBe(true);
      expect(q('database-filter-rule-property-picker')?.style.width).toBe('280px');
      click('database-pick-property-num');

      expect(rule()).toEqual(expect.objectContaining({ id, propertyId: 'num', operator: 'equals', value: null }));
      expect(q('database-filter-rule-property-picker')).toBeNull();
      expect(text(q(`database-filter-rule-property-${id}`))).toBe('Amount');
    });

    it('opens the operator list as a 190-wide flyout under its button', () => {
      const { ruleId, rule } = openAdvanced();
      const id = ruleId();

      click(`database-filter-rule-operator-${id}`);

      expect(panelDepthIsOne()).toBe(true);
      expect(q('database-filter-operator-picker')?.style.width).toBe('190px');
      click('database-filter-op-does_not_contain');

      expect(rule()).toEqual(expect.objectContaining({ id, operator: 'does_not_contain' }));
    });

    it('keeps typing in the value field across the redraw each keystroke causes', () => {
      const { ruleId, rule } = openAdvanced();
      const id = ruleId();
      const type = (value: string): void => {
        const input = q(`database-filter-rule-value-${id}`) as HTMLInputElement;

        input.focus();
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };

      type('a');
      type('ab');

      expect(rule()).toEqual(expect.objectContaining({ value: 'ab' }));
      expect(q(`database-filter-rule-value-${id}`)).toHaveFocus();
    });

    it('deletes the rule from its ⋯ flyout', () => {
      const { ruleId, controls, saved } = openAdvanced();
      const id = ruleId();

      click(`database-filter-rule-more-${id}`);
      expect(panelDepthIsOne()).toBe(true);
      click('database-filter-delete');

      expect(controls.effective(saved.view).filterTree?.filterRules).toEqual([]);
    });
  });

  // notion-motion.md Round 18 §2 (r18-adv-bar.raw): the advanced chip goes first, before the simple chips.
  it('puts the advanced filter chip before the simple filter chips', () => {
    const { controls, saved } = setup();

    saved.view = {
      ...saved.view,
      filters: [{ id: 'f1', propertyId: 'title', operator: 'contains', value: 'a' }],
      filterTree: { id: 'root', conjunction: 'and', filterRules: [{ id: 'a', propertyId: 'num', operator: 'is_empty', value: null }] },
    };
    controls.refresh();
    const order = [...document.querySelectorAll('[data-blok-database-filter-pills] > [data-blok-database-filter-pill]')].map((el) => el.getAttribute('data-blok-testid'));

    expect(order).toEqual(['database-advanced-pill', 'database-filter-pill-f1']);
  });

  // notion-motion.md Round 19 §1 (r19-adv-group2-bar.raw): rule, rule, group(rule, rule) reads "3 rules".
  it('counts the advanced chip by its top-level items', () => {
    const { controls, saved } = setup({ levers: { i18n: { t: (key: string, vars?: Record<string, string | number>) => `${key} ${String(vars?.count ?? '')}` } } });
    const rule = (id: string): FilterRule => ({ id, propertyId: 'num', operator: 'is_empty', value: null });

    saved.view = {
      ...saved.view,
      filterTree: { id: 'root', conjunction: 'and', filterRules: [rule('a'), rule('b'), { id: 'g', conjunction: 'or', filterRules: [rule('c'), rule('d')] }] },
    };
    controls.refresh();

    expect(q('database-advanced-pill')?.getAttribute('aria-label')).toBe('tools.database.filterRuleCount 3');
  });

  it('gives "+ Sort" no advanced footer', () => {
    setup();
    click('database-toolbar-sort');

    expect(q('database-sort-picker')).not.toBeNull();
    expect(q('database-filter-picker-advanced')).toBeNull();
    expect(q('database-sort-picker')?.querySelector('[data-blok-database-picker-list]')).not.toBeNull();
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

  // research/11 §4 (35-filter-saved.png): on a row page, Save for everyone asks first.
  describe('Save for everyone on a row page', () => {
    const rowPage = (): ReturnType<typeof setup> => setup({ levers: {
      i18n: { t: (key: string, vars?: Record<string, string | number>) => (vars?.name === undefined ? key : `${key} ${String(vars.name)}`) },
      rowPageDatabaseName: () => 'Measure DB 3',
    } });
    const dialog = (): HTMLElement | null => document.querySelector('[data-blok-database-confirm-dialog]');
    const action = (name: string): HTMLElement | null => dialog()?.querySelector(`[data-blok-database-confirm-action="${name}"]`) ?? null;

    afterEach(() => {
      document.querySelectorAll('[data-blok-database-confirm]').forEach((el) => el.remove());
    });

    it('asks "Updating layout for all pages…" before it saves, and saves on "Save for all pages"', async () => {
      const { controls, host } = rowPage();

      controls.filterBy('num', document.body);
      click('database-view-save');

      expect(host.updateView).not.toHaveBeenCalled();
      expect(dialog()?.querySelector('[data-blok-database-confirm-title]')?.textContent).toBe('tools.database.saveForAllTitle');
      const description = dialog()?.querySelector('[data-blok-database-confirm-description]');

      expect(description?.textContent).toBe('tools.database.saveForAllDescription Measure DB 3');
      expect(description?.querySelector('strong')?.textContent).toBe('Measure DB 3');
      expect(action('confirm')?.textContent).toBe('tools.database.saveForAllConfirm');
      expect(action('confirm')?.hasAttribute('data-primary')).toBe(true);
      expect(action('cancel')?.textContent).toBe('tools.database.layoutCancel');
      expect(action('cancel')?.hasAttribute('data-quiet')).toBe(false);
      expect(action('confirm')).toHaveFocus();

      action('confirm')?.click();
      await vi.waitFor(() => expect(host.updateView).toHaveBeenCalledWith({ filters: [expect.objectContaining({ propertyId: 'num' })] }));
      expect(controls.hasPersonalEdits('v1')).toBe(false);
    });

    it('keeps the draft on Cancel', async () => {
      const { controls, host } = rowPage();

      controls.filterBy('num', document.body);
      click('database-view-save');
      action('cancel')?.click();
      await vi.waitFor(() => expect(dialog()).toBeNull());

      expect(host.updateView).not.toHaveBeenCalled();
      expect(controls.hasPersonalEdits('v1')).toBe(true);
    });
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

    it('writes the operator after the name, as Notion\'s "Name: Contains a" and "Number = 5" (Round 18 §2)', () => {
      const { controls, saved } = setup();

      saved.view = { ...saved.view, filters: [{ id: 'f1', propertyId: 'num', operator: 'equals', value: 5 }] };
      controls.refresh();
      const chip = q('database-filter-pill-f1');

      expect(chip?.querySelector('[data-blok-database-chip-name]')?.textContent).toBe('Amount');
      expect(chip?.querySelector('[data-blok-database-chip-value]')?.textContent).toBe('tools.database.filterOperator.numberEquals 5');
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

    // research/08:232 and shots-08/67-filter-number.png: a value-field filter popover is 220 wide. The option
    // token field's width was never measured, so it keeps 260.
    it('opens a value-field filter 220 wide', () => {
      const env = setup();

      env.saved.view = { ...env.saved.view, filters: [{ id: 'f2', propertyId: 'title', operator: 'contains', value: '' }] };
      env.controls.refresh();
      click('database-filter-pill-f2');

      expect(q('database-filter-popover')?.style.width).toBe('220px');
    });

    // notion-motion.md Round 19 §2 (r19-cb-new.raw, r19-cb-checked.raw): the Checkbox popover is 220 wide (220×95, 220×132).
    it('opens a Checkbox filter 220 wide', () => {
      const env = setup({ schema: () => [...schema, { id: 'done', name: 'Done', type: 'checkbox', position: 'a3' }] });

      env.saved.view = { ...env.saved.view, filters: [{ id: 'f3', propertyId: 'done', operator: 'equals', value: true }] };
      env.controls.refresh();
      click('database-filter-pill-f3');

      expect(q('database-filter-popover')?.style.width).toBe('220px');
    });

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
  // notion-motion.md Round 13 (r13-filter-ops-id.raw): ID lists =, ≠, >, <, ≥, ≤, Is empty, Is not empty.
  it('lists Is empty and Is not empty on an ID filter, and hides the value field for them', () => {
    const env = setup({ schema: () => [...schema, { id: 'uid', name: 'ID', type: 'uniqueId', position: 'a3' }] });

    env.saved.view = { ...env.saved.view, filters: [{ id: 'f1', propertyId: 'uid', operator: 'equals', value: null }] };
    env.controls.refresh();
    click('database-filter-pill-f1');
    click('database-filter-operator');
    const ops = [...document.querySelectorAll('[data-blok-testid^="database-filter-op-"]')].map((el) => el.getAttribute('data-blok-testid')?.replace('database-filter-op-', ''));

    expect(ops).toEqual(['equals', 'does_not_equal', 'greater_than', 'less_than', 'greater_than_or_equal_to', 'less_than_or_equal_to', 'is_empty', 'is_not_empty']);

    click('database-filter-op-is_empty');

    expect(env.controls.effective(env.saved.view).filters[0]).toMatchObject({ operator: 'is_empty', value: null });
    expect(q('database-filter-value')).toBeNull();
  });

  // notion-motion.md Round 18 §2 (r18-filter-op-open.raw): the operator list is a 190-wide flyout under its button; the popover stays.
  describe('filter operator flyout', () => {
    const open = (): ReturnType<typeof setup> => {
      const env = setup();

      env.saved.view = { ...env.saved.view, filters: [{ id: 'f1', propertyId: 'title', operator: 'contains', value: 'a' }] };
      env.controls.refresh();
      click('database-filter-pill-f1');
      click('database-filter-operator');

      return env;
    };

    it('opens beside the rule popover, 190 wide, in the flyout layout, the current operator checked', () => {
      open();
      const flyout = q('database-filter-operator-picker');

      expect(flyout?.style.width).toBe('190px');
      expect(flyout?.getAttribute('data-blok-database-panel-page')).toBe('sort-flyout');
      expect(q('database-filter-popover')?.contains(flyout)).toBe(false);
      expect(q('database-filter-popover')?.querySelector('[data-blok-testid="database-filter-operator"]')).not.toBeNull();
      expect(q('database-filter-op-contains')?.getAttribute('aria-checked')).toBe('true');
    });

    it('a pick writes the operator, closes the flyout and relabels the open popover', () => {
      const { controls, saved } = open();

      click('database-filter-op-starts_with');

      expect(controls.effective(saved.view).filters[0]).toMatchObject({ operator: 'starts_with', value: 'a' });
      expect(q('database-filter-operator-picker')).toBeNull();
      expect(q('database-filter-popover')?.isConnected).toBe(true);
      expect(text(q('database-filter-operator'))).toBe('Name tools.database.filteroperator.startswith');
    });

    it('Escape closes only the flyout', () => {
      open();
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(q('database-filter-operator-picker')).toBeNull();
      expect(q('database-filter-popover')).not.toBeNull();
      expect(q('database-filter-operator')).toHaveFocus();
    });
  });

  // notion-motion.md Round 18 §2 (r18-filter-more.raw): the rule ⋯ is a 240-wide flyout beside its button.
  describe('filter rule ⋯ flyout', () => {
    const open = (): ReturnType<typeof setup> => {
      const env = setup();

      env.saved.view = { ...env.saved.view, filters: [{ id: 'f1', propertyId: 'title', operator: 'contains', value: 'a' }] };
      env.controls.refresh();
      click('database-filter-pill-f1');
      click('database-filter-more');

      return env;
    };

    it('opens beside the rule popover, 240 wide, with Delete filter and Add to advanced filter', () => {
      open();
      const flyout = q('database-filter-more-menu');

      expect(flyout?.style.width).toBe('240px');
      expect(q('database-filter-popover')?.contains(flyout)).toBe(false);
      expect(q('database-filter-popover')?.querySelector('[data-blok-testid="database-filter-operator"]')).not.toBeNull();
      expect(flyout?.querySelector('[data-blok-testid="database-filter-delete"]')).not.toBeNull();
      expect(flyout?.querySelector('[data-blok-testid="database-filter-to-advanced"]')).not.toBeNull();
    });

    it('Delete filter removes the rule and closes the flyout and the popover', () => {
      const { controls, saved } = open();

      click('database-filter-delete');

      expect(controls.effective(saved.view).filters).toEqual([]);
      expect(q('database-filter-more-menu')).toBeNull();
      expect(q('database-filter-popover')).toBeNull();
    });

    it('Escape closes only the flyout', () => {
      open();
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(q('database-filter-more-menu')).toBeNull();
      expect(q('database-filter-popover')).not.toBeNull();
    });
  });

  // notion-motion.md Round 13 (r13-filter-ops-rollup.png, -rollup.raw, -rollup-op.raw): "Rollup any ⌄ contains ⌄",
  // the first menu Any / None / Every, the second the URL list, and a text field.
  describe('rollup of the Name chip', () => {
    const names = Object.assign(
      { id: 'names', name: 'Names', type: 'relation', position: 'a3', rollup: { relationPropertyId: 'rel', targetPropertyId: 'title', function: 'show_original' } } as PropertyDefinition,
      { [PAGE_LIST_ROLLUP]: true }
    );

    const open = (filter: { operator: string; value: unknown }): ReturnType<typeof setup> => {
      const env = setup({ schema: () => [...schema, names] });

      env.saved.view = { ...env.saved.view, filters: [{ id: 'f1', propertyId: 'names', ...filter } as DatabaseViewConfig['filters'][number]] };
      env.controls.refresh();
      click('database-filter-pill-f1');

      return env;
    };

    it('heads the popover "Names any ⌄ contains ⌄", 220 wide, with the text field focused', () => {
      open({ operator: 'any:contains', value: '' });

      expect(q('database-filter-popover')?.style.width).toBe('220px');
      expect(text(q('database-filter-quantifier'))).toBe('tools.database.filteroperator.any');
      expect(text(q('database-filter-operator'))).toBe('tools.database.filteroperator.contains');
      expect(text(q('database-filter-quantifier')?.parentElement)).toBe('Names tools.database.filteroperator.any tools.database.filteroperator.contains');
      expect(q('database-filter-value')).toHaveFocus();
    });

    it('picks None from Any / None / Every and keeps the text operator', () => {
      const { controls, saved } = open({ operator: 'any:contains', value: 'x' });

      click('database-filter-quantifier');
      const rows = [...document.querySelectorAll('[data-blok-testid^="database-filter-quantifier-"]')].map((el) => el.getAttribute('data-blok-testid'));

      expect(rows).toEqual(['database-filter-quantifier-any', 'database-filter-quantifier-none', 'database-filter-quantifier-every']);
      expect(q('database-filter-quantifier-any')?.getAttribute('aria-checked')).toBe('true');

      click('database-filter-quantifier-none');

      expect(controls.effective(saved.view).filters[0]).toMatchObject({ operator: 'none:contains', value: 'x' });
    });

    it('lists the text operators second and keeps the quantifier', () => {
      const { controls, saved } = open({ operator: 'every:contains', value: 'x' });

      click('database-filter-operator');
      const ops = [...document.querySelectorAll('[data-blok-testid^="database-filter-op-"]')].map((el) => el.getAttribute('data-blok-testid')?.replace('database-filter-op-', ''));

      expect(ops).toEqual(['equals', 'does_not_equal', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty']);
      expect(q('database-filter-op-contains')?.getAttribute('aria-checked')).toBe('true');

      click('database-filter-op-starts_with');

      expect(controls.effective(saved.view).filters[0]).toMatchObject({ operator: 'every:starts_with', value: 'x' });
    });

    // Saved before the text quantifiers: a bare "any" with related row ids keeps the row picker and its pill text.
    it('keeps an older "any" + row ids filter on the related-row picker', () => {
      const env = setup({ schema: () => [...schema, names], levers: { relatedRows: () => [{ id: 'r1', title: 'Beta' }] } });

      env.saved.view = { ...env.saved.view, filters: [{ id: 'f1', propertyId: 'names', operator: 'any', value: ['r1'] }] };
      env.controls.refresh();

      expect(text(q('database-filter-pill-f1'))).toBe('Names: Beta');
      expect(q('database-filter-pill-f1')?.hasAttribute('data-active')).toBe(true);

      click('database-filter-pill-f1');

      expect(q('database-filter-quantifier')).toBeNull();
      expect(q('database-filter-value')).toBeNull();
      expect(q('database-filter-related-r1')?.getAttribute('aria-checked')).toBe('true');

      click('database-filter-operator');
      const ops = [...document.querySelectorAll('[data-blok-testid^="database-filter-op-"]')].map((el) => el.getAttribute('data-blok-testid')?.replace('database-filter-op-', ''));

      expect(ops).toEqual(['any', 'none', 'every', 'is_empty', 'is_not_empty']);
    });

    it('writes the typed text', () => {
      const { controls, saved } = open({ operator: 'any:contains', value: '' });
      const input = q('database-filter-value') as HTMLInputElement;

      input.value = 'des';
      input.dispatchEvent(new Event('input'));

      expect(controls.effective(saved.view).filters[0]).toMatchObject({ operator: 'any:contains', value: 'des' });
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

    // notion-motion.md Round 13 (r13-filter-date.png, r13-filter-ops-date.raw): "Start date ⌄ is relative to today ⌄",
    // the first button choosing Start date / End date.
    it('heads a date filter with the Start date / End date chooser in place of the name', () => {
      const { controls, saved } = open({ operator: 'this_week', value: null });

      expect(text(q('database-filter-side'))).toBe('tools.database.dateStart');
      expect(text(q('database-filter-operator'))).toBe('tools.database.filteroperator.isrelativetotoday');
      expect(text(q('database-filter-side')?.parentElement)).toBe('tools.database.dateStart tools.database.filteroperator.isrelativetotoday');

      click('database-filter-side');
      const rows = [...document.querySelectorAll('[data-blok-testid^="database-filter-side-"]')].map((el) => el.getAttribute('data-blok-testid'));

      expect(rows).toEqual(['database-filter-side-start', 'database-filter-side-end']);
      expect(text(q('database-filter-side-end'))).toBe('tools.database.dateEnd');
      expect(q('database-filter-side-start')?.getAttribute('aria-checked')).toBe('true');

      click('database-filter-side-end');

      expect(controls.effective(saved.view).filters[0]).toMatchObject({ operator: 'end:this_week', value: null });
      expect(text(q('database-filter-side'))).toBe('tools.database.dateEnd');
    });

    it('keeps End date through the relative editor and an operator pick, and goes back to Start date', () => {
      const { controls, saved } = open({ operator: 'end:this_week', value: null });

      pick('database-filter-unit', 'month');
      expect(controls.effective(saved.view).filters[0]).toMatchObject({ operator: 'end:relative_to_today', value: 'this:1:month' });

      click('database-filter-operator');
      expect(q('database-filter-op-relative_to_today')?.getAttribute('aria-checked')).toBe('true');
      click('database-filter-op-before');
      expect(controls.effective(saved.view).filters[0]).toMatchObject({ operator: 'end:before' });

      click('database-filter-side');
      click('database-filter-side-start');
      expect(controls.effective(saved.view).filters[0]).toMatchObject({ operator: 'before' });
    });

    it('has no Start date / End date chooser on Created time', () => {
      const env = setup({ schema: () => [...schema, { id: 'ct', name: 'Created', type: 'createdTime', position: 'a3' }] });

      env.saved.view = { ...env.saved.view, filters: [{ id: 'f1', propertyId: 'ct', operator: 'equals', value: null }] };
      env.controls.refresh();
      click('database-filter-pill-f1');

      expect(q('database-filter-side')).toBeNull();
      expect(text(q('database-filter-operator'))).toBe('Created tools.database.filteroperator.is');
    });

    it('edits "This week" with This / unit selects, a calendar and the moving-date note', () => {
      const { controls, saved, host } = open({ operator: 'this_week', value: null });

      expect((q('database-filter-direction') as HTMLSelectElement).value).toBe('this');
      expect((q('database-filter-unit') as HTMLSelectElement).value).toBe('week');
      // notion-motion.md Round 13: Past / Next / This, then day / week / month / year.
      expect([...(q('database-filter-direction') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['past', 'next', 'this']);
      expect([...(q('database-filter-unit') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['day', 'week', 'month', 'year']);
      expect(q('database-filter-count')).toBeNull();
      expect(document.querySelectorAll('[data-blok-database-chip-day][data-in-window]')).toHaveLength(7);
      expect(text(document.querySelector('[data-blok-database-chip-note]'))).toBe('tools.database.filterUpdatesWithDate');
      expect(host.updateView).not.toHaveBeenCalled();

      pick('database-filter-unit', 'month');

      expect(controls.effective(saved.view).filters[0]).toMatchObject({ operator: 'relative_to_today', value: 'this:1:month' });
    });

    it('ends the "Is" presets with Custom date, checked while no preset is picked (notion-motion.md Round 13)', () => {
      open({ operator: 'equals', value: null });

      const presets = [...document.querySelectorAll('[data-blok-testid^="database-filter-date-"]')].map((el) => el.getAttribute('data-blok-testid'));

      expect(presets.at(-1)).toBe('database-filter-date-custom');
      expect(text(q('database-filter-date-custom'))).toBe('tools.database.filterDateCustom');
      expect(q('database-filter-date-custom')?.getAttribute('aria-checked')).toBe('true');

      click('database-filter-date-custom');

      expect(q('database-filter-value')).toHaveFocus();
    });

    it('leaves Custom date unchecked on a preset', () => {
      open({ operator: 'equals', value: 'today' });

      expect(q('database-filter-date-custom')?.getAttribute('aria-checked')).toBe('false');
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

      expect(text(q('database-filter-operator'))).toBe('tools.database.filteroperator.isnot');
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

    it('starts "Is between" empty when switched from a single day, so no half-read value filters rows', () => {
      const { controls, saved } = open({ operator: 'equals', value: 'today' });

      click('database-filter-operator');
      click('database-filter-op-is_between');

      expect(controls.effective(saved.view).filters[0]).toMatchObject({ operator: 'is_between', value: null });
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

    // notion-motion.md Round 17 §5: the rule's pickers are flyouts under their button; the rule panel stays.
    it('opens the direction list as a 180-wide flyout over the rule panel, the current direction checked', () => {
      withSort();
      click('database-sort-pill');
      click('database-sort-direction-s1');
      const flyout = q('database-sort-direction-picker');

      expect(flyout?.style.width).toBe('180px');
      expect(flyout?.getAttribute('data-blok-database-panel-page')).toBe('sort-flyout');
      expect(q('database-sort-panel')?.contains(flyout)).toBe(false);
      expect(q('database-sort-panel')?.querySelector('[data-blok-testid="database-sort-row-s1"]')).not.toBeNull();
      expect(q('database-sort-direction-asc')?.getAttribute('aria-checked')).toBe('true');
      expect(q('database-sort-direction-desc')?.getAttribute('aria-checked')).toBe('false');
    });

    it('closes the direction flyout on a pick and keeps the rule panel', () => {
      withSort();
      click('database-sort-pill');
      click('database-sort-direction-s1');
      click('database-sort-direction-desc');

      expect(q('database-sort-direction-picker')).toBeNull();
      expect(q('database-sort-panel')?.isConnected).toBe(true);
    });

    it('opens the property list as a 280-wide flyout over the rule panel, and a pick changes the rule', () => {
      const { controls, saved } = withSort();

      click('database-sort-pill');
      click('database-sort-property-s1');
      const flyout = q('database-sort-property-picker');

      expect(flyout?.style.width).toBe('280px');
      expect(q('database-sort-panel')?.contains(flyout)).toBe(false);
      expect(q('database-sort-panel')?.querySelector('[data-blok-testid="database-sort-row-s1"]')).not.toBeNull();

      click('database-pick-property-title');

      expect(controls.effective(saved.view).sorts[0]).toMatchObject({ propertyId: 'title' });
      expect(q('database-sort-property-picker')).toBeNull();
      expect(q('database-sort-panel')?.isConnected).toBe(true);
    });

    it('Escape closes only the direction flyout and puts focus back on its button', () => {
      withSort();
      click('database-sort-pill');
      click('database-sort-direction-s1');
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(q('database-sort-direction-picker')).toBeNull();
      expect(q('database-sort-panel')).not.toBeNull();
      expect(q('database-sort-direction-s1')).toHaveFocus();
    });

    it('puts focus back on the rule\'s button after a pick, with the new label', () => {
      withSort();
      click('database-sort-pill');
      click('database-sort-direction-s1');
      click('database-sort-direction-desc');

      expect(q('database-sort-direction-s1')).toHaveFocus();
      expect(text(q('database-sort-direction-s1'))).toContain('tools.database.sortHighLow');
    });

    it('closes a rule flyout when the sort panel closes another way', () => {
      const { controls } = withSort();

      click('database-sort-pill');
      click('database-sort-direction-s1');
      controls.destroy();

      expect(q('database-sort-direction-picker')).toBeNull();
    });

    // notion-motion.md Round 17 §5: "Add sort" goes away once every property is sorted.
    it('hides "Add sort" when every sortable property is sorted', () => {
      const env = setup();

      env.saved.view = { ...env.saved.view, sorts: [{ id: 's1', propertyId: 'num', direction: 'asc' }, { id: 's2', propertyId: 'title', direction: 'asc' }] };
      env.controls.refresh();
      click('database-sort-pill');

      expect(q('database-sort-panel')).not.toBeNull();
      expect(q('database-sort-add')).toBeNull();
    });

    it('opens 4px under the chip', () => {
      withSort();
      const chip = q('database-sort-pill');

      if (chip === null) throw new Error('no chip');
      chip.getBoundingClientRect = () => new DOMRect(539, 277, 82, 24);
      click('database-sort-pill');

      expect(q('database-sort-panel')?.closest<HTMLElement>('[data-blok-popover]')?.style.top).toBe('305px');
    });

    // notion-motion.md Rounds 10-11 "Add sort picker": a separate picker under the row, its search focused,
    // the already-sorted property left out, the sort panel still open under it.
    it('opens "Add sort" as a separate picker over the open sort panel, search focused', () => {
      withSort();
      click('database-sort-pill');
      click('database-sort-add');
      const picker = q('database-sort-add-picker');

      expect(picker).not.toBeNull();
      expect(q('database-sort-panel')?.isConnected).toBe(true);
      expect(q('database-sort-panel')?.contains(picker)).toBe(false);
      expect(q('database-sort-add')).not.toBeNull();
      expect(q('database-sort-add-picker-search')).toHaveFocus();
      expect(picker?.style.width).toBe('280px');
      expect(picker?.querySelector('[data-blok-testid="database-pick-property-num"]')).toBeNull();
      expect(picker?.querySelector('[data-blok-testid="database-pick-property-title"]')).not.toBeNull();
    });

    it('adds the picked property, closes only the picker and redraws the panel with the new rule', () => {
      const { controls, saved } = withSort();

      click('database-sort-pill');
      click('database-sort-add');
      click('database-pick-property-title');

      expect(controls.effective(saved.view).sorts.map((sort) => sort.propertyId)).toEqual(['num', 'title']);
      expect(q('database-sort-add-picker')).toBeNull();
      expect(q('database-sort-panel')?.querySelectorAll('[data-blok-database-sort-row]')).toHaveLength(2);
    });

    it('moves focus to "Delete sort" when the last unsorted property is added', () => {
      withSort();
      click('database-sort-pill');
      click('database-sort-add');
      click('database-pick-property-title');

      expect(q('database-sort-add')).toBeNull();
      expect(q('database-sort-delete-all')).toHaveFocus();
    });

    it('Escape closes only the picker and puts focus back on "Add sort"', () => {
      withSort();
      click('database-sort-pill');
      click('database-sort-add');
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(q('database-sort-add-picker')).toBeNull();
      expect(q('database-sort-panel')).not.toBeNull();
      expect(q('database-sort-add')).toHaveFocus();
    });

    it('closes the picker when the sort panel closes another way', () => {
      const { controls } = withSort();

      click('database-sort-pill');
      click('database-sort-add');
      controls.destroy();

      expect(q('database-sort-add-picker')).toBeNull();
    });

    it('names the panel page "sort" for its measured rule spacing', () => {
      withSort();
      click('database-sort-pill');

      expect(q('database-sort-panel')?.getAttribute('data-blok-database-panel-page')).toBe('sort');
    });

    it('still lists every property when an existing sort changes its property', () => {
      withSort();
      click('database-sort-pill');
      click('database-sort-property-s1');

      expect(q('database-pick-property-num')).not.toBeNull();
    });

    // notion-motion.md Round 17 §5: with a sort, ⇅ first hides the bar, then shows it and opens the panel.
    it('hides the filter bar on the first Sort button click, with no panel', () => {
      withSort();
      click('database-toolbar-sort');

      expect(q('database-sort-panel')).toBeNull();
      expect(q('database-sort-pill')).toBeNull();
    });

    it('shows the bar and opens the sort panel under the chip on the next click', () => {
      withSort();
      click('database-toolbar-sort');
      click('database-toolbar-sort');

      expect(q('database-sort-panel')).not.toBeNull();
      expect(q('database-sort-pill')?.hasAttribute('data-popover-open')).toBe(true);
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
  // notion-motion.md Round 4 re-checks: while search is open Notion shows "»" ("Minimize") left of the icons.
  // It closes the search and minimizes the whole toolbar, saved with the view; « ("Expand") brings it back.
  describe('» minimizes the toolbar (Notion "Minimize")', () => {
    it('shows » left of the icons while the search is open, and » closes the search and minimizes the toolbar', () => {
      const { controls, host } = setup({ rows: 3 });

      expect(q('database-toolbar-minimize')?.hidden).toBe(true);
      click('database-toolbar-search');
      const minimize = q('database-toolbar-minimize');

      expect(minimize?.hidden).toBe(false);
      expect(minimize?.getAttribute('aria-label')).toBe('tools.database.filterBarMinimize');
      expect(q('database-toolbar-no-date')?.nextElementSibling).toBe(q('database-toolbar-filter'));

      click('database-toolbar-minimize');

      expect(host.updateView).toHaveBeenCalledWith({ toolbarMinimized: true });
      expect(q('database-search-input')).toBeNull();
      expect(q('database-toolbar-minimize')?.hidden).toBe(true);
      expect(controls.toolbar.hasAttribute('data-minimized')).toBe(true);
      expect(controls.filterBar.hidden).toBe(true);
    });

    it('opens a view saved minimized with only « and settings', () => {
      const { controls, saved } = setup({ rows: 3 });

      saved.view = { ...saved.view, toolbarMinimized: true };
      controls.refresh();
      const expand = q('database-toolbar-expand');

      expect(controls.toolbar.hasAttribute('data-minimized')).toBe(true);
      expect(expand?.hidden).toBe(false);
      expect(expand?.getAttribute('aria-label')).toBe('tools.toggle.ariaLabelExpand');
      expect(expand?.querySelector('svg')).not.toBeNull();
      expect(q('database-toolbar-minimize')?.hidden).toBe(true);
    });

    it('« brings every control back, and fades them in once', () => {
      vi.useFakeTimers();
      try {
        const { controls, host, saved } = setup({ rows: 3 });

        saved.view = { ...saved.view, toolbarMinimized: true };
        controls.refresh();
        // The host redraws inside updateView and may lay out: the fade mark must already be on.
        const markedAtUpdate: boolean[] = [];

        vi.mocked(host.updateView).mockImplementation((changes) => {
          markedAtUpdate.push(controls.toolbar.hasAttribute('data-expanding'));
          saved.view = { ...saved.view, ...changes };
        });
        click('database-toolbar-expand');

        expect(markedAtUpdate).toEqual([true]);
        expect(host.updateView).toHaveBeenCalledWith({ toolbarMinimized: false });
        expect(controls.toolbar.hasAttribute('data-minimized')).toBe(false);
        expect(q('database-toolbar-expand')?.hidden).toBe(true);
        expect(controls.toolbar.hasAttribute('data-expanding')).toBe(true);
        vi.advanceTimersByTime(300);
        expect(controls.toolbar.hasAttribute('data-expanding')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows « with no » while minimized, even with the search open', () => {
      const { controls, saved } = setup({ rows: 3 });

      click('database-toolbar-search');
      saved.view = { ...saved.view, toolbarMinimized: true };
      controls.refresh();

      expect(q('database-toolbar-minimize')?.hidden).toBe(true);
      expect(q('database-toolbar-expand')?.hidden).toBe(false);
    });

    // A blur on an empty query closes the search, so the press must not take the focus first.
    it('keeps the focus in the field on press, and gives it to settings, which stays, after', () => {
      setup({ rows: 3 });
      click('database-toolbar-search');
      const press = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });

      q('database-toolbar-minimize')?.dispatchEvent(press);
      expect(press.defaultPrevented).toBe(true);

      click('database-toolbar-minimize');
      expect(q('database-toolbar-settings')).toHaveFocus();
    });

    it('hints its name on hover, after the delay', () => {
      destroyTooltip();
      vi.useFakeTimers();
      try {
        setup({ rows: 3 });
        click('database-toolbar-search');
        hover(q('database-toolbar-minimize'));
        vi.advanceTimersByTime(HINT_DELAY - 1);
        expect(shownHint()).toBeNull();
        vi.advanceTimersByTime(1);
        expect(shownHint()?.text).toBe('tools.database.filterBarMinimize');
      } finally {
        vi.useRealTimers();
      }
    });

    // Notion: the field goes width 150→0 and opacity 1→0 over 200ms ease, then leaves.
    it('keeps the field while it shrinks away, and drops it when the shrink ends', () => {
      setup({ rows: 3 });
      click('database-toolbar-search');
      const input = q('database-search-input') as HTMLInputElement;

      input.style.transitionDuration = '0.2s';
      click('database-toolbar-minimize');

      expect(input.isConnected).toBe(true);
      expect(input.hasAttribute('data-closing')).toBe(true);
      expect(q('database-toolbar-minimize')?.hidden).toBe(true);
      expect(q('database-search-clear')).toBeNull();

      input.dispatchEvent(new Event('transitionend'));

      expect(input.isConnected).toBe(false);
      expect(input.hasAttribute('data-closing')).toBe(false);
    });

    it('drops the field after the shrink time even when no transitionend comes', () => {
      vi.useFakeTimers();
      try {
        setup({ rows: 3 });
        click('database-toolbar-search');
        const input = q('database-search-input') as HTMLInputElement;

        input.style.transitionDuration = '0.2s';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(input.isConnected).toBe(true);
        vi.advanceTimersByTime(300);
        expect(input.isConnected).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('opens again over a field that is still shrinking', () => {
      vi.useFakeTimers();
      try {
        setup({ rows: 3 });
        click('database-toolbar-search');
        const input = q('database-search-input') as HTMLInputElement;

        input.style.transitionDuration = '0.2s';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        click('database-toolbar-search');
        vi.advanceTimersByTime(300);
        input.dispatchEvent(new Event('transitionend'));

        expect(input.isConnected).toBe(true);
        expect(input.hasAttribute('data-closing')).toBe(false);
        expect(input).toHaveFocus();
        expect(q('database-toolbar-minimize')?.hidden).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Escape gives focus back to the button that opened the popover (findings K03)', () => {
    const escape = (): void => {
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    };

    it('Filter', () => {
      setup();
      click('database-toolbar-filter');
      expect(q('database-filter-picker')).not.toBeNull();
      escape();

      expect(q('database-filter-picker')).toBeNull();
      expect(q('database-toolbar-filter')).toHaveFocus();
    });

    it('Sort, with no rule and with one', () => {
      const { saved } = setup();

      click('database-toolbar-sort');
      escape();
      expect(q('database-sort-picker')).toBeNull();
      expect(q('database-toolbar-sort')).toHaveFocus();

      saved.view = { ...saved.view, sorts: [{ propertyId: 'num', direction: 'asc' }] };
      click('database-toolbar-sort');
      expect(q('database-sort-panel')).not.toBeNull();
      escape();
      expect(q('database-sort-panel')).toBeNull();
      expect(q('database-toolbar-sort')).toHaveFocus();
    });

    it('View settings', () => {
      setup();
      click('database-toolbar-settings');
      expect(q('database-view-settings')).not.toBeNull();
      escape();

      expect(q('database-view-settings')).toBeNull();
      expect(q('database-toolbar-settings')).toHaveFocus();
    });

    it('Search', () => {
      setup({ rows: 3 });
      click('database-toolbar-search');
      escape();

      expect(q('database-search-input')).toBeNull();
      expect(q('database-toolbar-search')).toHaveFocus();
    });

    it('leaves the focus alone when a pick closes the picker', () => {
      setup();
      click('database-toolbar-sort');
      click('database-pick-property-num');

      expect(q('database-toolbar-sort')).not.toHaveFocus();
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

      // A column name and the footer's "Calculate" are chrome: only row values are tinted.
      body.innerHTML = '<span data-blok-database-table-column-name>Alpha col</span><span data-blok-database-cell>Alpha</span>'
        + '<span data-blok-database-card-title>Delta alpha</span><span data-blok-database-table-calc-placeholder>Calculate</span>';
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

    // Shots 20, 22 and 23 show » with a sort; 15, 17 (a filter only) and 41 (no rule) do not.
    it('shows no » for a bar of filters alone', () => {
      withFilter();

      expect(q('database-toolbar-minimize')?.hidden).toBe(true);
    });

    it('shows » left of Filter while the bar shows a sort, and » hides the bar', () => {
      const { controls, saved } = withFilter();

      saved.view = { ...saved.view, sorts: [{ id: 's1', propertyId: 'num', direction: 'asc' }] };
      controls.refresh();
      const minimize = q('database-toolbar-minimize');

      expect(controls.filterBar.hidden).toBe(false);
      expect(minimize?.hidden).toBe(false);
      // A calendar or timeline's "No date" sits between them (findings C03); here it is hidden.
      expect(minimize?.nextElementSibling).toBe(q('database-toolbar-no-date'));
      expect(q('database-toolbar-no-date')?.nextElementSibling).toBe(q('database-toolbar-filter'));
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

    it('shows the bar again when a column header sorts after a minimize', () => {
      const { controls, saved } = withFilter();

      saved.view = { ...saved.view, sorts: [{ id: 's1', propertyId: 'num', direction: 'asc' }] };
      controls.refresh();
      click('database-toolbar-minimize');
      controls.sortBy('num', document.body);
      click('database-header-sort-asc');

      expect(controls.filterBar.hidden).toBe(false);
      expect(q('database-sort-pill')).not.toBeNull();
    });

    // notion-motion.md Round 10 "Add filter picker": the already-filtered property is left out.
    it('leaves the filtered property out of "+ Filter"', () => {
      withFilter();
      click('database-filter-bar-add');

      expect(q('database-filter-picker')).not.toBeNull();
      expect(q('database-pick-property-num')).toBeNull();
      expect(q('database-pick-property-title')).not.toBeNull();
    });

    // notion-motion.md Round 18 §2 (r18-bar-addfilter-allused.raw): an empty list says "No results".
    it('says "No results" in "+ Filter" once every property is filtered', () => {
      const { controls, saved } = setup();

      saved.view = {
        ...saved.view,
        filters: [{ id: 'f1', propertyId: 'num', operator: 'greater_than', value: 5 }, { id: 'f2', propertyId: 'title', operator: 'contains', value: 'a' }],
      };
      controls.refresh();
      click('database-filter-bar-add');
      const note = q('database-filter-picker')?.querySelector('[data-blok-database-panel-note]');

      expect(note?.textContent).toBe('find.noResults');
      expect(q('database-filter-picker-advanced')).not.toBeNull();
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
