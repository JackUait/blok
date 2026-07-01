import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Blok } from '../../../../types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const SELECT_ALL = process.platform === 'darwin' ? 'Meta+a' : 'Control+a';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const getParagraphByIndex = (page: Page, index: number): Locator =>
  page.locator(`:nth-match(${PARAGRAPH_SELECTOR}, ${index + 1})`);

const getBlockByIndex = (page: Page, index: number): Locator =>
  page.locator(`:nth-match(${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"], ${index + 1})`);

const createBlok = async (page: Page, texts: string[]): Promise<void> => {
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

  await page.evaluate(async ({ holder, texts: t }) => {
    const blok = new window.Blok({
      holder,
      data: { blocks: t.map((text) => ({ type: 'paragraph', data: { text } })) },
    });
    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, texts });
};

test.describe('modules/single-block-selection-arrow-move', () => {
  test.beforeAll(() => ensureBlokBundleBuilt());
  test.beforeEach(async ({ page }) => { await page.goto(TEST_PAGE_URL); });

  test('plain ArrowDown moves a single-block selection (entered via Cmd+A stage 2) to the next block', async ({ page }) => {
    await createBlok(page, ['One', 'Two', 'Three']);

    // Put the caret in the middle block, then Cmd+A twice: stage 1 selects the
    // text, stage 2 selects the single block (without navigation mode).
    await getParagraphByIndex(page, 1).click();
    await page.keyboard.press(SELECT_ALL);
    await page.keyboard.press(SELECT_ALL);

    // Exactly one block is selected.
    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(1);
    await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-selected', 'true');

    // Plain ArrowDown must MOVE the selection to the next block, not collapse it.
    await page.keyboard.press('ArrowDown');

    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(1);
    await expect(getBlockByIndex(page, 2)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 1)).not.toHaveAttribute('data-blok-selected', 'true');
  });

  test('plain ArrowUp moves a single-block selection to the previous block', async ({ page }) => {
    await createBlok(page, ['One', 'Two', 'Three']);

    await getParagraphByIndex(page, 1).click();
    await page.keyboard.press(SELECT_ALL);
    await page.keyboard.press(SELECT_ALL);

    await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-selected', 'true');

    await page.keyboard.press('ArrowUp');

    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(1);
    await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 1)).not.toHaveAttribute('data-blok-selected', 'true');
  });
});
