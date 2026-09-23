import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const SELECT_ALL_SHORTCUT = process.platform === 'darwin' ? 'Meta+a' : 'Control+a';
const YJS_CAPTURE_TIMEOUT = 600;

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

interface CaretInfo {
  blockId: string | null;
  offset: number | null;
  inBlok: boolean;
  anchorVisible: boolean | null;
  caretTop: number | null;
  scrollY: number;
  innerHeight: number;
  selectedBlocks: number;
}

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder, blocks: blokBlocks }) => {
    const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blocks });
};

const wait = async (page: Page, ms: number): Promise<void> => {
  await page.evaluate(async (timeout) => {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeout);
    });
  }, ms);
};

const save = async (page: Page): Promise<OutputData> => {
  return await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    return await window.blokInstance.save();
  });
};

/** Where the live caret is: owning block id, text offset in its editable (UTF-16), visibility, scroll. */
const caretInfo = async (page: Page): Promise<CaretInfo> => {
  return await page.evaluate(() => {
    const selection = window.getSelection();
    const selectedBlocks = document.querySelectorAll('[data-blok-selected="true"]').length;
    const base = { scrollY: window.scrollY, innerHeight: window.innerHeight, selectedBlocks };

    if (selection === null || selection.rangeCount === 0 || selection.anchorNode === null) {
      return { ...base, blockId: null, offset: null, inBlok: false, anchorVisible: null, caretTop: null };
    }

    const range = selection.getRangeAt(0);
    const anchor = range.startContainer;
    const anchorEl = anchor instanceof Element ? anchor : anchor.parentElement;
    const holder = anchorEl?.closest('[data-blok-id]') ?? null;
    const editable = anchorEl?.closest('[contenteditable="true"], [contenteditable="plaintext-only"]') ?? null;
    const inBlok = anchorEl?.closest('#blok') !== null && anchorEl !== null;

    let offset: number | null = null;

    if (editable !== null) {
      const pre = document.createRange();

      pre.selectNodeContents(editable);
      pre.setEnd(range.startContainer, range.startOffset);
      offset = pre.toString().length;
    }

    const rect = range.getBoundingClientRect();
    const fallbackRect = anchorEl?.getBoundingClientRect();
    const caretTop = rect.height > 0 || rect.top !== 0 ? rect.top : (fallbackRect?.top ?? null);

    return {
      ...base,
      blockId: holder?.getAttribute('data-blok-id') ?? null,
      offset,
      inBlok,
      anchorVisible: anchorEl === null ? null : anchorEl.checkVisibility(),
      caretTop,
    };
  });
};

/** Put the caret at a UTF-16 text offset inside the editable of a block, like a click would. */
const placeCaret = async (page: Page, blockId: string, offset: number, editableIndex = 0): Promise<void> => {
  await page.evaluate(({ id, off, idx }) => {
    const holder = document.querySelector(`[data-blok-id="${id}"]`);
    const editable = holder?.querySelectorAll<HTMLElement>('[contenteditable="true"], [contenteditable="plaintext-only"]')[idx];

    if (editable === undefined) {
      throw new Error(`no editable in ${id}`);
    }
    editable.focus();

    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    let remaining = off;
    let node = walker.nextNode();

    while (node !== null) {
      const len = node.textContent?.length ?? 0;

      if (remaining <= len) {
        break;
      }
      remaining -= len;
      node = walker.nextNode();
    }

    const range = document.createRange();

    if (node === null) {
      range.selectNodeContents(editable);
      range.collapse(false);
    } else {
      range.setStart(node, remaining);
      range.collapse(true);
    }
    const sel = window.getSelection();

    sel?.removeAllRanges();
    sel?.addRange(range);
  }, { id: blockId, off: offset, idx: editableIndex });
  // Let the debounced selectionchange settle currentBlock.
  await wait(page, 250);
};

const undo = async (page: Page): Promise<void> => {
  await page.keyboard.press(UNDO_SHORTCUT);
  await wait(page, 250);
};

const redo = async (page: Page): Promise<void> => {
  await page.keyboard.press(REDO_SHORTCUT);
  await wait(page, 250);
};

const editableOf = (page: Page, blockId: string) =>
  page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-id="${blockId}"] [contenteditable="true"]`).first();

const cellBlockIdByText = async (page: Page, text: string): Promise<string> => {
  const id = await page
    .locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`, { hasText: text })
    .first()
    .evaluate(el => el.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? null);

  if (id === null) {
    throw new Error(`no cell block with text ${text}`);
  }

  return id;
};

const texts = async (page: Page): Promise<Array<string | undefined>> =>
  (await save(page)).blocks.map(b => (b.data as { text?: string }).text);

const selectedIds = async (page: Page): Promise<Array<string | null>> =>
  await page.evaluate(() => Array.from(document.querySelectorAll('[data-blok-selected="true"]')).map(e => e.getAttribute('data-blok-id')));

const manyBlocks = (count: number): OutputData['blocks'] =>
  Array.from({ length: count }, (_, i) => ({ id: `p${i}`, type: 'paragraph', data: { text: `Paragraph number ${i}` } }));

const isCaretInViewport = (info: CaretInfo): boolean =>
  info.caretTop !== null && info.caretTop >= 0 && info.caretTop <= info.innerHeight;

test.describe('undo audit — caret, scroll, selection', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test.describe('works (no other coverage)', () => {
    // Collapsing is its own undo step (isOpen is saved data), so undo reopens first.
    test('undo after collapsing a toggle reopens it, then reverts the child edit', async ({ page }) => {
      await createBlok(page, [
        { id: 'tg', type: 'toggle', data: { text: 'Toggle', isOpen: true }, content: ['ch'] },
        { id: 'ch', type: 'paragraph', data: { text: 'child' }, parent: 'tg' },
      ]);
      await placeCaret(page, 'ch', 5);
      await page.keyboard.type('XX');
      await wait(page, YJS_CAPTURE_TIMEOUT);
      await page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-id="tg"] [aria-expanded="true"]`).first().click();
      await expect(page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-id="ch"]`)).toBeHidden();

      await undo(page);
      const afterReopen = await caretInfo(page);

      expect([afterReopen.blockId, afterReopen.offset, afterReopen.anchorVisible]).toEqual(['ch', 7, true]);
      await undo(page);
      const afterUndo = await caretInfo(page);

      expect([afterUndo.blockId, afterUndo.offset, afterUndo.anchorVisible]).toEqual(['ch', 5, true]);
      await expect(editableOf(page, 'ch')).toHaveText('child');
    });

    test('undo/redo in a code block keeps the offset after newlines', async ({ page }) => {
      await createBlok(page, [{ id: 'k', type: 'code', data: { code: 'one\ntwo\nthree', language: 'plain' } }]);
      // "one\ntwo\nth" is 10 characters.
      await placeCaret(page, 'k', 10);
      await page.keyboard.type('XX');
      await wait(page, YJS_CAPTURE_TIMEOUT);
      await undo(page);
      const afterUndo = await caretInfo(page);

      await redo(page);
      const afterRedo = await caretInfo(page);

      expect([afterUndo.offset, afterRedo.offset]).toEqual([10, 12]);
    });

    test('undo/redo next to emoji keeps UTF-16 offsets', async ({ page }) => {
      await createBlok(page, [{ id: 'a', type: 'paragraph', data: { text: 'a😀b😀c' } }]);
      // "a😀b😀" is 6 UTF-16 units.
      await placeCaret(page, 'a', 6);
      await page.keyboard.type('Z');
      await wait(page, YJS_CAPTURE_TIMEOUT);
      await undo(page);
      const afterUndo = await caretInfo(page);

      await redo(page);
      const afterRedo = await caretInfo(page);

      expect([afterUndo.offset, afterRedo.offset]).toEqual([6, 7]);
    });
  });

  // Expected source: undo puts the caret where the change was made (undo-redo.spec.ts "caret restoration").
  test('CAR-1: undo of a paste puts the caret where the paste started', async ({ page }) => {
    // Observed: caret offset 10 (end of the removed paste) instead of 5.
    test.fail();
    await createBlok(page, [{ id: 'a', type: 'paragraph', data: { text: 'Hello world' } }]);
    await placeCaret(page, 'a', 5);
    // Synthetic paste, as in undo-redo.spec.ts "paste operations"; a real Cmd+V is unverified (clipboard permission denied).
    await editableOf(page, 'a').evaluate((element: HTMLElement) => {
      const pasteEvent = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
        clipboardData: {
          getData: (type: string): string => (type === 'text/plain' ? 'PASTE' : ''),
          types: ['text/plain'],
        },
      });

      element.dispatchEvent(pasteEvent);
    });
    await wait(page, YJS_CAPTURE_TIMEOUT);
    await undo(page);
    const afterUndo = await caretInfo(page);

    expect([afterUndo.blockId, afterUndo.offset]).toEqual(['a', 5]);
    await expect(editableOf(page, 'a')).toHaveText('Hello world');
  });

  // Expected source: Notion scrolls to the undone change; Caret.set already scrolls the caret into view.
  // Conflicts with undo-history.mutants.test.ts "is restored when undoing or redoing an edit threw the
  // page across a viewport", which pins the scroll-back. A fix must narrow that guard first.
  test('CAR-2a: undo of an edit far above the viewport shows the caret', async ({ page }) => {
    // Observed: caretTop -4259 (scrollY stays 4348); caret is off-screen.
    test.fail();
    await createBlok(page, manyBlocks(120));
    await placeCaret(page, 'p0', 9);
    await page.keyboard.type('XX');
    await wait(page, YJS_CAPTURE_TIMEOUT);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await wait(page, 100);
    await undo(page);
    const afterUndo = await caretInfo(page);

    expect(isCaretInViewport(afterUndo)).toBe(true);
    await expect(editableOf(page, 'p0')).toHaveText('Paragraph number 0');
    expect([afterUndo.blockId, afterUndo.offset]).toEqual(['p0', 9]);
  });

  test('CAR-2b: undo of an edit far below the viewport shows the caret', async ({ page }) => {
    // Observed: caret stays far below the viewport (scroll restored to 0).
    test.fail();
    await createBlok(page, manyBlocks(120));
    await placeCaret(page, 'p119', 9);
    await page.keyboard.type('XX');
    await wait(page, YJS_CAPTURE_TIMEOUT);
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(page, 100);
    await undo(page);
    const afterUndo = await caretInfo(page);

    expect(isCaretInViewport(afterUndo)).toBe(true);
    await expect(editableOf(page, 'p119')).toHaveText('Paragraph number 119');
    expect([afterUndo.blockId, afterUndo.offset]).toEqual(['p119', 9]);
  });

  // Expected source: undo must restore the exact prior state; a highlight next to a live caret is stale UI.
  test('CAR-3a: undo clears a whole-block selection', async ({ page }) => {
    // Observed: block "b" stays [data-blok-selected] while the caret is in "a".
    test.fail();
    await createBlok(page, [
      { id: 'a', type: 'paragraph', data: { text: 'Alpha' } },
      { id: 'b', type: 'paragraph', data: { text: 'Beta' } },
    ]);
    await placeCaret(page, 'a', 5);
    await page.keyboard.type('XX');
    await wait(page, YJS_CAPTURE_TIMEOUT);
    await placeCaret(page, 'b', 2);
    await page.keyboard.press(SELECT_ALL_SHORTCUT);
    await page.keyboard.press(SELECT_ALL_SHORTCUT);
    await wait(page, 200);
    await undo(page);

    expect(await selectedIds(page)).toEqual([]);
    const afterUndo = await caretInfo(page);

    expect([afterUndo.blockId, afterUndo.offset]).toEqual(['a', 5]);
  });

  test('CAR-3b: Backspace after undo acts at the caret, not on a stale selected block', async ({ page }) => {
    // Observed: saved ["a:Alph"] expected, got ["a:Alpha"] — Backspace deleted the whole block "b".
    test.fail();
    await createBlok(page, [
      { id: 'a', type: 'paragraph', data: { text: 'Alpha' } },
      { id: 'b', type: 'paragraph', data: { text: 'Beta' } },
    ]);
    await placeCaret(page, 'a', 5);
    await page.keyboard.type('XX');
    await wait(page, YJS_CAPTURE_TIMEOUT);
    await placeCaret(page, 'b', 2);
    await page.keyboard.press(SELECT_ALL_SHORTCUT);
    await page.keyboard.press(SELECT_ALL_SHORTCUT);
    await wait(page, 200);
    await undo(page);
    await page.keyboard.press('Backspace');
    await wait(page, YJS_CAPTURE_TIMEOUT);

    expect((await save(page)).blocks.map(b => `${b.id}:${(b.data as { text?: string }).text}`)).toEqual(['a:Alph', 'b:Beta']);
  });

  test('CAR-3c: typing after undo goes where the caret is, not into a stale selected block', async ({ page }) => {
    // Observed: ["Alpha", "BetaQ"] — the caret shows in "a" but the key lands in "b".
    test.fail();
    await createBlok(page, [
      { id: 'a', type: 'paragraph', data: { text: 'Alpha' } },
      { id: 'b', type: 'paragraph', data: { text: 'Beta' } },
    ]);
    await placeCaret(page, 'a', 5);
    await page.keyboard.type('XX');
    await wait(page, YJS_CAPTURE_TIMEOUT);
    await placeCaret(page, 'b', 2);
    await page.keyboard.press('Escape');
    await wait(page, 200);
    await undo(page);
    await page.keyboard.type('Q');
    await wait(page, YJS_CAPTURE_TIMEOUT);

    expect(await texts(page)).toEqual(['AlphaQ', 'Beta']);
  });

  // Expected source: undo puts the caret where the change was made — here, the restored block.
  test('CAR-4: undo of a block delete from the settings menu puts the caret in the restored block', async ({ page }) => {
    // Observed: caret lands in the next block "c" (offset 5), same via history.undo().
    test.fail();
    await createBlok(page, [
      { id: 'a', type: 'paragraph', data: { text: 'First' } },
      { id: 'b', type: 'paragraph', data: { text: 'Second' } },
      { id: 'c', type: 'paragraph', data: { text: 'Third' } },
    ]);
    await placeCaret(page, 'b', 3);
    await page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-id="b"]`).hover();
    await page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`).click();
    await page.locator('[data-blok-testid="popover-item"][data-blok-item-name="delete"]').click();
    await wait(page, YJS_CAPTURE_TIMEOUT);
    await undo(page);
    const afterUndo = await caretInfo(page);

    expect(afterUndo.blockId).toBe('b');
    expect((await save(page)).blocks.map(b => b.id)).toEqual(['a', 'b', 'c']);
  });

  // Expected source: undo-redo.spec.ts "undo after block split rejoins blocks (single undo)", caret at the split point.
  test('CAR-5: undo of Enter in the middle of a table cell puts the caret at the split point', async ({ page }) => {
    // Observed: caret in the "Delta" cell at offset 5 instead of the "Gamma" cell at 3.
    test.fail();
    await createBlok(page, [{ id: 't', type: 'table', data: { withHeadings: false, content: [['Alpha', 'Beta'], ['Gamma', 'Delta']] } }]);
    const cellBlockId = await cellBlockIdByText(page, 'Gamma');

    await placeCaret(page, cellBlockId, 3);
    await page.keyboard.press('Enter');
    await wait(page, YJS_CAPTURE_TIMEOUT);
    await undo(page);
    const afterUndo = await caretInfo(page);

    expect([afterUndo.blockId, afterUndo.offset]).toEqual([cellBlockId, 3]);
  });

  test('CAR-6: one undo of Enter in the middle of a table cell rejoins the text', async ({ page }) => {
    // Observed: cell reads "Gam" after one undo; "Gamma" only after a second undo.
    test.fail();
    await createBlok(page, [{ id: 't', type: 'table', data: { withHeadings: false, content: [['Alpha', 'Beta'], ['Gamma', 'Delta']] } }]);
    const cellBlockId = await cellBlockIdByText(page, 'Gamma');

    await placeCaret(page, cellBlockId, 3);
    await page.keyboard.press('Enter');
    await wait(page, YJS_CAPTURE_TIMEOUT);
    await undo(page);
    await wait(page, 300);

    expect((await texts(page)).slice(1)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
    await expect(editableOf(page, cellBlockId)).toHaveText('Gamma');
  });

  // Expected source: undo must reverse the most recent edit first.
  test('CAR-7: undo with the slash menu open reverts the "/" before older edits', async ({ page }) => {
    // Observed: ["Hello", "/"] — the older "XX" was undone and the "/" stayed; caret went to "a" offset 0.
    test.fail();
    await createBlok(page, [
      { id: 'a', type: 'paragraph', data: { text: 'Hello' } },
      { id: 'b', type: 'paragraph', data: { text: '' } },
    ]);
    await placeCaret(page, 'a', 5);
    await page.keyboard.type('XX');
    await wait(page, YJS_CAPTURE_TIMEOUT);
    await placeCaret(page, 'b', 0);
    await page.keyboard.type('/');
    await wait(page, YJS_CAPTURE_TIMEOUT);
    await undo(page);

    expect(await texts(page)).toEqual(['HelloXX', '']);
    const afterUndo = await caretInfo(page);

    expect(afterUndo.blockId).toBe('b');
  });

  test('CAR-7b: redo after an undo with the slash menu open brings the edit back', async ({ page }) => {
    // Observed: ["Hello", "/"] after redo, canRedo() false — the "/" landed as a new entry and cleared the redo stack.
    test.fail();
    await createBlok(page, [
      { id: 'a', type: 'paragraph', data: { text: 'Hello' } },
      { id: 'b', type: 'paragraph', data: { text: '' } },
    ]);
    await placeCaret(page, 'a', 5);
    await page.keyboard.type('XX');
    await wait(page, YJS_CAPTURE_TIMEOUT);
    await placeCaret(page, 'b', 0);
    await page.keyboard.type('/');
    await wait(page, YJS_CAPTURE_TIMEOUT);
    await undo(page);
    await redo(page);

    expect(await texts(page)).toEqual(['HelloXX', '/']);
  });

  // Expected source: the public blocks API must agree with the caret the undo just placed.
  test('CAR-8: getCurrentBlockIndex agrees with the caret right after history.undo()', async ({ page }) => {
    // Observed: returns "c" (where the caret was before undo); heals to "a" only after ~180ms.
    test.fail();
    await createBlok(page, [
      { id: 'a', type: 'paragraph', data: { text: 'Alpha' } },
      { id: 'b', type: 'paragraph', data: { text: 'Beta' } },
      { id: 'c', type: 'paragraph', data: { text: 'Gamma' } },
    ]);
    await placeCaret(page, 'a', 5);
    await page.keyboard.type('XX');
    await wait(page, YJS_CAPTURE_TIMEOUT);
    await placeCaret(page, 'c', 2);
    const current = await page.evaluate(() => {
      const blok = window.blokInstance;

      if (blok === undefined) {
        return null;
      }
      blok.history.undo();

      return blok.blocks.getBlockByIndex(blok.blocks.getCurrentBlockIndex())?.id ?? null;
    });

    expect(current).toBe('a');
    expect((await caretInfo(page)).blockId).toBe('a');
  });
});
