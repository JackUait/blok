import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IconUndo } from '../../../../src/components/icons';

import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDrawerOptions } from '../../../../src/tools/database/database-card-drawer';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import { getTabbables } from '../../../../src/components/utils/modal-dialog';
import { registerLayer } from '../../../../src/components/utils/dismissable-layer';
import { HINT_DELAY, destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { pageLayoutOf } from '../../../../src/tools/database/page-layout';
import { askLeave } from '../../../../src/components/utils/leave-guards';
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

const BUILDER = '[data-blok-interface="database-layout-builder"]';

const schemaWith = (layout: PageLayoutFields = {}): PropertyDefinition[] => [
  { id: 'p-title', name: 'Title', type: 'title', position: 'a0', ...layout },
  { id: 'p-status', name: 'Status', type: 'text', position: 'a1' },
  { id: 'p-due', name: 'Due', type: 'text', position: 'a2' },
];

const ROW: DatabaseRow = {
  id: 'row-1',
  position: 'a0',
  properties: { 'p-title': 'Card', 'p-status': 'Open', 'p-due': 'Friday' },
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
    onOpenPropertyMenu: vi.fn(),
    onPageLayoutChange: vi.fn(),
    onPageLayoutBirth: vi.fn(),
    ...overrides,
  };
};

const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);

const builder = (): HTMLElement => {
  const el = q(BUILDER);

  if (el === null) throw new Error('no layout builder');

  return el;
};

const written = (options: CardDrawerOptions): PageLayoutData | undefined => {
  const edit = vi.mocked(options.onPageLayoutChange)?.mock.calls.at(-1)?.[0];

  return edit?.(pageLayoutOf({ id: 'p-title', name: 'Title', type: 'title', position: 'a0' }));
};

const clickItem = (name: string): void => {
  const item = q(`[data-blok-popover-item][data-blok-item-name="${name}"]`);

  if (item === null) throw new Error(`no menu item ${name}`);
  item.click();
};

const moduleCard = (kind: 'heading' | 'group' | 'content'): HTMLElement => {
  const el = builder().querySelector<HTMLElement>(`[data-blok-database-layout-module="${kind}"]`);

  if (el === null) throw new Error(`no ${kind} module`);

  return el;
};

const headingMenuButton = (): HTMLElement => {
  const el = moduleCard('heading').querySelector<HTMLElement>('[data-blok-database-layout-module-menu]');

  if (el === null) throw new Error('no Heading module menu button');

  return el;
};

const headingMenu = (): HTMLElement | null => q('[data-blok-testid="database-layout-heading-menu"]');

const pinButton = (id: string): HTMLButtonElement | null => q<HTMLButtonElement>(`[data-blok-testid="database-layout-pin-${id}"]`);

/** Pins from the Heading menu's pin button, then closes the menu. */
const pinDue = (): void => {
  if (headingMenu() === null) headingMenuButton().click();
  pinButton('p-due')?.click();
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
};

const customize = (overrides: Partial<CardDrawerOptions> = {}): { drawer: DatabaseCardDrawer; options: CardDrawerOptions } => {
  const options = createOptions(overrides);
  const drawer = new DatabaseCardDrawer(options);

  drawer.open(ROW);
  q('[data-blok-database-drawer-customize]')?.click();

  return { drawer, options };
};

describe('PageLayoutBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  // research/09 §1: a full-window takeover, not a bar inside the peek.
  it('opens full window over the page, outside the drawer, and closes on Apply', () => {
    const { drawer, options } = customize();
    const el = builder();

    expect(el.parentElement).toBe(document.body);
    expect(el.closest('[data-blok-database-drawer]')).toBeNull();
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-modal')).toBe('true');
    expect(el.getAttribute('aria-label')).toBe('Customize page layout');
    expect(q('[data-blok-database-drawer-layout-bar]')).toBeNull();

    const canvas = el.querySelector('[data-blok-database-layout-canvas]');

    expect(canvas?.querySelector('[data-blok-database-layout-canvas-title]')?.textContent).toBe('Card');
    expect(canvas?.querySelector('[data-blok-database-drawer-prop-value][data-property-id="p-due"]')).not.toBeNull();
    expect(q('[data-blok-database-drawer] [data-blok-database-drawer-props]')).toBeNull();

    pinDue();
    el.querySelector<HTMLElement>('[data-blok-database-layout-apply]')?.click();

    expect(q(BUILDER)).toBeNull();
    expect(written(options)?.placements).toEqual([{ id: 'p-due', place: 'heading' }]);
    // The host writes the layout; the regions are back in the page.
    expect(q('[data-blok-database-drawer] [data-blok-database-drawer-props]')).not.toBeNull();
    drawer.destroy();
  });

  it('shows the database title in the top bar', () => {
    const { drawer } = customize({ databaseTitle: () => 'Projects' });

    expect(builder().querySelector('[data-blok-database-layout-title]')?.textContent).toBe('Projects');
    drawer.destroy();
  });

  // The host refreshes the drawer when the database's data changes, e.g. a collaborator renames it.
  it('follows a database rename while open', () => {
    const name = { value: 'Projects' };
    const { drawer } = customize({ databaseTitle: () => name.value });

    name.value = 'Roadmap';
    drawer.refreshSchema(schemaWith());

    expect(builder().querySelector('[data-blok-database-layout-title]')?.textContent).toBe('Roadmap');
    name.value = '';
    drawer.refreshSchema(schemaWith());

    expect(builder().querySelector('[data-blok-database-layout-title]')?.textContent).toBe('New database');
    drawer.destroy();
  });

  // research/10 §9: Preview → Cancel → Apply → More save options.
  it('puts Preview, Cancel, Apply and More save options in that tab order', () => {
    const { drawer } = customize();
    const order = getTabbables(builder()).slice(0, 4);

    expect(order.map((el) => el.textContent?.trim() || el.getAttribute('aria-label'))).toEqual(['Preview: Card', 'Cancel', 'Apply to all pages', 'More save options']);
    drawer.destroy();
  });

  describe('Preview switch', () => {
    const SECOND: DatabaseRow = { id: 'row-2', position: 'a1', properties: { 'p-title': 'Second', 'p-status': 'Done', 'p-due': '' } };
    const previewButton = (): HTMLElement | null => builder().querySelector<HTMLElement>('[data-blok-database-layout-preview]');
    const pageItem = (id: string): HTMLElement | null => q(`[data-blok-popover-item][data-blok-item-name="preview-${id}"]`);

    // research/09 §2: switching swaps the canvas; unapplied edits survive.
    it('previews the chosen page from the Preview switch and keeps the draft', () => {
      const { drawer, options } = customize({ viewRows: () => [ROW, SECOND] });

      pinDue();
      previewButton()?.click();
      pageItem('row-2')?.click();

      expect(previewButton()?.textContent?.trim()).toBe('Preview: Second');
      expect(builder().querySelector('[data-blok-database-layout-canvas-title]')?.textContent).toBe('Second');
      expect(builder().querySelector('[data-blok-database-drawer-pins] [data-property-id="p-due"]')).not.toBeNull();
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      drawer.destroy();
    });

    // Q4: view order, not Notion's single newest-first sample.
    it('lists every page in view order, in a menu with a focused Search pages… field', async () => {
      const { drawer } = customize({ viewRows: () => [SECOND, ROW] });

      previewButton()?.click();
      // The popover focuses its search field in a microtask.
      await Promise.resolve();
      const items = [...document.querySelectorAll<HTMLElement>('[data-blok-popover-item][data-blok-item-name^="preview-"]')];
      const search = q<HTMLInputElement>('[data-blok-popover-opened] input');

      expect(items.map((item) => item.textContent?.trim())).toEqual(['Second', 'Card']);
      expect(search?.placeholder).toBe('Search pages…');
      expect(search).toHaveFocus();
      drawer.destroy();
    });

    it('searches pages in the Preview switch', () => {
      const { drawer } = customize({ viewRows: () => [ROW, SECOND] });

      previewButton()?.click();
      const search = q<HTMLInputElement>('[data-blok-popover-opened] input');

      if (search === null) throw new Error('no search field');
      search.value = 'sec';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      expect(pageItem('row-1')?.hasAttribute('data-blok-hidden')).toBe(true);
      expect(pageItem('row-2')?.hasAttribute('data-blok-hidden')).toBe(false);
      drawer.destroy();
    });

    // No blue selected states: a checkmark on a neutral row.
    it('marks the previewed page with a check and no fill', () => {
      const { drawer } = customize({ viewRows: () => [ROW, SECOND] });

      previewButton()?.click();

      const check = 'M4.5 10.25l3.5 3.5 7.5-7.5';

      expect(pageItem('row-1')?.innerHTML).toContain(check);
      expect(pageItem('row-1')?.hasAttribute('data-blok-popover-item-active')).toBe(false);
      expect(pageItem('row-2')?.innerHTML).not.toContain(check);
      drawer.destroy();
    });

    it('follows a rename of the previewed page', () => {
      const { drawer } = customize({ viewRows: () => [ROW] });

      drawer.syncOpenRow({ ...ROW, properties: { ...ROW.properties, 'p-title': 'Renamed' } });

      expect(previewButton()?.textContent?.trim()).toBe('Preview: Renamed');
      drawer.destroy();
    });
  });

  // research/09 §1: with zero rows the builder still opens, on a "New page" placeholder.
  describe('with no rows', () => {
    const customizeNewPage = (overrides: Partial<CardDrawerOptions> = {}): { drawer: DatabaseCardDrawer; options: CardDrawerOptions } => {
      const options = createOptions({ viewRows: () => [], ...overrides });
      const drawer = new DatabaseCardDrawer(options);

      drawer.customizeNewPage();

      return { drawer, options };
    };

    it('opens on a New page placeholder when the database has no rows', () => {
      const { drawer, options } = customizeNewPage();
      const title = builder().querySelector('[data-blok-database-layout-canvas-title]');

      expect(title?.textContent).toBe('New page');
      expect(title?.hasAttribute('data-placeholder')).toBe(true);
      expect(builder().querySelector('[data-blok-database-layout-preview]')?.textContent?.trim()).toBe('Preview: New page');
      expect(builder().querySelector('[data-blok-database-layout-canvas-content]')?.textContent).toBe('Empty');
      expect(drawer.isOpen).toBe(false);
      expect(options.wrapper.querySelector('[data-blok-database-drawer]')).toBeNull();
      drawer.destroy();
    });

    it('keeps the placeholder values read-only', () => {
      const { drawer, options } = customizeNewPage();
      const value = builder().querySelector<HTMLElement>('[data-blok-database-drawer-prop-value][data-property-id="p-due"]');

      expect(value).not.toBeNull();
      expect(value?.getAttribute('role')).toBeNull();
      value?.click();

      // The click opens the Property group menu (research/10 §8), never a value editor.
      expect(q('[data-blok-database-cell-editor]:not([data-blok-database-panel])')).toBeNull();
      expect(options.onPropertyValueChange).not.toHaveBeenCalled();
      drawer.destroy();
    });

    it('reads No results. in the Preview switch', () => {
      const { drawer } = customizeNewPage();

      builder().querySelector<HTMLElement>('[data-blok-database-layout-preview]')?.click();

      expect(q('[data-blok-popover-opened]')?.textContent).toContain('No results.');
      expect(document.querySelectorAll('[data-blok-popover-item][data-blok-item-name^="preview-"]')).toHaveLength(0);
      drawer.destroy();
    });

    it('applies the layout and leaves no page open', () => {
      const { drawer, options } = customizeNewPage();

      pinDue();
      builder().querySelector<HTMLElement>('[data-blok-database-layout-apply]')?.click();

      expect(written(options)?.placements).toEqual([{ id: 'p-due', place: 'heading' }]);
      expect(q(BUILDER)).toBeNull();
      expect(drawer.isOpen).toBe(false);
      expect(options.wrapper.querySelector('[data-blok-database-drawer]')).toBeNull();
      drawer.destroy();
    });

    it('reads Empty for a property group with no properties', () => {
      const { drawer } = customizeNewPage({ schema: [{ id: 'p-title', name: 'Title', type: 'title', position: 'a0' }] });

      expect(builder().querySelector('[data-blok-database-layout-group-empty]')?.textContent).toBe('Empty');
      drawer.destroy();
    });
  });

  // The editor's document keydown turns Tab into block navigation; inside the builder Tab must move focus.
  it('owns its keyboard, so the editor stands down inside it', () => {
    const { drawer } = customize();

    expect(builder().hasAttribute('data-blok-keyboard-owner')).toBe(true);
    drawer.destroy();
  });

  it('keeps Tab inside the builder and returns focus to the opener on close', () => {
    const options = createOptions();
    const drawer = new DatabaseCardDrawer(options);

    drawer.open(ROW);
    const opener = q<HTMLButtonElement>('[data-blok-database-drawer-customize]');

    opener?.focus();
    opener?.click();
    const tabbables = getTabbables(builder());
    const first = tabbables[0];
    const last = tabbables[tabbables.length - 1];

    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));

    expect(first).toHaveFocus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));

    expect(last).toHaveFocus();
    q('[data-blok-database-layout-cancel]')?.click();

    expect(q(BUILDER)).toBeNull();
    expect(opener).toHaveFocus();
    drawer.destroy();
  });

  it.each(['ltr', 'rtl'] as const)('follows the editor\'s direction (%s)', (dir) => {
    const options = createOptions();

    options.wrapper.setAttribute('dir', dir);
    const drawer = new DatabaseCardDrawer(options);

    drawer.open(ROW);
    q('[data-blok-database-drawer-customize]')?.click();

    expect(builder().getAttribute('dir')).toBe(dir);
    drawer.destroy();
  });

  // The live property menu writes pageVisibility at once and would skip the draft.
  it('does not open the live property menu from a canvas label while customizing', () => {
    const { drawer, options } = customize();
    const label = builder().querySelector<HTMLElement>('[data-blok-database-drawer-prop-label][data-property-id="p-due"]');

    expect(label?.getAttribute('role')).toBeNull();
    label?.click();

    expect(options.onOpenPropertyMenu).not.toHaveBeenCalled();
    drawer.destroy();
  });

  // research/09 §1b: the row page property menu ends with "Customize layout", which previews that page.
  it('hands the row page property menu a Customize layout that opens the builder on this page', () => {
    const options = createOptions();
    const drawer = new DatabaseCardDrawer(options);

    drawer.open(ROW);
    q('[data-blok-database-drawer-prop-label][data-property-id="p-due"]')?.click();
    const customizeLayout = vi.mocked(options.onOpenPropertyMenu)?.mock.calls.at(-1)?.[2];

    expect(customizeLayout).toBeTypeOf('function');
    customizeLayout?.();

    expect(builder().querySelector('[data-blok-database-layout-preview]')?.textContent?.trim()).toBe('Preview: Card');
    drawer.destroy();
  });

  it('offers no Customize layout from the property menu of a locked database', () => {
    const options = createOptions({ databaseLocked: () => true });
    const drawer = new DatabaseCardDrawer(options);

    drawer.open(ROW);
    q('[data-blok-database-drawer-prop-label][data-property-id="p-due"]')?.click();

    expect(options.onOpenPropertyMenu).toHaveBeenCalled();
    expect(vi.mocked(options.onOpenPropertyMenu)?.mock.calls.at(-1)?.[2]).toBeUndefined();
    drawer.destroy();
  });

  // research/10 §9: Escape never closes the builder.
  it('keeps the builder and its draft on Escape', () => {
    const { drawer, options } = customize({ onEscapeClose: vi.fn() });

    pinDue();
    builder().querySelector<HTMLElement>('[data-blok-database-layout-apply]')?.focus();
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(q(BUILDER)).not.toBeNull();
    expect(builder().querySelector('[data-blok-database-drawer-pins] [data-property-id="p-due"]')).not.toBeNull();
    expect(options.onEscapeClose).not.toHaveBeenCalled();
    drawer.destroy();
  });

  // A toast sits below the builder in the layer stack. One Escape peels one layer, and never one below the builder.
  describe('Escape with a toast showing', () => {
    const showToast = (): { onDismiss: ReturnType<typeof vi.fn>; unregister: () => void } => {
      const toast = document.createElement('div');
      const onDismiss = vi.fn();

      document.body.appendChild(toast);

      return { onDismiss, unregister: registerLayer({ element: toast, onDismiss, escape: true, outside: false }) };
    };
    const pressEscape = (): void => {
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    };

    it.each([
      ['More save options', () => builder().querySelector<HTMLElement>('[data-blok-database-layout-more-save]')?.click(), 'reset'],
      ['the Preview switch', () => builder().querySelector<HTMLElement>('[data-blok-database-layout-preview]')?.click(), 'preview-row-1'],
    ])('closes %s and leaves the toast and the builder', (_name, openMenu, item) => {
      const toast = showToast();
      const { drawer } = customize();

      openMenu();
      expect(q(`[data-blok-popover-item][data-blok-item-name="${item}"]`)).not.toBeNull();
      pressEscape();

      expect(toast.onDismiss).not.toHaveBeenCalled();
      expect(PopoverRegistry.instance.topmostTrigger()).toBeNull();
      expect(q(`[data-blok-popover-item][data-blok-item-name="${item}"]`)).toBeNull();
      expect(q(BUILDER)).not.toBeNull();
      toast.unregister();
      drawer.destroy();
    });

    it('does nothing with no menu open', () => {
      const toast = showToast();
      const { drawer } = customize();

      pinDue();
      builder().querySelector<HTMLElement>('[data-blok-database-layout-apply]')?.focus();
      pressEscape();

      expect(toast.onDismiss).not.toHaveBeenCalled();
      expect(q(BUILDER)).not.toBeNull();
      expect(builder().querySelector('[data-blok-database-drawer-pins] [data-property-id="p-due"]')).not.toBeNull();
      toast.unregister();
      drawer.destroy();
    });
  });

  // research/10 §5: the chevron half of Apply holds Reset.
  it('holds Reset to original page layout in More save options', () => {
    const { drawer } = customize();
    const more = builder().querySelector<HTMLElement>('[data-blok-database-layout-more-save]');

    expect(more?.getAttribute('aria-label')).toBe('More save options');
    more?.click();
    const reset = q('[data-blok-popover-item][data-blok-item-name="reset"]');

    expect(reset?.textContent).toContain('Reset to original page layout');
    expect(reset?.textContent).toContain('No properties will be deleted');
    drawer.destroy();
  });

  // research/10 §5: a confirm, then Reset applies at once and closes the builder.
  describe('Reset to original page layout', () => {
    const settle = (): Promise<void> => new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    const askReset = (): void => {
      builder().querySelector<HTMLElement>('[data-blok-database-layout-more-save]')?.click();
      clickItem('reset');
    };
    const answer = async (name: 'confirm' | 'cancel'): Promise<void> => {
      q(`[data-blok-database-confirm-action="${name}"]`)?.click();
      await settle();
    };
    /** The written edit, replayed on the layout the schema saved. */
    const savedAfter = (options: CardDrawerOptions): PageLayoutData | undefined =>
      vi.mocked(options.onPageLayoutChange)?.mock.calls.at(-1)?.[0]?.(pageLayoutOf(options.schema[0]));
    const SHAPED = (): PropertyDefinition[] => [
      ...schemaWith({
        pageLayoutStructure: 'tabbed',
        pageLayoutPropertyLabels: false,
        pageLayoutTemplates: false,
        pageLayoutSections: [{ id: 's1', name: 'More' }],
        pageLayoutPlacements: [{ id: 'p-notes', place: 'section', sectionId: 's1' }, { id: 'p-due', place: 'heading' }, { id: 'p-status', place: 'section', sectionId: 's1' }],
      }),
      { id: 'p-notes', name: 'Notes', type: 'text', position: 'a3' },
    ];

    it('asks before resetting and resets nothing on Cancel', async () => {
      const { drawer, options } = customize({ schema: SHAPED() });

      askReset();
      const dialog = builder().querySelector('[data-blok-database-confirm-dialog]');

      expect(dialog?.querySelector('[data-blok-database-confirm-title]')?.textContent).toBe('Reset to original page layout?');
      expect(dialog?.querySelector('[data-blok-database-confirm-description]')?.textContent).toBe('No properties will be deleted.');
      expect(dialog?.querySelector('[data-blok-database-confirm-action="confirm"]')?.textContent).toBe('Reset');
      expect(dialog?.querySelector('[data-blok-database-confirm-action="confirm"]')?.hasAttribute('data-destructive')).toBe(true);
      expect(dialog?.querySelector('[data-blok-database-confirm-action="confirm"]')?.hasAttribute('data-filled')).toBe(true);
      expect(dialog?.querySelector('[data-blok-database-confirm-action="cancel"]')?.textContent).toBe('Cancel');
      // research/10 §5: a U-turn glyph on top, a × at the top right, a 17px title, a grey borderless Cancel.
      const undo = document.createElement('div');

      undo.innerHTML = IconUndo;
      expect(dialog?.querySelector('[data-blok-database-confirm-art]')?.innerHTML).toBe(undo.innerHTML);
      expect(dialog?.querySelector('[data-blok-database-confirm-close]')?.getAttribute('aria-label')).toBe('Close');
      expect(dialog?.hasAttribute('data-large-title')).toBe(true);
      // research/36 §8.2: the 300px box with the 22px × and the 32px icon.
      expect(dialog?.hasAttribute('data-small')).toBe(true);
      expect(dialog?.querySelector('[data-blok-database-confirm-action="cancel"]')?.hasAttribute('data-quiet')).toBe(true);
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      await answer('cancel');

      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      expect(q('[data-blok-database-confirm-dialog]')).toBeNull();
      expect(q(BUILDER)).not.toBeNull();
      drawer.destroy();
    });

    it('resets nothing when the × closes the question', async () => {
      const { drawer, options } = customize({ schema: SHAPED() });

      askReset();
      q('[data-blok-database-confirm-close]')?.click();
      await settle();

      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      expect(q('[data-blok-database-confirm-dialog]')).toBeNull();
      expect(q(BUILDER)).not.toBeNull();
      drawer.destroy();
    });

    it('resets to Simple with no pins, sections or labels, templates back on, and closes the builder', async () => {
      const { drawer, options } = customize({ schema: SHAPED() });

      askReset();
      await answer('confirm');

      expect(options.onPageLayoutChange).toHaveBeenCalledTimes(1);
      expect(savedAfter(options)).toMatchObject({ structure: 'simple', groupIn: 'page', propertyLabels: true, templates: true, sections: [] });
      expect(savedAfter(options)?.placements.every((p) => p.place === 'group')).toBe(true);
      expect(q(BUILDER)).toBeNull();
      drawer.destroy();
    });

    it('keeps properties made in this session on Reset', async () => {
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
      headingMenuButton().click();
      q('[data-blok-testid="database-layout-heading-menu"] [data-blok-database-layout-add-pin]')?.click();
      q('[data-blok-database-property-type-option="number"]')?.click();

      expect(added).toHaveLength(1);
      askReset();
      await answer('confirm');

      expect(options.onDeleteProperty).not.toHaveBeenCalled();
      // The pin made this session counts as an old pin: the canvas showed it.
      expect(savedAfter(options)?.placements).toEqual([{ id: 'p-new-0', place: 'group' }]);
      expect(q(BUILDER)).toBeNull();
      drawer.destroy();
    });

    // research/10 §5 L166: not schema order, not table column order.
    it('orders the group by the old pins, then the old sections, after Reset', async () => {
      const { drawer, options } = customize({ schema: SHAPED() });

      askReset();
      await answer('confirm');

      expect(savedAfter(options)?.placements).toEqual([
        { id: 'p-due', place: 'group' },
        { id: 'p-notes', place: 'group' },
        { id: 'p-status', place: 'group' },
      ]);
      drawer.destroy();
    });
  });

  describe('Page settings column', () => {
    const column = (): HTMLElement => {
      const el = builder().querySelector<HTMLElement>('[data-blok-database-layout-settings-column]');

      if (el === null) throw new Error('no Page settings column');

      return el;
    };
    const cards = (): HTMLElement[] => [...column().querySelectorAll<HTMLElement>('[data-blok-database-layout-structure-card]')];
    const switches = (): HTMLElement[] => [...column().querySelectorAll<HTMLElement>('[role="switch"]')];
    const switchNamed = (name: string): HTMLElement => {
      const found = switches().find((el) => el.textContent?.trim() === name);

      if (found === undefined) throw new Error(`no ${name} switch`);

      return found;
    };

    // research/09 §10: a fixed column, always visible, titled "Page settings".
    it('shows Page settings as a column, not a menu, with no Reset in it', () => {
      const { drawer } = customize();

      expect(column().querySelector('[data-blok-database-layout-settings-title]')?.textContent).toBe('Page settings');
      expect(builder().querySelector('[data-blok-database-layout-settings]')).toBeNull();
      expect(column().textContent).not.toContain('Reset');
      drawer.destroy();
    });

    // research/10 §2: two cards, Simple (default) and Tabbed.
    it('sets Simple or Tabbed from the Structure cards as a draft edit', () => {
      const { drawer, options } = customize();

      expect(column().querySelector('[data-blok-database-layout-structure]')?.getAttribute('aria-label')).toBe('Structure');
      expect(cards().map((card) => [card.textContent?.trim(), card.getAttribute('aria-pressed')])).toEqual([['Simple', 'true'], ['Tabbed', 'false']]);
      cards()[1].focus();
      cards()[1].click();

      expect(cards().map((card) => card.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
      expect(cards()[1]).toHaveFocus();
      expect(builder().querySelector('[data-blok-database-drawer-tabs]')).not.toBeNull();
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      builder().querySelector<HTMLElement>('[data-blok-database-layout-apply]')?.click();

      expect(written(options)?.structure).toBe('tabbed');
      drawer.destroy();
    });

    // research/09 anatomy L41-43: Property icons ON, Full width OFF, Database templates ON; 30x18 role=switch.
    it('turns Property icons, Full width and Database templates on and off as draft edits, with switches', () => {
      const { drawer, options } = customize();

      expect(column().querySelector('[data-blok-database-layout-options-title]')?.textContent).toBe('Options');
      expect(switches().map((el) => [el.textContent?.trim(), el.getAttribute('aria-checked')])).toEqual([
        ['Property icons', 'true'],
        ['Full width', 'false'],
        ['Database templates', 'true'],
      ]);
      const fullWidth = switchNamed('Full width');

      fullWidth.focus();
      fullWidth.click();
      expect(switchNamed('Full width').getAttribute('aria-checked')).toBe('true');
      // An edit redraws the page; the switch under the caret must keep focus.
      expect(fullWidth).toHaveFocus();
      switchNamed('Property icons').click();
      expect(builder().querySelector('[data-blok-database-drawer-prop-icon]')).toBeNull();
      switchNamed('Database templates').click();
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      builder().querySelector<HTMLElement>('[data-blok-database-layout-apply]')?.click();

      expect(written(options)).toMatchObject({ propertyIcons: false, fullWidth: true, templates: false });
      drawer.destroy();
    });

    it('drops a switch edit that is turned back', () => {
      const { drawer, options } = customize();

      switchNamed('Full width').click();
      switchNamed('Full width').click();
      builder().querySelector<HTMLElement>('[data-blok-database-layout-apply]')?.click();

      expect(written(options)?.fullWidth).toBe(false);
      drawer.destroy();
    });

    it('shows the saved layout in the column', () => {
      const { drawer } = customize({ schema: schemaWith({ pageLayoutStructure: 'tabbed', pageLayoutFullWidth: true, pageLayoutTemplates: false, pageLayoutPropertyIcons: false }) });

      expect(cards().map((card) => card.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
      expect(switches().map((el) => el.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
      drawer.destroy();
    });

    // plan Phase 5b: the place choice and the property search moved into the Property group menu.
    it('holds no group place choice and no property search', () => {
      const { drawer } = customize();

      expect(column().querySelector('[data-blok-database-layout-group-in]')).toBeNull();
      expect(builder().querySelector('[data-blok-database-layout-search]')).toBeNull();
      expect(column().textContent).not.toContain('Properties in the');
      drawer.destroy();
    });

    describe('hints', () => {
      beforeEach(() => {
        // Earlier tests empty body, which detaches the shared tooltip's node.
        destroyTooltip();
        vi.useFakeTimers();
      });

      afterEach(() => {
        destroyTooltip();
        vi.useRealTimers();
      });

      const shownHint = (): string | null => {
        const wrapper = q('[data-blok-testid="tooltip"]');

        return wrapper?.getAttribute('data-blok-shown') === 'true' ? (q('[data-blok-testid="tooltip-content"]')?.textContent ?? '') : null;
      };

      it.each([
        ['Full width', 'Page width can be overwritten on individual pages.'],
        ['Database templates', 'If enabled, empty pages will show the template picker.'],
      ])('shows the %s hint only after a hover delay, never on focus', (name, hint) => {
        const { drawer } = customize();
        const row = switchNamed(name).closest('[data-blok-database-layout-option]');
        const info = row?.querySelector<HTMLElement>('[data-blok-database-layout-hint]');

        if (info === null || info === undefined) throw new Error(`no ${name} hint`);
        switchNamed(name).focus();
        switchNamed(name).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        info.dispatchEvent(new FocusEvent('focus'));
        vi.advanceTimersByTime(HINT_DELAY);
        expect(shownHint()).toBeNull();

        info.dispatchEvent(new MouseEvent('mouseenter'));
        vi.advanceTimersByTime(HINT_DELAY - 1);
        expect(shownHint()).toBeNull();
        vi.advanceTimersByTime(1);

        expect(shownHint()).toBe(hint);
        // The hint is a hover target only, so keyboard users get it from the switch.
        const describedBy = switchNamed(name).getAttribute('aria-describedby') ?? '';

        expect(document.getElementById(describedBy)?.textContent).toBe(hint);
        drawer.destroy();
      });

      it('has no hint on Property icons', () => {
        const { drawer } = customize();

        expect(switchNamed('Property icons').closest('[data-blok-database-layout-option]')?.querySelector('[data-blok-database-layout-hint]')).toBeNull();
        drawer.destroy();
      });
    });
  });

  // research/09 anatomy L39, research/10 §8: the canvas holds module cards, each with a header strip.
  describe('Heading module menu', () => {
    const PINNED = schemaWith({ pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }] });
    const rowsIn = (list: 'pinned' | 'unpinned'): string[] =>
      [...(headingMenu()?.querySelectorAll<HTMLElement>(`[data-blok-database-layout-pin-list="${list}"] [data-blok-database-layout-pin-row]`) ?? [])]
        .filter((row) => !row.hidden)
        .map((row) => row.getAttribute('data-property-id') ?? '');
    const canvasPins = (): string[] =>
      [...builder().querySelectorAll<HTMLElement>('[data-blok-database-drawer-pins] [data-blok-database-drawer-prop-value]')].map((el) => el.getAttribute('data-property-id') ?? '');
    const groupIds = (): string[] =>
      [...builder().querySelectorAll<HTMLElement>('[data-blok-database-drawer-props] [data-blok-database-drawer-prop-value]')].map((el) => el.getAttribute('data-property-id') ?? '');

    // research/09 §3, research/10 §7: header, focused search, two lists, a pin button per row.
    it('lists pinned and unpinned properties in the Heading menu with a pin button each', () => {
      const { drawer } = customize({ schema: PINNED });

      expect([...builder().querySelectorAll('[data-blok-database-layout-module]')].map((el) => el.getAttribute('data-blok-database-layout-module')))
        .toEqual(['heading', 'group', 'content']);
      expect([...builder().querySelectorAll('[data-blok-database-layout-module-name]')].map((el) => el.textContent)).toEqual(['Heading', 'Property group', 'Content']);
      expect(headingMenuButton().getAttribute('aria-label')).toBe('Action menu for module');
      headingMenuButton().click();
      const menu = headingMenu();

      expect(menu?.querySelector('[data-blok-database-panel-header]')?.textContent).toBe('Heading');
      const search = menu?.querySelector<HTMLInputElement>('[data-blok-testid="database-layout-heading-search"]');

      expect(search?.placeholder).toBe('Search properties…');
      expect(search).toHaveFocus();
      expect([...(menu?.querySelectorAll('[data-blok-database-panel-section]') ?? [])].map((el) => el.textContent))
        .toEqual(['Pinned properties', 'Unpinned properties', 'Options']);
      expect(rowsIn('pinned')).toEqual(['p-due']);
      expect(rowsIn('unpinned')).toEqual(['p-status']);
      expect(pinButton('p-due')?.getAttribute('aria-label')).toBe('Do not show Due as pinned');
      expect(pinButton('p-status')?.getAttribute('aria-label')).toBe('Show Status as pinned');
      expect(pinButton('p-due')?.hasAttribute('data-pinned')).toBe(true);
      expect(pinButton('p-status')?.hasAttribute('data-pinned')).toBe(false);
      if (search === null || search === undefined) throw new Error('no property search');
      search.value = 'sta';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      expect(rowsIn('pinned')).toEqual([]);
      expect(rowsIn('unpinned')).toEqual(['p-status']);
      expect(search).toHaveFocus();
      drawer.destroy();
    });

    // research/09 §3: a pin moves the row between the lists at once; the canvas follows.
    it('pins and unpins at once from the pin button, and the canvas follows', () => {
      const { drawer, options } = customize();

      headingMenuButton().click();
      pinButton('p-status')?.focus();
      pinButton('p-status')?.click();

      expect(rowsIn('pinned')).toEqual(['p-status']);
      expect(rowsIn('unpinned')).toEqual(['p-due']);
      expect(pinButton('p-status')).toHaveFocus();
      expect(pinButton('p-status')?.getAttribute('aria-label')).toBe('Do not show Status as pinned');
      expect(canvasPins()).toEqual(['p-status']);
      expect(groupIds()).toEqual(['p-due']);
      pinButton('p-due')?.click();
      pinButton('p-status')?.click();

      expect(rowsIn('pinned')).toEqual(['p-due']);
      expect(canvasPins()).toEqual(['p-due']);
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      builder().querySelector<HTMLElement>('[data-blok-database-layout-apply]')?.click();

      expect(written(options)?.placements).toEqual([{ id: 'p-due', place: 'heading' }]);
      expect(headingMenu()).toBeNull();
      drawer.destroy();
    });

    it('disables the pin buttons of unpinned rows at the pin limit, even when search hides the pins', () => {
      const many: PropertyDefinition[] = Array.from({ length: 16 }, (_, i) =>
        ({ id: `x${i}`, name: `X${i}`, type: 'text' as const, position: `b${String(i).padStart(2, '0')}` }));
      const { drawer } = customize({
        schema: [
          { id: 'p-title', name: 'Title', type: 'title', position: 'a0', pageLayoutPlacements: many.slice(0, 15).map((p) => ({ id: p.id, place: 'heading' as const })) },
          ...many,
        ],
      });

      headingMenuButton().click();
      const search = headingMenu()?.querySelector<HTMLInputElement>('[data-blok-testid="database-layout-heading-search"]');

      if (search === null || search === undefined) throw new Error('no property search');
      search.value = 'x15';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      expect(pinButton('x15')?.disabled).toBe(true);
      expect(pinButton('x0')?.disabled).toBe(false);
      expect(headingMenu()?.querySelector<HTMLButtonElement>('[data-blok-database-layout-add-pin]')?.disabled).toBe(true);
      drawer.destroy();
    });

    // research/10 §7: the new property lands pinned, first in the Pinned list, never in the group.
    it('adds a property from the Pinned list first among pins, never in the group', () => {
      const options = createOptions({ schema: PINNED, onOpenAddProperty: vi.fn() });
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(ROW);
      q('[data-blok-database-drawer-customize]')?.click();
      headingMenuButton().click();
      const add = headingMenu()?.querySelector<HTMLButtonElement>('[data-blok-database-layout-add-pin]');

      expect(add?.textContent).toBe('+ Add a property');
      add?.click();
      const [anchor, onAdded] = vi.mocked(options.onOpenAddProperty)?.mock.calls[0] ?? [];

      expect(headingMenu()).toBeNull();
      expect(anchor).toBe(headingMenuButton());
      drawer.refreshSchema([...PINNED, { id: 'p-new', name: 'Budget', type: 'number', position: 'a9' }]);
      onAdded?.('p-new');

      expect(canvasPins()).toEqual(['p-new', 'p-due']);
      expect(groupIds()).not.toContain('p-new');
      builder().querySelector<HTMLElement>('[data-blok-database-layout-apply]')?.click();

      const edit = vi.mocked(options.onPageLayoutChange)?.mock.calls.at(-1)?.[0];

      expect(edit?.(pageLayoutOf(PINNED[0])).placements).toEqual([{ id: 'p-new', place: 'heading' }, { id: 'p-due', place: 'heading' }]);
      drawer.destroy();
    });

    // research/10 §7: "Options > Property labels", ON, present with zero pins. Its rendering is plan Phase 7.
    it('turns Property labels off from the Heading menu as a draft edit', () => {
      const { drawer, options } = customize();

      headingMenuButton().click();
      const labels = headingMenu()?.querySelector<HTMLElement>('[role="switch"]');

      expect(labels?.textContent?.trim()).toBe('Property labels');
      expect(labels?.getAttribute('aria-checked')).toBe('true');
      labels?.click();

      expect(headingMenu()?.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      builder().querySelector<HTMLElement>('[data-blok-database-layout-apply]')?.click();

      expect(written(options)?.propertyLabels).toBe(false);
      drawer.destroy();
    });

    // research/10 §8: a click anywhere in a module selects it and opens its menu.
    it('selects a module and opens its menu on a click anywhere in it', () => {
      const { drawer } = customize({ schema: PINNED });

      builder().querySelector<HTMLElement>('[data-blok-database-layout-canvas-title]')?.click();

      expect(moduleCard('heading').hasAttribute('data-selected')).toBe(true);
      expect(headingMenu()).not.toBeNull();
      headingMenuButton().click();

      // The ••• click inside the card toggles once, not twice.
      expect(headingMenu()).toBeNull();
      moduleCard('group').click();

      expect(moduleCard('group').hasAttribute('data-selected')).toBe(true);
      expect(moduleCard('heading').hasAttribute('data-selected')).toBe(false);
      // A control inside a module keeps its own click.
      builder().querySelector<HTMLElement>('[data-blok-database-drawer-pin] [data-blok-database-drawer-prop-value][data-property-id="p-due"]')?.click();

      expect(headingMenu()).toBeNull();
      expect(moduleCard('heading').hasAttribute('data-selected')).toBe(false);
      drawer.destroy();
    });

    // research/10 §4: with labels off there is no label to grab, so the pin itself drags.
    it('drags a label-less pin before another', () => {
      const { drawer, options } = customize({
        schema: schemaWith({ pageLayoutPropertyLabels: false, pageLayoutPlacements: [{ id: 'p-status', place: 'heading' }, { id: 'p-due', place: 'heading' }] }),
      });
      const pins = [...builder().querySelectorAll<HTMLElement>('[data-blok-database-drawer-pin]')];
      const boxes = new Map<Element, { left: number; right: number }>(pins.map((el, i) => [el, { left: i * 100, right: i * 100 + 100 }]));

      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
        const { left, right } = boxes.get(this) ?? { left: 0, right: 0 };
        const box = { top: 0, bottom: 30, left, right, width: right - left, height: 30 };

        return { ...box, x: left, y: 0, toJSON: () => box };
      });
      expect(canvasPins()).toEqual(['p-status', 'p-due']);
      pins[1]?.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 150, clientY: 10, bubbles: true, cancelable: true }));
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 10, bubbles: true }));
      document.dispatchEvent(new MouseEvent('pointerup', { clientX: 10, clientY: 10, bubbles: true }));
      // The click a browser sends after the drag; the builder swallows it.
      moduleCard('heading').click();

      expect(canvasPins()).toEqual(['p-due', 'p-status']);
      builder().querySelector<HTMLElement>('[data-blok-database-layout-apply]')?.click();

      const edit = vi.mocked(options.onPageLayoutChange)?.mock.calls.at(-1)?.[0];

      expect(edit?.(pageLayoutOf(options.schema[0]))?.placements).toEqual([{ id: 'p-due', place: 'heading' }, { id: 'p-status', place: 'heading' }]);
      drawer.destroy();
    });

  });

  // research/09 §3 L56, §5: header + Add section, search, a row per property with an eye, Add a property, Move to panel.
  describe('Property group module menu', () => {
    const NOTES: PropertyDefinition = { id: 'p-notes', name: 'Notes', type: 'text', position: 'a3' };
    const groupMenuButton = (): HTMLElement => {
      const el = moduleCard('group').querySelector<HTMLElement>('[data-blok-database-layout-module-menu]');

      if (el === null) throw new Error('no Property group module menu button');

      return el;
    };
    const groupMenu = (): HTMLElement | null => q('[data-blok-testid="database-layout-group-menu"]');
    const openGroupMenu = (): HTMLElement => {
      if (groupMenu() === null) groupMenuButton().click();
      const menu = groupMenu();

      if (menu === null) throw new Error('no Property group menu');

      return menu;
    };
    const menuRows = (): string[] =>
      [...openGroupMenu().querySelectorAll<HTMLElement>('[data-blok-database-layout-group-row]')]
        .filter((row) => !row.hidden)
        .map((row) => row.getAttribute('data-property-id') ?? '');
    const eye = (id: string): HTMLButtonElement | null => q<HTMLButtonElement>(`[data-blok-testid="database-layout-eye-${id}"]`);
    const groupIds = (): string[] =>
      [...builder().querySelectorAll<HTMLElement>('[data-blok-database-drawer-props] [data-blok-database-drawer-prop-value]')].map((el) => el.getAttribute('data-property-id') ?? '');
    const more = (): HTMLButtonElement | null => builder().querySelector<HTMLButtonElement>('[data-blok-database-drawer-hidden-props]');
    const pick = (id: string, visibility: 'always' | 'hideWhenEmpty' | 'hidden'): void => {
      openGroupMenu();
      eye(id)?.click();
      q(`[data-blok-testid="database-layout-visibility-${visibility}"]`)?.click();
    };
    const apply = (): void => {
      builder().querySelector<HTMLElement>('[data-blok-database-layout-apply]')?.click();
    };

    it('lists the group properties with an eye each, between Add section and search, and Add a property and Move to panel', () => {
      const { drawer } = customize({
        schema: [...schemaWith({
          pageLayoutPlacements: [{ id: 'p-status', place: 'heading' }, { id: 'p-notes', place: 'section', sectionId: 's1' }],
          pageLayoutSections: [{ id: 's1', name: 'Planning' }],
        }), { ...NOTES, pageVisibility: 'hidden' }],
      });

      expect(groupMenuButton().getAttribute('aria-label')).toBe('Action menu for module');
      groupMenuButton().click();
      const menu = openGroupMenu();

      expect(moduleCard('group').hasAttribute('data-selected')).toBe(true);
      expect(menu.querySelector('[data-blok-database-panel-header]')?.textContent).toContain('Property group');
      expect(menu.querySelector('[data-blok-database-panel-header] [data-blok-database-layout-add-section]')?.textContent?.trim()).toBe('Add section');
      expect(menu.querySelector('[data-blok-database-panel-header] [data-blok-database-layout-add-section] svg')).not.toBeNull();
      const search = menu.querySelector<HTMLInputElement>('[data-blok-testid="database-layout-group-search"]');

      expect(search?.placeholder).toBe('Search properties…');
      expect(search).toHaveFocus();
      // Pins live in the Heading menu; a hidden or sectioned property is still in the group.
      expect(menuRows()).toEqual(['p-due', 'p-notes']);
      expect(eye('p-due')?.getAttribute('aria-label')).toBe('Visibility of Due');
      expect(menu.querySelector('[data-blok-database-layout-add-group-property]')?.textContent).toBe('+ Add a property');
      expect(menu.querySelector('[data-blok-testid="database-layout-group-move"]')?.textContent?.trim()).toBe('Move to panel');
      if (search === null) throw new Error('no property search');
      search.value = 'NOT';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      expect(menuRows()).toEqual(['p-notes']);
      expect(search).toHaveFocus();
      headingMenuButton().click();

      expect(groupMenu()).toBeNull();
      expect(headingMenu()).not.toBeNull();
      drawer.destroy();
    });

    // research/09 §5: three states; the eye glyph shows the current one. The canvas follows; nothing is written before Apply.
    it('sets Always show, Hide when empty and Always hide from the eye button as a draft', () => {
      const { drawer, options } = customize({ schema: [...schemaWith(), NOTES] });

      openGroupMenu();
      expect(eye('p-status')?.getAttribute('data-visibility')).toBe('always');
      eye('p-status')?.click();
      const choices = [...openGroupMenu().querySelectorAll<HTMLElement>('[data-blok-database-panel-row]')];

      expect(choices.map((row) => row.textContent?.trim())).toEqual(['Always show', 'Hide when empty', 'Always hide']);
      expect(choices.map((row) => row.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
      q('[data-blok-testid="database-layout-visibility-hidden"]')?.click();

      expect(eye('p-status')?.getAttribute('data-visibility')).toBe('hidden');
      expect(eye('p-status')).toHaveFocus();
      expect(groupIds()).toEqual(['p-due', 'p-notes']);
      pick('p-notes', 'hideWhenEmpty');
      pick('p-due', 'hideWhenEmpty');

      expect(groupIds()).toEqual(['p-due']);
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      expect(options.schema.find((p) => p.id === 'p-status')?.pageVisibility).toBeUndefined();
      apply();

      expect(options.onPageLayoutChange).toHaveBeenCalledTimes(1);
      const [edit, visibility] = vi.mocked(options.onPageLayoutChange)?.mock.calls[0] ?? [];

      expect(edit).toBeNull();
      expect([...(visibility ?? [])]).toEqual([['p-status', 'hidden'], ['p-notes', 'hideWhenEmpty'], ['p-due', 'hideWhenEmpty']]);
      drawer.destroy();
    });

    it('returns focus to the eye on Escape and on Back from its menu', () => {
      const { drawer } = customize();

      openGroupMenu();
      eye('p-due')?.click();
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

      expect(groupMenu()).not.toBeNull();
      expect(eye('p-due')).toHaveFocus();
      eye('p-due')?.click();
      q('[data-blok-testid="database-panel-back"]')?.click();

      expect(eye('p-due')).toHaveFocus();
      drawer.destroy();
    });

    it('drops an eye edit set back to the saved value', () => {
      const { drawer, options } = customize({ schema: [...schemaWith(), { ...NOTES, pageVisibility: 'hidden' }] });

      pick('p-notes', 'always');
      pick('p-notes', 'hidden');
      builder().querySelector<HTMLElement>('[data-blok-database-layout-cancel]')?.click();

      expect(q('[data-blok-database-confirm-dialog]')).toBeNull();
      expect(q(BUILDER)).toBeNull();
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      drawer.destroy();
    });

    // research/09 §5 L75: "1 more property", then "2 more properties"; a click in the builder does not expand it.
    it('shows N more properties for hidden properties and does not expand it while customizing', () => {
      const { drawer } = customize({ schema: [...schemaWith(), NOTES] });

      expect(more()).toBeNull();
      pick('p-status', 'hidden');

      expect(more()?.textContent).toBe('1 more property');
      pick('p-notes', 'hideWhenEmpty');

      expect(more()?.textContent).toBe('2 more properties');
      more()?.click();

      expect(more()?.textContent).toBe('2 more properties');
      expect(more()?.getAttribute('aria-expanded')).toBe('false');
      expect(groupIds()).toEqual(['p-due']);
      drawer.destroy();
    });

    // research/09 §3 L57: the new property lands at the top of the group.
    it('adds a property from the Property group menu at the top of the group', () => {
      const { drawer, options } = customize({ onOpenAddProperty: vi.fn() });
      const add = openGroupMenu().querySelector<HTMLElement>('[data-blok-database-layout-add-group-property]');

      add?.click();
      const [anchor, onAdded] = vi.mocked(options.onOpenAddProperty)?.mock.calls[0] ?? [];

      expect(groupMenu()).toBeNull();
      expect(anchor).toBe(groupMenuButton());
      drawer.refreshSchema([...schemaWith(), { id: 'p-new', name: 'Budget', type: 'number', position: 'a9' }]);
      onAdded?.('p-new');

      // Unplaced properties follow A→Z: Due before Status (R12).
      expect(groupIds()).toEqual(['p-new', 'p-due', 'p-status']);
      apply();

      expect(written(options)?.placements).toEqual([{ id: 'p-new', place: 'group' }]);
      drawer.destroy();
    });

    // research/10 §8 L172: "Move to panel" on the group, and back.
    it('moves the property group to the panel and back', () => {
      const { drawer, options } = customize();
      const move = (): HTMLElement | null => q('[data-blok-testid="database-layout-group-move"]');

      openGroupMenu();
      move()?.click();

      expect(builder().querySelector('[data-blok-database-layout-panel-column] [data-blok-database-drawer-props]')).not.toBeNull();
      expect(move()?.textContent?.trim()).toBe('Move to page');
      move()?.click();

      expect(builder().querySelector('[data-blok-database-layout-panel-column] [data-blok-database-drawer-props]')).toBeNull();
      expect(builder().querySelector('[data-blok-database-layout-canvas] [data-blok-database-drawer-props]')).not.toBeNull();
      move()?.click();
      apply();

      expect(written(options)?.groupIn).toBe('panel');
      drawer.destroy();
    });
  });

  // research/09 anatomy L39-40, §3b L65: page modules, "+" Add page module and the side panel column (plan Phase 5c).
  describe('page modules and the side panel column', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const REL: PropertyDefinition = { id: 'p-rel', name: 'Tasks', type: 'relation', position: 'a3', relation: { targetDatabaseId: 'other' } };
    const OWNER: PropertyDefinition = { id: 'p-owner', name: 'Owner', type: 'text', position: 'a4' };
    const column = (): HTMLElement => {
      const el = builder().querySelector<HTMLElement>('[data-blok-database-layout-panel-column]');

      if (el === null) throw new Error('no side panel column');

      return el;
    };
    const canvas = (): HTMLElement => {
      const el = builder().querySelector<HTMLElement>('[data-blok-database-layout-canvas]');

      if (el === null) throw new Error('no canvas');

      return el;
    };
    /** The canvas or the column, read as its module cards and "+" in order. */
    const cardsIn = (el: HTMLElement): string[] =>
      [...el.querySelectorAll<HTMLElement>(':scope > [data-blok-database-layout-module], :scope > [data-blok-database-layout-add-module], [data-blok-database-layout-panel-body] > [data-blok-database-layout-module]')]
        .map((card) => card.hasAttribute('data-blok-database-layout-add-module') ? '+' : card.getAttribute('data-property-id') ?? card.getAttribute('data-blok-database-layout-module') ?? '');
    const propertyCard = (id: string): HTMLElement => {
      const el = builder().querySelector<HTMLElement>(`[data-blok-database-layout-module="property"][data-property-id="${id}"]`);

      if (el === null) throw new Error(`no module card for ${id}`);

      return el;
    };
    const moduleMenu = (): HTMLElement | null => q('[data-blok-testid="database-layout-module-menu"]');
    const openModuleMenu = (id: string): HTMLElement => {
      if (moduleMenu() === null) propertyCard(id).querySelector<HTMLElement>('[data-blok-database-layout-module-menu]')?.click();
      const menu = moduleMenu();

      if (menu === null) throw new Error(`no module menu for ${id}`);

      return menu;
    };
    const addModuleButton = (): HTMLButtonElement => {
      const el = canvas().querySelector<HTMLButtonElement>('[data-blok-database-layout-add-module]');

      if (el === null) throw new Error('no Add page module button');

      return el;
    };
    const addToPanelButton = (): HTMLButtonElement => {
      const el = column().querySelector<HTMLButtonElement>('[data-blok-database-layout-add-to-panel]');

      if (el === null) throw new Error('no Add to panel button');

      return el;
    };
    const listed = (menu: HTMLElement | null): string[] =>
      [...(menu?.querySelectorAll<HTMLElement>('[data-blok-testid^="database-layout-add-existing-"]') ?? [])].map((row) => row.getAttribute('data-blok-testid')?.replace('database-layout-add-existing-', '') ?? '');
    const apply = (): void => {
      builder().querySelector<HTMLElement>('[data-blok-database-layout-apply]')?.click();
    };

    it('adds an existing property as a page module from +', () => {
      const { drawer, options } = customize();
      const add = addModuleButton();

      expect(add.getAttribute('aria-label')).toBe('Add page module');
      expect(cardsIn(canvas())).toEqual(['heading', 'group', '+', 'content']);
      add.click();
      const menu = q('[data-blok-testid="database-layout-add-module-menu"]');

      expect(menu?.querySelector('[data-blok-database-panel-header]')?.textContent).toBe('Add to page');
      expect(menu?.textContent).toContain('Use an existing property');
      expect(menu?.textContent).toContain('Create new property');
      expect(listed(menu)).toEqual(['p-due', 'p-status']);
      q('[data-blok-testid="database-layout-add-existing-p-due"]')?.click();

      expect(q('[data-blok-testid="database-layout-add-module-menu"]')).toBeNull();
      expect(cardsIn(canvas())).toEqual(['heading', 'group', 'p-due', '+', 'content']);
      expect(propertyCard('p-due').querySelector('[data-blok-database-layout-module-name]')?.textContent).toBe('Due');
      expect(propertyCard('p-due').querySelector('[data-blok-database-drawer-prop-value][data-property-id="p-due"]')).not.toBeNull();
      expect(moduleCard('group').querySelector('[data-blok-database-drawer-prop-value][data-property-id="p-due"]')).toBeNull();
      apply();

      expect(written(options)?.placements).toEqual([{ id: 'p-due', place: 'page' }]);
      drawer.destroy();
    });

    it('creates a property into the panel from Add to panel', () => {
      const { drawer, options } = customize({ onOpenAddProperty: vi.fn() });
      const add = addToPanelButton();

      expect(add.textContent?.trim()).toBe('Add to panel');
      add.click();
      const menu = q('[data-blok-testid="database-layout-add-panel-menu"]');

      expect(menu?.querySelector('[data-blok-database-panel-header]')?.textContent).toBe('Add to panel');
      q('[data-blok-testid="database-layout-create-module"]')?.click();
      const [anchor, onAdded] = vi.mocked(options.onOpenAddProperty)?.mock.calls[0] ?? [];

      expect(q('[data-blok-testid="database-layout-add-panel-menu"]')).toBeNull();
      expect(anchor).toBe(addToPanelButton());
      drawer.refreshSchema([...schemaWith(), { id: 'p-new', name: 'Budget', type: 'number', position: 'a9' }]);
      onAdded?.('p-new');

      expect(cardsIn(column())).toEqual(['p-new']);
      apply();

      expect(written(options)?.placements).toEqual([{ id: 'p-new', place: 'panel' }]);
      drawer.destroy();
    });

    it('never offers Add to panel for a relation', () => {
      const { drawer } = customize({ schema: [...schemaWith(), REL] });

      addToPanelButton().click();
      expect(listed(q('[data-blok-testid="database-layout-add-panel-menu"]'))).toEqual(['p-due', 'p-status']);
      addModuleButton().click();
      expect(listed(q('[data-blok-testid="database-layout-add-module-menu"]'))).toEqual(['p-due', 'p-status', 'p-rel']);
      drawer.destroy();
    });

    it('drags a module below another, and Move down does the same from the keyboard', () => {
      const { drawer, options } = customize({
        schema: [...schemaWith({ pageLayoutPlacements: [{ id: 'p-due', place: 'page' }, { id: 'p-status', place: 'page' }] })],
      });

      expect(cardsIn(canvas())).toEqual(['heading', 'group', 'p-due', 'p-status', '+', 'content']);
      const handle = propertyCard('p-due').querySelector<HTMLElement>('[data-blok-database-layout-module-handle]');

      // research/10 §9 L71: only the ••• is a tab stop; the handle is for the pointer.
      expect(handle?.getAttribute('aria-hidden')).toBe('true');
      expect(handle?.matches('button, [tabindex]')).toBe(false);
      const menu = openModuleMenu('p-due');

      expect(menu.querySelector('[data-blok-database-panel-header]')?.textContent).toBe('Due');
      expect(q<HTMLButtonElement>('[data-blok-testid="database-layout-module-move-up"]')?.disabled).toBe(true);
      q('[data-blok-testid="database-layout-module-move-down"]')?.click();

      expect(cardsIn(canvas())).toEqual(['heading', 'group', 'p-status', 'p-due', '+', 'content']);
      // The menu stays open on its card, which is still in the page.
      expect(moduleMenu()).not.toBeNull();
      expect(q<HTMLButtonElement>('[data-blok-testid="database-layout-module-move-down"]')?.disabled).toBe(true);
      apply();
      const edit = vi.mocked(options.onPageLayoutChange)?.mock.calls.at(-1)?.[0];

      expect(edit?.(pageLayoutOf(options.schema[0])).placements).toEqual([{ id: 'p-status', place: 'page' }, { id: 'p-due', place: 'page' }]);
      drawer.destroy();
    });

    it('moves a module to the panel and back, and removes it, from its ••• menu', () => {
      const { drawer, options } = customize({ schema: [...schemaWith({ pageLayoutPlacements: [{ id: 'p-due', place: 'page' }] }), OWNER] });

      openModuleMenu('p-due');
      q('[data-blok-testid="database-layout-module-move-panel"]')?.click();

      expect(cardsIn(column())).toEqual(['p-due']);
      expect(q('[data-blok-testid="database-layout-module-move-panel"]')?.textContent?.trim()).toBe('Move to page');
      q('[data-blok-testid="database-layout-module-move-panel"]')?.click();

      expect(cardsIn(column())).toEqual([]);
      expect(cardsIn(canvas())).toContain('p-due');
      q('[data-blok-testid="database-layout-module-remove"]')?.click();

      expect(moduleMenu()).toBeNull();
      expect(builder().querySelector('[data-blok-database-layout-module="property"]')).toBeNull();
      expect(moduleCard('group').querySelector('[data-blok-database-drawer-prop-value][data-property-id="p-due"]')).not.toBeNull();
      apply();
      const edit = vi.mocked(options.onPageLayoutChange)?.mock.calls.at(-1)?.[0];

      expect(edit?.(pageLayoutOf(options.schema[0])).placements).toEqual([]);
      drawer.destroy();
    });

    it('offers no Move to panel in the ••• menu of a relation module', () => {
      const { drawer } = customize({ schema: [...schemaWith({ pageLayoutPlacements: [{ id: 'p-rel', place: 'page' }] }), REL] });

      openModuleMenu('p-rel');
      expect(q('[data-blok-testid="database-layout-module-move-panel"]')).toBeNull();
      expect(q('[data-blok-testid="database-layout-module-remove"]')).not.toBeNull();
      drawer.destroy();
    });

    it('puts the property group and panel modules in the side panel column, and the View details line in the heading', () => {
      const { drawer } = customize({
        schema: [...schemaWith({ pageLayoutGroupIn: 'panel', pageLayoutPlacements: [{ id: 'p-due', place: 'panel' }] })],
      });

      expect(cardsIn(column())).toEqual(['group', 'p-due']);
      expect(cardsIn(canvas())).toEqual(['heading', '+', 'content']);
      expect(moduleCard('heading').querySelector('[data-blok-database-drawer-details-toggle]')).not.toBeNull();
      expect(builder().querySelector('[data-blok-database-drawer-details]')).toBeNull();
      drawer.destroy();
    });

    it('hides and shows the side panel column from its own button', () => {
      const { drawer } = customize();
      const toggle = (): HTMLButtonElement | null => column().querySelector<HTMLButtonElement>('[data-blok-database-layout-panel-toggle]');
      const body = (): HTMLElement | null => column().querySelector<HTMLElement>('[data-blok-database-layout-panel-body]');

      expect(toggle()?.getAttribute('aria-label')).toBe('Hide sidebar');
      expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
      expect(body()?.hidden).toBe(false);
      toggle()?.click();

      expect(toggle()?.getAttribute('aria-label')).toBe('Show sidebar');
      expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
      expect(body()?.hidden).toBe(true);
      expect(column().hasAttribute('data-collapsed')).toBe(true);
      toggle()?.click();

      expect(body()?.hidden).toBe(false);
      drawer.destroy();
    });

    // research/09 §10 L164: at 756px the column is a "«" button. Notion's breakpoint was not measured.
    it('collapses the side panel column at a narrow width', () => {
      const listeners: Array<(event: { matches: boolean }) => void> = [];
      const query = { matches: true, addEventListener: (_: string, fn: (event: { matches: boolean }) => void) => listeners.push(fn), removeEventListener: vi.fn() };

      vi.stubGlobal('matchMedia', vi.fn(() => query));
      const { drawer } = customize();
      const toggle = column().querySelector<HTMLButtonElement>('[data-blok-database-layout-panel-toggle]');

      expect(column().hasAttribute('data-collapsed')).toBe(true);
      expect(toggle?.getAttribute('aria-label')).toBe('Show sidebar');
      for (const fn of listeners) fn({ matches: false });

      expect(column().hasAttribute('data-collapsed')).toBe(false);
      drawer.close();

      expect(query.removeEventListener).toHaveBeenCalled();
    });
  });

  // research/10 §3: sections live in the Property group menu.
  describe('Sections', () => {
    const NOTES: PropertyDefinition = { id: 'p-notes', name: 'Notes', type: 'text', position: 'a3' };
    const groupMenu = (): HTMLElement | null => q('[data-blok-testid="database-layout-group-menu"]');
    const openGroupMenu = (): HTMLElement => {
      if (groupMenu() === null) moduleCard('group').querySelector<HTMLElement>('[data-blok-database-layout-module-menu]')?.click();
      const menu = groupMenu();

      if (menu === null) throw new Error('no Property group menu');

      return menu;
    };
    /** The menu read as its sections and their rows: '' is the group outside every section. */
    const menuSections = (): Array<[string, string[]]> => {
      const menu = openGroupMenu();
      const loose = [...menu.querySelectorAll<HTMLElement>('[data-blok-database-layout-menu-group] [data-blok-database-layout-group-row]')].map((row) => row.getAttribute('data-property-id') ?? '');
      const sections = [...menu.querySelectorAll<HTMLElement>('[data-blok-database-layout-menu-section]')].map((section): [string, string[]] => [
        section.querySelector('[data-blok-database-layout-section-row]')?.textContent?.trim() ?? '',
        [...section.querySelectorAll<HTMLElement>('[data-blok-database-layout-group-row]')].map((row) => row.getAttribute('data-property-id') ?? ''),
      ]);

      return [['', loose], ...sections];
    };
    const canvasSections = (): Array<[string, string[]]> =>
      [...builder().querySelectorAll<HTMLElement>('[data-blok-database-drawer-section]')].map((section) => [
        section.querySelector('[data-blok-database-drawer-section-header]')?.textContent?.trim() ?? '',
        [...section.querySelectorAll<HTMLElement>('[data-blok-database-drawer-prop-value]')].map((el) => el.getAttribute('data-property-id') ?? ''),
      ]);
    const sectionRow = (id: string): HTMLElement => {
      const el = openGroupMenu().querySelector<HTMLElement>(`[data-blok-database-layout-menu-section][data-section-id="${id}"] [data-blok-database-layout-section-row]`);

      if (el === null) throw new Error(`no section row ${id}`);

      return el;
    };
    const rowsOf = (): string[] => [...openGroupMenu().querySelectorAll<HTMLElement>('[data-blok-database-panel-row]')].map((row) => row.getAttribute('data-blok-testid') ?? '');
    const apply = (): void => {
      builder().querySelector<HTMLElement>('[data-blok-database-layout-apply]')?.click();
    };
    /** The applied edit, replayed on the layout the schema saved. */
    const savedAfter = (options: CardDrawerOptions): PageLayoutData | undefined =>
      vi.mocked(options.onPageLayoutChange)?.mock.calls.at(-1)?.[0]?.(pageLayoutOf(options.schema[0]));
    const TWO = (): PropertyDefinition[] => [...schemaWith({
      pageLayoutSections: [{ id: 's1', name: 'Planning' }, { id: 's2', name: 'Later' }],
      pageLayoutPlacements: [{ id: 'p-status', place: 'section', sectionId: 's1' }, { id: 'p-due', place: 'section', sectionId: 's1' }],
    }), NOTES];

    it('adds the first section at the top holding every property, and opens its rename with the name selected', () => {
      const { drawer, options } = customize();

      openGroupMenu().querySelector<HTMLElement>('[data-blok-database-panel-header] [data-blok-database-layout-add-section]')?.click();
      const input = openGroupMenu().querySelector<HTMLInputElement>('[data-blok-database-layout-section-rename] input');

      if (input === null) throw new Error('no rename field');
      expect(input.value).toBe('New section');
      expect(input).toHaveFocus();
      expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'New section'.length]);
      const done = openGroupMenu().querySelector<HTMLElement>('[data-blok-database-layout-section-done]');

      expect(done?.textContent).toBe('Done');
      expect(menuSections()).toEqual([['', []], ['', ['p-status', 'p-due']]]);
      input.value = 'Details';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      done?.click();

      expect(openGroupMenu().querySelector('[data-blok-database-layout-section-rename]')).toBeNull();
      expect(menuSections()).toEqual([['', []], ['Details', ['p-status', 'p-due']]]);
      expect(canvasSections()).toEqual([['Details', ['p-status', 'p-due']]]);
      apply();

      expect(savedAfter(options)?.sections.map((section) => section.name)).toEqual(['Details']);
      drawer.destroy();
    });

    it('commits a rename on Enter', () => {
      const { drawer } = customize();

      openGroupMenu().querySelector<HTMLElement>('[data-blok-database-panel-header] [data-blok-database-layout-add-section]')?.click();
      const input = openGroupMenu().querySelector<HTMLInputElement>('[data-blok-database-layout-section-rename] input');

      if (input === null) throw new Error('no rename field');
      input.value = 'More';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

      expect(canvasSections().map(([name]) => name)).toEqual(['More']);
      expect(sectionRow(canvasSectionId(0))).toHaveFocus();
      drawer.destroy();
    });

    const canvasSectionId = (index: number): string =>
      builder().querySelectorAll<HTMLElement>('[data-blok-database-drawer-section]')[index]?.getAttribute('data-section-id') ?? '';

    it('shows Empty in an empty section, and gives each section in the menu its own Add a property', () => {
      const { drawer } = customize({ schema: TWO() });

      expect(canvasSections()).toEqual([['Planning', ['p-status', 'p-due']], ['Later', []]]);
      expect(builder().querySelector('[data-blok-database-drawer-section][data-section-id="s2"] [data-blok-database-layout-section-empty]')?.textContent).toBe('Empty');
      expect(builder().querySelector('[data-blok-database-drawer-section][data-section-id="s1"] [data-blok-database-layout-section-empty]')).toBeNull();
      expect(menuSections()).toEqual([['', ['p-notes']], ['Planning', ['p-status', 'p-due']], ['Later', []]]);
      const adds = [...openGroupMenu().querySelectorAll<HTMLElement>('[data-blok-database-layout-menu-section] [data-blok-database-layout-add-section-property]')];

      expect(adds.map((add) => [add.closest('[data-section-id]')?.getAttribute('data-section-id'), add.textContent])).toEqual([['s1', '+ Add a property'], ['s2', '+ Add a property']]);
      drawer.destroy();
    });

    it('adds a property first in a section from that section\'s Add a property', () => {
      const added: PropertyDefinition = { id: 'p-new', name: 'New', type: 'text', position: 'a9' };
      let drawerRef: DatabaseCardDrawer | null = null;
      const { drawer, options } = customize({
        schema: TWO(),
        onOpenAddProperty: vi.fn((_anchor: HTMLElement, onAdded?: (id: string) => void) => {
          drawerRef?.refreshSchema([...TWO(), added]);
          onAdded?.('p-new');
        }),
      });

      drawerRef = drawer;
      openGroupMenu().querySelector<HTMLElement>('[data-section-id="s1"] [data-blok-database-layout-add-section-property]')?.click();

      expect(canvasSections()).toEqual([['Planning', ['p-new', 'p-status', 'p-due']], ['Later', []]]);
      apply();

      expect(savedAfter(options)?.placements[0]).toEqual({ id: 'p-new', place: 'section', sectionId: 's1' });
      drawer.destroy();
    });

    it('moves a section down from its menu and offers only valid directions', () => {
      const { drawer, options } = customize({ schema: TWO() });

      sectionRow('s1').click();
      expect(openGroupMenu().querySelector('[data-blok-database-panel-header]')?.textContent).toContain('Planning');
      expect(rowsOf()).toEqual(['database-layout-section-rename', 'database-layout-section-move-down', 'database-layout-section-delete']);
      q('[data-blok-testid="database-layout-section-move-down"]')?.click();

      expect(canvasSections().map(([name]) => name)).toEqual(['Later', 'Planning']);
      sectionRow('s1').click();
      expect(rowsOf()).toEqual(['database-layout-section-rename', 'database-layout-section-move-up', 'database-layout-section-delete']);
      apply();

      expect(savedAfter(options)?.sections.map((section) => section.id)).toEqual(['s2', 's1']);
      drawer.destroy();
    });

    it('renames a section from its menu', () => {
      const { drawer } = customize({ schema: TWO() });

      sectionRow('s2').click();
      q('[data-blok-testid="database-layout-section-rename"]')?.click();
      const input = openGroupMenu().querySelector<HTMLInputElement>('[data-section-id="s2"] [data-blok-database-layout-section-rename] input');

      expect(input).toHaveFocus();
      expect([input?.selectionStart, input?.selectionEnd]).toEqual([0, 'Later'.length]);
      if (input === null) throw new Error('no rename field');
      input.value = 'Someday';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      openGroupMenu().querySelector<HTMLElement>('[data-blok-database-layout-section-done]')?.click();

      expect(canvasSections().map(([name]) => name)).toEqual(['Planning', 'Someday']);
      drawer.destroy();
    });

    it('deletes a section without deleting its properties', () => {
      const onDeleteProperty = vi.fn();
      const { drawer, options } = customize({ schema: TWO(), onDeleteProperty });

      sectionRow('s1').click();
      const remove = q('[data-blok-testid="database-layout-section-delete"]');

      expect(remove?.querySelector('[data-blok-database-panel-label]')?.textContent).toBe('Delete');
      expect(remove?.querySelector('[data-blok-database-panel-description]')?.textContent).toBe('No properties will be deleted');
      remove?.click();

      expect(canvasSections()).toEqual([['Later', []]]);
      // Back in the group unplaced, so by name (R12).
      expect(menuSections()).toEqual([['', ['p-due', 'p-notes', 'p-status']], ['Later', []]]);
      apply();

      expect(onDeleteProperty).not.toHaveBeenCalled();
      expect(savedAfter(options)?.sections).toEqual([{ id: 's2', name: 'Later' }]);
      expect(savedAfter(options)?.placements).toEqual([]);
      drawer.destroy();
    });

    it('drags a property from one section to another in the group menu', () => {
      const { drawer, options } = customize({ schema: TWO() });
      const menu = openGroupMenu();
      // Lay the menu out: every row, header and add button 28px tall, in DOM order.
      const parts = [...menu.querySelectorAll<HTMLElement>('[data-blok-database-layout-group-row], [data-blok-database-layout-section-row], [data-blok-database-layout-add-section-property]')];
      const boxes = new Map<Element, { top: number; bottom: number; left: number; right: number; width: number; height: number }>(parts.map((el, i) => [el, { top: i * 28, bottom: i * 28 + 28, left: 0, right: 290, width: 290, height: 28 }]));
      const blocks = [...menu.querySelectorAll<HTMLElement>('[data-blok-database-layout-menu-group], [data-blok-database-layout-menu-section]')];

      for (const block of blocks) {
        const inside = parts.filter((el) => block.contains(el)).map((el) => boxes.get(el));
        const top = inside[0]?.top ?? 0;

        boxes.set(block, { top, bottom: inside.at(-1)?.bottom ?? top, left: 0, right: 290, width: 290, height: (inside.at(-1)?.bottom ?? top) - top });
      }
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
        const box = boxes.get(this) ?? { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };

        return { ...box, x: box.left, y: box.top, toJSON: () => box };
      });
      const handle = menu.querySelector<HTMLElement>('[data-blok-database-layout-group-row][data-property-id="p-status"] [data-blok-database-layout-group-handle]');

      expect(handle?.getAttribute('aria-hidden')).toBe('true');
      // Order: Notes (0), Planning header (1), Status (2), Due (3), add (4), Later header (5), add (6).
      handle?.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 70, bubbles: true, cancelable: true }));
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 160, bubbles: true }));

      expect(menu.querySelector('[data-blok-database-drop-line]')).not.toBeNull();
      document.dispatchEvent(new MouseEvent('pointerup', { clientX: 10, clientY: 160, bubbles: true }));

      expect(canvasSections()).toEqual([['Planning', ['p-due']], ['Later', ['p-status']]]);
      expect(menuSections()).toEqual([['', ['p-notes']], ['Planning', ['p-due']], ['Later', ['p-status']]]);
      apply();

      expect(savedAfter(options)?.placements).toEqual([{ id: 'p-due', place: 'section', sectionId: 's1' }, { id: 'p-status', place: 'section', sectionId: 's2' }]);
      drawer.destroy();
    });

    it('moves a property to another section, and out of one, from its row\'s menu', () => {
      const { drawer } = customize({ schema: TWO() });

      openGroupMenu().querySelector<HTMLElement>('[data-blok-database-layout-group-row][data-property-id="p-due"] [data-blok-database-layout-group-name]')?.click();
      expect(rowsOf()).toEqual(['database-layout-move-to-section-s2', 'database-layout-leave-section']);
      expect(q('[data-blok-testid="database-layout-move-to-section-s2"]')?.textContent?.trim()).toBe('Move to Later');
      q('[data-blok-testid="database-layout-move-to-section-s2"]')?.click();

      expect(canvasSections()).toEqual([['Planning', ['p-status']], ['Later', ['p-due']]]);
      openGroupMenu().querySelector<HTMLElement>('[data-blok-database-layout-group-row][data-property-id="p-due"] [data-blok-database-layout-group-name]')?.click();
      q('[data-blok-testid="database-layout-leave-section"]')?.click();

      expect(menuSections()).toEqual([['', ['p-due', 'p-notes']], ['Planning', ['p-status']], ['Later', []]]);
      drawer.destroy();
    });

    // research/10 §3: no folding inside the builder; a click on the header opens the group's menu.
    it('draws a section header on the canvas as its name, which opens the group menu and never folds', () => {
      const { drawer } = customize({ schema: TWO() });
      const header = builder().querySelector<HTMLElement>('[data-blok-database-drawer-section][data-section-id="s1"] [data-blok-database-drawer-section-header]');

      expect(header?.querySelector('input, button')).toBeNull();
      expect(header?.querySelector('svg')).not.toBeNull();
      header?.click();

      expect(groupMenu()).not.toBeNull();
      expect(builder().querySelector<HTMLElement>('[data-blok-database-drawer-section][data-section-id="s1"] [data-blok-database-drawer-section-body]')?.hidden).toBe(false);
      drawer.destroy();
    });

    it('deletes the per-property layout menu once every job has a home', () => {
      const { drawer } = customize({
        schema: [...schemaWith({
          pageLayoutSections: [{ id: 's1', name: 'Planning' }],
          pageLayoutPlacements: [{ id: 'p-status', place: 'heading' }, { id: 'p-due', place: 'section', sectionId: 's1' }],
        }), NOTES],
      });

      expect(q('[data-blok-database-layout-item-menu]')).toBeNull();
      drawer.destroy();
    });

    // The pins' keyboard path, which the per-property menu used to hold.
    it('moves a pin from its row in the Heading menu, offering only valid directions', () => {
      const { drawer, options } = customize({ schema: schemaWith({ pageLayoutPlacements: [{ id: 'p-status', place: 'heading' }, { id: 'p-due', place: 'heading' }] }) });

      headingMenuButton().click();
      headingMenu()?.querySelector<HTMLElement>('[data-blok-database-layout-pin-row][data-property-id="p-status"] [data-blok-database-layout-pin-name]')?.click();
      expect([...(headingMenu()?.querySelectorAll<HTMLElement>('[data-blok-database-panel-row]') ?? [])].map((row) => row.getAttribute('data-blok-testid'))).toEqual(['database-layout-pin-move-down']);
      q('[data-blok-testid="database-layout-pin-move-down"]')?.click();
      apply();

      expect(savedAfter(options)?.placements).toEqual([{ id: 'p-due', place: 'heading' }, { id: 'p-status', place: 'heading' }]);
      drawer.destroy();
    });
  });

  // research/09 §3b.
  it('asks Discard all layout changes? on Cancel after edits', async () => {
    const { drawer, options } = customize();

    pinDue();
    builder().querySelector<HTMLElement>('[data-blok-database-layout-cancel]')?.click();
    const dialog = q('[data-blok-database-confirm-dialog]');

    expect(dialog?.closest(BUILDER)).not.toBeNull();
    expect(q('[data-blok-database-confirm-title]')?.textContent).toBe('Discard all layout changes?');
    // research/23 §7: Discard is a filled red button.
    expect(q('[data-blok-database-confirm-action="confirm"]')?.hasAttribute('data-filled')).toBe(true);
    q('[data-blok-database-confirm-action="confirm"]')?.click();
    await Promise.resolve();

    expect(q(BUILDER)).toBeNull();
    expect(options.onPageLayoutChange).not.toHaveBeenCalled();
    drawer.destroy();
  });

  // research/23 §7: a page load with a draft asks the browser's "Leave site?".
  describe('leaving the page while customizing', () => {
    const leave = (): Event => {
      const event = new Event('beforeunload', { cancelable: true });

      window.dispatchEvent(event);

      return event;
    };

    it('holds the page load while the draft has edits', () => {
      const { drawer } = customize();

      expect(leave().defaultPrevented).toBe(false);
      pinDue();
      expect(leave().defaultPrevented).toBe(true);
      drawer.destroy();
    });

    it('lets the page load go once the builder closes', () => {
      const { drawer } = customize();

      pinDue();
      builder().querySelector<HTMLElement>('[data-blok-database-layout-apply]')?.click();

      expect(q(BUILDER)).toBeNull();
      expect(leave().defaultPrevented).toBe(false);
      drawer.destroy();
    });

    it('lets the page load go once the drawer is destroyed mid-draft', () => {
      const { drawer } = customize();

      pinDue();
      drawer.destroy();

      expect(leave().defaultPrevented).toBe(false);
    });
  });

  // research/23 §7: an in-app route change with a draft asks "Discard all layout changes?".
  describe('asking before an in-app route change', () => {
    const title = (): string | null | undefined => q('[data-blok-database-confirm-title]')?.textContent;
    const answer = async (name: 'confirm' | 'cancel'): Promise<void> => {
      q(`[data-blok-database-confirm-action="${name}"]`)?.click();
      await Promise.resolve();
    };

    it('lets the route change go without asking while the draft is empty', async () => {
      const { drawer, options } = customize();

      await expect(askLeave(options.wrapper)).resolves.toBe(true);
      expect(q('[data-blok-database-confirm-dialog]')).toBeNull();
      drawer.destroy();
    });

    it('stays, keeping the builder and its draft, when the user cancels', async () => {
      const { drawer, options } = customize();

      pinDue();
      const leaving = askLeave(options.wrapper);

      expect(title()).toBe('Discard all layout changes?');
      await answer('cancel');

      await expect(leaving).resolves.toBe(false);
      expect(q(BUILDER)).not.toBeNull();
      // The draft still has its edit, so a second try asks again.
      const again = askLeave(options.wrapper);

      expect(title()).toBe('Discard all layout changes?');
      await answer('cancel');
      await expect(again).resolves.toBe(false);
      drawer.destroy();
    });

    it('discards the draft and leaves when the user confirms', async () => {
      const { drawer, options } = customize();

      pinDue();
      const leaving = askLeave(options.wrapper);

      await answer('confirm');

      await expect(leaving).resolves.toBe(true);
      expect(q(BUILDER)).toBeNull();
      expect(options.onPageLayoutChange).not.toHaveBeenCalled();
      drawer.destroy();
    });

    it('answers only for the editor that holds the database', async () => {
      const { drawer } = customize();
      const otherEditor = document.createElement('div');

      document.body.appendChild(otherEditor);
      pinDue();

      await expect(askLeave(otherEditor)).resolves.toBe(true);
      expect(q('[data-blok-database-confirm-dialog]')).toBeNull();
      otherEditor.remove();
      drawer.destroy();
    });

    it('stops asking once the drawer is destroyed mid-draft', async () => {
      const { drawer, options } = customize();

      pinDue();
      drawer.destroy();

      await expect(askLeave(options.wrapper)).resolves.toBe(true);
    });
  });

  // Navigation API: a cancelable same-document Back is held while the draft has edits.
  describe('browser Back while customizing', () => {
    const traverseTo = vi.fn(() => ({ committed: Promise.resolve(), finished: Promise.resolve() }));
    let navigation: EventTarget & { traverseTo: typeof traverseTo };

    const back = (init: { cancelable?: boolean; sameDocument?: boolean; type?: string } = {}): Event => {
      const event = Object.assign(new Event('navigate', { cancelable: init.cancelable ?? true }), {
        navigationType: init.type ?? 'traverse',
        destination: { sameDocument: init.sameDocument ?? true, key: 'entry-1' },
      });

      navigation.dispatchEvent(event);

      return event;
    };

    beforeEach(() => {
      navigation = Object.assign(new EventTarget(), { traverseTo });
      Object.defineProperty(window, 'navigation', { value: navigation, configurable: true });
    });

    afterEach(() => {
      Reflect.deleteProperty(window, 'navigation');
    });

    it('holds Back and asks; Discard goes back to the same entry', async () => {
      const { drawer } = customize();

      pinDue();

      expect(back().defaultPrevented).toBe(true);
      expect(q('[data-blok-database-confirm-title]')?.textContent).toBe('Discard all layout changes?');
      q('[data-blok-database-confirm-action="confirm"]')?.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(q(BUILDER)).toBeNull();
      expect(traverseTo).toHaveBeenCalledWith('entry-1');
      expect(back().defaultPrevented).toBe(false);
      drawer.destroy();
    });

    it('stays on Cancel without moving history', async () => {
      const { drawer } = customize();

      pinDue();
      back();
      q('[data-blok-database-confirm-action="cancel"]')?.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(q(BUILDER)).not.toBeNull();
      expect(traverseTo).not.toHaveBeenCalled();
      drawer.destroy();
    });

    it('leaves Back alone without edits, when the browser will not let it be canceled, and for pushes', () => {
      const { drawer } = customize();

      expect(back().defaultPrevented).toBe(false);
      pinDue();
      expect(back({ cancelable: false }).defaultPrevented).toBe(false);
      expect(back({ sameDocument: false, cancelable: true }).defaultPrevented).toBe(false);
      expect(back({ type: 'push' }).defaultPrevented).toBe(false);
      expect(q('[data-blok-database-confirm-dialog]')).toBeNull();
      drawer.destroy();
    });
  });

  // The peek closes on a press outside it; the builder is outside it.
  it('keeps the page open on a press inside the builder', () => {
    const { drawer } = customize();

    builder().querySelector('[data-blok-database-layout-apply]')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(drawer.isOpen).toBe(true);
    expect(q(BUILDER)).not.toBeNull();
    drawer.destroy();
  });

  // The builder makes the rest of the page inert; every exit must lift that.
  it.each(['close', 'destroy'] as const)('leaves no builder and nothing inert after the drawer %s', (exit) => {
    const { drawer } = customize();

    expect(document.querySelectorAll('[inert]').length).toBeGreaterThan(0);
    drawer[exit]();

    expect(q(BUILDER)).toBeNull();
    expect(document.querySelectorAll('[inert]')).toHaveLength(0);
  });
});
