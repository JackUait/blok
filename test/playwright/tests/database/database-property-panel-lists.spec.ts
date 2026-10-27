/**
 * notion-spec-2 §16.1: the row page Edit property panel's Calculate and Number
 * format lists, and Type swapping the panel for the type list.
 */

import type { Page } from '@playwright/test';

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
        { id: 'p-amount', name: 'Amount', type: 'number', position: 'a1' },
        { id: 'p-next', name: 'Next', type: 'relation', position: 'a2', relation: { targetDatabaseId: 'db-1', twoWay: true, syncedPropertyId: 'p-prev' } },
        { id: 'p-prev', name: 'Prev', type: 'relation', position: 'a3', relation: { targetDatabaseId: 'db-1', twoWay: true, syncedPropertyId: 'p-next' } },
        { id: 'p-total', name: 'Total', type: 'rollup', position: 'a4', rollup: { relationPropertyId: 'p-next', targetPropertyId: 'p-amount', function: 'show_original' } },
      ],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-amount': 1 } } },
];

const openPanel = async (page: Page): Promise<void> => {
  await page.evaluate(async (input) => {
    const holder = document.createElement('div');

    holder.id = 'blok';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input }, tools: { database: { class: (window as unknown as Record<string, unknown>).BlokDatabase } } });
    await window.blokInstance.isReady;
  }, blocks);
  const row = page.getByRole('row', { name: /Alpha/ });

  await row.hover();
  await row.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('complementary', { name: 'Card details' }).getByRole('button', { name: 'Total', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Edit property' }).click();
};

const box = async (page: Page, name: string): Promise<{ x: number; y: number; width: number; height: number; right: number; bottom: number }> =>
  page.locator(`[data-blok-item-name="${name}"]`).evaluate(async (el) => {
    // The entrance scales the menu: measure once it ends.
    await Promise.all(el.closest('[data-blok-popover-container]')?.getAnimations().map((animation) => animation.finished) ?? []);
    const rect = el.getBoundingClientRect();

    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  });

/** The list holding `item`: its container's box. */
const listBox = async (page: Page, item: string): Promise<{ x: number; y: number; width: number; height: number }> =>
  page.locator(`[data-blok-item-name="${item}"]`).evaluate(async (el) => {
    const list = el.closest('[data-blok-popover-container]');

    // The entrance scales the list: measure once it ends.
    await Promise.all(list?.getAnimations().map((animation) => animation.finished) ?? []);
    const rect = list?.getBoundingClientRect();

    return { x: rect?.x ?? 0, y: rect?.y ?? 0, width: rect?.width ?? 0, height: rect?.height ?? 0 };
  });

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 717 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('Calculate is 200x152 under its row, rows 192x28 at 4px, 28 apart', async ({ page }) => {
  await openPanel(page);
  const row = await box(page, 'rollupFunction');

  await page.locator('[data-blok-item-name="rollupFunction"]').click();
  const list = await listBox(page, 'rollupFunction-show_original');
  const first = await box(page, 'rollupFunction-show_original');
  const second = await box(page, 'rollupFunction-show_unique');

  expect({ width: list.width, height: list.height }).toEqual({ width: 200, height: 152 });
  expect({ width: first.width, height: first.height }).toEqual({ width: 192, height: 28 });
  expect(first.x - list.x).toBe(4);
  expect(second.y - first.y).toBe(28);
  expect(list.x + list.width).toBe(row.right);
  expect(list.y).toBe(row.bottom);
});

test('Number format is 192 wide, its end edge on its row\'s', async ({ page }) => {
  await openPanel(page);
  const row = await box(page, 'numberFormat');

  await page.locator('[data-blok-item-name="numberFormat"]').click();
  const list = await listBox(page, 'format-number');

  expect(list.width).toBe(192);
  expect(list.x + list.width).toBe(row.right);
  // No format name is cut off at that width.
  const clipped = await page.locator('[data-blok-item-name^="format-"] [data-blok-popover-item-title]').evaluateAll((titles) =>
    titles.filter((title) => title.scrollWidth > title.clientWidth).map((title) => title.textContent));

  expect(clipped).toEqual([]);
});

test('Type swaps the panel for the type list, fitted in the window; Escape lands on the label menu', async ({ page }) => {
  await openPanel(page);
  const panel = await listBox(page, 'changeType');

  await page.locator('[data-blok-item-name="changeType"]').click();
  await expect(page.locator('[data-blok-item-name="changeType"]')).toHaveCount(0);
  const list = await listBox(page, 'type-text');

  expect(list.x).toBe(panel.x);
  expect(list.width).toBe(290);
  // Moved up so it ends 11px over the window's bottom edge.
  expect(list.y + list.height).toBe(717 - 11);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
  await expect(page.locator('[data-blok-item-name^="type-"]')).toHaveCount(0);
});
