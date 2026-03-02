import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable]`;
const PLUS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;
const POPOVER_CONTAINER_SELECTOR = '[data-blok-testid="toolbox-popover"] [data-blok-testid="popover-container"]';

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
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
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

/**
 * Simulates a consumer environment where un-layered CSS resets compete
 * with blok's Tailwind utilities. If blok's CSS uses native @layer,
 * these un-layered rules override it (per CSS cascade spec: un-layered > layered).
 */
const CONSUMER_RESET_CSS = `
  /* Simulated consumer CSS reset — un-layered, so it beats any @layer */
  div { border-radius: 0; box-shadow: none; }
  div, button { padding: 0; background-color: transparent; }
`;

test.describe('CSS layer conflict resistance', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('popover retains styles when consumer has un-layered CSS resets', async ({ page }) => {
    // Inject un-layered consumer CSS BEFORE creating the editor.
    // This simulates a real consumer app that has its own CSS reset.
    await page.addStyleTag({ content: CONSUMER_RESET_CSS });

    await createBlok(page, [
      { type: 'paragraph', data: { text: 'Hello world' } },
    ]);

    // Open the toolbox via the plus button
    const firstBlock = page.locator(PARAGRAPH_SELECTOR, { hasText: 'Hello world' });

    await firstBlock.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await expect(plusButton).toBeVisible();
    await plusButton.click();

    // Wait for toolbox popover to be visible
    const popoverContainer = page.locator(POPOVER_CONTAINER_SELECTOR);

    await expect(popoverContainer).toBeVisible();

    // Verify the popover retained its Tailwind styles despite un-layered consumer CSS.
    // These properties come from utility classes that live inside @layer utilities.
    // If the CSS uses native @layer, the consumer reset above wins and these fail.
    const styles = await popoverContainer.evaluate(el => {
      const computed = window.getComputedStyle(el);

      return {
        borderRadius: computed.borderRadius,
        padding: computed.padding,
        backgroundColor: computed.backgroundColor,
      };
    });

    // rounded-xl → border-radius should be non-zero (12px / 0.75rem)
    expect(styles.borderRadius).not.toBe('0px');

    // p-1.5 → padding should be non-zero (6px / 0.375rem)
    expect(styles.padding).not.toBe('0px');

    // bg-popover-bg → background should NOT be transparent
    expect(styles.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  });
});
