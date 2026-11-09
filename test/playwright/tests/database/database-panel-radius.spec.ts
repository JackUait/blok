/**
 * Database menus have Notion's 10px corner; cell editors keep 6px.
 * research/08 "View settings panel": menus 10px, cell popovers 6px.
 * research/08 Filter: the filter popover is 10px. research/21 §1a: menu / popover 10px in both themes.
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

const BLOCKS: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-notes', name: 'Notes', type: 'text', position: 'a1' },
      ],
      views: [{
        id: 'v1',
        name: 'Table',
        type: 'table',
        position: 'a0',
        sorts: [],
        filters: [],
        visibleProperties: [],
        properties: [{ id: 'p-title', visible: true, width: 280 }, { id: 'p-notes', visible: true, width: 200 }],
      }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-notes': 'short' } } },
];

const mount = async (page: Page): Promise<void> => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async (data) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1400px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, BLOCKS);
  await expect(page.getByRole('grid').first()).toBeVisible();
};

const panelBox = (page: Page, testId: string): Locator =>
  page.locator(`[data-blok-popover-container]:has([data-blok-testid="${testId}"])`);

const editorBox = (page: Page): Locator =>
  page.locator('[data-blok-popover-container]:has([data-blok-database-cell-editor]:not([data-blok-database-panel]))');

const radius = async (box: Locator): Promise<string> => {
  await expect(box).toBeVisible();

  return box.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 717 });
  await mount(page);
});

test('the Filter property menu and the filter rule popover are 10px, like Notion\'s menus', async ({ page }) => {
  await page.getByRole('button', { name: 'Filter', exact: true }).first().click();

  const picker = page.locator('[data-blok-popover-container]:has([data-blok-database-panel])');

  expect(await radius(picker)).toBe('10px');

  await picker.getByText('Notes', { exact: true }).click();

  expect(await radius(panelBox(page, 'database-filter-popover'))).toBe('10px');
});

test('the Sort property menu is 10px', async ({ page }) => {
  await page.getByRole('button', { name: 'Sort', exact: true }).first().click();

  expect(await radius(page.locator('[data-blok-popover-container]:has([data-blok-database-panel])'))).toBe('10px');
});

test('a cell editor keeps its 6px corner', async ({ page }) => {
  await page.locator('[role="gridcell"][data-property-id="p-notes"]').click();
  if (await editorBox(page).count() === 0) {
    await page.keyboard.press('Enter');
  }

  expect(await radius(editorBox(page))).toBe('6px');
});
