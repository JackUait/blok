import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
// Yjs captureTimeout (500ms) plus a buffer: waiting this long closes the current undo entry.
const CAPTURE = 600;

declare global {
  interface Window {
    blokInstance?: Blok;
  }
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
    container.setAttribute('data-blok-testid', holder);
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

/** Live DOM, one "component:innerHTML" entry per block, document order. */
const dom = async (page: Page): Promise<string[]> => {
  return page.evaluate((holder) => {
    const root = document.getElementById(holder);

    if (root === null) {
      return [];
    }

    return Array.from(root.querySelectorAll('[data-blok-testid="block-wrapper"]')).map((wrapper) => {
      const editable = wrapper.querySelector('[contenteditable="true"]');

      return `${wrapper.getAttribute('data-blok-component') ?? '?'}:${editable?.innerHTML ?? ''}`;
    });
  }, HOLDER_ID);
};

/** Saved data, one "type:text" entry per block. */
const saved = async (page: Page): Promise<string[]> => {
  return page.evaluate(async () => {
    const out = await window.blokInstance?.save();

    return (out?.blocks ?? []).map((block) => `${block.type}:${(block.data as { text?: string }).text ?? ''}`);
  });
};

const fullSaved = async (page: Page): Promise<string> => {
  return page.evaluate(async () => JSON.stringify((await window.blokInstance?.save())?.blocks.map((b) => ({
    type: b.type,
    data: b.data,
    parent: b.parent,
    content: b.content,
  }))));
};

const input = (page: Page, index: number): Locator =>
  page.locator(`#${HOLDER_ID} [data-blok-testid="block-wrapper"] [contenteditable="true"]`).nth(index);

const paste = async (target: Locator, data: Record<string, string>): Promise<void> => {
  await target.evaluate((node: HTMLElement, clip: Record<string, string>) => {
    const event = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: { getData: (type: string): string => clip[type] ?? '', types: Object.keys(clip) },
    });

    node.dispatchEvent(event);
  }, data);
};

const undoOnce = async (page: Page): Promise<void> => {
  await page.keyboard.press(UNDO);
  await wait(page, 300);
};

test.describe('undo audit: grouping and boundaries', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  // GRP-1. Expected: a block merge is its own undo step, like Enter (see undo-redo.spec.ts
  // "typing IMMEDIATELY after Enter ... separate undo checkpoints").
  test('GRP-1: Delete-forward merge right after typing is a separate undo step from the typing', async ({ page }) => {
    await create(page, [{ type: 'paragraph', data: { text: 'Hello' } }, { type: 'paragraph', data: { text: 'World' } }]);
    await input(page, 0).click();
    await page.keyboard.press('End');
    await wait(page, CAPTURE);

    await page.keyboard.type('xy');
    await page.keyboard.press('Delete');
    await wait(page, CAPTURE);
    await expect.poll(() => dom(page)).toEqual(['paragraph:HelloxyWorld']);

    await undoOnce(page);

    expect(await dom(page)).toEqual(['paragraph:Helloxy', 'paragraph:World']);
    expect(await saved(page)).toEqual(['paragraph:Helloxy', 'paragraph:World']);
  });

  // GRP-1b. Same root cause as GRP-1, Backspace direction.
  test('GRP-1b: Backspace merge right after typing is a separate undo step from the typing', async ({ page }) => {
    await create(page, [{ type: 'paragraph', data: { text: 'Hello' } }, { type: 'paragraph', data: { text: 'World' } }]);
    await input(page, 1).click();
    await page.keyboard.press('End');
    await wait(page, CAPTURE);

    await page.keyboard.type('xy');
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    await wait(page, CAPTURE);
    await expect.poll(() => dom(page)).toEqual(['paragraph:HelloWorldxy']);

    await undoOnce(page);

    expect(await dom(page)).toEqual(['paragraph:Hello', 'paragraph:Worldxy']);
    expect(await saved(page)).toEqual(['paragraph:Hello', 'paragraph:Worldxy']);
  });

  // GRP-2. Expected: a paste is its own undo step (paste/handlers/base.ts promises
  // "one Cmd+Z removes the whole paste" for multi-block paste; native editors do the same).
  test('GRP-2: inline plain-text paste right after typing is a separate undo step', async ({ page }) => {
    await create(page, [{ type: 'paragraph', data: { text: '' } }]);
    await input(page, 0).click();

    await page.keyboard.type('ab');
    await paste(input(page, 0), { 'text/plain': 'PASTE' });
    await wait(page, CAPTURE);
    await expect.poll(() => dom(page)).toEqual(['paragraph:abPASTE']);

    await undoOnce(page);

    expect(await dom(page)).toEqual(['paragraph:ab']);
    expect(await saved(page)).toEqual(['paragraph:ab']);
  });

  // One undo reverts a markdown conversion and leaves the literal marker
  // (Notion parity; "# ", "- ", "1. ", "[] ", "\" ", "---" all do this in one step).
  test('GRP-3: one undo reverts the "> " toggle shortcut to the literal text', async ({ page }) => {
    await create(page, [{ type: 'paragraph', data: { text: '' } }]);
    await input(page, 0).click();

    await page.keyboard.type('> ');
    await wait(page, CAPTURE);
    await expect.poll(() => dom(page)).toEqual(['toggle:']);

    await undoOnce(page);

    expect(await dom(page)).toEqual(['paragraph:&gt;&nbsp;']);
    expect(await saved(page)).toEqual(['paragraph:&gt;&nbsp;']);
  });

  // GRP-4. Expected: typing over selected blocks is one gesture, so one undo restores them
  // (Delete over a selection is one step: undo-redo.spec.ts "multi-block delete requires single undo").
  test('GRP-4: one undo after typing over a block selection restores the selected blocks', async ({ page }) => {
    await create(page, [
      { type: 'paragraph', data: { text: 'First' } },
      { type: 'paragraph', data: { text: 'Second' } },
      { type: 'paragraph', data: { text: 'Third' } },
    ]);
    await input(page, 0).click();
    await page.keyboard.press('End');
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.up('Shift');
    await expect(page.locator(`#${HOLDER_ID} [data-blok-selected="true"]`)).toHaveCount(3);

    await page.keyboard.type('Z');
    await wait(page, CAPTURE);
    await expect.poll(() => dom(page)).toEqual(['paragraph:Z']);

    await undoOnce(page);

    expect(await dom(page)).toEqual(['paragraph:First', 'paragraph:Second', 'paragraph:Third']);
    expect(await saved(page)).toEqual(['paragraph:First', 'paragraph:Second', 'paragraph:Third']);
  });

  // GRP-5. Expected: a committed IME composition is one undo step, and undo never restores
  // text the user never committed. Pausing over a candidate list for >500ms is normal.
  test('GRP-5: one undo removes a whole IME composition even when the user paused mid-composition', async ({ page }) => {
    await create(page, [{ type: 'paragraph', data: { text: 'Hello' } }]);
    await input(page, 0).click();
    await page.keyboard.press('End');
    await wait(page, CAPTURE);
    const cdp = await page.context().newCDPSession(page);

    await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
    await wait(page, CAPTURE);
    await cdp.send('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 });
    await wait(page, CAPTURE);
    await cdp.send('Input.insertText', { text: '日本' });
    await wait(page, CAPTURE);
    await expect.poll(() => dom(page)).toEqual(['paragraph:Hello日本']);

    await undoOnce(page);

    expect(await dom(page)).toEqual(['paragraph:Hello']);
    expect(await saved(page)).toEqual(['paragraph:Hello']);
  });

  test('a fast IME composition is one undo step', async ({ page }) => {
    await create(page, [{ type: 'paragraph', data: { text: 'Hello' } }]);
    await input(page, 0).click();
    await page.keyboard.press('End');
    await wait(page, CAPTURE);
    const cdp = await page.context().newCDPSession(page);

    await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 });
    await cdp.send('Input.insertText', { text: '日本' });
    await wait(page, CAPTURE);
    await expect.poll(() => dom(page)).toEqual(['paragraph:Hello日本']);

    await undoOnce(page);

    expect(await dom(page)).toEqual(['paragraph:Hello']);
    expect(await saved(page)).toEqual(['paragraph:Hello']);
  });

  test('one undo reverts a multi-line paste into a table cell', async ({ page }) => {
    await create(page, [{ type: 'table', data: { withHeadings: false, content: [['a', 'b'], ['c', 'd']] } }]);
    const cell = input(page, 0);

    await cell.click();
    await page.keyboard.press('End');
    await wait(page, CAPTURE);
    const before = await fullSaved(page);

    await paste(cell, { 'text/html': '<p>P1</p><p>P2</p>', 'text/plain': 'P1\nP2' });
    await wait(page, CAPTURE);
    await expect.poll(() => fullSaved(page)).toContain('"P2"');

    await undoOnce(page);

    expect(await fullSaved(page)).toBe(before);
    await expect(page.getByText('P1')).toHaveCount(0);
  });
});
