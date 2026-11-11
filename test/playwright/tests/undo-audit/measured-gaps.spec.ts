import type { Locator, Page } from '@playwright/test';
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

const editableOf = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

const selectedIds = async (page: Page): Promise<string[]> => page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-blok-selected="true"]')).map((el) => el.getAttribute('data-blok-id') ?? ''));

const savedTexts = async (page: Page): Promise<unknown[]> => page.evaluate(async () =>
  ((await window.blokInstance?.save())?.blocks ?? []).map((b) => b.data.text));

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

  // Notion U119 (presses ~5 ms apart) and U120 (~260 ms apart): two presses select every block.
  for (const gap of [15, 300]) {
    test(`Meta+a twice ${gap} ms apart selects every block, and Backspace deletes them in one undo step`, async ({ page }) => {
      await create(page, [
        { id: 'b1', type: 'paragraph', data: { text: 'one' } },
        { id: 'b2', type: 'paragraph', data: { text: 'two' } },
        { id: 'b3', type: 'paragraph', data: { text: 'three' } },
      ]);
      await editableOf(page, 'b1').click();
      await page.keyboard.press('End');

      await page.keyboard.press('ControlOrMeta+a');
      // The pause between presses is what this test varies.
      // eslint-disable-next-line playwright/no-wait-for-timeout
      await page.waitForTimeout(gap);
      await page.keyboard.press('ControlOrMeta+a');

      await expect.poll(() => selectedIds(page)).toEqual(['b1', 'b2', 'b3']);

      await page.keyboard.press('Backspace');
      await expect(page.locator('[data-blok-id="b2"]')).toHaveCount(0);
      await expect(page.locator('[data-blok-id="b3"]')).toHaveCount(0);

      await page.keyboard.press(UNDO);
      await expect.poll(() => savedTexts(page)).toHaveLength(3);
      await page.keyboard.press(REDO);
      await expect(page.locator('[data-blok-id="b3"]')).toHaveCount(0);
    });
  }

  // Notion U060 ("Beta/") and U173 ("x/"): "/" right after a letter is plain text.
  test('"/" typed right after a letter stays a literal character and opens no menu', async ({ page }) => {
    await create(page, [{ id: 'b1', type: 'paragraph', data: { text: 'Beta' } }]);
    await editableOf(page, 'b1').click();
    await page.keyboard.press('End');

    await page.keyboard.type('/');

    await expect(editableOf(page, 'b1')).toHaveText('Beta/');
    // Two frames: the menu would have opened by now.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator(`#${HOLDER_ID} [data-blok-toolbox-opened="true"]`)).toHaveCount(0);

    await page.keyboard.press(UNDO);
    await expect(editableOf(page, 'b1')).toHaveText('Beta');
  });

  test('"/" after a space still opens the menu', async ({ page }) => {
    await create(page, [{ id: 'b1', type: 'paragraph', data: { text: 'Beta' } }]);
    await editableOf(page, 'b1').click();
    await page.keyboard.press('End');

    await page.keyboard.type(' /');

    await expect(page.locator(`#${HOLDER_ID} [data-blok-toolbox-opened="true"]`)).toHaveCount(1);
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
