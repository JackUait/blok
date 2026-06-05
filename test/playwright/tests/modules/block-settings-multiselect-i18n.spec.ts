import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const SETTINGS_BUTTON = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const POPOVER = '[data-blok-testid="block-tunes-popover"]';
const POPOVER_CONTEXT_LABEL = `${POPOVER} [data-blok-testid="popover-context-label"]`;

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const TWO_PARAGRAPHS: OutputData = {
  blocks: [
    { type: 'paragraph', data: { text: 'First block' } },
    { type: 'paragraph', data: { text: 'Second block' } },
  ],
} as OutputData;

/**
 * Build a Blok instance with a non-English locale so we can assert the
 * multi-select block-settings header is translated rather than hard-coded.
 */
const createLocalizedBlok = async (page: Page, locale: string, data: OutputData): Promise<void> => {
  await page.goto(TEST_PAGE_URL);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, initialData, loc }) => {
      if (window.blokInstance) {
        await window.blokInstance.destroy?.();
        window.blokInstance = undefined;
      }
      document.getElementById(holder)?.remove();
      const container = document.createElement('div');

      container.id = holder;
      document.body.appendChild(container);

      const blok = new window.Blok({
        holder,
        data: initialData,
        i18n: { locale: loc },
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data, loc: locale }
  );
};

const selectBlocksByIndex = async (page: Page, indices: number[]): Promise<void> => {
  await page.evaluate((idxList: number[]) => {
    const blockSelection = (
      window.blokInstance as unknown as {
        module: { blockSelection: { selectBlockByIndex: (i: number) => void } };
      }
    ).module.blockSelection;

    for (const idx of idxList) {
      blockSelection.selectBlockByIndex(idx);
    }
  }, indices);
};

test.beforeAll(async () => {
  await ensureBlokBundleBuilt();
});

test('multi-select block settings header is localized', async ({ page }) => {
  await createLocalizedBlok(page, 'ru', TWO_PARAGRAPHS);

  await selectBlocksByIndex(page, [0, 1]);

  const lastBlock = page.getByTestId('block-wrapper').last();

  await lastBlock.hover();

  const settingsButton = page.locator(SETTINGS_BUTTON);

  await expect(settingsButton).toBeVisible();
  await settingsButton.click();

  const header = page.locator(POPOVER_CONTEXT_LABEL);

  await expect(header).toBeVisible();
  await expect(header).toHaveText('Блоков: 2');
});
