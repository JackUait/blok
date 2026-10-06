/**
 * Probes: multi-step undo/redo chains that mix table ops.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LegacyCellContent } from '../../../../../src/tools/table/types';
import type { OutputData } from '../../../../../types';
import {
  CAPTURE, STD_2X2, STD_TEXTS, TABLE_ID, blockFacts, boot, buildDoc, consistency, contentOf, domCellTexts, editableOf,
  gripAction, pasteHtml, redo, savedCellTexts, selectionAction, setup, sleep, tableDataOf, teardown, toggleHeaderRow,
  typeInto, undo, yjsDoc,
} from './undo-harness';

const tableData = async (editor: { save: () => Promise<OutputData> }): Promise<unknown> =>
  (await editor.save()).blocks.find(b => b.id === TABLE_ID)?.data;

describe('undo probes: mixed chains', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('paste a 3x3 table into a 2x2 (grows) -> undo -> redo -> undo', async () => {
    const editor = await boot(buildDoc(STD_2X2, STD_TEXTS));
    const before = await editor.save();

    pasteHtml(editableOf('a'), '<table><tr><td>1</td><td>2</td><td>3</td></tr><tr><td>4</td><td>5</td><td>6</td></tr><tr><td>7</td><td>8</td><td>9</td></tr></table>');
    await sleep(CAPTURE);
    const pasted = await editor.save();

    expect(savedCellTexts(pasted)).toEqual([['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']]);
    await undo(editor);
    expect(savedCellTexts(await editor.save())).toEqual(savedCellTexts(before));
    expect(blockFacts(await editor.save())).toEqual(blockFacts(before));
    await redo(editor);
    expect(savedCellTexts(await editor.save())).toEqual(savedCellTexts(pasted));
    await undo(editor);
    const again = await editor.save();

    expect(blockFacts(again)).toEqual(blockFacts(before));
    expect(contentOf(again)).toEqual(contentOf(before));
    expect(blockFacts(await yjsDoc(editor))).toEqual(blockFacts(before));
  }, 90_000);

  it('header row on, delete row 0, undo x2, redo x2, undo x2', async () => {
    const editor = await boot(buildDoc(STD_2X2, STD_TEXTS));
    const before = await tableData(editor);

    toggleHeaderRow();
    await sleep(CAPTURE);
    expect(tableDataOf(await editor.save())?.withHeadings).toBe(true);
    const headed = await tableData(editor);

    gripAction('row', 0, 'Delete');
    await sleep(CAPTURE);
    const deleted = await tableData(editor);

    await undo(editor);
    expect(await tableData(editor)).toEqual(headed);
    await undo(editor);
    expect(await tableData(editor)).toEqual(before);
    await redo(editor);
    expect(await tableData(editor)).toEqual(headed);
    await redo(editor);
    expect(await tableData(editor)).toEqual(deleted);
    await undo(editor);
    await undo(editor);
    expect(await tableData(editor)).toEqual(before);
    expect(domCellTexts()).toEqual({ '0,0': 'A', '0,1': 'B', '1,0': 'C', '1,1': 'D' });
  }, 90_000);

  it('merge row 0, delete column 1 (through the merge), undo x2, redo x2, undo x2', async () => {
    const editor = await boot(buildDoc(STD_2X2, STD_TEXTS));
    const before = await editor.save();

    selectionAction([0, 0], [0, 1], 'Merge cells');
    await sleep(CAPTURE);
    const merged = await editor.save();

    document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    document.body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
    await sleep(50);
    gripAction('col', 1, 'Delete');
    await sleep(CAPTURE);
    const deleted = await editor.save();

    await undo(editor);
    expect(contentOf(await editor.save())).toEqual(contentOf(merged));
    expect(blockFacts(await editor.save())).toEqual(blockFacts(merged));
    await undo(editor);
    expect(contentOf(await editor.save())).toEqual(contentOf(before));
    expect(blockFacts(await editor.save())).toEqual(blockFacts(before));
    await redo(editor);
    await redo(editor);
    expect(contentOf(await editor.save())).toEqual(contentOf(deleted));
    expect(blockFacts(await editor.save())).toEqual(blockFacts(deleted));
    await undo(editor);
    await undo(editor);
    const again = await editor.save();

    expect(contentOf(again)).toEqual(contentOf(before));
    expect(blockFacts(again)).toEqual(blockFacts(before));
    expect(domCellTexts()).toEqual({ '0,0': 'A', '0,1': 'B', '1,0': 'C', '1,1': 'D' });
    expect(blockFacts(await yjsDoc(editor))).toEqual(blockFacts(before));
  }, 90_000);

  it('insert column, type in it, delete it, undo x3, redo x3', async () => {
    const editor = await boot(buildDoc(STD_2X2, STD_TEXTS));
    const before = await editor.save();

    gripAction('col', 1, 'Insert column right');
    await sleep(CAPTURE);
    const newId = contentOf(await editor.save())[0][2].blocks?.[0] ?? '';

    await typeInto(newId, 'NEW');
    await sleep(CAPTURE);
    const typed = await editor.save();

    gripAction('col', 2, 'Delete');
    await sleep(CAPTURE);
    const deleted = await editor.save();

    await undo(editor);
    expect(savedCellTexts(await editor.save())).toEqual(savedCellTexts(typed));
    await undo(editor);
    await undo(editor);
    expect(savedCellTexts(await editor.save())).toEqual(savedCellTexts(before));
    await redo(editor);
    await redo(editor);
    expect(savedCellTexts(await editor.save())).toEqual(savedCellTexts(typed));
    expect(domCellTexts()['0,2']).toBe('NEW');
    await redo(editor);
    expect(savedCellTexts(await editor.save())).toEqual(savedCellTexts(deleted));
    await undo(editor);
    expect(savedCellTexts(await editor.save())).toEqual(savedCellTexts(typed));
    const c = await consistency(editor);

    expect(c.yjsTexts).toEqual(c.savedTexts);
  }, 90_000);

  it('delete a row holding a merge origin and colours, undo -> redo -> undo', async () => {
    const content: LegacyCellContent[][] = [
      [{ blocks: ['a', 'c'], rowspan: 2, color: '#ff0000' }, { blocks: ['b'], textColor: '#00ff00' }],
      [{ blocks: [], mergedInto: [0, 0] }, { blocks: ['d'], placement: 'bottom-right' }],
    ];
    const editor = await boot(buildDoc(content, STD_TEXTS));
    const before = await editor.save();

    gripAction('row', 0, 'Delete');
    await sleep(CAPTURE);
    await undo(editor);
    expect(contentOf(await editor.save())).toEqual(contentOf(before));
    expect(blockFacts(await editor.save())).toEqual(blockFacts(before));
    await redo(editor);
    await undo(editor);
    const again = await editor.save();

    expect(contentOf(again)).toEqual(contentOf(before));
    expect(blockFacts(again)).toEqual(blockFacts(before));
    expect(blockFacts(await yjsDoc(editor))).toEqual(blockFacts(before));
  }, 90_000);

  it('type in several cells as separate steps, undo all, redo all', async () => {
    const editor = await boot(buildDoc(STD_2X2, STD_TEXTS));

    await typeInto('a', 'A1');
    await sleep(CAPTURE);
    await typeInto('d', 'D1');
    await sleep(CAPTURE);
    gripAction('row', 0, 'Insert row above');
    await sleep(CAPTURE);
    await typeInto('b', 'B1');
    await sleep(CAPTURE);
    const final = await editor.save();

    for (let i = 0; i < 4; i++) {
      await undo(editor);
    }
    expect(savedCellTexts(await editor.save())).toEqual([['A', 'B'], ['C', 'D']]);
    for (let i = 0; i < 4; i++) {
      await redo(editor);
    }
    const redone = await editor.save();

    expect(savedCellTexts(redone)).toEqual(savedCellTexts(final));
    expect(blockFacts(redone)).toEqual(blockFacts(final));
  }, 90_000);
});
