// test/playwright/tests/tools/image-gif-to-video.spec.ts

import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const IMAGE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="image"]`;
const VIDEO_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="video"]`;
/** 160×120, 20 frames × 100 ms. */
const GIF_PATH = join(process.cwd(), 'test/playwright/fixtures/image/animated.gif');

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

interface SavedBlock {
  type: string;
  data: { url?: string; fileName?: string; mimeType?: string; autoplay?: boolean; loop?: boolean };
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

const createBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    await window.blokInstance?.destroy?.();
    window.blokInstance = undefined;
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: { blocks: [{ type: 'image', data: {} }] } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

const savedBlocks = (page: Page): Promise<SavedBlock[]> =>
  page.evaluate(async () => {
    const data = await window.blokInstance?.save();

    return data?.blocks ?? [];
  });

test('an animated GIF put into an image block becomes a looping WebM video block', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Only Chromium has ImageDecoder, so only it converts GIFs');
  test.setTimeout(45_000);
  await createBlok(page);
  await page.locator(IMAGE_BLOCK_SELECTOR).getByTestId('file-input').setInputFiles(GIF_PATH);

  await expect(page.locator(VIDEO_BLOCK_SELECTOR)).toHaveCount(1, { timeout: 30_000 });

  const blocks = await savedBlocks(page);

  expect(blocks.map((block) => block.type)).toEqual(['video']);
  expect(blocks[0].data).toMatchObject({
    fileName: 'animated.webm',
    mimeType: 'video/webm',
    autoplay: true,
    loop: true,
  });

  const header = await page.evaluate(async (url) => {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());

    return Array.from(bytes.slice(0, 4));
  }, blocks[0].data.url ?? '');

  // EBML magic: the bytes really are a WebM file, not the GIF renamed.
  expect(header).toEqual([0x1a, 0x45, 0xdf, 0xa3]);

  const duration = await page.evaluate((url) => new Promise<number>((resolve, reject) => {
    const video = document.createElement('video');

    video.onloadedmetadata = () => resolve(video.duration);
    video.onerror = () => reject(new Error('the WebM does not load'));
    video.src = url;
  }), blocks[0].data.url ?? '');

  // 20 frames × 100 ms: the last frame keeps its full delay.
  expect(duration).toBeCloseTo(2, 2);
});

test('the converted WebM is one Safari and the Mac hardware decoder accept', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Only Chromium has ImageDecoder, so only it converts GIFs');
  test.setTimeout(45_000);
  await createBlok(page);
  await page.locator(IMAGE_BLOCK_SELECTOR).getByTestId('file-input').setInputFiles(GIF_PATH);

  await expect(page.locator(VIDEO_BLOCK_SELECTOR)).toHaveCount(1, { timeout: 30_000 });

  const [block] = await savedBlocks(page);
  const file = await page.evaluate(async (url) => {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const find = (needle: number[], from: number): number =>
      bytes.findIndex((_byte, i) => i >= from && needle.every((b, j) => bytes[i + j] === b));
    // The first frame is a key frame: its header holds the VP9 sync code, then the colour bits.
    const sync = find([0x49, 0x83, 0x42], find([0x1f, 0x43, 0xb6, 0x75], 0));

    return { docType: find([0x42, 0x82], 0), colourBits: bytes[sync + 3] >> 4 };
  }, block.data.url ?? '');

  // Safari sniffs a URL with no .webm extension and misses a DocType far from the start.
  expect(file.docType).toBe(21);
  // 0b0100 is BT.709, limited range. Chrome's VideoToolbox decoder fails on full range (0b0101).
  expect(file.colourBits).toBe(0b0100);
});
