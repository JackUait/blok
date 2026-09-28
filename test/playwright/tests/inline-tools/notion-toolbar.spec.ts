import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { selectAllInEditable } from '../helpers/selection';
import { gotoTestPage } from '../helpers/shared-page';

test.beforeAll(ensureBlokBundleBuilt);

const TEXT = 'Make these words yours.';

const mount = async (page: Page, width: number, height = 844, marginTop = 120): Promise<void> => {
  await page.setViewportSize({ width, height });
  await gotoTestPage(page);
  await page.evaluate(async ({ text, top }) => {
    const holder = document.createElement('div');

    holder.style.cssText = `max-width:650px;margin:${top}px auto 0;padding:0 8px`;
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: [ { type: 'paragraph', data: { text } } ] } });
    await window.blokInstance.isReady;
  }, { text: TEXT, top: marginTop });
};

const selectParagraph = async (page: Page): Promise<Locator> => {
  const paragraph = page.getByTestId('block-wrapper').filter({ hasText: TEXT })
    .locator('[contenteditable="true"]');

  await selectAllInEditable(paragraph);

  return paragraph;
};

const toolbar = (page: Page): Locator => page.locator('[data-blok-interface="inline-toolbar"]');
const card = (page: Page): Locator => toolbar(page).getByTestId('popover-container').first();

test('the card animates in', async ({ page }) => {
  await mount(page, 1280);
  await selectParagraph(page);
  await expect(card(page)).toHaveCSS('animation-name', 'blok-inline-toolbar-in');
});

test('the card does not animate under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(page, 1280);
  await selectParagraph(page);
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toHaveCSS('animation-name', 'none');
});
