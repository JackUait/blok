import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { dragBetweenCharacters } from '../helpers/text-drag';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const UNDO = `${MOD}+z`;
const REDO = `${MOD}+Shift+z`;
const CAPTURE_GAP_MS = 700;

declare global {
  interface Window {
    blokInstance?: Blok;
    defaultBlockTools: Record<string, { class: unknown }>;
  }
}

const mount = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ list }) => {
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    document.body.appendChild(holder);
    const blok = new window.Blok({ holder: 'blok', tools: window.defaultBlockTools, data: { blocks: list } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { list: blocks });
};

const P = (id: string, text: string, parent?: string): OutputData['blocks'][number] => ({
  id, type: 'paragraph', data: { text }, ...(parent !== undefined ? { parent } : {}),
});

/** Saved blocks as `id:type:text^parent`. */
const saved = (page: Page): Promise<string[]> => page.evaluate(async () => {
  if (!window.blokInstance) {
    throw new Error('no editor');
  }

  return (await window.blokInstance.save()).blocks.map((b) => {
    const text = (b.data as { text?: string }).text ?? '';
    const parent = (b as { parent?: string }).parent;

    return `${b.id ?? '?'}:${b.type}:${text}${parent !== undefined ? `^${parent}` : ''}`;
  });
});

/** What is on screen: `id:innerHTML` of each block's first editable. */
const dom = (page: Page): Promise<string[]> => page.evaluate(() =>
  Array.from(document.querySelectorAll('#blok [data-blok-id]')).map((holder) => {
    const editable = holder.querySelector('[contenteditable="true"]');

    return `${holder.getAttribute('data-blok-id') ?? '?'}:${editable?.innerHTML ?? ''}`;
  }));

/** Caret as `blockId@offset`, or `off:<TAG>` when the selection is outside every block. */
const caret = (page: Page): Promise<string> => page.evaluate(() => {
  const selection = document.getSelection();

  if (selection === null || selection.rangeCount === 0) {
    return 'none';
  }
  const range = selection.getRangeAt(0);
  const node = range.startContainer;
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  const host = element?.closest('[contenteditable="true"]');
  const holder = element?.closest('[data-blok-id]');

  if (!host || !holder) {
    return `off:${document.activeElement?.tagName ?? ''}`;
  }
  const before = document.createRange();

  before.selectNodeContents(host);
  before.setEnd(range.startContainer, range.startOffset);

  return `${holder.getAttribute('data-blok-id') ?? '?'}@${before.toString().length}`;
});

const canUndo = (page: Page): Promise<boolean> => page.evaluate(() => window.blokInstance?.history.canUndo() ?? false);
const canRedo = (page: Page): Promise<boolean> => page.evaluate(() => window.blokInstance?.history.canRedo() ?? false);

const gap = (page: Page, ms = CAPTURE_GAP_MS): Promise<void> => page.evaluate((t) => new Promise<void>((r) => {
  window.setTimeout(r, t);
}), ms);

const undo = async (page: Page): Promise<void> => {
  await page.keyboard.press(UNDO);
  await gap(page, 300);
};

const redo = async (page: Page): Promise<void> => {
  await page.keyboard.press(REDO);
  await gap(page, 300);
};

const editable = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

/** Cmd+A escalates text → block → all blocks. */
const selectAllBlocks = async (page: Page, id: string): Promise<void> => {
  await editable(page, id).click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press(`${MOD}+a`);
};

/** Cross-block TEXT selection from `fromId`@fromOffset to `toId`@toOffset, by mouse drag. */
const dragText = (page: Page, fromId: string, fromOffset: number, toId: string, toOffset: number): Promise<void> =>
  dragBetweenCharacters(page, { editable: editable(page, fromId), offset: fromOffset }, { editable: editable(page, toId), offset: toOffset });

/** Rectangle (rubber band) selection from the left margin, over blocks `fromId`..`toId`. */
const rectSelect = async (page: Page, fromId: string, toId: string): Promise<void> => {
  const from = await page.locator(`[data-blok-id="${fromId}"]`).boundingBox();
  const to = await page.locator(`[data-blok-id="${toId}"]`).boundingBox();

  if (!from || !to) {
    throw new Error('block has no box');
  }
  await page.mouse.move(10, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(10, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
};

// Synthetic clipboard events: a real Cmd+C/X/V cannot reach the page clipboard in headless runs.
const clip = (page: Page, type: 'copy' | 'cut'): Promise<Record<string, string>> => page.evaluate((kind) => {
  const store: Record<string, string> = {};
  const transfer = new DataTransfer();
  const setData = transfer.setData.bind(transfer);

  transfer.setData = (format: string, value: string): void => {
    store[format] = value;
    setData(format, value);
  };
  (document.activeElement ?? document.body).dispatchEvent(
    new ClipboardEvent(kind, { bubbles: true, cancelable: true, clipboardData: transfer })
  );

  return store;
}, type);

const paste = (page: Page, payload: Record<string, string>): Promise<void> => page.evaluate((data) => {
  const transfer = new DataTransfer();

  for (const [format, value] of Object.entries(data)) {
    transfer.setData(format, value);
  }
  (document.activeElement ?? document.body).dispatchEvent(
    new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
  );
}, payload);

const HTML_TWO = { 'text/html': '<p>X1</p><p>X2</p>', 'text/plain': 'X1\nX2' };
const THREE = [P('a', 'Alpha one'), P('b', 'Bravo two'), P('c', 'Charlie three')];
const THREE_SAVED = ['a:paragraph:Alpha one', 'b:paragraph:Bravo two', 'c:paragraph:Charlie three'];

const TOGGLE_DOC = (): OutputData['blocks'] => [
  { id: 't', type: 'toggle', data: { text: 'Toggle title', isOpen: true }, content: ['tc'] },
  P('tc', 'Child text', 't'),
  P('z', 'Zulu'),
  P('d', ''),
];
const TOGGLE_SAVED = ['t:toggle:Toggle title', 'tc:paragraph:Child text^t', 'z:paragraph:Zulu', 'd:paragraph:'];

/** Drops the generated id so a line can be compared by type and text. */
const withoutId = (lines: string[]): string[] => lines.map((line) => line.replace(/^[^:]+:/, ''));

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('undo audit: selection-driven edits', () => {
  // Defect: the deletion of the selected text and the pasted blocks are two undo steps.
  // Root cause: paste/index.ts:603 deletes the selection first, then base.ts:268
  // transactForTool -> blockManager.ts:965 beginToolTransaction calls stopCapturing(),
  // which closes the group that holds the deletion.
  // Observed: one undo leaves ["a:Alplie three"], canUndo still true.
  test('W4S-1: one undo after pasting paragraphs over a cross-block text selection restores the original blocks', async ({ page }) => {
    test.fail();
    await mount(page, THREE);
    await dragText(page, 'a', 3, 'c', 4);
    await paste(page, HTML_TWO);
    await gap(page);
    expect(withoutId(await saved(page))).toEqual(['paragraph:Alplie three', 'paragraph:X1', 'paragraph:X2']);

    await undo(page);

    expect(await saved(page)).toEqual(THREE_SAVED);
    expect(await dom(page)).toEqual(['a:Alpha one', 'b:Bravo two', 'c:Charlie three']);
    expect(await canUndo(page)).toBe(false);
  });

  // Defect: same split for blocks copied from Blok (application/x-blok).
  // Root cause: blok-data-handler.ts:313 transactForTool -> blockManager.ts:965 stopCapturing().
  // Observed: one undo leaves ["a:Alplie three", "d:Delta four"].
  test('W4S-1b: one undo after pasting copied blocks over a cross-block text selection restores the original blocks', async ({ page }) => {
    test.fail();
    await mount(page, [...THREE, P('d', 'Delta four')]);
    await editable(page, 'd').click();
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.press(`${MOD}+a`);
    const copied = await clip(page, 'copy');

    await gap(page);
    await dragText(page, 'a', 3, 'c', 4);
    await paste(page, copied);
    await gap(page);
    expect(withoutId(await saved(page))).toEqual(['paragraph:Alplie three', 'paragraph:Delta four', 'paragraph:Delta four']);

    await undo(page);

    expect(await saved(page)).toEqual([...THREE_SAVED, 'd:paragraph:Delta four']);
  });

  test('W4S-2: undo of a multi-line paste in the middle of a block brings the original text back', async ({ page }) => {
    await mount(page, [P('a', 'Hello world')]);
    await editable(page, 'a').click();
    await page.keyboard.press('Home');
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowRight');
    }
    await gap(page);
    await paste(page, { 'text/plain': 'X1\nX2' });
    await gap(page);
    expect(withoutId(await saved(page))).toEqual(['paragraph:HelloX1', 'paragraph:X2 world']);

    await undo(page);

    expect(await saved(page)).toEqual(['a:paragraph:Hello world']);
    expect(await dom(page)).toEqual(['a:Hello world']);
  });

  test('W4S-2b: undo all then redo all of a multi-line paste over a cross-block text selection returns to the pasted state', async ({ page }) => {
    await mount(page, THREE);
    await dragText(page, 'a', 3, 'c', 4);
    await paste(page, { 'text/plain': 'X1\nX2' });
    await gap(page);
    const pasted = await saved(page);

    expect(withoutId(pasted)).toEqual(['paragraph:AlpX1', 'paragraph:X2lie three']);

    for (let i = 0; i < 4 && await canUndo(page); i++) {
      await undo(page);
    }
    for (let i = 0; i < 4 && await canRedo(page); i++) {
      await redo(page);
    }

    expect(await saved(page)).toEqual(pasted);
  });

  // Defect: undo of a letter typed over a cross-block text selection puts the caret at the
  // start of the block, not where the selection began (Backspace/Delete/Enter get it right).
  // Root cause: replaceCrossBlockTextSelection calls clearTextSelection()
  // (blockSelectionKeys.ts:589 -> removeAllRanges, crossBlockSelection.ts:201) before the first
  // tracked write; the lazy markCaretBeforeChange() in YjsManager.removeBlock (yjs/index.ts:341)
  // then reads no range and getCaretOffset returns 0 (utils/caret/selection.ts:69).
  // Enter/Backspace/Delete escape because keyboard.ts:144 force-captures only the keys in
  // KEYS_REQUIRING_CARET_CAPTURE (uiControllers/constants.ts:6); printable keys, cut and paste do not.
  // Observed: Expected "a@3", Received "a@0".
  test('W4S-3: undo of typing over a cross-block text selection puts the caret where the selection began', async ({ page }) => {
    test.fail();
    await mount(page, THREE);
    await dragText(page, 'a', 3, 'c', 4);
    await page.keyboard.press('q');
    await gap(page);
    expect(await saved(page)).toEqual(['a:paragraph:Alpqlie three']);

    await undo(page);

    expect(await caret(page)).toBe('a@3');
    expect(await saved(page)).toEqual(THREE_SAVED);
  });

  // Defect: same as W4S-3 for cut. Observed: Expected "a@3", Received "a@0".
  test('W4S-3b: undo of cutting a cross-block text selection puts the caret where the selection began', async ({ page }) => {
    test.fail();
    await mount(page, THREE);
    await dragText(page, 'a', 3, 'c', 4);
    await clip(page, 'cut');
    await gap(page);
    expect(await saved(page)).toEqual(['a:paragraph:Alplie three']);

    await undo(page);

    expect(await caret(page)).toBe('a@3');
    expect(await saved(page)).toEqual(THREE_SAVED);
  });

  // Defect: same as W4S-3 for an inline paste. Observed: Expected "a@3", Received "a@0".
  test('W4S-3c: undo of pasting text over a cross-block text selection puts the caret where the selection began', async ({ page }) => {
    test.fail();
    await mount(page, THREE);
    await dragText(page, 'a', 3, 'c', 4);
    await paste(page, { 'text/plain': 'ZZ' });
    await gap(page);
    expect(await saved(page)).toEqual(['a:paragraph:AlpZZlie three']);

    await undo(page);

    expect(await caret(page)).toBe('a@3');
    expect(await saved(page)).toEqual(THREE_SAVED);
  });

  // Defect: undo of a paste that replaced an empty block leaves no caret at all (focus on <body>).
  // Root cause: block-insertion.ts:762 insert({ replace: true }) takes the empty block out of the
  // DOM before the first tracked write; markCaretBeforeChange() then runs inside the transact at
  // block-insertion.ts:830 and captureCaretSnapshot falls back to currentBlock
  // (undo-history.ts:1461), which is already the NEW block. On undo that block is gone, so
  // restoreCaretSnapshot returns early (undo-history.ts:1563) and nothing focuses "d".
  // Observed: Expected "d@0", Received "off:BODY".
  test('W4S-4: undo of pasting into an empty block puts the caret back in that block', async ({ page }) => {
    test.fail();
    await mount(page, [P('a', 'Alpha one'), P('d', '')]);
    await editable(page, 'd').click();
    await gap(page);
    await paste(page, { 'text/html': '<h2>Title</h2>', 'text/plain': 'Title' });
    await gap(page);
    expect(withoutId(await saved(page))).toEqual(['paragraph:Alpha one', 'header:Title']);

    await undo(page);

    expect(await caret(page)).toBe('d@0');
    expect(await saved(page)).toEqual(['a:paragraph:Alpha one', 'd:paragraph:']);
  });

  // Defect: same as W4S-4 for blocks copied from Blok (a toggle with a child).
  // Observed: Expected "d@0", Received "off:BODY".
  test('W4S-4b: undo of pasting copied blocks into an empty block puts the caret back in that block', async ({ page }) => {
    test.fail();
    await mount(page, TOGGLE_DOC());
    await editable(page, 't').click();
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.press(`${MOD}+a`);
    const copied = await clip(page, 'copy');

    await editable(page, 'd').click();
    await gap(page);
    await paste(page, copied);
    await gap(page);
    expect(await saved(page)).toHaveLength(5);

    await undo(page);

    expect(await caret(page)).toBe('d@0');
    expect(await saved(page)).toEqual(TOGGLE_SAVED);
  });

  // Defect: redo of a multi-block paste puts the caret in the FIRST pasted block; the paste left it
  // at the end of the LAST one. Root cause: the second block's addBlock merges into the entry via
  // 'stack-item-updated', which captures `after` mid-transaction (undo-history.ts:887), before
  // base.ts:257 moves the caret into that block; only 'stack-item-added' gets the post-settle
  // refresh (scheduleAfterSnapshotRefresh, undo-history.ts:859).
  // Observed: Expected "<last>@2", Received "<first>@2".
  test('W4S-5: redo of a multi-block paste puts the caret where the paste left it', async ({ page }) => {
    test.fail();
    await mount(page, [P('a', 'Alpha one'), P('d', 'Delta')]);
    await editable(page, 'd').click();
    await page.keyboard.press('End');
    await gap(page);
    await paste(page, HTML_TWO);
    await gap(page);
    const pasted = await saved(page);
    const lastId = pasted[3]?.split(':')[0];

    expect(withoutId(pasted.slice(2))).toEqual(['paragraph:X1', 'paragraph:X2']);
    expect(await caret(page)).toBe(`${lastId}@2`);

    await undo(page);
    await redo(page);

    expect(await caret(page)).toBe(`${lastId}@2`);
    expect(await saved(page)).toEqual(pasted);
  });

  // ---- Controls: these work today. ----

  test('W4S-C1: select all + Backspace is one undo step and redo gives back the same empty block', async ({ page }) => {
    await mount(page, THREE);
    await selectAllBlocks(page, 'b');
    await page.keyboard.press('Backspace');
    await gap(page);
    const emptied = await dom(page);

    expect(await saved(page)).toEqual([]);
    expect(emptied).toHaveLength(1);

    await undo(page);
    expect(await saved(page)).toEqual(THREE_SAVED);
    expect(await canUndo(page)).toBe(false);

    await redo(page);
    expect(await dom(page)).toEqual(emptied);
    expect(await saved(page)).toEqual([]);
  });

  test('W4S-C2: select all + cut is one undo step, redo cuts again', async ({ page }) => {
    await mount(page, THREE);
    await selectAllBlocks(page, 'b');
    await clip(page, 'cut');
    await gap(page);
    expect(await saved(page)).toEqual([]);

    await undo(page);
    expect(await saved(page)).toEqual(THREE_SAVED);
    expect(await canUndo(page)).toBe(false);

    await redo(page);
    expect(await saved(page)).toEqual([]);
  });

  test('W4S-C3: rectangle selection + Delete and + cut are one undo step each, with exact redo', async ({ page }) => {
    const four = [...THREE, P('d', 'Delta four')];
    const fourSaved = [...THREE_SAVED, 'd:paragraph:Delta four'];

    await mount(page, four);
    await rectSelect(page, 'a', 'c');
    await page.keyboard.press('Delete');
    await gap(page);
    expect(await saved(page)).toEqual(['d:paragraph:Delta four']);
    await undo(page);
    expect(await saved(page)).toEqual(fourSaved);
    expect(await canUndo(page)).toBe(false);
    await redo(page);
    expect(await saved(page)).toEqual(['d:paragraph:Delta four']);

    await mount(page, four);
    await rectSelect(page, 'a', 'c');
    await clip(page, 'cut');
    await gap(page);
    expect(await saved(page)).toEqual(['d:paragraph:Delta four']);
    await undo(page);
    expect(await saved(page)).toEqual(fourSaved);
    await redo(page);
    expect(await saved(page)).toEqual(['d:paragraph:Delta four']);
  });

  test('W4S-C4: Shift+Arrow block selection + Backspace is one undo step', async ({ page }) => {
    await mount(page, [...THREE, P('d', 'Delta four')]);
    await editable(page, 'b').click();
    await page.keyboard.press('End');
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.up('Shift');
    await page.keyboard.press('Backspace');
    await gap(page);
    expect(await saved(page)).toEqual(['a:paragraph:Alpha one']);

    await undo(page);
    expect(await saved(page)).toEqual([...THREE_SAVED, 'd:paragraph:Delta four']);
    await redo(page);
    expect(await saved(page)).toEqual(['a:paragraph:Alpha one']);
  });

  for (const key of ['Backspace', 'Delete'] as const) {
    test(`W4S-C5 ${key}: ${key} over a cross-block text selection is one undo step, caret back at the start`, async ({ page }) => {
      await mount(page, THREE);
      await dragText(page, 'a', 3, 'c', 4);
      await page.keyboard.press(key);
      await gap(page);
      expect(await saved(page)).toEqual(['a:paragraph:Alplie three']);

      await undo(page);
      expect(await saved(page)).toEqual(THREE_SAVED);
      expect(await dom(page)).toEqual(['a:Alpha one', 'b:Bravo two', 'c:Charlie three']);
      expect(await caret(page)).toBe('a@3');
      expect(await canUndo(page)).toBe(false);

      await redo(page);
      expect(await saved(page)).toEqual(['a:paragraph:Alplie three']);
      expect(await caret(page)).toBe('a@3');
    });
  }

  test('W4S-C6: Enter over a cross-block text selection is one undo step with exact redo', async ({ page }) => {
    await mount(page, THREE);
    await dragText(page, 'a', 3, 'c', 4);
    await page.keyboard.press('Enter');
    await gap(page);
    const after = await saved(page);

    expect(withoutId(after)).toEqual(['paragraph:Alp', 'paragraph:lie three']);

    await undo(page);
    expect(await saved(page)).toEqual(THREE_SAVED);
    expect(await caret(page)).toBe('a@3');
    expect(await canUndo(page)).toBe(false);

    await redo(page);
    expect(await saved(page)).toEqual(after);
  });

  test('W4S-C7: a cross-block text selection into a header, or from a list item, undoes in one step', async ({ page }) => {
    await mount(page, [P('a', 'Alpha one'), { id: 'h', type: 'header', data: { text: 'Heading two', level: 2 } }]);
    await dragText(page, 'a', 3, 'h', 4);
    await page.keyboard.press('Backspace');
    await gap(page);
    expect(await saved(page)).toEqual(['a:paragraph:Alping two']);
    await undo(page);
    expect(await saved(page)).toEqual(['a:paragraph:Alpha one', 'h:header:Heading two']);
    await redo(page);
    expect(await saved(page)).toEqual(['a:paragraph:Alping two']);

    await mount(page, [{ id: 'l', type: 'list', data: { text: 'List item', style: 'unordered' } }, P('a', 'Alpha one')]);
    await dragText(page, 'l', 3, 'a', 4);
    await page.keyboard.press('Backspace');
    await gap(page);
    expect(await saved(page)).toEqual(['l:list:Lisa one']);
    await undo(page);
    expect(await saved(page)).toEqual(['l:list:List item', 'a:paragraph:Alpha one']);
  });

  test('W4S-C8: an inline paste over a cross-block text selection is one undo step', async ({ page }) => {
    await mount(page, THREE);
    await dragText(page, 'a', 3, 'c', 4);
    await paste(page, { 'text/plain': 'ZZ' });
    await gap(page);
    expect(await saved(page)).toEqual(['a:paragraph:AlpZZlie three']);

    await undo(page);
    expect(await saved(page)).toEqual(THREE_SAVED);
    expect(await canUndo(page)).toBe(false);
    await redo(page);
    expect(await saved(page)).toEqual(['a:paragraph:AlpZZlie three']);
  });

  test('W4S-C11: undo of pasting paragraphs at the end of a non-empty block puts the caret back there', async ({ page }) => {
    await mount(page, [P('a', 'Alpha one'), P('d', 'Delta')]);
    await editable(page, 'd').click();
    await page.keyboard.press('End');
    await gap(page);
    await paste(page, HTML_TWO);
    await gap(page);
    expect(await saved(page)).toHaveLength(4);

    await undo(page);

    expect(await caret(page)).toBe('d@5');
    expect(await saved(page)).toEqual(['a:paragraph:Alpha one', 'd:paragraph:Delta']);
  });

  test('W4S-C9: copied blocks (toggle with a child) pasted elsewhere undo in one step, redo keeps ids and nesting', async ({ page }) => {
    await mount(page, TOGGLE_DOC());
    await editable(page, 't').click();
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.press(`${MOD}+a`);
    const copied = await clip(page, 'copy');

    await editable(page, 'd').click();
    await gap(page);
    await paste(page, copied);
    await gap(page);
    const pasted = await saved(page);
    const [newToggle = '', newChild = ''] = pasted.slice(3);

    expect(newToggle).toMatch(/:toggle:Toggle title$/);
    expect(newChild).toBe(`${newChild.split(':')[0]}:paragraph:Child text^${newToggle.split(':')[0]}`);

    await undo(page);
    expect(await saved(page)).toEqual(TOGGLE_SAVED);
    expect(await canUndo(page)).toBe(false);

    await redo(page);
    expect(await saved(page)).toEqual(pasted);
  });

  test('W4S-C10: cut then paste (a move) is two clean undo steps with exact redo', async ({ page }) => {
    await mount(page, [...THREE, P('d', 'Delta four')]);
    await editable(page, 'a').click();
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.press(`${MOD}+a`);
    const cut = await clip(page, 'cut');

    await gap(page);
    const afterCut = await saved(page);

    await editable(page, 'd').click();
    await page.keyboard.press('End');
    await gap(page);
    await paste(page, cut);
    await gap(page);
    const afterPaste = await saved(page);

    expect(afterCut).toEqual(['b:paragraph:Bravo two', 'c:paragraph:Charlie three', 'd:paragraph:Delta four']);
    expect(afterPaste.slice(0, 3)).toEqual(afterCut);
    expect(afterPaste[3]).toMatch(/:paragraph:Alpha one$/);

    await undo(page);
    expect(await saved(page)).toEqual(afterCut);
    await undo(page);
    expect(await saved(page)).toEqual([...THREE_SAVED, 'd:paragraph:Delta four']);
    await redo(page);
    expect(await saved(page)).toEqual(afterCut);
    await redo(page);
    expect(await saved(page)).toEqual(afterPaste);
  });
});
