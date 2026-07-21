import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const POPOVER_CONTAINER_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const CONVERT_TO_OPTION = `${POPOVER_CONTAINER_SELECTOR} [data-blok-testid="popover-item"][data-blok-item-name="convert-to"]`;
const NESTED_POPOVER = '[data-blok-nested="true"] [data-blok-testid="popover-container"]';

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

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, data: initialData }) => {
      const blok = new window.Blok({ holder, data: initialData });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, data }
  );
};

const openBlockTunes = async (page: Page, hasText: string): Promise<void> => {
  const block = page.getByTestId('block-wrapper').filter({ hasText }).first();

  await expect(block).toBeVisible();
  await block.click();
  await block.hover();

  const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

  await expect(settingsButton).toBeVisible();
  await settingsButton.click();
  await expect(page.locator(POPOVER_CONTAINER_SELECTOR)).toBeVisible();
};

const save = async (page: Page): Promise<OutputData | undefined> =>
  page.evaluate(async () => window.blokInstance?.save());

test.describe('block-level color survives turn-into', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  // Regression: block-level textColor/backgroundColor lived outside the `text`
  // conversion contract and was dropped on every "Turn into". Converting a
  // colored heading to a paragraph must keep the color (Notion parity).
  test('keeps textColor + backgroundColor when converting a heading to a paragraph', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'header', data: { text: 'Colored heading', level: 2, textColor: 'red', backgroundColor: 'blue' } },
      ],
    });

    await openBlockTunes(page, 'Colored heading');

    const convertTo = page.locator(CONVERT_TO_OPTION);

    await expect(convertTo).toBeVisible();
    await convertTo.dispatchEvent('mouseover');

    await expect(page.locator(NESTED_POPOVER)).toBeVisible();

    // Paragraph entry in the "Convert to" submenu (toolbox title "Text").
    const paragraphEntry = page
      .locator(`${NESTED_POPOVER} [data-blok-testid="popover-item"]`)
      .filter({ hasText: 'Text' })
      .first();

    await expect(paragraphEntry).toBeVisible();
    await paragraphEntry.click();

    const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`).first();

    await expect(paragraph).toBeVisible();
    // Color CSS vars are re-applied on the converted element.
    await expect(paragraph).toHaveCSS('color', /.+/);

    const saved = await save(page);

    expect(saved?.blocks[0].type).toBe('paragraph');
    expect(saved?.blocks[0].data.textColor).toBe('red');
    expect(saved?.blocks[0].data.backgroundColor).toBe('blue');
  });
});
