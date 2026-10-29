import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDrawerOptions, DrawerBacklink } from '../../../../src/tools/database/database-card-drawer';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { DatabaseRow, PropertyDefinition } from '../../../../src/tools/database/types';
import { IconPageEmpty } from '../../../../src/components/icons';

vi.mock('../../../../src/blok', () => ({
  Blok: vi.fn(function stubBlok() {
    return {
      isReady: Promise.resolve(),
      save: vi.fn().mockResolvedValue({ blocks: [] }),
      destroy: vi.fn(),
    };
  }),
}));

/**
 * research/17 §2: "N backlinks" is the first item of the row page's hover row.
 * With none it is not drawn at all; a click lists the pages under "Linked to this page".
 */

const SCHEMA: PropertyDefinition[] = [{ id: 'p-title', name: 'Title', type: 'title', position: 'a0' }];
const ROW: DatabaseRow = { id: 'row-1', position: 'a0', properties: { 'p-title': 'Card' } };

const link = (key: string, title: string, path: string[] = []): DrawerBacklink => ({ key, title, path, open: vi.fn() });

const createOptions = (overrides: Partial<CardDrawerOptions> = {}): CardDrawerOptions => {
  const wrapper = document.createElement('div');

  document.body.appendChild(wrapper);

  return {
    wrapper,
    readOnly: false,
    titlePropertyId: 'p-title',
    schema: SCHEMA,
    onTitleChange: vi.fn(),
    onDescriptionChange: vi.fn(),
    onClose: vi.fn(),
    onIconChange: vi.fn(),
    onCoverChange: vi.fn(),
    ...overrides,
  };
};

const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
const button = (): HTMLButtonElement | null => q<HTMLButtonElement>('[data-blok-database-drawer-backlinks]');

describe('row page backlinks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    PopoverRegistry.resetForTests();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('draws nothing with no backlinks', () => {
    const drawer = new DatabaseCardDrawer(createOptions({ backlinks: () => [] }));

    drawer.open(ROW);

    expect(q('[data-blok-database-drawer-page-head]')).not.toBeNull();
    expect(button()).toBeNull();
    expect(q('[data-blok-database-drawer]')?.textContent).not.toMatch(/backlink/i);
    drawer.destroy();
  });

  it('shows "1 backlink" and "2 backlinks" first in the hover row', () => {
    const items = [link('r2', 'Bravo')];
    const drawer = new DatabaseCardDrawer(createOptions({ backlinks: () => items }));

    drawer.open(ROW);

    expect(button()?.textContent).toBe('1 backlink');
    expect(q('[data-blok-database-drawer-page-head]')?.firstElementChild).toBe(button());

    items.push(link('doc', 'Plans'));
    drawer.refreshBacklinks();

    expect(button()?.textContent).toBe('2 backlinks');
    expect(q('[data-blok-database-drawer-page-head]')?.firstElementChild).toBe(button());

    items.length = 0;
    drawer.refreshBacklinks();

    expect(button()).toBeNull();
    drawer.destroy();
  });

  it('shows to a reader too', () => {
    const drawer = new DatabaseCardDrawer(createOptions({ readOnly: true, backlinks: () => [link('r2', 'Bravo')] }));

    drawer.open(ROW);

    expect(button()?.textContent).toBe('1 backlink');
    drawer.destroy();
  });

  it('lists the pages under "Linked to this page" and opens the picked one', () => {
    const bravo = link('r2', 'Bravo', ['Tasks']);
    const plans = link('doc', 'Plans');
    const drawer = new DatabaseCardDrawer(createOptions({ backlinks: () => [bravo, plans] }));

    drawer.open(ROW);
    button()?.click();

    expect(q('[data-blok-database-backlinks-heading]')?.textContent).toBe('Linked to this page');
    const rows = [...document.querySelectorAll<HTMLElement>('[data-blok-popover-item][data-blok-item-name^="backlink-"]')];

    const text = (row: HTMLElement, part: string): string | undefined => row.querySelector(`[data-blok-database-backlink-${part}]`)?.textContent ?? undefined;

    expect(rows.map((row) => [text(row, 'title'), text(row, 'path')])).toEqual([['Bravo', 'Tasks'], ['Plans', undefined]]);
    expect(button()?.getAttribute('aria-expanded')).toBe('true');

    rows[0].click();

    expect(bravo.open).toHaveBeenCalledTimes(1);
    expect(plans.open).not.toHaveBeenCalled();
    drawer.destroy();
  });

  // notion-spec-2 §18.1: a page with no emoji shows Notion's pageEmpty, not a page with text lines.
  it('draws the empty page before a linked page with no emoji', () => {
    const drawer = new DatabaseCardDrawer(createOptions({ backlinks: () => [link('r2', 'Bravo')] }));
    const holder = document.createElement('span');

    holder.innerHTML = IconPageEmpty;
    drawer.open(ROW);
    button()?.click();

    const paths = (root: ParentNode | null | undefined): Array<string | null> => [...root?.querySelectorAll('path') ?? []].map((path) => path.getAttribute('d'));
    const page = document.querySelector('[data-blok-popover-item][data-blok-item-name^="backlink-"] [data-blok-database-backlink-icon] > :last-child');

    expect(paths(page)).toEqual(paths(holder));
    drawer.destroy();
  });

  // research/23 §4: "scratch…" alone, "scratch… / BL1", "scratch… / ... / BL4". Pixel pitch shows the middle is three periods.
  it('shortens the path to the first page, "...", then the parent', () => {
    const items = [
      link('bl1', 'BL1', ['Scratch']),
      link('bl2', 'BL2', ['Scratch', 'BL1']),
      link('bl3', 'BL3', ['Scratch', 'BL1', 'BL2']),
      link('bl5', 'BL5', ['Scratch', 'BL1', 'BL2', 'BL3', 'BL4']),
    ];
    const drawer = new DatabaseCardDrawer(createOptions({ backlinks: () => items }));

    drawer.open(ROW);
    button()?.click();
    const path = (key: string): Element | null => q(`[data-blok-item-name="backlink-${key}"] [data-blok-database-backlink-path]`);

    expect(['bl1', 'bl2', 'bl3', 'bl5'].map((key) => path(key)?.textContent)).toEqual([
      'Scratch',
      'Scratch / BL1',
      'Scratch / ... / BL2',
      'Scratch / ... / BL4',
    ]);
    // The first page is cut by width on its own, so the parent stays readable.
    expect(path('bl5')?.querySelector('[data-blok-database-backlink-path-first]')?.textContent).toBe('Scratch');
    expect(path('bl5')?.hasAttribute('title')).toBe(false);
    drawer.destroy();
  });

  it('reads "No backlinks" or the count above the title in Customize layout (research/09 §6)', () => {
    const items: DrawerBacklink[] = [];
    const drawer = new DatabaseCardDrawer(createOptions({ backlinks: () => items, onPageLayoutChange: vi.fn(), onPageLayoutBirth: vi.fn() }));

    drawer.open(ROW);
    drawer.startCustomizing();

    const line = q('[data-blok-database-layout-backlinks]');

    expect(line?.textContent).toBe('No backlinks');
    expect(line?.nextElementSibling?.matches('[data-blok-database-layout-canvas-title]')).toBe(true);
    drawer.destroy();
  });

  it('keeps the open list when a refresh finds the same pages', () => {
    const items = [link('r2', 'Bravo')];
    const drawer = new DatabaseCardDrawer(createOptions({ backlinks: () => items }));

    drawer.open(ROW);
    const first = button();

    first?.click();
    drawer.refreshBacklinks();

    expect(button()).toBe(first);
    expect(q('[data-blok-database-backlinks-heading]')).not.toBeNull();
    drawer.destroy();
  });

  // research/23 §4: "7 backlinks" over 6 rows: the count is per mention, the list per page.
  it('counts every mention but lists each page once', () => {
    const items: DrawerBacklink[] = [{ ...link('bl1', 'BL1'), mentions: 2 }, link('bl5', 'BL5')];
    const drawer = new DatabaseCardDrawer(createOptions({ backlinks: () => items }));

    drawer.open(ROW);

    expect(button()?.textContent).toBe('3 backlinks');
    button()?.click();
    expect(document.querySelectorAll('[data-blok-popover-item][data-blok-item-name^="backlink-"]')).toHaveLength(2);
    drawer.destroy();
  });

  it('redraws the count when a page gains a second mention', () => {
    const items: DrawerBacklink[] = [link('bl1', 'BL1')];
    const drawer = new DatabaseCardDrawer(createOptions({ backlinks: () => items }));

    drawer.open(ROW);
    items[0] = { ...link('bl1', 'BL1'), mentions: 2 };
    drawer.refreshBacklinks();

    expect(button()?.textContent).toBe('2 backlinks');
    drawer.destroy();
  });

  it('counts mentions in Customize layout too', () => {
    const drawer = new DatabaseCardDrawer(createOptions({ backlinks: () => [{ ...link('bl1', 'BL1'), mentions: 2 }], onPageLayoutChange: vi.fn(), onPageLayoutBirth: vi.fn() }));

    drawer.open(ROW);
    drawer.startCustomizing();

    expect(q('[data-blok-database-layout-backlinks]')?.textContent).toBe('2 backlinks');
    drawer.destroy();
  });

  it('puts a new count after the cover for a reader whose head holds only the cover', () => {
    const items: DrawerBacklink[] = [];
    const drawer = new DatabaseCardDrawer(createOptions({ readOnly: true, backlinks: () => items }));

    drawer.open({ ...ROW, cover: 'https://example.com/cover.png' });
    items.push(link('r2', 'Bravo'));
    drawer.refreshBacklinks();

    const head = q('[data-blok-database-drawer-page-head]');

    expect(head?.firstElementChild?.hasAttribute('data-blok-database-drawer-cover')).toBe(true);
    expect(head?.lastElementChild?.hasAttribute('data-blok-database-drawer-backlinks')).toBe(true);
    expect(head?.childElementCount).toBe(2);
    drawer.destroy();
  });
});
