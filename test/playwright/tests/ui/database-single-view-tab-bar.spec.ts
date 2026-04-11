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

const SINGLE_VIEW_BLOCKS: OutputData['blocks'] = [
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
              { id: 'opt-todo', label: 'Todo', color: 'gray', position: 'a0' },
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

test.describe('Database — single-view tab bar behaviour', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('hides tab bar when database has only one view', async ({ page }) => {
    await resetAndCreate(page, SINGLE_VIEW_BLOCKS);

    const tabBar = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-tab-bar]`);
    await expect(tabBar).toBeHidden();
  });

  test('shows + button inside title row when database has only one view', async ({ page }) => {
    await resetAndCreate(page, SINGLE_VIEW_BLOCKS);

    const addBtnInTitleRow = page.locator(
      `${BLOK_INTERFACE_SELECTOR} [data-blok-database-title-row] [data-blok-database-add-view]`
    );
    await expect(addBtnInTitleRow).toBeAttached();
  });

  test('shows tab bar after adding a second view', async ({ page }) => {
    await resetAndCreate(page, SINGLE_VIEW_BLOCKS);

    // Hover the title row to make the + button visible, then click it
    const titleRow = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-title-row]`);
    await titleRow.hover();

    const addBtn = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-add-view]`);
    await addBtn.click({ force: true });

    // Select "Board" view type in the popover
    const boardOption = page.locator('[data-blok-database-view-option="board"]');
    await boardOption.waitFor({ state: 'visible' });
    await boardOption.click();

    // Tab bar should now be visible
    const tabBar = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-tab-bar]`);
    await expect(tabBar).toBeVisible();

    // Tab bar should contain 2 tabs
    const tabs = tabBar.locator('[data-blok-database-tab]');
    await expect(tabs).toHaveCount(2);
  });

  test('+ button is inside tab bar (not title row) after adding a second view', async ({ page }) => {
    await resetAndCreate(page, SINGLE_VIEW_BLOCKS);

    // Hover and click the + button to add a second view
    const titleRow = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-title-row]`);
    await titleRow.hover();

    const addBtn = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-add-view]`);
    await addBtn.click({ force: true });

    const boardOption = page.locator('[data-blok-database-view-option="board"]');
    await boardOption.waitFor({ state: 'visible' });
    await boardOption.click();

    // + button should NOT be inside title row anymore
    const addBtnInTitleRow = page.locator(
      `${BLOK_INTERFACE_SELECTOR} [data-blok-database-title-row] [data-blok-database-add-view]`
    );
    await expect(addBtnInTitleRow).toHaveCount(0);

    // + button should be inside the tab bar
    const addBtnInTabBar = page.locator(
      `${BLOK_INTERFACE_SELECTOR} [data-blok-database-tab-bar] [data-blok-database-add-view]`
    );
    await expect(addBtnInTabBar).toBeAttached();
  });

  test('hides + button in read-only mode and restores to title row when switching back to edit', async ({ page }) => {
    await resetAndCreate(page, SINGLE_VIEW_BLOCKS);

    // In read-only mode, no + button should be present anywhere
    await page.evaluate(() => { void window.blokInstance?.readOnly.toggle(true); });

    const addBtn = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-add-view]`);
    await expect(addBtn).toHaveCount(0);

    // Switch back to edit mode — + button should return to the title row (single view)
    await page.evaluate(() => { void window.blokInstance?.readOnly.toggle(false); });

    const addBtnInTitleRow = page.locator(
      `${BLOK_INTERFACE_SELECTOR} [data-blok-database-title-row] [data-blok-database-add-view]`
    );
    await expect(addBtnInTitleRow).toBeAttached();
  });

  test('hides tab bar and moves + button back to title row after deleting to one view', async ({ page }) => {
    await resetAndCreate(page, SINGLE_VIEW_BLOCKS);

    // Add a second view first
    const titleRow = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-title-row]`);
    await titleRow.hover();

    const addBtn = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-add-view]`);
    await addBtn.click({ force: true });

    const boardOption = page.locator('[data-blok-database-view-option="board"]');
    await boardOption.waitFor({ state: 'visible' });
    await boardOption.click();

    // Verify we have 2 tabs
    const tabBar = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-tab-bar]`);
    await expect(tabBar).toBeVisible();

    // Delete the first tab via dblclick to open context menu, then click Delete
    const firstTab = tabBar.locator('[data-blok-database-tab][data-view-id="view-1"]');
    await firstTab.dblclick();

    // Wait for context popover and click Delete (destructive item)
    const deleteOption = page.locator('[data-blok-popover-item-destructive="true"]').filter({ hasText: 'Delete' });
    await deleteOption.waitFor({ state: 'visible' });
    await deleteOption.click();

    // Tab bar should now be hidden (back to single view)
    await expect(tabBar).toBeHidden();

    // + button should be back in title row
    const addBtnInTitleRow = page.locator(
      `${BLOK_INTERFACE_SELECTOR} [data-blok-database-title-row] [data-blok-database-add-view]`
    );
    await expect(addBtnInTitleRow).toBeAttached();
  });
});
