// test/playwright/tests/tools/image-crop.spec.ts

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

const seedImage = async (
  page: Page,
  crop?: { x: number; y: number; w: number; h: number }
): Promise<void> => {
  const data: OutputData = {
    blocks: [{
      type: 'image',
      data: { url: SAMPLE_IMAGE_URL, ...(crop ? { crop } : {}) },
    }],
  } as OutputData;
  await page.goto(TEST_PAGE_URL);
  await page.evaluate(async ({ holder, initialData }) => {
    document.getElementById(holder)?.remove();
    const c = document.createElement('div'); c.id = holder; document.body.appendChild(c);
    const blok = new window.Blok({ holder, data: initialData });
    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: data });
};

test('crop flow: Done with unchanged full rect → no crop saved', async ({ page }) => {
  await seedImage(page);
  const image = page.locator(IMAGE_BLOCK_SELECTOR);
  await image.hover();
  const cropBtn = image.locator('[data-action="crop"]');
  await expect(cropBtn).toBeVisible();
  await cropBtn.click();
  await expect(image.locator('.blok-image-crop-editor')).toBeVisible();
  await image.locator('[data-action="done"]').click();
  await expect(image.locator('.blok-image-crop-editor')).toHaveCount(0);
  const saved = await page.evaluate(() => window.blokInstance!.save() as Promise<OutputData>);
  const first = saved.blocks[0].data as { crop?: unknown };
  expect(first.crop).toBeUndefined();
});

test('crop flow: Reset clears existing crop', async ({ page }) => {
  await seedImage(page, { x: 10, y: 10, w: 60, h: 60 });
  const image = page.locator(IMAGE_BLOCK_SELECTOR);
  await expect(image.locator('.blok-image-crop')).toBeVisible();
  await image.hover();
  const cropBtn = image.locator('[data-action="crop"]');
  await expect(cropBtn).toBeVisible();
  await cropBtn.click();
  await image.locator('[data-action="reset"]').click();
  await image.locator('[data-action="done"]').click();
  const saved = await page.evaluate(() => window.blokInstance!.save() as Promise<OutputData>);
  const first = saved.blocks[0].data as { crop?: unknown };
  expect(first.crop).toBeUndefined();
});

test('crop flow: Cancel preserves existing crop', async ({ page }) => {
  await seedImage(page, { x: 10, y: 10, w: 60, h: 60 });
  const image = page.locator(IMAGE_BLOCK_SELECTOR);
  await image.hover();
  const cropBtn = image.locator('[data-action="crop"]');
  await expect(cropBtn).toBeVisible();
  await cropBtn.click();
  await image.locator('[data-action="cancel"]').click();
  const saved = await page.evaluate(() => window.blokInstance!.save() as Promise<OutputData>);
  const first = saved.blocks[0].data as { crop?: { w: number; h: number } };
  expect(first.crop).toEqual({ x: 10, y: 10, w: 60, h: 60 });
});
