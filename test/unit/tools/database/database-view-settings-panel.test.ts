import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseModel } from '../../../../src/tools/database/database-model';
import { openFilterPill, openViewSettings } from '../../../../src/tools/database/database-view-settings-panel';
import type { ViewSettingsContext, ViewSettingsStart } from '../../../../src/tools/database/database-view-settings-panel';
import type { DatabasePanel } from '../../../../src/tools/database/database-panel';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';
import { IconBoard, IconTable } from '../../../../src/components/icons';
import { PopoverItemType } from '../../../../src/components/utils/popover/components/popover-item';

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'due', name: 'Due', type: 'date', position: 'a1' },
  { id: 'num', name: 'Amount', type: 'number', position: 'a2' },
  { id: 'stage', name: 'Stage', type: 'select', position: 'a3', config: { options: [{ id: 'o1', label: 'Idea', position: 'a0' }] } },
  { id: 'prog', name: 'Progress', type: 'status', position: 'a4', config: { options: [{ id: 's1', label: 'Not started', position: 'a0', groupId: 'todo' }] } },
  { id: 'owner', name: 'Owner', type: 'person', position: 'a5' },
];

const click = (id: string): void => {
  const el = document.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`);

  if (el === null) throw new Error(`no ${id}`);
  el.click();
};

const exists = (id: string): boolean => document.querySelector(`[data-blok-testid="${id}"]`) !== null;

interface Harness {
  ctx: ViewSettingsContext;
  state: { view: DatabaseViewConfig; locked: boolean };
  open: (start?: ViewSettingsStart) => DatabasePanel;
  openPill: (filterId: string) => DatabasePanel;
}

const harness = (view: Partial<DatabaseViewConfig> = {}): Harness => {
  const state = {
    view: { id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view } satisfies DatabaseViewConfig,
    locked: false,
  };
  const holder: { panel: DatabasePanel | null } = { panel: null };
  const apply = (changes: Partial<DatabaseViewConfig>): void => {
    state.view = { ...state.view, ...changes };
    holder.panel?.refresh();
  };
  const ctx: ViewSettingsContext = {
    i18n: { t: (key: string) => key },
    view: () => state.view,
    schema: () => schema,
    locked: () => state.locked,
    layouts: ['table', 'board', 'list'],
    canDeleteView: () => true,
    updateView: vi.fn((changes: Partial<DatabaseViewConfig>) => apply(changes)),
    updatePersonal: vi.fn((patch: Partial<DatabaseViewConfig>) => apply(patch)),
    setLayout: vi.fn((type: DatabaseViewConfig['type']) => apply({ type })),
    setLocked: vi.fn((locked: boolean) => {
      state.locked = locked;
    }),
    duplicateView: vi.fn(),
    deleteView: vi.fn(),
    copyViewLink: vi.fn(),
    groups: () => [{ key: 'o1', label: 'Idea', count: 2 }, { key: 'none', label: 'No Stage', count: 0 }],
  };
  const anchor = document.createElement('button');

  document.body.appendChild(anchor);

  return {
    ctx,
    state,
    open: (start = 'root') => {
      holder.panel = openViewSettings(anchor, ctx, start);

      return holder.panel;
    },
    openPill: (filterId) => {
      holder.panel = openFilterPill(anchor, ctx, filterId);

      return holder.panel;
    },
  };
};

describe('view settings panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  // research/26 §1a: 290 wide at the window's end edge, radius 10, whatever opened it.
  it('docks at the window\'s end edge from every start page', () => {
    const docked = (): boolean => document.querySelector('[data-blok-testid="database-view-settings"]')
      ?.closest('[data-blok-popover-custom-class]')
      ?.getAttribute('data-blok-popover-custom-class')
      ?.split(' ')
      .includes('blok-database-docked-panel') === true;
    const h = harness();

    for (const start of ['root', 'filter', 'sort'] as const) {
      const panel = h.open(start);

      expect(docked()).toBe(true);
      panel.close();
    }
  });

  // findings V11: every root row carries a glyph; Layout's follows the view's layout.
  it('gives every root row a glyph, and Layout the current layout\'s', () => {
    const h = harness({ type: 'board' });

    h.ctx.manageInCalendar = { label: 'Manage in Calendar', onClick: vi.fn() };
    h.open();
    const rows = [...document.querySelectorAll<HTMLElement>('[data-blok-testid="database-view-settings"] [data-blok-database-panel-row]')];

    expect(rows.length).toBeGreaterThan(8);
    for (const row of rows) {
      expect(row.querySelector('[data-blok-database-panel-icon] svg'), row.getAttribute('data-blok-testid') ?? '').not.toBeNull();
    }
    const layoutIcon = (): string | undefined => document.querySelector('[data-blok-testid="database-settings-layout"] [data-blok-database-panel-icon]')?.innerHTML;
    const html = (svg: string): string => Object.assign(document.createElement('span'), { innerHTML: svg }).innerHTML;

    expect(layoutIcon()).toBe(html(IconBoard));
    click('database-settings-layout');
    click('database-layout-table');
    click('database-panel-back');
    expect(layoutIcon()).toBe(html(IconTable));
  });

  // findings V12, research/26 §1a: Notion's order; Duplicate and Delete live in the tab menu only.
  it('orders the root rows as Notion does, with dividers around the data source settings', () => {
    const h = harness();

    h.ctx.automations = { writable: () => true } as unknown as NonNullable<ViewSettingsContext['automations']>;
    h.ctx.structure = { subItems: () => false, setSubItems: vi.fn(), dependencies: () => undefined, setDependencies: vi.fn(), updateDependency: vi.fn() };
    h.open();
    const parts = [...document.querySelectorAll<HTMLElement>('[data-blok-testid="database-view-settings"] > :not([data-blok-database-panel-header], [data-blok-database-view-name-row])')].map((el) =>
      el.getAttribute('data-blok-testid')?.replace('database-settings-', '')
        ?? (el.hasAttribute('data-blok-database-panel-separator') ? '—' : `[${el.textContent ?? ''}]`));

    expect(parts).toEqual([
      'layout', 'properties', 'filter', 'sort', 'group', 'color', 'copy-link',
      '—', '[tools.database.settingsDataSourceSettings]', 'automations', 'more',
      '—', 'lock',
    ]);
  });

  it('shows no value on an empty Filter, Sort, Group or Conditional color, and the count once set', () => {
    const value = (id: string): string | null => document.querySelector(`[data-blok-testid="database-settings-${id}"] [data-blok-database-panel-value]`)?.textContent ?? null;
    const first = harness({ type: 'board' }).open();

    for (const id of ['filter', 'sort', 'group', 'subgroup', 'color']) expect(value(id), id).toBeNull();
    first.close();
    harness({ type: 'board', sorts: [{ id: 's', propertyId: 'num', direction: 'asc' }], groupBy: 'stage' }).open();
    expect(value('sort')).toBe('1');
    expect(value('group')).toBe('Stage');
  });

  it('puts the CSV actions under More settings; other actions stay on the root', () => {
    const h = harness();
    const exportCsv = vi.fn();

    h.ctx.actions = () => [
      { testId: 'database-settings-chart-save', label: 'Save chart as…', icon: '', page: () => ({ build: () => [] }) },
      { testId: 'database-settings-csv-export', label: 'Export as CSV', icon: '', moreSettings: true, onClick: exportCsv },
    ];
    const panel = h.open();
    const close = vi.spyOn(panel, 'close');

    expect(exists('database-settings-chart-save')).toBe(true);
    expect(exists('database-settings-csv-export')).toBe(false);
    click('database-settings-more');
    click('database-settings-csv-export');
    expect(exportCsv).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalled();
  });

  // findings V10: under the title, the layout glyph and a "View name" field (09-notion-rename-full.png).
  describe('view name field', () => {
    const field = (): HTMLInputElement => {
      const input = document.querySelector<HTMLInputElement>('[data-blok-testid="database-settings-view-name"]');

      if (input === null) throw new Error('no view name field');

      return input;
    };
    const type = (value: string, key: 'Enter' | 'blur'): void => {
      field().value = value;
      field().dispatchEvent(new Event('input', { bubbles: true }));
      if (key === 'Enter') field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      else field().dispatchEvent(new FocusEvent('blur'));
    };

    it('sits first, after the layout glyph, holding the view\'s name', () => {
      harness({ name: 'Roadmap', type: 'board' }).open();
      const row = field().closest('[data-blok-database-view-name-row]');

      expect(row).toBe(document.querySelector('[data-blok-testid="database-view-settings"] > :nth-child(2)'));
      expect(row?.querySelector('[data-blok-database-view-name-icon] svg')).not.toBeNull();
      expect(field().value).toBe('Roadmap');
      expect(field().placeholder).toBe('tools.database.layoutViewName');
    });

    it('renames the view on Enter or blur, trimmed', () => {
      const h = harness();

      h.open();
      type('  Plan  ', 'Enter');
      expect(h.ctx.updateView).toHaveBeenLastCalledWith({ name: 'Plan' });
      type('Later', 'blur');
      expect(h.ctx.updateView).toHaveBeenLastCalledWith({ name: 'Later' });
    });

    it('writes nothing for an unchanged or blank name', () => {
      const h = harness({ name: 'Table' });

      h.open();
      type('Table', 'Enter');
      type('   ', 'blur');
      expect(h.ctx.updateView).not.toHaveBeenCalled();
      expect(field().value).toBe('Table');
    });

    // findings V08: Rename opens View settings with the name field focused.
    it('a "rename" start opens the root with the name selected in the focused field', () => {
      harness({ name: 'Roadmap' }).open('rename');

      expect(field()).toHaveFocus();
      expect([field().selectionStart, field().selectionEnd]).toEqual([0, 'Roadmap'.length]);
      expect(document.querySelector('[data-blok-database-panel-header]')?.getAttribute('data-blok-database-panel-header')).toBe('label');
    });

    it('is read-only while the database is locked', () => {
      const h = harness();

      h.state.locked = true;
      h.open();
      expect(field().disabled).toBe(true);
    });
  });

  it('lists Notion\'s settings rows (research/08)', () => {
    harness().open();

    for (const id of ['layout', 'properties', 'filter', 'sort', 'group', 'color', 'copy-link', 'lock']) {
      expect(exists(`database-settings-${id}`)).toBe(true);
    }
    expect(exists('database-settings-subgroup')).toBe(false);
  });

  // research/26 §1a: the root title is a small label; a sub-page title keeps the 14/600 header.
  it('marks only the root page title as a label', () => {
    const header = (): Element | null => document.querySelector('[data-blok-database-panel-header]');
    const h = harness();

    h.open();
    expect(header()?.getAttribute('data-blok-database-panel-header')).toBe('label');

    click('database-settings-layout');
    expect(header()?.getAttribute('data-blok-database-panel-header')).toBe('');
  });

  it('a panel opened straight at a sub-page keeps the 14/600 header', () => {
    harness().open('filter');

    expect(document.querySelector('[data-blok-database-panel-header]')?.getAttribute('data-blok-database-panel-header')).toBe('');
  });

  it('offers a sub-group on a board only', () => {
    harness({ type: 'board' }).open();

    expect(exists('database-settings-subgroup')).toBe(true);
  });

  it('switches the layout and marks the current one with a check', () => {
    const h = harness();

    h.open();
    click('database-settings-layout');

    expect(document.querySelector('[data-blok-testid="database-layout-table"]')?.getAttribute('aria-checked')).toBe('true');

    click('database-layout-board');

    expect(h.ctx.setLayout).toHaveBeenCalledWith('board');
    expect(document.querySelector('[data-blok-testid="database-layout-board"]')?.getAttribute('aria-checked')).toBe('true');
  });

  it('mounts the layout rows a gallery or calendar gives: a page per choice list, a switch per toggle', () => {
    const h = harness({ type: 'gallery' });
    const pickLarge = vi.fn();
    const flip = vi.fn();

    h.ctx.layoutItems = () => [
      {
        type: PopoverItemType.Default,
        name: 'gallery-card-size',
        title: 'Card size',
        children: { items: [
          { type: PopoverItemType.Default, name: 'gallery-card-size-small', title: 'Small', isActive: true, onActivate: vi.fn() },
          { type: PopoverItemType.Default, name: 'gallery-card-size-large', title: 'Large', isActive: false, onActivate: pickLarge },
        ] },
      },
      { type: PopoverItemType.Default, name: 'gallery-fit-image', title: 'Fit image', isActive: true, onActivate: flip },
    ];
    h.open();
    click('database-settings-layout');

    expect(document.querySelector('[data-blok-testid="database-gallery-card-size"]')?.textContent).toContain('Small');
    expect(document.querySelector('[data-blok-testid="database-gallery-fit-image"]')?.getAttribute('role')).toBe('switch');
    expect(document.querySelector('[data-blok-testid="database-gallery-fit-image"]')?.getAttribute('aria-checked')).toBe('true');

    click('database-gallery-fit-image');
    expect(flip).toHaveBeenCalledTimes(1);

    click('database-gallery-card-size');
    expect(document.querySelector('[data-blok-testid="database-gallery-card-size-small"]')?.getAttribute('aria-checked')).toBe('true');
    click('database-gallery-card-size-large');
    expect(pickLarge).toHaveBeenCalledTimes(1);
  });

  it('lists the tool actions on the root page; a click closes the panel and runs it', () => {
    const h = harness();
    const exportCsv = vi.fn();

    h.ctx.actions = () => [
      { testId: 'database-settings-csv-export', label: 'Export as CSV', icon: '', onClick: exportCsv },
      { testId: 'database-settings-csv-merge', label: 'Merge with CSV', icon: '', onClick: vi.fn(), disabled: true },
    ];
    const panel = h.open();
    const close = vi.spyOn(panel, 'close');

    expect(document.querySelector<HTMLButtonElement>('[data-blok-testid="database-settings-csv-merge"]')?.disabled).toBe(true);
    click('database-settings-csv-export');
    expect(exportCsv).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalled();
  });

  it('disables the mounted layout rows while the database is locked', () => {
    const h = harness({ type: 'gallery' });

    h.ctx.layoutItems = () => [{ type: PopoverItemType.Default, name: 'gallery-fit-image', title: 'Fit image', isActive: false, onActivate: vi.fn() }];
    h.state.locked = true;
    h.open();
    click('database-settings-layout');

    expect(document.querySelector<HTMLButtonElement>('[data-blok-testid="database-gallery-fit-image"]')?.disabled).toBe(true);
  });

  it('marks the layout\'s default open mode with "Default for <layout>", under that mode only', () => {
    const h = harness();

    h.open();
    click('database-settings-layout');
    click('database-settings-open-pages');
    const text = document.body.textContent ?? '';

    expect(text.match(/tools\.database\.openPagesDefaultFor/g)).toHaveLength(1);
    expect(text).toContain('tools.database.openPagesSideDescriptiontools.database.openPagesDefaultFor');
  });

  describe('"Show data source title" on a linked view (research/20 §1f, §2b; R-2022-03-15)', () => {
    /** Test ids of the Layout page rows after the layout tiles, top to bottom. */
    const rowsAfterTiles = (): string[] => {
      const ids = [...document.querySelectorAll<HTMLElement>('[data-blok-testid="database-view-settings"] [data-blok-testid^="database-"]')]
        .map((el) => el.getAttribute('data-blok-testid') ?? '')
        .filter((id) => id.startsWith('database-settings-') || id.startsWith('database-layout-'));

      const lastTile = ids.map((id) => id.startsWith('database-layout-')).lastIndexOf(true);

      return ids.slice(lastTile + 1);
    };

    it.each(['table', 'map'] as const)('is the first row after the tiles on a linked %s, on by default, and turns off', (type) => {
      const h = harness({ type });

      h.ctx.linked = () => true;
      h.open();
      click('database-settings-layout');

      expect(rowsAfterTiles()[0]).toBe('database-settings-data-source-title');
      expect(document.querySelector('[data-blok-testid="database-settings-data-source-title"]')?.getAttribute('aria-checked')).toBe('true');
      click('database-settings-data-source-title');
      expect(h.ctx.updateView).toHaveBeenCalledWith({ showDataSourceTitle: false });
    });

    it('is not offered on a database that holds its own rows', () => {
      const h = harness();

      h.open();
      click('database-settings-layout');

      expect(exists('database-settings-data-source-title')).toBe(false);
    });
  });

  describe('a board\'s "Card layout" (research/30 §10d, §10f; shots 22, 24)', () => {
    const tiles = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-blok-database-card-layout-tile]')];

    it('ends the board\'s layout page with a "Card layout" box of two tiles, Compact then List; List is the default', () => {
      harness({ type: 'board', groupBy: 'stage' }).open();
      click('database-settings-layout');
      const box = document.querySelector<HTMLElement>('[data-blok-testid="database-settings-card-layout"]');

      expect(box?.parentElement?.lastElementChild).toBe(box);
      expect(box?.querySelector('[data-blok-database-card-layout-label]')?.textContent).toBe('tools.database.settingsCardLayout');
      expect(tiles().map((tile) => tile.textContent?.trim())).toEqual(['tools.database.settingsCardLayoutCompact', 'tools.database.viewTypeList']);
      expect(tiles().map((tile) => tile.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    });

    it('a tile click saves the layout and moves the pick', () => {
      const h = harness({ type: 'board', groupBy: 'stage' });

      h.open();
      click('database-settings-layout');
      click('database-card-layout-compact');

      expect(h.ctx.updateView).toHaveBeenCalledWith({ cardLayout: 'compact' });
      expect(tiles().map((tile) => tile.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    });

    it('is not on a table, and its tiles are disabled while the view is locked', () => {
      harness().open();
      click('database-settings-layout');
      expect(exists('database-settings-card-layout')).toBe(false);
      document.body.innerHTML = '';

      const h = harness({ type: 'board', groupBy: 'stage' });

      h.state.locked = true;
      h.open();
      click('database-settings-layout');
      expect(tiles().every((tile) => (tile as HTMLButtonElement).disabled)).toBe(true);
    });
  });

  it('sets the load limit, where pages open, and the layout switches', () => {
    const h = harness();

    h.open();
    click('database-settings-layout');
    click('database-settings-load-limit');
    click('database-load-limit-100');

    expect(h.ctx.updateView).toHaveBeenCalledWith({ loadLimit: 100 });

    click('database-panel-back');
    click('database-settings-open-pages');

    expect(document.body.textContent).toContain('tools.database.openPagesSideDescription');

    click('database-open-pages-center');

    expect(h.ctx.updateView).toHaveBeenCalledWith({ openPagesIn: 'center' });

    click('database-panel-back');
    click('database-settings-wrap');
    click('database-settings-vertical-lines');
    click('database-settings-page-icon');

    // A table wraps by default, so the switch turns it off.
    expect(h.ctx.updateView).toHaveBeenCalledWith({ wrapCells: false });
    expect(h.ctx.updateView).toHaveBeenCalledWith({ showVerticalLines: false });
    expect(h.ctx.updateView).toHaveBeenCalledWith({ showPageIcon: false });
  });

  it('hides a property and keeps the title always shown', () => {
    const h = harness();

    h.open();
    click('database-settings-properties');

    expect(exists('database-property-visible-title')).toBe(false);

    click('database-property-visible-due');

    expect(h.state.view.properties?.find((p) => p.id === 'due')?.visible).toBe(false);
  });

  // research/35 §2.2: Feed's Property visibility leaves out the title property.
  describe('a feed view', () => {
    const titleOnly: PropertyDefinition[] = [{ id: 'title', name: 'Name', type: 'title', position: 'a0' }];
    const countOf = (): string | null | undefined =>
      document.querySelector('[data-blok-testid="database-settings-properties"] [data-blok-database-panel-value]')?.textContent;

    it('counts and lists no title, and reads "No results" with nothing else', () => {
      const h = harness({ type: 'feed' });

      h.ctx.schema = () => titleOnly;
      h.open();
      expect(countOf()).toBe('0');

      click('database-settings-properties');
      expect(document.querySelector('[data-blok-database-panel-note]')?.textContent).toBe('find.noResults');
      expect(document.body.textContent).not.toContain('Name');
    });

    it('lists the other properties without the title', () => {
      const h = harness({ type: 'feed' });

      h.open();
      // The harness view shows nothing but the title, which Feed does not count.
      expect(countOf()).toBe('0');

      click('database-settings-properties');
      expect(exists('database-property-visible-due')).toBe(true);
      expect(document.querySelector('[data-blok-testid="database-properties-list"]')?.textContent).not.toContain('Name');
    });

    // research/35:197: the page reads "Shown in feed | Hide all | Note".
    it('heads the list with "Shown in feed" and a Hide all that hides every listed property at once', () => {
      const h = harness({ type: 'feed', properties: [{ id: 'due', visible: true }, { id: 'num', visible: true }] });

      h.open();
      click('database-settings-properties');
      expect(document.querySelector('[data-blok-database-panel-section]')?.textContent).toBe('tools.database.settingsShownInFeed');
      expect(document.querySelector('[data-blok-testid="database-property-hide-all"]')?.textContent).toContain('tools.database.groupHideAll');

      vi.mocked(h.ctx.updateView).mockClear();
      click('database-property-hide-all');

      expect(h.ctx.updateView).toHaveBeenCalledTimes(1);
      expect(h.state.view.properties?.filter((p) => p.visible).map((p) => p.id)).toEqual([]);
      expect(h.state.view.properties?.some((p) => p.id === 'title' && !p.visible)).toBe(false);
      expect(document.querySelector('[data-blok-testid="database-property-hide-all"]')?.textContent).toContain('tools.database.groupShowAll');
    });

    it('has no header when only the title exists', () => {
      const h = harness({ type: 'feed' });

      h.ctx.schema = () => titleOnly;
      h.open();
      click('database-settings-properties');
      expect(exists('database-property-hide-all')).toBe(false);
    });

    it('a table has no "Shown in feed" header', () => {
      const h = harness();

      h.open();
      click('database-settings-properties');
      expect(exists('database-property-hide-all')).toBe(false);
      expect(document.body.textContent).not.toContain('tools.database.settingsShownInFeed');
    });

    // research/35 §2.3: a fresh Table reads "Property visibility 1": the title counts there.
    it('a table still counts and lists its title', () => {
      const h = harness();

      h.ctx.schema = () => titleOnly;
      h.open();
      expect(countOf()).toBe('1');

      click('database-settings-properties');
      expect(document.querySelector('[data-blok-testid="database-properties-list"]')?.textContent).toContain('Name');
    });
  });

  it('adds a sort as a personal edit and flips its direction', () => {
    const h = harness();

    h.open('sort');
    click('database-sort-add');
    click('database-pick-property-num');

    expect(h.ctx.updatePersonal).toHaveBeenCalled();
    expect(h.ctx.updateView).not.toHaveBeenCalled();
    const [sort] = h.state.view.sorts;

    expect(sort).toMatchObject({ propertyId: 'num', direction: 'asc' });
    expect(document.querySelector(`[data-blok-testid="database-sort-direction-${sort.id ?? ''}"]`)?.textContent).toContain('tools.database.sortLowHigh');

    click(`database-sort-direction-${sort.id ?? ''}`);

    expect(h.state.view.sorts[0].direction).toBe('desc');
  });

  it('draws a sort as Notion\'s property button with its type icon and an icon-only remove × (research/26 §3a)', () => {
    const h = harness({ sorts: [{ id: 's1', propertyId: 'due', direction: 'asc' }] });

    h.open('sort');
    const property = document.querySelector('[data-blok-testid="database-sort-property-s1"]');
    const remove = document.querySelector('[data-blok-testid="database-sort-remove-s1"]');

    expect(property?.querySelector('[data-blok-database-panel-icon] svg')).not.toBeNull();
    expect(remove?.getAttribute('aria-label')).toBe('tools.database.sortRemove');
    expect(remove?.querySelector('[data-blok-database-panel-label]')).toBeNull();
    expect(remove?.textContent?.trim()).toBe('');

    click('database-sort-remove-s1');

    expect(h.state.view.sorts).toEqual([]);
  });

  it('puts a Close × at the end of the root header that closes the panel, and keeps first focus on the rows (research/26 §1b)', () => {
    const h = harness();
    const panel = h.open();
    const close = panel.root.querySelector('[data-blok-database-panel-header] [data-blok-testid="database-panel-close"]');

    expect(close?.getAttribute('aria-label')).toBe('tools.database.close');
    expect(close?.parentElement?.lastElementChild).toBe(close);
    expect(document.activeElement?.getAttribute('data-blok-testid')).not.toBe('database-panel-close');
    expect(panel.root.isConnected).toBe(true);

    click('database-panel-close');

    expect(panel.root.isConnected).toBe(false);
  });

  it('has no Close × on a sub-page, which keeps its Back arrow', () => {
    harness().open();
    click('database-settings-sort');

    expect(exists('database-panel-back')).toBe(true);
    expect(exists('database-panel-close')).toBe(false);
  });

  it('marks "Add sort" and "Delete sort" as muted rows, and the sort itself not (research/21 §1c)', () => {
    const h = harness({ sorts: [{ id: 's1', propertyId: 'num', direction: 'asc' }] });

    h.open('sort');
    const muted = (id: string): boolean => document.querySelector(`[data-blok-testid="${id}"]`)?.hasAttribute('data-muted') === true;

    expect(muted('database-sort-add')).toBe(true);
    expect(muted('database-sort-delete-all')).toBe(true);
    expect(muted('database-sort-property-s1')).toBe(false);
    expect(muted('database-sort-direction-s1')).toBe(false);
  });

  it('adds a simple filter and edits its value in its own page', () => {
    const h = harness();

    h.open('filter');
    click('database-filter-add');
    click('database-pick-property-stage');
    click('database-filter-option-o1');

    expect(h.state.view.filters).toEqual([expect.objectContaining({ propertyId: 'stage', operator: 'equals', value: ['o1'] })]);
  });

  it('offers every filterable property in "+ Filter", Files and ID too, but never a button', () => {
    const h = harness();
    const extra: PropertyDefinition[] = [
      { id: 'att', name: 'Attachment', type: 'files', position: 'a6' },
      { id: 'uid', name: 'ID', type: 'uniqueId', position: 'a7' },
      { id: 'act', name: 'Act', type: 'button', position: 'a8' },
    ];

    h.ctx.schema = () => [...schema, ...extra];
    h.open('filter');
    click('database-filter-add');

    expect(exists('database-pick-property-att')).toBe(true);
    expect(exists('database-pick-property-uid')).toBe(true);
    expect(exists('database-pick-property-act')).toBe(false);
  });

  it('reorders simple filters from the Filters page, keyboard Alt+Arrow included', () => {
    const h = harness({ filters: [
      { id: 'f1', propertyId: 'num', operator: 'is_not_empty', value: null },
      { id: 'f2', propertyId: 'due', operator: 'is_empty', value: null },
    ] });

    h.open('filter');
    document.querySelector('[data-blok-testid="database-filters-list-handle-f2"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }));

    expect(h.state.view.filters.map((f) => f.id)).toEqual(['f2', 'f1']);
  });

  it('reorders sorts from the Sort page, keyboard Alt+Arrow included', () => {
    const h = harness({ sorts: [
      { id: 's1', propertyId: 'num', direction: 'asc' },
      { id: 's2', propertyId: 'due', direction: 'desc' },
    ] });

    h.open('sort');
    document.querySelector('[data-blok-testid="database-sorts-list-handle-s1"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));

    expect(h.state.view.sorts.map((s) => s.id)).toEqual(['s2', 's1']);
  });

  // Ledger D31 (79b5db3a · database-panel.ts:340): a sort row also moves by dragging its ⋮⋮ handle.
  describe('dragging a sort row by its handle', () => {
    const sorts = (): DatabaseViewConfig['sorts'] => [
      { id: 's1', propertyId: 'num', direction: 'asc' },
      { id: 's2', propertyId: 'due', direction: 'desc' },
      { id: 's3', propertyId: 'title', direction: 'asc' },
    ];

    /** jsdom has no layout: rows stack 30px tall from y=100, so the middles are 115, 145, 175. */
    const layOut = (): void => {
      document.querySelectorAll<HTMLElement>('[data-blok-testid="database-sorts-list"] [data-blok-database-panel-list-item]').forEach((row, i) => {
        vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
          left: 0, top: 100 + i * 30, width: 200, height: 30, right: 200, bottom: 130 + i * 30, x: 0, y: 100 + i * 30, toJSON: () => ({}),
        });
      });
    };

    const drag = (id: string, toY: number): void => {
      const handle = document.querySelector(`[data-blok-testid="database-sorts-list-handle-${id}"]`);

      if (handle === null) throw new Error(`no handle ${id}`);
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientY: 115 }));
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: toY }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: toY }));
    };

    it('drops the row past each row whose middle its leading edge crossed', () => {
      const h = harness({ sorts: sorts() });

      h.open('sort');
      layOut();
      drag('s1', 150);

      expect(h.state.view.sorts.map((sort) => sort.id)).toEqual(['s2', 's1', 's3']);
    });

    it('drops the row at the end once it crosses the last middle', () => {
      const h = harness({ sorts: sorts() });

      h.open('sort');
      layOut();
      drag('s1', 180);

      expect(h.state.view.sorts.map((sort) => sort.id)).toEqual(['s2', 's3', 's1']);
    });

    it('ignores a right-button press', () => {
      const h = harness({ sorts: sorts() });

      h.open('sort');
      layOut();
      document.querySelector('[data-blok-testid="database-sorts-list-handle-s1"]')
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 2, clientY: 115 }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: 180 }));

      expect(h.state.view.sorts.map((sort) => sort.id)).toEqual(['s1', 's2', 's3']);
    });
  });

  // Ledger D30 (7f240977 · database-view-settings-panel.ts:1108): a date filter takes Today, One week ago… from its page.
  it('picks a relative date value for a date filter from the filter page, and an exact date replaces it', () => {
    const h = harness();

    h.open('filter');
    click('database-filter-add');
    click('database-pick-property-due');
    // A new date filter starts as "is within this week"; "Is" brings the value rows.
    click('database-filter-operator');
    click('database-filter-op-equals');
    click('database-filter-date-one_week_ago');

    expect(h.state.view.filters).toEqual([expect.objectContaining({ propertyId: 'due', operator: 'equals', value: 'one_week_ago' })]);
    expect(document.querySelector('[data-blok-testid="database-filter-date-one_week_ago"]')?.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('[data-blok-testid="database-filter-date-today"]')?.getAttribute('aria-checked')).toBe('false');

    click('database-filter-date-today');
    expect(h.state.view.filters[0]?.value).toBe('today');

    const exact = document.querySelector<HTMLInputElement>('[data-blok-testid="database-filter-value"]');

    if (exact === null) throw new Error('no exact date field');
    exact.value = '2026-10-20';
    exact.dispatchEvent(new Event('input', { bubbles: true }));

    expect(h.state.view.filters[0]?.value).toBe('2026-10-20');
    expect(document.querySelector('[data-blok-testid="database-filter-date-today"]')?.getAttribute('aria-checked')).toBe('false');
  });

  it('moves flat filters into the advanced tree on its first edit', () => {
    const h = harness({ filters: [
      { id: 'legacy-title', propertyId: 'title', operator: 'equals', value: 'Alpha' },
      { id: 'legacy-num', propertyId: 'num', operator: 'greater_than', value: 10 },
    ] });

    h.open('filter');
    click('database-filter-advanced');
    const add = document.querySelector<HTMLElement>('[data-blok-testid^="database-filter-add-rule-"]');

    if (add === null) throw new Error('no advanced filter add button');
    add.click();
    click('database-pick-property-due');

    expect(h.state.view.filters).toEqual([]);
    expect(h.state.view.filterTree?.filterRules).toHaveLength(3);
    expect(h.state.view.filterTree?.filterRules.slice(0, 2)).toEqual([
      { id: 'legacy-title', propertyId: 'title', operator: 'equals', value: 'Alpha' },
      { id: 'legacy-num', propertyId: 'num', operator: 'greater_than', value: 10 },
    ]);
  });

  it('builds an advanced filter with nested groups, three layers at most', () => {
    const h = harness({ filterTree: { id: 'root', conjunction: 'and', filterRules: [] } });

    h.open('filter');
    click('database-filter-advanced');
    const root = (): string => h.state.view.filterTree?.id ?? '';

    click(`database-filter-add-rule-${root()}`);
    click('database-pick-property-num');
    click(`database-filter-add-group-${root()}`);

    const tree = h.state.view.filterTree;
    const layer2 = tree?.filterRules.find((node) => 'filterRules' in node);

    expect(tree?.filterRules).toHaveLength(2);
    expect(exists(`database-filter-conjunction-${root()}`)).toBe(true);

    click(`database-filter-add-group-${layer2?.id ?? ''}`);
    const layer3 = h.state.view.filterTree?.filterRules
      .flatMap((node) => ('filterRules' in node ? node.filterRules : []))
      .find((node) => 'filterRules' in node);

    expect(layer3).toBeDefined();
    expect(exists(`database-filter-add-rule-${layer3?.id ?? ''}`)).toBe(true);
    expect(exists(`database-filter-add-group-${layer3?.id ?? ''}`)).toBe(false);
    expect(h.ctx.updateView).not.toHaveBeenCalled();
  });

  it('sets And or Or on a group', () => {
    const h = harness({
      filterTree: {
        id: 'root',
        conjunction: 'and',
        filterRules: [
          { id: 'a', propertyId: 'num', operator: 'is_empty', value: null },
          { id: 'b', propertyId: 'due', operator: 'is_empty', value: null },
        ],
      },
    });

    h.open('filter');
    click('database-filter-advanced');
    click('database-filter-conjunction-root');
    click('database-filter-conjunction-or');

    expect(h.state.view.filterTree?.conjunction).toBe('or');
  });

  it('groups a date by week and hides every group at once', () => {
    const h = harness({ groupBy: 'due' });

    h.open('group');
    click('database-group-date-by');
    click('database-group-date-by-week');

    expect(h.state.view.groupSettings).toEqual({ dateBy: 'week' });

    click('database-group-hide-all');

    expect(h.state.view.hiddenGroups).toEqual([{ id: 'o1' }, { id: 'none' }]);
  });

  // research/22 §7: "Number by: Unique" by default; Range shows 0 – 1000, every 100.
  it('groups a number by Unique, and Range starts at 0 to 1000 every 100', () => {
    const h = harness({ groupBy: 'num' });

    h.open('group');

    expect(document.querySelector('[data-blok-testid="database-group-number-by"] [data-blok-database-panel-value]')?.textContent)
      .toBe('tools.database.groupNumberUnique');

    click('database-group-number-by');
    click('database-group-number-by-range');

    const value = (id: string): string | undefined => document.querySelector<HTMLInputElement>(`[data-blok-testid="${id}"]`)?.value;

    expect([value('database-group-rangeStart'), value('database-group-rangeEnd'), value('database-group-rangeSize')]).toEqual(['0', '1000', '100']);
  });

  // research/22 §7, shots 37/38: the Range fields live on the "Number by" sub-page, not the Group page.
  it('keeps the Range fields off the Group page and shows them on the Number by page', () => {
    const h = harness({ groupBy: 'num', groupSettings: { numberBy: 'range' } });
    const title = (): string | null | undefined => document.querySelector('[data-blok-database-panel-header] span')?.textContent;
    const checked = (id: string): string | null | undefined => document.querySelector(`[data-blok-testid="${id}"]`)?.getAttribute('aria-checked');

    h.open('group');

    expect(exists('database-group-rangeStart')).toBe(false);
    expect(exists('database-group-range-example')).toBe(false);
    expect(document.querySelector('[data-blok-testid="database-group-number-by"] [data-blok-database-panel-value]')?.textContent)
      .toBe('tools.database.groupNumberRange');

    click('database-group-number-by');

    expect(title()).toBe('tools.database.groupNumberBy');
    expect(checked('database-group-number-by-range')).toBe('true');
    expect(checked('database-group-number-by-unique')).toBe('false');
    expect(exists('database-group-rangeStart')).toBe(true);
    expect(exists('database-group-rangeEnd')).toBe(true);
    expect(exists('database-group-rangeSize')).toBe(true);
    expect(exists('database-group-range-example')).toBe(true);

    click('database-group-number-by-unique');

    expect(h.state.view.groupSettings?.numberBy).toBe('unique');
    expect(title()).toBe('tools.database.groupNumberBy');
    expect(checked('database-group-number-by-unique')).toBe('true');
    expect(exists('database-group-rangeStart')).toBe(false);

    click('database-group-number-by-range');

    expect(exists('database-group-rangeStart')).toBe(true);

    click('database-panel-back');

    expect(exists('database-group-rangeStart')).toBe(false);
    expect(document.activeElement?.getAttribute('data-blok-testid')).toBe('database-group-number-by');
  });

  it('puts the sub-group Range fields on its own Number by page', () => {
    const h = harness({ type: 'board', groupBy: 'stage', subGroupBy: 'num' });

    h.open('root');
    click('database-settings-subgroup');
    click('database-group-number-by');
    click('database-group-number-by-range');

    expect(h.state.view.subGroupSettings?.numberBy).toBe('range');
    expect(h.state.view.groupSettings?.numberBy).toBeUndefined();
    expect(exists('database-group-rangeSize')).toBe(true);
  });

  // research/22 §7: "Group range" [0] – [1000], "Group every" [100], then "0 to 100, 100 to 200, ...".
  it('labels the number range like Notion, with a helper line built from the values', () => {
    const h = harness({ groupBy: 'num', groupSettings: { numberBy: 'range' } });

    h.ctx.i18n = {
      t: (key: string, params?: Record<string, string | number>) => {
        if (key === 'tools.database.groupRangeExample') return `${String(params?.start)} to ${String(params?.middle)}, ${String(params?.middle)} to ${String(params?.end)}, ...`;

        return key;
      },
    };
    h.open('group');
    click('database-group-number-by');

    const helper = (): string | null | undefined => document.querySelector('[data-blok-testid="database-group-range-example"]')?.textContent;

    expect(helper()).toBe('0 to 100, 100 to 200, ...');

    const sections = [...document.querySelectorAll('[data-blok-database-panel-section]')].map((el) => el.textContent);

    expect(sections).toEqual(expect.arrayContaining(['tools.database.groupRange', 'tools.database.groupRangeEvery']));
    expect(sections).not.toContain('tools.database.groupRangeStart');

    const pair = document.querySelector('[data-blok-database-range-pair]');

    expect([...(pair?.querySelectorAll('input') ?? [])].map((input) => input.getAttribute('data-blok-testid'))).toEqual(['database-group-rangeStart', 'database-group-rangeEnd']);
    expect(pair?.querySelector('[aria-hidden="true"]')?.textContent).toBe('–');
    expect(document.querySelector('[data-blok-testid="database-group-rangeStart"]')?.getAttribute('aria-label')).toBe('tools.database.groupRangeStart');

    const size = document.querySelector<HTMLInputElement>('[data-blok-testid="database-group-rangeSize"]');

    if (size === null) throw new Error('no size input');
    size.value = '50';
    size.dispatchEvent(new Event('input'));

    expect(helper()).toBe('0 to 50, 50 to 100, ...');
  });

  // research/23 §2e: grouping by a number turns Hide empty groups on, sorts ascending, and drops Color columns.
  describe('switching the grouping to a number', () => {
    const hideEmpty = (): string | null | undefined =>
      document.querySelector('[data-blok-testid="database-group-hide-empty"]')?.getAttribute('aria-checked');

    it('leaves Hide empty groups off and Color columns on for a select', () => {
      harness({ type: 'board', groupBy: 'stage' }).open('group');

      expect(hideEmpty()).toBe('false');
      expect(exists('database-group-color-columns')).toBe(true);
    });

    it('turns Hide empty groups on and sorts ascending in the same write', () => {
      const h = harness({ type: 'board', groupBy: 'stage', groupSettings: { sort: 'manual', colorColumns: true } });

      h.open('group');
      click('database-group-by');
      click('database-pick-property-num');

      expect(h.ctx.updateView).toHaveBeenLastCalledWith({ groupBy: 'num', groupSettings: { hideEmptyGroups: true } });
      expect(hideEmpty()).toBe('true');
      expect(document.querySelector('[data-blok-testid="database-group-sort"] [data-blok-database-panel-value]')?.textContent)
        .toBe('tools.database.groupSortAscending');
      expect(document.querySelector('[data-blok-testid="database-group-number-by"] [data-blok-database-panel-value]')?.textContent)
        .toBe('tools.database.groupNumberUnique');
      expect(exists('database-group-color-columns')).toBe(false);
    });

    it('resets the settings when a number grouping switches to a select', () => {
      const h = harness({ type: 'board', groupBy: 'num', groupSettings: { hideEmptyGroups: true } });

      h.open('group');
      click('database-group-by');
      click('database-pick-property-stage');

      expect(h.ctx.updateView).toHaveBeenLastCalledWith({ groupBy: 'stage', groupSettings: {} });
      expect(hideEmpty()).toBe('false');
    });

    it('keeps the settings when the same number property is picked again', () => {
      const h = harness({ type: 'board', groupBy: 'num', groupSettings: { numberBy: 'range' } });

      h.open('group');
      click('database-group-by');
      click('database-pick-property-num');

      expect(h.ctx.updateView).toHaveBeenLastCalledWith({ groupBy: 'num' });
    });

    it('does not touch a view already grouped by a number when it opens', () => {
      const h = harness({ type: 'board', groupBy: 'num' });

      h.open('group');

      expect(hideEmpty()).toBe('false');
      expect(h.ctx.updateView).not.toHaveBeenCalled();
    });

    // research/30 B26: after picking a sub-group, bands with no cards did not show.
    it('turns Hide empty groups on when a sub-group is picked', () => {
      const h = harness({ type: 'board', groupBy: 'stage', subGroupSettings: { sort: 'descending' } });

      h.open('root');
      click('database-settings-subgroup');
      click('database-subgroup-by');
      click('database-pick-property-prog');

      expect(h.ctx.updateView).toHaveBeenLastCalledWith({ subGroupBy: 'prog', subGroupSettings: { hideEmptyGroups: true } });
    });

    it('keeps the sub-group settings when the same sub-group is picked again', () => {
      const h = harness({ type: 'board', groupBy: 'stage', subGroupBy: 'prog', subGroupSettings: { hideEmptyGroups: false } });

      h.open('root');
      click('database-settings-subgroup');
      click('database-subgroup-by');
      click('database-pick-property-prog');

      expect(h.ctx.updateView).toHaveBeenLastCalledWith({ subGroupBy: 'prog' });
    });
  });

  it('groups a status by group or by option (research/08 "Status by")', () => {
    const h = harness({ type: 'board', groupBy: 'prog' });

    h.open('group');

    expect(document.querySelector('[data-blok-testid="database-group-status-by"]')?.textContent).toContain('tools.database.groupStatusOption');

    click('database-group-status-by');
    click('database-group-status-by-group');

    expect(h.ctx.updateView).toHaveBeenCalledWith({ groupByStatus: 'group' });
    expect(exists('database-group-color-columns')).toBe(true);
  });

  it('shows Ascending as the status group sort when the view stores none (research/08)', () => {
    const h = harness({ type: 'board', groupBy: 'prog' });
    const panel = h.open('group');

    try {
      expect(panel.root.querySelector('[data-blok-testid="database-group-sort"] [data-blok-database-panel-value]')?.textContent)
        .toBe('tools.database.groupSortAscending');
    } finally {
      panel.close();
    }
  });

  it('shows no group sort for a person grouping', () => {
    harness({ groupBy: 'owner' }).open('group');

    expect(exists('database-group-sort')).toBe(false);
    expect(exists('database-group-text-by')).toBe(false);
    expect(exists('database-group-date-by')).toBe(false);
    expect(exists('database-group-hide-empty')).toBe(true);
  });

  it.each(['option', 'group'] as const)('offers and saves every status %s group sort choice', (groupByStatus) => {
    const h = harness({ groupBy: 'prog', groupByStatus, groupSettings: { sort: 'ascending', hideEmptyGroups: true } });
    const panel = h.open('group');
    const choices = [
      ['manual', 'tools.database.groupSortManual'],
      ['ascending', 'tools.database.groupSortAscending'],
      ['descending', 'tools.database.groupSortDescending'],
    ] as const;

    try {
      expect(exists('database-group-sort')).toBe(true);

      for (const [sort, label] of choices) {
        click('database-group-sort');
        expect([...panel.root.querySelectorAll('[data-blok-testid^="database-group-sort-"]')].map((row) => row.textContent?.trim()))
          .toEqual(choices.map(([, choiceLabel]) => choiceLabel));
        click(`database-group-sort-${sort}`);

        expect(h.ctx.updateView).toHaveBeenLastCalledWith({ groupSettings: { sort, hideEmptyGroups: true } });
        expect(h.state.view.groupSettings).toEqual({ sort, hideEmptyGroups: true });
        expect(h.state.view.groupByStatus).toBe(groupByStatus);
        expect(panel.root.querySelector('[data-blok-testid="database-group-sort"] [data-blok-database-panel-value]')?.textContent).toBe(label);
      }
    } finally {
      panel.close();
    }
  });

  it.each([
    ['ascending', ['To-do (1)', 'In progress (1)', 'Complete (1)']],
    ['descending', ['Complete (1)', 'In progress (1)', 'To-do (1)']],
  ] as const)('renders status Group %s in the configured progress order', (sort, labels) => {
    const status: PropertyDefinition = {
      id: 'prog', name: 'Progress', type: 'status', position: 'a0',
      status: { groups: [
        { id: 'todo', kind: 'todo', name: 'To-do', position: 'a0' },
        { id: 'inProgress', kind: 'inProgress', name: 'In progress', position: 'a1' },
        { id: 'complete', kind: 'complete', name: 'Complete', position: 'a2' },
      ] },
      config: { options: [
        { id: 's1', label: 'Not started', position: 'a0', groupId: 'todo' },
        { id: 's2', label: 'In progress', position: 'a0', groupId: 'inProgress' },
        { id: 's3', label: 'Done', position: 'a0', groupId: 'complete' },
      ] },
    };
    const h = harness({ groupBy: 'prog', groupByStatus: 'group', groupSettings: { sort, hideEmptyGroups: true } });
    const model = new DatabaseModel({ schema: [status], views: [h.state.view], activeViewId: 'v' });

    model.setRows([
      { id: 'r1', position: 'a0', properties: { prog: 's1' } },
      { id: 'r2', position: 'a1', properties: { prog: 's2' } },
      { id: 'r3', position: 'a2', properties: { prog: 's3' } },
    ]);
    h.ctx.schema = () => model.getSchema();
    h.ctx.groups = () => {
      const options = model.getSelectOptions('prog', { statusBy: 'group' });

      return model.listGroups(h.state.view).map(({ key, count }) => ({
        key,
        label: options.find((option) => option.id === key)?.label ?? key,
        count,
      }));
    };
    const panel = h.open('group');

    try {
      expect([...panel.root.querySelectorAll('[data-blok-testid^="database-group-visible-"]')].map((row) => row.textContent?.trim()))
        .toEqual(labels);
    } finally {
      panel.close();
    }
  });

  it('offers "Me" first in a person filter', () => {
    const h = harness();

    h.ctx.people = () => [{ id: 'u1', name: 'Ada' }];
    h.open('filter');
    click('database-filter-add');
    click('database-pick-property-owner');
    click('database-filter-person-me');
    click('database-filter-person-u1');

    expect(h.state.view.filters[0]).toMatchObject({ propertyId: 'owner', operator: 'contains', value: ['me', 'u1'] });
  });

  it('offers "This page" first in a relation filter on a row page (research/13 §1c)', () => {
    const h = harness();
    const related: PropertyDefinition = { id: 'back', name: 'Measure A', type: 'relation', position: 'z0', relation: { targetDatabaseId: 'a' } };

    h.ctx.schema = () => [...schema, related];
    h.ctx.relatedRows = () => [{ id: 'r1', title: 'One' }];
    h.ctx.thisPageDatabase = () => 'a';
    h.open('filter');
    click('database-filter-add');
    click('database-pick-property-back');
    const rows = [...document.querySelectorAll('[data-blok-testid^="database-filter-related-"]')].map((el) => el.getAttribute('data-blok-testid'));

    expect(rows).toEqual(['database-filter-related-this-page', 'database-filter-related-r1']);
    click('database-filter-related-this-page');

    expect(h.state.view.filters[0]).toMatchObject({ propertyId: 'back', operator: 'contains', value: ['this_page'] });
  });

  it('offers no "This page" on a relation to another database than the row page\'s', () => {
    const h = harness();
    const other: PropertyDefinition = { id: 'toc', name: 'Measure C', type: 'relation', position: 'z0', relation: { targetDatabaseId: 'c' } };

    h.ctx.schema = () => [...schema, other];
    h.ctx.relatedRows = () => [{ id: 'c1', title: 'Uno' }];
    h.ctx.thisPageDatabase = () => 'a';
    h.open('filter');
    click('database-filter-add');
    click('database-pick-property-toc');

    expect(document.querySelector('[data-blok-testid="database-filter-related-c1"]')).not.toBeNull();
    expect(document.querySelector('[data-blok-testid="database-filter-related-this-page"]')).toBeNull();
  });

  it('offers no "This page" in a conditional color rule, which has no row page to read', () => {
    const h = harness({ colorRules: [{ id: 'c1', propertyId: 'back', operator: 'contains', value: [], color: 'gray' }] });
    const related: PropertyDefinition = { id: 'back', name: 'Measure A', type: 'relation', position: 'z0', relation: { targetDatabaseId: 'a' } };

    h.ctx.schema = () => [...schema, related];
    h.ctx.relatedRows = () => [{ id: 'r1', title: 'One' }];
    h.ctx.thisPageDatabase = () => 'a';
    h.open();
    click('database-settings-color');
    click('database-color-condition-c1');

    expect(document.querySelector('[data-blok-testid="database-filter-related-r1"]')).not.toBeNull();
    expect(document.querySelector('[data-blok-testid="database-filter-related-this-page"]')).toBeNull();
  });

  it('offers no "This page" in a relation filter away from a row page, unless it is chosen', () => {
    const h = harness({ filters: [] });
    const related: PropertyDefinition = { id: 'back', name: 'Measure A', type: 'relation', position: 'z0', relation: { targetDatabaseId: 'a' } };

    h.ctx.schema = () => [...schema, related];
    h.ctx.relatedRows = () => [{ id: 'r1', title: 'One' }];
    h.open('filter');
    click('database-filter-add');
    click('database-pick-property-back');

    expect(document.querySelector('[data-blok-testid="database-filter-related-this-page"]')).toBeNull();
  });

  it('adds a conditional color rule and picks its background', () => {
    const h = harness();

    h.open();
    click('database-settings-color');
    click('database-color-add');
    click('database-pick-property-num');
    const [rule] = h.state.view.colorRules ?? [];

    expect(rule).toMatchObject({ propertyId: 'num', operator: 'is_not_empty', color: 'gray' });

    click(`database-color-background-${rule.id}`);
    click('database-color-pick-green');
    click(`database-color-apply-${rule.id}`);
    click('database-color-apply-property');

    expect(h.state.view.colorRules?.[0]).toMatchObject({ color: 'green', applyTo: 'property' });
  });

  it('blocks shared edits while locked, but not personal filters', () => {
    const h = harness();

    h.state.locked = true;
    h.open();

    click('database-settings-layout');
    expect((document.querySelector('[data-blok-testid="database-layout-board"]') as HTMLButtonElement).disabled).toBe(true);
    click('database-panel-back');

    click('database-settings-filter');
    click('database-filter-add');
    click('database-pick-property-num');

    expect(h.state.view.filters).toHaveLength(1);
  });

  it('opens a filter pill popover at its editor, 220 wide', () => {
    const h = harness({ filters: [{ id: 'f1', propertyId: 'due', operator: 'this_week', value: null }] });

    h.openPill('f1');

    expect((document.querySelector('[data-blok-testid="database-filter-popover"]') as HTMLElement).style.width).toBe('220px');

    click('database-filter-within-past_month');

    expect(h.state.view.filters[0]).toMatchObject({ operator: 'past_month', value: null });

    click('database-filter-delete');

    expect(h.state.view.filters).toEqual([]);
  });
});

describe('view settings panel — sub-items and dependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const structure = (on: { subItems: boolean; dependencies: boolean }): {
    settings: NonNullable<ViewSettingsContext['structure']>;
    setSubItems: ReturnType<typeof vi.fn>;
    updateDependency: ReturnType<typeof vi.fn>;
  } => {
    const setSubItems = vi.fn();
    const updateDependency = vi.fn();

    return {
      setSubItems,
      updateDependency,
      settings: {
        subItems: () => on.subItems,
        setSubItems,
        dependencies: () => (on.dependencies ? { shift: 'none' } : undefined),
        setDependencies: vi.fn(),
        updateDependency,
      },
    };
  };

  it('turns sub-items on from Database settings', () => {
    const h = harness();
    const calls = structure({ subItems: false, dependencies: false });

    h.ctx.structure = calls.settings;
    h.open();
    click('database-settings-more');
    click('database-settings-subitems');
    click('database-settings-subitems-switch');

    expect(calls.setSubItems).toHaveBeenCalledWith(true);
    expect(exists('database-settings-subitems-display-nested')).toBe(false);
  });

  it('sets a table\'s sub-item display and filter on the view', () => {
    const h = harness();

    h.ctx.structure = structure({ subItems: true, dependencies: false }).settings;
    h.open();
    click('database-settings-more');
    click('database-settings-subitems');
    click('database-settings-subitems-display-flattened');
    click('database-settings-subitems-filter-parentsAndSubItems');

    expect(h.ctx.updateView).toHaveBeenCalledWith({ subItemsDisplay: 'flattened' });
    expect(h.ctx.updateView).toHaveBeenCalledWith({ subItemsFilter: 'parentsAndSubItems' });
  });

  it('offers a board "Card property" or "Flattened list", and parents only as a card property', () => {
    const h = harness({ type: 'board', groupBy: 'stage' });

    h.ctx.structure = structure({ subItems: true, dependencies: false }).settings;
    h.open();
    click('database-settings-more');
    click('database-settings-subitems');

    expect(exists('database-settings-subitems-display-card')).toBe(true);
    expect(exists('database-settings-subitems-display-nested')).toBe(false);
    expect(exists('database-settings-subitems-filter-subItems')).toBe(false);
  });

  const rowIds = (): string[] => [...document.querySelectorAll<HTMLElement>('[data-blok-testid^="database-settings-"]')]
    .map((el) => el.getAttribute('data-blok-testid') ?? '');

  // research/09 §1: More settings holds Sub-items, Dependencies, Connections, Customize page layout (last).
  it('puts Sub-items, Dependencies and Customize page layout in More settings, after Automations', () => {
    const h = harness();
    const customize = vi.fn();

    h.ctx.structure = structure({ subItems: false, dependencies: false }).settings;
    h.ctx.customizeLayout = () => ({ testId: 'database-settings-customize-layout', label: 'Customize page layout', icon: '', onClick: customize });
    h.ctx.automations = {
      read: () => undefined,
      schema: () => [],
      views: () => [],
      writable: () => true,
      write: () => true,
    };
    const panel = h.open();
    const close = vi.spyOn(panel, 'close');
    const root = rowIds();

    expect(root).not.toContain('database-settings-subitems');
    expect(root).not.toContain('database-settings-dependencies');
    expect(root).not.toContain('database-settings-customize-layout');
    expect(root[root.indexOf('database-settings-more') - 1]).toBe('database-settings-automations');
    expect(document.querySelector('[data-blok-testid="database-settings-more"]')?.textContent).toContain('tools.database.settingsMoreSettings');
    click('database-settings-more');

    expect(rowIds().filter((id) => /^database-settings-(?:subitems|dependencies|customize-layout)$/.test(id)))
      .toEqual(['database-settings-subitems', 'database-settings-dependencies', 'database-settings-customize-layout']);
    expect(rowIds().at(-1)).toBe('database-settings-customize-layout');
    click('database-settings-customize-layout');

    expect(close).toHaveBeenCalled();
    expect(customize).toHaveBeenCalledTimes(1);
  });

  it('shows More settings for Customize page layout alone, and hides it when nothing goes in it', () => {
    const h = harness();

    h.ctx.customizeLayout = () => ({ testId: 'database-settings-customize-layout', label: 'Customize page layout', icon: '', disabled: true, onClick: vi.fn() });
    h.open();
    click('database-settings-more');

    expect(document.querySelector<HTMLButtonElement>('[data-blok-testid="database-settings-customize-layout"]')?.disabled).toBe(true);
    expect(exists('database-settings-subitems')).toBe(false);
    document.body.innerHTML = '';
    harness().open();

    expect(exists('database-settings-more')).toBe(false);
  });

  it('turns dependencies on and picks a date shifting rule', () => {
    const h = harness();
    const calls = structure({ subItems: false, dependencies: true });

    h.ctx.structure = calls.settings;
    h.open();
    click('database-settings-more');
    click('database-settings-dependencies');
    click('database-settings-dependencies-shift-maintain');
    click('database-settings-dependencies-weekends');

    expect(calls.updateDependency).toHaveBeenCalledWith({ shift: 'maintain' });
    expect(calls.updateDependency).toHaveBeenCalledWith({ avoidWeekends: true });
  });
});

// research/12 §2 + shot 32: Data source settings reads Automations, "AI Autofill" (count), then More settings.
describe('view settings panel — AI Autofill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const autofillSchema: PropertyDefinition[] = [
    { id: 'title', name: 'Name', type: 'title', position: 'a0' },
    { id: 'sum', name: 'Summary', type: 'text', position: 'a1', autofill: { mode: 'summary', instruction: 'x' } },
    { id: 'notes', name: 'Notes', type: 'text', position: 'a2' },
    { id: 'calc', name: 'Calc', type: 'formula', position: 'a3' },
  ];

  const rowIds = (): string[] => [...document.querySelectorAll<HTMLElement>('[data-blok-testid^="database-settings-"]')]
    .map((el) => el.getAttribute('data-blok-testid') ?? '');

  const withAutofill = (writable = true): { h: Harness; open: ReturnType<typeof vi.fn> } => {
    const h = harness();
    const open = vi.fn();

    h.ctx.customizeLayout = () => ({ testId: 'database-settings-customize-layout', label: 'Customize page layout', icon: '', onClick: vi.fn() });
    h.ctx.automations = { read: () => undefined, schema: () => [], views: () => [], writable: () => true, write: () => true };
    h.ctx.autofill = { properties: () => autofillSchema, writable: () => writable, open };

    return { h, open };
  };

  it('puts AI Autofill between Automations and More settings, with the count of autofill properties', () => {
    withAutofill().h.open();
    const root = rowIds();
    const at = root.indexOf('database-settings-autofill');

    expect(at).toBeGreaterThan(-1);
    expect(root[at - 1]).toBe('database-settings-automations');
    expect(root[at + 1]).toBe('database-settings-more');
    const row = document.querySelector('[data-blok-testid="database-settings-autofill"]');

    expect(row?.textContent).toContain('tools.database.aiAutofill');
    expect(row?.textContent).toContain('1');
  });

  it('has no AI Autofill row when the host gives no autofill', () => {
    harness().open();

    expect(exists('database-settings-autofill')).toBe(false);
  });

  it('disables the row when the database cannot be written', () => {
    withAutofill(false).h.open();

    expect(document.querySelector<HTMLButtonElement>('[data-blok-testid="database-settings-autofill"]')?.disabled).toBe(true);
  });

  it('lists each autofill property and opens its setup, closing the panel first', () => {
    const { h, open } = withAutofill();
    const panel = h.open();
    const close = vi.spyOn(panel, 'close');

    click('database-settings-autofill');

    expect(exists('database-autofill-open-sum')).toBe(true);
    expect(exists('database-autofill-open-notes')).toBe(false);
    expect(document.querySelector('[data-blok-testid="database-autofill-open-sum"]')?.textContent).toContain('tools.database.aiAutofillProperty');
    click('database-autofill-open-sum');

    expect(close).toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith('sum');
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[0]);
  });

  it('"New AI Autofill" picks a property that can autofill and has none yet, then opens its setup', () => {
    const { h, open } = withAutofill();

    h.open();
    click('database-settings-autofill');

    expect(document.querySelector('[data-blok-testid="database-autofill-new"]')?.textContent).toContain('tools.database.aiAutofillNew');
    click('database-autofill-new');

    expect(exists('database-autofill-pick-notes')).toBe(true);
    expect(exists('database-autofill-pick-sum')).toBe(false);
    expect(exists('database-autofill-pick-calc')).toBe(false);
    click('database-autofill-pick-notes');

    expect(open).toHaveBeenCalledWith('notes');
  });
});
