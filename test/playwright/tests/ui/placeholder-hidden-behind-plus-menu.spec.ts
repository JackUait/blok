import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '../../../../types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

/**
 * Regression for BUG #18 — placeholder stays visible behind the + (plus) menu.
 *
 * Notion hides an empty, focused block's placeholder while the + button's toolbox
 * is open. The hide rule lives on the editor wrapper and is gated on the
 * `data-blok-toolbox-opened=true` attribute. It must target the placeholder
 * attributes the tools actually render:
 *   - paragraph → data-blok-placeholder-active
 *   - header    → data-placeholder
 *
 * The historical selector targeted `[data-blok-placeholder]`, which matched neither,
 * so the rule was inert and the placeholder bled through the menu. We assert the
 * placeholder's ::before pseudo-element collapses to opacity 0 once the toolbox opens.
 */

const HOLDER_ID = 'blok';
const BLOK_WRAPPER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const PARAGRAPH_EDITABLE_SELECTOR = `${BLOK_WRAPPER_SELECTOR}[data-blok-component="paragraph"] [contenteditable]`;
const PLUS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;
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

const getBeforeOpacity = async (locator: Locator): Promise<string> => {
  return await locator.evaluate((element) => {
    const view = element.ownerDocument.defaultView;

    if (!view) {
      throw new Error('Element is not attached to a window');
    }

    return view.getComputedStyle(element, '::before').getPropertyValue('opacity');
  });
};

const openToolboxViaPlusButton = async (page: Page, block: Locator): Promise<void> => {
  await block.click();
  await block.hover();

  const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

  await expect(plusButton).toBeVisible();
  await plusButton.click();

  await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();
};

test.describe('placeholder hidden behind + menu (BUG #18)', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('hides the empty paragraph placeholder while the toolbox is open', async ({ page }) => {
    await createBlokWithBlocks(page, [{ type: 'paragraph', data: { text: '' } }]);

    const paragraph = page.locator(PARAGRAPH_EDITABLE_SELECTOR);

    await paragraph.click();
    // Placeholder is visible while focused and the toolbox is closed.
    await expect.poll(async () => getBeforeOpacity(paragraph)).toBe('1');

    await openToolboxViaPlusButton(page, paragraph);

    // While the toolbox is open the placeholder is hidden (opacity collapses to 0).
    await expect.poll(async () => getBeforeOpacity(paragraph)).toBe('0');
  });

  test('hides the empty header placeholder while the toolbox is open', async ({ page }) => {
    await createBlokWithBlocks(page, [{ type: 'header', data: { text: '', level: 2 } }]);

    const header = page.locator(
      `${BLOK_WRAPPER_SELECTOR}[data-blok-component="header"] [contenteditable]`
    );

    await header.click();
    await expect.poll(async () => getBeforeOpacity(header)).toBe('1');

    await openToolboxViaPlusButton(page, header);

    await expect.poll(async () => getBeforeOpacity(header)).toBe('0');
  });
});
