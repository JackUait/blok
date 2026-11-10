import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const createBlok = async (page: Page, blocks: OutputData['blocks'], title?: string): Promise<void> => {
  await page.evaluate(async ({ holder, blocks: blokBlocks, title: pageTitle }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, pageTitle: pageTitle !== undefined, data: { blocks: blokBlocks } });

    window.blokInstance = blok;
    await blok.isReady;
    if (pageTitle !== undefined) {
      await blok.title.set(pageTitle, { record: false });
    }
    blok.history.clear();
  }, { holder: HOLDER_ID, blocks, title });
};

/** Where the caret is: the block id (or "title") and the text offset in its editable. */
const caret = async (page: Page): Promise<string> => page.evaluate(() => {
  const selection = window.getSelection();
  const node = selection?.anchorNode ?? null;
  const editable = (node instanceof Element ? node : node?.parentElement)?.closest('[contenteditable="true"]');

  if (selection === null || node === null || !(editable instanceof HTMLElement)) {
    return `none (${document.activeElement?.tagName ?? ''})`;
  }
  const before = document.createRange();

  before.setStart(editable, 0);
  before.setEnd(node, selection.anchorOffset);
  const owner = editable.hasAttribute('data-blok-page-title') ? 'title' : editable.closest('[data-blok-id]')?.getAttribute('data-blok-id');

  return `${owner ?? '?'}:${before.toString().length}`;
});

const wait = async (page: Page, ms: number): Promise<void> => {
  await page.evaluate(async (timeout) => {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeout);
    });
  }, ms);
};

const press = async (page: Page, key: string): Promise<void> => {
  await page.keyboard.press(key);
  await wait(page, 150);
};

const clickEnd = async (page: Page, editable: ReturnType<Page['locator']>): Promise<void> => {
  await editable.click();
  await page.keyboard.press('End');
  await wait(page, 250);
};

const blockText = (page: Page, id: string): ReturnType<Page['locator']> =>
  page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

const parentOf = async (page: Page, id: string): Promise<string | null | undefined> => page.evaluate(async (blockId) => {
  const saved = await window.blokInstance?.save();

  return saved?.blocks.find((block) => block.id === blockId)?.parent ?? null;
}, id);

const LIST: OutputData['blocks'] = [
  { id: 'b1', type: 'list', data: { text: 'one', style: 'unordered' } },
  { id: 'b2', type: 'list', data: { text: 'two', style: 'unordered' } },
];

test.describe('undo audit: title and indent carets', () => {
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('Tab on a list item keeps the caret offset through undo and redo', async ({ page }) => {
    await createBlok(page, LIST);
    await clickEnd(page, blockText(page, 'b2'));

    await press(page, 'Tab');
    expect(await caret(page)).toBe('b2:3');
    expect(await parentOf(page, 'b2')).toBe('b1');

    await press(page, UNDO);
    expect(await caret(page)).toBe('b2:3');
    expect(await parentOf(page, 'b2')).toBeNull();

    await press(page, REDO);
    expect(await caret(page)).toBe('b2:3');
    expect(await parentOf(page, 'b2')).toBe('b1');
  });

  test('Shift+Tab on a nested list item keeps the caret offset', async ({ page }) => {
    await createBlok(page, LIST);
    await clickEnd(page, blockText(page, 'b2'));
    await press(page, 'Tab');

    await press(page, 'Shift+Tab');
    expect(await caret(page)).toBe('b2:3');
    expect(await parentOf(page, 'b2')).toBeNull();

    await press(page, UNDO);
    expect(await caret(page)).toBe('b2:3');
    expect(await parentOf(page, 'b2')).toBe('b1');
  });

  test('Tab into a closed toggle opens it and keeps the caret; undo leaves it open', async ({ page }) => {
    await createBlok(page, [
      { id: 'b1', type: 'toggle', data: { text: 'Tog' }, content: ['b2'] },
      { id: 'b2', type: 'paragraph', data: { text: 'kid' }, parent: 'b1' },
      { id: 'b3', type: 'paragraph', data: { text: 'move me' } },
    ]);
    const toggleState = page.locator('[data-blok-id="b1"] [data-blok-toggle-open]').first();

    await expect(toggleState).toHaveAttribute('data-blok-toggle-open', 'false');
    await clickEnd(page, blockText(page, 'b3'));

    await press(page, 'Tab');
    await expect(toggleState).toHaveAttribute('data-blok-toggle-open', 'true');
    await expect(blockText(page, 'b3')).toBeVisible();
    expect(await caret(page)).toBe('b3:7');
    expect(await parentOf(page, 'b3')).toBe('b1');

    await press(page, UNDO);
    expect(await parentOf(page, 'b3')).toBeNull();
    expect(await caret(page)).toBe('b3:7');
    await expect(toggleState).toHaveAttribute('data-blok-toggle-open', 'true');
    expect(await page.evaluate(() => window.blokInstance?.history.canUndo())).toBe(false);
  });

  test('title undo puts the caret at the edit and redo after it', async ({ page }) => {
    await createBlok(page, [{ id: 'b1', type: 'paragraph', data: { text: 'Body' } }], 'Lab notes');
    await clickEnd(page, page.getByTestId('page-header-title'));
    for (const _ of [1, 2, 3, 4, 5, 6]) {
      await page.keyboard.press('ArrowLeft');
    }

    await page.keyboard.type('X');
    await wait(page, 800);

    await press(page, UNDO);
    expect(await page.evaluate(() => window.blokInstance?.title.get())).toBe('Lab notes');
    expect(await caret(page)).toBe('title:3');

    await press(page, REDO);
    expect(await page.evaluate(() => window.blokInstance?.title.get())).toBe('LabX notes');
    expect(await caret(page)).toBe('title:4');
  });

  test('undo of Enter mid-title goes back to the split; redo to the new block', async ({ page }) => {
    await createBlok(page, [{ id: 'b1', type: 'paragraph', data: { text: 'Body' } }], 'Lab notes');
    await clickEnd(page, page.getByTestId('page-header-title'));
    for (const _ of [1, 2, 3, 4, 5, 6]) {
      await page.keyboard.press('ArrowLeft');
    }

    await press(page, 'Enter');
    await wait(page, 800);
    const newId = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks[0]?.id);

    await press(page, UNDO);
    expect(await page.evaluate(() => window.blokInstance?.title.get())).toBe('Lab notes');
    expect(await caret(page)).toBe('title:3');

    await press(page, REDO);
    expect(await page.evaluate(() => window.blokInstance?.title.get())).toBe('Lab');
    expect(await caret(page)).toBe(`${newId}:0`);
  });

  test('fast typing in the title is one undo step', async ({ page }) => {
    await createBlok(page, [{ id: 'b1', type: 'paragraph', data: { text: 'Body' } }], 'Lab');
    await clickEnd(page, page.getByTestId('page-header-title'));

    await page.keyboard.type(' page');
    await wait(page, 800);

    await press(page, UNDO);
    expect(await page.evaluate(() => window.blokInstance?.title.get())).toBe('Lab');
    expect(await caret(page)).toBe('title:3');
  });
});
