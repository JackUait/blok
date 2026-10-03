/**
 * Probes: undo/redo storms over mixed table history, and read-only toggles
 * that land inside the typing window.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CAPTURE, STD_2X2, STD_TEXTS, blockFacts, boot, buildDoc, consistency, contentOf, domCellTexts, gripAction,
  redo, savedCellTexts, selectionAction, setup, sleep, teardown, typeInto, undo, yjsDoc, yjsIds,
} from './undo-harness';

const closeMenus = async (): Promise<void> => {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  document.body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
  await sleep(50);
};

describe('undo probes: storms and read-only', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('storm: 4 ops, then undo/redo with no waits, repeated, converges with no new ids', async () => {
    const editor = await boot(buildDoc(STD_2X2, STD_TEXTS));
    const before = await editor.save();
    const idsBefore = await yjsIds(editor);

    await typeInto('a', 'A1');
    await sleep(CAPTURE);
    gripAction('col', 1, 'Insert column right');
    await sleep(CAPTURE);
    await closeMenus();
    selectionAction([0, 0], [1, 0], 'Merge cells');
    await sleep(CAPTURE);
    await closeMenus();
    gripAction('row', 1, 'Insert row below');
    await sleep(CAPTURE);
    const final = await editor.save();
    const finalIds = await yjsIds(editor);

    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 4; i++) {
        editor.history.undo();
      }
      await sleep(50);
      for (let i = 0; i < 4; i++) {
        editor.history.redo();
      }
      await sleep(50);
    }
    await sleep(600);
    const redone = await editor.save();

    expect(contentOf(redone)).toEqual(contentOf(final));
    expect(blockFacts(redone)).toEqual(blockFacts(final));
    expect(await yjsIds(editor)).toEqual(finalIds);

    for (let i = 0; i < 4; i++) {
      await undo(editor, 200);
    }
    const undone = await editor.save();

    expect(contentOf(undone)).toEqual(contentOf(before));
    expect(blockFacts(undone)).toEqual(blockFacts(before));
    expect(await yjsIds(editor)).toEqual(idsBefore);
    expect(domCellTexts()).toEqual({ '0,0': 'A', '0,1': 'B', '1,0': 'C', '1,1': 'D' });
  }, 120_000);

  it('type in a cell, toggle read-only inside the typing window, undo reverts the typing', async () => {
    const editor = await boot(buildDoc(STD_2X2, STD_TEXTS));

    await typeInto('c', 'C typed');
    await editor.readOnly.set(true);
    await editor.readOnly.set(false);
    await sleep(CAPTURE);
    expect(savedCellTexts(await editor.save())[1][0]).toBe('C typed');

    await undo(editor);
    const c = await consistency(editor);

    expect(c.savedTexts).toEqual([['A', 'B'], ['C', 'D']]);
    expect(c.yjsTexts).toEqual(c.savedTexts);
    await redo(editor);
    const r = await consistency(editor);

    expect(r.savedTexts).toEqual([['A', 'B'], ['C typed', 'D']]);
    expect(r.yjsTexts).toEqual(r.savedTexts);
  }, 90_000);

  it('delete a row, toggle read-only, type in a cell, undo x2, redo x2', async () => {
    const editor = await boot(buildDoc(STD_2X2, STD_TEXTS));

    gripAction('row', 0, 'Delete');
    await sleep(CAPTURE);
    await editor.readOnly.set(true);
    await editor.readOnly.set(false);
    await sleep(CAPTURE);
    await typeInto('c', 'C typed');
    await sleep(CAPTURE);

    await undo(editor);
    expect(savedCellTexts(await editor.save())).toEqual([['C', 'D']]);
    await undo(editor);
    expect(savedCellTexts(await editor.save())).toEqual([['A', 'B'], ['C', 'D']]);
    expect(domCellTexts()).toEqual({ '0,0': 'A', '0,1': 'B', '1,0': 'C', '1,1': 'D' });
    await redo(editor);
    await redo(editor);
    const c = await consistency(editor);

    expect(c.savedTexts).toEqual([['C typed', 'D']]);
    expect(c.yjsTexts).toEqual(c.savedTexts);
    expect(blockFacts(await yjsDoc(editor))).toEqual(blockFacts(await editor.save()));
  }, 90_000);
});
