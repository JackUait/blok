/**
 * Probes: undo/redo replays that make the table mint or convert cell blocks
 * inside a Yjs sync window (empty cells, legacy string cells, read-only
 * toggles), checked against the Yjs doc and a reload.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CAPTURE, STD_2X2, STD_TEXTS, boot, buildDoc, consistency, domCellTexts, gripAction, redo, reload,
  savedCellTexts, setup, sleep, teardown, typeInto, undo, yjsIds,
} from './undo-harness';

describe('undo probes: replays inside the sync window', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('control: delete row -> undo keeps Yjs equal to save and mints no ids', async () => {
    const editor = await boot(buildDoc(STD_2X2, STD_TEXTS));
    const idsBefore = await yjsIds(editor);

    gripAction('row', 1, 'Delete');
    await sleep(CAPTURE);
    await undo(editor);
    const c = await consistency(editor);

    expect(c.yjsTexts).toEqual(c.savedTexts);
    expect(c.savedTexts).toEqual([['A', 'B'], ['C', 'D']]);
    expect(c.yjsIds).toEqual(idsBefore);
    await redo(editor);
    await undo(editor);
    const c2 = await consistency(editor);

    expect(c2.yjsTexts).toEqual(c2.savedTexts);
    expect(c2.yjsIds).toEqual(idsBefore);
  }, 90_000);

  it('table with an empty cell: delete row -> undo -> redo -> undo stays consistent, redo available', async () => {
    const content = [
      [{ blocks: ['a'] }, { blocks: [] }],
      [{ blocks: ['c'] }, { blocks: ['d'] }],
    ];
    const editor = await boot(buildDoc(content, { a: 'A', c: 'C', d: 'D' }));
    const first = await consistency(editor);

    expect(first.yjsTexts).toEqual(first.savedTexts);

    gripAction('row', 1, 'Delete');
    await sleep(CAPTURE);
    await undo(editor);
    expect(editor.history.canRedo()).toBe(true);
    const c = await consistency(editor);

    expect(c.yjsTexts).toEqual(c.savedTexts);
    expect(c.savedTexts).toEqual(first.savedTexts);
    expect(c.yjsIds).toEqual(first.yjsIds);

    await redo(editor);
    const r = await consistency(editor);

    expect(r.savedTexts).toEqual([first.savedTexts[0]]);
    expect(r.yjsTexts).toEqual(r.savedTexts);

    await undo(editor);
    const c2 = await consistency(editor);

    expect(c2.savedTexts).toEqual(first.savedTexts);
    expect(c2.yjsTexts).toEqual(c2.savedTexts);
    expect(c2.yjsIds).toEqual(first.yjsIds);
  }, 90_000);

  it('legacy string-cell table: delete row -> undo -> redo -> undo, then reload', async () => {
    const editor = await boot(buildDoc([['A', 'B'], ['C', 'D']], {}));
    const first = await consistency(editor);

    expect(first.savedTexts).toEqual([['A', 'B'], ['C', 'D']]);
    expect(first.yjsTexts).toEqual(first.savedTexts);

    gripAction('row', 1, 'Delete');
    await sleep(CAPTURE);
    await undo(editor);
    const c = await consistency(editor);

    expect(c.savedTexts).toEqual([['A', 'B'], ['C', 'D']]);
    expect(c.yjsTexts).toEqual(c.savedTexts);
    expect(c.yjsIds).toEqual(first.yjsIds);

    await redo(editor);
    await undo(editor);
    const c2 = await consistency(editor);

    expect(c2.savedTexts).toEqual([['A', 'B'], ['C', 'D']]);
    expect(c2.yjsTexts).toEqual(c2.savedTexts);

    const { saved } = await reload(editor);

    expect(savedCellTexts(saved)).toEqual([['A', 'B'], ['C', 'D']]);
    expect(domCellTexts()).toEqual({ '0,0': 'A', '0,1': 'B', '1,0': 'C', '1,1': 'D' });
  }, 90_000);

  it('legacy string-cell table: type in a cell, undo, redo', async () => {
    const editor = await boot(buildDoc([['A', 'B'], ['C', 'D']], {}));
    const first = await editor.save();
    const cellId = (first.blocks.find(b => b.id === 'tbl')?.data as { content: { blocks: string[] }[][] }).content[1][0].blocks[0];

    await typeInto(cellId, 'C typed');
    await sleep(CAPTURE);
    await undo(editor);
    const c = await consistency(editor);

    expect(c.savedTexts).toEqual([['A', 'B'], ['C', 'D']]);
    expect(c.yjsTexts).toEqual(c.savedTexts);
    await redo(editor);
    const r = await consistency(editor);

    expect(r.savedTexts).toEqual([['A', 'B'], ['C typed', 'D']]);
    expect(r.yjsTexts).toEqual(r.savedTexts);
  }, 90_000);

  it('read-only round trip mid-history: delete row, toggle read-only, undo, redo, undo', async () => {
    const editor = await boot(buildDoc(STD_2X2, STD_TEXTS));
    const first = await consistency(editor);

    gripAction('row', 1, 'Delete');
    await sleep(CAPTURE);
    await editor.readOnly.set(true);
    await sleep(100);
    await editor.readOnly.set(false);
    await sleep(CAPTURE);

    await undo(editor);
    const c = await consistency(editor);

    expect(c.savedTexts).toEqual([['A', 'B'], ['C', 'D']]);
    expect(c.yjsTexts).toEqual(c.savedTexts);
    expect(domCellTexts()).toEqual({ '0,0': 'A', '0,1': 'B', '1,0': 'C', '1,1': 'D' });

    await redo(editor);
    await undo(editor);
    const c2 = await consistency(editor);

    expect(c2.savedTexts).toEqual([['A', 'B'], ['C', 'D']]);
    expect(c2.yjsTexts).toEqual(c2.savedTexts);
    expect(c2.yjsIds).toEqual(first.yjsIds);
  }, 90_000);

  it('legacy string table, read-only round trip right after boot, then delete row and undo', async () => {
    const editor = await boot(buildDoc([['A', 'B'], ['C', 'D']], {}));

    await editor.readOnly.set(true);
    await sleep(100);
    await editor.readOnly.set(false);
    await sleep(CAPTURE);
    const first = await consistency(editor);

    expect(first.yjsTexts).toEqual(first.savedTexts);

    gripAction('row', 0, 'Delete');
    await sleep(CAPTURE);
    await undo(editor);
    const c = await consistency(editor);

    expect(c.savedTexts).toEqual([['A', 'B'], ['C', 'D']]);
    expect(c.yjsTexts).toEqual(c.savedTexts);
    expect(c.yjsIds).toEqual(first.yjsIds);
  }, 90_000);

  it('rapid undo/undo then redo/redo with no wait over delete-col + delete-row', async () => {
    const content = [
      [{ blocks: ['a', 'a2'] }, { blocks: ['b'] }, { blocks: ['e'] }],
      [{ blocks: ['c'] }, { blocks: ['d'] }, { blocks: ['f', 'f2'] }],
    ];
    const editor = await boot(buildDoc(content, { ...STD_TEXTS, a2: 'A2', e: 'E', f: 'F', f2: 'F2' }));
    const first = await consistency(editor);

    gripAction('col', 1, 'Delete');
    await sleep(CAPTURE);
    gripAction('row', 0, 'Delete');
    await sleep(CAPTURE);
    const afterOps = await consistency(editor);

    editor.history.undo();
    editor.history.undo();
    await sleep(400);
    const c = await consistency(editor);

    expect(c.savedTexts).toEqual(first.savedTexts);
    expect(c.yjsTexts).toEqual(c.savedTexts);
    expect(c.yjsIds).toEqual(first.yjsIds);

    editor.history.redo();
    editor.history.redo();
    await sleep(400);
    const r = await consistency(editor);

    expect(r.savedTexts).toEqual(afterOps.savedTexts);
    expect(r.yjsTexts).toEqual(r.savedTexts);
  }, 90_000);
});
