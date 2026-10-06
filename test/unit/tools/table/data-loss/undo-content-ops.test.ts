/**
 * Probes: undo/redo of cell-content ops (clear, selection delete, paste) on
 * multi-block cells with lists and a toggle child.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { OutputBlockData } from '../../../../../types';
import {
  CAPTURE, TABLE_ID, blockFacts, boot, consistency, domCellTexts, editableOf, gripAction, pasteHtml,
  redo, reload, savedCellTexts, selectCells, setup, sleep, teardown, undo, yjsDoc,
} from './undo-harness';

const P = (id: string, parent = TABLE_ID): OutputBlockData => ({ id, type: 'paragraph', data: { text: id.toUpperCase() }, parent });

const richDoc = (): { blocks: OutputBlockData[] } => ({
  blocks: [
    {
      id: TABLE_ID,
      type: 'table',
      data: {
        withHeadings: false,
        withHeadingColumn: false,
        content: [
          [{ blocks: ['a1', 'a2'], color: '#ff0000' }, { blocks: ['l1', 'l2'] }],
          [{ blocks: ['t1'] }, { blocks: ['b1'], textColor: '#00ff00' }],
        ],
      },
      content: ['a1', 'a2', 'l1', 'l2', 't1', 'b1'],
    },
    P('a1'),
    P('a2'),
    { id: 'l1', type: 'list', data: { text: 'L1', style: 'unordered' }, parent: TABLE_ID },
    { id: 'l2', type: 'list', data: { text: 'L2', style: 'ordered' }, parent: TABLE_ID },
    { id: 't1', type: 'toggle', data: { text: 'T1', isOpen: true }, parent: TABLE_ID, content: ['tk'] },
    P('tk', 't1'),
    P('b1'),
  ],
});

describe('undo probes: cell content ops', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('grip Clear contents on row 0 -> undo restores every block and colour', async () => {
    const editor = await boot(richDoc());
    const before = await editor.save();

    gripAction('row', 0, 'Clear contents');
    await sleep(CAPTURE);
    const cleared = await editor.save();

    expect(savedCellTexts(cleared)[0]).not.toEqual(savedCellTexts(before)[0]);

    await undo(editor);
    const undone = await editor.save();

    expect(blockFacts(undone)).toEqual(blockFacts(before));
    expect(undone.blocks.find(b => b.id === TABLE_ID)?.data).toEqual(before.blocks.find(b => b.id === TABLE_ID)?.data);

    // No redo half here: in jsdom the redo is lost, but the same chain in a
    // real browser keeps it (data-loss-undo-chains.spec.ts), so it is not
    // evidence of a product defect.
    const c = await consistency(editor);

    expect(c.yjsTexts).toEqual(c.savedTexts);
    expect(blockFacts(await yjsDoc(editor))).toEqual(blockFacts(before));
  }, 90_000);

  it('Delete key on a 2x2 cell selection -> undo -> redo -> undo', async () => {
    const editor = await boot(richDoc());
    const before = await editor.save();

    selectCells([0, 0], [1, 1]);
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Delete' }));
    await sleep(CAPTURE);
    const cleared = await editor.save();

    expect(savedCellTexts(cleared)).not.toEqual(savedCellTexts(before));

    await undo(editor);
    expect(blockFacts(await editor.save())).toEqual(blockFacts(before));
    await redo(editor);
    await undo(editor);
    const again = await editor.save();

    expect(blockFacts(again)).toEqual(blockFacts(before));
    expect(again.blocks.find(b => b.id === TABLE_ID)?.data).toEqual(before.blocks.find(b => b.id === TABLE_ID)?.data);
    expect(blockFacts(await yjsDoc(editor))).toEqual(blockFacts(before));
  }, 90_000);

  it('grip Delete row 0 on rich cells -> undo -> redo -> undo -> reload', async () => {
    const editor = await boot(richDoc());
    const before = await editor.save();

    gripAction('row', 0, 'Delete');
    await sleep(CAPTURE);
    await undo(editor);
    expect(blockFacts(await editor.save())).toEqual(blockFacts(before));
    await redo(editor);
    await undo(editor);
    const again = await editor.save();

    expect(blockFacts(again)).toEqual(blockFacts(before));
    expect(again.blocks.find(b => b.id === TABLE_ID)?.data).toEqual(before.blocks.find(b => b.id === TABLE_ID)?.data);
    expect(blockFacts(await yjsDoc(editor))).toEqual(blockFacts(before));
    const { saved } = await reload(editor);

    expect(blockFacts(saved)).toEqual(blockFacts(before));
  }, 90_000);

  it('paste a 2x2 HTML table over cells -> undo -> redo -> undo', async () => {
    const editor = await boot(richDoc());
    const before = await editor.save();

    pasteHtml(editableOf('a1'), '<table><tr><td>X1</td><td>X2</td></tr><tr><td>X3</td><td>X4</td></tr></table>');
    await sleep(CAPTURE);
    const pasted = await editor.save();

    expect(savedCellTexts(pasted)).not.toEqual(savedCellTexts(before));

    await undo(editor);
    expect(blockFacts(await editor.save())).toEqual(blockFacts(before));
    await redo(editor);
    expect(savedCellTexts(await editor.save())).toEqual(savedCellTexts(pasted));
    await undo(editor);
    const again = await editor.save();

    expect(blockFacts(again)).toEqual(blockFacts(before));
    expect(again.blocks.find(b => b.id === TABLE_ID)?.data).toEqual(before.blocks.find(b => b.id === TABLE_ID)?.data);
    expect(blockFacts(await yjsDoc(editor))).toEqual(blockFacts(before));
  }, 90_000);

  it('delete the whole table -> undo -> redo -> undo keeps every cell block and colour', async () => {
    const editor = await boot(richDoc());
    const before = await editor.save();

    await editor.blocks.delete(editor.blocks.getBlockIndex(TABLE_ID));
    await sleep(CAPTURE);
    expect((await editor.save()).blocks.find(b => b.id === TABLE_ID)).toBeUndefined();

    await undo(editor);
    expect(blockFacts(await editor.save())).toEqual(blockFacts(before));
    await redo(editor);
    await undo(editor);
    const again = await editor.save();

    expect(blockFacts(again)).toEqual(blockFacts(before));
    expect(again.blocks.find(b => b.id === TABLE_ID)?.data).toEqual(before.blocks.find(b => b.id === TABLE_ID)?.data);
    expect(domCellTexts()['0,0']).toBe('A1|A2');
    expect(blockFacts(await yjsDoc(editor))).toEqual(blockFacts(before));
  }, 90_000);
});
