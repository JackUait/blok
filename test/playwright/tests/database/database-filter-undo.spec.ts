/**
 * notion-motion.md Round 64: a filter's add and its value undo with the real
 * keys, one step each, and an undone delete selects a List row again.
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

const SCHEMA = [
  { id: 't', name: 'Name', type: 'title', position: 'a0' },
  { id: 'c', name: 'Done', type: 'checkbox', position: 'a1' },
];

const blocks = (type: string): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{ id: 'v', name: 'View', type, position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { position: 'a0', properties: { t: 'Alpha', c: true } } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { position: 'a1', properties: { t: 'Beta', c: false } } },
];

const mount = async (page: Page, type: string): Promise<void> => {
  await page.evaluate(async ({ data }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, { data: blocks(type) });
};

const tableRows = (page: Page): Locator => page.locator('[data-blok-database-table-row]');
const chips = (page: Page): Locator => page.locator('[data-blok-database-filter-bar] [data-blok-testid^="database-filter-pill"]');

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('filter undo', () => {
  test('undoes the value, then the chip, and redoes both', async ({ page }) => {
    await mount(page, 'table');
    await expect(tableRows(page)).toHaveCount(2);

    await page.getByTestId('database-toolbar-filter').click();
    await page.getByTestId('database-pick-property-c').click();
    await page.getByTestId('database-filter-checkbox-true').click();
    await expect(tableRows(page)).toHaveCount(1);
    await page.keyboard.press('Escape');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(tableRows(page)).toHaveCount(2);
    await expect(chips(page)).toHaveCount(1);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(chips(page)).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(chips(page)).toHaveCount(1);
    await expect(tableRows(page)).toHaveCount(2);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(tableRows(page)).toHaveCount(1);
  });
});

test.describe('undo selection outside tables', () => {
  test('selects the List row an undone delete brings back', async ({ page }) => {
    await mount(page, 'list');
    const beta = page.locator('[data-blok-database-list-row][data-row-id="r2"]');

    await expect(beta).toBeVisible();
    await page.evaluate(async () => {
      const blok = window.blokInstance;
      const at = blok?.blocks.getBlockIndex('r2');

      if (blok === undefined || at === undefined) throw new Error('no r2');
      await blok.blocks.delete(at);
    });
    await expect(beta).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+z');

    await expect(beta).toHaveAttribute('data-blok-database-row-selected', '');
  });
});
