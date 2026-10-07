/**
 * Data-loss probes that only a real browser can show: IME composition in a
 * table cell, blur mid-composition, fast typing then leaving the cell, and an
 * onSave host tearing the editor down right after a cell edit.
 */
import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import { blocksAsHtml, htmlOf } from '../../helpers/saved-as-html';

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
    savedPayloads?: OutputData[];
  }
}

const TABLE_DOC: OutputData['blocks'] = [
  {
    id: 'tbl',
    type: 'table',
    data: { withHeadings: false, content: [[{ blocks: ['c00'] }, { blocks: ['c01'] }], [{ blocks: ['c10'] }, { blocks: ['c11'] }]] },
  },
  { id: 'c00', type: 'paragraph', data: { text: 'a' }, parent: 'tbl' },
  { id: 'c01', type: 'paragraph', data: { text: 'b' }, parent: 'tbl' },
  { id: 'c10', type: 'paragraph', data: { text: 'c' }, parent: 'tbl' },
  { id: 'c11', type: 'paragraph', data: { text: 'd' }, parent: 'tbl' },
];

const create = async (page: Page, blocks: OutputData['blocks'], withOnSave = false): Promise<void> => {
  await page.evaluate(async ({ holder, blocks: data, withOnSave: hook }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);
    window.savedPayloads = [];
    const blok = new window.Blok({
      holder,
      data: { blocks: data },
      ...(hook ? { onSave: (out: OutputData) => { window.savedPayloads?.push(out); } } : {}),
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blocks, withOnSave });
};

const cellInput = (page: Page, row: number, col: number): Locator =>
  page.locator(`#${HOLDER_ID} [data-blok-table-cell-row="${row}"][data-blok-table-cell-col="${col}"] [contenteditable="true"]`).first();

const savedText = async (page: Page, id: string): Promise<string | undefined> =>
  (blocksAsHtml(await page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []))
    .find((b) => b.id === id)?.data as { text?: string } | undefined)?.text;

const savedCellIds = async (page: Page): Promise<string[][]> =>
  page.evaluate(async () => {
    const out = await window.blokInstance?.save();
    const table = out?.blocks.find((b) => b.type === 'table');

    return ((table?.data as { content: Array<Array<{ blocks: string[] }>> }).content).map((row) => row.map((cell) => cell.blocks.join(',')));
  });

const wait = async (page: Page, ms: number): Promise<void> => {
  await page.evaluate(async (t) => {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, t);
    });
  }, ms);
};

test.describe('table data loss: browser-only paths', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('an IME composition committed in a cell is saved in that cell', async ({ page }) => {
    await create(page, TABLE_DOC);
    await cellInput(page, 1, 1).click();
    await page.keyboard.press('End');
    const cdp = await page.context().newCDPSession(page);

    await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 });
    await cdp.send('Input.insertText', { text: '日本' });
    await wait(page, 100);

    await expect(cellInput(page, 1, 1)).toHaveText('d日本');
    expect(await savedText(page, 'c11')).toBe('d日本');
    expect(await savedCellIds(page)).toStrictEqual([['c00', 'c01'], ['c10', 'c11']]);
  });

  test('clicking another cell mid-composition keeps the composed text', async ({ page }) => {
    await create(page, TABLE_DOC);
    await cellInput(page, 1, 1).click();
    await page.keyboard.press('End');
    const cdp = await page.context().newCDPSession(page);

    await cdp.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 });
    await cellInput(page, 0, 0).click();
    await wait(page, 200);

    const text11 = await cellInput(page, 1, 1).textContent();
    const saved11 = await savedText(page, 'c11');

    // Composition text either commits into the original cell or is dropped
    // by the browser; it must never land in another cell or vanish from save
    // while still visible.
    expect(saved11).toBe(text11);
    await expect(cellInput(page, 0, 0)).toHaveText(/^a$/);
    expect(await savedCellIds(page)).toStrictEqual([['c00', 'c01'], ['c10', 'c11']]);
  });

  test('fast typing in a cell then clicking away keeps every character', async ({ page }) => {
    await create(page, TABLE_DOC);
    await cellInput(page, 0, 1).click();
    await page.keyboard.press('End');
    await page.keyboard.type('-the-quick-brown-fox', { delay: 0 });
    await cellInput(page, 1, 0).click();

    expect(await savedText(page, 'c01')).toBe('b-the-quick-brown-fox');
  });

  test('a cell edit followed by destroy() still reaches onSave', async ({ page }) => {
    await create(page, TABLE_DOC, true);
    await wait(page, 600);
    await page.evaluate(() => {
      window.savedPayloads = [];
    });
    await cellInput(page, 1, 1).click();
    await page.keyboard.press('End');
    await page.keyboard.type('XYZ');
    await page.evaluate(() => {
      window.blokInstance?.destroy();
      window.blokInstance = undefined;
    });
    await wait(page, 1000);

    const texts = await page.evaluate(() =>
      (window.savedPayloads ?? []).map((p) => (p.blocks.find((b) => b.id === 'c11')?.data as { text?: unknown } | undefined)?.text)
    );

    expect(texts.map((text) => htmlOf(text))).toContain('dXYZ');
  });
});
