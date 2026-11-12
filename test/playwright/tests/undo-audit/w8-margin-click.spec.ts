/**
 * A click in the editor's empty area beside a block's row puts the caret at
 * the end of that row's line, as in Notion (U179, RM2 item 4).
 */
import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type SavedBlock = OutputData['blocks'][number];

const createBlok = async (page: Page, blocks: SavedBlock[]): Promise<void> => {
  await page.evaluate(async ({ holder, initial }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: { blocks: initial } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initial: blocks });
};

const editable = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

/** The caret as `id@offset`, or `none` when the selection is outside every block. */
const caret = async (page: Page): Promise<string> => page.evaluate(() => {
  const selection = window.getSelection();

  if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) {
    return 'none';
  }
  const node = selection.anchorNode;
  const element = node instanceof Element ? node : node?.parentElement ?? null;
  const input = element?.closest('[contenteditable="true"]');
  const id = element?.closest('[data-blok-id]')?.getAttribute('data-blok-id');

  if (input == null || id == null || node === null) {
    return 'none';
  }
  const range = document.createRange();

  range.selectNodeContents(input);
  range.setEnd(node, selection.anchorOffset);

  return `${id}@${range.toString().length}`;
});

/** What sits under a point: a block's content, its row outside the content, the editor surface, or the page. */
const whereIs = async (page: Page, x: number, y: number): Promise<string> => page.evaluate(({ px, py, holder }) => {
  const element = document.elementFromPoint(px, py);
  const redactor = document.querySelector(`#${holder} [data-blok-redactor]`);

  if (element === null) {
    return 'nothing';
  }
  if (element.closest('[data-blok-element-content]') !== null) {
    return 'content';
  }
  if (element.closest('[data-blok-id]') !== null) {
    return 'holder-row';
  }
  if (redactor?.contains(element) === true) {
    return 'redactor';
  }

  return document.getElementById(holder)?.contains(element) === true ? 'holder' : 'page';
}, { px: x, py: y, holder: HOLDER_ID });

test.describe('a click beside a block row (U179)', () => {
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('120 px right of the block, on its row, moves the caret to that line end', async ({ page }) => {
    await createBlok(page, [
      { id: 'b1', type: 'paragraph', data: { text: 'Alpha' } },
      { id: 'b2', type: 'paragraph', data: { text: 'Beta' } },
    ]);
    await editable(page, 'b1').click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type(' x');
    expect(await caret(page)).toBe('b1@5');

    const box = await page.locator('[data-blok-id="b1"] [data-blok-element-content]').first().boundingBox();

    if (box === null) {
      throw new Error('no box for b1');
    }
    const x = box.x + box.width + 120;
    const y = box.y + box.height / 2;

    // Measured: this point is on b1's holder, outside its content box, inside the editor.
    expect(await whereIs(page, x, y)).toBe('holder-row');

    await page.mouse.click(x, y);

    await expect.poll(() => caret(page)).toBe('b1@7');

    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => editable(page, 'b1').textContent()).toBe('Alpha');
    expect(await caret(page)).toBe('b1@3');

    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect.poll(() => editable(page, 'b1').textContent()).toBe('Alp xha');
    expect(await caret(page)).toBe('b1@7');
  });

  test('a click on the page outside the editor leaves the caret where it was', async ({ page }) => {
    await createBlok(page, [{ id: 'b1', type: 'paragraph', data: { text: 'Alpha' } }]);
    await page.evaluate((holder) => {
      const root = document.getElementById(holder);

      if (root !== null) {
        root.style.width = '600px';
      }
    }, HOLDER_ID);
    await editable(page, 'b1').click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(await caret(page)).toBe('b1@3');

    const box = await page.locator(`#${HOLDER_ID}`).boundingBox();

    if (box === null) {
      throw new Error('no holder box');
    }
    const x = box.x + box.width + 40;
    const y = box.y + 20;

    expect(await whereIs(page, x, y)).toBe('page');
    await page.mouse.click(x, y);

    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-blok-id]') == null)).toBe(true);
    expect(await caret(page)).toBe('none');
  });
});
