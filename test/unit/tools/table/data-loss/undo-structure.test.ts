/**
 * Probes: undo/redo chains of table row/column structure ops.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CAPTURE, STD_2X2, STD_TEXTS, boot, buildDoc, contentOf, domCellTexts, gripAction, redo,
  savedCellTexts, setup, sleep, tableDataOf, teardown, typeInto, undo,
} from './undo-harness';

describe('undo probes: row / column structure', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('delete row -> undo -> redo -> undo brings row 2 text back each time', async () => {
    const editor = await boot(buildDoc(STD_2X2, STD_TEXTS));
    const before = await editor.save();

    gripAction('row', 1, 'Delete');
    await sleep(CAPTURE);
    expect(savedCellTexts(await editor.save())).toEqual([['A', 'B']]);

    await undo(editor);
    expect(savedCellTexts(await editor.save())).toEqual(savedCellTexts(before));
    expect(domCellTexts()).toEqual({ '0,0': 'A', '0,1': 'B', '1,0': 'C', '1,1': 'D' });

    await redo(editor);
    expect(savedCellTexts(await editor.save())).toEqual([['A', 'B']]);

    await undo(editor);
    expect(savedCellTexts(await editor.save())).toEqual(savedCellTexts(before));
    expect(domCellTexts()).toEqual({ '0,0': 'A', '0,1': 'B', '1,0': 'C', '1,1': 'D' });
  }, 90_000);

  it('delete column with colours and pixel widths -> undo restores colours and widths', async () => {
    const content = [
      [{ blocks: ['a'], color: '#ff0000' }, { blocks: ['b'], textColor: '#00ff00' }, { blocks: ['e'] }],
      [{ blocks: ['c'] }, { blocks: ['d'], color: '#0000ff' }, { blocks: ['f'] }],
    ];
    const editor = await boot(buildDoc(content, { ...STD_TEXTS, e: 'E', f: 'F' }, { colWidths: [100, 150, 200] }));
    const before = await editor.save();

    gripAction('col', 1, 'Delete');
    await sleep(CAPTURE);
    expect(savedCellTexts(await editor.save())).toEqual([['A', 'E'], ['C', 'F']]);

    await undo(editor);
    const undone = await editor.save();

    expect(savedCellTexts(undone)).toEqual(savedCellTexts(before));
    expect(contentOf(undone)).toEqual(contentOf(before));
    expect(tableDataOf(undone)?.colWidths).toEqual(tableDataOf(before)?.colWidths);

    await redo(editor);
    await undo(editor);
    const again = await editor.save();

    expect(contentOf(again)).toEqual(contentOf(before));
    expect(tableDataOf(again)?.colWidths).toEqual(tableDataOf(before)?.colWidths);
  }, 90_000);

  it('insert row, type in the new cell, undo x2, redo x2: typed text comes back', async () => {
    const editor = await boot(buildDoc(STD_2X2, STD_TEXTS));

    gripAction('row', 1, 'Insert row below');
    await sleep(CAPTURE);
    const withRow = contentOf(await editor.save());
    const newId = withRow[2][0].blocks?.[0];

    expect(newId).toBeDefined();
    await typeInto(newId ?? '', 'typed');
    await sleep(CAPTURE);
    const typed = await editor.save();

    expect(savedCellTexts(typed)[2][0]).toBe('typed');

    await undo(editor);
    await undo(editor);
    expect(savedCellTexts(await editor.save())).toEqual([['A', 'B'], ['C', 'D']]);

    await redo(editor);
    await redo(editor);
    const redone = await editor.save();

    expect(savedCellTexts(redone)).toEqual(savedCellTexts(typed));
    expect(domCellTexts()['2,0']).toBe('typed');
  }, 90_000);

  it('type in row 2, delete row 2, undo, undo, redo, redo: ends with row deleted and text intact before', async () => {
    const editor = await boot(buildDoc(STD_2X2, STD_TEXTS));

    await typeInto('c', 'C typed');
    await sleep(CAPTURE);
    gripAction('row', 1, 'Delete');
    await sleep(CAPTURE);

    await undo(editor);
    expect(savedCellTexts(await editor.save())).toEqual([['A', 'B'], ['C typed', 'D']]);
    expect(domCellTexts()['1,0']).toBe('C typed');

    await undo(editor);
    expect(savedCellTexts(await editor.save())).toEqual([['A', 'B'], ['C', 'D']]);

    await redo(editor);
    expect(savedCellTexts(await editor.save())).toEqual([['A', 'B'], ['C typed', 'D']]);
    expect(domCellTexts()['1,0']).toBe('C typed');

    await redo(editor);
    expect(savedCellTexts(await editor.save())).toEqual([['A', 'B']]);

    await undo(editor);
    expect(savedCellTexts(await editor.save())).toEqual([['A', 'B'], ['C typed', 'D']]);
    expect(domCellTexts()['1,0']).toBe('C typed');
  }, 90_000);

  it('delete column then delete row, undo both: original grid back', async () => {
    const content = [
      [{ blocks: ['a'] }, { blocks: ['b'] }, { blocks: ['e'] }],
      [{ blocks: ['c'] }, { blocks: ['d'] }, { blocks: ['f'] }],
    ];
    const editor = await boot(buildDoc(content, { ...STD_TEXTS, e: 'E', f: 'F' }));
    const before = await editor.save();

    gripAction('col', 0, 'Delete');
    await sleep(CAPTURE);
    gripAction('row', 0, 'Delete');
    await sleep(CAPTURE);
    expect(savedCellTexts(await editor.save())).toEqual([['D', 'F']]);

    await undo(editor);
    expect(savedCellTexts(await editor.save())).toEqual([['B', 'E'], ['D', 'F']]);
    await undo(editor);
    expect(savedCellTexts(await editor.save())).toEqual(savedCellTexts(before));
    expect(domCellTexts()).toEqual({ '0,0': 'A', '0,1': 'B', '0,2': 'E', '1,0': 'C', '1,1': 'D', '1,2': 'F' });

    await redo(editor);
    await redo(editor);
    expect(savedCellTexts(await editor.save())).toEqual([['D', 'F']]);
    await undo(editor);
    await undo(editor);
    expect(savedCellTexts(await editor.save())).toEqual(savedCellTexts(before));
  }, 90_000);

  it('duplicate row, type in the copy, undo all, redo all', async () => {
    const editor = await boot(buildDoc(STD_2X2, STD_TEXTS));

    gripAction('row', 0, 'Duplicate');
    await sleep(CAPTURE);
    const dup = await editor.save();

    expect(savedCellTexts(dup)).toEqual([['A', 'B'], ['A', 'B'], ['C', 'D']]);
    const copyId = contentOf(dup)[1][0].blocks?.[0] ?? '';

    await typeInto(copyId, 'A copy');
    await sleep(CAPTURE);
    const typed = await editor.save();

    await undo(editor);
    await undo(editor);
    expect(savedCellTexts(await editor.save())).toEqual([['A', 'B'], ['C', 'D']]);
    await redo(editor);
    await redo(editor);
    expect(savedCellTexts(await editor.save())).toEqual(savedCellTexts(typed));
    expect(domCellTexts()['1,0']).toBe('A copy');
  }, 90_000);
});
