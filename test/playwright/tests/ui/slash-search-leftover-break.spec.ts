import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputData } from '../../../../types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const PILL_SELECTOR = '[data-blok-slash-search]';

/**
 * A browser leaves a placeholder <br> in an editable emptied by Backspace or cut.
 * If the slash-search pill keeps it, the <br> breaks the line and
 * "Type to search" drops under the "/".
 */
const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder, blokBlocks }) => {
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blokBlocks: blocks });
};

const expectOneLinePill = async (pill: Locator): Promise<void> => {
  await expect(pill).toBeVisible();

  // The defect first: the leftover <br> itself.
  expect(await pill.evaluate((el) => el.querySelector('br') === null)).toBe(true);

  const { height, lineHeight } = await pill.evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    lineHeight: parseFloat(window.getComputedStyle(el).lineHeight),
  }));

  expect(height).toBeLessThan(lineHeight * 1.6);
};

const emptyWithBackspace = async (page: Page, editable: Locator): Promise<void> => {
  await editable.click();
  await page.keyboard.press('End');
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Backspace');
  }
  await expect(editable).toHaveText('');
};

test.describe('slash search in an emptied block', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  const cases: Array<{ name: string; block: OutputData['blocks'][number] }> = [
    { name: 'heading', block: { type: 'header', data: { text: 'abc', level: 2 } } },
    { name: 'list item', block: { type: 'list', data: { text: 'abc', style: 'unordered' } } },
    { name: 'toggle', block: { type: 'toggle', data: { text: 'abc' } } },
  ];

  for (const { name, block } of cases) {
    test(`keeps "/" and the placeholder on one line in a ${name} emptied with Backspace`, async ({ page }) => {
      await createBlok(page, [block]);

      const editable = page.locator(`#${HOLDER_ID} [contenteditable="true"]`).first();

      await emptyWithBackspace(page, editable);
      await page.keyboard.type('/');

      await expectOneLinePill(page.locator(PILL_SELECTOR));
      await expect(editable).toHaveText('/');
    });
  }

  test('keeps "/" and the placeholder on one line in a paragraph emptied with cut', async ({ page }) => {
    await createBlok(page, [{ type: 'paragraph', data: { text: 'abc' } }]);

    const editable = page.locator(`#${HOLDER_ID} [contenteditable="true"]`).first();

    await editable.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+x');
    await expect(editable).toHaveText('');

    await page.keyboard.type('/');

    await expectOneLinePill(page.locator(PILL_SELECTOR));
  });

  test('keeps the placeholder on one line when the + button opens search in an emptied heading', async ({ page }) => {
    await createBlok(page, [{ type: 'header', data: { text: 'abc', level: 2 } }]);

    const editable = page.locator(`#${HOLDER_ID} [contenteditable="true"]`).first();

    await emptyWithBackspace(page, editable);
    await editable.hover();

    const plusButton = page.locator('[data-blok-testid="plus-button"]');

    await plusButton.waitFor({ state: 'visible' });
    await plusButton.click();

    await expect(editable).toHaveAttribute('data-blok-slash-search', /.+/);
    await expectOneLinePill(page.locator(PILL_SELECTOR));
  });
});
