// test/playwright/tests/tools/audio.spec.ts

import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;

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

// ---------------------------------------------------------------------------
// 6. Cover — set from URL
// ---------------------------------------------------------------------------
test('user can set a cover image from a URL', async ({ page }) => {
  await createBlok(page);
  await insertAudioBlock(page);

  const audioBlock = page.locator(AUDIO_BLOCK_SELECTOR);

  // Upload sample audio so the player renders (cover area appears once rendered).
  await audioBlock.getByTestId('file-input').setInputFiles(FIXTURE_PATH);
  await expect(audioBlock.locator('[data-role="audio-controls"]')).toBeVisible();

  // Hover the cover area to reveal the change-cover overlay button.
  const cover = audioBlock.locator('[data-role="audio-cover"]');
  await cover.hover();

  // Click the change-cover button.
  const changeBtn = audioBlock.locator('[data-role="audio-cover-change"]');
  await expect(changeBtn).toBeVisible();
  await changeBtn.click();

  // The picker dialog is promoted to the CSS top layer (appended to document.body)
  // — locate it at the page level, NOT scoped inside the audio block selector.
  const picker = page.locator('[data-role="audio-cover-picker"]');
  await expect(picker).toBeVisible();

  // Switch to the Link (embed) tab with a real click.
  await picker.locator('[data-tab="embed"]').click();

  // The URL input must be visible — this assertion guards the rendered picker width.
  // A 2px-wide picker would make the input invisible/unreachable, catching the bug.
  await expect(picker.locator('input[type="url"]')).toBeVisible();

  // Fill the URL and submit with real interactions.
  await picker.locator('input[type="url"]').fill('https://example.com/cover.jpg');
  await picker.locator('[data-action="submit-url"]').click();

  // The cover img must appear with the submitted src.
  const coverImg = page.locator(`${AUDIO_BLOCK_SELECTOR} [data-role="audio-cover"] img`);
  await expect(coverImg).toBeAttached();
  await expect(coverImg).toHaveAttribute('src', 'https://example.com/cover.jpg');
});

test('cover picker paints a themed surface matching the player (no white canvas)', async ({ page }) => {
  await createBlok(page);

  // Force dark theme on the document root so the body-level top-layer picker
  // resolves dark tokens — the exact condition under which it used to render the
  // UA white [popover] canvas behind its translucent card.
  await page.evaluate(() => document.documentElement.setAttribute('data-blok-theme', 'dark'));

  await insertAudioBlock(page);

  const audioBlock = page.locator(AUDIO_BLOCK_SELECTOR);
  await audioBlock.getByTestId('file-input').setInputFiles(FIXTURE_PATH);
  await expect(audioBlock.locator('[data-role="audio-controls"]')).toBeVisible();

  const cover = audioBlock.locator('[data-role="audio-cover"]');
  await cover.hover();
  const changeBtn = audioBlock.locator('[data-role="audio-cover-change"]');
  await expect(changeBtn).toBeVisible();
  await changeBtn.click();

  const picker = page.locator('[data-role="audio-cover-picker"]');
  await expect(picker).toBeVisible();

  // The picker must paint a solid themed surface (the player's --blok-bg-primary)
  // so the dark theme's translucent card layers over dark, never the UA white
  // [popover] canvas the top-layer reset leaves unset.
  const surfaces = await page.evaluate(() => {
    const pick = document.querySelector('[data-role="audio-cover-picker"]');
    const player = document.querySelector('[data-blok-tool="audio"] .blok-audio-inner');
    return {
      picker: pick ? getComputedStyle(pick).backgroundColor : null,
      player: player ? getComputedStyle(player).backgroundColor : null,
    };
  });
  expect(surfaces.picker).toBe(surfaces.player);
  // Guard the specific regression: a white [popover] canvas behind the card.
  expect(surfaces.picker).not.toBe('rgb(255, 255, 255)');
});

// ---------------------------------------------------------------------------
// 7. Cover — remove via block settings restores the spinning disc
// ---------------------------------------------------------------------------
test('user can remove a cover and the vinyl disc returns', async ({ page }) => {
  await createBlok(page);
  await insertAudioBlock(page);

  const audioBlock = page.locator(AUDIO_BLOCK_SELECTOR);

  // Upload sample audio so the player renders.
  await audioBlock.getByTestId('file-input').setInputFiles(FIXTURE_PATH);
  await expect(audioBlock.locator('[data-role="audio-controls"]')).toBeVisible();

  // Set a cover via URL (reuse the same flow as the test above).
  const cover = audioBlock.locator('[data-role="audio-cover"]');
  await cover.hover();
  const changeBtn = audioBlock.locator('[data-role="audio-cover-change"]');
  await expect(changeBtn).toBeVisible();
  await changeBtn.click();

  const picker2 = page.locator('[data-role="audio-cover-picker"]');
  await expect(picker2).toBeVisible();
  await picker2.locator('[data-tab="embed"]').click();
  await expect(picker2.locator('input[type="url"]')).toBeVisible();
  await picker2.locator('input[type="url"]').fill('https://example.com/cover.jpg');
  await picker2.locator('[data-action="submit-url"]').click();

  // Confirm cover img is set before removing it.
  const coverImg = page.locator(`${AUDIO_BLOCK_SELECTOR} [data-role="audio-cover"] img`);
  await expect(coverImg).toBeAttached();

  // Open block settings — hover the block first so the settings toggler appears.
  await audioBlock.hover();
  const settingsBtn = page.locator(SETTINGS_BUTTON_SELECTOR);
  await expect(settingsBtn).toBeVisible();
  await settingsBtn.click();

  // Click the "Remove cover" settings item.
  const removeItem = page.locator('[data-blok-item-name="audio-cover-remove"]');
  await expect(removeItem).toBeVisible();
  await removeItem.click();

  // The img must be gone and the vinyl disc placeholder must return.
  await expect(page.locator(`${AUDIO_BLOCK_SELECTOR} [data-role="audio-cover"] img`)).toHaveCount(0);
  await expect(page.locator(`${AUDIO_BLOCK_SELECTOR} .blok-audio-cover__disc`)).toBeVisible();
});
