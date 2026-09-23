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
    defaultBlockTools: Record<string, { class: unknown }>;
  }
}

type Slow = 'image' | 'none';

// With slow = 'image' the image uploader waits until the test calls window.__resolveUpload().

const mount = async (page: Page, blocks: OutputData['blocks'], slow: Slow = 'none'): Promise<void> => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ list, slowTool, url }) => {
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
    const blok = new window.Blok({ holder: 'blok', tools, data: { blocks: list } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { list: blocks, slowTool: slow, url: IMAGE_URL });
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

const hasImage = async (page: Page): Promise<boolean> => (await saved(page)).some((b) => b.type === 'image');

test.describe('undo audit: remaining surfaces', () => {
  // Source: undo must keep redo until the user makes a new edit; a finishing upload is not one.
  // Observed: canRedo Expected true, Received false; redo never brings "alphaY" back.
  test('UNP-1: an image upload that finishes after an unrelated undo keeps redo', async ({ page }) => {
    test.fail();
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

  // Source: undo must keep redo until the user makes a new edit; a finishing link preview is not one.
  // Observed: canRedo Expected true, Received false.
  test('UNP-2: a bookmark preview that arrives after an unrelated undo keeps redo', async ({ page }) => {
    test.fail();
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
  // The preview lands while the block is undone, is dropped, and redo never fetches again.
  // Observed: card text Expected "Stubbed Title", Received "example.comhttps://example.com/article"; saved data has no title.
  test('UNP-3: undo then redo of a bookmark whose preview was still loading gets the preview', async ({ page }) => {
    test.fail();
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
  // One Cmd+Z during the upload only swaps the block back to the empty picker (the image block stays);
  // the upload then lands in it and redo is gone.
  // Observed: hasImage Expected false, Received true.
  test('UNP-4: an image upload undone while pending does not land afterwards', async ({ page }) => {
    test.fail();
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
  // The player writes aspectRatio on loadedmetadata (video/index.ts) and that write is recorded.
  // The video request is held so metadata lands after load, as it does on a slow network.
  // Observed: canUndo Expected false, Received true.
  test('UNP-5: a video without a saved aspect ratio adds an undo step when its metadata loads', async ({ page }) => {
    test.fail();
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
  // History holds two steps, but the first undo removes the card AND the link, and the second does nothing.
  // Observed: link count Expected 1, Received 0; the next undo changes nothing.
  test('UNP-6: one undo after picking Bookmark for a pasted link brings the link back', async ({ page }) => {
    test.fail();
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
