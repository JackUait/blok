/**
 * notion-motion.md Round 28 §1 (r28-narrowpill*.raw): in a 100px title column OPEN is a 30x24 frame around a
 * 26x20 button. Only the inner button takes the hover fill and opens the page; a click on the 2px frame edits
 * the title instead.
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
      title: 'Tasks',
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-text', name: 'Text', type: 'text', position: 'a1' },
      ],
      views: [{
        id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [],
        properties: [{ id: 'p-title', visible: true, width: 100 }, { id: 'p-text', visible: true, width: 200 }],
      }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha' } } },
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
    holder.style.cssText = 'width:1000px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, blocks);
};

const open = (page: Page): Locator => page.locator('[data-row-id="r1"] [data-blok-database-table-open]');
const inner = (page: Page): Locator => open(page).locator('> span[aria-hidden="true"]');

const box = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const b = await locator.boundingBox();

  if (b === null) throw new Error('no box');

  return b;
};

/** Shows the pill: the pointer rests on the title text, away from the pill. */
const showPill = async (page: Page): Promise<void> => {
  const title = await box(page.locator('[data-row-id="r1"] [data-property-id="p-title"]'));

  await page.mouse.move(title.x + 4, title.y + title.height / 2);
  await expect(open(page)).toBeVisible();
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 717 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await mount(page);
  await showPill(page);
});

test('the pill is a 30x24 frame around a 26x20 button', async ({ page }) => {
  const frame = await box(open(page));
  const button = await box(inner(page));

  expect([frame.width, frame.height]).toEqual([30, 24]);
  expect([button.width, button.height]).toEqual([26, 20]);
  expect([button.x - frame.x, button.y - frame.y]).toEqual([2, 2]);
});

test('only the inner button takes the hover fill', async ({ page }) => {
  const frame = await box(open(page));

  await page.mouse.move(frame.x + 1, frame.y + frame.height / 2);
  await expect(inner(page)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(open(page)).toHaveCSS('background-image', 'none');

  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await expect(inner(page)).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(open(page)).toHaveCSS('background-image', 'none');
});

test('a click on the frame edge does not open the page', async ({ page }) => {
  const frame = await box(open(page));

  await page.mouse.click(frame.x + 1, frame.y + frame.height / 2);
  await expect(page.locator('[data-blok-database-cell-input="title"]')).toBeFocused();
  await expect(page.locator('[data-blok-database-drawer][data-open]')).toHaveCount(0);
});

test('a click on the inner button opens the page', async ({ page }) => {
  const button = await box(inner(page));

  await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
  await expect(page.locator('[data-blok-database-drawer][data-open]')).toBeVisible();
});
