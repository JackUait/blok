/**
 * Where the caret and block selection land after a delete, a move or a column
 * drop, and after their undo and redo, as measured in Notion (U047, U048,
 * U104, U113, U117, U142, U163).
 */
import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const MOVE_UP = process.platform === 'darwin' ? 'Meta+Shift+ArrowUp' : 'Control+Shift+ArrowUp';
// Past the typing window, so the next gesture starts its own step.
const STEP_GAP_MS = 1000;
const HANDLE = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';
const TUNES_POPOVER = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

type SavedBlock = OutputData['blocks'][number];

const P = (id: string, text: string, parent?: string): SavedBlock => ({ id, type: 'paragraph', data: { text }, ...(parent === undefined ? {} : { parent }) });

const ABC = [P('b1', 'Alpha'), P('b2', 'Beta'), P('b3', 'Gamma')];

const createBlok = async (page: Page, blocks: SavedBlock[]): Promise<void> => {
  await page.evaluate(async ({ holder, blocks: blokBlocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });

    window.blokInstance = blok;
    await blok.isReady;
    blok.history.clear();
  }, { holder: HOLDER_ID, blocks });
};

/** "<block id>:<offset>", or "none" when no text caret is in the editor. */
const caret = async (page: Page): Promise<string> => page.evaluate((holder) => {
  const selection = window.getSelection();
  const node = selection?.anchorNode ?? null;
  const root = document.getElementById(holder);
  const editable = (node instanceof Element ? node : node?.parentElement)?.closest('[contenteditable="true"]');
  const active = document.activeElement;

  if (selection === null || node === null || !(editable instanceof HTMLElement) || root?.contains(editable) !== true) {
    return active instanceof HTMLElement && active.isContentEditable && root?.contains(active) === true ? 'focused' : 'none';
  }
  const before = document.createRange();

  before.setStart(editable, 0);
  before.setEnd(node, selection.anchorOffset);

  return `${editable.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? '?'}:${before.toString().length}`;
}, HOLDER_ID);

const selectedBlocks = async (page: Page): Promise<string[]> => page.evaluate(() =>
  [...document.querySelectorAll('[data-blok-selected="true"]')].map((holder) => holder.getAttribute('data-blok-id') ?? '?'));

/** Every saved block as "type:id", plus "<parent" when it has one. */
const tree = async (page: Page): Promise<string[]> => page.evaluate(async () => {
  const blocks = (await window.blokInstance?.save())?.blocks ?? [];

  return blocks.map((block) => `${block.type}:${block.id ?? '?'}${block.parent === undefined ? '' : `<${block.parent}`}`);
});

const ids = async (page: Page): Promise<string[]> => page.evaluate(async () =>
  ((await window.blokInstance?.save())?.blocks ?? []).map((block) => block.id ?? '?'));

const wait = async (page: Page, ms: number): Promise<void> => {
  await page.evaluate(async (timeout) => {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeout);
    });
  }, ms);
};

const press = async (page: Page, key: string): Promise<void> => {
  await page.keyboard.press(key);
  await wait(page, 200);
};

const editable = (page: Page, id: string): Locator =>
  page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

const clickEnd = async (page: Page, id: string): Promise<void> => {
  await editable(page, id).click();
  await page.keyboard.press('End');
  await wait(page, 250);
};

const openTunes = async (page: Page, id: string): Promise<void> => {
  await page.locator(`[data-blok-id="${id}"] [data-blok-element-content]`).first().hover();
  await page.locator(HANDLE).click();
  await expect(page.locator(TUNES_POPOVER)).toBeVisible();
};

const deleteFromMenu = async (page: Page, id: string): Promise<void> => {
  await openTunes(page, id);
  await page.locator(`${TUNES_POPOVER} [data-blok-testid="popover-item"][data-blok-item-name="delete"]`).click();
  await expect(page.locator(TUNES_POPOVER)).toBeHidden();
  await wait(page, 300);
};

/** Drag block `sourceId` by its handle onto the right edge of `targetId`. */
const dropBeside = async (page: Page, sourceId: string, targetId: string): Promise<void> => {
  await page.locator(`[data-blok-id="${sourceId}"] [data-blok-element-content]`).first().hover();
  const handle = page.locator(HANDLE);

  await expect(handle).toBeVisible();
  const from = await handle.boundingBox();
  const to = await page.locator(`[data-blok-id="${targetId}"] [data-blok-element-content]`).first().boundingBox();

  if (from === null || to === null) {
    throw new Error('missing box for the drop');
  }
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width - 4, to.y + to.height / 2, { steps: 15 });
  await page.waitForFunction(() => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true');
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[data-blok-testid="drag-preview"]') === null);
  await wait(page, 300);
};

test.describe('selection after delete, move and column drop (V1 V2 V4 V6)', () => {
  test.describe.configure({ timeout: 30_000 });
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('U047: redo of a block-selected delete leaves nothing selected and no caret', async ({ page }) => {
    await createBlok(page, ABC);
    await clickEnd(page, 'b2');
    await press(page, 'Escape');
    await press(page, 'Backspace');
    expect(await ids(page)).toEqual(['b1', 'b3']);
    await wait(page, STEP_GAP_MS);

    await press(page, UNDO);
    expect(await selectedBlocks(page)).toEqual(['b2']);
    await press(page, REDO);

    expect(await caret(page)).toBe('none');
    expect(await selectedBlocks(page)).toEqual([]);
    expect(await ids(page)).toEqual(['b1', 'b3']);
  });

  test('U048: redo of a two-block delete leaves nothing selected and no caret', async ({ page }) => {
    await createBlok(page, [...ABC, P('b4', 'Delta')]);
    await clickEnd(page, 'b2');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Backspace');
    await wait(page, 200);
    expect(await ids(page)).toEqual(['b1', 'b4']);
    await wait(page, STEP_GAP_MS);

    await press(page, UNDO);
    expect(await selectedBlocks(page)).toEqual(['b2', 'b3']);
    await press(page, REDO);

    expect(await caret(page)).toBe('none');
    expect(await selectedBlocks(page)).toEqual([]);
  });

  test('U135: redo of a closed toggle delete leaves nothing selected and no caret', async ({ page }) => {
    await createBlok(page, [
      { id: 'b1', type: 'toggle', data: { text: 'Tog', isOpen: false }, content: ['k1', 'k2'] },
      P('k1', 'kid one', 'b1'), P('k2', 'kid two', 'b1'),
      P('b4', 'after'),
    ]);
    await clickEnd(page, 'b1');
    await press(page, 'Escape');
    expect(await selectedBlocks(page)).toEqual(['b1']);
    await press(page, 'Backspace');
    expect(await ids(page)).toEqual(['b4']);
    await wait(page, STEP_GAP_MS);

    await press(page, UNDO);
    expect(await ids(page)).toEqual(['b1', 'k1', 'k2', 'b4']);
    await press(page, REDO);

    expect(await ids(page)).toEqual(['b4']);
    expect(await caret(page)).toBe('none');
    expect(await selectedBlocks(page)).toEqual([]);
  });

  test('V1 caveat: an API undo and redo still put the caret at the end of the step', async ({ page }) => {
    await createBlok(page, ABC);
    await clickEnd(page, 'b1');
    await page.keyboard.type(' one');
    await wait(page, STEP_GAP_MS);
    await page.evaluate(() => {
      window.getSelection()?.removeAllRanges();
      window.blokInstance?.history.undo();
    });
    await wait(page, 200);
    await page.evaluate(() => {
      window.getSelection()?.removeAllRanges();
      window.blokInstance?.history.redo();
    });
    await wait(page, 200);

    expect(await caret(page)).toBe('b1:9');
  });

  test('V1 limit: a text redo whose undo was pressed with nothing live puts the caret at the end of the step', async ({ page }) => {
    await createBlok(page, ABC);
    await clickEnd(page, 'b1');
    await page.keyboard.type(' one');
    await wait(page, STEP_GAP_MS);
    await page.evaluate(() => {
      window.getSelection()?.removeAllRanges();
      (document.activeElement as HTMLElement | null)?.blur();
    });

    await press(page, UNDO);
    expect(await caret(page)).toBe('b1:5');
    await press(page, REDO);

    expect(await caret(page)).toBe('b1:9');
  });

  test('U104: Delete from the block menu leaves no caret; undo selects the block; redo leaves nothing', async ({ page }) => {
    await createBlok(page, ABC);
    await clickEnd(page, 'b2');
    await wait(page, STEP_GAP_MS);
    await deleteFromMenu(page, 'b2');

    expect(await ids(page)).toEqual(['b1', 'b3']);
    expect(await caret(page)).toBe('none');
    expect(await selectedBlocks(page)).toEqual([]);
    await wait(page, STEP_GAP_MS);

    await press(page, UNDO);
    expect(await selectedBlocks(page)).toEqual(['b2']);
    await press(page, REDO);
    expect(await ids(page)).toEqual(['b1', 'b3']);
    expect(await caret(page)).toBe('none');
    expect(await selectedBlocks(page)).toEqual([]);
  });

  test('U104: after a menu Delete, Backspace changes nothing and undo brings the block back in one step', async ({ page }) => {
    await createBlok(page, ABC);
    await clickEnd(page, 'b2');
    await wait(page, STEP_GAP_MS);
    await deleteFromMenu(page, 'b2');
    await press(page, 'Backspace');
    expect(await ids(page)).toEqual(['b1', 'b3']);
    await wait(page, STEP_GAP_MS);

    await press(page, UNDO);
    expect(await ids(page)).toEqual(['b1', 'b2', 'b3']);
  });

  test('U163: Delete of a table from its menu leaves no caret in the block above', async ({ page }) => {
    const content = [['ca1', 'cb1'], ['ca2', 'cb2']].map((row, r) => row.map((id, c) => ({ blocks: [id], id: `col${c}`, rowId: `row${r}` })));

    await createBlok(page, [
      P('b1', 'Above'),
      { id: 't1', type: 'table', data: { withHeadings: false, withHeadingColumn: false, content }, content: ['ca1', 'cb1', 'ca2', 'cb2'] },
      P('ca1', 'a1', 't1'), P('cb1', 'b1', 't1'), P('ca2', 'a2', 't1'), P('cb2', 'b2', 't1'),
    ]);
    await clickEnd(page, 'b1');
    await wait(page, STEP_GAP_MS);
    await deleteFromMenu(page, 't1');

    expect(await ids(page)).toEqual(['b1']);
    expect(await caret(page)).toBe('none');
  });

  test('U163 route 2: Backspace on a block-selected table leaves no caret; undo selects it; redo leaves nothing', async ({ page }) => {
    const content = [['ca1', 'cb1'], ['ca2', 'cb2']].map((row, r) => row.map((id, c) => ({ blocks: [id], id: `col${c}`, rowId: `row${r}` })));

    await createBlok(page, [
      P('b1', 'Above'),
      { id: 't1', type: 'table', data: { withHeadings: false, withHeadingColumn: false, content }, content: ['ca1', 'cb1', 'ca2', 'cb2'] },
      P('ca1', 'a1', 't1'), P('cb1', 'b1', 't1'), P('ca2', 'a2', 't1'), P('cb2', 'b2', 't1'),
    ]);
    await clickEnd(page, 'b1');
    await press(page, 'Escape');
    await press(page, 'ArrowDown');
    expect(await selectedBlocks(page)).toEqual(['t1']);
    await press(page, 'Backspace');
    expect(await ids(page)).toEqual(['b1']);
    expect(await caret(page)).toBe('none');
    await wait(page, STEP_GAP_MS);

    await press(page, UNDO);
    expect(await selectedBlocks(page)).toEqual(['t1']);
    await press(page, REDO);
    expect(await ids(page)).toEqual(['b1']);
    expect(await caret(page)).toBe('none');
  });

  test('U142: Delete of the last block in a column from its menu leaves no caret', async ({ page }) => {
    await createBlok(page, [
      { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['l1'] },
      P('l1', 'left', 'c1'),
      { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['r1'] },
      P('r1', 'right', 'c2'),
    ]);
    await clickEnd(page, 'l1');
    await wait(page, STEP_GAP_MS);
    await deleteFromMenu(page, 'r1');

    await expect.poll(() => ids(page)).toEqual(['l1']);
    expect(await caret(page)).toBe('none');
    await wait(page, STEP_GAP_MS);

    await press(page, UNDO);
    expect(await ids(page)).toEqual(['cl', 'c1', 'l1', 'c2', 'r1']);
    expect(await selectedBlocks(page)).toEqual(['r1']);
  });

  test('U113: redo of a keyboard move puts the caret where it was at the undo press', async ({ page }) => {
    await createBlok(page, [P('b1', 'one'), P('b2', 'two'), P('b3', 'three')]);
    await clickEnd(page, 'b3');
    await press(page, MOVE_UP);
    expect(await ids(page)).toEqual(['b1', 'b3', 'b2']);
    await wait(page, STEP_GAP_MS);

    await press(page, UNDO);
    expect(await ids(page)).toEqual(['b1', 'b2', 'b3']);
    expect(await caret(page)).toBe('b3:5');
    await press(page, REDO);

    expect(await ids(page)).toEqual(['b1', 'b3', 'b2']);
    expect(await caret(page)).toBe('b3:5');
  });

  // A4-1 (Notion RM2-1): a caret move keeps the caret at its offset, and redo returns there.
  for (const offset of [0, 2]) {
    test(`U113: a keyboard move keeps the caret at offset ${offset}, and redo returns to it`, async ({ page }) => {
      await createBlok(page, [P('b1', 'one'), P('b2', 'two'), P('b3', 'three')]);
      await clickEnd(page, 'b3');
      for (let i = 0; i < 5 - offset; i++) {
        await page.keyboard.press('ArrowLeft');
      }
      expect(await caret(page)).toBe(`b3:${offset}`);

      await press(page, MOVE_UP);
      expect(await ids(page)).toEqual(['b1', 'b3', 'b2']);
      expect(await caret(page)).toBe(`b3:${offset}`);
      await wait(page, STEP_GAP_MS);

      await press(page, MOVE_UP);
      expect(await ids(page)).toEqual(['b3', 'b1', 'b2']);
      expect(await caret(page)).toBe(`b3:${offset}`);
      await wait(page, STEP_GAP_MS);

      await press(page, UNDO);
      expect(await ids(page)).toEqual(['b1', 'b3', 'b2']);
      await press(page, REDO);
      expect(await ids(page)).toEqual(['b3', 'b1', 'b2']);
      expect(await caret(page)).toBe(`b3:${offset}`);
    });
  }

  test('U117: a column drop leaves the dragged block selected through the drop, undo and redo', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, [P('b1', 'left'), P('b2', 'right')]);
    await clickEnd(page, 'b1');
    await dropBeside(page, 'b2', 'b1');

    await expect.poll(async () => (await tree(page)).some((row) => row.startsWith('column_list:'))).toBe(true);
    expect(await selectedBlocks(page)).toEqual(['b2']);
    expect(await caret(page)).toBe('none');
    await wait(page, STEP_GAP_MS);

    await press(page, UNDO);
    expect(await ids(page)).toEqual(['b1', 'b2']);
    expect(await selectedBlocks(page)).toEqual(['b2']);
    expect(await caret(page)).toBe('none');

    await press(page, REDO);
    expect((await tree(page)).some((row) => row.startsWith('column_list:'))).toBe(true);
    expect(await selectedBlocks(page)).toEqual(['b2']);
    expect(await caret(page)).toBe('none');
  });

  test('U117: Backspace on the dropped selection deletes it as one undo step', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, [P('b1', 'left'), P('b2', 'right')]);
    await clickEnd(page, 'b1');
    await dropBeside(page, 'b2', 'b1');
    expect(await selectedBlocks(page)).toEqual(['b2']);
    await wait(page, STEP_GAP_MS);
    const dropped = await ids(page);

    await press(page, 'Backspace');
    expect(await ids(page)).not.toContain('b2');
    await wait(page, STEP_GAP_MS);

    await press(page, UNDO);
    expect(await ids(page)).toEqual(dropped);
  });
});
