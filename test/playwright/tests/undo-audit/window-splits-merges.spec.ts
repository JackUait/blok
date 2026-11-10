import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { blocksAsHtml } from '../helpers/saved-as-html';

/**
 * Within ~708 ms of a step's first key, Shift+Enter, Enters and a Backspace
 * merge join the step, as in Notion (docs/plans/replica-undo/notion-measured-B.md
 * U032, U044, U098, U101). Typing, Enter, typing stays three steps (U033).
 */

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
// The key runs below must fit the window; a slower run fails here, not as a grouping bug.
const RUN_BUDGET_MS = 600;

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

interface Caret {
  blockId: string | null;
  offset: number | null;
}

const create = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.evaluate(async ({ holder, blocks: data }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: { blocks: data } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blocks });
};

const wait = async (page: Page, ms: number): Promise<void> => {
  await page.evaluate(async (t) => {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, t);
    });
  }, ms);
};

/** Saved blocks as "id type:text". */
const saved = async (page: Page): Promise<string[]> => {
  const blocks = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);

  return blocksAsHtml(blocks).map((block) => `${block.id ?? '?'} ${block.type}:${(block.data as { text?: string }).text ?? ''}`);
};

/** Saved text per block, without ids. */
const texts = async (page: Page): Promise<string[]> =>
  (await saved(page)).map((entry) => entry.slice(entry.indexOf(' ') + 1));

const caret = async (page: Page): Promise<Caret> => page.evaluate(() => {
  const selection = window.getSelection();

  if (selection === null || selection.rangeCount === 0) {
    return { blockId: null, offset: null };
  }

  const range = selection.getRangeAt(0);
  const anchor = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const editable = anchor?.closest('[contenteditable="true"]') ?? null;
  const pre = document.createRange();

  if (editable === null) {
    return { blockId: null, offset: null };
  }
  pre.selectNodeContents(editable);
  pre.setEnd(range.startContainer, range.startOffset);

  return { blockId: anchor?.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? null, offset: pre.toString().length };
});

/** Focus a block's editable and collapse the caret at a text offset, as a click would. */
const placeCaret = async (page: Page, blockId: string, offset: number): Promise<void> => {
  await page.locator(`#${HOLDER_ID} [data-blok-id="${blockId}"] [contenteditable="true"]`).click();
  await page.evaluate(({ id, off }) => {
    const editable = document.querySelector<HTMLElement>(`[data-blok-id="${id}"] [contenteditable="true"]`);
    const text = editable?.firstChild;

    if (editable === null || text === null || text === undefined) {
      throw new Error(`no text in ${id}`);
    }
    window.getSelection()?.collapse(text, off);
  }, { id: blockId, off: offset });
  // Let the click's step close before the run.
  await wait(page, 300);
};

/** Run the keys and fail if they took longer than the window allows. */
const fastRun = async (page: Page, run: () => Promise<void>): Promise<void> => {
  const started = Date.now();

  await run();
  expect(Date.now() - started, 'the key run must fit inside the typing window').toBeLessThan(RUN_BUDGET_MS);
  await wait(page, 1000);
};

const press = async (page: Page, key: string): Promise<void> => {
  await page.keyboard.press(key);
  await wait(page, 300);
};

test.describe('undo audit: splits, soft breaks and merges in the typing window', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('U032: typing, Shift+Enter and typing are one step', async ({ page }) => {
    await create(page, [{ id: 'b1', type: 'paragraph', data: { text: 'Alpha' } }]);
    await placeCaret(page, 'b1', 5);

    await fastRun(page, async () => {
      await page.keyboard.type(' one');
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('two');
    });
    const after = await texts(page);
    const caretAfter = await caret(page);

    expect(after).toHaveLength(1);
    expect(after[0]).toContain('two');

    await press(page, UNDO);
    expect(await texts(page)).toEqual(['paragraph:Alpha']);
    expect(await caret(page)).toEqual({ blockId: 'b1', offset: 5 });

    await press(page, REDO);
    expect(await texts(page)).toEqual(after);
    expect(await caret(page)).toEqual(caretAfter);
  });

  test('U044: three fast Enters are one step; redo brings back the same blocks', async ({ page }) => {
    await create(page, [{ id: 'b1', type: 'paragraph', data: { text: 'abcd' } }]);
    await placeCaret(page, 'b1', 1);

    await fastRun(page, async () => {
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
    });
    const after = await saved(page);
    const caretAfter = await caret(page);

    expect(after.map((entry) => entry.slice(entry.indexOf(' ') + 1))).toEqual(['paragraph:a', 'paragraph:b', 'paragraph:c', 'paragraph:d']);

    await press(page, UNDO);
    expect(await saved(page)).toEqual(['b1 paragraph:abcd']);
    expect(await caret(page)).toEqual({ blockId: 'b1', offset: 1 });

    await press(page, REDO);
    expect(await saved(page)).toEqual(after);
    expect(caretAfter.offset).toBe(0);
    expect(await caret(page)).toEqual(caretAfter);
  });

  test('U033: typing, Enter and typing stay three steps however fast', async ({ page }) => {
    await create(page, [{ id: 'b1', type: 'paragraph', data: { text: 'Alpha' } }]);
    await placeCaret(page, 'b1', 5);

    await fastRun(page, async () => {
      await page.keyboard.type(' one');
      await page.keyboard.press('Enter');
      await page.keyboard.type('two');
    });
    expect(await texts(page)).toEqual(['paragraph:Alpha one', 'paragraph:two']);

    await press(page, UNDO);
    expect(await texts(page)).toEqual(['paragraph:Alpha one', 'paragraph:']);
    await press(page, UNDO);
    expect(await texts(page)).toEqual(['paragraph:Alpha one']);
    await press(page, UNDO);
    expect(await texts(page)).toEqual(['paragraph:Alpha']);
  });

  test('U101: typing then a fast Backspace merge is one step', async ({ page }) => {
    await create(page, [
      { id: 'b1', type: 'paragraph', data: { text: 'Alpha' } },
      { id: 'b2', type: 'paragraph', data: { text: 'Beta' } },
    ]);
    await placeCaret(page, 'b2', 0);

    await fastRun(page, async () => {
      await page.keyboard.type('X');
      await page.keyboard.press('Home');
      await page.keyboard.press('Backspace');
    });
    expect(await saved(page)).toEqual(['b1 paragraph:AlphaXBeta']);
    const caretAfter = await caret(page);

    await press(page, UNDO);
    expect(await saved(page)).toEqual(['b1 paragraph:Alpha', 'b2 paragraph:Beta']);
    expect(await caret(page)).toEqual({ blockId: 'b2', offset: 0 });

    await press(page, REDO);
    expect(await saved(page)).toEqual(['b1 paragraph:AlphaXBeta']);
    expect(await caret(page)).toEqual(caretAfter);
    expect(caretAfter).toEqual({ blockId: 'b1', offset: 5 });
  });

  test('U098 shape: a merge and the Backspace after it in the block above are one step', async ({ page }) => {
    await create(page, [
      { id: 'b1', type: 'paragraph', data: { text: 'Alpha' } },
      { id: 'b2', type: 'paragraph', data: { text: 'Beta' } },
    ]);
    await placeCaret(page, 'b2', 0);

    await fastRun(page, async () => {
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
    });
    expect(await saved(page)).toEqual(['b1 paragraph:AlphBeta']);

    await press(page, UNDO);
    expect(await saved(page)).toEqual(['b1 paragraph:Alpha', 'b2 paragraph:Beta']);
    expect(await caret(page)).toEqual({ blockId: 'b2', offset: 0 });

    await press(page, REDO);
    expect(await saved(page)).toEqual(['b1 paragraph:AlphBeta']);
    expect(await caret(page)).toEqual({ blockId: 'b1', offset: 4 });
  });

  test('U098: two fast Backspaces at a heading start are one step', async ({ page }) => {
    await create(page, [
      { id: 'b1', type: 'paragraph', data: { text: 'Alpha' } },
      { id: 'b2', type: 'header', data: { text: 'Beta', level: 2 } },
    ]);
    await placeCaret(page, 'b2', 0);

    await fastRun(page, async () => {
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
    });
    expect(await texts(page)).toEqual(['paragraph:AlphaBeta']);
    const caretAfter = await caret(page);

    await press(page, UNDO);
    expect(await saved(page)).toEqual(['b1 paragraph:Alpha', 'b2 header:Beta']);
    expect(await caret(page)).toEqual({ blockId: 'b2', offset: 0 });

    await press(page, REDO);
    expect(await texts(page)).toEqual(['paragraph:AlphaBeta']);
    expect(await caret(page)).toEqual(caretAfter);
  });
});
