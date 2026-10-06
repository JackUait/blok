import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CAPTURE,
  STD_2X2,
  STD_TEXTS,
  TABLE_ID,
  boot,
  buildDoc,
  contentOf,
  redo,
  savedCellTexts,
  settle,
  setup,
  sleep,
  tableDataOf,
  teardown,
  undo,
} from './undo-harness';
import type { OutputData } from '../../../../../types';

/** Children of the table that no cell names: they float under the grid. */
const orphanChildren = (output: OutputData): string[] => {
  const named = new Set(contentOf(output).flat().flatMap(cell => (typeof cell === 'string' ? [] : cell.blocks ?? [])));

  return output.blocks.filter(b => b.parent === TABLE_ID && !named.has(b.id ?? '')).map(b => b.id ?? '');
};

describe('undo of blocks.update on a table', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('one undo restores the old table data with every cell text, redo re-applies it', async () => {
    const editor = await boot(buildDoc(STD_2X2, STD_TEXTS));

    await editor.blocks.update(TABLE_ID, { withHeadings: true });
    await settle(editor);
    await sleep(CAPTURE);

    await undo(editor);
    const undone = await editor.save();

    expect(tableDataOf(undone)?.withHeadings).toBe(false);
    expect(savedCellTexts(undone)).toEqual([['A', 'B'], ['C', 'D']]);
    expect(orphanChildren(undone)).toEqual([]);

    await redo(editor);
    const redone = await editor.save();

    expect(tableDataOf(redone)?.withHeadings).toBe(true);
    expect(savedCellTexts(redone)).toEqual([['A', 'B'], ['C', 'D']]);
    expect(orphanChildren(redone)).toEqual([]);
  }, 20_000);
});
