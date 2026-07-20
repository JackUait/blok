// test/playwright/tests/tools/image-compression.spec.ts

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { ImageCompressionConfig } from '@/types/tools/image';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const IMAGE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="image"]`;

interface UploadedFile {
  size: number;
  type: string;
  name: string;
  width: number;
  height: number;
}

const SOURCE_WIDTH = 800;
const SOURCE_HEIGHT = 600;
const PHOTO_FIXTURE_PATH = join(process.cwd(), 'test/playwright/fixtures/image/photo.jpg');
const SHOT_FIXTURE_PATH = join(process.cwd(), 'test/playwright/fixtures/image/shot.png');

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
    BlokImage: unknown;
    __uploaded?: UploadedFile;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

/**
 * Boot an editor whose image tool records whatever file reaches `uploadByFile`,
 * so a test can compare the uploaded bytes against the ones the user picked.
 */
const createBlok = async (
  page: Page,
  compress: boolean | ImageCompressionConfig,
): Promise<void> => {
  await page.evaluate(async ({ holder, compressConfig }) => {
    await window.blokInstance?.destroy?.();
    window.blokInstance = undefined;
    window.__uploaded = undefined;
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    const blok = new window.Blok({
      holder,
      // An image block with no url renders the empty card — the upload entry point.
      data: { blocks: [{ type: 'image', data: {} }] },
      tools: {
        image: {
          class: window.BlokImage,
          config: {
            compress: compressConfig,
            uploader: {
              uploadByFile: async (file: File) => {
                const url = URL.createObjectURL(file);
                const probe = new Image();

                await new Promise((resolve) => {
                  probe.onload = resolve;
                  probe.onerror = resolve;
                  probe.src = url;
                });

                window.__uploaded = {
                  size: file.size,
                  type: file.type,
                  name: file.name,
                  width: probe.naturalWidth,
                  height: probe.naturalHeight,
                };

                return { url, fileName: file.name };
              },
            },
          },
        },
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, compressConfig: compress });
};

const awaitEmptyCard = async (page: Page): Promise<void> => {
  await expect(page.locator(IMAGE_BLOCK_SELECTOR)).toBeVisible();
};

const uploadFixtureImage = (page: Page, path: string): Promise<void> =>
  page
    .locator(IMAGE_BLOCK_SELECTOR)
    .getByTestId('file-input')
    .setInputFiles(path);

const uploadPhoto = (page: Page): Promise<void> => uploadFixtureImage(page, PHOTO_FIXTURE_PATH);
const uploadShot = (page: Page): Promise<void> => uploadFixtureImage(page, SHOT_FIXTURE_PATH);

const uploadedFile = async (page: Page): Promise<UploadedFile> => {
  await page.waitForFunction(() => window.__uploaded !== undefined);
  const uploaded = await page.evaluate(() => window.__uploaded);

  expect(uploaded).toBeDefined();

  return uploaded as UploadedFile;
};

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_PAGE_URL);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('compresses an uploaded photo by default, keeping its format', async ({ page }) => {
  await createBlok(page, true);
  await awaitEmptyCard(page);
  await uploadPhoto(page);

  const uploaded = await uploadedFile(page);
  const original = statSync(PHOTO_FIXTURE_PATH).size;

  expect(original).toBeGreaterThan(100 * 1024);
  expect(uploaded.type).toBe('image/jpeg');
  expect(uploaded.name).toBe('photo.jpg');
  expect(uploaded.size).toBeLessThan(original * 0.9);
  expect(uploaded.width).toBe(SOURCE_WIDTH);
  expect(uploaded.height).toBe(SOURCE_HEIGHT);
  await expect(page.locator(IMAGE_BLOCK_SELECTOR)).toHaveAttribute('data-state', 'rendered');
});

/** Not every browser's canvas can encode WebP; it silently hands back a PNG instead. */
const canEncodeWebp = (page: Page): Promise<boolean> =>
  page.evaluate(async () => {
    const canvas = new OffscreenCanvas(4, 4);

    canvas.getContext('2d'); // convertToBlob throws without a rendering context
    const blob = await canvas.convertToBlob({ type: 'image/webp' });

    return blob.type === 'image/webp';
  });

test('opting into WebP re-encodes the upload, or falls back to the source format', async ({ page }) => {
  const webpSupported = await canEncodeWebp(page);

  await createBlok(page, { format: 'webp' });
  await awaitEmptyCard(page);
  await uploadPhoto(page);

  const uploaded = await uploadedFile(page);

  // Browsers that cannot encode WebP must silently keep the source format
  // rather than ship the PNG their canvas hands back instead.
  expect(uploaded.type).toBe(webpSupported ? 'image/webp' : 'image/jpeg');
  expect(uploaded.name).toBe(webpSupported ? 'photo.webp' : 'photo.jpg');
  await expect(page.locator(IMAGE_BLOCK_SELECTOR)).toHaveAttribute('data-state', 'rendered');
});

/**
 * No browser's canvas can encode AVIF — the only native path is WebCodecs'
 * AV1 encoder in quantizer mode (Chromium). This mirrors the runtime check
 * the compressor itself performs.
 */
const canEncodeAv1 = (page: Page): Promise<boolean> =>
  page.evaluate(async () => {
    if (typeof VideoEncoder !== 'function') return false;
    try {
      const { supported } = await VideoEncoder.isConfigSupported({
        codec: 'av01.0.08M.08',
        width: 800,
        height: 600,
        bitrateMode: 'quantizer',
        latencyMode: 'quality',
      });

      return supported === true;
    } catch {
      // WebKit throws on configs it does not recognise instead of reporting
      // supported: false — the compressor treats that the same way.
      return false;
    }
  });

/** Some WebKit builds can encode AVIF straight from the canvas. */
const canEncodeAvifCanvas = (page: Page): Promise<boolean> =>
  page.evaluate(async () => {
    const canvas = new OffscreenCanvas(4, 4);

    canvas.getContext('2d');
    const blob = await canvas.convertToBlob({ type: 'image/avif' });

    return blob.type === 'image/avif';
  });

test("format 'avif' re-encodes a PNG upload into a real, decodable AVIF", async ({ page }) => {
  const avifSupported = (await canEncodeAvifCanvas(page)) || (await canEncodeAv1(page));

  await createBlok(page, { format: 'avif' });
  await awaitEmptyCard(page);
  await uploadShot(page);

  const uploaded = await uploadedFile(page);
  const original = statSync(SHOT_FIXTURE_PATH).size;

  expect(original).toBeGreaterThan(100 * 1024);

  // Browsers without any AVIF encoder must keep the original PNG untouched
  // rather than ship a corrupt or pointlessly re-encoded file.
  expect(uploaded.type).toBe(avifSupported ? 'image/avif' : 'image/png');
  expect(uploaded.name).toBe(avifSupported ? 'shot.avif' : 'shot.png');
  expect(uploaded.size).toBeLessThan(avifSupported ? original * 0.9 : original + 1);
  // The uploader probes the file with an <img> — matching natural dimensions
  // prove the (possibly hand-muxed) AVIF actually decodes, not merely carries the MIME.
  expect(uploaded.width).toBe(SOURCE_WIDTH);
  expect(uploaded.height).toBe(SOURCE_HEIGHT);

  await expect(page.locator(IMAGE_BLOCK_SELECTOR)).toHaveAttribute('data-state', 'rendered');
});

test("fallbackFormat serves WebP to browsers that cannot produce the preferred AVIF", async ({ page }) => {
  const avifSupported = (await canEncodeAvifCanvas(page)) || (await canEncodeAv1(page));
  const webpSupported = await canEncodeWebp(page);

  await createBlok(page, { format: 'avif', fallbackFormat: 'webp' });
  await awaitEmptyCard(page);
  await uploadShot(page);

  const uploaded = await uploadedFile(page);
  const original = statSync(SHOT_FIXTURE_PATH).size;

  // Every current engine encodes at least one of the two — the chain's whole
  // point is that no user with a modern browser is stuck with the original.
  const fallbackType = webpSupported ? 'image/webp' : 'image/png';
  const expectedType = avifSupported ? 'image/avif' : fallbackType;

  expect(uploaded.type).toBe(expectedType);
  expect(uploaded.size).toBeLessThan(expectedType === 'image/png' ? original + 1 : original * 0.9);
  expect(uploaded.width).toBe(SOURCE_WIDTH);
  expect(uploaded.height).toBe(SOURCE_HEIGHT);
  await expect(page.locator(IMAGE_BLOCK_SELECTOR)).toHaveAttribute('data-state', 'rendered');
});

test('a dimension cap downscales the upload, preserving aspect ratio', async ({ page }) => {
  await createBlok(page, { maxWidth: 400 });
  await awaitEmptyCard(page);
  await uploadPhoto(page);

  const uploaded = await uploadedFile(page);
  const original = statSync(PHOTO_FIXTURE_PATH).size;

  expect(uploaded.width).toBe(400);
  expect(uploaded.height).toBe(300);
  expect(uploaded.size).toBeLessThan(original);
});

test('compress: false uploads the exact original bytes', async ({ page }) => {
  await createBlok(page, false);
  await awaitEmptyCard(page);
  await uploadPhoto(page);

  const uploaded = await uploadedFile(page);
  const original = statSync(PHOTO_FIXTURE_PATH).size;

  expect(uploaded.size).toBe(original);
  expect(uploaded.name).toBe('photo.jpg');
});
