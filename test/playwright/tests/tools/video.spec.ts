// test/playwright/tests/tools/video.spec.ts

import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const VIDEO_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="video"]`;
// A real, decodable H.264 clip (640×360) served by the Playwright webServer,
// which runs `npx serve .` from the repo root. It MUST decode: any `error`
// event on the <video> routes the block to the terminal ERROR state, which
// tears the player out of the DOM (src/tools/video/index.ts renderState).
// A dead/remote URL made these tests race the ~250 ms network failure.
// The origin is derived from the test page so a webServer port change carries
// over, and the `.mp4` suffix satisfies URL_PATTERN (video/constants.ts).
const SAMPLE_VIDEO_FILE = 'public/samples/big-buck-bunny.mp4';
const SAMPLE_VIDEO_URL = new URL(`/${SAMPLE_VIDEO_FILE}`, TEST_PAGE_URL).href;
const SAMPLE_VIDEO_PATH = join(process.cwd(), SAMPLE_VIDEO_FILE);

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
  await videoBlock.locator('[data-action="from-link"]').click();
  await videoBlock.getByPlaceholder('Paste a video link…').fill(SAMPLE_VIDEO_URL);
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
  await videoBlock.getByTestId('file-input').setInputFiles(SAMPLE_VIDEO_PATH);

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

test('hovering a never-played video shows only the play button, not the control bar', async ({ page }) => {
  await createBlok(page, {
    blocks: [{ type: 'video', data: { url: SAMPLE_VIDEO_URL } }],
  });

  const videoBlock = page.locator(VIDEO_BLOCK_SELECTOR);
  await expect(videoBlock).toHaveAttribute('data-state', 'rendered');

  const player = videoBlock.getByTestId('video-player');
  const bar = videoBlock.locator('[data-role="video-controls"] [data-action="play-toggle"]').locator('xpath=..');
  const centerPlay = videoBlock.locator('[data-role="center-play"]');
  const barOpacity = (): Promise<string> => bar.evaluate((el) => getComputedStyle(el).opacity);

  await player.hover({ position: { x: 40, y: 40 } });
  await expect(centerPlay).toBeVisible();
  await expect.poll(barOpacity).toBe('0');

  await centerPlay.click();
  await expect(videoBlock.locator('[data-role="video-figure"]')).toHaveAttribute('data-played', 'true');
  await player.evaluate((el) => (el as HTMLVideoElement).pause());

  await page.mouse.move(0, 0);
  await player.hover({ position: { x: 40, y: 40 } });
  await expect.poll(barOpacity).toBe('1');
});

test('the speed submenu: drag the bead, land on a peg, use a preset, step, and go back', async ({ page }) => {
  await createBlok(page, { blocks: [ { type: 'video', data: { url: SAMPLE_VIDEO_URL } } ] });

  const block = page.locator(VIDEO_BLOCK_SELECTOR);
  const media = block.getByTestId('video-player');
  const rate = (): Promise<number> => media.evaluate((element) => (element as HTMLVideoElement).playbackRate);

  // The bar, gear included, stays hidden until the video has played once.
  await media.evaluate(async (element) => {
    const video = element as HTMLVideoElement;

    video.muted = true;
    await video.play();
    video.pause();
  });
  await block.hover();
  await block.locator('[data-action="gear"]').click();

  const menu = block.locator('[data-role="playback-menu"]');

  await expect(menu).toHaveAttribute('data-pane', 'main');
  await expect(menu.getByRole('button', { name: 'Playback speed Normal', exact: true })).toBeVisible();
  // The lab's corners: a 14px glass card with 9px rows.
  await expect(menu).toHaveCSS('border-radius', '14px');
  await expect(menu.getByRole('button', { name: 'Playback speed Normal', exact: true })).toHaveCSS('border-radius', '9px');

  // The card sits clear of the whole control bar: 8px above it, and the bar's
  // edge is itself 6px above the gear.
  await menu.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });
  const cardBox = await menu.boundingBox();
  const gearBox = await block.locator('[data-action="gear"]').boundingBox();

  if (!cardBox || !gearBox) throw new Error('the card or the gear has no box');
  expect(gearBox.y - (cardBox.y + cardBox.height)).toBeGreaterThanOrEqual(13);

  // A longer translated label keeps to one line: the card widens, the row stays one row tall.
  const speedRow = menu.locator('[data-action="open-speed"]');
  const rowHeight = (): Promise<number> => speedRow.evaluate((element) => (element as HTMLElement).offsetHeight);
  // Layout width: the card is still scaling in, which a bounding box would include.
  const cardWidth = (): Promise<number> => menu.evaluate((element) => (element as HTMLElement).offsetWidth);
  const oneRow = await rowHeight();

  expect(await cardWidth()).toBe(264);
  await speedRow.evaluate((element) => {
    const [label, value] = [...element.querySelectorAll('span')].filter((span) => span.children.length === 0);

    label.textContent = 'Скорость воспроизведения';
    value.textContent = 'Обычная';
  });
  expect(await rowHeight()).toBe(oneRow);
  expect(await cardWidth()).toBeGreaterThan(264);

  await menu.locator('[data-action="open-speed"]').click();
  await expect(menu).toHaveAttribute('data-pane', 'speed');

  // The pane slides in; measure the wire only once it has stopped.
  await menu.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });

  // The submenu is always the 264px card, however wide the main list was.
  expect(await cardWidth()).toBe(264);

  const wire = menu.locator('[data-role="speed-wire"]');
  const box = await wire.boundingBox();

  if (!box) throw new Error('the speed wire has no box');

  // The wire is drawn in a 240-wide space: 26 of padding, then 188 of wire.
  const xAt = (share: number): number => box.x + ((26 + share * 188) / 240) * box.width;
  const y = box.y + box.height / 2;

  // Between two pegs the bead follows the pointer in steps of 0.05.
  await page.mouse.move(xAt(0.5), y);
  await page.mouse.down();
  await page.mouse.move(xAt(0.6), y, { steps: 4 });
  await expect.poll(rate).toBe(1.2);

  // Close to a peg, the peg takes the bead and keeps it a little way past.
  await page.mouse.move(xAt(0.72), y, { steps: 4 });
  await expect.poll(rate).toBe(1.5);
  await page.mouse.move(xAt(0.81), y, { steps: 4 });
  await expect.poll(rate).toBe(1.5);
  await page.mouse.up();

  await menu.getByRole('button', { name: '0.5×', exact: true }).click();
  await expect.poll(rate).toBe(0.5);
  await expect(menu.locator('[data-role="speed-presets"] [aria-pressed]')).toHaveCount(0);

  await menu.getByRole('button', { name: 'Increase playback speed', exact: true }).click();
  await expect.poll(rate).toBe(0.55);
  await expect(menu.locator('[data-role="speed-readout"]')).toHaveText('0.55×');

  await menu.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(menu).toHaveAttribute('data-pane', 'main');
  await expect(menu.locator('[data-action="open-speed"]')).toContainText('0.55×');

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
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
