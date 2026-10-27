/**
 * notion-spec-2 §17: the lists of the Edit property panel. A row with a value
 * drops a 250 wide list under itself, right edges aligned, items inset 4px,
 * 28px rows 1px apart and no gap after the last. A group row's submenu is
 * centred on its row.
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

const blocks: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-status', name: 'Status', type: 'status', position: 'a1' },
        { id: 'p-person', name: 'Person', type: 'person', position: 'a2' },
      ],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', data: { position: 'a0', properties: { 'p-title': 'Alpha' } } },
];

const mount = async (page: Page): Promise<void> => {
  await page.evaluate(async (input) => {
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, blocks);
  await expect(page.getByRole('grid')).toBeVisible();
};

const item = (page: Page, name: string): Locator => page.locator(`[data-blok-item-name="${name}"]`).last();
const listOf = (row: Locator): Locator => row.locator('xpath=ancestor::*[@data-blok-popover-container][1]');

/** Waits out the entrance, which scales the menus. */
const settled = async (page: Page): Promise<void> => {
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
};

interface ListBox { top: number; right: number; width: number; height: number; inset: number; rowBottom: number; rowRight: number }

/** Clicks `row`, then reads its list, which holds `first`. */
const openList = async (page: Page, row: string, first: string): Promise<ListBox> => {
  await item(page, row).click();
  await expect(item(page, first)).toBeVisible();
  await settled(page);
  const rowBox = await item(page, row).boundingBox();
  const list = await listOf(item(page, first)).boundingBox();
  const firstBox = await item(page, first).boundingBox();

  if (rowBox === null || list === null || firstBox === null) throw new Error('nothing measured');

  return {
    top: list.y, right: list.x + list.width, width: list.width, height: list.height, inset: firstBox.x - list.x,
    rowBottom: rowBox.y + rowBox.height, rowRight: rowBox.x + rowBox.width,
  };
};

const openPeekLabelMenu = async (page: Page, name: string): Promise<void> => {
  const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]');

  await row.hover();
  await row.locator('[data-blok-database-table-open]').click();
  await page.locator('[data-blok-database-drawer-prop-label][role="button"]', { hasText: name }).first().click();
  await expect(item(page, 'visibility')).toBeVisible();
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 717 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await mount(page);
});

test('a header Edit property list: 250 wide under its row, right aligned, 4px inset, 2 rows = 65 tall', async ({ page }) => {
  await page.locator('[role="columnheader"][data-property-id="p-person"]').click();
  await item(page, 'editProperty').hover();
  const box = await openList(page, 'limit', 'limit-one');

  expect(box.height).toBe(65);
  expect(box).toMatchObject({ width: 250, inset: 4 });
  expect(Math.abs(box.top - box.rowBottom)).toBeLessThan(1);
  expect(Math.abs(box.right - box.rowRight)).toBeLessThan(1);
});

test('a peek panel list keeps the list look: 4px inset, 2 rows = 65 tall', async ({ page }) => {
  await openPeekLabelMenu(page, 'Status');
  await item(page, 'editProperty').click();
  const box = await openList(page, 'displayAs', 'displayAs-checkbox');

  expect(box.height).toBe(65);
  expect(box).toMatchObject({ width: 250, inset: 4 });
  expect(Math.abs(box.right - box.rowRight)).toBeLessThan(1);
});

test('Property visibility opens on hover, 180 x 94, over the menu edge by 4px, centred on its row', async ({ page }) => {
  await openPeekLabelMenu(page, 'Status');
  const row = item(page, 'visibility');

  await row.hover();
  await expect(item(page, 'visibility-always')).toBeVisible();
  await settled(page);
  const rowBox = await row.boundingBox();
  const menu = await listOf(row).boundingBox();
  const list = await listOf(item(page, 'visibility-always')).boundingBox();

  if (rowBox === null || menu === null || list === null) throw new Error('nothing measured');
  expect(list.y + list.height / 2).toBeCloseTo(rowBox.y + rowBox.height / 2, 0);
  expect(list.x).toBeCloseTo(menu.x + menu.width - 4, 0);
  expect({ width: list.width, height: list.height }).toEqual({ width: 180, height: 94 });
});
