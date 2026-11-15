/**
 * The Add view menu opened with the pointer: its first tile is the keyboard
 * cursor (notion-motion.md Round 15 §A), so the arrows move on from it.
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
      schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v0', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
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
    holder.style.cssText = 'max-width:692px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, { data: blocks });
  await expect(page.getByRole('grid')).toBeVisible();
};

const savedViewTypes = (page: Page): Promise<string[]> => page.evaluate(async () => {
  const saved = await window.blokInstance?.save();
  const views = (saved?.blocks.find((block) => block.type === 'database')?.data as { views: Array<{ type: string; position: string }> }).views;

  return [...views].sort((a, b) => (a.position < b.position ? -1 : 1)).map((view) => view.type);
});

/** Tiles painted with a fill. */
const filledTiles = (page: Page): Promise<string[]> => page.evaluate(() =>
  [...document.querySelectorAll<HTMLElement>('[data-blok-database-view-option]')]
    .filter((tile) => getComputedStyle(tile).backgroundColor !== 'rgba(0, 0, 0, 0)')
    .map((tile) => tile.getAttribute('data-blok-database-view-option') ?? ''));

/** Tiles or tile wrappers drawing an outline or a box-shadow ring. */
const ringedTiles = (page: Page): Promise<string[]> => page.evaluate(() =>
  [...document.querySelectorAll<HTMLElement>('[data-blok-database-view-option]')]
    .filter((tile) => [tile, tile.parentElement].some((el) => {
      if (el === null) return false;
      const style = getComputedStyle(el);

      return (style.outlineStyle !== 'none' && style.outlineWidth !== '0px') || style.boxShadow !== 'none';
    }))
    .map((tile) => tile.getAttribute('data-blok-database-view-option') ?? ''));

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 717 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('Add view menu opened with the pointer', () => {
  test('an arrow moves the fill on from the first tile, and Enter adds that view', async ({ page }) => {
    await mount(page);
    await page.getByRole('grid').hover();
    await page.getByRole('button', { name: 'Add view' }).click();
    const table = page.locator('[data-blok-database-view-option="table"]');

    await expect(table).toBeVisible();
    await expect.poll(() => filledTiles(page)).toEqual(['table']);
    expect(await ringedTiles(page)).toEqual([]);

    await page.keyboard.press('ArrowDown');
    await expect.poll(() => filledTiles(page)).toEqual(['chart']);

    await page.keyboard.press('ArrowUp');
    await expect.poll(() => filledTiles(page)).toEqual(['table']);

    await page.keyboard.press('ArrowRight');
    await expect.poll(() => filledTiles(page)).toEqual(['board']);

    await page.keyboard.press('Enter');
    await expect(table).toBeHidden();
    await expect.poll(() => savedViewTypes(page)).toEqual(['table', 'board']);
  });

  // notion-motion.md Round 42 §5 (r42-av-open.raw): a 4-column grid; Right is reading order and wraps through New data source.
  test('the arrows move the fill across the 4-column grid as in Notion', async ({ page }) => {
    await mount(page);
    await page.getByRole('grid').hover();
    await page.getByRole('button', { name: 'Add view' }).click();
    await expect.poll(() => filledTiles(page)).toEqual(['table']);
    await page.mouse.move(5, 5);

    const press = async (key: string, expected: string): Promise<void> => {
      await page.keyboard.press(key);
      await expect.poll(() => filledTiles(page), { message: `${key} → ${expected}` }).toEqual([expected]);
    };

    await press('ArrowRight', 'board');
    await press('ArrowDown', 'dashboard');
    await press('ArrowDown', 'calendar');
    await press('ArrowDown', 'new-source');
    await press('ArrowUp', 'map');
    await press('ArrowRight', 'calendar');
    await press('ArrowRight', 'form');
    await press('ArrowRight', 'new-source');
    await press('ArrowRight', 'table');
    await press('ArrowRight', 'board');
    await press('ArrowRight', 'gallery');
    await press('ArrowDown', 'timeline');
    await press('ArrowLeft', 'dashboard');
    await press('ArrowUp', 'board');
  });

  test('the first tile keeps its fill while the pointer rests on another', async ({ page }) => {
    await mount(page);
    await page.getByRole('grid').hover();
    await page.getByRole('button', { name: 'Add view' }).click();
    const list = page.locator('[data-blok-database-view-option="list"]');

    await list.hover();
    await expect.poll(() => filledTiles(page)).toEqual(['table', 'list']);
  });
});
