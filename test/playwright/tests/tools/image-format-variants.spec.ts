// test/playwright/tests/tools/image-format-variants.spec.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import type { ImageFormat, MediaVariant } from '@/types/configs/media';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const IMAGE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="image"]`;
const PHOTO_FIXTURE_PATH = join(process.cwd(), 'test/playwright/fixtures/image/photo.jpg');
/** 64×48 RGBA with a fully transparent disc in the middle. */
const TRANSPARENT_FIXTURE_PATH = join(process.cwd(), 'test/playwright/fixtures/image/transparent.png');
const RANK = ['image/avif', 'image/webp', 'image/jpeg', 'image/png'];

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
    BlokImage: unknown;
    __uploads?: Array<{ type: string; name: string }>;
  }
}

interface SavedImage {
  url: string;
  variants?: MediaVariant[];
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

/**
 * Boot an editor with editor-level image formats and an uploader that records
 * every file it receives and serves it back as a blob: URL.
 */
const createBlok = async (page: Page, formats: ImageFormat[], data?: OutputData): Promise<void> => {
  await page.evaluate(async ({ holder, imageFormats, initial }) => {
    await window.blokInstance?.destroy?.();
    window.blokInstance = undefined;
    window.__uploads = [];
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    const blok = new window.Blok({
      holder,
      data: initial ?? { blocks: [{ type: 'image', data: {} }] },
      media: { formats: { image: imageFormats } },
      tools: {
        image: {
          class: window.BlokImage,
          config: {
            uploader: {
              uploadByFile: async (file: File) => {
                window.__uploads?.push({ type: file.type, name: file.name });

                return { url: URL.createObjectURL(file), fileName: file.name };
              },
            },
          },
        },
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, imageFormats: formats, initial: data });
};

const upload = (page: Page, path: string): Promise<void> =>
  page.locator(IMAGE_BLOCK_SELECTOR).getByTestId('file-input').setInputFiles(path);

const savedImage = async (page: Page): Promise<SavedImage> => {
  await expect(page.locator(IMAGE_BLOCK_SELECTOR)).toHaveAttribute('data-state', 'rendered');

  return page.evaluate(async () => {
    const saved = await window.blokInstance?.save();

    return saved?.blocks[0].data as unknown as SavedImage;
  });
};

const savedDocument = (page: Page): Promise<OutputData | undefined> =>
  page.evaluate(async () => window.blokInstance?.save());

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('a photo is saved in every format this browser can encode, best first, with JPEG as the url', async ({ page }) => {
  await createBlok(page, ['jpeg', 'webp', 'avif']);
  await upload(page, PHOTO_FIXTURE_PATH);

  const saved = await savedImage(page);
  const types = (saved.variants ?? []).map((variant) => variant.mimeType);

  // Every engine encodes JPEG, so it is always made, always last, always the url.
  expect(types.at(-1)).toBe('image/jpeg');
  expect(saved.url).toBe(saved.variants?.at(-1)?.url);
  expect([...types].sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))).toEqual(types);
  expect(await page.evaluate(() => window.__uploads?.map((u) => u.type))).toEqual(types);
});

test('the image shows the best format this browser made, through a picture element', async ({ page }) => {
  await createBlok(page, ['jpeg', 'webp', 'avif']);
  await upload(page, PHOTO_FIXTURE_PATH);

  const saved = await savedImage(page);

  // An empty alt makes the img presentational; name it so it has the img role.
  await page.evaluate(async () => {
    const block = window.blokInstance?.blocks.getBlockByIndex(0);

    if (block) await window.blokInstance?.blocks.update(block.id, { alt: 'photo' });
  });

  const img = page.locator(IMAGE_BLOCK_SELECTOR).getByRole('img', { name: 'photo' });

  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(800);

  const shown = await img.evaluate((el: HTMLImageElement) => ({ current: el.currentSrc, parent: el.parentElement?.tagName }));

  // A decoded naturalWidth proves the chosen format really rendered: a <picture>
  // does not fall back when its chosen source fails to decode.
  expect(shown.current).toBe(saved.variants?.[0]?.url ?? saved.url);
  // A browser that only made JPEG has nothing better to offer.
  expect(shown.parent).toBe((saved.variants?.length ?? 0) > 1 ? 'PICTURE' : 'FIGURE');
});

test('a transparent PNG never becomes a JPEG', async ({ page }) => {
  await createBlok(page, ['webp', 'jpeg', 'png']);
  await upload(page, TRANSPARENT_FIXTURE_PATH);

  const saved = await savedImage(page);
  const types = (saved.variants ?? []).map((variant) => variant.mimeType);

  expect(types).not.toContain('image/jpeg');
  expect(types.at(-1)).toBe('image/png');
});

test('saved variants survive a reload', async ({ page }) => {
  await createBlok(page, ['jpeg', 'webp']);
  await upload(page, PHOTO_FIXTURE_PATH);
  await savedImage(page);

  const first = await savedDocument(page);

  await createBlok(page, ['jpeg', 'webp'], first);

  const second = await savedDocument(page);

  expect(second?.blocks[0].data.variants).toEqual(first?.blocks[0].data.variants);
});

test('a best-format source that fails once is retried inside the picture', async ({ page }) => {
  const photo = readFileSync(PHOTO_FIXTURE_PATH);
  const hits = { avif: 0 };

  // Decoders sniff the bytes, so JPEG bytes stand in for the AVIF file.
  await page.route('https://media.test/**', async (route) => {
    if (route.request().url().endsWith('.avif') && hits.avif++ === 0) {
      await route.fulfill({ status: 500, body: '' });

      return;
    }
    await route.fulfill({ status: 200, contentType: 'image/jpeg', body: photo });
  });

  await createBlok(page, ['jpeg', 'avif'], { blocks: [{ type: 'image', data: {
    url: 'https://media.test/a.jpg',
    alt: 'photo',
    variants: [
      { url: 'https://media.test/a.avif', mimeType: 'image/avif' },
      { url: 'https://media.test/a.jpg', mimeType: 'image/jpeg' },
    ],
  } }] });

  const img = page.locator(IMAGE_BLOCK_SELECTOR).getByRole('img', { name: 'photo' });

  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(800);
  expect(await img.evaluate((el: HTMLImageElement) => el.currentSrc)).toBe('https://media.test/a.avif');
  expect(hits.avif).toBeGreaterThan(1);
});

