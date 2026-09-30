import type { Page } from '@playwright/test';
import type { Blok } from '../../../../types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable]`;

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const createBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({
      holder,
      data: { blocks: [ { type: 'paragraph', data: { text: '' } } ] },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

const openToolbox = async (page: Page): Promise<void> => {
  const paragraph = page.locator(PARAGRAPH_SELECTOR);

  await paragraph.click();
  await paragraph.type('/');
  await expect(page.getByTestId('toolbox-popover').getByTestId('popover-container')).toBeVisible();
};

const option = (page: Page, name: string) => page.getByTestId('toolbox-popover').locator(`[data-blok-item-name="${name}"]`);

test.describe('Toolbox hover preview', () => {
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await createBlok(page);
  });

  test('does not show a card when the menu opens under a resting pointer', async ({ page }) => {
    await openToolbox(page);
    // Absence needs a window longer than the card's open delay (PREVIEW_OPEN_DELAY = 320ms).
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 600)));

    await expect(page.getByTestId('toolbox-preview')).toBeHidden();
  });

  test('shows the drawing and caption beside the hovered row', async ({ page }) => {
    await openToolbox(page);
    await option(page, 'header-1').hover();

    const card = page.getByTestId('toolbox-preview');

    await expect(card).toBeVisible();
    await expect(card).toContainText('Big section heading');

    const menu = await page.getByTestId('toolbox-popover').getByTestId('popover-container').boundingBox();
    const box = await card.boundingBox();

    expect(box && menu ? box.x >= menu.x + menu.width : false).toBe(true);
  });

  test('follows the pointer to the next row', async ({ page }) => {
    await openToolbox(page);
    await option(page, 'header-1').hover();
    await expect(page.getByTestId('toolbox-preview')).toContainText('Big section heading');
    await option(page, 'header-2').hover();

    await expect(page.getByTestId('toolbox-preview')).toContainText('Medium section heading');
  });

  test('follows keyboard focus', async ({ page }) => {
    await openToolbox(page);
    await page.keyboard.press('ArrowDown');

    await expect(page.getByTestId('toolbox-preview')).toBeVisible();
  });

  test('stays open while arrow keys scroll the menu list', async ({ page }) => {
    await openToolbox(page);

    const list = page.getByTestId('toolbox-popover').locator('[data-blok-popover-items]');
    const before = await list.evaluate((el) => el.scrollTop);

    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('ArrowDown');
    }

    expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
    await expect(page.getByTestId('toolbox-preview')).toBeVisible();
  });

  test('closes with the menu', async ({ page }) => {
    await openToolbox(page);
    await option(page, 'header-1').hover();
    await expect(page.getByTestId('toolbox-preview')).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('toolbox-preview')).toBeHidden();
  });
});
