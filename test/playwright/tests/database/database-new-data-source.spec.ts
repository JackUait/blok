/**
 * "New data source" (research/23 §10): a second source inside one database
 * block, with its own schema and rows, and a Table view bound to it.
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

const NAMES = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];

const initial: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Projects',
      schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
      views: NAMES.map((name, i) => ({
        id: `v${i}`, name, type: 'table', position: `a${i}`, sorts: [], filters: [], visibleProperties: [],
      })),
      activeViewId: 'v0',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha' } } },
];

const mount = async (page: Page, blocks: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async ({ data }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:520px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, { data: blocks });
  await expect(page.getByRole('grid')).toBeVisible();
};

const save = (page: Page): Promise<OutputBlockData[]> =>
  page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);

const openList = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: /more…$/ }).click();
  await expect(page.locator('[data-blok-database-tab-overflow-dropdown]')).toBeVisible();
};

const grid = (page: Page) => page.getByRole('grid');

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('database New data source', () => {
  test('a second source keeps its own rows and property through views and a reload', async ({ page }) => {
    await mount(page, initial);
    await openList(page);
    await page.getByRole('option', { name: 'New data source' }).click();

    // The new Table view is selected and shows only the title property.
    await expect(grid(page).getByRole('columnheader')).toHaveCount(1);
    await expect(grid(page)).not.toContainText('Alpha');
    // The title line is the new source's: empty, so it shows the placeholder.
    await expect(page.locator('[data-blok-database-source-title]')).toHaveAttribute('data-placeholder', 'New data source');
    await expect(page.locator('[data-blok-database-source-title]')).not.toHaveAttribute('hidden', '');
    await expect(page.getByRole('tab', { name: 'Table' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Table' })).toBeVisible();

    // A row and a property on the new source.
    await grid(page).locator('[data-blok-database-table-add-row]').first().click();
    await expect(page.locator('[data-blok-database-cell-editor]')).toBeVisible();
    await page.keyboard.type('Beta');
    await page.keyboard.press('Enter');
    await expect(grid(page)).toContainText('Beta');
    await grid(page).locator('[data-blok-database-table-add-property]').click();
    await page.locator('[data-blok-database-property-type-option="text"]').click();
    await page.keyboard.press('Escape');
    await expect(grid(page).getByRole('columnheader')).toHaveCount(2);
    await expect(grid(page)).toContainText('Beta');

    // Back on the first source: its own row, its one property.
    await page.getByRole('tab', { name: 'First' }).click();
    await expect(grid(page)).toContainText('Alpha');
    await expect(grid(page)).not.toContainText('Beta');
    await expect(grid(page).getByRole('columnheader')).toHaveCount(1);

    // save → render.
    const saved = await save(page);
    const source = saved.find((block) => block.type === 'database' && block.id !== 'db-1');

    expect(source).toBeDefined();
    expect(saved.filter((block) => block.type === 'database-row' && block.parent === source?.id)).toHaveLength(1);
    await mount(page, saved);
    await expect(grid(page)).toContainText('Alpha');

    await openList(page);
    await page.locator('[data-blok-database-tab-overflow-item]').last().click();
    await expect(grid(page)).toContainText('Beta');
    await expect(grid(page)).not.toContainText('Alpha');
    await expect(grid(page).getByRole('columnheader')).toHaveCount(2);
  });
});
