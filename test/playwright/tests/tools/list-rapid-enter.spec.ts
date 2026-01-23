/* eslint-disable playwright/no-nth-methods */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const LIST_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="list"]`;

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(({ holder }) => {
    if (window.blokInstance) {
      window.blokInstance.destroy?.();
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

const createBlok = async (page: Page, data: { blocks: Array<{ id: string; type: string; data: Record<string, unknown> }> }): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder, data: initialData }) => {
    const blokConfig: Record<string, unknown> = {
      holder: holder,
      data: initialData,
    };

    window.blokInstance = new window.Blok(blokConfig);
    await window.blokInstance.isReady;
  }, { holder: HOLDER_ID, data });
};

test.describe('list tool regression: getBlockIndex for reliable index lookup', () => {
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  /**
   * Regression test for list item insertion using getBlockIndex
   *
   * The list tool should use getBlockIndex(this.blockId) instead of getCurrentBlockIndex()
   * to ensure it gets the correct index even when currentBlockIndex is stale.
   *
   * This test simulates a scenario where currentBlockIndex might not be updated
   * immediately after block operations, which can happen in rapid typing scenarios.
   */
  test('uses getBlockIndex instead of getCurrentBlockIndex for reliable insertion', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'list-1', type: 'list', data: { text: 'First item', style: 'ordered' } },
      ],
    });

    const listItem = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`);

    // Click on first item
    await listItem.click();
    await page.keyboard.press('End');

    // Create second item
    await page.keyboard.press('Enter');
    await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(2);

    // Now simulate the scenario where we verify the fix works:
    // Focus on the second item and create a third item
    // The key is that the list tool should use getBlockIndex(this.blockId)
    // to correctly determine where to insert the new item
    const secondItem = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`).nth(1);
    await secondItem.click();
    await page.keyboard.type('Second');

    // This should insert at index 2, not at a wrong index
    await page.keyboard.press('Enter');
    await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(3);

    // Verify correct ordering
    const markers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
    await expect(markers.nth(0)).toHaveText('1.');
    await expect(markers.nth(1)).toHaveText('2.');
    await expect(markers.nth(2)).toHaveText('3.');

    const items = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`);
    await expect(items.nth(0)).toHaveText('First item');
    await expect(items.nth(1)).toHaveText('Second');
    await expect(items.nth(2)).toHaveText('');
  });

  /**
   * Test that verifies the list tool's internal block ID lookup works correctly.
   * This is a direct test of the fix: using getBlockIndex(this.blockId) instead
   * of getCurrentBlockIndex().
   */
  test('correctly inserts after middle item when currentBlockIndex could be stale', async ({ page }) => {
    // Create a list with 3 items initially
    await createBlok(page, {
      blocks: [
        { id: 'list-1', type: 'list', data: { text: 'Item A', style: 'ordered' } },
        { id: 'list-2', type: 'list', data: { text: 'Item B', style: 'ordered' } },
        { id: 'list-3', type: 'list', data: { text: 'Item C', style: 'ordered' } },
      ],
    });

    // Focus on the middle item (Item B at index 1)
    const middleItem = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`).nth(1);
    await middleItem.click();

    // Press Enter to split the middle item
    // The new item should be inserted at index 2, pushing Item C to index 3
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(4);

    // Verify correct ordering: A, B, (new), C
    const markers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
    await expect(markers.nth(0)).toHaveText('1.');
    await expect(markers.nth(1)).toHaveText('2.');
    await expect(markers.nth(2)).toHaveText('3.');
    await expect(markers.nth(3)).toHaveText('4.');

    const items = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`);
    await expect(items.nth(0)).toHaveText('Item A');
    await expect(items.nth(1)).toHaveText('Item B');
    await expect(items.nth(2)).toHaveText('');
    await expect(items.nth(3)).toHaveText('Item C');
  });

  /**
   * Test that the fix works even when the user clicks on different items
   * before pressing Enter, which could cause currentBlockIndex to be out of sync.
   */
  test('handles clicking between items before pressing Enter', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'list-1', type: 'list', data: { text: 'First', style: 'ordered' } },
        { id: 'list-2', type: 'list', data: { text: 'Second', style: 'ordered' } },
        { id: 'list-3', type: 'list', data: { text: 'Third', style: 'ordered' } },
      ],
    });

    const items = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`);

    // Click on first item
    await items.nth(0).click();

    // Click on third item (this could cause currentBlockIndex to update)
    await items.nth(2).click();

    // Now press Enter on the third item
    // Should insert at index 3, not at index 0 or 1
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(4);

    // Verify: First, Second, Third, (new)
    const markers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
    await expect(markers.nth(0)).toHaveText('1.');
    await expect(markers.nth(1)).toHaveText('2.');
    await expect(markers.nth(2)).toHaveText('3.');
    await expect(markers.nth(3)).toHaveText('4.');

    await expect(items.nth(0)).toHaveText('First');
    await expect(items.nth(1)).toHaveText('Second');
    await expect(items.nth(2)).toHaveText('Third');
    await expect(items.nth(3)).toHaveText('');
  });
});
