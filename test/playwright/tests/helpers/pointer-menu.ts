import type { Locator, Page } from '@playwright/test';

import { expect } from './shared-page';

/** The window height notion-motion.md Round 59 measured at. */
export const POINTER_MENU_WINDOW = { width: 1512, height: 717 };

/** Scrolls the page so `target`'s top sits at `y`, with room padded around the editor to scroll into. */
export const placeAt = async (page: Page, target: Locator, y: number): Promise<void> => {
  await page.evaluate(() => {
    const holder = document.getElementById('blok');

    if (holder !== null) Object.assign(holder.style, { paddingTop: '800px', paddingBottom: '800px' });
  });
  const box = await target.boundingBox();

  if (box === null) throw new Error('no target');
  await page.evaluate((delta) => window.scrollBy(0, delta), box.y - y);
  await expect.poll(async () => Math.round((await target.boundingBox())?.y ?? -1)).toBe(Math.round(y));
};

/**
 * Right-clicks `target` 8px under its top and checks notion-motion.md Round 59 §4: the menu's left is the
 * pointer's x; its top is y + 1 when it fits above the window's 12px bottom margin, else its bottom is y
 * when its top keeps 12, else its bottom sits 12 over the window's.
 */
export const expectPointerMenu = async (page: Page, target: Locator): Promise<{ y: number; top: number; height: number }> => {
  const box = await target.boundingBox();

  if (box === null) throw new Error('no target');
  const [x, y] = [Math.round(box.x + box.width / 2), Math.round(box.y + 8)];

  await page.mouse.click(x, y, { button: 'right' });
  await expect(page.locator('[data-blok-popover-opened]').getByPlaceholder('Search actions…')).toBeVisible();
  const menu = await page.locator('[data-blok-popover-opened] [data-blok-popover-container]').boundingBox();

  if (menu === null) throw new Error('no menu');
  const bottomEdge = POINTER_MENU_WINDOW.height - 12;

  expect(menu.x).toBeCloseTo(x, 0);
  if (y + 1 + menu.height <= bottomEdge) {
    expect(menu.y).toBeCloseTo(y + 1, 0);
  } else if (y - menu.height >= 12) {
    expect(menu.y + menu.height).toBeCloseTo(y, 0);
  } else {
    expect(menu.y + menu.height).toBeCloseTo(bottomEdge, 0);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-blok-database-menu-point]')).toHaveCount(0);
  await expect(page.locator('[data-blok-popover-opened]')).toHaveCount(0);

  return { y, top: menu.y, height: menu.height };
};
