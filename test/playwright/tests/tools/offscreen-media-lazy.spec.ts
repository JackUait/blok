import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';

// The query tags each file, so a request is easy to spot. `serve` ignores it.
const IMAGE_URL = new URL('/public/samples/soundhelix-song-1-cover.png?offscreen-image', TEST_PAGE_URL).href;
const VIDEO_URL = new URL('/public/samples/big-buck-bunny.mp4?offscreen-video', TEST_PAGE_URL).href;
const AUDIO_URL = new URL('/public/samples/soundhelix-song-1.mp3?offscreen-audio', TEST_PAGE_URL).href;
const MEDIA_URLS = [IMAGE_URL, VIDEO_URL, AUDIO_URL];
const VISIBLE_IMAGE_URL = new URL('/public/samples/soundhelix-song-1-cover.png?visible-image', TEST_PAGE_URL).href;

// Far past the browser's own lazy-image distance, so the media starts well offscreen.
const FILLER_PARAGRAPHS = 250;

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
});

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await page.evaluate(async ({ holder, initialData }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: initialData });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: data });
};

const longDocument = (): OutputData => ({
  blocks: [
    { id: 'top', type: 'image', data: { url: VISIBLE_IMAGE_URL } },
    ...Array.from({ length: FILLER_PARAGRAPHS }, (_, i) => ({ id: `p${i}`, type: 'paragraph', data: { text: `Line ${i}` } })),
    { id: 'img', type: 'image', data: { url: IMAGE_URL } },
    { id: 'vid', type: 'video', data: { url: VIDEO_URL } },
    { id: 'aud', type: 'audio', data: { url: AUDIO_URL } },
  ],
});

test('media below the fold downloads only once the reader scrolls to it', async ({ page }) => {
  const requested = new Set<string>();

  page.on('request', (request) => {
    if (MEDIA_URLS.includes(request.url())) requested.add(request.url());
  });

  await createBlok(page, longDocument());
  // An eager element starts its request at render, long before the top picture finishes.
  await expect.poll(() => page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-tool="image"] img`).first()
    .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  expect([...requested]).toEqual([]);

  await page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-tool="audio"]`).scrollIntoViewIfNeeded();

  await expect.poll(() => [...requested].sort()).toEqual([...MEDIA_URLS].sort());
});
