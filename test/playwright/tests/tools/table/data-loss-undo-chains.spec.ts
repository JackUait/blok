/**
 * Probes: table undo/redo chains in a real browser, with real typing.
 */
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

const DOC: OutputData = {
  blocks: [
    { id: 'p-before', type: 'paragraph', data: { text: 'before' } },
    {
      id: 'tbl',
      type: 'table',
      data: {
        withHeadings: false,
        withHeadingColumn: false,
        content: [
          [{ blocks: ['a'], id: 'k0', rowId: 'r0' }, { blocks: ['b'], id: 'k1', rowId: 'r0' }],
          [{ blocks: ['c'], id: 'k0', rowId: 'r1' }, { blocks: ['d'], id: 'k1', rowId: 'r1' }],
        ],
      },
      content: ['a', 'b', 'c', 'd'],
    },
    ...['a', 'b', 'c', 'd'].map(id => ({ id, type: 'paragraph', data: { text: id.toUpperCase() }, parent: 'tbl' })),
  ],
};

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await page.evaluate(async ({ holder, initialData }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: initialData });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: data });
};

const wait = (page: Page, ms: number): Promise<void> => page.evaluate((t) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, t);
}), ms);

const texts = async (page: Page): Promise<string[][]> => page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-blok-table-row]')).map(r =>
    Array.from(r.querySelectorAll(':scope > [data-blok-table-cell]')).map(c =>
      Array.from(c.querySelectorAll('[data-blok-table-cell-blocks] > [data-blok-id]')).map(b => (b.textContent ?? '').trim()).join('|'))));

const savedTexts = async (page: Page): Promise<string[][]> => page.evaluate(async () => {
  const out = await window.blokInstance?.save();
  const blocks = out?.blocks ?? [];
  const byId = new Map(blocks.map(b => [b.id, String((b.data as { text?: string }).text ?? '')]));
  const table = blocks.find(b => b.id === 'tbl');

  return (table?.data as { content: { blocks: string[] }[][] }).content.map(row => row.map(cell => cell.blocks.map(id => byId.get(id) ?? `<missing:${id}>`).join('|')));
});

const kbUndo = async (page: Page): Promise<void> => {
  await page.locator('[data-blok-id="p-before"] [contenteditable="true"]').click();
  await page.keyboard.press(UNDO);
  await wait(page, 500);
};

const kbRedo = async (page: Page): Promise<void> => {
  await page.keyboard.press(REDO);
  await wait(page, 500);
};

const row0 = async (page: Page): Promise<string[]> => page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-blok-table-cell-row="0"]')).map(c => (c.textContent ?? '').trim()));

const canRedo = (page: Page): Promise<boolean> => page.evaluate(() => window.blokInstance?.history.canRedo() ?? false);

const clearRow0 = async (page: Page): Promise<void> => {
  await page.locator('[data-blok-table-cell-row="0"][data-blok-table-cell-col="0"]').click();
  const grip = page.locator('[data-blok-table-grip-row="0"]');

  await expect(grip).toBeVisible();
  await grip.click();
  await page.getByRole('menuitem', { name: 'Clear contents', exact: true }).click();
  await expect.poll(() => row0(page)).toEqual(['', '']);
  await wait(page, 700);
};

test.describe('table undo/redo chains in a real browser', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await createBlok(page, DOC);
    await wait(page, 700);
  });

  test('keyboard undo keeps redo, and redo clears the row again', async ({ page }) => {
    await clearRow0(page);
    await page.locator('[data-blok-id="p-before"] [contenteditable="true"]').click();
    await page.keyboard.press(UNDO);
    await wait(page, 500);
    expect(await row0(page)).toEqual(['A', 'B']);
    expect(await canRedo(page)).toBe(true);
    await page.keyboard.press(REDO);
    await wait(page, 500);
    expect(await row0(page)).toEqual(['', '']);
  });

  test('history API undo keeps redo, and redo clears the row again', async ({ page }) => {
    await clearRow0(page);
    await page.evaluate(() => window.blokInstance?.history.undo());
    await wait(page, 500);
    expect(await row0(page)).toEqual(['A', 'B']);
    expect(await canRedo(page)).toBe(true);
    await page.evaluate(() => window.blokInstance?.history.redo());
    await wait(page, 500);
    expect(await row0(page)).toEqual(['', '']);
  });

  test('type + Enter + type in a cell, delete its row, undo x3, redo x3, undo x1', async ({ page }) => {
    const editable = page.locator('[data-blok-id="c"] [contenteditable="true"]');

    await editable.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' x');
    await wait(page, 700);
    await page.keyboard.press('Enter');
    await page.keyboard.type('new');
    await wait(page, 700);
    expect(await savedTexts(page)).toEqual([['A', 'B'], ['C x|new', 'D']]);

    await page.locator('[data-blok-table-cell-row="1"][data-blok-table-cell-col="0"]').click();
    const grip = page.locator('[data-blok-table-grip-row="1"]');

    await expect(grip).toBeVisible();
    await grip.click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await wait(page, 700);
    expect(await savedTexts(page)).toEqual([['A', 'B']]);

    const undoTrail: string[][][] = [];

    for (let i = 0; i < 6 && JSON.stringify(await savedTexts(page)) !== JSON.stringify([['A', 'B'], ['C', 'D']]); i++) {
      await kbUndo(page);
      undoTrail.push(await savedTexts(page));
      expect(await texts(page), `screen after undo ${i + 1}`).toEqual(await savedTexts(page));
    }
    expect(undoTrail.at(-1), JSON.stringify(undoTrail)).toEqual([['A', 'B'], ['C', 'D']]);
    expect(undoTrail[0]).toEqual([['A', 'B'], ['C x|new', 'D']]);

    for (let i = 0; i < undoTrail.length; i++) {
      await kbRedo(page);
      expect(await texts(page), `screen after redo ${i + 1}`).toEqual(await savedTexts(page));
    }
    expect(await savedTexts(page)).toEqual([['A', 'B']]);
    await kbUndo(page);
    expect(await savedTexts(page)).toEqual([['A', 'B'], ['C x|new', 'D']]);
    expect(await texts(page)).toEqual([['A', 'B'], ['C x|new', 'D']]);
  });

  test('merge row 0, type in it, split, undo x3, redo x3', async ({ page }) => {
    const a = await page.locator('[data-blok-table-cell-row="0"][data-blok-table-cell-col="0"]').boundingBox();
    const b = await page.locator('[data-blok-table-cell-row="0"][data-blok-table-cell-col="1"]').boundingBox();

    if (a === null || b === null) {
      throw new Error('no cell boxes');
    }
    await page.mouse.move(a.x + a.width * 0.3, a.y + a.height * 0.7);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.6, { steps: 10 });
    await page.mouse.up();
    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeAttached();
    const pb = await pill.boundingBox();

    if (pb === null) {
      throw new Error('no pill box');
    }
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await pill.click();
    await page.getByRole('menuitem', { name: 'Merge cells', exact: true }).click();
    await wait(page, 700);
    expect(await savedTexts(page)).toEqual([['A|B', ''], ['C', 'D']]);

    await page.locator('[data-blok-id="b"] [contenteditable="true"]').click();
    await page.keyboard.press('End');
    await page.keyboard.type('2');
    await wait(page, 700);
    expect(await savedTexts(page)).toEqual([['A|B2', ''], ['C', 'D']]);

    await page.locator('[data-blok-id="b"] [contenteditable="true"]').click();
    await pill.click();
    await page.getByRole('menuitem', { name: 'Split cell', exact: true }).click();
    await wait(page, 700);
    const split = await savedTexts(page);

    await kbUndo(page);
    expect(await savedTexts(page)).toEqual([['A|B2', ''], ['C', 'D']]);
    await kbUndo(page);
    expect(await savedTexts(page)).toEqual([['A|B', ''], ['C', 'D']]);
    await kbUndo(page);
    expect(await savedTexts(page)).toEqual([['A', 'B'], ['C', 'D']]);
    expect(await texts(page)).toEqual([['A', 'B'], ['C', 'D']]);
    await kbRedo(page);
    await kbRedo(page);
    await kbRedo(page);
    expect(await savedTexts(page)).toEqual(split);
  });

  test('delete a cell block, type into its repair, undo x2, redo x2', async ({ page }) => {
    await page.evaluate(async () => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('no blok');
      }
      await blok.blocks.delete(blok.blocks.getBlockIndex('b'), false);
    });
    await wait(page, 700);
    expect(await savedTexts(page)).toEqual([['A', ''], ['C', 'D']]);
    await page.locator('[data-blok-table-cell-row="0"][data-blok-table-cell-col="1"] [contenteditable="true"]').click();
    await page.keyboard.type('R');
    await wait(page, 700);
    expect(await savedTexts(page)).toEqual([['A', 'R'], ['C', 'D']]);

    await kbUndo(page);
    expect(await savedTexts(page)).toEqual([['A', ''], ['C', 'D']]);
    await kbUndo(page);
    expect(await savedTexts(page)).toEqual([['A', 'B'], ['C', 'D']]);
    expect(await canRedo(page)).toBe(true);
    await kbRedo(page);
    await kbRedo(page);
    expect(await savedTexts(page)).toEqual([['A', 'R'], ['C', 'D']]);
  });

  test('delete a cell block, undo, redo deletes it again', async ({ page }) => {
    await page.evaluate(async () => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('no blok');
      }
      await blok.blocks.delete(blok.blocks.getBlockIndex('b'), false);
    });
    await wait(page, 700);
    expect(await savedTexts(page)).toEqual([['A', ''], ['C', 'D']]);

    await kbUndo(page);
    expect(await savedTexts(page)).toEqual([['A', 'B'], ['C', 'D']]);
    expect(await canRedo(page)).toBe(true);
    await kbRedo(page);
    expect(await savedTexts(page)).toEqual([['A', ''], ['C', 'D']]);
  });
});
