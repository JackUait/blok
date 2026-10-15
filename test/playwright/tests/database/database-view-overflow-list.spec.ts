/**
 * The "N more…" view list (research/13-notion-tabs-extras.md:81-82): a
 * "Search for a view..." field, every view with a drag handle and "•••",
 * then "New view".
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

const NAMES = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];

const BLOCKS: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
      views: NAMES.map((name, i) => ({
        id: `v${i}`, name, type: 'table', position: `a${i}`, sorts: [], filters: [], visibleProperties: [],
      })),
      activeViewId: 'v0',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', data: { position: 'a0', properties: { 'p-title': 'Alpha' } } },
];

const mount = async (page: Page): Promise<void> => {
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
  }, { data: BLOCKS });
  await expect(page.getByRole('grid')).toBeVisible();
};

const savedViewNames = (page: Page): Promise<string[]> => page.evaluate(async () => {
  const saved = await window.blokInstance?.save();
  const views = (saved?.blocks.find((block) => block.type === 'database')?.data as { views: Array<{ name: string; position: string }> }).views;

  return [...views].sort((a, b) => (a.position < b.position ? -1 : 1)).map((view) => view.name);
});

const openList = async (page: Page): Promise<Locator> => {
  await page.getByRole('button', { name: /more…$/ }).click();
  const list = page.locator('[data-blok-database-tab-overflow-dropdown]');

  await expect(list).toBeVisible();

  return list;
};

const rowOf = (list: Locator, name: string): Locator =>
  list.locator('[data-blok-database-tab-overflow-item]').filter({ hasText: name });

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('database view overflow list', () => {
  test('lists every view under a focused search field, then New view', async ({ page }) => {
    await mount(page);
    const list = await openList(page);
    const search = list.getByPlaceholder('Search for a view...');

    await expect(search).toBeFocused();
    for (const name of NAMES) {
      await expect(rowOf(list, name)).toBeVisible();
    }
    await expect(list.getByRole('button', { name: 'Drag to reorder' })).toHaveCount(NAMES.length);
    await expect(list.getByRole('button', { name: 'More actions' })).toHaveCount(NAMES.length);
    await expect(list.getByRole('button', { name: 'New view' })).toBeVisible();
  });

  test('search narrows the rows by name', async ({ page }) => {
    await mount(page);
    const list = await openList(page);

    await list.getByPlaceholder('Search for a view...').fill('seve');

    await expect(rowOf(list, 'Seventh')).toBeVisible();
    await expect(rowOf(list, 'First')).toBeHidden();
    await expect(rowOf(list, 'Eighth')).toBeHidden();
    await expect(list.getByRole('button', { name: 'New view' })).toBeVisible();
  });

  test('"•••" opens the view menu and Rename renames the view in its row', async ({ page }) => {
    await mount(page);
    const list = await openList(page);

    await rowOf(list, 'Eighth').getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const input = list.getByRole('textbox', { name: 'Rename' });

    await expect(input).toBeFocused();
    await input.fill('Renamed');
    await input.press('Enter');

    await expect.poll(() => savedViewNames(page)).toContain('Renamed');
    expect(await savedViewNames(page)).not.toContain('Eighth');
  });

  test('one Escape closes the row menu, the next closes the list', async ({ page }) => {
    await mount(page);
    const list = await openList(page);

    await rowOf(list, 'Third').getByRole('button', { name: 'More actions' }).click();
    const rename = page.getByRole('menuitem', { name: 'Rename' });

    await expect(rename).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(rename).toBeHidden();
    await expect(list).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
  });

  test('dragging a row by its handle reorders the tabs', async ({ page }) => {
    await mount(page);
    const list = await openList(page);
    const handle = rowOf(list, 'Eighth').getByRole('button', { name: 'Drag to reorder' });
    const target = await rowOf(list, 'First').boundingBox();
    const from = await handle.boundingBox();

    expect(target).not.toBeNull();
    expect(from).not.toBeNull();
    if (target === null || from === null) {
      return;
    }
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, target.y + 4, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => (await savedViewNames(page))[0]).toBe('Eighth');
    await expect(page.getByRole('tab').first()).toHaveAccessibleName(/Eighth/);
  });
});
