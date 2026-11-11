import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const create = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.evaluate(async ({ holder, initial }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: { blocks: initial } });

    window.blokInstance = blok;
    await blok.isReady;
    blok.history.clear();
  }, { holder: HOLDER_ID, initial: blocks });
};

/** Caret offset in the code text, or -1 when the caret is not in the code. */
const codeCaret = async (page: Page): Promise<number> => page.getByTestId('code-content').evaluate((code) => {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || !code.contains(selection.focusNode)) {
    return -1;
  }

  const range = document.createRange();

  range.selectNodeContents(code);
  range.setEnd(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset);

  return range.toString().length;
});

const savedCode = async (page: Page): Promise<unknown> =>
  page.evaluate(async () => (await window.blokInstance?.save())?.blocks[0]?.data.code);

test.describe('undo audit — measured Notion gaps', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  // Notion U154: Tab inserts one tab character, one undo step.
  test('Tab in code inserts a tab character as one undo step', async ({ page }) => {
    await create(page, [{ id: 'b1', type: 'code', data: { code: 'x', language: 'plain text' } }]);
    const code = page.getByTestId('code-content');

    await code.click();
    await page.keyboard.press('Home');
    await expect.poll(() => codeCaret(page)).toBe(0);

    await page.keyboard.press('Tab');
    await expect.poll(() => code.textContent()).toBe('\tx');
    expect(await codeCaret(page)).toBe(1);
    expect(await savedCode(page)).toBe('\tx');

    await page.keyboard.press(UNDO);
    await expect.poll(() => code.textContent()).toBe('x');
    expect(await codeCaret(page)).toBe(0);

    await page.keyboard.press(REDO);
    await expect.poll(() => code.textContent()).toBe('\tx');
    expect(await codeCaret(page)).toBe(1);

    // Shift+Tab takes the tab back out.
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => code.textContent()).toBe('x');
  });
});
