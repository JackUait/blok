import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { blocksAsHtml } from '../helpers/saved-as-html';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const create = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: { blocks: [{ type: 'paragraph', data: { text: 'Alpha' } }] } });

    window.blokInstance = blok;
    await blok.isReady;
    blok.history.clear();
  }, { holder: HOLDER_ID });
};

const savedText = async (page: Page): Promise<string> => {
  const blocks = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);
  const text: unknown = blocksAsHtml(blocks)[0]?.data.text;

  return typeof text === 'string' ? text : '';
};

test.describe('undo audit — undo and redo announcements', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await create(page);
  });

  test('a key press says Undone, Redone, then Nothing to redo', async ({ page }) => {
    // The live region Blok owns, not any other status region on the page.
    const status = page.locator('[data-blok-announcer][role="status"]');
    const editable = page.locator(`#${HOLDER_ID} [contenteditable="true"]`).first();

    await editable.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' one');
    await expect.poll(() => savedText(page)).toBe('Alpha one');

    // The region clears 1 s after each message, so check right after each press.
    await page.keyboard.press(UNDO);
    await expect(status).toHaveText('Undone');
    await expect.poll(() => savedText(page)).toBe('Alpha');

    await page.keyboard.press(REDO);
    await expect(status).toHaveText('Redone');
    await expect.poll(() => savedText(page)).toBe('Alpha one');

    // If an announcement had made a step, this redo would have something to apply.
    await page.keyboard.press(REDO);
    await expect(status).toHaveText('Nothing to redo');
    await expect.poll(() => savedText(page)).toBe('Alpha one');
  });

  test('an undo press with nothing to undo says nothing', async ({ page }) => {
    const status = page.locator('[data-blok-announcer][role="status"]');
    const editable = page.locator(`#${HOLDER_ID} [contenteditable="true"]`).first();

    await editable.click();
    await page.keyboard.press(UNDO);
    // Give the announcer's next-task write time to land before reading the region.
    await page.evaluate(() => new Promise<void>((resolve) => {
      window.setTimeout(resolve, 200);
    }));

    await expect(status).toHaveText('');
  });
});
