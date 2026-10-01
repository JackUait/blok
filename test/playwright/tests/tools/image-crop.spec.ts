// test/playwright/tests/tools/image-crop.spec.ts

import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

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

const saveBlok = async (page: Page): Promise<OutputData> => {
  const saved = await page.evaluate(() => window.blokInstance?.save());

  expect(saved, 'no blok instance').toBeTruthy();

  return saved as OutputData;
};

const seedImage = async (
  page: Page,
  crop?: { x: number; y: number; w: number; h: number }
): Promise<void> => {
  const data: OutputData = {
    blocks: [{
      type: 'image',
      data: { url: SAMPLE_IMAGE_URL, ...(crop ? { crop } : {}) },
    }],
  };
  await gotoTestPage(page);
  await page.evaluate(async ({ holder, initialData }) => {
    document.getElementById(holder)?.remove();
    const c = document.createElement('div'); c.id = holder; document.body.appendChild(c);
    const blok = new window.Blok({ holder, data: initialData });
    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: data });
};

const openDarkroom = async (page: Page, crop?: { x: number; y: number; w: number; h: number }) => {
  await seedImage(page, crop);
  const image = page.locator(IMAGE_BLOCK_SELECTOR);

  await image.hover();
  await image.locator('[data-action="crop"]').click();
  const dialog = page.getByRole('dialog', { name: 'Crop image' });

  await expect(dialog).toBeVisible();
  // Settled is only set once the photo has loaded and been laid out.
  // The fly-in animates the darkroom's own photo; gestures must start from rest.
  await expect(page.locator('[data-role="darkroom-stage"][data-settled]')).toHaveCount(1);

  return { dialog, stage: page.locator('[data-role="darkroom-stage"]') };
};

type FlightSpan = { added: number; removed?: number };
type Recorded = { __flights: FlightSpan[]; __veils: FlightSpan[] };

// The fly-out starts a rAF after Done and may live for one frame only, so polling can miss it.
const recordFlights = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const spans: Record<string, FlightSpan[]> = { 'darkroom-flight': [], 'darkroom-veil': [] };
    const live = new Map<Node, FlightSpan>();

    new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          const list = n instanceof HTMLElement ? spans[n.dataset.role ?? ''] : undefined;

          if (!list) return;
          const span: FlightSpan = { added: performance.now() };

          list.push(span);
          live.set(n, span);
        });
        r.removedNodes.forEach((n) => {
          const span = live.get(n);

          if (span) span.removed = performance.now();
        });
      }
    }).observe(document.body, { childList: true });
    Object.assign(window, { __flights: spans['darkroom-flight'], __veils: spans['darkroom-veil'] });
  });
};

const veilsSoFar = async (page: Page): Promise<FlightSpan[]> =>
  page.evaluate(() => (window as unknown as Recorded).__veils);

const flightsAfterLanding = async (page: Page): Promise<FlightSpan[]> => {
  await expect(page.locator(`${IMAGE_BLOCK_SELECTOR} [data-role="image-crop"]`)).toBeVisible();
  // The flight starts a rAF after Done and lives until its spring settles, many frames later.
  await expect.poll(() => page.evaluate(() => (window as unknown as Recorded).__flights[0]?.removed)).toBeDefined();

  return page.evaluate(() => (window as unknown as Recorded).__flights);
};

const cropOf = async (page: Page) =>
  (await saveBlok(page)).blocks[0].data as { crop?: { x: number; y: number; w: number; h: number; shape?: string } };

test('Done on an untouched image saves no crop', async ({ page }) => {
  const { dialog } = await openDarkroom(page);

  await dialog.locator('[data-action="done"]').click();
  await expect(dialog).toHaveCount(0);
  expect((await cropOf(page)).crop).toBeUndefined();
});

test('Reset clears an existing crop', async ({ page }) => {
  const { dialog } = await openDarkroom(page, { x: 10, y: 10, w: 60, h: 60 });

  await dialog.locator('[data-action="reset"]').click();
  await dialog.locator('[data-action="done"]').click();
  expect((await cropOf(page)).crop).toBeUndefined();
});

test('Cancel keeps the existing crop', async ({ page }) => {
  const { dialog } = await openDarkroom(page, { x: 10, y: 10, w: 60, h: 60 });

  await dialog.locator('[data-action="cancel"]').click();
  expect((await cropOf(page)).crop).toStrictEqual({ x: 10, y: 10, w: 60, h: 60 });
});

test('a press on the dark surround does not cancel', async ({ page }) => {
  const { dialog } = await openDarkroom(page, { x: 10, y: 10, w: 60, h: 60 });

  await page.mouse.click(8, 400);
  await expect(dialog).toBeVisible();
});

test('one Escape cancels', async ({ page }) => {
  const { dialog } = await openDarkroom(page, { x: 10, y: 10, w: 60, h: 60 });

  await page.locator('[data-ratio="1"]').click();
  await expect(page.locator('[data-ratio="1"]')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect((await cropOf(page)).crop).toStrictEqual({ x: 10, y: 10, w: 60, h: 60 });
});

test('wheel zoom narrows the crop', async ({ page }) => {
  const { dialog, stage } = await openDarkroom(page);
  const box = await stage.boundingBox();

  expect(box).not.toBeNull();
  await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
  await page.mouse.wheel(0, -400);
  await expect(page.locator('[data-role="darkroom-stage"][data-settled]')).toHaveCount(1);
  await dialog.locator('[data-action="done"]').click();
  const { crop } = await cropOf(page);

  expect(crop?.w ?? 100).toBeLessThan(100);
});

test('dragging the zoomed photo moves the crop', async ({ page }) => {
  const { dialog, stage } = await openDarkroom(page, { x: 25, y: 25, w: 50, h: 50 });
  const box = await stage.boundingBox();
  const cx = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const cy = (box?.y ?? 0) + (box?.height ?? 0) / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 60, cy, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('[data-role="darkroom-stage"][data-settled]')).toHaveCount(1);
  await dialog.locator('[data-action="done"]').click();
  const { crop } = await cropOf(page);

  expect(crop?.x ?? 25).toBeGreaterThan(25);
});

test('releasing a handle springs the frame back to the centre', async ({ page }) => {
  const { stage } = await openDarkroom(page);
  const handle = page.locator('[data-handle="se"]');
  const hb = await handle.boundingBox();
  const sb = await stage.boundingBox();

  await page.mouse.move((hb?.x ?? 0) + 14, (hb?.y ?? 0) + 14);
  await page.mouse.down();
  await page.mouse.move((hb?.x ?? 0) - 120, (hb?.y ?? 0) - 80, { steps: 8 });
  const frameOffset = async (): Promise<number> => {
    const f = await page.locator('[data-role="darkroom-frame"]').boundingBox();

    return Math.abs(((f?.x ?? 0) + (f?.width ?? 0) / 2) - ((sb?.x ?? 0) + (sb?.width ?? 0) / 2));
  };

  // Without an off-centre frame mid-drag, the spring-back check below proves nothing.
  expect(await frameOffset()).toBeGreaterThan(20);
  await page.mouse.up();
  await expect.poll(frameOffset).toBeLessThan(2);
});

test('Circle saves a crop that is square in pixels', async ({ page }) => {
  const { dialog } = await openDarkroom(page);

  await page.locator('[data-ratio="circle"]').click();
  await dialog.locator('[data-action="done"]').click();
  const { crop } = await cropOf(page);

  expect(crop?.shape).toBe('circle');
  expect(((crop?.w ?? 0) * 600) / ((crop?.h ?? 1) * 400)).toBeCloseTo(1, 1);
});

test('Cmd+Z inside the darkroom undoes the crop edit, not the document', async ({ page }) => {
  await seedImage(page);
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`);

  // A typed edit gives document undo something to revert.
  await page.evaluate(() => window.blokInstance?.blocks.insert('paragraph', { text: '' }));
  await paragraph.click();
  await page.keyboard.type('kept');
  await expect(paragraph).toHaveText('kept');

  const image = page.locator(IMAGE_BLOCK_SELECTOR);

  await image.hover();
  await image.locator('[data-action="crop"]').click();
  const dialog = page.getByRole('dialog', { name: 'Crop image' });

  await expect(page.locator('[data-role="darkroom-stage"][data-settled]')).toHaveCount(1);
  await page.locator('[data-ratio="1"]').click();
  await expect(page.locator('[data-ratio="1"]')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press(`${mod}+z`);
  await expect(page.locator('[data-ratio="free"]')).toHaveAttribute('aria-checked', 'true');
  await expect(dialog).toBeVisible();
  await expect(page.locator(IMAGE_BLOCK_SELECTOR)).toHaveCount(1);
  await expect(paragraph).toHaveText('kept');
});

test('the photo flies back into the block after Done', async ({ page }) => {
  const { dialog } = await openDarkroom(page, { x: 10, y: 10, w: 60, h: 60 });

  await recordFlights(page);
  await dialog.locator('[data-action="done"]').click();
  const flights = await flightsAfterLanding(page);

  expect(flights).toHaveLength(1);
  expect(flights[0].removed).toBeDefined();
  await expect.poll(async () => (await veilsSoFar(page))[0]?.removed).toBeDefined();
  const veils = await veilsSoFar(page);

  // The dark surround fades with the flight instead of dropping in one frame.
  expect(veils).toHaveLength(1);
  expect((veils[0].removed ?? 0) - veils[0].added).toBeGreaterThan(17);
});

test('reduced motion applies with no flight', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { dialog } = await openDarkroom(page, { x: 10, y: 10, w: 60, h: 60 });

  await recordFlights(page);
  await dialog.locator('[data-action="done"]').click();
  const flights = await flightsAfterLanding(page);

  // A reduced-motion spring settles in the frame it starts, so any shell lives under one frame.
  for (const f of flights) {
    expect(f.removed).toBeDefined();
    expect((f.removed ?? Infinity) - f.added).toBeLessThan(17);
  }
  expect(await veilsSoFar(page)).toHaveLength(0);
  expect((await cropOf(page)).crop).toStrictEqual({ x: 10, y: 10, w: 60, h: 60 });
});

type EditedData = {
  crop?: { x: number; y: number; w: number; h: number };
  rotation?: number;
  flipX?: boolean;
  straighten?: number;
  filter?: string;
};

const editsOf = async (page: Page): Promise<EditedData> => (await saveBlok(page)).blocks[0].data;

test('rotate, flip and straighten save the turn and the block renders it', async ({ page }) => {
  const { dialog } = await openDarkroom(page);

  await dialog.getByRole('button', { name: 'Rotate left' }).click();
  await expect(page.locator('[data-role="darkroom-stage"][data-settled]')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Flip' }).click();
  await expect(page.locator('[data-role="darkroom-stage"][data-settled]')).toHaveCount(1);
  const dial = dialog.getByRole('slider', { name: 'Straighten' });

  await dial.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(dial).toHaveAttribute('aria-valuenow', '5');
  await dialog.locator('[data-action="done"]').click();
  await expect(dialog).toHaveCount(0);
  const data = await editsOf(page);

  // Rotate left makes 270; the mirror then negates the turn to 90.
  expect(data.rotation).toBe(90);
  expect(data.flipX).toBe(true);
  expect(data.straighten).toBe(5);
  // A straightened photo always saves a crop, shrunk inside the turned content.
  expect(data.crop).toBeDefined();
  expect(data.crop?.w ?? 100).toBeLessThan(100);
  await expect(page.locator(`${IMAGE_BLOCK_SELECTOR} [data-role="image-plane"] img`))
    .toHaveAttribute('style', /rotate\(95deg\) scaleX\(-1\)/);
});

test('a filter preset saves and the block image carries the filter', async ({ page }) => {
  const { dialog } = await openDarkroom(page);

  await dialog.getByRole('tab', { name: 'Filters' }).click();
  await dialog.getByRole('radio', { name: 'Mono', exact: true }).click();
  await expect(dialog.getByRole('radio', { name: 'Mono', exact: true })).toHaveAttribute('aria-checked', 'true');
  await dialog.locator('[data-action="done"]').click();
  await expect(dialog).toHaveCount(0);

  expect((await editsOf(page)).filter).toBe('mono');
  await expect(page.locator(`${IMAGE_BLOCK_SELECTOR} [data-role="image-figure"] img`)).toHaveCSS('filter', 'grayscale(1)');
});

test('Cmd+Z inside the darkroom undoes a rotate', async ({ page }) => {
  const { dialog } = await openDarkroom(page, { x: 10, y: 20, w: 30, h: 40 });
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

  await dialog.getByRole('button', { name: 'Rotate left' }).click();
  await expect(page.locator('[data-role="darkroom-stage"][data-settled]')).toHaveCount(1);
  // The screen-reader size announcement follows the turned crop.
  await expect(page.locator('[data-role="darkroom-live"]')).toHaveText('160 × 180 px');
  await page.keyboard.press(`${mod}+z`);
  await expect(page.locator('[data-role="darkroom-live"]')).toHaveText('180 × 160 px');
  await dialog.locator('[data-action="done"]').click();
  await expect(dialog).toHaveCount(0);
  const data = await editsOf(page);

  expect(data.rotation).toBeUndefined();
  expect(data.crop).toStrictEqual({ x: 10, y: 20, w: 30, h: 40 });
});

test('Reset crop clears the crop and turn but keeps the filter', async ({ page }) => {
  const { dialog } = await openDarkroom(page, { x: 10, y: 20, w: 30, h: 40 });
  const resetCrop = dialog.getByRole('button', { name: 'Reset crop' });

  await dialog.getByRole('button', { name: 'Rotate left' }).click();
  await expect(page.locator('[data-role="darkroom-stage"][data-settled]')).toHaveCount(1);
  await dialog.getByRole('tab', { name: 'Filters' }).click();
  await dialog.getByRole('radio', { name: 'Mono', exact: true }).click();
  await dialog.getByRole('tab', { name: 'Crop' }).click();
  await expect(resetCrop).toBeVisible();
  await resetCrop.click();
  await expect(page.locator('[data-role="darkroom-stage"][data-settled]')).toHaveCount(1);
  // Hidden by visibility, so it keeps its box but leaves the accessibility tree.
  await expect(resetCrop).toBeHidden();
  await dialog.locator('[data-action="done"]').click();
  await expect(dialog).toHaveCount(0);
  const data = await editsOf(page);

  expect(data.crop).toBeUndefined();
  expect(data.rotation).toBeUndefined();
  expect(data.filter).toBe('mono');
});

test('switching tabs never grows the frame outline into a screen-wide flash', async ({ page }) => {
  const { dialog } = await openDarkroom(page);

  // Samples every frame: a transition between unequal shadow lists only shows mid-flight.
  await page.evaluate(() => {
    const frame = document.querySelector('[data-role="darkroom-frame"]');
    const spreads: number[] = [];
    const tick = (): void => {
      if (frame) {
        const first = getComputedStyle(frame).boxShadow.split(/,(?![^(]*\))/)[0] ?? '';
        const px = [...first.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));

        spreads.push(px[3] ?? 0);
      }
      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
    Object.assign(window, { __spreads: spreads });
  });
  const spreads = (): Promise<number[]> => page.evaluate(() => (window as unknown as { __spreads: number[] }).__spreads);

  await dialog.getByRole('tab', { name: 'Adjust' }).click();
  await expect.poll(async () => (await spreads()).length).toBeGreaterThan(30);
  const before = (await spreads()).length;

  await dialog.getByRole('tab', { name: 'Crop' }).click();
  await expect.poll(async () => (await spreads()).length).toBeGreaterThan(before + 30);

  expect(Math.max(...await spreads())).toBeLessThanOrEqual(1.5);
});

test('the bottom dock never covers the frame, and the frame keeps its place across tabs', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const { dialog } = await openDarkroom(page);
  const frame = page.locator('[data-role="darkroom-frame"]');
  const frameBox = await frame.boundingBox();
  // The bottom handle hangs below the frame edge; it is what the dock used to cover.
  const handleBox = await page.locator('[data-handle="s"]').boundingBox();
  const pillBox = await dialog.getByRole('radiogroup', { name: 'Crop shape' }).boundingBox();

  expect(frameBox && handleBox && pillBox).toBeTruthy();
  if (!frameBox || !handleBox || !pillBox) return;
  expect(handleBox.y + handleBox.height).toBeLessThanOrEqual(pillBox.y);

  await dialog.getByRole('tab', { name: 'Adjust' }).click();
  await expect(page.locator('[data-role="darkroom-stage"][data-settled]')).toHaveCount(1);
  expect(await frame.boundingBox()).toStrictEqual(frameBox);
});

test('a changed adjust tool shows its reset on top of the chip row, where a click reaches it', async ({ page }) => {
  const { dialog } = await openDarkroom(page);

  await dialog.getByRole('tab', { name: 'Adjust' }).click();
  await dialog.getByRole('slider', { name: 'Brightness' }).focus();
  await page.keyboard.press('ArrowRight');
  const reset = dialog.getByRole('button', { name: 'Reset brightness' });

  await expect(reset).toBeVisible();
  // The chip row's backdrop-filter paints it like a positioned box, over any unpositioned sibling.
  const onTop = await reset.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);

    return hit !== null && el.contains(hit);
  });

  expect(onTop).toBe(true);
  await reset.click();
  await expect(reset).toBeHidden();
});
