import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const TOOLBAR_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="toolbar"]`;
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`;

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
    { type: 'paragraph', data: { text: 'Middle paragraph' } },
    { type: 'paragraph', data: { text: 'Last paragraph' } },
  ],
};

/**
 * Generalization of the slash-pill regression: ANY change to a block's inner
 * geometry that does NOT resize the block holder (so the toolbar's resize
 * observer never fires) must still be followed by the toolbar. Here the shift
 * is simulated with `position: relative; top` on the contenteditable — a
 * layout-neutral offset the resize observer is blind to, exactly like the
 * slash-search pill was.
 */
test.describe('ui.toolbar-inner-geometry-shift', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await createBlok(page, DOCUMENT);
  });

  test('toolbar still follows inner shifts after a slash menu was opened and closed on the block', async ({ page }) => {
    const middleParagraph = page.locator(PARAGRAPH_SELECTOR).nth(1);

    await middleParagraph.click();

    const toolbar = page.locator(TOOLBAR_SELECTOR);

    await expect(toolbar).toHaveAttribute('data-blok-opened', 'true');

    /**
     * Open and dismiss the slash menu. Toolbox.open() stops the block's
     * mutation watching to suppress spurious block-changed events while the
     * popover is open — closing it must re-arm the watching, otherwise the
     * block never reports geometry changes again and the toolbar goes stale.
     */
    await page.keyboard.type('/');
    await expect(middleParagraph).toHaveAttribute('data-blok-slash-search');
    await page.keyboard.press('Escape');
    await expect(middleParagraph).not.toHaveAttribute('data-blok-slash-search');
    await page.keyboard.press('Backspace');

    const baselineTop = await toolbar.evaluate((el) => parseFloat(el.style.top));

    await middleParagraph.evaluate((el) => {
      el.style.setProperty('position', 'relative');
      el.style.setProperty('top', '20px');
    });

    await expect
      .poll(async () => toolbar.evaluate((el) => parseFloat(el.style.top)))
      .toBeGreaterThan(baselineTop + 10);
  });

  test('toolbar follows an inner content shift that does not resize the holder', async ({ page }) => {
    const middleParagraph = page.locator(PARAGRAPH_SELECTOR).nth(1);

    await middleParagraph.click();

    const toolbar = page.locator(TOOLBAR_SELECTOR);

    await expect(toolbar).toHaveAttribute('data-blok-opened', 'true');

    const baselineTop = await toolbar.evaluate((el) => parseFloat(el.style.top));

    /**
     * Shift the block's content down by 20px WITHOUT changing the holder's
     * outer size (position: relative offsets do not affect layout).
     */
    await middleParagraph.evaluate((el) => {
      el.style.setProperty('position', 'relative');
      el.style.setProperty('top', '20px');
    });

    await expect
      .poll(async () => toolbar.evaluate((el) => parseFloat(el.style.top)))
      .toBeGreaterThan(baselineTop + 10);

    /** Removing the shift must bring the toolbar back to its original spot. */
    await middleParagraph.evaluate((el) => {
      el.style.removeProperty('position');
      el.style.removeProperty('top');
    });

    await expect
      .poll(async () => toolbar.evaluate((el) => parseFloat(el.style.top)))
      .toBe(baselineTop);
  });
});
