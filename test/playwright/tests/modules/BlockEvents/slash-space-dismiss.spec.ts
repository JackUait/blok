import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { OutputData } from '../../../../../types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

/**
 * Regression: typing "/" then a space cancels the command menu and leaves a
 * literal "/ " in the block (Notion parity). Previously the query became a lone
 * space and the toolbox stayed open filtering by whitespace until the "/" was
 * deleted.
 */

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`;
const TOOLBOX_CONTAINER_SELECTOR = '[data-blok-testid="toolbox-popover"] [data-blok-testid="popover-container"]';

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createParagraphBlok = async (page: Page, text: string): Promise<void> => {
  const blocks: OutputData['blocks'] = [ { type: 'paragraph', data: { text } } ];

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ holder, blokBlocks }) => {
    const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blokBlocks: blocks });
};

const getTextContent = (locator: Locator): Promise<string> =>
  locator.evaluate((element) => element.textContent ?? '');

test.describe('slash + space dismisses the toolbox (Notion parity)', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('typing "/" then a space closes the menu and keeps a literal "/ "', async ({ page }) => {
    await createParagraphBlok(page, '');

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();
    await page.keyboard.type('/');

    await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeVisible();

    await page.keyboard.type(' ');

    // Menu dismissed.
    await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeHidden();

    // Literal "/ " remains in the block.
    expect(await getTextContent(paragraph)).toBe('/ ');
  });
});
