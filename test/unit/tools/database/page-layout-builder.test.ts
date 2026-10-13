import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDrawerOptions } from '../../../../src/tools/database/database-card-drawer';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import { getTabbables } from '../../../../src/components/utils/modal-dialog';
import { registerLayer } from '../../../../src/components/utils/dismissable-layer';
import { pageLayoutOf } from '../../../../src/tools/database/page-layout';
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

const pinDue = (): void => {
  q('[data-blok-database-layout-item-menu][data-property-id="p-due"]')?.click();
  clickItem('pin');
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

      expect(q('[data-blok-database-cell-editor]')).toBeNull();
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
      ['Page settings', () => builder().querySelector<HTMLElement>('[data-blok-database-layout-settings]')?.click(), 'structure-simple'],
      ['an item menu', () => q('[data-blok-database-layout-item-menu][data-property-id="p-due"]')?.click(), 'pin'],
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
    const { drawer, options } = customize();
    const more = builder().querySelector<HTMLElement>('[data-blok-database-layout-more-save]');

    expect(more?.getAttribute('aria-label')).toBe('More save options');
    more?.click();
    const reset = q('[data-blok-popover-item][data-blok-item-name="reset"]');

    expect(reset?.textContent).toContain('Reset to original page layout');
    expect(reset?.textContent).toContain('No properties will be deleted');
    clickItem('reset');

    expect(written(options)).toMatchObject({ structure: 'simple', placements: [], sections: [] });
    expect(q(BUILDER)).toBeNull();
    drawer.destroy();
  });

  it('no longer offers Reset in Page settings', () => {
    const { drawer } = customize();

    builder().querySelector<HTMLElement>('[data-blok-database-layout-settings]')?.click();

    expect(q('[data-blok-popover-item][data-blok-item-name="structure-simple"]')).not.toBeNull();
    expect(q('[data-blok-popover-item][data-blok-item-name="reset"]')).toBeNull();
    drawer.destroy();
  });

  // research/09 §3b.
  it('asks Discard all layout changes? on Cancel after edits', async () => {
    const { drawer, options } = customize();

    pinDue();
    builder().querySelector<HTMLElement>('[data-blok-database-layout-cancel]')?.click();
    const dialog = q('[data-blok-database-confirm-dialog]');

    expect(dialog?.closest(BUILDER)).not.toBeNull();
    expect(q('[data-blok-database-confirm-title]')?.textContent).toBe('Discard all layout changes?');
    q('[data-blok-database-confirm-action="confirm"]')?.click();
    await Promise.resolve();

    expect(q(BUILDER)).toBeNull();
    expect(options.onPageLayoutChange).not.toHaveBeenCalled();
    drawer.destroy();
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
