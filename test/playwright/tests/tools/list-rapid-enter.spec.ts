/* eslint-disable playwright/no-nth-methods */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const LIST_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="list"]`;

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

const createBlok = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder }) => {
    const blokConfig: Record<string, unknown> = {
      holder: holder,
      data: {
        blocks: [
          { id: 'list-1', type: 'list', data: { text: 'First item', style: 'ordered' } },
        ],
      },
    };

    window.blokInstance = new window.Blok(blokConfig);
    await window.blokInstance.isReady;
  }, { holder: HOLDER_ID });
};

test.describe('list tool rapid Enter key handling', () => {
  test.beforeAll(ensureBlokBundleBuilt);

  test('creates items at correct positions with rapid Enter presses', async ({ page }) => {
    await createBlok(page);

    const listItem = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`);

    // Click on first item
    await listItem.click();
    await page.keyboard.press('End');

    // Press Enter to create second item
    await page.keyboard.press('Enter');
    await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(2);

    // Type in second item immediately after creation
    await page.keyboard.type('Second');

    // Press Enter again quickly to create third item
    await page.keyboard.press('Enter');
    await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(3);

    // Verify all items are in correct order
    const markers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
    await expect(markers.nth(0)).toHaveText('1.');
    await expect(markers.nth(1)).toHaveText('2.');
    await expect(markers.nth(2)).toHaveText('3.');

    // Verify the text content is correct
    const items = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`);
    await expect(items.nth(0)).toHaveText('First item');
    await expect(items.nth(1)).toHaveText('Second');
    await expect(items.nth(2)).toHaveText('');
  });

  test('maintains correct currentBlockIndex after rapid operations', async ({ page }) => {
    await createBlok(page);

    const listItem = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`);

    await listItem.click();
    await page.keyboard.press('End');

    // Create 5 items rapidly
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Enter');
    }

    await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(6);

    // Verify numbering is correct
    const markers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
    await expect(markers.nth(0)).toHaveText('1.');
    await expect(markers.nth(1)).toHaveText('2.');
    await expect(markers.nth(2)).toHaveText('3.');
    await expect(markers.nth(3)).toHaveText('4.');
    await expect(markers.nth(4)).toHaveText('5.');
    await expect(markers.nth(5)).toHaveText('6.');
  });

  test('handles type then Enter in newly created list item', async ({ page }) => {
    await createBlok(page);

    const listItem = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`);

    await listItem.click();
    await page.keyboard.press('End');

    // Create second item
    await page.keyboard.press('Enter');
    await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(2);

    // Type in the new second item
    await page.keyboard.type('ABC');

    // Create third item
    await page.keyboard.press('Enter');
    await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(3);

    // Type in the new third item
    await page.keyboard.type('DEF');

    // Create fourth item
    await page.keyboard.press('Enter');
    await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(4);

    // Verify order: First item, ABC, DEF, (empty)
    const items = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`);
    await expect(items.nth(0)).toHaveText('First item');
    await expect(items.nth(1)).toHaveText('ABC');
    await expect(items.nth(2)).toHaveText('DEF');
    await expect(items.nth(3)).toHaveText('');
  });
});
