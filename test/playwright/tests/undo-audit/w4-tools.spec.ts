import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const CAPTURE_GAP_MS = 700;
const IMAGE_URL = 'http://localhost:4444/test/playwright/fixtures/image/shot.png';
const VIDEO_URL = 'http://localhost:4444/public/samples/big-buck-bunny.mp4';
const AUDIO_URL = 'http://localhost:4444/test/playwright/fixtures/audio/sample.mp3';
const SETTINGS_BUTTON = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';
const TUNES_POPOVER = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';

declare global {
  interface Window {
    blokInstance?: Blok;
    defaultBlockTools: Record<string, { class: unknown }>;
  }
}

type Block = OutputData['blocks'][number];
type Uploads = 'none' | 'file';

const P = (id: string, text: string): Block => ({ id, type: 'paragraph', data: { text } });
const ANCHOR = P('p0', 'Anchor');

// With uploads = 'file' the file tool's uploader answers at once with the image fixture url.
const mount = async (page: Page, blocks: Block[], uploads: Uploads = 'none'): Promise<void> => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ list, mode, url }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    // The shared page keeps localStorage between tests; the audio player reads its loop/volume from it.
    window.localStorage.clear();
    const d = document.createElement('div');

    d.id = 'blok';
    document.body.appendChild(d);
    const tools: Record<string, unknown> = {};

    if (mode === 'file') {
      tools.file = {
        class: window.defaultBlockTools.file.class,
        config: {
          uploader: {
            uploadByFile: async (f: File) => ({
              url: f.type.startsWith('image/') ? url : `${url}?name=${f.name}`,
              fileName: f.name,
              size: f.size,
              mimeType: f.type,
            }),
          },
        },
      };
    }
    const blok = new window.Blok({ holder: 'blok', tools, data: { blocks: list } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { list: blocks, mode: uploads, url: IMAGE_URL });
  await gap(page);
};

const gap = (page: Page, ms = CAPTURE_GAP_MS): Promise<void> => page.evaluate((t) => new Promise<void>((r) => {
  window.setTimeout(r, t);
}), ms);

const saved = (page: Page): Promise<Block[]> => page.evaluate(async () => {
  if (!window.blokInstance) {
    throw new Error('no editor');
  }

  return (await window.blokInstance.save()).blocks.map(({ lastEditedAt: _a, lastEditedBy: _b, ...rest }) => rest);
});

const dataOf = async (page: Page, id: string): Promise<Record<string, unknown> | undefined> =>
  (await saved(page)).find((b) => b.id === id)?.data;

/** Every block the editor holds (save() drops blocks whose data fails validate, e.g. an empty url). */
const liveTypes = (page: Page): Promise<string[]> => page.evaluate(() => {
  const api = window.blokInstance?.blocks;
  const out: string[] = [];

  for (let i = 0; api !== undefined && i < api.getBlocksCount(); i++) {
    out.push(api.getBlockByIndex(i)?.name ?? '?');
  }

  return out;
});

const canUndo = (page: Page): Promise<boolean> => page.evaluate(() => window.blokInstance?.history.canUndo() ?? false);
const canRedo = (page: Page): Promise<boolean> => page.evaluate(() => window.blokInstance?.history.canRedo() ?? false);

/** Put the caret in the anchor paragraph, then press the shortcut. */
const press = async (page: Page, shortcut: string): Promise<void> => {
  await page.getByText('Anchor', { exact: true }).click();
  await page.keyboard.press(shortcut);
  await gap(page, 500);
};

const openTunesOn = async (page: Page, id: string): Promise<void> => {
  await page.locator(`[data-blok-id="${id}"]`).hover({ position: { x: 10, y: 10 } });
  await page.locator(SETTINGS_BUTTON).click();
  await expect(page.locator(TUNES_POPOVER)).toBeVisible();
};

const tuneItem = (page: Page, name: string): Locator =>
  page.locator(`[data-blok-testid="block-tunes-popover"] [data-blok-item-name="${name}"]`);

const settle = async (page: Page): Promise<void> => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await gap(page);
};

/** Drag the centre of `locator` by (dx, dy); `pauseMs` holds the button still halfway. */
const dragBy = async (page: Page, locator: Locator, dx: number, dy: number, pauseMs = 0): Promise<void> => {
  const box = await locator.boundingBox();

  if (box === null) {
    throw new Error('drag handle has no box');
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
  if (pauseMs > 0) {
    await gap(page, pauseMs);
  }
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
};

const spacerHeight = (page: Page, id: string): Promise<string> =>
  page.locator(`[data-blok-id="${id}"] [data-blok-spacer]`).evaluate((el: HTMLElement) => el.style.height);

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(() => {
  test.setTimeout(45_000);
});

test.describe('W4T spacer', () => {
  test('W4T-1: one undo reverts a spacer drag and redo restores the dragged height', async ({ page }) => {
    await mount(page, [ANCHOR, { id: 's', type: 'spacer', data: { height: 60 } }, P('p1', 'Below')]);
    await page.locator('[data-blok-id="s"]').hover();
    const box = await page.locator('[data-blok-id="s"] [data-blok-spacer-grip="bottom"]').boundingBox();

    if (box === null) {
      throw new Error('drag handle has no box');
    }
    // One pointermove: a drag that lasts longer than 500 ms splits into two steps (W4T-2).
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 80);
    await page.mouse.up();
    await gap(page);
    const dragged = (await dataOf(page, 's'))?.height;

    expect(dragged).toBeGreaterThan(100);
    await press(page, UNDO);
    expect((await dataOf(page, 's'))?.height).toBe(60);
    expect(await spacerHeight(page, 's')).toBe('60px');
    await press(page, REDO);
    expect((await dataOf(page, 's'))?.height).toBe(dragged);
    expect(await spacerHeight(page, 's')).toBe(`${String(dragged)}px`);
  });

  // Defect: any drag that lasts > 500 ms is split into two undo steps (first undo lands on the halfway height).
  // The pause makes it deterministic; a plain slow drag hits it too.
  // Root cause: spacer/index.ts:460 writes the height on every pointermove (setHeight :214), and the grip's
  // pointerdown (:439) opens no undo group, so Y.UndoManager captureTimeout (serializer.ts:306, undo-history.ts:239)
  // closes the step during the pause. Image/video/embed resizers write once on pointerup (see W4T-5b, passes).
  test('W4T-2: one undo reverts a spacer drag that paused halfway', async ({ page }) => {
    test.fail();
    await mount(page, [ANCHOR, { id: 's', type: 'spacer', data: { height: 60 } }, P('p1', 'Below')]);
    await page.locator('[data-blok-id="s"]').hover();
    await dragBy(page, page.locator('[data-blok-id="s"] [data-blok-spacer-grip="bottom"]'), 0, 120, 900);
    await gap(page);
    expect((await dataOf(page, 's'))?.height).toBeGreaterThan(150);
    await press(page, UNDO);

    expect((await dataOf(page, 's'))?.height).toBe(60);
    expect(await spacerHeight(page, 's')).toBe('60px');
    expect(await canRedo(page)).toBe(true);
  });

  test('W4T-3: Cmd+Z with focus on a spacer grip undoes the arrow-key resize', async ({ page }) => {
    await mount(page, [ANCHOR, { id: 's', type: 'spacer', data: { height: 60 } }, P('p1', 'Below')]);
    const grip = page.locator('[data-blok-id="s"] [data-blok-spacer-grip="bottom"]');

    await grip.focus();
    await page.keyboard.press('ArrowDown');
    await gap(page);
    expect((await dataOf(page, 's'))?.height).toBe(68);
    await page.keyboard.press(UNDO);
    await gap(page, 500);

    expect((await dataOf(page, 's'))?.height).toBe(60);
    expect(await spacerHeight(page, 's')).toBe('60px');
  });
});

const IMG: Block = { id: 'img', type: 'image', data: { url: IMAGE_URL, naturalWidth: 800, naturalHeight: 600 } };

test.describe('W4T image', () => {
  test('W4T-5: one undo reverts an image width drag and redo restores the width', async ({ page }) => {
    await mount(page, [ANCHOR, IMG]);
    await expect(page.locator('[data-blok-id="img"] img')).toBeVisible();
    await page.locator('[data-blok-id="img"] img').hover();
    await dragBy(page, page.locator('[data-blok-id="img"] [data-role="resize-handle"][data-edge="right"]'), -150, 0);
    await gap(page);
    const width = (await dataOf(page, 'img'))?.width;

    expect(width).toBeDefined();
    await press(page, UNDO);
    expect((await dataOf(page, 'img'))?.width).toBeUndefined();
    await press(page, REDO);
    expect((await dataOf(page, 'img'))?.width).toBe(width);
    expect(await canUndo(page)).toBe(true);
  });

  test('W4T-5b: one undo reverts an image width drag that paused halfway', async ({ page }) => {
    await mount(page, [ANCHOR, IMG]);
    await expect(page.locator('[data-blok-id="img"] img')).toBeVisible();
    await page.locator('[data-blok-id="img"] img').hover();
    await dragBy(page, page.locator('[data-blok-id="img"] [data-role="resize-handle"][data-edge="right"]'), -150, 0, 900);
    await gap(page);
    expect((await dataOf(page, 'img'))?.width).toBeDefined();
    await press(page, UNDO);
    expect((await dataOf(page, 'img'))?.width).toBeUndefined();
  });

  test('W4T-6: undo and redo of image alignment', async ({ page }) => {
    await mount(page, [ANCHOR, IMG]);
    await openTunesOn(page, 'img');
    await tuneItem(page, 'image-alignment').click();
    await page.locator('[data-blok-item-name="image-alignment-left"]').click();
    await settle(page);
    expect((await dataOf(page, 'img'))?.alignment).toBe('left');
    await press(page, UNDO);
    expect((await dataOf(page, 'img'))?.alignment).toBeUndefined();
    await press(page, REDO);
    expect((await dataOf(page, 'img'))?.alignment).toBe('left');
  });

  test('W4T-7: undo of adding alt text removes it and redo brings it back', async ({ page }) => {
    await mount(page, [ANCHOR, IMG]);
    await page.locator('[data-blok-id="img"] img').hover();
    await page.locator('[data-blok-id="img"] [data-action="alt-edit"]').click();
    await page.locator('[data-role="image-alt-popover"] textarea').fill('A cat');
    await page.locator('[data-role="image-alt-popover"] textarea').press('Enter');
    await gap(page);
    expect((await dataOf(page, 'img'))?.alt).toBe('A cat');
    await press(page, UNDO);
    expect((await dataOf(page, 'img'))?.alt).toBeUndefined();
    await expect(page.locator('[data-blok-id="img"] img')).not.toHaveAttribute('alt', 'A cat');
    await press(page, REDO);
    expect((await dataOf(page, 'img'))?.alt).toBe('A cat');
    await expect(page.locator('[data-blok-id="img"] img')).toHaveAttribute('alt', 'A cat');
  });

  test('W4T-8: undo of a circle crop removes the crop, redo restores it', async ({ page }) => {
    await mount(page, [ANCHOR, IMG]);
    await openTunesOn(page, 'img');
    await tuneItem(page, 'image-crop').click();
    await page.locator('[data-ratio="circle"]').click();
    await expect(page.locator('[data-ratio="circle"]')).toHaveAttribute('aria-checked', 'true');
    await page.locator('[data-action="done"]').click();
    await expect(page.getByTestId('image-crop-backdrop')).toHaveCount(0);
    await gap(page);
    await expect.poll(async () => (await dataOf(page, 'img'))?.crop).toBeDefined();
    const crop = (await dataOf(page, 'img'))?.crop;

    await press(page, UNDO);
    expect((await dataOf(page, 'img'))?.crop).toBeUndefined();
    await press(page, REDO);
    expect((await dataOf(page, 'img'))?.crop).toEqual(crop);
  });

  test('W4T-9: undo of Replace image brings the picture back', async ({ page }) => {
    await mount(page, [ANCHOR, IMG]);
    await openTunesOn(page, 'img');
    await tuneItem(page, 'image-replace').click();
    await gap(page);
    await expect(page.locator('[data-blok-id="img"] input[type="file"]')).toHaveCount(1);
    await press(page, UNDO);
    expect((await dataOf(page, 'img'))?.url).toBe(IMAGE_URL);
    await expect(page.locator('[data-blok-id="img"] img')).toBeVisible();
    await press(page, REDO);
    await expect(page.locator('[data-blok-id="img"] input[type="file"]')).toHaveCount(1);
    expect(await liveTypes(page)).toEqual(['paragraph', 'image']);
  });
});

test.describe('W4T video', () => {
  const VID: Block = { id: 'v', type: 'video', data: { url: VIDEO_URL, aspectRatio: '640 / 360' } };

  test('W4T-10: undo of a video width drag restores full width, redo restores the width', async ({ page }) => {
    await mount(page, [ANCHOR, VID]);
    await page.locator('[data-blok-id="v"] [data-role="video-figure"]').hover();
    await dragBy(page, page.locator('[data-blok-id="v"] [data-role="resize-handle"][data-edge="right"]'), -150, 0);
    await gap(page);
    const width = (await dataOf(page, 'v'))?.width;

    expect(width).toBeDefined();
    await press(page, UNDO);
    expect((await dataOf(page, 'v'))?.width).toBeUndefined();
    await press(page, REDO);
    expect((await dataOf(page, 'v'))?.width).toBe(width);
  });

  test('W4T-11: undo and redo of Autoplay (edit mode never autoplays, so data only)', async ({ page }) => {
    await mount(page, [ANCHOR, VID]);
    await openTunesOn(page, 'v');
    await tuneItem(page, 'video-autoplay').click();
    await settle(page);
    expect((await dataOf(page, 'v'))?.autoplay).toBe(true);
    await press(page, UNDO);
    expect((await dataOf(page, 'v'))?.autoplay).toBeUndefined();
    await press(page, REDO);
    expect((await dataOf(page, 'v'))?.autoplay).toBe(true);
  });
});

test.describe('W4T file', () => {
  const FILE: Block = { id: 'f', type: 'file', data: { url: `${IMAGE_URL}?doc`, fileName: 'report.pdf', size: 1000, mimeType: 'application/pdf' } };

  test('W4T-12: undo of a file rename restores the old name in data and on screen', async ({ page }) => {
    await mount(page, [ANCHOR, FILE]);
    const name = page.locator('[data-blok-id="f"] [data-role="file-name"]');

    await name.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('summary.pdf');
    await page.keyboard.press('Enter');
    await gap(page);
    expect((await dataOf(page, 'f'))?.fileName).toBe('summary.pdf');
    await press(page, UNDO);
    expect((await dataOf(page, 'f'))?.fileName).toBe('report.pdf');
    await expect(name).toHaveText('report.pdf');
    await press(page, REDO);
    expect((await dataOf(page, 'f'))?.fileName).toBe('summary.pdf');
    await expect(name).toHaveText('summary.pdf');
  });

  test('W4T-13: one undo of a file upload brings back the empty file block', async ({ page }) => {
    await mount(page, [ANCHOR, { id: 'f', type: 'file', data: { url: '' } }], 'file');
    await page.locator('[data-blok-id="f"] input[type="file"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect.poll(async () => (await dataOf(page, 'f'))?.url).not.toBe('');
    await gap(page);
    await press(page, UNDO);
    expect(await liveTypes(page)).toEqual(['paragraph', 'file']);
    expect(await dataOf(page, 'f')).toBeUndefined();
    await expect(page.locator('[data-blok-id="f"] input[type="file"]')).toHaveCount(1);
    await press(page, REDO);
    expect((await dataOf(page, 'f'))?.fileName).toBe('notes.txt');
  });

  test('W4T-14: one undo of an image dropped into a file block brings back the file block', async ({ page }) => {
    await mount(page, [ANCHOR, { id: 'f', type: 'file', data: { url: '' } }], 'file');
    await page.locator('[data-blok-id="f"] input[type="file"]').setInputFiles({ name: 'pic.png', mimeType: 'image/png', buffer: Buffer.from('png') });
    await expect.poll(async () => (await saved(page)).some((b) => b.type === 'image')).toBe(true);
    await gap(page);
    await press(page, UNDO);

    expect(await liveTypes(page)).toEqual(['paragraph', 'file']);
    await expect(page.locator('[data-blok-id="f"] input[type="file"]')).toHaveCount(1);
    await press(page, REDO);
    expect((await saved(page)).map((b) => b.type)).toEqual(['paragraph', 'image']);
  });

  test('W4T-15: undo of showing the file caption hides it again', async ({ page }) => {
    await mount(page, [ANCHOR, FILE]);
    await openTunesOn(page, 'f');
    await tuneItem(page, 'file-caption').click();
    await settle(page);
    expect((await dataOf(page, 'f'))?.captionVisible).toBe(true);
    await press(page, UNDO);
    expect((await dataOf(page, 'f'))?.captionVisible).toBeUndefined();
    await expect(page.locator('[data-blok-id="f"] [data-role="file-caption"]')).toHaveCount(0);
  });
});

test.describe('W4T audio', () => {
  const AUD: Block = { id: 'a', type: 'audio', data: { url: AUDIO_URL, duration: 3, peaks: [0.1, 0.5, 0.3] } };

  test('W4T-16: changing audio volume and mute adds no undo step', async ({ page }) => {
    await mount(page, [ANCHOR, AUD]);
    expect(await canUndo(page)).toBe(false);
    // The volume slider only shows on hover; force the real input actions.
    await page.locator('[data-blok-id="a"] [data-role="audio-volume"]').fill('0.3', { force: true });
    await page.locator('[data-blok-id="a"] [data-role="audio-mute"]').click({ force: true });
    expect(await page.locator('[data-blok-id="a"] audio').evaluate((el: HTMLAudioElement) => el.muted)).toBe(true);
    await gap(page);

    expect(await canUndo(page)).toBe(false);
  });

  // Defect: after undo, save() says loop is off but the player still loops and shows the button pressed.
  // Root cause: audio/controls.ts:344-345 lets the shared localStorage loop preference (written by the button
  // at :379) override data.loop (audio/ui.ts:109) on every re-render, including the undo re-render.
  // Controls W4T-17b (preference cleared) and W4T-17c (loop set from the settings menu) pass.
  test('W4T-17: undo of the player loop button turns loop off on screen too', async ({ page }) => {
    test.fail();
    await mount(page, [ANCHOR, AUD]);
    const loop = page.locator('[data-blok-id="a"] [data-role="audio-loop"]');

    await expect(loop).toHaveAttribute('aria-pressed', 'false');
    await loop.click();
    await gap(page);
    expect((await dataOf(page, 'a'))?.loop).toBe(true);
    await press(page, UNDO);

    await expect(page.locator('[data-blok-id="a"] [data-role="audio-loop"]')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.locator('[data-blok-id="a"] audio').evaluate((el: HTMLAudioElement) => el.loop)).toBe(false);
    expect((await dataOf(page, 'a'))?.loop).toBeUndefined();
  });

  test('W4T-17c: control: undo of Loop turned on from the settings menu shows loop off', async ({ page }) => {
    await mount(page, [ANCHOR, AUD]);
    await openTunesOn(page, 'a');
    await tuneItem(page, 'audio-loop').click();
    await settle(page);
    expect((await dataOf(page, 'a'))?.loop).toBe(true);
    await press(page, UNDO);

    await expect(page.locator('[data-blok-id="a"] [data-role="audio-loop"]')).toHaveAttribute('aria-pressed', 'false');
    expect((await dataOf(page, 'a'))?.loop).toBeUndefined();
  });

  test('W4T-17b: control: with the stored loop preference cleared, undo of the loop button shows loop off', async ({ page }) => {
    await mount(page, [ANCHOR, AUD]);
    await page.locator('[data-blok-id="a"] [data-role="audio-loop"]').click();
    await gap(page);
    await page.evaluate(() => window.localStorage.removeItem('blok:audio:loop'));
    await press(page, UNDO);

    expect((await dataOf(page, 'a'))?.loop).toBeUndefined();
    await expect(page.locator('[data-blok-id="a"] [data-role="audio-loop"]')).toHaveAttribute('aria-pressed', 'false');
  });

  test('W4T-18: undo and redo of audio alignment', async ({ page }) => {
    await mount(page, [ANCHOR, AUD]);
    await openTunesOn(page, 'a');
    await tuneItem(page, 'audio-alignment').hover();
    await page.locator('[data-blok-item-name="audio-alignment-right"]').click();
    await settle(page);
    expect((await dataOf(page, 'a'))?.alignment).toBe('right');
    await press(page, UNDO);
    expect((await dataOf(page, 'a'))?.alignment).toBeUndefined();
    await press(page, REDO);
    expect((await dataOf(page, 'a'))?.alignment).toBe('right');
  });

  test('W4T-28: undo of hiding the audio caption brings the caption text back', async ({ page }) => {
    await mount(page, [ANCHOR, { ...AUD, data: { ...AUD.data, caption: 'Hello', captionVisible: true } }]);
    await openTunesOn(page, 'a');
    await tuneItem(page, 'audio-caption').click();
    await settle(page);
    expect((await dataOf(page, 'a'))?.captionVisible).toBe(false);
    await press(page, UNDO);

    expect((await dataOf(page, 'a'))?.caption).toBe('Hello');
    expect((await dataOf(page, 'a'))?.captionVisible).toBe(true);
  });

  test('W4T-19: loading an audio block without duration adds no undo step', async ({ page }) => {
    await mount(page, [ANCHOR, { id: 'a', type: 'audio', data: { url: AUDIO_URL } }]);
    await gap(page, 2000);

    expect(await canUndo(page)).toBe(false);
  });
});

test.describe('W4T embed', () => {
  const EMB: Block = {
    id: 'e',
    type: 'embed',
    data: { service: 'googledrive', source: 'https://drive.google.com/file/d/abc/view', embed: 'https://drive.google.com/file/d/abc/preview', width: 600, height: 320 },
  };

  test('W4T-20: one undo reverts an embed height drag, redo restores it', async ({ page }) => {
    await page.route('**/drive.google.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>x</p>' }));
    await mount(page, [ANCHOR, EMB]);
    await page.locator('[data-blok-id="e"] [data-role="embed-figure"]').hover();
    await dragBy(page, page.locator('[data-blok-id="e"] [data-role="resize-handle"][data-edge="bottom"]'), 0, 100);
    await gap(page);
    const height = (await dataOf(page, 'e'))?.height;

    expect(height).not.toBe(320);
    await press(page, UNDO);
    expect((await dataOf(page, 'e'))?.height).toBe(320);
    await press(page, REDO);
    expect((await dataOf(page, 'e'))?.height).toBe(height);
  });

  test('W4T-21: one undo reverts an embed width drag, redo restores it', async ({ page }) => {
    await page.route('**/drive.google.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>x</p>' }));
    await mount(page, [ANCHOR, EMB]);
    await page.locator('[data-blok-id="e"] [data-role="embed-figure"]').hover();
    await dragBy(page, page.locator('[data-blok-id="e"] [data-role="resize-handle"][data-edge="right"]'), -150, 0);
    await gap(page);
    const width = (await dataOf(page, 'e'))?.widthPercent;

    expect(width).toBeDefined();
    await press(page, UNDO);
    expect((await dataOf(page, 'e'))?.widthPercent).toBeUndefined();
    await press(page, REDO);
    expect((await dataOf(page, 'e'))?.widthPercent).toBe(width);
  });
});

const codeText = (page: Page, id: string): Promise<string> =>
  page.locator(`[data-blok-id="${id}"] code[contenteditable]`).evaluate((el) => el.textContent ?? '');

test.describe('W4T code', () => {
  test('W4T-22: undo of a language picked in the picker restores the old language and label', async ({ page }) => {
    await mount(page, [ANCHOR, { id: 'c', type: 'code', data: { code: 'x = 1', language: 'plain text' } }]);
    await page.locator('[data-blok-id="c"] [aria-haspopup="listbox"]').click();
    await page.locator('[data-blok-item-name="python"]').click();
    await gap(page);
    expect((await dataOf(page, 'c'))?.language).toBe('python');
    await press(page, UNDO);
    expect((await dataOf(page, 'c'))?.language).toBe('plain text');
    await expect(page.locator('[data-blok-id="c"] [aria-haspopup="listbox"]')).not.toContainText('Python');
    await press(page, REDO);
    expect((await dataOf(page, 'c'))?.language).toBe('python');
    await expect(page.locator('[data-blok-id="c"] [aria-haspopup="listbox"]')).toContainText('Python');
  });

  test('W4T-23: typing after an undo in a code block continues where the caret is', async ({ page }) => {
    await mount(page, [ANCHOR, { id: 'c', type: 'code', data: { code: '', language: 'plain text' } }]);
    const code = page.locator('[data-blok-id="c"] code[contenteditable]');

    await code.click();
    await page.keyboard.type('abc');
    await gap(page);
    await page.keyboard.type('def');
    await gap(page);
    await page.keyboard.press(UNDO);
    await gap(page, 500);
    expect(await codeText(page, 'c')).toBe('abc');
    await page.keyboard.type('X');
    await gap(page);

    expect(await codeText(page, 'c')).toBe('abcX');
    expect((await dataOf(page, 'c'))?.code).toBe('abcX');
  });

  test('W4T-24: undo and redo of two typed lines in a code block are exact', async ({ page }) => {
    await mount(page, [ANCHOR, { id: 'c', type: 'code', data: { code: '', language: 'plain text' } }]);
    const code = page.locator('[data-blok-id="c"] code[contenteditable]');

    await code.click();
    await page.keyboard.type('one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('two');
    await gap(page);
    const typed = (await dataOf(page, 'c'))?.code;

    expect(typed).toBe('one\ntwo');
    const steps: string[] = [];

    for (let i = 0; i < 4 && await canUndo(page); i++) {
      await page.keyboard.press(UNDO);
      await gap(page, 400);
      steps.push(await codeText(page, 'c'));
    }
    expect(steps.at(-1)?.replace(/\n$/, '')).toBe('');
    for (let i = 0; i < steps.length; i++) {
      await page.keyboard.press(REDO);
      await gap(page, 400);
    }
    expect((await dataOf(page, 'c'))?.code).toBe('one\ntwo');
    expect((await codeText(page, 'c')).replace(/\n$/, '')).toBe('one\ntwo');
    test.info().annotations.push({ type: 'undo-steps', description: JSON.stringify(steps) });
  });

  // Family 4 (missing undo boundary), new instance. Observed: one undo removes "ab" and the paste together.
  // Root cause: paste into a plaintext-only code element is left to the browser (paste/index.ts:552, :614),
  // so the Paste module's undo boundary never runs; the paste merges with typing inside captureTimeout.
  test('W4T-25: a paste into a code block right after typing is its own undo step', async ({ page }) => {
    test.fail();
    await mount(page, [ANCHOR, P('src', 'PASTED'), { id: 'c', type: 'code', data: { code: '', language: 'plain text' } }]);
    const code = page.locator('[data-blok-id="c"] code[contenteditable]');

    // Native copy from a paragraph: no clipboard permission needed.
    await page.getByText('PASTED', { exact: true }).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('ControlOrMeta+c');
    await code.click();
    await page.keyboard.type('ab');
    await page.keyboard.press('ControlOrMeta+v');
    await gap(page);
    expect((await dataOf(page, 'c'))?.code).toBe('abPASTED');
    await page.keyboard.press(UNDO);
    await gap(page, 500);

    expect((await dataOf(page, 'c'))?.code).toBe('ab');
  });
});

test.describe('W4T stub and columns', () => {
  test('W4T-26: a stub block keeps its type and data through undo/redo of a neighbour edit and its own delete', async ({ page }) => {
    const stubData = { foo: 1, nested: { a: [1, 2] }, text: 'kept' };

    await mount(page, [ANCHOR, { id: 'st', type: 'mystery', data: stubData }, P('p1', 'Neighbour')]);
    await page.getByText('Neighbour', { exact: true }).click();
    await page.keyboard.press('End');
    await page.keyboard.type('X');
    await gap(page);
    await press(page, UNDO);
    await press(page, REDO);
    let stub = (await saved(page)).find((b) => b.id === 'st');

    expect(stub?.type).toBe('mystery');
    expect(stub?.data).toEqual(stubData);
    await openTunesOn(page, 'st');
    await tuneItem(page, 'delete').click();
    await gap(page);
    expect((await saved(page)).some((b) => b.id === 'st')).toBe(false);
    await press(page, UNDO);
    stub = (await saved(page)).find((b) => b.id === 'st');
    expect(stub?.type).toBe('mystery');
    expect(stub?.data).toEqual(stubData);
    expect((await saved(page)).map((b) => b.id)).toEqual(['p0', 'st', 'p1']);
  });

  // Defect: the double-click width reset is not in history at all (canUndo() is false right after it).
  // Root cause: columns-shared.ts:334-338 sets flex-grow on the column holders (outside any observed subtree)
  // and never calls persistColumnWidths like drag and keyboard resize do. If it did, family 3 would still drop it:
  // Column.save() omits a ratio of 1 (column/index.ts:265).
  test('W4T-27: undo of a column width reset (double-click) keeps the columns and restores the ratio', async ({ page }) => {
    test.fail();
    await mount(page, [
      ANCHOR,
      { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', data: { widthRatio: 1.5 }, parent: 'cl1', content: ['pa'] },
      { id: 'pa', type: 'paragraph', data: { text: 'Left' }, parent: 'c1' },
      { id: 'c2', type: 'column', data: { widthRatio: 0.5 }, parent: 'cl1', content: ['pb'] },
      { id: 'pb', type: 'paragraph', data: { text: 'Right' }, parent: 'c2' },
    ]);
    await page.getByTestId('column-resizer').first().dblclick();
    await gap(page);
    expect((await dataOf(page, 'c1'))?.widthRatio).toBeUndefined();
    expect(await canUndo(page)).toBe(true);
    await press(page, UNDO);

    expect((await saved(page)).map((b) => b.id)).toEqual(['p0', 'cl1', 'c1', 'pa', 'c2', 'pb']);
    expect((await dataOf(page, 'c1'))?.widthRatio).toBe(1.5);
  });
});
