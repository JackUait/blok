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

const savedBlocks = async (page: Page): Promise<string[]> => {
  const blocks = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);

  return blocksAsHtml(blocks).map((block) => {
    const text: unknown = block.data.text;

    return `${block.type}:${typeof text === 'string' ? text : ''}`;
  });
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
    // One letter, no space: a space plus a pause would cut a second step.
    await page.keyboard.type('X');
    await expect.poll(() => savedText(page)).toBe('AlphaX');

    // The region clears 1 s after each message, so check right after each press.
    await page.keyboard.press(UNDO);
    await expect(status).toHaveText('Undone');
    await expect.poll(() => savedText(page)).toBe('Alpha');

    await page.keyboard.press(REDO);
    await expect(status).toHaveText('Redone');
    await expect.poll(() => savedText(page)).toBe('AlphaX');

    // If an announcement had made a step, this redo would have something to apply.
    await page.keyboard.press(REDO);
    await expect(status).toHaveText('Nothing to redo');
    await expect.poll(() => savedText(page)).toBe('AlphaX');
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

  // Notion's live region after a markdown shortcut (scenarios U074, U077, U080, U083).
  for (const { keys, message, blocks } of [
    { keys: '## ', message: 'Converted to Heading 2', blocks: ['paragraph:Alpha', 'header:Item'] },
    { keys: '[] ', message: 'Converted to To-do list', blocks: ['paragraph:Alpha', 'list:Item'] },
    { keys: '---', message: 'Converted to Divider', blocks: ['paragraph:Alpha', 'divider:', 'paragraph:Item'] },
    { keys: '# ', message: 'Converted to Heading 1', blocks: ['paragraph:Alpha', 'header:Item'] },
  ]) {
    test(`typing ${JSON.stringify(keys)} says ${message}`, async ({ page }) => {
      const status = page.locator('[data-blok-announcer][role="status"]');
      const editable = page.locator(`#${HOLDER_ID} [contenteditable="true"]`).first();

      await editable.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      // The region clears 1 s after each message, so check right after the shortcut.
      await page.keyboard.type(keys);
      await expect(status).toHaveText(message);

      await page.keyboard.type('Item');
      await expect.poll(() => savedBlocks(page)).toEqual(blocks);
    });
  }

  test('an undo after a shortcut says only Undone and keeps the steps', async ({ page }) => {
    const status = page.locator('[data-blok-announcer][role="status"]');
    const editable = page.locator(`#${HOLDER_ID} [contenteditable="true"]`).first();

    await editable.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('## ');
    await expect(status).toHaveText('Converted to Heading 2');
    await page.keyboard.type('Item');
    await expect.poll(() => savedBlocks(page)).toEqual(['paragraph:Alpha', 'header:Item']);

    // The first undo takes back only the text typed after the conversion, as in Notion.
    await page.keyboard.press(UNDO);
    await expect(status).toHaveText('Undone');
    await expect.poll(() => savedBlocks(page)).toEqual(['paragraph:Alpha', 'header:']);
  });
});
