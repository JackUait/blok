// test/playwright/tests/tools/audio.spec.ts

import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const AUDIO_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="audio"]`;
const FIXTURE_PATH = join(process.cwd(), 'test/playwright/fixtures/audio/sample.mp3');

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

const createBlok = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder }) => {
      const blok = new window.Blok({ holder });
      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID }
  );
};

/** Insert an audio block via the slash menu. */
const insertAudioBlock = async (page: Page): Promise<void> => {
  const defaultParagraph = page.locator(
    `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`
  );
  await defaultParagraph.click();
  await page.keyboard.type('/audio', { delay: 50 });
  const menuItem = page.locator('[data-blok-item-name="audio"]');
  await expect(menuItem).toBeVisible();
  await menuItem.click();
  await expect(page.locator(AUDIO_BLOCK_SELECTOR)).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_PAGE_URL);
});

// ---------------------------------------------------------------------------
// 1. Insert — empty state
// ---------------------------------------------------------------------------
test('inserts an audio block via the slash menu and shows the empty state', async ({ page }) => {
  await createBlok(page);
  await insertAudioBlock(page);

  const audioBlock = page.locator(AUDIO_BLOCK_SELECTOR);
  await expect(audioBlock).toBeVisible();

  // Empty state exposes the file input for upload.
  await expect(audioBlock.getByTestId('file-input')).toBeAttached();
});

// ---------------------------------------------------------------------------
// 2. Upload — media + controls appear
// ---------------------------------------------------------------------------
test('uploads an audio file and renders the player with controls', async ({ page }) => {
  await createBlok(page);
  await insertAudioBlock(page);

  const audioBlock = page.locator(AUDIO_BLOCK_SELECTOR);

  // Upload the fixture MP3 via the hidden file input.
  await audioBlock.getByTestId('file-input').setInputFiles(FIXTURE_PATH);

  // The <audio> element and controls bar must appear.
  // The <audio> element is typically hidden via CSS (no visual chrome) — use toBeAttached.
  await expect(audioBlock.locator('[data-role="audio-media"]')).toBeAttached();
  await expect(audioBlock.locator('[data-role="audio-controls"]')).toBeVisible();

  // Verify the audio src is a blob URL (created by URL.createObjectURL fallback).
  await expect(audioBlock.locator('[data-role="audio-media"]')).toHaveAttribute('src', /^blob:/);
});

// ---------------------------------------------------------------------------
// 3. Play — button toggles to pause affordance
// ---------------------------------------------------------------------------
test('clicking the play button flips it to a pause affordance', async ({ page }) => {
  await createBlok(page);
  await insertAudioBlock(page);

  const audioBlock = page.locator(AUDIO_BLOCK_SELECTOR);
  await audioBlock.getByTestId('file-input').setInputFiles(FIXTURE_PATH);

  const controls = audioBlock.locator('[data-role="audio-controls"]');
  await expect(controls).toBeVisible();

  const playBtn = audioBlock.locator('[data-role="audio-play"]');
  await expect(playBtn).toBeVisible();

  // Before play: aria-label is "Play".
  await expect(playBtn).toHaveAttribute('aria-label', 'Play');

  // Wait for media metadata to load so that play() is more likely to succeed.
  await expect.poll(
    () => page.evaluate(() => {
      const audio = document.querySelector<HTMLAudioElement>('[data-role="audio-media"]');
      return audio ? audio.readyState : 0;
    }),
    { timeout: 10_000 }
  ).toBeGreaterThanOrEqual(1); // HAVE_METADATA

  // Click the play button — this is a real trusted user gesture so headless
  // Chromium permits media.play(). The controls wire up an 'onPlay' listener
  // on the media element that calls setPlaying(true), which synchronously:
  //   • sets figure[data-playing]="true"
  //   • sets playToggle[aria-label]="Pause"
  await playBtn.click();

  // Assert the UI flipped via web-first auto-waiting (no fixed sleeps).
  await expect(playBtn).toHaveAttribute('aria-label', 'Pause');
  await expect(audioBlock.locator('[data-role="audio-figure"]')).toHaveAttribute('data-playing', 'true');
});

// ---------------------------------------------------------------------------
// 4. Seek — clicking the waveform canvas advances currentTime and the readout
// ---------------------------------------------------------------------------
test('seeking via the waveform canvas advances the time readout', async ({ page }) => {
  await createBlok(page);
  await insertAudioBlock(page);

  const audioBlock = page.locator(AUDIO_BLOCK_SELECTOR);
  await audioBlock.getByTestId('file-input').setInputFiles(FIXTURE_PATH);

  const controls = audioBlock.locator('[data-role="audio-controls"]');
  await expect(controls).toBeVisible();

  const timeEl = audioBlock.locator('[data-role="audio-time"]');
  await expect(timeEl).toBeVisible();

  // The waveform canvas seek handler (pointerdown) only sets currentTime when
  // media.duration is finite. Wait for loadedmetadata so duration is available.
  await expect.poll(
    () => page.evaluate(() => {
      const audio = document.querySelector<HTMLAudioElement>('[data-role="audio-media"]');
      return audio ? audio.duration : 0;
    }),
    { timeout: 10_000 }
  ).toBeGreaterThan(0);

  // Locate the waveform canvas and get its bounding box.
  const canvas = audioBlock.locator('[data-role="audio-waveform-canvas"]');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas bounding box not available');

  // Click near the horizontal center of the canvas (~50% position).
  // This dispatches a real pointerdown event that the waveform handler uses to
  // compute: currentTime = ratio * duration  →  ~4s for an 8s fixture.
  await canvas.click({ position: { x: Math.round(box.width / 2), y: Math.round(box.height / 2) } });

  // Assert currentTime advanced beyond 0.
  await expect.poll(
    () => page.evaluate(() => {
      const audio = document.querySelector<HTMLAudioElement>('[data-role="audio-media"]');
      return audio ? audio.currentTime : 0;
    }),
    { timeout: 5_000 }
  ).toBeGreaterThan(0);

  // Assert the time readout no longer shows "0:00" — it should display something
  // like "00:03" or "00:04" (center of an 8s track).
  await expect(timeEl).not.toContainText('0:00 / 0:00');
});

// ---------------------------------------------------------------------------
// 5. Regression — the volume slider and time readout must NOT inherit the
//    generic 30×30 pill-button styling. The control bar's button rule was once
//    written as `.blok-audio-controls [data-role]`, which also matched the
//    volume <input data-role="audio-volume"> and the time <span data-role=
//    "audio-time"> — rendering the volume as a fat 30px pill toggle and
//    squashing the time text into a 30px grid box. Scoping the rule to
//    `button[data-role]` is what keeps these slim/natural.
// ---------------------------------------------------------------------------
test('volume slider and time readout do not inherit pill-button sizing', async ({ page }) => {
  await createBlok(page);
  await insertAudioBlock(page);

  const audioBlock = page.locator(AUDIO_BLOCK_SELECTOR);
  await audioBlock.getByTestId('file-input').setInputFiles(FIXTURE_PATH);

  await expect(audioBlock.locator('[data-role="audio-controls"]')).toBeVisible();

  const metrics = await audioBlock.evaluate((root) => {
    const read = (selector: string): { height: number; width: number; display: string } => {
      const el = root.querySelector(selector);
      if (!el) throw new Error(`missing ${selector}`);
      const cs = getComputedStyle(el);
      return { height: parseFloat(cs.height), width: parseFloat(cs.width), display: cs.display };
    };
    return {
      volume: read('[data-role="audio-volume"]'),
      time: read('[data-role="audio-time"]'),
    };
  });

  // The volume slider is a slim track, not a 30px circular pill.
  expect(metrics.volume.height).toBeLessThan(12);
  expect(metrics.volume.display).not.toBe('grid');

  // The time readout is a free-flowing text span wide enough for "MM:SS / MM:SS",
  // not a 30px square button box.
  expect(metrics.time.display).not.toBe('grid');
  expect(metrics.time.width).toBeGreaterThan(40);
});
