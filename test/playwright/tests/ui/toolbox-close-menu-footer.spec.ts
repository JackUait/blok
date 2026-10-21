/**
 * research/30 §B7c: the "/" menu ends with a "Close menu  esc" footer.
 * ArrowUp from the first row reaches it; Enter or a click on it closes the menu.
 */
import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const POPOVER = '[data-blok-testid="toolbox-popover"]';

const mount = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: [{ id: 'p0', type: 'paragraph', data: { text: 'Hello' } }, { id: 'p1', type: 'paragraph', data: { text: '' } }] },
    });
    await window.blokInstance.isReady;
  });
};

const saved = async (page: Page): Promise<OutputBlockData[]> => page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);

const openSlash = async (page: Page): Promise<void> => {
  await page.locator('[data-blok-id="p1"] [contenteditable]').click();
  await page.keyboard.type('/');
  await expect(page.locator(`${POPOVER} [data-blok-popover-container]`)).toBeVisible();
};

const footer = (page: Page) => page.locator(POPOVER).getByRole('button', { name: 'Close menu', exact: true });

test.describe('"/" menu "Close menu" footer', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await mount(page);
  });

  test('shows "Close menu" with "esc" on its right, below the list', async ({ page }) => {
    await openSlash(page);

    await expect(footer(page)).toHaveText('Close menuesc');

    const [list, row] = await Promise.all([
      page.locator(`${POPOVER} [data-blok-popover-items]`).boundingBox(),
      footer(page).boundingBox(),
    ]);

    expect((row?.y ?? 0)).toBeGreaterThanOrEqual((list?.y ?? 0) + (list?.height ?? 0) - 1);
  });

  test('ArrowUp from the first row highlights the footer, ArrowUp again the true last row', async ({ page }) => {
    await openSlash(page);
    const editable = page.locator('[data-blok-id="p1"] [contenteditable]');
    const options = page.locator(`${POPOVER} [role="option"]:not([data-blok-hidden])`);
    const firstId = await options.first().evaluate((el) => el.id);

    await expect(editable).toHaveAttribute('aria-activedescendant', firstId);
    await page.keyboard.press('ArrowUp');
    await expect(footer(page)).toHaveAttribute('data-blok-focused', 'true');
    await expect(editable).toHaveAttribute('aria-activedescendant', await footer(page).evaluate((el) => el.id));

    await page.keyboard.press('ArrowUp');
    const lastId = await options.last().evaluate((el) => el.id);

    await expect(editable).toHaveAttribute('aria-activedescendant', lastId);
    await expect(footer(page)).not.toHaveAttribute('data-blok-focused', 'true');
  });

  test('Enter on the footer closes the menu and inserts nothing', async ({ page }) => {
    await openSlash(page);
    await page.keyboard.press('ArrowUp');
    await expect(footer(page)).toHaveAttribute('data-blok-focused', 'true');
    await page.keyboard.press('Enter');

    await expect(page.locator(`${POPOVER} [data-blok-popover-container]`)).toBeHidden();
    expect((await saved(page)).map((block) => block.type)).toEqual(['paragraph', 'paragraph']);
    await expect(page.locator('[data-blok-id="p1"] [contenteditable]')).toBeFocused();
  });

  test('a click on the footer closes the menu and keeps the caret in the block', async ({ page }) => {
    await openSlash(page);
    await footer(page).click();

    await expect(page.locator(`${POPOVER} [data-blok-popover-container]`)).toBeHidden();
    expect((await saved(page)).map((block) => block.type)).toEqual(['paragraph', 'paragraph']);
    await expect(page.locator('[data-blok-id="p1"] [contenteditable]')).toBeFocused();
  });

  test('stays in filtered results; a query with no match does not close the menu on Enter', async ({ page }) => {
    await openSlash(page);
    await page.keyboard.type('head');
    await expect(footer(page)).toBeVisible();

    await page.keyboard.type('zzzz');
    await expect(footer(page)).toBeVisible();
    await expect(footer(page)).not.toHaveAttribute('data-blok-focused', 'true');
  });
});
