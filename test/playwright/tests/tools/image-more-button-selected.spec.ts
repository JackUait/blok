import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const IMAGE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="image"]`;
const BLOCK_TUNES_POPOVER_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
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

test('image "more" button shows selected state while its menu is open', async ({ page }) => {
  await createBlok(page, {
    blocks: [
      { type: 'image', data: { url: SAMPLE_IMAGE_URL, alt: 'pic' } },
    ],
  });

  const imageBlock = page.locator(IMAGE_BLOCK_SELECTOR);

  await expect(imageBlock).toBeVisible();
  await imageBlock.hover();

  const moreBtn = imageBlock.locator('[data-action="more"]');

  await expect(moreBtn).toHaveAttribute('aria-expanded', 'false');

  await moreBtn.click();

  const popover = page.locator(BLOCK_TUNES_POPOVER_SELECTOR);
  await expect(popover).toBeVisible();

  await expect(moreBtn).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();

  await expect(moreBtn).toHaveAttribute('aria-expanded', 'false');
});
