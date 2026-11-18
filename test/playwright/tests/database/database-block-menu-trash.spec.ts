/**
 * The database block's ⋮⋮ menu and its Delete, against notion-motion.md Round 65 §1:
 * a 265 menu with 28px rows 29 apart, and a "Move database to Trash?" prompt
 * (324x181, the red button focused) before the block goes. No toast after.
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

const database = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', title: 'Alpha', properties: { 'p-title': 'Alpha' } } },
] as OutputBlockData[];

const mount = async (page: Page): Promise<void> => {
  await page.evaluate(async (input) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:240px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, database());
  await expect(page.getByRole('grid')).toBeVisible();
};

/** Lets the open scale finish: a box read mid-animation is the scaled one. */
const settle = (page: Page): Promise<unknown> => page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));

const openMenu = async (page: Page): Promise<void> => {
  await page.locator('[data-blok-database-title]').hover();
  await page.getByTestId('settings-toggler').first().click();
  await expect(page.getByTestId('block-tunes-popover').locator('[data-blok-popover-container]')).toBeVisible();
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 717 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await mount(page);
});

test('the database block menu is 265 wide with 28px rows 29 apart', async ({ page }) => {
  await openMenu(page);
  await settle(page);
  const menu = page.getByTestId('block-tunes-popover');
  const box = await menu.locator('[data-blok-popover-container]').boundingBox();
  const rows = await menu.locator('[data-blok-popover-item]:visible').evaluateAll((items) => items.map((item) => {
    const rect = item.getBoundingClientRect();

    return { y: rect.y, height: rect.height, name: item.getAttribute('data-blok-item-name') };
  }));
  const lock = rows.findIndex((row) => row.name === 'database-lock');

  expect(box?.width).toBe(265);
  expect(rows.every((row) => row.height === 28)).toBe(true);
  expect(rows[lock + 1].y - rows[lock].y).toBe(29);
});

test('Delete asks first; Move to Trash removes it with no toast, and undo brings it back', async ({ page }) => {
  await openMenu(page);
  await page.getByTestId('block-tunes-popover').locator('[data-blok-item-name="delete"]').click();

  const dialog = page.getByRole('alertdialog', { name: 'Move database to Trash?' });

  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('block-tunes-popover').locator('[data-blok-popover-container]')).toBeHidden();
  await settle(page);
  const box = await page.locator('[data-blok-database-confirm-dialog]').boundingBox();

  expect(box?.width).toBe(324);
  expect(box?.height).toBe(181);
  await expect(dialog.getByRole('button', { name: 'Move to Trash' })).toBeFocused();

  await page.keyboard.press('Enter');

  await expect(page.locator('[data-blok-database-title]')).toHaveCount(0);
  await expect(page.locator('[aria-live]', { hasText: '1 block deleted' }).first()).toBeAttached();
  await expect(page.getByText('Moved to Trash')).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('[data-blok-database-title]')).toHaveText('Tasks');
});

test('Cancel keeps the database', async ({ page }) => {
  await openMenu(page);
  await page.getByTestId('block-tunes-popover').locator('[data-blok-item-name="delete"]').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.locator('[data-blok-database-title]')).toHaveText('Tasks');
});
