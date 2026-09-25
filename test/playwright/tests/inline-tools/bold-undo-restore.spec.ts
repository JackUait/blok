import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type Blocks = OutputData['blocks'];

const mount = async (page: Page, blocks: Blocks): Promise<void> => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async (list) => {
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.setAttribute('data-blok-testid', 'blok');
    document.body.appendChild(holder);
    const blok = new window.Blok({ holder: 'blok', data: { blocks: list } });

    window.blokInstance = blok;
    await blok.isReady;
  }, blocks);
};

const savedText = (page: Page, id: string): Promise<string> => page.evaluate(async (blockId) => {
  const output = await window.blokInstance?.save();
  const text: unknown = output?.blocks.find((block) => block.id === blockId)?.data.text;

  return typeof text === 'string' ? text : '';
}, id);

const documentText = (page: Page, id: string): Promise<string> => page.evaluate((blockId) => {
  const blok = window.blokInstance as unknown as { module: { yjsManager: { toJSON: () => Array<{ id: string; data?: { text?: unknown } }> } } };

  return String(blok.module.yjsManager.toJSON().find((block) => block.id === blockId)?.data?.text);
}, id);

const editable = (page: Page, id: string): ReturnType<Page['locator']> => page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

test.describe('stored <b> bold', () => {
  test('saves as <strong> after a merge is undone', async ({ page }) => {
    await mount(page, [
      { id: 'a', type: 'paragraph', data: { text: 'first' } },
      { id: 'b', type: 'paragraph', data: { text: '<b>ld</b> tail' } },
    ]);
    await expect.poll(() => savedText(page, 'b')).toBe('<strong>ld</strong> tail');

    // Caret at the very start of block b, inside the bold text.
    await editable(page, 'b').evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const range = document.createRange();

      walker.nextNode();
      range.setStart(walker.currentNode, 0);
      range.collapse(true);
      (element as HTMLElement).focus();
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    });
    await page.keyboard.press('Backspace');
    await expect(page.locator('[data-blok-id="b"]')).toHaveCount(0);

    await page.keyboard.press(UNDO);
    await expect(editable(page, 'b')).toHaveText('ld tail');

    expect(await savedText(page, 'b')).toBe('<strong>ld</strong> tail');
    await expect.poll(() => editable(page, 'b').innerHTML()).toBe('<strong>ld</strong> tail');
  });

  test('the document holds what save() returns after boot', async ({ page }) => {
    await mount(page, [ { id: 'b', type: 'paragraph', data: { text: '<b>ld</b> tail' } } ]);

    await expect.poll(() => documentText(page, 'b')).toBe('<strong>ld</strong> tail');
  });
});
