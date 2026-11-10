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
    const blok = new window.Blok({ holder, data: { blocks: [{ type: 'paragraph', data: { text: '' } }] } });

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

// Notion U178: one undo takes back all of "/tod" and closes the menu; redo brings the text back with the menu closed.
test.describe('undo audit — the slash menu and history keys', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await create(page);
  });

  test('undo closes the slash menu and redo does not reopen it', async ({ page }) => {
    const wrapper = page.locator(`#${HOLDER_ID} [data-blok-toolbox-opened="true"]`);
    const editable = page.locator(`#${HOLDER_ID} [contenteditable="true"]`).first();

    await editable.click();
    await page.keyboard.type('/tod');
    await expect(wrapper).toHaveCount(1);
    await expect.poll(() => savedText(page)).toBe('/tod');

    await page.keyboard.press(UNDO);
    await expect(wrapper).toHaveCount(0);
    await expect.poll(() => savedText(page)).toBe('');

    await page.keyboard.press(REDO);
    await expect.poll(() => savedText(page)).toBe('/tod');
    // Give a late reopen time to show before checking it did not.
    await page.evaluate(() => new Promise<void>((resolve) => {
      window.setTimeout(resolve, 300);
    }));
    await expect(wrapper).toHaveCount(0);

    // "/tod" was one step: a second undo after the first leaves nothing more to take back.
    await page.keyboard.press(UNDO);
    await expect.poll(() => savedText(page)).toBe('');
    await page.keyboard.press(UNDO);
    await expect.poll(() => savedText(page)).toBe('');
  });
});
