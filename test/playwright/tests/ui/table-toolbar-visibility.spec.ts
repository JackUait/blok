import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const PLUS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const createBlokWithTable = async (page: Page): Promise<void> => {
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

  await page.waitForFunction(() => typeof window.Blok === 'function');

  const data: OutputData = {
    blocks: [
      {
        type: 'table',
        data: {
          withHeadings: false,
          content: [['Cell A', 'Cell B'], ['Cell C', 'Cell D']],
        },
      },
    ],
  };

  await page.evaluate(
    async ({ holder, data: initialData }) => {
      const tableClass = (window.Blok as unknown as Record<string, unknown>).Table;
      const blok = new window.Blok({
        holder,
        tools: {
          table: { class: tableClass },
        },
        data: initialData,
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, data }
  );
};

test.describe('toolbar visibility in table cells', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('hides plus button and settings toggler when clicking inside a table cell', async ({ page }) => {
    await createBlokWithTable(page);

    const firstCell = page.locator(CELL_SELECTOR).filter({ hasText: 'Cell A' });

    await firstCell.click();

    // eslint-disable-next-line playwright/no-wait-for-timeout -- checking non-appearance requires a brief wait
    await page.waitForTimeout(300);

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);
    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeHidden();
    await expect(plusButton).toBeHidden();
  });
});
