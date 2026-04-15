import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';

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

const createBlokWithTable = async (page: Page, data: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder, initialData }) => {
    const blok = new window.Blok({
      holder,
      data: initialData,
      tools: {
        table: { class: (window.Blok as unknown as { Table: unknown }).Table },
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: data });
};

test.describe('slash search radius inside table cell', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('renders slash search with small rounding inside a table cell', async ({ page }) => {
    await createBlokWithTable(page, {
      blocks: [
        {
          type: 'table',
          data: {
            withHeadings: false,
            content: [['', '']],
          },
        },
      ],
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    const firstCell = page.locator(CELL_SELECTOR).first();

    await firstCell.click();
    await page.keyboard.type('/');

    const slashSearch = firstCell.locator('[data-blok-slash-search]').first();

    await expect(slashSearch).toHaveAttribute('data-blok-slash-search', /.+/);

    const radius = await slashSearch.evaluate(
      (el) => window.getComputedStyle(el).borderTopLeftRadius
    );

    expect(radius).toBe('6px');
  });
});
