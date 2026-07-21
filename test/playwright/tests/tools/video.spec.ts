// test/playwright/tests/tools/video.spec.ts

import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const VIDEO_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="video"]`;
const SAMPLE_VIDEO_URL = 'https://example.com/sample.mp4';

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

const insertVideoBlock = async (page: Page): Promise<void> => {
  const defaultParagraph = page.locator(
    `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`
  );
  await defaultParagraph.click();
  await page.keyboard.type('/video', { delay: 50 });
  const menuItem = page.locator('[data-blok-item-name="video"]');
  await expect(menuItem).toBeVisible();
  await menuItem.click();
  await expect(page.locator(VIDEO_BLOCK_SELECTOR)).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
});

test('inserts a video via the slash menu and embeds a URL', async ({ page }) => {
  await createBlok(page);
  await insertVideoBlock(page);

  const videoBlock = page.locator(VIDEO_BLOCK_SELECTOR);
  await videoBlock.locator('[data-tab="embed"]').click();
  await videoBlock.getByPlaceholder('Paste a video URL…').fill(SAMPLE_VIDEO_URL);
  await videoBlock.locator('[data-action="submit-url"]').click();

  await expect(videoBlock).toHaveAttribute('data-state', 'rendered');
  const player = videoBlock.getByTestId('video-player');
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute('src', SAMPLE_VIDEO_URL);
  // Native chrome is replaced by a custom Airbnb-style control surface.
  await expect(player).not.toHaveAttribute('controls', /.*/);
  const controls = videoBlock.locator('[data-role="video-controls"]');
  await expect(controls).toBeAttached();
  await expect(controls.locator('[data-action="play-toggle"]').first()).toBeAttached();
  await expect(controls.locator('[data-role="seek"]')).toBeAttached();
  await expect(controls.locator('[data-action="fullscreen"]')).toBeAttached();
});

test('uploads a video file via the picker and renders a player', async ({ page }) => {
  await createBlok(page);
  await insertVideoBlock(page);

  const videoBlock = page.locator(VIDEO_BLOCK_SELECTOR);
  await videoBlock.getByTestId('file-input').setInputFiles({
    name: 'clip.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]),
  });

  await expect(videoBlock).toHaveAttribute('data-state', 'rendered');
  const player = videoBlock.getByTestId('video-player');
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute('src', /^blob:/);
});

test('fullscreen hides editor chrome and keeps only playback controls', async ({ page }) => {
  await createBlok(page, {
    blocks: [{ type: 'video', data: { url: SAMPLE_VIDEO_URL, caption: 'My clip', alignment: 'center' } }],
  });

  const videoBlock = page.locator(VIDEO_BLOCK_SELECTOR);
  await expect(videoBlock).toHaveAttribute('data-state', 'rendered');

  const figure = videoBlock.locator('[data-role="video-figure"]');
  const display = (locator: ReturnType<Page['locator']>): Promise<string> =>
    locator.evaluate((el) => getComputedStyle(el).display);

  // Editor chrome is visible (in the DOM, not display:none) before fullscreen.
  await expect(display(videoBlock.locator('[data-role="video-caption-row"]'))).resolves.not.toBe('none');

  // Enter fullscreen by flipping the flag the controls toggle (matches
  // controls.ts onFullscreenChange) — avoids the headless requestFullscreen gate.
  await figure.evaluate((el) => el.setAttribute('data-fullscreen', 'true'));

  // Caption + resize handles drop out of the fullscreen view.
  await expect(display(videoBlock.locator('[data-role="video-caption-row"]'))).resolves.toBe('none');
  await expect(display(videoBlock.locator('[data-role="resize-handle"]').first())).resolves.toBe('none');

  // Playback controls survive — that is the whole point of fullscreen.
  await expect(display(videoBlock.locator('[data-role="video-controls"]'))).resolves.not.toBe('none');
  await expect(videoBlock.locator('[data-action="fullscreen"]')).toBeAttached();

  // The figure centers its player both axes so it fits any screen aspect
  // (object-fit:contain — the <video> UA default — then letterboxes the frame).
  const layout = await figure.evaluate((el) => {
    const s = getComputedStyle(el);
    return { display: s.display, alignItems: s.alignItems, justifyContent: s.justifyContent };
  });
  expect(layout).toEqual({ display: 'flex', alignItems: 'center', justifyContent: 'center' });
  await expect(
    videoBlock.getByTestId('video-player').evaluate((el) => getComputedStyle(el).objectFit)
  ).resolves.toBe('contain');
});

test('persists video data across save and reload', async ({ page }) => {
  await createBlok(page, {
    blocks: [{ type: 'video', data: { url: SAMPLE_VIDEO_URL, caption: 'My clip', alignment: 'center' } }],
  });

  const videoBlock = page.locator(VIDEO_BLOCK_SELECTOR);
  await expect(videoBlock).toHaveAttribute('data-state', 'rendered');
  await expect(videoBlock.getByTestId('video-player')).toHaveAttribute('src', SAMPLE_VIDEO_URL);

  const saved = await page.evaluate(async () => {
    const out = await window.blokInstance?.save?.();
    return out?.blocks?.[0];
  });
  expect(saved?.type).toBe('video');
  expect((saved?.data as { url?: string })?.url).toBe(SAMPLE_VIDEO_URL);
  expect((saved?.data as { caption?: string })?.caption).toBe('My clip');
});
