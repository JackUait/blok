/**
 * The block handle (+ ⋮⋮) stays beside the block's content column when the
 * page changes width under it, without a new hover (the side peek narrows the page over 200ms).
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

const WINDOW_WIDTH = 1400;
const PEEK_WIDTH = 756;

const BLOCKS: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-notes', name: 'Notes', type: 'text', position: 'a1' },
      ],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', data: { position: 'a0', properties: { 'p-title': 'Alpha' } } },
  { id: 'r2', type: 'database-row', data: { position: 'a1', properties: { 'p-title': 'Bravo' } } },
];

const mount = async (page: Page): Promise<void> => {
  await page.evaluate(async (blocks) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    // Full width, so the wide page centres the column and the narrow one does not.
    holder.style.cssText = 'margin:40px 0 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks } });
    await window.blokInstance.isReady;
  }, BLOCKS);
  await expect(page.locator('[data-blok-database-wrapper]')).toBeVisible();
};

/** How far the handle's end sits from the start of the column it belongs to (the database title). */
const handleGap = async (page: Page): Promise<number> => {
  const actions = await page.getByTestId('toolbar-actions').boundingBox();
  const title = await page.locator('[data-blok-database-title]').first().boundingBox();

  if (actions === null || title === null) {
    return Number.NaN;
  }

  return Math.round(title.x - (actions.x + actions.width));
};

const databaseEnd = async (database: Locator): Promise<number> => {
  const box = await database.boundingBox();

  return Math.round((box?.x ?? 0) + (box?.width ?? 0));
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: WINDOW_WIDTH, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('the block handle follows the content column as the side peek narrows and widens the page', async ({ page }) => {
  await mount(page);
  const database = page.locator('[data-blok-database-wrapper]');
  const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]');
  const openButton = (): Locator => page.locator('[data-blok-database-table-open]').filter({ visible: true }).first();

  await row.hover();
  await expect(page.getByTestId('toolbar-actions')).toBeVisible();
  const wideGap = await handleGap(page);
  const wideTitleStart = (await page.locator('[data-blok-database-title]').first().boundingBox())?.x ?? 0;

  await openButton().click();
  await expect.poll(() => databaseEnd(database)).toBe(WINDOW_WIDTH - PEEK_WIDTH);
  // The column moved: without this the check below would pass on an unmoved page.
  await expect.poll(async () => (await page.locator('[data-blok-database-title]').first().boundingBox())?.x ?? 0).toBeLessThan(wideTitleStart - 100);

  await expect.poll(() => handleGap(page)).toBe(wideGap);

  await openButton().click();
  await expect(page.locator('[data-blok-database-drawer]')).toHaveCount(0);
  await expect.poll(() => databaseEnd(database)).toBeGreaterThan(WINDOW_WIDTH - 50);

  await expect.poll(() => handleGap(page)).toBe(wideGap);
});
