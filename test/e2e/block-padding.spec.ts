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

test.describe('Text block padding', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('paragraph block has 7px top and bottom padding', async ({ page }) => {
    await resetAndCreate(page, [{ type: 'paragraph', data: { text: 'Hello world' } }]);

    const el = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`).first();
    const paddingTop = await el.evaluate((e) => window.getComputedStyle(e).paddingTop);
    const paddingBottom = await el.evaluate((e) => window.getComputedStyle(e).paddingBottom);

    expect(paddingTop).toBe('7px');
    expect(paddingBottom).toBe('7px');
  });

  test('header block has 7px top and bottom padding', async ({ page }) => {
    await resetAndCreate(page, [{ type: 'header', data: { text: 'Hello', level: 1 } }]);

    const el = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="header"] h1`).first();
    const paddingTop = await el.evaluate((e) => window.getComputedStyle(e).paddingTop);
    const paddingBottom = await el.evaluate((e) => window.getComputedStyle(e).paddingBottom);

    expect(paddingTop).toBe('7px');
    expect(paddingBottom).toBe('7px');
  });

  test('list block has 7px top and bottom padding', async ({ page }) => {
    await resetAndCreate(page, [{ type: 'list', data: { style: 'unordered', items: [{ content: 'Item 1' }] } }]);

    const el = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="list"] [data-blok-tool="list"]`).first();
    const paddingTop = await el.evaluate((e) => window.getComputedStyle(e).paddingTop);
    const paddingBottom = await el.evaluate((e) => window.getComputedStyle(e).paddingBottom);

    expect(paddingTop).toBe('7px');
    expect(paddingBottom).toBe('7px');
  });
});
