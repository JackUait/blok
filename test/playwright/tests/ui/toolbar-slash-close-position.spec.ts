import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const TOOLBAR_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="toolbar"]`;
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`;
const TOOLBOX_POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"]';

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
    container.style.width = '600px';
    container.style.margin = '50px auto';

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokData }) => {
      const blok = new window.Blok({
        holder: holder,
        ...(blokData ? { data: blokData } : {}),
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokData: data }
  );
};

const DOCUMENT: OutputData = {
  blocks: [
    { type: 'paragraph', data: { text: 'First paragraph' } },
    { type: 'paragraph', data: { text: '' } },
    { type: 'paragraph', data: { text: 'Last paragraph' } },
  ],
};

/**
 * The slash-search pill styling (margin/padding on the contenteditable) shifts
 * the block's inner geometry while the toolbox is open, and the toolbar follows
 * it. When the popover closes the pill is removed, so the toolbar must return
 * to its pre-slash position — regression test for the toolbar getting stuck at
 * the pill-era offset because no reposition ran on toolbox close.
 */
test.describe('ui.toolbar-slash-close-position', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await createBlok(page, DOCUMENT);
  });

  const openSlashMenuOnEmptyParagraph = async (page: Page): Promise<{ baselineTop: string }> => {
    const emptyParagraph = page.locator(PARAGRAPH_SELECTOR).nth(1);

    await emptyParagraph.click();

    const toolbar = page.locator(TOOLBAR_SELECTOR);

    await expect(toolbar).toHaveAttribute('data-blok-opened', 'true');

    const baselineTop = await toolbar.evaluate((el) => el.style.top);

    expect(baselineTop).not.toBe('');

    await page.keyboard.type('/');

    await expect(emptyParagraph).toHaveAttribute('data-blok-slash-search');
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toHaveAttribute('data-state', 'open');

    return { baselineTop };
  };

  test('toolbar returns to its pre-slash position after Escape closes the slash menu', async ({ page }) => {
    const { baselineTop } = await openSlashMenuOnEmptyParagraph(page);

    await page.keyboard.press('Escape');

    const emptyParagraph = page.locator(PARAGRAPH_SELECTOR).nth(1);

    await expect(emptyParagraph).not.toHaveAttribute('data-blok-slash-search');

    const toolbar = page.locator(TOOLBAR_SELECTOR);

    await expect.poll(async () => toolbar.evaluate((el) => el.style.top)).toBe(baselineTop);
  });

  test('toolbar returns to its pre-slash position after deleting the slash closes the menu', async ({ page }) => {
    const { baselineTop } = await openSlashMenuOnEmptyParagraph(page);

    await page.keyboard.press('Backspace');

    const emptyParagraph = page.locator(PARAGRAPH_SELECTOR).nth(1);

    await expect(emptyParagraph).not.toHaveAttribute('data-blok-slash-search');

    const toolbar = page.locator(TOOLBAR_SELECTOR);

    await expect.poll(async () => toolbar.evaluate((el) => el.style.top)).toBe(baselineTop);
  });
});
