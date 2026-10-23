import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDrawerOptions, LayoutTabsHost } from '../../../../src/tools/database/database-card-drawer';
import { IconSidebarRight } from '../../../../src/components/icons';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import { PAGE_LAYOUT_PIN_LIMIT, pageLayoutOf } from '../../../../src/tools/database/page-layout';
import type { PageLayoutData } from '../../../../src/tools/database/page-layout';
import type { DatabaseRow, PageLayoutFields, PropertyDefinition } from '../../../../src/tools/database/types';

vi.mock('../../../../src/blok', () => ({
  Blok: vi.fn(function stubBlok() {
    return {
      isReady: Promise.resolve(),
      save: vi.fn().mockResolvedValue({ blocks: [] }),
      destroy: vi.fn(),
    };
  }),
}));

const schemaWith = (layout: PageLayoutFields = {}): PropertyDefinition[] => [
  { id: 'p-title', name: 'Title', type: 'title', position: 'a0', ...layout },
  { id: 'p-status', name: 'Status', type: 'text', position: 'a1' },
  { id: 'p-due', name: 'Due', type: 'text', position: 'a2' },
  { id: 'p-owner', name: 'Owner', type: 'text', position: 'a3' },
  { id: 'p-rel', name: 'Tasks', type: 'relation', position: 'a4', relation: { targetDatabaseId: 'other' } },
];

const ROW: DatabaseRow = {
  id: 'row-1',
  position: 'a0',
  properties: { 'p-title': 'Card', 'p-status': 'Open', 'p-due': 'Friday', 'p-owner': 'Ada' },
};

const createOptions = (overrides: Partial<CardDrawerOptions> = {}): CardDrawerOptions => {
  const wrapper = document.createElement('div');

  document.body.appendChild(wrapper);

  return {
    wrapper,
    readOnly: false,
    titlePropertyId: 'p-title',
    schema: schemaWith(),
    onTitleChange: vi.fn(),
    onDescriptionChange: vi.fn(),
    onClose: vi.fn(),
    onPropertyValueChange: vi.fn(),
    onPageLayoutChange: vi.fn(),
    onPageLayoutBirth: vi.fn(),
    ...overrides,
  };
};

const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
const all = (selector: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(selector)];
const idsIn = (selector: string): string[] =>
  all(`${selector} [data-blok-database-drawer-prop-value]`).map((el) => el.getAttribute('data-property-id') ?? '');

/** What the tool would save: the drawer's edit applied to the model's layout. */
const written = (options: CardDrawerOptions, base: PageLayoutFields = {}): PageLayoutData | undefined => {
  const edit = vi.mocked(options.onPageLayoutChange)?.mock.calls.at(-1)?.[0];

  return edit?.(pageLayoutOf({ id: 'p-title', name: 'Title', type: 'title', position: 'a0', ...base }));
};

const clickItem = (name: string): void => {
  const item = q(`[data-blok-popover-item][data-blok-item-name="${name}"]`);

  if (item === null) throw new Error(`no menu item ${name}`);
  item.click();
};

/** The Heading module's ••• menu (plan Phase 5a). */
const openHeadingMenu = (): void => {
  if (q('[data-blok-testid="database-layout-heading-menu"]') !== null) return;
  q('[data-blok-database-layout-module="heading"] [data-blok-database-layout-module-menu]')?.click();
};

const pinButton = (propertyId: string): HTMLButtonElement | null => q<HTMLButtonElement>(`[data-blok-testid="database-layout-pin-${propertyId}"]`);

/** "+ Add a property" at the end of the Heading menu's Pinned list. */
const addPin = (): HTMLButtonElement | null => {
  openHeadingMenu();

  return q<HTMLButtonElement>('[data-blok-testid="database-layout-heading-menu"] [data-blok-database-layout-add-pin]');
};

const pinFromMenu = (propertyId: string): void => {
  openHeadingMenu();
  pinButton(propertyId)?.click();
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
};

/** Types into the Heading menu's property search (plan Phase 5a). */
const searchHeadingMenu = (value: string): void => {
  openHeadingMenu();
  const search = q<HTMLInputElement>('[data-blok-testid="database-layout-heading-search"]');

  if (search === null) throw new Error('missing Heading menu search');
  search.value = value;
  search.dispatchEvent(new Event('input', { bubbles: true }));
};

/** "+ Add section" in the Property group menu's header (plan Phase 5b). */
const addSectionFromMenu = (): void => {
  if (q('[data-blok-testid="database-layout-group-menu"]') === null) {
    q('[data-blok-database-layout-module="group"] [data-blok-database-layout-module-menu]')?.click();
  }
  const add = q('[data-blok-testid="database-layout-group-menu"] [data-blok-database-panel-header] [data-blok-database-layout-add-section]');

  if (add === null) throw new Error('no Add section in the Property group menu');
  add.click();
};

describe('DatabaseCardDrawer — page layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  // feel/findings-rowpage R11: the classic page has no "Properties" heading; Notion names the group once a layout has sections (research/09 §3).
  it('draws no Properties toggle on a classic page, and one once the page has sections', () => {
    const drawer = new DatabaseCardDrawer(createOptions());

    drawer.open(ROW);

    expect(q('[data-blok-database-drawer-props-toggle]')).toBeNull();
    expect(q('[data-blok-database-drawer-props]')?.hidden).toBe(false);
    drawer.refreshSchema(schemaWith({ pageLayoutSections: [{ id: 's1', name: 'Planning' }], pageLayoutPlacements: [{ id: 'p-due', place: 'section', sectionId: 's1' }] }));

    expect(q('[data-blok-database-drawer-props-toggle]')).not.toBeNull();
    drawer.destroy();
  });

  it('shows pinned properties in the heading and not again in the group', () => {
    const options = createOptions({ schema: schemaWith({ pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }] }) });

    new DatabaseCardDrawer(options).open(ROW);

    expect(idsIn('[data-blok-database-drawer-pins]')).toEqual(['p-due']);
    // The group lists by name (R12): Owner, Status, Tasks.
    expect(idsIn('[data-blok-database-drawer-props]')).toEqual(['p-owner', 'p-status', 'p-rel']);
  });

  it('puts a 16px property icon beside each label, outside the label text', () => {
    const options = createOptions({
      schema: [...schemaWith(), { id: 'p-mood', name: 'Mood', type: 'text', position: 'a5', icon: '🙂' }],
    });

    new DatabaseCardDrawer(options).open(ROW);
    const head = q('[data-blok-database-drawer-prop-head]:has([data-property-id="p-due"])');
    const icon = head?.querySelector('[data-blok-database-drawer-prop-icon]');

    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.querySelector('svg')).not.toBeNull();
    expect(q('[data-blok-database-drawer-prop-label][data-property-id="p-due"]')?.textContent).toBe('Due');
    expect(q('[data-blok-database-drawer-prop-label][data-property-id="p-due"] [data-blok-database-drawer-prop-icon]')).toBeNull();
    expect(q('[data-blok-database-drawer-prop-head]:has([data-property-id="p-mood"]) [data-blok-database-drawer-prop-icon]')?.textContent).toBe('🙂');
  });

  it('draws no layout chrome for a database without a layout', () => {
    new DatabaseCardDrawer(createOptions()).open(ROW);

    expect(q('[data-blok-database-drawer-pins]')).toBeNull();
    expect(q('[data-blok-database-drawer-details]')).toBeNull();
    expect(q('[data-blok-database-drawer-tabs]')).toBeNull();
    expect(idsIn('[data-blok-database-drawer-props]')).toEqual(['p-due', 'p-owner', 'p-status', 'p-rel']);
  });

  it('draws named sections that fold away', () => {
    const options = createOptions({
      schema: schemaWith({
        pageLayoutSections: [{ id: 's1', name: 'Planning' }],
        pageLayoutPlacements: [{ id: 'p-due', place: 'section', sectionId: 's1' }],
      }),
    });

    new DatabaseCardDrawer(options).open(ROW);
    const toggle = q('[data-blok-database-drawer-section-toggle][data-section-id="s1"]');

    expect(toggle?.textContent).toContain('Planning');
    expect(idsIn('[data-blok-database-drawer-section][data-section-id="s1"]')).toEqual(['p-due']);
    toggle?.click();

    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(q('[data-blok-database-drawer-section][data-section-id="s1"] [data-blok-database-drawer-section-body]')?.hidden).toBe(true);
  });

  describe('sections on the row page', () => {
    const SECTIONS = (): PropertyDefinition[] => schemaWith({
      pageLayoutSections: [{ id: 's1', name: 'Planning' }, { id: 's2', name: 'Later' }],
      pageLayoutPlacements: [{ id: 'p-due', place: 'section', sectionId: 's1' }],
    });
    const OTHER: DatabaseRow = { id: 'row-2', position: 'a1', properties: { 'p-title': 'Other' } };
    const folded = (id: string): HTMLElement['hidden'] | undefined =>
      q(`[data-blok-database-drawer-section][data-section-id="${id}"] [data-blok-database-drawer-section-body]`)?.hidden;
    const fold = (id: string): void => q(`[data-blok-database-drawer-section-toggle][data-section-id="${id}"]`)?.click();

    afterEach(() => {
      try {
        window.localStorage.clear();
      } catch {
        // A test made storage throw.
      }
    });

    // research/10 §2b: each section ends with its own "+ Add a property"; folding hides it too.
    it('ends each section with its own Add a property', () => {
      const added: PropertyDefinition = { id: 'p-new', name: 'New', type: 'text', position: 'a9' };
      const options = createOptions({
        schema: SECTIONS(),
        onOpenAddProperty: vi.fn((_anchor: HTMLElement, onAdded?: (id: string) => void) => onAdded?.(added.id)),
      });

      new DatabaseCardDrawer(options).open(ROW);
      const adds = all('[data-blok-database-drawer-section] [data-blok-database-drawer-section-add]');

      expect(adds.map((add) => [add.closest('[data-section-id]')?.getAttribute('data-section-id'), add.textContent])).toEqual([['s1', '+ Add a property'], ['s2', '+ Add a property']]);
      expect(adds.every((add) => add.closest('[data-blok-database-drawer-section-body]') !== null)).toBe(true);
      adds[1]?.click();

      const edit = vi.mocked(options.onPageLayoutChange)?.mock.calls.at(-1)?.[0];

      expect(edit?.(pageLayoutOf(SECTIONS()[0])).placements).toEqual([
        { id: 'p-due', place: 'section', sectionId: 's1' },
        { id: 'p-new', place: 'section', sectionId: 's2' },
      ]);
    });

    // research/10 §2b: the fold carries to other rows and survives a reload. Per viewer, in local storage (Q3).
    it('keeps a folded section folded on other rows and after the drawer is rebuilt', () => {
      const first = new DatabaseCardDrawer(createOptions({ schema: SECTIONS(), databaseId: 'db-1' }));

      first.open(ROW);
      fold('s1');
      first.open(OTHER);

      expect(folded('s1')).toBe(true);
      first.destroy();
      document.body.innerHTML = '';
      new DatabaseCardDrawer(createOptions({ schema: SECTIONS(), databaseId: 'db-1' })).open(ROW);

      expect(folded('s1')).toBe(true);
      expect(folded('s2')).toBe(false);
      expect(q('[data-blok-database-drawer-section-toggle][data-section-id="s1"]')?.getAttribute('aria-expanded')).toBe('false');
      fold('s1');
      document.body.innerHTML = '';
      new DatabaseCardDrawer(createOptions({ schema: SECTIONS(), databaseId: 'db-1' })).open(ROW);

      expect(folded('s1')).toBe(false);
    });

    it('keeps folds apart per database', () => {
      new DatabaseCardDrawer(createOptions({ schema: SECTIONS(), databaseId: 'db-1' })).open(ROW);
      fold('s1');
      document.body.innerHTML = '';
      new DatabaseCardDrawer(createOptions({ schema: SECTIONS(), databaseId: 'db-2' })).open(ROW);

      expect(folded('s1')).toBe(false);
    });

    it('still folds for the session when storage throws', () => {
      vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
        throw new Error('blocked');
      });
      const drawer = new DatabaseCardDrawer(createOptions({ schema: SECTIONS(), databaseId: 'db-1' }));

      drawer.open(ROW);

      expect(idsIn('[data-blok-database-drawer-section][data-section-id="s1"]')).toEqual(['p-due']);
      expect(folded('s1')).toBe(false);
      fold('s1');

      expect(folded('s1')).toBe(true);
      drawer.open(OTHER);

      expect(folded('s1')).toBe(true);
    });

    it('opens every section when storage is empty or holds junk', () => {
      window.localStorage.setItem('blok:database-section-fold:db-1:s2', 'nonsense');
      new DatabaseCardDrawer(createOptions({ schema: SECTIONS(), databaseId: 'db-1' })).open(ROW);

      expect(folded('s1')).toBe(false);
      expect(folded('s2')).toBe(false);
    });
  });

  // research/09 §9: the panel starts closed; View details opens it.
  it('draws modules in the page and in a details panel that View details opens and closes', () => {
    const options = createOptions({
      schema: schemaWith({ pageLayoutPlacements: [{ id: 'p-owner', place: 'page' }, { id: 'p-due', place: 'panel' }] }),
    });

    new DatabaseCardDrawer(options).open(ROW);

    expect(idsIn('[data-blok-database-drawer-modules]')).toEqual(['p-owner']);
    expect(idsIn('[data-blok-database-drawer-details]')).toEqual(['p-due']);
    const toggle = q('[data-blok-database-drawer-details-toggle]');

    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(q('[data-blok-database-drawer-details]')?.hidden).toBe(true);
    expect(q('[data-blok-database-drawer]')?.hasAttribute('data-details-open')).toBe(false);
    toggle?.click();

    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(q('[data-blok-database-drawer-details]')?.hidden).toBe(false);
    expect(q('[data-blok-database-drawer]')?.hasAttribute('data-details-open')).toBe(true);
    toggle?.click();

    expect(q('[data-blok-database-drawer-details]')?.hidden).toBe(true);
    expect(q('[data-blok-database-drawer]')?.hasAttribute('data-details-open')).toBe(false);
  });

  // research/22 §10: opening the panel widens the side peek by 280px up to 1008; closing takes 280px back, down to 564.
  it('widens the side peek by the 280px panel while it is open', () => {
    window.localStorage.removeItem('blok:database-peek-width');
    const options = createOptions({ schema: schemaWith({ pageLayoutPlacements: [{ id: 'p-due', place: 'panel' }] }) });
    const drawer = new DatabaseCardDrawer(options);
    const width = (): string => q('[data-blok-database-drawer]')?.style.getPropertyValue('--_blok-peek-width') ?? '';
    const handle = (): HTMLElement | null => q('[data-blok-database-peek-resize]');

    drawer.open(ROW);
    handle()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(width()).toBe('564px');
    q('[data-blok-database-drawer-details-toggle]')?.click();
    expect(width()).toBe('844px');
    expect(handle()?.getAttribute('aria-valuenow')).toBe('844');
    q('[data-blok-database-peek-page-info]')?.click();
    expect(width()).toBe('564px');

    // From 756 the peek stops at 1008, and closing settles at 728 (as measured).
    for (let i = 0; i < 12; i++) handle()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(width()).toBe('756px');
    q('[data-blok-database-drawer-details-toggle]')?.click();
    expect(width()).toBe('1008px');
    q('[data-blok-database-drawer-details-toggle]')?.click();
    expect(width()).toBe('728px');
    expect(window.localStorage.getItem('blok:database-peek-width')).toBe('728');
    drawer.destroy();
    window.localStorage.removeItem('blok:database-peek-width');
  });

  it('gives the 280px back when another page opens with the panel closed', () => {
    window.localStorage.removeItem('blok:database-peek-width');
    const options = createOptions({ schema: schemaWith({ pageLayoutPlacements: [{ id: 'p-due', place: 'panel' }] }) });
    const drawer = new DatabaseCardDrawer(options);
    const width = (): string => q('[data-blok-database-drawer]')?.style.getPropertyValue('--_blok-peek-width') ?? '';

    drawer.open(ROW);
    q('[data-blok-database-drawer-details-toggle]')?.click();
    expect(width()).toBe('1008px');
    drawer.open({ ...ROW, id: 'row-2' });
    expect(q('[data-blok-database-drawer-details]')?.hidden).toBe(true);
    expect(width()).toBe('728px');
    drawer.destroy();
    window.localStorage.removeItem('blok:database-peek-width');
  });

  // research/09 §9: closed on every navigation measured; it does not persist.
  // research/09 §9: the saved Full width widens the full page; a draft does not (the builder canvas never changes).
  it('marks the page full width from the saved layout only, and follows Apply', () => {
    const options = createOptions({ schema: schemaWith({ pageLayoutFullWidth: true }) });
    const drawer = new DatabaseCardDrawer(options);
    const fullWidth = (): boolean | undefined => q('[data-blok-database-drawer]')?.hasAttribute('data-full-width');

    drawer.open(ROW);

    expect(fullWidth()).toBe(true);
    drawer.refreshSchema(schemaWith({}));

    expect(fullWidth()).toBe(false);
    q('[data-blok-database-drawer-customize]')?.click();
    const toggle = q('[data-blok-testid="database-layout-option-layoutFullWidth"]');

    toggle?.click();

    expect(toggle?.getAttribute('aria-checked')).toBe('true');
    expect(fullWidth()).toBe(false);
    drawer.destroy();
  });

  it('starts the details panel closed on every open and on the next row', () => {
    const options = createOptions({ schema: schemaWith({ pageLayoutPlacements: [{ id: 'p-due', place: 'panel' }] }) });
    const drawer = new DatabaseCardDrawer(options);
    const details = (): HTMLElement | null => q('[data-blok-database-drawer-details]');

    drawer.open(ROW);
    q('[data-blok-database-drawer-details-toggle]')?.click();

    expect(details()?.hidden).toBe(false);
    drawer.open({ ...ROW, id: 'row-2' });

    expect(details()?.hidden).toBe(true);
    q('[data-blok-database-drawer-details-toggle]')?.click();
    drawer.close();
    drawer.open(ROW);

    expect(details()?.hidden).toBe(true);
    expect(q('[data-blok-database-drawer-details-toggle]')?.getAttribute('aria-expanded')).toBe('false');
    drawer.destroy();
  });

  // research/09 §9, 10 §10: the line under the title reads "Hide details" while the panel is open.
  it('says Hide details while the panel is open', () => {
    const options = createOptions({ schema: schemaWith({ pageLayoutPlacements: [{ id: 'p-due', place: 'panel' }] }) });
    const drawer = new DatabaseCardDrawer(options);
    const toggle = (): HTMLElement | null => q('[data-blok-database-drawer-details-toggle]');

    drawer.open(ROW);

    expect(toggle()?.textContent?.trim()).toBe('View details');
    toggle()?.click();

    expect(toggle()?.textContent?.trim()).toBe('Hide details');
    toggle()?.click();

    expect(toggle()?.textContent?.trim()).toBe('View details');
    toggle()?.click();
    q('[data-blok-database-drawer-customize]')?.click();

    // The builder's Heading keeps "View details" (research/10 §10).
    expect(toggle()?.textContent?.trim()).toBe('View details');
    drawer.destroy();
  });

  // research/10 §10: a "Properties" header and a round "Close panel" button at the panel's top.
  it('closes the panel from its Close panel button', () => {
    const options = createOptions({ schema: schemaWith({ pageLayoutGroupIn: 'panel' }) });
    const drawer = new DatabaseCardDrawer(options);
    const panel = (): HTMLElement | null => q('[data-blok-database-drawer-details]');

    drawer.open(ROW);
    q('[data-blok-database-drawer-details-toggle]')?.click();
    const header = panel()?.querySelector('[data-blok-database-drawer-details-header]');
    const close = header?.querySelector<HTMLButtonElement>('[data-blok-database-drawer-details-close]');

    expect(header?.textContent?.trim()).toBe('Properties');
    expect(close?.getAttribute('aria-label')).toBe('Close panel');
    // The header names the group, so the group's own "Properties" fold is not drawn twice.
    expect(panel()?.querySelector('[data-blok-database-drawer-props-toggle]')).toBeNull();
    close?.click();

    expect(panel()?.hidden).toBe(true);
    expect(q('[data-blok-database-drawer]')?.hasAttribute('data-details-open')).toBe(false);
    expect(q('[data-blok-database-drawer-details-toggle]')?.getAttribute('aria-expanded')).toBe('false');
    expect(q('[data-blok-database-drawer-details-toggle]')?.textContent?.trim()).toBe('View details');
    expect(q('[data-blok-database-drawer-details-toggle]')).toHaveFocus();
    drawer.destroy();
  });

  it('keeps the group shown in the panel after it was folded on the page', () => {
    // Only a page with sections has the Properties fold (R11).
    const sections = [{ id: 's1', name: 'Planning' }];
    const options = createOptions({ schema: schemaWith({ pageLayoutSections: sections }) });
    const drawer = new DatabaseCardDrawer(options);

    drawer.open(ROW);
    q('[data-blok-database-drawer-props-toggle]')?.click();

    expect(q('[data-blok-database-drawer-props]')?.hidden).toBe(true);
    drawer.refreshSchema(schemaWith({ pageLayoutGroupIn: 'panel', pageLayoutSections: sections }));
    q('[data-blok-database-drawer-details-toggle]')?.click();

    expect(q('[data-blok-database-drawer-details] [data-blok-database-drawer-props]')?.hidden).toBe(false);
    drawer.destroy();
  });

  // research/10 §10: "Page info" is in the top bar only once the layout uses the panel, and toggles it both ways.
  it('shows Page info only when the layout uses the panel, and toggles the panel', () => {
    const options = createOptions();
    const drawer = new DatabaseCardDrawer(options);
    const info = (): HTMLButtonElement | null => q<HTMLButtonElement>('[data-blok-database-drawer-toolbar] [data-blok-database-peek-page-info]');
    const panel = (): HTMLElement | null => q('[data-blok-database-drawer-details]');

    drawer.open(ROW);

    expect(info()?.hidden).toBe(true);
    drawer.refreshSchema(schemaWith({ pageLayoutPlacements: [{ id: 'p-due', place: 'panel' }] }));

    expect(info()?.hidden).toBe(false);
    expect(info()?.getAttribute('aria-label')).toBe('Page info');
    expect(info()?.getAttribute('aria-expanded')).toBe('false');
    expect(info()?.getAttribute('aria-controls')).toBe(panel()?.id);
    info()?.click();

    expect(panel()?.hidden).toBe(false);
    expect(info()?.getAttribute('aria-expanded')).toBe('true');
    expect(q('[data-blok-database-drawer-details-toggle]')?.textContent?.trim()).toBe('Hide details');
    q('[data-blok-database-drawer-details-toggle]')?.click();

    expect(info()?.getAttribute('aria-expanded')).toBe('false');
    info()?.click();
    info()?.click();

    expect(panel()?.hidden).toBe(true);
    q('[data-blok-database-drawer-customize]')?.click();

    expect(info()?.hidden).toBe(true);
    drawer.destroy();
  });

  // research/10 §10: Notion draws Page info with `sidebarRight`; "Open pages in" next to it keeps the split view.
  it('draws Page info as a side panel, not the Open pages in glyph', () => {
    const drawer = new DatabaseCardDrawer(createOptions({ schema: schemaWith({ pageLayoutPlacements: [{ id: 'p-due', place: 'panel' }] }) }));
    const glyph = (selector: string): string | undefined => q(`[data-blok-database-drawer-toolbar] ${selector} svg`)?.outerHTML;
    const expected = document.createElement('div');

    expected.innerHTML = IconSidebarRight;
    drawer.open(ROW);

    expect(glyph('[data-blok-database-peek-page-info]')).toBe(expected.querySelector('svg')?.outerHTML);
    expect(glyph('[data-blok-database-peek-page-info]')).not.toBe(glyph('[data-blok-database-peek-mode]'));
    drawer.destroy();
  });

  // research/09 "Other checks": the expanded state carries across rows in a session; a reload resets it.
  it('keeps N more properties expanded on the next row', () => {
    const hiding = (): PropertyDefinition[] => schemaWith().map((def) => (def.id === 'p-owner' ? { ...def, pageVisibility: 'hidden' as const } : def));
    const options = createOptions({ schema: hiding() });
    const drawer = new DatabaseCardDrawer(options);
    const reveal = (): HTMLElement | null => q('[data-blok-database-drawer-hidden-props]');

    drawer.open(ROW);
    reveal()?.click();

    expect(reveal()?.getAttribute('aria-expanded')).toBe('true');
    drawer.open({ ...ROW, id: 'row-2' });

    expect(reveal()?.getAttribute('aria-expanded')).toBe('true');
    expect(idsIn('[data-blok-database-drawer-props]')).toContain('p-owner');
    drawer.close();
    drawer.open(ROW);

    expect(reveal()?.getAttribute('aria-expanded')).toBe('true');
    drawer.destroy();
    document.body.innerHTML = '';
    new DatabaseCardDrawer(createOptions({ schema: hiding() })).open(ROW);

    expect(reveal()?.getAttribute('aria-expanded')).toBe('false');
  });

  it('puts the details panel beside the page column, after it in focus order, with View details first', () => {
    const options = createOptions({
      schema: schemaWith({ pageLayoutPlacements: [{ id: 'p-owner', place: 'page' }, { id: 'p-due', place: 'panel' }] }),
    });

    new DatabaseCardDrawer(options).open(ROW);
    const columns = q('[data-blok-database-drawer-columns]');
    const main = q('[data-blok-database-drawer-columns] > [data-blok-database-drawer-main]');
    const panel = q('[data-blok-database-drawer-columns] > [data-blok-database-drawer-details]');
    const toggle = q('[data-blok-database-drawer-details-toggle]');

    expect(main?.querySelector('[data-blok-database-drawer-props]')).not.toBeNull();
    expect(main?.querySelector('[data-blok-database-drawer-modules]')).not.toBeNull();
    expect(panel?.nextElementSibling).toBeNull();
    expect(main?.nextElementSibling).toBe(panel);
    expect(toggle?.nextElementSibling).toBe(columns);
    expect(toggle?.getAttribute('aria-controls')).toBe(panel?.id);
    expect(panel?.id).not.toBe('');
  });

  it('moves the property group into the details panel', () => {
    const options = createOptions({ schema: schemaWith({ pageLayoutGroupIn: 'panel' }) });

    new DatabaseCardDrawer(options).open(ROW);

    expect(q('[data-blok-database-drawer-details] [data-blok-database-drawer-props]')).not.toBeNull();
  });

  // plan 11 §2.1: the tabs are blocks; a relation no longer makes a tab.
  it('draws a Tabbed page from the layout tabs: Content, then each view tab showing the whole linked database', () => {
    const view = document.createElement('div');
    const layoutTabs: LayoutTabsHost = {
      canEdit: () => false,
      list: () => [{ id: 'tc', title: '', view: false }, { id: 'tv', title: 'Roadmap', view: true }],
      sources: () => [],
      add: () => null,
      related: () => [],
      addRelated: () => null,
      canRelate: () => false,
      addWithRelation: () => null,
      removeRelation: vi.fn(),
      duplicate: () => null,
      ensure: () => null,
      renameMade: vi.fn(),
      discard: vi.fn(),
      attach: vi.fn((tabId: string, host: HTMLElement) => {
        view.textContent = `all rows of ${tabId}`;
        host.appendChild(view);

        return true;
      }),
      detach: vi.fn(() => view.remove()),
      notify: vi.fn(),
    };
    const options = createOptions({ schema: schemaWith({ pageLayoutStructure: 'tabbed' }), layoutTabs });

    new DatabaseCardDrawer(options).open(ROW);
    const tabs = all('[data-blok-database-drawer-tabs] [role="tab"]');

    expect(tabs.map((tab) => tab.textContent)).toEqual(['Content', 'Roadmap']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    tabs[1].click();

    expect(q('[data-blok-database-drawer-tabs] [role="tab"][aria-selected="true"]')?.textContent).toBe('Roadmap');
    expect(layoutTabs.attach).toHaveBeenLastCalledWith('tv', q('[data-blok-database-drawer-tab-panel]'), ROW.id);
    expect(q('[data-blok-database-drawer-tab-panel]')?.textContent).toBe('all rows of tv');
    expect(q('[data-blok-database-drawer-editor]')?.hidden).toBe(true);
    expect(q('[data-blok-database-drawer-props]')).toBeNull();
    q('[data-blok-database-drawer-tabs] [data-tab-id="content"]')?.click();

    expect(layoutTabs.detach).toHaveBeenCalled();
    expect(view.isConnected).toBe(false);
  });

  it('discards tabs made in an open Customize layout and puts a shown view back when destroyed', () => {
    const layoutTabs: LayoutTabsHost = {
      canEdit: () => true,
      list: () => [{ id: 'tc', title: '', view: false }, { id: 'tv', title: 'Roadmap', view: true }],
      sources: () => [{ id: 'db', title: 'Tasks' }],
      add: vi.fn(() => ({ tabId: 't9', made: 't9', contentId: null })),
      related: () => [],
      addRelated: () => null,
      canRelate: () => false,
      addWithRelation: () => null,
      removeRelation: vi.fn(),
      duplicate: () => null,
      ensure: () => null,
      renameMade: vi.fn(),
      discard: vi.fn(),
      attach: vi.fn(() => true),
      detach: vi.fn(),
      notify: vi.fn(),
    };
    const drawer = new DatabaseCardDrawer(createOptions({ schema: schemaWith({ pageLayoutStructure: 'tabbed' }), layoutTabs }));

    drawer.open(ROW);
    q('[data-blok-database-drawer-tabs] [data-tab-id="tv"]')?.click();
    drawer.startCustomizing();
    q('[data-blok-database-layout-add-tab]')?.click();
    q('[data-blok-testid="database-layout-link-data-source"]')?.click();
    q('[data-blok-testid="database-layout-source-db"]')?.click();
    q('[data-blok-testid="database-layout-add-view"]')?.click();

    expect(layoutTabs.add).toHaveBeenCalledWith('db', 'Tasks');
    vi.mocked(layoutTabs.detach).mockClear();
    drawer.destroy();

    expect(layoutTabs.discard).toHaveBeenCalledWith(['t9']);
    expect(layoutTabs.detach).toHaveBeenCalled();
  });

  it('keeps $ patterns in a deleted tab\'s name literal in the toast', async () => {
    const layoutTabs: LayoutTabsHost = {
      canEdit: () => true,
      list: () => [{ id: 'tc', title: '', view: false }, { id: 'tv', title: 'Q$$A', view: true }],
      sources: () => [],
      add: () => null,
      related: () => [],
      addRelated: () => null,
      canRelate: () => false,
      addWithRelation: () => null,
      removeRelation: vi.fn(),
      duplicate: () => null,
      ensure: () => null,
      renameMade: vi.fn(),
      discard: vi.fn(),
      attach: vi.fn(() => true),
      detach: vi.fn(),
      notify: vi.fn(),
    };
    const drawer = new DatabaseCardDrawer(createOptions({ schema: schemaWith({ pageLayoutStructure: 'tabbed' }), layoutTabs }));

    drawer.open(ROW);
    drawer.startCustomizing();
    const tab = (): HTMLElement | null => q('[data-blok-interface="database-layout-builder"] [data-blok-database-drawer-tabs] [data-tab-id="tv"]');

    tab()?.click();
    tab()?.click();
    q('[data-blok-testid="database-layout-delete-view"]')?.click();
    q('[data-blok-database-confirm-action="confirm"]')?.click();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(layoutTabs.notify).toHaveBeenCalledWith('Deleted Q$$A view');
    drawer.destroy();
  });

  // Closing or destroying mid-draft is a Discard: a relation "Add new relation" made goes with its tab.
  it.each(['close', 'destroy'] as const)('removes a relation made in an open Customize layout on %s', (exit) => {
    const layoutTabs: LayoutTabsHost = {
      canEdit: () => true,
      list: () => [{ id: 'tc', title: '', view: false }],
      sources: () => [{ id: 'dbb', title: 'Other' }],
      add: () => null,
      related: () => [],
      addRelated: () => null,
      canRelate: () => true,
      addWithRelation: vi.fn(() => ({ tabId: 't9', made: 't9', contentId: null, propertyId: 'p9' })),
      removeRelation: vi.fn(),
      duplicate: () => null,
      ensure: () => null,
      renameMade: vi.fn(),
      discard: vi.fn(),
      attach: vi.fn(() => true),
      detach: vi.fn(),
      notify: vi.fn(),
    };
    const drawer = new DatabaseCardDrawer(createOptions({ schema: schemaWith({ pageLayoutStructure: 'tabbed' }), layoutTabs }));

    drawer.open(ROW);
    drawer.startCustomizing();
    q('[data-blok-database-layout-add-tab]')?.click();
    q('[data-blok-testid="database-layout-link-data-source"]')?.click();
    q('[data-blok-testid="database-layout-source-dbb"]')?.click();
    q('[data-blok-testid="database-layout-add-relation"]')?.click();
    q('[data-blok-testid="database-layout-add-view"]')?.click();

    expect(layoutTabs.addWithRelation).toHaveBeenCalled();
    if (exit === 'close') drawer.close();
    else drawer.destroy();

    expect(layoutTabs.discard).toHaveBeenCalledWith(['t9']);
    expect(layoutTabs.removeRelation).toHaveBeenCalledWith('p9');
  });

  it('draws only Content for a Tabbed page with no layout tabs, whatever relations the database has', () => {
    new DatabaseCardDrawer(createOptions({ schema: schemaWith({ pageLayoutStructure: 'tabbed' }) })).open(ROW);

    expect(all('[data-blok-database-drawer-tabs] [role="tab"]').map((tab) => tab.textContent)).toEqual(['Content']);
  });

  describe('customizing', () => {
    it('offers Customize layout, which bears the layout lists and opens the builder', () => {
      const options = createOptions();

      new DatabaseCardDrawer(options).open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();

      expect(options.onPageLayoutBirth).toHaveBeenCalledTimes(1);
      expect(q('[data-blok-interface="database-layout-builder"]')).not.toBeNull();
      expect(q('[data-blok-database-layout-add-module]')).not.toBeNull();
    });

    it('hides Customize layout when read-only or locked', () => {
      new DatabaseCardDrawer(createOptions({ readOnly: true })).open(ROW);
      expect(q('[data-blok-database-drawer-customize]')).toBeNull();
      document.body.innerHTML = '';

      new DatabaseCardDrawer(createOptions({ databaseLocked: () => true })).open(ROW);
      expect(q('[data-blok-database-drawer-customize]')).toBeNull();
    });

    it('draws pins and page and panel modules in the canvas without changing their saved placement', () => {
      const layout: PageLayoutFields = {
        pageLayoutPlacements: [
          { id: 'p-due', place: 'heading' },
          { id: 'p-owner', place: 'page' },
          { id: 'p-status', place: 'panel' },
        ],
      };
      const options = createOptions({ schema: schemaWith(layout) });
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();

      expect(idsIn('[data-blok-database-layout-canvas] [data-blok-database-drawer-pins]')).toEqual(['p-due']);
      expect(idsIn('[data-blok-database-layout-canvas] [data-blok-database-layout-module="property"]')).toEqual(['p-owner']);
      expect(idsIn('[data-blok-database-layout-panel-column] [data-blok-database-layout-module="property"]')).toEqual(['p-status']);
      expect(idsIn('[data-blok-database-layout-canvas] [data-blok-database-drawer-props]')).toEqual(['p-rel']);
      q('[data-blok-database-layout-cancel]')?.click();

      expect(options.schema.find((property) => property.type === 'title')?.pageLayoutPlacements).toEqual(layout.pageLayoutPlacements);
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      drawer.destroy();
    });
    it('opens a collapsed property group in Customize and restores it on Cancel', () => {
      // Only a page with sections has the Properties fold (R11).
      const options = createOptions({ schema: schemaWith({ pageLayoutSections: [{ id: 's1', name: 'Planning' }] }) });
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(ROW);
      q('[data-blok-database-drawer-props-toggle]')?.click();
      q('[data-blok-database-drawer-customize]')?.click();

      expect(q('[data-blok-database-drawer-props]')?.hidden).toBe(false);
      expect(q('[data-blok-database-drawer-prop-value][data-property-id="p-status"]')?.closest('[hidden]')).toBeNull();
      expect(q('[data-blok-database-drawer-props-toggle]')?.getAttribute('aria-expanded')).toBe('true');
      q('[data-blok-database-drawer-props-toggle]')?.click();

      expect(q('[data-blok-database-drawer-props]')?.hidden).toBe(false);
      expect(idsIn('[data-blok-database-drawer-props]')).toEqual(['p-due', 'p-owner', 'p-status', 'p-rel']);
      q('[data-blok-database-layout-cancel]')?.click();

      expect(q('[data-blok-database-drawer-props]')?.hidden).toBe(true);
      expect(q('[data-blok-database-drawer-props-toggle]')?.getAttribute('aria-expanded')).toBe('false');
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      drawer.destroy();
    });

    it('opens a closed details panel in Customize and restores it on Cancel', () => {
      const layout: PageLayoutFields = { pageLayoutPlacements: [{ id: 'p-due', place: 'panel' }] };
      const options = createOptions({ schema: schemaWith(layout) });
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();

      // While customizing, the panel's modules sit in the builder's side panel column.
      expect(q('[data-blok-database-drawer-prop-value][data-property-id="p-due"]')?.closest('[hidden]')).toBeNull();
      expect(idsIn('[data-blok-database-layout-panel-column] [data-blok-database-layout-module="property"]')).toEqual(['p-due']);
      expect(q('[data-blok-database-drawer-details-toggle]')?.getAttribute('aria-expanded')).toBe('true');
      q('[data-blok-database-drawer-details-toggle]')?.click();

      expect(idsIn('[data-blok-database-layout-panel-column] [data-blok-database-layout-module="property"]')).toEqual(['p-due']);
      q('[data-blok-database-layout-cancel]')?.click();

      expect(q('[data-blok-database-drawer-details]')?.hidden).toBe(true);
      expect(q('[data-blok-database-drawer-details-toggle]')?.getAttribute('aria-expanded')).toBe('false');
      expect(options.schema.find((property) => property.type === 'title')?.pageLayoutPlacements).toEqual(layout.pageLayoutPlacements);
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      drawer.destroy();
    });

    it('previews a pin and writes nothing until Apply to all pages', () => {
      const options = createOptions();

      new DatabaseCardDrawer(options).open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      pinFromMenu('p-due');

      expect(idsIn('[data-blok-database-drawer-pins]')).toEqual(['p-due']);
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      q('[data-blok-database-layout-apply]')?.click();

      expect(options.onPageLayoutChange).toHaveBeenCalledTimes(1);
      expect(written(options)?.placements).toEqual([{ id: 'p-due', place: 'heading' }]);
      expect(q('[data-blok-interface="database-layout-builder"]')).toBeNull();
    });

    // research/09 §3b: Cancel with no edits closes at once.
    it('closes at once on Cancel with no edits, without asking', () => {
      const options = createOptions();

      new DatabaseCardDrawer(options).open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      q('[data-blok-database-layout-cancel]')?.click();

      expect(q('[data-blok-database-confirm-dialog]')).toBeNull();
      expect(q('[data-blok-interface="database-layout-builder"]')).toBeNull();
    });

    // research/09 §3b: "Discard all layout changes?" with Discard (red) and Cancel.
    it('asks before dropping edits on Cancel, and keeps customizing when that is cancelled', async () => {
      const options = createOptions();

      new DatabaseCardDrawer(options).open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      pinFromMenu('p-due');
      q('[data-blok-database-layout-cancel]')?.click();
      const dialog = q('[data-blok-database-confirm-dialog]');

      expect(dialog).not.toBeNull();
      expect(dialog?.closest('[data-blok-interface="database-layout-builder"]')).not.toBeNull();
      expect(q('[data-blok-database-confirm-title]')?.textContent).toBe('Discard all layout changes?');
      expect(q('[data-blok-database-confirm-action="confirm"]')?.textContent).toBe('Discard');
      expect(q('[data-blok-database-confirm-action="confirm"]')?.hasAttribute('data-destructive')).toBe(true);
      expect(q('[data-blok-database-confirm-action="cancel"]')?.textContent).toBe('Cancel');
      q('[data-blok-database-confirm-action="cancel"]')?.click();
      await Promise.resolve();

      expect(q('[data-blok-database-confirm-dialog]')).toBeNull();
      expect(q('[data-blok-interface="database-layout-builder"]')).not.toBeNull();
      expect(idsIn('[data-blok-database-drawer-pins]')).toEqual(['p-due']);
    });

    it('drops the draft and every property made while customizing on Discard', async () => {
      const added: PropertyDefinition[] = [];
      const options = createOptions({ onDeleteProperty: vi.fn() });
      const drawer = new DatabaseCardDrawer({
        ...options,
        onAddProperty: () => {
          added.push({ id: `p-new-${added.length}`, name: 'Budget', type: 'number', position: `a9${added.length}` });
          drawer.refreshSchema([...schemaWith(), ...added]);
        },
      });

      drawer.open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      q('[data-blok-database-drawer-add-prop]')?.click();
      q('[data-blok-database-property-type-option="number"]')?.click();
      addPin()?.click();
      q('[data-blok-database-property-type-option="number"]')?.click();
      q('[data-blok-database-layout-cancel]')?.click();
      q('[data-blok-database-confirm-action="confirm"]')?.click();
      await Promise.resolve();

      expect(vi.mocked(options.onDeleteProperty)?.mock.calls.map(([id]) => id)).toEqual(['p-new-0', 'p-new-1']);
      expect(q('[data-blok-interface="database-layout-builder"]')).toBeNull();
      expect(q('[data-blok-database-drawer-pins]')).toBeNull();
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      drawer.destroy();
    });

    it('asks on Cancel after only adding a property through the host menu, and deletes it on Discard', async () => {
      const options = createOptions({ onOpenAddProperty: vi.fn(), onDeleteProperty: vi.fn() });
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      q('[data-blok-database-drawer-add-prop]')?.click();
      const [, onAdded] = vi.mocked(options.onOpenAddProperty)?.mock.calls[0] ?? [];

      drawer.refreshSchema([...schemaWith(), { id: 'p-new', name: 'Budget', type: 'number', position: 'a9' }]);
      onAdded?.('p-new');
      q('[data-blok-database-layout-cancel]')?.click();

      expect(q('[data-blok-database-confirm-dialog]')).not.toBeNull();
      q('[data-blok-database-confirm-action="confirm"]')?.click();
      await Promise.resolve();

      expect(options.onDeleteProperty).toHaveBeenCalledWith('p-new');
      drawer.destroy();
    });

    it('keeps the drawer and the draft when Escape closes the discard question', async () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      pinFromMenu('p-due');
      q('[data-blok-database-layout-cancel]')?.click();
      q('[data-blok-database-confirm-action="cancel"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await Promise.resolve();

      expect(q('[data-blok-database-confirm-dialog]')).toBeNull();
      expect(q('[data-blok-database-drawer]')).not.toBeNull();
      expect(idsIn('[data-blok-database-drawer-pins]')).toEqual(['p-due']);
      drawer.destroy();
    });

    it('keeps the page and the draft open on Escape while customizing', () => {
      const options = createOptions({ onEscapeClose: vi.fn() });
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      pinFromMenu('p-due');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(q('[data-blok-database-drawer]')).not.toBeNull();
      expect(q('[data-blok-interface="database-layout-builder"]')).not.toBeNull();
      expect(idsIn('[data-blok-database-drawer-pins]')).toEqual(['p-due']);
      expect(options.onEscapeClose).not.toHaveBeenCalled();
      drawer.destroy();
    });

    it('keeps the draft across a remote schema refresh and applies it over the newest layout', () => {
      const options = createOptions({ schema: schemaWith({ pageLayoutPlacements: [], pageLayoutSections: [] }) });
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      pinFromMenu('p-due');
      drawer.refreshSchema(schemaWith({ pageLayoutPlacements: [{ id: 'p-status', place: 'heading' }], pageLayoutSections: [] }));

      expect(idsIn('[data-blok-database-drawer-pins]')).toEqual(['p-status', 'p-due']);
      q('[data-blok-database-layout-apply]')?.click();

      expect(written(options, { pageLayoutPlacements: [{ id: 'p-status', place: 'heading' }] })?.placements)
        .toEqual([{ id: 'p-status', place: 'heading' }, { id: 'p-due', place: 'heading' }]);
    });

    it('disables the pin buttons at the pin limit', () => {
      const many: PropertyDefinition[] = Array.from({ length: PAGE_LAYOUT_PIN_LIMIT + 1 }, (_, i) =>
        ({ id: `x${i}`, name: `X${i}`, type: 'text' as const, position: `b${String(i).padStart(2, '0')}` }));
      const options = createOptions({
        schema: [
          { id: 'p-title', name: 'Title', type: 'title', position: 'a0', pageLayoutPlacements: many.slice(0, PAGE_LAYOUT_PIN_LIMIT).map((p) => ({ id: p.id, place: 'heading' as const })) },
          ...many,
        ],
      });

      new DatabaseCardDrawer(options).open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      openHeadingMenu();

      expect(pinButton(`x${PAGE_LAYOUT_PIN_LIMIT}`)?.disabled).toBe(true);
      // Unpinning stays possible at the limit.
      expect(pinButton('x0')?.disabled).toBe(false);
    });

    it('keeps the pin buttons disabled when the Heading menu search hides all 15 existing pins', () => {
      const pins: PropertyDefinition[] = Array.from({ length: PAGE_LAYOUT_PIN_LIMIT }, (_, i) =>
        ({ id: `pin-${i}`, name: `Pinned ${i}`, type: 'text', position: `b${String(i).padStart(2, '0')}` }));
      const options = createOptions({
        schema: [
          {
            id: 'p-title', name: 'Title', type: 'title', position: 'a0',
            pageLayoutPlacements: pins.map((property) => ({ id: property.id, place: 'heading' })),
          },
          ...pins,
          { id: 'candidate', name: 'Candidate', type: 'text', position: 'c0' },
        ],
      });
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      searchHeadingMenu('candidate');

      expect(pinButton('candidate')?.disabled).toBe(true);
      expect(pinButton('pin-0')?.closest<HTMLElement>('[data-blok-database-layout-pin-row]')?.hidden).toBe(true);
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      drawer.destroy();
    });

    it('adds the first section with every group property in it, then a second, empty one at the top', () => {
      const options = createOptions();
      const rename = (name: string): void => {
        const field = q<HTMLInputElement>('[data-blok-database-layout-section-rename] input');

        if (field === null) throw new Error('no section name field');
        field.value = name;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        q('[data-blok-database-layout-section-done]')?.click();
      };

      new DatabaseCardDrawer(options).open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      addSectionFromMenu();
      rename('Planning');
      addSectionFromMenu();
      rename('Later');
      q('[data-blok-database-layout-group-row][data-property-id="p-due"] [data-blok-database-layout-group-name]')?.click();
      all('[data-blok-database-panel-row]').find((item) => item.textContent?.includes('Later'))?.click();
      q('[data-blok-database-layout-apply]')?.click();
      const layout = written(options);
      const [later, planning] = layout?.sections ?? [];

      expect(layout?.sections.map((section) => section.name)).toEqual(['Later', 'Planning']);
      expect(layout?.placements).toEqual([
        { id: 'p-status', place: 'section', sectionId: planning?.id },
        { id: 'p-owner', place: 'section', sectionId: planning?.id },
        { id: 'p-rel', place: 'section', sectionId: planning?.id },
        { id: 'p-due', place: 'section', sectionId: later?.id },
      ]);
    });

    it('sets the structure from Page settings, and resets to the original layout once confirmed from More save options', async () => {
      const options = createOptions({ schema: schemaWith({ pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }], pageLayoutSections: [] }) });

      new DatabaseCardDrawer(options).open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      [...document.querySelectorAll<HTMLElement>('[data-blok-database-layout-structure-card]')].find((card) => card.textContent?.trim() === 'Tabbed')?.click();

      expect(q('[data-blok-database-drawer-tabs]')).not.toBeNull();
      q('[data-blok-database-layout-more-save]')?.click();
      clickItem('reset');

      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      q('[data-blok-database-confirm-action="confirm"]')?.click();
      await Promise.resolve();

      expect(written(options, { pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }], pageLayoutStructure: 'tabbed' }))
        .toEqual({ structure: 'simple', groupIn: 'page', propertyIcons: true, propertyLabels: true, templates: true, fullWidth: false, placements: [{ id: 'p-due', place: 'group' }], sections: [] });
      expect(q('[data-blok-interface="database-layout-builder"]')).toBeNull();
      expect(q('[data-blok-database-drawer-tabs]')).toBeNull();
    });

    it('turns property icons off from Page settings as a draft edit', () => {
      const options = createOptions();

      new DatabaseCardDrawer(options).open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      const toggle = q('[data-blok-testid="database-layout-option-layoutPropertyIcons"]');

      expect(toggle?.getAttribute('role')).toBe('switch');
      toggle?.click();

      expect(q('[data-blok-database-drawer-prop-icon]')).toBeNull();
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      q('[data-blok-database-layout-apply]')?.click();

      expect(written(options)?.propertyIcons).toBe(false);
    });

    it('draws no property icons when the layout turns them off', () => {
      new DatabaseCardDrawer(createOptions({ schema: schemaWith({ pageLayoutPropertyIcons: false }) })).open(ROW);

      expect(q('[data-blok-database-drawer-prop-label][data-property-id="p-due"]')?.textContent).toBe('Due');
      expect(q('[data-blok-database-drawer-prop-icon]')).toBeNull();
    });

    it('keeps the unapplied draft when stepping to the next page', () => {
      const next: DatabaseRow = { id: 'row-2', position: 'a1', properties: { 'p-title': 'Second', 'p-due': 'Monday' } };
      const options = createOptions({ adjacentRow: (rowId, direction) => (rowId === 'row-1' && direction === 1 ? next : undefined) });

      new DatabaseCardDrawer(options).open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      pinFromMenu('p-due');
      q('[data-blok-database-peek-next]')?.click();

      expect(q('[data-blok-database-drawer-pins] [data-blok-database-drawer-prop-value][data-property-id="p-due"]')?.textContent).toContain('Monday');
      expect(q('[data-blok-interface="database-layout-builder"]')).not.toBeNull();
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
    });

    it('adds a property from the Heading menu as a draft pin, even with no pins yet', () => {
      const added: PropertyDefinition = { id: 'p-new', name: 'Budget', type: 'number', position: 'a9' };
      const options = createOptions({ onOpenAddProperty: vi.fn() });
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      const add = addPin();

      expect(add?.disabled).toBe(false);
      add?.click();
      const [anchor, onAdded] = vi.mocked(options.onOpenAddProperty)?.mock.calls[0] ?? [];

      expect(anchor).toBe(q('[data-blok-database-layout-module="heading"] [data-blok-database-layout-module-menu]'));
      drawer.refreshSchema([...schemaWith(), added]);
      onAdded?.('p-new');

      expect(idsIn('[data-blok-database-drawer-pins]')).toEqual(['p-new']);
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      q('[data-blok-database-layout-apply]')?.click();

      expect(written(options)?.placements).toEqual([{ id: 'p-new', place: 'heading' }]);
    });

    it('pins a property made with the built-in type menu from the Heading menu only', () => {
      const added: PropertyDefinition[] = [];
      const options = createOptions();
      const drawer = new DatabaseCardDrawer({
        ...options,
        onAddProperty: () => {
          added.push({ id: `p-new-${added.length}`, name: 'Budget', type: 'number', position: `a9${added.length}` });
          drawer.refreshSchema([...schemaWith(), ...added]);
        },
      });

      drawer.open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      q('[data-blok-database-drawer-add-prop]')?.click();
      q('[data-blok-database-property-type-option="number"]')?.click();

      expect(idsIn('[data-blok-database-drawer-pins]')).toEqual([]);
      addPin()?.click();
      q('[data-blok-database-property-type-option="number"]')?.click();

      expect(idsIn('[data-blok-database-drawer-pins]')).toEqual(['p-new-1']);
      drawer.destroy();
    });

    it('disables Add a property in the Heading menu at the pin limit, counting pins search hides', () => {
      const pins: PropertyDefinition[] = Array.from({ length: PAGE_LAYOUT_PIN_LIMIT }, (_, i) =>
        ({ id: `pin-${i}`, name: `Pinned ${i}`, type: 'text', position: `b${String(i).padStart(2, '0')}` }));
      const options = createOptions({
        schema: [
          { id: 'p-title', name: 'Title', type: 'title', position: 'a0', pageLayoutPlacements: pins.map((p) => ({ id: p.id, place: 'heading' })) },
          ...pins,
          { id: 'candidate', name: 'Candidate', type: 'text', position: 'c0' },
        ],
        onOpenAddProperty: vi.fn(),
      });

      new DatabaseCardDrawer(options).open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      searchHeadingMenu('candidate');

      expect(addPin()?.disabled).toBe(true);
    });

    it('draws no Add a property in the pins row', () => {
      new DatabaseCardDrawer(createOptions({ schema: schemaWith({ pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }] }) })).open(ROW);

      expect(q('[data-blok-database-drawer-pins]')).not.toBeNull();
      expect(q('[data-blok-database-layout-add-pin]')).toBeNull();
    });

    it('drops the draft when the page closes', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      pinFromMenu('p-due');
      drawer.close();
      drawer.open(ROW);

      expect(q('[data-blok-database-drawer-pins]')).toBeNull();
      expect(q('[data-blok-interface="database-layout-builder"]')).toBeNull();
    });
  });

  // research/10 §4: Property labels OFF.
  describe('property labels off', () => {
    const LABELS_OFF = (): PropertyDefinition[] => [
      ...schemaWith({
        pageLayoutPropertyLabels: false,
        pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }, { id: 'p-owner', place: 'heading' }, { id: 'p-done', place: 'heading' }],
      }),
      { id: 'p-done', name: 'Done', type: 'checkbox', position: 'a5' },
    ];
    const EMPTY_OWNER: DatabaseRow = { ...ROW, properties: { ...ROW.properties, 'p-owner': '' } };
    const pin = (id: string): HTMLElement | null => q(`[data-blok-database-drawer-pins] [data-blok-database-drawer-pin][data-property-id="${id}"]`);
    const placeholder = (id: string): HTMLElement | null =>
      q(`[data-blok-database-drawer-prop-value][data-property-id="${id}"] [data-blok-database-drawer-prop-placeholder]`);

    it('drops pin labels when Property labels is off', () => {
      new DatabaseCardDrawer(createOptions({ schema: LABELS_OFF() })).open(ROW);

      expect(all('[data-blok-database-drawer-pin]')).toHaveLength(3);
      expect(q('[data-blok-database-drawer-pins] [data-blok-database-drawer-prop-head]')).toBeNull();
      expect(q('[data-blok-database-drawer-pins] [data-blok-database-drawer-prop-label]')).toBeNull();
      expect(q('[data-blok-database-drawer-props] [data-blok-database-drawer-prop-label][data-property-id="p-status"]')?.textContent).toBe('Status');
    });

    it('shows an empty pin as its icon and name in grey when labels are off', () => {
      new DatabaseCardDrawer(createOptions({ schema: LABELS_OFF() })).open(EMPTY_OWNER);

      expect(placeholder('p-owner')?.textContent?.trim()).toBe('Owner');
      expect(placeholder('p-owner')?.querySelector('[data-blok-database-drawer-prop-icon] svg')).not.toBeNull();
      expect(q('[data-blok-database-drawer-prop-value][data-property-id="p-owner"]')?.textContent).not.toContain('Empty');
    });

    it('shows a filled pin as its value only when labels are off', () => {
      new DatabaseCardDrawer(createOptions({ schema: LABELS_OFF() })).open(ROW);

      expect(placeholder('p-due')).toBeNull();
      expect(pin('p-due')?.textContent).toBe('Friday');
      expect(pin('p-due')?.querySelector('[data-blok-database-drawer-prop-icon]')).toBeNull();
      expect(pin('p-due')?.hasAttribute('title')).toBe(false);
    });

    it('shows an empty checkbox pin as its box only, named for assistive tech', () => {
      new DatabaseCardDrawer(createOptions({ schema: LABELS_OFF(), readOnly: true })).open(ROW);

      expect(pin('p-done')?.querySelector('[data-blok-database-checkbox]')?.getAttribute('data-state')).toBe('unchecked');
      expect(placeholder('p-done')).toBeNull();
      expect(pin('p-done')?.getAttribute('role')).toBe('group');
      expect(pin('p-done')?.getAttribute('aria-label')).toBe('Done');
      expect(pin('p-done')?.hasAttribute('title')).toBe(false);
    });

    it('shows the placeholder again when a filled label-less pin is cleared in place', () => {
      const options = createOptions({ schema: LABELS_OFF() });

      new DatabaseCardDrawer(options).open(ROW);
      q('[data-blok-database-drawer-prop-value][data-property-id="p-owner"]')?.click();
      const input = q<HTMLInputElement>('[data-blok-database-cell-editor] input, [data-blok-database-cell-editor] textarea');

      if (input === null) throw new Error('no editor input');
      input.value = '';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

      expect(options.onPropertyValueChange).toHaveBeenCalledWith('row-1', 'p-owner', '');
      expect(placeholder('p-owner')?.textContent?.trim()).toBe('Owner');
    });

    it('turns pin labels off from the Heading menu as a draft edit', () => {
      const options = createOptions({ schema: schemaWith({ pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }] }) });

      new DatabaseCardDrawer(options).open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      openHeadingMenu();
      q('[data-blok-testid="database-layout-option-layoutPropertyLabels"]')?.click();

      expect(q('[data-blok-database-drawer-pin]')).not.toBeNull();
      expect(q('[data-blok-database-drawer-pin] [data-blok-database-drawer-prop-label]')).toBeNull();
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      q('[data-blok-database-layout-apply]')?.click();

      expect(written(options)?.propertyLabels).toBe(false);
    });
  });

  describe('pin scroll arrows', () => {
    const PINNED = schemaWith({ pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }, { id: 'p-owner', place: 'heading' }] });
    const observers: Array<{ observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; fire: () => void }> = [];

    /** Gives every element the same scroll box; jsdom has no layout. */
    const box = (scrollWidth: number, clientWidth: number): void => {
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scrollWidth);
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(clientWidth);
    };

    beforeEach(() => {
      observers.length = 0;
      vi.stubGlobal('ResizeObserver', class {
        private readonly callback: () => void;
        readonly observe = vi.fn();
        readonly disconnect = vi.fn();
        constructor(callback: () => void) {
          this.callback = callback;
          observers.push({ observe: this.observe, disconnect: this.disconnect, fire: () => this.callback() });
        }
        unobserve(): void {}
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
    });

    const row = (): HTMLElement | null => q('[data-blok-database-drawer-pins-row]');

    // research/09 §4: each arrow shows only while the strip can scroll its way.
    it('marks only the forward side scrollable while the pins overflow at the start', () => {
      box(600, 300);
      new DatabaseCardDrawer(createOptions({ schema: PINNED })).open(ROW);
      observers.at(-1)?.fire();

      expect(row()?.hasAttribute('data-scroll-forward')).toBe(true);
      expect(row()?.hasAttribute('data-scroll-back')).toBe(false);
      expect(q('[data-blok-database-drawer-pins-forward]')?.getAttribute('aria-label')).toBe('Scroll to next pinned properties');
      expect(observers.at(-1)?.observe).toHaveBeenCalledWith(q('[data-blok-database-drawer-pins]'));
    });

    it('marks neither side scrollable when the pins fit', () => {
      box(300, 300);
      new DatabaseCardDrawer(createOptions({ schema: PINNED })).open(ROW);
      observers.at(-1)?.fire();

      expect(row()?.hasAttribute('data-scroll-forward')).toBe(false);
      expect(row()?.hasAttribute('data-scroll-back')).toBe(false);
    });

    // research/09 §4: 0 → 400 → 682 (max) and 682 → 282 → 0 at width 600, scrollWidth 1282.
    it('scrolls 400px per click, clamped to both ends', () => {
      box(1282, 600);
      const scrollLeft = vi.spyOn(HTMLElement.prototype, 'scrollLeft', 'get').mockReturnValue(0);
      const scrollTo = vi.fn();

      Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, writable: true, value: scrollTo });
      new DatabaseCardDrawer(createOptions({ schema: PINNED })).open(ROW);
      const forward = q('[data-blok-database-drawer-pins-forward]');
      const back = q('[data-blok-database-drawer-pins-back]');
      const lefts = (): unknown[] => scrollTo.mock.calls.map(([arg]) => (arg as ScrollToOptions).left);

      forward?.click();
      scrollLeft.mockReturnValue(400);
      forward?.click();
      scrollLeft.mockReturnValue(682);
      back?.click();
      scrollLeft.mockReturnValue(282);
      back?.click();

      expect(lefts()).toEqual([400, 682, 282, 0]);
    });

    // research/09 §4: inside the builder there are no arrows, only the edge fade.
    it('draws no arrows while customizing but still marks the fade sides', () => {
      box(600, 300);
      new DatabaseCardDrawer(createOptions({ schema: PINNED })).open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      observers.at(-1)?.fire();

      expect(q('[data-blok-database-drawer-pins-forward]')).toBeNull();
      expect(q('[data-blok-database-drawer-pins-back]')).toBeNull();
      expect(row()?.hasAttribute('data-scroll-forward')).toBe(true);
    });

    it('disconnects the pins observer on redraw, close and destroy', () => {
      const drawer = new DatabaseCardDrawer(createOptions({ schema: PINNED }));

      drawer.open(ROW);
      const first = observers.at(-1);

      drawer.refreshSchema(PINNED);
      expect(first?.disconnect).toHaveBeenCalled();
      const second = observers.at(-1);

      expect(second).not.toBe(first);
      drawer.close();
      expect(second?.disconnect).toHaveBeenCalled();
      drawer.open(ROW);
      const third = observers.at(-1);

      drawer.destroy();
      expect(third?.disconnect).toHaveBeenCalled();
    });
  });
});
