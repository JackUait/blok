import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  ANONYMOUS_GLYPHS,
  UNKNOWN_GLYPH,
} from '../../../../src/components/modules/collaboration/anonymous-identity';

const presenceCss = readFileSync(resolve(__dirname, '../../../../src/styles/presence.css'), 'utf8');

/** The face is blown up so one drawing unit is ten pixels. */
const FACE_PX = 320;
const UNIT_PX = FACE_PX / 32;
/** The disc edge sits 16 units from the centre; ink must stop well short of it. */
const INK_LIMIT = 12.6;
/** A part that swells or slides in motion may use this much more. */
const MOTION_ALLOWANCE = 0.2;

interface Reading {
  /** Furthest ink or paper from the centre, in drawing units. */
  reach: number;
  /** Centre of the painted bounds, in drawing units. */
  centreX: number;
  centreY: number;
  /** Pixels that are not the bare wash. */
  inked: number;
}

/**
 * Put one anonymous face on the page the way the gutter draws it, enlarged.
 * @param page - the page under test
 * @param glyph - which silhouette the face wears
 */
const mount = async (page: Page, glyph: string): Promise<Locator> => {
  await page.addStyleTag({ content: presenceCss });
  await page.evaluate(({ name, size }) => {
    const root = document.createElement('div');
    const face = document.createElement('span');

    root.setAttribute('data-blok-interface', 'blok');
    root.style.cssText = `padding:40px;background:#fff;--blok-presence-face-size:${size}px;--blok-presence-ring:0px`;
    face.setAttribute('data-blok-presence-face', '');
    face.setAttribute('data-blok-presence-glyph', name);
    face.style.setProperty('--blok-presence-color', '#0b6e99');
    root.appendChild(face);
    document.body.appendChild(root);
  }, { name: glyph, size: FACE_PX });

  return page.locator('[data-blok-presence-face]');
};

const shoot = async (face: Locator): Promise<string> => (await face.screenshot()).toString('base64');

/**
 * Read where a screenshot of the face carries drawing rather than bare wash.
 * @param page - any page; the pixels are decoded on its canvas
 * @param shot - a base64 PNG of the face
 */
const read = async (page: Page, shot: string): Promise<Reading> =>
  page.evaluate(async ({ png, unit }) => {
    const image = new Image();

    image.src = `data:image/png;base64,${png}`;
    await image.decode();

    const canvas = document.createElement('canvas');

    canvas.width = image.width;
    canvas.height = image.height;

    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Canvas 2D context unavailable');
    }

    context.drawImage(image, 0, 0);

    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    const centre = width / 2;
    // Bare wash: just inside the rim, straight above the centre.
    const sample = (Math.round(unit) * width + Math.round(centre)) * 4;
    const wash = [data[sample], data[sample + 1], data[sample + 2]];
    const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    let reach = 0;
    let inked = 0;

    for (let pixel = 0; pixel < width * height; pixel++) {
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const distance = Math.hypot(x + 0.5 - centre, y + 0.5 - centre);
      const offset = pixel * 4;
      const differs = Math.max(
        Math.abs(data[offset] - wash[0]),
        Math.abs(data[offset + 1] - wash[1]),
        Math.abs(data[offset + 2] - wash[2])
      ) > 60;

      // Outside the disc is page, and its last pixel is antialiased rim.
      if (distance > centre - 2 || !differs) {
        continue;
      }

      inked++;
      reach = Math.max(reach, distance);
      bounds.left = Math.min(bounds.left, x);
      bounds.top = Math.min(bounds.top, y);
      bounds.right = Math.max(bounds.right, x + 1);
      bounds.bottom = Math.max(bounds.bottom, y + 1);
    }

    return {
      reach: reach / unit,
      centreX: (bounds.left + bounds.right) / 2 / unit,
      centreY: (bounds.top + bounds.bottom) / 2 / unit,
      inked,
    };
  }, { png: shot, unit: UNIT_PX });

/**
 * Count the pixels two screenshots of the face disagree on.
 * @param page - any page; the pixels are decoded on its canvas
 * @param first - a base64 PNG of the face
 * @param second - another one
 */
const differingPixels = async (page: Page, first: string, second: string): Promise<number> =>
  page.evaluate(async ([a, b]) => {
    const pixelsOf = async (png: string): Promise<Uint8ClampedArray> => {
      const image = new Image();

      image.src = `data:image/png;base64,${png}`;
      await image.decode();

      const canvas = document.createElement('canvas');

      canvas.width = image.width;
      canvas.height = image.height;

      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error('Canvas 2D context unavailable');
      }

      context.drawImage(image, 0, 0);

      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const [left, right] = [await pixelsOf(a), await pixelsOf(b)];
    let count = 0;

    for (let offset = 0; offset < left.length; offset += 4) {
      const gap = Math.max(
        Math.abs(left[offset] - right[offset]),
        Math.abs(left[offset + 1] - right[offset + 1]),
        Math.abs(left[offset + 2] - right[offset + 2])
      );

      count += gap > 48 ? 1 : 0;
    }

    return count;
  }, [first, second]);

for (const glyph of [...ANONYMOUS_GLYPHS, UNKNOWN_GLYPH]) {
  test(`${glyph} sits inside its circle, centred, at rest`, async ({ page }) => {
    const face = await mount(page, glyph);
    const rest = await read(page, await shoot(face));

    // The defect this pins: drawings that ran up to, or past, the disc edge.
    expect.soft(rest.reach, `${glyph} furthest ink from the centre`).toBeLessThanOrEqual(INK_LIMIT);
    // Not a speck either: the subject fills most of the safe circle.
    expect.soft(rest.reach, `${glyph} furthest ink from the centre`).toBeGreaterThanOrEqual(9);
    expect.soft(Math.abs(rest.centreX - 16), `${glyph} painted bounds centre X = ${rest.centreX}`).toBeLessThanOrEqual(2);
    expect.soft(Math.abs(rest.centreY - 16), `${glyph} painted bounds centre Y = ${rest.centreY}`).toBeLessThanOrEqual(2);
  });

  test(`${glyph} moves under the pointer without leaving its circle or losing ink`, async ({ page }) => {
    const face = await mount(page, glyph);
    const restShot = await shoot(face);
    const rest = await read(page, restShot);

    await face.hover();

    const frames: string[] = [];

    // 2.4s: long enough for every rocking, bobbing and pulsing part to reach both ends of its swing.
    for (let frame = 0; frame < 8; frame++) {
      frames.push(await shoot(face));
      // eslint-disable-next-line playwright/no-wait-for-timeout -- frames are sampled across real animation time
      await page.waitForTimeout(300);
    }

    const changes: number[] = [];

    for (const [index, frame] of frames.entries()) {
      const reading = await read(page, frame);
      const change = await differingPixels(page, restShot, frame);

      changes.push(change);
      // The defect this pins: parts that swung out of the disc mid-motion.
      expect.soft(reading.reach, `${glyph} frame ${index} furthest ink`).toBeLessThanOrEqual(INK_LIMIT + MOTION_ALLOWANCE);
      // The defect this pins: parts that faded or vanished mid-motion.
      expect.soft(reading.inked, `${glyph} frame ${index} ink area`).toBeGreaterThanOrEqual(rest.inked * 0.8);
    }

    expect(Math.max(...changes), `${glyph} moved while hovered`).toBeGreaterThanOrEqual(40);

    await page.mouse.move(0, 0);

    await expect.poll(async () => differingPixels(page, restShot, await shoot(face))).toBeLessThanOrEqual(40);
  });

  test(`${glyph} holds still under the pointer when motion is reduced`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const face = await mount(page, glyph);
    const restShot = await shoot(face);

    await face.hover();
    // eslint-disable-next-line playwright/no-wait-for-timeout -- stillness only shows after time has passed
    await page.waitForTimeout(400);

    expect(await differingPixels(page, restShot, await shoot(face))).toBeLessThanOrEqual(40);
  });
}
