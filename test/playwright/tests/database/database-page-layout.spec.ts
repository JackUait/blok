/**
 * The row page layout, shared by every row of a database.
 * - Layouts: https://www.notion.com/help/layouts (pins up to 15, sections,
 *   details panel, modules, Simple/Tabbed, Apply to all pages, reset)
 * Notion's layout builder was not measured, so this checks behaviour only.
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const blocks = (title: Record<string, unknown> = {}): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0', ...title },
        { id: 'p-due', name: 'Due', type: 'text', position: 'a1' },
        { id: 'p-owner', name: 'Owner', type: 'text', position: 'a2' },
      ],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-due': 'Friday', 'p-owner': 'Ada' } } },
  { id: 'r2', type: 'database-row', parent: 'db-1', data: { position: 'a1', properties: { 'p-title': 'Bravo', 'p-due': 'Monday', 'p-owner': 'Bo' } } },
];

const mount = async (page: Page, data: OutputBlockData[], dir: 'ltr' | 'rtl' = 'ltr'): Promise<void> => {
  await page.evaluate(async ({ data: input, dir: direction }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input }, i18n: { direction } });
    await window.blokInstance.isReady;
  }, { data, dir });
  await expect(page.getByRole('grid')).toBeVisible();
};

const savedTitle = async (page: Page): Promise<Record<string, unknown> | undefined> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();
  const database = output?.blocks.find((block) => block.id === 'db-1');
  const schema = (database?.data as { schema?: Array<Record<string, unknown>> } | undefined)?.schema ?? [];

  return schema.find((property) => property.type === 'title');
});

const openRow = async (page: Page, rowId: string): Promise<void> => {
  const row = page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"]`);

  await row.hover();
  await row.locator('[data-blok-database-table-open]').click();
};

const peek = (page: Page): Locator => page.locator('[data-blok-database-drawer]');

const layoutBounds = async (page: Page): Promise<Record<'panelLeft' | 'panelRight' | 'panelTop' | 'groupLeft' | 'groupRight' | 'groupBottom', number>> =>
  peek(page).evaluate((drawer) => {
    const panel = drawer.querySelector('[data-blok-database-drawer-details]');
    const group = drawer.querySelector('[data-blok-database-drawer-props]');

    if (panel === null || group === null) throw new Error('missing layout regions');
    const p = panel.getBoundingClientRect();
    const g = group.getBoundingClientRect();

    return { panelLeft: p.left, panelRight: p.right, panelTop: p.top, groupLeft: g.left, groupRight: g.right, groupBottom: g.bottom };
  });

const pins = (page: Page): Locator => peek(page).locator('[data-blok-database-drawer-pins]');

const layoutMenu = async (page: Page, propertyId: string): Promise<void> => {
  await peek(page).locator(`[data-blok-database-layout-item-menu][data-property-id="${propertyId}"]`).click();
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('row page layout', () => {
  test('pins a property for every page with Apply to all pages', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');

    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    await expect(peek(page).getByRole('toolbar', { name: 'Customize layout' })).toBeVisible();

    await layoutMenu(page, 'p-due');
    await page.getByRole('menuitem', { name: 'Pin to heading' }).click();
    await expect(pins(page).locator('[data-blok-database-drawer-prop-value][data-property-id="p-due"]')).toContainText('Friday');
    expect((await savedTitle(page))?.pageLayoutPlacements).toEqual([]);

    await peek(page).getByRole('button', { name: 'Apply to all pages' }).click();
    await expect(peek(page).getByRole('toolbar', { name: 'Customize layout' })).toBeHidden();
    expect((await savedTitle(page))?.pageLayoutPlacements).toEqual([{ id: 'p-due', place: 'heading' }]);

    await page.keyboard.press('Escape');
    await openRow(page, 'r2');
    await expect(pins(page).locator('[data-blok-database-drawer-prop-value][data-property-id="p-due"]')).toContainText('Monday');
  });

  test('folds a named section and opens and closes the details panel', async ({ page }) => {
    await mount(page, blocks({
      pageLayoutSections: [{ id: 's1', name: 'Planning' }],
      pageLayoutPlacements: [{ id: 'p-due', place: 'section', sectionId: 's1' }, { id: 'p-owner', place: 'panel' }],
    }));
    await openRow(page, 'r1');

    const section = peek(page).getByRole('button', { name: 'Planning' });

    await expect(section).toHaveAttribute('aria-expanded', 'true');
    await expect(peek(page).locator('[data-blok-database-drawer-section] [data-blok-database-drawer-prop-value][data-property-id="p-due"]')).toBeVisible();
    await section.click();
    await expect(section).toHaveAttribute('aria-expanded', 'false');
    await expect(peek(page).locator('[data-blok-database-drawer-section] [data-blok-database-drawer-prop-value][data-property-id="p-due"]')).toBeHidden();

    const details = peek(page).getByRole('region', { name: 'Details' });

    await expect(details).toContainText('Ada');
    await peek(page).getByRole('button', { name: 'View details' }).click();
    await expect(details).toBeHidden();
  });

  test('places the details panel to the right of the page properties', async ({ page }) => {
    await mount(page, blocks({ pageLayoutPlacements: [{ id: 'p-owner', place: 'panel' }] }));
    await openRow(page, 'r1');
    const details = peek(page).getByRole('region', { name: 'Details' });
    const properties = peek(page).locator('[data-blok-database-drawer-props]');

    await expect(details).toBeVisible();
    await expect(properties).toBeVisible();
    const bounds = await layoutBounds(page);

    expect(bounds.panelLeft).toBeGreaterThanOrEqual(bounds.groupRight - 1);
    expect(bounds.panelTop).toBeLessThan(bounds.groupBottom);
    await peek(page).getByRole('button', { name: 'View details' }).click();
    await expect(details).toBeHidden();
  });

  test('mirrors the details panel to the left of the page properties in RTL', async ({ page }) => {
    await mount(page, blocks({ pageLayoutPlacements: [{ id: 'p-owner', place: 'panel' }] }), 'rtl');
    await openRow(page, 'r1');
    await expect(peek(page).getByRole('region', { name: 'Details' })).toBeVisible();
    const bounds = await layoutBounds(page);

    expect(bounds.panelRight).toBeLessThanOrEqual(bounds.groupLeft + 1);
    expect(bounds.panelTop).toBeLessThan(bounds.groupBottom);
  });

  // Notion's narrow-width behaviour was not measured; Blok stacks the panel below.
  test('stacks the details panel below the page properties when the page is narrow', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 900 });
    await mount(page, blocks({ pageLayoutPlacements: [{ id: 'p-owner', place: 'panel' }] }));
    await openRow(page, 'r1');
    await expect(peek(page).getByRole('region', { name: 'Details' })).toBeVisible();
    const bounds = await layoutBounds(page);

    expect(bounds.panelTop).toBeGreaterThanOrEqual(bounds.groupBottom - 1);
  });

  test('switches to a Tabbed page from Page settings and resets to the original layout', async ({ page }) => {
    await mount(page, blocks({ pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }], pageLayoutSections: [] }));
    await openRow(page, 'r1');
    await expect(pins(page)).toBeVisible();

    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    await peek(page).getByRole('button', { name: 'Page settings' }).click();
    await page.getByRole('menuitem', { name: 'Tabbed' }).click();
    await expect(peek(page).getByRole('tablist')).toBeVisible();
    await expect(peek(page).getByRole('tab', { name: 'Content' })).toHaveAttribute('aria-selected', 'true');

    await peek(page).getByRole('button', { name: 'Page settings' }).click();
    await page.getByRole('menuitem', { name: /Reset to original page layout/ }).click();

    await expect(pins(page)).toHaveCount(0);
    await expect(peek(page).getByRole('tablist')).toHaveCount(0);
    expect(await savedTitle(page)).toMatchObject({ pageLayoutPlacements: [], pageLayoutSections: [] });
  });
});
