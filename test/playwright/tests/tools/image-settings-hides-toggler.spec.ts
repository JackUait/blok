import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const IMAGE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="image"]`;
const SETTINGS_TOGGLER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
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
  await gotoTestPage(page);
});

test('opening the image overlay "more" menu keeps the block drag handle visible and active', async ({ page }) => {
  await createBlok(page, {
    blocks: [
      { type: 'image', data: { url: SAMPLE_IMAGE_URL, alt: 'pic' } },
    ],
  });

  const imageBlock = page.locator(IMAGE_BLOCK_SELECTOR);

  await expect(imageBlock).toBeVisible();
  await imageBlock.hover();

  const settingsToggler = page.locator(SETTINGS_TOGGLER_SELECTOR);

  await expect(settingsToggler).toBeVisible();

  const moreBtn = imageBlock.locator('[data-action="more"]');

  await moreBtn.click();

  const popover = page.locator(BLOCK_TUNES_POPOVER_SELECTOR);

  await expect(popover).toBeVisible();
  await expect(settingsToggler).toBeVisible();
  await expect(settingsToggler).toHaveAttribute('aria-expanded', 'true');
});
