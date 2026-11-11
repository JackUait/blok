/* eslint-disable playwright/expect-expect -- some tests assert inside shared helpers */
import type { Page } from '@playwright/test';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { blocksAsHtml } from '../helpers/saved-as-html';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import type { Clip, SavedBlock } from './table-helpers';
import {
  canonDoc,
  canonRegion,
  canonTable,
  createEditor,
  fireClipboard,
  firePaste,
  focusCell,
  focusEditable,
  htmlAndPlain,
  htmlWithoutBlokAttr,
  integrityProblems,
  layoutProblems,
  
  para,
  plainTable,
  rectangleSelectBlock,
  saveRaw,
  selectCellRange,
  selectedIds,
  tableShape,
  tables,
} from './table-helpers';

/**
 * 3x3 with a horizontal merge (0,0)-(0,1), a toggle with a child paragraph in
 * (1,0) and a code block in (1,1).
 */
const mixedTable = (id: string): SavedBlock[] => [
  {
    id,
    type: 'table',
    data: {
      withHeadings: false,
      withHeadingColumn: false,
      colWidths: [160, 200, 180],
      content: [
        [{ blocks: [`${id}a`], colspan: 2, color: 'var(--blok-color-green-bg)' }, { blocks: [], mergedInto: [0, 0] }, { blocks: [`${id}b`] }],
        [{ blocks: [`${id}tg`] }, { blocks: [`${id}cd`] }, { blocks: [`${id}c`] }],
        [{ blocks: [`${id}d`] }, { blocks: [`${id}e`] }, { blocks: [`${id}f`] }],
      ],
    },
    content: [`${id}a`, `${id}b`, `${id}tg`, `${id}cd`, `${id}c`, `${id}d`, `${id}e`, `${id}f`],
  },
  para(`${id}a`, 'wide', id),
  para(`${id}b`, 'B', id),
  { id: `${id}tg`, type: 'toggle', data: { text: 'tog', isOpen: true }, parent: id, content: [`${id}tc`] },
  para(`${id}tc`, 'toggle child', `${id}tg`),
  { id: `${id}cd`, type: 'code', data: { code: 'let x = 1;\n  x++', language: 'javascript' }, parent: id },
  para(`${id}c`, 'C', id),
  para(`${id}d`, 'D', id),
  para(`${id}e`, 'E', id),
  para(`${id}f`, 'F', id),
];

const words = ['wide', 'tog', 'toggle child', 'let x = 1', 'B', 'C', 'D', 'E', 'F'];

const expectAllWords = (json: string, expected: string[] = words): void => {
  for (const w of expected) {
    expect.soft(json, `text "${w}" survives`).toContain(w);
  }
};

test.describe('table round trips: colspan, nested cell blocks, discriminators', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  const wholeMixed = async (page: Page, degrade: (c: Clip) => Clip): Promise<void> => {
    await createEditor(page, [para('lead', 'lead'), ...mixedTable('t1'), para('tgt', '')]);
    const beforeSaved = await saveRaw(page);
    const before = canonTable(beforeSaved, tables(beforeSaved)[0]);

    await rectangleSelectBlock(page, 't1');
    expect(await selectedIds(page)).toContain('t1');
    const clip = await fireClipboard(page, 'copy');

    await focusEditable(page.locator('[data-blok-id="tgt"]'));
    await firePaste(page, degrade(clip));
    await expect.poll(async () => tables(await saveRaw(page)).length).toBe(2);
    const after = await saveRaw(page);
    const pasted = tables(after).find(t => t.id !== 't1') as SavedBlock;

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(tableShape(pasted)).toEqual({ rows: 3, cols: [3, 3, 3] });
    expectAllWords(JSON.stringify(canonTable(after, pasted)));
    expect.soft(canonTable(after, pasted)).toEqual(before);
  };

  test('C1 whole table with colspan + toggle-in-cell + code-in-cell (x-blok) → top level', async ({ page }) => {
    await wholeMixed(page, c => c);
  });

  test('C2 same whole table degraded html+plain → top level', async ({ page }) => {
    test.fixme(true, 'table-C2-whole-degraded-html-mixed: cell html carries no toggle or code language, and the var() colour token comes back as hex');
    await wholeMixed(page, htmlAndPlain);
  });

  test('C3 range 2x3 (colspan, toggle, code) → paste into another table', async ({ page }) => {
    await createEditor(page, [...mixedTable('t1'), plainTable('t2', 4, 4, 'z')]);
    const beforeSaved = await saveRaw(page);
    const source = canonRegion(beforeSaved, tables(beforeSaved)[0], 0, 0, 1, 2);

    await selectCellRange(page, 't1', 0, 0, 1, 2);
    const clip = await fireClipboard(page, 'copy');

    await focusCell(page, 't2', 0, 0);
    await firePaste(page, clip);
    const after = await saveRaw(page);
    const t2 = after.find(b => b.id === 't2') as SavedBlock;

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(tableShape(t2)).toEqual({ rows: 4, cols: [4, 4, 4, 4] });
    expect.soft(canonRegion(after, t2, 0, 0, 1, 2)).toEqual(source);
  });

  test('C4 range 2x3 (colspan, toggle, code) → outside (top-level empty paragraph)', async ({ page }) => {
    await createEditor(page, [...mixedTable('t1'), para('tgt', '')]);
    const beforeSaved = await saveRaw(page);
    const source = canonRegion(beforeSaved, tables(beforeSaved)[0], 0, 0, 1, 2);

    await selectCellRange(page, 't1', 0, 0, 1, 2);
    const clip = await fireClipboard(page, 'copy');

    await page.mouse.click(3, 3);
    await focusEditable(page.locator('[data-blok-id="tgt"]'));
    await firePaste(page, clip);
    await expect.poll(async () => tables(await saveRaw(page)).length).toBe(2);
    const after = await saveRaw(page);
    const pasted = tables(after).find(t => t.id !== 't1') as SavedBlock;

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(tableShape(pasted)).toEqual({ rows: 2, cols: [3, 3] });
    expect.soft(canonRegion(after, pasted, 0, 0, 1, 2)).toEqual(source);
  });

  test('C5 range 2x3 degraded html (data attr stripped) → outside', async ({ page }) => {
    test.fixme(true, 'table-C5-range-colspan-degraded-html: cell html carries no toggle or code language, and the var() colour token comes back as hex');
    await createEditor(page, [...mixedTable('t1'), para('tgt', '')]);
    const beforeSaved = await saveRaw(page);
    const source = canonRegion(beforeSaved, tables(beforeSaved)[0], 0, 0, 1, 2);

    await selectCellRange(page, 't1', 0, 0, 1, 2);
    const clip = await fireClipboard(page, 'copy');

    await page.mouse.click(3, 3);
    await focusEditable(page.locator('[data-blok-id="tgt"]'));
    await firePaste(page, htmlWithoutBlokAttr(clip));
    await expect.poll(async () => tables(await saveRaw(page)).length).toBe(2);
    const after = await saveRaw(page);
    const pasted = tables(after).find(t => t.id !== 't1') as SavedBlock;

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(tableShape(pasted)).toEqual({ rows: 2, cols: [3, 3] });
    expectAllWords(JSON.stringify(canonRegion(after, pasted, 0, 0, 1, 2)), ['wide', 'tog', 'toggle child', 'let x = 1', 'B', 'C']);
    expect.soft(canonRegion(after, pasted, 0, 0, 1, 2)).toEqual(source);
  });

  test('C6 cut range 2x2 → paste outside; source keeps its shape', async ({ page }) => {
    await createEditor(page, [...mixedTable('t1'), para('tgt', '')]);
    const beforeSaved = await saveRaw(page);
    const source = canonRegion(beforeSaved, tables(beforeSaved)[0], 1, 0, 2, 1);

    await selectCellRange(page, 't1', 1, 0, 2, 1);
    const clip = await fireClipboard(page, 'cut');

    await page.mouse.click(3, 3);
    await focusEditable(page.locator('[data-blok-id="tgt"]'));
    await firePaste(page, clip);
    await expect.poll(async () => tables(await saveRaw(page)).length).toBe(2);
    const after = await saveRaw(page);
    const t1 = after.find(b => b.id === 't1') as SavedBlock;
    const pasted = tables(after).find(t => t.id !== 't1') as SavedBlock;

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(tableShape(t1)).toEqual({ rows: 3, cols: [3, 3, 3] });
    expect.soft(canonRegion(after, pasted, 0, 0, 1, 1)).toEqual(source);
  });

  test('W8b whole table x-blok with caret in another table cell: t2 untouched, pasted table placed after t2 at top level', async ({ page }) => {
    await createEditor(page, [para('lead', 'lead'), ...mixedTable('t1'), plainTable('t2', 2, 2, 'z')]);
    const beforeSaved = await saveRaw(page);
    const t1Before = canonTable(beforeSaved, tables(beforeSaved)[0]);
    const t2Before = canonTable(beforeSaved, beforeSaved.find(b => b.id === 't2') as SavedBlock);

    await rectangleSelectBlock(page, 't1');
    expect(await selectedIds(page)).toContain('t1');
    const clip = await fireClipboard(page, 'copy');

    await focusCell(page, 't2', 0, 0);
    await firePaste(page, clip);
    await expect.poll(async () => tables(await saveRaw(page)).length).toBe(3);
    const after = await saveRaw(page);
    const top = after.filter(b => b.parent === undefined).map(b => b.id === 't1' || b.id === 't2' || b.id === 'lead' ? b.id : b.type);

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(canonTable(after, after.find(b => b.id === 't2') as SavedBlock)).toEqual(t2Before);
    const pasted = tables(after).find(b => b.id !== 't1' && b.id !== 't2') as SavedBlock;

    expect.soft(pasted.parent).toBeUndefined();
    expect.soft(canonTable(after, pasted)).toEqual(t1Before);
    expect.soft(top.indexOf('t2')).toBeLessThan(top.lastIndexOf('table'));
  });

  test('P1 1x1 structured cell paste (list) overwrites target text; 1x1 text paste inserts at caret', async ({ page }) => {
    await createEditor(page, [{
      id: 't1', type: 'table',
      data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['l'] }, { blocks: ['p'] }], [{ blocks: ['q'] }, { blocks: ['r'] }]] },
      content: ['l', 'p', 'q', 'r'],
    },
    { id: 'l', type: 'list', data: { text: 'item', style: 'unordered' }, parent: 't1' },
    para('p', 'plain', 't1'),
    para('q', 'keepA', 't1'),
    para('r', 'keepB', 't1')]);
    await selectCellRange(page, 't1', 0, 0, 0, 0);
    const listClip = await fireClipboard(page, 'copy');

    await focusCell(page, 't1', 1, 0);
    await firePaste(page, listClip);
    await selectCellRange(page, 't1', 0, 1, 0, 1);
    const textClip = await fireClipboard(page, 'copy');

    await focusCell(page, 't1', 1, 1);
    await firePaste(page, textClip);
    const after = await saveRaw(page);
    const row1 = canonRegion(after, tables(after)[0], 1, 0, 1, 1);

    expect.soft(integrityProblems(after)).toEqual([]);
    const listCell = JSON.stringify(row1[0][0]);
    const textCell = JSON.stringify(row1[0][1]);

    // Both 1x1 pastes into a cell with text should treat the existing text the same way.
    expect.soft(textCell.includes('keepB'), 'text 1x1 keeps target text').toBe(true);
    expect.soft(listCell.includes('keepA'), `structured 1x1 keeps target text like the text path; row1=${JSON.stringify(row1)}`).toBe(true);
  });

  test('D1 discriminator: top-level list (one / nested d1 / done checklist d0) Cmd+A copy → paste keeps depths', async ({ page }) => {
    await createEditor(page, [
      { id: 'l1', type: 'list', data: { text: 'one', style: 'unordered' } },
      { id: 'l2', type: 'list', data: { text: 'nested', style: 'unordered', depth: 1 } },
      { id: 'l3', type: 'list', data: { text: 'done', style: 'checklist', checked: true } },
      para('end', 'end'),
    ]);
    const before = canonDoc(await saveRaw(page)).slice(0, 3);

    await page.getByText('one', { exact: true }).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    const clip = await fireClipboard(page, 'copy');

    await page.getByText('end', { exact: true }).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await firePaste(page, clip);
    const afterDoc = canonDoc(await saveRaw(page));
    const pasted = afterDoc.filter(b => b.type === 'list').slice(3);

    expect.soft(pasted).toEqual(before);
  });

  test('D2 discriminator: same three list items in ONE cell, cell copied to another table → depths', async ({ page }) => {
    await createEditor(page, [{
      id: 't1', type: 'table',
      data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['l1', 'l2', 'l3'] }]] },
      content: ['l1', 'l2', 'l3'],
    },
    { id: 'l1', type: 'list', data: { text: 'one', style: 'unordered' }, parent: 't1' },
    { id: 'l2', type: 'list', data: { text: 'nested', style: 'unordered', depth: 1 }, parent: 't1' },
    { id: 'l3', type: 'list', data: { text: 'done', style: 'unordered' }, parent: 't1' },
    plainTable('t2', 1, 1, 'z')]);
    const beforeSaved = await saveRaw(page);
    const source = canonRegion(beforeSaved, tables(beforeSaved)[0], 0, 0, 0, 0);
    const target = canonRegion(beforeSaved, tables(beforeSaved)[1], 0, 0, 0, 0);

    await selectCellRange(page, 't1', 0, 0, 0, 0);
    const clip = await fireClipboard(page, 'copy');

    await focusCell(page, 't2', 0, 0);
    await firePaste(page, clip);
    const after = await saveRaw(page);
    // A one-cell paste at a caret in a filled cell keeps that cell's blocks and adds the copy after them.
    const pastedCell = canonRegion(after, after.find(b => b.id === 't2') as SavedBlock, 0, 0, 0, 0)[0][0].blocks;

    expect.soft(pastedCell).toEqual([...(target[0][0].blocks ?? []), ...(source[0][0].blocks ?? [])]);
  });
});

test.describe('blocks pasted at a caret inside a cell paragraph', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  const doc = (): SavedBlock[] => [
    {
      id: 't1', type: 'table',
      data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['c'] }, { blocks: ['b'] }]] },
      content: ['c', 'b'],
    },
    para('c', 'HelloWorld', 't1'),
    para('b', 'B', 't1'),
    para('z', 'Zulu'),
  ];
  const payload = (blocks: Array<{ id: string; tool: string; data: Record<string, unknown> }>): string =>
    JSON.stringify(blocks.map(b => ({ parentId: null, contentIds: [], tunes: {}, ...b })));
  const flavors: Record<string, Clip> = {
    'a Blok block copy': {
      'application/x-blok': payload([{ id: 'pa', tool: 'paragraph', data: { text: 'First' } }, { id: 'pb', tool: 'paragraph', data: { text: 'Second' } }]),
      'text/html': '<p>First</p><p>Second</p>',
      'text/plain': 'First\n\nSecond',
    },
    'html only': { 'text/html': '<p>First</p><p>Second</p>', 'text/plain': 'First\n\nSecond' },
  };

  const caretInCell = async (page: Page, offset: number): Promise<void> => {
    const editable = page.locator('[data-blok-id="c"] [contenteditable="true"]');

    await editable.click();
    await editable.evaluate((el, at) => {
      const text = el.firstChild;
      const selection = window.getSelection();

      if (!text || !selection) {
        throw new Error('no text node to place the caret in');
      }
      selection.collapse(text, at);
    }, offset);
  };

  /** The first cell's blocks as `id:text`, with new ids shown as `new`. */
  const firstCell = async (page: Page): Promise<string[]> => {
    const saved = blocksAsHtml(await saveRaw(page));
    const table = saved.find(b => b.id === 't1');
    const ids = (table?.data as { content: Array<Array<{ blocks: string[] }>> }).content[0][0].blocks;

    return ids.map((id) => {
      const block = saved.find(b => b.id === id);

      return `${id === 'c' ? 'c' : 'new'}:${String((block?.data as { text?: unknown } | undefined)?.text)}`;
    });
  };
  const roots = async (page: Page): Promise<string[]> => (await saveRaw(page)).filter(b => b.parent === undefined).map(b => b.id ?? '');

  for (const [flavor, clip] of Object.entries(flavors)) {
    test(`${flavor} splits the cell paragraph at the caret`, async ({ page }) => {
      await createEditor(page, doc());
      await caretInCell(page, 5);
      await firePaste(page, clip);

      await expect.poll(() => firstCell(page)).toEqual(['c:HelloFirst', 'new:SecondWorld']);
      expect(await roots(page)).toEqual(['t1', 'z']);
    });

    test(`${flavor} split in a cell undoes in one step`, async ({ page }) => {
      await createEditor(page, doc());
      await caretInCell(page, 5);
      await firePaste(page, clip);
      await expect.poll(() => firstCell(page)).toEqual(['c:HelloFirst', 'new:SecondWorld']);

      await page.keyboard.press('ControlOrMeta+z');

      await expect.poll(() => firstCell(page)).toEqual(['c:HelloWorld']);
    });
  }

  test('a Blok block copy holding a header leaves the cell whole and lands after the table', async ({ page }) => {
    await createEditor(page, doc());
    await caretInCell(page, 5);
    await firePaste(page, {
      'application/x-blok': payload([{ id: 'pa', tool: 'paragraph', data: { text: 'First' } }, { id: 'ph', tool: 'header', data: { text: 'Second', level: 2 } }]),
      'text/plain': 'First\n\n## Second',
    });

    await expect.poll(async () => blocksAsHtml(await saveRaw(page)).filter(b => b.parent === undefined).map(b => `${b.type}:${String((b.data as { text?: unknown }).text)}`))
      .toEqual(['table:undefined', 'paragraph:First', 'header:Second', 'paragraph:Zulu']);
    expect(await firstCell(page)).toEqual(['c:HelloWorld']);
  });
});
