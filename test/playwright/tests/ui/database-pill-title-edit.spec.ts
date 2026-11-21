import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

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

const titleOf = (page: Page, name: string): ReturnType<Page['locator']> =>
  page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-column-title]`).filter({ hasText: name });

const pillOf = (page: Page, name: string): ReturnType<Page['locator']> =>
  page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-column-pill]`).filter({ hasText: name });

const field = (page: Page): ReturnType<Page['locator']> => page.getByRole('textbox', { name: 'Rename column' });

/** notion-motion.md Round 99 §1 #1: a click on a column pill opens the same rename popup as Enter. */
test.describe('Database board view — pill click rename popup', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await resetAndCreate(page, DATABASE_BLOCKS);
  });

  test('a click opens the popup with the name selected, and no inline field', async ({ page }) => {
    await titleOf(page, 'Backlog').click();

    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveValue('Backlog');
    expect(await field(page).evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 7]);
    await expect(page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-column] input`)).toHaveCount(0);
  });

  test('Enter in the popup renames the group, and the pill takes focus back', async ({ page }) => {
    await titleOf(page, 'Backlog').click();
    await field(page).fill('Enter Committed');
    await field(page).press('Enter');

    await expect(field(page)).toHaveCount(0);
    await expect(titleOf(page, 'Enter Committed')).toBeVisible();
    await expect(pillOf(page, 'Enter Committed')).toBeFocused();
  });

  test('Done by mouse renames, and the pill takes focus back with no ring', async ({ page }) => {
    await pillOf(page, 'Backlog').click();
    await field(page).fill('Done Committed');
    await page.getByTestId('popover-item-html').getByRole('button', { name: 'Done' }).click();

    await expect(titleOf(page, 'Done Committed')).toBeVisible();
    await expect(pillOf(page, 'Done Committed')).toBeFocused();
    expect(await pillOf(page, 'Done Committed').evaluate((el) => el.matches(':focus-visible'))).toBe(false);
  });

  // Notion's click outside is unread: the popup keeps a typed name, as the old in-pill field did on blur.
  test('a click outside the popup commits the new title', async ({ page }) => {
    await titleOf(page, 'Backlog').click();
    await field(page).fill('New Column Name');
    await page.mouse.click(5, 5);

    await expect(field(page)).toHaveCount(0);
    await expect(titleOf(page, 'New Column Name')).toHaveText('New Column Name');
  });

  test('Escape keeps the name, and the pill takes focus back with its ring, as in Notion', async ({ page }) => {
    await titleOf(page, 'Backlog').click();
    await field(page).fill('Cancelled Text');
    await field(page).press('Escape');

    await expect(field(page)).toHaveCount(0);
    await expect(titleOf(page, 'Backlog')).toHaveText('Backlog');
    await expect(pillOf(page, 'Backlog')).toBeFocused();
    expect(await pillOf(page, 'Backlog').evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  });

  test('a click on the pill does NOT start a column drag', async ({ page }) => {
    await titleOf(page, 'Backlog').click();

    await expect(page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-column-ghost]`)).not.toBeVisible();
    await expect(field(page)).toBeVisible();
  });
});
