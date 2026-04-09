import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

declare global {
  interface Window {
    blokInstance?: Blok;
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
  }
}

const HOLDER_ID = 'blok';

const resetAndCreate = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
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

  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokBlocks }) => {
      const blok = new window.Blok({
        holder,
        data: { blocks: blokBlocks },
        tools: {
          database: { class: window.BlokDatabase },
          'database-row': { class: window.BlokDatabaseRow },
        },
      });
      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks }
  );
};

const DATABASE_BLOCKS: OutputData['blocks'] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
        {
          id: 'prop-status',
          name: 'Status',
          type: 'select',
          position: 'a1',
          config: {
            options: [
              { id: 'opt-backlog', label: 'Backlog', color: 'gray', position: 'a0' },
            ],
          },
        },
      ],
      views: [
        { id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: ['prop-title'] },
      ],
      activeViewId: 'view-1',
    },
    content: [],
  },
];

test.describe('Database board view — pill title inline editing', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('clicking the column title replaces it with a focused input', async ({ page }) => {
    await resetAndCreate(page, DATABASE_BLOCKS);

    const titleDiv = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-column-title]`).first();
    await expect(titleDiv).toBeVisible();

    await titleDiv.click();

    const input = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-column-title-input]`).first();
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
  });

  test('blurring the input commits the new title', async ({ page }) => {
    await resetAndCreate(page, DATABASE_BLOCKS);

    const titleDiv = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-column-title]`).first();
    await titleDiv.click();

    const input = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-column-title-input]`).first();
    await expect(input).toBeVisible();

    await input.fill('New Column Name');
    await input.blur();

    // Input should disappear after blur
    await expect(input).not.toBeVisible();

    // Title div should now show the new name
    const updatedTitle = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-column-title]`).first();
    await expect(updatedTitle).toBeVisible();
    await expect(updatedTitle).toHaveText('New Column Name');
  });

  test('pressing Enter commits the new title', async ({ page }) => {
    await resetAndCreate(page, DATABASE_BLOCKS);

    const titleDiv = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-column-title]`).first();
    await titleDiv.click();

    const input = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-column-title-input]`).first();
    await expect(input).toBeVisible();

    await input.fill('Enter Committed');
    await input.press('Enter');

    // Input should disappear after Enter
    await expect(input).not.toBeVisible();

    // Title div should show the committed name
    const updatedTitle = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-column-title]`).first();
    await expect(updatedTitle).toBeVisible();
    await expect(updatedTitle).toHaveText('Enter Committed');
  });

  test('pressing Escape cancels the edit and restores the original title', async ({ page }) => {
    await resetAndCreate(page, DATABASE_BLOCKS);

    const titleDiv = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-column-title]`).first();
    const originalText = await titleDiv.textContent();

    await titleDiv.click();

    const input = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-column-title-input]`).first();
    await expect(input).toBeVisible();

    await input.fill('Cancelled Text');
    await input.press('Escape');

    // Input should disappear after Escape
    await expect(input).not.toBeVisible();

    // Title div should be restored with the original text
    const restoredTitle = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-column-title]`).first();
    await expect(restoredTitle).toBeVisible();
    await expect(restoredTitle).toHaveText(originalText ?? '');
  });

  test('clicking the pill title does NOT start a column drag', async ({ page }) => {
    await resetAndCreate(page, DATABASE_BLOCKS);

    const titleDiv = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-column-title]`).first();
    await titleDiv.click();

    // The drag ghost element should NOT appear after a simple click on the title
    const dragGhost = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-column-ghost]`);
    await expect(dragGhost).not.toBeVisible();

    // The input should appear instead (confirming edit mode, not drag)
    const input = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-column-title-input]`).first();
    await expect(input).toBeVisible();
  });
});
