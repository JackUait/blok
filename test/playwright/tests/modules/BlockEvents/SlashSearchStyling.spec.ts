import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '../../../../../types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable]`;
const TOOLBOX_CONTAINER_SELECTOR = '[data-blok-testid="toolbox-popover"] [data-blok-testid="popover-container"]';
const PLUS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;

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
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createParagraphBlok = async (page: Page, paragraphs: string[]): Promise<void> => {
  const blocks: OutputData['blocks'] = paragraphs.map((text) => ({
    type: 'paragraph',
    data: { text },
  }));

  await resetBlok(page);
  await page.evaluate(async ({ holder, blocks: blokBlocks }) => {
    const blok = new window.Blok({
      holder: holder,
      data: { blocks: blokBlocks },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID,
    blocks });
};

test.describe('slash search styling', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('should add data-blok-slash-search attribute when typing slash in empty block', async ({ page }) => {
    await createParagraphBlok(page, [ '' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();
    await paragraph.type('/');

    await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeVisible();
    await expect(paragraph).toHaveAttribute('data-blok-slash-search', '');
  });

  test('should remove data-blok-slash-search attribute when toolbox closes via Escape', async ({ page }) => {
    await createParagraphBlok(page, [ '' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();
    await paragraph.type('/');

    await expect(paragraph).toHaveAttribute('data-blok-slash-search', '');

    await page.keyboard.press('Escape');

    await expect(paragraph).not.toHaveAttribute('data-blok-slash-search');
  });

  test('should add data-blok-slash-search attribute when clicking plus button', async ({ page }) => {
    await createParagraphBlok(page, [ '' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();

    // Hover to show toolbar, then click plus button
    const blockWrapper = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`).first();

    await blockWrapper.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.click();

    await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeVisible();
    await expect(paragraph).toHaveAttribute('data-blok-slash-search', '');
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}
