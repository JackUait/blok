/**
 * Probes: undo/redo of a nested table row and of a cell repair the user
 * typed into.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { OutputBlockData, OutputData } from '../../../../../types';
import {
  CAPTURE, STD_2X2, STD_TEXTS, TABLE_ID, blockFacts, boot, buildDoc, consistency, gripAction, h,
  redo, savedCellTexts, setup, sleep, teardown, typeInto, undo, yjsDoc,
} from './undo-harness';

const P = (id: string, parent: string, text = id.toUpperCase()): OutputBlockData => ({ id, type: 'paragraph', data: { text }, parent });

const nestedDoc = (): OutputData => ({
  blocks: [
    {
      id: TABLE_ID,
      type: 'table',
      data: { withHeadings: false, content: [[{ blocks: ['a'] }, { blocks: ['b'] }], [{ blocks: ['inner'] }, { blocks: ['d'] }]] },
      content: ['a', 'b', 'inner', 'd'],
    },
    P('a', TABLE_ID),
    P('b', TABLE_ID),
    {
      id: 'inner',
      type: 'table',
      parent: TABLE_ID,
      data: { withHeadings: false, content: [[{ blocks: ['i1'], color: '#ff0000' }, { blocks: ['i2'] }]] },
      content: ['i1', 'i2'],
    },
    P('i1', 'inner'),
    P('i2', 'inner'),
    P('d', TABLE_ID),
  ],
});

const tableTexts = (out: OutputData, tableId: string): string[][] => {
  const texts = new Map(out.blocks.map(b => [b.id ?? '', String((b.data as { text?: string }).text ?? (b.type === 'table' ? `<table:${b.id}>` : ''))]));
  const table = out.blocks.find(b => b.id === tableId);

  return (table?.data as { content: { blocks: string[] }[][] } | undefined)?.content
    .map(row => row.map(cell => cell.blocks.map(id => texts.get(id) ?? `<missing:${id}>`).join('|'))) ?? [];
};

describe('undo probes: nested table, typed repair', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('delete the outer row holding a nested table -> undo -> redo -> undo', async () => {
    const editor = await boot(nestedDoc());
    const before = await editor.save();

    gripAction('row', 1, 'Delete');
    await sleep(CAPTURE);
    expect(tableTexts(await editor.save(), TABLE_ID)).toEqual([['A', 'B']]);
    await undo(editor);
    expect(blockFacts(await editor.save())).toEqual(blockFacts(before));
    await redo(editor);
    await undo(editor);
    const again = await editor.save();

    expect(blockFacts(again)).toEqual(blockFacts(before));
    expect(tableTexts(again, 'inner')).toEqual([['I1', 'I2']]);
    expect(again.blocks.find(b => b.id === 'inner')?.data).toEqual(before.blocks.find(b => b.id === 'inner')?.data);
    expect(blockFacts(await yjsDoc(editor))).toEqual(blockFacts(before));
    expect(h.holder.querySelector('[data-blok-id="inner"]')?.textContent).toContain('I1');
  }, 90_000);

  it('delete a cell\'s only block, type into the repair, undo x2, redo x2', async () => {
    const editor = await boot(buildDoc(STD_2X2, STD_TEXTS));

    await editor.blocks.delete(editor.blocks.getBlockIndex('b'), false);
    await sleep(CAPTURE);
    const afterDelete = await editor.save();
    const repairId = (afterDelete.blocks.find(b => b.id === TABLE_ID)?.data as { content: { blocks: string[] }[][] }).content[0][1].blocks[0];

    expect(repairId).toBeDefined();
    expect(repairId).not.toBe('b');
    await typeInto(repairId, 'R');
    await sleep(CAPTURE);
    const typed = await editor.save();

    expect(savedCellTexts(typed)).toEqual([['A', 'R'], ['C', 'D']]);
    await undo(editor);
    expect(savedCellTexts(await editor.save())).toEqual([['A', ''], ['C', 'D']]);
    await undo(editor);
    expect(savedCellTexts(await editor.save())).toEqual([['A', 'B'], ['C', 'D']]);
    // The defect: undoing the delete writes the table's data as a new tracked
    // step, which drops the redo stack.
    expect(editor.history.canRedo()).toBe(true);
    await redo(editor);
    await redo(editor);
    const redone = await editor.save();

    expect(savedCellTexts(redone)).toEqual([['A', 'R'], ['C', 'D']]);
    const c = await consistency(editor);

    expect(c.yjsTexts).toEqual(c.savedTexts);
  }, 90_000);

  it('delete a cell\'s only block, undo, redo deletes it again', async () => {
    const editor = await boot(buildDoc(STD_2X2, STD_TEXTS));

    await editor.blocks.delete(editor.blocks.getBlockIndex('b'), false);
    await sleep(CAPTURE);
    expect(savedCellTexts(await editor.save())).toEqual([['A', ''], ['C', 'D']]);
    await undo(editor);
    expect(savedCellTexts(await editor.save())).toEqual([['A', 'B'], ['C', 'D']]);
    expect(editor.history.canRedo()).toBe(true);
    await redo(editor);
    expect(savedCellTexts(await editor.save())).toEqual([['A', ''], ['C', 'D']]);
  }, 90_000);
});
