// test/playwright/tests/tools/video-format-variants.spec.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import type { MediaVariant, VideoFormat } from '@/types/configs/media';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const VIDEO_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="video"]`;
/** 2 s, 320×240, VP9 + Opus. */
const CLIP_PATH = join(process.cwd(), 'test/playwright/fixtures/video/clip.webm');
/** Served the way a host would ship it: the host installs Mediabunny, Blok never bundles it. */
const MEDIABUNNY_URL = 'https://media.test/mediabunny.mjs';
const MEDIABUNNY_BUNDLE = join(process.cwd(), 'node_modules/mediabunny/dist/bundles/mediabunny.min.mjs');

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

interface SavedVideo {
  url: string;
  mimeType?: string;
  variants?: MediaVariant[];
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.route(MEDIABUNNY_URL, (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: readFileSync(MEDIABUNNY_BUNDLE),
  }));
});

const createBlok = async (page: Page, formats: VideoFormat[], withMediabunny = true): Promise<void> => {
  await page.evaluate(async ({ holder, videoFormats, loaderUrl }) => {
    await window.blokInstance?.destroy?.();
    window.blokInstance = undefined;
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    const blok = new window.Blok({
      holder,
      data: { blocks: [{ type: 'video', data: {} }] },
      media: {
        formats: { video: videoFormats },
        ...(loaderUrl === null ? {} : { mediabunny: () => import(/* @vite-ignore */ loaderUrl) }),
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, videoFormats: formats, loaderUrl: withMediabunny ? MEDIABUNNY_URL : null });
};

const upload = (page: Page): Promise<void> =>
  page.locator(VIDEO_BLOCK_SELECTOR).getByTestId('file-input').setInputFiles(CLIP_PATH);

const saved = (page: Page): Promise<SavedVideo> =>
  page.evaluate(async () => {
    const data = await window.blokInstance?.save();

    return data?.blocks[0].data as unknown as SavedVideo;
  });

/** Whether leaving the page right now would ask the user first. */
const leaveIsGuarded = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });

    window.dispatchEvent(event);

    return event.defaultPrevented;
  });

const converting = (page: Page): ReturnType<Page['getByTestId']> =>
  page.locator(VIDEO_BLOCK_SELECTOR).getByTestId('video-converting');

test('the original plays at once, then the video gains every format this browser can make', async ({ page }) => {
  test.setTimeout(60_000);
  await createBlok(page, ['mp4', 'webm']);
  await upload(page);

  const block = page.locator(VIDEO_BLOCK_SELECTOR);

  await expect(block).toHaveAttribute('data-state', 'rendered');
  await expect(block.getByTestId('video-player')).toHaveAttribute('src', /^blob:/);

  const original = (await saved(page)).url;

  await expect(converting(page)).toBeHidden({ timeout: 45_000 });

  const after = await saved(page);
  const variants = after.variants ?? [];

  // VP9 + Opus already fit WebM, so that format is a lossless copy every Chromium can make.
  expect(variants.some((variant) => variant.mimeType.startsWith('video/webm'))).toBe(true);
  // url is always the last entry: the MP4 when this build could encode one, else the original.
  expect(variants.at(-1)?.url).toBe(after.url);
  expect(after.url === original || after.mimeType === 'video/mp4').toBe(true);
});

test('asks before the page is left while it converts, and not after', async ({ page }) => {
  test.setTimeout(60_000);
  await createBlok(page, ['webm']);
  await upload(page);

  await expect(converting(page)).toBeVisible();
  expect(await leaveIsGuarded(page)).toBe(true);

  await expect(converting(page)).toBeHidden({ timeout: 45_000 });
  expect(await leaveIsGuarded(page)).toBe(false);
});

test('without Mediabunny from the host, the upload is left as it is', async ({ page }) => {
  await createBlok(page, ['webm'], false);
  await upload(page);

  await expect(page.locator(VIDEO_BLOCK_SELECTOR)).toHaveAttribute('data-state', 'rendered');
  await expect(converting(page)).toHaveCount(0);
  expect((await saved(page)).variants).toBeUndefined();
  expect(await leaveIsGuarded(page)).toBe(false);
});

test('saved variants render as sources after a reload', async ({ page }) => {
  test.setTimeout(60_000);
  await createBlok(page, ['webm']);
  await upload(page);
  await expect(converting(page)).toBeHidden({ timeout: 45_000 });

  const data: OutputData | undefined = await page.evaluate(async () => window.blokInstance?.save());

  await page.evaluate(async ({ holder, initial }) => {
    await window.blokInstance?.destroy?.();
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
    window.blokInstance = new window.Blok({ holder, data: initial });
    await window.blokInstance.isReady;
  }, { holder: HOLDER_ID, initial: data });

  const player = page.locator(VIDEO_BLOCK_SELECTOR).getByTestId('video-player');

  await expect(player).not.toHaveAttribute('src', /.+/);
  await expect.poll(() => player.evaluate((el: HTMLVideoElement) => el.readyState)).toBeGreaterThan(0);
});
