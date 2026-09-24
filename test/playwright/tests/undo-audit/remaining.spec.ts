import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const CAPTURE_GAP_MS = 700;
const IMAGE_URL = 'http://localhost:4444/test/playwright/fixtures/image/shot.png';
const IMAGE_FILE = join(process.cwd(), 'test/playwright/fixtures/image/shot.png');
const VIDEO_URL = 'http://localhost:4444/public/samples/big-buck-bunny.mp4';

declare global {
  interface Window {
    blokInstance?: Blok;
    __resolveUpload?: () => void;
    __rejectUpload?: () => void;
    defaultBlockTools: Record<string, { class: unknown }>;
  }
}

type Slow = 'image' | 'url' | 'file' | 'none';

// A slow uploader waits until the test calls window.__resolveUpload().
// 'image': image uploads by file. 'url': image/audio/video/file uploads by URL. 'file': file uploads by file.
const MEDIA_URLS: Record<string, string> = {
  image: IMAGE_URL,
  audio: 'http://localhost:4444/public/samples/soundhelix-song-1.mp3',
  video: VIDEO_URL,
  file: 'http://localhost:4444/public/samples/release-notes.txt',
};

const mount = async (page: Page, blocks: OutputData['blocks'], slow: Slow = 'none'): Promise<void> => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ list, slowTool, url, urls }) => {
    document.getElementById('blok')?.remove();
    const d = document.createElement('div');

    d.id = 'blok';
    document.body.appendChild(d);
    const tools: Record<string, unknown> = {};

    if (slowTool === 'image') {
      tools.image = {
        class: window.defaultBlockTools.image.class,
        config: {
          uploader: {
            uploadByFile: (f: File) => new Promise((res) => {
              window.__resolveUpload = () => res({ url, fileName: f.name });
            }),
          },
        },
      };
    }
    if (slowTool === 'url') {
      Object.entries(urls).forEach(([name, stored]) => {
        tools[name] = {
          class: window.defaultBlockTools[name].class,
          config: {
            uploader: {
              uploadByUrl: () => new Promise((res, rej) => {
                window.__resolveUpload = () => res({ url: stored });
                window.__rejectUpload = () => rej(new Error('404'));
              }),
            },
          },
        };
      });
    }
    if (slowTool === 'file') {
      tools.file = {
        class: window.defaultBlockTools.file.class,
        config: {
          uploader: {
            uploadByFile: (f: File) => new Promise((res) => {
              window.__resolveUpload = () => res({ url, fileName: f.name, mimeType: f.type });
            }),
          },
        },
      };
    }
    const blok = new window.Blok({ holder: 'blok', tools, data: { blocks: list } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { list: blocks, slowTool: slow, url: IMAGE_URL, urls: MEDIA_URLS });
};

const saved = (page: Page): Promise<OutputData['blocks']> =>
  page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('no editor');
    }

    return (await window.blokInstance.save()).blocks;
  });

const canRedo = (page: Page): Promise<boolean> => page.evaluate(() => window.blokInstance?.history.canRedo() ?? false);

const gap = (page: Page): Promise<void> => page.evaluate((ms) => new Promise<void>((r) => {
  window.setTimeout(r, ms);
}), CAPTURE_GAP_MS);

const typeAtEnd = async (page: Page, text: string, value: string): Promise<void> => {
  await page.getByText(text, { exact: true }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(value);
};

const P = (id: string, text: string): OutputData['blocks'][number] => ({ id, type: 'paragraph', data: { text } });

const pasteText = async (locator: Locator, text: string): Promise<void> => {
  await locator.evaluate((element: HTMLElement, value: string) => {
    const pasteEvent = Object.assign(
      new Event('paste', { bubbles: true, cancelable: true }),
      {
        clipboardData: {
          getData: (type: string): string => (type === 'text/plain' ? value : ''),
          types: ['text/plain'],
        },
      }
    );

    element.dispatchEvent(pasteEvent);
  }, text);
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const holdUnfurl = async (page: Page): Promise<() => void> => {
  const gate: { release: () => void } = { release: () => undefined };
  const held = new Promise<void>((r) => {
    gate.release = r;
  });

  await page.route('**/__unfurl*', async (route) => {
    await held;
    await route.fulfill({ json: { success: 1, link: 'https://example.com/article', meta: { title: 'Stubbed Title' } } });
  });

  return () => gate.release();
};

const pasteBookmark = async (page: Page, blockId: string): Promise<void> => {
  const target = page.locator(`[data-blok-id="${blockId}"] [contenteditable]`);

  await target.click();
  await pasteText(target, 'https://example.com/article');
  await page.locator('[data-blok-item-name="paste-menu-bookmark"]').click();
  await expect(page.getByTestId('bookmark-loading')).toBeVisible();
};

const media = (page: Page, tool: string): Locator => page.locator(`[data-blok-tool="${tool}"]`);

const enterUrl = async (page: Page, tool: string, url: string): Promise<void> => {
  const block = media(page, tool);

  await block.locator('[data-tab="embed"]').click();
  await block.getByRole('textbox').fill(url);
  await block.locator('[data-action="submit-url"]').click();
};

const resolveUpload = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => typeof window.__resolveUpload === 'function');
  await page.evaluate(() => window.__resolveUpload?.());
};

const rejectUpload = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => typeof window.__rejectUpload === 'function');
  await page.evaluate(() => window.__rejectUpload?.());
};

const MEDIA_ERRORS: Record<string, string> = {
  image: '[data-role="error-state"]',
  audio: '[data-role="audio-error"]',
  video: '[data-role="video-error"]',
  file: '[data-role="file-error"]',
};

const dataOf = async (page: Page, id: string): Promise<Record<string, unknown> | undefined> =>
  (await saved(page)).find((b) => b.id === id)?.data;

const hasImage = async (page: Page): Promise<boolean> => (await saved(page)).some((b) => b.type === 'image');

test.describe('undo audit: remaining surfaces', () => {
  // Source: undo must keep redo until the user makes a new edit; a finishing upload is not one.
  // Observed: canRedo Expected true, Received false; redo never brings "alphaY" back.
  test('UNP-1: an image upload that finishes after an unrelated undo keeps redo', async ({ page }) => {
    await mount(page, [P('p', 'alpha'), { id: 'img', type: 'image', data: { url: '' } }], 'image');
    await page.locator('[data-blok-tool="image"]').getByTestId('file-input').setInputFiles(IMAGE_FILE);
    await gap(page);
    await typeAtEnd(page, 'alpha', 'Y');
    await gap(page);
    await page.keyboard.press(UNDO);
    await gap(page);
    await page.evaluate(() => window.__resolveUpload?.());
    await expect.poll(() => hasImage(page)).toBe(true);
    await gap(page);

    expect(await canRedo(page)).toBe(true);
    await page.keyboard.press(REDO);
    await gap(page);
    await expect(page.getByText('alphaY', { exact: true })).toBeVisible();
  });

  // Source: an upload's result belongs to the gesture that started it: undoing that gesture removes it, redo brings it back.
  test('UNP-1b: undo of inserting an image removes an upload that landed later, and redo brings the image back', async ({ page }) => {
    const image = page.locator('[data-blok-tool="image"]');
    const url = async (): Promise<unknown> => (await saved(page)).find((b) => b.type === 'image')?.data.url;

    await mount(page, [P('p', 'alpha'), P('q', '')], 'image');
    await page.locator('[data-blok-id="q"] [contenteditable]').click();
    await page.keyboard.type('/image', { delay: 30 });
    await page.locator('[data-blok-item-name="image"]').click();
    await gap(page);
    await image.getByTestId('file-input').setInputFiles(IMAGE_FILE);
    await gap(page);
    await page.evaluate(() => window.__resolveUpload?.());
    await expect.poll(() => hasImage(page)).toBe(true);
    await gap(page);

    // Undo the pick, then the insert.
    await page.keyboard.press(UNDO);
    await gap(page);
    await expect(image).toHaveCount(1);
    await expect(page.locator('[data-blok-tool="image"] img')).toHaveCount(0);
    await page.keyboard.press(UNDO);
    await gap(page);
    await expect(image).toHaveCount(0);
    await expect(page.locator('[data-blok-id="q"]')).toBeVisible();

    await page.keyboard.press(REDO);
    await gap(page);
    await expect(image).toHaveCount(1);
    await page.keyboard.press(REDO);
    await gap(page);
    expect(await url()).toBe(IMAGE_URL);
    await expect(page.locator('[data-blok-tool="image"] img')).toHaveCount(1);
    await expect(image).toHaveAttribute('data-state', 'rendered');
  });

  // Source: an upload's result belongs to the gesture that started it: undoing that gesture removes it, redo brings it back.
  test('UNP-1c: undo of picking a file for an empty image returns it to empty after the upload landed, and redo brings it back', async ({ page }) => {
    await mount(page, [P('p', 'alpha'), { id: 'img', type: 'image', data: { url: '' } }], 'image');
    const chooser = page.waitForEvent('filechooser');

    await page.locator('[data-blok-tool="image"] [data-action="choose-file"]').click();
    await (await chooser).setFiles(IMAGE_FILE);
    await gap(page);
    await typeAtEnd(page, 'alpha', 'Y');
    await gap(page);
    await page.keyboard.press(UNDO);
    await gap(page);
    await page.evaluate(() => window.__resolveUpload?.());
    await expect.poll(async () => (await saved(page)).find((b) => b.id === 'img')?.data.url).toBe(IMAGE_URL);
    await gap(page);
    await page.keyboard.press(REDO);
    await gap(page);
    await expect(page.getByText('alphaY', { exact: true })).toBeVisible();

    await page.keyboard.press(UNDO);
    await gap(page);
    await page.keyboard.press(UNDO);
    await gap(page);
    await expect(page.locator('[data-blok-tool="image"]')).toHaveAttribute('data-state', 'empty');
    expect(await hasImage(page)).toBe(false);
    await expect(page.getByText('alpha', { exact: true })).toBeVisible();

    await page.keyboard.press(REDO);
    await gap(page);
    expect((await saved(page)).find((b) => b.id === 'img')?.data.url).toBe(IMAGE_URL);
    await expect(page.locator('[data-blok-tool="image"] img')).toHaveCount(1);
    await expect(page.locator('[data-blok-tool="image"]')).toHaveAttribute('data-state', 'rendered');
    await page.keyboard.press(REDO);
    await gap(page);
    await expect(page.getByText('alphaY', { exact: true })).toBeVisible();
  });

  // Source: undo must keep redo until the user makes a new edit; a finishing link preview is not one.
  test('UNP-2: a bookmark preview that arrives after an unrelated undo keeps redo', async ({ page }) => {
    await gotoTestPage(page);
    const release = await holdUnfurl(page);

    await mount(page, [P('p', 'alpha'), P('q', '')]);
    await pasteBookmark(page, 'q');
    await gap(page);
    await typeAtEnd(page, 'alpha', 'Y');
    await gap(page);
    await page.keyboard.press(UNDO);
    await gap(page);
    release();
    await expect(page.getByTestId('bookmark-card')).toContainText('Stubbed Title');
    await gap(page);

    expect(await canRedo(page)).toBe(true);
    await page.keyboard.press(REDO);
    await gap(page);
    await expect(page.getByText('alphaY', { exact: true })).toBeVisible();
  });

  // Source: undo then redo must give the document the user would have had without them.
  test('UNP-3: undo then redo of a bookmark whose preview was still loading gets the preview', async ({ page }) => {
    await gotoTestPage(page);
    const release = await holdUnfurl(page);

    await mount(page, [P('p', 'alpha'), P('q', '')]);
    await pasteBookmark(page, 'q');
    await gap(page);
    await page.keyboard.press(UNDO);
    await gap(page);
    release();
    await gap(page);
    await page.keyboard.press(REDO);
    await gap(page);
    await gap(page);

    await expect(page.getByTestId('bookmark-card')).toContainText('Stubbed Title', { timeout: 2000 });
    const bookmark = (await saved(page)).find((b) => b.type === 'bookmark');

    expect(bookmark?.data.title).toBe('Stubbed Title');
  });

  // Source: undo must restore the exact prior state and keep redo.
  test('UNP-4: an image upload undone while pending does not land afterwards', async ({ page }) => {
    await mount(page, [P('p', 'alpha'), P('q', '')], 'image');
    await page.locator('[data-blok-id="q"] [contenteditable]').click();
    await page.keyboard.type('/image', { delay: 30 });
    await page.locator('[data-blok-item-name="image"]').click();
    await gap(page);
    await page.locator('[data-blok-tool="image"]').getByTestId('file-input').setInputFiles(IMAGE_FILE);
    await gap(page);
    await page.keyboard.press(UNDO);
    await gap(page);
    await page.evaluate(() => window.__resolveUpload?.());
    await gap(page);
    await gap(page);

    expect(await hasImage(page)).toBe(false);
    expect(await canRedo(page)).toBe(true);
  });

  // Source: opening a document is not an edit; nothing may be undoable before the user acts (cf. RDO-1b, LIF-1).
  // The video request is held so metadata lands after load, as it does on a slow network.
  test('UNP-5: a video without a saved aspect ratio adds an undo step when its metadata loads', async ({ page }) => {
    await gotoTestPage(page);
    const gate = { open: false };

    await page.route('**/big-buck-bunny.mp4*', async (route) => {
      while (!gate.open) {
        await new Promise((r) => setTimeout(r, 50));
      }
      await route.continue();
    });
    await mount(page, [P('p', 'alpha'), { id: 'v', type: 'video', data: { url: VIDEO_URL } }]);
    await gap(page);
    gate.open = true;
    await expect.poll(async () => (await saved(page)).find((b) => b.id === 'v')?.data.aspectRatio).toBeTruthy();
    await gap(page);

    expect(await page.evaluate(() => window.blokInstance?.history.canUndo())).toBe(false);
  });

  // Source: undo must restore the exact prior state (before the pick, the pasted link was on screen).
  test('UNP-6: one undo after picking Bookmark for a pasted link brings the link back', async ({ page }) => {
    await gotoTestPage(page);
    await page.route('**/__unfurl*', async (route) => {
      await route.fulfill({ json: { success: 1, link: 'https://example.com/article', meta: { title: 'Stubbed Title' } } });
    });
    await mount(page, [P('p', 'see')]);
    const target = page.locator('[data-blok-id="p"] [contenteditable]');

    await target.click();
    await page.keyboard.press('End');
    await gap(page);
    await pasteText(target, 'https://example.com/article');
    await gap(page);
    await page.locator('[data-blok-item-name="paste-menu-bookmark"]').click();
    await expect(page.getByTestId('bookmark-card')).toContainText('Stubbed Title');
    await gap(page);
    await page.keyboard.press(UNDO);
    await gap(page);

    await expect(target.getByRole('link', { name: 'https://example.com/article' })).toHaveCount(1, { timeout: 2000 });
    await expect(page.getByTestId('bookmark-card')).toHaveCount(0);
  });

  for (const tool of ['image', 'audio', 'video', 'file']) {
    // Source: undo must keep redo until the user makes a new edit; a finishing upload is not one.
    test(`UNP-7 (${tool}): an upload by URL that finishes after an unrelated undo keeps redo`, async ({ page }) => {
      await mount(page, [P('p', 'alpha'), { id: 'm', type: tool, data: { url: '' } }], 'url');
      await enterUrl(page, tool, 'https://example.com/source');
      await gap(page);
      await typeAtEnd(page, 'alpha', 'Y');
      await gap(page);
      await page.keyboard.press(UNDO);
      await gap(page);
      await resolveUpload(page);
      await expect.poll(async () => (await dataOf(page, 'm'))?.url).toBe(MEDIA_URLS[tool]);
      await gap(page);

      expect(await canRedo(page)).toBe(true);
      await page.keyboard.press(REDO);
      await gap(page);
      await expect(page.getByText('alphaY', { exact: true })).toBeVisible();
    });

    // Source: an upload's result belongs to the gesture that started it: undoing that gesture removes it, redo brings it back.
    test(`UNP-7b (${tool}): undo of entering a URL returns the block to empty after the upload landed, and redo brings it back`, async ({ page }) => {
      await mount(page, [P('p', 'alpha'), { id: 'm', type: tool, data: { url: '' } }], 'url');
      await enterUrl(page, tool, 'https://example.com/source');
      await gap(page);
      await typeAtEnd(page, 'alpha', 'Y');
      await gap(page);
      await resolveUpload(page);
      await expect.poll(async () => (await dataOf(page, 'm'))?.url).toBe(MEDIA_URLS[tool]);
      await gap(page);

      await page.keyboard.press(UNDO);
      await gap(page);
      await expect(page.getByText('alpha', { exact: true })).toBeVisible();
      await page.keyboard.press(UNDO);
      await gap(page);
      await expect(media(page, tool).locator('[data-action="choose-file"]')).toHaveCount(1);
      expect((await dataOf(page, 'm'))?.url ?? '').toBe('');

      await page.keyboard.press(REDO);
      await gap(page);
      expect((await dataOf(page, 'm'))?.url).toBe(MEDIA_URLS[tool]);
      await expect(media(page, tool).locator('[data-action="choose-file"]')).toHaveCount(0);
      await page.keyboard.press(REDO);
      await gap(page);
      await expect(page.getByText('alphaY', { exact: true })).toBeVisible();
    });
    // Source: a link that fails to upload was never saved (base 328fb87c): the block keeps its error, and the failed
    // link leaves no undo step, so one undo takes back the edit made before it.
    test(`UNP-7c (${tool}): a failed upload by URL saves nothing and adds no undo step`, async ({ page }) => {
      await mount(page, [P('p', 'alpha'), { id: 'm', type: tool, data: { url: '' } }], 'url');
      await typeAtEnd(page, 'alpha', 'Y');
      await gap(page);
      await enterUrl(page, tool, 'https://example.com/source');
      await gap(page);
      await rejectUpload(page);
      await expect(media(page, tool).locator(MEDIA_ERRORS[tool])).toHaveCount(1);
      // A media block with no link fails validate(), so save() leaves it out.
      await expect.poll(() => dataOf(page, 'm')).toBeUndefined();
      await gap(page);

      await page.keyboard.press(UNDO);
      await gap(page);
      await expect(page.getByText('alpha', { exact: true })).toBeVisible();
      expect(await dataOf(page, 'm')).toBeUndefined();
      await expect(media(page, tool)).toHaveCount(1);
      await page.keyboard.press(REDO);
      await gap(page);
      await expect(page.getByText('alphaY', { exact: true })).toBeVisible();
      expect(await dataOf(page, 'm')).toBeUndefined();
      await expect(media(page, tool)).toHaveCount(1);
      expect(await canRedo(page)).toBe(false);
    });

    // Source: undo must keep redo until the user makes a new edit; a failing upload is not one.
    test(`UNP-7d (${tool}): an upload by URL that fails after an unrelated undo keeps redo`, async ({ page }) => {
      await mount(page, [P('p', 'alpha'), { id: 'm', type: tool, data: { url: '' } }], 'url');
      await enterUrl(page, tool, 'https://example.com/source');
      await gap(page);
      await typeAtEnd(page, 'alpha', 'Y');
      await gap(page);
      await page.keyboard.press(UNDO);
      await gap(page);
      await rejectUpload(page);
      await expect.poll(() => dataOf(page, 'm')).toBeUndefined();
      await gap(page);

      expect(await canRedo(page)).toBe(true);
      await page.keyboard.press(REDO);
      await gap(page);
      await expect(page.getByText('alphaY', { exact: true })).toBeVisible();
      expect(await dataOf(page, 'm')).toBeUndefined();
      await expect(media(page, tool)).toHaveCount(1);
    });
  }

  // UNP-8 (a GIF swapped for a video) is pinned in test/unit/tools/image/index.test.ts: the GIF to WebM
  // conversion never succeeds in Chromium, where VideoFrame.timestamp is read-only.

  // Source: undo must keep redo until the user makes a new edit; a file turning into an image is not one.
  test('UNP-9: a file upload that becomes an image after an unrelated undo keeps redo', async ({ page }) => {
    await mount(page, [P('p', 'alpha'), { id: 'f', type: 'file', data: { url: '' } }], 'file');
    await media(page, 'file').getByTestId('file-input').setInputFiles(IMAGE_FILE);
    await gap(page);
    await typeAtEnd(page, 'alpha', 'Y');
    await gap(page);
    await page.keyboard.press(UNDO);
    await gap(page);
    await resolveUpload(page);
    await expect(media(page, 'image')).toHaveCount(1);
    await gap(page);

    expect(await canRedo(page)).toBe(true);
    await page.keyboard.press(REDO);
    await gap(page);
    await expect(page.getByText('alphaY', { exact: true })).toBeVisible();
  });

  // Source: an upload's result belongs to the gesture that started it: undoing that gesture removes it, redo brings it back.
  test('UNP-9b: undo of picking an image for a file block gives back the empty file block, and redo the image', async ({ page }) => {
    await mount(page, [P('p', 'alpha'), { id: 'f', type: 'file', data: { url: '' } }], 'file');
    await media(page, 'file').getByTestId('file-input').setInputFiles(IMAGE_FILE);
    await gap(page);
    await resolveUpload(page);
    await expect(media(page, 'image')).toHaveCount(1);
    await gap(page);

    await page.keyboard.press(UNDO);
    await gap(page);
    await expect(media(page, 'image')).toHaveCount(0);
    await expect(media(page, 'file').locator('[data-action="choose-file"]')).toHaveCount(1);

    await page.keyboard.press(REDO);
    await gap(page);
    await expect(media(page, 'image')).toHaveCount(1);
    expect((await saved(page)).find((b) => b.type === 'image')?.data.url).toBe(IMAGE_URL);
  });

  // Source: undo must keep redo until the user makes a new edit. Undo and redo of the pick rebuild the
  // block, so the upload lands on a new instance of the tool.
  test('UNP-10: an upload that lands on a rebuilt image block keeps redo', async ({ page }) => {
    await mount(page, [P('p', 'alpha'), { id: 'img', type: 'image', data: { url: '' } }], 'image');
    await media(page, 'image').getByTestId('file-input').setInputFiles(IMAGE_FILE);
    await gap(page);
    await typeAtEnd(page, 'alpha', 'Y');
    await gap(page);
    await page.keyboard.press(UNDO);
    await gap(page);
    await page.keyboard.press(UNDO);
    await gap(page);
    await page.keyboard.press(REDO);
    await gap(page);
    await resolveUpload(page);
    await expect.poll(async () => (await dataOf(page, 'img'))?.url).toBe(IMAGE_URL);
    await gap(page);

    expect(await canRedo(page)).toBe(true);
    await page.keyboard.press(REDO);
    await gap(page);
    await expect(page.getByText('alphaY', { exact: true })).toBeVisible();
  });

  test('spacer: grip keyboard resize undo and redo', async ({ page }) => {
    await mount(page, [P('p', 'alpha'), { id: 's', type: 'spacer', data: { height: 40 } }]);
    const grip = page.locator('[data-blok-spacer-grip="bottom"]');

    await grip.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await gap(page);
    const resized = (await saved(page)).find((b) => b.id === 's')?.data.height;

    expect(resized).not.toBe(40);
    await page.keyboard.press(UNDO);
    await gap(page);
    expect((await saved(page)).find((b) => b.id === 's')?.data.height).toBe(40);
    await expect(grip).toHaveAttribute('aria-valuenow', '40');
    await page.keyboard.press(REDO);
    await gap(page);
    expect((await saved(page)).find((b) => b.id === 's')?.data.height).toBe(resized);
  });
});
