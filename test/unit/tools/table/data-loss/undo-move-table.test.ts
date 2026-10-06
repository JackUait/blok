/**
 * Probes: undo/redo chains around duplicating, cutting and moving a table.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CAPTURE, STD_2X2, STD_TEXTS, TABLE_ID, blockFacts, boot, buildDoc, consistency, h, redo,
  savedCellTexts, setup, sleep, teardown, typeInto, undo,
} from './undo-harness';

describe('undo probes: moving the table', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('move the table below a paragraph, type in a cell, undo x2, redo x2', async () => {
    const doc = buildDoc(STD_2X2, STD_TEXTS);

    doc.blocks.push({ id: 'after', type: 'paragraph', data: { text: 'after' } });
    const editor = await boot(doc);

    editor.blocks.move(editor.blocks.getBlocksCount() - 1, editor.blocks.getBlockIndex(TABLE_ID));
    await sleep(CAPTURE);
    await typeInto('c', 'C typed');
    await sleep(CAPTURE);
    const final = await editor.save();

    await undo(editor);
    await undo(editor);
    const undone = await editor.save();

    expect(savedCellTexts(undone)).toEqual([['A', 'B'], ['C', 'D']]);
    expect(undone.blocks.filter(b => b.parent === undefined || b.parent === null).map(b => b.id)).toEqual([TABLE_ID, 'after']);
    await redo(editor);
    await redo(editor);
    const redone = await editor.save();

    expect(blockFacts(redone)).toEqual(blockFacts(final));
    expect(savedCellTexts(redone)).toEqual([['A', 'B'], ['C typed', 'D']]);
    const c = await consistency(editor);

    expect(c.yjsTexts).toEqual(c.savedTexts);
    expect(h.holder.querySelectorAll('[data-blok-tool="table"]')).toHaveLength(1);
  }, 90_000);
});
