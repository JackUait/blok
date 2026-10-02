// test/playwright/tests/tools/image-markup.spec.ts

import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const IMAGE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="image"]`;
// 600 × 400: the O box the marks' fractions are measured in.
const SAMPLE_IMAGE_URL = 'https://placehold.co/600x400.png';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

interface SavedMark { type: string; text?: string; x1?: number; y1?: number; x2?: number; y2?: number }

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const saveBlok = async (page: Page): Promise<OutputData> => {
  const saved = await page.evaluate(() => window.blokInstance?.save());

  expect(saved, 'no blok instance').toBeTruthy();

  return saved as OutputData;
};

const marksOf = async (page: Page): Promise<SavedMark[]> =>
  ((await saveBlok(page)).blocks[0].data as { markup?: SavedMark[] }).markup ?? [];

const seedImage = async (page: Page, markup?: unknown[]): Promise<void> => {
  const data: OutputData = {
    blocks: [{ type: 'image', data: { url: SAMPLE_IMAGE_URL, ...(markup ? { markup } : {}) } }],
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

const openMarkup = async (page: Page): Promise<{ dialog: Locator; frame: { x: number; y: number; w: number; h: number } }> => {
  const image = page.locator(IMAGE_BLOCK_SELECTOR);

  await image.hover();
  await image.locator('[data-action="crop"]').click();
  const dialog = page.getByRole('dialog', { name: 'Crop image' });

  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-role="darkroom-stage"][data-settled]')).toHaveCount(1);
  await dialog.getByRole('tab', { name: 'Markup' }).click();
  const box = await page.locator('[data-role="darkroom-frame"]').boundingBox();

  if (!box) throw new Error('no frame');

  return { dialog, frame: { x: box.x, y: box.y, w: box.width, h: box.height } };
};

/** A point inside the frame, as fractions of it. */
const within = (frame: { x: number; y: number; w: number; h: number }, fx: number, fy: number): [number, number] =>
  [frame.x + frame.w * fx, frame.y + frame.h * fy];

const stroke = async (page: Page, from: [number, number], to: [number, number]): Promise<void> => {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2 + 20, { steps: 6 });
  await page.mouse.move(...to, { steps: 6 });
  await page.mouse.up();
};

const darkroomMarks = (page: Page): Locator =>
  page.locator('[data-role="darkroom-stage"] [data-role="image-markup"] [data-markup-id]');

test('a pen stroke drawn in Markup is saved and drawn on the block', async ({ page }) => {
  await seedImage(page);
  const { dialog, frame } = await openMarkup(page);

  await stroke(page, within(frame, 0.2, 0.3), within(frame, 0.7, 0.6));
  await expect(darkroomMarks(page)).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);

  const drawn = page.locator(`${IMAGE_BLOCK_SELECTOR} [data-role="image-markup"]`);

  await expect(drawn.locator('[data-markup-type="pen"] path')).toHaveCount(1);
  const marks = await marksOf(page);

  expect(marks).toHaveLength(1);
  expect(marks[0].type).toBe('pen');
});

test('Shift draws a square rectangle', async ({ page }) => {
  await seedImage(page);
  const { dialog, frame } = await openMarkup(page);

  await dialog.getByRole('radio', { name: 'Rectangle' }).click();
  await page.keyboard.down('Shift');
  await stroke(page, within(frame, 0.2, 0.2), within(frame, 0.6, 0.4));
  await page.keyboard.up('Shift');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);

  const [rect] = await marksOf(page);

  expect(rect.type).toBe('rect');
  const w = ((rect.x2 ?? 0) - (rect.x1 ?? 0)) * 600;
  const h = ((rect.y2 ?? 0) - (rect.y1 ?? 0)) * 400;

  expect(Math.abs(w - h)).toBeLessThan(2);
});

test('undo and redo walk the marks inside the darkroom', async ({ page }) => {
  await seedImage(page);
  const { frame } = await openMarkup(page);

  await stroke(page, within(frame, 0.2, 0.2), within(frame, 0.6, 0.3));
  await stroke(page, within(frame, 0.2, 0.6), within(frame, 0.6, 0.7));
  await expect(darkroomMarks(page)).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(darkroomMarks(page)).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(darkroomMarks(page)).toHaveCount(2);
});

test('text: Enter types a newline, one Escape commits, the next deselects, the third cancels', async ({ page }) => {
  await seedImage(page);
  const { dialog, frame } = await openMarkup(page);

  await dialog.getByRole('radio', { name: 'Text' }).click();
  await page.mouse.click(...within(frame, 0.5, 0.5));
  const editor = dialog.getByRole('textbox', { name: 'Text label' });

  await expect(editor).toBeFocused();
  await page.keyboard.type('Hello');
  await page.keyboard.press('Enter');
  await page.keyboard.type('there');
  await expect(dialog).toBeVisible();
  await expect(editor).toHaveValue('Hello\nthere');

  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-role="markup-selection"]')).toBeVisible();
  await expect(darkroomMarks(page)).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-role="markup-selection"]')).toHaveCount(0);
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await marksOf(page)).toEqual([]);
});

test('a saved text shows again on reopen and a double-click edits it', async ({ page }) => {
  await seedImage(page, [{ id: 't1', type: 'text', color: '#ffffff', x: 0.5, y: 0.5, text: 'Hi', size: 0.09, style: 'outline' }]);
  const { dialog, frame } = await openMarkup(page);

  await expect(darkroomMarks(page)).toHaveCount(1);
  await dialog.getByRole('radio', { name: 'Select' }).click();
  await page.mouse.dblclick(...within(frame, 0.5, 0.5));
  const editor = dialog.getByRole('textbox', { name: 'Text label' });

  await expect(editor).toHaveValue('Hi');
  await editor.fill('Bye');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(editor).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);

  const marks = await marksOf(page);

  expect(marks).toHaveLength(1);
  expect(marks[0].text).toBe('Bye');
  await expect(page.locator(`${IMAGE_BLOCK_SELECTOR} [data-role="image-markup"] [data-markup-type="text"]`)).toHaveText('Bye');
});

test('Z zooms the view only: a rectangle drawn zoomed lands where the pointer was, and 100% is one image px per CSS px', async ({ page }) => {
  await seedImage(page);
  const { dialog } = await openMarkup(page);
  const plane = page.locator('[data-role="darkroom-stage"] [data-role="image-plane"]');
  const fit = await plane.boundingBox();

  if (!fit) throw new Error('no plane');
  await page.locator('[data-role="darkroom-stage"]').focus();
  await page.keyboard.press('r');
  await page.keyboard.press('z');
  // 600 px wide at 100%; a photo already shown at or above that doubles instead.
  const zoomedWidth = fit.width < 600 ? 600 : fit.width * 2;

  await expect.poll(async () => Math.round((await plane.boundingBox())?.width ?? 0)).toBe(Math.round(zoomedWidth));
  const zoomed = await plane.boundingBox();
  const stage = await page.locator('[data-role="darkroom-stage"]').boundingBox();

  if (!zoomed || !stage) throw new Error('no box');
  const from: [number, number] = [stage.x + stage.width * 0.45, stage.y + stage.height * 0.4];
  const to: [number, number] = [stage.x + stage.width * 0.55, stage.y + stage.height * 0.5];

  await stroke(page, from, to);
  await expect(darkroomMarks(page)).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);

  const [rect] = await marksOf(page);

  expect(rect.type).toBe('rect');
  expect(rect.x1).toBeCloseTo((from[0] - zoomed.x) / zoomed.width, 2);
  expect(rect.y1).toBeCloseTo((from[1] - zoomed.y) / zoomed.height, 2);
  expect(rect.x2).toBeCloseTo((to[0] - zoomed.x) / zoomed.width, 2);
  expect(rect.y2).toBeCloseTo((to[1] - zoomed.y) / zoomed.height, 2);
});

test('? opens the keyboard shortcuts sheet; Escape closes only the sheet', async ({ page }) => {
  await seedImage(page);
  const { dialog } = await openMarkup(page);

  await page.keyboard.press('?');
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });

  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Rotate right')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(dialog).toBeVisible();
});
