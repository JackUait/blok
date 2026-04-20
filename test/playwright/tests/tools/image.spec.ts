// test/playwright/tests/tools/image.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const IMAGE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="image"]`;
const SAMPLE_IMAGE_URL = 'https://placehold.co/600x400.png';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const resetBlok = async (page: Page): Promise<void> => {
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
};

const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, initialData }) => {
      const blok = new window.Blok({ holder, ...(initialData ? { data: initialData } : {}) });
      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null }
  );
};

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_PAGE_URL);
});

test('inserts image via slash menu and embeds URL', async ({ page }) => {
  await createBlok(page);

  const defaultParagraph = page.locator(
    `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`
  );

  await defaultParagraph.click();
  await page.keyboard.type('/image', { delay: 50 });

  const imageMenuItem = page.locator('[data-blok-item-name="image"]');

  await expect(imageMenuItem).toBeVisible();
  await imageMenuItem.click();

  const imageBlock = page.locator(IMAGE_BLOCK_SELECTOR);

  await expect(imageBlock).toBeVisible();

  await imageBlock.locator('[data-tab="embed"]').click();
  await imageBlock.getByPlaceholder('Paste an image URL…').fill(SAMPLE_IMAGE_URL);
  await imageBlock.locator('[data-action="submit-url"]').click();

  await expect(imageBlock).toHaveAttribute('data-state', 'rendered');
});

test('clicking image opens lightbox; Escape closes it', async ({ page }) => {
  await createBlok(page, {
    blocks: [
      { type: 'image', data: { url: SAMPLE_IMAGE_URL, alt: 'pic' } },
    ],
  });

  const imageBlock = page.locator(IMAGE_BLOCK_SELECTOR);
  const imageEl = imageBlock.locator('img[alt="pic"]');

  await expect(imageEl).toBeVisible();
  await imageEl.click();

  const dialog = page.getByRole('dialog');

  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('read-only mode hides overlay and resize handles', async ({ page }) => {
  await createBlok(page, {
    blocks: [
      { type: 'image', data: { url: SAMPLE_IMAGE_URL, alt: 'pic' } },
    ],
  });

  const imageBlock = page.locator(IMAGE_BLOCK_SELECTOR);

  await expect(imageBlock.getByRole('img')).toBeVisible();

  await page.evaluate(async () => {
    const blok = window.blokInstance ?? (() => {
      throw new Error('Blok instance not found');
    })();

    await blok.readOnly.toggle(true);
  });

  await page.waitForFunction(() => window.blokInstance?.readOnly.isEnabled === true);

  await expect(imageBlock.locator('[data-role="image-overlay"]')).toHaveCount(0);
  await expect(imageBlock.locator('[data-role="resize-handle"]')).toHaveCount(0);
});
