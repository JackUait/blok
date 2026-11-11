import type { Page } from '@playwright/test';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import type { Canon, CanonCell, Clip, SavedBlock } from './table-helpers';
import {
  box,
  canonDoc,
  canonRegion,
  canonTable,
  cellOf,
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
  plainOnly,
  plainTable,
  rectangleSelectBlock,
  richTable,
  saveRaw,
  selectCellRange,
  selectedIds,
  tableLocator,
  tableShape,
  tables,
} from './table-helpers';

/** A one-cell paste at a caret in a filled cell keeps that cell's blocks and adds the copy after them. */
const afterCaretPaste = (target: CanonCell[][], source: CanonCell[][]): Canon[] => [...(target[0][0].blocks ?? []), ...(source[0][0].blocks ?? [])];

test.describe('table round trips', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  /* ---------------------- whole table block (x-blok) --------------------- */

  const wholeTableCase = async (
    page: Page,
    targetBlocks: SavedBlock[],
    targetId: string,
    expectedParent: string | undefined,
    degrade: (clip: Clip) => Clip,
    mode: 'copy' | 'cut' = 'copy',
  ): Promise<{ clip: Clip; before: Canon; after: SavedBlock[] }> => {
    await createEditor(page, [para('lead', 'lead'), ...richTable('t1'), ...targetBlocks]);
    const beforeSaved = await saveRaw(page);
    const before = canonTable(beforeSaved, tables(beforeSaved)[0]);

    await rectangleSelectBlock(page, 't1');
    expect(await selectedIds(page)).toContain('t1');
    const clip = await fireClipboard(page, mode);

    await focusEditable(page.locator(`[data-blok-id="${targetId}"]`));
    await firePaste(page, degrade(clip));
    const after = await saveRaw(page);
    const pasted = tables(after).find(t => t.id !== 't1' || mode === 'cut');

    expect(pasted, 'a pasted table exists').toBeTruthy();
    if (pasted) {
      expect(pasted.parent, 'pasted table parent').toBe(expectedParent);
    }

    return { clip, before, after };
  };

  test('W1 whole table x-blok → top-level empty paragraph', async ({ page }) => {
    const { before, after } = await wholeTableCase(page, [para('tgt', '')], 'tgt', undefined, c => c);
    const pasted = tables(after).find(t => t.id !== 't1');

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(pasted && canonTable(after, pasted)).toEqual(before);
    // The empty target paragraph should be replaced, not left as a stray block.
    expect(after.filter(b => b.parent === undefined).map(b => b.type)).toEqual(['paragraph', 'table', 'table']);
  });

  test('W2 whole table x-blok → empty paragraph inside a toggle', async ({ page }) => {
    const { before, after } = await wholeTableCase(page, [
      { id: 'tg', type: 'toggle', data: { text: 'Toggle', isOpen: true }, content: ['tgt'] },
      para('tgt', '', 'tg'),
    ], 'tgt', 'tg', c => c);
    const pasted = tables(after).find(t => t.id !== 't1');

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(pasted && canonTable(after, pasted)).toEqual(before);
  });

  test('W3 whole table x-blok → empty paragraph inside a column', async ({ page }) => {
    const { before, after } = await wholeTableCase(page, [
      { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['tgt'] },
      para('tgt', '', 'c1'),
      { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['p2'] },
      para('p2', 'right', 'c2'),
    ], 'tgt', 'c1', c => c);
    const pasted = tables(after).find(t => t.id !== 't1');

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(pasted && canonTable(after, pasted)).toEqual(before);
  });

  test('W4 whole table x-blok → empty paragraph inside a callout', async ({ page }) => {
    const { before, after } = await wholeTableCase(page, [
      { id: 'co', type: 'callout', data: { emoji: '💡' }, content: ['co1', 'tgt'] },
      para('co1', 'callout line', 'co'),
      para('tgt', '', 'co'),
    ], 'tgt', 'co', c => c);
    const pasted = tables(after).find(t => t.id !== 't1');

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(pasted && canonTable(after, pasted)).toEqual(before);
  });

  test('W5 whole table cut (x-blok) → paste back at top level', async ({ page }) => {
    const { before, after } = await wholeTableCase(page, [para('tgt', '')], 'tgt', undefined, c => c, 'cut');

    expect(tables(after)).toHaveLength(1);
    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(canonTable(after, tables(after)[0])).toEqual(before);
  });

  test('W6 whole table degraded html+plain → top level', async ({ page }) => {
    test.fixme(true, 'table-W6-whole-degraded-html: the cell image caption comes back as alt, and the var() colour tokens come back as hex');
    const { before, after } = await wholeTableCase(page, [para('tgt', '')], 'tgt', undefined, htmlAndPlain);
    const pasted = tables(after).find(t => t.id !== 't1');

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(pasted && tableShape(pasted)).toEqual({ rows: 3, cols: [3, 3, 3] });
    expect.soft(pasted && canonTable(after, pasted)).toEqual(before);
  });

  test('W7 whole table degraded plain only → top level', async ({ page }) => {
    await createEditor(page, [para('lead', 'lead'), ...richTable('t1'), para('tgt', '')]);
    await rectangleSelectBlock(page, 't1');
    expect(await selectedIds(page)).toContain('t1');
    const clip = await fireClipboard(page, 'copy');

    const beforeCount = (await saveRaw(page)).length;

    await focusEditable(page.locator('[data-blok-id="tgt"]'));
    await firePaste(page, plainOnly(clip));
    const after = await saveRaw(page);

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect(after.length).toBeGreaterThan(beforeCount - 1);
    // Plain text has no table: the best the format allows is the table back from its Markdown.
    expect(tables(after).length).toBe(2);
  });

  test('W8 whole table x-blok → caret inside another table cell', async ({ page }) => {
    await createEditor(page, [para('lead', 'lead'), ...richTable('t1'), plainTable('t2', 2, 2)]);
    await rectangleSelectBlock(page, 't1');
    expect(await selectedIds(page)).toContain('t1');
    const clip = await fireClipboard(page, 'copy');
    const beforeT2 = canonTable(await saveRaw(page), (await saveRaw(page)).find(b => b.id === 't2') as SavedBlock);

    await focusCell(page, 't2', 0, 0);
    await firePaste(page, clip);
    const after = await saveRaw(page);

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    // No block lost: every source cell text must land somewhere.
    const text = JSON.stringify(after);

    for (const word of ['H1', 'H2', 'H3', 'one', 'nested', 'done', 'bold', 'merged', 'red']) {
      expect(text, `text ${word} survives`).toContain(word);
    }
    expect(beforeT2).toBeTruthy();
  });

  test('W9 table inside a toggle (source nested) x-blok → top level', async ({ page }) => {
    await createEditor(page, [
      { id: 'tg', type: 'toggle', data: { text: 'Toggle', isOpen: true }, content: ['t1'] },
      ...richTable('t1', 'tg'),
      para('tgt', ''),
    ]);
    const beforeSaved = await saveRaw(page);
    const before = canonTable(beforeSaved, tables(beforeSaved)[0]);

    // Select just the nested table via its block menu toggler.
    const t = await box(tableLocator(page, 't1'), 'nested table');

    await page.mouse.move(t.x + 5, t.y + 5);
    const toggler = page.getByTestId('settings-toggler');

    await toggler.click();
    const clip = await fireClipboard(page, 'copy');

    await page.keyboard.press('Escape');
    await focusEditable(page.locator('[data-blok-id="tgt"]'));
    await firePaste(page, clip);
    const after = await saveRaw(page);
    const pasted = tables(after).find(b => b.id !== 't1');

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect(pasted?.parent).toBeUndefined();
    expect.soft(pasted && canonTable(after, pasted)).toEqual(before);
  });

  test('W10 table among other blocks (Cmd+A all) x-blok → top level keeps order', async ({ page }) => {
    await createEditor(page, [para('a', 'alpha'), ...richTable('t1'), para('b', 'beta')]);
    const beforeSaved = await saveRaw(page);
    const beforeDoc = canonDoc(beforeSaved);

    await page.getByText('alpha').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+a');
    const clip = await fireClipboard(page, 'copy');

    await page.getByText('beta').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await firePaste(page, clip);
    const after = await saveRaw(page);
    const afterDoc = canonDoc(after);

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    // Pasted copy follows the originals: alpha, table, beta, alpha, table, beta (modulo stray empty paragraph).
    const nonEmpty = afterDoc.filter(b => JSON.stringify(b.data) !== '{"text":[]}' && JSON.stringify(b.data) !== '{"text":""}');

    expect(nonEmpty).toEqual([...beforeDoc, ...beforeDoc]);
  });

  test('W11 whole table copy via real keyboard (Cmd+C / Cmd+V) → top level', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await createEditor(page, [para('lead', 'lead'), ...richTable('t1'), para('tgt', '')]);
    const beforeSaved = await saveRaw(page);
    const before = canonTable(beforeSaved, tables(beforeSaved)[0]);

    await rectangleSelectBlock(page, 't1');
    expect(await selectedIds(page)).toContain('t1');
    await page.keyboard.press('ControlOrMeta+c');
    await focusEditable(page.locator('[data-blok-id="tgt"]'));
    await page.keyboard.press('ControlOrMeta+v');
    // eslint-disable-next-line playwright/no-wait-for-timeout -- paste and save settle with no event to wait on
    await page.waitForTimeout(800);
    const after = await saveRaw(page);
    const pasted = tables(after).find(b => b.id !== 't1');

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(pasted && canonTable(after, pasted)).toEqual(before);
  });

  test('W12 Cmd+A x3 inside a cell (selects every cell block) → copy → paste top level', async ({ page }) => {
    await createEditor(page, [...richTable('t1'), para('tgt', '')]);
    await focusCell(page, 't1', 0, 0);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+a');
    const clip = await fireClipboard(page, 'copy');

    await page.mouse.click(3, 3);
    await focusEditable(page.locator('[data-blok-id="tgt"]'));
    await firePaste(page, clip);
    const after = await saveRaw(page);

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    const text = JSON.stringify(canonDoc(after).slice(1));

    for (const word of ['H1', 'H2', 'H3', 'one', 'nested', 'done', 'bold', 'merged', 'red']) {
      expect(text, `text ${word} survives`).toContain(word);
    }
  });

  /* ------------------------- cell range (in-table) ------------------------ */

  const rangeIntoTable = async (
    page: Page,
    r0: number, c0: number, r1: number, c1: number,
    degrade: (clip: Clip) => Clip,
    mode: 'copy' | 'cut' = 'copy',
  ): Promise<{ before: CanonCell[][]; target: CanonCell[][]; after: SavedBlock[]; clip: Clip }> => {
    await createEditor(page, [...richTable('t1'), plainTable('t2', 4, 4, 'z')]);
    const beforeSaved = await saveRaw(page);
    const before = canonRegion(beforeSaved, tables(beforeSaved)[0], r0, c0, r1, c1);
    const target = canonRegion(beforeSaved, tables(beforeSaved)[1], 0, 0, 0, 0);

    await selectCellRange(page, 't1', r0, c0, r1, c1);
    const clip = await fireClipboard(page, mode);

    await focusCell(page, 't2', 0, 0);
    await firePaste(page, degrade(clip));
    const after = await saveRaw(page);

    return { before, target, after, clip };
  };

  test('R1 copy full rich range (3x3) → paste into another table at (0,0)', async ({ page }) => {
    const { before, after } = await rangeIntoTable(page, 0, 0, 2, 2, c => c);
    const t2 = after.find(b => b.id === 't2') as SavedBlock;

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(tableShape(t2)).toEqual({ rows: 4, cols: [4, 4, 4, 4] });
    expect.soft(canonRegion(after, t2, 0, 0, 2, 2)).toEqual(before);
  });

  test('R2 copy list cell + marks cell (1x2) → paste into another table', async ({ page }) => {
    const { before, after } = await rangeIntoTable(page, 1, 0, 1, 1, c => c);
    const t2 = after.find(b => b.id === 't2') as SavedBlock;

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(canonRegion(after, t2, 0, 0, 0, 1)).toEqual(before);
  });

  test('R3 copy merged cell (rowspan 2) alone → paste into another table', async ({ page }) => {
    const { before, after } = await rangeIntoTable(page, 1, 2, 2, 2, c => c);
    const t2 = after.find(b => b.id === 't2') as SavedBlock;

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(canonRegion(after, t2, 0, 0, 1, 0)).toEqual(before);
  });

  test('R4 copy image cell (1x1) → paste into another table cell', async ({ page }) => {
    const { before, target, after } = await rangeIntoTable(page, 2, 1, 2, 1, c => c);
    const t2 = after.find(b => b.id === 't2') as SavedBlock;

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(canonRegion(after, t2, 0, 0, 0, 0)[0][0].blocks).toEqual(afterCaretPaste(target, before));
  });

  test('R5 copy list cell (1x1, structured) → paste into another table cell', async ({ page }) => {
    const { before, target, after } = await rangeIntoTable(page, 1, 0, 1, 0, c => c);
    const t2 = after.find(b => b.id === 't2') as SavedBlock;

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(canonRegion(after, t2, 0, 0, 0, 0)[0][0].blocks).toEqual(afterCaretPaste(target, before));
  });

  test('R6 copy marks cell (1x1 text) → paste into another cell inline (replaces z00? appends at caret)', async ({ page }) => {
    const { after } = await rangeIntoTable(page, 1, 1, 1, 1, c => c);
    const t2 = after.find(b => b.id === 't2') as SavedBlock;
    const region = canonRegion(after, t2, 0, 0, 0, 0);

    expect.soft(integrityProblems(after)).toEqual([]);
    // Inline insert at caret (end of "z00"): marks must survive.
    const json = JSON.stringify(region);

    expect(json).toContain('bold');
    expect(json).toContain('"bold":true');
    expect(json).toContain('"italic":true');
    expect(json).toContain('https://example.com/');
    expect(json).toContain('yellow');
  });

  test('R7 cut rich range (2x2 incl. list + colours) → paste into another table', async ({ page }) => {
    const { before, after } = await rangeIntoTable(page, 1, 0, 2, 1, c => c, 'cut');
    const t2 = after.find(b => b.id === 't2') as SavedBlock;

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(canonRegion(after, t2, 0, 0, 1, 1)).toEqual(before);
  });

  test('R8 range degraded: html without data-blok-table-cells (app re-serialised) → paste into another table', async ({ page }) => {
    test.fixme(true, 'table-R8-range-degraded-html: the cell image caption comes back as alt, and the var() colour tokens come back as hex');
    const { before, after } = await rangeIntoTable(page, 0, 0, 2, 2, htmlWithoutBlokAttr);
    const t2 = after.find(b => b.id === 't2') as SavedBlock;

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(tableShape(t2)).toEqual({ rows: 4, cols: [4, 4, 4, 4] });
    expect.soft(canonRegion(after, t2, 0, 0, 2, 2)).toEqual(before);
  });

  test('R9 range degraded: plain text only (TSV) → paste into another table', async ({ page }) => {
    const { after } = await rangeIntoTable(page, 0, 0, 2, 2, plainOnly);
    const t2 = after.find(b => b.id === 't2') as SavedBlock;

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(tableShape(t2)).toEqual({ rows: 4, cols: [4, 4, 4, 4] });
    // Text of every cell must land in the matching cell.
    const region = JSON.stringify(canonRegion(after, t2, 0, 0, 2, 2));

    for (const word of ['H1', 'H2', 'H3', 'one', 'nested', 'done', 'bold', 'merged', 'red']) {
      expect(region, `text ${word}`).toContain(word);
    }
  });

  test('R10 copy 2x2 range → paste into same table over another range (overlapping merge)', async ({ page }) => {
    await createEditor(page, richTable('t1'));
    const beforeSaved = await saveRaw(page);
    const source = canonRegion(beforeSaved, tables(beforeSaved)[0], 0, 0, 1, 1);

    await selectCellRange(page, 't1', 0, 0, 1, 1);
    const clip = await fireClipboard(page, 'copy');

    await focusCell(page, 't1', 1, 1);
    await firePaste(page, clip);
    const after = await saveRaw(page);
    const t1 = tables(after)[0];

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(canonRegion(after, t1, 1, 1, 2, 2)).toEqual(source);
    expect.soft(tableShape(t1)).toEqual({ rows: 3, cols: [3, 3, 3] });
  });

  test('R11 copy range then paste with a target cell RANGE selected (pastes at its top-left)', async ({ page }) => {
    await createEditor(page, [...richTable('t1'), plainTable('t2', 4, 4, 'z')]);
    const beforeSaved = await saveRaw(page);
    const source = canonRegion(beforeSaved, tables(beforeSaved)[0], 1, 0, 2, 1);

    await selectCellRange(page, 't1', 1, 0, 2, 1);
    const clip = await fireClipboard(page, 'copy');

    await selectCellRange(page, 't2', 1, 1, 2, 2);
    await firePaste(page, clip);
    const after = await saveRaw(page);
    const t2 = after.find(b => b.id === 't2') as SavedBlock;

    expect.soft(integrityProblems(after)).toEqual([]);
    expect(tables(after)).toHaveLength(2);
    expect.soft(canonRegion(after, t2, 1, 1, 2, 2)).toEqual(source);
  });

  test('R12 copy range via the selection pill Copy button → paste into another table', async ({ page }) => {
    await createEditor(page, [...richTable('t1'), plainTable('t2', 4, 4, 'z')]);
    await page.evaluate(() => {
      const w = window as unknown as { __pillClip?: Record<string, string> };

      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          write: async (items: ClipboardItem[]): Promise<void> => {
            const out: Record<string, string> = {};

            for (const item of items) {
              for (const t of item.types) {
                out[t] = await (await item.getType(t)).text();
              }
            }
            w.__pillClip = out;
          },
          writeText: async (): Promise<void> => undefined,
          readText: async (): Promise<string> => '',
        },
      });
    });
    const beforeSaved = await saveRaw(page);
    const source = canonRegion(beforeSaved, tables(beforeSaved)[0], 1, 0, 2, 1);

    await selectCellRange(page, 't1', 1, 0, 2, 1);
    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeAttached();
    const pb = await box(pill, 'pill');

    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    // eslint-disable-next-line playwright/no-wait-for-timeout -- paste and save settle with no event to wait on
    await page.waitForTimeout(200);
    await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await page.getByText('Copy', { exact: true }).click();
    // eslint-disable-next-line playwright/no-wait-for-timeout -- paste and save settle with no event to wait on
    await page.waitForTimeout(300);
    const clip = await page.evaluate(() => (window as unknown as { __pillClip?: Record<string, string> }).__pillClip ?? {});

    await page.keyboard.press('Escape');
    await focusCell(page, 't2', 0, 0);
    await firePaste(page, clip);
    const after = await saveRaw(page);
    const t2 = after.find(b => b.id === 't2') as SavedBlock;

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(canonRegion(after, t2, 0, 0, 1, 1)).toEqual(source);
  });

  test('R13 copy range from a heading-column table → paste into another table keeps text', async ({ page }) => {
    await createEditor(page, [
      plainTable('t1', 3, 3, 'h', { withHeadingColumn: true, withHeadings: true }),
      plainTable('t2', 3, 3, 'z'),
    ]);
    const beforeSaved = await saveRaw(page);
    const source = canonRegion(beforeSaved, tables(beforeSaved)[0], 0, 0, 1, 1);

    await selectCellRange(page, 't1', 0, 0, 1, 1);
    const clip = await fireClipboard(page, 'copy');

    await focusCell(page, 't2', 1, 1);
    await firePaste(page, clip);
    const after = await saveRaw(page);
    const t2 = after.find(b => b.id === 't2') as SavedBlock;

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(canonRegion(after, t2, 1, 1, 2, 2)).toEqual(source);
  });

  test('R14 nested list with marks in a cell, 1x1 copy → paste inline into a cell keeps list structure', async ({ page }) => {
    await createEditor(page, [
      {
        id: 't1', type: 'table',
        data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['a', 'b', 'c'] }, { blocks: ['d'] }]] },
        content: ['a', 'b', 'c', 'd'],
      },
      { id: 'a', type: 'list', data: { text: '<b>top</b>', style: 'ordered' }, parent: 't1' },
      { id: 'b', type: 'list', data: { text: 'child <a href="https://e.com/">l</a>', style: 'ordered', depth: 1 }, parent: 't1' },
      { id: 'c', type: 'list', data: { text: 'grand', style: 'ordered', depth: 2 }, parent: 't1' },
      para('d', 'target', 't1'),
    ]);
    const beforeSaved = await saveRaw(page);
    const source = canonRegion(beforeSaved, tables(beforeSaved)[0], 0, 0, 0, 0);
    const target = canonRegion(beforeSaved, tables(beforeSaved)[0], 0, 1, 0, 1);

    await selectCellRange(page, 't1', 0, 0, 0, 0);
    const clip = await fireClipboard(page, 'copy');

    await focusCell(page, 't1', 0, 1);
    await firePaste(page, clip);
    const after = await saveRaw(page);

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(canonRegion(after, tables(after)[0], 0, 1, 0, 1)[0][0].blocks).toEqual(afterCaretPaste(target, source));
  });

  /* ---------------------- cell range → outside table ---------------------- */

  const rangeOutside = async (
    page: Page,
    r0: number, c0: number, r1: number, c1: number,
    targetBlocks: SavedBlock[],
    targetId: string,
    degrade: (clip: Clip) => Clip,
  ): Promise<{ before: CanonCell[][]; after: SavedBlock[]; clip: Clip; pasted: SavedBlock | undefined }> => {
    await createEditor(page, [...richTable('t1'), ...targetBlocks]);
    const beforeSaved = await saveRaw(page);
    const before = canonRegion(beforeSaved, tables(beforeSaved)[0], r0, c0, r1, c1);

    await selectCellRange(page, 't1', r0, c0, r1, c1);
    const clip = await fireClipboard(page, 'copy');

    await page.mouse.click(3, 3);
    await focusEditable(page.locator(`[data-blok-id="${targetId}"]`));
    await firePaste(page, degrade(clip));
    const after = await saveRaw(page);
    const pasted = tables(after).find(b => b.id !== 't1');

    return { before, after, clip, pasted };
  };

  test('O1 rich range 3x3 → top-level empty paragraph makes an equal table', async ({ page }) => {
    const { before, after, pasted } = await rangeOutside(page, 0, 0, 2, 2, [para('tgt', '')], 'tgt', c => c);

    expect(pasted).toBeTruthy();
    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    if (pasted) {
      // eslint-disable-next-line playwright/no-conditional-expect -- runs only once the hard check above found the pasted table
      expect.soft(canonRegion(after, pasted, 0, 0, 2, 2)).toEqual(before);
      // eslint-disable-next-line playwright/no-conditional-expect -- runs only once the hard check above found the pasted table
      expect((pasted.data).withHeadings).toBe(true);
      // eslint-disable-next-line playwright/no-conditional-expect -- runs only once the hard check above found the pasted table
      expect(after.filter(b => !b.parent).map(b => b.type)).toEqual(['table', 'table']);
    }
  });

  test('O2 whole-table-sized range → outside keeps column widths', async ({ page }) => {
    const { pasted, clip } = await rangeOutside(page, 0, 0, 2, 2, [para('tgt', '')], 'tgt', c => c);
    const payloadJson = /data-blok-table-cells='([^']*)'/.exec(clip['text/html'] ?? '')?.[1]?.replace(/&#39;/g, "'");

    expect(Object.keys(clip).sort()).toEqual(['text/html', 'text/plain']);
    expect(payloadJson).toBeTruthy();
    expect.soft(Object.keys(JSON.parse(payloadJson ?? '{}') as Record<string, unknown>).sort()).toEqual(['cells', 'colWidths', 'cols', 'rows', 'withHeadings']);
    expect(pasted).toBeTruthy();
    expect((pasted?.data)?.colWidths).toEqual([140, 220, 180]);
  });

  test('O3 range → empty paragraph inside a toggle', async ({ page }) => {
    const { before, after, pasted } = await rangeOutside(page, 1, 0, 2, 2, [
      { id: 'tg', type: 'toggle', data: { text: 'Toggle', isOpen: true }, content: ['tgt'] },
      para('tgt', '', 'tg'),
    ], 'tgt', c => c);

    expect(pasted?.parent).toBe('tg');
    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(pasted && canonRegion(after, pasted, 0, 0, 1, 2)).toEqual(before);
  });

  test('O4 range → empty paragraph inside a column', async ({ page }) => {
    const { before, after, pasted } = await rangeOutside(page, 1, 0, 2, 2, [
      { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['tgt'] },
      para('tgt', '', 'c1'),
      { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['p2'] },
      para('p2', 'right', 'c2'),
    ], 'tgt', c => c);

    expect(pasted?.parent).toBe('c1');
    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(pasted && canonRegion(after, pasted, 0, 0, 1, 2)).toEqual(before);
  });

  test('O5 range → empty paragraph inside a callout', async ({ page }) => {
    const { before, after, pasted } = await rangeOutside(page, 1, 0, 2, 2, [
      { id: 'co', type: 'callout', data: { emoji: '💡' }, content: ['co1', 'tgt'] },
      para('co1', 'callout line', 'co'),
      para('tgt', '', 'co'),
    ], 'tgt', c => c);

    expect(pasted?.parent).toBe('co');
    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(pasted && canonRegion(after, pasted, 0, 0, 1, 2)).toEqual(before);
  });

  test('O6 range → non-empty top-level paragraph (caret at end) inserts table after it', async ({ page }) => {
    const { before, after, pasted } = await rangeOutside(page, 1, 0, 2, 1, [para('tgt', 'keep me')], 'tgt', c => c);

    expect.soft(integrityProblems(after)).toEqual([]);
    expect(JSON.stringify(after)).toContain('keep me');
    expect.soft(pasted && canonRegion(after, pasted, 0, 0, 1, 1)).toEqual(before);
  });

  test('O7 range degraded html (data attr stripped) → top level', async ({ page }) => {
    test.fixme(true, 'table-O7-range-outside-degraded-html: the cell image caption comes back as alt, and the var() colour tokens come back as hex');
    const { before, after, pasted } = await rangeOutside(page, 0, 0, 2, 2, [para('tgt', '')], 'tgt', htmlWithoutBlokAttr);

    expect(pasted).toBeTruthy();
    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    if (pasted) {
      // eslint-disable-next-line playwright/no-conditional-expect -- runs only once the hard check above found the pasted table
      expect.soft(tableShape(pasted)).toEqual({ rows: 3, cols: [3, 3, 3] });
      // eslint-disable-next-line playwright/no-conditional-expect -- runs only once the hard check above found the pasted table
      expect.soft(canonRegion(after, pasted, 0, 0, 2, 2)).toEqual(before);
    }
  });

  test('O8 range degraded html+plain (attr kept, no x-blok — identical to Blok flavours) → top level', async ({ page }) => {
    const { before, after, pasted } = await rangeOutside(page, 0, 0, 2, 2, [para('tgt', '')], 'tgt', htmlAndPlain);

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(pasted && canonRegion(after, pasted, 0, 0, 2, 2)).toEqual(before);
  });

  test('O9 range degraded plain only (TSV) → top level', async ({ page }) => {
    test.fixme(true, 'table-O9-range-outside-plain-tsv: plain TSV pasted outside a table lands as paragraphs');
    const { after, pasted } = await rangeOutside(page, 0, 0, 2, 2, [para('tgt', '')], 'tgt', plainOnly);

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect(pasted, 'TSV grid comes back as a table').toBeTruthy();
    if (pasted) {
      // eslint-disable-next-line playwright/no-conditional-expect -- runs only once the hard check above found the pasted table
      expect.soft(tableShape(pasted)).toEqual({ rows: 3, cols: [3, 3, 3] });
    }
  });

  test('O9b rows 0-1 range (selection grows to the rowspan footprint) plain only (TSV) → top level, offer toast check', async ({ page }) => {
    test.fixme(true, 'table-O9-range-outside-plain-tsv: plain TSV pasted outside a table lands as paragraphs');
    const { pasted } = await rangeOutside(page, 0, 0, 1, 2, [para('tgt', '')], 'tgt', plainOnly);
    // eslint-disable-next-line playwright/no-wait-for-timeout -- paste and save settle with no event to wait on
    await page.waitForTimeout(500);

    expect(pasted, 'TSV grid comes back as a table').toBeTruthy();
  });

  test('O10 range with merged cell (rowspan) only → outside keeps merge', async ({ page }) => {
    const { before, after, pasted } = await rangeOutside(page, 1, 1, 2, 2, [para('tgt', '')], 'tgt', c => c);

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect.soft(pasted && canonRegion(after, pasted, 0, 0, 1, 1)).toEqual(before);
  });

  test('O11 single cell (1x1 text) → outside a table', async ({ page }) => {
    const { after } = await rangeOutside(page, 1, 1, 1, 1, [para('tgt', '')], 'tgt', c => c);

    expect.soft(integrityProblems(after)).toEqual([]);
    expect(JSON.stringify(canonDoc(after).slice(1))).toContain('"bold":true');
  });

  /* --------------------- native text selection inside a cell --------------------- */

  test('N1 native text selection in one cell (real Cmd+C/Cmd+V) → another cell', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await createEditor(page, richTable('t1'));
    await focusCell(page, 't1', 1, 1);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+c');

    await focusCell(page, 't1', 0, 0);
    await page.keyboard.press('ControlOrMeta+v');
    // eslint-disable-next-line playwright/no-wait-for-timeout -- paste and save settle with no event to wait on
    await page.waitForTimeout(700);
    const after = await saveRaw(page);
    const region = canonRegion(after, tables(after)[0], 0, 0, 0, 0);

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect(tables(after)).toHaveLength(1);
    const json = JSON.stringify(region);

    expect(json).toContain('"bold":true');
    expect(json).toContain('https://example.com/');
  });

  test('N2 native text selection of list items in one cell (real Cmd+C/Cmd+V) → another cell', async ({ page }) => {
    test.fixme(true, 'table-N2-native-cross-block-in-cell: the pasted nested list item is saved under its list parent but its holder sits in the table');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await createEditor(page, richTable('t1'));
    // Drag a text selection across the three list items in cell (1,0).
    const one = await box(cellOf(page, 't1', 1, 0).getByText('one', { exact: true }), 'one');
    const done = await box(cellOf(page, 't1', 1, 0).getByText('done', { exact: true }), 'done');

    await page.mouse.move(one.x + 1, one.y + one.height / 2);
    await page.mouse.down();
    await page.mouse.move(done.x + done.width - 1, done.y + done.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.press('ControlOrMeta+c');

    await page.mouse.click(3, 3);
    await focusCell(page, 't1', 0, 1);
    await page.keyboard.press('ControlOrMeta+v');
    // eslint-disable-next-line playwright/no-wait-for-timeout -- paste and save settle with no event to wait on
    await page.waitForTimeout(700);
    const after = await saveRaw(page);

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(await layoutProblems(page)).toEqual([]);
    expect(tables(after)).toHaveLength(1);
    const json = JSON.stringify(canonRegion(after, tables(after)[0], 0, 1, 0, 1));

    expect(json).toContain('"type":"list"');
  });

  test('K1 cell range via real keyboard Cmd+C/Cmd+V (Chromium clipboard) → another table', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await createEditor(page, [...richTable('t1'), plainTable('t2', 4, 4, 'z')]);
    const beforeSaved = await saveRaw(page);
    const source = canonRegion(beforeSaved, tables(beforeSaved)[0], 0, 0, 2, 2);

    await selectCellRange(page, 't1', 0, 0, 2, 2);
    await page.keyboard.press('ControlOrMeta+c');
    await focusCell(page, 't2', 0, 0);
    await page.keyboard.press('ControlOrMeta+v');
    // eslint-disable-next-line playwright/no-wait-for-timeout -- paste and save settle with no event to wait on
    await page.waitForTimeout(800);
    const after = await saveRaw(page);
    const t2 = after.find(b => b.id === 't2') as SavedBlock;

    expect.soft(integrityProblems(after)).toEqual([]);
    expect.soft(canonRegion(after, t2, 0, 0, 2, 2)).toEqual(source);
  });

  test('N3 native copy of plain text from a COLOURED cell (real Cmd+C/Cmd+V) → plain cell gets no highlight', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await createEditor(page, [{
      id: 't1', type: 'table',
      data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['a'], color: 'var(--blok-color-blue-bg)' }, { blocks: ['b'] }]] },
      content: ['a', 'b'],
    }, para('a', 'plain words', 't1'), para('b', 'x', 't1')]);
    await focusCell(page, 't1', 0, 0);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+c');

    await focusCell(page, 't1', 0, 1);
    await page.keyboard.press('ControlOrMeta+v');
    // eslint-disable-next-line playwright/no-wait-for-timeout -- paste and save settle with no event to wait on
    await page.waitForTimeout(700);
    const after = await saveRaw(page);
    const region = canonRegion(after, tables(after)[0], 0, 1, 0, 1);

    expect(JSON.stringify(region)).not.toContain('background');
  });

  test('V1 verify: pasted list items get depth rewritten by List.moved() neighbour rule', async ({ page }) => {
    await createEditor(page, [...richTable('t1'), plainTable('t2', 2, 2, 'z')]);
    await page.evaluate(() => {
      const w = window as unknown as { __moved: Array<{ text: string; before: unknown; after: unknown }>; Blok: Record<string, unknown> };
      const List = w.Blok.List as { prototype: Record<string, unknown> } | undefined;

      w.__moved = [];
      if (!List) {
        w.__moved.push({ text: 'NO LIST EXPORT', before: null, after: null });

        return;
      }
      const original = List.prototype.moved as (this: { _data: { depth?: number; text?: unknown } }, e: unknown) => void;

      List.prototype.moved = function (this: { _data: { depth?: number; text?: unknown }; _element?: HTMLElement }, e: unknown): void {
        const before = this._data.depth;

        original.call(this, e);
        w.__moved.push({ text: this._element?.textContent ?? '', before, after: this._data.depth });
      };
    });
    await selectCellRange(page, 't1', 1, 0, 1, 0);
    const clip = await fireClipboard(page, 'copy');

    await focusCell(page, 't2', 0, 0);
    await firePaste(page, clip);
    const moved = await page.evaluate(() => (window as unknown as { __moved: unknown[] }).__moved);

    expect(moved.length).toBeGreaterThan(0);
  });
});
