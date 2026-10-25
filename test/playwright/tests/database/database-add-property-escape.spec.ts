/**
 * Notion: one Escape in the row page's add-property menu closes the menu only.
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

const BLOCKS: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
        {
          id: 'prop-status',
          name: 'Status',
          type: 'select',
          position: 'a1',
          config: { options: [{ id: 'opt-a', label: 'A', color: 'gray', position: 'a0' }] },
        },
      ],
      views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: ['prop-title'] }],
      activeViewId: 'view-1',
    },
    content: ['row-1'],
  },
  { id: 'row-1', type: 'database-row', data: { position: 'a0', properties: { 'prop-title': 'Gamma', 'prop-status': 'opt-a' } } },
];

const createBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async (data) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();

    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:760px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, BLOCKS);
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('one Escape closes the add-property menu and keeps the row page open', async ({ page }) => {
  await createBlok(page);
  await page.locator('[data-blok-database-card]').first().click();
  const peek = page.locator('[data-blok-database-drawer][data-open]');

  await expect(peek).toBeVisible();
  await page.locator('[data-blok-database-drawer-add-prop]').click();
  const menu = page.locator('[data-blok-database-property-type-popover]');

  await expect(page.getByPlaceholder('Property name')).toBeFocused();
  await page.keyboard.press('Escape');

  await expect(menu).toHaveCount(0);
  await expect(peek).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(peek).toHaveCount(0);
});
