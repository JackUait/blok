import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '../../../../types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable]`;
const PLUS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;
const SETTINGS_TOGGLER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const TOOLBOX_POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"] [data-blok-testid="popover-container"]';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const resetBlok = async (page: Page): Promise<void> => {
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
  }, { holder: HOLDER_ID });
};

const createBlokWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokBlocks }) => {
      const blok = new window.Blok({
        holder,
        data: { blocks: blokBlocks },
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks }
  );
};

test.describe('toolbox open hides plus and settings-toggler buttons', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('clicking the plus button hides the plus and dots buttons while the toolbox is open', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: 'Hover me' } },
    ]);

    const block = page.locator(PARAGRAPH_SELECTOR, { hasText: 'Hover me' });

    await block.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);
    const settingsToggler = page.locator(SETTINGS_TOGGLER_SELECTOR);

    await expect(plusButton).toBeVisible();
    await expect(settingsToggler).toBeVisible();

    await plusButton.click();

    const toolbox = page.locator(TOOLBOX_POPOVER_SELECTOR);

    await expect(toolbox).toBeVisible();

    await expect(plusButton).toBeHidden();
    await expect(settingsToggler).toBeHidden();
  });

  test('typing slash in an empty paragraph hides the plus and dots buttons while the toolbox is open', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '' } },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();
    await paragraph.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);
    const settingsToggler = page.locator(SETTINGS_TOGGLER_SELECTOR);

    await expect(plusButton).toBeVisible();
    await expect(settingsToggler).toBeVisible();

    await page.keyboard.type('/');

    const toolbox = page.locator(TOOLBOX_POPOVER_SELECTOR);

    await expect(toolbox).toBeVisible();

    await expect(plusButton).toBeHidden();
    await expect(settingsToggler).toBeHidden();
  });

  test('closing the toolbox restores the plus and dots buttons on hover', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: 'Hover me' } },
    ]);

    const block = page.locator(PARAGRAPH_SELECTOR, { hasText: 'Hover me' });

    await block.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);
    const settingsToggler = page.locator(SETTINGS_TOGGLER_SELECTOR);

    await plusButton.click();

    const toolbox = page.locator(TOOLBOX_POPOVER_SELECTOR);

    await expect(toolbox).toBeVisible();
    await expect(plusButton).toBeHidden();

    await page.keyboard.press('Escape');

    await expect(toolbox).toBeHidden();

    await block.hover();

    await expect(plusButton).toBeVisible();
    await expect(settingsToggler).toBeVisible();
  });
});
