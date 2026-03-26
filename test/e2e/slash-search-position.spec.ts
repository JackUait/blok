import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../playwright/tests/helpers/ensure-build';

declare global {
  interface Window {
    blokInstance?: Blok;
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
      const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });
      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks }
  );
};

test.describe('Slash search position stability', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('slash search preserves vertical padding of the paragraph', async ({ page }) => {
    await resetAndCreate(page, [{ type: 'paragraph', data: { text: '' } }]);

    const el = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`).first();

    // Measure padding before typing "/"
    const paddingBefore = await el.evaluate((e) => ({
      top: window.getComputedStyle(e).paddingTop,
      bottom: window.getComputedStyle(e).paddingBottom,
    }));

    // Click to focus, then type "/" to trigger slash search
    await el.click();
    await page.keyboard.type('/');

    // Wait for the slash search attribute to be set
    await expect(el).toHaveAttribute('data-blok-slash-search');

    // Measure padding after slash search activates
    const paddingAfter = await el.evaluate((e) => ({
      top: window.getComputedStyle(e).paddingTop,
      bottom: window.getComputedStyle(e).paddingBottom,
    }));

    expect(paddingAfter.top).toBe(paddingBefore.top);
    expect(paddingAfter.bottom).toBe(paddingBefore.bottom);
  });
});
