import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDrawerOptions } from '../../../../src/tools/database/database-card-drawer';
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

const openItemMenu = (propertyId: string): void => {
  const button = q(`[data-blok-database-layout-item-menu][data-property-id="${propertyId}"]`);

  if (button === null) throw new Error(`no layout menu for ${propertyId}`);
  button.click();
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

  it('shows pinned properties in the heading and not again in the group', () => {
    const options = createOptions({ schema: schemaWith({ pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }] }) });

    new DatabaseCardDrawer(options).open(ROW);

    expect(idsIn('[data-blok-database-drawer-pins]')).toEqual(['p-due']);
    expect(idsIn('[data-blok-database-drawer-props]')).toEqual(['p-status', 'p-owner', 'p-rel']);
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
    expect(idsIn('[data-blok-database-drawer-props]')).toEqual(['p-status', 'p-due', 'p-owner', 'p-rel']);
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

  // research/09 §9: closed on every navigation measured; it does not persist.
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

  it('draws a Tabbed page: a Content tab, and a relation tab that hides the body', () => {
    const options = createOptions({ schema: schemaWith({ pageLayoutStructure: 'tabbed' }) });

    new DatabaseCardDrawer(options).open(ROW);
    const tabs = all('[data-blok-database-drawer-tabs] [role="tab"]');

    expect(tabs.map((tab) => tab.textContent)).toEqual(['Content', 'Tasks']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    tabs[1].click();

    expect(q('[data-blok-database-drawer-tabs] [role="tab"][aria-selected="true"]')?.textContent).toBe('Tasks');
    expect(idsIn('[data-blok-database-drawer-tab-panel]')).toEqual(['p-rel']);
    expect(q('[data-blok-database-drawer-editor]')?.hidden).toBe(true);
    expect(q('[data-blok-database-drawer-props]')).toBeNull();
  });

  describe('customizing', () => {
    it('offers Customize layout, which bears the layout lists and shows the builder bar', () => {
      const options = createOptions();

      new DatabaseCardDrawer(options).open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();

      expect(options.onPageLayoutBirth).toHaveBeenCalledTimes(1);
      expect(q('[data-blok-database-drawer-layout-bar]')).not.toBeNull();
      expect(q('[data-blok-database-layout-item-menu][data-property-id="p-due"]')).not.toBeNull();
    });

    it('hides Customize layout when read-only or locked', () => {
      new DatabaseCardDrawer(createOptions({ readOnly: true })).open(ROW);
      expect(q('[data-blok-database-drawer-customize]')).toBeNull();
      document.body.innerHTML = '';

      new DatabaseCardDrawer(createOptions({ databaseLocked: () => true })).open(ROW);
      expect(q('[data-blok-database-drawer-customize]')).toBeNull();
    });

    it('searches property names live, including hidden properties and folded sections', () => {
      const options = createOptions({
        schema: schemaWith({
          pageLayoutSections: [{ id: 's1', name: 'Planning' }],
          pageLayoutPlacements: [{ id: 'p-due', place: 'section', sectionId: 's1' }],
        }).map((property) => property.id === 'p-status' ? { ...property, pageVisibility: 'hidden' as const } : property),
      });
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(ROW);
      q('[data-blok-database-drawer-section-toggle][data-section-id="s1"]')?.click();
      q('[data-blok-database-drawer-customize]')?.click();
      const search = q<HTMLInputElement>('[data-blok-database-layout-search]');

      expect(search).not.toBeNull();
      if (search === null) throw new Error('missing property search');
      search.value = 'STAT';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      expect(idsIn('[data-blok-database-drawer-props]')).toEqual(['p-status']);
      search.value = 'uE';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      expect(idsIn('[data-blok-database-drawer-props]')).toEqual(['p-due']);
      expect(q('[data-blok-database-drawer-section-body]')?.hidden).toBe(false);
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      drawer.destroy();
    });

    it('clearing property search restores every builder property without changing page visibility', () => {
      const options = createOptions({
        schema: schemaWith().map((property) => property.id === 'p-status' ? { ...property, pageVisibility: 'hidden' as const } : property),
      });
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      const search = q<HTMLInputElement>('[data-blok-database-layout-search]');

      expect(search).not.toBeNull();
      if (search === null) throw new Error('missing property search');
      search.value = 'missing';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      expect(idsIn('[data-blok-database-drawer-props]')).toEqual([]);
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      expect(idsIn('[data-blok-database-drawer-props]')).toEqual(['p-status', 'p-due', 'p-owner', 'p-rel']);
      q('[data-blok-database-layout-cancel]')?.click();

      expect(idsIn('[data-blok-database-drawer-props]')).toEqual(['p-due', 'p-owner', 'p-rel']);
      expect(options.schema.find((property) => property.id === 'p-status')?.pageVisibility).toBe('hidden');
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      drawer.destroy();
    });

    it('keeps the selected relation tab when property search hides its value', () => {
      const drawer = new DatabaseCardDrawer(createOptions({
        schema: schemaWith({ pageLayoutStructure: 'tabbed' }),
      }));

      drawer.open(ROW);
      q('[data-blok-database-drawer-tabs] [data-tab-id="p-rel"]')?.click();
      q('[data-blok-database-drawer-customize]')?.click();
      const search = q<HTMLInputElement>('[data-blok-database-layout-search]');

      if (search === null) throw new Error('missing property search');
      search.value = 'due';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      expect(q('[data-blok-database-drawer-tabs] [aria-selected="true"]')?.getAttribute('data-tab-id')).toBe('p-rel');
      expect(idsIn('[data-blok-database-drawer-tab-panel]')).toEqual([]);
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      expect(q('[data-blok-database-drawer-tabs] [aria-selected="true"]')?.getAttribute('data-tab-id')).toBe('p-rel');
      expect(idsIn('[data-blok-database-drawer-tab-panel]')).toEqual(['p-rel']);
      q('[data-blok-database-layout-cancel]')?.click();

      expect(q('[data-blok-database-drawer-tabs] [aria-selected="true"]')?.getAttribute('data-tab-id')).toBe('p-rel');
      drawer.destroy();
    });

    it('searches pins and page and panel modules without changing their saved placement', () => {
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
      const search = q<HTMLInputElement>('[data-blok-database-layout-search]');

      if (search === null) throw new Error('missing property search');
      for (const [query, region, id] of [
        ['due', '[data-blok-database-drawer-pins]', 'p-due'],
        ['owner', '[data-blok-database-drawer-modules]', 'p-owner'],
        ['status', '[data-blok-database-drawer-panel-modules]', 'p-status'],
        ['tasks', '[data-blok-database-drawer-props]', 'p-rel'],
      ]) {
        search.value = query;
        search.dispatchEvent(new Event('input', { bubbles: true }));

        expect(idsIn(region)).toEqual([id]);
        expect(idsIn('[data-blok-database-drawer-content]')).toEqual([id]);
      }
      expect(options.schema.find((property) => property.type === 'title')?.pageLayoutPlacements).toEqual(layout.pageLayoutPlacements);
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      expect(idsIn('[data-blok-database-drawer-pins]')).toEqual(['p-due']);
      expect(idsIn('[data-blok-database-drawer-modules]')).toEqual(['p-owner']);
      expect(idsIn('[data-blok-database-drawer-panel-modules]')).toEqual(['p-status']);
      drawer.destroy();
    });

    it('opens a collapsed property group in Customize and restores it on Cancel', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(ROW);
      q('[data-blok-database-drawer-props-toggle]')?.click();
      q('[data-blok-database-drawer-customize]')?.click();

      expect(q('[data-blok-database-drawer-props]')?.hidden).toBe(false);
      const search = q<HTMLInputElement>('[data-blok-database-layout-search]');

      if (search === null) throw new Error('missing property search');
      search.value = 'status';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      expect(q('[data-blok-database-drawer-prop-value][data-property-id="p-status"]')?.closest('[hidden]')).toBeNull();
      expect(idsIn('[data-blok-database-drawer-props]')).toEqual(['p-status']);
      expect(q('[data-blok-database-drawer-props-toggle]')?.getAttribute('aria-expanded')).toBe('true');
      q('[data-blok-database-drawer-props-toggle]')?.click();

      expect(q('[data-blok-database-drawer-props]')?.hidden).toBe(false);
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      expect(q('[data-blok-database-drawer-props]')?.hidden).toBe(false);
      expect(idsIn('[data-blok-database-drawer-props]')).toEqual(['p-status', 'p-due', 'p-owner', 'p-rel']);
      search.value = 'status';
      search.dispatchEvent(new Event('input', { bubbles: true }));
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

      expect(q('[data-blok-database-drawer-details]')?.hidden).toBe(false);
      const search = q<HTMLInputElement>('[data-blok-database-layout-search]');

      if (search === null) throw new Error('missing property search');
      search.value = 'due';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      expect(q('[data-blok-database-drawer-prop-value][data-property-id="p-due"]')?.closest('[hidden]')).toBeNull();
      expect(idsIn('[data-blok-database-drawer-panel-modules]')).toEqual(['p-due']);
      expect(q('[data-blok-database-drawer-details-toggle]')?.getAttribute('aria-expanded')).toBe('true');
      q('[data-blok-database-drawer-details-toggle]')?.click();

      expect(q('[data-blok-database-drawer-details]')?.hidden).toBe(false);
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      expect(q('[data-blok-database-drawer-details]')?.hidden).toBe(false);
      search.value = 'due';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      q('[data-blok-database-layout-cancel]')?.click();

      expect(q('[data-blok-database-drawer-details]')?.hidden).toBe(true);
      expect(q('[data-blok-database-drawer-details-toggle]')?.getAttribute('aria-expanded')).toBe('false');
      expect(options.schema.find((property) => property.type === 'title')?.pageLayoutPlacements).toEqual(layout.pageLayoutPlacements);
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      drawer.destroy();
    });

    it('shows searched content beside a relation tab and restores the tab on clear', () => {
      const options = createOptions({ schema: schemaWith({ pageLayoutStructure: 'tabbed' }) });
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(ROW);
      q('[data-blok-database-drawer-tabs] [data-tab-id="p-rel"]')?.click();
      q('[data-blok-database-drawer-customize]')?.click();
      const search = q<HTMLInputElement>('[data-blok-database-layout-search]');

      if (search === null) throw new Error('missing property search');
      search.value = 'due';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      expect(q('[data-blok-database-drawer-prop-value][data-property-id="p-due"]')?.closest('[hidden]')).toBeNull();
      expect(idsIn('[data-blok-database-drawer-props]')).toEqual(['p-due']);
      expect(q('[data-blok-database-drawer-tabs] [aria-selected="true"]')?.getAttribute('data-tab-id')).toBe('p-rel');
      expect(q('[data-blok-database-drawer-editor]')?.hidden).toBe(true);
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      expect(idsIn('[data-blok-database-drawer-tab-panel]')).toEqual(['p-rel']);
      expect(q('[data-blok-database-drawer-props]')).toBeNull();
      expect(q('[data-blok-database-drawer-tabs] [aria-selected="true"]')?.getAttribute('data-tab-id')).toBe('p-rel');
      search.value = 'due';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      q('[data-blok-database-layout-cancel]')?.click();

      expect(idsIn('[data-blok-database-drawer-tab-panel]')).toEqual(['p-rel']);
      expect(q('[data-blok-database-drawer-props]')).toBeNull();
      expect(q('[data-blok-database-drawer-tabs] [aria-selected="true"]')?.getAttribute('data-tab-id')).toBe('p-rel');
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      drawer.destroy();
    });

    it('previews a pin and writes nothing until Apply to all pages', () => {
      const options = createOptions();

      new DatabaseCardDrawer(options).open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      openItemMenu('p-due');
      clickItem('pin');

      expect(idsIn('[data-blok-database-drawer-pins]')).toEqual(['p-due']);
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      q('[data-blok-database-layout-apply]')?.click();

      expect(options.onPageLayoutChange).toHaveBeenCalledTimes(1);
      expect(written(options)?.placements).toEqual([{ id: 'p-due', place: 'heading' }]);
      expect(q('[data-blok-database-drawer-layout-bar]')).toBeNull();
    });

    // research/09 §3b: Cancel with no edits closes at once.
    it('closes at once on Cancel with no edits, without asking', () => {
      const options = createOptions();

      new DatabaseCardDrawer(options).open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      q('[data-blok-database-layout-cancel]')?.click();

      expect(q('[data-blok-database-confirm-dialog]')).toBeNull();
      expect(q('[data-blok-database-drawer-layout-bar]')).toBeNull();
    });

    // research/09 §3b: "Discard all layout changes?" with Discard (red) and Cancel.
    it('asks before dropping edits on Cancel, and keeps customizing when that is cancelled', async () => {
      const options = createOptions();

      new DatabaseCardDrawer(options).open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      openItemMenu('p-due');
      clickItem('pin');
      q('[data-blok-database-layout-cancel]')?.click();
      const dialog = q('[data-blok-database-confirm-dialog]');

      expect(dialog).not.toBeNull();
      expect(dialog?.closest('[data-blok-database-drawer]')).not.toBeNull();
      expect(q('[data-blok-database-confirm-title]')?.textContent).toBe('Discard all layout changes?');
      expect(q('[data-blok-database-confirm-action="confirm"]')?.textContent).toBe('Discard');
      expect(q('[data-blok-database-confirm-action="confirm"]')?.hasAttribute('data-destructive')).toBe(true);
      expect(q('[data-blok-database-confirm-action="cancel"]')?.textContent).toBe('Cancel');
      q('[data-blok-database-confirm-action="cancel"]')?.click();
      await Promise.resolve();

      expect(q('[data-blok-database-confirm-dialog]')).toBeNull();
      expect(q('[data-blok-database-drawer-layout-bar]')).not.toBeNull();
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
      q('[data-blok-database-layout-add-pin]')?.click();
      q('[data-blok-database-property-type-option="number"]')?.click();
      q('[data-blok-database-layout-cancel]')?.click();
      q('[data-blok-database-confirm-action="confirm"]')?.click();
      await Promise.resolve();

      expect(vi.mocked(options.onDeleteProperty)?.mock.calls.map(([id]) => id)).toEqual(['p-new-0', 'p-new-1']);
      expect(q('[data-blok-database-drawer-layout-bar]')).toBeNull();
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
      openItemMenu('p-due');
      clickItem('pin');
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
      openItemMenu('p-due');
      clickItem('pin');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(q('[data-blok-database-drawer]')).not.toBeNull();
      expect(q('[data-blok-database-drawer-layout-bar]')).not.toBeNull();
      expect(idsIn('[data-blok-database-drawer-pins]')).toEqual(['p-due']);
      expect(options.onEscapeClose).not.toHaveBeenCalled();
      drawer.destroy();
    });

    it('keeps the draft across a remote schema refresh and applies it over the newest layout', () => {
      const options = createOptions({ schema: schemaWith({ pageLayoutPlacements: [], pageLayoutSections: [] }) });
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      openItemMenu('p-due');
      clickItem('pin');
      drawer.refreshSchema(schemaWith({ pageLayoutPlacements: [{ id: 'p-status', place: 'heading' }], pageLayoutSections: [] }));

      expect(idsIn('[data-blok-database-drawer-pins]')).toEqual(['p-status', 'p-due']);
      q('[data-blok-database-layout-apply]')?.click();

      expect(written(options, { pageLayoutPlacements: [{ id: 'p-status', place: 'heading' }] })?.placements)
        .toEqual([{ id: 'p-status', place: 'heading' }, { id: 'p-due', place: 'heading' }]);
    });

    it('disables Pin to heading at the pin limit', () => {
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
      openItemMenu(`x${PAGE_LAYOUT_PIN_LIMIT}`);

      expect(q('[data-blok-popover-item][data-blok-item-name="pin"]')?.getAttribute('aria-disabled')).toBe('true');
    });

    it('keeps Pin to heading disabled when search hides all 15 existing pins', () => {
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
      const search = q<HTMLInputElement>('[data-blok-database-layout-search]');

      if (search === null) throw new Error('missing property search');
      search.value = 'candidate';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      openItemMenu('candidate');

      expect(q('[data-blok-popover-item][data-blok-item-name="pin"]')?.getAttribute('aria-disabled')).toBe('true');
      expect(idsIn('[data-blok-database-drawer-pins]')).toEqual([]);
      expect(idsIn('[data-blok-database-drawer-props]')).toEqual(['candidate']);
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      drawer.destroy();
    });

    it('never offers the details panel for a relation', () => {
      new DatabaseCardDrawer(createOptions()).open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      openItemMenu('p-rel');

      expect(q('[data-blok-popover-item][data-blok-item-name="add-to-panel"]')).toBeNull();
      expect(q('[data-blok-popover-item][data-blok-item-name="add-to-page"]')).not.toBeNull();
    });

    it('adds the first section with every group property in it, then a second, empty one at the top', () => {
      const options = createOptions();

      new DatabaseCardDrawer(options).open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      q('[data-blok-database-layout-add-section]')?.click();
      const name = q<HTMLInputElement>('[data-blok-database-layout-section-name]');

      if (name === null) throw new Error('no section name field');
      name.value = 'Planning';
      name.dispatchEvent(new Event('change'));
      q('[data-blok-database-layout-add-section]')?.click();
      const second = q<HTMLInputElement>('[data-blok-database-layout-section-name]');

      if (second === null) throw new Error('no second section name field');
      second.value = 'Later';
      second.dispatchEvent(new Event('change'));
      openItemMenu('p-due');
      const move = all('[data-blok-popover-item]').find((item) => item.textContent?.includes('Later'));

      move?.click();
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

    it('sets the structure from Page settings and resets to the original layout at once', () => {
      const options = createOptions({ schema: schemaWith({ pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }], pageLayoutSections: [] }) });

      new DatabaseCardDrawer(options).open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      q('[data-blok-database-layout-settings]')?.click();
      clickItem('structure-tabbed');

      expect(q('[data-blok-database-drawer-tabs]')).not.toBeNull();
      q('[data-blok-database-layout-settings]')?.click();
      clickItem('reset');

      expect(written(options, { pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }], pageLayoutStructure: 'tabbed' }))
        .toEqual({ structure: 'simple', groupIn: 'page', propertyIcons: true, propertyLabels: true, templates: true, fullWidth: false, placements: [], sections: [] });
      expect(q('[data-blok-database-drawer-layout-bar]')).toBeNull();
    });

    it('turns property icons off from Page settings as a draft edit', () => {
      const options = createOptions();

      new DatabaseCardDrawer(options).open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      q('[data-blok-database-layout-settings]')?.click();

      expect(q('[data-blok-popover-item][data-blok-item-name="property-icons"] svg')).not.toBeNull();
      clickItem('property-icons');

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
      openItemMenu('p-due');
      clickItem('pin');
      q('[data-blok-database-peek-next]')?.click();

      expect(q('[data-blok-database-drawer-pins] [data-blok-database-drawer-prop-value][data-property-id="p-due"]')?.textContent).toContain('Monday');
      expect(q('[data-blok-database-drawer-layout-bar]')).not.toBeNull();
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
    });

    it('adds a property from the pins row as a draft pin, even with no pins yet', () => {
      const added: PropertyDefinition = { id: 'p-new', name: 'Budget', type: 'number', position: 'a9' };
      const options = createOptions({ onOpenAddProperty: vi.fn() });
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      const add = q<HTMLButtonElement>('[data-blok-database-drawer-pins-row] [data-blok-database-layout-add-pin]');

      expect(add?.disabled).toBe(false);
      add?.click();
      const [anchor, onAdded] = vi.mocked(options.onOpenAddProperty)?.mock.calls[0] ?? [];

      expect(anchor).toBe(add);
      drawer.refreshSchema([...schemaWith(), added]);
      onAdded?.('p-new');

      expect(idsIn('[data-blok-database-drawer-pins]')).toEqual(['p-new']);
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      q('[data-blok-database-layout-apply]')?.click();

      expect(written(options)?.placements).toEqual([{ id: 'p-new', place: 'heading' }]);
    });

    it('pins a property made with the built-in type menu from the pins row only', () => {
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
      q('[data-blok-database-layout-add-pin]')?.click();
      q('[data-blok-database-property-type-option="number"]')?.click();

      expect(idsIn('[data-blok-database-drawer-pins]')).toEqual(['p-new-1']);
      drawer.destroy();
    });

    it('disables Add a property in the pins row at the pin limit, counting pins search hides', () => {
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
      const search = q<HTMLInputElement>('[data-blok-database-layout-search]');

      if (search === null) throw new Error('missing property search');
      search.value = 'candidate';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      expect(q<HTMLButtonElement>('[data-blok-database-layout-add-pin]')?.disabled).toBe(true);
    });

    it('shows Add a property in the pins row only while customizing', () => {
      new DatabaseCardDrawer(createOptions({ schema: schemaWith({ pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }] }) })).open(ROW);

      expect(q('[data-blok-database-drawer-pins]')).not.toBeNull();
      expect(q('[data-blok-database-layout-add-pin]')).toBeNull();
    });

    it('drops the draft when the page closes', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      openItemMenu('p-due');
      clickItem('pin');
      drawer.close();
      drawer.open(ROW);

      expect(q('[data-blok-database-drawer-pins]')).toBeNull();
      expect(q('[data-blok-database-drawer-layout-bar]')).toBeNull();
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
